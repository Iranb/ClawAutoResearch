import { checkGraphPresenceForWorkflow } from "./graph-presence";
import { listBackgroundWorkflowRuns } from "./workflow-fast-paths";
import {
  setPaperIngestionState,
  type WorkflowGuardPolicy,
  type WorkflowSnapshot,
} from "./workflow-guard";

const GRAPH_PRESENCE_AUTO_REFRESH_MIN_INTERVAL_MS = 15_000;

function readIsoTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function reconcileBackgroundWorkflowStateForSnapshot(params: {
  snapshot: WorkflowSnapshot;
  workflowPolicy: WorkflowGuardPolicy;
  runtimeSubagent?: {
    waitForRun?: (params: { runId: string; timeoutMs?: number }) => Promise<{
      status: "ok" | "error" | "timeout";
      error?: string;
    }>;
  };
}): Promise<void> {
  if (!params.snapshot.projectRoot) {
    return;
  }
  await listBackgroundWorkflowRuns({
    runtimeSubagent: params.runtimeSubagent,
    ownerAgent: "researcher",
    projectId: params.snapshot.projectId,
    projectRoot: params.snapshot.projectRoot,
    projectsRoot: params.workflowPolicy.projectsRoot,
  });
}

export async function maybeRefreshGraphPresenceForSnapshot(params: {
  snapshot: WorkflowSnapshot;
  workflowPolicy: WorkflowGuardPolicy;
}): Promise<boolean> {
  const { snapshot, workflowPolicy } = params;
  if (!snapshot.projectRoot) {
    return false;
  }
  if (snapshot.currentStage !== "graph_build") {
    return false;
  }
  if (snapshot.graphPresenceStatus === "ready") {
    return false;
  }
  if (
    (snapshot.paperIngestionRunningRequestCount ?? 0) > 0 ||
    (snapshot.paperIngestionActiveBatchCount ?? 0) > 0 ||
    (snapshot.paperIngestionPendingBatchItemCount ?? 0) > 0 ||
    (snapshot.paperIngestionActiveOperationCount ?? 0) > 0
  ) {
    return false;
  }
  const checkedAtMs = readIsoTimestamp(snapshot.graphPresenceCheckedAt);
  if (
    checkedAtMs !== null &&
    Date.now() - checkedAtMs < GRAPH_PRESENCE_AUTO_REFRESH_MIN_INTERVAL_MS
  ) {
    return false;
  }
  const result = await checkGraphPresenceForWorkflow({
    projectRoot: snapshot.projectRoot,
    updateManifest: true,
    remoteAccess: {
      apiBaseUrl: workflowPolicy.papernexusApiBaseUrl,
      mcpUrl: workflowPolicy.papernexusMcpUrl,
      mcpTransport: workflowPolicy.papernexusMcpTransport,
      mcpTimeoutMs: workflowPolicy.papernexusMcpTimeoutMs,
      tokenSource: workflowPolicy.papernexusApiTokenSource,
      tokenEnv: workflowPolicy.papernexusApiTokenEnv,
      tokenService: workflowPolicy.papernexusApiTokenService,
      tokenAccount: workflowPolicy.papernexusApiTokenAccount,
      mineruHttpUrl: workflowPolicy.papernexusMineruHttpUrl,
      tokenLookupTimeoutMs: workflowPolicy.papernexusApiTokenLookupTimeoutMs,
    },
  });
  await setPaperIngestionState({
    projectRoot: snapshot.projectRoot,
    paperIngestion: {
      runtime_status: result.status === "ready" ? "ready" : "waiting_graph",
      waiting_reason:
        result.status === "ready"
          ? null
          : result.refreshReason ??
            "Graph presence still needs verification before downstream stages continue.",
      last_updated_at: result.checkedAt,
    },
  });
  return true;
}
