import {
  asRecord,
  asStringArray,
  pickBoolean,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";

function normalizeStatus(value: unknown, fallback = "missing"): string {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : fallback;
}

export type BenchmarkProtocolState = {
  status: string;
  benchmarkFamily: string | null;
  protocolLockPath: string | null;
  officialEvalRecipe: string | null;
  locked: boolean;
  driftStatus: string | null;
  pendingReason: string | null;
};

export type StatisticalEvidenceState = {
  status: string;
  aggregatePath: string | null;
  claimStrengthStatus: string | null;
  significantResultCount: number;
  insufficientSeedCount: number;
  pendingReason: string | null;
};

export type VenueCompetitionState = {
  status: string;
  targetVenues: string[];
  competitorSlatePath: string | null;
  acceptanceRiskStatus: string | null;
  graphContextStatus: string | null;
  pendingReason: string | null;
};

export type AblationEvidenceState = {
  status: string;
  summaryPath: string | null;
  sufficiencyStatus: string | null;
  publicationCriticalCount: number;
  pendingReason: string | null;
};

export type MechanismEvidenceState = {
  status: string;
  packetPath: string | null;
  evidenceTier: string | null;
  graphContextStatus: string | null;
  pendingReason: string | null;
};

export type ReproducibilityPackState = {
  status: string;
  bundlePath: string | null;
  environmentCaptureStatus: string | null;
  regenerateTablesStatus: string | null;
  pendingReason: string | null;
};

export type CameraReadyEvidenceState = {
  status: string;
  packagePath: string | null;
  figuresStatus: string | null;
  tablesStatus: string | null;
  captionsStatus: string | null;
  pendingReason: string | null;
};

export type OpportunityScorecardState = {
  status: string;
  verdict: string | null;
  scorecardPath: string | null;
  graphContextStatus: string | null;
  pendingReason: string | null;
};

export function normalizeBenchmarkProtocolState(value: unknown): BenchmarkProtocolState {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStatus(record.status),
    benchmarkFamily:
      pickString(record, ["benchmarkFamily", "benchmark_family"]) ?? null,
    protocolLockPath:
      pickString(record, ["protocolLockPath", "protocol_lock_path"]) ??
      "researcher/BENCHMARK_PROTOCOL.json",
    officialEvalRecipe:
      pickString(record, ["officialEvalRecipe", "official_eval_recipe"]) ?? null,
    locked: pickBoolean(record, ["locked"]) ?? false,
    driftStatus: pickString(record, ["driftStatus", "drift_status"]) ?? null,
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]) ?? null,
  };
}

export function normalizeStatisticalEvidenceState(value: unknown): StatisticalEvidenceState {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStatus(record.status),
    aggregatePath:
      pickString(record, ["aggregatePath", "aggregate_path"]) ??
      "analyzer/STATISTICAL_EVIDENCE.json",
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
  const record = asRecord(value) ?? {};
  return {
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
  const record = asRecord(value) ?? {};
  return {
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
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStatus(record.status),
    packetPath:
      pickString(record, ["packetPath", "packet_path"]) ??
      "researcher/MECHANISM_EVIDENCE.json",
    evidenceTier:
      pickString(record, ["evidenceTier", "evidence_tier"]) ?? null,
    graphContextStatus:
      pickString(record, ["graphContextStatus", "graph_context_status"]) ?? null,
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]) ?? null,
  };
}

export function normalizeReproducibilityPackState(value: unknown): ReproducibilityPackState {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStatus(record.status),
    bundlePath:
      pickString(record, ["bundlePath", "bundle_path"]) ??
      "academic_writer/REPRODUCIBILITY_PACK.json",
    environmentCaptureStatus:
      pickString(record, ["environmentCaptureStatus", "environment_capture_status"]) ?? null,
    regenerateTablesStatus:
      pickString(record, ["regenerateTablesStatus", "regenerate_tables_status"]) ?? null,
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]) ?? null,
  };
}

export function normalizeCameraReadyEvidenceState(value: unknown): CameraReadyEvidenceState {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStatus(record.status),
    packagePath:
      pickString(record, ["packagePath", "package_path"]) ??
      "academic_writer/CAMERA_READY_EVIDENCE.json",
    figuresStatus: pickString(record, ["figuresStatus", "figures_status"]) ?? null,
    tablesStatus: pickString(record, ["tablesStatus", "tables_status"]) ?? null,
    captionsStatus: pickString(record, ["captionsStatus", "captions_status"]) ?? null,
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]) ?? null,
  };
}

export function normalizeOpportunityScorecardState(value: unknown): OpportunityScorecardState {
  const record = asRecord(value) ?? {};
  return {
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
