import {
  asRecord,
  normalizeStage,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";
import type { PaperStoryState } from "../workflow-guard.js";

const DEFAULT_PAPER_STORY_DIR = "academic_writer/story";
const DEFAULT_PAPER_STORY_TASK_SUMMARY_PATH =
  `${DEFAULT_PAPER_STORY_DIR}/TASK_SUMMARY.md`;
const DEFAULT_PAPER_STORY_CHALLENGE_STATEMENT_PATH =
  `${DEFAULT_PAPER_STORY_DIR}/CHALLENGE_STATEMENT.md`;
const DEFAULT_PAPER_STORY_INSIGHT_SUMMARY_PATH =
  `${DEFAULT_PAPER_STORY_DIR}/INSIGHT_SUMMARY.md`;
const DEFAULT_PAPER_STORY_CONTRIBUTION_MAP_PATH =
  `${DEFAULT_PAPER_STORY_DIR}/CONTRIBUTION_MAP.md`;
const DEFAULT_PAPER_STORY_ADVANTAGE_MAP_PATH =
  `${DEFAULT_PAPER_STORY_DIR}/ADVANTAGE_MAP.md`;
const DEFAULT_PAPER_STORY_SPINE_PATH =
  `${DEFAULT_PAPER_STORY_DIR}/STORY_SPINE.md`;
const DEFAULT_PAPER_STORY_PIPELINE_SKETCH_PATH =
  `${DEFAULT_PAPER_STORY_DIR}/PIPELINE_FIGURE_SKETCH.md`;
const DEFAULT_PAPER_STORY_MODULE_MOTIVATION_MAP_PATH =
  `${DEFAULT_PAPER_STORY_DIR}/MODULE_MOTIVATION_MAP.md`;
const DEFAULT_PAPER_STORY_CLAIM_MAP_PATH =
  `${DEFAULT_PAPER_STORY_DIR}/CLAIM_TO_EXPERIMENT_MAP.md`;
const DEFAULT_PAPER_STORY_FALLBACK_NARRATIVE_PATH =
  `${DEFAULT_PAPER_STORY_DIR}/FALLBACK_NARRATIVE.md`;
const DEFAULT_PAPER_STORY_REJECTION_RISK_TABLE_PATH =
  `${DEFAULT_PAPER_STORY_DIR}/REJECTION_RISK_TABLE.md`;

export function normalizePaperStoryState(value: unknown): PaperStoryState {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    contractVersion:
      Math.max(
        1,
        Math.floor(
          pickNumber(record, ["contractVersion", "contract_version"]) ?? 1
        )
      ),
    taskSummaryPath:
      pickString(record, ["taskSummaryPath", "task_summary_path"]) ??
      DEFAULT_PAPER_STORY_TASK_SUMMARY_PATH,
    challengeStatementPath:
      pickString(record, [
        "challengeStatementPath",
        "challenge_statement_path",
      ]) ?? DEFAULT_PAPER_STORY_CHALLENGE_STATEMENT_PATH,
    insightSummaryPath:
      pickString(record, ["insightSummaryPath", "insight_summary_path"]) ??
      DEFAULT_PAPER_STORY_INSIGHT_SUMMARY_PATH,
    contributionMapPath:
      pickString(record, ["contributionMapPath", "contribution_map_path"]) ??
      DEFAULT_PAPER_STORY_CONTRIBUTION_MAP_PATH,
    advantageMapPath:
      pickString(record, ["advantageMapPath", "advantage_map_path"]) ??
      DEFAULT_PAPER_STORY_ADVANTAGE_MAP_PATH,
    storySpinePath:
      pickString(record, ["storySpinePath", "story_spine_path"]) ??
      DEFAULT_PAPER_STORY_SPINE_PATH,
    pipelineFigureSketchPath:
      pickString(record, [
        "pipelineFigureSketchPath",
        "pipeline_figure_sketch_path",
      ]) ?? DEFAULT_PAPER_STORY_PIPELINE_SKETCH_PATH,
    moduleMotivationMapPath:
      pickString(record, [
        "moduleMotivationMapPath",
        "module_motivation_map_path",
      ]) ?? DEFAULT_PAPER_STORY_MODULE_MOTIVATION_MAP_PATH,
    claimToExperimentMapPath:
      pickString(record, [
        "claimToExperimentMapPath",
        "claim_to_experiment_map_path",
      ]) ?? DEFAULT_PAPER_STORY_CLAIM_MAP_PATH,
    fallbackNarrativePath:
      pickString(record, [
        "fallbackNarrativePath",
        "fallback_narrative_path",
      ]) ?? DEFAULT_PAPER_STORY_FALLBACK_NARRATIVE_PATH,
    rejectionRiskTablePath:
      pickString(record, [
        "rejectionRiskTablePath",
        "rejection_risk_table_path",
      ]) ?? DEFAULT_PAPER_STORY_REJECTION_RISK_TABLE_PATH,
    claimEvidenceMatrixPath:
      pickString(record, [
        "claimEvidenceMatrixPath",
        "claim_evidence_matrix_path",
      ]) ?? "analyzer/CLAIM_EVIDENCE_MATRIX.md",
    trackVerdictsPath:
      pickString(record, ["trackVerdictsPath", "track_verdicts_path"]) ??
      "analyzer/TRACK_VERDICTS.md",
    unsupportedClaimsPath:
      pickString(record, ["unsupportedClaimsPath", "unsupported_claims_path"]) ??
      "analyzer/UNSUPPORTED_CLAIMS.md",
    claimSupportStatus:
      normalizeStage(record.claimSupportStatus ?? record.claim_support_status) ?? "missing",
    supportedClaimCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["supportedClaimCount", "supported_claim_count"]) ?? 0
      )
    ),
    partialClaimCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["partialClaimCount", "partial_claim_count"]) ?? 0
      )
    ),
    unsupportedClaimCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["unsupportedClaimCount", "unsupported_claim_count"]) ?? 0
      )
    ),
    storylineSourceTrackId:
      pickString(record, ["storylineSourceTrackId", "storyline_source_track_id"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

export function serializePaperStoryState(
  value: PaperStoryState
): Record<string, unknown> {
  return {
    status: value.status,
    contract_version: value.contractVersion,
    task_summary_path: value.taskSummaryPath,
    challenge_statement_path: value.challengeStatementPath,
    insight_summary_path: value.insightSummaryPath,
    contribution_map_path: value.contributionMapPath,
    advantage_map_path: value.advantageMapPath,
    story_spine_path: value.storySpinePath,
    pipeline_figure_sketch_path: value.pipelineFigureSketchPath,
    module_motivation_map_path: value.moduleMotivationMapPath,
    claim_to_experiment_map_path: value.claimToExperimentMapPath,
    fallback_narrative_path: value.fallbackNarrativePath,
    rejection_risk_table_path: value.rejectionRiskTablePath,
    claim_evidence_matrix_path: value.claimEvidenceMatrixPath,
    track_verdicts_path: value.trackVerdictsPath,
    unsupported_claims_path: value.unsupportedClaimsPath,
    claim_support_status: value.claimSupportStatus,
    supported_claim_count: value.supportedClaimCount,
    partial_claim_count: value.partialClaimCount,
    unsupported_claim_count: value.unsupportedClaimCount,
    storyline_source_track_id: value.storylineSourceTrackId,
    pending_reason: value.pendingReason,
    last_updated_at: value.lastUpdatedAt,
  };
}
