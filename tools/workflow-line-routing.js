import { asString, normalizeStage } from "./workflow-guard-core/coercion";
import { STAGE_REQUIREMENTS } from "./workflow-guard-policies/role-policy";
import { normalizeSurveyReviewState } from "./workflow-guard-state/survey-review";
import { normalizeWritingContractState } from "./workflow-guard-state/writing-contract";

const SURVEY_WORKFLOW_RECOVERY_STAGES = new Set([
  "setup",
  "graph_build",
  "frontier_mapping",
  "idea",
  "plan",
  "code",
  "experiment",
  "analyze",
  "review",
]);

export function isSurveyWorkflow(manifest) {
  const record = manifest ?? {};
  const currentStage = normalizeStage(record.current_stage);
  if (currentStage === "survey_review") {
    return true;
  }

  const writingContract = normalizeWritingContractState(record.writing_contract);
  if (writingContract.paperMode === "survey") {
    return true;
  }

  const surveyReview = normalizeSurveyReviewState(record.survey_review);
  if (surveyReview.status !== "missing" || Boolean(surveyReview.topic)) {
    return true;
  }

  const projectId = asString(record.project_id)?.toLowerCase() ?? "";
  return projectId.startsWith("survey-");
}

export function resolveStageForWorkflowLine(params) {
  const stage = normalizeStage(params.stage);
  if (!isSurveyWorkflow(params.manifest)) {
    return stage;
  }
  if (!stage) {
    return "survey_review";
  }
  return SURVEY_WORKFLOW_RECOVERY_STAGES.has(stage) ? "survey_review" : stage;
}

export function resolveNextStageForWorkflow(params) {
  const stage = normalizeStage(params.stage);
  if (!stage) {
    return null;
  }
  if (!isSurveyWorkflow(params.manifest)) {
    return STAGE_REQUIREMENTS[stage]?.nextStage ?? null;
  }

  switch (stage) {
    case "setup":
    case "graph_build":
    case "frontier_mapping":
    case "idea":
    case "plan":
    case "code":
    case "experiment":
    case "analyze":
    case "review":
      return "survey_review";
    case "survey_review":
      return "write";
    case "write":
      return "submit";
    case "submit":
      return "done";
    case "revise":
      return "write";
    case "done":
      return "done";
    default:
      return STAGE_REQUIREMENTS[stage]?.nextStage ?? null;
  }
}
