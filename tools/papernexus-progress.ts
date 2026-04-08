import * as path from "node:path";
import {
  asRecord,
  normalizeGraphPresenceStatus,
  pickNumber,
  pickString,
} from "./workflow-guard-core/coercion";
import { readJsonIfExists, writeJsonEnsured } from "./workflow-guard-core/fs";
import { normalizePaperIngestionState } from "./workflow-guard-state/paper-ingestion";

type ManifestLike = Record<string, unknown>;

export type PapernexusProgressPhase =
  | "staging"
  | "submitting"
  | "uploading"
  | "waiting_import"
  | "verifying_graph"
  | "ready"
  | "failed"
  | "needs_repair";

export type PapernexusProgressOwnerRun = {
  run_id: string | null;
  session_key: string | null;
  queue_key: string | null;
  wrapper: string | null;
};

export type PapernexusProgressBatch = {
  manifest_path: string | null;
  total_items: number | null;
  pending_items: number;
  running_items: number;
  synced_items: number;
  failed_items: number;
};

export type PapernexusProgressGraphCheck = {
  expected_papers: number | null;
  present_papers: number | null;
  missing_papers: number | null;
  last_checked_at: string | null;
  status: string | null;
};

export type PapernexusProgressCounters = {
  completed_ratio: number | null;
  percent: number | null;
  eta_hint: string | null;
};

export type PapernexusProgressSnapshot = {
  updated_at: string;
  phase: PapernexusProgressPhase;
  owner_run: PapernexusProgressOwnerRun | null;
  batch: PapernexusProgressBatch;
  graph_check: PapernexusProgressGraphCheck;
  progress: PapernexusProgressCounters;
  next_action: string | null;
  blocking_reason: string | null;
};

type OwnerRunOverride = Partial<PapernexusProgressOwnerRun> | null | undefined;

function asNullableRecord(value: unknown): Record<string, unknown> | null {
  return asRecord(value);
}

function normalizeCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : null;
}

function normalizeOwnerRun(value: unknown): PapernexusProgressOwnerRun | null {
  const record = asNullableRecord(value);
  if (!record) {
    return null;
  }
  const normalized: PapernexusProgressOwnerRun = {
    run_id: pickString(record, ["run_id", "runId"]),
    session_key: pickString(record, ["session_key", "sessionKey"]),
    queue_key: pickString(record, ["queue_key", "queueKey"]),
    wrapper: pickString(record, ["wrapper"]),
  };
  return normalized.run_id ||
    normalized.session_key ||
    normalized.queue_key ||
    normalized.wrapper
    ? normalized
    : null;
}

function normalizeBatch(value: unknown): PapernexusProgressBatch {
  const record = asNullableRecord(value) ?? {};
  return {
    manifest_path: pickString(record, ["manifest_path", "manifestPath"]),
    total_items: normalizeCount(record?.total_items ?? record?.totalItems),
    pending_items:
      normalizeCount(record?.pending_items ?? record?.pendingItems) ?? 0,
    running_items:
      normalizeCount(record?.running_items ?? record?.runningItems) ?? 0,
    synced_items:
      normalizeCount(record?.synced_items ?? record?.syncedItems) ?? 0,
    failed_items:
      normalizeCount(record?.failed_items ?? record?.failedItems) ?? 0,
  };
}

function normalizeGraphCheck(value: unknown): PapernexusProgressGraphCheck {
  const record = asNullableRecord(value) ?? {};
  return {
    expected_papers: normalizeCount(
      record?.expected_papers ?? record?.expectedPapers
    ),
    present_papers: normalizeCount(
      record?.present_papers ?? record?.presentPapers
    ),
    missing_papers: normalizeCount(
      record?.missing_papers ?? record?.missingPapers
    ),
    last_checked_at: pickString(record, ["last_checked_at", "lastCheckedAt"]),
    status: pickString(record, ["status"]),
  };
}

function normalizeProgressCounters(value: unknown): PapernexusProgressCounters {
  const record = asNullableRecord(value) ?? {};
  const completedRatioRaw = record?.completed_ratio ?? record?.completedRatio;
  const percentRaw = record?.percent;
  return {
    completed_ratio:
      typeof completedRatioRaw === "number" && Number.isFinite(completedRatioRaw)
        ? Math.max(0, Math.min(1, completedRatioRaw))
        : null,
    percent:
      typeof percentRaw === "number" && Number.isFinite(percentRaw)
        ? Math.max(0, Math.min(100, Math.round(percentRaw)))
        : null,
    eta_hint: pickString(record, ["eta_hint", "etaHint"]),
  };
}

export function getPapernexusProgressPath(projectRoot: string): string {
  return path.join(projectRoot, "graph", "PAPERNEXUS_PROGRESS.json");
}

export async function readPapernexusProgress(
  projectRoot: string
): Promise<PapernexusProgressSnapshot | null> {
  const raw = await readJsonIfExists<Record<string, unknown>>(
    getPapernexusProgressPath(projectRoot)
  );
  const record = asNullableRecord(raw);
  if (!record) {
    return null;
  }
  const phase = pickString(record, ["phase"]) as PapernexusProgressPhase | null;
  const updatedAt = pickString(record, ["updated_at", "updatedAt"]);
  if (!phase || !updatedAt) {
    return null;
  }
  return {
    updated_at: updatedAt,
    phase,
    owner_run: normalizeOwnerRun(record.owner_run ?? record.ownerRun),
    batch: normalizeBatch(record.batch),
    graph_check: normalizeGraphCheck(record.graph_check ?? record.graphCheck),
    progress: normalizeProgressCounters(record.progress),
    next_action: pickString(record, ["next_action", "nextAction"]),
    blocking_reason: pickString(record, ["blocking_reason", "blockingReason"]),
  };
}

function resolveTrackedImportWrapper(wrapper: string | null | undefined): string | null {
  switch (wrapper) {
    case "pn_stage_sync.py":
    case "pn_import_submit.py":
    case "pn_import_queue.py":
    case "pn_batch_import.py":
      return wrapper;
    default:
      return null;
  }
}

export function isTrackedPapernexusImportWrapper(
  wrapper: string | null | undefined
): boolean {
  return Boolean(resolveTrackedImportWrapper(wrapper));
}

function phaseFromWrapper(
  wrapper: string | null | undefined
): PapernexusProgressPhase {
  switch (resolveTrackedImportWrapper(wrapper)) {
    case "pn_stage_sync.py":
      return "uploading";
    case "pn_import_queue.py":
      return "waiting_import";
    case "pn_import_submit.py":
    case "pn_batch_import.py":
    default:
      return "submitting";
  }
}

function deriveMissingPaperCount(paperIngestionRecord: Record<string, unknown>): number | null {
  const missingRaw =
    paperIngestionRecord.graph_presence_missing_papers ??
    paperIngestionRecord.graphPresenceMissingPapers;
  if (Array.isArray(missingRaw)) {
    return missingRaw.length;
  }
  return pickNumber(paperIngestionRecord, [
    "graph_presence_missing_count",
    "graphPresenceMissingCount",
  ]);
}

function countBatchItems(
  state: ReturnType<typeof normalizePaperIngestionState>
): PapernexusProgressBatch {
  const manifestPath =
    state.lastBatchManifestPath ??
    state.activeBatches[state.activeBatches.length - 1]?.manifestPath ??
    state.batchItems[state.batchItems.length - 1]?.manifestPath ??
    state.queuedRequests.find((entry) => entry.manifestPath)?.manifestPath ??
    null;
  if (state.batchItems.length > 0) {
    return {
      manifest_path: manifestPath,
      total_items: state.batchItems.length,
      pending_items: state.batchItems.filter((entry) => entry.status === "pending").length,
      running_items: state.batchItems.filter((entry) => entry.status === "running").length,
      synced_items: state.batchItems.filter(
        (entry) => entry.synced === true || entry.status === "completed"
      ).length,
      failed_items: state.batchItems.filter(
        (entry) => entry.status === "failed" || entry.status === "submit_failed"
      ).length,
    };
  }

  const latestBatch = state.activeBatches[state.activeBatches.length - 1] ?? null;
  if (latestBatch) {
    return {
      manifest_path: manifestPath,
      total_items: latestBatch.total,
      pending_items: latestBatch.pending ?? 0,
      running_items: latestBatch.running ?? 0,
      synced_items: latestBatch.completed ?? 0,
      failed_items:
        (latestBatch.failed ?? 0) + (latestBatch.submitFailed ?? 0),
    };
  }

  const activeRequest =
    state.queuedRequests.find((entry) =>
      ["launching", "running"].includes(entry.status)
    ) ??
    state.queuedRequests.find((entry) =>
      ["queued", "needs_repair"].includes(entry.status)
    ) ??
    null;
  const totalItems =
    activeRequest?.paperCount ??
    (activeRequest && isTrackedPapernexusImportWrapper(activeRequest.wrapper) ? 1 : null);
  if (totalItems !== null) {
    const phase =
      !activeRequest || activeRequest.status === "queued"
        ? "staging"
        : activeRequest.status === "needs_repair"
          ? "needs_repair"
          : phaseFromWrapper(activeRequest.wrapper);
    const syncedItems = phase === "ready" ? totalItems : 0;
    const runningItems =
      phase === "waiting_import" || phase === "submitting" || phase === "uploading"
        ? Math.min(1, totalItems)
        : 0;
    const pendingItems = Math.max(0, totalItems - runningItems - syncedItems);
    return {
      manifest_path: manifestPath ?? activeRequest?.manifestPath ?? null,
      total_items: totalItems,
      pending_items: pendingItems,
      running_items: runningItems,
      synced_items: syncedItems,
      failed_items: 0,
    };
  }

  return {
    manifest_path: manifestPath,
    total_items: null,
    pending_items: 0,
    running_items: 0,
    synced_items: 0,
    failed_items: 0,
  };
}

function hasActiveImportWork(state: ReturnType<typeof normalizePaperIngestionState>): boolean {
  if (
    state.queuedRequests.some((entry) =>
      ["queued", "launching", "running"].includes(entry.status)
    )
  ) {
    return true;
  }
  if (
    state.activeBatches.some((entry) =>
      ["queued", "running"].includes(entry.status)
    )
  ) {
    return true;
  }
  if (
    state.paperOperations.some((entry) =>
      ["queued", "running"].includes(entry.status)
    )
  ) {
    return true;
  }
  if (
    state.batchItems.some((entry) =>
      ["pending", "running"].includes(entry.status ?? "")
    )
  ) {
    return true;
  }
  return state.importTaskIds.length > 0;
}

function hasFailedImportWork(state: ReturnType<typeof normalizePaperIngestionState>): boolean {
  return (
    state.queuedRequests.some((entry) => entry.status === "failed") ||
    state.activeBatches.some((entry) =>
      ["failed", "timed_out"].includes(entry.status)
    ) ||
    state.paperOperations.some((entry) =>
      ["failed", "timed_out"].includes(entry.status)
    ) ||
    state.batchItems.some((entry) =>
      ["failed", "submit_failed"].includes(entry.status ?? "")
    )
  );
}

function buildOwnerRun(params: {
  state: ReturnType<typeof normalizePaperIngestionState>;
  previous: PapernexusProgressSnapshot | null;
  override: OwnerRunOverride;
}): PapernexusProgressOwnerRun | null {
  const activeRequest =
    params.state.queuedRequests.find((entry) =>
      ["launching", "running"].includes(entry.status)
    ) ?? null;
  const base =
    activeRequest || params.previous?.owner_run
      ? {
          run_id: activeRequest?.lastRunId ?? params.previous?.owner_run?.run_id ?? null,
          session_key:
            activeRequest?.lastSessionKey ??
            params.previous?.owner_run?.session_key ??
            null,
          queue_key: params.previous?.owner_run?.queue_key ?? null,
          wrapper:
            activeRequest?.wrapper ?? params.previous?.owner_run?.wrapper ?? null,
        }
      : null;
  if (!base && !params.override) {
    return null;
  }
  const override = params.override ?? {};
  const overrideRecord = asNullableRecord(override) ?? {};
  const next: PapernexusProgressOwnerRun = {
    run_id: pickString(overrideRecord, ["run_id", "runId"]) ?? base?.run_id ?? null,
    session_key:
      pickString(overrideRecord, ["session_key", "sessionKey"]) ??
      base?.session_key ??
      null,
    queue_key:
      pickString(overrideRecord, ["queue_key", "queueKey"]) ??
      base?.queue_key ??
      null,
    wrapper:
      pickString(overrideRecord, ["wrapper"]) ?? base?.wrapper ?? null,
  };
  return next.run_id || next.session_key || next.queue_key || next.wrapper ? next : null;
}

function derivePhase(params: {
  state: ReturnType<typeof normalizePaperIngestionState>;
  paperIngestionRecord: Record<string, unknown>;
  previous: PapernexusProgressSnapshot | null;
  ownerRun: PapernexusProgressOwnerRun | null;
  phaseOverride?: PapernexusProgressPhase | null;
}): PapernexusProgressPhase | null {
  if (params.phaseOverride) {
    return params.phaseOverride;
  }
  const graphStatus = normalizeGraphPresenceStatus(
    params.paperIngestionRecord.graph_presence_status ??
      params.paperIngestionRecord.graphPresenceStatus
  );
  const activeRequest = params.state.queuedRequests.find((entry) =>
    ["launching", "running"].includes(entry.status)
  );
  if (params.state.repairRequired || graphStatus === "missing_corpus") {
    return "needs_repair";
  }
  if (
    params.state.runtimeStatus === "waiting_import" ||
    params.state.runtimeStatus === "reconciling"
  ) {
    return "waiting_import";
  }
  if (activeRequest?.status === "running" || activeRequest?.status === "launching") {
    return phaseFromWrapper(activeRequest.wrapper);
  }
  if (params.state.queuedRequests.some((entry) => entry.status === "needs_repair")) {
    return "needs_repair";
  }
  if (
    params.state.queuedRequests.some((entry) => entry.status === "queued")
  ) {
    return "staging";
  }
  if (
    hasActiveImportWork(params.state)
  ) {
    return "waiting_import";
  }
  if (hasFailedImportWork(params.state)) {
    return "failed";
  }
  if (graphStatus === "ready" || params.state.runtimeStatus === "ready") {
    return "ready";
  }
  if (graphStatus) {
    return "verifying_graph";
  }
  if (params.ownerRun) {
    return phaseFromWrapper(params.ownerRun.wrapper);
  }
  if (params.previous) {
    return params.previous.phase;
  }
  return null;
}

function buildEtaHint(params: {
  phase: PapernexusProgressPhase;
  batch: PapernexusProgressBatch;
  graphCheck: PapernexusProgressGraphCheck;
  importTaskCount: number;
}): string | null {
  switch (params.phase) {
    case "staging":
      return "launch the queued PaperNexus wrapper";
    case "submitting":
      return "waiting for import task submission";
    case "uploading":
      return "uploading staged sources to PaperNexus";
    case "waiting_import": {
      if (
        params.batch.total_items !== null &&
        params.batch.total_items > 0 &&
        params.batch.synced_items < params.batch.total_items
      ) {
        return `${params.batch.total_items - params.batch.synced_items}/${params.batch.total_items} items remaining`;
      }
      if (params.importTaskCount > 0) {
        return `${params.importTaskCount} import task(s) active`;
      }
      return "waiting for import completion";
    }
    case "verifying_graph":
      return "rerun graph presence verification";
    case "needs_repair":
      return "repair the shared-corpus import state";
    case "failed":
      return "inspect the latest wrapper failure";
    case "ready":
      return "graph is ready";
    default:
      return null;
  }
}

function defaultNextAction(phase: PapernexusProgressPhase): string {
  switch (phase) {
    case "staging":
      return "launch queued PaperNexus upload";
    case "submitting":
      return "wait for import task submission";
    case "uploading":
      return "wait for staged file upload";
    case "waiting_import":
      return "wait for import completion";
    case "verifying_graph":
      return "rerun graph check";
    case "needs_repair":
      return "repair PaperNexus import state";
    case "failed":
      return "inspect wrapper failure";
    case "ready":
      return "continue downstream graph-dependent work";
  }
}

function hasRelevantSignals(params: {
  state: ReturnType<typeof normalizePaperIngestionState>;
  paperIngestionRecord: Record<string, unknown>;
  ownerRun: PapernexusProgressOwnerRun | null;
}): boolean {
  return Boolean(
    params.ownerRun ||
      params.state.importTaskIds.length > 0 ||
      params.state.completedPapers.length > 0 ||
      params.state.paperOperations.length > 0 ||
      params.state.activeBatches.length > 0 ||
      params.state.batchItems.length > 0 ||
      params.state.queuedRequests.length > 0 ||
      params.state.waitingReason ||
      params.state.graphVersionSeen ||
      params.state.reconcileRequired ||
      params.state.repairRequired ||
      params.paperIngestionRecord.graph_presence_status ||
      params.paperIngestionRecord.graphPresenceStatus ||
      params.paperIngestionRecord.graph_presence_checked_at ||
      params.paperIngestionRecord.graphPresenceCheckedAt ||
      params.paperIngestionRecord.refresh_required === true ||
      params.paperIngestionRecord.repair_required === true
  );
}

export function derivePapernexusProgressSnapshot(params: {
  manifest: ManifestLike;
  previous?: PapernexusProgressSnapshot | null;
  ownerRun?: OwnerRunOverride;
  phaseOverride?: PapernexusProgressPhase | null;
  nextActionOverride?: string | null;
  blockingReasonOverride?: string | null;
  updatedAt?: string | null;
}): PapernexusProgressSnapshot | null {
  const manifest = asNullableRecord(params.manifest) ?? {};
  const paperIngestionRecord = asNullableRecord(manifest.paper_ingestion) ?? {};
  const state = normalizePaperIngestionState(paperIngestionRecord);
  const ownerRun = buildOwnerRun({
    state,
    previous: params.previous ?? null,
    override: params.ownerRun,
  });
  if (
    !hasRelevantSignals({
      state,
      paperIngestionRecord,
      ownerRun,
    }) &&
    !params.phaseOverride
  ) {
    return null;
  }
  const phase = derivePhase({
    state,
    paperIngestionRecord,
    previous: params.previous ?? null,
    ownerRun,
    phaseOverride: params.phaseOverride,
  });
  if (!phase) {
    return null;
  }
  const batch = countBatchItems(state);
  const graphCheck: PapernexusProgressGraphCheck = {
    expected_papers: pickNumber(paperIngestionRecord, [
      "graph_presence_expected_papers",
      "graphPresenceExpectedPapers",
    ]),
    present_papers: pickNumber(paperIngestionRecord, [
      "graph_presence_present_papers",
      "graphPresencePresentPapers",
    ]),
    missing_papers: deriveMissingPaperCount(paperIngestionRecord),
    last_checked_at: pickString(paperIngestionRecord, [
      "graph_presence_checked_at",
      "graphPresenceCheckedAt",
    ]),
    status:
      normalizeGraphPresenceStatus(
        paperIngestionRecord.graph_presence_status ??
          paperIngestionRecord.graphPresenceStatus
      ) ?? null,
  };
  const completedRatio =
    batch.total_items && batch.total_items > 0
      ? Number((batch.synced_items / batch.total_items).toFixed(4))
      : phase === "ready"
        ? 1
        : phase === "failed" || phase === "needs_repair"
          ? 0
          : null;
  const progress: PapernexusProgressCounters = {
    completed_ratio: completedRatio,
    percent:
      completedRatio === null ? null : Math.max(0, Math.min(100, Math.round(completedRatio * 100))),
    eta_hint: buildEtaHint({
      phase,
      batch,
      graphCheck,
      importTaskCount: state.importTaskIds.length,
    }),
  };
  return {
    updated_at: params.updatedAt ?? new Date().toISOString(),
    phase,
    owner_run: ownerRun,
    batch,
    graph_check: graphCheck,
    progress,
    next_action:
      params.nextActionOverride ??
      pickString(manifest, ["next_action", "nextAction"]) ??
      defaultNextAction(phase),
    blocking_reason:
      params.blockingReasonOverride ??
      pickString(manifest, ["blocking_reason", "blockingReason"]) ??
      state.waitingReason,
  };
}

export async function writePapernexusProgressFromManifest(params: {
  projectRoot: string;
  manifest: ManifestLike;
  ownerRun?: OwnerRunOverride;
  phaseOverride?: PapernexusProgressPhase | null;
  nextActionOverride?: string | null;
  blockingReasonOverride?: string | null;
  updatedAt?: string | null;
}): Promise<PapernexusProgressSnapshot | null> {
  const previous = await readPapernexusProgress(params.projectRoot);
  const next = derivePapernexusProgressSnapshot({
    manifest: params.manifest,
    previous,
    ownerRun: params.ownerRun,
    phaseOverride: params.phaseOverride,
    nextActionOverride: params.nextActionOverride,
    blockingReasonOverride: params.blockingReasonOverride,
    updatedAt: params.updatedAt,
  });
  if (!next) {
    return null;
  }
  await writeJsonEnsured(getPapernexusProgressPath(params.projectRoot), next);
  return next;
}

export async function loadPapernexusProgress(params: {
  projectRoot: string;
  manifest?: ManifestLike | null;
  writeIfMissing?: boolean;
}): Promise<PapernexusProgressSnapshot | null> {
  const existing = await readPapernexusProgress(params.projectRoot);
  if (existing) {
    return existing;
  }
  const manifest =
    params.manifest ??
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(params.projectRoot, "PROJECT_MANIFEST.json")
    ));
  if (!manifest) {
    return null;
  }
  const derived = derivePapernexusProgressSnapshot({
    manifest,
    previous: null,
  });
  if (derived && params.writeIfMissing) {
    await writeJsonEnsured(getPapernexusProgressPath(params.projectRoot), derived);
  }
  return derived;
}

export function summarizePapernexusProgress(
  progress: PapernexusProgressSnapshot | null
): string | null {
  if (!progress) {
    return null;
  }
  const total = progress.batch.total_items;
  const synced = progress.batch.synced_items;
  const expected = progress.graph_check.expected_papers;
  const present = progress.graph_check.present_papers;
  const progressText =
    total !== null && total > 0
      ? `${synced}/${total} synced`
      : progress.progress.percent !== null
        ? `${progress.progress.percent}%`
        : progress.progress.eta_hint ?? "unknown";
  const graphText =
    expected !== null && expected > 0
      ? `${present ?? 0}/${expected} present`
      : progress.graph_check.status ?? "unknown";
  return `phase=${progress.phase}, progress=${progressText}, graph=${graphText}, next=${progress.next_action ?? "wait"}`;
}
