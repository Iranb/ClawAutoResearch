import {
  asRecord,
  normalizeGraphPresenceStatus,
  pickString,
} from "../workflow-guard-core/coercion";
import type { GraphPresenceCheckResult } from "../graph-presence";
import { normalizePaperIngestionState } from "../workflow-guard-state/paper-ingestion";

const GRAPH_SENSITIVE_STAGES = new Set(["graph_build", "frontier_mapping", "idea"]);

export type WorkflowGraphContextStatus =
  | "ready"
  | "stale"
  | "missing"
  | "unavailable";

export type WorkflowGraphContext = {
  stage: string | null;
  graphSensitive: boolean;
  status: WorkflowGraphContextStatus;
  graphPresenceStatus: ReturnType<typeof normalizeGraphPresenceStatus>;
  graphPresenceCheckStatus: GraphPresenceCheckResult["status"] | null;
  graphBuildWorkflowStatus: GraphPresenceCheckResult["graphBuildWorkflowStatus"] | null;
  graphBuildCanContinue: boolean | null;
  graphBuildRequiresImport: boolean | null;
  graphBuildRequiresSourceRepair: boolean | null;
  graphBuildStatusReason: string | null;
  checkedAt: string | null;
  checkedAtMs: number | null;
  recentlyChecked: boolean;
  refreshRequired: boolean;
  repairRequired: boolean;
  repairReason: string | null;
  repairTargetCorpus: string | null;
  runtimeStatus: ReturnType<typeof normalizePaperIngestionState>["runtimeStatus"];
  waitingReason: string | null;
  paperIngestionState: ReturnType<typeof normalizePaperIngestionState>;
};

function readIsoTimestamp(value: unknown): number | null {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function readOptionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeGraphBuildWorkflowStatus(
  value: unknown
): GraphPresenceCheckResult["graphBuildWorkflowStatus"] | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : null;
  switch (normalized) {
    case "ready":
    case "waiting":
    case "degraded":
    case "blocked":
      return normalized;
    default:
      return null;
  }
}

export function isGraphSensitiveWorkflowStage(stage: string | null | undefined): boolean {
  return Boolean(stage && GRAPH_SENSITIVE_STAGES.has(stage));
}

export function deriveWorkflowGraphContext(params: {
  manifest: Record<string, unknown> | null | undefined;
  stage: string | null | undefined;
  nowIso: string;
  minRefreshIntervalMs?: number;
  graphPresenceCheck?: GraphPresenceCheckResult | null;
}): WorkflowGraphContext {
  const graphSensitive = isGraphSensitiveWorkflowStage(params.stage);
  const paperIngestionRecord = asRecord(params.manifest?.paper_ingestion);
  const paperIngestionState = normalizePaperIngestionState(params.manifest?.paper_ingestion);
  const checkedAt =
    params.graphPresenceCheck?.checkedAt ??
    pickString(paperIngestionRecord ?? {}, [
      "graph_presence_checked_at",
      "graphPresenceCheckedAt",
    ]);
  const checkedAtMs = readIsoTimestamp(checkedAt);
  const nowMs = readIsoTimestamp(params.nowIso) ?? Date.now();
  const minRefreshIntervalMs =
    typeof params.minRefreshIntervalMs === "number" &&
    Number.isFinite(params.minRefreshIntervalMs)
      ? Math.max(0, Math.floor(params.minRefreshIntervalMs))
      : 0;
  const recentlyChecked =
    checkedAtMs !== null && nowMs - checkedAtMs < minRefreshIntervalMs;
  const refreshRequired =
    params.graphPresenceCheck?.refreshRequired === true ||
    paperIngestionRecord?.refresh_required === true ||
    paperIngestionRecord?.refreshRequired === true;
  const graphPresenceStatus =
    normalizeGraphPresenceStatus(params.graphPresenceCheck?.status) ??
    normalizeGraphPresenceStatus(
      paperIngestionRecord?.graph_presence_status ?? paperIngestionRecord?.graphPresenceStatus
    );
  const graphBuildWorkflowStatus =
    params.graphPresenceCheck?.graphBuildWorkflowStatus ??
    normalizeGraphBuildWorkflowStatus(
      paperIngestionRecord?.graph_build_workflow_status ??
        paperIngestionRecord?.graphBuildWorkflowStatus
    );
  const graphBuildCanContinue =
    params.graphPresenceCheck?.graphBuildCanContinue ??
    readOptionalBoolean(
      paperIngestionRecord?.graph_build_can_continue ??
        paperIngestionRecord?.graphBuildCanContinue
    );
  const graphBuildRequiresImport =
    params.graphPresenceCheck?.graphBuildRequiresImport ??
    readOptionalBoolean(
      paperIngestionRecord?.graph_build_requires_import ??
        paperIngestionRecord?.graphBuildRequiresImport
    );
  const graphBuildRequiresSourceRepair =
    params.graphPresenceCheck?.graphBuildRequiresSourceRepair ??
    readOptionalBoolean(
      paperIngestionRecord?.graph_build_requires_source_repair ??
        paperIngestionRecord?.graphBuildRequiresSourceRepair
    );
  const graphBuildStatusReason =
    params.graphPresenceCheck?.graphBuildStatusReason ??
    pickString(paperIngestionRecord ?? {}, [
      "graph_build_status_reason",
      "graphBuildStatusReason",
    ]);

  let status: WorkflowGraphContextStatus = "missing";
  if (!graphSensitive) {
    status = "ready";
  } else if (
    params.graphPresenceCheck?.status === "missing_corpus" ||
    params.graphPresenceCheck?.status === "missing_sources"
  ) {
    status = "unavailable";
  } else if (graphPresenceStatus === "ready" && !refreshRequired) {
    status = "ready";
  } else if (
    graphPresenceStatus !== null ||
    refreshRequired ||
    checkedAtMs !== null ||
    paperIngestionState.runtimeStatus === "waiting_graph"
  ) {
    status = "stale";
  }

  return {
    stage: params.stage ?? null,
    graphSensitive,
    status,
    graphPresenceStatus,
    graphPresenceCheckStatus: params.graphPresenceCheck?.status ?? null,
    graphBuildWorkflowStatus,
    graphBuildCanContinue,
    graphBuildRequiresImport,
    graphBuildRequiresSourceRepair,
    graphBuildStatusReason,
    checkedAt,
    checkedAtMs,
    recentlyChecked,
    refreshRequired,
    repairRequired:
      params.graphPresenceCheck?.repairRequired ?? paperIngestionState.repairRequired,
    repairReason:
      params.graphPresenceCheck?.repairReason ?? paperIngestionState.repairReason,
    repairTargetCorpus:
      params.graphPresenceCheck?.repairTargetCorpus ??
      paperIngestionState.repairTargetCorpus,
    runtimeStatus: paperIngestionState.runtimeStatus,
    waitingReason: paperIngestionState.waitingReason,
    paperIngestionState,
  };
}

export function shouldRefreshWorkflowGraphPresence(params: {
  manifest: Record<string, unknown> | null | undefined;
  stage: string | null | undefined;
  nowIso: string;
  minRefreshIntervalMs?: number;
  graphPresenceCheck?: GraphPresenceCheckResult | null;
}): boolean {
  const context = deriveWorkflowGraphContext(params);
  if (!context.graphSensitive) {
    return false;
  }
  if (context.status === "ready" && !context.refreshRequired) {
    return false;
  }
  if (context.recentlyChecked && !context.refreshRequired) {
    return false;
  }
  return (
    context.status !== "ready" ||
    context.refreshRequired ||
    context.checkedAtMs === null
  );
}
