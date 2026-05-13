import * as path from "node:path";

import { asRecord, normalizeStage } from "../workflow-guard-core/coercion";
import { readJsonIfExists } from "../workflow-guard-core/fs";
import {
  maybeMaterializeGraphBuildPaperSources,
  type GraphBuildSourceCatchupResult,
} from "../graph-build-source-catchup";
import {
  INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON,
  isInvalidCompletedWorkflowOwnedLiteratureRequisitionRequest,
  isWorkflowOwnedLiteratureRequisitionRequest,
  normalizePaperIngestionState,
  serializePaperIngestionQueuedRequest,
} from "../workflow-guard-state/paper-ingestion";
import { setPaperIngestionState } from "../workflow-guard-setters/ingestion-state-setters";
import {
  reconcileWorkflowControl,
  type WorkflowControlReconcileResult,
} from "../workflow-control-reconciler";

type WorkflowPolicyLike = Parameters<typeof maybeMaterializeGraphBuildPaperSources>[0]["workflowPolicy"];
type PaperIngestionState = ReturnType<typeof normalizePaperIngestionState>;
type PaperIngestionRequest = PaperIngestionState["queuedRequests"][number];

export type LiteratureDiscoveryRequisitionAdvanceResult = {
  advanced: boolean;
  reason:
    | "no_requisition"
    | "marked_needs_repair"
    | "launched_or_polled"
    | "materialized"
    | "blocked";
  requestId: string | null;
  status: string | null;
  startedAt: string | null;
  attemptCount: number | null;
  runId: string | null;
  queueProgress: Record<string, unknown> | null;
  sourceIndexPath: string | null;
  batchManifestPath: string | null;
  materializedPaperCount: number;
  summary: string | null;
  catchup: GraphBuildSourceCatchupResult | null;
  workflowControl: {
    stage: string | null;
    owner: string | null;
    nextAction: string | null;
    blockingReason: string | null;
  } | null;
};

function requestQueueProgress(request: PaperIngestionRequest | null): Record<string, unknown> | null {
  const progress = request?.queueProgress;
  if (!progress) {
    return null;
  }
  return {
    sequence: progress.sequence ?? null,
    last_event_at: progress.lastEventAt ?? null,
    total: progress.total,
    pending: progress.pending,
    running: progress.running,
    completed: progress.completed,
    failed: progress.failed,
    remaining: progress.remaining,
    overall_percent: progress.overallPercent,
  };
}

function findAdvanceCandidate(state: PaperIngestionState): PaperIngestionRequest | null {
  return (
    state.queuedRequests.find((request) =>
      isInvalidCompletedWorkflowOwnedLiteratureRequisitionRequest({ state, request })
    ) ??
    state.queuedRequests.find(
      (request) =>
        isWorkflowOwnedLiteratureRequisitionRequest(request) &&
        ["queued", "launching", "running"].includes(request.status)
    ) ??
    null
  );
}

function findRequestById(
  state: PaperIngestionState,
  requestId: string | null
): PaperIngestionRequest | null {
  if (!requestId) {
    return null;
  }
  return state.queuedRequests.find((request) => request.requestId === requestId) ?? null;
}

async function readManifest(projectRoot: string): Promise<Record<string, unknown>> {
  return (
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {}
  );
}

function summarizeWorkflowControl(
  reconcile: WorkflowControlReconcileResult | null
): LiteratureDiscoveryRequisitionAdvanceResult["workflowControl"] {
  if (!reconcile) {
    return null;
  }
  return {
    stage: reconcile.contract.stage,
    owner: reconcile.contract.owner,
    nextAction: reconcile.contract.next_action,
    blockingReason: reconcile.contract.blocking_reason,
  };
}

function summarizeResult(params: {
  reason: LiteratureDiscoveryRequisitionAdvanceResult["reason"];
  request: PaperIngestionRequest | null;
  catchup: GraphBuildSourceCatchupResult | null;
  reconcile: WorkflowControlReconcileResult | null;
  summary: string | null;
  advanced?: boolean;
}): LiteratureDiscoveryRequisitionAdvanceResult {
  return {
    advanced: params.advanced ?? params.reason !== "no_requisition",
    reason: params.reason,
    requestId: params.request?.requestId ?? params.catchup?.requestId ?? null,
    status: params.request?.status ?? null,
    startedAt: params.request?.startedAt ?? null,
    attemptCount: params.request?.attemptCount ?? null,
    runId: params.request?.lastRunId ?? null,
    queueProgress: requestQueueProgress(params.request),
    sourceIndexPath: params.catchup?.sourceIndexPath ?? null,
    batchManifestPath: params.catchup?.batchManifestPath ?? null,
    materializedPaperCount: params.catchup?.materializedPaperCount ?? 0,
    summary: params.summary,
    catchup: params.catchup,
    workflowControl: summarizeWorkflowControl(params.reconcile),
  };
}

export async function advanceLiteratureDiscoveryRequisition(params: {
  projectRoot: string;
  projectId?: string | null;
  workflowPolicy?: WorkflowPolicyLike;
  now?: string;
}): Promise<LiteratureDiscoveryRequisitionAdvanceResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const now = params.now ?? new Date().toISOString();
  const manifest = await readManifest(projectRoot);
  const state = normalizePaperIngestionState(manifest.paper_ingestion);
  const candidate = findAdvanceCandidate(state);
  if (!candidate) {
    return summarizeResult({
      reason: "no_requisition",
      request: null,
      catchup: null,
      reconcile: null,
      summary: "No workflow-owned literature discovery requisition is ready to advance.",
      advanced: false,
    });
  }

  if (
    isInvalidCompletedWorkflowOwnedLiteratureRequisitionRequest({
      state,
      request: candidate,
    })
  ) {
    await setPaperIngestionState({
      projectRoot,
      paperIngestion: {
        runtime_status: "blocked",
        waiting_reason: INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON,
        queued_requests: [
          {
            ...serializePaperIngestionQueuedRequest(candidate),
            status: "needs_repair",
            updated_at: now,
            finished_at: null,
            last_error: INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON,
            detail: INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON,
            next_retry_at: null,
            dead_letter_at: null,
            dead_letter_reason: null,
          },
        ],
        last_updated_at: now,
      },
    });
    const reconciled = await reconcileWorkflowControl({
      projectRoot,
      policy: { allowProjectionRepair: true },
      now,
    });
    const nextManifest = asRecord(reconciled.manifest) ?? (await readManifest(projectRoot));
    const nextState = normalizePaperIngestionState(nextManifest.paper_ingestion);
    const nextRequest = findRequestById(nextState, candidate.requestId) ?? candidate;
    return summarizeResult({
      reason: "marked_needs_repair",
      request: nextRequest,
      catchup: null,
      reconcile: reconciled,
      summary: INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON,
    });
  }

  const catchup = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId:
      params.projectId ??
      (typeof manifest.project_id === "string" ? manifest.project_id : null),
    workflowPolicy: params.workflowPolicy,
    now,
    force: true,
  });
  const reconciled = await reconcileWorkflowControl({
    projectRoot,
    policy: { allowProjectionRepair: true },
    now,
  });
  const nextState = normalizePaperIngestionState(reconciled.manifest.paper_ingestion);
  const nextRequest = findRequestById(nextState, candidate.requestId);
  const nextStatus = normalizeStage(nextRequest?.status);
  const reason =
    nextStatus === "needs_repair" || nextStatus === "failed"
      ? "blocked"
      : catchup.materializedPaperCount > 0 || catchup.sourceIndexPath
        ? "materialized"
        : "launched_or_polled";
  return summarizeResult({
    reason,
    request: nextRequest ?? candidate,
    catchup,
    reconcile: reconciled,
    summary:
      catchup.skippedReason ??
      (catchup.queued
        ? "Workflow-owned literature discovery requisition is waiting on remote import progress."
        : "Workflow-owned literature discovery requisition advanced through the PaperNexus control-plane executor."),
  });
}
