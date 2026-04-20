import { asString, normalizeStage } from "./workflow-guard-core/coercion";
import { STAGE_REQUIREMENTS } from "./workflow-guard-policies/role-policy";
import { normalizeSurveyReviewState } from "./workflow-guard-state/survey-review";
import {
  normalizeWritingContractState,
  serializeWritingContractState,
} from "./workflow-guard-state/writing-contract";

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

const SURVEY_WRITING_CONTRACT_RESET_KEYS = [
  "templateRequired",
  "template_required",
  "templatePath",
  "template_path",
  "projectTemplatePath",
  "project_template_path",
  "templateName",
  "template_name",
  "templateStatus",
  "template_status",
  "templateCopyStatus",
  "template_copy_status",
  "bodyPageBudget",
  "body_page_budget",
  "referencePageBudget",
  "reference_page_budget",
  "bodyWordTargetMin",
  "body_word_target_min",
  "bodyWordTargetMax",
  "body_word_target_max",
  "mainTextProofStyle",
  "main_text_proof_style",
  "proofAppendixRequired",
  "proof_appendix_required",
  "proofAppendixPath",
  "proof_appendix_path",
  "proofAppendixStatus",
  "proof_appendix_status",
  "proofChecklist",
  "proof_checklist",
  "storylineSource",
  "storyline_source",
  "kgStorylineRequired",
  "kg_storyline_required",
  "kgStorylineStatus",
  "kg_storyline_status",
  "kgStorylinePacketPath",
  "kg_storyline_packet_path",
  "requiredSections",
  "required_sections",
  "sectionOrder",
  "section_order",
  "pendingReason",
  "pending_reason",
];

function stripSurveyWritingContractPresetFields(contract) {
  const next = { ...(contract ?? {}) };
  for (const key of SURVEY_WRITING_CONTRACT_RESET_KEYS) {
    delete next[key];
  }
  return next;
}

function inferSurveyTopic(manifest) {
  const record = manifest ?? {};
  const surveyReview =
    record.survey_review && typeof record.survey_review === "object"
      ? record.survey_review
      : {};
  const researchProgram =
    record.research_program && typeof record.research_program === "object"
      ? record.research_program
      : {};
  return (
    asString(surveyReview.topic) ??
    asString(record.topic) ??
    asString(record.title) ??
    asString(researchProgram.goal) ??
    asString(record.project_id)
  );
}

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

export function ensureSurveyWorkflowIdentity(manifest) {
  if (!isSurveyWorkflow(manifest)) {
    return {
      manifest: manifest ?? {},
      updated: false,
    };
  }
  const record = { ...(manifest ?? {}) };
  const now = new Date().toISOString();
  const currentSurveyReview = normalizeSurveyReviewState(record.survey_review);
  const currentWritingContractRecord =
    record.writing_contract && typeof record.writing_contract === "object"
      ? record.writing_contract
      : {};
  const currentWritingContract = normalizeWritingContractState(currentWritingContractRecord);
  const topic = currentSurveyReview.topic ?? inferSurveyTopic(record);
  const nextSurveyReview = {
    ...(record.survey_review && typeof record.survey_review === "object"
      ? record.survey_review
      : {}),
    topic,
    mode: currentSurveyReview.mode ?? "survey",
    status: currentSurveyReview.status === "missing" ? "searching" : currentSurveyReview.status,
    current_phase: currentSurveyReview.currentPhase ?? "retrieval",
    last_updated_at: currentSurveyReview.lastUpdatedAt ?? now,
  };
  const nextWritingContract = serializeWritingContractState(
    normalizeWritingContractState({
      ...(currentWritingContract.paperMode === "survey"
        ? currentWritingContractRecord
        : stripSurveyWritingContractPresetFields(currentWritingContractRecord)),
      paper_mode: "survey",
    })
  );
  const next = {
    ...record,
    workflow_line: "survey",
    paper_type: "survey",
    survey_review: nextSurveyReview,
    writing_contract: nextWritingContract,
  };
  const updated =
    record.workflow_line !== next.workflow_line ||
    record.paper_type !== next.paper_type ||
    record.survey_review !== next.survey_review ||
    record.writing_contract !== next.writing_contract;
  return {
    manifest: next,
    updated,
  };
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
