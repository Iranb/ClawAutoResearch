import { asRecord, normalizeStage, pickNumber, pickString, } from "../workflow-guard-core/coercion";
const DEFAULT_PAPER_STORY_DIR = "academic_writer/story";
const DEFAULT_PAPER_STORY_TASK_SUMMARY_PATH = `${DEFAULT_PAPER_STORY_DIR}/TASK_SUMMARY.md`;
const DEFAULT_PAPER_STORY_CHALLENGE_STATEMENT_PATH = `${DEFAULT_PAPER_STORY_DIR}/CHALLENGE_STATEMENT.md`;
const DEFAULT_PAPER_STORY_INSIGHT_SUMMARY_PATH = `${DEFAULT_PAPER_STORY_DIR}/INSIGHT_SUMMARY.md`;
const DEFAULT_PAPER_STORY_CONTRIBUTION_MAP_PATH = `${DEFAULT_PAPER_STORY_DIR}/CONTRIBUTION_MAP.md`;
const DEFAULT_PAPER_STORY_ADVANTAGE_MAP_PATH = `${DEFAULT_PAPER_STORY_DIR}/ADVANTAGE_MAP.md`;
const DEFAULT_PAPER_STORY_SPINE_PATH = `${DEFAULT_PAPER_STORY_DIR}/STORY_SPINE.md`;
const DEFAULT_PAPER_STORY_PIPELINE_SKETCH_PATH = `${DEFAULT_PAPER_STORY_DIR}/PIPELINE_FIGURE_SKETCH.md`;
const DEFAULT_PAPER_STORY_MODULE_MOTIVATION_MAP_PATH = `${DEFAULT_PAPER_STORY_DIR}/MODULE_MOTIVATION_MAP.md`;
const DEFAULT_PAPER_STORY_CLAIM_MAP_PATH = `${DEFAULT_PAPER_STORY_DIR}/CLAIM_TO_EXPERIMENT_MAP.md`;
const DEFAULT_PAPER_STORY_IDEA_TO_CLAIM_MAP_PATH = "researcher/idea-catalyst/IDEA_TO_CLAIM_MAP.json";
const DEFAULT_PAPER_STORY_FALLBACK_NARRATIVE_PATH = `${DEFAULT_PAPER_STORY_DIR}/FALLBACK_NARRATIVE.md`;
const DEFAULT_PAPER_STORY_REJECTION_RISK_TABLE_PATH = `${DEFAULT_PAPER_STORY_DIR}/REJECTION_RISK_TABLE.md`;
const DEFAULT_PAPER_STORY_WRITING_REFERENCE_BUNDLE_PATH = "academic_writer/WRITING_REFERENCE_BUNDLE.json";
const DEFAULT_PAPER_STORY_FALLBACK_ACTIVATION_PATH = "academic_writer/FALLBACK_ACTIVATION.json";
const DEFAULT_PAPER_STORY_REVISION_CYCLE_PATH = "academic_writer/PAPER_REVISION_STATE.json";
const DEFAULT_PAPER_STORY_PREWRITE_REJECTION_SIMULATION_PATH = "academic_writer/PREWRITE_REJECTION_SIMULATION.md";
const DEFAULT_PAPER_STORY_CONTRIBUTION_TO_STORY_BRIDGE_PATH = "academic_writer/CONTRIBUTION_TO_STORY_BRIDGE.md";
const DEFAULT_PAPER_STORY_FIGURE_ANCHOR_PLAN_PATH = "academic_writer/FIGURE_ANCHOR_PLAN.md";
const DEFAULT_PAPER_STORY_SURVEY_STORYLINE_PACKET_PATH = "academic_writer/SURVEY_STORYLINE_PACKET.json";
const DEFAULT_PAPER_STORY_SURVEY_STORYLINE_MEMO_PATH = "academic_writer/SURVEY_STORYLINE_PACKET.md";
export function normalizePaperStoryState(value) {
    const record = asRecord(value) ?? {};
    return {
        status: normalizeStage(record.status) ?? "missing",
        contractVersion: Math.max(1, Math.floor(pickNumber(record, ["contractVersion", "contract_version"]) ?? 1)),
        taskSummaryPath: pickString(record, ["taskSummaryPath", "task_summary_path"]) ??
            DEFAULT_PAPER_STORY_TASK_SUMMARY_PATH,
        challengeStatementPath: pickString(record, [
            "challengeStatementPath",
            "challenge_statement_path",
        ]) ?? DEFAULT_PAPER_STORY_CHALLENGE_STATEMENT_PATH,
        insightSummaryPath: pickString(record, ["insightSummaryPath", "insight_summary_path"]) ??
            DEFAULT_PAPER_STORY_INSIGHT_SUMMARY_PATH,
        contributionMapPath: pickString(record, ["contributionMapPath", "contribution_map_path"]) ??
            DEFAULT_PAPER_STORY_CONTRIBUTION_MAP_PATH,
        advantageMapPath: pickString(record, ["advantageMapPath", "advantage_map_path"]) ??
            DEFAULT_PAPER_STORY_ADVANTAGE_MAP_PATH,
        storySpinePath: pickString(record, ["storySpinePath", "story_spine_path"]) ??
            DEFAULT_PAPER_STORY_SPINE_PATH,
        pipelineFigureSketchPath: pickString(record, [
            "pipelineFigureSketchPath",
            "pipeline_figure_sketch_path",
        ]) ?? DEFAULT_PAPER_STORY_PIPELINE_SKETCH_PATH,
        moduleMotivationMapPath: pickString(record, [
            "moduleMotivationMapPath",
            "module_motivation_map_path",
        ]) ?? DEFAULT_PAPER_STORY_MODULE_MOTIVATION_MAP_PATH,
        claimToExperimentMapPath: pickString(record, [
            "claimToExperimentMapPath",
            "claim_to_experiment_map_path",
        ]) ?? DEFAULT_PAPER_STORY_CLAIM_MAP_PATH,
        ideaToClaimMapPath: pickString(record, ["ideaToClaimMapPath", "idea_to_claim_map_path"]) ??
            DEFAULT_PAPER_STORY_IDEA_TO_CLAIM_MAP_PATH,
        fallbackNarrativePath: pickString(record, [
            "fallbackNarrativePath",
            "fallback_narrative_path",
        ]) ?? DEFAULT_PAPER_STORY_FALLBACK_NARRATIVE_PATH,
        rejectionRiskTablePath: pickString(record, [
            "rejectionRiskTablePath",
            "rejection_risk_table_path",
        ]) ?? DEFAULT_PAPER_STORY_REJECTION_RISK_TABLE_PATH,
        writingReferenceBundlePath: pickString(record, [
            "writingReferenceBundlePath",
            "writing_reference_bundle_path",
        ]) ?? DEFAULT_PAPER_STORY_WRITING_REFERENCE_BUNDLE_PATH,
        fallbackActivationPath: pickString(record, [
            "fallbackActivationPath",
            "fallback_activation_path",
        ]) ?? DEFAULT_PAPER_STORY_FALLBACK_ACTIVATION_PATH,
        revisionCyclePath: pickString(record, ["revisionCyclePath", "revision_cycle_path"]) ??
            DEFAULT_PAPER_STORY_REVISION_CYCLE_PATH,
        prewriteRejectionSimulationPath: pickString(record, [
            "prewriteRejectionSimulationPath",
            "prewrite_rejection_simulation_path",
        ]) ?? DEFAULT_PAPER_STORY_PREWRITE_REJECTION_SIMULATION_PATH,
        contributionToStoryBridgePath: pickString(record, [
            "contributionToStoryBridgePath",
            "contribution_to_story_bridge_path",
        ]) ?? DEFAULT_PAPER_STORY_CONTRIBUTION_TO_STORY_BRIDGE_PATH,
        figureAnchorPlanPath: pickString(record, ["figureAnchorPlanPath", "figure_anchor_plan_path"]) ??
            DEFAULT_PAPER_STORY_FIGURE_ANCHOR_PLAN_PATH,
        surveyStorylinePacketPath: pickString(record, [
            "surveyStorylinePacketPath",
            "survey_storyline_packet_path",
        ]) ?? DEFAULT_PAPER_STORY_SURVEY_STORYLINE_PACKET_PATH,
        surveyStorylineMemoPath: pickString(record, [
            "surveyStorylineMemoPath",
            "survey_storyline_memo_path",
        ]) ?? DEFAULT_PAPER_STORY_SURVEY_STORYLINE_MEMO_PATH,
        claimEvidenceMatrixPath: pickString(record, [
            "claimEvidenceMatrixPath",
            "claim_evidence_matrix_path",
        ]) ?? "analyzer/CLAIM_EVIDENCE_MATRIX.md",
        trackVerdictsPath: pickString(record, ["trackVerdictsPath", "track_verdicts_path"]) ??
            "analyzer/TRACK_VERDICTS.md",
        unsupportedClaimsPath: pickString(record, ["unsupportedClaimsPath", "unsupported_claims_path"]) ??
            "analyzer/UNSUPPORTED_CLAIMS.md",
        claimSupportStatus: normalizeStage(record.claimSupportStatus ?? record.claim_support_status) ?? "missing",
        supportedClaimCount: Math.max(0, Math.floor(pickNumber(record, ["supportedClaimCount", "supported_claim_count"]) ?? 0)),
        partialClaimCount: Math.max(0, Math.floor(pickNumber(record, ["partialClaimCount", "partial_claim_count"]) ?? 0)),
        unsupportedClaimCount: Math.max(0, Math.floor(pickNumber(record, ["unsupportedClaimCount", "unsupported_claim_count"]) ?? 0)),
        storylineSourceTrackId: pickString(record, ["storylineSourceTrackId", "storyline_source_track_id"]),
        pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
        lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
    };
}
export function serializePaperStoryState(value) {
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
        idea_to_claim_map_path: value.ideaToClaimMapPath,
        fallback_narrative_path: value.fallbackNarrativePath,
        rejection_risk_table_path: value.rejectionRiskTablePath,
        writing_reference_bundle_path: value.writingReferenceBundlePath,
        fallback_activation_path: value.fallbackActivationPath,
        revision_cycle_path: value.revisionCyclePath,
        prewrite_rejection_simulation_path: value.prewriteRejectionSimulationPath,
        contribution_to_story_bridge_path: value.contributionToStoryBridgePath,
        figure_anchor_plan_path: value.figureAnchorPlanPath,
        survey_storyline_packet_path: value.surveyStorylinePacketPath,
        survey_storyline_memo_path: value.surveyStorylineMemoPath,
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
export function materializePaperStoryFromClaims(currentState, reconciliation) {
    return {
        ...currentState,
        claimSupportStatus: reconciliation.claimSupportStatus,
        supportedClaimCount: reconciliation.supportedClaimCount,
        partialClaimCount: reconciliation.partialClaimCount,
        unsupportedClaimCount: reconciliation.unsupportedClaimCount,
        lastUpdatedAt: reconciliation.reconciledAt,
    };
}
