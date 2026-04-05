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
  const paperStory = deps.asRecord(params.manifest?.paper_story_state);
  const reviewPressure = deps.asRecord(params.manifest?.review_pressure_packet);

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
    if (paperStory && deps.asString(paperStory.status) === "ready") {
      prepend.push(
        `Use the story-first packet before drafting: ${deps.asString(paperStory.story_spine_path) ?? "academic_writer/story/STORY_SPINE.md"}, ${deps.asString(paperStory.claim_to_experiment_map_path) ?? "academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md"}, ${deps.asString(paperStory.fallback_narrative_path) ?? "academic_writer/story/FALLBACK_NARRATIVE.md"}, ${deps.asString(paperStory.prewrite_rejection_simulation_path) ?? "academic_writer/PREWRITE_REJECTION_SIMULATION.md"}, ${deps.asString(paperStory.contribution_to_story_bridge_path) ?? "academic_writer/CONTRIBUTION_TO_STORY_BRIDGE.md"}, and ${deps.asString(paperStory.figure_anchor_plan_path) ?? "academic_writer/FIGURE_ANCHOR_PLAN.md"}.`
      );
      append.push(
        `Before section drafting, consult ${deps.asString(paperStory.writing_reference_bundle_path) ?? "academic_writer/WRITING_REFERENCE_BUNDLE.json"} and obey the fallback trigger at ${deps.asString(paperStory.fallback_activation_path) ?? "academic_writer/FALLBACK_ACTIVATION.json"} if it switches the narrative mode.`
      );
      append.push(
        `Keep the revision scaffold current via ${deps.asString(paperStory.revision_cycle_path) ?? "academic_writer/PAPER_REVISION_STATE.json"} so section pass, intro-method consistency, and full-paper adversarial review stay explicit.`
      );
    }
    if (reviewPressure && deps.asString(reviewPressure.status) === "ready") {
      append.push(
        `Consume the adversarial review packet before polishing prose: ${deps.asString(reviewPressure.reject_first_review_path) ?? "reviewer/story-pressure/REJECT_FIRST_REVIEW.md"}, ${deps.asString(reviewPressure.reverse_outline_path) ?? "reviewer/story-pressure/REVERSE_OUTLINE.md"}, and ${deps.asString(reviewPressure.unsupported_claim_audit_path) ?? "reviewer/story-pressure/UNSUPPORTED_CLAIM_AUDIT.md"}.`
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
  if (
    params.role === "reviewer" &&
    (params.currentStage === "review" || params.currentStage === "write" || params.currentStage === "submit") &&
    reviewPressure &&
    deps.asString(reviewPressure.status) === "ready"
  ) {
    append.push(
      `Run reject-first and novelty attack story-pressure checks from ${deps.asString(reviewPressure.reject_first_review_path) ?? "reviewer/story-pressure/REJECT_FIRST_REVIEW.md"} and ${deps.asString(reviewPressure.novelty_attack_path) ?? "reviewer/story-pressure/NOVELTY_ATTACK.md"} before signing off on the manuscript arc.`
    );
  }

  return { prepend, append };
}
