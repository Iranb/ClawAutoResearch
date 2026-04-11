import { readWorkflowDashboardSummary } from "./dashboard-summary";

export type WorkflowProjectionModel = Awaited<ReturnType<typeof readWorkflowProjectionModel>>;

export async function readWorkflowProjectionModel(projectRoot: string) {
  const dashboard = await readWorkflowDashboardSummary(projectRoot);
  return {
    schemaVersion: 1,
    projectRoot,
    evidenceCloseout: dashboard.evidenceCloseout,
    evidenceBoard: dashboard.evidenceBoard,
    teamTaskGraph: dashboard.teamTaskGraph,
    taskBoard: dashboard.taskBoard,
    teamRound: dashboard.teamRound,
  };
}
