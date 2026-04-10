import * as path from "node:path";
import {
  asRecord,
  asString,
  asStringArray,
  normalizeStage,
  pickString,
  uniqueStrings,
} from "./workflow-guard-core/coercion";
import {
  normalizeExperimentSearchState,
  serializeExperimentSearchState,
} from "./workflow-guard-state/execution-state";

const DEFAULT_EXPERIMENT_SEARCH_PATH = "researcher/EXPERIMENT_SEARCH.json";

type ExperimentPapernexusSyncLike = {
  status: string | null;
  corpus: string | null;
  lastSyncedAt: string | null;
  nodeRefs: string[];
  notes: string | null;
};

type ExperimentLedgerEntryLike = {
  experimentId: string;
  trackId: string | null;
  name: string | null;
  kind: string | null;
  status: string | null;
  stage: string | null;
  hypothesis: string | null;
  configRef: string | null;
  summary: string | null;
  server: string | null;
  gpuId: string | null;
  screenName: string | null;
  launchedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  lastUpdatedBy: string | null;
  decision: string | null;
  keyMetric: Record<string, unknown> | null;
  metrics: Record<string, unknown> | null;
  resultPaths: string[];
  evidencePointers: string[];
  failureSignature: string | null;
  notes: string[];
  metadata: Record<string, unknown> | null;
  papernexusSync: ExperimentPapernexusSyncLike;
};

type ExperimentLedgerSummaryLike = {
  activeExperimentIds: string[];
  lastCompletedExperimentId: string | null;
  lastFailedExperimentId: string | null;
  bestKnownConfigRef: string | null;
  lastDecisionSummary: string | null;
  papernexusSyncRequired: boolean;
  papernexusLastSyncAt: string | null;
};

type ExperimentLedgerLike = {
  schemaVersion: number;
  projectId: string | null;
  updatedAt: string;
  summary: ExperimentLedgerSummaryLike;
  experiments: ExperimentLedgerEntryLike[];
};

type ExperimentMemoryDigestLike = {
  experimentId: string;
  name: string | null;
  trackId: string | null;
  status: string | null;
  stage: string | null;
  decision: string | null;
  updatedAt: string | null;
  keyMetric: string | null;
  papernexusSyncStatus: string | null;
  failureSignature: string | null;
};

export function getExperimentLedgerPath(projectRoot: string): string {
  return path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json");
}

export function getExperimentSearchPath(projectRoot: string): string {
  return path.join(projectRoot, DEFAULT_EXPERIMENT_SEARCH_PATH);
}

function resolveConfiguredExperimentSearchPath(params: {
  projectRoot: string;
  manifest?: Record<string, unknown> | null;
  stateSearchPath?: string | null;
}): string {
  const manifestRecord = asRecord(params.manifest);
  const manifestSearch = asRecord(manifestRecord?.experiment_search);
  const configuredPath =
    params.stateSearchPath?.trim() ||
    pickString(manifestSearch ?? {}, ["searchStatePath", "search_state_path"]) ||
    null;
  if (!configuredPath) {
    return getExperimentSearchPath(params.projectRoot);
  }
  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(params.projectRoot, configuredPath);
}

export function createEmptyExperimentLedger(
  projectId: string | null
): ExperimentLedgerLike {
  return {
    schemaVersion: 1,
    projectId,
    updatedAt: new Date(0).toISOString(),
    summary: {
      activeExperimentIds: [],
      lastCompletedExperimentId: null,
      lastFailedExperimentId: null,
      bestKnownConfigRef: null,
      lastDecisionSummary: null,
      papernexusSyncRequired: false,
      papernexusLastSyncAt: null,
    },
    experiments: [],
  };
}

export function isTerminalExperimentStatus(status: string | null): boolean {
  return Boolean(
    status &&
      [
        "done",
        "failed",
        "timeout",
        "stalled",
        "killed",
        "merged",
        "parked",
        "cancelled",
        "completed",
      ].includes(status)
  );
}

export function normalizePapernexusSync(
  value: unknown
): ExperimentPapernexusSyncLike {
  const record = asRecord(value);
  return {
    status: normalizeStage(record?.status) ?? null,
    corpus: asString(record?.corpus),
    lastSyncedAt: asString(record?.lastSyncedAt) ?? asString(record?.last_synced_at),
    nodeRefs: asStringArray(record?.nodeRefs ?? record?.node_refs),
    notes: asString(record?.notes),
  };
}

export function normalizeMetricRecord(
  value: unknown
): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const normalized: Record<string, unknown> = {};
  const name = asString(record.name);
  if (name) normalized.name = name;
  if ("value" in record) normalized.value = record.value;
  if ("baseline" in record) normalized.baseline = record.baseline;
  if ("higherIsBetter" in record) normalized.higherIsBetter = record.higherIsBetter;
  if ("unit" in record && asString(record.unit)) normalized.unit = asString(record.unit);
  return Object.keys(normalized).length > 0 ? normalized : null;
}

export function metricToText(metric: Record<string, unknown> | null): string | null {
  if (!metric) return null;
  const name = asString(metric.name) ?? "metric";
  const value = "value" in metric ? String(metric.value) : null;
  const baseline = "baseline" in metric ? String(metric.baseline) : null;
  if (value && baseline) return `${name}=${value} (baseline ${baseline})`;
  if (value) return `${name}=${value}`;
  return null;
}

export function normalizeExperimentEntry(
  entry: Record<string, unknown>,
  defaults?: { experimentId?: string | null; updatedAt?: string; lastUpdatedBy?: string | null }
): ExperimentLedgerEntryLike | null {
  const experimentId =
    pickString(entry, ["experimentId", "experiment_id", "id"]) ??
    defaults?.experimentId ??
    null;
  if (!experimentId) return null;
  return {
    experimentId,
    trackId: pickString(entry, ["trackId", "track_id"]),
    name: pickString(entry, ["name", "experimentName", "experiment_name"]),
    kind: normalizeStage(pickString(entry, ["kind", "experimentType", "experiment_type"])) ?? null,
    status: normalizeStage(pickString(entry, ["status"])) ?? null,
    stage: normalizeStage(pickString(entry, ["stage", "checkpoint", "phase"])) ?? null,
    hypothesis: pickString(entry, ["hypothesis"]),
    configRef: pickString(entry, ["configRef", "config_ref", "configPath", "config_path"]),
    summary: pickString(entry, ["summary"]),
    server: pickString(entry, ["server"]),
    gpuId: pickString(entry, ["gpuId", "gpu_id"]),
    screenName: pickString(entry, ["screenName", "screen_name"]),
    launchedAt: pickString(entry, ["launchedAt", "launched_at", "startedAt", "started_at"]),
    completedAt: pickString(entry, ["completedAt", "completed_at", "finishedAt", "finished_at"]),
    updatedAt: pickString(entry, ["updatedAt", "updated_at"]) ?? defaults?.updatedAt ?? new Date().toISOString(),
    lastUpdatedBy:
      pickString(entry, ["lastUpdatedBy", "last_updated_by", "sourceAgent", "source_agent"]) ??
      defaults?.lastUpdatedBy ??
      null,
    decision: normalizeStage(pickString(entry, ["decision"])) ?? null,
    keyMetric:
      normalizeMetricRecord(entry.keyMetric) ??
      normalizeMetricRecord(entry.key_metric) ??
      normalizeMetricRecord(entry.metric) ??
      null,
    metrics: asRecord(entry.metrics),
    resultPaths: asStringArray(entry.resultPaths ?? entry.result_paths),
    evidencePointers: asStringArray(entry.evidencePointers ?? entry.evidence_pointers),
    failureSignature: pickString(entry, ["failureSignature", "failure_signature"]),
    notes: uniqueStrings([
      ...asStringArray(entry.notes),
      ...(asString(entry.note) ? [asString(entry.note)!] : []),
    ]),
    metadata: asRecord(entry.metadata),
    papernexusSync: normalizePapernexusSync(entry.papernexusSync ?? entry.papernexus_sync),
  };
}

export function mergeExperimentEntries(
  existing: ExperimentLedgerEntryLike | null,
  incoming: Record<string, unknown>,
  defaults?: { updatedAt?: string; lastUpdatedBy?: string | null }
): ExperimentLedgerEntryLike {
  const now = defaults?.updatedAt ?? new Date().toISOString();
  const base =
    existing ??
    normalizeExperimentEntry(incoming, {
      updatedAt: now,
      lastUpdatedBy: defaults?.lastUpdatedBy ?? null,
    });
  if (!base) {
    throw new Error("experimentId is required for experiment ledger updates.");
  }
  const next = normalizeExperimentEntry(incoming, {
    experimentId: base.experimentId,
    updatedAt: now,
    lastUpdatedBy: defaults?.lastUpdatedBy ?? null,
  });
  if (!next) return base;
  const merged: ExperimentLedgerEntryLike = {
    experimentId: base.experimentId,
    trackId: next.trackId ?? base.trackId,
    name: next.name ?? base.name,
    kind: next.kind ?? base.kind,
    status: next.status ?? base.status,
    stage: next.stage ?? base.stage,
    hypothesis: next.hypothesis ?? base.hypothesis,
    configRef: next.configRef ?? base.configRef,
    summary: next.summary ?? base.summary,
    server: next.server ?? base.server,
    gpuId: next.gpuId ?? base.gpuId,
    screenName: next.screenName ?? base.screenName,
    launchedAt: next.launchedAt ?? base.launchedAt,
    completedAt: next.completedAt ?? base.completedAt,
    updatedAt: now,
    lastUpdatedBy: next.lastUpdatedBy ?? base.lastUpdatedBy ?? defaults?.lastUpdatedBy ?? null,
    decision: next.decision ?? base.decision,
    keyMetric: next.keyMetric ?? base.keyMetric,
    metrics: next.metrics ?? base.metrics,
    resultPaths: uniqueStrings([...(base.resultPaths || []), ...(next.resultPaths || [])]),
    evidencePointers: uniqueStrings([...(base.evidencePointers || []), ...(next.evidencePointers || [])]),
    failureSignature: next.failureSignature ?? base.failureSignature,
    notes: uniqueStrings([...(base.notes || []), ...(next.notes || [])]),
    metadata: next.metadata ?? base.metadata,
    papernexusSync: {
      status: next.papernexusSync.status ?? base.papernexusSync.status,
      corpus: next.papernexusSync.corpus ?? base.papernexusSync.corpus,
      lastSyncedAt: next.papernexusSync.lastSyncedAt ?? base.papernexusSync.lastSyncedAt,
      nodeRefs: uniqueStrings([...(base.papernexusSync.nodeRefs || []), ...(next.papernexusSync.nodeRefs || [])]),
      notes: next.papernexusSync.notes ?? base.papernexusSync.notes,
    },
  };
  if (isTerminalExperimentStatus(merged.status) && !merged.completedAt) merged.completedAt = now;
  if (isTerminalExperimentStatus(merged.status) && !merged.papernexusSync.status) {
    merged.papernexusSync.status = "pending";
  }
  if (merged.papernexusSync.status === "synced" && !merged.papernexusSync.lastSyncedAt) {
    merged.papernexusSync.lastSyncedAt = now;
  }
  return merged;
}

export function getExperimentSortTimestamp(entry: ExperimentLedgerEntryLike): string {
  return entry.updatedAt || entry.completedAt || entry.launchedAt || new Date(0).toISOString();
}

export function buildExperimentLedgerSummary(
  experiments: ExperimentLedgerEntryLike[]
): ExperimentLedgerSummaryLike {
  const ordered = [...experiments].sort((left, right) =>
    getExperimentSortTimestamp(right).localeCompare(getExperimentSortTimestamp(left))
  );
  const activeExperimentIds = ordered
    .filter((entry) => !isTerminalExperimentStatus(entry.status))
    .map((entry) => entry.experimentId);
  const lastCompleted = ordered.find((entry) => ["done", "completed"].includes(entry.status ?? ""));
  const lastFailed = ordered.find((entry) =>
    ["failed", "timeout", "stalled", "killed", "cancelled"].includes(entry.status ?? "")
  );
  const bestKnown = ordered.find(
    (entry) =>
      entry.configRef &&
      (entry.decision === "advance" || ["done", "completed"].includes(entry.status ?? ""))
  );
  const lastDecision = ordered.find((entry) => entry.decision);
  const papernexusSyncRequired = ordered.some(
    (entry) =>
      isTerminalExperimentStatus(entry.status) &&
      ["pending", "failed", "missing"].includes(entry.papernexusSync.status ?? "")
  );
  const papernexusLastSyncAt =
    ordered
      .map((entry) => entry.papernexusSync.lastSyncedAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => right.localeCompare(left))[0] ?? null;
  return {
    activeExperimentIds,
    lastCompletedExperimentId: lastCompleted?.experimentId ?? null,
    lastFailedExperimentId: lastFailed?.experimentId ?? null,
    bestKnownConfigRef: bestKnown?.configRef ?? null,
    lastDecisionSummary: lastDecision
      ? `${lastDecision.name ?? lastDecision.experimentId}: ${lastDecision.decision}`
      : null,
    papernexusSyncRequired,
    papernexusLastSyncAt,
  };
}

export function normalizeExperimentLedger(
  raw: Record<string, unknown>,
  projectId: string | null
): ExperimentLedgerLike {
  const experiments = Array.isArray(raw.experiments)
    ? raw.experiments
        .map((item) =>
          normalizeExperimentEntry(asRecord(item) ?? {}, {
            updatedAt: new Date(0).toISOString(),
            lastUpdatedBy: null,
          })
        )
        .filter((item): item is ExperimentLedgerEntryLike => Boolean(item))
    : [];
  return {
    schemaVersion:
      typeof raw.schemaVersion === "number" && Number.isFinite(raw.schemaVersion)
        ? Math.floor(raw.schemaVersion)
        : typeof raw.schema_version === "number" && Number.isFinite(raw.schema_version)
          ? Math.floor(raw.schema_version)
          : 1,
    projectId: asString(raw.projectId) ?? asString(raw.project_id) ?? projectId,
    updatedAt: asString(raw.updatedAt) ?? asString(raw.updated_at) ?? new Date(0).toISOString(),
    summary: buildExperimentLedgerSummary(experiments),
    experiments,
  };
}

export async function loadExperimentLedgerIfExists(params: {
  projectRoot: string;
  readJsonIfExists: <T>(targetPath: string) => Promise<T | null>;
}): Promise<ExperimentLedgerLike | null> {
  const raw = await params.readJsonIfExists<Record<string, unknown>>(
    getExperimentLedgerPath(params.projectRoot)
  );
  return raw ? normalizeExperimentLedger(raw, path.basename(params.projectRoot)) : null;
}

export async function readExperimentLedgerEnsured(params: {
  projectRoot: string;
  readJsonIfExists: <T>(targetPath: string) => Promise<T | null>;
}): Promise<ExperimentLedgerLike> {
  return (
    (await loadExperimentLedgerIfExists(params)) ??
    createEmptyExperimentLedger(path.basename(params.projectRoot))
  );
}

export async function saveExperimentLedger(params: {
  projectRoot: string;
  ledger: ExperimentLedgerLike;
  writeJsonEnsured: (targetPath: string, value: unknown) => Promise<void>;
}): Promise<void> {
  await params.writeJsonEnsured(getExperimentLedgerPath(params.projectRoot), {
    schema_version: params.ledger.schemaVersion,
    project_id: params.ledger.projectId,
    updated_at: params.ledger.updatedAt,
    summary: {
      active_experiment_ids: params.ledger.summary.activeExperimentIds,
      last_completed_experiment_id: params.ledger.summary.lastCompletedExperimentId,
      last_failed_experiment_id: params.ledger.summary.lastFailedExperimentId,
      best_known_config_ref: params.ledger.summary.bestKnownConfigRef,
      last_decision_summary: params.ledger.summary.lastDecisionSummary,
      papernexus_sync_required: params.ledger.summary.papernexusSyncRequired,
      papernexus_last_sync_at: params.ledger.summary.papernexusLastSyncAt,
    },
    experiments: params.ledger.experiments.map((entry) => ({
      experiment_id: entry.experimentId,
      track_id: entry.trackId,
      name: entry.name,
      kind: entry.kind,
      status: entry.status,
      stage: entry.stage,
      hypothesis: entry.hypothesis,
      config_ref: entry.configRef,
      summary: entry.summary,
      server: entry.server,
      gpu_id: entry.gpuId,
      screen_name: entry.screenName,
      launched_at: entry.launchedAt,
      completed_at: entry.completedAt,
      updated_at: entry.updatedAt,
      last_updated_by: entry.lastUpdatedBy,
      decision: entry.decision,
      key_metric: entry.keyMetric,
      metrics: entry.metrics,
      result_paths: entry.resultPaths,
      evidence_pointers: entry.evidencePointers,
      failure_signature: entry.failureSignature,
      notes: entry.notes,
      metadata: entry.metadata,
      papernexus_sync: {
        status: entry.papernexusSync.status,
        corpus: entry.papernexusSync.corpus,
        last_synced_at: entry.papernexusSync.lastSyncedAt,
        node_refs: entry.papernexusSync.nodeRefs,
        notes: entry.papernexusSync.notes,
      },
    })),
  });
}

export async function loadExperimentSearchState(params: {
  projectRoot: string;
  manifest?: Record<string, unknown> | null;
  readJsonIfExists: <T>(targetPath: string) => Promise<T | null>;
}): Promise<ReturnType<typeof normalizeExperimentSearchState>> {
  const targetPath = resolveConfiguredExperimentSearchPath(params);
  const raw = await params.readJsonIfExists<Record<string, unknown>>(
    targetPath
  );
  if (raw) return normalizeExperimentSearchState(raw);
  return normalizeExperimentSearchState(params.manifest?.experiment_search);
}

export async function saveExperimentSearchStateFile(params: {
  projectRoot: string;
  state: ReturnType<typeof normalizeExperimentSearchState>;
  writeJsonEnsured: (targetPath: string, value: unknown) => Promise<void>;
}): Promise<void> {
  const targetPath = resolveConfiguredExperimentSearchPath({
    projectRoot: params.projectRoot,
    stateSearchPath: params.state.searchStatePath,
  });
  await params.writeJsonEnsured(
    targetPath,
    serializeExperimentSearchState(params.state)
  );
}

export async function syncManifestExperimentMemoryImpl(params: {
  projectRoot: string;
  ledger: ExperimentLedgerLike;
}, deps: {
  readJsonIfExists: <T>(targetPath: string) => Promise<T | null>;
  writeJsonEnsured: (targetPath: string, value: unknown) => Promise<void>;
  normalizeInnovationReflectionState: (value: unknown) => {
    requiredAfterExperiments: boolean;
    status: string;
    lastReflectionPath: string | null;
    pendingReason: string | null;
  };
  serializeInnovationReflectionState: (value: unknown) => Record<string, unknown>;
  isInnovationReflectionDue: (params: { state: unknown; ledger: ExperimentLedgerLike | null }) => boolean;
}): Promise<Record<string, unknown> | null> {
  const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await deps.readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const current = asRecord(manifest.experiment_memory) ?? {};
  manifest.experiment_memory = {
    ...current,
    ledger_path: "researcher/EXPERIMENT_LEDGER.json",
    last_ledger_update_at: params.ledger.updatedAt,
    last_completed_experiment_id: params.ledger.summary.lastCompletedExperimentId,
    last_failed_experiment_id: params.ledger.summary.lastFailedExperimentId,
    best_known_config_ref: params.ledger.summary.bestKnownConfigRef,
    last_decision_summary: params.ledger.summary.lastDecisionSummary,
    papernexus_sync_status: params.ledger.summary.papernexusSyncRequired
      ? "pending"
      : params.ledger.summary.papernexusLastSyncAt
        ? "synced"
        : asString(current.papernexus_sync_status) ?? "unknown",
    papernexus_sync_required: params.ledger.summary.papernexusSyncRequired,
    papernexus_last_sync_at: params.ledger.summary.papernexusLastSyncAt,
  };
  const currentReflection = deps.normalizeInnovationReflectionState(
    manifest.innovation_reflection
  );
  const reflectionDue = deps.isInnovationReflectionDue({
    state: currentReflection,
    ledger: params.ledger,
  });
  manifest.innovation_reflection = deps.serializeInnovationReflectionState({
    ...currentReflection,
    requiredAfterExperiments: true,
    status: reflectionDue
      ? currentReflection.status === "running"
        ? "running"
        : "pending"
      : currentReflection.lastReflectionPath
        ? "fresh"
        : currentReflection.status,
    pendingReason: reflectionDue
      ? "new experiment evidence requires a PaperNexus-backed innovation reflection before the next idea proposal"
      : null,
  });
  if (typeof manifest.updated_at === "string" || !("updated_at" in manifest)) {
    manifest.updated_at = new Date().toISOString();
  }
  await deps.writeJsonEnsured(manifestPath, manifest);
  return manifest;
}

export function buildExperimentMemoryDigest(
  ledger: ExperimentLedgerLike | null,
  limit = 5
): ExperimentMemoryDigestLike[] {
  if (!ledger) return [];
  return [...ledger.experiments]
    .sort((left, right) =>
      getExperimentSortTimestamp(right).localeCompare(getExperimentSortTimestamp(left))
    )
    .slice(0, limit)
    .map((entry) => ({
      experimentId: entry.experimentId,
      name: entry.name,
      trackId: entry.trackId,
      status: entry.status,
      stage: entry.stage,
      decision: entry.decision,
      updatedAt: entry.updatedAt,
      keyMetric: metricToText(entry.keyMetric),
      papernexusSyncStatus: entry.papernexusSync.status,
      failureSignature: entry.failureSignature,
    }));
}
