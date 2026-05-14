/**
 * 论文摄入（Paper Ingestion）状态管理。
 *
 * 处理论文从外部来源导入到知识图谱的全流程——
 * 队列管理、批量处理、远程任务跟踪、失败重试、图同步。
 *
 * 核心概念：
 * - PaperNexus: 论文知识图谱系统
 * - QueuedRequest: 待处理的论文导入请求
 * - BatchRun/BatchItem: 批量导入（用于大规模论文导入）
 * - PaperOperation: 单个论文的操作（import 或 graph 阶段）
 * - CompletedPaper: 成功导入的论文记录
 * - FailedPaper: 失败的论文（可重试 vs 不可重试）
 *
 * 为什么有这么多 merge 函数？因为论文导入是异步的——
 * 不同来源的状态更新可能交错到达，需要安全合并（patch 覆盖 current，
 * 但不丢失 current 中 patch 没有的字段）。
 *
 * derivePaperIngestionWorkflowDecision 是核心决策函数——
 * 判断论文摄入是否在运行、是否需要等待、是否需要修复。
 * 这决定了工作流是否可以进入下一阶段（frontier_mapping）。
 *
 * syncExperimentOutcomesToGraph 将实验结果写回知识图谱——
 * 为每个完成的实验创建 Finding 节点，并连接到对应的 Hypothesis 节点。
 * 这是"实验驱动知识图谱更新"的关键环节。
 */
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
  PaperIngestionFailedPaper,
  PaperIngestionQueueProgress,
  PaperIngestionPaperOperation,
  PaperIngestionQueuedRequest,
  PaperIngestionQueuedRequestKind,
  PaperIngestionRetryPolicy,
  PaperIngestionRemoteTaskProgress,
  PaperIngestionState,
} from "../workflow-guard.js";
import type { PaperIngestionValidationStatus } from "../paper-ingestion-validation";

/**
 * 解析论文摄入运行时状态。
 *
 * 将未知值标准化为允许的运行时状态之一。
 * 未知状态默认为 "idle"。
 */
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

function normalizeOptionalCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : null;
}

function normalizeOptionalPercent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : null;
}

function normalizePaperIngestionRemoteTaskProgress(
  value: unknown
): PaperIngestionRemoteTaskProgress | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const normalized: PaperIngestionRemoteTaskProgress = {
    percent: normalizeOptionalPercent(record.percent),
    stagePercent: normalizeOptionalPercent(
      record.stagePercent ?? record.stage_percent
    ),
    queuePosition: normalizeOptionalCount(
      record.queuePosition ?? record.queue_position
    ),
    currentStep: pickString(record, ["currentStep", "current_step"]),
    processedUnits: normalizeOptionalCount(
      record.processedUnits ?? record.processed_units
    ),
    totalUnits: normalizeOptionalCount(record.totalUnits ?? record.total_units),
  };
  return normalized.percent !== null ||
    normalized.stagePercent !== null ||
    normalized.queuePosition !== null ||
    normalized.currentStep !== null ||
    normalized.processedUnits !== null ||
    normalized.totalUnits !== null
    ? normalized
    : null;
}

function serializePaperIngestionRemoteTaskProgress(
  value: PaperIngestionRemoteTaskProgress | null
): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  return {
    percent: value.percent,
    stage_percent: value.stagePercent,
    queue_position: value.queuePosition,
    current_step: value.currentStep,
    processed_units: value.processedUnits,
    total_units: value.totalUnits,
  };
}

function mergePaperIngestionRemoteTaskProgress(
  current: PaperIngestionRemoteTaskProgress | null,
  patch: PaperIngestionRemoteTaskProgress | null
): PaperIngestionRemoteTaskProgress | null {
  if (!current) {
    return patch;
  }
  if (!patch) {
    return current;
  }
  return {
    percent: patch.percent ?? current.percent,
    stagePercent: patch.stagePercent ?? current.stagePercent,
    queuePosition: patch.queuePosition ?? current.queuePosition,
    currentStep: patch.currentStep ?? current.currentStep,
    processedUnits: patch.processedUnits ?? current.processedUnits,
    totalUnits: patch.totalUnits ?? current.totalUnits,
  };
}

function normalizePaperIngestionQueueProgress(
  value: unknown
): PaperIngestionQueueProgress | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const normalized: PaperIngestionQueueProgress = {
    sequence: normalizeOptionalCount(record.sequence),
    lastEventAt: pickString(record, ["lastEventAt", "last_event_at"]),
    total: normalizeOptionalCount(record.total),
    pending: normalizeOptionalCount(record.pending),
    running: normalizeOptionalCount(record.running),
    completed: normalizeOptionalCount(record.completed),
    failed: normalizeOptionalCount(record.failed),
    remaining: normalizeOptionalCount(record.remaining),
    overallPercent: normalizeOptionalPercent(
      record.overallPercent ?? record.overall_percent
    ),
  };
  return normalized.total !== null ||
    normalized.sequence !== null ||
    normalized.lastEventAt !== null ||
    normalized.pending !== null ||
    normalized.running !== null ||
    normalized.completed !== null ||
    normalized.failed !== null ||
    normalized.remaining !== null ||
    normalized.overallPercent !== null
    ? normalized
    : null;
}

function serializePaperIngestionQueueProgress(
  value: PaperIngestionQueueProgress | null
): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  return {
    sequence: value.sequence ?? null,
    last_event_at: value.lastEventAt ?? null,
    total: value.total,
    pending: value.pending,
    running: value.running,
    completed: value.completed,
    failed: value.failed,
    remaining: value.remaining,
    overall_percent: value.overallPercent,
  };
}

function mergePaperIngestionQueueProgress(
  current: PaperIngestionQueueProgress | null,
  patch: PaperIngestionQueueProgress | null
): PaperIngestionQueueProgress | null {
  if (!current) {
    return patch;
  }
  if (!patch) {
    return current;
  }
  const maxCount = (left: number | null | undefined, right: number | null | undefined) =>
    left == null ? right ?? null : right == null ? left : Math.max(left, right);
  return {
    sequence: maxCount(current.sequence, patch.sequence),
    lastEventAt: patch.lastEventAt ?? current.lastEventAt ?? null,
    total: patch.total ?? current.total,
    pending: patch.pending ?? current.pending,
    running: patch.running ?? current.running,
    completed: maxCount(current.completed, patch.completed),
    failed: maxCount(current.failed, patch.failed),
    remaining: patch.remaining ?? current.remaining,
    overallPercent: patch.overallPercent ?? current.overallPercent,
  };
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

function canonicalizePaperIngestionQueuedRequestStatus(params: {
  status: PaperIngestionQueuedRequest["status"];
  attemptCount: number;
  maxAttempts: number | null;
  deadLetterAt: string | null;
  deadLetterReason: string | null;
  lastError: string | null;
  finishedAt: string | null;
}): PaperIngestionQueuedRequest["status"] {
  if (params.deadLetterAt) {
    return "failed";
  }
  const maxAttempts = params.maxAttempts ?? 3;
  const exhausted =
    params.attemptCount >= maxAttempts &&
    Boolean(params.lastError || params.deadLetterReason || params.finishedAt);
  if (
    exhausted &&
    ["queued", "launching", "running", "needs_repair"].includes(params.status)
  ) {
    return "failed";
  }
  return params.status;
}

export function normalizePaperIngestionQueuedRequestKind(
  value: unknown
): PaperIngestionQueuedRequestKind | null {
  const normalized = normalizeStage(value);
  switch (normalized) {
    case "upload_manifest":
    case "direct_source":
    case "requisition":
      return normalized;
    default:
      return null;
  }
}

export function derivePaperIngestionQueuedRequestKind(params: {
  explicit?: unknown;
  triggerKind?: string | null;
  manifestPath?: string | null;
  commandText?: string | null;
  wrapper?: string | null;
}): PaperIngestionQueuedRequestKind | null {
  const explicit = normalizePaperIngestionQueuedRequestKind(params.explicit);
  if (explicit) {
    return explicit;
  }
  const triggerKind = String(params.triggerKind ?? "").trim().toLowerCase();
  if (
    triggerKind === "idea_catalyst_requisition" ||
    triggerKind === "literature_discovery" ||
    triggerKind.endsWith("literature_discovery")
  ) {
    return "requisition";
  }
  if (params.manifestPath) {
    return "upload_manifest";
  }
  if (params.commandText || params.wrapper) {
    return "direct_source";
  }
  return null;
}

export function isPaperIngestionRequisitionRequest(
  request: Pick<
    PaperIngestionQueuedRequest,
    "requestKind" | "triggerKind" | "manifestPath" | "commandText" | "wrapper"
  >
): boolean {
  return (
    derivePaperIngestionQueuedRequestKind({
      explicit: request.requestKind,
      triggerKind: request.triggerKind,
      manifestPath: request.manifestPath,
      commandText: request.commandText,
      wrapper: request.wrapper,
    }) === "requisition"
  );
}

export function isPaperIngestionExecutableUploadRequest(
  request: Pick<
    PaperIngestionQueuedRequest,
    "requestKind" | "triggerKind" | "manifestPath" | "commandText" | "wrapper"
  >
): boolean {
  return !isPaperIngestionRequisitionRequest(request);
}

function normalizePaperIngestionRetryPolicy(value: unknown): PaperIngestionRetryPolicy | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const intervalSeconds = pickNumber(record, ["intervalSeconds", "interval_seconds"]) ?? 45;
  const maxAttempts = pickNumber(record, ["maxAttempts", "max_attempts"]) ?? 3;
  return {
    mode: normalizeStage(record.mode) === "batch" ? "batch" : "sequential",
    intervalSeconds: Math.max(1, Math.floor(intervalSeconds)),
    maxAttempts: Math.max(1, Math.floor(maxAttempts)),
  };
}

function serializePaperIngestionRetryPolicy(
  value: PaperIngestionRetryPolicy | null
): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  return {
    mode: value.mode,
    interval_seconds: value.intervalSeconds,
    max_attempts: value.maxAttempts,
  };
}

function normalizePaperIngestionFailedPaper(value: unknown): PaperIngestionFailedPaper | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const paperId = pickString(record, ["paperId", "paper_id", "canonicalId", "canonical_id"]);
  const title = pickString(record, ["title", "paperTitle", "paper_title"]);
  const sourceKey = pickString(record, ["sourceKey", "source_key"]);
  const inputPath = pickString(record, ["inputPath", "input_path", "path"]);
  const failureMessage = pickString(record, [
    "failureMessage",
    "failure_message",
    "error",
    "message",
    "detail",
  ]);
  if (!paperId && !title && !sourceKey && !inputPath && !failureMessage) {
    return null;
  }
  return {
    paperId,
    title,
    sourceKey,
    inputPath,
    failureSignature:
      pickString(record, ["failureSignature", "failure_signature"]) ?? failureMessage,
    failureMessage,
    failedAt: pickString(record, ["failedAt", "failed_at", "updatedAt", "updated_at"]),
    retryable: record.retryable === true,
    retryReason: pickString(record, ["retryReason", "retry_reason"]),
    alreadyInGraph: record.alreadyInGraph === true || record.already_in_graph === true,
    lastRetryAt: pickString(record, ["lastRetryAt", "last_retry_at"]),
    retryCount: Math.max(
      0,
      Math.floor(pickNumber(record, ["retryCount", "retry_count"]) ?? 0)
    ),
  };
}

function normalizePaperIngestionFailedPapers(value: unknown): PaperIngestionFailedPaper[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: PaperIngestionFailedPaper[] = [];
  for (const item of value) {
    const normalized = normalizePaperIngestionFailedPaper(item);
    if (!normalized) {
      continue;
    }
    const key =
      normalized.paperId ?? normalized.sourceKey ?? normalized.inputPath ?? normalized.title;
    const existingIndex = entries.findIndex(
      (entry) => key && key === (entry.paperId ?? entry.sourceKey ?? entry.inputPath ?? entry.title)
    );
    if (existingIndex >= 0) {
      entries[existingIndex] = {
        ...entries[existingIndex],
        ...normalized,
        retryCount: Math.max(entries[existingIndex].retryCount, normalized.retryCount),
      };
      continue;
    }
    entries.push(normalized);
  }
  return entries;
}

function serializePaperIngestionFailedPaper(
  value: PaperIngestionFailedPaper
): Record<string, unknown> {
  return {
    paper_id: value.paperId,
    title: value.title,
    source_key: value.sourceKey,
    input_path: value.inputPath,
    failure_signature: value.failureSignature,
    failure_message: value.failureMessage,
    failed_at: value.failedAt,
    retryable: value.retryable,
    retry_reason: value.retryReason,
    already_in_graph: value.alreadyInGraph,
    last_retry_at: value.lastRetryAt,
    retry_count: value.retryCount,
  };
}

function normalizePaperIngestionValidationStatus(
  value: unknown
): PaperIngestionValidationStatus {
  const normalized = normalizeStage(value);
  switch (normalized) {
    case "valid":
    case "warning":
    case "invalid":
    case "unknown":
      return normalized;
    default:
      return "unknown";
  }
}

/**
 * 解析论文摄入完整状态。
 *
 * 从 unknown JSON 安全转换。包含所有子组件的 normalize：
 * completedPapers、paperOperations、activeBatches、batchItems、
 * queuedRequests、failedPapers、retryPolicy 等。
 * lastBatchManifestPath 自动从最新的 activeBatch 或 batchItem 推断。
 */
export function normalizePaperIngestionState(value: unknown): PaperIngestionState {
  const record = asRecord(value) ?? {};
  const importTaskIdsRaw = record.import_task_ids ?? record.importTaskIds;
  const completedPapersRaw = record.completed_papers ?? record.completedPapers;
  const paperOperationsRaw = record.paper_operations ?? record.paperOperations;
  const activeBatchesRaw = record.active_batches ?? record.activeBatches;
  const batchItemsRaw = record.batch_items ?? record.batchItems;
  const queuedRequestsRaw = record.queued_requests ?? record.queuedRequests;
  const failedPapersRaw = record.failed_papers ?? record.failedPapers;
  const retryableFailedPapersRaw =
    record.retryable_failed_papers ?? record.retryableFailedPapers;
  const nonRetryableFailedPapersRaw =
    record.non_retryable_failed_papers ?? record.nonRetryableFailedPapers;
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
    failedPapers: normalizePaperIngestionFailedPapers(failedPapersRaw),
    retryableFailedPapers: normalizePaperIngestionFailedPapers(retryableFailedPapersRaw),
    nonRetryableFailedPapers: normalizePaperIngestionFailedPapers(nonRetryableFailedPapersRaw),
    lastFailureScanAt: pickString(record, ["lastFailureScanAt", "last_failure_scan_at"]),
    lastRetryManifestPath: pickString(record, [
      "lastRetryManifestPath",
      "last_retry_manifest_path",
    ]),
    retryPolicy: normalizePaperIngestionRetryPolicy(
      record.retryPolicy ?? record.retry_policy
    ),
    retryRunId: pickString(record, ["retryRunId", "retry_run_id"]),
    retryStatus: pickString(record, ["retryStatus", "retry_status"]),
    retryAttemptCount: Math.max(
      0,
      Math.floor(pickNumber(record, ["retryAttemptCount", "retry_attempt_count"]) ?? 0)
    ),
    sequentialRetryIntervalSeconds:
      pickNumber(record, [
        "sequentialRetryIntervalSeconds",
        "sequential_retry_interval_seconds",
      ]) ?? null,
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

/**
 * 序列化论文摄入状态。
 *
 * 将 camelCase 内部表示转为 snake_case JSON。
 */
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
    failed_papers: value.failedPapers.map(serializePaperIngestionFailedPaper),
    retryable_failed_papers: value.retryableFailedPapers.map(
      serializePaperIngestionFailedPaper
    ),
    non_retryable_failed_papers: value.nonRetryableFailedPapers.map(
      serializePaperIngestionFailedPaper
    ),
    last_failure_scan_at: value.lastFailureScanAt,
    last_retry_manifest_path: value.lastRetryManifestPath,
    retry_policy: serializePaperIngestionRetryPolicy(value.retryPolicy),
    retry_run_id: value.retryRunId,
    retry_status: value.retryStatus,
    retry_attempt_count: value.retryAttemptCount,
    sequential_retry_interval_seconds: value.sequentialRetryIntervalSeconds,
    last_batch_manifest_path: value.lastBatchManifestPath,
    graph_version_seen: value.graphVersionSeen,
    reconcile_required: value.reconcileRequired,
    repair_required: value.repairRequired,
    repair_reason: value.repairReason,
    repair_target_corpus: value.repairTargetCorpus,
    last_updated_at: value.lastUpdatedAt,
  };
}

/**
 * 检查是否有活跃的论文上传任务。
 *
 * 用于工作流守卫——如果论文摄入还在运行，工作流不能进入下一阶段。
 * 决策优先：先调用 derivePaperIngestionWorkflowDecision，
 * 如果 action 是 "wait" 说明有活跃任务。
 */
export function hasActiveWorkflowOwnedPaperUpload(
  state: PaperIngestionState,
  options?: {
    graphPresenceStatus?: unknown;
  }
): boolean {
  const decision = derivePaperIngestionWorkflowDecision({
    state,
    graphPresenceStatus: options?.graphPresenceStatus,
  });
  if (decision.action === "wait") {
    return true;
  }
  if (options?.graphPresenceStatus !== undefined) {
    return false;
  }
  if (
    ["waiting_import", "reconciling"].includes(
      normalizePaperIngestionRuntimeStatus(state.runtimeStatus) ?? ""
    )
  ) {
    return true;
  }
  if (
    state.queuedRequests.some(
      (request) =>
        isPaperIngestionExecutableUploadRequest(request) &&
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

export type PaperIngestionWorkflowDecisionAction =
  | "continue"
  | "wait"
  | "repair";

export type PaperIngestionQueuedLaunchabilityStatus =
  | "queued_but_dispatchable"
  | "queued_but_no_runtime_capacity"
  | "queued_but_missing_binding"
  | "queued_but_registry_hidden";

export type PaperIngestionWorkflowDecision = {
  action: PaperIngestionWorkflowDecisionAction;
  blocking: boolean;
  reason: string | null;
  graphPresenceReady: boolean;
  requisitionRequestCount: number;
  invalidCompletedRequisitionRequestCount: number;
  queuedRequestCount: number;
  launchingOrRunningRequestCount: number;
  dormantQueuedRequestCount: number;
  ignoredDormantQueuedRequestCount: number;
  needsRepairRequestCount: number;
  failedRequestCount: number;
  activeBatchCount: number;
  activeOperationCount: number;
  failedOperationCount: number;
  hardActiveCount?: number;
  queuedLaunchabilityStatus?: PaperIngestionQueuedLaunchabilityStatus | null;
  queuedLaunchabilityReason?: string | null;
};

export type GraphBuildPartialReadiness = {
  ready: boolean;
  reason: string | null;
  expectedPaperCount: number | null;
  presentPaperCount: number | null;
  missingPaperCount: number | null;
  coverage: number | null;
  minCoverage: number;
  minPresentPapers: number;
  hardActiveCount: number;
  terminalFailureCount: number;
};

function readGraphPresenceCount(
  record: Record<string, unknown> | null,
  keys: string[]
): number | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }
  }
  return null;
}

function readGraphPresenceMissingPaperCount(
  record: Record<string, unknown> | null
): number | null {
  if (!record) {
    return null;
  }
  const explicit = readGraphPresenceCount(record, [
    "graph_presence_missing_paper_count",
    "graphPresenceMissingPaperCount",
    "graph_presence_missing_count",
    "graphPresenceMissingCount",
  ]);
  if (explicit !== null) {
    return explicit;
  }
  const missingPapers = record.graph_presence_missing_papers ?? record.graphPresenceMissingPapers;
  return Array.isArray(missingPapers) ? missingPapers.length : null;
}

function readGraphPresenceMissingPaperRecords(
  record: Record<string, unknown> | null
): Record<string, unknown>[] {
  if (!record) {
    return [];
  }
  const missingPapers = record.graph_presence_missing_papers ?? record.graphPresenceMissingPapers;
  if (!Array.isArray(missingPapers)) {
    return [];
  }
  return missingPapers
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function missingGraphPaperHasImportableLocalSource(
  record: Record<string, unknown>
): boolean {
  const sourceKind = normalizeStage(record.source_kind ?? record.sourceKind);
  if (sourceKind === "markdown" || sourceKind === "pdf") {
    return true;
  }
  return Boolean(
    asString(record.source_path ?? record.sourcePath) ||
      asString(record.planned_staging_path ?? record.plannedStagingPath) ||
      asString(record.md_path ?? record.mdPath) ||
      asString(record.pdf_path ?? record.pdfPath)
  );
}

function allMissingGraphPapersHaveImportableLocalSources(
  record: Record<string, unknown> | null,
  missingPaperCount: number | null
): boolean {
  const missingPapers = readGraphPresenceMissingPaperRecords(record);
  return (
    missingPapers.length > 0 &&
    (missingPaperCount == null || missingPapers.length >= missingPaperCount) &&
    missingPapers.every(missingGraphPaperHasImportableLocalSource)
  );
}

function paperIngestionUsesRemotePapernexus(
  record: Record<string, unknown> | null,
  state: PaperIngestionState
): boolean {
  const accessMode = normalizeStage(
    record ? pickString(record, ["papernexusAccessMode", "papernexus_access_mode"]) : null
  );
  if (accessMode === "remote_mcp") {
    return true;
  }
  if (accessMode === "local_mcp") {
    return false;
  }
  if (record && pickString(record, ["papernexusMcpUrl", "papernexus_mcp_url"])) {
    return true;
  }
  return state.queuedRequests.some((request) => {
    const wrapper = request.wrapper ?? "";
    const lastSessionKey = request.lastSessionKey ?? "";
    const commandText = request.commandText ?? "";
    const argsText = request.args.join(" ");
    return (
      wrapper === "papernexus_remote_mcp" ||
      /papernexus:remote_mcp:/i.test(lastSessionKey) ||
      /(?:^|\s)--mcp-url(?:\s|=)|papernexus_remote_mcp|remote_mcp|\/mcp\b/i.test(
        commandText
      ) ||
      /(?:^|\s)--mcp-url(?:\s|=)|papernexus_remote_mcp|remote_mcp|\/mcp\b/i.test(
        argsText
      )
    );
  });
}

function clampGraphCoverage(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, value));
}

function normalizeMinPresentPapers(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

function getTerminalPaperIngestionRequestManifestPaths(
  state: PaperIngestionState
): Set<string> {
  const paths = new Set<string>();
  for (const request of state.queuedRequests) {
    if (
      request.manifestPath &&
      (request.deadLetterAt || request.status === "failed" || request.status === "needs_repair")
    ) {
      paths.add(request.manifestPath);
    }
  }
  return paths;
}

function isBatchShadowedByTerminalRequest(
  batch: PaperIngestionBatchRun,
  terminalManifestPaths: Set<string>
): boolean {
  return Boolean(batch.manifestPath && terminalManifestPaths.has(batch.manifestPath));
}

function countHardActivePaperIngestionWork(state: PaperIngestionState): number {
  const runtimeStatus = normalizePaperIngestionRuntimeStatus(state.runtimeStatus);
  const runtimeActive =
    runtimeStatus === "waiting_import" || runtimeStatus === "reconciling";
  const terminalManifestPaths = getTerminalPaperIngestionRequestManifestPaths(state);
  const activeUploadRequests = state.queuedRequests.filter(
    (request) =>
      isPaperIngestionExecutableUploadRequest(request) &&
      (request.status === "queued" ||
        request.status === "launching" ||
        request.status === "running")
  );
  const activeBatches = state.activeBatches.filter((batch) =>
    ["queued", "running"].includes(normalizeStage(batch.status) ?? "") &&
    !isBatchShadowedByTerminalRequest(batch, terminalManifestPaths)
  );
  const activeOperations = state.paperOperations.filter((operation) =>
    ["queued", "running"].includes(normalizeStage(operation.status) ?? "")
  );
  const hasConcreteActiveWork =
    activeUploadRequests.length > 0 ||
    activeBatches.length > 0 ||
    activeOperations.length > 0;
  return (
    activeUploadRequests.length +
    activeBatches.length +
    activeOperations.length +
    (runtimeActive && hasConcreteActiveWork ? 1 : 0)
  );
}

function countTerminalPaperIngestionFailures(state: PaperIngestionState): number {
  const failedRequests = state.queuedRequests.filter(
    (request) =>
      isPaperIngestionExecutableUploadRequest(request) &&
      (request.status === "failed" || request.status === "needs_repair")
  );
  const failedOperations = state.paperOperations.filter((operation) =>
    ["failed", "timed_out"].includes(normalizeStage(operation.status) ?? "")
  );
  const failedBatchItems = state.batchItems.filter((item) =>
    ["failed", "submit_failed", "timed_out"].includes(normalizeStage(item.status) ?? "")
  );
  return failedRequests.length + failedOperations.length + failedBatchItems.length;
}

export function deriveGraphBuildPartialReadiness(params: {
  paperIngestion: Record<string, unknown> | null | undefined;
  state?: PaperIngestionState;
  graphPresenceStatus?: unknown;
  minCoverage?: number | null;
  minPresentPapers?: number | null;
}): GraphBuildPartialReadiness {
  const paperIngestion = params.paperIngestion ?? null;
  const state = params.state ?? normalizePaperIngestionState(paperIngestion);
  const graphPresenceStatus = normalizeGraphPresenceStatus(
    params.graphPresenceStatus ??
      paperIngestion?.graph_presence_status ??
      paperIngestion?.graphPresenceStatus
  );
  const minCoverage = clampGraphCoverage(params.minCoverage);
  const minPresentPapers = normalizeMinPresentPapers(params.minPresentPapers);
  const expectedPaperCount = readGraphPresenceCount(paperIngestion, [
    "graph_presence_expected_papers",
    "graphPresenceExpectedPapers",
    "graph_presence_expected",
    "graphPresenceExpected",
  ]);
  const presentPaperCount = readGraphPresenceCount(paperIngestion, [
    "graph_presence_present_papers",
    "graphPresencePresentPapers",
    "graph_presence_present",
    "graphPresencePresent",
    "synced_papers",
    "syncedPapers",
  ]);
  const missingPaperCount =
    readGraphPresenceMissingPaperCount(paperIngestion) ??
    (expectedPaperCount !== null && presentPaperCount !== null
      ? Math.max(0, expectedPaperCount - presentPaperCount)
      : null);
  const coverage =
    expectedPaperCount !== null &&
    expectedPaperCount > 0 &&
    presentPaperCount !== null
      ? Math.max(0, Math.min(1, presentPaperCount / expectedPaperCount))
      : null;
  const hardActiveCount = countHardActivePaperIngestionWork(state);
  const terminalFailureCount = countTerminalPaperIngestionFailures(state);
  const degradedImportAttempted = terminalFailureCount > 0;
  const remotePapernexusConfigured = paperIngestionUsesRemotePapernexus(
    paperIngestion,
    state
  );
  const partialCoverageReady =
    !remotePapernexusConfigured &&
    graphPresenceStatus === "missing_papers" &&
    degradedImportAttempted &&
    expectedPaperCount !== null &&
    expectedPaperCount > 0 &&
    presentPaperCount !== null &&
    presentPaperCount >= minPresentPapers &&
    coverage !== null &&
    coverage >= minCoverage &&
    hardActiveCount === 0;
  const localSourceFallbackReady =
    !remotePapernexusConfigured &&
    (graphPresenceStatus === "missing_papers" || graphPresenceStatus === "missing_corpus") &&
    degradedImportAttempted &&
    expectedPaperCount !== null &&
    expectedPaperCount > 0 &&
    hardActiveCount === 0 &&
    allMissingGraphPapersHaveImportableLocalSources(paperIngestion, missingPaperCount);
  const ready = partialCoverageReady || localSourceFallbackReady;
  return {
    ready,
    reason: partialCoverageReady
      ? `partial graph build is usable: ${presentPaperCount}/${expectedPaperCount} expected paper(s) are present (${Math.round(
          coverage * 100
        )}% coverage), so missing papers can be repaired asynchronously`
      : localSourceFallbackReady
        ? `local-source graph fallback is usable: PaperNexus import failed after a bounded attempt, but ${expectedPaperCount} expected paper(s) have importable local PDF/Markdown sources, so remote graph repair can continue asynchronously`
      : null,
    expectedPaperCount,
    presentPaperCount,
    missingPaperCount,
    coverage,
    minCoverage,
    minPresentPapers,
    hardActiveCount,
    terminalFailureCount,
  };
}

function isDormantQueuedRequest(request: PaperIngestionQueuedRequest): boolean {
  return (
    isPaperIngestionExecutableUploadRequest(request) &&
    request.status === "queued" &&
    !request.startedAt &&
    !request.lastRunId &&
    !request.lastSessionKey &&
    !request.progress &&
    !request.queueProgress &&
    request.attemptCount === 0
  );
}

function isGraphBuildUploadRepairTrigger(
  triggerKind: string | null | undefined
): boolean {
  const normalized = String(triggerKind ?? "").trim().toLowerCase();
  return (
    normalized === "graph_build_source_catchup" ||
    normalized === "graph_build_repair_import" ||
    normalized === "coordinator_heartbeat"
  );
}

function isIgnorableGraphReadyQueuedUploadRequest(
  request: PaperIngestionQueuedRequest
): boolean {
  return (
    isPaperIngestionExecutableUploadRequest(request) &&
    request.status === "queued" &&
    (isGraphBuildUploadRepairTrigger(request.triggerKind) ||
      request.requestId.startsWith("graph-build-source-catchup-") ||
      request.requestId.startsWith("graph-build-repair-import-"))
  );
}

function isDormantRequisitionRequest(request: PaperIngestionQueuedRequest): boolean {
  return (
    isPaperIngestionRequisitionRequest(request) &&
    request.status === "queued" &&
    !request.startedAt &&
    !request.lastRunId &&
    !request.lastSessionKey &&
    !request.progress &&
    !request.queueProgress &&
    request.attemptCount === 0
  );
}

function isLiteratureDiscoveryRequisitionTrigger(
  triggerKind: string | null | undefined
): boolean {
  const normalized = String(triggerKind ?? "").trim().toLowerCase();
  return (
    normalized === "idea_catalyst_requisition" ||
    normalized === "literature_discovery" ||
    normalized.endsWith("literature_discovery")
  );
}

export function isWorkflowOwnedLiteratureRequisitionRequest(
  request: PaperIngestionQueuedRequest
): boolean {
  return (
    isPaperIngestionRequisitionRequest(request) &&
    isLiteratureDiscoveryRequisitionTrigger(request.triggerKind)
  );
}

function isIgnorableDormantRequisitionWhenGraphReady(
  request: PaperIngestionQueuedRequest
): boolean {
  return (
    isDormantRequisitionRequest(request) &&
    !isLiteratureDiscoveryRequisitionTrigger(request.triggerKind)
  );
}

export const INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON =
  "workflow-owned literature requisition was marked completed without durable import or requisition-satisfaction evidence; keep graph_build blocked and rerun bounded literature discovery before frontier mapping";

function deriveQueuedLaunchabilityDiagnostic(params: {
  state: PaperIngestionState;
  queuedRequests: PaperIngestionQueuedRequest[];
}): {
  status: PaperIngestionQueuedLaunchabilityStatus | null;
  reason: string | null;
} {
  if (params.queuedRequests.length === 0) {
    return { status: null, reason: null };
  }
  const evidence = [
    params.state.waitingReason,
    ...params.queuedRequests.flatMap((request) => [
      request.lastError,
      request.detail,
      request.summary,
    ]),
  ]
    .filter((entry): entry is string => Boolean(entry && entry.trim()))
    .join(" ")
    .toLowerCase();
  if (/projects_state|registry|hidden project|coordinator.*project/.test(evidence)) {
    return {
      status: "queued_but_registry_hidden",
      reason:
        "queued PaperNexus import is waiting, but coordinator registry/project visibility appears to be blocking dispatch",
    };
  }
  if (/binding|channel|session key|project binding|not bound/.test(evidence)) {
    return {
      status: "queued_but_missing_binding",
      reason:
        "queued PaperNexus import is waiting for a usable project/channel runtime binding",
    };
  }
  if (/capacity|quota|cooldown|rate limit|no available|provider/.test(evidence)) {
    return {
      status: "queued_but_no_runtime_capacity",
      reason:
        "queued PaperNexus import is waiting for runtime/provider capacity before launch",
    };
  }
  return {
    status: "queued_but_dispatchable",
    reason:
      "queued PaperNexus import is dispatchable and should be launched by the background import worker or runtime coordinator",
  };
}

function hasRequisitionSatisfactionEvidence(
  request: PaperIngestionQueuedRequest
): boolean {
  if (!request.validationReportPath) {
    return false;
  }
  if (request.validationStatus === "invalid") {
    return false;
  }
  return (
    request.validationStatus === "valid" ||
    request.validationStatus === "warning" ||
    Boolean(request.validationReportPath)
  );
}

export function hasWorkflowOwnedLiteratureRequisitionCompletionEvidence(params: {
  state: PaperIngestionState;
  request: PaperIngestionQueuedRequest;
}): boolean {
  if (!isWorkflowOwnedLiteratureRequisitionRequest(params.request)) {
    return true;
  }
  if (params.request.status !== "completed") {
    return true;
  }
  return hasRequisitionSatisfactionEvidence(params.request);
}

export function isInvalidCompletedWorkflowOwnedLiteratureRequisitionRequest(params: {
  state: PaperIngestionState;
  request: PaperIngestionQueuedRequest;
}): boolean {
  return (
    isWorkflowOwnedLiteratureRequisitionRequest(params.request) &&
    params.request.status === "completed" &&
    !hasWorkflowOwnedLiteratureRequisitionCompletionEvidence(params)
  );
}

/**
 * 推导论文摄入工作流决策。
 *
 * 核心决策逻辑——判断论文摄入的当前状态应该采取什么行动：
 * - "wait": 有活跃任务（运行中/排队中），等待完成
 * - "continue": 图就绪或无活跃任务，可以继续
 * - "repair": 有失败需要修复，先修复再继续
 *
 * 决策优先级：活跃任务 > 排队任务 > 终端失败 > 继续。
 * dormantQueuedRequest 是从未启动的请求——如果图已就绪可以忽略。
 */
export function derivePaperIngestionWorkflowDecision(params: {
  state: PaperIngestionState;
  graphPresenceStatus?: unknown;
}): PaperIngestionWorkflowDecision {
  const graphPresenceReady =
    normalizeGraphPresenceStatus(params.graphPresenceStatus) === "ready";
  const runtimeStatus = normalizePaperIngestionRuntimeStatus(
    params.state.runtimeStatus
  );
  const runtimeActive =
    runtimeStatus === "waiting_import" || runtimeStatus === "reconciling";
  const requisitionRequests = params.state.queuedRequests.filter(
    (request) =>
      isPaperIngestionRequisitionRequest(request) &&
      ["queued", "launching", "running", "needs_repair"].includes(request.status)
  );
  const invalidCompletedRequisitionRequests = params.state.queuedRequests.filter(
    (request) =>
      isInvalidCompletedWorkflowOwnedLiteratureRequisitionRequest({
        state: params.state,
        request,
      })
  );
  const ignorableDormantRequisitionRequests = requisitionRequests.filter(
    isIgnorableDormantRequisitionWhenGraphReady
  );
  const uploadRequests = params.state.queuedRequests.filter((request) =>
    isPaperIngestionExecutableUploadRequest(request)
  );
  const queuedRequests = uploadRequests.filter((request) => request.status === "queued");
  const launchingOrRunningRequests = uploadRequests.filter(
    (request) => request.status === "launching" || request.status === "running"
  );
  const needsRepairRequests = uploadRequests.filter(
    (request) => request.status === "needs_repair"
  );
  const failedRequests = uploadRequests.filter(
    (request) => request.status === "failed"
  );
  const dormantQueuedRequests = queuedRequests.filter(isDormantQueuedRequest);
  const graphReadyIgnoredQueuedRequests = queuedRequests.filter(
    (request) =>
      isDormantQueuedRequest(request) ||
      isIgnorableGraphReadyQueuedUploadRequest(request)
  );
  const terminalManifestPaths = getTerminalPaperIngestionRequestManifestPaths(params.state);
  const activeBatches = params.state.activeBatches.filter((batch) =>
    ["queued", "running"].includes(normalizeStage(batch.status) ?? "") &&
    !batch.finishedAt &&
    !isBatchShadowedByTerminalRequest(batch, terminalManifestPaths)
  );
  const queuedActiveBatches = activeBatches.filter(
    (batch) => normalizeStage(batch.status) === "queued"
  );
  const runningActiveBatches = activeBatches.filter(
    (batch) => normalizeStage(batch.status) === "running"
  );
  const activeOperations = params.state.paperOperations.filter((operation) =>
    ["queued", "running"].includes(normalizeStage(operation.status) ?? "") &&
    !operation.finishedAt
  );
  const failedOperations = params.state.paperOperations.filter((operation) =>
    ["failed", "timed_out"].includes(normalizeStage(operation.status) ?? "")
  );
  const failedBatchItems = params.state.batchItems.filter((item) =>
    ["failed", "submit_failed", "timed_out"].includes(normalizeStage(item.status) ?? "")
  );

  const terminalFailureCount =
    failedRequests.length +
    failedOperations.length +
    failedBatchItems.length +
    needsRepairRequests.length +
    invalidCompletedRequisitionRequests.length;
  const blockingQueuedRequests = graphPresenceReady
    ? queuedRequests.filter(
        (request) =>
          !isDormantQueuedRequest(request) &&
          !isIgnorableGraphReadyQueuedUploadRequest(request)
      )
    : queuedRequests;
  const queuedLaunchability = deriveQueuedLaunchabilityDiagnostic({
    state: params.state,
    queuedRequests: blockingQueuedRequests,
  });
  const blockingActiveBatches = graphPresenceReady ? [] : activeBatches;
  const hasConcreteActiveWork =
    blockingQueuedRequests.length > 0 ||
    launchingOrRunningRequests.length > 0 ||
    blockingActiveBatches.length > 0 ||
    activeOperations.length > 0;
  const hardActiveCount =
    blockingQueuedRequests.length +
    launchingOrRunningRequests.length +
    blockingActiveBatches.length +
    activeOperations.length +
    (runtimeActive && hasConcreteActiveWork ? 1 : 0);

  if (invalidCompletedRequisitionRequests.length > 0) {
    return {
      action: "repair",
      blocking: true,
      reason: INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON,
      graphPresenceReady,
      requisitionRequestCount: requisitionRequests.length,
      invalidCompletedRequisitionRequestCount:
        invalidCompletedRequisitionRequests.length,
      queuedRequestCount: queuedRequests.length,
      launchingOrRunningRequestCount: launchingOrRunningRequests.length,
      dormantQueuedRequestCount: dormantQueuedRequests.length,
      ignoredDormantQueuedRequestCount: 0,
      needsRepairRequestCount: needsRepairRequests.length,
      failedRequestCount: failedRequests.length,
      activeBatchCount: activeBatches.length,
      activeOperationCount: activeOperations.length,
      failedOperationCount: failedOperations.length + failedBatchItems.length,
    };
  }

  if (requisitionRequests.length > 0) {
    if (
      graphPresenceReady &&
      ignorableDormantRequisitionRequests.length === requisitionRequests.length
    ) {
      return {
        action: "continue",
        blocking: false,
        reason:
          "graph presence is ready; ignoring dormant queued graph-enrichment requisitions that were never launched",
        graphPresenceReady,
        requisitionRequestCount: requisitionRequests.length,
        invalidCompletedRequisitionRequestCount:
          invalidCompletedRequisitionRequests.length,
        queuedRequestCount: queuedRequests.length,
        launchingOrRunningRequestCount: launchingOrRunningRequests.length,
        dormantQueuedRequestCount: dormantQueuedRequests.length,
        ignoredDormantQueuedRequestCount:
          dormantQueuedRequests.length + ignorableDormantRequisitionRequests.length,
        needsRepairRequestCount: needsRepairRequests.length,
        failedRequestCount: failedRequests.length,
        activeBatchCount: activeBatches.length,
        activeOperationCount: activeOperations.length,
        failedOperationCount: failedOperations.length + failedBatchItems.length,
      };
    }
    return {
      action: "wait",
      blocking: true,
      reason:
        "workflow-owned graph enrichment requisition is still active; keep graph_build on bounded literature collection / staging before frontier mapping",
      graphPresenceReady,
      requisitionRequestCount: requisitionRequests.length,
      invalidCompletedRequisitionRequestCount:
        invalidCompletedRequisitionRequests.length,
      queuedRequestCount: queuedRequests.length,
      launchingOrRunningRequestCount: launchingOrRunningRequests.length,
      dormantQueuedRequestCount: dormantQueuedRequests.length,
      ignoredDormantQueuedRequestCount: 0,
      needsRepairRequestCount: needsRepairRequests.length,
      failedRequestCount: failedRequests.length,
      activeBatchCount: activeBatches.length,
      activeOperationCount: activeOperations.length,
      failedOperationCount: failedOperations.length + failedBatchItems.length,
    };
  }

  if (hardActiveCount > 0) {
    const waitingForQueuedLaunch =
      blockingQueuedRequests.length > 0 &&
      launchingOrRunningRequests.length === 0 &&
      blockingActiveBatches.length === 0 &&
      activeOperations.length === 0;
    return {
      action: "wait",
      blocking: true,
      reason:
        waitingForQueuedLaunch
          ? `${queuedLaunchability.reason}; keep graph_build waiting until launch/replay succeeds or maintenance marks the request needs_repair`
          : "workflow-owned PaperNexus ingestion is running; wait for upload / graph sync completion before frontier mapping",
      graphPresenceReady,
      requisitionRequestCount: requisitionRequests.length,
      invalidCompletedRequisitionRequestCount:
        invalidCompletedRequisitionRequests.length,
      queuedRequestCount: queuedRequests.length,
      launchingOrRunningRequestCount: launchingOrRunningRequests.length,
      dormantQueuedRequestCount: dormantQueuedRequests.length,
      ignoredDormantQueuedRequestCount: 0,
      needsRepairRequestCount: needsRepairRequests.length,
      failedRequestCount: failedRequests.length,
      activeBatchCount: activeBatches.length,
      activeOperationCount: activeOperations.length,
      failedOperationCount: failedOperations.length + failedBatchItems.length,
      hardActiveCount,
      queuedLaunchabilityStatus: queuedLaunchability.status,
      queuedLaunchabilityReason: queuedLaunchability.reason,
    };
  }

  if (
    graphPresenceReady &&
    (queuedActiveBatches.length > 0 || runningActiveBatches.length > 0) &&
    launchingOrRunningRequests.length === 0 &&
    activeOperations.length === 0 &&
    graphReadyIgnoredQueuedRequests.length === queuedRequests.length
  ) {
    return {
      action: "continue",
      blocking: false,
      reason:
        "graph presence is ready; ignoring stale graph-build PaperNexus batches that no longer gate frontier mapping",
      graphPresenceReady,
      requisitionRequestCount: requisitionRequests.length,
      invalidCompletedRequisitionRequestCount:
        invalidCompletedRequisitionRequests.length,
      queuedRequestCount: queuedRequests.length,
      launchingOrRunningRequestCount: launchingOrRunningRequests.length,
      dormantQueuedRequestCount: dormantQueuedRequests.length,
      ignoredDormantQueuedRequestCount: graphReadyIgnoredQueuedRequests.length,
      needsRepairRequestCount: needsRepairRequests.length,
      failedRequestCount: failedRequests.length,
      activeBatchCount: activeBatches.length,
      activeOperationCount: activeOperations.length,
      failedOperationCount: failedOperations.length + failedBatchItems.length,
    };
  }

  if (queuedRequests.length > 0) {
    const allQueuedRequestsAreDormant =
      dormantQueuedRequests.length === queuedRequests.length;
    if (graphPresenceReady && allQueuedRequestsAreDormant) {
      return {
        action: "continue",
        blocking: false,
        reason:
          "graph presence is ready; ignoring dormant queued PaperNexus requests that were never launched",
        graphPresenceReady,
        requisitionRequestCount: requisitionRequests.length,
        invalidCompletedRequisitionRequestCount:
          invalidCompletedRequisitionRequests.length,
        queuedRequestCount: queuedRequests.length,
        launchingOrRunningRequestCount: launchingOrRunningRequests.length,
        dormantQueuedRequestCount: dormantQueuedRequests.length,
        ignoredDormantQueuedRequestCount: dormantQueuedRequests.length,
        needsRepairRequestCount: needsRepairRequests.length,
        failedRequestCount: failedRequests.length,
        activeBatchCount: activeBatches.length,
        activeOperationCount: activeOperations.length,
        failedOperationCount: failedOperations.length + failedBatchItems.length,
      };
    }
    return {
      action: "wait",
      blocking: true,
      reason:
        "workflow-owned PaperNexus ingestion is queued; wait for the background import worker to launch or clear the request",
      graphPresenceReady,
      requisitionRequestCount: requisitionRequests.length,
      invalidCompletedRequisitionRequestCount:
        invalidCompletedRequisitionRequests.length,
      queuedRequestCount: queuedRequests.length,
      launchingOrRunningRequestCount: launchingOrRunningRequests.length,
      dormantQueuedRequestCount: dormantQueuedRequests.length,
      ignoredDormantQueuedRequestCount: 0,
      needsRepairRequestCount: needsRepairRequests.length,
      failedRequestCount: failedRequests.length,
      activeBatchCount: activeBatches.length,
      activeOperationCount: activeOperations.length,
      failedOperationCount: failedOperations.length + failedBatchItems.length,
    };
  }

  if (terminalFailureCount > 0) {
    if (graphPresenceReady) {
      return {
        action: "continue",
        blocking: false,
        reason:
          "graph presence is ready; ignoring terminal PaperNexus ingestion failures that no longer block the current stage",
        graphPresenceReady,
        requisitionRequestCount: requisitionRequests.length,
        invalidCompletedRequisitionRequestCount:
          invalidCompletedRequisitionRequests.length,
        queuedRequestCount: queuedRequests.length,
        launchingOrRunningRequestCount: launchingOrRunningRequests.length,
        dormantQueuedRequestCount: dormantQueuedRequests.length,
        ignoredDormantQueuedRequestCount: 0,
        needsRepairRequestCount: needsRepairRequests.length,
        failedRequestCount: failedRequests.length,
        activeBatchCount: activeBatches.length,
        activeOperationCount: activeOperations.length,
        failedOperationCount: failedOperations.length + failedBatchItems.length,
      };
    }
    return {
      action: "repair",
      blocking: true,
      reason:
        "workflow-owned PaperNexus ingestion failed or needs repair; rerun a bounded repair/import pass or mark the request terminal before frontier mapping",
      graphPresenceReady,
      requisitionRequestCount: requisitionRequests.length,
      invalidCompletedRequisitionRequestCount:
        invalidCompletedRequisitionRequests.length,
      queuedRequestCount: queuedRequests.length,
      launchingOrRunningRequestCount: launchingOrRunningRequests.length,
      dormantQueuedRequestCount: dormantQueuedRequests.length,
      ignoredDormantQueuedRequestCount: 0,
      needsRepairRequestCount: needsRepairRequests.length,
      failedRequestCount: failedRequests.length,
      activeBatchCount: activeBatches.length,
      activeOperationCount: activeOperations.length,
      failedOperationCount: failedOperations.length + failedBatchItems.length,
    };
  }

  return {
    action: "continue",
    blocking: false,
    reason: null,
    graphPresenceReady,
    requisitionRequestCount: requisitionRequests.length,
    invalidCompletedRequisitionRequestCount:
      invalidCompletedRequisitionRequests.length,
    queuedRequestCount: 0,
    launchingOrRunningRequestCount: 0,
    dormantQueuedRequestCount: 0,
    ignoredDormantQueuedRequestCount: 0,
    needsRepairRequestCount: 0,
    failedRequestCount: 0,
    activeBatchCount: 0,
    activeOperationCount: 0,
    failedOperationCount: 0,
  };
}

/**
 * 推导 graph_build 阶段的微阶段。
 *
 * 基于论文摄入决策——
 * uploading（上传中）> needs_repair（需修复）> verifying（验证中）> brainstorm_refresh（就绪）。
 * 这决定了 graph_build 阶段的内部进度展示。
 */
export function deriveGraphBuildMicroStage(params: {
  paperIngestionState: PaperIngestionState;
  graphPresenceStatus: string | null;
}): string {
  const decision = derivePaperIngestionWorkflowDecision({
    state: params.paperIngestionState,
    graphPresenceStatus: params.graphPresenceStatus,
  });
  if (decision.action === "wait") {
    return "uploading";
  }
  if (decision.action === "repair") {
    return "needs_repair";
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
    normalizeOptionalCount(count);
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

/**
 * 解析队列请求。
 *
 * 从 unknown JSON 安全转换。requestId 如果未提供则自动生成（randomUUID）。
 * 至少需要一个有意义的字段（wrapper/commandText/manifestPath/summary 等）才返回有效请求。
 */
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
  const rawStatus = normalizePaperIngestionQueuedRequestStatus(record.status);
  const detail = pickString(record, ["detail"]);
  const triggerKind = pickString(record, ["triggerKind", "trigger_kind"]);
  const progress = normalizePaperIngestionRemoteTaskProgress(record.progress);
  const queueProgress = normalizePaperIngestionQueueProgress(
    record.queueProgress ?? record.queue_progress
  );
  const argsRaw = record.args;
  const args = Array.isArray(argsRaw)
    ? argsRaw
        .map((item) => asString(item))
        .filter((item): item is string => Boolean(item))
    : [];
  const hasSparsePatchPayload = Boolean(
    detail || triggerKind || record.status != null || progress || queueProgress
  );
  if (
    !requestId ||
    (!wrapper && !commandText && !manifestPath && !summary && !hasSparsePatchPayload)
  ) {
    return null;
  }
  const finishedAt = pickString(record, ["finishedAt", "finished_at"]);
  const lastError = pickString(record, ["lastError", "last_error"]);
  const attemptCount =
    normalizeOptionalCount(record.attemptCount ?? record.attempt_count) ?? 0;
  const maxAttempts = normalizeOptionalCount(record.maxAttempts ?? record.max_attempts);
  const deadLetterAt = pickString(record, ["deadLetterAt", "dead_letter_at"]);
  const deadLetterReason = pickString(record, [
    "deadLetterReason",
    "dead_letter_reason",
  ]);
  const status = canonicalizePaperIngestionQueuedRequestStatus({
    status: rawStatus,
    attemptCount,
    maxAttempts,
    deadLetterAt,
    deadLetterReason,
    lastError,
    finishedAt,
  });
  return {
    requestId,
    requestKind: derivePaperIngestionQueuedRequestKind({
      explicit: record.requestKind ?? record.request_kind,
      triggerKind,
      manifestPath,
      commandText,
      wrapper,
    }),
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
    finishedAt,
    lastRunId: pickString(record, ["lastRunId", "last_run_id"]),
    lastSessionKey: pickString(record, ["lastSessionKey", "last_session_key"]),
    lastError,
    detail,
    triggerKind,
    progress,
    queueProgress,
    validationStatus: normalizePaperIngestionValidationStatus(
      record.validationStatus ?? record.validation_status
    ),
    validationSummary: pickString(record, [
      "validationSummary",
      "validation_summary",
    ]),
    validationReportPath: pickString(record, [
      "validationReportPath",
      "validation_report_path",
    ]),
    attemptCount,
    maxAttempts,
    lastAttemptAt: pickString(record, ["lastAttemptAt", "last_attempt_at"]),
    nextRetryAt: pickString(record, ["nextRetryAt", "next_retry_at"]),
    deadLetterAt,
    deadLetterReason,
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

/**
 * 序列化队列请求。
 */
export function serializePaperIngestionQueuedRequest(
  value: PaperIngestionQueuedRequest
): Record<string, unknown> {
  return {
    request_id: value.requestId,
    request_kind: value.requestKind,
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
    progress: serializePaperIngestionRemoteTaskProgress(value.progress),
    queue_progress: serializePaperIngestionQueueProgress(value.queueProgress),
    validation_status: value.validationStatus,
    validation_summary: value.validationSummary,
    validation_report_path: value.validationReportPath,
    attempt_count: value.attemptCount,
    max_attempts: value.maxAttempts,
    last_attempt_at: value.lastAttemptAt,
    next_retry_at: value.nextRetryAt,
    dead_letter_at: value.deadLetterAt,
    dead_letter_reason: value.deadLetterReason,
  };
}

function mergePaperIngestionQueuedRequestValues(
  current: PaperIngestionQueuedRequest,
  patch: PaperIngestionQueuedRequest
): PaperIngestionQueuedRequest {
  const lifecycleRestart =
    ["queued", "launching"].includes(patch.status) &&
    ["completed", "failed", "needs_repair"].includes(current.status);
  const merged: PaperIngestionQueuedRequest = {
    requestId: current.requestId,
    requestKind: patch.requestKind ?? current.requestKind,
    status: patch.status ?? current.status,
    wrapper: patch.wrapper ?? current.wrapper,
    args: patch.args.length > 0 ? patch.args : current.args,
    commandText: patch.commandText ?? current.commandText,
    manifestPath: patch.manifestPath ?? current.manifestPath,
    sharedCorpus: patch.sharedCorpus ?? current.sharedCorpus,
    paperCount: patch.paperCount ?? current.paperCount,
    summary: patch.summary ?? current.summary,
    createdAt: lifecycleRestart
      ? patch.createdAt ?? current.createdAt
      : current.createdAt ?? patch.createdAt,
    updatedAt: patch.updatedAt ?? current.updatedAt,
    startedAt: lifecycleRestart
      ? patch.startedAt
      : patch.startedAt ?? current.startedAt,
    finishedAt: lifecycleRestart
      ? patch.finishedAt
      : patch.finishedAt ?? current.finishedAt,
    lastRunId: lifecycleRestart
      ? patch.lastRunId
      : patch.lastRunId ?? current.lastRunId,
    lastSessionKey: lifecycleRestart
      ? patch.lastSessionKey
      : patch.lastSessionKey ?? current.lastSessionKey,
    lastError: lifecycleRestart
      ? patch.lastError
      : patch.lastError ?? current.lastError,
    detail: patch.detail ?? current.detail,
    triggerKind: patch.triggerKind ?? current.triggerKind,
    progress: mergePaperIngestionRemoteTaskProgress(
      current.progress,
      patch.progress
    ),
    queueProgress: mergePaperIngestionQueueProgress(
      current.queueProgress,
      patch.queueProgress
    ),
    validationStatus:
      lifecycleRestart || patch.validationStatus !== "unknown"
        ? patch.validationStatus
        : current.validationStatus,
    validationSummary: lifecycleRestart
      ? patch.validationSummary
      : patch.validationSummary ?? current.validationSummary,
    validationReportPath: lifecycleRestart
      ? patch.validationReportPath
      : patch.validationReportPath ?? current.validationReportPath,
    attemptCount: lifecycleRestart
      ? patch.attemptCount
      : Math.max(current.attemptCount, patch.attemptCount),
    maxAttempts: patch.maxAttempts ?? current.maxAttempts,
    lastAttemptAt: lifecycleRestart
      ? patch.lastAttemptAt
      : patch.lastAttemptAt ?? current.lastAttemptAt,
    nextRetryAt: lifecycleRestart
      ? patch.nextRetryAt
      : patch.nextRetryAt ?? current.nextRetryAt,
    deadLetterAt: lifecycleRestart
      ? patch.deadLetterAt
      : patch.deadLetterAt ?? current.deadLetterAt,
    deadLetterReason: lifecycleRestart
      ? patch.deadLetterReason
      : patch.deadLetterReason ?? current.deadLetterReason,
  };
  return {
    ...merged,
    status: canonicalizePaperIngestionQueuedRequestStatus({
      status: merged.status,
      attemptCount: merged.attemptCount,
      maxAttempts: merged.maxAttempts,
      deadLetterAt: merged.deadLetterAt,
      deadLetterReason: merged.deadLetterReason,
      lastError: merged.lastError,
      finishedAt: merged.finishedAt,
    }),
  };
}

/**
 * 合并两个队列请求列表。
 *
 * 按 requestId 匹配——新请求覆盖旧请求的对应字段。
 * 用于增量更新状态（比如从外部系统收到新的进度更新时）。
 */
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

/**
 * 合并批量运行列表。
 *
 * 按 manifestPath 匹配——合并后返回新变为终端状态的批量运行。
 */
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

/**
 * 合并批量项目列表。
 */
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

/**
 * 合并论文操作列表。
 */
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

/**
 * 合并已完成论文列表。
 */
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

// ---------------------------------------------------------------------------
// Experiment outcome → graph write-back
// ---------------------------------------------------------------------------

export type ExperimentSyncOutcome = {
  synced: boolean;
  experimentsProcessed: number;
  findingsCreated: number;
  error: string | null;
};

type ExperimentLedgerLike = Record<string, unknown> & {
  summary?: Record<string, unknown> | null;
  experiments?: Array<Record<string, unknown>> | null;
};

type McpClientLike = {
  callTool: (
    toolName: string,
    params?: Record<string, unknown>
  ) => Promise<{ ok: boolean; data: unknown; error: string | null }>;
};

function getOrCreateExperimentSyncRecord(
  experiment: Record<string, unknown>
): Record<string, unknown> {
  const existing = asRecord(experiment.papernexusSync ?? experiment.papernexus_sync);
  if (existing) {
    experiment.papernexusSync = existing;
    experiment.papernexus_sync = existing;
    return existing;
  }
  const created: Record<string, unknown> = {};
  experiment.papernexusSync = created;
  experiment.papernexus_sync = created;
  return created;
}

function recordExperimentSyncOutcome(params: {
  experiment: Record<string, unknown>;
  status: "synced" | "failed";
  now: string;
  note: string | null;
  nodeRef?: string | null;
}): void {
  const syncRecord = getOrCreateExperimentSyncRecord(params.experiment);
  syncRecord.status = params.status;
  syncRecord.lastSyncedAt = params.status === "synced" ? params.now : null;
  syncRecord.last_synced_at = params.status === "synced" ? params.now : null;
  syncRecord.notes = params.note;
  if (params.nodeRef) {
    const existingRefs = Array.isArray(syncRecord.nodeRefs)
      ? syncRecord.nodeRefs
      : Array.isArray(syncRecord.node_refs)
        ? syncRecord.node_refs
        : [];
    const nextRefs = Array.from(
      new Set(
        existingRefs
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .concat(params.nodeRef)
      )
    );
    syncRecord.nodeRefs = nextRefs;
    syncRecord.node_refs = nextRefs;
  }
}

function recalculateExperimentLedgerSyncSummary(
  ledger: ExperimentLedgerLike,
  now: string,
  markComplete: boolean
): void {
  const summary = asRecord(ledger.summary) ?? {};
  const experiments = Array.isArray(ledger.experiments) ? ledger.experiments : [];
  const syncRequired = experiments.some((experiment) => {
    const status = asString(experiment.status);
    if (
      !["done", "completed", "failed", "timeout", "stalled", "killed", "cancelled"].includes(
        status ?? ""
      )
    ) {
      return false;
    }
    const syncRecord = asRecord(experiment.papernexusSync ?? experiment.papernexus_sync);
    const syncStatus =
      asString(syncRecord?.status) ??
      asString((syncRecord as Record<string, unknown> | null)?.sync_status);
    return !syncStatus || ["pending", "failed", "missing"].includes(syncStatus);
  });
  const latestSyncedAt =
    experiments
      .map((experiment) => {
        const syncRecord = asRecord(experiment.papernexusSync ?? experiment.papernexus_sync);
        return (
          asString(syncRecord?.lastSyncedAt) ??
          asString((syncRecord as Record<string, unknown> | null)?.last_synced_at)
        );
      })
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => right.localeCompare(left))[0] ??
    (!syncRequired && markComplete
      ? now
      : asString(summary.papernexus_last_sync_at) ?? asString(summary.papernexusLastSyncAt));

  summary.papernexus_sync_required = syncRequired;
  summary.papernexusSyncRequired = syncRequired;
  summary.papernexus_last_sync_at = latestSyncedAt ?? null;
  summary.papernexusLastSyncAt = latestSyncedAt ?? null;
  ledger.summary = summary;
}

/**
 * 将实验结果同步到知识图谱。
 *
 * 为核心决策函数。为每个已完成的实验（completed/failed）：
 * 1. 创建 Finding 节点（包含 experimentId、hypothesisRef、resultSummary）
 * 2. 创建关系边（SUPPORTED_BY 或 FALSIFIED_BY，连接 Hypothesis → Finding）
 * 3. 记录同步结果到实验 ledger
 *
 * 为什么需要这个？因为实验结果的最终价值在于更新领域知识图谱——
 * 支持的假设增强信心，证伪的假设标记风险。
 * 这是"实验驱动知识发现"的闭环。
 */
export async function syncExperimentOutcomesToGraph(params: {
  projectRoot: string;
  ledger: ExperimentLedgerLike;
  mcpClient: McpClientLike | null;
  now?: string;
}): Promise<ExperimentSyncOutcome> {
  const { ledger, mcpClient, now = new Date().toISOString() } = params;
  const syncRequired =
    ledger.summary?.papernexus_sync_required === true ||
    ledger.summary?.papernexusSyncRequired === true;

  if (!syncRequired) {
    return { synced: false, experimentsProcessed: 0, findingsCreated: 0, error: null };
  }

  if (!mcpClient) {
    return {
      synced: false,
      experimentsProcessed: 0,
      findingsCreated: 0,
      error: "No MCP client available for graph write-back. Configure papernexusAccessMode or resolve token.",
    };
  }

  const experiments = Array.isArray(ledger.experiments) ? ledger.experiments : [];
  const completed = experiments.filter(
    (exp) =>
      asString(exp.status) === "completed" || asString(exp.status) === "failed"
  );

  let findingsCreated = 0;
  const errors: string[] = [];

  for (const exp of completed) {
    const expId = asString(exp.experiment_id) ?? asString(exp.id) ?? "unknown";
    const hypothesisRef = asString(exp.hypothesis_ref) ?? asString(exp.hypothesis);
    const methodRef = asString(exp.method_ref) ?? asString(exp.method);
    const status = asString(exp.status);
    const resultSummary = asString(exp.result_summary) ?? asString(exp.summary) ?? "";
    const edgeType = status === "completed" ? "SUPPORTED_BY" : "FALSIFIED_BY";
    const findingName = `finding_${expId}`;
    const findingRef = `finding:${expId}`;

    try {
      const result = await mcpClient.callTool("mutate_graph", {
        dryRun: false,
        operations: [
          {
            action: "upsert_node",
            id: findingRef,
            type: "Finding",
            name: findingName,
            properties: {
              experimentId: expId,
              hypothesisRef,
              methodRef,
              status,
              resultSummary,
              createdAt: now,
              updatedAt: now,
            },
          },
          ...(hypothesisRef
            ? [
                {
                  action: "upsert_relationship",
                  type: edgeType,
                  source: hypothesisRef,
                  target: { id: findingRef },
                  properties: { experimentId: expId },
                },
              ]
            : []),
        ],
      });

      if (result.ok) {
        findingsCreated++;
        recordExperimentSyncOutcome({
          experiment: exp,
          status: "synced",
          now,
          note: null,
          nodeRef: findingRef,
        });
      } else {
        const errorMessage = `Experiment ${expId}: ${result.error ?? "graph mutation failed"}`;
        errors.push(errorMessage);
        recordExperimentSyncOutcome({
          experiment: exp,
          status: "failed",
          now,
          note: errorMessage,
        });
      }
    } catch (error) {
      const errorMessage = `Experiment ${expId}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      errors.push(errorMessage);
      recordExperimentSyncOutcome({
        experiment: exp,
        status: "failed",
        now,
        note: errorMessage,
      });
    }
  }
  recalculateExperimentLedgerSyncSummary(ledger, now, errors.length === 0);

  return {
    synced: errors.length === 0,
    experimentsProcessed: completed.length,
    findingsCreated,
    error: errors.length > 0 ? errors.join("; ") : null,
  };
}
