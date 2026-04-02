import type {
  BuildDynamicTasksDeps,
  BuildDynamicTasksParams,
  GuidanceContribution,
} from "./types";

export function buildWritingGuidance(
  params: BuildDynamicTasksParams,
  deps: BuildDynamicTasksDeps
): GuidanceContribution {
  const prepend: string[] = [];
  const append: string[] = [];

  if (
    params.role === "researcher" &&
    params.currentStage === "write" &&
    params.writingContract.templateRequired &&
    params.writingTemplateStatus === "missing"
  ) {
    prepend.push(
      "Writer cannot start safely because the required writing template is missing; restore it with research_workflow.set_writing_contract before waking Academic Writer."
    );
  }

  if (params.role === "academic_writer") {
    if (params.writingContract.paperMode) {
      prepend.push(
        `Honor writing mode ${params.writingContract.paperMode}: body=${params.writingContract.bodyPageBudget ?? "unset"} pages, refs=${params.writingContract.referencePageBudget ?? "unset"} pages, body_words=${params.writingContract.bodyWordTargetMin ?? "unset"}-${params.writingContract.bodyWordTargetMax ?? "unset"}.`
      );
    }
    if (
      params.writingContract.templateRequired &&
      params.writingTemplateStatus === "missing"
    ) {
      prepend.push(
        "Writing template is required but missing; restore it through research_workflow.set_writing_contract before editing PAPER_PLAN.md or paper sections."
      );
    } else if (params.writingTemplatePath) {
      prepend.push(
        `Read the writing template at ${params.writingTemplatePath} before changing PAPER_PLAN.md or drafting a new section.`
      );
    }
    if (params.writingContract.kgStorylineRequired) {
      prepend.push(
        `Use the KG storyline packet at ${params.writingContract.kgStorylinePacketPath ?? deps.DEFAULT_KG_STORYLINE_PACKET_PATH} to keep a single thesis, gap, method, and evidence spine.`
      );
      if (params.writingContract.kgStorylineStatus !== "ready") {
        append.push(
          "KG storyline packet is not ready yet; finish the knowledge-graph storyline contract before broadening the prose."
        );
      }
    }
    if (params.writingContract.templateMappingPath) {
      append.push(
        `Keep template adaptation notes aligned with ${params.writingContract.templateMappingPath}.`
      );
    }
    if (params.paragraphLogicStatus !== "green") {
      append.push(
        "Run a reverse-outline and paragraph-bridge audit before finalizing the current section; keep WRITING_SIGNALS.md visible."
      );
    }
    if (params.writingContractPendingReason) {
      append.push(`Writing contract pending: ${params.writingContractPendingReason}`);
    }
    if (params.citationIntegrity.enabled) {
      append.push(
        `Citations must come from real sources of truth (${params.citationIntegrity.sourceOfTruth.join(", ")}). Keep placeholders <= ${params.citationIntegrity.allowedPlaceholderCount}.`
      );
    }
  }

  if (
    params.role === "reviewer" &&
    (params.currentStage === "submit" || params.currentStage === "write") &&
    params.citationIntegrity.enabled &&
    params.citationIntegrity.verificationRequired
  ) {
    prepend.push(
      `Run the citation integrity gate before submission and update ${params.citationReportPath ?? deps.DEFAULT_CITATION_REPORT_PATH}.`
    );
    if (params.citationIntegrity.verificationStatus !== "verified") {
      append.push(
        `Citation verification is ${params.citationIntegrity.verificationStatus}; do not finalize submission until it becomes verified.`
      );
    }
  }

  return { prepend, append };
}
