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
  "submit",
] as const;

export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];

export function getWorkflowStageIndex(
  stage: string | null | undefined,
): number | null {
  if (!stage) {
    return null;
  }

  const index = WORKFLOW_STAGES.indexOf(stage as WorkflowStage);

  return index >= 0 ? index : null;
}
