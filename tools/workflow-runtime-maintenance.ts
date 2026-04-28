import path from "node:path";
import {
  readJsonIfExists,
  writeJsonAtomicEnsured,
} from "./workflow-guard-core/fs";
import {
  dispatchWorkflowTaskToAgent,
  resolveWorkflowDispatchLaunchRunId,
  type DispatchableWorkflowRole,
} from "./agent-task-dispatch";
import {
  handoffWorkflowTaskToAgent,
  type WorkflowLobsterHandoffConfig,
} from "./lobster-handoff";
import {
  recordWorkflowRuntimeIncident,
  type WorkflowRuntimeIncidentEntry,
} from "./workflow-runtime-incidents.js";
import {
  recoverWorkflowRuntimeState,
  type WorkflowRuntimeRecoveryResult,
} from "./workflow-runtime-recovery.js";
import { refreshExperimentGpuMonitor } from "./workflow-gpu-monitor";
import { evaluateExperimentSearchDecisionForProject } from "./workflow-experiment-decision";
import {
  appendWorkflowRuntimeEvent,
  readWorkflowRuntimeQueueStore,
  readWorkflowRuntimeSessionsStore,
  type WorkflowRuntimeBroadcastEntry,
  type WorkflowRuntimeQueueDispatchPayload,
  type WorkflowRuntimeQueueEntry,
  type WorkflowRuntimeSessionEntry,
  updateWorkflowRuntimeQueueStore,
  updateWorkflowRuntimeSessionsStore,
} from "./workflow-runtime-state.js";
import { resumeWorkflowTransition } from "./workflow-session-orchestrator.js";
import {
  runWorkflowHandoffMaintenancePass,
  type WorkflowHandoffMaintenanceResult,
} from "./workflow-handoff/maintenance";
import {
  findWorkflowHandoffIntent,
  transitionWorkflowHandoffIntent,
} from "./workflow-handoff/handoff-store";
import { routeWorkflowFailure } from "./workflow-handoff/failure-router";
import { evaluateChannelProjectBindingGate } from "./channel-project-bindings";
import { appendWorkflowDiagnosticEvent } from "./workflow-diagnostics.js";
import { writePapernexusProgressFromManifest } from "./papernexus-progress";
import {
  buildPapernexusBatchImportCommandText,
  buildPapernexusBatchImportWaitArgs,
  getPapernexusBatchImportArgs,
  isPapernexusBatchImportLifecycleRequest,
} from "./papernexus-batch-executor.js";
import {
  DEFAULT_PROVIDER_CAPACITY_COOLDOWN_MS,
  isProviderCapacityFailure,
} from "./provider-capacity.js";
import { appendWorkflowLocalOperatorRelay } from "./workflow-local-operator-relay.js";
import { isWorkflowRuntimeTrackingMissError } from "./workflow-background-run-reconcile.js";
import { inspectRecentSessionProviderCapacity } from "./workflow-session-provider-capacity.js";
import type {
  WorkflowExecutionRuntime,
  WorkflowExecutionSessionInspection,
} from "./workflow-execution-runtime.js";

type WorkflowRuntimeApi = WorkflowExecutionRuntime;

type LoggerLike = {
  debug?: (message: string, meta?: Record<string, unknown>) => void;
  info?: (message: string, meta?: Record<string, unknown>) => void;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
  error?: (message: string, meta?: Record<string, unknown>) => void;
};

type WorkflowPolicyLike = {
  lobsterHandoff?: WorkflowLobsterHandoffConfig;
  enableChannelProjectBindings?: boolean;
  projectsRoot?: string;
} | null;

const ACTIVE_SESSION_INSPECTION_GRACE_MS = 30 * 1000;
const ACTIVE_RUN_FAILURE_PROBE_TIMEOUT_MS = 25;
const ACTIVE_PAPER_INGESTION_REQUEST_STATUSES = new Set([
  "launching",
  "running",
]);
const ACTIVE_RUNTIME_QUEUE_STATUSES = new Set([
  "queued",
  "launching",
  "running",
  "degraded",
  "needs_repair",
]);
const TERMINAL_RUNTIME_QUEUE_STATUSES = new Set([
  "completed",
  "failed",
]);
const ACTIVE_UNDERLYING_SESSION_STATUSES = new Set([
  "active",
  "busy",
  "launching",
  "queued",
  "running",
  "starting",
]);

type InvalidRuntimeSessionRepair = {
  reason: string;
  capacityFailure: boolean;
  cooldownUntil: string | null;
};

export type WorkflowRuntimeMaintenanceResult = {
  projectId: string | null;
  projectRoot: string;
  recovery: WorkflowRuntimeRecoveryResult;
  replayedQueueKeys: string[];
  exhaustedQueueKeys: string[];
  repairedSessionKeys: string[];
  repairedPaperIngestionRequestIds: string[];
  exhaustedSessionKeys: string[];
  incidents: WorkflowRuntimeIncidentEntry[];
  handoffMaintenance: WorkflowHandoffMaintenanceResult;
  watchdogSummary: {
    queueRepairPending: number;
    sessionRepairPending: number;
    replayedQueueCount: number;
    exhaustedQueueCount: number;
    exhaustedSessionCount: number;
    incidentCount: number;
  };
  experimentMaintenance: {
    attempted: boolean;
    monitorRefreshed: boolean;
    decisionPersisted: boolean;
    decision: string | null;
    recommendation: string | null;
  };
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseTimeMs(value: unknown): number | null {
  const numeric = readFiniteNumber(value);
  if (numeric != null) {
    return numeric;
  }
  const text = readString(value);
  if (!text) {
    return null;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
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

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function buildDispatchSupersededByProjectRoutingReason(params: {
  queueKey: string;
  dispatchStage: string | null;
  dispatchOwner: string | null;
  currentStage: string | null;
  currentOwner: string | null;
}): string {
  return [
    `Workflow transition ${params.queueKey} was superseded by newer project routing.`,
    params.dispatchStage ? `queued_stage=${params.dispatchStage}` : null,
    params.dispatchOwner ? `queued_owner=${params.dispatchOwner}` : null,
    params.currentStage ? `current_stage=${params.currentStage}` : null,
    params.currentOwner ? `current_owner=${params.currentOwner}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function isDispatchEntrySupersededByProjectRouting(params: {
  entry: WorkflowRuntimeQueueEntry;
  currentStage: string | null;
  currentOwner: string | null;
  pendingHandoffId: string | null;
}): boolean {
  if (
    params.entry.entryType !== "dispatch_task" ||
    !params.entry.dispatchPayload ||
    !params.entry.queueKey.startsWith("handoff:")
  ) {
    return false;
  }
  const queuedIntentId = params.entry.queueKey.slice("handoff:".length);
  if (params.pendingHandoffId && queuedIntentId === params.pendingHandoffId) {
    return false;
  }
  const dispatchStage = readString(params.entry.dispatchPayload.stage);
  const dispatchOwner = readString(params.entry.dispatchPayload.toRole);
  if (!dispatchStage && !dispatchOwner) {
    return false;
  }
  if (dispatchStage && params.currentStage && dispatchStage !== params.currentStage) {
    return true;
  }
  if (dispatchOwner && params.currentOwner && dispatchOwner !== params.currentOwner) {
    return true;
  }
  return false;
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .map((entry) => readRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
}

function pickRecordString(
  record: Record<string, unknown>,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = readString(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function normalizeRuntimeLikeStatus(value: unknown): string | null {
  return readString(value)?.toLowerCase().replace(/[^a-z0-9]+/g, "_") ?? null;
}

function isPaperNexusQueuedRequest(record: Record<string, unknown>): boolean {
  const wrapper = pickRecordString(record, ["wrapper"]);
  const commandText = pickRecordString(record, ["command_text", "commandText"]);
  const requestKind = normalizeRuntimeLikeStatus(
    record.request_kind ?? record.requestKind
  );
  const triggerKind = normalizeRuntimeLikeStatus(
    record.trigger_kind ?? record.triggerKind
  );
  const searchable = [wrapper, commandText].filter(Boolean).join(" ");
  return (
    requestKind === "upload_manifest" ||
    triggerKind === "graph_build_source_catchup" ||
    /(?:^|\/)pn_(?:batch_import|import_submit|import_queue|stage_sync|paper_refresh)\.py\b/.test(
      searchable
    )
  );
}

function paperRequestRuntimeRefs(record: Record<string, unknown>): {
  requestId: string | null;
  runId: string | null;
  sessionKey: string | null;
  queueKey: string | null;
  commandText: string | null;
} {
  return {
    requestId: pickRecordString(record, ["request_id", "requestId"]),
    runId: pickRecordString(record, ["last_run_id", "lastRunId", "run_id", "runId"]),
    sessionKey: pickRecordString(record, [
      "last_session_key",
      "lastSessionKey",
      "session_key",
      "sessionKey",
    ]),
    queueKey: pickRecordString(record, ["queue_key", "queueKey"]),
    commandText: pickRecordString(record, ["command_text", "commandText"]),
  };
}

function paperRequestTimestampMs(record: Record<string, unknown>): number | null {
  return (
    parseTimeMs(record.updated_at) ??
    parseTimeMs(record.updatedAt) ??
    parseTimeMs(record.started_at) ??
    parseTimeMs(record.startedAt) ??
    parseTimeMs(record.created_at) ??
    parseTimeMs(record.createdAt)
  );
}

function runtimeQueueMatchesPaperRequest(
  entry: WorkflowRuntimeQueueEntry,
  refs: ReturnType<typeof paperRequestRuntimeRefs>
): boolean {
  const values = [
    entry.queueKey,
    entry.requesterSessionKey,
    entry.preferredSessionKey,
    entry.parentSessionKey,
    entry.runPayload?.idempotencyKey,
    entry.runPayload?.message,
    entry.summary,
  ].filter((value): value is string => Boolean(value));
  if (refs.queueKey && entry.queueKey === refs.queueKey) {
    return true;
  }
  if (
    refs.sessionKey &&
    values.some((value) => value === refs.sessionKey || value.includes(refs.sessionKey ?? ""))
  ) {
    return true;
  }
  if (refs.requestId && values.some((value) => value.includes(refs.requestId ?? ""))) {
    return true;
  }
  if (refs.runId && values.some((value) => value.includes(refs.runId ?? ""))) {
    return true;
  }
  if (refs.commandText && values.some((value) => value.includes(refs.commandText ?? ""))) {
    return true;
  }
  return false;
}

function terminalRuntimeQueueTimestamp(
  entry: WorkflowRuntimeQueueEntry
): string {
  return entry.lastCheckedAt ?? entry.lastAttemptedAt ?? nowIso();
}

function rawPaperIngestionRequestForBatchImport(
  request: Record<string, unknown>
) {
  const argsRaw = Array.isArray(request.args) ? request.args : [];
  return {
    wrapper: pickRecordString(request, ["wrapper"]),
    args: argsRaw
      .map((entry) => (typeof entry === "string" ? entry : null))
      .filter((entry): entry is string => Boolean(entry)),
    commandText: pickRecordString(request, ["command_text", "commandText"]),
  };
}

async function reconcileTerminalPaperIngestionRequestsWithRuntimeQueue(params: {
  projectRoot: string;
  projectId: string | null;
}): Promise<{
  completedRequestIds: string[];
  failedRequestIds: string[];
}> {
  const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
  const manifest = await readJsonIfExists<Record<string, unknown>>(manifestPath);
  if (!manifest) {
    return { completedRequestIds: [], failedRequestIds: [] };
  }
  const paperIngestion = readRecord(manifest.paper_ingestion);
  if (!paperIngestion) {
    return { completedRequestIds: [], failedRequestIds: [] };
  }
  const queuedRequests = readRecordArray(
    paperIngestion.queued_requests ?? paperIngestion.queuedRequests
  );
  if (queuedRequests.length === 0) {
    return { completedRequestIds: [], failedRequestIds: [] };
  }

  const queueStore = await readWorkflowRuntimeQueueStore(params.projectRoot);
  const activeQueueEntries = queueStore.entries.filter((entry) =>
    ACTIVE_RUNTIME_QUEUE_STATUSES.has(entry.status)
  );
  const terminalQueueEntries = queueStore.entries.filter((entry) =>
    TERMINAL_RUNTIME_QUEUE_STATUSES.has(entry.status)
  );
  if (terminalQueueEntries.length === 0) {
    return { completedRequestIds: [], failedRequestIds: [] };
  }

  const currentAt = nowIso();
  const completedRequestIds: string[] = [];
  const requeuedImportRequestIds: string[] = [];
  const failedRequestIds: string[] = [];
  const nextRequests = queuedRequests.map((request) => {
    const status = normalizeRuntimeLikeStatus(request.status);
    if (
      !status ||
      !ACTIVE_PAPER_INGESTION_REQUEST_STATUSES.has(status) ||
      !isPaperNexusQueuedRequest(request)
    ) {
      return request;
    }
    const refs = paperRequestRuntimeRefs(request);
    const hasActiveQueue = activeQueueEntries.some((entry) =>
      runtimeQueueMatchesPaperRequest(entry, refs)
    );
    if (hasActiveQueue) {
      return request;
    }
    const terminalQueue = terminalQueueEntries
      .filter((entry) => runtimeQueueMatchesPaperRequest(entry, refs))
      .sort((left, right) =>
        terminalRuntimeQueueTimestamp(right).localeCompare(
          terminalRuntimeQueueTimestamp(left)
        )
      )[0];
    if (!terminalQueue) {
      return request;
    }
    const requestId =
      refs.requestId ?? refs.runId ?? refs.sessionKey ?? `request-${completedRequestIds.length + failedRequestIds.length + 1}`;
    const finishedAt = terminalRuntimeQueueTimestamp(terminalQueue);
    if (terminalQueue.status === "completed") {
      const batchRequest = rawPaperIngestionRequestForBatchImport(request);
      if (isPapernexusBatchImportLifecycleRequest(batchRequest)) {
        const waitArgs = buildPapernexusBatchImportWaitArgs(
          getPapernexusBatchImportArgs(batchRequest),
          {
            timeoutSeconds: 60,
            intervalSeconds: 5,
          }
        );
        requeuedImportRequestIds.push(requestId);
        return {
          ...request,
          status: "queued",
          args: waitArgs,
          command_text: buildPapernexusBatchImportCommandText(waitArgs),
          updated_at: currentAt,
          finished_at: pickRecordString(request, ["finished_at", "finishedAt"]),
          next_retry_at: null,
          last_error: null,
          detail:
            "PaperNexus wrapper process completed, but remote import completion still requires a bounded wait/status pass.",
        };
      }
      completedRequestIds.push(requestId);
      return {
        ...request,
        status: "completed",
        updated_at: currentAt,
        finished_at: pickRecordString(request, ["finished_at", "finishedAt"]) ?? finishedAt,
        last_error: null,
        detail:
          "PaperNexus wrapper runtime completed; graph presence verification remains authoritative for downstream readiness.",
      };
    }
    failedRequestIds.push(requestId);
    const error =
      terminalQueue.lastError ??
      "PaperNexus wrapper runtime failed before synchronizing queued request state.";
    return {
      ...request,
      status: "failed",
      updated_at: currentAt,
      finished_at: pickRecordString(request, ["finished_at", "finishedAt"]) ?? finishedAt,
      last_error: pickRecordString(request, ["last_error", "lastError"]) ?? error,
      detail: error,
    };
  });

  if (
    completedRequestIds.length === 0 &&
    requeuedImportRequestIds.length === 0 &&
    failedRequestIds.length === 0
  ) {
    return { completedRequestIds: [], failedRequestIds: [] };
  }

  const summaryParts = [
    completedRequestIds.length > 0
      ? `${completedRequestIds.length} PaperNexus queued request(s) completed in the runtime queue`
      : null,
    requeuedImportRequestIds.length > 0
      ? `${requeuedImportRequestIds.length} PaperNexus queued request(s) requeued for remote import wait/status`
      : null,
    failedRequestIds.length > 0
      ? `${failedRequestIds.length} PaperNexus queued request(s) failed in the runtime queue`
      : null,
  ].filter(Boolean);
  const summary = `${summaryParts.join("; ")}; reconciled queued_requests before stale-runtime repair.`;
  const nextPaperIngestion = {
    ...paperIngestion,
    queued_requests: nextRequests,
    runtime_status:
      failedRequestIds.length > 0
        ? "blocked"
        : requeuedImportRequestIds.length > 0
          ? "waiting_import"
          : "waiting_graph",
    waiting_reason:
      failedRequestIds.length > 0
        ? "PaperNexus wrapper runtime failed; repair is required before graph readiness can advance."
        : requeuedImportRequestIds.length > 0
          ? "PaperNexus wrapper process completed; remote import still requires bounded wait/status verification."
        : "PaperNexus wrapper runtime completed; waiting for graph presence verification.",
    repair_required:
      failedRequestIds.length > 0 ? true : paperIngestion.repair_required,
    repair_reason:
      failedRequestIds.length > 0
        ? "PaperNexus wrapper runtime failed before queued request completion."
        : paperIngestion.repair_reason,
    last_updated_at: currentAt,
  } as Record<string, unknown>;
  delete nextPaperIngestion.queuedRequests;
  manifest.paper_ingestion = nextPaperIngestion;
  manifest.updated_at = currentAt;

  await writeJsonAtomicEnsured(manifestPath, manifest);
  await writePapernexusProgressFromManifest({
    projectRoot: params.projectRoot,
    manifest,
    updatedAt: currentAt,
  });
  await appendWorkflowRuntimeEvent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    kind: "paper_ingestion_request_runtime_reconciled",
    summary,
    details: {
      completedRequestIds,
      requeuedImportRequestIds,
      failedRequestIds,
    },
  });
  await appendWorkflowDiagnosticEvent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    component: "runtime_maintenance",
    action: "paper_ingestion_request_runtime_reconciled",
    status:
      failedRequestIds.length > 0 || requeuedImportRequestIds.length > 0
        ? "waiting"
        : "completed",
    summary,
    details: {
      completedRequestIds,
      requeuedImportRequestIds,
      failedRequestIds,
    },
  });
  return { completedRequestIds, failedRequestIds };
}

async function markStalePaperIngestionRequestsNeedsRepair(params: {
  projectRoot: string;
  projectId: string | null;
  activeSessionInspectionGraceMs?: number;
  currentMs?: number;
}): Promise<{
  repairedRequestIds: string[];
}> {
  const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
  const manifest = await readJsonIfExists<Record<string, unknown>>(manifestPath);
  if (!manifest) {
    return { repairedRequestIds: [] };
  }
  const paperIngestion = readRecord(manifest.paper_ingestion);
  if (!paperIngestion) {
    return { repairedRequestIds: [] };
  }
  const queuedRequests = readRecordArray(
    paperIngestion.queued_requests ?? paperIngestion.queuedRequests
  );
  if (queuedRequests.length === 0) {
    return { repairedRequestIds: [] };
  }

  const [sessionsStore, queueStore] = await Promise.all([
    readWorkflowRuntimeSessionsStore(params.projectRoot),
    readWorkflowRuntimeQueueStore(params.projectRoot),
  ]);
  const activeSessionKeys = new Set(
    sessionsStore.entries
      .filter((entry) => entry.status === "active")
      .map((entry) => entry.sessionKey)
  );
  const activeRunIds = new Set(
    sessionsStore.entries
      .filter((entry) => entry.status === "active" && readString(entry.runId))
      .map((entry) => entry.runId as string)
  );
  const activeQueueEntries = queueStore.entries.filter((entry) =>
    ACTIVE_RUNTIME_QUEUE_STATUSES.has(entry.status)
  );
  const currentMs = params.currentMs ?? Date.now();
  const graceMs =
    typeof params.activeSessionInspectionGraceMs === "number" &&
    Number.isFinite(params.activeSessionInspectionGraceMs)
      ? Math.max(0, Math.floor(params.activeSessionInspectionGraceMs))
      : ACTIVE_SESSION_INSPECTION_GRACE_MS;
  const now = new Date(currentMs).toISOString();
  const repairedRequestIds: string[] = [];
  const repairedRefs: Array<ReturnType<typeof paperRequestRuntimeRefs>> = [];
  const nextRequests = queuedRequests.map((request) => {
    const status = normalizeRuntimeLikeStatus(request.status);
    if (
      !status ||
      !ACTIVE_PAPER_INGESTION_REQUEST_STATUSES.has(status) ||
      !isPaperNexusQueuedRequest(request)
    ) {
      return request;
    }
    const refs = paperRequestRuntimeRefs(request);
    const hasActiveSession =
      (refs.sessionKey ? activeSessionKeys.has(refs.sessionKey) : false) ||
      (refs.runId ? activeRunIds.has(refs.runId) : false);
    const hasActiveQueue = activeQueueEntries.some((entry) =>
      runtimeQueueMatchesPaperRequest(entry, refs)
    );
    if (hasActiveSession || hasActiveQueue) {
      return request;
    }
    const updatedMs = paperRequestTimestampMs(request);
    if (updatedMs != null && currentMs - updatedMs < graceMs) {
      return request;
    }
    const requestId =
      refs.requestId ?? refs.runId ?? refs.sessionKey ?? `request-${repairedRequestIds.length + 1}`;
    const reason =
      "PaperNexus upload request lost its active runtime session/queue linkage and needs repair.";
    repairedRequestIds.push(requestId);
    repairedRefs.push(refs);
    return {
      ...request,
      status: "needs_repair",
      updated_at: now,
      last_error: pickRecordString(request, ["last_error", "lastError"]) ?? reason,
      detail: reason,
    };
  });

  if (repairedRequestIds.length === 0) {
    return { repairedRequestIds: [] };
  }

  const repairReason =
    repairedRequestIds.length === 1
      ? `PaperNexus queued request ${repairedRequestIds[0]} lost runtime tracking and needs repair.`
      : `${repairedRequestIds.length} PaperNexus queued requests lost runtime tracking and need repair.`;
  const nextPaperIngestion = {
    ...paperIngestion,
    queued_requests: nextRequests,
    runtime_status: "blocked",
    waiting_reason: repairReason,
    repair_required: true,
    repair_reason: repairReason,
    last_updated_at: now,
  } as Record<string, unknown>;
  delete nextPaperIngestion.queuedRequests;
  manifest.paper_ingestion = nextPaperIngestion;
  manifest.updated_at = now;
  await writeJsonAtomicEnsured(manifestPath, manifest);
  await writePapernexusProgressFromManifest({
    projectRoot: params.projectRoot,
    manifest,
    updatedAt: now,
  });
  await appendWorkflowRuntimeEvent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    kind: "paper_ingestion_request_repair",
    summary: repairReason,
    details: {
      repairedRequestIds,
      repairedRefs,
    },
  });
  await appendWorkflowDiagnosticEvent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    component: "runtime_maintenance",
    action: "paper_ingestion_request_repair",
    status: "waiting",
    summary: repairReason,
    details: {
      repairedRequestIds,
      repairedRefs,
    },
  });
  return { repairedRequestIds };
}

function describeInvalidRuntimeSessionInspection(
  inspection: WorkflowExecutionSessionInspection
): string | null {
  const status = readString(inspection.status)?.toLowerCase() ?? null;
  const legacyInspection = inspection as unknown as { error?: unknown };
  const lastError =
    readString(inspection.lastError) ?? readString(legacyInspection.error);
  if (status && ["failed", "completed", "aborted", "done"].includes(status)) {
    return [
      `Workflow runtime session is already terminal in the underlying session store (status=${status}).`,
      lastError ? `last_error=${lastError}` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (inspection.abortedLastRun) {
    return "Workflow runtime session was aborted in the underlying session store.";
  }
  if (inspection.liveModelSwitchPending) {
    return "Workflow runtime session has a pending live model switch and must be rotated.";
  }
  if (inspection.providerOverride || inspection.modelOverride) {
    return "Workflow runtime session carries a persisted model/provider override and must be rotated.";
  }
  return null;
}

function isUnderlyingRuntimeSessionActive(
  inspection: WorkflowExecutionSessionInspection | null | undefined
): boolean {
  if (!inspection) {
    return false;
  }
  const status = readString(inspection.status)?.toLowerCase() ?? null;
  if (!status || !ACTIVE_UNDERLYING_SESSION_STATUSES.has(status)) {
    return false;
  }
  return inspection.endedAt == null;
}

function resolveRuntimeSessionFreshnessMs(
  session: WorkflowRuntimeSessionEntry
): number | null {
  return (
    parseTimeMs(session.lastHeartbeatAt) ??
    parseTimeMs(session.lastCheckedAt) ??
    parseTimeMs(session.startedAt)
  );
}

function isRuntimeSessionStaleForInspection(params: {
  session: WorkflowRuntimeSessionEntry;
  staleSessionAgeMs: number;
  currentMs: number;
}): boolean {
  const freshnessMs = resolveRuntimeSessionFreshnessMs(params.session);
  if (freshnessMs == null) {
    return true;
  }
  return params.currentMs - freshnessMs > params.staleSessionAgeMs;
}

function getQueueRetryDelayMs(entry: WorkflowRuntimeQueueEntry, currentMs: number): number {
  const nextRetryMs = parseTimeMs(entry.nextRetryAt);
  if (nextRetryMs == null) {
    return 0;
  }
  return Math.max(0, nextRetryMs - currentMs);
}

function buildProviderCapacityCooldownUntil(): string {
  return new Date(Date.now() + DEFAULT_PROVIDER_CAPACITY_COOLDOWN_MS).toISOString();
}

async function probeActiveRuntimeRun(params: {
  workflowRuntime: WorkflowRuntimeApi;
  session: WorkflowRuntimeSessionEntry;
  inspection: WorkflowExecutionSessionInspection | null;
}): Promise<InvalidRuntimeSessionRepair | null> {
  const transcriptCapacityFailure =
    await inspectRecentSessionProviderCapacity({
      workflowRuntime: params.workflowRuntime,
      sessionKey: params.session.sessionKey,
      limit: 120,
    });
  if (transcriptCapacityFailure) {
    return {
      reason: `Workflow runtime session hit provider capacity while still marked active: ${transcriptCapacityFailure}`,
      capacityFailure: true,
      cooldownUntil: new Date(
        Date.now() + DEFAULT_PROVIDER_CAPACITY_COOLDOWN_MS
      ).toISOString(),
    };
  }
  const runId = readString(params.session.runId);
  if (!runId || !params.workflowRuntime.waitForRun) {
    return null;
  }
  const waited = await params.workflowRuntime.waitForRun({
    runId,
    timeoutMs: ACTIVE_RUN_FAILURE_PROBE_TIMEOUT_MS,
  });
  if (waited.status === "timeout") {
    return null;
  }
  if (
    waited.status === "error" &&
    isWorkflowRuntimeTrackingMissError(waited) &&
    isUnderlyingRuntimeSessionActive(params.inspection)
  ) {
    return null;
  }
  const reason =
    waited.status === "ok"
      ? "Workflow runtime run has already completed but the runtime session is still marked active."
      : `Workflow runtime run failed while the session was still marked active: ${
          readString(waited.error) ?? "unknown error"
        }`;
  const capacityFailure = isProviderCapacityFailure(waited.error ?? reason);
  return {
    reason,
    capacityFailure,
    cooldownUntil: capacityFailure
      ? new Date(Date.now() + DEFAULT_PROVIDER_CAPACITY_COOLDOWN_MS).toISOString()
      : null,
  };
}

async function repairInvalidActiveRuntimeSessions(params: {
  projectRoot: string;
  projectId: string | null;
  workflowRuntime?: WorkflowRuntimeApi;
  activeSessionInspectionGraceMs?: number;
  staleSessionAgeMs?: number;
}): Promise<{
  repairedSessionKeys: string[];
  repairedQueueKeys: string[];
}> {
  if (!params.workflowRuntime?.inspectSession) {
    return {
      repairedSessionKeys: [],
      repairedQueueKeys: [],
    };
  }

  const sessionsStore = await readWorkflowRuntimeSessionsStore(params.projectRoot);
  const invalidBySessionKey = new Map<string, InvalidRuntimeSessionRepair>();
  const deferredBySessionKey = new Map<string, string>();
  const inspectionGraceMs =
    typeof params.activeSessionInspectionGraceMs === "number" &&
    Number.isFinite(params.activeSessionInspectionGraceMs)
      ? Math.max(0, Math.floor(params.activeSessionInspectionGraceMs))
      : ACTIVE_SESSION_INSPECTION_GRACE_MS;
  const staleSessionAgeMs =
    typeof params.staleSessionAgeMs === "number" &&
    Number.isFinite(params.staleSessionAgeMs)
      ? Math.max(0, Math.floor(params.staleSessionAgeMs))
      : 15 * 60 * 1000;
  const currentMs = Date.now();
  const providerCapacityCooldownUntil = new Date(
    currentMs + DEFAULT_PROVIDER_CAPACITY_COOLDOWN_MS
  ).toISOString();

  const buildRepair = (
    reason: string,
    evidence?: unknown
  ): InvalidRuntimeSessionRepair => {
    const capacityFailure = isProviderCapacityFailure(evidence ?? reason);
    return {
      reason,
      capacityFailure,
      cooldownUntil: capacityFailure ? providerCapacityCooldownUntil : null,
    };
  };

  const buildRepairWithTranscriptEvidence = async (input: {
    sessionKey: string;
    reason: string;
    evidence?: unknown;
  }): Promise<InvalidRuntimeSessionRepair> => {
    const transcriptCapacityFailure =
      await inspectRecentSessionProviderCapacity({
        workflowRuntime: params.workflowRuntime,
        sessionKey: input.sessionKey,
        limit: 120,
      });
    if (!transcriptCapacityFailure) {
      return buildRepair(input.reason, input.evidence ?? input.reason);
    }
    return buildRepair(
      `${input.reason} Recent transcript provider capacity failure: ${transcriptCapacityFailure}`,
      transcriptCapacityFailure
    );
  };

  for (const session of sessionsStore.entries) {
    if (session.status !== "active") {
      continue;
    }
    const startedAtMs = parseTimeMs(session.startedAt);
    if (
      inspectionGraceMs > 0 &&
      startedAtMs != null &&
      currentMs - startedAtMs < inspectionGraceMs
    ) {
      continue;
    }
    const isStaleForInspection = isRuntimeSessionStaleForInspection({
      session,
      staleSessionAgeMs,
      currentMs,
    });
    try {
      const inspection = await params.workflowRuntime.inspectSession({
        sessionKey: session.sessionKey,
      });
      if (!inspection) {
        const transcriptCapacityFailure =
          await inspectRecentSessionProviderCapacity({
            workflowRuntime: params.workflowRuntime,
            sessionKey: session.sessionKey,
            limit: 120,
          });
        if (transcriptCapacityFailure) {
          invalidBySessionKey.set(
            session.sessionKey,
            buildRepair(
              `Workflow runtime session hit provider capacity but is missing from the underlying session store: ${transcriptCapacityFailure}`,
              transcriptCapacityFailure
            )
          );
          continue;
        }
        const reason =
          "Workflow runtime session is missing from the underlying session store.";
        invalidBySessionKey.set(session.sessionKey, buildRepair(reason));
        continue;
      }
      const reason = describeInvalidRuntimeSessionInspection(inspection);
      if (reason) {
        invalidBySessionKey.set(
          session.sessionKey,
          await buildRepairWithTranscriptEvidence({
            sessionKey: session.sessionKey,
            reason,
            evidence: inspection.lastError ?? reason,
          })
        );
        continue;
      }
      const activeRunRepair = await probeActiveRuntimeRun({
        workflowRuntime: params.workflowRuntime,
        session,
        inspection,
      });
      if (activeRunRepair) {
        invalidBySessionKey.set(session.sessionKey, activeRunRepair);
      }
    } catch (error) {
      const reason = `Workflow runtime session inspection failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      if (isStaleForInspection) {
        invalidBySessionKey.set(session.sessionKey, buildRepair(reason, error));
      } else {
        deferredBySessionKey.set(session.sessionKey, reason);
      }
    }
  }

  if (deferredBySessionKey.size > 0) {
    await appendWorkflowDiagnosticEvent({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      component: "runtime_maintenance",
      action: "session_inspection_deferred",
      status: "waiting",
      summary:
        "Runtime maintenance deferred missing active session inspection until the session becomes stale.",
      details: {
        deferredSessionKeys: [...deferredBySessionKey.keys()],
        reasons: Object.fromEntries(deferredBySessionKey),
        staleSessionAgeMs,
        activeSessionInspectionGraceMs: inspectionGraceMs,
      },
    });
  }

  if (invalidBySessionKey.size === 0) {
    return {
      repairedSessionKeys: [],
      repairedQueueKeys: [],
    };
  }

  const currentAt = nowIso();
  const queueStoreBeforeRepair = await readWorkflowRuntimeQueueStore(params.projectRoot);
  const queueRepairByQueueKey = new Map<string, InvalidRuntimeSessionRepair>();
  for (const entry of sessionsStore.entries) {
    const repair = invalidBySessionKey.get(entry.sessionKey);
    const queueKey = readString(entry.queueKey);
    if (!repair || !queueKey) {
      continue;
    }
    const existing = queueRepairByQueueKey.get(queueKey);
    if (!existing || (!existing.capacityFailure && repair.capacityFailure)) {
      queueRepairByQueueKey.set(queueKey, repair);
    }
  }
  const invalidQueueKeys = uniqueStrings([...queueRepairByQueueKey.keys()]);

  await updateWorkflowRuntimeSessionsStore({
    projectRoot: params.projectRoot,
    updater: (store) =>
      store.entries.map((entry) => {
        const repair = invalidBySessionKey.get(entry.sessionKey);
        if (!repair) {
          return entry;
        }
        return {
          ...entry,
          status: "needs_repair",
          lastCheckedAt: currentAt,
          lastFinishedAt: entry.lastFinishedAt ?? currentAt,
          lastError: [entry.lastError, repair.reason].filter(Boolean).join(" "),
        };
      }),
  });

  if (invalidQueueKeys.length > 0) {
    await updateWorkflowRuntimeQueueStore({
      projectRoot: params.projectRoot,
      updater: (store) =>
        store.entries.map((entry) => {
          if (
            !invalidQueueKeys.includes(entry.queueKey) ||
            (entry.status !== "running" && entry.status !== "launching")
          ) {
            return entry;
          }
          const repair = queueRepairByQueueKey.get(entry.queueKey);
          return {
            ...entry,
            status: "needs_repair",
            lastCheckedAt: currentAt,
            nextRetryAt: repair?.cooldownUntil ?? entry.nextRetryAt ?? null,
            lastError:
              entry.lastError ??
              repair?.reason ??
              "Linked runtime session is not active in the underlying session store and needs repair.",
          };
        }),
    });
  }

  const capacityRelayQueueKeys: string[] = [];
  for (const [queueKey, repair] of queueRepairByQueueKey.entries()) {
    if (!repair.capacityFailure) {
      continue;
    }
    const queueEntry =
      queueStoreBeforeRepair.entries.find((entry) => entry.queueKey === queueKey) ?? null;
    const sessionEntry =
      sessionsStore.entries.find((entry) => entry.queueKey === queueKey) ?? null;
    capacityRelayQueueKeys.push(queueKey);
    await appendWorkflowLocalOperatorRelay({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      idempotencyKey: `provider-capacity:${queueKey}:${repair.cooldownUntil ?? "unknown"}`,
      queueKey,
      sessionKey: sessionEntry?.sessionKey ?? null,
      ownerAgent: queueEntry?.ownerAgent ?? sessionEntry?.ownerAgent ?? null,
      stage: queueEntry?.dispatchPayload?.stage ?? null,
      kind: "provider_capacity_cooldown",
      summary:
        "Workflow runtime hit provider capacity limits and needs local operator follow-up.",
      reason: repair.reason,
      cooldownUntil: repair.cooldownUntil,
      operatorPrompt: [
        "Continue this AutoResearch workflow locally without Discord.",
        `Project root: ${params.projectRoot}`,
        params.projectId ? `Project id: ${params.projectId}` : null,
        `Queue key: ${queueKey}`,
        sessionEntry?.sessionKey ? `Session key: ${sessionEntry.sessionKey}` : null,
        queueEntry?.summary ? `Transition summary: ${queueEntry.summary}` : null,
        "The provider returned a capacity/quota error. Use configured agent model fallbacks when available; otherwise wait until cooldownUntil before replaying the queued transition.",
      ]
        .filter(Boolean)
        .join("\n"),
      details: {
        source: queueEntry?.source ?? null,
        entryType: queueEntry?.entryType ?? null,
        kind: queueEntry?.kind ?? null,
        family: queueEntry?.family ?? null,
      },
    });
  }

  await appendWorkflowRuntimeEvent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    kind: "runtime_session_inspection_repair",
    summary:
      `Marked ${invalidBySessionKey.size} runtime session(s) and ` +
      `${invalidQueueKeys.length} linked queue entry(s) as needs_repair after session inspection.`,
    details: {
      repairedSessionKeys: [...invalidBySessionKey.keys()],
      repairedQueueKeys: invalidQueueKeys,
      providerCapacityCooldownQueueKeys: capacityRelayQueueKeys,
      providerCapacityCooldownUntil,
    },
  });

  await appendWorkflowDiagnosticEvent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    component: "runtime_maintenance",
    action: "session_inspection_repair",
    status: "waiting",
    summary: "Runtime maintenance marked invalid active sessions as needs_repair after inspecting session liveness.",
    details: {
      repairedSessionKeys: [...invalidBySessionKey.keys()],
      repairedQueueKeys: invalidQueueKeys,
      providerCapacityCooldownQueueKeys: capacityRelayQueueKeys,
      providerCapacityCooldownUntil,
    },
  });

  return {
    repairedSessionKeys: [...invalidBySessionKey.keys()],
    repairedQueueKeys: invalidQueueKeys,
  };
}

async function reactivateRepairSessionsWithLiveRuntime(params: {
  projectRoot: string;
  projectId: string | null;
  workflowRuntime?: WorkflowRuntimeApi;
}): Promise<string[]> {
  if (!params.workflowRuntime?.inspectSession) {
    return [];
  }
  const sessionsStore = await readWorkflowRuntimeSessionsStore(params.projectRoot);
  const queueStore = await readWorkflowRuntimeQueueStore(params.projectRoot);
  const queueByKey = new Map(
    queueStore.entries.map((entry) => [entry.queueKey, entry] as const)
  );
  const reactivatedBySessionKey = new Map<
    string,
    WorkflowExecutionSessionInspection
  >();

  for (const session of sessionsStore.entries) {
    if (session.status !== "needs_repair") {
      continue;
    }
    const queueKey = readString(session.queueKey);
    if (!queueKey) {
      continue;
    }
    const queue = queueByKey.get(queueKey);
    if (!queue || (queue.status !== "running" && queue.status !== "launching")) {
      continue;
    }
    if (isProviderCapacityFailure(session.lastError)) {
      continue;
    }
    try {
      const inspection = await params.workflowRuntime.inspectSession({
        sessionKey: session.sessionKey,
      });
      if (
        !inspection ||
        describeInvalidRuntimeSessionInspection(inspection) ||
        !isUnderlyingRuntimeSessionActive(inspection)
      ) {
        continue;
      }
      reactivatedBySessionKey.set(session.sessionKey, inspection);
    } catch {
      continue;
    }
  }

  if (reactivatedBySessionKey.size === 0) {
    return [];
  }

  const currentAt = nowIso();
  await updateWorkflowRuntimeSessionsStore({
    projectRoot: params.projectRoot,
    updater: (store) =>
      store.entries.map((entry) => {
        const inspection = reactivatedBySessionKey.get(entry.sessionKey);
        if (!inspection) {
          return entry;
        }
        return {
          ...entry,
          sessionId: inspection.sessionId ?? entry.sessionId,
          status: "active",
          lastHeartbeatAt: currentAt,
          lastCheckedAt: currentAt,
          lastFinishedAt: null,
          lastError: null,
        };
      }),
  });

  const reactivatedSessionKeys = [...reactivatedBySessionKey.keys()];
  await appendWorkflowDiagnosticEvent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    component: "runtime_maintenance",
    action: "repair_session_reactivated_from_live_runtime",
    status: "completed",
    summary:
      "Runtime maintenance reactivated repair-marked sessions because the underlying runtime session is still active.",
    details: {
      reactivatedSessionKeys,
    },
  });
  await appendWorkflowRuntimeEvent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    kind: "runtime_repair_session_reactivated",
    summary:
      `Reactivated ${reactivatedSessionKeys.length} repair-marked runtime session(s) ` +
      "after confirming live runtime activity.",
    details: {
      reactivatedSessionKeys,
    },
  });

  return reactivatedSessionKeys;
}

async function markLinkedQueuesNeedsRepairForRepairSessions(params: {
  projectRoot: string;
  projectId: string | null;
}): Promise<string[]> {
  const sessionsStore = await readWorkflowRuntimeSessionsStore(params.projectRoot);
  const reasonsByQueueKey = new Map<string, string>();
  for (const session of sessionsStore.entries) {
    if (session.status !== "needs_repair") {
      continue;
    }
    const queueKey = readString(session.queueKey);
    if (!queueKey) {
      continue;
    }
    reasonsByQueueKey.set(
      queueKey,
      session.lastError ??
        "Linked runtime session needs repair before the workflow transition can continue."
    );
  }
  if (reasonsByQueueKey.size === 0) {
    return [];
  }

  const currentAt = nowIso();
  const markedQueueKeys: string[] = [];
  await updateWorkflowRuntimeQueueStore({
    projectRoot: params.projectRoot,
    updater: (store) =>
      store.entries.map((entry) => {
        const reason = reasonsByQueueKey.get(entry.queueKey);
        if (
          !reason ||
          (entry.status !== "running" && entry.status !== "launching")
        ) {
          return entry;
        }
        markedQueueKeys.push(entry.queueKey);
        return {
          ...entry,
          status: "needs_repair",
          lastCheckedAt: currentAt,
          lastError: entry.lastError ?? reason,
        };
      }),
  });

  const uniqueQueueKeys = uniqueStrings(markedQueueKeys);
  if (uniqueQueueKeys.length > 0) {
    await appendWorkflowDiagnosticEvent({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      component: "runtime_maintenance",
      action: "linked_queue_repair_marked",
      status: "waiting",
      summary:
        "Runtime maintenance marked running queue entries as needs_repair because their linked sessions need repair.",
      details: {
        repairedQueueKeys: uniqueQueueKeys,
      },
    });
  }
  return uniqueQueueKeys;
}

async function readProjectRepairTopic(projectRoot: string): Promise<string> {
  const manifest = await readJsonIfExists<Record<string, unknown>>(
    path.join(projectRoot, "PROJECT_MANIFEST.json")
  );
  return (
    readString(manifest?.title) ??
    readString(manifest?.topic) ??
    readString(manifest?.research_topic) ??
    path.basename(path.resolve(projectRoot))
  );
}

function buildBackgroundRepairCommand(params: {
  session: WorkflowRuntimeSessionEntry;
  projectRoot: string;
  projectId: string | null;
  topic: string;
}): string | null {
  const kind = readString(params.session.kind) ?? "generic";
  const quotedTopic = JSON.stringify(params.topic);
  const header =
    kind === "research_pipeline"
      ? `/research-pipeline ${quotedTopic}`
      : kind === "research_queue"
        ? `/research-queue ${quotedTopic}`
        : kind === "graph_build"
          ? "/graph-build"
          : kind === "idle_research"
            ? `/idle-research ${quotedTopic}`
            : null;
  if (!header) {
    return null;
  }
  return [
    header,
    "",
    "Workflow runtime repair replay.",
    params.projectId ? `Project ID: ${params.projectId}` : null,
    `Project root: ${params.projectRoot}`,
    "Continue this no-Discord AutoResearch project from the durable workflow state.",
    "Read PROJECT_MANIFEST.json and .openclaw-research runtime files first; do not create a new project.",
    "Resolve the current missing workflow stage signals and persist progress through research_workflow tools.",
    "__BACKGROUND_CONTINUATION__: true",
  ]
    .filter(Boolean)
    .join("\n");
}

async function restoreMissingQueueEntriesForRepairSessions(params: {
  projectRoot: string;
  projectId: string | null;
}): Promise<string[]> {
  const [sessionsStore, queueStore] = await Promise.all([
    readWorkflowRuntimeSessionsStore(params.projectRoot),
    readWorkflowRuntimeQueueStore(params.projectRoot),
  ]);
  const existingQueueKeys = new Set(
    queueStore.entries.map((entry) => entry.queueKey)
  );
  const topic = await readProjectRepairTopic(params.projectRoot);
  const currentAt = nowIso();
  const restoredEntries: WorkflowRuntimeQueueEntry[] = [];

  for (const session of sessionsStore.entries) {
    if (session.status !== "needs_repair") {
      continue;
    }
    const queueKey = readString(session.queueKey);
    if (!queueKey || existingQueueKeys.has(queueKey)) {
      continue;
    }
    const ownerAgent =
      readString(session.ownerAgent) ??
      readString(session.agentId) ??
      readString(session.role) ??
      "researcher";
    const requesterSessionKey =
      readString(session.requesterSessionKey) ??
      readString(session.parentSessionKey) ??
      `agent:${ownerAgent}:main`;
    const channelKey =
      readString(session.channelKey) ??
      readString(session.threadBindingKey) ??
      requesterSessionKey;
    const message = buildBackgroundRepairCommand({
      session,
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      topic,
    });
    if (!message) {
      continue;
    }
    restoredEntries.push({
      transitionId: `${queueKey}:restored`,
      queueId: `${queueKey}:restored`,
      queueKey,
      source: "runtime_orphan_repair",
      entryType: "background_run",
      ownerAgent,
      channelKey,
      requesterSessionKey,
      messageChannel: null,
      preferredSessionKey: requesterSessionKey,
      family: readString(session.family) ?? "research",
      kind: readString(session.kind) ?? "generic",
      projectId: params.projectId,
      projectRoot: params.projectRoot,
      queuedAt: readString(session.startedAt) ?? currentAt,
      lastAttemptedAt:
        readString(session.lastCheckedAt) ??
        readString(session.lastHeartbeatAt) ??
        readString(session.startedAt),
      lastCheckedAt: currentAt,
      nextRetryAt: null,
      attemptCount: 1,
      summary:
        session.lastError ??
        `Restored missing workflow transition ${queueKey} from repair session metadata.`,
      status: "needs_repair",
      fallbackMode: null,
      lastError:
        session.lastError ??
        "Linked runtime session needed repair after its queue transition was missing.",
      parentSessionKey: requesterSessionKey,
      threadBindingKey: readString(session.threadBindingKey),
      depth: Math.max(0, session.depth ?? 0),
      runPayload: {
        message,
        lane: "nested",
        deliver: false,
        idempotencyKey: `workflow-orphan-repair:${queueKey}`,
        extraSystemPrompt:
          "This is an automatic local recovery replay. Stay bounded to the current project and update durable workflow state before finishing.",
      },
      dispatchPayload: null,
    });
    existingQueueKeys.add(queueKey);
  }

  if (restoredEntries.length === 0) {
    return [];
  }

  await updateWorkflowRuntimeQueueStore({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    updater: (store) => {
      const currentKeys = new Set(store.entries.map((entry) => entry.queueKey));
      return [
        ...store.entries,
        ...restoredEntries.filter((entry) => !currentKeys.has(entry.queueKey)),
      ];
    },
  });

  const restoredQueueKeys = restoredEntries.map((entry) => entry.queueKey);
  await appendWorkflowRuntimeEvent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    kind: "runtime_missing_queue_restored",
    summary:
      `Restored ${restoredQueueKeys.length} missing workflow transition(s) ` +
      "from repair session metadata.",
    details: {
      restoredQueueKeys,
    },
  });
  await appendWorkflowDiagnosticEvent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    component: "runtime_maintenance",
    action: "missing_queue_restored",
    status: "waiting",
    summary:
      "Runtime maintenance restored missing queue entries from repair session metadata.",
    details: {
      restoredQueueKeys,
    },
  });
  return restoredQueueKeys;
}

function toDispatchableRole(value: unknown): DispatchableWorkflowRole {
  const normalized = readString(value)?.toLowerCase();
  switch (normalized) {
    case "planner":
    case "orchestrator":
    case "coder":
    case "analyzer":
    case "academic_writer":
    case "reviewer":
    case "cross-reviewer":
    case "researcher":
      return normalized;
    default:
      return "researcher";
  }
}

async function updateQueueEntry(
  projectRoot: string,
  queueKey: string,
  updater: (entry: WorkflowRuntimeQueueEntry) => WorkflowRuntimeQueueEntry
): Promise<WorkflowRuntimeQueueEntry | null> {
  let updatedEntry: WorkflowRuntimeQueueEntry | null = null;
  await updateWorkflowRuntimeQueueStore({
    projectRoot,
    updater: (store) => {
      const index = store.entries.findIndex((entry) => entry.queueKey === queueKey);
      if (index < 0) {
        return store.entries;
      }
      const nextEntries = [...store.entries];
      nextEntries[index] = updater(nextEntries[index]);
      updatedEntry = nextEntries[index];
      return nextEntries;
    },
  });
  return updatedEntry;
}

async function updateSessions(
  projectRoot: string,
  updater: (entry: WorkflowRuntimeSessionEntry) => WorkflowRuntimeSessionEntry
): Promise<WorkflowRuntimeSessionEntry[]> {
  let nextEntriesSnapshot: WorkflowRuntimeSessionEntry[] = [];
  await updateWorkflowRuntimeSessionsStore({
    projectRoot,
    updater: (store) => {
      nextEntriesSnapshot = store.entries.map(updater);
      return nextEntriesSnapshot;
    },
  });
  return nextEntriesSnapshot;
}

async function markQueueFailed(params: {
  projectRoot: string;
  projectId: string | null;
  entry: WorkflowRuntimeQueueEntry;
  error: string;
}) {
  return updateQueueEntry(params.projectRoot, params.entry.queueKey, (entry) => ({
    ...entry,
    status: "failed",
    lastAttemptedAt: nowIso(),
    lastCheckedAt: nowIso(),
    nextRetryAt: null,
    lastError: params.error,
  }));
}

async function markQueueProviderCapacityCooldown(params: {
  projectRoot: string;
  projectId: string | null;
  entry: WorkflowRuntimeQueueEntry;
  error: string;
  nextRetryAt?: string | null;
  relaySummary: string;
  relayPromptTail: string;
}): Promise<string> {
  const nextRetryAt = params.nextRetryAt ?? buildProviderCapacityCooldownUntil();
  await updateQueueEntry(params.projectRoot, params.entry.queueKey, (entry) => ({
    ...entry,
    status: "needs_repair",
    lastCheckedAt: nowIso(),
    nextRetryAt,
    lastError: params.error,
  }));
  await appendWorkflowLocalOperatorRelay({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    idempotencyKey: `provider-capacity:${params.entry.queueKey}:${nextRetryAt}`,
    queueKey: params.entry.queueKey,
    sessionKey:
      params.entry.preferredSessionKey ?? params.entry.requesterSessionKey,
    ownerAgent: params.entry.ownerAgent,
    stage: params.entry.dispatchPayload?.stage ?? null,
    kind: "provider_capacity_cooldown",
    summary: params.relaySummary,
    reason: params.error,
    cooldownUntil: nextRetryAt,
    operatorPrompt: [
      "Continue this AutoResearch workflow locally without Discord.",
      `Project root: ${params.projectRoot}`,
      params.projectId ? `Project id: ${params.projectId}` : null,
      `Queue key: ${params.entry.queueKey}`,
      params.entry.summary ? `Transition summary: ${params.entry.summary}` : null,
      params.relayPromptTail,
    ]
      .filter(Boolean)
      .join("\n"),
    details: {
      source: params.entry.source,
      entryType: params.entry.entryType,
      kind: params.entry.kind,
      family: params.entry.family,
    },
  });
  return nextRetryAt;
}

async function normalizeProviderCapacityQueueFailures(params: {
  projectRoot: string;
  projectId: string | null;
}): Promise<string[]> {
  const queueStore = await readWorkflowRuntimeQueueStore(params.projectRoot);
  const capacityFailures = queueStore.entries.filter(
    (entry) =>
      entry.status === "failed" && isProviderCapacityFailure(entry.lastError)
  );
  const cooledDownQueueKeys: string[] = [];
  for (const entry of capacityFailures) {
    const error =
      entry.lastError ??
      "Workflow runtime repair hit provider capacity limits.";
    await markQueueProviderCapacityCooldown({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      entry,
      error,
      nextRetryAt: entry.nextRetryAt ?? null,
      relaySummary:
        "Workflow runtime failure was converted to a provider capacity cooldown.",
      relayPromptTail:
        "The provider returned a capacity/quota error before this queue entry reached a durable terminal state. Wait until cooldownUntil, then let runtime maintenance replay the queued transition.",
    });
    cooledDownQueueKeys.push(entry.queueKey);
  }
  if (cooledDownQueueKeys.length > 0) {
    await appendWorkflowDiagnosticEvent({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      component: "runtime_maintenance",
      action: "provider_capacity_failed_queue_recovered",
      status: "waiting",
      summary:
        "Runtime maintenance converted failed provider-capacity queue entries back to cooldown repair state.",
      details: {
        queueKeys: cooledDownQueueKeys,
      },
    });
  }
  return cooledDownQueueKeys;
}

async function markLinkedSessionsFailed(params: {
  projectRoot: string;
  queueKey: string;
  error: string;
}) {
  const currentAt = nowIso();
  await updateSessions(params.projectRoot, (entry) => {
    if (entry.queueKey !== params.queueKey) {
      return entry;
    }
    return {
      ...entry,
      status: "failed",
      lastCheckedAt: currentAt,
      lastFinishedAt: entry.lastFinishedAt ?? currentAt,
      lastError: params.error,
    };
  });
}

async function markSessionFailed(params: {
  projectRoot: string;
  sessionKey: string;
  error: string;
}) {
  const currentAt = nowIso();
  await updateSessions(params.projectRoot, (entry) => {
    if (entry.sessionKey !== params.sessionKey) {
      return entry;
    }
    return {
      ...entry,
      status: "failed",
      lastCheckedAt: currentAt,
      lastFinishedAt: entry.lastFinishedAt ?? currentAt,
      lastError: params.error,
    };
  });
}

async function reconcileSupersededRepairSessions(params: {
  projectRoot: string;
  queueKey: string;
  survivorSessionKey: string | null;
}) {
  const currentAt = nowIso();
  await updateSessions(params.projectRoot, (entry) => {
    if (entry.queueKey !== params.queueKey) {
      return entry;
    }
    if (params.survivorSessionKey && entry.sessionKey === params.survivorSessionKey) {
      return entry;
    }
    if (entry.status !== "needs_repair") {
      return entry;
    }
    return {
      ...entry,
      status: "failed",
      lastCheckedAt: currentAt,
      lastFinishedAt: entry.lastFinishedAt ?? currentAt,
      lastError:
        entry.lastError ??
        "Superseded by a newer repaired workflow transition session.",
    };
  });
}

function buildPreferredSessionKeys(
  entry: WorkflowRuntimeQueueEntry,
  dispatchPayload: WorkflowRuntimeQueueDispatchPayload
): string[] {
  return uniqueStrings([
    entry.preferredSessionKey,
    ...dispatchPayload.preferredSessionKeys,
  ]);
}

async function replayQueueEntry(params: {
  entry: WorkflowRuntimeQueueEntry;
  workflowRuntime?: WorkflowRuntimeApi;
  workflowPolicy?: WorkflowPolicyLike;
  logger?: LoggerLike;
}) {
  if (!params.workflowRuntime) {
    return {
      launched: false,
      error: "Workflow execution runtime is unavailable for workflow repair.",
      sessionKey: null,
    };
  }
  const entry = params.entry;
  const dispatchPayload = entry.dispatchPayload;
  const preferredSessionKeys =
    dispatchPayload != null ? buildPreferredSessionKeys(entry, dispatchPayload) : [];
  const resumed = await resumeWorkflowTransition({
    projectRoot: String(entry.projectRoot),
    projectId: entry.projectId,
    queueKey: entry.queueKey,
    spawn: async () => {
      if (entry.entryType === "background_run") {
        const runPayload = entry.runPayload;
        const sessionKey =
          readString(entry.preferredSessionKey) ??
          readString(entry.requesterSessionKey) ??
          `agent:${entry.ownerAgent}:main`;
        if (!runPayload?.message) {
          throw new Error("Background workflow repair is missing a durable run payload.");
        }
        const started = await params.workflowRuntime!.run({
          sessionKey,
          message: runPayload.message,
          lane: runPayload.lane,
          deliver: runPayload.deliver,
          idempotencyKey:
            runPayload.idempotencyKey ??
            `workflow-repair:${entry.queueKey}:${Date.now()}`,
          extraSystemPrompt: runPayload.extraSystemPrompt ?? undefined,
          projectRoot: entry.projectRoot,
          projectId: entry.projectId,
          ownerAgent: entry.ownerAgent,
          requesterSessionKey: entry.requesterSessionKey,
          messageChannel: entry.messageChannel,
          workspaceDir: entry.projectRoot,
        });
        return {
          runId: started.runId,
          sessionKey,
          sessionId: started.sessionId ?? null,
          runtime:
            started.runtime ??
            params.workflowRuntime!.runtimeKind ??
            "subagent",
          role: entry.ownerAgent,
          agentId: entry.ownerAgent,
          ownerAgent: entry.ownerAgent,
          parentSessionKey: entry.requesterSessionKey,
          depth: entry.depth,
        };
      }

      if (!dispatchPayload) {
        throw new Error("Workflow repair is missing a durable dispatch payload.");
      }

      const dispatch = dispatchPayload.useWorkflowHandoff
        ? await handoffWorkflowTaskToAgent({
            workflowRuntime: params.workflowRuntime,
            workflowPolicy: params.workflowPolicy ?? undefined,
            requesterSessionKey: entry.requesterSessionKey,
            requesterChannel: dispatchPayload.requesterChannel ?? undefined,
            requesterAccountId: dispatchPayload.requesterAccountId ?? undefined,
            preferredSessionKeys,
            fromRole: dispatchPayload.fromRole,
            toRole: toDispatchableRole(dispatchPayload.toRole),
            projectRoot: dispatchPayload.projectRoot,
            projectId: dispatchPayload.projectId,
            stage: dispatchPayload.stage,
            summary: dispatchPayload.summary,
            command: dispatchPayload.command,
            mailboxMessageId: dispatchPayload.mailboxMessageId,
            requireMailboxAcknowledgement:
              dispatchPayload.requireMailboxAcknowledgement,
            extraBody: dispatchPayload.extraBody,
            waitTimeoutMs: dispatchPayload.waitTimeoutMs ?? undefined,
            retryOnTimeout: dispatchPayload.retryOnTimeout,
            enableSpawnFallback: dispatchPayload.enableSpawnFallback,
            autoModeActive: dispatchPayload.autoModeActive,
            logger: params.logger,
          })
        : await dispatchWorkflowTaskToAgent({
            workflowRuntime: params.workflowRuntime,
            requesterSessionKey: entry.requesterSessionKey,
            requesterChannel: dispatchPayload.requesterChannel ?? undefined,
            preferredSessionKeys,
            fromRole: dispatchPayload.fromRole,
            toRole: toDispatchableRole(dispatchPayload.toRole),
            projectRoot: dispatchPayload.projectRoot,
            projectId: dispatchPayload.projectId,
            stage: dispatchPayload.stage,
            summary: dispatchPayload.summary,
            command: dispatchPayload.command,
            mailboxMessageId: dispatchPayload.mailboxMessageId,
            requireMailboxAcknowledgement:
              dispatchPayload.requireMailboxAcknowledgement,
            extraBody: dispatchPayload.extraBody,
            waitTimeoutMs: dispatchPayload.waitTimeoutMs ?? undefined,
            retryOnTimeout: dispatchPayload.retryOnTimeout,
            enableSpawnFallback: dispatchPayload.enableSpawnFallback,
          });
      const dispatchRunId = resolveWorkflowDispatchLaunchRunId(dispatch);
      if (!dispatch.dispatched || !dispatchRunId || !dispatch.sessionKey) {
        throw new Error(dispatch.error ?? "Workflow repair dispatch did not start.");
      }
      return {
        runId: dispatchRunId,
        sessionKey: dispatch.sessionKey,
        runtime:
          dispatch.channel === "sessions_spawn" || dispatch.channel === "sessions_send"
            ? params.workflowRuntime!.runtimeKind ?? "subagent"
            : "legacy_dispatch",
        role: dispatchPayload.toRole,
        agentId: dispatchPayload.toRole,
        ownerAgent: entry.ownerAgent,
        strategy: dispatch.strategy ?? "workflow_dispatch",
        parentSessionKey: entry.requesterSessionKey,
        depth: entry.depth,
      };
    },
  });
  return {
    launched: resumed.launched,
    error: resumed.error,
    sessionKey: resumed.sessionKey,
  };
}

function computeResetAckDeadlineAt(params: {
  fallbackAfterMs: number | null;
}): string | null {
  if (
    typeof params.fallbackAfterMs === "number" &&
    Number.isFinite(params.fallbackAfterMs) &&
    params.fallbackAfterMs > 0
  ) {
    return new Date(Date.now() + Math.floor(params.fallbackAfterMs)).toISOString();
  }
  return null;
}

async function syncQueuedHandoffIntentAfterReplay(params: {
  projectRoot: string;
  queueKey: string;
  sessionKey: string | null;
}): Promise<void> {
  if (!params.queueKey.startsWith("handoff:")) {
    return;
  }
  const intentId = params.queueKey.slice("handoff:".length);
  const intent = await findWorkflowHandoffIntent({
    projectRoot: params.projectRoot,
    intentId,
  });
  if (!intent) {
    return;
  }
  await transitionWorkflowHandoffIntent({
    projectRoot: params.projectRoot,
    intentId,
    toStatus: "dispatched",
    patch: {
      toSessionKey: params.sessionKey ?? intent.toSessionKey,
      deliveryPlan: {
        ...intent.deliveryPlan,
        ackDeadlineAt: computeResetAckDeadlineAt({
          fallbackAfterMs: intent.deliveryPlan.fallbackAfterMs,
        }),
      },
    },
    summary:
      "Runtime maintenance replay dispatched the queued handoff and reset the acknowledgement deadline.",
  });
}

async function supersedeQueuedHandoffIntent(params: {
  projectRoot: string;
  queueKey: string;
  summary: string;
}): Promise<void> {
  if (!params.queueKey.startsWith("handoff:")) {
    return;
  }
  const intentId = params.queueKey.slice("handoff:".length);
  const intent = await findWorkflowHandoffIntent({
    projectRoot: params.projectRoot,
    intentId,
  });
  if (!intent || intent.status === "superseded") {
    return;
  }
  await transitionWorkflowHandoffIntent({
    projectRoot: params.projectRoot,
    intentId,
    toStatus: "superseded",
    summary: params.summary,
  });
}

async function recordBroadcastFailures(params: {
  projectRoot: string;
  projectId: string | null;
  failedBroadcasts: WorkflowRuntimeBroadcastEntry[];
}): Promise<WorkflowRuntimeIncidentEntry[]> {
  const incidents: WorkflowRuntimeIncidentEntry[] = [];
  for (const entry of params.failedBroadcasts) {
    incidents.push(
      await recordWorkflowRuntimeIncident({
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        idempotencyKey: `broadcast:${entry.idempotencyKey}`,
        kind: "broadcast_delivery_failed",
        severity: "warning",
        summary: `Workflow runtime broadcast ${entry.status} could not be delivered.`,
        sessionKey: entry.sessionKey,
        error: entry.lastError,
        details: {
          broadcastId: entry.broadcastId,
          stage: entry.stage,
          deliveryStatus: entry.deliveryStatus,
        },
      })
    );
  }
  return incidents;
}

export async function runWorkflowRuntimeMaintenancePass(params: {
  projectRoot: string;
  projectId?: string | null;
  staleSessionAgeMs?: number;
  activeSessionInspectionGraceMs?: number;
  maxRepairAttempts?: number;
  workflowRuntime?: WorkflowRuntimeApi;
  workflowPolicy?: WorkflowPolicyLike;
  logger?: LoggerLike;
  sendBroadcast?: (entry: WorkflowRuntimeBroadcastEntry) => Promise<{
    runId: string;
    sessionKey?: string | null;
  }>;
}): Promise<WorkflowRuntimeMaintenanceResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const projectId = readString(params.projectId) ?? path.basename(projectRoot);
  const maxRepairAttempts =
    typeof params.maxRepairAttempts === "number" && Number.isFinite(params.maxRepairAttempts)
      ? Math.max(1, Math.floor(params.maxRepairAttempts))
      : 3;
  await appendWorkflowDiagnosticEvent({
    projectRoot,
    projectId,
    component: "runtime_maintenance",
    action: "maintenance_started",
    status: "started",
    summary: "Runtime maintenance pass started.",
    details: {
      maxRepairAttempts,
      staleSessionAgeMs:
        typeof params.staleSessionAgeMs === "number" && Number.isFinite(params.staleSessionAgeMs)
          ? params.staleSessionAgeMs
          : null,
      activeSessionInspectionGraceMs:
        typeof params.activeSessionInspectionGraceMs === "number" &&
        Number.isFinite(params.activeSessionInspectionGraceMs)
          ? Math.max(0, Math.floor(params.activeSessionInspectionGraceMs))
          : ACTIVE_SESSION_INSPECTION_GRACE_MS,
      hasWorkflowRuntime: Boolean(params.workflowRuntime),
    },
  });

  const recovery = await recoverWorkflowRuntimeState({
    projectRoot,
    projectId,
    staleSessionAgeMs: params.staleSessionAgeMs,
    workflowPolicy: params.workflowPolicy ?? undefined,
    sendBroadcast: params.sendBroadcast,
  });
  const handoffMaintenance = await runWorkflowHandoffMaintenancePass({
    projectRoot,
  });
  const manifest = await readJsonIfExists<Record<string, unknown>>(
    path.join(projectRoot, "PROJECT_MANIFEST.json")
  );
  const currentStage = readString(manifest?.current_stage);
  const currentOwner = readString(manifest?.owner_agent);
  const orchestrationState = readRecord(manifest?.orchestration_state);
  const pendingHandoffId = readString(
    orchestrationState?.pending_handoff_id ?? orchestrationState?.pendingHandoffId
  );
  const paperIngestion =
    manifest?.paper_ingestion &&
    typeof manifest.paper_ingestion === "object" &&
    !Array.isArray(manifest.paper_ingestion)
      ? (manifest.paper_ingestion as Record<string, unknown>)
      : null;
  const retryStatus = readString(
    paperIngestion?.retry_status ?? paperIngestion?.retryStatus
  );
  const retryableFailuresRaw =
    paperIngestion?.retryable_failed_papers ?? paperIngestion?.retryableFailedPapers;
  const retryableFailures: unknown[] = Array.isArray(retryableFailuresRaw)
    ? retryableFailuresRaw
    : [];
  if (
    retryableFailures.length > 0 &&
    ["failed", "terminal", "completed_with_failures", "exhausted"].includes(
      retryStatus ?? ""
    )
  ) {
    await routeWorkflowFailure({
      projectRoot,
      projectId,
      workflowLine: manifest?.workflow_line === "survey" ? "survey" : "experiment",
      stage: readString(manifest?.current_stage),
      originalOwner: readString(manifest?.owner_agent),
      failureKind: "paper_ingestion_failed",
      failureReason: `PaperNexus retry terminal state still has ${retryableFailures.length} retryable failure(s).`,
      verificationRule: "paper_ingestion_retry_terminal",
    });
  }

  const incidents = await recordBroadcastFailures({
    projectRoot,
    projectId,
    failedBroadcasts: recovery.broadcast.failed,
  });

  const sessionInspectionRepair = await repairInvalidActiveRuntimeSessions({
    projectRoot,
    projectId,
    workflowRuntime: params.workflowRuntime,
    activeSessionInspectionGraceMs: params.activeSessionInspectionGraceMs,
    staleSessionAgeMs: params.staleSessionAgeMs,
  });
  await reactivateRepairSessionsWithLiveRuntime({
    projectRoot,
    projectId,
    workflowRuntime: params.workflowRuntime,
  });
  await markLinkedQueuesNeedsRepairForRepairSessions({
    projectRoot,
    projectId,
  });
  await restoreMissingQueueEntriesForRepairSessions({
    projectRoot,
    projectId,
  });
  await reconcileTerminalPaperIngestionRequestsWithRuntimeQueue({
    projectRoot,
    projectId,
  });
  const recoveredProviderCapacityQueueKeys =
    await normalizeProviderCapacityQueueFailures({
      projectRoot,
      projectId,
    });
  const paperIngestionMaintenance =
    await markStalePaperIngestionRequestsNeedsRepair({
      projectRoot,
      projectId,
      activeSessionInspectionGraceMs: params.activeSessionInspectionGraceMs,
    });

  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  const replayCandidates = queueStore.entries.filter(
    (entry) =>
      entry.status === "needs_repair" ||
      entry.status === "degraded" ||
      (entry.status === "queued" &&
        entry.entryType === "dispatch_task" &&
        entry.queueKey.startsWith("handoff:"))
  );
  const replayedQueueKeys: string[] = [];
  const exhaustedQueueKeys: string[] = [];
  const cooldownQueueKeys: string[] = [...recoveredProviderCapacityQueueKeys];

  for (const entry of replayCandidates) {
    const retryDelayMs = getQueueRetryDelayMs(entry, Date.now());
    if (retryDelayMs > 0) {
      cooldownQueueKeys.push(entry.queueKey);
      await appendWorkflowDiagnosticEvent({
        projectRoot,
        projectId,
        component: "runtime_maintenance",
        action: "repair_replay_deferred_until_retry_at",
        status: "waiting",
        summary:
          "Runtime maintenance deferred workflow repair replay until the queue retry cooldown expires.",
        details: {
          queueKey: entry.queueKey,
          nextRetryAt: entry.nextRetryAt ?? null,
          retryDelayMs,
          lastError: entry.lastError ?? null,
        },
      });
      continue;
    }
    const bindingGate = await evaluateChannelProjectBindingGate({
      policy: params.workflowPolicy ?? undefined,
      context: {
        sessionKey:
          readString(entry.requesterSessionKey) ??
          readString(entry.preferredSessionKey) ??
          undefined,
        channelKey: readString(entry.channelKey) ?? undefined,
        messageChannel: readString(entry.messageChannel) ?? undefined,
      },
      projectRoot,
      projectId,
      sessionKey:
        readString(entry.requesterSessionKey) ??
        readString(entry.preferredSessionKey),
      allowSessionProjectFallback: true,
      allowSessionFallbackOnBindingMismatch: false,
    });
    if (!bindingGate.allowed) {
      const error = [
        `Workflow transition ${entry.queueKey} was superseded by the current channel binding gate.`,
        `gate_reason=${bindingGate.reason}`,
        bindingGate.currentBinding?.projectId
          ? `bound_project=${bindingGate.currentBinding.projectId}`
          : null,
        bindingGate.currentBinding?.projectRoot
          ? `bound_root=${bindingGate.currentBinding.projectRoot}`
          : null,
      ]
        .filter(Boolean)
        .join(" ");
      await markQueueFailed({
        projectRoot,
        projectId,
        entry,
        error,
      });
      await markLinkedSessionsFailed({
        projectRoot,
        queueKey: entry.queueKey,
        error,
      });
      exhaustedQueueKeys.push(entry.queueKey);
      incidents.push(
        await recordWorkflowRuntimeIncident({
          projectRoot,
          projectId,
          idempotencyKey: `binding-gate:${entry.queueKey}`,
          kind: "binding_gate_mismatch",
          severity: "warning",
          summary:
            "Workflow repair replay was suppressed because the current channel binding points elsewhere.",
          queueKey: entry.queueKey,
          sessionKey: entry.requesterSessionKey,
          error,
          details: {
            gateReason: bindingGate.reason,
            expectedProjectRoot: projectRoot,
            boundProjectRoot: bindingGate.currentBinding?.projectRoot ?? null,
            boundProjectId: bindingGate.currentBinding?.projectId ?? null,
          },
        })
      );
      continue;
    }
    if (
      isDispatchEntrySupersededByProjectRouting({
        entry,
        currentStage,
        currentOwner,
        pendingHandoffId,
      })
    ) {
      const error = buildDispatchSupersededByProjectRoutingReason({
        queueKey: entry.queueKey,
        dispatchStage: readString(entry.dispatchPayload?.stage),
        dispatchOwner: readString(entry.dispatchPayload?.toRole),
        currentStage,
        currentOwner,
      });
      await markQueueFailed({
        projectRoot,
        projectId,
        entry,
        error,
      });
      await markLinkedSessionsFailed({
        projectRoot,
        queueKey: entry.queueKey,
        error,
      });
      await supersedeQueuedHandoffIntent({
        projectRoot,
        queueKey: entry.queueKey,
        summary:
          "Runtime maintenance superseded the queued handoff because the live project stage/owner moved on.",
      });
      exhaustedQueueKeys.push(entry.queueKey);
      incidents.push(
        await recordWorkflowRuntimeIncident({
          projectRoot,
          projectId,
          idempotencyKey: `routing-superseded:${entry.queueKey}`,
          kind: "queue_exhausted",
          severity: "warning",
          summary:
            "Runtime maintenance retired a stale dispatch after project routing advanced.",
          queueKey: entry.queueKey,
          sessionKey: entry.requesterSessionKey,
          error,
          details: {
            currentStage,
            currentOwner,
            queuedStage: readString(entry.dispatchPayload?.stage),
            queuedOwner: readString(entry.dispatchPayload?.toRole),
          },
        })
      );
      continue;
    }

    const entryCapacityFailure = isProviderCapacityFailure(entry.lastError);
    if (entryCapacityFailure && parseTimeMs(entry.nextRetryAt) == null) {
      await markQueueProviderCapacityCooldown({
        projectRoot,
        projectId,
        entry,
        error:
          entry.lastError ??
          "Workflow runtime repair hit provider capacity limits.",
        relaySummary:
          "Workflow runtime repair is waiting for provider capacity cooldown.",
        relayPromptTail:
          "The provider returned a capacity/quota error. Use configured agent model fallbacks when available; otherwise wait until cooldownUntil before replaying the queued transition.",
      });
      cooldownQueueKeys.push(entry.queueKey);
      continue;
    }

    if (entry.attemptCount >= maxRepairAttempts && !entryCapacityFailure) {
      const error =
        entry.lastError ??
        `Workflow transition exhausted the repair budget (${maxRepairAttempts}).`;
      await markQueueFailed({
        projectRoot,
        projectId,
        entry,
        error,
      });
      await markLinkedSessionsFailed({
        projectRoot,
        queueKey: entry.queueKey,
        error,
      });
      exhaustedQueueKeys.push(entry.queueKey);
      incidents.push(
        await recordWorkflowRuntimeIncident({
          projectRoot,
          projectId,
          idempotencyKey: `repair-exhausted:${entry.queueKey}`,
          kind: "repair_exhausted",
          severity: "error",
          summary: `Workflow transition ${entry.queueKey} exhausted the repair budget.`,
          queueKey: entry.queueKey,
          error,
          details: {
            attemptCount: entry.attemptCount,
            maxRepairAttempts,
            source: entry.source,
            kind: entry.kind,
          },
        })
      );
      continue;
    }

    const replay = await replayQueueEntry({
      entry,
      workflowRuntime: params.workflowRuntime,
      workflowPolicy: params.workflowPolicy,
      logger: params.logger,
    });
    if (replay.launched) {
      replayedQueueKeys.push(entry.queueKey);
      await syncQueuedHandoffIntentAfterReplay({
        projectRoot,
        queueKey: entry.queueKey,
        sessionKey: replay.sessionKey,
      });
      await reconcileSupersededRepairSessions({
        projectRoot,
        queueKey: entry.queueKey,
        survivorSessionKey: replay.sessionKey,
      });
      continue;
    }

    const refreshedStore = await readWorkflowRuntimeQueueStore(projectRoot);
    const refreshedEntry =
      refreshedStore.entries.find((candidate) => candidate.queueKey === entry.queueKey) ?? entry;
    const exhausted = refreshedEntry.attemptCount >= maxRepairAttempts;
    const error =
      readString(replay.error) ??
      refreshedEntry.lastError ??
      "Workflow runtime repair replay failed.";
    const capacityReplayFailure = isProviderCapacityFailure(error);
    if (capacityReplayFailure) {
      await markQueueProviderCapacityCooldown({
        projectRoot,
        projectId,
        entry: refreshedEntry,
        error,
        relaySummary:
          "Workflow repair replay hit provider capacity limits and needs local operator follow-up.",
        relayPromptTail:
          "The repair replay failed with a provider capacity/quota error. Use configured agent model fallbacks when available; otherwise wait until cooldownUntil before replaying this queued transition.",
      });
      cooldownQueueKeys.push(refreshedEntry.queueKey);
    } else if (exhausted) {
      await markQueueFailed({
        projectRoot,
        projectId,
        entry: refreshedEntry,
        error,
      });
      await markLinkedSessionsFailed({
        projectRoot,
        queueKey: refreshedEntry.queueKey,
        error,
      });
      exhaustedQueueKeys.push(refreshedEntry.queueKey);
      incidents.push(
        await recordWorkflowRuntimeIncident({
          projectRoot,
          projectId,
          idempotencyKey: `repair-exhausted:${refreshedEntry.queueKey}`,
          kind: "repair_exhausted",
          severity: "error",
          summary: `Workflow transition ${refreshedEntry.queueKey} exhausted the repair budget.`,
          queueKey: refreshedEntry.queueKey,
          error,
          details: {
            attemptCount: refreshedEntry.attemptCount,
            maxRepairAttempts,
            source: refreshedEntry.source,
            kind: refreshedEntry.kind,
          },
        })
      );
    } else {
      await updateQueueEntry(projectRoot, refreshedEntry.queueKey, (candidate) => ({
        ...candidate,
        status: "needs_repair",
        lastCheckedAt: nowIso(),
        lastError: error,
        nextRetryAt: refreshedEntry.nextRetryAt ?? null,
      }));
    }
  }

  const experimentMaintenance: WorkflowRuntimeMaintenanceResult["experimentMaintenance"] = {
    attempted: false,
    monitorRefreshed: false,
    decisionPersisted: false,
    decision: null,
    recommendation: null,
  };
  if (currentStage === "experiment") {
    experimentMaintenance.attempted = true;
    try {
      const refreshed = await refreshExperimentGpuMonitor({
        projectRoot,
      });
      experimentMaintenance.monitorRefreshed = true;
      experimentMaintenance.recommendation = refreshed.state.recommendation;
    } catch (error) {
      params.logger?.warn?.("Experiment maintenance could not refresh GPU monitor.", {
        projectRoot,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    try {
      const decision = await evaluateExperimentSearchDecisionForProject({
        projectRoot,
        persist: true,
      });
      experimentMaintenance.decisionPersisted = true;
      experimentMaintenance.decision = decision.summary.decision;
    } catch (error) {
      params.logger?.warn?.("Experiment maintenance could not persist decision state.", {
        projectRoot,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const sessionsStore = await readWorkflowRuntimeSessionsStore(projectRoot);
  const queueStoreAfterReplay = await readWorkflowRuntimeQueueStore(projectRoot);
  const queueByKey = new Map(
    queueStoreAfterReplay.entries.map((entry) => [entry.queueKey, entry] as const)
  );
  const exhaustedSessionKeys: string[] = [];

  for (const session of sessionsStore.entries) {
    if (session.status !== "needs_repair") {
      continue;
    }
    const queueKey = readString(session.queueKey);
    if (!queueKey) {
      const error =
        session.lastError ??
        "Workflow session has no durable queue linkage and cannot be repaired.";
      await markSessionFailed({
        projectRoot,
        sessionKey: session.sessionKey,
        error,
      });
      exhaustedSessionKeys.push(session.sessionKey);
      incidents.push(
        await recordWorkflowRuntimeIncident({
          projectRoot,
          projectId,
          idempotencyKey: `orphan-session:${session.sessionKey}`,
          kind: "repair_orphan_session",
          severity: "error",
          summary: `Workflow session ${session.sessionKey} became orphaned without a queue link.`,
          sessionKey: session.sessionKey,
          error,
          details: {
            ownerAgent: session.ownerAgent,
            runtime: session.runtime,
          },
        })
      );
      continue;
    }
    const queueEntry = queueByKey.get(queueKey) ?? null;
    if (!queueEntry) {
      const error =
        session.lastError ??
        `Workflow session references missing transition ${queueKey}.`;
      await markSessionFailed({
        projectRoot,
        sessionKey: session.sessionKey,
        error,
      });
      exhaustedSessionKeys.push(session.sessionKey);
      incidents.push(
        await recordWorkflowRuntimeIncident({
          projectRoot,
          projectId,
          idempotencyKey: `orphan-session:${session.sessionKey}:${queueKey}`,
          kind: "repair_orphan_session",
          severity: "error",
          summary: `Workflow session ${session.sessionKey} references missing transition ${queueKey}.`,
          queueKey,
          sessionKey: session.sessionKey,
          error,
        })
      );
      continue;
    }
    if (queueEntry.status === "failed") {
      await markSessionFailed({
        projectRoot,
        sessionKey: session.sessionKey,
        error:
          queueEntry.lastError ??
          session.lastError ??
          `Workflow transition ${queueKey} failed during repair.`,
      });
      exhaustedSessionKeys.push(session.sessionKey);
    }
  }

  const replayActivatedSessionKeys = (
    await readWorkflowRuntimeSessionsStore(projectRoot)
  ).entries
    .filter((entry) => replayedQueueKeys.includes(entry.queueKey ?? "") && entry.status === "active")
    .map((entry) => entry.sessionKey);
  const repairedSessionKeys = uniqueStrings([
    ...sessionInspectionRepair.repairedSessionKeys,
    ...replayActivatedSessionKeys,
  ]);

  const finalQueueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  const finalSessionsStore = await readWorkflowRuntimeSessionsStore(projectRoot);
  const watchdogSummary = {
    queueRepairPending: finalQueueStore.entries.filter((entry) =>
      entry.status === "needs_repair" || entry.status === "degraded"
    ).length,
    sessionRepairPending: finalSessionsStore.entries.filter(
      (entry) => entry.status === "needs_repair"
    ).length,
    replayedQueueCount: replayedQueueKeys.length,
    exhaustedQueueCount: exhaustedQueueKeys.length,
    exhaustedSessionCount: exhaustedSessionKeys.length,
    incidentCount: incidents.length,
  };

  await appendWorkflowRuntimeEvent({
    projectRoot,
    projectId,
    kind: "runtime_watchdog_summary",
    summary:
      `Runtime maintenance completed with ${watchdogSummary.replayedQueueCount} replay(s), ` +
      `${watchdogSummary.exhaustedQueueCount} exhausted queue(s), and ` +
      `${watchdogSummary.sessionRepairPending} pending session repair(s).`,
    details: {
      replayedQueueKeys,
      exhaustedQueueKeys,
      cooldownQueueKeys,
      exhaustedSessionKeys,
      handoffMaintenance,
      queueRepairPending: watchdogSummary.queueRepairPending,
      sessionRepairPending: watchdogSummary.sessionRepairPending,
      repairedPaperIngestionRequestIds:
        paperIngestionMaintenance.repairedRequestIds,
      incidentCount: watchdogSummary.incidentCount,
      experimentMaintenance,
    },
  });
  await appendWorkflowDiagnosticEvent({
    projectRoot,
    projectId,
    component: "runtime_maintenance",
    action: "maintenance_completed",
    status:
      watchdogSummary.queueRepairPending > 0 || watchdogSummary.sessionRepairPending > 0
        ? "waiting"
        : incidents.length > 0 || exhaustedQueueKeys.length > 0 || exhaustedSessionKeys.length > 0
          ? "degraded"
          : "completed",
    stage: currentStage,
    owner: currentOwner,
    summary: "Runtime maintenance pass completed.",
    details: {
      replayedQueueKeys,
      exhaustedQueueKeys,
      cooldownQueueKeys,
      exhaustedSessionKeys,
      repairedSessionKeys,
      repairedPaperIngestionRequestIds:
        paperIngestionMaintenance.repairedRequestIds,
      handoffMaintenance,
      watchdogSummary,
      experimentMaintenance,
    },
  });

  return {
    projectId,
    projectRoot,
    recovery,
    replayedQueueKeys,
    exhaustedQueueKeys,
    repairedSessionKeys,
    repairedPaperIngestionRequestIds:
      paperIngestionMaintenance.repairedRequestIds,
    exhaustedSessionKeys,
    incidents,
    handoffMaintenance,
    watchdogSummary,
    experimentMaintenance,
  };
}
