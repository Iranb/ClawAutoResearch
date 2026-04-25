import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import {
  isProviderCapacityFailure,
  providerCapacityFailureMessage,
} from "./provider-capacity.js";

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
  lastError: string | null;
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
  sessionFile: string | null;
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

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    const normalized = readString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
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

function isSyntheticAlreadyActiveRunId(runId: string): boolean {
  return /^already-active:/i.test(runId.trim());
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

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const record = asRecord(entry);
        return record ? [record] : [];
      })
    : [];
}

function splitModelRef(
  modelRef: unknown
): { provider: string; model: string; ref: string } | null {
  const ref = readString(modelRef);
  if (!ref) {
    return null;
  }
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) {
    return null;
  }
  const provider = ref.slice(0, slash).trim();
  const model = ref.slice(slash + 1).trim();
  return provider && model ? { provider, model, ref } : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveAgentConfigRecord(params: {
  config: unknown;
  agentId: string;
}): Record<string, unknown> | null {
  const agents = asRecord(asRecord(params.config)?.agents);
  const list = asRecordArray(agents?.list);
  const exact = list.find((entry) => readString(entry.id) === params.agentId);
  if (exact) {
    return exact;
  }
  const expected = params.agentId.toLowerCase();
  return (
    list.find((entry) => readString(entry.id)?.toLowerCase() === expected) ?? null
  );
}

function collectAgentModelRefs(params: {
  config: unknown;
  agentId: string;
}): string[] {
  const agents = asRecord(asRecord(params.config)?.agents);
  const defaultsModel = asRecord(agents?.defaults)?.model;
  const agentModel = resolveAgentConfigRecord(params)?.model;
  const primary =
    readModelPrimaryRef(agentModel) ?? readModelPrimaryRef(defaultsModel);
  return [
    primary,
    ...readModelFallbackRefs(agentModel),
    ...readModelFallbackRefs(defaultsModel),
  ].filter((entry): entry is string => Boolean(entry));
}

function resolveExternalOpenClawConfigPath(): string | null {
  const explicit =
    readString(process.env.OPENCLAW_CONFIG_PATH) ??
    readString(process.env.OPENCLAW_CONFIG);
  if (explicit) {
    return path.resolve(explicit);
  }
  const home = readString(process.env.HOME);
  return home ? path.join(home, ".openclaw", "openclaw.json") : null;
}

function readExternalOpenClawModelRefs(agentId: string): string[] {
  const configPath = resolveExternalOpenClawConfigPath();
  if (!configPath) {
    return [];
  }
  try {
    return collectAgentModelRefs({
      config: JSON.parse(readFileSync(configPath, "utf8")),
      agentId,
    });
  } catch {
    return [];
  }
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const text = readString(entry);
        return text ? [text] : [];
      })
    : [];
}

function readModelPrimaryRef(modelConfig: unknown): string | null {
  const direct = readString(modelConfig);
  if (direct) {
    return direct;
  }
  return readString(asRecord(modelConfig)?.primary);
}

function readModelFallbackRefs(modelConfig: unknown): string[] {
  return readStringArray(asRecord(modelConfig)?.fallbacks);
}

function resolveEmbeddedAgentModelCandidates(params: {
  config: unknown;
  agentId: string;
}): Array<{ provider: string; model: string; ref: string }> {
  const candidates = uniqueStrings([
    ...collectAgentModelRefs(params),
    ...readExternalOpenClawModelRefs(params.agentId),
  ]);
  const selections: Array<{ provider: string; model: string; ref: string }> = [];
  for (const candidate of candidates) {
    const parsed = splitModelRef(candidate);
    if (parsed) {
      selections.push(parsed);
    }
  }
  return selections;
}

function cloneJsonConfig(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return value;
  }
}

function buildConfigForEmbeddedModelCandidate(params: {
  config: unknown;
  agentId: string;
  selection: { provider: string; model: string; ref: string } | null;
  fallbackRefs: string[];
}): unknown {
  if (!params.selection) {
    return params.config;
  }
  const cloned = cloneJsonConfig(params.config);
  const root = asRecord(cloned);
  if (!root) {
    return params.config;
  }
  const agents = asRecord(root.agents) ?? {};
  root.agents = agents;
  const list = Array.isArray(agents.list) ? agents.list : [];
  agents.list = list;
  const expected = params.agentId.toLowerCase();
  let agentRecord =
    list
      .map((entry) => asRecord(entry))
      .find((entry) => readString(entry?.id)?.toLowerCase() === expected) ?? null;
  if (!agentRecord) {
    agentRecord = { id: params.agentId };
    list.push(agentRecord);
  }
  const existingModel = asRecord(agentRecord.model) ?? {};
  agentRecord.model = {
    ...existingModel,
    primary: params.selection.ref,
    fallbacks: params.fallbackRefs,
  };
  return cloned;
}

function collectEmbeddedErrorTexts(value: unknown, depth = 0): string[] {
  if (depth > 5 || value == null) {
    return [];
  }
  if (typeof value === "string") {
    return [value];
  }
  if (value instanceof Error) {
    return [value.message];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectEmbeddedErrorTexts(entry, depth + 1));
  }
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  const texts: string[] = [];
  const isErrorPayload =
    record.isError === true ||
    record.error === true ||
    readString(record.status)?.toLowerCase() === "error";
  if (isErrorPayload) {
    for (const key of ["text", "message", "error", "rawError", "raw_error", "reason"]) {
      const text = readString(record[key]);
      if (text) {
        texts.push(text);
      }
    }
  }
  for (const key of ["payloads", "content", "items", "replies", "meta", "details"]) {
    if (key in record) {
      texts.push(...collectEmbeddedErrorTexts(record[key], depth + 1));
    }
  }
  return texts;
}

function extractEmbeddedRunErrorMessage(result: unknown): string | null {
  const texts = uniqueStrings(collectEmbeddedErrorTexts(result));
  return texts.find((text) => text.length > 0) ?? null;
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
  fallbackState?: EmbeddedRunState | null;
}): WorkflowExecutionSessionInspection | null {
  const fallbackStatus = params.fallbackState
    ? params.fallbackState.status === "running"
      ? "running"
      : params.fallbackState.status === "ok"
        ? "completed"
        : "failed"
    : null;
  if (!params.entry && !params.fallbackState) {
    return null;
  }
  return {
    sessionKey: params.sessionKey,
    sessionId:
      readString(params.entry?.sessionId) ??
      params.fallbackState?.sessionId ??
      null,
    sessionFile:
      readString(params.entry?.sessionFile) ??
      params.fallbackState?.sessionFile ??
      null,
    status: readString(params.entry?.status) ?? fallbackStatus,
    startedAt:
      readNumber(params.entry?.startedAt) ??
      params.fallbackState?.startedAt ??
      null,
    endedAt:
      readNumber(params.entry?.endedAt) ??
      params.fallbackState?.finishedAt ??
      null,
    updatedAt:
      readNumber(params.entry?.updatedAt) ??
      params.fallbackState?.finishedAt ??
      params.fallbackState?.startedAt ??
      null,
    abortedLastRun: params.entry?.abortedLastRun === true,
    providerOverride: readString(params.entry?.providerOverride),
    modelOverride: readString(params.entry?.modelOverride),
    liveModelSwitchPending: params.entry?.liveModelSwitchPending === true,
    lastError:
      readString(params.entry?.lastError) ??
      readString(params.entry?.last_error) ??
      readString(params.entry?.error) ??
      params.fallbackState?.error ??
      null,
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
      const modelSelections = resolveEmbeddedAgentModelCandidates({
        config: params.runtimeApi.config,
        agentId,
      });
      if (modelSelections.length === 0) {
        params.runtimeApi.logger?.warn?.(
          "workflow.embedded_agent.model_selection_missing",
          {
            agentId,
            sessionKey,
            reason:
              "no usable agents.<agent>.model.primary or agents.defaults.model.primary provider/model ref",
          }
        );
      }
      const modelRunCandidates = modelSelections.length > 0 ? modelSelections : [null];

      const runPromise = (async () => {
        for (let index = 0; index < modelRunCandidates.length; index += 1) {
          const modelSelection = modelRunCandidates[index];
          const candidateFallbackRefs = modelRunCandidates
            .slice(index + 1)
            .flatMap((candidate) => (candidate ? [candidate.ref] : []));
          try {
            const result = await runEmbeddedAgent({
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
              config: buildConfigForEmbeddedModelCandidate({
                config: params.runtimeApi.config,
                agentId,
                selection: modelSelection,
                fallbackRefs: candidateFallbackRefs,
              }),
              provider: modelSelection?.provider,
              model: modelSelection?.model,
              prompt: runParams.message,
              lane: readString(runParams.lane) ?? "nested",
              extraSystemPrompt:
                readString(runParams.extraSystemPrompt) ?? undefined,
              timeoutMs,
              runId,
            });
            const embeddedError = extractEmbeddedRunErrorMessage(result);
            if (embeddedError) {
              throw new Error(embeddedError);
            }
            return result;
          } catch (error) {
            const hasFallback = index < modelRunCandidates.length - 1;
            if (!hasFallback || !isProviderCapacityFailure(error)) {
              throw error;
            }
            const nextSelection = modelRunCandidates[index + 1];
            params.runtimeApi.logger?.warn?.(
              "workflow.embedded_agent.provider_capacity_fallback",
              {
                agentId,
                sessionKey,
                failedProvider: modelSelection?.provider ?? null,
                failedModel: modelSelection?.model ?? null,
                nextProvider: nextSelection?.provider ?? null,
                nextModel: nextSelection?.model ?? null,
                error: providerCapacityFailureMessage(error),
              }
            );
          }
        }
        throw new Error("Embedded workflow run did not start.");
      })();

      const state: EmbeddedRunState = {
        runId,
        runtimeKind: "embedded_agent",
        sessionKey,
        sessionId,
        sessionFile,
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
      if (isSyntheticAlreadyActiveRunId(waitParams.runId)) {
        return { status: "timeout" };
      }
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
        fallbackState: state,
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
