import {
  asRecord,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";

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
  sotaMatrixPath: string | null;
  gapSynthesisPath: string | null;
  coverageSummaryPath: string | null;
  surveyBriefPath: string | null;
  candidatePaperCount: number | null;
  includedPaperCount: number | null;
  excludedPaperCount: number | null;
  queryRoundCount: number | null;
  graphGroundedBriefReady: boolean;
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
export const DEFAULT_SURVEY_SOTA_MATRIX_PATH = `${DEFAULT_SURVEY_DIR}/SOTA_MATRIX.md`;
export const DEFAULT_SURVEY_GAP_SYNTHESIS_PATH =
  `${DEFAULT_SURVEY_DIR}/GAP_SYNTHESIS.md`;
export const DEFAULT_SURVEY_COVERAGE_SUMMARY_PATH =
  `${DEFAULT_SURVEY_DIR}/COVERAGE_SUMMARY.md`;
export const DEFAULT_SURVEY_BRIEF_PATH = `${DEFAULT_SURVEY_DIR}/SURVEY_BRIEF.md`;

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
    queryRoundCount: normalizeOptionalCount(
      record.queryRoundCount ?? record.query_round_count
    ),
    graphGroundedBriefReady:
      pickBoolean(record, [
        "graphGroundedBriefReady",
        "graph_grounded_brief_ready",
      ]) ?? false,
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
    sota_matrix_path: state.sotaMatrixPath,
    gap_synthesis_path: state.gapSynthesisPath,
    coverage_summary_path: state.coverageSummaryPath,
    survey_brief_path: state.surveyBriefPath,
    candidate_paper_count: state.candidatePaperCount,
    included_paper_count: state.includedPaperCount,
    excluded_paper_count: state.excludedPaperCount,
    query_round_count: state.queryRoundCount,
    graph_grounded_brief_ready: state.graphGroundedBriefReady,
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
    ready: state.status === "completed",
  };
}
