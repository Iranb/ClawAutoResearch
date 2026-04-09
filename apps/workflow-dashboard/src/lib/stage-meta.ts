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
export type MatrixCellState =
  | "blocked"
  | "active"
  | "ready"
  | "complete"
  | "idle"
  | "incomplete";

export function getStageIndex(stage: string | null | undefined): number | null {
  if (!stage) {
    return null;
  }

  const index = WORKFLOW_STAGES.indexOf(stage as WorkflowStage);

  return index >= 0 ? index : null;
}

export function getStageLabel(stage: WorkflowStage): string {
  return stage;
}
