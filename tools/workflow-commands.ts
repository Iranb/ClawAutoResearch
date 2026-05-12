import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
  bindChannelProjectForWorkflow,
  getResearchProgramStateSummary,
  getWorkflowGuardPolicy,
  inferTargetRoleFromToolParams,
  runWorkflowAutoIterator,
  setGraphGuidedWritingState,
  setResearchProgramState,
  setWritingContractState,
  unbindChannelProjectForWorkflow,
} from "./workflow-guard.js";
import {
  deriveAgentSessionKeyForRole,
  type DispatchableWorkflowRole,
} from "./agent-task-dispatch";
import { runIdeaCatalystResearch30 } from "./research30/bridge";
import { runBroadPaperSearch } from "./research30/workflow-bridge";
import { runCitationCalibration } from "./research-writing/citation-calibration";
import { stagePapernexusRemoteSources } from "./papernexus-remote-stage";
import { reconcileAuthoringCloseout } from "./authoring-closeout-reconcile";
import { captureWorkflowDiagnosticBundle } from "./workflow-diagnostic-bundle";
import { buildHandoffDashboard } from "./workflow-handoff/dashboard.js";
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
  type BackgroundRunStartResult,
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
import { createWorkflowExecutionRuntimeFromApi } from "./workflow-execution-runtime.js";
import { shouldUseChannelProjectBindingForWorkflow } from "./workflow-message-channels.js";
import { recordWorkflowNotificationChannelForProject } from "./workflow-notification-channels.js";
import { syncProjectsStateEntry } from "./workflow-project-registry";

// Import types and utilities from decoupled modules
import {
  type WorkflowBackgroundCommandKind,
  type WorkflowCommandKind,
  type WorkflowCommandDependencies,
  type WorkflowCommandApi,
  type WorkflowCommandContext,
  type ResolvedWorkflowCommandTarget,
  type WorkflowSnapshot,
  type ExistingWorkflowProjectSelection,
  COMMAND_LABELS,
} from "./workflow-commands/types.js";

import {
  readString,
  resolveBindingConversationFromCommandContext,
  buildWorkflowConversationBindingKeyFromConversation,
  resolveRoutePeerFromCommandContext,
  extractAgentIdFromSessionKey,
  extractQuotedSegment,
  formatWorkflowCommandArgument,
} from "./workflow-commands/parsers.js";
import {
  readJsonIfExists,
  withAdvisoryLock,
  writeJsonAtomicEnsured,
  writeJsonEnsured,
} from "./workflow-guard-core/fs";

function createWorkflowCommandRuntime(params: {
  api: WorkflowCommandApi;
  workspaceDir?: string | null;
  agentId?: string | null;
  messageChannel?: string | null;
}) {
  return createWorkflowExecutionRuntimeFromApi({
    api: params.api,
    defaultWorkspaceDir: params.workspaceDir ?? undefined,
    defaultAgentId: params.agentId ?? undefined,
    defaultMessageChannel: params.messageChannel ?? undefined,
  });
}

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
import { buildWorkflowStatusPresentation } from "./workflow-commands/presentation.js";
import { defaultResearchProgramZoteroProjectPath } from "./workflow-guard-project-state";
import { sanitizeProjectIdFragment } from "./workflow-guard-project/project-context";

const nodeRequire = createRequire(import.meta.url);

// Re-export public APIs from submodules
export {
  resolveBindingConversationFromCommandContext,
} from "./workflow-commands/parsers.js";

export type {
  WorkflowBackgroundCommandKind,
  WorkflowCommandKind,
  WorkflowCommandDependencies,
  WorkflowCommandApi,
  WorkflowCommandContext,
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

const NATIVE_DISCORD_BACKGROUND_ACK_TIMEOUT_MS = 1500;

function deriveWorkflowRoleSessionKey(params: {
  sessionKey: string | null;
  role: DispatchableWorkflowRole;
}): string | null {
  return params.sessionKey
    ? deriveAgentSessionKeyForRole({
        requesterSessionKey: params.sessionKey,
        targetRole: params.role,
      })
    : null;
}

function resolveChannelProjectBindingPolicy<T extends { enableChannelProjectBindings?: boolean }>(
  policy: T,
  params: {
    messageChannel?: unknown;
    channelKey?: unknown;
    sessionKey?: unknown;
  }
): T {
  return shouldUseChannelProjectBindingForWorkflow(params)
    ? policy
    : {
        ...policy,
        enableChannelProjectBindings: false,
      };
}

function isNativeDiscordCommand(
  ctx: Pick<WorkflowCommandContext, "channel" | "commandSource">
): boolean {
  return ctx.channel === "discord" && readString(ctx.commandSource) === "native";
}

function deriveBindingChannelKeyFromSessionKey(params: {
  sessionKey?: string | null;
  accountId?: string | null;
}): string | null {
  const sessionKey = readString(params.sessionKey);
  if (!sessionKey?.startsWith("agent:")) {
    return null;
  }
  const parts = sessionKey.split(":");
  if (parts.length < 4) {
    return null;
  }
  const channel = readString(parts[2]);
  if (!channel || !["discord", "local", "telegram"].includes(channel)) {
    return null;
  }
  const rawConversation = parts.slice(3).join(":");
  const subagentMarker = rawConversation.indexOf(":subagent:");
  const conversationId = (subagentMarker > 0
    ? rawConversation.slice(0, subagentMarker)
    : rawConversation
  ).trim();
  if (
    !conversationId ||
    (channel === "discord" && conversationId.startsWith("slash:"))
  ) {
    return null;
  }
  return buildWorkflowConversationBindingKeyFromConversation({
    channel,
    accountId: readString(params.accountId) ?? "default",
    conversationId,
  });
}

async function withNativeDiscordBackgroundAckTimeout(params: {
  api: WorkflowCommandApi;
  ctx: Pick<WorkflowCommandContext, "channel" | "commandSource">;
  commandLabel: string;
  projectRoot: string | null | undefined;
  projectId: string | null | undefined;
  launch: Promise<BackgroundRunStartResult>;
}): Promise<BackgroundRunStartResult> {
  if (!isNativeDiscordCommand(params.ctx)) {
    return params.launch;
  }
  const timedOut = Symbol("native_discord_background_ack_timeout");
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const first = await Promise.race([
    params.launch,
    new Promise<typeof timedOut>((resolve) => {
      timeout = setTimeout(
        resolve,
        NATIVE_DISCORD_BACKGROUND_ACK_TIMEOUT_MS,
        timedOut
      );
    }),
  ]);
  if (timeout) {
    clearTimeout(timeout);
  }
  if (first !== timedOut) {
    return first;
  }
  params.api.logger?.info?.("Native Discord workflow command acknowledged before background launch completed.", {
    commandLabel: params.commandLabel,
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    timeoutMs: NATIVE_DISCORD_BACKGROUND_ACK_TIMEOUT_MS,
    nextAction: "background_launch_continues",
  });
  void params.launch.catch((error) => {
    params.api.logger?.warn?.("Native Discord workflow background launch failed after fast ack.", {
      commandLabel: params.commandLabel,
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
  return {
    started: false,
    reason: "session_unavailable",
    runId: null,
    sessionKey: null,
    projectRoot: params.projectRoot ?? null,
    projectId: params.projectId ?? null,
    summary:
      `Accepted ${params.commandLabel}; background launch is still starting. ` +
      "Use /workflow-status or /handoff-status for progress.",
    reusedIdleSession: false,
    activeResearcherSessionsInChannel: null,
    queued: true,
    queueKey: null,
  };
}

async function recordCommandNotificationChannel(params: {
  projectRoot: string;
  projectId: string | null;
  ctx: Pick<PluginCommandContext, "channel">;
  target: ResolvedWorkflowCommandTarget;
  sessionKey: string | null;
  source: string;
  notes: string;
}): Promise<void> {
  await recordWorkflowNotificationChannelForProject({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    messageChannel: params.ctx.channel,
    channelKey: params.target.bindingChannelKey,
    sessionKey: params.sessionKey,
    accountId: params.target.bindingConversation?.accountId,
    conversationId: params.target.bindingConversation?.conversationId,
    source: params.source,
    notes: params.notes,
  });
}

const DEFAULT_DEPS: _WorkflowCommandDependencies = {
  resolveConversationBindingRecord: defaultResolveConversationBindingRecord,
  buildWorkflowSnapshot,
  runWorkflowAutoIterator,
  startBackgroundWorkflowRun,
  bindChannelProjectForWorkflow,
  setResearchProgramState,
  setWritingContractState,
  setGraphGuidedWritingState,
  unbindChannelProjectForWorkflow,
  runIdeaCatalystResearch30,
  runBroadPaperSearch,
  runCitationCalibration,
  stagePapernexusRemoteSources,
  reconcileAuthoringCloseout,
  captureWorkflowDiagnosticBundle,
  buildHandoffDashboard,
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
    cachedConversationRuntime = nodeRequire("openclaw/plugin-sdk/conversation-runtime");
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
    label: COMMAND_LABELS.auto_research,
    intro: "只输入主题就启动全自动科研主线：自动建项目、补最小 onboarding、记录通知渠道并后台启动主 pipeline。",
  },
  {
    label: COMMAND_LABELS.auto_review,
    intro: "只输入主题就启动全自动综述主线：自动建 survey 项目、记录通知渠道并后台启动 survey pipeline。",
  },
  {
    label: COMMAND_LABELS.bind_project,
    intro: "把当前消息渠道显式绑定到一个已有 workflow project，适合需要手动切换或修正项目上下文的通知入口。",
  },
  {
    label: COMMAND_LABELS.clear_project_binding,
    intro: "清空当前消息渠道的 workflow 项目绑定，适合渠道上下文指向错误项目时执行。",
  },
  {
    label: COMMAND_LABELS.clear_projects_state,
    intro: "清空 PROJECTS_STATE.json 里的项目注册列表，只保留项目目录和其它状态文件。",
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
    label: COMMAND_LABELS.handoff_status,
    intro: "查看 handoff 当前停在哪一步：prepared、dispatched、claimed、activated、queue、mailbox、binding gate。",
  },
  {
    label: COMMAND_LABELS.survey_graph_build,
    intro: "后台执行 survey 图谱构建前置搜集：强调主题相关、强去重、优先找图里没有的论文。",
  },
  {
    label: COMMAND_LABELS.show_commands,
    intro: "列出当前可用的 slash commands 和用途说明。",
  },
  {
    label: COMMAND_LABELS.autoresearch_panel,
    intro: "发送固定频道控制面板：Status、Resume、Graph、Handoff、Commands。",
  },
  {
    label: COMMAND_LABELS.discord_buttons_test,
    intro: "发送一条 Discord-native reusable 测试面板；按钮只回发测试消息，不推进 workflow。",
  },
  {
    label: COMMAND_LABELS.idea_catalyst_search,
    intro: "运行 IDEA-CATALYST 的跨域 research30 检索，并把结果回写到 scouting report。",
  },
  {
    label: COMMAND_LABELS.broad_paper_search,
    intro: "运行 broad multi-provider literature search，把合并后的候选论文与 source index 持久化到当前项目。",
  },
  {
    label: COMMAND_LABELS.citation_calibrate,
    intro: "运行当前项目的 citation calibration，并更新 reviewer 侧验证报告。",
  },
  {
    label: COMMAND_LABELS.papernexus_stage_remote,
    intro: "把本地 staged PDF/Markdown 上传到远端 PaperNexus staging，并生成 remote manifest。",
  },
  {
    label: COMMAND_LABELS.authoring_closeout,
    intro: "对当前论文项目做写作 closeout：补 citation/review/QC 状态并尝试生成 PDF。",
  },
  {
    label: COMMAND_LABELS.capture_diagnostics,
    intro: "抓取当前项目的诊断包：snapshot、runtime health、handoff、queue、mailbox、graph/papernexus 状态和关键日志 tail。",
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

function buildUnauthorizedDiscordActionText(commandLabel: string): string {
  return (
    `⛔ ${commandLabel} 是 workflow 控制操作，当前 Discord 用户没有执行权限。\n` +
    "你仍然可以使用 /workflow-status 查看当前状态；需要推进 workflow 时请让频道 operator 点击控制按钮。"
  );
}

function ensureAuthorizedDiscordWorkflowAction(
  ctx: Pick<PluginCommandContext, "channel" | "isAuthorizedSender">,
  commandLabel: string
) {
  if (ctx.channel === "discord" && ctx.isAuthorizedSender === false) {
    return {
      text: buildUnauthorizedDiscordActionText(commandLabel),
    };
  }
  return null;
}

type DiscordNativeButtonStyle = "primary" | "secondary" | "success" | "danger";

type DiscordNativeButtonSpec = {
  id: string;
  label: string;
  style?: DiscordNativeButtonStyle;
  callbackData: string;
};

type DiscordSerializableComponent = {
  isV2?: boolean;
  serialize: () => unknown;
};

type DiscordComponentRegistryEntry = {
  id: string;
  kind: "button";
  label: string;
  callbackData: string;
  reusable?: boolean;
  sessionKey?: string;
  accountId?: string;
  createdAt?: number;
  expiresAt?: number;
};

type DiscordComponentBuildResult = {
  components: DiscordSerializableComponent[];
  entries: DiscordComponentRegistryEntry[];
  modals: [];
};

type DiscordComponentRegistrationFacade = {
  registerBuiltDiscordComponentMessage?: (params: {
    buildResult: DiscordComponentBuildResult;
    messageId?: string;
  }) => void;
};

const DISCORD_COMPONENT_TYPE_ACTION_ROW = 1;
const DISCORD_COMPONENT_TYPE_BUTTON = 2;
const DISCORD_BUTTON_STYLE_VALUES: Record<DiscordNativeButtonStyle, number> = {
  primary: 1,
  secondary: 2,
  success: 3,
  danger: 4,
};

let cachedDiscordComponentRegistrationFacade:
  | Promise<DiscordComponentRegistrationFacade | null>
  | null
  | undefined;

const runtimeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<unknown>;

export const AUTORESEARCH_DISCORD_PANEL_COMPONENT_REFRESH_INTERVAL_MS = 20 * 60 * 1000;
const AUTORESEARCH_DISCORD_PANEL_COMPONENT_REGISTRY_TTL_MS = 24 * 60 * 60 * 1000;

function resolveDiscordFacadeImportSpecifiers(): string[] {
  const specifiers = ["openclaw/plugin-sdk/discord"];
  const openclawDistEntry = process.argv.find((entry) =>
    /(?:^|[/\\])openclaw[/\\]dist[/\\]index\.js$/i.test(entry)
  );
  if (openclawDistEntry) {
    const openclawRoot = path.dirname(path.dirname(openclawDistEntry));
    specifiers.push(
      pathToFileURL(path.join(openclawRoot, "dist", "plugin-sdk", "discord.js")).href
    );
  }
  return Array.from(new Set(specifiers));
}

async function importDiscordComponentRegistrationFacade(): Promise<DiscordComponentRegistrationFacade | null> {
  for (const specifier of resolveDiscordFacadeImportSpecifiers()) {
    try {
      return (await runtimeImport(specifier)) as DiscordComponentRegistrationFacade;
    } catch {
      continue;
    }
  }
  return null;
}

async function getDiscordComponentRegistrationFacade(): Promise<DiscordComponentRegistrationFacade | null> {
  if (cachedDiscordComponentRegistrationFacade !== undefined) {
    return cachedDiscordComponentRegistrationFacade;
  }
  cachedDiscordComponentRegistrationFacade = importDiscordComponentRegistrationFacade();
  return cachedDiscordComponentRegistrationFacade;
}

function buildDiscordComponentCustomId(componentId: string): string {
  return `occomp:cid=${componentId}`;
}

function createDiscordActionRowComponent(
  buttons: DiscordNativeButtonSpec[]
): DiscordSerializableComponent {
  return {
    isV2: false,
    serialize: () => ({
      type: DISCORD_COMPONENT_TYPE_ACTION_ROW,
      components: buttons.map((button) => ({
        type: DISCORD_COMPONENT_TYPE_BUTTON,
        style: DISCORD_BUTTON_STYLE_VALUES[button.style ?? "secondary"],
        label: button.label,
        custom_id: buildDiscordComponentCustomId(button.id),
      })),
    }),
  };
}

function readOptionalDiscordRouteValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function registerDiscordNativeButtonComponents(params: {
  components: DiscordSerializableComponent[];
  entries: DiscordComponentRegistryEntry[];
  logger?: Pick<WorkflowCommandApi["logger"], "debug" | "warn">;
}): Promise<boolean> {
  const register =
    (await getDiscordComponentRegistrationFacade())?.registerBuiltDiscordComponentMessage;
  if (!register) {
    params.logger?.warn?.("Discord component registry facade is unavailable.", {
      componentIds: params.entries.map((entry) => entry.id),
    });
    return false;
  }
  try {
    register({
      buildResult: {
        components: params.components,
        entries: params.entries,
        modals: [],
      },
    });
    return true;
  } catch {
    // Local unit tests often run outside the OpenClaw runtime bundle. In the
    // Gateway process this registration is what keeps clicks from expiring.
    params.logger?.warn?.("Discord component registry registration failed.", {
      componentIds: params.entries.map((entry) => entry.id),
    });
    return false;
  }
}

function buildDiscordNativeButtonRegistryPayload(params: {
  ctx: PluginCommandContext;
  reusable: true;
  buttons: DiscordNativeButtonSpec[];
  ttlMs?: number;
}): {
  components: DiscordSerializableComponent[];
  entries: DiscordComponentRegistryEntry[];
} {
  const routeCtx = params.ctx as PluginCommandContext & {
    sessionKey?: string;
  };
  const sessionKey = readOptionalDiscordRouteValue(routeCtx.sessionKey);
  const accountId = readOptionalDiscordRouteValue(params.ctx.accountId);
  const components = [createDiscordActionRowComponent(params.buttons)];
  const now = Date.now();
  const expiresAt =
    now + (params.ttlMs ?? AUTORESEARCH_DISCORD_PANEL_COMPONENT_REGISTRY_TTL_MS);
  const entries: DiscordComponentRegistryEntry[] = params.buttons.map((button) => ({
    id: button.id,
    kind: "button",
    label: button.label,
    callbackData: button.callbackData,
    reusable: params.reusable,
    createdAt: now,
    expiresAt,
    ...(sessionKey ? { sessionKey } : {}),
    ...(accountId ? { accountId } : {}),
  }));

  return { components, entries };
}

async function buildDiscordNativeButtonChannelData(params: {
  ctx: PluginCommandContext;
  reusable: true;
  buttons: DiscordNativeButtonSpec[];
  logger?: Pick<WorkflowCommandApi["logger"], "debug" | "warn">;
}): Promise<Record<string, unknown>> {
  const { components, entries } = buildDiscordNativeButtonRegistryPayload(params);

  await registerDiscordNativeButtonComponents({
    components,
    entries,
    logger: params.logger,
  });

  return {
    components,
    reusable: params.reusable,
    componentEntries: entries.map(({ id, label, callbackData, reusable }) => ({
      id,
      label,
      callbackData,
      reusable,
    })),
  };
}

function createAutoresearchPanelButtonSpecs(): DiscordNativeButtonSpec[] {
  return [
    {
      id: "autoresearch_panel_status",
      label: "Status",
      style: "primary",
      callbackData: COMMAND_LABELS.workflow_status,
    },
    {
      id: "autoresearch_panel_resume",
      label: "Resume",
      style: "secondary",
      callbackData: COMMAND_LABELS.resume_pipeline,
    },
    {
      id: "autoresearch_panel_graph",
      label: "Graph",
      style: "secondary",
      callbackData: COMMAND_LABELS.graph_build,
    },
    {
      id: "autoresearch_panel_handoff",
      label: "Handoff",
      style: "secondary",
      callbackData: COMMAND_LABELS.handoff_status,
    },
    {
      id: "autoresearch_panel_commands",
      label: "Commands",
      style: "secondary",
      callbackData: COMMAND_LABELS.show_commands,
    },
  ];
}

export async function refreshAutoresearchDiscordPanelComponentRegistry(params: {
  logger?: Pick<WorkflowCommandApi["logger"], "debug" | "warn">;
  reason?: string;
} = {}): Promise<boolean> {
  const { components, entries } = buildDiscordNativeButtonRegistryPayload({
    ctx: {
      channel: "discord",
      isAuthorizedSender: true,
      commandBody: COMMAND_LABELS.autoresearch_panel,
      config: {},
      requestConversationBinding: async () => ({ status: "error" }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null,
    },
    reusable: true,
    buttons: createAutoresearchPanelButtonSpecs(),
  });
  const registered = await registerDiscordNativeButtonComponents({
    components,
    entries,
    logger: params.logger,
  });
  params.logger?.debug?.("AutoResearch Discord panel component registry refreshed.", {
    reason: params.reason ?? "manual",
    registered,
    componentIds: entries.map((entry) => entry.id),
  });
  return registered;
}

function createAutoresearchPanelCommandHandler() {
  return async (ctx: PluginCommandContext) => {
    const unauthorized = ensureAuthorizedDiscordWorkflowAction(
      ctx,
      COMMAND_LABELS.autoresearch_panel
    );
    if (unauthorized) {
      return unauthorized;
    }

    const text =
      "AutoResearch 控制面板\n" +
      "这个频道建议保持只读：普通成员查看状态，operator 使用按钮推进 workflow。";

    return {
      text,
      channelData: {
        discord: await buildDiscordNativeButtonChannelData({
          ctx,
          reusable: true,
          buttons: createAutoresearchPanelButtonSpecs(),
        }),
      },
    };
  };
}

const DISCORD_BUTTON_TEST_PING_RE = /^--ping\s+([A-D])$/i;

function createDiscordButtonsTestCommandHandler() {
  return async (ctx: PluginCommandContext) => {
    const pingMatch = (ctx.args ?? "").trim().match(DISCORD_BUTTON_TEST_PING_RE);
    if (pingMatch) {
      return {
        text: `AutoResearch 按钮 ${pingMatch[1].toUpperCase()} 测试通过。`,
      };
    }

    const text =
      "AutoResearch Discord 按钮测试\n" +
      "这是临时测试面板。按钮只会在本频道发送测试消息，不会启动或推进 workflow。";
    const buttonCommand = COMMAND_LABELS.discord_buttons_test;

    return {
      text,
      channelData: {
        discord: await buildDiscordNativeButtonChannelData({
          ctx,
          reusable: true,
          buttons: [
            {
              id: "autoresearch_buttons_test_a",
              label: "测试 A",
              style: "primary",
              callbackData: `${buttonCommand} --ping A`,
            },
            {
              id: "autoresearch_buttons_test_b",
              label: "测试 B",
              style: "secondary",
              callbackData: `${buttonCommand} --ping B`,
            },
            {
              id: "autoresearch_buttons_test_c",
              label: "测试 C",
              style: "secondary",
              callbackData: `${buttonCommand} --ping C`,
            },
            {
              id: "autoresearch_buttons_test_d",
              label: "测试 D",
              style: "success",
              callbackData: `${buttonCommand} --ping D`,
            },
          ],
        }),
      },
    };
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

function asPlainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function expandHomePath(value: string): string {
  const home = readString(process.env.HOME);
  if (!home) {
    return value;
  }
  if (value === "~") {
    return home;
  }
  return value.startsWith("~/") ? path.join(home, value.slice(2)) : value;
}

function resolveProjectsStatePathFromCommand(params: {
  api: WorkflowCommandApi;
  ctx: PluginCommandContext;
}): string | null {
  const explicitTarget = extractQuotedSegment(params.ctx.args) ?? readString(params.ctx.args);
  if (explicitTarget) {
    const resolvedTarget = path.resolve(expandHomePath(explicitTarget));
    return path.basename(resolvedTarget) === "PROJECTS_STATE.json"
      ? resolvedTarget
      : path.join(resolvedTarget, "PROJECTS_STATE.json");
  }

  const workflowPolicy = getWorkflowGuardPolicy(resolvePluginConfig(params.api));
  const projectsRoot = readString(workflowPolicy.projectsRoot);
  return projectsRoot
    ? path.join(path.resolve(expandHomePath(projectsRoot)), "PROJECTS_STATE.json")
    : null;
}

async function clearProjectsStateProjects(params: {
  projectsStatePath: string;
}): Promise<{
  projectsStatePath: string;
  removedProjectCount: number;
  created: boolean;
}> {
  const projectsStatePath = path.resolve(params.projectsStatePath);
  return withAdvisoryLock({
    lockPath: `${projectsStatePath}.lock`,
    task: async () => {
      const existing = asPlainRecord(
        await readJsonIfExists<Record<string, unknown>>(projectsStatePath)
      );
      const projects = Array.isArray(existing?.projects) ? existing.projects : [];
      const nextState: Record<string, unknown> = {
        ...(existing ?? {
          gpu_allocation: {},
          total_gpu_hours_used: 0,
        }),
        projects: [],
        updated_at: new Date().toISOString(),
      };
      await writeJsonAtomicEnsured(projectsStatePath, nextState);
      return {
        projectsStatePath,
        removedProjectCount: projects.length,
        created: !existing,
      };
    },
  });
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

function hasCommandFlag(commandText: string | undefined, flag: string): boolean {
  return Boolean(commandText && new RegExp(`(^|\\s)${flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "i").test(commandText));
}

function readNumericFlag(commandText: string | undefined, flag: string): number | null {
  if (!commandText) {
    return null;
  }
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = commandText.match(new RegExp(`${escaped}\\s+(\\d+)`, "i"));
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

function readFlagValue(commandText: string | undefined, flag: string): string | null {
  if (!commandText) {
    return null;
  }
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = commandText.match(
    new RegExp(`${escaped}\\s+(?:"([^"]+)"|'([^']+)'|(\\S+))`, "i")
  );
  return readString(match?.[1] ?? match?.[2] ?? match?.[3]) ?? null;
}

function readWorkflowProjectIdOverrideFromContext(
  ctx: WorkflowCommandContext,
  args?: string | null
): string | null {
  const record = ctx as WorkflowCommandContext & Record<string, unknown>;
  return (
    readString(record.projectId) ??
    readString(record.project_id) ??
    readString(record.projectIdOverride) ??
    readString(record.project_id_override) ??
    readFlagValue(args ?? undefined, "--project-id")
  );
}

async function resolveProjectRootForProjectBoundCommand(params: {
  api: WorkflowCommandApi;
  ctx: PluginCommandContext;
  deps: WorkflowCommandDependencies;
  explicitArgument?: string | null;
}) {
  const workflowPolicy = getWorkflowGuardPolicy(resolvePluginConfig(params.api));
  const target = resolveWorkflowCommandSessionTarget(
    params.api,
    params.ctx,
    params.deps.resolveConversationBindingRecord
  );
  const targetSessionKey = target.sessionKey;
  const explicitArgument = readString(params.explicitArgument);
  if (explicitArgument) {
    if (path.isAbsolute(explicitArgument)) {
      return {
        projectRoot: path.resolve(explicitArgument),
        projectId: path.basename(path.resolve(explicitArgument)),
        workflowPolicy,
        target,
      };
    }
    const explicitProject = await resolveExistingWorkflowProjectSelection({
      workflowPolicy,
      projectId: explicitArgument,
    }).catch(() => null);
    if (explicitProject) {
      return {
        projectRoot: explicitProject.projectRoot,
        projectId: explicitProject.projectId,
        workflowPolicy,
        target,
      };
    }
  }
  if (!targetSessionKey) {
    throw new Error("This slash command requires a workflow-bound conversation or an explicit project path/project id.");
  }
  const projectBindingPolicy = resolveChannelProjectBindingPolicy(workflowPolicy, {
    messageChannel: params.ctx.channel,
    channelKey: target.bindingChannelKey,
    sessionKey: targetSessionKey,
  });
  const snapshot = await params.deps.buildWorkflowSnapshot({
    policy: projectBindingPolicy,
    agentId: target.agentId ?? undefined,
    workspaceDir: target.workspaceDir ?? undefined,
    sessionKey: targetSessionKey,
    messageChannel: params.ctx.channel,
    channelKey: target.bindingChannelKey ?? undefined,
  });
  if (!snapshot.projectRoot) {
    throw new Error("The current conversation is not bound to a workflow project.");
  }
  return {
    projectRoot: snapshot.projectRoot,
    projectId: snapshot.projectId ?? path.basename(snapshot.projectRoot),
    workflowPolicy,
    target,
  };
}

export function resolveWorkflowCommandSessionTarget(
  api: Pick<WorkflowCommandApi, "runtime">,
  ctx: Pick<
    WorkflowCommandContext,
    | "channel"
    | "from"
    | "to"
    | "accountId"
    | "messageThreadId"
    | "config"
    | "commandTargetSessionKey"
    | "commandSource"
    | "originatingTo"
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
  const explicitTargetSessionKey = readString(ctx.commandTargetSessionKey) ?? null;
  const fallbackSessionKey =
    readString(ctx.commandSource) === "native" ? null : readString((ctx as { sessionKey?: string | null }).sessionKey);
  const sessionKey =
    explicitTargetSessionKey ??
    readString(bindingRecord?.targetSessionKey) ??
    readString(route?.sessionKey) ??
    fallbackSessionKey ??
    null;
  const agentId =
    extractAgentIdFromSessionKey(sessionKey) ?? readString(route?.agentId) ?? null;
  const workspaceDir =
    agentId && typeof api.runtime?.agent?.resolveAgentWorkspaceDir === "function"
      ? api.runtime.agent.resolveAgentWorkspaceDir(ctx.config, agentId)
      : null;
  const bindingChannelKey =
    buildWorkflowConversationBindingKeyFromConversation(bindingConversation) ??
    deriveBindingChannelKeyFromSessionKey({
      sessionKey,
      accountId: ctx.accountId,
    });
  return {
    sessionKey,
    agentId,
    workspaceDir: readString(workspaceDir) ?? null,
    bindingConversation,
    bindingChannelKey,
  };
}

function coerceTargetToResearcherWorkflowSession(params: {
  api: Pick<WorkflowCommandApi, "runtime">;
  config: PluginCommandContext["config"];
  target: ResolvedWorkflowCommandTarget;
}): ResolvedWorkflowCommandTarget | null {
  const currentSessionKey = readString(params.target.sessionKey) ?? null;
  if (!currentSessionKey) {
    return null;
  }
  const researcherSessionKey =
    deriveAgentSessionKeyForRole({
      requesterSessionKey: currentSessionKey,
      targetRole: "researcher",
    }) ?? null;
  if (!researcherSessionKey) {
    return null;
  }
  const workspaceDir =
    typeof params.api.runtime?.agent?.resolveAgentWorkspaceDir === "function"
      ? readString(
          params.api.runtime.agent.resolveAgentWorkspaceDir(
            params.config,
            "researcher"
          )
        ) ?? params.target.workspaceDir
      : params.target.workspaceDir;
  return {
    ...params.target,
    sessionKey: researcherSessionKey,
    agentId: "researcher",
    workspaceDir,
  };
}

function createBackgroundWorkflowCommandHandler(
  api: WorkflowCommandApi,
  kind: WorkflowBackgroundCommandKind,
  deps: WorkflowCommandDependencies
) {
  return async (ctx: PluginCommandContext) => {
    const commandLabel = COMMAND_LABELS[kind];
    const unauthorized = ensureAuthorizedDiscordWorkflowAction(ctx, commandLabel);
    if (unauthorized) {
      return unauthorized;
    }
    try {
      const workflowPolicy = getWorkflowGuardPolicy(resolvePluginConfig(api));
      await maybeReplayQueuedWorkflowRunsFromCommandRuntime(api, workflowPolicy, ctx.channel);
      let target = resolveWorkflowCommandSessionTarget(
        api,
        ctx,
        deps.resolveConversationBindingRecord
      );
      let targetSessionKey = target.sessionKey;

      if (!targetSessionKey) {
        return {
          text:
            `❌ ${commandLabel} requires a resolved workflow session for this conversation. ` +
            "Run it from a Researcher-bound conversation or keep the prompt-path fallback enabled.",
        };
      }

      let targetRole = inferTargetRoleFromToolParams({
        agentId: target.agentId ?? undefined,
        sessionKey: targetSessionKey,
      });
      const requiresResearcherSession =
        kind === "research_pipeline" ||
        kind === "research_queue" ||
        kind === "literature_review" ||
        kind === "survey_review";
      const shouldAutoRerouteToResearcher =
        kind === "survey_review";
      if (requiresResearcherSession && targetRole !== "researcher") {
        if (!shouldAutoRerouteToResearcher) {
          return {
            text:
              `❌ ${commandLabel} can only start from a Researcher workflow session. ` +
              `Current target: ${targetRole ?? target.agentId ?? target.sessionKey}.`,
          };
        }
        const reroutedTarget = coerceTargetToResearcherWorkflowSession({
          api,
          config: ctx.config,
          target,
        });
        if (!reroutedTarget) {
          return {
            text:
              `❌ ${commandLabel} can only start from a Researcher workflow session. ` +
              `Current target: ${targetRole ?? target.agentId ?? target.sessionKey}.`,
          };
        }
        target = reroutedTarget;
        targetSessionKey = reroutedTarget.sessionKey;
        targetRole = "researcher";
      }
      if (!requiresResearcherSession && !targetRole) {
        return {
          text:
            `❌ ${commandLabel} requires a workflow-owned session for this conversation. ` +
            `Current target: ${target.agentId ?? target.sessionKey}.`,
        };
      }

      const projectBindingPolicy = resolveChannelProjectBindingPolicy(workflowPolicy, {
        messageChannel: ctx.channel,
        channelKey: target.bindingChannelKey,
        sessionKey: targetSessionKey,
      });
      const snapshot = await deps.buildWorkflowSnapshot({
        policy: projectBindingPolicy,
        agentId: target.agentId ?? undefined,
        workspaceDir: target.workspaceDir ?? undefined,
        sessionKey: targetSessionKey ?? undefined,
        messageChannel: ctx.channel,
        channelKey: target.bindingChannelKey ?? undefined,
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

      const queuedLaunch = enqueueWorkflowTask({
        key: resolveWorkflowQueueKey({
          projectRoot: explicitProject?.projectRoot ?? snapshot.projectRoot,
          workspaceDir: target.workspaceDir,
          sessionKey: targetSessionKey,
          messageChannel: ctx.channel,
          channelKey: target.bindingChannelKey,
        }),
        label: `workflow_command:${kind}`,
        logger: api.logger,
        task: async () => {
          const currentSnapshot = await deps.buildWorkflowSnapshot({
            policy: projectBindingPolicy,
            agentId: target.agentId ?? undefined,
            workspaceDir: target.workspaceDir ?? undefined,
            sessionKey: targetSessionKey ?? undefined,
            messageChannel: ctx.channel,
            channelKey: target.bindingChannelKey ?? undefined,
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
          const backgroundRun = buildBackgroundRunRequest(kind, ctx, {
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
          });

          if (
            commandSnapshot.projectRoot &&
            !shouldUseChannelProjectBindingForWorkflow({
              messageChannel: ctx.channel,
              channelKey: target.bindingChannelKey,
              sessionKey: targetSessionKey,
            })
          ) {
            await recordCommandNotificationChannel({
              projectRoot: commandSnapshot.projectRoot,
              projectId: commandSnapshot.projectId ?? null,
              ctx,
              target,
              sessionKey: targetSessionKey,
              source: `${kind}_command`,
              notes: `Recorded notification-only channel before ${COMMAND_LABELS[kind]} background launch.`,
            });
          }

          const launch = deps.startBackgroundWorkflowRun({
            workflowRuntime: createWorkflowCommandRuntime({
              api,
              workspaceDir:
                commandSnapshot.projectRoot ??
                resolvedBackgroundWorkspaceDir ??
                target.workspaceDir ??
                undefined,
              agentId: resolvedBackgroundAgentId ?? undefined,
              messageChannel: ctx.channel,
            }),
            workflowPolicy,
            agentCtx: {
              agentId: resolvedBackgroundAgentId,
              workspaceDir: resolvedBackgroundWorkspaceDir,
              sessionKey: targetSessionKey ?? undefined,
              messageChannel: ctx.channel,
              channelKey: target.bindingChannelKey ?? undefined,
            },
            snapshot: commandSnapshot,
            backgroundRun,
          });
          return launch;
        },
      });
      const result = await withNativeDiscordBackgroundAckTimeout({
        api,
        ctx,
        commandLabel,
        projectRoot: explicitProject?.projectRoot ?? snapshot.projectRoot,
        projectId:
          explicitProject?.projectId ??
          (kind === "survey_review" ? surveyProjectId : undefined) ??
          snapshot.projectId,
        launch: queuedLaunch,
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
      const projectBindingPolicy = resolveChannelProjectBindingPolicy(workflowPolicy, {
        messageChannel: ctx.channel,
        channelKey: target.bindingChannelKey,
        sessionKey: target.sessionKey,
      });
      const snapshot = target.sessionKey && targetRole
        ? await deps.buildWorkflowSnapshot({
            policy: projectBindingPolicy,
            agentId: target.agentId ?? undefined,
            workspaceDir: target.workspaceDir ?? undefined,
            sessionKey: target.sessionKey,
            messageChannel: ctx.channel,
            channelKey: target.bindingChannelKey ?? undefined,
          })
        : null;
      const ensuredProject = await ensureWorkflowProjectRoot({
        policy: workflowPolicy,
        workspaceDir: target.workspaceDir ?? undefined,
        sessionKey: target.sessionKey ?? undefined,
        messageChannel: ctx.channel,
        channelKey: target.bindingChannelKey ?? undefined,
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

function buildAutoResearchBootstrapPatch(params: {
  intent: AutoBootstrapIntent;
  projectId: string;
  zoteroProjectRoot?: string | null;
  current: Awaited<ReturnType<typeof getResearchProgramStateSummary>>["state"];
}) {
  const intentConstraints = [
    ...params.intent.referenceHints.map(
      (entry) => `Reference method hint: ${entry}`
    ),
    ...params.intent.explicitRequirements.map(
      (entry) => `User requirement: ${entry}`
    ),
  ];
  return {
    status:
      params.current.status === "missing" ? "draft" : params.current.status,
    goal: params.current.goal ?? params.intent.cleanTopic,
    problem_statement:
      params.current.problemStatement ??
      (params.intent.rawRequest !== params.intent.cleanTopic
        ? params.intent.rawRequest
        : params.intent.cleanTopic),
    baseline_reference:
      params.current.baselineReference ??
      `${params.intent.cleanTopic} literature baseline (auto-bootstrap)`,
    primary_metric:
      params.current.primaryMetric ??
      "literature-grounded primary metric (auto-bootstrap)",
    datasets:
      params.current.datasets.length > 0
        ? params.current.datasets
        : [`${params.intent.cleanTopic} target dataset (auto-bootstrap)`],
    constraints:
      params.current.constraints.length > 0
        ? params.current.constraints
        : intentConstraints,
    success_criteria:
      params.current.successCriteria.length > 0
        ? params.current.successCriteria
        : [
            "Infer a literature-grounded baseline, primary metric, and dataset envelope from the graph and literature, then advance the strongest experiment track automatically.",
          ],
    zotero_project_path:
      params.current.zoteroProjectPath ??
      defaultResearchProgramZoteroProjectPath(
        params.projectId,
        params.zoteroProjectRoot
      ),
    pending_reason:
      params.current.pendingReason ??
      (params.intent.rawRequest !== params.intent.cleanTopic
        ? "Auto-research bootstrap preserved richer request context (paper references / explicit requirements); refine the provisional onboarding values with literature/graph evidence while honoring that context."
        : "Auto-research bootstrap seeded provisional onboarding values from the topic; refine them with literature/graph evidence as the workflow advances."),
  };
}

function buildAutoResearchWritingBootstrapPatch() {
  return {
    paper_mode: "conference",
    storyline_source: "idea_catalyst",
    kg_storyline_required: true,
    kg_storyline_status: "pending",
    pending_reason:
      "Auto-research defaults to Idea-Catalyst-style storyline synthesis: clarify target-domain questions, unresolved challenges, interdisciplinary bridges, and evidence-backed narrative anchors before final prose hardening.",
  };
}

function buildAutoResearchGraphGuidedWritingBootstrapPatch() {
  return {
    enabled: true,
    status: "pending",
    evidence_coverage_status: "pending",
    citation_source_mode: "graph_only",
    scholar_query_reserved: true,
    pending_reason:
      "Graph-guided writing is enabled by default for auto-research. Use Idea-Catalyst-style storyline organization to map problem -> challenge -> interdisciplinary bridge -> evidence before tightening claims.",
  };
}

function buildAutoReviewWritingBootstrapPatch() {
  return {
    paper_mode: "survey",
    storyline_source: "survey_packet",
    kg_storyline_required: false,
    kg_storyline_status: "optional",
    pending_reason:
      "Auto-review prioritizes broad related-direction coverage and survey packet quality over graph-guided storyline enforcement.",
  };
}

function buildAutoReviewGraphGuidedWritingBootstrapPatch() {
  return {
    enabled: false,
    status: "optional",
    evidence_coverage_status: "optional",
    scholar_query_reserved: false,
    pending_reason:
      "Auto-review emphasizes breadth of adjacent directions, benchmarks, and unresolved gaps; graph-guided writing is advisory only unless explicitly enabled later.",
  };
}

type AutoBootstrapIntent = {
  sourceCommand: "auto_research" | "auto_review";
  rawRequest: string;
  cleanTopic: string;
  supplementalContext: string | null;
  referenceHints: string[];
  explicitRequirements: string[];
};

function trimBootstrapPunctuation(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/^[\s,，;；:：\-–—]+/, "")
    .replace(/[\s,，;；:：\-–—]+$/, "")
    .trim();
}

function splitIntentClauses(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(/[\n。；;]+/g)
    .map((entry) => trimBootstrapPunctuation(entry))
    .filter(Boolean);
}

function isReferenceHint(value: string): boolean {
  return /(参考论文|参考|参照|借鉴|基于|方法|paper|papers|arxiv|doi|inspired by|using|reference)/i.test(
    value
  );
}

function isExplicitRequirement(value: string): boolean {
  return /(要求|需要|并且|同时|must|require|requirements|constraint|constraints|focus on|重点|请)/i.test(
    value
  );
}

function parseAutoBootstrapIntent(params: {
  sourceCommand: "auto_research" | "auto_review";
  args: string;
}): AutoBootstrapIntent | null {
  const rawRequest = trimBootstrapPunctuation(params.args);
  if (!rawRequest) {
    return null;
  }
  const quotedTopic =
    /^"([^"]+)"/.exec(rawRequest)?.[1]?.trim() ??
    /^'([^']+)'/.exec(rawRequest)?.[1]?.trim() ??
    null;
  let cleanTopic = quotedTopic ? trimBootstrapPunctuation(quotedTopic) : "";
  let supplementalContext: string | null = null;
  if (quotedTopic) {
    const quotedIndex = rawRequest.indexOf(`"${quotedTopic}"`);
    if (quotedIndex >= 0) {
      supplementalContext = trimBootstrapPunctuation(
        `${rawRequest.slice(0, quotedIndex)} ${rawRequest.slice(
          quotedIndex + quotedTopic.length + 2
        )}`
      );
    }
  } else {
    const markerMatch = rawRequest.match(
      /^(.*?)(?:[\s,，;；:：\-–—]+)?(参考论文|参考|参照|借鉴|基于|使用|要求|需要|并且|同时|\bwith\b|\busing\b|\binspired by\b|\breference\b|\breferences\b|\brequire\b|\brequirements\b|\bconstraint\b|\bconstraints\b|\bmust\b)/i
    );
    if (markerMatch?.[1]) {
      cleanTopic = trimBootstrapPunctuation(markerMatch[1]);
      supplementalContext = trimBootstrapPunctuation(
        rawRequest.slice(markerMatch[1].length)
      );
    } else {
      cleanTopic = rawRequest;
    }
  }
  if (!cleanTopic) {
    cleanTopic = rawRequest;
  }
  const clauses = splitIntentClauses(supplementalContext);
  const referenceHints = clauses.filter((entry) => isReferenceHint(entry));
  const explicitRequirements = clauses.filter((entry) =>
    isExplicitRequirement(entry)
  );
  return {
    sourceCommand: params.sourceCommand,
    rawRequest,
    cleanTopic,
    supplementalContext,
    referenceHints,
    explicitRequirements,
  };
}

function buildBootstrapRequestManifestPatch(
  intent: AutoBootstrapIntent
): Record<string, unknown> {
  return {
    bootstrap_request: {
      source_command: intent.sourceCommand,
      raw_request: intent.rawRequest,
      clean_topic: intent.cleanTopic,
      supplemental_context: intent.supplementalContext,
      reference_hints: intent.referenceHints,
      explicit_requirements: intent.explicitRequirements,
      last_updated_at: new Date().toISOString(),
    },
  };
}

function buildBootstrapContextPrompt(intent: AutoBootstrapIntent): string | null {
  const lines = [
    `Bootstrap topic: ${intent.cleanTopic}`,
    intent.rawRequest !== intent.cleanTopic ? `Full user request: ${intent.rawRequest}` : null,
    intent.referenceHints.length > 0 ? "Paper / method references to consider:" : null,
    ...intent.referenceHints.map((entry) => `- ${entry}`),
    intent.explicitRequirements.length > 0 ? "Explicit user requirements:" : null,
    ...intent.explicitRequirements.map((entry) => `- ${entry}`),
    "Naming rule: keep project naming anchored to the clean topic, but preserve and honor the richer request context during bootstrap and downstream planning.",
  ].filter((entry): entry is string => Boolean(entry));
  return lines.length > 0 ? lines.join("\n") : null;
}

async function persistBootstrapRequest(
  projectRoot: string,
  intent: AutoBootstrapIntent
): Promise<void> {
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  await writeJsonEnsured(manifestPath, {
    ...manifest,
    ...buildBootstrapRequestManifestPatch(intent),
  });
}

async function syncBootstrapProjectRegistryEntry(params: {
  projectRoot: string;
  projectId: string | null;
}) {
  if (!params.projectId) {
    return;
  }
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(params.projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  await syncProjectsStateEntry({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    manifest,
    trackRegistry: null,
    stage: readString(manifest.current_stage) ?? "setup",
    nextAction: readString(manifest.next_action) ?? "/project-init \"research goal\"",
    blockingReason: readString(manifest.blocking_reason) ?? null,
    getActiveTracks: () => [],
  });
}

function createAutoResearchCommandHandler(
  api: WorkflowCommandApi,
  deps: WorkflowCommandDependencies
) {
  return async (ctx: PluginCommandContext) => {
      const commandLabel = COMMAND_LABELS.auto_research;
    try {
      const workflowPolicy = getWorkflowGuardPolicy(resolvePluginConfig(api));
      await maybeReplayQueuedWorkflowRunsFromCommandRuntime(api, workflowPolicy, ctx.channel);
      const intent = parseAutoBootstrapIntent({
        sourceCommand: "auto_research",
        args: readString(ctx.args) ?? "",
      });
      if (!intent) {
        return {
          text: `❌ ${commandLabel} requires a topic, for example: /auto-research "gcd confirmation bias mitigation"`,
        };
      }
      const topic = intent.cleanTopic;
      const projectIdOverride = readWorkflowProjectIdOverrideFromContext(
        ctx,
        readString(ctx.args) ?? null
      );
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
            "Run it from a workflow-enabled channel or restore gateway routing first.",
        };
      }
      const researcherSessionKey = deriveWorkflowRoleSessionKey({
        sessionKey: targetSessionKey,
        role: "researcher",
      });
      const workflowSessionKey = researcherSessionKey ?? targetSessionKey;
      const shouldBindProjectChannel = shouldUseChannelProjectBindingForWorkflow({
        messageChannel: ctx.channel,
        channelKey: target.bindingChannelKey,
        sessionKey: workflowSessionKey,
      });

      const ensuredProject = await ensureWorkflowProjectRoot({
        policy: workflowPolicy,
        workspaceDir: target.workspaceDir ?? undefined,
        sessionKey: workflowSessionKey,
        messageChannel: ctx.channel,
        channelKey: shouldBindProjectChannel
          ? target.bindingChannelKey ?? undefined
          : undefined,
        projectId: projectIdOverride ?? undefined,
        title: topic,
        topic,
      });
      await persistBootstrapRequest(ensuredProject.projectRoot, intent);

      const bindingNotes =
        intent.rawRequest === intent.cleanTopic
          ? "Auto-bound during /auto-research bootstrap."
          : `Auto-bound during /auto-research bootstrap. Full request: ${intent.rawRequest}`;
      if (shouldBindProjectChannel) {
        await deps.bindChannelProjectForWorkflow({
          policy: workflowPolicy,
          workspaceDir: target.workspaceDir ?? undefined,
          sessionKey: workflowSessionKey,
          messageChannel: ctx.channel,
          channelKey: target.bindingChannelKey ?? undefined,
          projectRoot: ensuredProject.projectRoot,
          projectId: ensuredProject.projectId,
          title: ensuredProject.title,
          topic,
          boundByAgent: "researcher",
          notes: bindingNotes,
        });
      } else {
        await recordCommandNotificationChannel({
          projectRoot: ensuredProject.projectRoot,
          projectId: ensuredProject.projectId,
          ctx,
          target,
          sessionKey: workflowSessionKey,
          source: "auto_research_command",
          notes:
            intent.rawRequest === intent.cleanTopic
              ? "Recorded notification channel during /auto-research bootstrap."
              : `Recorded notification channel during /auto-research bootstrap. Full request: ${intent.rawRequest}`,
        });
      }

      const currentSummary = await getResearchProgramStateSummary({
        projectRoot: ensuredProject.projectRoot,
      });
      const update = await deps.setResearchProgramState({
        projectRoot: ensuredProject.projectRoot,
        researchProgram: buildAutoResearchBootstrapPatch({
          intent,
          projectId: ensuredProject.projectId,
          zoteroProjectRoot: workflowPolicy.zoteroProjectRoot,
          current: currentSummary.state,
        }),
      });
      await deps.setWritingContractState({
        projectRoot: ensuredProject.projectRoot,
        policy: workflowPolicy,
        writingContract: buildAutoResearchWritingBootstrapPatch(),
      });
      await deps.setGraphGuidedWritingState({
        projectRoot: ensuredProject.projectRoot,
        graphGuidedWriting: buildAutoResearchGraphGuidedWritingBootstrapPatch(),
      });
      await syncBootstrapProjectRegistryEntry({
        projectRoot: ensuredProject.projectRoot,
        projectId: ensuredProject.projectId,
      });

      const started = await deps.startBackgroundWorkflowRun({
        workflowRuntime: createWorkflowCommandRuntime({
          api,
          workspaceDir: ensuredProject.projectRoot,
          agentId: "researcher",
          messageChannel: ctx.channel,
        }),
        workflowPolicy,
        agentCtx: {
          agentId: "researcher",
          workspaceDir: target.workspaceDir ?? undefined,
          sessionKey: workflowSessionKey,
          sessionId: undefined,
          messageChannel: ctx.channel,
          channelKey: target.bindingChannelKey ?? undefined,
        },
        snapshot: {
          role: "researcher",
          projectRoot: ensuredProject.projectRoot,
          projectId: ensuredProject.projectId,
          channelProjectBindingsEnabled: shouldBindProjectChannel,
        },
        backgroundRun: {
          kind: "research_pipeline",
          projectId: ensuredProject.projectId,
          projectRoot: ensuredProject.projectRoot,
          topic,
          title: topic,
          triggerKind: "auto_research_command",
          summary: `Full-auto research pipeline started for ${ensuredProject.projectId}.`,
          commandText: buildResearchPipelineBackgroundCommand(
            `/research-pipeline ${JSON.stringify(topic)} -- AUTO_PROCEED: true`
          ),
          extraSystemPrompt: buildBootstrapContextPrompt(intent) ?? undefined,
        },
      });

      return {
        text:
          `Full-auto research pipeline started for ${ensuredProject.projectId}.\n` +
          `project_root=${ensuredProject.projectRoot}\n` +
          `onboarding=${update.onboardingStatus}\n` +
          (intent.rawRequest !== intent.cleanTopic
            ? `preserved_request=${intent.rawRequest}\n`
            : "") +
          `summary=${started.summary}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      api.logger?.warn?.("Failed to start full-auto research pipeline.", {
        channel: ctx.channel,
        error: message,
      });
      return {
        text: `❌ Failed to start /auto-research: ${message}`,
      };
    }
  };
}

function createAutoReviewCommandHandler(
  api: WorkflowCommandApi,
  deps: WorkflowCommandDependencies
) {
  return async (ctx: PluginCommandContext) => {
      const commandLabel = COMMAND_LABELS.auto_review;
    try {
      const workflowPolicy = getWorkflowGuardPolicy(resolvePluginConfig(api));
      await maybeReplayQueuedWorkflowRunsFromCommandRuntime(api, workflowPolicy, ctx.channel);
      const intent = parseAutoBootstrapIntent({
        sourceCommand: "auto_review",
        args: readString(ctx.args) ?? "",
      });
      if (!intent) {
        return {
          text: `❌ ${commandLabel} requires a topic, for example: /auto-review "graph reasoning survey"`,
        };
      }
      const topic = intent.cleanTopic;
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
            "Run it from a workflow-enabled channel or restore gateway routing first.",
        };
      }
      const projectIdOverride = readWorkflowProjectIdOverrideFromContext(
        ctx,
        readString(ctx.args) ?? null
      );
      const researcherSessionKey = deriveWorkflowRoleSessionKey({
        sessionKey: targetSessionKey,
        role: "researcher",
      });
      const workflowSessionKey = researcherSessionKey ?? targetSessionKey;
      const shouldBindProjectChannel = shouldUseChannelProjectBindingForWorkflow({
        messageChannel: ctx.channel,
        channelKey: target.bindingChannelKey,
        sessionKey: workflowSessionKey,
      });

      const ensuredProject = await ensureWorkflowProjectRoot({
        policy: workflowPolicy,
        workspaceDir: target.workspaceDir ?? undefined,
        sessionKey: workflowSessionKey,
        messageChannel: ctx.channel,
        channelKey: shouldBindProjectChannel
          ? target.bindingChannelKey ?? undefined
          : undefined,
        projectId: projectIdOverride ?? `survey-${sanitizeProjectIdFragment(topic)}`,
        title: topic,
        topic,
        workflowLine: "survey",
      });
      await persistBootstrapRequest(ensuredProject.projectRoot, intent);

      const bindingNotes =
        intent.rawRequest === intent.cleanTopic
          ? "Auto-bound during /auto-review bootstrap."
          : `Auto-bound during /auto-review bootstrap. Full request: ${intent.rawRequest}`;
      if (shouldBindProjectChannel) {
        await deps.bindChannelProjectForWorkflow({
          policy: workflowPolicy,
          workspaceDir: target.workspaceDir ?? undefined,
          sessionKey: workflowSessionKey,
          messageChannel: ctx.channel,
          channelKey: target.bindingChannelKey ?? undefined,
          projectRoot: ensuredProject.projectRoot,
          projectId: ensuredProject.projectId,
          title: ensuredProject.title,
          topic,
          boundByAgent: "researcher",
          notes: bindingNotes,
        });
      } else {
        await recordCommandNotificationChannel({
          projectRoot: ensuredProject.projectRoot,
          projectId: ensuredProject.projectId,
          ctx,
          target,
          sessionKey: workflowSessionKey,
          source: "auto_review_command",
          notes:
            intent.rawRequest === intent.cleanTopic
              ? "Recorded notification channel during /auto-review bootstrap."
              : `Recorded notification channel during /auto-review bootstrap. Full request: ${intent.rawRequest}`,
        });
      }
      await deps.setWritingContractState({
        projectRoot: ensuredProject.projectRoot,
        policy: workflowPolicy,
        writingContract: buildAutoReviewWritingBootstrapPatch(),
      });
      await deps.setGraphGuidedWritingState({
        projectRoot: ensuredProject.projectRoot,
        graphGuidedWriting: buildAutoReviewGraphGuidedWritingBootstrapPatch(),
      });

      const started = await deps.startBackgroundWorkflowRun({
        workflowRuntime: createWorkflowCommandRuntime({
          api,
          workspaceDir: ensuredProject.projectRoot,
          agentId: "researcher",
          messageChannel: ctx.channel,
        }),
        workflowPolicy,
        agentCtx: {
          agentId: "researcher",
          workspaceDir: target.workspaceDir ?? undefined,
          sessionKey: workflowSessionKey,
          sessionId: undefined,
          messageChannel: ctx.channel,
          channelKey: target.bindingChannelKey ?? undefined,
        },
        snapshot: {
          role: "researcher",
          projectRoot: ensuredProject.projectRoot,
          projectId: ensuredProject.projectId,
          channelProjectBindingsEnabled: shouldBindProjectChannel,
        },
        backgroundRun: {
          kind: "survey_review",
          projectId: ensuredProject.projectId,
          projectRoot: ensuredProject.projectRoot,
          topic,
          title: topic,
          triggerKind: "auto_review_command",
          summary: `Full-auto survey pipeline started for ${ensuredProject.projectId}.`,
          commandText: buildSurveyReviewBackgroundCommand(
            `/survey-pipeline ${JSON.stringify(topic)}`
          ),
          extraSystemPrompt: buildBootstrapContextPrompt(intent) ?? undefined,
        },
      });

      return {
        text:
          `Full-auto survey pipeline started for ${ensuredProject.projectId}.\n` +
          `project_root=${ensuredProject.projectRoot}\n` +
          (intent.rawRequest !== intent.cleanTopic
            ? `preserved_request=${intent.rawRequest}\n`
            : "") +
          `summary=${started.summary}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      api.logger?.warn?.("Failed to start full-auto survey pipeline.", {
        channel: ctx.channel,
        error: message,
      });
      return {
        text: `❌ Failed to start /auto-review: ${message}`,
      };
    }
  };
}

function createClearProjectBindingCommandHandler(
  api: WorkflowCommandApi,
  deps: WorkflowCommandDependencies
) {
  return async (ctx: PluginCommandContext) => {
    const commandLabel = COMMAND_LABELS.clear_project_binding;
    try {
      const routePeer = resolveRoutePeerFromCommandContext(ctx);
      if (!routePeer || routePeer.kind === "direct") {
        return {
          text:
            `❌ ${commandLabel} 必须在要清理绑定的频道或群组会话里调用，` +
            "不能在私聊里代替其他频道执行。",
        };
      }

      const workflowPolicy = getWorkflowGuardPolicy(resolvePluginConfig(api));
      const target = resolveWorkflowCommandSessionTarget(
        api,
        ctx,
        deps.resolveConversationBindingRecord
      );
      const channelKey = target.bindingChannelKey;
      if (!channelKey) {
        return {
          text:
            `❌ ${commandLabel} 无法解析当前频道的 workflow binding key。` +
            "请在目标频道内直接调用这个命令。",
        };
      }

      const result = await deps.unbindChannelProjectForWorkflow({
        policy: workflowPolicy,
        workspaceDir: target.workspaceDir ?? undefined,
        sessionKey: target.sessionKey ?? undefined,
        messageChannel: ctx.channel,
        channelKey,
      });

      return {
        text: result.removed
          ? `Cleared the workflow project binding for this channel.\nchannel_key=${result.channelKey ?? channelKey}`
          : `No workflow project binding is currently set for this channel.\nchannel_key=${result.channelKey ?? channelKey}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      api.logger?.warn?.("Failed to clear the workflow channel project binding.", {
        channel: ctx.channel,
        error: message,
      });
      return {
        text: `❌ Failed to clear the workflow project binding: ${message}`,
      };
    }
  };
}

function createClearProjectsStateCommandHandler(api: WorkflowCommandApi) {
  return async (ctx: PluginCommandContext) => {
    const commandLabel = COMMAND_LABELS.clear_projects_state;
    try {
      const projectsStatePath = resolveProjectsStatePathFromCommand({ api, ctx });
      if (!projectsStatePath) {
        return {
          text:
            `❌ ${commandLabel} requires plugin config projectsRoot or an explicit projects root / PROJECTS_STATE.json path.`,
        };
      }

      const result = await clearProjectsStateProjects({ projectsStatePath });
      api.logger?.info?.("Cleared workflow projects registry from slash command.", {
        commandLabel,
        projectsStatePath: result.projectsStatePath,
        removedProjectCount: result.removedProjectCount,
        created: result.created,
      });

      return {
        text:
          "Cleared all project registry bindings from PROJECTS_STATE.json.\n" +
          `removed_projects=${result.removedProjectCount}\n` +
          `projects_state=${result.projectsStatePath}\n` +
          "project_files=preserved",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      api.logger?.warn?.("Failed to clear workflow projects registry.", {
        channel: ctx.channel,
        error: message,
      });
      return {
        text: `❌ Failed to clear PROJECTS_STATE.json project bindings: ${message}`,
      };
    }
  };
}

function createBindProjectCommandHandler(
  api: WorkflowCommandApi,
  deps: WorkflowCommandDependencies
) {
  return async (ctx: PluginCommandContext) => {
    const commandLabel = COMMAND_LABELS.bind_project;
    try {
      const routePeer = resolveRoutePeerFromCommandContext(ctx);
      if (!routePeer || routePeer.kind === "direct") {
        return {
          text:
            `❌ ${commandLabel} 必须在要绑定的频道或群组会话里调用，` +
            "不能在私聊里代替其他频道执行。",
        };
      }

      const explicitProject =
        extractQuotedSegment(ctx.args) ?? readString(ctx.args);
      if (!explicitProject) {
        return {
          text:
            `❌ ${commandLabel} requires an explicit project id or absolute project path, ` +
            'for example: /bind-project "survey-graph-reasoning"',
        };
      }

      const { projectRoot, projectId, workflowPolicy, target } =
        await resolveProjectRootForProjectBoundCommand({
          api,
          ctx,
          deps,
          explicitArgument: explicitProject,
        });

      if (path.isAbsolute(explicitProject)) {
        const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
        if (!(await pathExists(manifestPath))) {
          throw new Error(
            `The explicit project path is not a workflow project root: missing ${manifestPath}`
          );
        }
      }

      const channelKey = target.bindingChannelKey;
      if (!channelKey) {
        return {
          text:
            `❌ ${commandLabel} 无法解析当前频道的 workflow binding key。` +
            "请在目标频道内直接调用这个命令。",
        };
      }

      const shouldBindProjectChannel = shouldUseChannelProjectBindingForWorkflow({
        messageChannel: ctx.channel,
        channelKey,
        sessionKey: target.sessionKey,
      });
      if (!shouldBindProjectChannel) {
        await recordCommandNotificationChannel({
          projectRoot,
          projectId,
          ctx,
          target,
          sessionKey: target.sessionKey,
          source: "bind_project_command",
          notes: `Recorded notification-only channel via ${commandLabel}.`,
        });
        return {
          text:
            `Recorded this channel as a notification target for workflow project ${projectId}.\n` +
            `project_root=${projectRoot}\n` +
            "project_binding=skipped_notification_only",
        };
      }

      const result = await deps.bindChannelProjectForWorkflow({
        policy: workflowPolicy,
        workspaceDir: target.workspaceDir ?? undefined,
        sessionKey: target.sessionKey ?? undefined,
        messageChannel: ctx.channel,
        channelKey,
        projectRoot,
        projectId,
        title: projectId,
        topic: projectId,
        boundByAgent: "researcher",
        notes: `Manually bound via ${commandLabel}.`,
      });

      return {
        text:
          `Bound this channel to workflow project ${projectId}.\n` +
          `project_root=${projectRoot}\n` +
          `channel_key=${result.binding?.channelKey ?? channelKey}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      api.logger?.warn?.("Failed to bind the workflow channel to a project.", {
        channel: ctx.channel,
        error: message,
      });
      return {
        text: `❌ Failed to bind the workflow project: ${message}`,
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
      await maybeReplayQueuedWorkflowRunsFromCommandRuntime(api, workflowPolicy, ctx.channel);
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

      const projectBindingPolicy = resolveChannelProjectBindingPolicy(workflowPolicy, {
        messageChannel: ctx.channel,
        channelKey: target.bindingChannelKey,
        sessionKey: targetSessionKey,
      });
      const previewSnapshot = await deps.buildWorkflowSnapshot({
        policy: projectBindingPolicy,
        agentId: target.agentId ?? undefined,
        workspaceDir: target.workspaceDir ?? undefined,
        sessionKey: targetSessionKey ?? undefined,
        messageChannel: ctx.channel,
        channelKey: target.bindingChannelKey ?? undefined,
      });

      const statusState = await enqueueWorkflowTask({
        key: resolveWorkflowQueueKey({
          projectRoot: previewSnapshot.projectRoot,
          workspaceDir: target.workspaceDir,
          sessionKey: targetSessionKey,
          messageChannel: ctx.channel,
          channelKey: target.bindingChannelKey,
        }),
        label: "workflow_command:workflow_status",
        logger: api.logger,
        task: async () => {
          const snapshot = await deps.buildWorkflowSnapshot({
            policy: projectBindingPolicy,
            agentId: target.agentId ?? undefined,
            workspaceDir: target.workspaceDir ?? undefined,
            sessionKey: targetSessionKey,
            messageChannel: ctx.channel,
            channelKey: target.bindingChannelKey ?? undefined,
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
        presentation: buildWorkflowStatusPresentation({
          channel: ctx.channel,
          snapshot: statusState.snapshot,
          autoIteratorResult: statusState.autoIteratorResult,
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

function createHandoffStatusCommandHandler(
  api: WorkflowCommandApi,
  deps: WorkflowCommandDependencies
) {
  return async (ctx: PluginCommandContext) => {
    try {
      const resolved = await resolveProjectRootForProjectBoundCommand({
        api,
        ctx,
        deps,
        explicitArgument: extractQuotedSegment(ctx.args),
      });
      const status = await deps.buildHandoffDashboard({
        projectRoot: resolved.projectRoot,
        projectId: resolved.projectId,
        policy: resolved.workflowPolicy,
        sessionKey: resolved.target.sessionKey ?? undefined,
      });
      const latest = status.intents[0] ?? null;
      return {
        text:
          `Handoff status for ${resolved.projectId}.\n` +
          `current_owner=${status.currentOwner ?? "none"}, pending_handoff=${status.pendingHandoffId ?? "none"}, pending_owner=${status.pendingOwnerCandidate ?? "none"}, phase=${status.handoffPhase ?? "idle"}\n` +
          `queue_depth=${status.queueDepth}, active_sessions=${status.activeSessionCount}, pending_mailbox=${status.pendingMailboxCount}\n` +
          `binding_gate=${status.bindingGate?.allowed === true ? "allowed" : status.bindingGate?.reason ?? "unknown"}\n` +
          `latest_intent=${latest ? `${latest.intentId} (${latest.status} -> ${latest.toRole})` : "none"}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        text: `❌ Failed to run /handoff-status: ${message}`,
      };
    }
  };
}

function createShowCommandsCommandHandler() {
  return async () => ({
    text: formatShowCommandsText(),
  });
}

function createSurveyGraphBuildCommandHandler(
  api: WorkflowCommandApi,
  deps: WorkflowCommandDependencies
) {
  return async (ctx: PluginCommandContext) => {
    const commandLabel = COMMAND_LABELS.survey_graph_build;
    try {
      const workflowPolicy = getWorkflowGuardPolicy(resolvePluginConfig(api));
      await maybeReplayQueuedWorkflowRunsFromCommandRuntime(api, workflowPolicy, ctx.channel);
      let target = resolveWorkflowCommandSessionTarget(
        api,
        ctx,
        deps.resolveConversationBindingRecord
      );
      let targetSessionKey = target.sessionKey;
      if (!targetSessionKey) {
        return {
          text:
            `❌ ${commandLabel} requires a resolved workflow session for this conversation. ` +
            "Run it from a Researcher-bound conversation.",
        };
      }
      let targetRole = inferTargetRoleFromToolParams({
        agentId: target.agentId ?? undefined,
        sessionKey: targetSessionKey,
      });
      if (targetRole !== "researcher") {
        const reroutedTarget = coerceTargetToResearcherWorkflowSession({
          api,
          config: ctx.config,
          target,
        });
        if (!reroutedTarget) {
          return {
            text:
              `❌ ${commandLabel} can only start from a Researcher workflow session. ` +
              `Current target: ${targetRole ?? target.agentId ?? target.sessionKey}.`,
          };
        }
        target = reroutedTarget;
        targetSessionKey = reroutedTarget.sessionKey;
        targetRole = "researcher";
      }

      const projectBindingPolicy = resolveChannelProjectBindingPolicy(workflowPolicy, {
        messageChannel: ctx.channel,
        channelKey: target.bindingChannelKey,
        sessionKey: targetSessionKey,
      });
      const snapshot = await deps.buildWorkflowSnapshot({
        policy: projectBindingPolicy,
        agentId: target.agentId ?? undefined,
        workspaceDir: target.workspaceDir ?? undefined,
        sessionKey: targetSessionKey ?? undefined,
        messageChannel: ctx.channel,
        channelKey: target.bindingChannelKey ?? undefined,
      });

      const topic = extractQuotedSegment(ctx.args) ?? snapshot.projectId ?? "survey graph build";
      const result = await deps.startBackgroundWorkflowRun({
        workflowRuntime: createWorkflowCommandRuntime({
          api,
          workspaceDir: snapshot.projectRoot ?? target.workspaceDir ?? undefined,
          agentId: "researcher",
          messageChannel: ctx.channel,
        }),
        workflowPolicy,
        agentCtx: {
          agentId: "researcher",
          workspaceDir: target.workspaceDir ?? undefined,
          sessionKey: targetSessionKey ?? undefined,
          sessionId: undefined,
          messageChannel: ctx.channel,
          channelKey: target.bindingChannelKey ?? undefined,
        },
        snapshot,
        backgroundRun: {
          kind: "literature_review",
          commandText: buildLiteratureReviewBackgroundCommand(
            `/literature-review "${topic}"`
          ),
          topic,
          title: topic,
          projectId: snapshot.projectId ?? undefined,
          projectRoot: snapshot.projectRoot ?? undefined,
          summary:
            `Background survey graph build started for ${snapshot.projectId ?? topic}.`,
          extraSystemPrompt: [
            "This continuation is running the dedicated /survey-graph-build flow.",
            "Goal: build a topic-focused survey graph candidate set without blocking the main workflow.",
            "Hard priorities:",
            "1. Prefer papers that are strongly relevant to the requested topic or survey scope.",
            "2. Deduplicate aggressively by canonical identity, DOI, arXiv id, and normalized title before recommending or staging anything.",
            "3. Prefer papers that appear to be missing from the current shared graph or missing from the project's durable survey packet.",
            "4. Do not churn the graph with near-duplicates, weakly related papers, or papers already well covered in the current graph unless they upgrade canonical quality.",
            "5. Materialize a durable packet under {PROJ}/researcher/ describing included candidates, dedupe decisions, likely-missing-in-graph targets, and suggested next import actions.",
            "Required outputs:",
            "- {PROJ}/researcher/SURVEY_GRAPH_BUILD_PACKET.md",
            "- {PROJ}/researcher/SURVEY_GRAPH_BUILD_CANDIDATES.json",
            "- {PROJ}/researcher/SURVEY_GRAPH_BUILD_DEDUPE_LOG.json",
            "- {PROJ}/researcher/SURVEY_GRAPH_BUILD_MISSING_IN_GRAPH.json",
            "Execution guidance:",
            "- Reuse the current literature-review and graph-grounding workflow rather than inventing a parallel state machine.",
            "- If strong candidates are staged locally, schedule imports through research_workflow.schedule_papernexus_import instead of running wrappers inline.",
            "- If remote graph checks are available, prefer graph-aware checks before staging imports so the packet can prioritize graph-missing papers.",
            "- Keep the pass bounded and report the strongest non-duplicate missing papers first.",
          ].join("\n"),
        },
      });

      return {
        text: result.summary,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      api.logger?.warn?.("Failed to start survey graph build background run.", {
        channel: ctx.channel,
        error: message,
      });
      return {
        text: `❌ Failed to start /survey-graph-build: ${message}`,
      };
    }
  };
}

function createIdeaCatalystSearchCommandHandler(
  api: WorkflowCommandApi,
  deps: WorkflowCommandDependencies
) {
  return async (ctx: PluginCommandContext) => {
    try {
      const resolved = await resolveProjectRootForProjectBoundCommand({
        api,
        ctx,
        deps,
        explicitArgument: extractQuotedSegment(ctx.args),
      });
      const depth = hasCommandFlag(ctx.commandBody, "--deep")
        ? "deep"
        : hasCommandFlag(ctx.commandBody, "--quick")
          ? "quick"
          : "default";
      const days = readNumericFlag(ctx.commandBody, "--days") ?? 3650;
      const result = await deps.runIdeaCatalystResearch30({
        projectRoot: resolved.projectRoot,
        days,
        depth,
      });
      return {
        text:
          `IDEA-CATALYST search completed for ${resolved.projectId}.\n` +
          `queries=${result.queryCount}, domains=${result.domainCount}, scout_report_updated=${result.scoutReportUpdated ? "yes" : "no"}\n` +
          `json={PROJ}/${result.reportJsonPath}\nmarkdown={PROJ}/${result.reportMarkdownPath}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        text: `❌ Failed to run /idea-catalyst-search: ${message}`,
      };
    }
  };
}

function createBroadPaperSearchCommandHandler(
  api: WorkflowCommandApi,
  deps: WorkflowCommandDependencies
) {
  return async (ctx: PluginCommandContext) => {
    try {
      const resolved = await resolveProjectRootForProjectBoundCommand({
        api,
        ctx,
        deps,
        explicitArgument: extractQuotedSegment(ctx.args),
      });
      const depth = hasCommandFlag(ctx.commandBody, "--deep")
        ? "deep"
        : hasCommandFlag(ctx.commandBody, "--quick")
          ? "quick"
          : "default";
      const topic =
        extractQuotedSegment(ctx.args) ??
        readString(ctx.args) ??
        resolved.projectId;
      const result = await deps.runBroadPaperSearch({
        projectRoot: resolved.projectRoot,
        topic,
        depth,
      });
      return {
        text:
          `Broad paper search completed for ${resolved.projectId}.\n` +
          `queries=${result.queryPlan.length}, merged_candidates=${result.mergedCandidates.length}, index_updates=${result.sourceIndexUpdate.updatedCanonicalIds.length}\n` +
          `plan={PROJ}/${path.relative(resolved.projectRoot, result.artifacts.queryPlanPath)}\n` +
          `merged={PROJ}/${path.relative(resolved.projectRoot, result.artifacts.mergedCandidatesPath)}\n` +
          `report={PROJ}/${path.relative(resolved.projectRoot, result.artifacts.reportMarkdownPath)}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        text: `❌ Failed to run /broad-paper-search: ${message}`,
      };
    }
  };
}

function createCitationCalibrateCommandHandler(
  api: WorkflowCommandApi,
  deps: WorkflowCommandDependencies
) {
  return async (ctx: PluginCommandContext) => {
    try {
      const resolved = await resolveProjectRootForProjectBoundCommand({
        api,
        ctx,
        deps,
        explicitArgument: extractQuotedSegment(ctx.args),
      });
      const result = await deps.runCitationCalibration({
        projectRoot: resolved.projectRoot,
        replaceArxiv: hasCommandFlag(ctx.commandBody, "--replace-arxiv"),
      });
      return {
        text:
          `Citation calibration completed for ${resolved.projectId}.\n` +
          `verified=${result.verifiedCount}, needs_review=${result.needsReviewCount}, suspicious=${result.suspiciousCount}, hallucinated=${result.hallucinatedCount}\n` +
          `json={PROJ}/${result.reportJsonPath}\nmarkdown={PROJ}/${result.reportMarkdownPath}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        text: `❌ Failed to run /citation-calibrate: ${message}`,
      };
    }
  };
}

function createPapernexusStageRemoteCommandHandler(
  api: WorkflowCommandApi,
  deps: WorkflowCommandDependencies
) {
  return async (ctx: PluginCommandContext) => {
    try {
      const resolved = await resolveProjectRootForProjectBoundCommand({
        api,
        ctx,
        deps,
        explicitArgument: extractQuotedSegment(ctx.args),
      });
      const manifestPath =
        readFlagValue(ctx.commandBody, "--manifest") ??
        "researcher/paper-staging/batch-import.json";
      const result = await deps.stagePapernexusRemoteSources({
        projectRoot: resolved.projectRoot,
        sshTarget: readFlagValue(ctx.commandBody, "--ssh-target"),
        remoteBaseDir: readFlagValue(ctx.commandBody, "--remote-base-dir"),
        manifestPath,
      });
      if (!result.available) {
        return {
          text: `❌ /papernexus-stage-remote unavailable: ${result.error ?? "missing configuration"}`,
        };
      }
      return {
        text:
          `Remote PaperNexus staging completed for ${resolved.projectId}.\n` +
          `report={PROJ}/${result.reportPath}\n` +
          `remote_manifest=${result.rewriteManifestOut ?? "none"}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        text: `❌ Failed to run /papernexus-stage-remote: ${message}`,
      };
    }
  };
}

function createAuthoringCloseoutCommandHandler(
  api: WorkflowCommandApi,
  deps: WorkflowCommandDependencies
) {
  return async (ctx: PluginCommandContext) => {
    try {
      const resolved = await resolveProjectRootForProjectBoundCommand({
        api,
        ctx,
        deps,
        explicitArgument: extractQuotedSegment(ctx.args),
      });
      const result = await deps.reconcileAuthoringCloseout({
        projectRoot: resolved.projectRoot,
        compilePdf: !hasCommandFlag(ctx.commandBody, "--no-compile"),
        autoInjectConferenceCitations: !hasCommandFlag(
          ctx.commandBody,
          "--no-auto-cite"
        ),
      });
      return {
        text:
          `Authoring closeout finished for ${resolved.projectId}.\n` +
          `paper_mode=${result.paperMode}, stage=${result.nextStage}, cites=${result.citeCount}, sections=${result.sectionCount}, pdf=${result.mainPdfExists ? "yes" : "no"}\n` +
          `citation_status=${result.citationIntegrity.verificationStatus}, review_status=${result.reviewSession.status}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        text: `❌ Failed to run /authoring-closeout: ${message}`,
      };
    }
  };
}

function createCaptureDiagnosticsCommandHandler(
  api: WorkflowCommandApi,
  deps: WorkflowCommandDependencies
) {
  return async (ctx: PluginCommandContext) => {
    try {
      const resolved = await resolveProjectRootForProjectBoundCommand({
        api,
        ctx,
        deps,
        explicitArgument: extractQuotedSegment(ctx.args),
      });
      const result = await deps.captureWorkflowDiagnosticBundle({
        projectRoot: resolved.projectRoot,
        workflowPolicy: resolved.workflowPolicy,
        agentCtx: {
          agentId: resolved.target.agentId ?? undefined,
          workspaceDir: resolved.target.workspaceDir ?? undefined,
          sessionKey: resolved.target.sessionKey ?? undefined,
          messageChannel: ctx.channel,
          channelKey: resolved.target.bindingChannelKey ?? undefined,
        },
        reason: readFlagValue(ctx.commandBody, "--reason") ?? "manual_capture",
        tailLines: readNumericFlag(ctx.commandBody, "--tail") ?? 200,
      });
      return {
        text:
          `Diagnostic bundle captured for ${resolved.projectId}.\n` +
          `bundle={PROJ}/${result.bundleRelativeDir}\n` +
          `summary={PROJ}/${result.summaryRelativePath}\n` +
          `index={PROJ}/${result.indexRelativePath}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        text: `❌ Failed to run /capture-diagnostics: ${message}`,
      };
    }
  };
}

async function maybeReplayQueuedWorkflowRunsFromCommandRuntime(
  api: WorkflowCommandApi,
  workflowPolicy: ReturnType<typeof getWorkflowGuardPolicy>,
  messageChannel = "discord"
): Promise<void> {
  if (!workflowPolicy.projectsRoot) {
    return;
  }
  try {
    await Promise.race([
      drainQueuedBackgroundWorkflowRuns({
        workflowRuntime: createWorkflowCommandRuntime({
          api,
          workspaceDir: workflowPolicy.projectsRoot,
          messageChannel,
        }),
        workflowPolicy,
        projectsRoot: workflowPolicy.projectsRoot,
        ignoreRetryBackoff: true,
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("workflow command queue replay timed out")),
          750
        )
      ),
    ]);
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
      name: "auto-research",
      description:
        "Start the full automated research pipeline from only a topic by bootstrapping a project and running the main pipeline in the background.",
      acceptsArgs: true,
      handler: createAutoResearchCommandHandler(api, resolvedDeps),
    },
    {
      name: "auto-review",
      description:
        "Start the full automated survey pipeline from only a topic by bootstrapping a survey project and running the survey line in the background.",
      acceptsArgs: true,
      handler: createAutoReviewCommandHandler(api, resolvedDeps),
    },
    {
      name: "bind-project",
      description:
        "Bind the current channel to an existing workflow project by project id or absolute project path.",
      acceptsArgs: true,
      handler: createBindProjectCommandHandler(api, resolvedDeps),
    },
    {
      name: "clear-project-binding",
      description:
        "Clear the current channel's workflow project binding. Must be called inside the channel you want to unbind.",
      acceptsArgs: false,
      handler: createClearProjectBindingCommandHandler(api, resolvedDeps),
    },
    {
      name: "clear-projects-state",
      description:
        "Clear every project registry entry from PROJECTS_STATE.json while preserving project directories and other workflow files.",
      acceptsArgs: true,
      handler: createClearProjectsStateCommandHandler(api),
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
      name: "survey-graph-build",
      description:
        "Run a non-blocking survey graph candidate build focused on topic relevance, aggressive dedupe, and graph-missing papers.",
      acceptsArgs: true,
      handler: createSurveyGraphBuildCommandHandler(api, resolvedDeps),
    },
    {
      name: "workflow-status",
      description:
        "Show the current workflow snapshot for this bound conversation or workflow session.",
      acceptsArgs: false,
      handler: createWorkflowStatusCommandHandler(api, resolvedDeps),
    },
    {
      name: "handoff-status",
      description:
        "Show the current handoff control-plane status for this project, including pending intent, queue depth, mailbox backlog, and binding gate state.",
      acceptsArgs: true,
      handler: createHandoffStatusCommandHandler(api, resolvedDeps),
    },
    {
      name: "idea-catalyst-search",
      description:
        "Run the workflow-owned research30 cross-domain search for the current project's IDEA-CATALYST scouting state.",
      acceptsArgs: true,
      handler: createIdeaCatalystSearchCommandHandler(api, resolvedDeps),
    },
    {
      name: "broad-paper-search",
      description:
        "Run the broad multi-provider literature search backbone for the current project topic and persist merged paper candidates.",
      acceptsArgs: true,
      handler: createBroadPaperSearchCommandHandler(api, resolvedDeps),
    },
    {
      name: "citation-calibrate",
      description:
        "Run citation calibration for the current project and refresh reviewer-side verification artifacts.",
      acceptsArgs: true,
      handler: createCitationCalibrateCommandHandler(api, resolvedDeps),
    },
    {
      name: "papernexus-stage-remote",
      description:
        "Upload the current project's staged PDF/Markdown sources to the configured remote PaperNexus staging host.",
      acceptsArgs: true,
      handler: createPapernexusStageRemoteCommandHandler(api, resolvedDeps),
    },
    {
      name: "authoring-closeout",
      description:
        "Reconcile writing/review/QC state for the current project and attempt a deterministic paper closeout.",
      acceptsArgs: true,
      handler: createAuthoringCloseoutCommandHandler(api, resolvedDeps),
    },
    {
      name: "capture-diagnostics",
      description:
        "Capture a bounded workflow diagnostic bundle for the current project, including snapshot, runtime health, handoff, queue, mailbox, graph, and key log tails.",
      acceptsArgs: true,
      handler: createCaptureDiagnosticsCommandHandler(api, resolvedDeps),
    },
    {
      name: "autoresearch-buttons-test",
      description:
        "Send a reusable Discord-native AutoResearch button test panel; button clicks only post test messages.",
      acceptsArgs: true,
      handler: createDiscordButtonsTestCommandHandler(),
    },
    {
      name: "show-commands",
      description:
        "List the available workflow slash commands and when to use them.",
      acceptsArgs: false,
      handler: createShowCommandsCommandHandler(),
    },
    {
      name: "autoresearch-panel",
      description:
        "Post a reusable Discord-native channel control panel with the five stable workflow buttons.",
      acceptsArgs: false,
      handler: createAutoresearchPanelCommandHandler(),
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
