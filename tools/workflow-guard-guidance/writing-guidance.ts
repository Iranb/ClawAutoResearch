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
  const writingFlowMap =
    "Writing flow map: write builds or revises manuscript artifacts, review stress-tests them, submit packages the final response bundle, and any revise verdict should route back into another targeted write pass instead of widening scope.";

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
    prepend.push(writingFlowMap);
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
      append.push(
        "Revision loop rule: when review or cross-review returns revise, expect the next pass to be targeted. Update only the cited artifacts, preserve the rest of the manuscript state, then hand control back through auto_iterator_tick."
      );
      append.push(
        "Treat the writing-quality sweep, reader-journey check, and claim-verification sweep as mandatory before section sign-off, not optional polish."
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
    if (params.currentStage === "review" || params.currentStage === "submit") {
      append.push(
        "Before review/submit closeout, make sure the manuscript has explicit method-comparison tables plus at least one comparison-oriented figure, and discuss strengths/weaknesses from multiple angles instead of only best-case numbers."
      );
      append.push(
        "Post-review rule: answer reviewer-raised points in academic_writer/paper/sections/appendix_reviewer_responses.tex using detailed paragraphs. Tables and figures are allowed and encouraged when they clarify the response better than prose alone."
      );
    }
    if (params.writingContract.paperMode === "survey") {
      append.push(
        "Survey visualization rule: use academic_writer/SURVEY_VISUALIZATION_PLAN.md to plan taxonomy figures and multi-table comparison layouts before treating the draft as structurally complete."
      );
    }
  }

  if (
    params.role === "reviewer" &&
    (params.currentStage === "submit" || params.currentStage === "write") &&
    params.citationIntegrity.enabled &&
    params.citationIntegrity.verificationRequired
  ) {
    prepend.push(writingFlowMap);
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
    append.push(
      "Review routing rule: use pass/revise/block as workflow control signals. Revise should describe bounded repair work that can be handed back to Writer, not a vague request to rethink the whole paper."
    );
  }

  if (params.role === "cross-reviewer") {
    prepend.push(writingFlowMap);
    append.push(
      "Cross-review rule: act like an independent late-stage critic. When you return revise, make the packet precise enough that Writer can answer it in one bounded revision pass or in the rebuttal appendix."
    );
  }

  return { prepend, append };
}
