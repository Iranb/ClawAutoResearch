import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type {
  OpenClawPluginApi,
  OpenClawPluginCommandDefinition,
  PluginCommandContext,
} from "../runtime-api.js";
import type {
  ConversationRef,
  SessionBindingRecord,
} from "openclaw/plugin-sdk/conversation-runtime";
import {
  buildWorkflowSnapshot,
  getWorkflowGuardPolicy,
  inferTargetRoleFromToolParams,
} from "./workflow-guard";
import {
  buildResearchPipelineBackgroundCommand,
  buildResearchQueueBackgroundCommand,
  buildResumePipelineBackgroundCommand,
  startBackgroundWorkflowRun,
  type BackgroundRunRequest,
} from "./workflow-fast-paths";
import { enqueueWorkflowTask, resolveWorkflowQueueKey } from "./workflow-coordination";

type WorkflowBackgroundCommandKind =
  | "research_pipeline"
  | "research_queue"
  | "resume_pipeline";

type WorkflowCommandKind = WorkflowBackgroundCommandKind | "workflow_status";

type WorkflowCommandDependencies = {
  resolveConversationBindingRecord: (
    conversation: ConversationRef
  ) => SessionBindingRecord | null;
  buildWorkflowSnapshot: typeof buildWorkflowSnapshot;
  startBackgroundWorkflowRun: typeof startBackgroundWorkflowRun;
};

type WorkflowCommandApi = Pick<
  OpenClawPluginApi,
  "config" | "pluginConfig" | "runtime" | "logger" | "registerCommand"
>;

type RoutePeer = {
  kind: "direct" | "group" | "channel";
  id: string;
};

type ResolvedWorkflowCommandTarget = {
  sessionKey: string | null;
  agentId: string | null;
  workspaceDir: string | null;
  bindingConversation: ConversationRef | null;
};

type WorkflowSnapshot = Awaited<ReturnType<typeof buildWorkflowSnapshot>>;

type ExistingWorkflowProjectSelection = {
  projectId: string;
  projectRoot: string;
};

const DEFAULT_DEPS: WorkflowCommandDependencies = {
  resolveConversationBindingRecord: defaultResolveConversationBindingRecord,
  buildWorkflowSnapshot,
  startBackgroundWorkflowRun,
};

const COMMAND_LABELS: Record<WorkflowCommandKind, string> = {
  research_pipeline: "/research-pipeline",
  research_queue: "/research-queue",
  resume_pipeline: "/resume-pipeline",
  workflow_status: "/workflow-status",
};

let cachedConversationRuntime:
  | {
      resolveConversationBindingRecord?: WorkflowCommandDependencies["resolveConversationBindingRecord"];
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
): ReturnType<WorkflowCommandDependencies["resolveConversationBindingRecord"]> {
  return getConversationRuntime()?.resolveConversationBindingRecord?.(conversation) ?? null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolvePluginConfig(
  api: Pick<WorkflowCommandApi, "config" | "pluginConfig">
): Record<string, unknown> | undefined {
  if (api.config && api.pluginConfig) {
    return {
      ...api.config,
      ...api.pluginConfig,
    };
  }
  return api.pluginConfig ?? api.config;
}

function stripDiscordPrefix(raw: string): string {
  return raw.startsWith("discord:") ? raw.slice("discord:".length) : raw;
}

function parseDiscordPeer(raw: string): RoutePeer | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("slash:")) {
    return null;
  }
  const normalized = stripDiscordPrefix(trimmed);
  const mentionMatch = /^<@!?(\d+)>$/.exec(normalized);
  if (mentionMatch?.[1]) {
    return { kind: "direct", id: mentionMatch[1] };
  }
  if (normalized.startsWith("user:")) {
    return { kind: "direct", id: normalized.slice("user:".length).trim() };
  }
  if (normalized.startsWith("channel:")) {
    return { kind: "channel", id: normalized.slice("channel:".length).trim() };
  }
  if (/^\d+$/.test(normalized)) {
    return { kind: "channel", id: normalized };
  }
  return { kind: "channel", id: normalized };
}

function stripTelegramInternalPrefixes(raw: string): string {
  let trimmed = raw.trim();
  let strippedTelegramPrefix = false;
  while (true) {
    const next = (() => {
      if (/^(telegram|tg):/i.test(trimmed)) {
        strippedTelegramPrefix = true;
        return trimmed.replace(/^(telegram|tg):/i, "").trim();
      }
      if (strippedTelegramPrefix && /^group:/i.test(trimmed)) {
        return trimmed.replace(/^group:/i, "").trim();
      }
      return trimmed;
    })();
    if (next === trimmed) {
      return trimmed;
    }
    trimmed = next;
  }
}

function parseTelegramTarget(raw: string): {
  chatId: string;
  threadId?: string | number;
  kind: RoutePeer["kind"];
} | null {
  const normalized = stripTelegramInternalPrefixes(raw);
  if (!normalized) {
    return null;
  }
  const topicMatch = /^(.+?):topic:(\d+)$/.exec(normalized);
  if (topicMatch?.[1] && topicMatch[2]) {
    return {
      chatId: topicMatch[1],
      threadId: Number.parseInt(topicMatch[2], 10),
      kind: topicMatch[1].startsWith("-") ? "group" : "direct",
    };
  }
  const colonMatch = /^(.+):(\d+)$/.exec(normalized);
  if (colonMatch?.[1] && colonMatch[2]) {
    return {
      chatId: colonMatch[1],
      threadId: Number.parseInt(colonMatch[2], 10),
      kind: colonMatch[1].startsWith("-") ? "group" : "direct",
    };
  }
  return {
    chatId: normalized,
    kind: normalized.startsWith("-") ? "group" : "direct",
  };
}

export function resolveBindingConversationFromCommandContext(
  ctx: Pick<
    PluginCommandContext,
    "channel" | "from" | "to" | "accountId" | "messageThreadId"
  >
): ConversationRef | null {
  const accountId = readString(ctx.accountId) ?? "default";

  if (ctx.channel === "telegram") {
    const rawTarget = readString(ctx.to) ?? readString(ctx.from);
    if (!rawTarget) {
      return null;
    }
    const parsed = parseTelegramTarget(rawTarget);
    if (!parsed) {
      return null;
    }
    return {
      channel: "telegram",
      accountId,
      conversationId: parsed.chatId,
      ...(ctx.messageThreadId != null
        ? { threadId: ctx.messageThreadId }
        : parsed.threadId != null
          ? { threadId: parsed.threadId }
          : {}),
    };
  }

  if (ctx.channel === "discord") {
    const candidates = [readString(ctx.from), readString(ctx.to)].filter(
      (value): value is string => Boolean(value)
    );
    for (const candidate of candidates) {
      const parsed = parseDiscordPeer(candidate);
      if (!parsed) {
        continue;
      }
      return {
        channel: "discord",
        accountId,
        conversationId: `${parsed.kind === "direct" ? "user" : "channel"}:${parsed.id}`,
      };
    }
  }

  return null;
}

function resolveRoutePeerFromCommandContext(
  ctx: Pick<PluginCommandContext, "channel" | "from" | "to">
): RoutePeer | null {
  if (ctx.channel === "telegram") {
    const rawTarget = readString(ctx.to) ?? readString(ctx.from);
    const parsed = rawTarget ? parseTelegramTarget(rawTarget) : null;
    if (!parsed) {
      return null;
    }
    return {
      kind: parsed.kind,
      id: parsed.chatId,
    };
  }

  if (ctx.channel === "discord") {
    const candidates = [readString(ctx.from), readString(ctx.to)].filter(
      (value): value is string => Boolean(value)
    );
    for (const candidate of candidates) {
      const parsed = parseDiscordPeer(candidate);
      if (parsed) {
        return parsed;
      }
    }
  }

  return null;
}

function extractAgentIdFromSessionKey(sessionKey: string | null | undefined): string | null {
  const trimmed = readString(sessionKey);
  if (!trimmed) {
    return null;
  }
  const match = /^agent:([^:]+):/i.exec(trimmed);
  return match?.[1] ? match[1].trim() : null;
}

function extractQuotedSegment(value: string | undefined): string | undefined {
  const trimmed = readString(value);
  if (!trimmed) {
    return undefined;
  }
  const doubleQuoted = /^"([^"]+)"/.exec(trimmed);
  if (doubleQuoted?.[1]) {
    return doubleQuoted[1].trim();
  }
  const singleQuoted = /^'([^']+)'/.exec(trimmed);
  if (singleQuoted?.[1]) {
    return singleQuoted[1].trim();
  }
  return trimmed.split(/\s+--\s+/u, 1)[0]?.trim() || undefined;
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

function formatWorkflowStatusText(params: {
  snapshot: WorkflowSnapshot;
  commandLabel: string;
  targetSessionKey: string;
}) {
  const { snapshot } = params;
  const lines = [
    "Workflow Status",
    `Session: ${params.targetSessionKey}`,
    `Role: ${snapshot.role ?? "unknown"}`,
    `Project: ${snapshot.projectId ?? "unset"} (${snapshot.projectResolutionSource})`,
    `Stage: ${snapshot.currentStage ?? "unknown"} / ${snapshot.currentMicroStage ?? "unknown"}`,
    `Owner: ${snapshot.ownerAgent ?? "unset"}${snapshot.recommendedOwner ? `, expected=${snapshot.recommendedOwner}` : ""}`,
    `Next action: ${snapshot.nextAction ?? "none"}`,
    `Resume action: ${snapshot.resumeAction ?? params.commandLabel}`,
    `Blocking reason: ${snapshot.blockingReason ?? "none"}`,
    `Mailbox: ${snapshot.unreadMailbox.length} unread`,
    `Idle research: enabled=${snapshot.idleResearchEnabled ? "true" : "false"}, due=${snapshot.idleResearchDue ? "true" : "false"}, topic=${snapshot.idleResearchTopic ?? "unset"}`,
    `Graph refresh: ${snapshot.graphRefreshRequired ? `required (${snapshot.graphRefreshReason ?? "pending"})` : "not required"}`,
    `Innovation reflection: status=${snapshot.innovationReflectionStatus ?? "unknown"}, due=${snapshot.innovationReflectionDue ? "true" : "false"}`,
    `Experiment sync: ${snapshot.experimentSyncRequired ? `required (${snapshot.experimentPapernexusSyncStatus ?? "pending"})` : "not required"}`,
  ];
  if (!snapshot.projectRoot) {
    lines.push(
      "Project binding: no active project is currently bound to this conversation or workflow session."
    );
  }
  return lines.join("\n");
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
        kind === "research_pipeline" || kind === "research_queue";
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
      const explicitProject =
        kind === "resume_pipeline"
          ? await resolveExistingWorkflowProjectSelection({
              workflowPolicy,
              projectId: extractQuotedSegment(ctx.args),
            })
          : null;

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

          return deps.startBackgroundWorkflowRun({
            runtimeSubagent: api.runtime?.subagent,
            workflowPolicy,
            agentCtx: {
              agentId: target.agentId ?? currentSnapshot.role ?? undefined,
              workspaceDir: target.workspaceDir ?? undefined,
              sessionKey: targetSessionKey,
              messageChannel: ctx.channel,
            },
            snapshot: commandSnapshot,
            backgroundRun: buildBackgroundRunRequest(kind, ctx, {
              projectId: explicitProject?.projectId,
              projectRoot: explicitProject?.projectRoot,
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

function createWorkflowStatusCommandHandler(
  api: WorkflowCommandApi,
  deps: WorkflowCommandDependencies
) {
  return async (ctx: PluginCommandContext) => {
    const commandLabel = COMMAND_LABELS.workflow_status;
    try {
      const workflowPolicy = getWorkflowGuardPolicy(resolvePluginConfig(api));
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

      const currentSnapshot = await enqueueWorkflowTask({
        key: resolveWorkflowQueueKey({
          projectRoot: previewSnapshot.projectRoot,
          workspaceDir: target.workspaceDir,
          sessionKey: targetSessionKey,
          messageChannel: ctx.channel,
          channelKey: target.bindingConversation?.conversationId,
        }),
        label: "workflow_command:workflow_status",
        logger: api.logger,
        task: () =>
          deps.buildWorkflowSnapshot({
            policy: workflowPolicy,
            agentId: target.agentId ?? undefined,
            workspaceDir: target.workspaceDir ?? undefined,
            sessionKey: targetSessionKey,
            messageChannel: ctx.channel,
          }),
      });

      return {
        text: formatWorkflowStatusText({
          snapshot: currentSnapshot,
          commandLabel,
          targetSessionKey,
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
      name: "workflow-status",
      description:
        "Show the current workflow snapshot for this bound conversation or workflow session.",
      acceptsArgs: false,
      handler: createWorkflowStatusCommandHandler(api, resolvedDeps),
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
