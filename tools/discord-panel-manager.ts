import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { OpenClawPluginCommandResponse } from "../runtime-api.js";
import type { PluginRegistrationContext, ApiLike } from "./plugin-registration-shared";
import { resolvePluginConfig } from "./plugin-registration-shared";

const AUTORESEARCH_DISCORD_PANEL_NAMESPACE = "autoresearch-panel";
const AUTORESEARCH_DISCORD_PANEL_STATE_FILE = "autoresearch-discord-panel.json";
const DEFAULT_REFRESH_INTERVAL_MS = 20 * 60 * 1000;
const DEFAULT_ACTIVE_ACTION_TTL_MS = 10 * 60 * 1000;
const DEFAULT_STARTUP_REFRESH_DELAY_MS = 2 * 60 * 1000;

type DiscordPanelActionMode = "test_panel" | "test_message" | "workflow";
type DiscordPanelButtonStyle = "primary" | "secondary" | "success" | "danger";

type DiscordPanelButton = {
  action: DiscordPanelAction;
  label: string;
  style: DiscordPanelButtonStyle;
  command: string;
  guarded: boolean;
};

type DiscordPanelAction =
  | "status"
  | "resume"
  | "graph"
  | "handoff"
  | "commands";

type DiscordComponentMessageSpec = {
  text?: string;
  reusable?: boolean;
  container?: {
    accentColor?: string | number;
    spoiler?: boolean;
  };
  blocks?: Array<Record<string, unknown>>;
};

type DiscordPanelConfig = {
  enabled: boolean;
  channelId: string | null;
  accountId: string | null;
  actionMode: DiscordPanelActionMode;
  refreshIntervalMs: number;
  startupRefreshDelayMs: number;
  activeActionTtlMs: number;
};

type DiscordPanelState = {
  channelId: string;
  accountId: string | null;
  messageId: string | null;
  createdAt: number;
  updatedAt: number;
  lastReason?: string;
  lastAction?: {
    action: DiscordPanelAction;
    label: string;
    mode: DiscordPanelActionMode;
    senderId?: string;
    at: number;
    summary: string;
  };
  activeAction?: {
    action: DiscordPanelAction;
    label: string;
    senderId?: string;
    startedAt: number;
    expiresAt: number;
    summary: string;
  };
};

type DiscordPanelLogger = {
  debug?: (message: string, meta?: Record<string, unknown>) => void;
  info?: (message: string, meta?: Record<string, unknown>) => void;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
  error?: (message: string, meta?: Record<string, unknown>) => void;
};

type DiscordPanelServiceContext = {
  config: Record<string, unknown>;
  stateDir: string;
  logger: DiscordPanelLogger;
};

type DiscordPanelInteractiveContext = {
  channel: "discord";
  accountId: string;
  conversationId: string;
  parentConversationId?: string;
  guildId?: string;
  senderId?: string;
  senderUsername?: string;
  auth: {
    isAuthorizedSender: boolean;
  };
  interaction: {
    kind: "button" | "select" | "modal";
    data: string;
    namespace: string;
    payload: string;
    messageId?: string;
    values?: string[];
    fields?: Array<{ id: string; name: string; values: string[] }>;
  };
  respond: {
    acknowledge: () => Promise<void>;
    reply: (params: { text: string; ephemeral?: boolean }) => Promise<void>;
    followUp: (params: { text: string; ephemeral?: boolean }) => Promise<void>;
  };
  requestConversationBinding: (...args: any[]) => Promise<unknown>;
  detachConversationBinding: (...args: any[]) => Promise<unknown>;
  getCurrentConversationBinding: (...args: any[]) => Promise<unknown>;
};

type DiscordPanelSendResult = {
  messageId: string | null;
  channelId: string | null;
};

type DiscordPanelDeps = {
  now?: () => number;
  sendPanelMessage?: (params: {
    api: ApiLike;
    config: DiscordPanelConfig;
    spec: DiscordComponentMessageSpec;
  }) => Promise<DiscordPanelSendResult>;
  editPanelMessage?: (params: {
    api: ApiLike;
    config: DiscordPanelConfig;
    messageId: string;
    spec: DiscordComponentMessageSpec;
  }) => Promise<DiscordPanelSendResult>;
};

type WorkflowCommandsModule = {
  createResearchWorkflowCommands: (api: any) => Array<{
    name: string;
    handler: (ctx: any) => Promise<OpenClawPluginCommandResponse> | OpenClawPluginCommandResponse;
  }>;
};

type DiscordRuntimeFacade = {
  editDiscordComponentMessage?: (
    to: string,
    messageId: string,
    spec: DiscordComponentMessageSpec,
    opts: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
};

let workflowCommandsModulePromise: Promise<WorkflowCommandsModule> | null = null;
let discordRuntimeFacadePromise: Promise<DiscordRuntimeFacade> | null = null;
const dynamicImport = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<unknown>;

async function loadWorkflowCommandsModule(): Promise<WorkflowCommandsModule> {
  if (!workflowCommandsModulePromise) {
    workflowCommandsModulePromise = dynamicImport(
      new URL("./workflow-commands.js", import.meta.url).href
    ).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND") {
        throw error;
      }
      return dynamicImport(new URL("./workflow-commands.ts", import.meta.url).href);
    }) as Promise<WorkflowCommandsModule>;
  }
  return workflowCommandsModulePromise;
}

function resolveOpenClawHome(): string {
  return readString(process.env.OPENCLAW_HOME) ?? path.join(os.homedir(), ".openclaw");
}

function resolveDiscordRuntimeFacadeImportSpecifiers(): string[] {
  const specifiers = [
    pathToFileURL(
      path.join(
        resolveOpenClawHome(),
        "npm",
        "node_modules",
        "@openclaw",
        "discord",
        "dist",
        "runtime-api.js"
      )
    ).href,
  ];
  const openclawDistEntry = process.argv.find((entry) =>
    /(?:^|[/\\])openclaw[/\\]dist[/\\]index\.js$/i.test(entry)
  );
  if (openclawDistEntry) {
    const openclawRoot = path.dirname(path.dirname(openclawDistEntry));
    specifiers.push(
      pathToFileURL(path.join(openclawRoot, "dist", "plugin-sdk", "discord.js")).href
    );
  }
  specifiers.push("openclaw/plugin-sdk/discord");
  return Array.from(new Set(specifiers));
}

async function loadDiscordRuntimeFacade(): Promise<DiscordRuntimeFacade> {
  if (!discordRuntimeFacadePromise) {
    discordRuntimeFacadePromise = (async () => {
      const errors: string[] = [];
      for (const specifier of resolveDiscordRuntimeFacadeImportSpecifiers()) {
        try {
          const facade = (await dynamicImport(specifier)) as DiscordRuntimeFacade;
          if (typeof facade.editDiscordComponentMessage === "function") {
            return facade;
          }
          errors.push(`${specifier}: editDiscordComponentMessage missing`);
        } catch (error) {
          errors.push(
            `${specifier}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
      throw new Error(
        `OpenClaw Discord component edit facade is unavailable: ${errors.join("; ")}`
      );
    })();
  }
  return discordRuntimeFacadePromise;
}

const PANEL_BUTTONS: DiscordPanelButton[] = [
  {
    action: "status",
    label: "Status",
    style: "primary",
    command: "/workflow-status",
    guarded: false,
  },
  {
    action: "resume",
    label: "Resume",
    style: "secondary",
    command: "/resume-pipeline",
    guarded: true,
  },
  {
    action: "graph",
    label: "Graph",
    style: "secondary",
    command: "/graph-build",
    guarded: true,
  },
  {
    action: "handoff",
    label: "Handoff",
    style: "secondary",
    command: "/handoff-status",
    guarded: false,
  },
  {
    action: "commands",
    label: "Commands",
    style: "secondary",
    command: "/show-commands",
    guarded: false,
  },
];

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function resolvePanelConfig(config: Record<string, unknown> | undefined): DiscordPanelConfig {
  const raw =
    readObject(config?.discordPanel) ??
    readObject(config?.autoresearchDiscordPanel) ??
    {};
  const envChannelId = readString(process.env.CLAW_AUTORESEARCH_DISCORD_PANEL_CHANNEL_ID);
  const channelId = readString(raw.channelId) ?? envChannelId;
  const rawActionMode = readString(raw.actionMode);
  const actionMode: DiscordPanelActionMode =
    rawActionMode === "test_message" || rawActionMode === "workflow"
      ? rawActionMode
      : "test_panel";
  return {
    enabled: raw.enabled === true || Boolean(envChannelId && raw.enabled !== false),
    channelId,
    accountId: readString(raw.accountId),
    actionMode,
    refreshIntervalMs: readPositiveNumber(raw.refreshIntervalMs, DEFAULT_REFRESH_INTERVAL_MS),
    startupRefreshDelayMs: readPositiveNumber(
      raw.startupRefreshDelayMs,
      DEFAULT_STARTUP_REFRESH_DELAY_MS
    ),
    activeActionTtlMs: readPositiveNumber(
      raw.activeActionTtlMs,
      DEFAULT_ACTIVE_ACTION_TTL_MS
    ),
  };
}

function statePathFor(ctx: Pick<DiscordPanelServiceContext, "stateDir">): string {
  return path.join(ctx.stateDir, AUTORESEARCH_DISCORD_PANEL_STATE_FILE);
}

async function readPanelState(statePath: string): Promise<DiscordPanelState | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(statePath, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed as DiscordPanelState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writePanelState(statePath: string, state: DiscordPanelState): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const tmpPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, statePath);
}

function resolveAction(payload: string): DiscordPanelButton | null {
  const action = payload.trim().toLowerCase();
  return PANEL_BUTTONS.find((button) => button.action === action) ?? null;
}

function formatDiscordTarget(channelId: string): string {
  return channelId.startsWith("channel:") || channelId.startsWith("user:")
    ? channelId
    : `channel:${channelId}`;
}

function formatPanelMode(mode: DiscordPanelActionMode): string {
  if (mode === "workflow") {
    return "workflow";
  }
  if (mode === "test_message") {
    return "test-message";
  }
  return "test-panel";
}

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", {
    hour12: false,
    timeZone: "Asia/Shanghai",
  });
}

function buildPanelText(params: {
  config: DiscordPanelConfig;
  state?: DiscordPanelState | null;
  now: number;
  summary?: string;
}): string {
  const lines = [
    "### AutoResearch 控制面板",
    "> - [x] 只读频道：用按钮查看状态或触发可重试动作",
    "> - [x] 项目、论文、track 选择会走下拉列表",
    `> - [ ] 模式：${formatPanelMode(params.config.actionMode)}`,
  ];
  const active = params.state?.activeAction;
  if (active && active.expiresAt > params.now) {
    lines.push(
      `运行中：${active.label} started ${formatClock(active.startedAt)}，重复点击会返回状态。`
    );
  }
  const summary = params.summary ?? params.state?.lastAction?.summary;
  if (summary) {
    lines.push(`最近：${summary}`);
  }
  return lines.join("\n");
}

function buildSupersededPanelComponentSpec(): DiscordComponentMessageSpec {
  return {
    text: "AutoResearch 控制面板已刷新，请使用频道里的最新面板。",
  };
}

export function buildAutoresearchDiscordPanelComponentSpec(params: {
  config: DiscordPanelConfig;
  state?: DiscordPanelState | null;
  now?: number;
  summary?: string;
}): DiscordComponentMessageSpec {
  const now = params.now ?? Date.now();
  return {
    text: buildPanelText({
      config: params.config,
      state: params.state,
      now,
      summary: params.summary,
    }),
    reusable: true,
    blocks: [
      {
        type: "actions",
        buttons: PANEL_BUTTONS.map((button) => ({
          label: button.label,
          style: button.style,
          callbackData: `${AUTORESEARCH_DISCORD_PANEL_NAMESPACE}:${button.action}`,
        })),
      },
    ],
  };
}

async function sendAutoresearchDiscordPanelMessage(params: {
  api: ApiLike;
  config: DiscordPanelConfig;
  spec: DiscordComponentMessageSpec;
}): Promise<DiscordPanelSendResult> {
  if (!params.config.channelId) {
    throw new Error("AutoResearch Discord panel channelId is not configured.");
  }
  const adapter = await params.api.runtime?.channel?.outbound?.loadAdapter?.("discord");
  if (!adapter?.sendPayload) {
    throw new Error("Discord outbound adapter does not expose sendPayload.");
  }
  const text = params.spec.text ?? "";
  const result = await adapter.sendPayload({
    cfg: params.api.config ?? {},
    to: formatDiscordTarget(params.config.channelId),
    text,
    accountId: params.config.accountId ?? undefined,
    payload: {
      text,
      channelData: {
        discord: {
          components: params.spec,
        },
      },
    },
  });
  return {
    messageId: readString(result?.messageId),
    channelId: readString(result?.channelId),
  };
}

async function editAutoresearchDiscordPanelMessage(params: {
  api: ApiLike;
  config: DiscordPanelConfig;
  messageId: string;
  spec: DiscordComponentMessageSpec;
}): Promise<DiscordPanelSendResult> {
  if (!params.config.channelId) {
    throw new Error("AutoResearch Discord panel channelId is not configured.");
  }
  const discord = await loadDiscordRuntimeFacade();
  if (typeof discord.editDiscordComponentMessage !== "function") {
    throw new Error("OpenClaw Discord component edit facade is unavailable.");
  }
  const result = await discord.editDiscordComponentMessage(
    formatDiscordTarget(params.config.channelId),
    params.messageId,
    params.spec,
    {
      cfg: params.api.config ?? {},
      accountId: params.config.accountId ?? undefined,
    }
  );
  return {
    messageId: readString(result?.id) ?? params.messageId,
    channelId: readString(result?.channel_id),
  };
}

async function ensureAutoresearchDiscordPanel(params: {
  api: ApiLike;
  config: DiscordPanelConfig;
  statePath: string;
  logger?: DiscordPanelLogger;
  deps?: DiscordPanelDeps;
  reason: string;
  replaceOnEditFailure?: boolean;
}): Promise<DiscordPanelState | null> {
  if (!params.config.enabled || !params.config.channelId) {
    params.logger?.debug?.("AutoResearch Discord panel is disabled or missing channelId.", {
      enabled: params.config.enabled,
      hasChannelId: Boolean(params.config.channelId),
      reason: params.reason,
    });
    return null;
  }

  const now = params.deps?.now?.() ?? Date.now();
  const previous = await readPanelState(params.statePath);
  const baseState: DiscordPanelState = {
    channelId: params.config.channelId,
    accountId: params.config.accountId,
    messageId: null,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    lastReason: params.reason,
    lastAction: previous?.lastAction,
    activeAction: previous?.activeAction,
  };
  const spec = buildAutoresearchDiscordPanelComponentSpec({
    config: params.config,
    state: previous,
    now,
  });
  const editPanel = params.deps?.editPanelMessage ?? editAutoresearchDiscordPanelMessage;
  const sendPanel = params.deps?.sendPanelMessage ?? sendAutoresearchDiscordPanelMessage;
  const canEdit =
    Boolean(previous?.messageId) &&
    previous?.channelId === params.config.channelId &&
    (previous.accountId ?? null) === params.config.accountId;

  if (canEdit && previous?.messageId) {
    try {
      const edited = await editPanel({
        api: params.api,
        config: params.config,
        messageId: previous.messageId,
        spec,
      });
      const state = {
        ...baseState,
        messageId: edited.messageId ?? previous.messageId,
      };
      await writePanelState(params.statePath, state);
      params.logger?.info?.("AutoResearch Discord panel refreshed.", {
        reason: params.reason,
        channelId: params.config.channelId,
        accountId: params.config.accountId,
        messageId: state.messageId,
      });
      return state;
    } catch (error) {
      if (params.replaceOnEditFailure === false) {
        params.logger?.warn?.("AutoResearch Discord panel edit failed; keeping existing panel.", {
          reason: params.reason,
          channelId: params.config.channelId,
          accountId: params.config.accountId,
          messageId: previous.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        const state = {
          ...baseState,
          messageId: previous.messageId,
        };
        await writePanelState(params.statePath, state);
        return state;
      }
      params.logger?.warn?.("AutoResearch Discord panel edit failed; sending a fresh panel.", {
        reason: params.reason,
        channelId: params.config.channelId,
        accountId: params.config.accountId,
        messageId: previous.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const sent = await sendPanel({
    api: params.api,
    config: params.config,
    spec,
  });
  if (previous?.messageId && sent.messageId && previous.messageId !== sent.messageId) {
    await editPanel({
      api: params.api,
      config: params.config,
      messageId: previous.messageId,
      spec: buildSupersededPanelComponentSpec(),
    }).catch((error) => {
      params.logger?.warn?.("AutoResearch Discord stale panel cleanup failed.", {
        reason: params.reason,
        channelId: params.config.channelId,
        accountId: params.config.accountId,
        messageId: previous.messageId,
        replacementMessageId: sent.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
  const state = {
    ...baseState,
    messageId: sent.messageId,
  };
  await writePanelState(params.statePath, state);
  params.logger?.info?.("AutoResearch Discord panel sent.", {
    reason: params.reason,
    channelId: params.config.channelId,
    accountId: params.config.accountId,
    messageId: state.messageId,
  });
  return state;
}

function isActiveGuard(state: DiscordPanelState | null, now: number): boolean {
  return Boolean(state?.activeAction && state.activeAction.expiresAt > now);
}

function truncateSummary(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}

function commandNameFromLabel(label: string): string {
  return label.replace(/^\//, "");
}

function renderCommandResponse(result: OpenClawPluginCommandResponse): string {
  if (typeof result.text === "string" && result.text.trim()) {
    return result.text.trim();
  }
  if (result.presentation?.title) {
    return result.presentation.title;
  }
  return "命令已处理。";
}

function formatDiscordConversationSource(conversationId: string): string {
  return conversationId.startsWith("discord:")
    ? conversationId
    : `discord:${conversationId}`;
}

async function runWorkflowPanelCommand(params: {
  api: ApiLike;
  ctx: DiscordPanelInteractiveContext;
  button: DiscordPanelButton;
}): Promise<string> {
  const { createResearchWorkflowCommands } = await loadWorkflowCommandsModule();
  const commands = createResearchWorkflowCommands(params.api);
  const command = commands.find(
    (entry) => entry.name === commandNameFromLabel(params.button.command)
  );
  if (!command) {
    return `${params.button.command} 当前不可用。`;
  }
  const result = await command.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: params.button.command,
    args: undefined,
    config: resolvePluginConfig(params.api) ?? {},
    from: formatDiscordConversationSource(params.ctx.conversationId),
    to: params.ctx.conversationId,
    accountId: params.ctx.accountId,
    senderId: params.ctx.senderId,
    requestConversationBinding: params.ctx.requestConversationBinding,
    detachConversationBinding: params.ctx.detachConversationBinding,
    getCurrentConversationBinding: params.ctx.getCurrentConversationBinding,
    commandSource: "native",
  } as Parameters<typeof command.handler>[0] & { commandSource: "native" });
  return renderCommandResponse(result);
}

async function publishPanelFeedback(params: {
  api: ApiLike;
  ctx: DiscordPanelInteractiveContext;
  config: DiscordPanelConfig;
  statePath: string | null;
  state: DiscordPanelState | null;
  summary: string;
  logger?: DiscordPanelLogger;
  deps?: DiscordPanelDeps;
}): Promise<void> {
  const now = params.deps?.now?.() ?? Date.now();
  const messageId = params.state?.messageId ?? readString(params.ctx.interaction.messageId);
  if (!messageId || !params.config.channelId) {
    await params.ctx.respond.followUp({
      text: params.summary,
      ephemeral: true,
    });
    return;
  }
  const spec = buildAutoresearchDiscordPanelComponentSpec({
    config: params.config,
    state: params.state,
    now,
    summary: params.summary,
  });
  try {
    const editPanel = params.deps?.editPanelMessage ?? editAutoresearchDiscordPanelMessage;
    await editPanel({
      api: params.api,
      config: params.config,
      messageId,
      spec,
    });
  } catch (error) {
    params.logger?.warn?.("AutoResearch Discord panel feedback edit failed.", {
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    await params.ctx.respond.followUp({
      text: params.summary,
      ephemeral: true,
    });
  }
}

function createPanelInteractiveHandler(params: {
  api: ApiLike;
  getConfig: () => Record<string, unknown> | undefined;
  getStatePath: () => string | null;
  logger?: DiscordPanelLogger;
  deps?: DiscordPanelDeps;
}) {
  return async (ctx: DiscordPanelInteractiveContext) => {
    const button = resolveAction(ctx.interaction.payload);
    if (!button) {
      await ctx.respond.followUp({
        text: "AutoResearch 面板按钮无法识别，请等待面板自动刷新后重试。",
        ephemeral: true,
      });
      return { handled: true };
    }
    await ctx.respond.acknowledge().catch((error) => {
      params.logger?.warn?.("AutoResearch Discord panel acknowledge failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    const config = resolvePanelConfig(params.getConfig());
    if (ctx.auth.isAuthorizedSender === false) {
      await ctx.respond.followUp({
        text: "你没有执行 AutoResearch 面板按钮的权限。",
        ephemeral: true,
      });
      return { handled: true };
    }

    const statePath = params.getStatePath();
    const now = params.deps?.now?.() ?? Date.now();
    const previous = statePath ? await readPanelState(statePath) : null;
    if (button.guarded && isActiveGuard(previous, now)) {
      const active = previous?.activeAction;
      const summary = active
        ? `${active.label} 正在执行或刚刚排队；不会重复启动。${active.summary}`
        : `${button.label} 正在执行或刚刚排队；不会重复启动。`;
      await publishPanelFeedback({
        api: params.api,
        ctx,
        config,
        statePath,
        state: previous,
        summary,
        logger: params.logger,
        deps: params.deps,
      });
      return { handled: true };
    }

    let summary: string;
    let nextState: DiscordPanelState | null = previous;
    if (config.actionMode === "workflow") {
      if (button.guarded && previous && statePath) {
        nextState = {
          ...previous,
          activeAction: {
            action: button.action,
            label: button.label,
            senderId: ctx.senderId,
            startedAt: now,
            expiresAt: now + config.activeActionTtlMs,
            summary: `${button.command} 已接收。`,
          },
          updatedAt: now,
        };
        await writePanelState(statePath, nextState);
      }
      summary = truncateSummary(await runWorkflowPanelCommand({ api: params.api, ctx, button }));
    } else {
      summary = `${button.label} 测试触发成功：${button.command} 未执行。`;
    }

    if (statePath) {
      const base = nextState ?? {
        channelId: config.channelId ?? ctx.conversationId.replace(/^channel:/, ""),
        accountId: config.accountId,
        messageId: readString(ctx.interaction.messageId),
        createdAt: now,
        updatedAt: now,
      };
      nextState = {
        ...base,
        channelId: config.channelId ?? base.channelId,
        accountId: config.accountId,
        updatedAt: now,
        lastAction: {
          action: button.action,
          label: button.label,
          mode: config.actionMode,
          senderId: ctx.senderId,
          at: now,
          summary,
        },
        activeAction:
          config.actionMode === "workflow" && button.guarded
            ? base.activeAction
            : base.activeAction && base.activeAction.expiresAt > now
              ? base.activeAction
              : undefined,
      };
      await writePanelState(statePath, nextState);
    }

    if (config.actionMode === "test_message") {
      await ctx.respond.followUp({
        text: summary,
        ephemeral: false,
      });
      return { handled: true };
    }

    await publishPanelFeedback({
      api: params.api,
      ctx,
      config,
      statePath,
      state: nextState,
      summary,
      logger: params.logger,
      deps: params.deps,
    });
    return { handled: true };
  };
}

export function registerAutoresearchDiscordPanel(
  plugin: PluginRegistrationContext,
  deps: DiscordPanelDeps = {}
) {
  let panelStatePath: string | null = null;
  const getConfig = () => plugin.getPluginConfig();
  if (typeof plugin.api.registerInteractiveHandler === "function") {
    plugin.api.registerInteractiveHandler({
      channel: "discord",
      namespace: AUTORESEARCH_DISCORD_PANEL_NAMESPACE,
      handler: createPanelInteractiveHandler({
        api: plugin.api,
        getConfig,
        getStatePath: () => panelStatePath,
        logger: plugin.api.logger,
        deps,
      }),
    });
  } else {
    plugin.api.logger?.warn?.("OpenClaw interactive handler API is unavailable.", {
      namespace: AUTORESEARCH_DISCORD_PANEL_NAMESPACE,
    });
  }

  if (typeof plugin.api.registerService !== "function") {
    return;
  }

  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let startupRefreshHandle: ReturnType<typeof setTimeout> | null = null;
  let refreshInFlight: Promise<void> = Promise.resolve();
  plugin.api.registerService({
    id: "autoresearch-discord-panel",
    async start(ctx) {
      panelStatePath = statePathFor(ctx);
      const refresh = async (
        reason: string,
        options: { replaceOnEditFailure?: boolean } = {}
      ) => {
        const config = resolvePanelConfig(resolvePluginConfig(plugin.api) ?? ctx.config);
        await ensureAutoresearchDiscordPanel({
          api: plugin.api,
          config,
          statePath: panelStatePath as string,
          logger: ctx.logger,
          deps,
          reason,
          replaceOnEditFailure: options.replaceOnEditFailure,
        }).catch((error) => {
          ctx.logger.warn?.("AutoResearch Discord panel refresh failed.", {
            reason,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      };
      const enqueueRefresh = (
        reason: string,
        options: { replaceOnEditFailure?: boolean } = {}
      ) => {
        refreshInFlight = refreshInFlight
          .catch(() => undefined)
          .then(() => refresh(reason, options));
        return refreshInFlight;
      };

      await enqueueRefresh("startup", { replaceOnEditFailure: true });
      const config = resolvePanelConfig(resolvePluginConfig(plugin.api) ?? ctx.config);
      if (!config.enabled || !config.channelId) {
        return;
      }
      startupRefreshHandle = setTimeout(
        () => void enqueueRefresh("startup-delayed", { replaceOnEditFailure: false }),
        config.startupRefreshDelayMs
      );
      startupRefreshHandle.unref?.();
      intervalHandle = setInterval(
        () => void enqueueRefresh("interval", { replaceOnEditFailure: false }),
        config.refreshIntervalMs
      );
      intervalHandle.unref?.();
    },
    stop() {
      if (startupRefreshHandle) {
        clearTimeout(startupRefreshHandle);
        startupRefreshHandle = null;
      }
      if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
    },
  });
}
