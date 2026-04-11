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
  const explicitWorkflowLine =
    asString(record.workflow_line) ??
    asString(record.workflowLine) ??
    asString(record.project_type) ??
    asString(record.projectType) ??
    asString(record.paper_type) ??
    asString(record.paperType);
  if (/^(survey|survey_review|review_paper|literature_review)$/i.test(explicitWorkflowLine ?? "")) {
    return true;
  }
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
  if (/(^|[-_])survey([-_]|$)/.test(projectId)) {
    return true;
  }

  const researchProgram =
    record.research_program && typeof record.research_program === "object"
      ? record.research_program
      : {};
  const researchProgramText = [
    asString(researchProgram.goal),
    asString(researchProgram.problem_statement),
    asString(researchProgram.problemStatement),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\b(survey|literature review|systematic review|综述)\b/.test(
    researchProgramText
  );
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
