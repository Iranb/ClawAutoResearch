import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

import {
  dispatchWorkflowTaskToAgent,
  type DispatchableWorkflowRole,
  type WorkflowTaskDispatchResult,
} from "./agent-task-dispatch";
import { recordWorkflowRuntimeIncident } from "./workflow-runtime-incidents.js";

type WorkflowRuntimeApi = {
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

export type WorkflowLobsterHandoffConfig = {
  enabled: boolean;
  autoModeOnly: boolean;
  gatewayUrl: string;
  pipelinePath: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  fallbackToNative: boolean;
};

type LoggerLike = {
  debug?: (message: string, meta?: Record<string, unknown>) => void;
  info?: (message: string, meta?: Record<string, unknown>) => void;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
  error?: (message: string, meta?: Record<string, unknown>) => void;
};

export type WorkflowHandoffDispatchResult = WorkflowTaskDispatchResult & {
  backend: "native" | "lobster";
  lobsterStatus: "ok" | "needs_approval" | "cancelled" | "error" | null;
  fallbackReason: string | null;
};

export type WorkflowLobsterReadiness = {
  enabledByConfig: boolean;
  activeForMode: boolean;
  binaryFound: boolean;
  pipelineFound: boolean;
  pipelinePath: string;
  status:
    | "ready"
    | "config_disabled"
    | "auto_mode_inactive"
    | "binary_missing"
    | "pipeline_missing";
  reason: string | null;
};

type LobsterToolEnvelope = {
  ok?: boolean;
  status?: string;
  output?: unknown;
  requiresApproval?: {
    type?: string;
    prompt?: string;
    resumeToken?: string;
  };
};

type InvokeGatewayToolParams = {
  gatewayUrl: string;
  token?: string | null;
  tool: string;
  action?: string;
  args?: Record<string, unknown>;
  sessionKey?: string;
  messageChannel?: string | null;
  accountId?: string | null;
  timeoutMs?: number;
};

type InvokeGatewayToolDeps = {
  fetchImpl?: typeof fetch;
};

type InvokeLobsterDispatchParams = {
  config: WorkflowLobsterHandoffConfig;
  requesterSessionKey: string;
  requesterChannel?: string | null;
  requesterAccountId?: string | null;
  toRole: DispatchableWorkflowRole;
  subject: string;
  command?: string | null;
  extraBody?: string | null;
  waitTimeoutMs?: number;
  retryOnTimeout?: boolean;
  enableSpawnFallback?: boolean;
};

type InvokeLobsterDispatchResult = {
  envelope: LobsterToolEnvelope;
  dispatch: WorkflowTaskDispatchResult | null;
};

function normalizeLobsterStatus(
  value: string | null | undefined
): "ok" | "needs_approval" | "cancelled" | "error" {
  if (value === "ok" || value === "needs_approval" || value === "cancelled") {
    return value;
  }
  return "error";
}

type HandoffWorkflowTaskParams = {
  workflowRuntime?: WorkflowRuntimeApi;
  workflowPolicy?: {
    lobsterHandoff?: WorkflowLobsterHandoffConfig;
  } | null;
  requesterSessionKey?: string;
  requesterChannel?: string | null;
  requesterAccountId?: string | null;
  preferredSessionKeys?: string[] | null;
  fromRole?: string | null;
  toRole: DispatchableWorkflowRole;
  projectRoot: string;
  projectId?: string | null;
  stage?: string | null;
  summary: string;
  command?: string | null;
  mailboxMessageId?: string | null;
  requireMailboxAcknowledgement?: boolean;
  extraBody?: string | null;
  waitTimeoutMs?: number;
  retryOnTimeout?: boolean;
  enableSpawnFallback?: boolean;
  autoModeActive?: boolean;
  logger?: LoggerLike;
};

type HandoffWorkflowTaskDeps = {
  nativeDispatch?: typeof dispatchWorkflowTaskToAgent;
  invokeLobsterDispatch?: (
    params: InvokeLobsterDispatchParams
  ) => Promise<InvokeLobsterDispatchResult>;
  fetchImpl?: typeof fetch;
};

export const DEFAULT_WORKFLOW_LOBSTER_HANDOFF_CONFIG: WorkflowLobsterHandoffConfig = {
  enabled: false,
  autoModeOnly: true,
  gatewayUrl: "http://127.0.0.1:18789",
  pipelinePath: "",
  timeoutMs: 30000,
  maxStdoutBytes: 512000,
  fallbackToNative: true,
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function readNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function unwrapGatewayToolResult(rawResult: unknown): unknown {
  if (!rawResult || typeof rawResult !== "object") {
    return rawResult;
  }
  const object = rawResult as Record<string, unknown>;
  if ("details" in object && object.details !== undefined) {
    return object.details;
  }
  if ("content" in object && typeof object.content === "string") {
    try {
      return JSON.parse(object.content);
    } catch {
      return object.content;
    }
  }
  return rawResult;
}

function getPluginRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function resolveBundledPipelinePath(config: WorkflowLobsterHandoffConfig) {
  return (
    readString(config.pipelinePath) ??
    path.join(getPluginRoot(), "lobster", "workflows", "workflow-agent-dispatch.lobster")
  );
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findExecutableOnPath(command: string): Promise<string | null> {
  const pathEnv = process.env.PATH ?? "";
  const directories = pathEnv
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT")
          .split(";")
          .map((entry) => entry.trim())
          .filter(Boolean)
      : [""];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (await fileExists(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

export async function inspectWorkflowLobsterReadiness(params: {
  config: WorkflowLobsterHandoffConfig;
  autoModeActive?: boolean;
}): Promise<WorkflowLobsterReadiness> {
  const enabledByConfig = params.config.enabled === true;
  const activeForMode = shouldUseLobsterForWorkflowHandoff(params);
  const pipelinePath = resolveBundledPipelinePath(params.config);
  if (!enabledByConfig) {
    return {
      enabledByConfig,
      activeForMode,
      binaryFound: false,
      pipelineFound: false,
      pipelinePath,
      status: "config_disabled",
      reason: "lobster_config_disabled",
    };
  }
  if (!activeForMode) {
    return {
      enabledByConfig,
      activeForMode,
      binaryFound: false,
      pipelineFound: false,
      pipelinePath,
      status: "auto_mode_inactive",
      reason: "lobster_auto_mode_inactive",
    };
  }
  const [binaryPath, pipelineFound] = await Promise.all([
    findExecutableOnPath("lobster"),
    fileExists(pipelinePath),
  ]);
  if (!binaryPath) {
    return {
      enabledByConfig,
      activeForMode,
      binaryFound: false,
      pipelineFound,
      pipelinePath,
      status: "binary_missing",
      reason: "lobster_binary_missing",
    };
  }
  if (!pipelineFound) {
    return {
      enabledByConfig,
      activeForMode,
      binaryFound: true,
      pipelineFound: false,
      pipelinePath,
      status: "pipeline_missing",
      reason: "lobster_pipeline_missing",
    };
  }
  return {
    enabledByConfig,
    activeForMode,
    binaryFound: true,
    pipelineFound: true,
    pipelinePath,
    status: "ready",
    reason: null,
  };
}

export function classifyWorkflowLobsterFailureReason(
  error: string | null | undefined
): string | null {
  const normalized = readString(error)?.toLowerCase() ?? "";
  if (!normalized) {
    return null;
  }
  if (/tool not available: lobster|unknown tool|not in allowlist|plugin.+lobster/i.test(normalized)) {
    return "lobster_plugin_not_loaded";
  }
  if (/spawn lobster enoent|lobster not found|binary_missing/i.test(normalized)) {
    return "lobster_binary_missing";
  }
  if (/pipeline_missing|workflow-agent-dispatch\.lobster/i.test(normalized)) {
    return "lobster_pipeline_missing";
  }
  if (/timed out|timeout|aborterror|aborted/i.test(normalized)) {
    return "lobster_gateway_timeout";
  }
  if (/tool execution failed|lobster failed|lobster_invalid_output/i.test(normalized)) {
    return "lobster_tool_error";
  }
  return normalized;
}

function readGatewayToken() {
  return (
    readString(process.env.OPENCLAW_GATEWAY_TOKEN) ??
    readString(process.env.OPENCLAW_GATEWAY_PASSWORD) ??
    null
  );
}

async function invokeGatewayTool(
  params: InvokeGatewayToolParams,
  deps: InvokeGatewayToolDeps = {}
) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs =
    typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
      ? Math.max(100, Math.floor(params.timeoutMs))
      : null;
  const abortController = timeoutMs ? new AbortController() : null;
  const timeoutHandle = timeoutMs
    ? setTimeout(() => abortController?.abort(), timeoutMs)
    : null;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (params.token) {
    headers.authorization = `Bearer ${params.token}`;
  }
  if (params.messageChannel) {
    headers["x-openclaw-message-channel"] = params.messageChannel;
  }
  if (params.accountId) {
    headers["x-openclaw-account-id"] = params.accountId;
  }
  let response: Response;
  try {
    response = await fetchImpl(`${params.gatewayUrl.replace(/\/+$/, "")}/tools/invoke`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        tool: params.tool,
        ...(params.action ? { action: params.action } : {}),
        args: params.args ?? {},
        ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
      }),
      ...(abortController ? { signal: abortController.signal } : {}),
    });
  } catch (error) {
    if (abortController?.signal.aborted && timeoutMs) {
      throw new Error(`OpenClaw tools invoke timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
  let payload: Record<string, unknown>;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    const text = await response.text();
    throw new Error(`OpenClaw tools invoke returned non-JSON response: ${text}`);
  }
  if (!response.ok || payload.ok !== true) {
    const errorObject = asObject(payload.error);
    throw new Error(
      readString(errorObject?.message) ??
        readString(payload.message) ??
        `tools/invoke failed with HTTP ${response.status}`
    );
  }
  return unwrapGatewayToolResult(payload.result);
}

function extractDispatchResultFromEnvelope(
  envelope: LobsterToolEnvelope
): WorkflowTaskDispatchResult | null {
  const outputs = Array.isArray(envelope.output) ? envelope.output : [envelope.output];
  for (let index = outputs.length - 1; index >= 0; index -= 1) {
    const item = asObject(outputs[index]);
    const nested =
      asObject(item?.dispatchResult) ??
      asObject(item?.dispatch) ??
      item;
    if (
      nested &&
      typeof nested.dispatched === "boolean" &&
      ("strategy" in nested || "channel" in nested || "attempts" in nested)
    ) {
      return nested as unknown as WorkflowTaskDispatchResult;
    }
  }
  return null;
}

export function normalizeWorkflowLobsterHandoffConfig(
  value: unknown
): WorkflowLobsterHandoffConfig {
  const object = asObject(value);
  return {
    enabled: readBoolean(object?.enabled, DEFAULT_WORKFLOW_LOBSTER_HANDOFF_CONFIG.enabled),
    autoModeOnly: readBoolean(
      object?.autoModeOnly,
      DEFAULT_WORKFLOW_LOBSTER_HANDOFF_CONFIG.autoModeOnly
    ),
    gatewayUrl:
      readString(object?.gatewayUrl) ?? DEFAULT_WORKFLOW_LOBSTER_HANDOFF_CONFIG.gatewayUrl,
    pipelinePath:
      readString(object?.pipelinePath) ?? DEFAULT_WORKFLOW_LOBSTER_HANDOFF_CONFIG.pipelinePath,
    timeoutMs: Math.max(
      1000,
      Math.floor(readNumber(object?.timeoutMs, DEFAULT_WORKFLOW_LOBSTER_HANDOFF_CONFIG.timeoutMs))
    ),
    maxStdoutBytes: Math.max(
      1024,
      Math.floor(
        readNumber(
          object?.maxStdoutBytes,
          DEFAULT_WORKFLOW_LOBSTER_HANDOFF_CONFIG.maxStdoutBytes
        )
      )
    ),
    fallbackToNative: readBoolean(
      object?.fallbackToNative,
      DEFAULT_WORKFLOW_LOBSTER_HANDOFF_CONFIG.fallbackToNative
    ),
  };
}

export function shouldUseLobsterForWorkflowHandoff(params: {
  config: WorkflowLobsterHandoffConfig;
  autoModeActive?: boolean;
}) {
  if (!params.config.enabled) {
    return false;
  }
  if (!params.config.autoModeOnly) {
    return true;
  }
  return params.autoModeActive === true;
}

async function invokeLobsterDispatchWorkflow(
  params: InvokeLobsterDispatchParams,
  deps: InvokeGatewayToolDeps = {}
): Promise<InvokeLobsterDispatchResult> {
  const result = (await invokeGatewayTool({
    gatewayUrl: params.config.gatewayUrl,
    token: readGatewayToken(),
    tool: "lobster",
    action: "run",
    args: {
      pipeline: resolveBundledPipelinePath(params.config),
      argsJson: JSON.stringify({
        pluginRoot: getPluginRoot(),
        gatewayUrl: params.config.gatewayUrl,
        sessionKey: params.requesterSessionKey,
        messageChannel: params.requesterChannel ?? "discord",
        accountId: params.requesterAccountId ?? "",
        toAgent: params.toRole,
        subject: params.subject,
        command: params.command ?? "",
        extraBody: params.extraBody ?? "",
        waitTimeoutMs: params.waitTimeoutMs ?? 0,
        retryOnTimeout: params.retryOnTimeout !== false,
        enableSpawnFallback: params.enableSpawnFallback !== false,
      }),
      timeoutMs: params.config.timeoutMs,
      maxStdoutBytes: params.config.maxStdoutBytes,
    },
    sessionKey: params.requesterSessionKey,
    messageChannel: params.requesterChannel ?? "discord",
    accountId: params.requesterAccountId ?? undefined,
    timeoutMs: params.config.timeoutMs,
  }, deps)) as LobsterToolEnvelope;
  return {
    envelope: result,
    dispatch: extractDispatchResultFromEnvelope(result),
  };
}

function buildFallbackResult(
  nativeResult: WorkflowTaskDispatchResult,
  reason: string | null
): WorkflowHandoffDispatchResult {
  return {
    ...nativeResult,
    backend: "native",
    lobsterStatus: null,
    fallbackReason: reason,
  };
}

export async function handoffWorkflowTaskToAgent(
  params: HandoffWorkflowTaskParams,
  deps: HandoffWorkflowTaskDeps = {}
): Promise<WorkflowHandoffDispatchResult> {
  const nativeDispatch = deps.nativeDispatch ?? dispatchWorkflowTaskToAgent;
  const lobsterConfig = normalizeWorkflowLobsterHandoffConfig(
    params.workflowPolicy?.lobsterHandoff
  );
  const requireMailboxAcknowledgement =
    params.requireMailboxAcknowledgement !== false;
  const lobsterReadiness = await inspectWorkflowLobsterReadiness({
    config: lobsterConfig,
    autoModeActive: params.autoModeActive,
  });
  const useLobster = lobsterReadiness.status === "ready";

  const runNative = async (reason: string | null) =>
    buildFallbackResult(
      await (async () => {
        if (reason) {
          await recordWorkflowRuntimeIncident({
            projectRoot: params.projectRoot,
            projectId: params.projectId,
            idempotencyKey: `lobster-fallback:${params.toRole}:${params.stage ?? "unknown"}:${reason}`,
            kind: "lobster_fallback",
            severity: "warning",
            summary: `Lobster handoff fell back to native dispatch for ${params.toRole}.`,
            queueKey: null,
            sessionKey: params.requesterSessionKey ?? null,
            backend: "lobster",
            error: reason,
            details: {
              toRole: params.toRole,
              stage: params.stage,
              command: params.command,
            },
          });
        }
        return nativeDispatch({
          workflowRuntime: params.workflowRuntime,
          requesterSessionKey: params.requesterSessionKey,
          requesterChannel: params.requesterChannel ?? undefined,
          preferredSessionKeys: params.preferredSessionKeys ?? undefined,
          fromRole: params.fromRole,
          toRole: params.toRole,
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          stage: params.stage,
          summary: params.summary,
          command: params.command,
          mailboxMessageId: params.mailboxMessageId,
          requireMailboxAcknowledgement,
          extraBody: params.extraBody,
          waitTimeoutMs: params.waitTimeoutMs,
          retryOnTimeout: params.retryOnTimeout,
          enableSpawnFallback: params.enableSpawnFallback,
        });
      })(),
      reason
    );

  if (!useLobster) {
    return runNative(lobsterReadiness.reason);
  }

  if (!params.requesterSessionKey) {
    params.logger?.warn?.("Lobster handoff skipped: requester session key unavailable.", {
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      toRole: params.toRole,
    });
    return runNative("missing_requester_session");
  }

  try {
    const invoked = deps.invokeLobsterDispatch
      ? await deps.invokeLobsterDispatch({
          config: lobsterConfig,
          requesterSessionKey: params.requesterSessionKey,
          requesterChannel: params.requesterChannel,
          requesterAccountId: params.requesterAccountId,
          toRole: params.toRole,
          subject: params.summary,
          command: params.command,
          extraBody: params.extraBody,
          waitTimeoutMs: params.waitTimeoutMs,
          retryOnTimeout: params.retryOnTimeout,
          enableSpawnFallback: params.enableSpawnFallback,
        })
      : await invokeLobsterDispatchWorkflow(
          {
            config: lobsterConfig,
            requesterSessionKey: params.requesterSessionKey,
            requesterChannel: params.requesterChannel,
            requesterAccountId: params.requesterAccountId,
            toRole: params.toRole,
            subject: params.summary,
            command: params.command,
            extraBody: params.extraBody,
            waitTimeoutMs: params.waitTimeoutMs,
            retryOnTimeout: params.retryOnTimeout,
            enableSpawnFallback: params.enableSpawnFallback,
          },
          { fetchImpl: deps.fetchImpl }
        );
    const status = readString(invoked.envelope.status) ?? (invoked.envelope.ok ? "ok" : "error");
    if (status !== "ok" || !invoked.dispatch) {
      const reason =
        status === "needs_approval"
          ? "lobster_needs_approval"
          : status === "cancelled"
            ? "lobster_cancelled"
            : "lobster_invalid_output";
      if (lobsterConfig.fallbackToNative) {
        params.logger?.warn?.("Lobster handoff fell back to native dispatch.", {
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          toRole: params.toRole,
          reason,
          lobsterStatus: status,
        });
        return runNative(reason);
      }
      return {
        dispatched: false,
        sessionKey: null,
        runId: null,
        waitStatus: null,
        channel: null,
        strategy: null,
        attempts: [],
        fallbackSpawned: false,
        acknowledgedByMailbox: false,
        error: reason,
        backend: "lobster",
        lobsterStatus: normalizeLobsterStatus(status),
        fallbackReason: null,
      };
    }
    return {
      ...invoked.dispatch,
      backend: "lobster",
      lobsterStatus: normalizeLobsterStatus(status),
      fallbackReason: null,
    };
  } catch (error) {
    const reason =
      classifyWorkflowLobsterFailureReason(
        error instanceof Error ? error.message : String(error)
      ) ??
      (error instanceof Error ? error.message : String(error));
    if (lobsterConfig.fallbackToNative) {
      params.logger?.warn?.("Lobster handoff failed; falling back to native dispatch.", {
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        toRole: params.toRole,
        error: reason,
      });
      return runNative(reason);
    }
    return {
      dispatched: false,
      sessionKey: null,
      runId: null,
      waitStatus: null,
      channel: null,
      strategy: null,
      attempts: [],
      fallbackSpawned: false,
      acknowledgedByMailbox: false,
      error: reason,
      backend: "lobster",
      lobsterStatus: "error",
      fallbackReason: null,
    };
  }
}
