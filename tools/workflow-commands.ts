import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type {
  OpenClawPluginCommandDefinition,
  PluginCommandContext,
} from "../runtime-api.js";
import type {
  ConversationRef,
} from "openclaw/plugin-sdk/conversation-runtime";
import {
  buildWorkflowSnapshot,
  ensureWorkflowProjectRoot,
  getResearchProgramStateSummary,
  getWorkflowGuardPolicy,
  inferTargetRoleFromToolParams,
  runWorkflowAutoIterator,
  setResearchProgramState,
} from "./workflow-guard.js";
import {
  buildGraphBuildBackgroundCommand,
  buildLiteratureReviewBackgroundCommand,
  buildResearchPipelineBackgroundCommand,
  buildResearchQueueBackgroundCommand,
  buildResumePipelineBackgroundCommand,
  buildZoteroSyncBackgroundCommand,
  buildSurveyReviewBackgroundCommand,
  drainQueuedBackgroundWorkflowRuns,
  startBackgroundWorkflowRun,
  type BackgroundRunRequest,
} from "./workflow-fast-paths";
import {
  readGateReviewStore,
} from "./workflow-auto-gate.js";
import {
  readCodeReviewStore,
} from "./workflow-code-review.js";
import {
  readAutoModeDiscussionStore,
} from "./workflow-auto-discussion.js";
import { enqueueWorkflowTask, resolveWorkflowQueueKey } from "./workflow-coordination.js";

// Import types and utilities from decoupled modules
import {
  type WorkflowBackgroundCommandKind,
  type WorkflowCommandKind,
  type WorkflowCommandDependencies,
  type WorkflowCommandApi,
  type ResolvedWorkflowCommandTarget,
  type WorkflowSnapshot,
  type ExistingWorkflowProjectSelection,
  COMMAND_LABELS,
} from "./workflow-commands/types.js";

import {
  readString,
  resolveBindingConversationFromCommandContext,
  resolveRoutePeerFromCommandContext,
  extractAgentIdFromSessionKey,
  extractQuotedSegment,
  formatWorkflowCommandArgument,
} from "./workflow-commands/parsers.js";

import {
  formatWorkflowStatusText,
  formatAutoModeSection,
  formatAutoDiscussionSection,
  formatGateReviewSection,
  formatCodeReviewSection,
  formatResearchProgramOnboardingGapLabels,
  compactStatusText,
  joinStatusList,
} from "./workflow-commands/formatters.js";
import { defaultResearchProgramZoteroProjectPath } from "./workflow-guard-project-state";
import { sanitizeProjectIdFragment } from "./workflow-guard-project/project-context";

// Re-export public APIs from submodules
export {
  resolveBindingConversationFromCommandContext,
} from "./workflow-commands/parsers.js";

export type {
  WorkflowBackgroundCommandKind,
  WorkflowCommandKind,
  WorkflowCommandDependencies,
  WorkflowCommandApi,
  ResolvedWorkflowCommandTarget,
  WorkflowSnapshot,
  ExistingWorkflowProjectSelection,
} from "./workflow-commands/types.js";

// Local type aliases for internal use (to avoid duplicate definitions)
type _WorkflowCommandDependencies = WorkflowCommandDependencies;
type _WorkflowCommandApi = WorkflowCommandApi;
type _WorkflowBackgroundCommandKind = WorkflowBackgroundCommandKind;
type _WorkflowCommandKind = WorkflowCommandKind;
type _ResolvedWorkflowCommandTarget = ResolvedWorkflowCommandTarget;
type _WorkflowSnapshot = WorkflowSnapshot;
type _ExistingWorkflowProjectSelection = ExistingWorkflowProjectSelection;

type WorkflowAutoIteratorResult = Awaited<ReturnType<typeof runWorkflowAutoIterator>>;
type WorkflowGateReviewStore = Awaited<ReturnType<typeof readGateReviewStore>>;
type WorkflowCodeReviewStore = Awaited<ReturnType<typeof readCodeReviewStore>>;
type WorkflowAutoDiscussionStore = Awaited<ReturnType<typeof readAutoModeDiscussionStore>>;

const DEFAULT_DEPS: _WorkflowCommandDependencies = {
  resolveConversationBindingRecord: defaultResolveConversationBindingRecord,
  buildWorkflowSnapshot,
  runWorkflowAutoIterator,
  startBackgroundWorkflowRun,
};

let cachedConversationRuntime:
  | {
      resolveConversationBindingRecord?: _WorkflowCommandDependencies["resolveConversationBindingRecord"];
    }
  | null
  | undefined;

function getConversationRuntime() {
  if (cachedConversationRuntime !== undefined) {
    return cachedConversationRuntime;
  }
  try {
    const require = createRequire(import.meta.url);
    cachedConversationRuntime = require("openclaw/plugin-sdk/conversation-runtime");
  } catch {
    cachedConversationRuntime = null;
  }
  return cachedConversationRuntime;
}

function defaultResolveConversationBindingRecord(
  conversation: ConversationRef
): ReturnType<_WorkflowCommandDependencies["resolveConversationBindingRecord"]> {
  return getConversationRuntime()?.resolveConversationBindingRecord?.(conversation) ?? null;
}

function resolvePluginConfig(
  api: Pick<_WorkflowCommandApi, "config" | "pluginConfig">
): Record<string, unknown> | undefined {
  if (api.config && api.pluginConfig) {
    return {
      ...api.config,
      ...api.pluginConfig,
    };
  }
  return api.pluginConfig ?? api.config;
}

function injectGraphBuildRepairFlags(
  commandText: string | undefined,
  snapshot: WorkflowSnapshot
): string {
  const base = readString(commandText) ?? "/graph-build";
  if (!snapshot.paperIngestionRepairRequired) {
    return buildGraphBuildBackgroundCommand(base);
  }
  let next = base;
  if (!/--repair-import\b/i.test(next)) {
    next = `${next.trim()} --repair-import true`;
  }
  if (
    snapshot.paperIngestionRepairTargetCorpus &&
    !/--shared-corpus\b/i.test(next)
  ) {
    next =
      `${next.trim()} --shared-corpus ` +
      formatWorkflowCommandArgument(snapshot.paperIngestionRepairTargetCorpus);
  }
  return buildGraphBuildBackgroundCommand(next);
}

function buildBackgroundRunRequest(
  kind: WorkflowBackgroundCommandKind,
  ctx: Pick<PluginCommandContext, "args" | "commandBody">,
  overrides: Partial<BackgroundRunRequest> = {}
): BackgroundRunRequest {
  if (kind === "research_pipeline") {
    return {
      kind,
      commandText: buildResearchPipelineBackgroundCommand(ctx.commandBody),
      topic: extractQuotedSegment(ctx.args),
      summary: "Background research pipeline started.",
      ...overrides,
    };
  }
  if (kind === "research_queue") {
    return {
      kind,
      commandText: buildResearchQueueBackgroundCommand(ctx.commandBody),
      summary: "Background research queue task started.",
      ...overrides,
    };
  }
  if (kind === "graph_build") {
    return {
      kind,
      commandText: buildGraphBuildBackgroundCommand(ctx.commandBody),
      topic: extractQuotedSegment(ctx.args),
      summary:
        overrides.summary ??
        `Background graph build started for ${
          readString(overrides.projectId) ?? "the current project"
        }.`,
      ...overrides,
    };
  }
  if (kind === "zotero_sync") {
    return {
      kind,
      commandText: buildZoteroSyncBackgroundCommand(ctx.commandBody),
      topic: extractQuotedSegment(ctx.args),
      summary:
        overrides.summary ??
        `Background Zotero sync started for ${
          readString(overrides.projectId) ?? "the current project"
        }.`,
      ...overrides,
    };
  }
  if (kind === "literature_review") {
    return {
      kind,
      commandText: buildLiteratureReviewBackgroundCommand(ctx.commandBody),
      topic: extractQuotedSegment(ctx.args),
      summary:
        overrides.summary ??
        `Background literature review started for ${
          readString(overrides.projectId) ?? extractQuotedSegment(ctx.args) ?? "the current project"
        }.`,
      ...overrides,
    };
  }
  if (kind === "survey_review") {
    return {
      kind,
      commandText: buildSurveyReviewBackgroundCommand(ctx.commandBody),
      topic: extractQuotedSegment(ctx.args),
      summary:
        overrides.summary ??
        `Background survey pipeline started for ${
          readString(overrides.title) ??
          extractQuotedSegment(ctx.args) ??
          "the current topic"
        }.`,
      ...overrides,
    };
  }
  return {
    kind,
    commandText: buildResumePipelineBackgroundCommand(ctx.commandBody),
    summary:
      overrides.summary ??
      `Background resume pipeline started for ${
        readString(overrides.projectId) ?? "the current project"
      }.`,
    ...overrides,
  };
}

type ShowCommandsEntry = {
  label: string;
  intro: string;
};

const SHOW_COMMANDS_ENTRIES: readonly ShowCommandsEntry[] = [
  {
    label: COMMAND_LABELS.project_init,
    intro: "初始化或刷新当前项目的 research program onboarding。",
  },
  {
    label: COMMAND_LABELS.research_pipeline,
    intro: "启动或继续普通论文主研究流程。",
  },
  {
    label: COMMAND_LABELS.survey_review,
    intro: '围绕一个主题启动综述主线，例如 `/survey-pipeline "topic"`。',
  },
  {
    label: COMMAND_LABELS.graph_build,
    intro: "刷新 graph readiness，并补齐后续 brainstorm 所需输入。",
  },
  {
    label: COMMAND_LABELS.literature_review,
    intro: "对当前项目发起一次 bounded literature review 后台调研。",
  },
  {
    label: COMMAND_LABELS.zotero_sync,
    intro: "把当前项目论文集合 best-effort 同步到 Zotero。",
  },
  {
    label: COMMAND_LABELS.research_queue,
    intro: "批量排队推进多个项目，而不是只盯住当前会话。",
  },
  {
    label: COMMAND_LABELS.resume_pipeline,
    intro: "从 durable workflow state 恢复当前项目，或显式恢复某个 project id。",
  },
  {
    label: COMMAND_LABELS.workflow_status,
    intro: "查看当前阶段、owner、blockers、auto mode 与 runtime health。",
  },
  {
    label: COMMAND_LABELS.show_commands,
    intro: "列出当前可用的 slash commands 和用途说明。",
  },
];

function formatShowCommandsText(): string {
  const lines = [
    "Available slash commands:",
    "",
    ...SHOW_COMMANDS_ENTRIES.map((entry) => `- ${entry.label}: ${entry.intro}`),
    "",
    "Tip: 普通论文从 /project-init 或 /research-pipeline 开始；综述项目直接用 /survey-pipeline \"topic\"。",
  ];
  return lines.join("\n");
}

async function pathExists(filePath: string): Promise<boolean> {
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

async function resolveExistingWorkflowProjectSelection(params: {
  workflowPolicy: ReturnType<typeof getWorkflowGuardPolicy>;
  projectId: string | undefined;
}): Promise<ExistingWorkflowProjectSelection | null> {
  const projectId = readString(params.projectId);
  if (!projectId) {
    return null;
  }
  const projectsRoot = readString(params.workflowPolicy.projectsRoot);
  if (!projectsRoot) {
    throw new Error(
      "projectsRoot is not configured for openclaw-research, so /resume-pipeline cannot resolve an explicit project id."
    );
  }
  const projectRoot = path.resolve(projectsRoot, projectId);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  if (!(await pathExists(manifestPath))) {
    throw new Error(
      `No existing workflow project found for "${projectId}" under ${projectsRoot}.`
    );
  }
  return {
    projectId,
    projectRoot,
  };
}

export function resolveWorkflowCommandSessionTarget(
  api: Pick<WorkflowCommandApi, "runtime">,
  ctx: Pick<
    PluginCommandContext,
    "channel" | "from" | "to" | "accountId" | "messageThreadId" | "config"
  >,
  resolveBindingRecord: WorkflowCommandDependencies["resolveConversationBindingRecord"] = DEFAULT_DEPS.resolveConversationBindingRecord
): ResolvedWorkflowCommandTarget {
  const bindingConversation = resolveBindingConversationFromCommandContext(ctx);
  const bindingRecord = bindingConversation
    ? resolveBindingRecord(bindingConversation)
    : null;
  const routePeer = resolveRoutePeerFromCommandContext(ctx);
  const route = routePeer
    ? api.runtime?.channel?.routing?.resolveAgentRoute?.({
        cfg: ctx.config,
        channel: ctx.channel,
        accountId: ctx.accountId,
        peer: routePeer,
      })
    : null;
  const sessionKey = readString(bindingRecord?.targetSessionKey) ?? readString(route?.sessionKey) ?? null;
  const agentId =
    extractAgentIdFromSessionKey(sessionKey) ?? readString(route?.agentId) ?? null;
  const workspaceDir =
    agentId && typeof api.runtime?.agent?.resolveAgentWorkspaceDir === "function"
      ? api.runtime.agent.resolveAgentWorkspaceDir(ctx.config, agentId)
      : null;
  return {
    sessionKey,
    agentId,
    workspaceDir: readString(workspaceDir) ?? null,
    bindingConversation,
  };
}

function createBackgroundWorkflowCommandHandler(
  api: WorkflowCommandApi,
  kind: WorkflowBackgroundCommandKind,
  deps: WorkflowCommandDependencies
) {
  return async (ctx: PluginCommandContext) => {
    const commandLabel = COMMAND_LABELS[kind];
    try {
      const workflowPolicy = getWorkflowGuardPolicy(resolvePluginConfig(api));
      await maybeReplayQueuedWorkflowRunsFromCommandRuntime(api, workflowPolicy);
      const target = resolveWorkflowCommandSessionTarget(
        api,
        ctx,
        deps.resolveConversationBindingRecord
      );
      const targetSessionKey = target.sessionKey;

      if (!targetSessionKey) {
        return {
          text:
            `❌ ${commandLabel} requires a resolved workflow session for this conversation. ` +
            "Run it from a Researcher-bound conversation or keep the prompt-path fallback enabled.",
        };
      }

      const targetRole = inferTargetRoleFromToolParams({
        agentId: target.agentId ?? undefined,
        sessionKey: targetSessionKey,
      });
      const requiresResearcherSession =
        kind === "research_pipeline" ||
        kind === "research_queue" ||
        kind === "literature_review" ||
        kind === "survey_review";
      if (requiresResearcherSession && targetRole !== "researcher") {
        return {
          text:
            `❌ ${commandLabel} can only start from a Researcher workflow session. ` +
            `Current target: ${targetRole ?? target.agentId ?? target.sessionKey}.`,
        };
      }
      if (!requiresResearcherSession && !targetRole) {
        return {
          text:
            `❌ ${commandLabel} requires a workflow-owned session for this conversation. ` +
            `Current target: ${target.agentId ?? target.sessionKey}.`,
        };
      }

      const snapshot = await deps.buildWorkflowSnapshot({
        policy: workflowPolicy,
        agentId: target.agentId ?? undefined,
        workspaceDir: target.workspaceDir ?? undefined,
        sessionKey: targetSessionKey,
        messageChannel: ctx.channel,
      });
      const requiresProjectBoundConversation =
        kind === "graph_build" || kind === "zotero_sync" || kind === "literature_review";
      if (requiresProjectBoundConversation && !snapshot.projectRoot) {
        return {
          text:
            `❌ ${commandLabel} requires a project-bound workflow conversation. ` +
            "Run it from a conversation already bound to a project or resume the project first.",
        };
      }
      const explicitProject =
        kind === "resume_pipeline"
          ? await resolveExistingWorkflowProjectSelection({
              workflowPolicy,
              projectId: extractQuotedSegment(ctx.args),
            })
          : null;
      const surveyTopic = kind === "survey_review" ? extractQuotedSegment(ctx.args) : null;
      const surveyProjectId =
        kind === "survey_review" && surveyTopic
          ? `survey-${sanitizeProjectIdFragment(surveyTopic)}`
          : undefined;

      if (kind === "resume_pipeline" && !explicitProject && !snapshot.projectRoot) {
        return {
          text:
            `❌ ${commandLabel} could not resolve a project to resume. ` +
            "Run it from a project-bound workflow conversation or pass an explicit project id.",
        };
      }

      const result = await enqueueWorkflowTask({
        key: resolveWorkflowQueueKey({
          projectRoot: explicitProject?.projectRoot ?? snapshot.projectRoot,
          workspaceDir: target.workspaceDir,
          sessionKey: targetSessionKey,
          messageChannel: ctx.channel,
          channelKey: target.bindingConversation?.conversationId,
        }),
        label: `workflow_command:${kind}`,
        logger: api.logger,
        task: async () => {
          const currentSnapshot = await deps.buildWorkflowSnapshot({
            policy: workflowPolicy,
            agentId: target.agentId ?? undefined,
            workspaceDir: target.workspaceDir ?? undefined,
            sessionKey: targetSessionKey,
            messageChannel: ctx.channel,
          });
          const commandSnapshot =
            explicitProject != null
              ? {
                  ...currentSnapshot,
                  projectRoot: explicitProject.projectRoot,
                  projectId: explicitProject.projectId,
                }
              : currentSnapshot;
          const graphBuildCommandText =
            kind === "graph_build"
              ? injectGraphBuildRepairFlags(ctx.commandBody, commandSnapshot)
              : undefined;
          const zoteroSyncCommandText =
            kind === "zotero_sync"
              ? buildZoteroSyncBackgroundCommand(ctx.commandBody)
              : undefined;

      const researcherBackgroundKind =
        kind === "graph_build" ||
        kind === "zotero_sync" ||
        kind === "literature_review";
      const resolvedBackgroundAgentId =
        researcherBackgroundKind
          ? "researcher"
          : target.agentId ?? currentSnapshot.role ?? undefined;
      const resolvedBackgroundWorkspaceDir =
        researcherBackgroundKind &&
        typeof api.runtime?.agent?.resolveAgentWorkspaceDir === "function"
          ? readString(api.runtime.agent.resolveAgentWorkspaceDir(ctx.config, "researcher")) ??
            target.workspaceDir ??
            undefined
          : target.workspaceDir ?? undefined;

          return deps.startBackgroundWorkflowRun({
            runtimeSubagent: api.runtime?.subagent,
            workflowPolicy,
            agentCtx: {
              agentId: resolvedBackgroundAgentId,
              workspaceDir: resolvedBackgroundWorkspaceDir,
              sessionKey: targetSessionKey,
              messageChannel: ctx.channel,
            },
            snapshot: commandSnapshot,
            backgroundRun: buildBackgroundRunRequest(kind, ctx, {
              ...(graphBuildCommandText ? { commandText: graphBuildCommandText } : {}),
              ...(zoteroSyncCommandText ? { commandText: zoteroSyncCommandText } : {}),
              projectId:
                explicitProject?.projectId ??
                (kind === "survey_review" ? surveyProjectId : undefined) ??
                (researcherBackgroundKind ? commandSnapshot.projectId ?? undefined : undefined),
              projectRoot:
                explicitProject?.projectRoot ??
                (researcherBackgroundKind ? commandSnapshot.projectRoot ?? undefined : undefined),
              title: kind === "survey_review" ? surveyTopic ?? undefined : undefined,
            }),
          });
        },
      });

      return {
        text: result.summary,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      api.logger?.warn?.("Failed to start workflow command background run.", {
        kind,
        channel: ctx.channel,
        error: message,
      });
      return {
        text: `❌ Failed to start the background workflow: ${message}`,
      };
    }
  };
}

function createProjectInitCommandHandler(
  api: WorkflowCommandApi,
  deps: WorkflowCommandDependencies
) {
  return async (ctx: PluginCommandContext) => {
    const commandLabel = COMMAND_LABELS.project_init;
    try {
      const workflowPolicy = getWorkflowGuardPolicy(resolvePluginConfig(api));
      const target = resolveWorkflowCommandSessionTarget(
        api,
        ctx,
        deps.resolveConversationBindingRecord
      );
      const targetRole = inferTargetRoleFromToolParams({
        agentId: target.agentId ?? undefined,
        sessionKey: target.sessionKey,
      });
      const topic = extractQuotedSegment(ctx.args);
      const snapshot = target.sessionKey && targetRole
        ? await deps.buildWorkflowSnapshot({
            policy: workflowPolicy,
            agentId: target.agentId ?? undefined,
            workspaceDir: target.workspaceDir ?? undefined,
            sessionKey: target.sessionKey,
            messageChannel: ctx.channel,
          })
        : null;
      const ensuredProject = await ensureWorkflowProjectRoot({
        policy: workflowPolicy,
        workspaceDir: target.workspaceDir ?? undefined,
        sessionKey: target.sessionKey ?? undefined,
        messageChannel: ctx.channel,
        channelKey: target.bindingConversation?.conversationId,
        projectRoot: snapshot?.projectRoot ?? null,
        projectId: snapshot?.projectId ?? null,
        title: topic ?? snapshot?.projectId ?? null,
        topic,
      });
      const currentSummary = await getResearchProgramStateSummary({
        projectRoot: ensuredProject.projectRoot,
      });
      const seededGoal =
        topic ?? currentSummary.state.goal ?? ensuredProject.title;
      const update = await setResearchProgramState({
        projectRoot: ensuredProject.projectRoot,
        researchProgram: {
          status:
            currentSummary.state.status === "missing"
              ? "draft"
              : currentSummary.state.status,
          goal: currentSummary.state.goal ?? seededGoal,
          problem_statement:
            currentSummary.state.problemStatement ?? seededGoal,
          zotero_project_path:
            currentSummary.state.zoteroProjectPath ??
            defaultResearchProgramZoteroProjectPath(
              ensuredProject.projectId,
              workflowPolicy.zoteroProjectRoot
            ),
          pending_reason:
            currentSummary.state.pendingReason ??
            "Complete the onboarding contract before graph grounding.",
        },
      });
      const missingLabels = formatResearchProgramOnboardingGapLabels(
        update.onboardingGaps
      );
      return {
        text:
          `Project init saved for ${ensuredProject.projectId}. ` +
          `Research program onboarding=${update.onboardingStatus}. ` +
          `Zotero path=${
            update.state.zoteroProjectPath ??
            defaultResearchProgramZoteroProjectPath(
              ensuredProject.projectId,
              workflowPolicy.zoteroProjectRoot
            )
          }. ` +
          (missingLabels ? `missing=${missingLabels}` : "missing=none"),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      api.logger?.warn?.("Failed to initialize workflow project onboarding.", {
        channel: ctx.channel,
        error: message,
      });
      return {
        text: `❌ Failed to initialize the workflow project: ${message}`,
      };
    }
  };
}

function createWorkflowStatusCommandHandler(
  api: WorkflowCommandApi,
  deps: WorkflowCommandDependencies
) {
  return async (ctx: PluginCommandContext) => {
    const commandLabel = COMMAND_LABELS.workflow_status;
    try {
      const workflowPolicy = getWorkflowGuardPolicy(resolvePluginConfig(api));
      await maybeReplayQueuedWorkflowRunsFromCommandRuntime(api, workflowPolicy);
      const target = resolveWorkflowCommandSessionTarget(
        api,
        ctx,
        deps.resolveConversationBindingRecord
      );
      const targetSessionKey = target.sessionKey;

      if (!targetSessionKey) {
        return {
          text:
            `❌ ${commandLabel} requires a resolved workflow session for this conversation. ` +
            "Run it from a workflow-bound conversation.",
        };
      }

      const previewSnapshot = await deps.buildWorkflowSnapshot({
        policy: workflowPolicy,
        agentId: target.agentId ?? undefined,
        workspaceDir: target.workspaceDir ?? undefined,
        sessionKey: targetSessionKey,
        messageChannel: ctx.channel,
      });

      const statusState = await enqueueWorkflowTask({
        key: resolveWorkflowQueueKey({
          projectRoot: previewSnapshot.projectRoot,
          workspaceDir: target.workspaceDir,
          sessionKey: targetSessionKey,
          messageChannel: ctx.channel,
          channelKey: target.bindingConversation?.conversationId,
        }),
        label: "workflow_command:workflow_status",
        logger: api.logger,
        task: async () => {
          const snapshot = await deps.buildWorkflowSnapshot({
            policy: workflowPolicy,
            agentId: target.agentId ?? undefined,
            workspaceDir: target.workspaceDir ?? undefined,
            sessionKey: targetSessionKey,
            messageChannel: ctx.channel,
          });
          const resolvedProjectRoot = snapshot.projectRoot ?? null;
          const autoIteratorResult = resolvedProjectRoot
            ? await deps.runWorkflowAutoIterator({
                projectRoot: resolvedProjectRoot,
                policy: workflowPolicy,
                agentId: target.agentId ?? snapshot.role ?? undefined,
                mode: "command-status",
                queueMailbox: false,
              })
            : null;
          const [discussionStore, gateReviewStore, codeReviewStore] = resolvedProjectRoot
            ? await Promise.all([
                readAutoModeDiscussionStore(resolvedProjectRoot),
                readGateReviewStore(resolvedProjectRoot),
                readCodeReviewStore(resolvedProjectRoot),
              ])
            : [null, null, null];
          return {
            snapshot,
            autoIteratorResult,
            discussionStore,
            gateReviewStore,
            codeReviewStore,
          };
        },
      });

      return {
        text: formatWorkflowStatusText({
          snapshot: statusState.snapshot,
          commandLabel,
          targetSessionKey,
          autoIteratorResult: statusState.autoIteratorResult,
          discussionStore: statusState.discussionStore,
          gateReviewStore: statusState.gateReviewStore,
          codeReviewStore: statusState.codeReviewStore,
        }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      api.logger?.warn?.("Failed to resolve workflow status command.", {
        channel: ctx.channel,
        error: message,
      });
      return {
        text: `❌ Failed to read workflow status: ${message}`,
      };
    }
  };
}

function createShowCommandsCommandHandler() {
  return async () => ({
    text: formatShowCommandsText(),
  });
}

async function maybeReplayQueuedWorkflowRunsFromCommandRuntime(
  api: WorkflowCommandApi,
  workflowPolicy: ReturnType<typeof getWorkflowGuardPolicy>
): Promise<void> {
  if (!workflowPolicy.projectsRoot) {
    return;
  }
  try {
    await drainQueuedBackgroundWorkflowRuns({
      runtimeSubagent: api.runtime?.subagent,
      workflowPolicy,
      projectsRoot: workflowPolicy.projectsRoot,
      ignoreRetryBackoff: true,
    });
  } catch (error) {
    api.logger?.debug?.("Failed opportunistic workflow queue replay from command runtime.", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function createResearchWorkflowCommands(
  api: WorkflowCommandApi,
  deps: Partial<WorkflowCommandDependencies> = {}
): OpenClawPluginCommandDefinition[] {
  const resolvedDeps: WorkflowCommandDependencies = {
    ...DEFAULT_DEPS,
    ...deps,
  };

  return [
    {
      name: "project-init",
      description:
        "Initialize or refresh the guided workflow onboarding contract for the current project.",
      acceptsArgs: true,
      handler: createProjectInitCommandHandler(api, resolvedDeps),
    },
    {
      name: "research-pipeline",
      description:
        "Start the research pipeline as a background continuation for the current Researcher session.",
      acceptsArgs: true,
      handler: createBackgroundWorkflowCommandHandler(
        api,
        "research_pipeline",
        resolvedDeps
      ),
    },
    {
      name: "research-queue",
      description:
        "Run the research queue flow as a background continuation for the current Researcher session.",
      acceptsArgs: true,
      handler: createBackgroundWorkflowCommandHandler(
        api,
        "research_queue",
        resolvedDeps
      ),
    },
    {
      name: "resume-pipeline",
      description:
        "Resume and reconcile the current workflow project, optionally targeting an explicit existing project id.",
      acceptsArgs: true,
      handler: createBackgroundWorkflowCommandHandler(
        api,
        "resume_pipeline",
        resolvedDeps
      ),
    },
    {
      name: "graph-build",
      description:
        "Run the bounded graph-readiness and brainstorm-refresh pass for the current project in a background Researcher continuation.",
      acceptsArgs: true,
      handler: createBackgroundWorkflowCommandHandler(
        api,
        "graph_build",
        resolvedDeps
      ),
    },
    {
      name: "zotero-sync",
      description:
        "Reconcile the current project's Zotero collections in a background Researcher continuation without blocking the foreground workflow session.",
      acceptsArgs: true,
      handler: createBackgroundWorkflowCommandHandler(
        api,
        "zotero_sync",
        resolvedDeps
      ),
    },
    {
      name: "literature-review",
      description:
        "Run the current project's durable literature-review packet in a background Researcher continuation without blocking the foreground session.",
      acceptsArgs: true,
      handler: createBackgroundWorkflowCommandHandler(
        api,
        "literature_review",
        resolvedDeps
      ),
    },
    {
      name: "survey-pipeline",
      description:
        "Start a survey-only literature review workflow for a topic in a background Researcher continuation.",
      acceptsArgs: true,
      handler: createBackgroundWorkflowCommandHandler(
        api,
        "survey_review",
        resolvedDeps
      ),
    },
    {
      name: "workflow-status",
      description:
        "Show the current workflow snapshot for this bound conversation or workflow session.",
      acceptsArgs: false,
      handler: createWorkflowStatusCommandHandler(api, resolvedDeps),
    },
    {
      name: "show-commands",
      description:
        "List the available workflow slash commands and when to use them.",
      acceptsArgs: false,
      handler: createShowCommandsCommandHandler(),
    },
  ];
}

export function registerResearchWorkflowCommands(
  api: WorkflowCommandApi,
  deps: Partial<WorkflowCommandDependencies> = {}
): void {
  for (const command of createResearchWorkflowCommands(api, deps)) {
    api.registerCommand(command);
  }
}
