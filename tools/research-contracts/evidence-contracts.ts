import {
  asRecord,
} from "./core/project-io.ts";
import {
  asStringArray,
  pickBoolean,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion.ts";

const CURRENT_EVIDENCE_SCHEMA_VERSION = 2;

function normalizeStatus(value: unknown, fallback = "missing"): string {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : fallback;
}

type VersionedEvidenceContract = {
  schemaVersion: number;
  lastMaterializedAt: string | null;
};

export type BenchmarkProtocolState = VersionedEvidenceContract & {
  status: string;
  benchmarkFamily: string | null;
  registryPath: string | null;
  protocolLockPath: string | null;
  officialEvalRecipe: string | null;
  locked: boolean;
  driftStatus: string | null;
  pendingReason: string | null;
};

export type StatisticalEvidenceState = VersionedEvidenceContract & {
  status: string;
  aggregatePath: string | null;
  summaryPath: string | null;
  claimConfidenceMapPath: string | null;
  claimStrengthStatus: string | null;
  significantResultCount: number;
  insufficientSeedCount: number;
  pendingReason: string | null;
};

export type VenueCompetitionState = VersionedEvidenceContract & {
  status: string;
  targetVenues: string[];
  competitorSlatePath: string | null;
  acceptanceRiskStatus: string | null;
  graphContextStatus: string | null;
  pendingReason: string | null;
};

export type AblationEvidenceState = VersionedEvidenceContract & {
  status: string;
  summaryPath: string | null;
  sufficiencyStatus: string | null;
  publicationCriticalCount: number;
  pendingReason: string | null;
};

export type MechanismEvidenceState = VersionedEvidenceContract & {
  status: string;
  packetPath: string | null;
  planPath: string | null;
  evidenceTier: string | null;
  graphContextStatus: string | null;
  pendingReason: string | null;
};

export type ReproducibilityPackState = VersionedEvidenceContract & {
  status: string;
  bundlePath: string | null;
  environmentCaptureStatus: string | null;
  regenerateTablesStatus: string | null;
  pendingReason: string | null;
};

export type CameraReadyEvidenceState = VersionedEvidenceContract & {
  status: string;
  packagePath: string | null;
  auditPath: string | null;
  figuresStatus: string | null;
  tablesStatus: string | null;
  captionsStatus: string | null;
  pendingReason: string | null;
};

export type OpportunityScorecardState = VersionedEvidenceContract & {
  status: string;
  verdict: string | null;
  scorecardPath: string | null;
  graphContextStatus: string | null;
  pendingReason: string | null;
};

function normalizeVersion(record: Record<string, unknown>): VersionedEvidenceContract {
  return {
    schemaVersion:
      pickNumber(record, ["schemaVersion", "schema_version"]) ??
      CURRENT_EVIDENCE_SCHEMA_VERSION,
    lastMaterializedAt:
      pickString(record, ["lastMaterializedAt", "last_materialized_at"]) ?? null,
  };
}

export function normalizeBenchmarkProtocolState(value: unknown): BenchmarkProtocolState {
  const record = asRecord(value);
  return {
    ...normalizeVersion(record),
    status: normalizeStatus(record.status),
    benchmarkFamily:
      pickString(record, ["benchmarkFamily", "benchmark_family"]) ?? null,
    registryPath:
      pickString(record, ["registryPath", "registry_path"]) ??
      "researcher/BENCHMARK_REGISTRY.json",
    protocolLockPath:
      pickString(record, ["protocolLockPath", "protocol_lock_path"]) ??
      "researcher/PROTOCOL_LOCK.json",
    officialEvalRecipe:
      pickString(record, ["officialEvalRecipe", "official_eval_recipe"]) ?? null,
    locked: pickBoolean(record, ["locked"]) ?? false,
    driftStatus: pickString(record, ["driftStatus", "drift_status"]) ?? null,
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]) ?? null,
  };
}

export function normalizeStatisticalEvidenceState(value: unknown): StatisticalEvidenceState {
  const record = asRecord(value);
  return {
    ...normalizeVersion(record),
    status: normalizeStatus(record.status),
    aggregatePath:
      pickString(record, ["aggregatePath", "aggregate_path"]) ??
      "analyzer/STATISTICAL_EVIDENCE.json",
    summaryPath:
      pickString(record, ["summaryPath", "summary_path"]) ??
      "analyzer/STATISTICAL_EVIDENCE_SUMMARY.md",
    claimConfidenceMapPath:
      pickString(record, ["claimConfidenceMapPath", "claim_confidence_map_path"]) ??
      "analyzer/CLAIM_CONFIDENCE_MAP.json",
    claimStrengthStatus:
      pickString(record, ["claimStrengthStatus", "claim_strength_status"]) ?? null,
    significantResultCount:
      pickNumber(record, ["significantResultCount", "significant_result_count"]) ?? 0,
    insufficientSeedCount:
      pickNumber(record, ["insufficientSeedCount", "insufficient_seed_count"]) ?? 0,
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]) ?? null,
  };
}

export function normalizeVenueCompetitionState(value: unknown): VenueCompetitionState {
  const record = asRecord(value);
  return {
    ...normalizeVersion(record),
    status: normalizeStatus(record.status),
    targetVenues: asStringArray(record.targetVenues ?? record.target_venues),
    competitorSlatePath:
      pickString(record, ["competitorSlatePath", "competitor_slate_path"]) ??
      "researcher/VENUE_COMPETITION.json",
    acceptanceRiskStatus:
      pickString(record, ["acceptanceRiskStatus", "acceptance_risk_status"]) ?? null,
    graphContextStatus:
      pickString(record, ["graphContextStatus", "graph_context_status"]) ?? null,
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]) ?? null,
  };
}

export function normalizeAblationEvidenceState(value: unknown): AblationEvidenceState {
  const record = asRecord(value);
  return {
    ...normalizeVersion(record),
    status: normalizeStatus(record.status),
    summaryPath:
      pickString(record, ["summaryPath", "summary_path"]) ??
      "researcher/ABLATION_EVIDENCE.json",
    sufficiencyStatus:
      pickString(record, ["sufficiencyStatus", "sufficiency_status"]) ?? null,
    publicationCriticalCount:
      pickNumber(record, ["publicationCriticalCount", "publication_critical_count"]) ?? 0,
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]) ?? null,
  };
}

export function normalizeMechanismEvidenceState(value: unknown): MechanismEvidenceState {
  const record = asRecord(value);
  return {
    ...normalizeVersion(record),
    status: normalizeStatus(record.status),
    packetPath:
      pickString(record, ["packetPath", "packet_path"]) ??
      "researcher/MECHANISM_EVIDENCE.json",
    planPath:
      pickString(record, ["planPath", "plan_path"]) ??
      "researcher/MECHANISM_EVIDENCE_PLAN.md",
    evidenceTier: pickString(record, ["evidenceTier", "evidence_tier"]) ?? null,
    graphContextStatus:
      pickString(record, ["graphContextStatus", "graph_context_status"]) ?? null,
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]) ?? null,
  };
}

export function normalizeReproducibilityPackState(value: unknown): ReproducibilityPackState {
  const record = asRecord(value);
  return {
    ...normalizeVersion(record),
    status: normalizeStatus(record.status),
    bundlePath:
      pickString(record, ["bundlePath", "bundle_path"]) ?? "submit/REPRO_PACK.json",
    environmentCaptureStatus:
      pickString(record, ["environmentCaptureStatus", "environment_capture_status"]) ?? null,
    regenerateTablesStatus:
      pickString(record, ["regenerateTablesStatus", "regenerate_tables_status"]) ?? null,
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]) ?? null,
  };
}

export function normalizeCameraReadyEvidenceState(value: unknown): CameraReadyEvidenceState {
  const record = asRecord(value);
  return {
    ...normalizeVersion(record),
    status: normalizeStatus(record.status),
    packagePath:
      pickString(record, ["packagePath", "package_path"]) ??
      "academic_writer/CAMERA_READY_EVIDENCE.json",
    auditPath:
      pickString(record, ["auditPath", "audit_path"]) ??
      "submit/FINAL_CONSISTENCY_AUDIT.md",
    figuresStatus: pickString(record, ["figuresStatus", "figures_status"]) ?? null,
    tablesStatus: pickString(record, ["tablesStatus", "tables_status"]) ?? null,
    captionsStatus: pickString(record, ["captionsStatus", "captions_status"]) ?? null,
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]) ?? null,
  };
}

export function normalizeOpportunityScorecardState(value: unknown): OpportunityScorecardState {
  const record = asRecord(value);
  return {
    ...normalizeVersion(record),
    status: normalizeStatus(record.status),
    verdict: pickString(record, ["verdict"]) ?? null,
    scorecardPath:
      pickString(record, ["scorecardPath", "scorecard_path"]) ??
      "researcher/TOP_TIER_OPPORTUNITY.json",
    graphContextStatus:
      pickString(record, ["graphContextStatus", "graph_context_status"]) ?? null,
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]) ?? null,
  };
}

export function serializeBenchmarkProtocolState(
  state: BenchmarkProtocolState
): Record<string, unknown> {
  return {
    schema_version: state.schemaVersion,
    last_materialized_at: state.lastMaterializedAt,
    status: state.status,
    benchmark_family: state.benchmarkFamily,
    registry_path: state.registryPath,
    protocol_lock_path: state.protocolLockPath,
    official_eval_recipe: state.officialEvalRecipe,
    locked: state.locked,
    drift_status: state.driftStatus,
    pending_reason: state.pendingReason,
  };
}

export function serializeStatisticalEvidenceState(
  state: StatisticalEvidenceState
): Record<string, unknown> {
  return {
    schema_version: state.schemaVersion,
    last_materialized_at: state.lastMaterializedAt,
    status: state.status,
    aggregate_path: state.aggregatePath,
    summary_path: state.summaryPath,
    claim_confidence_map_path: state.claimConfidenceMapPath,
    claim_strength_status: state.claimStrengthStatus,
    significant_result_count: state.significantResultCount,
    insufficient_seed_count: state.insufficientSeedCount,
    pending_reason: state.pendingReason,
  };
}

export function serializeVenueCompetitionState(
  state: VenueCompetitionState
): Record<string, unknown> {
  return {
    schema_version: state.schemaVersion,
    last_materialized_at: state.lastMaterializedAt,
    status: state.status,
    target_venues: state.targetVenues,
    competitor_slate_path: state.competitorSlatePath,
    acceptance_risk_status: state.acceptanceRiskStatus,
    graph_context_status: state.graphContextStatus,
    pending_reason: state.pendingReason,
  };
}

export function serializeAblationEvidenceState(
  state: AblationEvidenceState
): Record<string, unknown> {
  return {
    schema_version: state.schemaVersion,
    last_materialized_at: state.lastMaterializedAt,
    status: state.status,
    summary_path: state.summaryPath,
    sufficiency_status: state.sufficiencyStatus,
    publication_critical_count: state.publicationCriticalCount,
    pending_reason: state.pendingReason,
  };
}

export function serializeMechanismEvidenceState(
  state: MechanismEvidenceState
): Record<string, unknown> {
  return {
    schema_version: state.schemaVersion,
    last_materialized_at: state.lastMaterializedAt,
    status: state.status,
    packet_path: state.packetPath,
    plan_path: state.planPath,
    evidence_tier: state.evidenceTier,
    graph_context_status: state.graphContextStatus,
    pending_reason: state.pendingReason,
  };
}

export function serializeReproducibilityPackState(
  state: ReproducibilityPackState
): Record<string, unknown> {
  return {
    schema_version: state.schemaVersion,
    last_materialized_at: state.lastMaterializedAt,
    status: state.status,
    bundle_path: state.bundlePath,
    environment_capture_status: state.environmentCaptureStatus,
    regenerate_tables_status: state.regenerateTablesStatus,
    pending_reason: state.pendingReason,
  };
}

export function serializeCameraReadyEvidenceState(
  state: CameraReadyEvidenceState
): Record<string, unknown> {
  return {
    schema_version: state.schemaVersion,
    last_materialized_at: state.lastMaterializedAt,
    status: state.status,
    package_path: state.packagePath,
    audit_path: state.auditPath,
    figures_status: state.figuresStatus,
    tables_status: state.tablesStatus,
    captions_status: state.captionsStatus,
    pending_reason: state.pendingReason,
  };
}

export function serializeOpportunityScorecardState(
  state: OpportunityScorecardState
): Record<string, unknown> {
  return {
    schema_version: state.schemaVersion,
    last_materialized_at: state.lastMaterializedAt,
    status: state.status,
    verdict: state.verdict,
    scorecard_path: state.scorecardPath,
    graph_context_status: state.graphContextStatus,
    pending_reason: state.pendingReason,
  };
}
