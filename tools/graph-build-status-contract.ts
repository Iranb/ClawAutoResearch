export type GraphBuildWorkflowStatus = "ready" | "waiting" | "degraded" | "blocked";

export type GraphBuildStatusContract = {
  workflowStatus: GraphBuildWorkflowStatus;
  canContinue: boolean;
  requiresImport: boolean;
  requiresSourceRepair: boolean;
  reason: string | null;
};

export function evaluateGraphBuildStatusContract(params: {
  graphPresenceStatus: "ready" | "missing_papers" | "missing_corpus" | "missing_sources";
  expectedPaperCount: number;
  presentPaperCount: number;
  missingPaperCount: number;
  repairRequired: boolean;
  refreshRequired: boolean;
  ingestionInFlight: boolean;
  blockingReason?: string | null;
}): GraphBuildStatusContract {
  if (params.graphPresenceStatus === "ready") {
    return {
      workflowStatus: "ready",
      canContinue: true,
      requiresImport: false,
      requiresSourceRepair: false,
      reason: null,
    };
  }
  if (params.ingestionInFlight) {
    return {
      workflowStatus: "waiting",
      canContinue: false,
      requiresImport: false,
      requiresSourceRepair: false,
      reason: params.blockingReason ?? "Paper ingestion is still in flight.",
    };
  }
  if (
    params.graphPresenceStatus === "missing_papers" &&
    params.expectedPaperCount > 0 &&
    params.presentPaperCount > 0 &&
    !params.repairRequired
  ) {
    return {
      workflowStatus: "degraded",
      canContinue: true,
      requiresImport: false,
      requiresSourceRepair: false,
      reason:
        params.blockingReason ??
        "Graph is partially populated; workflow may continue with degraded coverage.",
    };
  }
  return {
    workflowStatus: "blocked",
    canContinue: false,
    requiresImport: params.repairRequired || params.refreshRequired,
    requiresSourceRepair: params.graphPresenceStatus === "missing_sources",
    reason:
      params.blockingReason ??
      "Graph build cannot continue until source or import repair completes.",
  };
}
