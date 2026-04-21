import {
  asRecord,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";
import {
  DEFAULT_SURVEY_CANDIDATE_PAPERS_PATH,
  DEFAULT_SURVEY_SCREENING_DECISIONS_PATH,
} from "../survey-review-artifacts";

export type SurveyReviewState = {
  status: string;
  currentPhase: string | null;
  topic: string | null;
  mode: string | null;
  years: string | null;
  venueScope: string[];
  queryRegistryPath: string | null;
  literaturePath: string | null;
  literatureReviewPath: string | null;
  reviewProtocolPath: string | null;
  includedPapersPath: string | null;
  excludedPapersPath: string | null;
  candidatePapersPath: string | null;
  screeningDecisionsPath: string | null;
  sotaMatrixPath: string | null;
  gapSynthesisPath: string | null;
  coverageSummaryPath: string | null;
  surveyBriefPath: string | null;
  candidatePaperCount: number | null;
  includedPaperCount: number | null;
  excludedPaperCount: number | null;
  backgroundPaperCount: number | null;
  queryRoundCount: number | null;
  pendingScreeningCount: number | null;
  pendingPlannedRoundCount: number | null;
  graphGroundedBriefReady: boolean;
  diagnosticsPath: string | null;
  gateReady: boolean;
  gateBlockingIssues: string[];
  gateWarnings: string[];
  coverageStatus: string | null;
  coverageSummary: string | null;
  taxonomyStabilityStatus: string | null;
  taxonomyStabilitySummary: string | null;
  representativeMethodsStatus: string | null;
  representativeMethodsSummary: string | null;
  benchmarkAlignmentStatus: string | null;
  benchmarkAlignmentSummary: string | null;
  topicRelevanceStatus: string | null;
  topicRelevanceSummary: string | null;
  gapClosureStatus: string | null;
  gapClosureSummary: string | null;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

export const DEFAULT_SURVEY_DIR = "researcher";
export const DEFAULT_SURVEY_QUERY_REGISTRY_PATH = `${DEFAULT_SURVEY_DIR}/SURVEY_QUERY_REGISTRY.json`;
export const DEFAULT_SURVEY_LITERATURE_PATH = `${DEFAULT_SURVEY_DIR}/LITERATURE.md`;
export const DEFAULT_SURVEY_LITERATURE_REVIEW_PATH =
  `${DEFAULT_SURVEY_DIR}/LITERATURE_REVIEW.md`;
export const DEFAULT_SURVEY_REVIEW_PROTOCOL_PATH =
  `${DEFAULT_SURVEY_DIR}/REVIEW_PROTOCOL.md`;
export const DEFAULT_SURVEY_INCLUDED_PAPERS_PATH =
  `${DEFAULT_SURVEY_DIR}/INCLUDED_PAPERS.json`;
export const DEFAULT_SURVEY_EXCLUDED_PAPERS_PATH =
  `${DEFAULT_SURVEY_DIR}/EXCLUDED_PAPERS.json`;
export { DEFAULT_SURVEY_CANDIDATE_PAPERS_PATH, DEFAULT_SURVEY_SCREENING_DECISIONS_PATH };
export const DEFAULT_SURVEY_SOTA_MATRIX_PATH = `${DEFAULT_SURVEY_DIR}/SOTA_MATRIX.md`;
export const DEFAULT_SURVEY_GAP_SYNTHESIS_PATH =
  `${DEFAULT_SURVEY_DIR}/GAP_SYNTHESIS.md`;
export const DEFAULT_SURVEY_COVERAGE_SUMMARY_PATH =
  `${DEFAULT_SURVEY_DIR}/COVERAGE_SUMMARY.md`;
export const DEFAULT_SURVEY_BRIEF_PATH = `${DEFAULT_SURVEY_DIR}/SURVEY_BRIEF.md`;
export const DEFAULT_SURVEY_DIAGNOSTICS_PATH =
  `${DEFAULT_SURVEY_DIR}/SURVEY_GATE_DIAGNOSTICS.json`;

function normalizeOptionalCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    )
  );
}

function normalizeOptionalStatus(value: unknown): string | null {
  const normalized = normalizeStage(value);
  if (normalized) {
    return normalized;
  }
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeSurveyReviewState(value: unknown): SurveyReviewState {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    currentPhase:
      normalizeStage(record.currentPhase ?? record.current_phase) ?? null,
    topic: pickString(record, ["topic"]),
    mode: pickString(record, ["mode"]),
    years: pickString(record, ["years"]),
    venueScope: normalizeStringArray(record.venueScope ?? record.venue_scope),
    queryRegistryPath:
      pickString(record, ["queryRegistryPath", "query_registry_path"]) ??
      DEFAULT_SURVEY_QUERY_REGISTRY_PATH,
    literaturePath:
      pickString(record, ["literaturePath", "literature_path"]) ??
      DEFAULT_SURVEY_LITERATURE_PATH,
    literatureReviewPath:
      pickString(record, ["literatureReviewPath", "literature_review_path"]) ??
      DEFAULT_SURVEY_LITERATURE_REVIEW_PATH,
    reviewProtocolPath:
      pickString(record, ["reviewProtocolPath", "review_protocol_path"]) ??
      DEFAULT_SURVEY_REVIEW_PROTOCOL_PATH,
    includedPapersPath:
      pickString(record, ["includedPapersPath", "included_papers_path"]) ??
      DEFAULT_SURVEY_INCLUDED_PAPERS_PATH,
    excludedPapersPath:
      pickString(record, ["excludedPapersPath", "excluded_papers_path"]) ??
      DEFAULT_SURVEY_EXCLUDED_PAPERS_PATH,
    candidatePapersPath:
      pickString(record, ["candidatePapersPath", "candidate_papers_path"]) ??
      DEFAULT_SURVEY_CANDIDATE_PAPERS_PATH,
    screeningDecisionsPath:
      pickString(record, ["screeningDecisionsPath", "screening_decisions_path"]) ??
      DEFAULT_SURVEY_SCREENING_DECISIONS_PATH,
    sotaMatrixPath:
      pickString(record, ["sotaMatrixPath", "sota_matrix_path"]) ??
      DEFAULT_SURVEY_SOTA_MATRIX_PATH,
    gapSynthesisPath:
      pickString(record, ["gapSynthesisPath", "gap_synthesis_path"]) ??
      DEFAULT_SURVEY_GAP_SYNTHESIS_PATH,
    coverageSummaryPath:
      pickString(record, ["coverageSummaryPath", "coverage_summary_path"]) ??
      DEFAULT_SURVEY_COVERAGE_SUMMARY_PATH,
    surveyBriefPath:
      pickString(record, ["surveyBriefPath", "survey_brief_path"]) ??
      DEFAULT_SURVEY_BRIEF_PATH,
    candidatePaperCount: normalizeOptionalCount(
      record.candidatePaperCount ?? record.candidate_paper_count
    ),
    includedPaperCount: normalizeOptionalCount(
      record.includedPaperCount ?? record.included_paper_count
    ),
    excludedPaperCount: normalizeOptionalCount(
      record.excludedPaperCount ?? record.excluded_paper_count
    ),
    backgroundPaperCount: normalizeOptionalCount(
      record.backgroundPaperCount ?? record.background_paper_count
    ),
    queryRoundCount: normalizeOptionalCount(
      record.queryRoundCount ?? record.query_round_count
    ),
    pendingScreeningCount: normalizeOptionalCount(
      record.pendingScreeningCount ?? record.pending_screening_count
    ),
    pendingPlannedRoundCount: normalizeOptionalCount(
      record.pendingPlannedRoundCount ?? record.pending_planned_round_count
    ),
    graphGroundedBriefReady:
      pickBoolean(record, [
        "graphGroundedBriefReady",
        "graph_grounded_brief_ready",
      ]) ?? false,
    diagnosticsPath:
      pickString(record, ["diagnosticsPath", "diagnostics_path"]) ??
      DEFAULT_SURVEY_DIAGNOSTICS_PATH,
    gateReady:
      pickBoolean(record, ["gateReady", "gate_ready"]) ?? false,
    gateBlockingIssues: normalizeStringArray(
      record.gateBlockingIssues ?? record.gate_blocking_issues
    ),
    gateWarnings: normalizeStringArray(
      record.gateWarnings ?? record.gate_warnings
    ),
    coverageStatus: normalizeOptionalStatus(
      record.coverageStatus ?? record.coverage_status
    ),
    coverageSummary: pickString(record, ["coverageSummary", "coverage_summary"]),
    taxonomyStabilityStatus: normalizeOptionalStatus(
      record.taxonomyStabilityStatus ?? record.taxonomy_stability_status
    ),
    taxonomyStabilitySummary: pickString(record, [
      "taxonomyStabilitySummary",
      "taxonomy_stability_summary",
    ]),
    representativeMethodsStatus: normalizeOptionalStatus(
      record.representativeMethodsStatus ??
        record.representative_methods_status
    ),
    representativeMethodsSummary: pickString(record, [
      "representativeMethodsSummary",
      "representative_methods_summary",
    ]),
    benchmarkAlignmentStatus: normalizeOptionalStatus(
      record.benchmarkAlignmentStatus ?? record.benchmark_alignment_status
    ),
    benchmarkAlignmentSummary: pickString(record, [
      "benchmarkAlignmentSummary",
      "benchmark_alignment_summary",
    ]),
    topicRelevanceStatus: normalizeOptionalStatus(
      record.topicRelevanceStatus ?? record.topic_relevance_status
    ),
    topicRelevanceSummary: pickString(record, [
      "topicRelevanceSummary",
      "topic_relevance_summary",
    ]),
    gapClosureStatus: normalizeOptionalStatus(
      record.gapClosureStatus ?? record.gap_closure_status
    ),
    gapClosureSummary: pickString(record, [
      "gapClosureSummary",
      "gap_closure_summary",
    ]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

export function serializeSurveyReviewState(
  state: SurveyReviewState
): Record<string, unknown> {
  return {
    status: state.status,
    current_phase: state.currentPhase,
    topic: state.topic,
    mode: state.mode,
    years: state.years,
    venue_scope: state.venueScope,
    query_registry_path: state.queryRegistryPath,
    literature_path: state.literaturePath,
    literature_review_path: state.literatureReviewPath,
    review_protocol_path: state.reviewProtocolPath,
    included_papers_path: state.includedPapersPath,
    excluded_papers_path: state.excludedPapersPath,
    candidate_papers_path: state.candidatePapersPath,
    screening_decisions_path: state.screeningDecisionsPath,
    sota_matrix_path: state.sotaMatrixPath,
    gap_synthesis_path: state.gapSynthesisPath,
    coverage_summary_path: state.coverageSummaryPath,
    survey_brief_path: state.surveyBriefPath,
    candidate_paper_count: state.candidatePaperCount,
    included_paper_count: state.includedPaperCount,
    excluded_paper_count: state.excludedPaperCount,
    background_paper_count: state.backgroundPaperCount,
    query_round_count: state.queryRoundCount,
    pending_screening_count: state.pendingScreeningCount,
    pending_planned_round_count: state.pendingPlannedRoundCount,
    graph_grounded_brief_ready: state.graphGroundedBriefReady,
    diagnostics_path: state.diagnosticsPath,
    gate_ready: state.gateReady,
    gate_blocking_issues: state.gateBlockingIssues,
    gate_warnings: state.gateWarnings,
    coverage_status: state.coverageStatus,
    coverage_summary: state.coverageSummary,
    taxonomy_stability_status: state.taxonomyStabilityStatus,
    taxonomy_stability_summary: state.taxonomyStabilitySummary,
    representative_methods_status: state.representativeMethodsStatus,
    representative_methods_summary: state.representativeMethodsSummary,
    benchmark_alignment_status: state.benchmarkAlignmentStatus,
    benchmark_alignment_summary: state.benchmarkAlignmentSummary,
    topic_relevance_status: state.topicRelevanceStatus,
    topic_relevance_summary: state.topicRelevanceSummary,
    gap_closure_status: state.gapClosureStatus,
    gap_closure_summary: state.gapClosureSummary,
    pending_reason: state.pendingReason,
    last_updated_at: state.lastUpdatedAt,
  };
}

export function getSurveyReviewStateSummary(value: unknown): {
  state: SurveyReviewState;
  ready: boolean;
} {
  const record = asRecord(value) ?? {};
  const state = normalizeSurveyReviewState(
    record.survey_review ?? record.surveyReview ?? value
  );
  return {
    state,
    ready: state.status === "completed" && state.gateReady === true,
  };
}
