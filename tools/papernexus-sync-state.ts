import * as path from "node:path";
import { readJsonIfExists, writeJsonEnsured } from "./workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "./workflow-guard-core/paths";
import type { PapernexusTaskCertification } from "./papernexus-task-certification";
import type { PapernexusGraphBuildReceipt } from "./papernexus-graph-build-receipt";

export const DEFAULT_PAPERNEXUS_SYNC_STATE_PATH =
  "graph/PAPERNEXUS_SYNC_STATE.json";

export type PapernexusSyncAuthorityMode =
  | "remote_mcp"
  | "remote_api"
  | "local_mcp"
  | "local_corpus"
  | "unknown";

export type PapernexusSyncGraphPresenceStatus =
  | "ready"
  | "waiting"
  | "blocked"
  | "degraded";

export type PapernexusSyncReadyProofLevel =
  | "source_span"
  | "paper_index"
  | "remote_summary"
  | "none";

export type PapernexusSyncWorkflowRuntimeStatus =
  | "ready"
  | "waiting_import"
  | "waiting_graph"
  | "blocked"
  | "degraded";

type JsonRecord = Record<string, unknown>;

export type PapernexusSyncPaperProjection = {
  canonical_id: string | null;
  title: string | null;
  corpus_paper_id?: string | null;
  corpus_source_key?: string | null;
  matched_by?: string | null;
  has_paper_index_evidence?: boolean;
  has_source_span_evidence?: boolean;
};

export type PapernexusSyncMissingPaperProjection = {
  canonical_id: string | null;
  title: string | null;
  arxiv_id?: string | null;
  doi?: string | null;
  source_kind?: string | null;
  source_provider?: string | null;
};

export type PapernexusSyncState = {
  schema_version: 1;
  project_id: string | null;
  generated_at: string;
  authority: {
    mode: PapernexusSyncAuthorityMode;
    corpus: string | null;
    api_fallback_used: boolean;
    tool_versions: JsonRecord;
  };
  desired_corpus: {
    source: string | null;
    paper_count: number;
    papers: string[];
  };
  discovery: {
    metadata_only_count: number;
    source_resolved_count: number;
  };
  imports: {
    total_count: number;
    pending_count: number;
    running_count: number;
    completed_count: number;
    failed_count: number;
    remaining_count: number;
    tasks: JsonRecord[];
  };
  graph_presence: {
    status: PapernexusSyncGraphPresenceStatus;
    ready_proof_level: PapernexusSyncReadyProofLevel;
    verification_mode: string | null;
    expected_paper_count: number;
    present_paper_count: number;
    missing_paper_count: number;
    source_backed_present_count: number;
    paper_index_present_count: number;
    present_papers: PapernexusSyncPaperProjection[];
    missing_papers: PapernexusSyncMissingPaperProjection[];
  };
  proof: {
    latest_receipt_path: string | null;
    certification_path: string | null;
    graph_presence_report_path: string | null;
    source_backed_graph_claim: boolean;
    graph_visibility: "verified" | "unverified" | "unavailable";
    graph_fingerprint: string | null;
    min_required_satisfied: boolean;
  };
  workflow_projection: {
    runtime_status: PapernexusSyncWorkflowRuntimeStatus;
    can_continue: boolean;
    blocking_reason: string | null;
    next_action: string;
  };
  conflicts: string[];
};

export type PapernexusSyncGraphPresenceInput = {
  projectId: string | null;
  checkedAt: string;
  status: string | null;
  verificationMode: string | null;
  reportPath: string | null;
  paperSourceIndexPath: string | null;
  expectedPaperCount: number;
  presentPaperCount: number;
  missingPaperCount: number;
  readyProofLevel: PapernexusSyncReadyProofLevel;
  sourceBackedPresentCount: number;
  paperIndexPresentCount: number;
  corpusName: string | null;
  refreshRequired: boolean;
  refreshReason: string | null;
  repairRequired: boolean;
  repairReason: string | null;
  presentPapers: unknown[];
  missingPapers: unknown[];
  graphBuildWorkflowStatus: string | null;
  graphBuildCanContinue: boolean;
  graphBuildRequiresImport: boolean;
  graphBuildStatusReason: string | null;
};

export type PapernexusSyncCertificationSummary = {
  sourceBackedGraphClaim: boolean;
  reportPath: string | null;
  limitations: string[];
  taskCount: number;
  completedTaskCount: number;
  failedTaskCount: number;
  queueRemaining: number;
  metadataOnlyPaperCount: number;
  sourceBackedPaperCount: number;
  tasks?: JsonRecord[];
};

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort();
}

function hasEvidenceRecord(value: unknown): boolean {
  const record = asRecord(value);
  return Boolean(record && Object.keys(record).length > 0);
}

function normalizeReadyProofLevel(value: unknown): PapernexusSyncReadyProofLevel {
  const normalized = asString(value)?.toLowerCase();
  return normalized === "source_span" ||
    normalized === "paper_index" ||
    normalized === "remote_summary" ||
    normalized === "none"
    ? normalized
    : "none";
}

function normalizeGraphVisibility(
  value: unknown
): PapernexusSyncState["proof"]["graph_visibility"] | null {
  const normalized = asString(value)?.toLowerCase();
  return normalized === "verified" ||
    normalized === "unverified" ||
    normalized === "unavailable"
    ? normalized
    : null;
}

function hasPerPaperGraphProofLevel(
  value: PapernexusSyncReadyProofLevel
): boolean {
  return value === "source_span" || value === "paper_index";
}

function authorityRequiresSourceBackedGraphProof(
  authorityMode: PapernexusSyncAuthorityMode
): boolean {
  return authorityMode === "remote_mcp" || authorityMode === "remote_api";
}

function normalizeGraphPresenceStatus(params: {
  status: string | null;
  expectedPaperCount: number;
  presentPaperCount: number;
  missingPaperCount: number;
  readyProofLevel: PapernexusSyncReadyProofLevel;
  refreshRequired: boolean;
  repairRequired: boolean;
  graphBuildRequiresImport: boolean;
}): PapernexusSyncGraphPresenceStatus {
  if (params.expectedPaperCount <= 0) {
    return "blocked";
  }
  if (
    params.status === "ready" &&
    params.presentPaperCount >= params.expectedPaperCount &&
    params.missingPaperCount === 0 &&
    !params.refreshRequired &&
    !params.repairRequired
  ) {
    return params.readyProofLevel === "source_span" ||
      params.readyProofLevel === "paper_index"
      ? "ready"
      : "degraded";
  }
  if (params.graphBuildRequiresImport || params.refreshRequired) {
    return "waiting";
  }
  return "blocked";
}

function normalizeWorkflowRuntimeStatus(params: {
  graphStatus: PapernexusSyncGraphPresenceStatus;
  canContinue: boolean;
  graphBuildRequiresImport: boolean;
}): PapernexusSyncWorkflowRuntimeStatus {
  if (params.canContinue) {
    return "ready";
  }
  if (params.graphStatus === "degraded") {
    return "degraded";
  }
  if (params.graphBuildRequiresImport) {
    return "waiting_import";
  }
  if (params.graphStatus === "waiting") {
    return "waiting_graph";
  }
  return "blocked";
}

function buildBlockingReason(params: {
  graphStatus: PapernexusSyncGraphPresenceStatus;
  graphBuildStatusReason: string | null;
  refreshReason: string | null;
  repairReason: string | null;
  limitations: string[];
}): string | null {
  if (params.graphStatus === "ready") {
    return null;
  }
  return (
    params.graphBuildStatusReason ??
    params.repairReason ??
    params.refreshReason ??
    params.limitations[0] ??
    "PaperNexus graph evidence is not source-backed ready."
  );
}

function buildNextAction(params: {
  runtimeStatus: PapernexusSyncWorkflowRuntimeStatus;
  graphBuildRequiresImport: boolean;
  readyProofLevel: PapernexusSyncReadyProofLevel;
}): string {
  if (params.runtimeStatus === "ready") {
    return "continue workflow";
  }
  if (params.graphBuildRequiresImport || params.runtimeStatus === "waiting_import") {
    return "poll PaperNexus import_workflow until import tasks complete";
  }
  if (
    params.runtimeStatus === "degraded" ||
    params.readyProofLevel === "remote_summary"
  ) {
    return "refresh PaperNexus graph presence with per-paper source-backed evidence";
  }
  if (params.runtimeStatus === "waiting_graph") {
    return "rerun PaperNexus graph presence verification";
  }
  return "repair PaperNexus source import or graph certification";
}

function projectPresentPaper(entry: unknown): PapernexusSyncPaperProjection {
  const record = asRecord(entry) ?? {};
  return {
    canonical_id:
      asString(record.canonicalId) ??
      asString(record.canonical_id) ??
      asString(record.paperId) ??
      asString(record.paper_id),
    title:
      asString(record.title) ??
      asString(record.paperTitle) ??
      asString(record.paper_title),
    corpus_paper_id:
      asString(record.corpusPaperId) ?? asString(record.corpus_paper_id),
    corpus_source_key:
      asString(record.corpusSourceKey) ?? asString(record.corpus_source_key),
    matched_by: asString(record.matchedBy) ?? asString(record.matched_by),
    has_paper_index_evidence:
      hasEvidenceRecord(record.graphIndexEvidence) ||
      hasEvidenceRecord(record.graph_index_evidence) ||
      (asString(record.matchedBy) ?? asString(record.matched_by)) === "paper_source_index",
    has_source_span_evidence:
      hasEvidenceRecord(record.sourceSpanEvidence) ||
      hasEvidenceRecord(record.source_span_evidence),
  };
}

function projectMissingPaper(entry: unknown): PapernexusSyncMissingPaperProjection {
  const record = asRecord(entry) ?? {};
  return {
    canonical_id:
      asString(record.canonicalId) ??
      asString(record.canonical_id) ??
      asString(record.paperId) ??
      asString(record.paper_id),
    title: asString(record.title),
    arxiv_id: asString(record.arxivId) ?? asString(record.arxiv_id),
    doi: asString(record.doi),
    source_kind: asString(record.sourceKind) ?? asString(record.source_kind),
    source_provider:
      asString(record.sourceProvider) ?? asString(record.source_provider),
  };
}

function certificationTaskSummary(
  certification: PapernexusTaskCertification | null | undefined,
  summary: PapernexusSyncCertificationSummary | null | undefined
): PapernexusSyncState["imports"] {
  if (summary) {
    const pending = Math.max(
      0,
      summary.taskCount - summary.completedTaskCount - summary.failedTaskCount
    );
    return {
      total_count: summary.taskCount,
      pending_count: pending,
      running_count: 0,
      completed_count: summary.completedTaskCount,
      failed_count: summary.failedTaskCount,
      remaining_count: Math.max(0, summary.queueRemaining),
      tasks: summary.tasks ?? [],
    };
  }
  const importTasks = certification?.upload.import_tasks;
  const total = importTasks?.task_count ?? 0;
  const completed = importTasks?.completed_task_count ?? 0;
  const failed = importTasks?.failed_task_count ?? 0;
  const remaining = certification?.upload.queue_remaining ?? 0;
  const pending = Math.max(0, total - completed - failed);
  return {
    total_count: total,
    pending_count: pending,
    running_count: 0,
    completed_count: completed,
    failed_count: failed,
    remaining_count: Math.max(0, remaining),
    tasks: importTasks?.items ?? [],
  };
}

function normalizeReceiptRecord(
  receipt: PapernexusGraphBuildReceipt | JsonRecord | null | undefined
): JsonRecord | null {
  return asRecord(receipt);
}

function receiptStatusClaimsGraphReady(receipt: JsonRecord | null): boolean {
  const status = asString(receipt?.status)?.toLowerCase();
  return status === "graph_ready" || status === "evidence_ready";
}

function readReceiptSourceBackedCount(receipt: JsonRecord | null): number | null {
  return asNumber(receipt?.source_backed_count) ??
    asNumber(receipt?.sourceBackedCount);
}

function readReceiptMinRequiredSatisfied(receipt: JsonRecord | null): boolean | null {
  const coverage = asRecord(receipt?.coverage);
  return asBoolean(
    coverage?.min_required_satisfied ?? coverage?.minRequiredSatisfied
  );
}

function buildSyncStateConflicts(params: {
  authorityMode: PapernexusSyncAuthorityMode;
  rawGraphStatus: string | null;
  graphStatus: PapernexusSyncGraphPresenceStatus;
  readyProofLevel: PapernexusSyncReadyProofLevel;
  expectedPaperCount: number;
  presentPaperCount: number;
  missingPaperCount: number;
  sourceBackedPresentCount: number;
  sourceBackedGraphClaim: boolean;
  graphBuildCanContinue: boolean;
  imports: PapernexusSyncState["imports"];
  receipt: JsonRecord | null;
}): string[] {
  const conflicts: string[] = [];
  const perPaperProof = hasPerPaperGraphProofLevel(params.readyProofLevel);
  const strictRemote = authorityRequiresSourceBackedGraphProof(
    params.authorityMode
  );
  if (params.rawGraphStatus === "ready" && params.graphStatus !== "ready") {
    conflicts.push(
      `graph_presence_reported_ready_without_usable_proof:${params.readyProofLevel}`
    );
  }
  if (
    params.expectedPaperCount > 0 &&
    params.presentPaperCount + params.missingPaperCount !== params.expectedPaperCount
  ) {
    conflicts.push("graph_presence_count_mismatch");
  }
  if (
    params.graphBuildCanContinue &&
    (params.graphStatus !== "ready" || !perPaperProof)
  ) {
    conflicts.push("graph_build_can_continue_without_per_paper_graph_proof");
  }
  if (
    strictRemote &&
    params.graphStatus === "ready" &&
    (params.readyProofLevel !== "source_span" ||
      params.sourceBackedPresentCount <= 0 ||
      !params.sourceBackedGraphClaim)
  ) {
    conflicts.push("strict_remote_ready_requires_source_backed_per_paper_proof");
  }
  const receipt = params.receipt;
  if (!receipt) {
    return conflicts;
  }
  const receiptReady = receiptStatusClaimsGraphReady(receipt);
  const receiptVisibility = normalizeGraphVisibility(
    receipt.graph_visibility ?? receipt.graphVisibility
  );
  const receiptSourceBackedCount = readReceiptSourceBackedCount(receipt) ?? 0;
  const receiptMinRequiredSatisfied =
    readReceiptMinRequiredSatisfied(receipt) === true;
  const receiptSourceBackedClaim =
    receipt.source_backed_graph_claim === true ||
    receipt.sourceBackedGraphClaim === true;
  if (
    receiptReady &&
    (params.graphStatus !== "ready" ||
      receiptVisibility !== "verified" ||
      !receiptSourceBackedClaim ||
      !receiptMinRequiredSatisfied ||
      receiptSourceBackedCount <= 0)
  ) {
    conflicts.push("receipt_graph_ready_conflicts_with_sync_evidence");
  }
  if (
    params.graphStatus === "ready" &&
    receiptReady === false &&
    authorityRequiresSourceBackedGraphProof(params.authorityMode)
  ) {
    conflicts.push("strict_remote_sync_ready_without_ready_receipt");
  }
  return conflicts;
}

export function buildPapernexusSyncStateFromGraphPresence(params: {
  projectId: string | null;
  authorityMode: PapernexusSyncAuthorityMode;
  corpus: string | null;
  graphPresence: PapernexusSyncGraphPresenceInput;
  certification?: PapernexusTaskCertification | null;
  certificationSummary?: PapernexusSyncCertificationSummary | null;
  receiptPath?: string | null;
  receipt?: PapernexusGraphBuildReceipt | JsonRecord | null;
  graphFingerprint?: string | null;
}): PapernexusSyncState {
  const certification = params.certification ?? null;
  const certificationSummary = params.certificationSummary ?? null;
  const receipt = normalizeReceiptRecord(params.receipt);
  const imports = certificationTaskSummary(certification, certificationSummary);
  const limitations =
    certificationSummary?.limitations ?? certification?.limitations ?? [];
  const readyProofLevel = normalizeReadyProofLevel(
    params.graphPresence.readyProofLevel
  );
  const rawGraphStatus = asString(params.graphPresence.status)?.toLowerCase() ?? null;
  const graphStatus = normalizeGraphPresenceStatus({
    status: params.graphPresence.status,
    expectedPaperCount: params.graphPresence.expectedPaperCount,
    presentPaperCount: params.graphPresence.presentPaperCount,
    missingPaperCount: params.graphPresence.missingPaperCount,
    readyProofLevel,
    refreshRequired: params.graphPresence.refreshRequired,
    repairRequired: params.graphPresence.repairRequired,
    graphBuildRequiresImport: params.graphPresence.graphBuildRequiresImport,
  });
  const sourceBackedGraphClaim = certificationSummary
    ? certificationSummary.sourceBackedGraphClaim === true
    : certification?.source_backed_graph_claim === true ||
      (readyProofLevel === "source_span" &&
        params.graphPresence.sourceBackedPresentCount > 0);
  const perPaperProof = hasPerPaperGraphProofLevel(readyProofLevel);
  const receiptMinRequiredSatisfied = readReceiptMinRequiredSatisfied(receipt);
  const minRequiredSatisfied =
    graphStatus === "ready" &&
    perPaperProof &&
    params.graphPresence.presentPaperCount >= params.graphPresence.expectedPaperCount &&
    params.graphPresence.expectedPaperCount > 0 &&
    params.graphPresence.missingPaperCount === 0 &&
    (receiptMinRequiredSatisfied ?? true);
  const conflicts = buildSyncStateConflicts({
    authorityMode: params.authorityMode,
    rawGraphStatus,
    graphStatus,
    readyProofLevel,
    expectedPaperCount: params.graphPresence.expectedPaperCount,
    presentPaperCount: params.graphPresence.presentPaperCount,
    missingPaperCount: params.graphPresence.missingPaperCount,
    sourceBackedPresentCount: params.graphPresence.sourceBackedPresentCount,
    sourceBackedGraphClaim,
    graphBuildCanContinue: params.graphPresence.graphBuildCanContinue,
    imports,
    receipt,
  });
  const strictRemote = authorityRequiresSourceBackedGraphProof(
    params.authorityMode
  );
  const canContinue =
    graphStatus === "ready" &&
    params.graphPresence.graphBuildCanContinue &&
    minRequiredSatisfied &&
    conflicts.length === 0 &&
    (!strictRemote || sourceBackedGraphClaim);
  const runtimeStatus = normalizeWorkflowRuntimeStatus({
    graphStatus,
    canContinue,
    graphBuildRequiresImport: params.graphPresence.graphBuildRequiresImport,
  });
  const presentPapers = params.graphPresence.presentPapers.map(projectPresentPaper);
  const missingPapers = params.graphPresence.missingPapers.map(projectMissingPaper);
  const desiredPaperIds = uniqueStrings([
    ...presentPapers.map((paper) => paper.canonical_id),
    ...missingPapers.map((paper) => paper.canonical_id),
  ]);
  return {
    schema_version: 1,
    project_id: params.projectId ?? params.graphPresence.projectId,
    generated_at: params.graphPresence.checkedAt,
    authority: {
      mode: params.authorityMode,
      corpus: params.graphPresence.corpusName ?? params.corpus,
      api_fallback_used: params.authorityMode === "remote_api",
      tool_versions: {},
    },
    desired_corpus: {
      source: params.graphPresence.paperSourceIndexPath,
      paper_count: params.graphPresence.expectedPaperCount,
      papers: desiredPaperIds,
    },
    discovery: {
      metadata_only_count:
        certificationSummary?.metadataOnlyPaperCount ??
        certification?.source_index.metadata_only_paper_count ?? 0,
      source_resolved_count:
        certificationSummary?.sourceBackedPaperCount ??
        certification?.source_index.source_backed_paper_count ?? 0,
    },
    imports,
    graph_presence: {
      status: graphStatus,
      ready_proof_level: readyProofLevel,
      verification_mode: params.graphPresence.verificationMode,
      expected_paper_count: params.graphPresence.expectedPaperCount,
      present_paper_count: params.graphPresence.presentPaperCount,
      missing_paper_count: params.graphPresence.missingPaperCount,
      source_backed_present_count:
        params.graphPresence.sourceBackedPresentCount,
      paper_index_present_count: params.graphPresence.paperIndexPresentCount,
      present_papers: presentPapers,
      missing_papers: missingPapers,
    },
    proof: {
      latest_receipt_path: params.receiptPath ?? null,
      certification_path:
      certification?.report_path ?? certificationSummary?.reportPath ?? null,
      graph_presence_report_path: params.graphPresence.reportPath,
      source_backed_graph_claim: sourceBackedGraphClaim,
      graph_visibility:
        normalizeGraphVisibility(
          receipt?.graph_visibility ?? receipt?.graphVisibility
        ) ?? (graphStatus === "ready" ? "verified" : "unverified"),
      graph_fingerprint: params.graphFingerprint ?? null,
      min_required_satisfied: minRequiredSatisfied,
    },
    workflow_projection: {
      runtime_status: runtimeStatus,
      can_continue: canContinue,
      blocking_reason: buildBlockingReason({
        graphStatus,
        graphBuildStatusReason: params.graphPresence.graphBuildStatusReason,
        refreshReason: params.graphPresence.refreshReason,
        repairReason: params.graphPresence.repairReason,
        limitations,
      }),
      next_action: buildNextAction({
        runtimeStatus,
        graphBuildRequiresImport: params.graphPresence.graphBuildRequiresImport,
        readyProofLevel,
      }),
    },
    conflicts,
  };
}

export async function writePapernexusSyncState(params: {
  projectRoot: string;
  state: PapernexusSyncState;
}): Promise<string> {
  const resolvedPath =
    resolveProjectArtifactPath(
      params.projectRoot,
      DEFAULT_PAPERNEXUS_SYNC_STATE_PATH
    ) ?? path.join(params.projectRoot, DEFAULT_PAPERNEXUS_SYNC_STATE_PATH);
  await writeJsonEnsured(resolvedPath, params.state);
  return DEFAULT_PAPERNEXUS_SYNC_STATE_PATH;
}

export async function readPapernexusSyncState(
  projectRoot: string
): Promise<PapernexusSyncState | null> {
  const resolvedPath =
    resolveProjectArtifactPath(projectRoot, DEFAULT_PAPERNEXUS_SYNC_STATE_PATH) ??
    path.join(projectRoot, DEFAULT_PAPERNEXUS_SYNC_STATE_PATH);
  const state = await readJsonIfExists<PapernexusSyncState>(resolvedPath);
  return state?.schema_version === 1 ? state : null;
}

export function papernexusSyncStateSupportsGraphReady(
  state: PapernexusSyncState | null
): boolean {
  if (!state || state.schema_version !== 1) {
    return false;
  }
  return (
    state.graph_presence.status === "ready" &&
    state.graph_presence.ready_proof_level === "source_span" &&
    state.graph_presence.expected_paper_count > 0 &&
    state.graph_presence.source_backed_present_count > 0 &&
    state.workflow_projection.can_continue === true &&
    state.proof.source_backed_graph_claim === true &&
    state.proof.graph_visibility === "verified" &&
    state.proof.min_required_satisfied === true &&
    Boolean(state.proof.latest_receipt_path)
  );
}

export function papernexusSyncStateAllowsWorkflowContinue(
  state: PapernexusSyncState | null,
  options?: { strictRemote?: boolean }
): boolean {
  if (!state || state.schema_version !== 1) {
    return false;
  }
  const strictRemote =
    options?.strictRemote ??
    authorityRequiresSourceBackedGraphProof(state.authority.mode);
  if (strictRemote) {
    return papernexusSyncStateSupportsGraphReady(state);
  }
  return (
    state.graph_presence.status === "ready" &&
    hasPerPaperGraphProofLevel(state.graph_presence.ready_proof_level) &&
    state.graph_presence.expected_paper_count > 0 &&
    state.graph_presence.present_paper_count >=
      state.graph_presence.expected_paper_count &&
    state.graph_presence.missing_paper_count === 0 &&
    state.workflow_projection.can_continue === true &&
    state.proof.graph_visibility === "verified" &&
    state.proof.min_required_satisfied === true &&
    state.conflicts.length === 0
  );
}

export function buildPapernexusSyncGraphPresenceInputFromReport(params: {
  report: JsonRecord;
  checkedAt: string;
  reportPath: string;
  projectId: string | null;
  sourceBackedPresentCount: number | null;
  paperIndexPresentCount: number | null;
}): PapernexusSyncGraphPresenceInput {
  const presentPapers = Array.isArray(params.report.present_papers)
    ? params.report.present_papers
    : Array.isArray(params.report.presentPapers)
      ? params.report.presentPapers
      : [];
  const missingPapers = Array.isArray(params.report.missing_papers)
    ? params.report.missing_papers
    : Array.isArray(params.report.missingPapers)
      ? params.report.missingPapers
      : [];
  return {
    projectId:
      asString(params.report.project_id) ??
      asString(params.report.projectId) ??
      params.projectId,
    checkedAt: params.checkedAt,
    status:
      asString(params.report.status) ??
      asString(params.report.graph_presence_status),
    verificationMode:
      asString(params.report.verification_mode) ??
      asString(params.report.verificationMode),
    reportPath: params.reportPath,
    paperSourceIndexPath:
      asString(params.report.paper_source_index_path) ??
      asString(params.report.paperSourceIndexPath),
    expectedPaperCount:
      asNumber(params.report.expected_paper_count) ??
      asNumber(params.report.expectedPaperCount) ??
      0,
    presentPaperCount:
      asNumber(params.report.present_paper_count) ??
      asNumber(params.report.presentPaperCount) ??
      presentPapers.length,
    missingPaperCount:
      asNumber(params.report.missing_paper_count) ??
      asNumber(params.report.missingPaperCount) ??
      missingPapers.length,
    readyProofLevel: normalizeReadyProofLevel(
      params.report.ready_proof_level ?? params.report.readyProofLevel
    ),
    sourceBackedPresentCount:
      params.sourceBackedPresentCount ??
      asNumber(params.report.source_backed_present_count) ??
      asNumber(params.report.sourceBackedPresentCount) ??
      0,
    paperIndexPresentCount:
      params.paperIndexPresentCount ??
      asNumber(params.report.paper_index_present_count) ??
      asNumber(params.report.paperIndexPresentCount) ??
      0,
    corpusName:
      asString(params.report.corpus_name) ?? asString(params.report.corpusName),
    refreshRequired:
      params.report.refresh_required === true ||
      params.report.refreshRequired === true,
    refreshReason:
      asString(params.report.refresh_reason) ??
      asString(params.report.refreshReason),
    repairRequired:
      params.report.repair_required === true ||
      params.report.repairRequired === true,
    repairReason:
      asString(params.report.repair_reason) ??
      asString(params.report.repairReason),
    presentPapers,
    missingPapers,
    graphBuildWorkflowStatus:
      asString(params.report.graph_build_workflow_status) ??
      asString(params.report.graphBuildWorkflowStatus),
    graphBuildCanContinue:
      params.report.graph_build_can_continue === true ||
      params.report.graphBuildCanContinue === true,
    graphBuildRequiresImport:
      params.report.graph_build_requires_import === true ||
      params.report.graphBuildRequiresImport === true,
    graphBuildStatusReason:
      asString(params.report.graph_build_status_reason) ??
      asString(params.report.graphBuildStatusReason),
  };
}
