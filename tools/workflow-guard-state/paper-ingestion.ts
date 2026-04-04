import { randomUUID } from "node:crypto";
import {
  asRecord,
  asString,
  normalizeGraphPresenceStatus,
  normalizeStage,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";
import type {
  PaperIngestionBatchItem,
  PaperIngestionBatchRun,
  PaperIngestionCompletedPaper,
  PaperIngestionPaperOperation,
  PaperIngestionQueuedRequest,
  PaperIngestionState,
} from "../workflow-guard.js";

export function normalizePaperIngestionRuntimeStatus(value: unknown): string {
  const normalized = normalizeStage(value);
  switch (normalized) {
    case "waiting_import":
    case "waiting_graph":
    case "reconciling":
    case "ready":
    case "blocked":
    case "idle":
      return normalized;
    default:
      return "idle";
  }
}

function normalizePaperIngestionOperationPhase(
  value: unknown
): PaperIngestionPaperOperation["phase"] {
  return normalizeStage(value) === "graph" ? "graph" : "import";
}

function normalizePaperIngestionOperationStatus(
  value: unknown
): PaperIngestionPaperOperation["status"] {
  const normalized = normalizeStage(value);
  switch (normalized) {
    case "queued":
    case "running":
    case "completed":
    case "timed_out":
    case "failed":
      return normalized;
    default:
      return "queued";
  }
}

function normalizePaperIngestionQueuedRequestStatus(
  value: unknown
): PaperIngestionQueuedRequest["status"] {
  const normalized = normalizeStage(value);
  switch (normalized) {
    case "queued":
    case "launching":
    case "running":
    case "completed":
    case "needs_repair":
    case "failed":
      return normalized;
    default:
      return "queued";
  }
}

export function normalizePaperIngestionState(value: unknown): PaperIngestionState {
  const record = asRecord(value) ?? {};
  const importTaskIdsRaw = record.import_task_ids ?? record.importTaskIds;
  const completedPapersRaw = record.completed_papers ?? record.completedPapers;
  const paperOperationsRaw = record.paper_operations ?? record.paperOperations;
  const activeBatchesRaw = record.active_batches ?? record.activeBatches;
  const batchItemsRaw = record.batch_items ?? record.batchItems;
  const queuedRequestsRaw = record.queued_requests ?? record.queuedRequests;
  const activeBatches = normalizePaperIngestionBatchRuns(activeBatchesRaw);
  const batchItems = normalizePaperIngestionBatchItems(batchItemsRaw);
  return {
    runtimeStatus: normalizePaperIngestionRuntimeStatus(
      record.runtimeStatus ?? record.runtime_status
    ),
    waitingReason: pickString(record, ["waitingReason", "waiting_reason"]),
    importTaskIds: Array.isArray(importTaskIdsRaw)
      ? importTaskIdsRaw
          .map((entry: unknown) => asString(entry))
          .filter((entry): entry is string => Boolean(entry))
      : [],
    lastImportTaskId: pickString(record, ["lastImportTaskId", "last_import_task_id"]),
    lastImportStatus:
      normalizeStage(record.lastImportStatus ?? record.last_import_status) ?? null,
    completedPapers: normalizeCompletedPaperEntries(completedPapersRaw),
    paperOperations: normalizePaperIngestionPaperOperations(paperOperationsRaw),
    activeBatches,
    batchItems,
    queuedRequests: normalizePaperIngestionQueuedRequests(queuedRequestsRaw),
    lastBatchManifestPath:
      pickString(record, ["lastBatchManifestPath", "last_batch_manifest_path"]) ??
      activeBatches[activeBatches.length - 1]?.manifestPath ??
      batchItems[batchItems.length - 1]?.manifestPath ??
      null,
    graphVersionSeen: pickString(record, ["graphVersionSeen", "graph_version_seen"]),
    reconcileRequired:
      record.reconcileRequired === true || record.reconcile_required === true,
    repairRequired:
      record.repairRequired === true || record.repair_required === true,
    repairReason: pickString(record, ["repairReason", "repair_reason"]),
    repairTargetCorpus: pickString(record, [
      "repairTargetCorpus",
      "repair_target_corpus",
    ]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

export function serializePaperIngestionState(
  value: PaperIngestionState
): Record<string, unknown> {
  return {
    runtime_status: value.runtimeStatus,
    waiting_reason: value.waitingReason,
    import_task_ids: value.importTaskIds,
    last_import_task_id: value.lastImportTaskId,
    last_import_status: value.lastImportStatus,
    completed_papers: value.completedPapers.map(serializeCompletedPaperEntry),
    paper_operations: value.paperOperations.map(serializePaperIngestionPaperOperation),
    active_batches: value.activeBatches.map(serializePaperIngestionBatchRun),
    batch_items: value.batchItems.map(serializePaperIngestionBatchItem),
    queued_requests: value.queuedRequests.map(serializePaperIngestionQueuedRequest),
    last_batch_manifest_path: value.lastBatchManifestPath,
    graph_version_seen: value.graphVersionSeen,
    reconcile_required: value.reconcileRequired,
    repair_required: value.repairRequired,
    repair_reason: value.repairReason,
    repair_target_corpus: value.repairTargetCorpus,
    last_updated_at: value.lastUpdatedAt,
  };
}

export function hasActiveWorkflowOwnedPaperUpload(
  state: PaperIngestionState
): boolean {
  if (
    ["waiting_import", "waiting_graph", "reconciling"].includes(
      normalizePaperIngestionRuntimeStatus(state.runtimeStatus) ?? ""
    )
  ) {
    return true;
  }
  if (
    state.queuedRequests.some((request) =>
      ["queued", "launching", "running"].includes(normalizeStage(request.status) ?? "")
    )
  ) {
    return true;
  }
  if (
    state.activeBatches.some((batch) =>
      ["queued", "running"].includes(normalizeStage(batch.status) ?? "")
    )
  ) {
    return true;
  }
  if (
    state.paperOperations.some((operation) =>
      ["queued", "running"].includes(normalizeStage(operation.status) ?? "")
    )
  ) {
    return true;
  }
  return false;
}

export function deriveGraphBuildMicroStage(params: {
  paperIngestionState: PaperIngestionState;
  graphPresenceStatus: string | null;
}): string {
  if (hasActiveWorkflowOwnedPaperUpload(params.paperIngestionState)) {
    return "uploading";
  }
  if (normalizeGraphPresenceStatus(params.graphPresenceStatus) !== "ready") {
    return "verifying";
  }
  return "brainstorm_refresh";
}

function normalizeCompletedPaperEntry(
  value: unknown
): PaperIngestionCompletedPaper | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const canonicalId = pickString(record, ["canonicalId", "canonical_id"]);
  const title = pickString(record, ["title"]);
  const importTaskId = pickString(record, ["importTaskId", "import_task_id"]);
  if (!canonicalId && !title && !importTaskId) {
    return null;
  }
  return {
    canonicalId,
    title,
    importTaskId,
  };
}

function normalizeCompletedPaperEntries(
  value: unknown
): PaperIngestionCompletedPaper[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: PaperIngestionCompletedPaper[] = [];
  for (const item of value) {
    const normalized = normalizeCompletedPaperEntry(item);
    if (!normalized) {
      continue;
    }
    const existingIndex = entries.findIndex((entry) =>
      areCompletedPaperEntriesEquivalent(entry, normalized)
    );
    if (existingIndex >= 0) {
      entries[existingIndex] = mergeCompletedPaperEntryValues(
        entries[existingIndex],
        normalized
      );
      continue;
    }
    entries.push(normalized);
  }
  return entries;
}

function serializeCompletedPaperEntry(
  value: PaperIngestionCompletedPaper
): Record<string, unknown> {
  return {
    canonical_id: value.canonicalId,
    title: value.title,
    import_task_id: value.importTaskId,
  };
}

function normalizePaperIngestionPaperOperation(
  value: unknown
): PaperIngestionPaperOperation | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const canonicalId = pickString(record, ["canonicalId", "canonical_id"]);
  const title = pickString(record, ["title"]);
  const importTaskId = pickString(record, ["importTaskId", "import_task_id"]);
  if (!canonicalId && !title && !importTaskId) {
    return null;
  }
  const timeoutSecondsRaw = pickNumber(record, [
    "timeoutSeconds",
    "timeout_seconds",
  ]);
  return {
    canonicalId,
    title,
    importTaskId,
    phase: normalizePaperIngestionOperationPhase(record.phase),
    status: normalizePaperIngestionOperationStatus(record.status),
    timeoutSeconds:
      typeof timeoutSecondsRaw === "number" && Number.isFinite(timeoutSecondsRaw)
        ? Math.max(1, Math.floor(timeoutSecondsRaw))
        : null,
    startedAt: pickString(record, ["startedAt", "started_at"]),
    deadlineAt: pickString(record, ["deadlineAt", "deadline_at"]),
    finishedAt: pickString(record, ["finishedAt", "finished_at"]),
    detail: pickString(record, ["detail", "reason", "message"]),
  };
}

function normalizePaperIngestionPaperOperations(
  value: unknown
): PaperIngestionPaperOperation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: PaperIngestionPaperOperation[] = [];
  for (const item of value) {
    const normalized = normalizePaperIngestionPaperOperation(item);
    if (!normalized) {
      continue;
    }
    const existingIndex = entries.findIndex((entry) =>
      arePaperIngestionPaperOperationsEquivalent(entry, normalized)
    );
    if (existingIndex >= 0) {
      entries[existingIndex] = mergePaperIngestionOperationValues(
        entries[existingIndex],
        normalized
      );
      continue;
    }
    entries.push(normalized);
  }
  return entries;
}

function serializePaperIngestionPaperOperation(
  value: PaperIngestionPaperOperation
): Record<string, unknown> {
  return {
    canonical_id: value.canonicalId,
    title: value.title,
    import_task_id: value.importTaskId,
    phase: value.phase,
    status: value.status,
    timeout_seconds: value.timeoutSeconds,
    started_at: value.startedAt,
    deadline_at: value.deadlineAt,
    finished_at: value.finishedAt,
    detail: value.detail,
  };
}

function areCompletedPaperEntriesEquivalent(
  left: PaperIngestionCompletedPaper,
  right: PaperIngestionCompletedPaper
): boolean {
  if (left.canonicalId && right.canonicalId && left.canonicalId === right.canonicalId) {
    return true;
  }
  if (left.importTaskId && right.importTaskId && left.importTaskId === right.importTaskId) {
    return true;
  }
  if (left.title && right.title && left.title === right.title) {
    return true;
  }
  return false;
}

function mergeCompletedPaperEntryValues(
  current: PaperIngestionCompletedPaper,
  patch: PaperIngestionCompletedPaper
): PaperIngestionCompletedPaper {
  return {
    canonicalId: current.canonicalId ?? patch.canonicalId,
    title: current.title ?? patch.title,
    importTaskId: current.importTaskId ?? patch.importTaskId,
  };
}

function arePaperIngestionPaperOperationsEquivalent(
  left: PaperIngestionPaperOperation,
  right: PaperIngestionPaperOperation
): boolean {
  if (left.phase !== right.phase) {
    return false;
  }
  if (left.canonicalId && right.canonicalId && left.canonicalId === right.canonicalId) {
    return true;
  }
  if (left.importTaskId && right.importTaskId && left.importTaskId === right.importTaskId) {
    return true;
  }
  if (left.title && right.title && left.title === right.title) {
    return true;
  }
  return false;
}

function mergePaperIngestionOperationValues(
  current: PaperIngestionPaperOperation,
  patch: PaperIngestionPaperOperation
): PaperIngestionPaperOperation {
  return {
    canonicalId: current.canonicalId ?? patch.canonicalId,
    title: current.title ?? patch.title,
    importTaskId: current.importTaskId ?? patch.importTaskId,
    phase: patch.phase,
    status: patch.status,
    timeoutSeconds: patch.timeoutSeconds ?? current.timeoutSeconds,
    startedAt: current.startedAt ?? patch.startedAt,
    deadlineAt: patch.deadlineAt ?? current.deadlineAt,
    finishedAt: patch.finishedAt ?? current.finishedAt,
    detail: patch.detail ?? current.detail,
  };
}

function isPaperIngestionOperationTerminal(
  value: PaperIngestionPaperOperation["status"]
): boolean {
  return value === "completed" || value === "timed_out" || value === "failed";
}

function normalizePaperIngestionBatchStatus(
  value: unknown
): PaperIngestionBatchRun["status"] {
  const normalized = normalizeStage(value);
  switch (normalized) {
    case "queued":
    case "running":
    case "completed":
    case "timed_out":
    case "failed":
      return normalized;
    default:
      return "queued";
  }
}

function normalizePaperIngestionBatchRun(
  value: unknown
): PaperIngestionBatchRun | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const manifestPath = pickString(record, ["manifestPath", "manifest_path"]);
  const detail = pickString(record, ["detail", "reason", "message"]);
  const total = pickNumber(record, ["total"]);
  const submitted = pickNumber(record, ["submitted"]);
  const completed = pickNumber(record, ["completed"]);
  const running = pickNumber(record, ["running"]);
  const pending = pickNumber(record, ["pending"]);
  const failed = pickNumber(record, ["failed"]);
  const submitFailed = pickNumber(record, ["submitFailed", "submit_failed"]);
  if (
    !manifestPath &&
    !detail &&
    total == null &&
    submitted == null &&
    completed == null &&
    running == null &&
    pending == null &&
    failed == null &&
    submitFailed == null
  ) {
    return null;
  }
  const normalizeCount = (count: number | null) =>
    typeof count === "number" && Number.isFinite(count)
      ? Math.max(0, Math.floor(count))
      : null;
  return {
    manifestPath,
    status: normalizePaperIngestionBatchStatus(record.status),
    total: normalizeCount(total),
    submitted: normalizeCount(submitted),
    completed: normalizeCount(completed),
    running: normalizeCount(running),
    pending: normalizeCount(pending),
    failed: normalizeCount(failed),
    submitFailed: normalizeCount(submitFailed),
    startedAt: pickString(record, ["startedAt", "started_at"]),
    updatedAt: pickString(record, ["updatedAt", "updated_at"]),
    finishedAt: pickString(record, ["finishedAt", "finished_at"]),
    detail,
  };
}

function normalizePaperIngestionBatchRuns(
  value: unknown
): PaperIngestionBatchRun[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: PaperIngestionBatchRun[] = [];
  for (const item of value) {
    const normalized = normalizePaperIngestionBatchRun(item);
    if (!normalized) {
      continue;
    }
    const existingIndex = entries.findIndex((entry) =>
      arePaperIngestionBatchRunsEquivalent(entry, normalized)
    );
    if (existingIndex >= 0) {
      entries[existingIndex] = mergePaperIngestionBatchRunValues(
        entries[existingIndex],
        normalized
      );
      continue;
    }
    entries.push(normalized);
  }
  return entries;
}

function serializePaperIngestionBatchRun(
  value: PaperIngestionBatchRun
): Record<string, unknown> {
  return {
    manifest_path: value.manifestPath,
    status: value.status,
    total: value.total,
    submitted: value.submitted,
    completed: value.completed,
    running: value.running,
    pending: value.pending,
    failed: value.failed,
    submit_failed: value.submitFailed,
    started_at: value.startedAt,
    updated_at: value.updatedAt,
    finished_at: value.finishedAt,
    detail: value.detail,
  };
}

function normalizePaperIngestionBatchItemStatus(
  value: unknown
): PaperIngestionBatchItem["status"] {
  const normalized = normalizeStage(value);
  switch (normalized) {
    case "pending":
    case "running":
    case "completed":
    case "failed":
      return normalized;
    default:
      break;
  }
  return asString(value)?.toLowerCase() === "submit_failed" ? "submit_failed" : null;
}

function normalizePaperIngestionBatchItem(
  value: unknown
): PaperIngestionBatchItem | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const manifestPath = pickString(record, ["manifestPath", "manifest_path"]);
  const paperId = pickString(record, ["paperId", "paper_id"]);
  const canonicalId = pickString(record, ["canonicalId", "canonical_id"]);
  const title = pickString(record, ["title"]);
  const importTaskId = pickString(record, [
    "importTaskId",
    "import_task_id",
    "taskId",
    "task_id",
  ]);
  if (!manifestPath && !paperId && !canonicalId && !title && !importTaskId) {
    return null;
  }
  return {
    manifestPath,
    paperId,
    canonicalId,
    title,
    importTaskId,
    status: normalizePaperIngestionBatchItemStatus(record.status),
    stage: normalizeStage(record.stage) ?? pickString(record, ["stage"]),
    submitted: record.submitted === true,
    synced: record.synced === true,
    matchedBy: pickString(record, ["matchedBy", "matched_by"]),
    error: pickString(record, ["error", "detail", "reason", "message"]),
    updatedAt: pickString(record, ["updatedAt", "updated_at"]),
  };
}

function normalizePaperIngestionBatchItems(
  value: unknown
): PaperIngestionBatchItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: PaperIngestionBatchItem[] = [];
  for (const item of value) {
    const normalized = normalizePaperIngestionBatchItem(item);
    if (!normalized) {
      continue;
    }
    const existingIndex = entries.findIndex((entry) =>
      arePaperIngestionBatchItemsEquivalent(entry, normalized)
    );
    if (existingIndex >= 0) {
      entries[existingIndex] = mergePaperIngestionBatchItemValues(
        entries[existingIndex],
        normalized
      );
      continue;
    }
    entries.push(normalized);
  }
  return entries;
}

function serializePaperIngestionBatchItem(
  value: PaperIngestionBatchItem
): Record<string, unknown> {
  return {
    manifest_path: value.manifestPath,
    paper_id: value.paperId,
    canonical_id: value.canonicalId,
    title: value.title,
    import_task_id: value.importTaskId,
    status: value.status,
    stage: value.stage,
    submitted: value.submitted,
    synced: value.synced,
    matched_by: value.matchedBy,
    error: value.error,
    updated_at: value.updatedAt,
  };
}

export function normalizePaperIngestionQueuedRequest(
  value: unknown
): PaperIngestionQueuedRequest | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const requestId =
    pickString(record, ["requestId", "request_id"]) ?? randomUUID();
  const wrapper = pickString(record, ["wrapper"]);
  const commandText = pickString(record, ["commandText", "command_text"]);
  const manifestPath = pickString(record, ["manifestPath", "manifest_path"]);
  const sharedCorpus = pickString(record, ["sharedCorpus", "shared_corpus"]);
  const summary = pickString(record, ["summary"]);
  const status = normalizePaperIngestionQueuedRequestStatus(record.status);
  const detail = pickString(record, ["detail"]);
  const triggerKind = pickString(record, ["triggerKind", "trigger_kind"]);
  const argsRaw = record.args;
  const args = Array.isArray(argsRaw)
    ? argsRaw
        .map((item) => asString(item))
        .filter((item): item is string => Boolean(item))
    : [];
  const hasSparsePatchPayload = Boolean(detail || triggerKind || record.status != null);
  if (
    !requestId ||
    (!wrapper && !commandText && !manifestPath && !summary && !hasSparsePatchPayload)
  ) {
    return null;
  }
  return {
    requestId,
    status,
    wrapper,
    args,
    commandText,
    manifestPath,
    sharedCorpus,
    paperCount: Math.max(
      0,
      Math.floor(pickNumber(record, ["paperCount", "paper_count"]) ?? 0)
    ) || null,
    summary,
    createdAt: pickString(record, ["createdAt", "created_at"]),
    updatedAt: pickString(record, ["updatedAt", "updated_at"]),
    startedAt: pickString(record, ["startedAt", "started_at"]),
    finishedAt: pickString(record, ["finishedAt", "finished_at"]),
    lastRunId: pickString(record, ["lastRunId", "last_run_id"]),
    lastSessionKey: pickString(record, ["lastSessionKey", "last_session_key"]),
    lastError: pickString(record, ["lastError", "last_error"]),
    detail,
    triggerKind,
  };
}

function normalizePaperIngestionQueuedRequests(
  value: unknown
): PaperIngestionQueuedRequest[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: PaperIngestionQueuedRequest[] = [];
  for (const item of value) {
    const normalized = normalizePaperIngestionQueuedRequest(item);
    if (!normalized) {
      continue;
    }
    const existingIndex = entries.findIndex(
      (entry) => entry.requestId === normalized.requestId
    );
    if (existingIndex >= 0) {
      entries[existingIndex] = mergePaperIngestionQueuedRequestValues(
        entries[existingIndex],
        normalized
      );
      continue;
    }
    entries.push(normalized);
  }
  return entries;
}

export function serializePaperIngestionQueuedRequest(
  value: PaperIngestionQueuedRequest
): Record<string, unknown> {
  return {
    request_id: value.requestId,
    status: value.status,
    wrapper: value.wrapper,
    args: value.args,
    command_text: value.commandText,
    manifest_path: value.manifestPath,
    shared_corpus: value.sharedCorpus,
    paper_count: value.paperCount,
    summary: value.summary,
    created_at: value.createdAt,
    updated_at: value.updatedAt,
    started_at: value.startedAt,
    finished_at: value.finishedAt,
    last_run_id: value.lastRunId,
    last_session_key: value.lastSessionKey,
    last_error: value.lastError,
    detail: value.detail,
    trigger_kind: value.triggerKind,
  };
}

function mergePaperIngestionQueuedRequestValues(
  current: PaperIngestionQueuedRequest,
  patch: PaperIngestionQueuedRequest
): PaperIngestionQueuedRequest {
  return {
    requestId: current.requestId,
    status: patch.status ?? current.status,
    wrapper: patch.wrapper ?? current.wrapper,
    args: patch.args.length > 0 ? patch.args : current.args,
    commandText: patch.commandText ?? current.commandText,
    manifestPath: patch.manifestPath ?? current.manifestPath,
    sharedCorpus: patch.sharedCorpus ?? current.sharedCorpus,
    paperCount: patch.paperCount ?? current.paperCount,
    summary: patch.summary ?? current.summary,
    createdAt: current.createdAt ?? patch.createdAt,
    updatedAt: patch.updatedAt ?? current.updatedAt,
    startedAt: patch.startedAt ?? current.startedAt,
    finishedAt: patch.finishedAt ?? current.finishedAt,
    lastRunId: patch.lastRunId ?? current.lastRunId,
    lastSessionKey: patch.lastSessionKey ?? current.lastSessionKey,
    lastError: patch.lastError ?? current.lastError,
    detail: patch.detail ?? current.detail,
    triggerKind: patch.triggerKind ?? current.triggerKind,
  };
}

export function mergePaperIngestionQueuedRequests(params: {
  current: PaperIngestionQueuedRequest[];
  patch: unknown;
}): {
  queuedRequests: PaperIngestionQueuedRequest[];
} {
  const currentEntries = normalizePaperIngestionQueuedRequests(params.current);
  const patchEntries = normalizePaperIngestionQueuedRequests(params.patch);
  if (patchEntries.length === 0) {
    return {
      queuedRequests: currentEntries,
    };
  }
  const merged = [...currentEntries];
  for (const entry of patchEntries) {
    const existingIndex = merged.findIndex(
      (currentEntry) => currentEntry.requestId === entry.requestId
    );
    if (existingIndex >= 0) {
      merged[existingIndex] = mergePaperIngestionQueuedRequestValues(
        merged[existingIndex],
        entry
      );
      continue;
    }
    merged.push(entry);
  }
  return {
    queuedRequests: merged,
  };
}

function arePaperIngestionBatchRunsEquivalent(
  left: PaperIngestionBatchRun,
  right: PaperIngestionBatchRun
): boolean {
  return Boolean(
    left.manifestPath &&
      right.manifestPath &&
      left.manifestPath === right.manifestPath
  );
}

function mergePaperIngestionBatchRunValues(
  current: PaperIngestionBatchRun,
  patch: PaperIngestionBatchRun
): PaperIngestionBatchRun {
  return {
    manifestPath: current.manifestPath ?? patch.manifestPath,
    status: patch.status,
    total: patch.total ?? current.total,
    submitted: patch.submitted ?? current.submitted,
    completed: patch.completed ?? current.completed,
    running: patch.running ?? current.running,
    pending: patch.pending ?? current.pending,
    failed: patch.failed ?? current.failed,
    submitFailed: patch.submitFailed ?? current.submitFailed,
    startedAt: current.startedAt ?? patch.startedAt,
    updatedAt: patch.updatedAt ?? current.updatedAt,
    finishedAt: patch.finishedAt ?? current.finishedAt,
    detail: patch.detail ?? current.detail,
  };
}

function arePaperIngestionBatchItemsEquivalent(
  left: PaperIngestionBatchItem,
  right: PaperIngestionBatchItem
): boolean {
  if (
    left.manifestPath &&
    right.manifestPath &&
    left.paperId &&
    right.paperId &&
    left.manifestPath === right.manifestPath &&
    left.paperId === right.paperId
  ) {
    return true;
  }
  if (left.importTaskId && right.importTaskId && left.importTaskId === right.importTaskId) {
    return true;
  }
  if (
    left.manifestPath &&
    right.manifestPath &&
    left.canonicalId &&
    right.canonicalId &&
    left.manifestPath === right.manifestPath &&
    left.canonicalId === right.canonicalId
  ) {
    return true;
  }
  return false;
}

function mergePaperIngestionBatchItemValues(
  current: PaperIngestionBatchItem,
  patch: PaperIngestionBatchItem
): PaperIngestionBatchItem {
  return {
    manifestPath: current.manifestPath ?? patch.manifestPath,
    paperId: current.paperId ?? patch.paperId,
    canonicalId: current.canonicalId ?? patch.canonicalId,
    title: current.title ?? patch.title,
    importTaskId: current.importTaskId ?? patch.importTaskId,
    status: patch.status ?? current.status,
    stage: patch.stage ?? current.stage,
    submitted: current.submitted || patch.submitted,
    synced: current.synced || patch.synced,
    matchedBy: patch.matchedBy ?? current.matchedBy,
    error: patch.error ?? current.error,
    updatedAt: patch.updatedAt ?? current.updatedAt,
  };
}

function isPaperIngestionBatchTerminal(
  value: PaperIngestionBatchRun["status"]
): boolean {
  return value === "completed" || value === "timed_out" || value === "failed";
}

export function mergePaperIngestionBatchRuns(params: {
  current: PaperIngestionBatchRun[];
  patch: unknown;
}): {
  activeBatches: PaperIngestionBatchRun[];
  newlyTerminalBatches: PaperIngestionBatchRun[];
} {
  const currentEntries = normalizePaperIngestionBatchRuns(params.current);
  const patchEntries = normalizePaperIngestionBatchRuns(params.patch);
  if (patchEntries.length === 0) {
    return {
      activeBatches: currentEntries,
      newlyTerminalBatches: [],
    };
  }
  const merged = [...currentEntries];
  const newlyTerminalBatches: PaperIngestionBatchRun[] = [];
  for (const entry of patchEntries) {
    const existingIndex = merged.findIndex((currentEntry) =>
      arePaperIngestionBatchRunsEquivalent(currentEntry, entry)
    );
    if (existingIndex >= 0) {
      const previous = merged[existingIndex];
      const next = mergePaperIngestionBatchRunValues(previous, entry);
      merged[existingIndex] = next;
      if (isPaperIngestionBatchTerminal(next.status) && previous.status !== next.status) {
        newlyTerminalBatches.push(next);
      }
      continue;
    }
    merged.push(entry);
    if (isPaperIngestionBatchTerminal(entry.status)) {
      newlyTerminalBatches.push(entry);
    }
  }
  return {
    activeBatches: merged,
    newlyTerminalBatches,
  };
}

export function mergePaperIngestionBatchItems(params: {
  current: PaperIngestionBatchItem[];
  patch: unknown;
}): {
  batchItems: PaperIngestionBatchItem[];
} {
  const currentEntries = normalizePaperIngestionBatchItems(params.current);
  const patchEntries = normalizePaperIngestionBatchItems(params.patch);
  if (patchEntries.length === 0) {
    return {
      batchItems: currentEntries,
    };
  }
  const merged = [...currentEntries];
  for (const entry of patchEntries) {
    const existingIndex = merged.findIndex((currentEntry) =>
      arePaperIngestionBatchItemsEquivalent(currentEntry, entry)
    );
    if (existingIndex >= 0) {
      merged[existingIndex] = mergePaperIngestionBatchItemValues(
        merged[existingIndex],
        entry
      );
      continue;
    }
    merged.push(entry);
  }
  return {
    batchItems: merged,
  };
}

export function mergePaperIngestionOperations(params: {
  current: PaperIngestionPaperOperation[];
  patch: unknown;
}): {
  paperOperations: PaperIngestionPaperOperation[];
  newlyTerminalPaperOperations: PaperIngestionPaperOperation[];
} {
  const currentEntries = normalizePaperIngestionPaperOperations(params.current);
  const patchEntries = normalizePaperIngestionPaperOperations(params.patch);
  if (patchEntries.length === 0) {
    return {
      paperOperations: currentEntries,
      newlyTerminalPaperOperations: [],
    };
  }
  const merged = [...currentEntries];
  const newlyTerminalPaperOperations: PaperIngestionPaperOperation[] = [];
  for (const entry of patchEntries) {
    const existingIndex = merged.findIndex((currentEntry) =>
      arePaperIngestionPaperOperationsEquivalent(currentEntry, entry)
    );
    if (existingIndex >= 0) {
      const previous = merged[existingIndex];
      const next = mergePaperIngestionOperationValues(previous, entry);
      merged[existingIndex] = next;
      if (
        isPaperIngestionOperationTerminal(next.status) &&
        previous.status !== next.status
      ) {
        newlyTerminalPaperOperations.push(next);
      }
      continue;
    }
    merged.push(entry);
    if (isPaperIngestionOperationTerminal(entry.status)) {
      newlyTerminalPaperOperations.push(entry);
    }
  }
  return {
    paperOperations: merged,
    newlyTerminalPaperOperations,
  };
}

export function mergeCompletedPaperEntries(params: {
  current: PaperIngestionCompletedPaper[];
  patch: unknown;
}): {
  completedPapers: PaperIngestionCompletedPaper[];
  newlyCompletedPapers: PaperIngestionCompletedPaper[];
} {
  const currentEntries = normalizeCompletedPaperEntries(params.current);
  const patchEntries = normalizeCompletedPaperEntries(params.patch);
  if (patchEntries.length === 0) {
    return {
      completedPapers: currentEntries,
      newlyCompletedPapers: [],
    };
  }
  const merged = [...currentEntries];
  const newlyCompletedPapers: PaperIngestionCompletedPaper[] = [];
  for (const entry of patchEntries) {
    const existingIndex = merged.findIndex((currentEntry) =>
      areCompletedPaperEntriesEquivalent(currentEntry, entry)
    );
    if (existingIndex >= 0) {
      merged[existingIndex] = mergeCompletedPaperEntryValues(merged[existingIndex], entry);
      continue;
    }
    merged.push(entry);
    newlyCompletedPapers.push(entry);
  }
  return {
    completedPapers: merged,
    newlyCompletedPapers,
  };
}
