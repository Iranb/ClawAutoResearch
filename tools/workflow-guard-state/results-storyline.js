import { asRecord, asStringArray, normalizeStage, pickBoolean, pickString, } from "../workflow-guard-core/coercion";
export const DEFAULT_RESULTS_QUESTION_ORDER_PATH = "academic_writer/RESULTS_QUESTION_ORDER.md";
export const DEFAULT_EXPERIMENT_EVIDENCE_SEQUENCE_PATH = "academic_writer/EXPERIMENT_EVIDENCE_SEQUENCE.json";
function normalizeQuestion(value, fallbackIndex) {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    return {
        questionId: pickString(record, ["questionId", "question_id"]) ?? `q${fallbackIndex + 1}`,
        sectionId: pickString(record, ["sectionId", "section_id"]),
        prompt: pickString(record, ["prompt", "question"]),
        objective: pickString(record, ["objective"]),
        evidenceIds: asStringArray(record.evidenceIds ?? record.evidence_ids),
        figureTableIds: asStringArray(record.figureTableIds ?? record.figure_table_ids),
        tensionIds: asStringArray(record.tensionIds ?? record.tension_ids),
        answerStatus: normalizeStage(record.answerStatus ?? record.answer_status) ?? "missing",
        searchRequired: pickBoolean(record, ["searchRequired", "search_required"]) ?? false,
    };
}
function serializeQuestion(value) {
    return {
        question_id: value.questionId,
        section_id: value.sectionId,
        prompt: value.prompt,
        objective: value.objective,
        evidence_ids: value.evidenceIds,
        figure_table_ids: value.figureTableIds,
        tension_ids: value.tensionIds,
        answer_status: value.answerStatus,
        search_required: value.searchRequired,
    };
}
export function normalizeResultsStorylineState(value) {
    const record = asRecord(value) ?? {};
    const questionsRaw = Array.isArray(record.questionOrder ?? record.question_order)
        ? (record.questionOrder ?? record.question_order)
        : [];
    const workflowLineRaw = pickString(record, ["workflowLine", "workflow_line"]) ?? null;
    const workflowLine = workflowLineRaw === "experiment" || workflowLineRaw === "survey"
        ? workflowLineRaw
        : null;
    return {
        status: normalizeStage(record.status) ?? "missing",
        workflowLine,
        storyStrategy: pickString(record, ["storyStrategy", "story_strategy"]),
        storyStrategyRationale: asStringArray(record.storyStrategyRationale ?? record.story_strategy_rationale),
        storyThesis: pickString(record, ["storyThesis", "story_thesis"]),
        intellectualCenterSection: pickString(record, [
            "intellectualCenterSection",
            "intellectual_center_section",
        ]),
        supportPacketPath: pickString(record, ["supportPacketPath", "support_packet_path"]),
        questionOrder: questionsRaw
            .map((entry, index) => normalizeQuestion(entry, index))
            .filter((entry) => Boolean(entry)),
        evidenceModules: asStringArray(record.evidenceModules ?? record.evidence_modules),
        figureTableOrder: asStringArray(record.figureTableOrder ?? record.figure_table_order),
        resultsQuestionOrderPath: pickString(record, [
            "resultsQuestionOrderPath",
            "results_question_order_path",
        ]) ?? DEFAULT_RESULTS_QUESTION_ORDER_PATH,
        experimentEvidenceSequencePath: pickString(record, [
            "experimentEvidenceSequencePath",
            "experiment_evidence_sequence_path",
        ]) ?? DEFAULT_EXPERIMENT_EVIDENCE_SEQUENCE_PATH,
        pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
        storylineFingerprint: pickString(record, [
            "storylineFingerprint",
            "storyline_fingerprint",
        ]),
        lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
    };
}
export function serializeResultsStorylineState(value) {
    return {
        status: value.status,
        workflow_line: value.workflowLine,
        story_strategy: value.storyStrategy,
        story_strategy_rationale: value.storyStrategyRationale,
        story_thesis: value.storyThesis,
        intellectual_center_section: value.intellectualCenterSection,
        support_packet_path: value.supportPacketPath,
        question_order: value.questionOrder.map((entry) => serializeQuestion(entry)),
        evidence_modules: value.evidenceModules,
        figure_table_order: value.figureTableOrder,
        results_question_order_path: value.resultsQuestionOrderPath,
        experiment_evidence_sequence_path: value.experimentEvidenceSequencePath,
        pending_reason: value.pendingReason,
        storyline_fingerprint: value.storylineFingerprint,
        last_updated_at: value.lastUpdatedAt,
    };
}
