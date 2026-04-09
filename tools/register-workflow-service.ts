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
  drainQueuedBackgroundWorkflowRuns,
  enqueueQueuedBackgroundWorkflowRun,
  hasPendingBackgroundWorkflowQueueKey,
  startBackgroundWorkflowRun,
} from "./workflow-fast-paths";
import {
  acquireBackgroundWorkflowSession,
  getBackgroundWorkflowRunByQueueKey,
  recordBackgroundWorkflowRun,
} from "./workflow-background-pool";
import { readWorkflowAnnounceOutboxStore } from "./workflow-runtime-state.js";
import {
  orchestrateWorkflowTransition,
  recordWorkflowAnnounceEvent,
} from "./workflow-session-orchestrator.js";
import { recoverWorkflowRuntimeState } from "./workflow-runtime-recovery.js";
import {
  getIdleResearchStateSummary,
  listChannelProjectBindingsForWorkflow,
  recordWorkflowContactEvent,
  runWorkflowAutoIterator,
} from "./workflow-guard";
import {
  selectDispatchableAutoStageAction,
} from "./workflow-guard-runtime/auto-iterator";
import {
  deriveAgentSessionKeyForRole,
  type DispatchableWorkflowRole,
} from "./agent-task-dispatch";
import { handoffWorkflowTaskToAgent } from "./lobster-handoff";
import { maybeBroadcastWorkflowStatusUpdate } from "./stage-broadcast";
import {
  aggregateGateReviewRound,
  buildAutoGateReviewPrompt,
  createGateReviewRound,
  defaultGateReviewPanel,
  evaluateAutoGate,
  extractLatestAssistantText,
  materializeGateReviewPacket,
  parseGateReviewResult,
  readGateReviewStore,
  saveGateReviewStore,
  type GateReviewAttempt,
  type GateReviewReviewerRole,
  type GateReviewResult,
} from "./workflow-auto-gate";
import {
  aggregateCodeReviewRound,
  buildCodeReviewPrompt,
  createCodeReviewRound,
  defaultCodeReviewPanel,
  materializeCodeReviewPacket,
  parseCodeReviewResult,
  readCodeReviewStore,
  saveCodeReviewStore,
  type CodeReviewAttempt,
  type CodeReviewResult,
} from "./workflow-code-review.js";
import {
  aggregateAutoModeDiscussionRound,
  buildAutoModeDiscussionPrompt,
  createAutoModeDiscussionRound,
  defaultAutoModeDiscussionPanel,
  materializeAutoModeDiscussionPacket,
  parseAutoModeDiscussionResult,
  readAutoModeDiscussionStore,
  saveAutoModeDiscussionStore,
  type AutoModeDiscussionAttempt as AutoModeDiscussionReviewAttempt,
  type AutoModeDiscussionResult,
} from "./workflow-auto-discussion";
import { buildWorkflowSubagentSessionKey } from "./workflow-subagent-sessions";
import { asRecord, asString } from "./workflow-guard-core/coercion";
import { readJsonIfExists } from "./workflow-guard-core/fs";
import { resolveWorkflowBroadcastSessionKey } from "./workflow-agent-isolation.js";

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
  waitForRun?: (params: { runId: string; timeoutMs?: number }) => Promise<{
    status: "ok" | "error" | "timeout";
    error?: string;
  }>;
  getSessionMessages?: (params: {
    sessionKey: string;
    limit?: number;
  }) => Promise<{ messages: unknown[] }>;
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
    | "idle_research_already_launched"
    | "channel_capacity_reached";
  projectId: string | null;
  projectRoot: string;
  topic: string | null;
  sessionKey: string | null;
  runId: string | null;
  dueKey: string | null;
  summary: string | null;
  reusedIdleSession: boolean;
  activeResearcherSessionsInChannel: number | null;
};

type AutoStageLaunchAttempt = {
  launched: boolean;
  reason:
    | "started"
    | "auto_mode_disabled"
    | "risk_discussion_pending"
    | "no_runtime_subagent"
    | "session_pool_full"
    | "gate_blocked"
    | "no_drive_stage_action"
    | "cooldown_active"
    | "already_launched"
    | "dispatch_failed";
  projectId: string | null;
  projectRoot: string;
  stage: string | null;
  owner: string | null;
  sessionKey: string | null;
  runId: string | null;
  dispatchStrategy: string | null;
  launchKey: string | null;
  error: string | null;
  reusedServiceSession: boolean;
  activeResearcherSessionsInChannel: number | null;
};

type AutoGateReviewAttempt = {
  launched: boolean;
  reason:
    | "disabled"
    | "not_submit_gate"
    | "manual_confirmation_required"
    | "no_runtime_subagent"
    | "already_approved"
    | "already_rejected"
    | "reviewing"
    | "started"
    | "updated"
    | "launch_failed";
  projectId: string | null;
  projectRoot: string;
  gateId: string | null;
  stage: string | null;
  status: string | null;
  reviewCount: number;
  approved: boolean;
};

type AutoCodeReviewAttempt = {
  launched: boolean;
  reason:
    | "disabled"
    | "not_code_gate"
    | "bundle_incomplete"
    | "no_runtime_subagent"
    | "already_approved"
    | "already_rejected"
    | "reviewing"
    | "started"
    | "updated"
    | "launch_failed";
  projectId: string | null;
  projectRoot: string;
  gateId: string | null;
  stage: string | null;
  status: string | null;
  reviewCount: number;
  approved: boolean;
};

type AutoModeDiscussionAttempt = {
  launched: boolean;
  reason:
    | "disabled"
    | "stable"
    | "no_runtime_subagent"
    | "reviewing"
    | "started"
    | "updated"
    | "resolved"
    | "round_limit_reached";
  projectId: string | null;
  projectRoot: string;
  fingerprint: string | null;
  stage: string | null;
  riskLevel: string | null;
  status: string | null;
  reviewCount: number;
  roundsStarted: number;
  recommendedOwner: DispatchableWorkflowRole | null;
  actionItems: string[];
  blockers: string[];
  summary: string | null;
  roundId: string | null;
  packetPath: string | null;
  resolved: boolean;
};

type AutoModeMitigationDispatchAttempt = {
  launched: boolean;
  reason:
    | "not_needed"
    | "no_runtime_subagent"
    | "session_pool_full"
    | "already_dispatched"
    | "dispatch_failed"
    | "started";
  projectId: string | null;
  projectRoot: string;
  fingerprint: string | null;
  stage: string | null;
  owner: DispatchableWorkflowRole | null;
  sessionKey: string | null;
  runId: string | null;
  dispatchStrategy: string | null;
  error: string | null;
  reusedServiceSession: boolean;
  activeResearcherSessionsInChannel: number | null;
};

type WorkflowCoordinatorVisibleStatusUpdate = {
  status: "started" | "continued" | "queued" | "blocked" | "waiting" | "handed_off";
  stage: string | null;
  summary: string;
  dedupeKey: string;
};

const DEFAULT_WORKFLOW_COORDINATOR_INTERVAL_MS = 120_000;
const DEFAULT_WORKFLOW_COORDINATOR_MAX_PROJECTS = 3;

const readString = asString;

function slugifyForIdempotency(value: string): string {
  return value.replace(/[^a-z0-9_.:-]+/gi, "-");
}

function nowIso() {
  return new Date().toISOString();
}

function readGateReviewAnnounceResult(params: {
  entries: Array<{ announceId: string; payload: Record<string, unknown> | null }>;
  attempt: GateReviewAttempt;
}): GateReviewResult | null {
  if (!params.attempt.runId) {
    return null;
  }
  const targetAnnounceId = `gate-review:${params.attempt.runId}:${params.attempt.reviewerRole}`;
  const match = params.entries.find((entry) => entry.announceId === targetAnnounceId);
  const payload = asRecord(match?.payload);
  const result = asRecord(payload?.result);
  if (result) {
    const parsed = parseGateReviewResult(
      JSON.stringify(result),
      params.attempt.reviewerRole
    );
    return {
      ...parsed,
      createdAt: readString(result.createdAt) ?? parsed.createdAt,
      runId: readString(result.runId) ?? params.attempt.runId,
      rawText: readString(result.rawText) ?? parsed.rawText,
    };
  }
  const rawText = readString(payload?.rawText ?? payload?.text);
  if (!rawText) {
    return null;
  }
  const parsed = parseGateReviewResult(rawText, params.attempt.reviewerRole);
  return {
    ...parsed,
    runId: readString(payload?.runId) ?? parsed.runId ?? params.attempt.runId,
  };
}

function readCodeReviewAnnounceResult(params: {
  entries: Array<{ announceId: string; payload: Record<string, unknown> | null }>;
  attempt: CodeReviewAttempt;
}): CodeReviewResult | null {
  if (!params.attempt.runId) {
    return null;
  }
  const targetAnnounceId = `code-review:${params.attempt.runId}:${params.attempt.reviewerRole}`;
  const match = params.entries.find((entry) => entry.announceId === targetAnnounceId);
  const payload = asRecord(match?.payload);
  const result = asRecord(payload?.result);
  if (result) {
    const parsed = parseCodeReviewResult(
      JSON.stringify(result),
      params.attempt.reviewerRole
    );
    return {
      ...parsed,
      createdAt: readString(result.createdAt) ?? parsed.createdAt,
      runId: readString(result.runId) ?? params.attempt.runId,
      rawText: readString(result.rawText) ?? parsed.rawText,
    };
  }
  const rawText = readString(payload?.rawText ?? payload?.text);
  if (!rawText) {
    return null;
  }
  const parsed = parseCodeReviewResult(rawText, params.attempt.reviewerRole);
  return {
    ...parsed,
    runId: readString(payload?.runId) ?? parsed.runId ?? params.attempt.runId,
  };
}

function readAutoModeDiscussionAnnounceResult(params: {
  entries: Array<{ announceId: string; payload: Record<string, unknown> | null }>;
  attempt: AutoModeDiscussionReviewAttempt;
}): AutoModeDiscussionResult | null {
  if (!params.attempt.runId) {
    return null;
  }
  const targetAnnounceId = `auto-discussion:${params.attempt.runId}:${params.attempt.reviewerRole}`;
  const match = params.entries.find((entry) => entry.announceId === targetAnnounceId);
  const payload = asRecord(match?.payload);
  const result = asRecord(payload?.result);
  if (result) {
    const parsed = parseAutoModeDiscussionResult(
      JSON.stringify(result),
      params.attempt.reviewerRole
    );
    return {
      ...parsed,
      createdAt: readString(result.createdAt) ?? parsed.createdAt,
      runId: readString(result.runId) ?? params.attempt.runId,
      rawText: readString(result.rawText) ?? parsed.rawText,
    };
  }
  const rawText = readString(payload?.rawText ?? payload?.text);
  if (!rawText) {
    return null;
  }
  const parsed = parseAutoModeDiscussionResult(rawText, params.attempt.reviewerRole);
  return {
    ...parsed,
    runId: readString(payload?.runId) ?? parsed.runId ?? params.attempt.runId,
  };
}

function resolveWorkflowRequesterSessionKey(params: {
  projectRoot: string;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  deps: WorkflowCoordinatorDependencies;
}): string | null {
  return resolveWorkflowRequesterBinding(params).sessionKey;
}

function resolveWorkflowRequesterBinding(params: {
  projectRoot: string;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  deps: WorkflowCoordinatorDependencies;
}): {
  sessionKey: string | null;
  messageChannel: string | null;
} {
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
  return {
    sessionKey: resolveWorkflowBroadcastSessionKey(binding) ?? null,
    messageChannel: binding?.messageChannel ?? null,
  };
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
  policy?: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
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
          policy: params.policy,
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
    const baseSessionKey = deriveAgentSessionKeyForRole({
      requesterSessionKey: binding.sessionKeySample,
      targetRole: "researcher",
    });
    return (
      buildWorkflowSubagentSessionKey({
        parentSessionKey: baseSessionKey,
        purpose: "workflow-idle-research",
        segments: [params.projectRoot],
      }) ?? baseSessionKey
    );
  }
  return (
    buildWorkflowSubagentSessionKey({
      parentSessionKey: "agent:researcher:main",
      purpose: "workflow-idle-research",
      segments: [params.projectRoot],
    }) ?? "agent:researcher:main"
  );
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

function buildResearcherWorkflowSubagentSessionKey(params: {
  requesterSessionKey?: string | null;
  projectRoot: string;
  purpose: string;
  segments?: Array<string | null | undefined>;
}) {
  const baseSessionKey = deriveAgentSessionKeyForRole({
    requesterSessionKey: params.requesterSessionKey ?? undefined,
    targetRole: "researcher",
  });
  const projectSessionSegment = path.basename(path.resolve(params.projectRoot));
  return (
    buildWorkflowSubagentSessionKey({
      parentSessionKey: baseSessionKey,
      purpose: params.purpose,
      segments: [projectSessionSegment, ...(params.segments ?? [])],
    }) ?? baseSessionKey
  );
}

function buildWorkflowCoordinatorDispatchSessionKeys(params: {
  requesterSessionKey?: string | null;
  owner: DispatchableWorkflowRole;
  projectRoot: string;
  purpose: string;
  segments?: Array<string | null | undefined>;
}): string[] | undefined {
  if (params.owner !== "researcher") {
    return undefined;
  }
  return [
    buildResearcherWorkflowSubagentSessionKey({
      requesterSessionKey: params.requesterSessionKey,
      projectRoot: params.projectRoot,
      purpose: params.purpose,
      segments: params.segments,
    }),
  ];
}

export function deriveWorkflowCoordinatorStatusUpdate(params: {
  projectId: string | null;
  projectRoot: string;
  stageAfter: string | null;
  timedDefaultTriggered?: boolean;
  timedDefaultSummary?: string | null;
  autoCodeReview?: AutoCodeReviewAttempt;
  autoGateReview: AutoGateReviewAttempt;
  autoModeDiscussion: AutoModeDiscussionAttempt;
  autoMitigationDispatch: AutoModeMitigationDispatchAttempt;
  autoStageLaunch: AutoStageLaunchAttempt;
  idleResearchLaunch: IdleResearchLaunchAttempt;
}): WorkflowCoordinatorVisibleStatusUpdate | null {
  const autoCodeReview =
    params.autoCodeReview ??
    ({
      launched: false,
      reason: "disabled",
      projectId: params.projectId,
      projectRoot: params.projectRoot,
      gateId: null,
      stage: params.stageAfter ?? null,
      status: null,
      reviewCount: 0,
      approved: false,
    } satisfies AutoCodeReviewAttempt);
  if (params.autoStageLaunch.launched && params.autoStageLaunch.owner) {
    return {
      status: "handed_off",
      stage: params.autoStageLaunch.stage ?? params.stageAfter ?? null,
      summary:
        params.autoStageLaunch.owner === "researcher" &&
        params.autoStageLaunch.reusedServiceSession
          ? `Workflow handed off to ${params.autoStageLaunch.owner} for ${params.autoStageLaunch.stage ?? params.stageAfter ?? "the current"} stage using an idle reused Researcher service session.`
          : `Workflow handed off to ${params.autoStageLaunch.owner} for ${params.autoStageLaunch.stage ?? params.stageAfter ?? "the current"} stage.`,
      dedupeKey: [
        "handoff",
        params.autoStageLaunch.stage ?? params.stageAfter ?? "unknown",
        params.autoStageLaunch.owner,
        params.autoStageLaunch.dispatchStrategy ?? "unknown",
        params.autoStageLaunch.reusedServiceSession ? "reused" : "fresh",
      ].join(":"),
    };
  }
  if (params.autoMitigationDispatch.launched && params.autoMitigationDispatch.owner) {
    return {
      status: "handed_off",
      stage: params.autoMitigationDispatch.stage ?? params.stageAfter ?? null,
      summary:
        params.autoMitigationDispatch.owner === "researcher" &&
        params.autoMitigationDispatch.reusedServiceSession
          ? "Auto-mode mitigation was handed off to Researcher using an idle reused service session."
          : `Auto-mode mitigation was handed off to ${params.autoMitigationDispatch.owner}.`,
      dedupeKey: [
        "mitigation",
        params.autoMitigationDispatch.stage ?? params.stageAfter ?? "unknown",
        params.autoMitigationDispatch.owner,
        params.autoMitigationDispatch.reusedServiceSession ? "reused" : "fresh",
      ].join(":"),
    };
  }
  if (params.timedDefaultTriggered) {
    return {
      status: "continued",
      stage: params.stageAfter ?? null,
      summary:
        params.timedDefaultSummary ??
        "No user reply arrived before the confirmation deadline, so the workflow continued through the default safe branch.",
      dedupeKey: [
        "timed-default",
        params.stageAfter ?? "unknown-stage",
        params.projectId ?? path.basename(params.projectRoot),
      ].join(":"),
    };
  }
  if (params.idleResearchLaunch.launched) {
    return {
      status: "started",
      stage: params.stageAfter ?? null,
      summary:
        params.idleResearchLaunch.summary ??
        `Idle research started${params.idleResearchLaunch.topic ? ` for ${params.idleResearchLaunch.topic}` : ""}.`,
      dedupeKey: [
        "idle-research",
        params.idleResearchLaunch.topic ?? "unknown-topic",
        params.idleResearchLaunch.dueKey ?? "due-now",
        params.idleResearchLaunch.reusedIdleSession ? "reused" : "fresh",
      ].join(":"),
    };
  }
  if (params.idleResearchLaunch.reason === "channel_capacity_reached") {
    return {
      status: "queued",
      stage: params.stageAfter ?? null,
      summary:
        params.idleResearchLaunch.summary ??
        `Queued idle research${params.idleResearchLaunch.topic ? ` for ${params.idleResearchLaunch.topic}` : ""} until a Researcher background session becomes idle in this channel.`,
      dedupeKey: [
        "idle-research",
        "capacity",
        params.idleResearchLaunch.topic ?? "unknown-topic",
        String(params.idleResearchLaunch.activeResearcherSessionsInChannel ?? "unknown"),
      ].join(":"),
    };
  }
  if (
    autoCodeReview.reason === "started" ||
    autoCodeReview.reason === "reviewing"
  ) {
    return {
      status: "waiting",
      stage: autoCodeReview.stage ?? params.stageAfter ?? null,
      summary:
        "Waiting for code innovation reviewer quorum before progressing from CODE to EXPERIMENT.",
      dedupeKey: [
        "auto-code-review",
        autoCodeReview.stage ?? params.stageAfter ?? "code",
        autoCodeReview.status ?? autoCodeReview.reason,
      ].join(":"),
    };
  }
  if (
    params.autoGateReview.reason === "manual_confirmation_required"
  ) {
    return {
      status: "waiting",
      stage: params.autoGateReview.stage ?? params.stageAfter ?? null,
      summary:
        "OpenReview-facing submission and the final GATE-5 revision decision require explicit human confirmation; auto mode will stop here.",
      dedupeKey: [
        "auto-gate",
        "manual",
        params.autoGateReview.stage ?? params.stageAfter ?? "submit",
      ].join(":"),
    };
  }
  if (
    params.autoGateReview.reason === "started" ||
    params.autoGateReview.reason === "reviewing"
  ) {
    return {
      status: "waiting",
      stage: params.autoGateReview.stage ?? params.stageAfter ?? null,
      summary: "Waiting for auto gate reviewer quorum at submit before progressing further.",
      dedupeKey: [
        "auto-gate",
        params.autoGateReview.stage ?? params.stageAfter ?? "submit",
        params.autoGateReview.status ?? params.autoGateReview.reason,
      ].join(":"),
    };
  }
  if (
    params.autoModeDiscussion.reason === "started" ||
    params.autoModeDiscussion.reason === "reviewing"
  ) {
    return {
      status: "waiting",
      stage: params.autoModeDiscussion.stage ?? params.stageAfter ?? null,
      summary: "Waiting for the auto-mode risk discussion to settle before the next dispatch.",
      dedupeKey: [
        "auto-discussion",
        params.autoModeDiscussion.stage ?? params.stageAfter ?? "unknown",
        params.autoModeDiscussion.fingerprint ?? "unknown",
        params.autoModeDiscussion.status ?? params.autoModeDiscussion.reason,
      ].join(":"),
    };
  }
  if (
    params.autoStageLaunch.reason === "risk_discussion_pending" ||
    params.autoStageLaunch.reason === "cooldown_active" ||
    params.autoStageLaunch.reason === "already_launched" ||
    params.autoStageLaunch.reason === "session_pool_full"
  ) {
    const summary =
      params.autoStageLaunch.reason === "risk_discussion_pending"
        ? "Waiting for auto-mode risk discussion before handing off the next stage."
        : params.autoStageLaunch.reason === "cooldown_active"
          ? `Queued the next stage handoff until the workflow contact cooldown clears for ${params.autoStageLaunch.owner ?? "the next owner"}.`
          : params.autoStageLaunch.reason === "session_pool_full"
            ? `Queued the ${params.autoStageLaunch.stage ?? params.stageAfter ?? "current"} stage until an idle Researcher service session is available.`
            : `Queued behind the already-running ${params.autoStageLaunch.stage ?? params.stageAfter ?? "workflow"} stage handoff.`;
    return {
      status:
        params.autoStageLaunch.reason === "risk_discussion_pending" ? "waiting" : "queued",
      stage: params.autoStageLaunch.stage ?? params.stageAfter ?? null,
      summary,
      dedupeKey: [
        "stage-wait",
        params.autoStageLaunch.reason,
        params.autoStageLaunch.stage ?? params.stageAfter ?? "unknown",
        params.autoStageLaunch.owner ?? "unknown-owner",
      ].join(":"),
    };
  }
  if (params.autoMitigationDispatch.reason === "session_pool_full") {
    return {
      status: "queued",
      stage: params.autoMitigationDispatch.stage ?? params.stageAfter ?? null,
      summary:
        "Queued the mitigation pass until an idle Researcher service session is available.",
      dedupeKey: [
        "mitigation-wait",
        params.autoMitigationDispatch.stage ?? params.stageAfter ?? "unknown",
        params.autoMitigationDispatch.owner ?? "researcher",
      ].join(":"),
    };
  }
  if (
    params.autoStageLaunch.reason === "gate_blocked" ||
    params.autoStageLaunch.reason === "dispatch_failed" ||
    autoCodeReview.reason === "already_rejected" ||
    params.autoGateReview.reason === "already_rejected"
  ) {
    const summary =
      autoCodeReview.reason === "already_rejected"
        ? "Blocked because the code innovation review rejected the current implementation packet."
        : params.autoGateReview.reason === "already_rejected"
        ? "Blocked because the submit auto gate review rejected the packet."
        : params.autoStageLaunch.reason === "gate_blocked"
          ? `Blocked by the current ${params.autoStageLaunch.stage ?? params.stageAfter ?? "workflow"} gate.`
          : `Blocked because the handoff to ${params.autoStageLaunch.owner ?? "the next owner"} failed${params.autoStageLaunch.error ? `: ${params.autoStageLaunch.error}` : "."}`;
    return {
      status: "blocked",
      stage: params.autoStageLaunch.stage ?? params.stageAfter ?? null,
      summary,
      dedupeKey: [
        "blocked",
        params.autoStageLaunch.reason,
        params.autoStageLaunch.stage ?? params.stageAfter ?? "unknown",
        params.autoStageLaunch.owner ?? "unknown-owner",
      ].join(":"),
    };
  }
  return null;
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
          summary: null,
          reusedIdleSession: false,
          activeResearcherSessionsInChannel: null,
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
          summary: null,
          reusedIdleSession: false,
          activeResearcherSessionsInChannel: null,
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
          summary: null,
          reusedIdleSession: false,
          activeResearcherSessionsInChannel: null,
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
          summary: null,
          reusedIdleSession: false,
          activeResearcherSessionsInChannel: null,
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
          summary: null,
          reusedIdleSession: false,
          activeResearcherSessionsInChannel: null,
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
          summary: null,
          reusedIdleSession: false,
          activeResearcherSessionsInChannel: null,
        };
      }

      const sessionKey = resolveResearcherIdleResearchSessionKey({
        projectRoot: params.projectRoot,
        workflowPolicy: params.workflowPolicy,
        deps,
      });
      const launched = await startBackgroundWorkflowRun({
        runtimeSubagent: params.runtimeSubagent,
        workflowPolicy: params.workflowPolicy,
        agentCtx: {
          agentId: "researcher",
          workspaceDir: params.projectRoot,
          sessionKey,
          messageChannel: "discord",
        },
        snapshot: {
          role: "researcher",
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          channelProjectBindingsEnabled:
            params.workflowPolicy.enableChannelProjectBindings === true,
        },
        backgroundRun: {
          kind: "idle_research",
          commandText: buildIdleResearchCoordinatorMessage({
            projectId: params.projectId,
            projectRoot: params.projectRoot,
            topic,
          }),
          topic,
          projectId: params.projectId ?? undefined,
          projectRoot: params.projectRoot,
          ensureProjectBinding: false,
          summary: `Idle research started for ${topic}.`,
        },
      });
      if (!launched.started || !launched.runId || !launched.sessionKey) {
        return {
          launched: false,
          reason:
            launched.reason === "channel_capacity_reached"
              ? "channel_capacity_reached"
              : "no_runtime_subagent",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          topic,
          sessionKey: null,
          runId: null,
          dueKey,
          summary: launched.summary,
          reusedIdleSession: false,
          activeResearcherSessionsInChannel:
            launched.activeResearcherSessionsInChannel,
        };
      }
      params.launchedDueKeys.set(params.projectRoot, dueKey);
      return {
        launched: true,
        reason: "started",
        projectId: params.projectId,
        projectRoot: params.projectRoot,
        topic,
        sessionKey: launched.sessionKey,
        runId: launched.runId,
        dueKey,
        summary: launched.summary,
        reusedIdleSession: launched.reusedIdleSession,
        activeResearcherSessionsInChannel:
          launched.activeResearcherSessionsInChannel,
      };
    },
  });
}

function buildAutoStageLaunchKey(params: {
  projectRoot: string;
  stage: string | null;
  owner: string | null;
  command: string | null;
}) {
  return [
    path.resolve(params.projectRoot),
    params.stage ?? "unknown-stage",
    params.owner ?? "unknown-owner",
    params.command ?? "no-command",
  ].join("::");
}

function isExperimentMonitorCommand(command: string | null | undefined): boolean {
  return /\/monitor-experiment\b/i.test(command ?? "");
}

async function launchWorkflowDispatchTransition(params: {
  runtimeSubagent: RuntimeSubagentApi;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  source: string;
  queueKey: string;
  owner: DispatchableWorkflowRole;
  projectRoot: string;
  projectId: string | null;
  requesterSessionKey: string;
  requesterChannel?: string | null;
  preferredSessionKeys: string[];
  family: string;
  kind: string;
  stage: string | null;
  summary: string;
  command?: string | null;
  mailboxMessageId?: string | null;
  extraBody?: string | null;
  autoModeActive: boolean;
  fromRole?: string | null;
  logger?: WorkflowCoordinatorLogger;
}) {
  return orchestrateWorkflowTransition({
    transition: {
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      queueKey: params.queueKey,
      source: params.source,
      entryType: "dispatch_task",
      ownerAgent: params.owner,
      channelKey: params.requesterChannel ?? params.requesterSessionKey,
      requesterSessionKey: params.requesterSessionKey,
      messageChannel: params.requesterChannel ?? null,
      preferredSessionKey: params.preferredSessionKeys[0] ?? null,
      family: params.family,
      kind: params.kind,
      summary: params.summary,
      parentSessionKey: params.requesterSessionKey,
      depth: 1,
      dispatchPayload: {
        requesterChannel: params.requesterChannel ?? null,
        requesterAccountId: null,
        preferredSessionKeys: params.preferredSessionKeys,
        fromRole: params.fromRole ?? "researcher",
        toRole: params.owner,
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        stage: params.stage,
        summary: params.summary,
        command: params.command ?? null,
        mailboxMessageId: params.mailboxMessageId ?? null,
        extraBody: params.extraBody ?? null,
        waitTimeoutMs: 5000,
        retryOnTimeout: true,
        enableSpawnFallback: true,
        useWorkflowHandoff: true,
        autoModeActive: params.autoModeActive,
      },
    },
    spawn: async () => {
      const dispatch = await handoffWorkflowTaskToAgent({
        runtimeSubagent: params.runtimeSubagent,
        workflowPolicy: params.workflowPolicy,
        requesterSessionKey: params.requesterSessionKey,
        requesterChannel: params.requesterChannel ?? undefined,
        preferredSessionKeys: params.preferredSessionKeys,
        fromRole: params.fromRole ?? "researcher",
        toRole: params.owner,
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        stage: params.stage,
        summary: params.summary,
        command: params.command ?? null,
        mailboxMessageId: params.mailboxMessageId ?? null,
        extraBody: params.extraBody ?? null,
        waitTimeoutMs: 5000,
        retryOnTimeout: true,
        enableSpawnFallback: true,
        autoModeActive: params.autoModeActive,
        logger: params.logger,
      });
      if (!dispatch.dispatched || !dispatch.runId || !dispatch.sessionKey) {
        throw new Error(
          dispatch.error ??
            `Failed to dispatch workflow transition ${params.queueKey}.`
        );
      }
      return {
        runId: dispatch.runId,
        sessionKey: dispatch.sessionKey,
        runtime:
          dispatch.channel === "sessions_spawn"
            ? "subagent"
            : "legacy_dispatch",
        role: params.owner,
        agentId: params.owner,
        ownerAgent: params.owner,
        strategy: dispatch.strategy ?? "workflow_dispatch",
        parentSessionKey: params.requesterSessionKey,
        depth: 1,
      };
    },
  });
}

async function launchWorkflowNestedRunTransition(params: {
  runtimeSubagent: RuntimeSubagentApi;
  source: string;
  queueKey: string;
  ownerAgent: string;
  sessionKey: string;
  requesterSessionKey: string;
  projectRoot: string;
  projectId: string | null;
  family: string;
  kind: string;
  summary: string;
  message: string;
  idempotencyKey: string;
  extraSystemPrompt: string;
  depth?: number;
}) {
  return orchestrateWorkflowTransition({
    transition: {
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      queueKey: params.queueKey,
      source: params.source,
      entryType: "background_run",
      ownerAgent: params.ownerAgent,
      channelKey: params.requesterSessionKey,
      requesterSessionKey: params.requesterSessionKey,
      preferredSessionKey: params.sessionKey,
      family: params.family,
      kind: params.kind,
      summary: params.summary,
      parentSessionKey: params.requesterSessionKey,
      depth: params.depth ?? 1,
      runPayload: {
        message: params.message,
        lane: "nested",
        deliver: false,
        idempotencyKey: params.idempotencyKey,
        extraSystemPrompt: params.extraSystemPrompt,
      },
    },
    spawn: async () => {
      const started = await params.runtimeSubagent.run({
        sessionKey: params.sessionKey,
        message: params.message,
        lane: "nested",
        deliver: false,
        idempotencyKey: params.idempotencyKey,
        extraSystemPrompt: params.extraSystemPrompt,
      });
      return {
        runId: started.runId,
        sessionKey: params.sessionKey,
        runtime: "subagent",
        role: params.ownerAgent,
        agentId: params.ownerAgent,
        ownerAgent: params.ownerAgent,
        parentSessionKey: params.requesterSessionKey,
        depth: params.depth ?? 1,
      };
    },
  });
}

export async function maybeLaunchAutoStageForProject(params: {
  runtimeSubagent?: RuntimeSubagentApi;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  projectRoot: string;
  projectId: string | null;
  autoIteratorResult: {
    configuredAutoMode?: string | null;
    effectiveAutoMode?: string | null;
    autoModeRiskLevel?: string | null;
    autoModeMitigationStatus?: string | null;
    gateBlocking?: boolean;
    stageAfter?: string | null;
    missingStageSignals?: string[];
    recommendedActions: Array<{
      kind: string;
      owner: string | null;
      stage: string | null;
      summary: string;
      command: string | null;
      mailboxMessageId?: string | null;
      cooldownRemainingSeconds?: number | null;
      blocking?: boolean;
    }>;
  };
  launchedStageKeys: Map<string, { key: string; launchedAt: number }>;
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
    label: "workflow_auto_stage_launch",
    logger: params.logger,
    task: async (): Promise<AutoStageLaunchAttempt> => {
      if ((params.autoIteratorResult.effectiveAutoMode ?? params.workflowPolicy.autoMode) === "off") {
        params.launchedStageKeys.delete(params.projectRoot);
        return {
          launched: false,
          reason: "auto_mode_disabled",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          stage: params.autoIteratorResult.stageAfter ?? null,
          owner: null,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          launchKey: null,
          error: null,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        };
      }
      if (
        readString(params.autoIteratorResult.autoModeRiskLevel) &&
        readString(params.autoIteratorResult.autoModeRiskLevel) !== "stable" &&
        params.autoIteratorResult.autoModeMitigationStatus !== "resolved" &&
        (params.autoIteratorResult.effectiveAutoMode ?? params.workflowPolicy.autoMode) ===
          (params.autoIteratorResult.configuredAutoMode ?? params.workflowPolicy.autoMode)
      ) {
        return {
          launched: false,
          reason: "risk_discussion_pending",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          stage: params.autoIteratorResult.stageAfter ?? null,
          owner: null,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          launchKey: null,
          error: null,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        };
      }
      if (!params.runtimeSubagent) {
        return {
          launched: false,
          reason: "no_runtime_subagent",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          stage: params.autoIteratorResult.stageAfter ?? null,
          owner: null,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          launchKey: null,
          error: null,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        };
      }
      if (params.autoIteratorResult.gateBlocking) {
        return {
          launched: false,
          reason: "gate_blocked",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          stage: params.autoIteratorResult.stageAfter ?? null,
          owner: null,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          launchKey: null,
          error: null,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        };
      }

      const dispatchableAutoIteratorResult: Parameters<
        typeof selectDispatchableAutoStageAction
      >[0]["autoIteratorResult"] = {
        gateBlocking: params.autoIteratorResult.gateBlocking ?? false,
        missingStageSignals: params.autoIteratorResult.missingStageSignals ?? [],
        recommendedActions: (params.autoIteratorResult.recommendedActions ?? []).map(
          (entry) => ({
            kind: entry.kind as "drive_stage" | "background" | "wait_human" | "switch_project",
            owner: entry.owner as DispatchableWorkflowRole | null,
            stage: entry.stage ?? null,
            summary: entry.summary,
            command: entry.command ?? null,
            mailboxQueued: false,
            mailboxMessageId: entry.mailboxMessageId ?? null,
            cooldownRemainingSeconds: entry.cooldownRemainingSeconds ?? null,
            blocking: entry.blocking === true,
          })
        ),
      };
      const action = selectDispatchableAutoStageAction({
        autoIteratorResult: dispatchableAutoIteratorResult,
      });
      if (!action) {
        params.launchedStageKeys.delete(params.projectRoot);
        return {
          launched: false,
          reason: "no_drive_stage_action",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          stage: params.autoIteratorResult.stageAfter ?? null,
          owner: null,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          launchKey: null,
          error: null,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        };
      }
      if ((action.cooldownRemainingSeconds ?? 0) > 0) {
        return {
          launched: false,
          reason: "cooldown_active",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
          owner: action.owner,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          launchKey: null,
          error: null,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        };
      }

      const launchKey = buildAutoStageLaunchKey({
        projectRoot: params.projectRoot,
        stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
        owner: action.owner,
        command: action.command,
      });
      const lastLaunch = params.launchedStageKeys.get(params.projectRoot);
      const cooldownMs = Math.max(
        1,
        isExperimentMonitorCommand(action.command)
          ? Math.floor(
              (params.workflowPolicy.autoGate?.experimentMonitorCooldownMs ?? 5 * 60 * 1000) /
                1000
            )
          : params.workflowPolicy.agentContactCooldownSeconds
      ) * 1000;
      if (
        lastLaunch?.key === launchKey &&
        Date.now() - lastLaunch.launchedAt < cooldownMs
      ) {
        return {
          launched: false,
          reason: "already_launched",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
          owner: action.owner,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          launchKey,
          error: null,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        };
      }
      const pendingQueueState = await hasPendingBackgroundWorkflowQueueKey({
        queueKey: launchKey,
        projectId: params.projectId ?? null,
        projectRoot: params.projectRoot,
      });
      if (pendingQueueState.active || pendingQueueState.queued) {
        return {
          launched: false,
          reason: pendingQueueState.active ? "already_launched" : "session_pool_full",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
          owner: action.owner,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          launchKey,
          error: pendingQueueState.queued
            ? "Researcher stage handoff is already queued for the shared service session pool."
            : null,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        };
      }

      const requesterBinding = resolveWorkflowRequesterBinding({
        projectRoot: params.projectRoot,
        workflowPolicy: params.workflowPolicy,
        deps,
      });
      const requesterSessionKey = requesterBinding.sessionKey;
      const defaultResearcherRequesterSessionKey =
        requesterSessionKey ?? "agent:researcher:main";
      const preferredResearcherSessionKeys = buildWorkflowCoordinatorDispatchSessionKeys({
        requesterSessionKey: requesterSessionKey ?? undefined,
        owner: action.owner as Parameters<typeof deriveAgentSessionKeyForRole>[0]["targetRole"],
        projectRoot: params.projectRoot,
        purpose: "workflow-stage",
        segments: [
          action.stage ?? params.autoIteratorResult.stageAfter ?? null,
          action.command,
        ],
      });
      let researcherSessionLease:
        | Awaited<ReturnType<typeof acquireBackgroundWorkflowSession>>
        | null = null;
      if (action.owner === "researcher") {
        researcherSessionLease = await acquireBackgroundWorkflowSession({
          runtimeSubagent: params.runtimeSubagent,
          ownerAgent: "researcher",
          requesterSessionKey: defaultResearcherRequesterSessionKey,
          preferredSessionKey: preferredResearcherSessionKeys?.[0] ?? null,
          family: "research",
          kind: "workflow_stage_dispatch",
          projectId: params.projectId ?? undefined,
          projectRoot: params.projectRoot,
          projectsRoot: params.workflowPolicy.projectsRoot,
        });
        if (!researcherSessionLease.acquired || !researcherSessionLease.sessionKey) {
          await enqueueQueuedBackgroundWorkflowRun({
            source: "workflow_auto_stage",
            ownerAgent: "researcher",
            requesterSessionKey: defaultResearcherRequesterSessionKey,
            preferredSessionKey: preferredResearcherSessionKeys?.[0] ?? null,
            family: "research",
            kind: "workflow_stage_dispatch",
            projectId: params.projectId ?? undefined,
            projectRoot: params.projectRoot,
            projectsRoot: params.workflowPolicy.projectsRoot,
            queueKey: launchKey,
            summary:
              `Queued the ${action.stage ?? params.autoIteratorResult.stageAfter ?? "current"} stage handoff until an idle Researcher service session becomes available.`,
            dispatchPayload: {
              requesterChannel: requesterBinding.messageChannel,
              requesterAccountId: null,
              preferredSessionKeys: preferredResearcherSessionKeys ?? [],
              fromRole: "researcher",
              toRole: action.owner as Parameters<typeof deriveAgentSessionKeyForRole>[0]["targetRole"],
              projectRoot: params.projectRoot,
              projectId: params.projectId,
              stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
              summary: action.summary,
              command: action.command,
              mailboxMessageId: action.mailboxMessageId ?? null,
              extraBody:
                "Workflow auto-mode service dispatch. Continue only the assigned stage, keep durable state current, and do not skip stage completion checks.",
              waitTimeoutMs: 5000,
              retryOnTimeout: true,
              enableSpawnFallback: true,
              useWorkflowHandoff: true,
              autoModeActive:
                (params.autoIteratorResult.effectiveAutoMode ??
                  params.workflowPolicy.autoMode) !== "off",
            },
          });
          return {
            launched: false,
            reason: "session_pool_full",
            projectId: params.projectId,
            projectRoot: params.projectRoot,
            stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
            owner: action.owner,
            sessionKey: null,
            runId: null,
            dispatchStrategy: null,
            launchKey,
            error: `Researcher service session pool is at capacity for this channel (${researcherSessionLease.activeResearcherSessionsInChannel ?? 0} active).`,
            reusedServiceSession: false,
            activeResearcherSessionsInChannel:
              researcherSessionLease.activeResearcherSessionsInChannel,
          };
        }
      }
      const dispatchLaunch = await launchWorkflowDispatchTransition({
        runtimeSubagent: params.runtimeSubagent,
        workflowPolicy: params.workflowPolicy,
        source: "workflow_auto_stage",
        queueKey: launchKey,
        owner: action.owner as Parameters<typeof deriveAgentSessionKeyForRole>[0]["targetRole"],
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        requesterSessionKey: requesterSessionKey ?? defaultResearcherRequesterSessionKey,
        requesterChannel: requesterBinding.messageChannel ?? undefined,
        preferredSessionKeys:
          action.owner === "researcher"
            ? [
                researcherSessionLease?.sessionKey ??
                  preferredResearcherSessionKeys?.[0] ??
                  defaultResearcherRequesterSessionKey,
              ]
            : preferredResearcherSessionKeys ?? [],
        family: "research",
        kind: "workflow_stage_dispatch",
        fromRole: "researcher",
        stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
        summary: action.summary,
        command: action.command,
        mailboxMessageId: action.mailboxMessageId ?? null,
        extraBody:
          "Workflow auto-mode service dispatch. Continue only the assigned stage, keep durable state current, and do not skip stage completion checks.",
        autoModeActive:
          (params.autoIteratorResult.effectiveAutoMode ??
            params.workflowPolicy.autoMode) !== "off",
        logger: params.logger,
      });
      if (!dispatchLaunch.launched) {
        return {
          launched: false,
          reason: "dispatch_failed",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
          owner: action.owner,
          sessionKey: dispatchLaunch.sessionKey,
          runId: dispatchLaunch.runId,
          dispatchStrategy: dispatchLaunch.strategy,
          launchKey,
          error: dispatchLaunch.error,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel:
            researcherSessionLease?.activeResearcherSessionsInChannel ?? null,
        };
      }

      if (
        action.owner === "researcher" &&
        researcherSessionLease?.channelKey &&
        dispatchLaunch.runId &&
        dispatchLaunch.sessionKey
      ) {
        await recordBackgroundWorkflowRun({
          ownerAgent: "researcher",
          channelKey: researcherSessionLease.channelKey,
          requesterSessionKey: defaultResearcherRequesterSessionKey,
          backgroundSessionKey: dispatchLaunch.sessionKey,
          runId: dispatchLaunch.runId,
          queueKey: launchKey,
          kind: "workflow_stage_dispatch",
          family: "research",
          projectId: params.projectId ?? undefined,
          projectRoot: params.projectRoot,
          projectsRoot: params.workflowPolicy.projectsRoot,
        });
      }

      params.launchedStageKeys.set(params.projectRoot, {
        key: launchKey,
        launchedAt: Date.now(),
      });
      await recordWorkflowContactEvent({
        projectRoot: params.projectRoot,
        fromAgent: "researcher",
        toAgent: action.owner as Parameters<typeof deriveAgentSessionKeyForRole>[0]["targetRole"],
        channel: "sessions_spawn",
      });
      return {
        launched: true,
        reason: "started",
        projectId: params.projectId,
        projectRoot: params.projectRoot,
        stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
        owner: action.owner,
        sessionKey: dispatchLaunch.sessionKey,
        runId: dispatchLaunch.runId,
        dispatchStrategy: dispatchLaunch.strategy,
        launchKey,
        error: null,
        reusedServiceSession: researcherSessionLease?.reusedIdleSession ?? false,
        activeResearcherSessionsInChannel:
          researcherSessionLease?.activeResearcherSessionsInChannel ?? null,
      };
    },
  });
}

async function pollGateReviewAttempts(params: {
  runtimeSubagent: RuntimeSubagentApi;
  attempts: GateReviewAttempt[];
  projectRoot: string;
  projectId: string | null;
}) {
  const announceStore = await readWorkflowAnnounceOutboxStore(params.projectRoot);
  const nextAttempts: GateReviewAttempt[] = [];

  for (const attempt of params.attempts) {
    if (attempt.status !== "pending") {
      nextAttempts.push(attempt);
      continue;
    }

    const announcedResult = readGateReviewAnnounceResult({
      entries: announceStore.entries,
      attempt,
    });
    if (announcedResult) {
      nextAttempts.push({
        ...attempt,
        status: "completed",
        completedAt: attempt.completedAt ?? nowIso(),
        error: null,
        result: {
          ...announcedResult,
          runId: announcedResult.runId ?? attempt.runId,
        },
      });
      continue;
    }

    if (!attempt.runId || !params.runtimeSubagent.waitForRun) {
      nextAttempts.push(attempt);
      continue;
    }

    const waited = await params.runtimeSubagent.waitForRun({
      runId: attempt.runId,
      timeoutMs: 1,
    });
    if (waited.status === "timeout") {
      nextAttempts.push(attempt);
      continue;
    }
    if (waited.status === "error") {
      const failedAttempt = {
        ...attempt,
        status: "error" as const,
        completedAt: nowIso(),
        error: waited.error ?? "gate review run failed",
        result: parseGateReviewResult(
          JSON.stringify({
            verdict: "block",
            overallScore: 0,
            criticalBlockers: [waited.error ?? "gate review run failed"],
            summary: "Gate review run failed before returning a valid response.",
          }),
          attempt.reviewerRole
        ),
      };
      await recordWorkflowAnnounceEvent({
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        announceId: `gate-review:${attempt.runId}:${attempt.reviewerRole}`,
        parentSessionKey: null,
        childSessionKey: attempt.sessionKey,
        deliveryMode: "internal",
        summary: `Gate reviewer ${attempt.reviewerRole} failed ${attempt.runId}.`,
        payload: {
          reviewerRole: attempt.reviewerRole,
          runId: attempt.runId,
          status: "error",
          error: failedAttempt.error,
          completedAt: failedAttempt.completedAt,
          result: failedAttempt.result,
        },
      });
      nextAttempts.push(failedAttempt);
      continue;
    }

    const messages = params.runtimeSubagent.getSessionMessages
      ? await params.runtimeSubagent.getSessionMessages({
          sessionKey: attempt.sessionKey,
          limit: 20,
        })
      : { messages: [] };
    const latestText = extractLatestAssistantText(messages.messages);
    const completedAttempt = {
      ...attempt,
      status: "completed" as const,
      completedAt: nowIso(),
      error: null,
      result: {
        ...parseGateReviewResult(
          latestText ??
            JSON.stringify({
              verdict: "block",
              overallScore: 0,
              criticalBlockers: ["Reviewer returned no readable response."],
              summary: "No readable gate review response was found in the session transcript.",
            }),
          attempt.reviewerRole
        ),
        runId: attempt.runId,
      },
    };
    await recordWorkflowAnnounceEvent({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      announceId: `gate-review:${attempt.runId}:${attempt.reviewerRole}`,
      parentSessionKey: null,
      childSessionKey: attempt.sessionKey,
      deliveryMode: "internal",
      summary: `Gate reviewer ${attempt.reviewerRole} completed ${attempt.runId}.`,
      payload: {
        reviewerRole: attempt.reviewerRole,
        runId: attempt.runId,
        status: "completed",
        completedAt: completedAttempt.completedAt,
        result: completedAttempt.result,
      },
    });
    nextAttempts.push(completedAttempt);
  }

  return nextAttempts;
}

async function pollCodeReviewAttempts(params: {
  runtimeSubagent: RuntimeSubagentApi;
  attempts: CodeReviewAttempt[];
  projectRoot: string;
  projectId: string | null;
}) {
  const announceStore = await readWorkflowAnnounceOutboxStore(params.projectRoot);
  const nextAttempts: CodeReviewAttempt[] = [];

  for (const attempt of params.attempts) {
    if (attempt.status !== "pending") {
      nextAttempts.push(attempt);
      continue;
    }

    const announcedResult = readCodeReviewAnnounceResult({
      entries: announceStore.entries,
      attempt,
    });
    if (announcedResult) {
      nextAttempts.push({
        ...attempt,
        status: "completed",
        completedAt: attempt.completedAt ?? nowIso(),
        error: null,
        result: {
          ...announcedResult,
          runId: announcedResult.runId ?? attempt.runId,
        },
      });
      continue;
    }

    if (!attempt.runId || !params.runtimeSubagent.waitForRun) {
      nextAttempts.push(attempt);
      continue;
    }

    const waited = await params.runtimeSubagent.waitForRun({
      runId: attempt.runId,
      timeoutMs: 1,
    });
    if (waited.status === "timeout") {
      nextAttempts.push(attempt);
      continue;
    }
    if (waited.status === "error") {
      const failedAttempt = {
        ...attempt,
        status: "error" as const,
        completedAt: nowIso(),
        error: waited.error ?? "code innovation review run failed",
        result: parseCodeReviewResult(
          JSON.stringify({
            verdict: "block",
            overallScore: 0,
            criticalBlockers: [waited.error ?? "code innovation review run failed"],
            summary:
              "Code innovation reviewer run failed before returning a valid response.",
          }),
          attempt.reviewerRole
        ),
      };
      await recordWorkflowAnnounceEvent({
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        announceId: `code-review:${attempt.runId}:${attempt.reviewerRole}`,
        parentSessionKey: null,
        childSessionKey: attempt.sessionKey,
        deliveryMode: "internal",
        summary: `Code reviewer ${attempt.reviewerRole} failed ${attempt.runId}.`,
        payload: {
          reviewerRole: attempt.reviewerRole,
          runId: attempt.runId,
          status: "error",
          error: failedAttempt.error,
          completedAt: failedAttempt.completedAt,
          result: failedAttempt.result,
        },
      });
      nextAttempts.push(failedAttempt);
      continue;
    }

    const messages = params.runtimeSubagent.getSessionMessages
      ? await params.runtimeSubagent.getSessionMessages({
          sessionKey: attempt.sessionKey,
          limit: 20,
        })
      : { messages: [] };
    const latestText = extractLatestAssistantText(messages.messages);
    const completedAttempt = {
      ...attempt,
      status: "completed" as const,
      completedAt: nowIso(),
      error: null,
      result: {
        ...parseCodeReviewResult(
          latestText ??
            JSON.stringify({
              verdict: "block",
              overallScore: 0,
              criticalBlockers: ["Reviewer returned no readable response."],
              summary:
                "No readable code innovation review response was found in the session transcript.",
            }),
          attempt.reviewerRole
        ),
        runId: attempt.runId,
      },
    };
    await recordWorkflowAnnounceEvent({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      announceId: `code-review:${attempt.runId}:${attempt.reviewerRole}`,
      parentSessionKey: null,
      childSessionKey: attempt.sessionKey,
      deliveryMode: "internal",
      summary: `Code reviewer ${attempt.reviewerRole} completed ${attempt.runId}.`,
      payload: {
        reviewerRole: attempt.reviewerRole,
        runId: attempt.runId,
        status: "completed",
        completedAt: completedAttempt.completedAt,
        result: completedAttempt.result,
      },
    });
    nextAttempts.push(completedAttempt);
  }

  return nextAttempts;
}

async function pollAutoModeDiscussionAttempts(params: {
  runtimeSubagent: RuntimeSubagentApi;
  attempts: AutoModeDiscussionReviewAttempt[];
  projectRoot: string;
  projectId: string | null;
  projectsRoot?: string | null;
}) {
  const announceStore = await readWorkflowAnnounceOutboxStore(params.projectRoot);
  const nextAttempts: AutoModeDiscussionReviewAttempt[] = [];

  for (const originalAttempt of params.attempts) {
    let attempt = originalAttempt;
    if (attempt.status !== "pending") {
      nextAttempts.push(attempt);
      continue;
    }
    if (!attempt.runId && attempt.queueKey) {
      const activeQueuedRun = await getBackgroundWorkflowRunByQueueKey({
        queueKey: attempt.queueKey,
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        projectsRoot: params.projectsRoot,
        runtimeSubagent: params.runtimeSubagent,
      });
      if (activeQueuedRun?.runId && activeQueuedRun.backgroundSessionKey) {
        attempt = {
          ...attempt,
          sessionKey: activeQueuedRun.backgroundSessionKey,
          runId: activeQueuedRun.runId,
        };
      } else {
        const pendingQueueState = await hasPendingBackgroundWorkflowQueueKey({
          queueKey: attempt.queueKey,
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          projectsRoot: params.projectsRoot,
        });
        if (pendingQueueState.queued || pendingQueueState.active) {
          nextAttempts.push(attempt);
          continue;
        }
        nextAttempts.push({
          ...attempt,
          status: "error" as const,
          completedAt: nowIso(),
          error: "Queued auto discussion reviewer run disappeared before launch.",
          result: parseAutoModeDiscussionResult(
            JSON.stringify({
              riskAssessment: "blocked",
              confidence: 0,
              recommendedOwner: "researcher",
              blockers: ["Queued auto discussion reviewer run disappeared before launch."],
              summary: "Queued auto discussion reviewer run disappeared before launch.",
            }),
            attempt.reviewerRole
          ),
        });
        continue;
      }
    }
    const announcedResult = readAutoModeDiscussionAnnounceResult({
      entries: announceStore.entries,
      attempt,
    });
    if (announcedResult) {
      nextAttempts.push({
        ...attempt,
        status: "completed",
        completedAt: attempt.completedAt ?? nowIso(),
        error: null,
        result: {
          ...announcedResult,
          runId: announcedResult.runId ?? attempt.runId,
        },
      });
      continue;
    }
    if (!attempt.runId || !params.runtimeSubagent.waitForRun) {
      nextAttempts.push(attempt);
      continue;
    }
    const waited = await params.runtimeSubagent.waitForRun({
      runId: attempt.runId,
      timeoutMs: 1,
    });
    if (waited.status === "timeout") {
      nextAttempts.push(attempt);
      continue;
    }
    if (waited.status === "error") {
      const failedAttempt = {
        ...attempt,
        status: "error" as const,
        completedAt: nowIso(),
        error: waited.error ?? "auto discussion run failed",
        result: parseAutoModeDiscussionResult(
          JSON.stringify({
            riskAssessment: "blocked",
            confidence: 0,
            recommendedOwner: "researcher",
            blockers: [waited.error ?? "auto discussion run failed"],
            summary: "Auto discussion run failed before returning a valid response.",
          }),
          attempt.reviewerRole
        ),
      };
      await recordWorkflowAnnounceEvent({
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        announceId: `auto-discussion:${attempt.runId}:${attempt.reviewerRole}`,
        parentSessionKey: null,
        childSessionKey: attempt.sessionKey,
        deliveryMode: "internal",
        summary: `Auto discussion reviewer ${attempt.reviewerRole} failed ${attempt.runId}.`,
        payload: {
          reviewerRole: attempt.reviewerRole,
          runId: attempt.runId,
          status: "error",
          error: failedAttempt.error,
          completedAt: failedAttempt.completedAt,
          result: failedAttempt.result,
        },
      });
      nextAttempts.push(failedAttempt);
      continue;
    }
    const messages = params.runtimeSubagent.getSessionMessages
      ? await params.runtimeSubagent.getSessionMessages({
          sessionKey: attempt.sessionKey,
          limit: 20,
        })
      : { messages: [] };
    const latestText = extractLatestAssistantText(messages.messages);
    const completedAttempt = {
      ...attempt,
      status: "completed" as const,
      completedAt: nowIso(),
      error: null,
      result: {
        ...parseAutoModeDiscussionResult(
          latestText ??
            JSON.stringify({
              riskAssessment: "blocked",
              confidence: 0,
              recommendedOwner: "researcher",
              blockers: ["Reviewer returned no readable response."],
              summary:
                "No readable auto discussion response was found in the session transcript.",
            }),
          attempt.reviewerRole
        ),
        runId: attempt.runId,
      },
    };
    await recordWorkflowAnnounceEvent({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      announceId: `auto-discussion:${attempt.runId}:${attempt.reviewerRole}`,
      parentSessionKey: null,
      childSessionKey: attempt.sessionKey,
      deliveryMode: "internal",
      summary: `Auto discussion reviewer ${attempt.reviewerRole} completed ${attempt.runId}.`,
      payload: {
        reviewerRole: attempt.reviewerRole,
        runId: attempt.runId,
        status: "completed",
        completedAt: completedAttempt.completedAt,
        result: completedAttempt.result,
      },
    });
    nextAttempts.push(completedAttempt);
  }

  return nextAttempts;
}

function buildAutoMitigationLaunchKey(params: {
  projectRoot: string;
  fingerprint: string | null;
  owner: DispatchableWorkflowRole | null;
  roundId: string | null;
}) {
  return [
    path.resolve(params.projectRoot),
    params.fingerprint ?? "no-fingerprint",
    params.owner ?? "researcher",
    params.roundId ?? "no-round",
  ].join("::");
}

function buildAutoMitigationExtraBody(params: {
  packetPath: string | null;
  summary: string | null;
  actionItems: string[];
  blockers: string[];
}) {
  return [
    "Workflow auto-mode risk mitigation dispatch.",
    params.packetPath ? `Discussion packet: ${params.packetPath}` : null,
    params.summary ? `Panel summary: ${params.summary}` : null,
    params.actionItems.length > 0
      ? `Action items:\n- ${params.actionItems.join("\n- ")}`
      : "Action items: none were returned.",
    params.blockers.length > 0
      ? `Open blockers:\n- ${params.blockers.join("\n- ")}`
      : null,
    "Make one bounded remediation pass for the listed risk signals, update durable workflow artifacts, then rerun research_workflow.auto_iterator_tick.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function maybeAdvanceAutoCodeReviewForProject(params: {
  runtimeSubagent?: RuntimeSubagentApi;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  projectRoot: string;
  projectId: string | null;
  autoIteratorResult: {
    effectiveAutoMode?: string | null;
    gateBlocking?: boolean;
    gateReason?: string | null;
    stageAfter?: string | null;
    missingStageSignals?: string[];
    recommendedActions?: Array<{ kind: string; summary: string; command: string | null }>;
  };
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
    label: "workflow_auto_code_review",
    logger: params.logger,
    task: async (): Promise<AutoCodeReviewAttempt> => {
      if (
        !params.workflowPolicy.autoGate.enabled ||
        (params.autoIteratorResult.effectiveAutoMode ?? params.workflowPolicy.autoMode) !==
          "aggressive"
      ) {
        return {
          launched: false,
          reason: "disabled",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId: null,
          stage: params.autoIteratorResult.stageAfter ?? null,
          status: null,
          reviewCount: 0,
          approved: false,
        };
      }
      if (
        params.autoIteratorResult.stageAfter !== "code" ||
        params.autoIteratorResult.gateBlocking !== true
      ) {
        return {
          launched: false,
          reason: "not_code_gate",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId: null,
          stage: params.autoIteratorResult.stageAfter ?? null,
          status: null,
          reviewCount: 0,
          approved: false,
        };
      }

      const missingStageSignals = Array.isArray(params.autoIteratorResult.missingStageSignals)
        ? params.autoIteratorResult.missingStageSignals.filter(
            (item): item is string => typeof item === "string" && item.trim().length > 0
          )
        : [];
      if (missingStageSignals.length > 0) {
        return {
          launched: false,
          reason: "bundle_incomplete",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId: "CODE-REVIEW",
          stage: "code",
          status: null,
          reviewCount: 0,
          approved: false,
        };
      }

      const packet = await materializeCodeReviewPacket({
        projectRoot: params.projectRoot,
        projectId: params.projectId,
      });
      const store = await readCodeReviewStore(params.projectRoot);
      const currentRound = store.currentRound;
      if (
        currentRound?.gateId === "CODE-REVIEW" &&
        currentRound.packetFingerprint === packet.packetFingerprint &&
        currentRound.status === "approved"
      ) {
        return {
          launched: false,
          reason: "already_approved",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId: "CODE-REVIEW",
          stage: "code",
          status: currentRound.status,
          reviewCount: currentRound.aggregate?.reviewCount ?? 0,
          approved: true,
        };
      }
      if (
        currentRound?.gateId === "CODE-REVIEW" &&
        currentRound.packetFingerprint === packet.packetFingerprint &&
        currentRound.status === "rejected"
      ) {
        return {
          launched: false,
          reason: "already_rejected",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId: "CODE-REVIEW",
          stage: "code",
          status: currentRound.status,
          reviewCount: currentRound.aggregate?.reviewCount ?? 0,
          approved: false,
        };
      }
      if (!params.runtimeSubagent) {
        return {
          launched: false,
          reason: "no_runtime_subagent",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId: "CODE-REVIEW",
          stage: "code",
          status: currentRound?.status ?? null,
          reviewCount: currentRound?.aggregate?.reviewCount ?? 0,
          approved: false,
        };
      }

      if (
        currentRound?.gateId === "CODE-REVIEW" &&
        currentRound.packetFingerprint === packet.packetFingerprint &&
        currentRound.status === "reviewing"
      ) {
        const attempts = await pollCodeReviewAttempts({
          runtimeSubagent: params.runtimeSubagent,
          attempts: currentRound.attempts,
          projectRoot: params.projectRoot,
          projectId: params.projectId,
        });
        const nextRound = {
          ...currentRound,
          attempts,
          updatedAt: nowIso(),
        };
        nextRound.aggregate = aggregateCodeReviewRound(
          nextRound,
          params.workflowPolicy.autoGate
        );
        nextRound.status = nextRound.aggregate.status;
        const nextStore = {
          ...store,
          updatedAt: nowIso(),
          currentRound: nextRound,
        };
        await saveCodeReviewStore(params.projectRoot, nextStore);
        return {
          launched: false,
          reason: nextRound.status === "reviewing" ? "reviewing" : "updated",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId: "CODE-REVIEW",
          stage: "code",
          status: nextRound.status,
          reviewCount: nextRound.aggregate?.reviewCount ?? 0,
          approved: nextRound.aggregate?.approved === true,
        };
      }

      if (store.roundsStarted >= params.workflowPolicy.autoGate.maxReviewRounds) {
        return {
          launched: false,
          reason: "already_rejected",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId: "CODE-REVIEW",
          stage: "code",
          status: "rejected",
          reviewCount: currentRound?.aggregate?.reviewCount ?? 0,
          approved: false,
        };
      }

      const requesterSessionKey = resolveWorkflowRequesterSessionKey({
        projectRoot: params.projectRoot,
        workflowPolicy: params.workflowPolicy,
        deps,
      });
      const attempts: CodeReviewAttempt[] = [];
      for (const reviewerRole of defaultCodeReviewPanel()) {
        const sessionKey = deriveAgentSessionKeyForRole({
          requesterSessionKey: requesterSessionKey ?? undefined,
          targetRole: reviewerRole,
        });
        const queueKey = slugifyForIdempotency(
          `openclaw-research:auto-code-review:${params.projectId ?? path.basename(params.projectRoot)}:${packet.packetFingerprint}:${reviewerRole}`
        );
        try {
          const started = await launchWorkflowNestedRunTransition({
            runtimeSubagent: params.runtimeSubagent,
            source: "workflow_auto_code_review",
            queueKey,
            ownerAgent: reviewerRole,
            sessionKey,
            requesterSessionKey: requesterSessionKey ?? "agent:researcher:main",
            projectRoot: params.projectRoot,
            projectId: params.projectId,
            family: "review",
            kind: "workflow_auto_code_review",
            summary: `Run code innovation review for ${reviewerRole}.`,
            message: buildCodeReviewPrompt({
              projectRoot: params.projectRoot,
              projectId: params.projectId,
              reviewerRole,
              packetPath: packet.packetPath,
              packetJsonPath: packet.packetJsonPath,
            }),
            idempotencyKey: queueKey,
            extraSystemPrompt:
              "Workflow code innovation reviewer.\n" +
              "Review only the supplied code review packet and return the required JSON schema.",
          });
          if (!started.launched || !started.runId) {
            throw new Error(
              started.error ??
                "Code innovation reviewer run failed to launch through the workflow runtime."
            );
          }
          attempts.push({
            reviewerRole,
            sessionKey,
            runId: started.runId,
            status: "pending",
            launchedAt: nowIso(),
            completedAt: null,
            error: null,
            result: null,
          });
        } catch (error) {
          attempts.push({
            reviewerRole,
            sessionKey,
            runId: null,
            status: "error",
            launchedAt: nowIso(),
            completedAt: nowIso(),
            error: error instanceof Error ? error.message : String(error),
            result: parseCodeReviewResult(
              JSON.stringify({
                verdict: "block",
                overallScore: 0,
                criticalBlockers: [
                  error instanceof Error ? error.message : String(error),
                ],
                summary: "Code reviewer run failed to start.",
              }),
              reviewerRole
            ),
          });
        }
      }

      const round = createCodeReviewRound({
        stage: "code",
        packetPath: packet.packetPath,
        packetJsonPath: packet.packetJsonPath,
        packetFingerprint: packet.packetFingerprint,
        attempts,
      });
      const nextStore = {
        schemaVersion: 1 as const,
        updatedAt: nowIso(),
        roundsStarted: store.roundsStarted + 1,
        currentRound: round,
      };
      await saveCodeReviewStore(params.projectRoot, nextStore);
      return {
        launched: true,
        reason: "started",
        projectId: params.projectId,
        projectRoot: params.projectRoot,
        gateId: "CODE-REVIEW",
        stage: "code",
        status: round.status,
        reviewCount: 0,
        approved: false,
      };
    },
  });
}

export async function maybeAdvanceAutoGateReviewForProject(params: {
  runtimeSubagent?: RuntimeSubagentApi;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  projectRoot: string;
  projectId: string | null;
  autoIteratorResult: {
    effectiveAutoMode?: string | null;
    gateBlocking?: boolean;
    stageAfter?: string | null;
    recommendedActions?: Array<{ kind: string; summary: string; command: string | null }>;
  };
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
    label: "workflow_auto_gate_review",
    logger: params.logger,
    task: async (): Promise<AutoGateReviewAttempt> => {
      if (
        !params.workflowPolicy.autoGate.enabled ||
        (params.autoIteratorResult.effectiveAutoMode ?? params.workflowPolicy.autoMode) !==
          "aggressive"
      ) {
        return {
          launched: false,
          reason: "disabled",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId: null,
          stage: params.autoIteratorResult.stageAfter ?? null,
          status: null,
          reviewCount: 0,
          approved: false,
        };
      }
      if (
        params.autoIteratorResult.stageAfter !== "submit" ||
        params.autoIteratorResult.gateBlocking !== true
      ) {
        return {
          launched: false,
          reason: "not_submit_gate",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId: null,
          stage: params.autoIteratorResult.stageAfter ?? null,
          status: null,
          reviewCount: 0,
          approved: false,
        };
      }
      const manifest = await readJsonIfExists<Record<string, unknown>>(
        path.join(params.projectRoot, "PROJECT_MANIFEST.json")
      );
      const scoreEvaluation = evaluateAutoGate(
        "submit",
        manifest,
        params.workflowPolicy.autoGate
      );
      if (scoreEvaluation.scoreRecordCount > 0 && !scoreEvaluation.pass) {
        return {
          launched: false,
          reason: "already_rejected",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId: "GATE-5",
          stage: "submit",
          status: "rejected",
          reviewCount: scoreEvaluation.scoreRecordCount,
          approved: false,
        };
      }
      return {
        launched: false,
        reason: "manual_confirmation_required",
        projectId: params.projectId,
        projectRoot: params.projectRoot,
        gateId: "GATE-5",
        stage: "submit",
        status:
          scoreEvaluation.scoreRecordCount > 0 && scoreEvaluation.pass
            ? "thresholds_passed"
            : null,
        reviewCount: scoreEvaluation.scoreRecordCount,
        approved: false,
      };
    },
  });
}

export async function maybeAdvanceAutoModeDiscussionForProject(params: {
  runtimeSubagent?: RuntimeSubagentApi;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  projectRoot: string;
  projectId: string | null;
  autoIteratorResult: {
    configuredAutoMode?: string | null;
    autoModeRiskLevel?: string | null;
    autoModeReasons?: string[];
    autoModeRiskFingerprint?: string | null;
    stageAfter?: string | null;
    ownerAfter?: string | null;
    nextAction?: string | null;
    blockingReason?: string | null;
    missingStageSignals?: string[];
  };
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
    label: "workflow_auto_mode_discussion",
    logger: params.logger,
    task: async (): Promise<AutoModeDiscussionAttempt> => {
      const configuredMode =
        readString(params.autoIteratorResult.configuredAutoMode) ??
        params.workflowPolicy.autoMode;
      const riskLevel = readString(params.autoIteratorResult.autoModeRiskLevel);
      const fingerprint = readString(params.autoIteratorResult.autoModeRiskFingerprint);
      const riskReasons = Array.isArray(params.autoIteratorResult.autoModeReasons)
        ? params.autoIteratorResult.autoModeReasons.filter(
            (item): item is string => typeof item === "string" && item.trim().length > 0
          )
        : [];
      const coreRiskReasons = riskReasons.filter(
        (item) => !/^Auto discussion /i.test(item)
      );
      const missingStageSignals = Array.isArray(params.autoIteratorResult.missingStageSignals)
        ? params.autoIteratorResult.missingStageSignals.filter(
            (item): item is string => typeof item === "string" && item.trim().length > 0
          )
        : [];
      if (configuredMode === "off") {
        return {
          launched: false,
          reason: "disabled",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          fingerprint,
          stage: params.autoIteratorResult.stageAfter ?? null,
          riskLevel,
          status: null,
          reviewCount: 0,
          roundsStarted: 0,
          recommendedOwner: null,
          actionItems: [],
          blockers: [],
          summary: null,
          roundId: null,
          packetPath: null,
          resolved: false,
        };
      }
      if (riskLevel == null || riskLevel === "stable" || !fingerprint) {
        return {
          launched: false,
          reason: "stable",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          fingerprint,
          stage: params.autoIteratorResult.stageAfter ?? null,
          riskLevel,
          status: null,
          reviewCount: 0,
          roundsStarted: 0,
          recommendedOwner: null,
          actionItems: [],
          blockers: [],
          summary: null,
          roundId: null,
          packetPath: null,
          resolved: false,
        };
      }

      const packet = await materializeAutoModeDiscussionPacket({
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        stage: params.autoIteratorResult.stageAfter ?? null,
        riskLevel: riskLevel as "caution" | "severe",
        riskReasons: coreRiskReasons.length > 0 ? coreRiskReasons : riskReasons,
        missingStageSignals,
        ownerAfter: params.autoIteratorResult.ownerAfter ?? null,
        nextAction: params.autoIteratorResult.nextAction ?? null,
        blockingReason: params.autoIteratorResult.blockingReason ?? null,
      });
      const store = await readAutoModeDiscussionStore(params.projectRoot);
      const currentRound = store.currentRound;
      const roundsStarted = store.roundsStartedByFingerprint[packet.packetFingerprint] ?? 0;

      if (
        currentRound?.packetFingerprint === packet.packetFingerprint &&
        currentRound.status === "resolved"
      ) {
        return {
          launched: false,
          reason: "resolved",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          fingerprint: packet.packetFingerprint,
          stage: currentRound.stage,
          riskLevel: currentRound.riskLevel,
          status: currentRound.status,
          reviewCount: currentRound.aggregate?.reviewCount ?? 0,
          roundsStarted,
          recommendedOwner: currentRound.aggregate?.recommendedOwner ?? null,
          actionItems: currentRound.aggregate?.actionItems ?? [],
          blockers: currentRound.aggregate?.blockers ?? [],
          summary: currentRound.aggregate?.summary ?? null,
          roundId: currentRound.roundId,
          packetPath: currentRound.packetPath,
          resolved: true,
        };
      }

      if (
        currentRound?.packetFingerprint === packet.packetFingerprint &&
        currentRound.status === "reviewing"
      ) {
        if (!params.runtimeSubagent) {
          return {
            launched: false,
            reason: "no_runtime_subagent",
            projectId: params.projectId,
            projectRoot: params.projectRoot,
            fingerprint: packet.packetFingerprint,
            stage: currentRound.stage,
            riskLevel: currentRound.riskLevel,
            status: currentRound.status,
            reviewCount: currentRound.aggregate?.reviewCount ?? 0,
            roundsStarted,
            recommendedOwner: currentRound.aggregate?.recommendedOwner ?? null,
            actionItems: currentRound.aggregate?.actionItems ?? [],
            blockers: currentRound.aggregate?.blockers ?? [],
            summary: currentRound.aggregate?.summary ?? null,
            roundId: currentRound.roundId,
            packetPath: currentRound.packetPath,
            resolved: false,
          };
        }
        const attempts = await pollAutoModeDiscussionAttempts({
          runtimeSubagent: params.runtimeSubagent,
          attempts: currentRound.attempts,
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          projectsRoot: params.workflowPolicy.projectsRoot,
        });
        const nextRound = {
          ...currentRound,
          attempts,
          updatedAt: nowIso(),
        };
        nextRound.aggregate = aggregateAutoModeDiscussionRound(
          nextRound,
          params.workflowPolicy.autoGate.quorum
        );
        nextRound.status = nextRound.aggregate.status;
        const nextStore = {
          ...store,
          updatedAt: nowIso(),
          currentRound: nextRound,
        };
        await saveAutoModeDiscussionStore(params.projectRoot, nextStore);
        return {
          launched: false,
          reason: nextRound.status === "reviewing" ? "reviewing" : "updated",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          fingerprint: packet.packetFingerprint,
          stage: nextRound.stage,
          riskLevel: nextRound.riskLevel,
          status: nextRound.status,
          reviewCount: nextRound.aggregate?.reviewCount ?? 0,
          roundsStarted,
          recommendedOwner: nextRound.aggregate?.recommendedOwner ?? null,
          actionItems: nextRound.aggregate?.actionItems ?? [],
          blockers: nextRound.aggregate?.blockers ?? [],
          summary: nextRound.aggregate?.summary ?? null,
          roundId: nextRound.roundId,
          packetPath: nextRound.packetPath,
          resolved: nextRound.status === "resolved",
        };
      }

      if (roundsStarted >= params.workflowPolicy.autoGate.maxMitigationRounds) {
        return {
          launched: false,
          reason: "round_limit_reached",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          fingerprint: packet.packetFingerprint,
          stage: currentRound?.stage ?? params.autoIteratorResult.stageAfter ?? null,
          riskLevel: currentRound?.riskLevel ?? riskLevel,
          status: currentRound?.status ?? "blocked",
          reviewCount: currentRound?.aggregate?.reviewCount ?? 0,
          roundsStarted,
          recommendedOwner: currentRound?.aggregate?.recommendedOwner ?? null,
          actionItems: currentRound?.aggregate?.actionItems ?? [],
          blockers: currentRound?.aggregate?.blockers ?? [],
          summary: currentRound?.aggregate?.summary ?? null,
          roundId: currentRound?.roundId ?? null,
          packetPath: currentRound?.packetPath ?? packet.packetPath,
          resolved: false,
        };
      }
      if (!params.runtimeSubagent) {
        return {
          launched: false,
          reason: "no_runtime_subagent",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          fingerprint: packet.packetFingerprint,
          stage: params.autoIteratorResult.stageAfter ?? null,
          riskLevel,
          status: null,
          reviewCount: 0,
          roundsStarted,
          recommendedOwner: null,
          actionItems: [],
          blockers: [],
          summary: null,
          roundId: null,
          packetPath: packet.packetPath,
          resolved: false,
        };
      }

      const requesterSessionKey = resolveWorkflowRequesterSessionKey({
        projectRoot: params.projectRoot,
        workflowPolicy: params.workflowPolicy,
        deps,
      });
      const attempts: AutoModeDiscussionReviewAttempt[] = [];
      for (const reviewerRole of defaultAutoModeDiscussionPanel()) {
        let sessionKey: string | null =
          reviewerRole === "researcher"
            ? buildResearcherWorkflowSubagentSessionKey({
                requesterSessionKey: requesterSessionKey ?? undefined,
                projectRoot: params.projectRoot,
                purpose: "workflow-auto-discussion",
                segments: [
                  params.autoIteratorResult.stageAfter ?? null,
                  riskLevel,
                  `${roundsStarted + 1}`,
                ],
              })
            : deriveAgentSessionKeyForRole({
                requesterSessionKey: requesterSessionKey ?? undefined,
                targetRole: reviewerRole,
              });
        const researcherDiscussionQueueKey =
          reviewerRole === "researcher"
            ? [
                "auto-discussion",
                params.projectId ?? path.basename(params.projectRoot),
                packet.packetFingerprint,
                `${roundsStarted + 1}`,
                reviewerRole,
              ].join(":")
            : null;
        let researcherSessionLease:
          | Awaited<ReturnType<typeof acquireBackgroundWorkflowSession>>
          | null = null;
        if (reviewerRole === "researcher") {
          researcherSessionLease = await acquireBackgroundWorkflowSession({
            runtimeSubagent: params.runtimeSubagent,
            ownerAgent: "researcher",
            requesterSessionKey: requesterSessionKey ?? "agent:researcher:main",
            preferredSessionKey: sessionKey,
            family: "research",
            kind: "workflow_auto_discussion",
            projectId: params.projectId ?? undefined,
            projectRoot: params.projectRoot,
            projectsRoot: params.workflowPolicy.projectsRoot,
          });
          if (!researcherSessionLease.acquired || !researcherSessionLease.sessionKey) {
            await enqueueQueuedBackgroundWorkflowRun({
              source: "workflow_auto_discussion",
              ownerAgent: "researcher",
              requesterSessionKey: requesterSessionKey ?? "agent:researcher:main",
              preferredSessionKey: sessionKey,
              family: "research",
              kind: "workflow_auto_discussion",
              projectId: params.projectId ?? undefined,
              projectRoot: params.projectRoot,
              projectsRoot: params.workflowPolicy.projectsRoot,
              queueKey: researcherDiscussionQueueKey,
              summary:
                "Queued the researcher auto discussion reviewer until an idle Researcher service session becomes available.",
              runPayload: {
                message: buildAutoModeDiscussionPrompt({
                  projectRoot: params.projectRoot,
                  projectId: params.projectId,
                  stage: params.autoIteratorResult.stageAfter ?? null,
                  riskLevel: riskLevel as "caution" | "severe",
                  reviewerRole,
                  packetPath: packet.packetPath,
                  packetJsonPath: packet.packetJsonPath,
                }),
                lane: "nested",
                deliver: false,
                idempotencyKey: slugifyForIdempotency(
                  `openclaw-research:auto-discussion:${params.projectId ?? path.basename(params.projectRoot)}:${packet.packetFingerprint}:${reviewerRole}:${roundsStarted + 1}`
                ),
                extraSystemPrompt:
                  "Workflow auto risk discussion reviewer.\n" +
                  "Review only the supplied risk packet and return the required JSON schema.",
              },
            });
            params.logger?.debug?.("Queued researcher auto discussion reviewer because the shared service session pool is at capacity.", {
              projectId: params.projectId,
              projectRoot: params.projectRoot,
              stage: params.autoIteratorResult.stageAfter ?? null,
              riskLevel,
              activeResearcherSessionsInChannel:
                researcherSessionLease.activeResearcherSessionsInChannel,
            });
            attempts.push({
              reviewerRole,
              sessionKey: sessionKey ?? "",
              runId: null,
              queueKey: researcherDiscussionQueueKey,
              status: "pending",
              launchedAt: nowIso(),
              completedAt: null,
              error: null,
              result: null,
            });
            continue;
          }
          sessionKey = researcherSessionLease.sessionKey;
        }
        try {
          const queueKey = slugifyForIdempotency(
            `openclaw-research:auto-discussion:${params.projectId ?? path.basename(params.projectRoot)}:${packet.packetFingerprint}:${reviewerRole}:${roundsStarted + 1}`
          );
          const started = await launchWorkflowNestedRunTransition({
            runtimeSubagent: params.runtimeSubagent,
            source: "workflow_auto_discussion",
            queueKey,
            ownerAgent: reviewerRole,
            sessionKey,
            requesterSessionKey: requesterSessionKey ?? "agent:researcher:main",
            projectRoot: params.projectRoot,
            projectId: params.projectId,
            family: "review",
            kind: "workflow_auto_discussion",
            summary: `Run auto discussion review for ${reviewerRole}.`,
            message: buildAutoModeDiscussionPrompt({
              projectRoot: params.projectRoot,
              projectId: params.projectId,
              stage: params.autoIteratorResult.stageAfter ?? null,
              riskLevel: riskLevel as "caution" | "severe",
              reviewerRole,
              packetPath: packet.packetPath,
              packetJsonPath: packet.packetJsonPath,
            }),
            idempotencyKey: queueKey,
            extraSystemPrompt:
              "Workflow auto risk discussion reviewer.\n" +
              "Review only the supplied risk packet and return the required JSON schema.",
          });
          if (!started.launched || !started.runId) {
            throw new Error(
              started.error ??
                "Auto discussion reviewer failed to launch through the workflow runtime."
            );
          }
          if (reviewerRole === "researcher" && researcherSessionLease?.channelKey) {
            await recordBackgroundWorkflowRun({
              ownerAgent: "researcher",
              channelKey: researcherSessionLease.channelKey,
              requesterSessionKey: requesterSessionKey ?? "agent:researcher:main",
              backgroundSessionKey: sessionKey,
              runId: started.runId,
              kind: "workflow_auto_discussion",
              family: "research",
              projectId: params.projectId ?? undefined,
              projectRoot: params.projectRoot,
              projectsRoot: params.workflowPolicy.projectsRoot,
            });
          }
          attempts.push({
            reviewerRole,
            sessionKey,
            runId: started.runId,
            queueKey: researcherDiscussionQueueKey,
            status: "pending",
            launchedAt: nowIso(),
            completedAt: null,
            error: null,
            result: null,
          });
        } catch (error) {
          attempts.push({
            reviewerRole,
            sessionKey,
            runId: null,
            queueKey: researcherDiscussionQueueKey,
            status: "error",
            launchedAt: nowIso(),
            completedAt: nowIso(),
            error: error instanceof Error ? error.message : String(error),
            result: parseAutoModeDiscussionResult(
              JSON.stringify({
                riskAssessment: "blocked",
                confidence: 0,
                recommendedOwner: "researcher",
                blockers: [error instanceof Error ? error.message : String(error)],
                summary: "Risk discussion run failed to start.",
              }),
              reviewerRole
            ),
          });
        }
      }
      const round = createAutoModeDiscussionRound({
        stage: params.autoIteratorResult.stageAfter ?? null,
        riskLevel: riskLevel as "caution" | "severe",
        packetPath: packet.packetPath,
        packetJsonPath: packet.packetJsonPath,
        packetFingerprint: packet.packetFingerprint,
        attempts,
      });
      const nextStore = {
        schemaVersion: 1 as const,
        updatedAt: nowIso(),
        roundsStartedByFingerprint: {
          ...store.roundsStartedByFingerprint,
          [packet.packetFingerprint]: roundsStarted + 1,
        },
        currentRound: round,
      };
      await saveAutoModeDiscussionStore(params.projectRoot, nextStore);
      return {
        launched: true,
        reason: "started",
        projectId: params.projectId,
        projectRoot: params.projectRoot,
        fingerprint: packet.packetFingerprint,
        stage: round.stage,
        riskLevel: round.riskLevel,
        status: round.status,
        reviewCount: 0,
        roundsStarted: roundsStarted + 1,
        recommendedOwner: null,
        actionItems: [],
        blockers: [],
        summary: null,
        roundId: round.roundId,
        packetPath: round.packetPath,
        resolved: false,
      };
    },
  });
}

export async function maybeDispatchAutoModeMitigationForProject(params: {
  runtimeSubagent?: RuntimeSubagentApi;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  projectRoot: string;
  projectId: string | null;
  autoIteratorResult: {
    stageAfter?: string | null;
    nextAction?: string | null;
    ownerAfter?: DispatchableWorkflowRole | null;
    effectiveAutoMode?: string | null;
  };
  discussionAttempt: AutoModeDiscussionAttempt;
  launchedMitigationKeys: Map<string, { key: string; launchedAt: number }>;
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
    label: "workflow_auto_mode_mitigation",
    logger: params.logger,
    task: async (): Promise<AutoModeMitigationDispatchAttempt> => {
      if (
        params.discussionAttempt.status !== "needs_changes" &&
        params.discussionAttempt.status !== "blocked"
      ) {
        return {
          launched: false,
          reason: "not_needed",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          fingerprint: params.discussionAttempt.fingerprint,
          stage: params.discussionAttempt.stage,
          owner: null,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          error: null,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        };
      }
      if (!params.runtimeSubagent) {
        return {
          launched: false,
          reason: "no_runtime_subagent",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          fingerprint: params.discussionAttempt.fingerprint,
          stage: params.discussionAttempt.stage,
          owner: params.discussionAttempt.recommendedOwner,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          error: null,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        };
      }

      const owner =
        params.discussionAttempt.recommendedOwner ??
        params.autoIteratorResult.ownerAfter ??
        "researcher";
      const launchKey = buildAutoMitigationLaunchKey({
        projectRoot: params.projectRoot,
        fingerprint: params.discussionAttempt.fingerprint,
        owner,
        roundId: params.discussionAttempt.roundId,
      });
      const lastLaunch = params.launchedMitigationKeys.get(params.projectRoot);
      const cooldownMs = Math.max(
        1,
        params.workflowPolicy.agentContactCooldownSeconds
      ) * 1000;
      if (
        lastLaunch?.key === launchKey &&
        Date.now() - lastLaunch.launchedAt < cooldownMs
      ) {
        return {
          launched: false,
          reason: "already_dispatched",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          fingerprint: params.discussionAttempt.fingerprint,
          stage: params.discussionAttempt.stage,
          owner,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          error: null,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        };
      }

      const requesterBinding = resolveWorkflowRequesterBinding({
        projectRoot: params.projectRoot,
        workflowPolicy: params.workflowPolicy,
        deps,
      });
      const requesterSessionKey = requesterBinding.sessionKey;
      const defaultResearcherRequesterSessionKey =
        requesterSessionKey ?? "agent:researcher:main";
      const preferredResearcherSessionKeys = buildWorkflowCoordinatorDispatchSessionKeys({
        requesterSessionKey: requesterSessionKey ?? undefined,
        owner,
        projectRoot: params.projectRoot,
        purpose: "workflow-mitigation",
        segments: [
          params.discussionAttempt.stage ?? params.autoIteratorResult.stageAfter ?? null,
          params.autoIteratorResult.nextAction,
        ],
      });
      let researcherSessionLease:
        | Awaited<ReturnType<typeof acquireBackgroundWorkflowSession>>
        | null = null;
      if (owner === "researcher") {
        researcherSessionLease = await acquireBackgroundWorkflowSession({
          runtimeSubagent: params.runtimeSubagent,
          ownerAgent: "researcher",
          requesterSessionKey: defaultResearcherRequesterSessionKey,
          preferredSessionKey: preferredResearcherSessionKeys?.[0] ?? null,
          family: "research",
          kind: "workflow_mitigation_dispatch",
          projectId: params.projectId ?? undefined,
          projectRoot: params.projectRoot,
          projectsRoot: params.workflowPolicy.projectsRoot,
        });
        if (!researcherSessionLease.acquired || !researcherSessionLease.sessionKey) {
          await enqueueQueuedBackgroundWorkflowRun({
            source: "workflow_auto_mitigation",
            ownerAgent: "researcher",
            requesterSessionKey: defaultResearcherRequesterSessionKey,
            preferredSessionKey: preferredResearcherSessionKeys?.[0] ?? null,
            family: "research",
            kind: "workflow_mitigation_dispatch",
            projectId: params.projectId ?? undefined,
            projectRoot: params.projectRoot,
            projectsRoot: params.workflowPolicy.projectsRoot,
            queueKey: launchKey,
            summary:
              "Queued the mitigation pass until an idle Researcher service session becomes available.",
            dispatchPayload: {
              requesterChannel: requesterBinding.messageChannel,
              requesterAccountId: null,
              preferredSessionKeys: preferredResearcherSessionKeys ?? [],
              fromRole: "researcher",
              toRole: owner,
              projectRoot: params.projectRoot,
              projectId: params.projectId,
              stage: params.autoIteratorResult.stageAfter ?? null,
              summary:
                params.discussionAttempt.summary ??
                "Resolve the current auto-mode risk before the next workflow advance.",
              command:
                params.autoIteratorResult.nextAction ??
                "Run research_workflow.auto_iterator_tick after the mitigation pass.",
              mailboxMessageId: null,
              extraBody: buildAutoMitigationExtraBody({
                packetPath: params.discussionAttempt.packetPath,
                summary: params.discussionAttempt.summary,
                actionItems: params.discussionAttempt.actionItems,
                blockers: params.discussionAttempt.blockers,
              }),
              waitTimeoutMs: 5000,
              retryOnTimeout: true,
              enableSpawnFallback: true,
              useWorkflowHandoff: true,
              autoModeActive:
                (params.autoIteratorResult.effectiveAutoMode ??
                  params.workflowPolicy.autoMode) !== "off",
            },
          });
          return {
            launched: false,
            reason: "session_pool_full",
            projectId: params.projectId,
            projectRoot: params.projectRoot,
            fingerprint: params.discussionAttempt.fingerprint,
            stage: params.discussionAttempt.stage,
            owner,
            sessionKey: null,
            runId: null,
            dispatchStrategy: null,
            error: `Researcher service session pool is at capacity for this channel (${researcherSessionLease.activeResearcherSessionsInChannel ?? 0} active).`,
            reusedServiceSession: false,
            activeResearcherSessionsInChannel:
              researcherSessionLease.activeResearcherSessionsInChannel,
          };
        }
      }
      const dispatchLaunch = await launchWorkflowDispatchTransition({
        runtimeSubagent: params.runtimeSubagent,
        workflowPolicy: params.workflowPolicy,
        source: "workflow_auto_mitigation",
        queueKey: launchKey,
        owner,
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        requesterSessionKey: requesterSessionKey ?? defaultResearcherRequesterSessionKey,
        requesterChannel: requesterBinding.messageChannel ?? undefined,
        preferredSessionKeys:
          owner === "researcher"
            ? [
                researcherSessionLease?.sessionKey ??
                  preferredResearcherSessionKeys?.[0] ??
                  defaultResearcherRequesterSessionKey,
              ]
            : preferredResearcherSessionKeys ?? [],
        family: "research",
        kind: "workflow_mitigation_dispatch",
        fromRole: "researcher",
        stage: params.autoIteratorResult.stageAfter ?? null,
        summary:
          params.discussionAttempt.summary ??
          "Resolve the current auto-mode risk before the next workflow advance.",
        command:
          params.autoIteratorResult.nextAction ??
          "Run research_workflow.auto_iterator_tick after the mitigation pass.",
        extraBody: buildAutoMitigationExtraBody({
          packetPath: params.discussionAttempt.packetPath,
          summary: params.discussionAttempt.summary,
          actionItems: params.discussionAttempt.actionItems,
          blockers: params.discussionAttempt.blockers,
        }),
        autoModeActive:
          (params.autoIteratorResult.effectiveAutoMode ??
            params.workflowPolicy.autoMode) !== "off",
        logger: params.logger,
      });
      if (!dispatchLaunch.launched) {
        return {
          launched: false,
          reason: "dispatch_failed",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          fingerprint: params.discussionAttempt.fingerprint,
          stage: params.discussionAttempt.stage,
          owner,
          sessionKey: dispatchLaunch.sessionKey,
          runId: dispatchLaunch.runId,
          dispatchStrategy: dispatchLaunch.strategy,
          error: dispatchLaunch.error,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel:
            researcherSessionLease?.activeResearcherSessionsInChannel ?? null,
        };
      }

      if (
        owner === "researcher" &&
        researcherSessionLease?.channelKey &&
        dispatchLaunch.runId &&
        dispatchLaunch.sessionKey
      ) {
        await recordBackgroundWorkflowRun({
          ownerAgent: "researcher",
          channelKey: researcherSessionLease.channelKey,
          requesterSessionKey: defaultResearcherRequesterSessionKey,
          backgroundSessionKey: dispatchLaunch.sessionKey,
          runId: dispatchLaunch.runId,
          queueKey: launchKey,
          kind: "workflow_mitigation_dispatch",
          family: "research",
          projectId: params.projectId ?? undefined,
          projectRoot: params.projectRoot,
          projectsRoot: params.workflowPolicy.projectsRoot,
        });
      }

      params.launchedMitigationKeys.set(params.projectRoot, {
        key: launchKey,
        launchedAt: Date.now(),
      });
      await recordWorkflowContactEvent({
        projectRoot: params.projectRoot,
        fromAgent: "researcher",
        toAgent: owner,
        channel: "sessions_spawn",
      });
      return {
        launched: true,
        reason: "started",
        projectId: params.projectId,
        projectRoot: params.projectRoot,
        fingerprint: params.discussionAttempt.fingerprint,
        stage: params.discussionAttempt.stage,
        owner,
        sessionKey: dispatchLaunch.sessionKey,
        runId: dispatchLaunch.runId,
        dispatchStrategy: dispatchLaunch.strategy,
        error: null,
        reusedServiceSession: researcherSessionLease?.reusedIdleSession ?? false,
        activeResearcherSessionsInChannel:
          researcherSessionLease?.activeResearcherSessionsInChannel ?? null,
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
  const launchedStageKeys = new Map<string, { key: string; launchedAt: number }>();
  const launchedMitigationKeys = new Map<string, { key: string; launchedAt: number }>();

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
        const drainedQueue = await drainQueuedBackgroundWorkflowRuns({
          runtimeSubagent: plugin.api.runtime?.subagent,
          workflowPolicy,
          projectsRoot: workflowPolicy.projectsRoot,
        });
        const results = await runWorkflowCoordinatorPass({
          projectsRoot: workflowPolicy.projectsRoot,
          policy: workflowPolicy,
          cooldownSeconds: workflowPolicy.agentContactCooldownSeconds,
          queueMailbox: workflowPolicy.enableWorkflowMailbox,
          maxProjects: DEFAULT_WORKFLOW_COORDINATOR_MAX_PROJECTS,
          logger,
          deps,
        });
        await Promise.all(
          results.map((entry) =>
            recoverWorkflowRuntimeState({
              projectRoot: entry.projectRoot,
              projectId: entry.projectId,
              staleSessionAgeMs: 15 * 60 * 1000,
              sendBroadcast: async (broadcastEntry) => {
                const result = await maybeBroadcastWorkflowStatusUpdate({
                  runtimeSubagent: plugin.api.runtime?.subagent,
                  sessionKey: broadcastEntry.sessionKey,
                  projectId: broadcastEntry.projectId,
                  projectRoot: broadcastEntry.projectRoot,
                  status: broadcastEntry.status,
                  stage: broadcastEntry.stage,
                  summary: broadcastEntry.summary,
                  idempotencyKeySuffix: broadcastEntry.broadcastId,
                });
                if (!result.broadcasted || !result.runId) {
                  throw new Error(
                    result.reasonSkipped ??
                      "Workflow runtime recovery broadcast could not be delivered."
                  );
                }
                return {
                  runId: result.runId,
                  sessionKey: result.sessionKey,
                };
              },
            })
          )
        );
        const autoCodeReviews = await Promise.all(
          results.map((entry) =>
            maybeAdvanceAutoCodeReviewForProject({
              runtimeSubagent: plugin.api.runtime?.subagent,
              workflowPolicy,
              projectRoot: entry.projectRoot,
              projectId: entry.projectId,
              autoIteratorResult: entry.result,
              logger,
              deps,
            })
          )
        );
        const codeReviewRefreshedResults = await Promise.all(
          results.map(async (entry, index) => {
            if (autoCodeReviews[index]?.approved !== true) {
              return entry;
            }
            const refreshed = await enqueueWorkflowTask({
              key: resolveWorkflowProjectQueueKey(entry.projectRoot),
              label: "workflow_post_code_review_reconcile",
              logger,
              task: () =>
                (deps.runWorkflowAutoIterator ?? runWorkflowAutoIterator)({
                  projectRoot: entry.projectRoot,
                  policy: workflowPolicy,
                  agentId: "researcher",
                  mode: "service-post-code-review",
                  queueMailbox: workflowPolicy.enableWorkflowMailbox,
                  cooldownSeconds: workflowPolicy.agentContactCooldownSeconds,
                }),
            });
            return {
              ...entry,
              result: refreshed,
            };
          })
        );
        const autoGateReviews = await Promise.all(
          codeReviewRefreshedResults.map((entry) =>
            maybeAdvanceAutoGateReviewForProject({
              runtimeSubagent: plugin.api.runtime?.subagent,
              workflowPolicy,
              projectRoot: entry.projectRoot,
              projectId: entry.projectId,
              autoIteratorResult: entry.result,
              logger,
              deps,
            })
          )
        );
        const refreshedResults = await Promise.all(
          codeReviewRefreshedResults.map(async (entry, index) => {
            if (autoGateReviews[index]?.approved !== true) {
              return entry;
            }
            const refreshed = await enqueueWorkflowTask({
              key: resolveWorkflowProjectQueueKey(entry.projectRoot),
              label: "workflow_post_gate_reconcile",
              logger,
              task: () =>
                (deps.runWorkflowAutoIterator ?? runWorkflowAutoIterator)({
                  projectRoot: entry.projectRoot,
                  policy: workflowPolicy,
                  agentId: "researcher",
                  mode: "service-post-gate",
                  queueMailbox: workflowPolicy.enableWorkflowMailbox,
                  cooldownSeconds: workflowPolicy.agentContactCooldownSeconds,
                }),
            });
            return {
              ...entry,
              result: refreshed,
            };
          })
        );
        const autoModeDiscussions = await Promise.all(
          refreshedResults.map((entry) =>
            maybeAdvanceAutoModeDiscussionForProject({
              runtimeSubagent: plugin.api.runtime?.subagent,
              workflowPolicy,
              projectRoot: entry.projectRoot,
              projectId: entry.projectId,
              autoIteratorResult: entry.result,
              logger,
              deps,
            })
          )
        );
        const discussionRefreshedResults = await Promise.all(
          refreshedResults.map(async (entry, index) => {
            if (autoModeDiscussions[index]?.resolved !== true) {
              return entry;
            }
            const refreshed = await enqueueWorkflowTask({
              key: resolveWorkflowProjectQueueKey(entry.projectRoot),
              label: "workflow_post_discussion_reconcile",
              logger,
              task: () =>
                (deps.runWorkflowAutoIterator ?? runWorkflowAutoIterator)({
                  projectRoot: entry.projectRoot,
                  policy: workflowPolicy,
                  agentId: "researcher",
                  mode: "service-post-discussion",
                  queueMailbox: workflowPolicy.enableWorkflowMailbox,
                  cooldownSeconds: workflowPolicy.agentContactCooldownSeconds,
                }),
            });
            return {
              ...entry,
              result: refreshed,
            };
          })
        );
        const autoMitigationAttempts = await Promise.all(
          discussionRefreshedResults.map((entry, index) =>
            maybeDispatchAutoModeMitigationForProject({
              runtimeSubagent: plugin.api.runtime?.subagent,
              workflowPolicy,
              projectRoot: entry.projectRoot,
              projectId: entry.projectId,
              autoIteratorResult: entry.result,
              discussionAttempt: autoModeDiscussions[index],
              launchedMitigationKeys,
              logger,
              deps,
            })
          )
        );
        const autoMitigationDispatches = autoMitigationAttempts.filter((entry) => entry.launched);
        const autoStageAttempts = await Promise.all(
          discussionRefreshedResults.map((entry) =>
            maybeLaunchAutoStageForProject({
              runtimeSubagent: plugin.api.runtime?.subagent,
              workflowPolicy,
              projectRoot: entry.projectRoot,
              projectId: entry.projectId,
              autoIteratorResult: entry.result,
              launchedStageKeys,
              logger,
              deps,
            })
          )
        );
        const autoStageLaunches = autoStageAttempts.filter((entry) => entry.launched);
        const idleResearchAttempts = await Promise.all(
          discussionRefreshedResults.map((entry) =>
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
        );
        const idleResearchLaunches = idleResearchAttempts.filter((entry) => entry.launched);
        await Promise.all(
          discussionRefreshedResults.map(async (entry, index) => {
            const statusUpdate = deriveWorkflowCoordinatorStatusUpdate({
              projectId: entry.projectId,
              projectRoot: entry.projectRoot,
              stageAfter: entry.result.stageAfter ?? null,
              timedDefaultTriggered: entry.result.timedDefaultTriggered === true,
              timedDefaultSummary: entry.result.gateReason,
              autoCodeReview: autoCodeReviews[index],
              autoGateReview: autoGateReviews[index],
              autoModeDiscussion: autoModeDiscussions[index],
              autoMitigationDispatch: autoMitigationAttempts[index],
              autoStageLaunch: autoStageAttempts[index],
              idleResearchLaunch: idleResearchAttempts[index],
            });
            if (!statusUpdate) {
              return null;
            }
            const requesterSessionKey = resolveWorkflowRequesterSessionKey({
              projectRoot: entry.projectRoot,
              workflowPolicy,
              deps: {
                runWorkflowAutoIterator,
                listWorkflowCoordinatorProjects,
                getIdleResearchStateSummary,
                listChannelProjectBindingsForWorkflow,
                ...deps,
              },
            });
            return maybeBroadcastWorkflowStatusUpdate({
              runtimeSubagent: plugin.api.runtime?.subagent,
              sessionKey: requesterSessionKey,
              projectId: entry.projectId,
              projectRoot: entry.projectRoot,
              status: statusUpdate.status,
              stage: statusUpdate.stage,
              summary: statusUpdate.summary,
              idempotencyKeySuffix: statusUpdate.dedupeKey,
            });
          })
        );
        logger.debug?.("Workflow coordinator pass completed.", {
          trigger,
          queuedBackgroundRunsStarted: drainedQueue.started.length,
          queuedBackgroundRunsRemaining: drainedQueue.remaining.length,
          projectCount: discussionRefreshedResults.length,
          results: summarizeCoordinatorPass(discussionRefreshedResults),
          autoCodeReviews,
          autoGateReviews,
          autoModeDiscussions,
          autoMitigationDispatches,
          autoStageLaunches,
          idleResearchLaunches,
        });
        if (autoMitigationDispatches.length > 0) {
          logger.info?.("Workflow coordinator launched mitigation passes.", {
            trigger,
            launches: autoMitigationDispatches.map((entry) => ({
              projectId: entry.projectId,
              stage: entry.stage,
              owner: entry.owner,
              sessionKey: entry.sessionKey,
              runId: entry.runId,
              strategy: entry.dispatchStrategy,
            })),
          });
        }
        if (autoStageLaunches.length > 0) {
          logger.info?.("Workflow coordinator launched stage owners.", {
            trigger,
            launches: autoStageLaunches.map((entry) => ({
              projectId: entry.projectId,
              stage: entry.stage,
              owner: entry.owner,
              sessionKey: entry.sessionKey,
              runId: entry.runId,
              strategy: entry.dispatchStrategy,
            })),
          });
        }
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
