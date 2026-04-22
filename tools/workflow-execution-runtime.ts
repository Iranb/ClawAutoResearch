import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

type WorkflowExecutionRunParams = {
  sessionKey: string;
  message: string;
  lane?: string;
  deliver?: boolean;
  idempotencyKey?: string;
  extraSystemPrompt?: string;
  projectRoot?: string | null;
  projectId?: string | null;
  ownerAgent?: string | null;
  requesterSessionKey?: string | null;
  messageChannel?: string | null;
  workspaceDir?: string | null;
  trigger?: "manual" | "heartbeat" | "cron" | "memory" | "overflow" | "user";
};

type WorkflowExecutionWaitResult = {
  status: "ok" | "error" | "timeout";
  error?: string;
};

export type WorkflowExecutionSessionInspection = {
  sessionKey: string;
  sessionId: string | null;
  sessionFile: string | null;
  status: string | null;
  startedAt: number | null;
  endedAt: number | null;
  updatedAt: number | null;
  abortedLastRun: boolean;
  providerOverride: string | null;
  modelOverride: string | null;
  liveModelSwitchPending: boolean;
};

export type WorkflowExecutionRuntimeLike = {
  runtimeKind?: "embedded_agent" | "subagent";
  run?: (params: WorkflowExecutionRunParams) => Promise<{
    runId: string;
    sessionId?: string | null;
    runtime?: string;
  }>;
  waitForRun?: (params: {
    runId: string;
    timeoutMs?: number;
  }) => Promise<WorkflowExecutionWaitResult>;
  getSessionMessages?: (params: {
    sessionKey: string;
    limit?: number;
  }) => Promise<{ messages: unknown[] }>;
  inspectSession?: (params: {
    sessionKey: string;
  }) => Promise<WorkflowExecutionSessionInspection | null>;
  deleteSession?: (params: {
    sessionKey: string;
    deleteTranscript?: boolean;
  }) => Promise<void>;
};

export type WorkflowExecutionRuntime = WorkflowExecutionRuntimeLike & {
  run: NonNullable<WorkflowExecutionRuntimeLike["run"]>;
};

export type WorkflowBroadcastRuntime = {
  run: (params: {
    sessionKey: string;
    message: string;
    lane?: string;
    deliver?: boolean;
    idempotencyKey?: string;
    extraSystemPrompt?: string;
  }) => Promise<{ runId: string }>;
};

type WorkflowExecutionRuntimeApiLike = {
  config?: Record<string, unknown>;
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
      waitForRun?: (params: {
        runId: string;
        timeoutMs?: number;
      }) => Promise<WorkflowExecutionWaitResult>;
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
  };
  logger?: {
    debug?: (message: string, meta?: Record<string, unknown>) => void;
    warn?: (message: string, meta?: Record<string, unknown>) => void;
  };
};

type EmbeddedRunState = {
  runId: string;
  runtimeKind: "embedded_agent";
  sessionKey: string;
  sessionId: string;
  agentId: string;
  startedAt: number;
  finishedAt: number | null;
  status: "running" | "ok" | "error";
  error: string | null;
  promise: Promise<unknown>;
};

const EMBEDDED_RUN_ENTRY_TTL_MS = 15 * 60 * 1000;
const embeddedWorkflowRuns = new Map<string, EmbeddedRunState>();

function nowMs(): number {
  return Date.now();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pruneFinishedEmbeddedRuns() {
  const cutoff = nowMs() - EMBEDDED_RUN_ENTRY_TTL_MS;
  for (const [runId, state] of embeddedWorkflowRuns.entries()) {
    if (state.status === "running") {
      continue;
    }
    if ((state.finishedAt ?? state.startedAt) >= cutoff) {
      continue;
    }
    embeddedWorkflowRuns.delete(runId);
  }
}

function parseAgentIdFromSessionKey(sessionKey: string): string | null {
  const match = sessionKey.trim().match(/^agent:([^:]+):/i);
  return match?.[1]?.trim() ? match[1].trim().toLowerCase() : null;
}

function buildEmbeddedSessionId(sessionKey: string, agentId: string): string {
  const hash = createHash("sha1").update(sessionKey).digest("hex").slice(0, 24);
  return `workflow.${agentId}.${hash}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveEmbeddedWorkspaceDir(params: {
  runtimeApi: WorkflowExecutionRuntimeApiLike;
  runParams: WorkflowExecutionRunParams;
  agentId: string;
  defaultWorkspaceDir?: string | null;
}): string {
  const explicitWorkspaceDir = readString(params.runParams.workspaceDir);
  if (explicitWorkspaceDir) {
    return path.resolve(explicitWorkspaceDir);
  }
  const projectRoot = readString(params.runParams.projectRoot);
  if (projectRoot) {
    return path.resolve(projectRoot);
  }
  const defaultWorkspaceDir = readString(params.defaultWorkspaceDir);
  if (defaultWorkspaceDir) {
    return path.resolve(defaultWorkspaceDir);
  }
  const resolvedWorkspaceDir =
    params.runtimeApi.runtime?.agent?.resolveAgentWorkspaceDir?.(
      params.runtimeApi.config,
      params.agentId
    ) ?? null;
  if (readString(resolvedWorkspaceDir)) {
    return path.resolve(String(resolvedWorkspaceDir));
  }
  return process.cwd();
}

function resolveAgentDir(params: {
  runtimeApi: WorkflowExecutionRuntimeApiLike;
  agentId: string;
}): string | undefined {
  const resolved = params.runtimeApi.runtime?.agent?.resolveAgentDir?.(
    params.runtimeApi.config,
    params.agentId
  );
  return readString(resolved) ?? undefined;
}

function resolveSessionStorePath(params: {
  runtimeApi: WorkflowExecutionRuntimeApiLike;
  agentId: string;
}): string | null {
  const resolveStorePath = params.runtimeApi.runtime?.agent?.session?.resolveStorePath;
  if (typeof resolveStorePath !== "function") {
    return null;
  }
  const configuredStore = asRecord(params.runtimeApi.config)?.session;
  const configuredStorePath = asRecord(configuredStore)?.store;
  return resolveStorePath(readString(configuredStorePath) ?? undefined, {
    agentId: params.agentId,
  });
}

function readSessionStoreEntry(params: {
  runtimeApi: WorkflowExecutionRuntimeApiLike;
  agentId: string;
  sessionKey: string;
  sessionId?: string | null;
}): {
  storePath: string;
  store: Record<string, unknown>;
  entry: Record<string, unknown> | null;
} | null {
  const loadSessionStore = params.runtimeApi.runtime?.agent?.session?.loadSessionStore;
  if (typeof loadSessionStore !== "function") {
    return null;
  }
  const storePath = resolveSessionStorePath(params);
  if (!storePath) {
    return null;
  }
  const store = loadSessionStore(storePath);
  const exact = asRecord(store[params.sessionKey]);
  if (exact) {
    return { storePath, store, entry: exact };
  }
  const bySessionId =
    params.sessionId != null
      ? Object.values(store).find((candidate) => {
          const record = asRecord(candidate);
          return readString(record?.sessionId) === params.sessionId;
        }) ?? null
      : null;
  return {
    storePath,
    store,
    entry: asRecord(bySessionId),
  };
}

async function readSessionMessages(params: {
  runtimeApi: WorkflowExecutionRuntimeApiLike;
  sessionKey: string;
  sessionId: string;
  agentId: string;
  limit?: number;
}): Promise<{ messages: unknown[] }> {
  const resolveSessionFilePath =
    params.runtimeApi.runtime?.agent?.session?.resolveSessionFilePath;
  if (typeof resolveSessionFilePath !== "function") {
    return { messages: [] };
  }
  const storeState = readSessionStoreEntry({
    runtimeApi: params.runtimeApi,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
  });
  const sessionsDir = storeState?.storePath
    ? path.dirname(storeState.storePath)
    : undefined;
  const sessionFile = resolveSessionFilePath(
    params.sessionId,
    storeState?.entry ?? undefined,
    {
      agentId: params.agentId,
      sessionsDir,
    }
  );
  try {
    const raw = await fs.readFile(sessionFile, "utf8");
    const messages: unknown[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const message = parsed.message ?? parsed;
        const record = asRecord(message);
        if (!record) {
          continue;
        }
        if (readString(record.type) === "session") {
          continue;
        }
        messages.push(record);
      } catch {
        continue;
      }
    }
    const limit =
      typeof params.limit === "number" && Number.isFinite(params.limit)
        ? Math.max(1, Math.floor(params.limit))
        : null;
    return {
      messages: limit != null ? messages.slice(-limit) : messages,
    };
  } catch {
    return { messages: [] };
  }
}

function inspectPersistedSessionEntry(params: {
  entry: Record<string, unknown> | null;
  sessionKey: string;
}): WorkflowExecutionSessionInspection | null {
  if (!params.entry) {
    return null;
  }
  return {
    sessionKey: params.sessionKey,
    sessionId: readString(params.entry.sessionId),
    sessionFile: readString(params.entry.sessionFile),
    status: readString(params.entry.status),
    startedAt: readNumber(params.entry.startedAt),
    endedAt: readNumber(params.entry.endedAt),
    updatedAt: readNumber(params.entry.updatedAt),
    abortedLastRun: params.entry.abortedLastRun === true,
    providerOverride: readString(params.entry.providerOverride),
    modelOverride: readString(params.entry.modelOverride),
    liveModelSwitchPending: params.entry.liveModelSwitchPending === true,
  };
}

function buildEmbeddedWorkflowRuntimeFacade(params: {
  runtimeApi: WorkflowExecutionRuntimeApiLike;
  defaultWorkspaceDir?: string | null;
  defaultAgentId?: string | null;
  defaultMessageChannel?: string | null;
}): WorkflowExecutionRuntime | undefined {
  const runEmbeddedAgent = params.runtimeApi.runtime?.agent?.runEmbeddedAgent;
  if (typeof runEmbeddedAgent !== "function") {
    return undefined;
  }

  return {
    runtimeKind: "embedded_agent",
    async run(runParams) {
      pruneFinishedEmbeddedRuns();
      const sessionKey = runParams.sessionKey.trim();
      const agentId =
        readString(runParams.ownerAgent) ??
        parseAgentIdFromSessionKey(sessionKey) ??
        readString(params.defaultAgentId) ??
        "researcher";
      const sessionId = buildEmbeddedSessionId(sessionKey, agentId);
      const workspaceDir = resolveEmbeddedWorkspaceDir({
        runtimeApi: params.runtimeApi,
        runParams,
        agentId,
        defaultWorkspaceDir: params.defaultWorkspaceDir,
      });
      const agentDir = resolveAgentDir({
        runtimeApi: params.runtimeApi,
        agentId,
      });
      const timeoutMs =
        params.runtimeApi.runtime?.agent?.resolveAgentTimeoutMs?.(
          params.runtimeApi.config
        ) ?? 48 * 60 * 60 * 1000;
      const storePath = resolveSessionStorePath({
        runtimeApi: params.runtimeApi,
        agentId,
      });
      const sessionFile =
        params.runtimeApi.runtime?.agent?.session?.resolveSessionFilePath?.(
          sessionId,
          undefined,
          {
            agentId,
            sessionsDir: storePath ? path.dirname(storePath) : undefined,
          }
        ) ?? path.join(workspaceDir, `${sessionId}.jsonl`);
      const runId = randomUUID();

      const runPromise = (async () => {
        try {
          return await runEmbeddedAgent({
            sessionId,
            sessionKey,
            agentId,
            trigger: runParams.trigger ?? "manual",
            spawnedBy: readString(runParams.requesterSessionKey) ?? undefined,
            messageChannel:
              readString(runParams.messageChannel) ??
              readString(params.defaultMessageChannel) ??
              undefined,
            disableMessageTool: true,
            forceMessageTool: false,
            allowGatewaySubagentBinding: false,
            sessionFile,
            workspaceDir,
            agentDir,
            config: params.runtimeApi.config,
            prompt: runParams.message,
            lane: readString(runParams.lane) ?? "nested",
            extraSystemPrompt:
              readString(runParams.extraSystemPrompt) ?? undefined,
            timeoutMs,
            runId,
          });
        } catch (error) {
          throw error;
        }
      })();

      const state: EmbeddedRunState = {
        runId,
        runtimeKind: "embedded_agent",
        sessionKey,
        sessionId,
        agentId,
        startedAt: nowMs(),
        finishedAt: null,
        status: "running",
        error: null,
        promise: runPromise,
      };
      embeddedWorkflowRuns.set(runId, state);
      void runPromise
        .then(() => {
          state.status = "ok";
          state.finishedAt = nowMs();
        })
        .catch((error) => {
          state.status = "error";
          state.finishedAt = nowMs();
          state.error = error instanceof Error ? error.message : String(error);
        });

      return {
        runId,
        sessionId,
        runtime: "embedded_agent",
      };
    },
    async waitForRun(waitParams) {
      pruneFinishedEmbeddedRuns();
      const state = embeddedWorkflowRuns.get(waitParams.runId);
      if (!state) {
        return {
          status: "error",
          error: "Embedded workflow run is not tracked in the local registry.",
        };
      }
      if (state.status === "ok") {
        return { status: "ok" };
      }
      if (state.status === "error") {
        return {
          status: "error",
          error: state.error ?? "Embedded workflow run failed.",
        };
      }
      const timeoutMs =
        typeof waitParams.timeoutMs === "number" &&
        Number.isFinite(waitParams.timeoutMs)
          ? Math.max(0, Math.floor(waitParams.timeoutMs))
          : 0;
      if (timeoutMs === 0) {
        return { status: "timeout" };
      }
      const settled = await Promise.race([
        state.promise
          .then<WorkflowExecutionWaitResult>(() => ({ status: "ok" }))
          .catch<WorkflowExecutionWaitResult>((error) => ({
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          })),
        new Promise<WorkflowExecutionWaitResult>((resolve) => {
          setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
        }),
      ]);
      return settled;
    },
    async getSessionMessages(getParams) {
      pruneFinishedEmbeddedRuns();
      const sessionKey = getParams.sessionKey.trim();
      const state =
        [...embeddedWorkflowRuns.values()]
          .reverse()
          .find((entry) => entry.sessionKey === sessionKey) ?? null;
      const agentId =
        state?.agentId ??
        parseAgentIdFromSessionKey(sessionKey) ??
        readString(params.defaultAgentId) ??
        "researcher";
      const sessionId = state?.sessionId ?? buildEmbeddedSessionId(sessionKey, agentId);
      return readSessionMessages({
        runtimeApi: params.runtimeApi,
        sessionKey,
        sessionId,
        agentId,
        limit: getParams.limit,
      });
    },
    async inspectSession(inspectParams) {
      pruneFinishedEmbeddedRuns();
      const sessionKey = inspectParams.sessionKey.trim();
      const state =
        [...embeddedWorkflowRuns.values()]
          .reverse()
          .find((entry) => entry.sessionKey === sessionKey) ?? null;
      const agentId =
        state?.agentId ??
        parseAgentIdFromSessionKey(sessionKey) ??
        readString(params.defaultAgentId) ??
        "researcher";
      const sessionId = state?.sessionId ?? buildEmbeddedSessionId(sessionKey, agentId);
      const storeState = readSessionStoreEntry({
        runtimeApi: params.runtimeApi,
        agentId,
        sessionKey,
        sessionId,
      });
      return inspectPersistedSessionEntry({
        entry: storeState?.entry ?? null,
        sessionKey,
      });
    },
    async deleteSession(deleteParams) {
      pruneFinishedEmbeddedRuns();
      const sessionKey = deleteParams.sessionKey.trim();
      const matchingStates = [...embeddedWorkflowRuns.values()].filter(
        (entry) => entry.sessionKey === sessionKey
      );
      for (const state of matchingStates) {
        embeddedWorkflowRuns.delete(state.runId);
      }
      const agentId =
        matchingStates.at(-1)?.agentId ??
        parseAgentIdFromSessionKey(sessionKey) ??
        readString(params.defaultAgentId) ??
        "researcher";
      const sessionId =
        matchingStates.at(-1)?.sessionId ?? buildEmbeddedSessionId(sessionKey, agentId);
      const saveSessionStore = params.runtimeApi.runtime?.agent?.session?.saveSessionStore;
      const storeState = readSessionStoreEntry({
        runtimeApi: params.runtimeApi,
        agentId,
        sessionKey,
        sessionId,
      });
      if (storeState && typeof saveSessionStore === "function") {
        for (const [key, value] of Object.entries(storeState.store)) {
          const record = asRecord(value);
          if (
            key === sessionKey ||
            readString(record?.sessionId) === sessionId
          ) {
            delete storeState.store[key];
          }
        }
        await saveSessionStore(storeState.storePath, storeState.store);
      }
      if (deleteParams.deleteTranscript === true) {
        const resolveSessionFilePath =
          params.runtimeApi.runtime?.agent?.session?.resolveSessionFilePath;
        if (typeof resolveSessionFilePath === "function") {
          const sessionFile = resolveSessionFilePath(
            sessionId,
            storeState?.entry ?? undefined,
            {
              agentId,
              sessionsDir: storeState?.storePath
                ? path.dirname(storeState.storePath)
                : undefined,
            }
          );
          await fs.rm(sessionFile, { force: true });
        }
      }
    },
  };
}

function buildSubagentRuntime(params: {
  runtimeApi: WorkflowExecutionRuntimeApiLike;
}): WorkflowExecutionRuntime | undefined {
  const subagent = params.runtimeApi.runtime?.subagent;
  if (!subagent?.run) {
    return undefined;
  }
  return {
    runtimeKind: "subagent",
    async run(runParams) {
      const started = await subagent.run({
        sessionKey: runParams.sessionKey,
        message: runParams.message,
        lane: runParams.lane,
        deliver: runParams.deliver,
        idempotencyKey: runParams.idempotencyKey,
        extraSystemPrompt: runParams.extraSystemPrompt,
      });
      return {
        runId: started.runId,
        sessionId: null,
        runtime: "subagent",
      };
    },
    waitForRun: subagent.waitForRun,
    getSessionMessages: subagent.getSessionMessages,
    deleteSession: subagent.deleteSession,
  };
}

export function createWorkflowSubagentRuntimeFromApi(params: {
  api: WorkflowExecutionRuntimeApiLike;
}): WorkflowExecutionRuntime | undefined {
  return buildSubagentRuntime({
    runtimeApi: params.api,
  });
}

export function createWorkflowMonitorRuntimeFromApi(params: {
  api: WorkflowExecutionRuntimeApiLike;
}): WorkflowExecutionRuntimeLike | undefined {
  const subagent = params.api.runtime?.subagent;
  if (
    !subagent?.waitForRun &&
    !subagent?.getSessionMessages &&
    !subagent?.deleteSession
  ) {
    return undefined;
  }
  return {
    runtimeKind: "subagent",
    waitForRun: subagent.waitForRun,
    getSessionMessages: subagent.getSessionMessages,
    deleteSession: subagent.deleteSession,
  };
}

export function createWorkflowBroadcastRuntimeFromApi(params: {
  api: WorkflowExecutionRuntimeApiLike;
}): WorkflowBroadcastRuntime | undefined {
  const subagent = params.api.runtime?.subagent;
  if (!subagent?.run) {
    return undefined;
  }
  return {
    run: subagent.run,
  };
}

export function createWorkflowExecutionRuntimeFromApi(params: {
  api: WorkflowExecutionRuntimeApiLike;
  defaultWorkspaceDir?: string | null;
  defaultAgentId?: string | null;
  defaultMessageChannel?: string | null;
  preferEmbedded?: boolean;
}): WorkflowExecutionRuntime | undefined {
  const preferEmbedded = params.preferEmbedded !== false;
  const embedded = buildEmbeddedWorkflowRuntimeFacade({
    runtimeApi: params.api,
    defaultWorkspaceDir: params.defaultWorkspaceDir,
    defaultAgentId: params.defaultAgentId,
    defaultMessageChannel: params.defaultMessageChannel,
  });
  const subagent = createWorkflowSubagentRuntimeFromApi({
    api: params.api,
  });
  return preferEmbedded ? embedded ?? subagent : subagent ?? embedded;
}
