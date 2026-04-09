import type {
  BuildDynamicTasksDeps,
  BuildDynamicTasksParams,
  GuidanceContribution,
} from "./types";

export function buildExperimentReviewGuidance(
  params: BuildDynamicTasksParams,
  _deps: BuildDynamicTasksDeps
): GuidanceContribution {
  const prepend: string[] = [];
  const append: string[] = [];

  if (
    params.currentStage !== "experiment" ||
    params.experimentReviewMode !== "reviewed_auto"
  ) {
    return { prepend, append };
  }

  const packetPath =
    params.experimentReviewPacketPath ?? "planner/EXPERIMENT_REVIEW_PACKET.json";
  const plannerPlanPath =
    params.experimentReviewPlannerPlanPath ?? "planner/EXPERIMENT_PLAN.md";
  const analyzerReportPath =
    params.experimentReviewAnalyzerReportPath ??
    "analyzer/EXPERIMENT_REASONABLENESS_REPORT.md";
  const crossReviewerReportPath =
    params.experimentReviewCrossReviewerReportPath ??
    "cross-reviewer/EXPERIMENT_ATTACK_REPORT.md";
  const launchDecisionPath =
    params.experimentReviewLaunchDecisionPath ??
    "researcher/EXPERIMENT_LAUNCH_DECISION.json";

  if (params.role === "planner") {
    prepend.push(
      `Reviewed-auto launch is active. Refresh ${packetPath} and ${plannerPlanPath} so claim coverage, one-variable change, baselines, falsifiers, stop rules, compute budget, and PaperNexus-backed norms are explicit before reviewer passes begin.`
    );
  }

  if (params.role === "analyzer") {
    prepend.push(
      `Reviewed-auto launch is active. Audit ${packetPath} for attribution purity, baseline fairness, metric sufficiency, seed adequacy, stop-rule sanity, and expected artifact completeness, then persist ${analyzerReportPath} and mirror the verdict through research_workflow.set_experiment_review_state.`
    );
  }

  if (params.role === "cross-reviewer") {
    prepend.push(
      `Reviewed-auto launch is active. Attack ${packetPath} independently, record novelty/confound/cherry-picking/falsifier risks in ${crossReviewerReportPath}, and mirror any critical blocker through research_workflow.set_experiment_review_state without editing other project areas.`
    );
  }

  if (params.role === "researcher") {
    prepend.push(
      `Experiment launch is in reviewed_auto mode. Synthesize ${plannerPlanPath}, ${analyzerReportPath}, and ${crossReviewerReportPath}, then record the autonomous launch verdict in ${launchDecisionPath}; do not wake Coder until launch_approved is truly justified.`
    );
    if (params.experimentReviewPendingReason) {
      append.push(`Experiment review pending: ${params.experimentReviewPendingReason}`);
    }
  }

  if (params.role === "coder") {
    prepend.push(
      `Launch only from the approved reviewed-auto packet. Require ${launchDecisionPath} with launch_approved=true plus a stable packet fingerprint before running /run-experiment; otherwise bounce back to Researcher.`
    );
  }

  if (
    params.role === "researcher" &&
    params.experimentReviewStatus === "ready_for_launch" &&
    params.experimentReviewLaunchApproved
  ) {
    append.push(
      "The reviewed packet is approved; the next bounded handoff should go to Coder for launch, and monitor mode should take over once remote runs exist."
    );
  }

  return { prepend, append };
}
