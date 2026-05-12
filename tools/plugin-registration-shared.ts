import {
  ensureChannelProjectBindingForWorkflow,
  getWorkflowGuardPolicy,
} from "./workflow-guard";
import { isProjectWorkflowAgentId } from "./workflow-agent-isolation.js";
import type {
  OpenClawPluginCommandDefinition,
  OpenClawPluginInteractiveHandlerRegistration,
  OpenClawPluginService,
} from "../runtime-api.js";
import { enqueueWorkflowTask } from "./workflow-coordination";
import { resolveBindingChannelKeyFromContext } from "./workflow-commands/parsers.js";

export type ToolContext = {
  workspaceDir?: string;
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  channelKey?: string;
  sandboxed?: boolean;
};

export type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (_id: string, params: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string }>;
  }>;
};

export type ApiLike = {
  config?: Record<string, unknown>;
  pluginConfig?: Record<string, unknown>;
  runtime?: {
    subagent?: {
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
      deleteSession?: (params: {
        sessionKey: string;
        deleteTranscript?: boolean;
      }) => Promise<void>;
    };
    agent?: {
      runEmbeddedAgent?: (params: Record<string, unknown>) => Promise<unknown>;
      resolveAgentDir?: (cfg: unknown, agentId?: string) => string;
      resolveAgentWorkspaceDir?: (cfg: unknown, agentId?: string) => string;
      resolveAgentTimeoutMs?: (cfg: unknown) => number;
      session?: {
        resolveStorePath?: (store?: string, opts?: { agentId?: string }) => string;
        loadSessionStore?: (storePath: string) => Record<string, unknown>;
        saveSessionStore?: (
          storePath: string,
          store: Record<string, unknown>
        ) => Promise<void>;
        resolveSessionFilePath?: (
          sessionId: string,
          sessionEntry?: Record<string, unknown>,
          opts?: { agentId?: string; sessionsDir?: string }
        ) => string;
      };
    };
    channel?: {
      outbound?: {
        loadAdapter?: (id: string) => Promise<
          | {
              sendPayload?: (ctx: Record<string, unknown>) => Promise<Record<string, unknown>>;
            }
          | undefined
        >;
      };
    };
  };
  logger?: {
    debug?: (message: string, meta?: Record<string, unknown>) => void;
    info?: (message: string, meta?: Record<string, unknown>) => void;
    warn?: (message: string, meta?: Record<string, unknown>) => void;
    error?: (message: string, meta?: Record<string, unknown>) => void;
  };
  registerTool: (
    spec: ToolSpec | ((ctx: ToolContext) => ToolSpec | null | undefined),
    options?: { optional?: boolean }
  ) => void;
  registerCommand?: (command: OpenClawPluginCommandDefinition) => void;
  registerService?: (service: OpenClawPluginService) => void;
  registerInteractiveHandler?: (
    registration: OpenClawPluginInteractiveHandlerRegistration
  ) => void;
  on?: (
    hookName: string,
    handler: (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown,
    options?: { priority?: number }
  ) => void;
};

export type PluginRegistrationContext = {
  api: ApiLike;
  getPluginConfig: () => Record<string, unknown> | undefined;
  getMemoryPolicy: () => ReturnType<typeof getResearchMemoryPolicy>;
  getWorkflowPolicy: () => ReturnType<typeof getWorkflowGuardPolicy>;
};

export function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function getResearchMemoryPolicy(config: Record<string, unknown> | undefined) {
  return {
    allowWorkspaceFallback: config?.allowWorkspaceFallback === true,
    requireProjectIsolation: config?.requireProjectIsolation !== false,
    requireProjectIdInEntries: config?.requireProjectIdInEntries !== false,
    requireTrackId: config?.requireTrackId !== false,
    requireEvidencePointers: config?.requireEvidencePointers !== false,
    reviewStateMaxAgeHours:
      typeof config?.reviewStateMaxAgeHours === "number"
        ? config.reviewStateMaxAgeHours
        : 24,
    projectsRoot: readString(config?.projectsRoot),
    enableChannelProjectBindings: config?.enableChannelProjectBindings === true,
    channelProjectBindingsPath: readString(config?.channelProjectBindingsPath),
    defaultConferenceTemplatePath: readString(config?.defaultConferenceTemplatePath),
    defaultJournalTemplatePath: readString(config?.defaultJournalTemplatePath),
  };
}

export function requireObject<T>(value: unknown, label: string): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is required for this action.`);
  }
  return value as T;
}

export function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function resolvePluginConfig(api: ApiLike): Record<string, unknown> | undefined {
  if (api.config && api.pluginConfig) {
    return {
      ...api.config,
      ...api.pluginConfig,
    };
  }
  return api.pluginConfig ?? api.config;
}

export function createPluginRegistrationContext(
  api: ApiLike
): PluginRegistrationContext {
  const getPluginConfig = () => resolvePluginConfig(api);
  return {
    api,
    getPluginConfig,
    getMemoryPolicy: () => getResearchMemoryPolicy(getPluginConfig()),
    getWorkflowPolicy: () => getWorkflowGuardPolicy(getPluginConfig()),
  };
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function inferAgentIdFromPath(value: string | undefined): string | undefined {
  const raw = readString(value);
  if (!raw) {
    return undefined;
  }
  const normalized = raw.replace(/\\/g, "/");
  const workspaceMatch = normalized.match(/\/workspace-([^/]+)\/?$/i);
  if (workspaceMatch?.[1]) {
    return workspaceMatch[1];
  }
  const agentDirMatch = normalized.match(/\/agents\/([^/]+)\/agent(?:\/|$)/i);
  if (agentDirMatch?.[1]) {
    return agentDirMatch[1];
  }
  return undefined;
}

export function getToolContext(ctx: Record<string, unknown>): ToolContext {
  const workspaceDir = readString(ctx.workspaceDir) ?? readString(ctx.cwd);
  const messageChannel = readString(ctx.messageChannel) ?? readString(ctx.channel);
  const channelKey =
    resolveBindingChannelKeyFromContext({
      channel: readString(ctx.channel),
      messageChannel,
      from: readString(ctx.from),
      to: readString(ctx.to),
      accountId: readString(ctx.accountId),
      conversationId: readString(ctx.conversationId),
      messageThreadId:
        typeof ctx.messageThreadId === "number" ? ctx.messageThreadId : undefined,
      threadId:
        typeof ctx.threadId === "number" || typeof ctx.threadId === "string"
          ? ctx.threadId
          : null,
      channelKey: readString(ctx.channelKey) ?? readString(ctx.threadBindingKey),
    }) ?? undefined;
  const agentId =
    readString(ctx.agentId) ??
    readString(ctx.agentName) ??
    readString(ctx.agentRole) ??
    readString(ctx.role) ??
    readString(ctx.name) ??
    inferAgentIdFromPath(workspaceDir) ??
    inferAgentIdFromPath(readString(ctx.agentDir));
  return {
    workspaceDir,
    agentId,
    sessionKey: readString(ctx.sessionKey),
    sessionId: readString(ctx.sessionId),
    messageChannel,
    ...(channelKey ? { channelKey } : {}),
    sandboxed: ctx.sandboxed === true,
  };
}

export async function maybeAutoBindChannelProject(params: {
  policy: ReturnType<typeof getWorkflowGuardPolicy>;
  agentCtx: ToolContext;
  snapshot: {
    projectRoot: string | null;
    projectId: string | null;
    projectResolutionSource: string;
    channelProjectBindingsEnabled: boolean;
    channelProjectBindingKey?: string | null;
  };
}) {
  if (!params.snapshot.channelProjectBindingsEnabled) {
    return;
  }
  if (!params.agentCtx.sessionKey && !params.agentCtx.sessionId) {
    return;
  }
  if (!params.snapshot.projectRoot) {
    return;
  }
  if (!isProjectWorkflowAgentId(params.agentCtx.agentId)) {
    return;
  }
  if (params.snapshot.projectResolutionSource === "channel_binding") {
    return;
  }
  if (!readString(params.agentCtx.channelKey)) {
    return;
  }
  await enqueueWorkflowTask({
    label: "workflow:auto_bind_channel_project",
    queueContext: {
      projectRoot: params.snapshot.projectRoot,
      workspaceDir: params.agentCtx.workspaceDir,
      sessionKey: params.agentCtx.sessionKey,
      sessionId: params.agentCtx.sessionId,
      messageChannel: params.agentCtx.messageChannel,
      channelKey: params.snapshot.channelProjectBindingKey,
    },
    task: () =>
      ensureChannelProjectBindingForWorkflow({
        policy: params.policy,
        workspaceDir: params.agentCtx.workspaceDir,
        sessionKey: params.agentCtx.sessionKey,
        sessionId: params.agentCtx.sessionId,
        messageChannel: params.agentCtx.messageChannel,
        channelKey: params.agentCtx.channelKey,
        projectRoot: params.snapshot.projectRoot,
        projectId: params.snapshot.projectId,
        boundByAgent: params.agentCtx.agentId ?? "workflow",
        notes: "Auto-created from a resolved project during workflow execution.",
      }),
  });
}
