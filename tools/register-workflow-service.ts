import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import type {
  OpenClawPluginService,
  OpenClawPluginServiceContext,
} from "../runtime-api.js";
import type { PluginRegistrationContext } from "./plugin-registration-shared";
import {
  enqueueWorkflowTask,
  resolveWorkflowProjectQueueKey,
} from "./workflow-coordination";
import {
  getIdleResearchStateSummary,
  listChannelProjectBindingsForWorkflow,
  runWorkflowAutoIterator,
} from "./workflow-guard";
import { deriveAgentSessionKeyForRole } from "./agent-task-dispatch";

type WorkflowCoordinatorLogger = {
  debug?: (message: string, meta?: Record<string, unknown>) => void;
  info?: (message: string, meta?: Record<string, unknown>) => void;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
};

type WorkflowCoordinatorProject = {
  projectId: string | null;
  projectRoot: string;
  source: "projects_state" | "scan";
  stage: string | null;
  updatedAt: string | null;
};

type WorkflowCoordinatorDependencies = {
  runWorkflowAutoIterator: typeof runWorkflowAutoIterator;
  listWorkflowCoordinatorProjects: typeof listWorkflowCoordinatorProjects;
  getIdleResearchStateSummary: typeof getIdleResearchStateSummary;
  listChannelProjectBindingsForWorkflow: typeof listChannelProjectBindingsForWorkflow;
};

type RuntimeSubagentApi = {
  run: (params: {
    sessionKey: string;
    message: string;
    lane?: string;
    deliver?: boolean;
    idempotencyKey?: string;
    extraSystemPrompt?: string;
  }) => Promise<{ runId: string }>;
};

type IdleResearchLaunchAttempt = {
  launched: boolean;
  reason:
    | "started"
    | "no_runtime_subagent"
    | "no_recommended_idle_research"
    | "idle_research_disabled"
    | "idle_research_not_due"
    | "idle_research_topic_missing"
    | "idle_research_already_launched";
  projectId: string | null;
  projectRoot: string;
  topic: string | null;
  sessionKey: string | null;
  runId: string | null;
  dueKey: string | null;
};

const DEFAULT_WORKFLOW_COORDINATOR_INTERVAL_MS = 120_000;
const DEFAULT_WORKFLOW_COORDINATOR_MAX_PROJECTS = 3;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function slugifyForIdempotency(value: string): string {
  return value.replace(/[^a-z0-9_.:-]+/gi, "-");
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function resolveProjectRootFromStateEntry(
  projectsRoot: string,
  entry: Record<string, unknown>
): string | null {
  const dir = readString(entry.dir);
  if (dir) {
    return path.isAbsolute(dir) ? path.resolve(dir) : path.resolve(projectsRoot, dir);
  }
  const projectId = readString(entry.id);
  return projectId ? path.resolve(projectsRoot, projectId) : null;
}

async function listProjectsFromStateFile(params: {
  projectsRoot: string;
  maxProjects: number;
}): Promise<WorkflowCoordinatorProject[]> {
  const projectsStatePath = path.join(params.projectsRoot, "PROJECTS_STATE.json");
  const state = await readJsonIfExists<Record<string, unknown>>(projectsStatePath);
  const projects = Array.isArray(state?.projects)
    ? state.projects.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
      )
    : [];
  const results: WorkflowCoordinatorProject[] = [];

  for (const entry of projects) {
    if (readString(entry.status)?.toLowerCase() === "completed") {
      continue;
    }
    if (readString(entry.stage)?.toLowerCase() === "done") {
      continue;
    }
    const projectRoot = resolveProjectRootFromStateEntry(params.projectsRoot, entry);
    if (!projectRoot) {
      continue;
    }
    if (!(await fileExists(path.join(projectRoot, "PROJECT_MANIFEST.json")))) {
      continue;
    }
    results.push({
      projectId: readString(entry.id),
      projectRoot,
      source: "projects_state",
      stage: readString(entry.stage),
      updatedAt: readString(entry.updated),
    });
    if (results.length >= params.maxProjects) {
      break;
    }
  }

  return results;
}

async function listProjectsFromDirectoryScan(params: {
  projectsRoot: string;
  maxProjects: number;
}): Promise<WorkflowCoordinatorProject[]> {
  let entries: Dirent<string>[] = [];
  try {
    entries = (await fs.readdir(params.projectsRoot, {
      withFileTypes: true,
      encoding: "utf8",
    })) as Dirent<string>[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const results: WorkflowCoordinatorProject[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const projectRoot = path.join(params.projectsRoot, entry.name);
    const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
    const manifest = await readJsonIfExists<Record<string, unknown>>(manifestPath);
    if (!manifest) {
      continue;
    }
    if (readString(manifest.current_stage)?.toLowerCase() === "done") {
      continue;
    }
    results.push({
      projectId: readString(manifest.project_id) ?? entry.name,
      projectRoot,
      source: "scan",
      stage: readString(manifest.current_stage),
      updatedAt: readString(manifest.last_heartbeat_at),
    });
    if (results.length >= params.maxProjects) {
      break;
    }
  }

  return results;
}

export async function listWorkflowCoordinatorProjects(params: {
  projectsRoot: string;
  maxProjects?: number;
}): Promise<WorkflowCoordinatorProject[]> {
  const projectsRoot = path.resolve(params.projectsRoot);
  const maxProjects = Math.max(
    1,
    Math.floor(params.maxProjects ?? DEFAULT_WORKFLOW_COORDINATOR_MAX_PROJECTS)
  );
  const fromState = await listProjectsFromStateFile({
    projectsRoot,
    maxProjects,
  });
  if (fromState.length > 0) {
    return fromState;
  }
  return listProjectsFromDirectoryScan({
    projectsRoot,
    maxProjects,
  });
}

export async function runWorkflowCoordinatorPass(params: {
  projectsRoot: string;
  cooldownSeconds: number;
  queueMailbox: boolean;
  maxProjects?: number;
  logger?: WorkflowCoordinatorLogger;
  deps?: Partial<WorkflowCoordinatorDependencies>;
}) {
  const deps: WorkflowCoordinatorDependencies = {
    runWorkflowAutoIterator,
    listWorkflowCoordinatorProjects,
    getIdleResearchStateSummary,
    listChannelProjectBindingsForWorkflow,
    ...params.deps,
  };
  const projects = await deps.listWorkflowCoordinatorProjects({
    projectsRoot: params.projectsRoot,
    maxProjects: params.maxProjects,
  });
  const results = [];

  for (const project of projects) {
    const result = await enqueueWorkflowTask({
      key: resolveWorkflowProjectQueueKey(project.projectRoot),
      label: "workflow_coordinator_tick",
      logger: params.logger,
      task: () =>
        deps.runWorkflowAutoIterator({
          projectRoot: project.projectRoot,
          agentId: "researcher",
          mode: "service",
          queueMailbox: params.queueMailbox,
          cooldownSeconds: params.cooldownSeconds,
        }),
    });
    results.push({
      ...project,
      result,
    });
  }

  return results;
}

function hasRecommendedIdleResearchAction(result: {
  recommendedActions: Array<{
    kind: string;
    owner: string | null;
    command: string | null;
  }>;
}): boolean {
  return result.recommendedActions.some(
    (action) =>
      action.kind === "background" &&
      action.owner === "researcher" &&
      /\/idle-research\b/i.test(action.command ?? "")
  );
}

function buildIdleResearchDueKey(params: {
  projectRoot: string;
  topic: string;
  nextDueAt: string | null;
}) {
  return [
    path.resolve(params.projectRoot),
    params.topic.trim().toLowerCase(),
    params.nextDueAt ?? "due-now",
  ].join("::");
}

function resolveResearcherIdleResearchSessionKey(params: {
  projectRoot: string;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  deps: WorkflowCoordinatorDependencies;
}): string {
  const bindings = params.deps.listChannelProjectBindingsForWorkflow({
    policy: params.workflowPolicy,
  });
  const binding = bindings.bindings
    .filter(
      (entry) => path.resolve(entry.projectRoot) === path.resolve(params.projectRoot)
    )
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    )[0];
  if (binding?.sessionKeySample) {
    return deriveAgentSessionKeyForRole({
      requesterSessionKey: binding.sessionKeySample,
      targetRole: "researcher",
    });
  }
  return "agent:researcher:main";
}

function buildIdleResearchCoordinatorMessage(params: {
  projectId: string | null;
  projectRoot: string;
  topic: string;
}) {
  return [
    `/idle-research ${JSON.stringify(params.topic)}`,
    "",
    "Workflow coordinator background task.",
    params.projectId ? `Project ID: ${params.projectId}` : null,
    `Project root: ${params.projectRoot}`,
    "This project is currently idle or waiting on another owner, and idle_research is due.",
    "Before fresh work, read research_workflow.get_idle_research. If it is still due, complete exactly one bounded idle-research round for this topic.",
    "Record the round through research_workflow.record_idle_research_run, including digest path, paper counts, and graph-refresh follow-up.",
    "Do not change active tracks, rewrite PLAN.md, or launch experiments from this background round.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function maybeLaunchIdleResearchForProject(params: {
  runtimeSubagent?: RuntimeSubagentApi;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  projectRoot: string;
  projectId: string | null;
  autoIteratorResult: {
    recommendedActions: Array<{
      kind: string;
      owner: string | null;
      command: string | null;
    }>;
  };
  launchedDueKeys: Map<string, string>;
  logger?: WorkflowCoordinatorLogger;
  deps?: Partial<WorkflowCoordinatorDependencies>;
}) {
  const deps: WorkflowCoordinatorDependencies = {
    runWorkflowAutoIterator,
    listWorkflowCoordinatorProjects,
    getIdleResearchStateSummary,
    listChannelProjectBindingsForWorkflow,
    ...params.deps,
  };

  return enqueueWorkflowTask({
    key: resolveWorkflowProjectQueueKey(params.projectRoot),
    label: "workflow_idle_research_launch",
    logger: params.logger,
    task: async (): Promise<IdleResearchLaunchAttempt> => {
      if (!params.runtimeSubagent) {
        return {
          launched: false,
          reason: "no_runtime_subagent",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          topic: null,
          sessionKey: null,
          runId: null,
          dueKey: null,
        };
      }

      if (!hasRecommendedIdleResearchAction(params.autoIteratorResult)) {
        params.launchedDueKeys.delete(params.projectRoot);
        return {
          launched: false,
          reason: "no_recommended_idle_research",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          topic: null,
          sessionKey: null,
          runId: null,
          dueKey: null,
        };
      }

      const idleResearch = await deps.getIdleResearchStateSummary({
        projectRoot: params.projectRoot,
      });
      const topic = readString(idleResearch.state.topic);
      if (!idleResearch.state.enabled) {
        params.launchedDueKeys.delete(params.projectRoot);
        return {
          launched: false,
          reason: "idle_research_disabled",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          topic,
          sessionKey: null,
          runId: null,
          dueKey: null,
        };
      }
      if (!idleResearch.due) {
        params.launchedDueKeys.delete(params.projectRoot);
        return {
          launched: false,
          reason: "idle_research_not_due",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          topic,
          sessionKey: null,
          runId: null,
          dueKey: null,
        };
      }
      if (!topic) {
        params.launchedDueKeys.delete(params.projectRoot);
        return {
          launched: false,
          reason: "idle_research_topic_missing",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          topic: null,
          sessionKey: null,
          runId: null,
          dueKey: null,
        };
      }

      const dueKey = buildIdleResearchDueKey({
        projectRoot: params.projectRoot,
        topic,
        nextDueAt: idleResearch.nextDueAt,
      });
      if (params.launchedDueKeys.get(params.projectRoot) === dueKey) {
        return {
          launched: false,
          reason: "idle_research_already_launched",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          topic,
          sessionKey: null,
          runId: null,
          dueKey,
        };
      }

      const sessionKey = resolveResearcherIdleResearchSessionKey({
        projectRoot: params.projectRoot,
        workflowPolicy: params.workflowPolicy,
        deps,
      });
      const runId = (
        await params.runtimeSubagent.run({
          sessionKey,
          message: buildIdleResearchCoordinatorMessage({
            projectId: params.projectId,
            projectRoot: params.projectRoot,
            topic,
          }),
          lane: "nested",
          deliver: false,
          idempotencyKey: slugifyForIdempotency(
            `openclaw-research:idle-research:${params.projectId ?? path.basename(params.projectRoot)}:${dueKey}`
          ),
          extraSystemPrompt:
            "Workflow idle-research background continuation.\n" +
            "Execute only for the specified project, obey the idle_research contract, and record the round durably.",
        })
      ).runId;
      params.launchedDueKeys.set(params.projectRoot, dueKey);
      return {
        launched: true,
        reason: "started",
        projectId: params.projectId,
        projectRoot: params.projectRoot,
        topic,
        sessionKey,
        runId,
        dueKey,
      };
    },
  });
}

function summarizeCoordinatorPass(
  results: Awaited<ReturnType<typeof runWorkflowCoordinatorPass>>
) {
  return results.map((entry) => ({
    projectId: entry.projectId,
    stageBefore: entry.result.stageBefore,
    stageAfter: entry.result.stageAfter,
    stageChanged: entry.result.stageChanged,
    regressed: entry.result.regressed,
    recommendedActionKinds: entry.result.recommendedActions.map((action) => action.kind),
  }));
}

export function createWorkflowCoordinatorService(
  plugin: PluginRegistrationContext,
  deps: Partial<WorkflowCoordinatorDependencies> = {}
): OpenClawPluginService {
  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let inFlightTick: Promise<void> | null = null;
  const launchedIdleResearchDueKeys = new Map<string, string>();

  const runTick = (logger: WorkflowCoordinatorLogger, trigger: string) => {
    if (inFlightTick) {
      return inFlightTick;
    }

    const workflowPolicy = plugin.getWorkflowPolicy();
    if (!workflowPolicy.heartbeatBackgroundChecks || !workflowPolicy.projectsRoot) {
      return Promise.resolve();
    }

    inFlightTick = (async () => {
      try {
        const workflowPolicy = plugin.getWorkflowPolicy();
        const results = await runWorkflowCoordinatorPass({
          projectsRoot: workflowPolicy.projectsRoot,
          cooldownSeconds: workflowPolicy.agentContactCooldownSeconds,
          queueMailbox: workflowPolicy.enableWorkflowMailbox,
          maxProjects: DEFAULT_WORKFLOW_COORDINATOR_MAX_PROJECTS,
          logger,
          deps,
        });
        const idleResearchLaunches = (
          await Promise.all(
            results.map((entry) =>
              maybeLaunchIdleResearchForProject({
                runtimeSubagent: plugin.api.runtime?.subagent,
                workflowPolicy,
                projectRoot: entry.projectRoot,
                projectId: entry.projectId,
                autoIteratorResult: entry.result,
                launchedDueKeys: launchedIdleResearchDueKeys,
                logger,
                deps,
              })
            )
          )
        ).filter((entry) => entry.launched);
        logger.debug?.("Workflow coordinator pass completed.", {
          trigger,
          projectCount: results.length,
          results: summarizeCoordinatorPass(results),
          idleResearchLaunches,
        });
        if (idleResearchLaunches.length > 0) {
          logger.info?.("Workflow coordinator launched idle research.", {
            trigger,
            launches: idleResearchLaunches.map((entry) => ({
              projectId: entry.projectId,
              topic: entry.topic,
              sessionKey: entry.sessionKey,
              runId: entry.runId,
            })),
          });
        }
      } catch (error) {
        logger.warn?.("Workflow coordinator pass failed.", {
          trigger,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        inFlightTick = null;
      }
    })();

    return inFlightTick;
  };

  return {
    id: "workflow-background-coordinator",
    async start(ctx: OpenClawPluginServiceContext) {
      const workflowPolicy = plugin.getWorkflowPolicy();
      if (intervalHandle) {
        return;
      }
      if (!workflowPolicy.heartbeatBackgroundChecks || !workflowPolicy.projectsRoot) {
        ctx.logger.debug?.("Workflow coordinator service disabled by policy.", {
          heartbeatBackgroundChecks: workflowPolicy.heartbeatBackgroundChecks,
          projectsRoot: workflowPolicy.projectsRoot,
        });
        return;
      }

      intervalHandle = setInterval(() => {
        void runTick(ctx.logger, "interval");
      }, DEFAULT_WORKFLOW_COORDINATOR_INTERVAL_MS);
      intervalHandle.unref?.();

      ctx.logger.info?.("Workflow coordinator service started.", {
        intervalMs: DEFAULT_WORKFLOW_COORDINATOR_INTERVAL_MS,
        maxProjectsPerTick: DEFAULT_WORKFLOW_COORDINATOR_MAX_PROJECTS,
        projectsRoot: workflowPolicy.projectsRoot,
      });
      void runTick(ctx.logger, "startup");
    },
    async stop(ctx: OpenClawPluginServiceContext) {
      if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
      await inFlightTick;
      ctx.logger.info?.("Workflow coordinator service stopped.");
    },
  };
}

export function registerWorkflowService(plugin: PluginRegistrationContext) {
  if (typeof plugin.api.registerService !== "function") {
    return;
  }
  plugin.api.registerService(createWorkflowCoordinatorService(plugin));
}
