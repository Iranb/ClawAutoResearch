import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickString,
} from "../workflow-guard-core/coercion";

export type ResultsStorylineQuestion = {
  questionId: string;
  prompt: string | null;
  objective: string | null;
  evidenceIds: string[];
  figureTableIds: string[];
  answerStatus: string;
  searchRequired: boolean;
};

export type ResultsStorylineState = {
  status: string;
  workflowLine: "experiment" | "survey" | null;
  questionOrder: ResultsStorylineQuestion[];
  evidenceModules: string[];
  figureTableOrder: string[];
  resultsQuestionOrderPath: string | null;
  experimentEvidenceSequencePath: string | null;
  pendingReason: string | null;
  storylineFingerprint: string | null;
  lastUpdatedAt: string | null;
};

export const DEFAULT_RESULTS_QUESTION_ORDER_PATH =
  "academic_writer/RESULTS_QUESTION_ORDER.md";
export const DEFAULT_EXPERIMENT_EVIDENCE_SEQUENCE_PATH =
  "academic_writer/EXPERIMENT_EVIDENCE_SEQUENCE.json";

function normalizeQuestion(
  value: unknown,
  fallbackIndex: number
): ResultsStorylineQuestion | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return {
    questionId:
      pickString(record, ["questionId", "question_id"]) ?? `q${fallbackIndex + 1}`,
    prompt: pickString(record, ["prompt", "question"]),
    objective: pickString(record, ["objective"]),
    evidenceIds: asStringArray(record.evidenceIds ?? record.evidence_ids),
    figureTableIds: asStringArray(record.figureTableIds ?? record.figure_table_ids),
    answerStatus:
      normalizeStage(record.answerStatus ?? record.answer_status) ?? "missing",
    searchRequired:
      pickBoolean(record, ["searchRequired", "search_required"]) ?? false,
  };
}

function serializeQuestion(
  value: ResultsStorylineQuestion
): Record<string, unknown> {
  return {
    question_id: value.questionId,
    prompt: value.prompt,
    objective: value.objective,
    evidence_ids: value.evidenceIds,
    figure_table_ids: value.figureTableIds,
    answer_status: value.answerStatus,
    search_required: value.searchRequired,
  };
}

export function normalizeResultsStorylineState(
  value: unknown
): ResultsStorylineState {
  const record = asRecord(value) ?? {};
  const questionsRaw = Array.isArray(record.questionOrder ?? record.question_order)
    ? ((record.questionOrder ?? record.question_order) as unknown[])
    : [];
  const workflowLineRaw =
    pickString(record, ["workflowLine", "workflow_line"]) ?? null;
  const workflowLine =
    workflowLineRaw === "experiment" || workflowLineRaw === "survey"
      ? workflowLineRaw
      : null;
  return {
    status: normalizeStage(record.status) ?? "missing",
    workflowLine,
    questionOrder: questionsRaw
      .map((entry, index) => normalizeQuestion(entry, index))
      .filter((entry): entry is ResultsStorylineQuestion => Boolean(entry)),
    evidenceModules: asStringArray(
      record.evidenceModules ?? record.evidence_modules
    ),
    figureTableOrder: asStringArray(
      record.figureTableOrder ?? record.figure_table_order
    ),
    resultsQuestionOrderPath:
      pickString(record, [
        "resultsQuestionOrderPath",
        "results_question_order_path",
      ]) ?? DEFAULT_RESULTS_QUESTION_ORDER_PATH,
    experimentEvidenceSequencePath:
      pickString(record, [
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

export function serializeResultsStorylineState(
  value: ResultsStorylineState
): Record<string, unknown> {
  return {
    status: value.status,
    workflow_line: value.workflowLine,
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
