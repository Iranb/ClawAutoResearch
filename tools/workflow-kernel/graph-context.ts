import {
  asRecord,
  normalizeGraphPresenceStatus,
  pickString,
} from "../workflow-guard-core/coercion";
import type { GraphPresenceCheckResult } from "../graph-presence";
import { normalizePaperIngestionState } from "../workflow-guard-state/paper-ingestion";
import {
  papernexusSyncStateAllowsWorkflowContinue,
  type PapernexusSyncState,
} from "../papernexus-sync-state";

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
  graphPresenceReadyProofLevel: GraphPresenceCheckResult["readyProofLevel"] | null;
  graphPresenceSourceBackedPresentCount: number | null;
  graphPresencePaperIndexPresentCount: number | null;
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

function readOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : null;
}

function normalizeReadyProofLevel(
  value: unknown
): GraphPresenceCheckResult["readyProofLevel"] | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : null;
  return normalized === "source_span" ||
    normalized === "paper_index" ||
    normalized === "remote_summary" ||
    normalized === "none"
    ? normalized
    : null;
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

function normalizeStageValue(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : null;
}

function graphPresenceStatusFromSyncState(
  state: PapernexusSyncState | null
): ReturnType<typeof normalizeGraphPresenceStatus> {
  if (!state) {
    return null;
  }
  if (state.graph_presence.status === "ready") {
    return "ready";
  }
  if (
    state.graph_presence.status === "blocked" &&
    state.graph_presence.expected_paper_count <= 0
  ) {
    return "missing_corpus";
  }
  return "missing_papers";
}

function graphBuildWorkflowStatusFromSyncState(
  state: PapernexusSyncState | null
): GraphPresenceCheckResult["graphBuildWorkflowStatus"] | null {
  if (!state) {
    return null;
  }
  switch (state.workflow_projection.runtime_status) {
    case "ready":
      return "ready";
    case "waiting_import":
    case "waiting_graph":
      return "waiting";
    case "degraded":
      return "degraded";
    case "blocked":
      return "blocked";
  }
}

function paperIngestionRuntimeStatusFromSyncState(
  state: PapernexusSyncState | null,
  fallback: ReturnType<typeof normalizePaperIngestionState>["runtimeStatus"]
): ReturnType<typeof normalizePaperIngestionState>["runtimeStatus"] {
  if (!state) {
    return fallback;
  }
  switch (state.workflow_projection.runtime_status) {
    case "ready":
      return "ready";
    case "waiting_import":
      return "waiting_import";
    case "waiting_graph":
    case "degraded":
      return "waiting_graph";
    case "blocked":
      return "blocked";
  }
}

function queuedRequestUsesStrictRemotePapernexus(
  request: ReturnType<typeof normalizePaperIngestionState>["queuedRequests"][number]
): boolean {
  const wrapper = request.wrapper ?? "";
  const lastSessionKey = request.lastSessionKey ?? "";
  return (
    wrapper === "papernexus_remote_mcp" ||
    /papernexus:remote_mcp:/i.test(lastSessionKey)
  );
}

function manifestUsesStrictRemotePapernexus(params: {
  manifest: Record<string, unknown> | null | undefined;
  paperIngestionRecord: Record<string, unknown> | null;
  paperIngestionState: ReturnType<typeof normalizePaperIngestionState>;
}): boolean {
  const accessMode = normalizeStageValue(
    pickString(params.manifest ?? {}, [
      "papernexusAccessMode",
      "papernexus_access_mode",
    ]) ??
      pickString(params.paperIngestionRecord ?? {}, [
        "papernexusAccessMode",
        "papernexus_access_mode",
      ])
  );
  if (accessMode === "remote_mcp") {
    return true;
  }
  if (accessMode === "local_mcp") {
    return false;
  }
  return params.paperIngestionState.queuedRequests.some(
    queuedRequestUsesStrictRemotePapernexus
  );
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
  papernexusSyncState?: PapernexusSyncState | null;
}): WorkflowGraphContext {
  const graphSensitive = isGraphSensitiveWorkflowStage(params.stage);
  const paperIngestionRecord = asRecord(params.manifest?.paper_ingestion);
  const paperIngestionState = normalizePaperIngestionState(params.manifest?.paper_ingestion);
  const papernexusSyncState = params.papernexusSyncState ?? null;
  const checkedAt =
    papernexusSyncState?.generated_at ??
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
    papernexusSyncState
      ? papernexusSyncState.workflow_projection.runtime_status === "waiting_graph" ||
        (papernexusSyncState.graph_presence.status === "degraded" &&
          papernexusSyncState.workflow_projection.can_continue !== true)
      : params.graphPresenceCheck?.refreshRequired === true ||
        paperIngestionRecord?.refresh_required === true ||
        paperIngestionRecord?.refreshRequired === true;
  const graphPresenceStatus =
    graphPresenceStatusFromSyncState(papernexusSyncState) ??
    normalizeGraphPresenceStatus(params.graphPresenceCheck?.status) ??
    normalizeGraphPresenceStatus(
      paperIngestionRecord?.graph_presence_status ?? paperIngestionRecord?.graphPresenceStatus
    );
  const graphBuildWorkflowStatus =
    graphBuildWorkflowStatusFromSyncState(papernexusSyncState) ??
    params.graphPresenceCheck?.graphBuildWorkflowStatus ??
    normalizeGraphBuildWorkflowStatus(
      paperIngestionRecord?.graph_build_workflow_status ??
        paperIngestionRecord?.graphBuildWorkflowStatus
    );
  const graphBuildCanContinue =
    papernexusSyncState?.workflow_projection.can_continue ??
    params.graphPresenceCheck?.graphBuildCanContinue ??
    readOptionalBoolean(
      paperIngestionRecord?.graph_build_can_continue ??
        paperIngestionRecord?.graphBuildCanContinue
    );
  const graphBuildRequiresImport =
    (papernexusSyncState
      ? papernexusSyncState.workflow_projection.runtime_status === "waiting_import" ||
        papernexusSyncState.imports.pending_count > 0 ||
        papernexusSyncState.imports.running_count > 0 ||
        papernexusSyncState.imports.remaining_count > 0
      : null) ??
    params.graphPresenceCheck?.graphBuildRequiresImport ??
    readOptionalBoolean(
      paperIngestionRecord?.graph_build_requires_import ??
        paperIngestionRecord?.graphBuildRequiresImport
    );
  const graphBuildRequiresSourceRepair =
    (papernexusSyncState
      ? papernexusSyncState.graph_presence.status === "blocked"
      : null) ??
    params.graphPresenceCheck?.graphBuildRequiresSourceRepair ??
    readOptionalBoolean(
      paperIngestionRecord?.graph_build_requires_source_repair ??
        paperIngestionRecord?.graphBuildRequiresSourceRepair
    );
  const graphBuildStatusReason =
    papernexusSyncState?.workflow_projection.blocking_reason ??
    params.graphPresenceCheck?.graphBuildStatusReason ??
    pickString(paperIngestionRecord ?? {}, [
      "graph_build_status_reason",
      "graphBuildStatusReason",
    ]);
  const graphPresenceReadyProofLevel =
    papernexusSyncState?.graph_presence.ready_proof_level ??
    params.graphPresenceCheck?.readyProofLevel ??
    normalizeReadyProofLevel(
      paperIngestionRecord?.graph_presence_ready_proof_level ??
        paperIngestionRecord?.graphPresenceReadyProofLevel ??
        paperIngestionRecord?.ready_proof_level ??
        paperIngestionRecord?.readyProofLevel
    );
  const graphPresenceSourceBackedPresentCount =
    papernexusSyncState?.graph_presence.source_backed_present_count ??
    params.graphPresenceCheck?.sourceBackedPresentCount ??
    readOptionalNumber(
      paperIngestionRecord?.graph_presence_source_backed_present_count ??
        paperIngestionRecord?.graphPresenceSourceBackedPresentCount ??
        paperIngestionRecord?.source_backed_present_count ??
        paperIngestionRecord?.sourceBackedPresentCount
    );
  const graphPresencePaperIndexPresentCount =
    papernexusSyncState?.graph_presence.paper_index_present_count ??
    params.graphPresenceCheck?.paperIndexPresentCount ??
    readOptionalNumber(
      paperIngestionRecord?.graph_presence_paper_index_present_count ??
        paperIngestionRecord?.graphPresencePaperIndexPresentCount ??
        paperIngestionRecord?.paper_index_present_count ??
        paperIngestionRecord?.paperIndexPresentCount
    );
  const papernexusSourceBackedGraphClaim =
    papernexusSyncState?.proof.source_backed_graph_claim ??
    readOptionalBoolean(
      paperIngestionRecord?.papernexus_source_backed_graph_claim ??
        paperIngestionRecord?.papernexusSourceBackedGraphClaim
    );
  const papernexusClaimLevel =
    papernexusSyncState
      ? papernexusSyncState.graph_presence.ready_proof_level === "source_span"
        ? "source_backed_graph"
        : papernexusSyncState.graph_presence.ready_proof_level === "paper_index"
          ? "paper_index_confirmed"
          : papernexusSyncState.graph_presence.ready_proof_level === "remote_summary"
            ? "remote_corpus_summary"
            : "none"
      : pickString(paperIngestionRecord ?? {}, [
          "papernexus_claim_level",
          "papernexusClaimLevel",
        ]);
  const strictRemotePapernexus = manifestUsesStrictRemotePapernexus({
    manifest: params.manifest,
    paperIngestionRecord,
    paperIngestionState,
  }) || papernexusSyncState?.authority.mode === "remote_mcp" ||
    papernexusSyncState?.authority.mode === "remote_api";
  const remoteSummaryGraphPresence =
    params.graphPresenceCheck?.verificationMode === "remote_corpus_summary" ||
    papernexusSyncState?.graph_presence.verification_mode === "remote_corpus_summary" ||
    papernexusClaimLevel === "remote_corpus_summary" ||
    graphPresenceReadyProofLevel === "remote_summary";
  const proofLevelAllowsReady =
    graphPresenceReadyProofLevel === null ||
    graphPresenceReadyProofLevel === "source_span" ||
    graphPresenceReadyProofLevel === "paper_index" ||
    (!strictRemotePapernexus && !remoteSummaryGraphPresence);
  const certificationBlocksReady =
    strictRemotePapernexus
      ? papernexusSourceBackedGraphClaim !== true ||
        papernexusClaimLevel === "remote_corpus_summary" ||
        papernexusClaimLevel === "connectivity_only" ||
        papernexusClaimLevel === "none"
      : remoteSummaryGraphPresence &&
        (papernexusSourceBackedGraphClaim === false ||
          papernexusClaimLevel === "remote_corpus_summary");

  let status: WorkflowGraphContextStatus = "missing";
  if (!graphSensitive) {
    status = "ready";
  } else if (papernexusSyncState) {
    if (
      papernexusSyncStateAllowsWorkflowContinue(papernexusSyncState, {
        strictRemote: strictRemotePapernexus,
      })
    ) {
      status = "ready";
    } else if (
      papernexusSyncState.workflow_projection.runtime_status === "blocked" &&
      papernexusSyncState.graph_presence.status === "blocked"
    ) {
      status = "unavailable";
    } else {
      status = "stale";
    }
  } else if (
    params.graphPresenceCheck?.status === "missing_corpus" ||
    params.graphPresenceCheck?.status === "missing_sources"
  ) {
    status = "unavailable";
  } else if (
    graphPresenceStatus === "ready" &&
    !refreshRequired &&
    proofLevelAllowsReady &&
    !certificationBlocksReady
  ) {
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
    graphPresenceReadyProofLevel,
    graphPresenceSourceBackedPresentCount,
    graphPresencePaperIndexPresentCount,
    checkedAt,
    checkedAtMs,
    recentlyChecked,
    refreshRequired,
    repairRequired:
      papernexusSyncState
        ? papernexusSyncState.graph_presence.status === "blocked"
        : params.graphPresenceCheck?.repairRequired ?? paperIngestionState.repairRequired,
    repairReason:
      papernexusSyncState?.workflow_projection.blocking_reason ??
      params.graphPresenceCheck?.repairReason ??
      paperIngestionState.repairReason,
    repairTargetCorpus:
      params.graphPresenceCheck?.repairTargetCorpus ??
      paperIngestionState.repairTargetCorpus,
    runtimeStatus: paperIngestionRuntimeStatusFromSyncState(
      papernexusSyncState,
      paperIngestionState.runtimeStatus
    ),
    waitingReason:
      papernexusSyncState?.workflow_projection.blocking_reason ??
      paperIngestionState.waitingReason,
    paperIngestionState,
  };
}

export function shouldRefreshWorkflowGraphPresence(params: {
  manifest: Record<string, unknown> | null | undefined;
  stage: string | null | undefined;
  nowIso: string;
  minRefreshIntervalMs?: number;
  graphPresenceCheck?: GraphPresenceCheckResult | null;
  papernexusSyncState?: PapernexusSyncState | null;
}): boolean {
  const context = deriveWorkflowGraphContext(params);
  if (!context.graphSensitive) {
    return false;
  }
  if (context.status === "ready" && !context.refreshRequired) {
    return false;
  }
  if (context.graphBuildRequiresImport) {
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
