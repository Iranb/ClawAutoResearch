import fs from "node:fs/promises";
import path from "node:path";
import {
  appendWorkflowRuntimeEvent,
  readWorkflowRuntimeQueueStore,
  updateWorkflowRuntimeQueueStore,
  type WorkflowRuntimeQueueEntryStatus,
} from "./workflow-runtime-state.js";
import {
  INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON,
  isInvalidCompletedWorkflowOwnedLiteratureRequisitionRequest,
  normalizePaperIngestionState,
  serializePaperIngestionState,
} from "./workflow-guard-state/paper-ingestion";
import { normalizeGraphPresenceStatus } from "./workflow-guard-core/coercion";
import { finalizeQueuedPaperIngestionAttempt } from "./paper-ingestion-validation";
import {
  readPapernexusProgress,
  writePapernexusProgressFromManifest,
} from "./papernexus-progress";
import {
  DEFAULT_PROVIDER_CAPACITY_COOLDOWN_MS,
  isProviderCapacityFailure,
} from "./provider-capacity.js";
import { appendWorkflowLocalOperatorRelay } from "./workflow-local-operator-relay.js";

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

type BackgroundRunTerminalStatus = "completed" | "failed" | "needs_repair";

const PAPERNEXUS_IMPORT_WRAPPER_PATTERN =
  /\bpn_(?:stage_sync|import_submit|import_queue|batch_import)\.py\b/i;

export function isWorkflowRuntimeTrackingMissError(value: unknown): boolean {
  const parts: string[] = [];
  const direct = readString(value);
  if (direct) {
    parts.push(direct);
  }
  const record = asRecord(value);
  if (record) {
    for (const key of ["error", "message", "lastError", "reason", "detail"]) {
      const text = readString(record[key]);
      if (text) {
        parts.push(text);
      }
    }
  }
  return /(?:embedded workflow run is )?not tracked in the local registry/i.test(
    parts.join(" ")
  );
}

export type BackgroundRunTerminalEntry = {
  backgroundSessionKey: string;
  runId: string;
  queueKey: string | null;
  kind: string;
  family: string;
  projectId: string | null;
  projectRoot: string | null;
};

export type BackgroundRunDurableTerminalState = {
  terminalStatus: BackgroundRunTerminalStatus;
  error: string | null;
  source:
    | "runtime_queue"
    | "papernexus_progress"
    | "paper_ingestion_request"
    | "paper_ingestion_idle_import_wrapper";
};

function hasDurableInFlightPaperUpload(
  paperIngestion: ReturnType<typeof normalizePaperIngestionState>
): boolean {
  if (
    paperIngestion.queuedRequests.some((request) =>
      ["queued", "launching", "running"].includes(request.status)
    )
  ) {
    return true;
  }
  if (
    paperIngestion.activeBatches.some((batch) =>
      ["queued", "running"].includes(batch.status)
    )
  ) {
    return true;
  }
  if (
    paperIngestion.paperOperations.some((operation) =>
      ["queued", "running"].includes(operation.status)
    )
  ) {
    return true;
  }
  if (
    paperIngestion.batchItems.some((item) =>
      ["pending", "running"].includes(item.status ?? "")
    )
  ) {
    return true;
  }
  return (
    paperIngestion.importTaskIds.length > 0 &&
    paperIngestion.completedPapers.length === 0
  );
}

function derivePaperIngestionRuntimeStatus(params: {
  paperIngestion: ReturnType<typeof normalizePaperIngestionState>;
  graphPresenceStatus: string | null;
  terminalStatus: BackgroundRunTerminalStatus;
}): ReturnType<typeof normalizePaperIngestionState>["runtimeStatus"] {
  if (hasDurableInFlightPaperUpload(params.paperIngestion)) {
    return "waiting_import";
  }
  if (
    params.terminalStatus === "failed" ||
    params.terminalStatus === "needs_repair"
  ) {
    return "blocked";
  }
  if (params.graphPresenceStatus && params.graphPresenceStatus !== "ready") {
    return "waiting_graph";
  }
  if (params.graphPresenceStatus === "ready") {
    return "ready";
  }
  return "idle";
}

function derivePaperIngestionWaitingReason(params: {
  paperIngestion: ReturnType<typeof normalizePaperIngestionState>;
  graphPresenceStatus: string | null;
  terminalStatus: BackgroundRunTerminalStatus;
  error: string | null;
}): string | null {
  if (hasDurableInFlightPaperUpload(params.paperIngestion)) {
    const activeRequest = params.paperIngestion.queuedRequests.find(
      (request) =>
        ["queued", "launching", "running"].includes(request.status) &&
        (request.detail || request.lastError)
    );
    return (
      activeRequest?.detail ??
      activeRequest?.lastError ??
      params.paperIngestion.waitingReason ??
      "PaperNexus import is still running; waiting for remote import progress before graph verification."
    );
  }
  if (params.terminalStatus === "completed") {
    return params.graphPresenceStatus && params.graphPresenceStatus !== "ready"
      ? "Latest PaperNexus upload pass finished; waiting for graph presence verification before downstream stages continue."
      : null;
  }
  if (params.terminalStatus === "failed") {
    return params.error
      ? `Latest PaperNexus upload pass failed: ${params.error}`
      : "Latest PaperNexus upload pass failed.";
  }
  return params.error
    ? `Latest PaperNexus upload pass needs repair: ${params.error}`
    : "Latest PaperNexus upload pass needs repair before the workflow can continue.";
}

async function reconcileQueueTerminalState(params: {
  entry: BackgroundRunTerminalEntry;
  terminalStatus: BackgroundRunTerminalStatus;
  finishedAt: string;
  error: string | null;
  nextRetryAt?: string | null;
}): Promise<boolean> {
  if (!params.entry.projectRoot || !params.entry.queueKey) {
    return false;
  }
  if (
    params.terminalStatus === "failed" &&
    isWorkflowRuntimeTrackingMissError(params.error)
  ) {
    return false;
  }
  const queueStatus: WorkflowRuntimeQueueEntryStatus =
    params.terminalStatus === "completed"
      ? "completed"
      : params.terminalStatus === "failed"
        ? "failed"
        : "needs_repair";
  let changed = false;
  await updateWorkflowRuntimeQueueStore({
    projectRoot: params.entry.projectRoot,
    updater: (store) => {
      const index = store.entries.findIndex(
        (entry) => entry.queueKey === params.entry.queueKey
      );
      if (index < 0) {
        return store.entries;
      }
      const current = store.entries[index];
      const next = {
        ...current,
        status: queueStatus,
        lastAttemptedAt: params.finishedAt,
        lastCheckedAt: params.finishedAt,
        nextRetryAt:
          params.terminalStatus === "completed"
            ? null
            : queueStatus === "needs_repair"
              ? params.nextRetryAt ?? current.nextRetryAt ?? null
              : null,
        lastError:
          params.terminalStatus === "completed"
            ? null
            : params.error ?? current.lastError,
      };
      if (JSON.stringify(next) === JSON.stringify(current)) {
        return store.entries;
      }
      changed = true;
      const nextEntries = [...store.entries];
      nextEntries[index] = next;
      return nextEntries;
    },
  });
  return changed;
}

function deriveTerminalStatusFromQueueStatus(
  value: unknown
): BackgroundRunTerminalStatus | null {
  const normalized = readString(value)?.toLowerCase() ?? null;
  if (normalized === "completed") {
    return "completed";
  }
  if (normalized === "failed" || normalized === "degraded") {
    return "failed";
  }
  if (normalized === "needs_repair") {
    return "needs_repair";
  }
  return null;
}

function deriveTerminalStatusFromQueuedRequestStatus(
  value: unknown
): BackgroundRunTerminalStatus | null {
  const normalized = readString(value)?.toLowerCase() ?? null;
  if (normalized === "completed") {
    return "completed";
  }
  if (normalized === "failed") {
    return "failed";
  }
  if (normalized === "needs_repair") {
    return "needs_repair";
  }
  return null;
}

function isImportWrapperQueueKey(value: string | null): boolean {
  return Boolean(value && PAPERNEXUS_IMPORT_WRAPPER_PATTERN.test(value));
}

async function readManifestRecordIfPresent(
  manifestPath: string
): Promise<Record<string, unknown> | null> {
  let manifestRaw: string;
  try {
    manifestRaw = await fs.readFile(manifestPath, "utf8");
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : null;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
  if (!manifestRaw.trim()) {
    return null;
  }
  try {
    return asRecord(JSON.parse(manifestRaw)) ?? {};
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

export async function inferBackgroundRunTerminalStateFromDurableState(params: {
  entry: BackgroundRunTerminalEntry;
  allowNeedsRepair?: boolean;
}): Promise<BackgroundRunDurableTerminalState | null> {
  const allowNeedsRepair = params.allowNeedsRepair !== false;
  const entry = {
    ...params.entry,
    projectRoot: readString(params.entry.projectRoot),
    projectId: readString(params.entry.projectId),
    queueKey: readString(params.entry.queueKey),
  };
  if (!entry.projectRoot) {
    return null;
  }

  const queueStore = await readWorkflowRuntimeQueueStore(entry.projectRoot);
  let queueTerminalStatus: BackgroundRunTerminalStatus | null = null;
  let queueTerminalError: string | null = null;
  if (entry.queueKey) {
    const queueEntry = queueStore.entries.find(
      (candidate) => candidate.queueKey === entry.queueKey
    );
    queueTerminalStatus = deriveTerminalStatusFromQueueStatus(queueEntry?.status);
    queueTerminalError =
      queueTerminalStatus === "completed" ? null : readString(queueEntry?.lastError);
    if (
      queueTerminalStatus === "failed" &&
      isWorkflowRuntimeTrackingMissError(queueTerminalError)
    ) {
      queueTerminalStatus = null;
      queueTerminalError = null;
    }
  }

  const manifestPath = path.join(entry.projectRoot, "PROJECT_MANIFEST.json");
  const manifest = await readManifestRecordIfPresent(manifestPath);
  if (!manifest) {
    if (queueTerminalStatus) {
      if (queueTerminalStatus === "needs_repair" && !allowNeedsRepair) {
        return null;
      }
      return {
        terminalStatus: queueTerminalStatus,
        error: queueTerminalError,
        source: "runtime_queue",
      };
    }
    return null;
  }
  const paperIngestionRecord = asRecord(manifest.paper_ingestion) ?? {};
  const paperIngestion = normalizePaperIngestionState(paperIngestionRecord);
  const matchedRequest = paperIngestion.queuedRequests.find(
    (request) =>
      (request.lastRunId && request.lastRunId === entry.runId) ||
      (request.lastSessionKey &&
        request.lastSessionKey === entry.backgroundSessionKey)
  );
  const requestTerminalStatus = deriveTerminalStatusFromQueuedRequestStatus(
    matchedRequest?.status
  );
  if (
    matchedRequest &&
    isInvalidCompletedWorkflowOwnedLiteratureRequisitionRequest({
      state: paperIngestion,
      request: matchedRequest,
    })
  ) {
    return {
      terminalStatus: "needs_repair",
      error: INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON,
      source: "paper_ingestion_request",
    };
  }
  if (requestTerminalStatus) {
    if (requestTerminalStatus === "needs_repair" && !allowNeedsRepair) {
      return null;
    }
    return {
      terminalStatus: requestTerminalStatus,
      error:
        requestTerminalStatus === "completed"
          ? null
          : readString(matchedRequest?.lastError),
      source: "paper_ingestion_request",
    };
  }

  if (
    matchedRequest &&
    queueTerminalStatus === "completed" &&
    isInvalidCompletedWorkflowOwnedLiteratureRequisitionRequest({
      state: paperIngestion,
      request: {
        ...matchedRequest,
        status: "completed",
      },
    })
  ) {
    return {
      terminalStatus: "needs_repair",
      error: INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON,
      source: "paper_ingestion_request",
    };
  }

  if (queueTerminalStatus) {
    if (queueTerminalStatus === "needs_repair" && !allowNeedsRepair) {
      return null;
    }
    return {
      terminalStatus: queueTerminalStatus,
      error: queueTerminalError,
      source: "runtime_queue",
    };
  }

  if (entry.kind !== "papernexus_wrapper" || entry.family !== "papernexus") {
    return null;
  }

  const papernexusProgress = await readPapernexusProgress(entry.projectRoot);
  const ownerRunMatches =
    (papernexusProgress?.owner_run?.run_id &&
      papernexusProgress.owner_run.run_id === entry.runId) ||
    (papernexusProgress?.owner_run?.session_key &&
      papernexusProgress.owner_run.session_key === entry.backgroundSessionKey) ||
    (papernexusProgress?.owner_run?.queue_key &&
      papernexusProgress.owner_run.queue_key === entry.queueKey);
  if (papernexusProgress && (ownerRunMatches || isImportWrapperQueueKey(entry.queueKey))) {
    if (papernexusProgress.phase === "ready" || papernexusProgress.phase === "verifying_graph") {
      return {
        terminalStatus: "completed",
        error: null,
        source: "papernexus_progress",
      };
    }
    if (papernexusProgress.phase === "needs_repair") {
      if (!allowNeedsRepair) {
        return null;
      }
      return {
        terminalStatus: "needs_repair",
        error: papernexusProgress.blocking_reason,
        source: "papernexus_progress",
      };
    }
    if (papernexusProgress.phase === "failed") {
      return {
        terminalStatus: "failed",
        error: papernexusProgress.blocking_reason,
        source: "papernexus_progress",
      };
    }
  }

  if (
    isImportWrapperQueueKey(entry.queueKey) &&
    !hasDurableInFlightPaperUpload(paperIngestion)
  ) {
    return {
      terminalStatus: "completed",
      error: null,
      source: "paper_ingestion_idle_import_wrapper",
    };
  }

  return null;
}

async function reconcilePaperIngestionTerminalState(params: {
  entry: BackgroundRunTerminalEntry;
  terminalStatus: BackgroundRunTerminalStatus;
  finishedAt: string;
  error: string | null;
}): Promise<boolean> {
  if (!params.entry.projectRoot) {
    return false;
  }
  const manifestPath = path.join(params.entry.projectRoot, "PROJECT_MANIFEST.json");
  const manifest = await readManifestRecordIfPresent(manifestPath);
  if (!manifest) {
    return false;
  }
  const paperIngestionRecord = asRecord(manifest.paper_ingestion) ?? {};
  const paperIngestion = normalizePaperIngestionState(paperIngestionRecord);
  const graphPresenceStatus = normalizeGraphPresenceStatus(
    paperIngestionRecord.graph_presence_status ?? paperIngestionRecord.graphPresenceStatus
  );

  let matched = false;
  let matchedRequestWrapper: string | null = null;
  let effectiveTerminalStatus = params.terminalStatus;
  let effectiveError = params.error;
  const queuedRequests = paperIngestion.queuedRequests.map((request) => {
    const matches =
      (request.lastRunId && request.lastRunId === params.entry.runId) ||
      (request.lastSessionKey &&
        request.lastSessionKey === params.entry.backgroundSessionKey);
    if (!matches) {
      return request;
    }
    matched = true;
    matchedRequestWrapper = request.wrapper;
    const completionWouldBeInvalid =
      effectiveTerminalStatus === "completed" &&
      isInvalidCompletedWorkflowOwnedLiteratureRequisitionRequest({
        state: paperIngestion,
        request: {
          ...request,
          status: "completed",
        },
      });
    if (completionWouldBeInvalid) {
      effectiveTerminalStatus = "needs_repair";
      effectiveError = INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON;
      return finalizeQueuedPaperIngestionAttempt({
        request,
        terminalStatus: "needs_repair",
        finishedAt: params.finishedAt,
        error: INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON,
      });
    }
    const existingTerminalStatus = deriveTerminalStatusFromQueuedRequestStatus(
      request.status
    );
    if (existingTerminalStatus) {
      if (
        isInvalidCompletedWorkflowOwnedLiteratureRequisitionRequest({
          state: paperIngestion,
          request,
        })
      ) {
        effectiveTerminalStatus = "needs_repair";
        effectiveError = INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON;
        return finalizeQueuedPaperIngestionAttempt({
          request,
          terminalStatus: "needs_repair",
          finishedAt: params.finishedAt,
          error: INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON,
        });
      }
      return request;
    }
    return finalizeQueuedPaperIngestionAttempt({
      request,
      terminalStatus: effectiveTerminalStatus,
      finishedAt: params.finishedAt,
      error: effectiveError,
    });
  });

  if (
    !matched &&
    (params.entry.kind !== "papernexus_wrapper" ||
      params.entry.family !== "papernexus" ||
      !isImportWrapperQueueKey(params.entry.queueKey) ||
      hasDurableInFlightPaperUpload(paperIngestion))
  ) {
    return false;
  }

  const nextState = matched
    ? {
        ...paperIngestion,
        queuedRequests,
      }
    : {
        ...paperIngestion,
      };
  nextState.runtimeStatus = derivePaperIngestionRuntimeStatus({
    paperIngestion: nextState,
    graphPresenceStatus,
    terminalStatus: effectiveTerminalStatus,
  });
  nextState.waitingReason = derivePaperIngestionWaitingReason({
    paperIngestion: nextState,
    graphPresenceStatus,
    terminalStatus: effectiveTerminalStatus,
    error: effectiveError,
  });
  nextState.lastUpdatedAt = params.finishedAt;

  const nextManifest = {
    ...manifest,
    paper_ingestion: {
      ...paperIngestionRecord,
      ...serializePaperIngestionState(nextState),
    },
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8");
  await writePapernexusProgressFromManifest({
    projectRoot: params.entry.projectRoot,
    manifest: nextManifest,
    ownerRun: {
      run_id: params.entry.runId,
      session_key: params.entry.backgroundSessionKey,
      queue_key: params.entry.queueKey,
      wrapper: matchedRequestWrapper,
    },
    updatedAt: params.finishedAt,
  });
  return true;
}

export async function reconcileBackgroundRunTerminalState(params: {
  entry: BackgroundRunTerminalEntry;
  terminalStatus: BackgroundRunTerminalStatus;
  finishedAt: string;
  error?: string | null;
}): Promise<{
  queuePatched: boolean;
  manifestPatched: boolean;
}> {
  const entry = {
    ...params.entry,
    projectRoot: readString(params.entry.projectRoot),
    projectId: readString(params.entry.projectId),
    queueKey: readString(params.entry.queueKey),
  };
  if (!entry.projectRoot) {
    return {
      queuePatched: false,
      manifestPatched: false,
    };
  }
  const error = readString(params.error) ?? null;
  const capacityFailure = isProviderCapacityFailure(error);
  const terminalStatus: BackgroundRunTerminalStatus =
    capacityFailure && params.terminalStatus === "failed"
      ? "needs_repair"
      : params.terminalStatus;
  let effectiveTerminalStatus = terminalStatus;
  let effectiveError = error;
  if (terminalStatus === "completed") {
    const manifestPath = path.join(entry.projectRoot, "PROJECT_MANIFEST.json");
    const manifest = await readManifestRecordIfPresent(manifestPath);
    const paperIngestionRecord = asRecord(manifest?.paper_ingestion) ?? {};
    const paperIngestion = normalizePaperIngestionState(paperIngestionRecord);
    const matchedRequest = paperIngestion.queuedRequests.find(
      (request) =>
        (request.lastRunId && request.lastRunId === entry.runId) ||
        (request.lastSessionKey &&
          request.lastSessionKey === entry.backgroundSessionKey)
    );
    if (
      matchedRequest &&
      isInvalidCompletedWorkflowOwnedLiteratureRequisitionRequest({
        state: paperIngestion,
        request: {
          ...matchedRequest,
          status: "completed",
        },
      })
    ) {
      effectiveTerminalStatus = "needs_repair";
      effectiveError = INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON;
    }
  }
  const finishedAtMs = Date.parse(params.finishedAt);
  const cooldownUntil = capacityFailure
    ? new Date(
        (Number.isFinite(finishedAtMs) ? finishedAtMs : Date.now()) +
          DEFAULT_PROVIDER_CAPACITY_COOLDOWN_MS
      ).toISOString()
    : null;
  if (
    terminalStatus === "failed" &&
    isWorkflowRuntimeTrackingMissError(error)
  ) {
    return {
      queuePatched: false,
      manifestPatched: false,
    };
  }
  const [queuePatched, manifestPatched] = await Promise.all([
    reconcileQueueTerminalState({
      entry,
      terminalStatus: effectiveTerminalStatus,
      finishedAt: params.finishedAt,
      error: effectiveError,
      nextRetryAt: cooldownUntil,
    }),
    reconcilePaperIngestionTerminalState({
      entry,
      terminalStatus: effectiveTerminalStatus,
      finishedAt: params.finishedAt,
      error: effectiveError,
    }),
  ]);
  if (capacityFailure && entry.queueKey) {
    const queueStore = await readWorkflowRuntimeQueueStore(entry.projectRoot);
    const queueEntry =
      queueStore.entries.find((candidate) => candidate.queueKey === entry.queueKey) ??
      null;
    await appendWorkflowLocalOperatorRelay({
      projectRoot: entry.projectRoot,
      projectId: entry.projectId,
      idempotencyKey: `provider-capacity:${entry.queueKey}:${cooldownUntil ?? "unknown"}`,
      queueKey: entry.queueKey,
      sessionKey: entry.backgroundSessionKey,
      ownerAgent: queueEntry?.ownerAgent ?? null,
      stage: queueEntry?.dispatchPayload?.stage ?? null,
      kind: "provider_capacity_cooldown",
      summary:
        "Background workflow run hit provider capacity limits and needs local operator follow-up.",
      reason:
        error ??
        "Background workflow run failed because the configured model provider is at capacity.",
      cooldownUntil,
      operatorPrompt: [
        "Continue this AutoResearch workflow locally without Discord.",
        `Project root: ${entry.projectRoot}`,
        entry.projectId ? `Project id: ${entry.projectId}` : null,
        `Queue key: ${entry.queueKey}`,
        `Session key: ${entry.backgroundSessionKey}`,
        queueEntry?.summary ? `Transition summary: ${queueEntry.summary}` : null,
        "The provider returned a capacity/quota error. Use configured agent model fallbacks when available; otherwise wait until cooldownUntil before replaying the queued transition.",
      ]
        .filter(Boolean)
        .join("\n"),
      details: {
        source: queueEntry?.source ?? null,
        entryType: queueEntry?.entryType ?? null,
        kind: queueEntry?.kind ?? entry.kind,
        family: queueEntry?.family ?? entry.family,
        runId: entry.runId,
      },
    });
  }
  if (queuePatched || manifestPatched) {
    await appendWorkflowRuntimeEvent({
      projectRoot: entry.projectRoot,
      projectId: entry.projectId,
      kind: "background_run_reconciled",
      summary: `Background workflow ${entry.runId} reconciled as ${effectiveTerminalStatus}.`,
      details: {
        queueKey: entry.queueKey,
        kind: entry.kind,
        family: entry.family,
        queuePatched,
        manifestPatched,
        error: effectiveError,
        providerCapacityCooldownUntil: cooldownUntil,
      },
    });
  }
  return {
    queuePatched,
    manifestPatched,
  };
}
