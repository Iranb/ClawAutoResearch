import fs from "node:fs/promises";
import path from "node:path";
import {
  appendWorkflowRuntimeEvent,
  readWorkflowRuntimeQueueStore,
  writeWorkflowRuntimeQueueStore,
  type WorkflowRuntimeQueueEntryStatus,
} from "./workflow-runtime-state.js";
import {
  normalizePaperIngestionState,
  serializePaperIngestionState,
} from "./workflow-guard-state/paper-ingestion";
import { normalizeGraphPresenceStatus } from "./workflow-guard-core/coercion";
import {
  readPapernexusProgress,
  writePapernexusProgressFromManifest,
} from "./papernexus-progress";

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

function deriveQueuedRequestTerminalStatus(
  status: BackgroundRunTerminalStatus
): "completed" | "failed" | "needs_repair" {
  if (status === "failed") {
    return "failed";
  }
  if (status === "needs_repair") {
    return "needs_repair";
  }
  return "completed";
}

function deriveQueuedRequestDetail(params: {
  status: BackgroundRunTerminalStatus;
  error: string | null;
}): string {
  if (params.status === "completed") {
    return "Workflow observed that the delegated PaperNexus wrapper pass finished. Upload execution is no longer running in the background.";
  }
  if (params.status === "failed") {
    return params.error
      ? `Workflow observed that the delegated PaperNexus wrapper pass failed: ${params.error}`
      : "Workflow observed that the delegated PaperNexus wrapper pass failed.";
  }
  return params.error
    ? `Workflow could not reconcile the delegated PaperNexus wrapper pass cleanly and marked it for repair: ${params.error}`
    : "Workflow could not reconcile the delegated PaperNexus wrapper pass cleanly and marked it for repair.";
}

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
    return params.paperIngestion.waitingReason;
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
}): Promise<boolean> {
  if (!params.entry.projectRoot || !params.entry.queueKey) {
    return false;
  }
  const queueStore = await readWorkflowRuntimeQueueStore(params.entry.projectRoot);
  const index = queueStore.entries.findIndex(
    (entry) => entry.queueKey === params.entry.queueKey
  );
  if (index < 0) {
    return false;
  }
  const current = queueStore.entries[index];
  const queueStatus: WorkflowRuntimeQueueEntryStatus =
    params.terminalStatus === "completed"
      ? "completed"
      : params.terminalStatus === "failed"
        ? "failed"
        : "needs_repair";
  const next = {
    ...current,
    status: queueStatus,
    lastAttemptedAt: params.finishedAt,
    lastError:
      params.terminalStatus === "completed"
        ? null
        : params.error ?? current.lastError,
  };
  if (JSON.stringify(next) === JSON.stringify(current)) {
    return false;
  }
  const nextEntries = [...queueStore.entries];
  nextEntries[index] = next;
  await writeWorkflowRuntimeQueueStore({
    projectRoot: params.entry.projectRoot,
    projectId: queueStore.projectId,
    entries: nextEntries,
  });
  return true;
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

export async function inferBackgroundRunTerminalStateFromDurableState(params: {
  entry: BackgroundRunTerminalEntry;
}): Promise<BackgroundRunDurableTerminalState | null> {
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
  if (entry.queueKey) {
    const queueEntry = queueStore.entries.find(
      (candidate) => candidate.queueKey === entry.queueKey
    );
    const queueTerminalStatus = deriveTerminalStatusFromQueueStatus(queueEntry?.status);
    if (queueTerminalStatus) {
      return {
        terminalStatus: queueTerminalStatus,
        error:
          queueTerminalStatus === "completed" ? null : readString(queueEntry?.lastError),
        source: "runtime_queue",
      };
    }
  }

  if (entry.kind !== "papernexus_wrapper" || entry.family !== "papernexus") {
    return null;
  }

  const manifestPath = path.join(entry.projectRoot, "PROJECT_MANIFEST.json");
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
  const manifest = asRecord(JSON.parse(manifestRaw)) ?? {};
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
  if (requestTerminalStatus) {
    return {
      terminalStatus: requestTerminalStatus,
      error:
        requestTerminalStatus === "completed"
          ? null
          : readString(matchedRequest?.lastError),
      source: "paper_ingestion_request",
    };
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
  if (
    !params.entry.projectRoot ||
    params.entry.kind !== "papernexus_wrapper" ||
    params.entry.family !== "papernexus"
  ) {
    return false;
  }
  const manifestPath = path.join(params.entry.projectRoot, "PROJECT_MANIFEST.json");
  let manifestRaw: string;
  try {
    manifestRaw = await fs.readFile(manifestPath, "utf8");
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : null;
    if (code === "ENOENT") {
      return false;
    }
    throw error;
  }
  const manifest = asRecord(JSON.parse(manifestRaw)) ?? {};
  const paperIngestionRecord = asRecord(manifest.paper_ingestion) ?? {};
  const paperIngestion = normalizePaperIngestionState(paperIngestionRecord);
  const graphPresenceStatus = normalizeGraphPresenceStatus(
    paperIngestionRecord.graph_presence_status ?? paperIngestionRecord.graphPresenceStatus
  );

  let matched = false;
  let matchedRequestWrapper: string | null = null;
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
    return {
      ...request,
      status: deriveQueuedRequestTerminalStatus(params.terminalStatus),
      updatedAt: params.finishedAt,
      finishedAt: params.finishedAt,
      lastError:
        params.terminalStatus === "completed" ? null : params.error ?? request.lastError,
      detail: deriveQueuedRequestDetail({
        status: params.terminalStatus,
        error: params.error,
      }),
    };
  });

  if (
    !matched &&
    (!isImportWrapperQueueKey(params.entry.queueKey) ||
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
    terminalStatus: params.terminalStatus,
  });
  nextState.waitingReason = derivePaperIngestionWaitingReason({
    paperIngestion: nextState,
    graphPresenceStatus,
    terminalStatus: params.terminalStatus,
    error: params.error,
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
  const [queuePatched, manifestPatched] = await Promise.all([
    reconcileQueueTerminalState({
      entry,
      terminalStatus: params.terminalStatus,
      finishedAt: params.finishedAt,
      error,
    }),
    reconcilePaperIngestionTerminalState({
      entry,
      terminalStatus: params.terminalStatus,
      finishedAt: params.finishedAt,
      error,
    }),
  ]);
  if (queuePatched || manifestPatched) {
    await appendWorkflowRuntimeEvent({
      projectRoot: entry.projectRoot,
      projectId: entry.projectId,
      kind: "background_run_reconciled",
      summary: `Background workflow ${entry.runId} reconciled as ${params.terminalStatus}.`,
      details: {
        queueKey: entry.queueKey,
        kind: entry.kind,
        family: entry.family,
        queuePatched,
        manifestPatched,
        error,
      },
    });
  }
  return {
    queuePatched,
    manifestPatched,
  };
}
