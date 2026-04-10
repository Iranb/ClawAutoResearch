export const WORKFLOW_STAGES = [
  "setup",
  "graph_build",
  "survey_review",
  "frontier_mapping",
  "idea",
  "plan",
  "code",
  "experiment",
  "analyze",
  "review",
  "write",
  "revise",
  "submit",
  "done",
] as const;

export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];
export type WorkflowLine = "experiment" | "survey";

export const WORKFLOW_LINE_STAGE_ORDERS: Record<WorkflowLine, readonly WorkflowStage[]> = {
  experiment: [
    "setup",
    "graph_build",
    "frontier_mapping",
    "idea",
    "plan",
    "code",
    "experiment",
    "analyze",
    "review",
    "write",
    "revise",
    "submit",
    "done",
  ],
  survey: [
    "setup",
    "graph_build",
    "survey_review",
    "write",
    "revise",
    "submit",
    "done",
  ],
};

export function getWorkflowStageIndex(
  stage: string | null | undefined,
): number | null {
  if (!stage) {
    return null;
  }

  const index = WORKFLOW_STAGES.indexOf(stage as WorkflowStage);

  return index >= 0 ? index : null;
}

export function getWorkflowLineStageIndex(
  workflowLine: WorkflowLine,
  stage: string | null | undefined,
): number | null {
  if (!stage) {
    return null;
  }

  const index = WORKFLOW_LINE_STAGE_ORDERS[workflowLine].indexOf(stage as WorkflowStage);
  return index >= 0 ? index : null;
}
