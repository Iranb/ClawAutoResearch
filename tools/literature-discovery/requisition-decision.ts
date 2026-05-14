import * as path from "node:path";

import { writeJsonAtomicEnsured } from "../workflow-guard-core/fs";
import {
  DEFAULT_REQUISITION_SATISFACTION_REPORT_BASENAME,
  LITERATURE_REQUISITION_SATISFACTION_AUTHORITY,
} from "../workflow-authority-registry";

export type LiteratureRequisitionDecisionStatus =
  | "valid"
  | "running"
  | "failed"
  | "warning"
  | "invalid";

export function deriveLiteratureDiscoverySatisfactionReportPath(request: {
  requestId: string;
  manifestPath?: string | null;
}): string {
  if (request.manifestPath?.includes("/")) {
    return `${request.manifestPath.split("/").slice(0, -1).join("/")}/${DEFAULT_REQUISITION_SATISFACTION_REPORT_BASENAME}`;
  }
  return `researcher/literature-discovery/requisition/${request.requestId}/${DEFAULT_REQUISITION_SATISFACTION_REPORT_BASENAME}`;
}

export async function writeLiteratureRequisitionDecisionReport(params: {
  projectRoot: string;
  requestId: string;
  manifestPath?: string | null;
  triggerKind?: string | null;
  status: LiteratureRequisitionDecisionStatus;
  decision: string;
  reason: string;
  limitations?: string[];
  now: string;
  generation?: number | null;
  remoteRunId?: string | null;
  remoteArtifactPath?: string | null;
  remoteReportPath?: string | null;
  sharedCorpus?: string | null;
  mcpUrl?: string | null;
  importTaskIds?: string[];
  queueProgress?: Record<string, unknown> | null;
  queueProgressError?: string | null;
  candidatePaperCount: number;
  selectedPaperCount: number;
  sourceBackedCount: number;
  metadataOnlyCount: number;
  evidenceGapClosed: boolean;
  citedEvidence?: Record<string, unknown>;
}): Promise<string> {
  const reportPath = deriveLiteratureDiscoverySatisfactionReportPath({
    requestId: params.requestId,
    manifestPath: params.manifestPath,
  });
  await writeJsonAtomicEnsured(path.join(params.projectRoot, reportPath), {
    schema_version: 1,
    kind: "literature_requisition_decision",
    authority: LITERATURE_REQUISITION_SATISFACTION_AUTHORITY,
    status: params.status,
    decision: params.decision,
    request_id: params.requestId,
    trigger_kind: params.triggerKind ?? null,
    generation: params.generation ?? null,
    remote_run_id: params.remoteRunId ?? null,
    selected_paper_count: params.selectedPaperCount,
    candidate_paper_count: params.candidatePaperCount,
    source_backed_count: params.sourceBackedCount,
    metadata_only_count: params.metadataOnlyCount,
    evidence_gap_closed: params.evidenceGapClosed,
    reason: params.reason,
    limitations: params.limitations ?? [],
    cited_evidence: {
      remote_artifact_path: params.remoteArtifactPath ?? null,
      remote_report_path: params.remoteReportPath ?? null,
      ...(params.citedEvidence ?? {}),
    },
    remote_literature_discovery: {
      request_id: params.requestId,
      run_id: params.remoteRunId ?? null,
      mcp_url: params.mcpUrl ?? null,
      shared_corpus: params.sharedCorpus ?? null,
      artifact_path: params.remoteArtifactPath ?? null,
      report_path: params.remoteReportPath ?? null,
      import_task_ids: params.importTaskIds ?? [],
      queue_progress: params.queueProgress ?? null,
      queue_progress_error: params.queueProgressError ?? null,
    },
    created_at: params.now,
    updated_at: params.now,
  });
  return reportPath;
}
