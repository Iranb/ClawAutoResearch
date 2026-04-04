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
      `IDEA-CATALYST requisition is active; satisfy {PROJ}/${ideaCatalyst.investigationRequisitionPath} by collecting the requested cross-domain papers, queueing imports with research_workflow.queue_paper_ingestion, then rerunning /graph-build before resuming IDEA integration.`
    );
  }

  return { prepend, append };
}
