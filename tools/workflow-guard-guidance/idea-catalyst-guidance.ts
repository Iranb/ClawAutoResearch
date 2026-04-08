import type {
  BuildDynamicTasksDeps,
  BuildDynamicTasksParams,
  GuidanceContribution,
} from "./types";

export function buildIdeaCatalystGuidance(
  params: BuildDynamicTasksParams,
  deps: BuildDynamicTasksDeps
): GuidanceContribution {
  const prepend: string[] = [];
  const append: string[] = [];
  const ideaCatalyst = deps.normalizeIdeaCatalystState(
    params.manifest?.idea_catalyst
  );

  if (
    params.role === "researcher" &&
    ["idea", "plan"].includes(params.currentStage ?? "") &&
    (ideaCatalyst.requisitionRequired || ideaCatalyst.status === "requisition")
  ) {
    prepend.push(
      `IDEA-CATALYST investigation requisition is active; read {PROJ}/${ideaCatalyst.investigationRequisitionPath}, treat it as the decision boundary for sufficiency, collect the requested cross-domain papers and bridge evidence, queue imports with research_workflow.queue_paper_ingestion, rerun /graph-build, then resume the graph-grounded IDEA-CATALYST sub-pipeline before advancing to PLAN.`
    );
  }

  return { prepend, append };
}
