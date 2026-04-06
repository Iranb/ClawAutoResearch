import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";
import { normalizeReviewScoreRecords } from "./authoring-review-state";

const DEFAULT_REVIEW_ISSUES_PATH = "reviewer/REVIEW_ISSUES.json";

type ExperimentSearchStateLike = {
  status: string;
  currentMainStage: string | null;
  currentSubstage: string | null;
  frontierNodeIds: string[];
  bestNodeId: string | null;
  completedNodeIds: string[];
  failedNodeIds: string[];
  triedHyperparams: string[];
  completedAblations: string[];
  multiSeedStatus: string;
  evaluationSummaryPath: string | null;
  plotPackStatus: string;
  plotPackPath: string | null;
  stageProgressPath: string | null;
  checkpointPath: string | null;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

type OrchestrationStateLike = {
  status: string;
  activeTicketId: string | null;
  stageRunId: string | null;
  currentOwner: string | null;
  nextOwner: string | null;
  nextTransitionCandidate: string | null;
  blockingCategory: string | null;
  blockingReason: string | null;
  retryBudgetRemaining: number | null;
  lastContractEvalAt: string | null;
  lastContractEvalResult: string | null;
  rollbackTargetStage: string | null;
  resumeCursor: string | null;
  lastUpdatedAt: string | null;
};

type WritePackageStateLike = {
  status: string;
  assemblyStatus: string | null;
  assemblyMode: string | null;
  winningTrackIds: string[];
  claimEvidenceMatrixPath: string | null;
  narrativeReportPath: string | null;
  trackVerdictsPath: string | null;
  unsupportedClaimsPath: string | null;
  baselineSummaryPath: string | null;
  researchSummaryPath: string | null;
  ablationSummaryPath: string | null;
  evaluationSummaryPath: string | null;
  figurePackPath: string | null;
  tablePackPath: string | null;
  proofPacketDir: string | null;
  citationCandidatesPath: string | null;
  packageManifestPath: string | null;
  assemblyReportPath: string | null;
  sectionAssemblyQueuePath: string | null;
  sourceArtifactCount: number;
  derivedArtifactCount: number;
  assembledAt: string | null;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

type PaperQcStateLike = {
  status: string;
  compileStatus: string;
  compileRoundCount: number;
  chktexStatus: string;
  pageBudgetStatus: string;
  referenceStartPage: number | null;
  bodyPageCount: number | null;
  unusedFigureStatus: string;
  invalidFigureRefStatus: string;
  reflectionRoundCount: number;
  latestReportPath: string | null;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

type CitationCollectionStateLike = {
  status: string;
  progressPath: string | null;
  cacheBibPath: string | null;
  candidateCount: number;
  verifiedCount: number;
  suspiciousCount: number;
  hallucinatedCount: number;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

type FigureQcStateLike = {
  status: string;
  figureReviewPath: string | null;
  figureSelectionPath: string | null;
  duplicateFigureStatus: string;
  captionAlignmentStatus: string;
  textAlignmentStatus: string;
  selectionStatus: string;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

type ReviewIssueCountsLike = {
  critical: number;
  high: number;
  medium: number;
  low: number;
};

type ReviewIssueStateLike = {
  issueId: string;
  lane: string | null;
  severity: string | null;
  title: string | null;
  description: string | null;
  targetStage: string | null;
  targetArtifact: string | null;
  openedBy: string | null;
  owner: string | null;
  status: string | null;
  fixArtifactPaths: string[];
  verifiedAt: string | null;
  waiverReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type ReviewIssueTrackerStateLike = {
  status: string;
  openCounts: ReviewIssueCountsLike;
  issueManifestPath: string | null;
  issues: ReviewIssueStateLike[];
  scoreRecords: ReturnType<typeof normalizeReviewScoreRecords>;
  lastReviewRound: number;
  lastUpdatedAt: string | null;
  pendingReason: string | null;
};

export function normalizeExperimentSearchState(
  value: unknown
): ExperimentSearchStateLike {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "not_started",
    currentMainStage:
      normalizeStage(record.currentMainStage ?? record.current_main_stage) ?? null,
    currentSubstage:
      normalizeStage(record.currentSubstage ?? record.current_substage) ?? null,
    frontierNodeIds: asStringArray(
      record.frontierNodeIds ?? record.frontier_node_ids
    ),
    bestNodeId: pickString(record, ["bestNodeId", "best_node_id"]),
    completedNodeIds: asStringArray(
      record.completedNodeIds ?? record.completed_node_ids
    ),
    failedNodeIds: asStringArray(record.failedNodeIds ?? record.failed_node_ids),
    triedHyperparams: asStringArray(
      record.triedHyperparams ?? record.tried_hyperparams
    ),
    completedAblations: asStringArray(
      record.completedAblations ?? record.completed_ablations
    ),
    multiSeedStatus:
      normalizeStage(record.multiSeedStatus ?? record.multi_seed_status) ??
      "pending",
    evaluationSummaryPath: pickString(record, [
      "evaluationSummaryPath",
      "evaluation_summary_path",
    ]),
    plotPackStatus:
      normalizeStage(record.plotPackStatus ?? record.plot_pack_status) ??
      "pending",
    plotPackPath: pickString(record, ["plotPackPath", "plot_pack_path"]),
    stageProgressPath: pickString(record, [
      "stageProgressPath",
      "stage_progress_path",
    ]),
    checkpointPath: pickString(record, ["checkpointPath", "checkpoint_path"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

export function serializeExperimentSearchState(
  state: ExperimentSearchStateLike
): Record<string, unknown> {
  return {
    status: state.status,
    current_main_stage: state.currentMainStage,
    current_substage: state.currentSubstage,
    frontier_node_ids: state.frontierNodeIds,
    best_node_id: state.bestNodeId,
    completed_node_ids: state.completedNodeIds,
    failed_node_ids: state.failedNodeIds,
    tried_hyperparams: state.triedHyperparams,
    completed_ablations: state.completedAblations,
    multi_seed_status: state.multiSeedStatus,
    evaluation_summary_path: state.evaluationSummaryPath,
    plot_pack_status: state.plotPackStatus,
    plot_pack_path: state.plotPackPath,
    stage_progress_path: state.stageProgressPath,
    checkpoint_path: state.checkpointPath,
    pending_reason: state.pendingReason,
    last_updated_at: state.lastUpdatedAt,
  };
}

export function normalizeOrchestrationState(
  value: unknown
): OrchestrationStateLike {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    activeTicketId: pickString(record, ["activeTicketId", "active_ticket_id"]),
    stageRunId: pickString(record, ["stageRunId", "stage_run_id"]),
    currentOwner: pickString(record, ["currentOwner", "current_owner"]),
    nextOwner: pickString(record, ["nextOwner", "next_owner"]),
    nextTransitionCandidate: pickString(record, [
      "nextTransitionCandidate",
      "next_transition_candidate",
    ]),
    blockingCategory: pickString(record, [
      "blockingCategory",
      "blocking_category",
    ]),
    blockingReason: pickString(record, ["blockingReason", "blocking_reason"]),
    retryBudgetRemaining: pickNumber(record, [
      "retryBudgetRemaining",
      "retry_budget_remaining",
    ]),
    lastContractEvalAt: pickString(record, [
      "lastContractEvalAt",
      "last_contract_eval_at",
    ]),
    lastContractEvalResult: pickString(record, [
      "lastContractEvalResult",
      "last_contract_eval_result",
    ]),
    rollbackTargetStage: pickString(record, [
      "rollbackTargetStage",
      "rollback_target_stage",
    ]),
    resumeCursor: pickString(record, ["resumeCursor", "resume_cursor"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

export function serializeOrchestrationState(
  value: OrchestrationStateLike
): Record<string, unknown> {
  return {
    status: value.status,
    active_ticket_id: value.activeTicketId,
    stage_run_id: value.stageRunId,
    current_owner: value.currentOwner,
    next_owner: value.nextOwner,
    next_transition_candidate: value.nextTransitionCandidate,
    blocking_category: value.blockingCategory,
    blocking_reason: value.blockingReason,
    retry_budget_remaining: value.retryBudgetRemaining,
    last_contract_eval_at: value.lastContractEvalAt,
    last_contract_eval_result: value.lastContractEvalResult,
    rollback_target_stage: value.rollbackTargetStage,
    resume_cursor: value.resumeCursor,
    last_updated_at: value.lastUpdatedAt,
  };
}

export function normalizeWritePackageState(
  value: unknown
): WritePackageStateLike {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    assemblyStatus:
      normalizeStage(record.assemblyStatus ?? record.assembly_status) ?? null,
    assemblyMode: pickString(record, ["assemblyMode", "assembly_mode"]) ?? null,
    winningTrackIds: asStringArray(
      record.winningTrackIds ?? record.winning_track_ids
    ),
    claimEvidenceMatrixPath: pickString(record, [
      "claimEvidenceMatrixPath",
      "claim_evidence_matrix_path",
    ]),
    narrativeReportPath: pickString(record, [
      "narrativeReportPath",
      "narrative_report_path",
    ]),
    trackVerdictsPath: pickString(record, [
      "trackVerdictsPath",
      "track_verdicts_path",
    ]),
    unsupportedClaimsPath: pickString(record, [
      "unsupportedClaimsPath",
      "unsupported_claims_path",
    ]),
    baselineSummaryPath: pickString(record, [
      "baselineSummaryPath",
      "baseline_summary_path",
    ]),
    researchSummaryPath: pickString(record, [
      "researchSummaryPath",
      "research_summary_path",
    ]),
    ablationSummaryPath: pickString(record, [
      "ablationSummaryPath",
      "ablation_summary_path",
    ]),
    evaluationSummaryPath: pickString(record, [
      "evaluationSummaryPath",
      "evaluation_summary_path",
    ]),
    figurePackPath: pickString(record, ["figurePackPath", "figure_pack_path"]),
    tablePackPath: pickString(record, ["tablePackPath", "table_pack_path"]),
    proofPacketDir: pickString(record, ["proofPacketDir", "proof_packet_dir"]),
    citationCandidatesPath: pickString(record, [
      "citationCandidatesPath",
      "citation_candidates_path",
    ]),
    packageManifestPath: pickString(record, [
      "packageManifestPath",
      "package_manifest_path",
    ]),
    assemblyReportPath: pickString(record, [
      "assemblyReportPath",
      "assembly_report_path",
    ]),
    sectionAssemblyQueuePath: pickString(record, [
      "sectionAssemblyQueuePath",
      "section_assembly_queue_path",
    ]),
    sourceArtifactCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["sourceArtifactCount", "source_artifact_count"]) ?? 0
      )
    ),
    derivedArtifactCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["derivedArtifactCount", "derived_artifact_count"]) ?? 0
      )
    ),
    assembledAt: pickString(record, ["assembledAt", "assembled_at"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

export function serializeWritePackageState(
  value: WritePackageStateLike
): Record<string, unknown> {
  return {
    status: value.status,
    assembly_status: value.assemblyStatus,
    assembly_mode: value.assemblyMode,
    winning_track_ids: value.winningTrackIds,
    claim_evidence_matrix_path: value.claimEvidenceMatrixPath,
    narrative_report_path: value.narrativeReportPath,
    track_verdicts_path: value.trackVerdictsPath,
    unsupported_claims_path: value.unsupportedClaimsPath,
    baseline_summary_path: value.baselineSummaryPath,
    research_summary_path: value.researchSummaryPath,
    ablation_summary_path: value.ablationSummaryPath,
    evaluation_summary_path: value.evaluationSummaryPath,
    figure_pack_path: value.figurePackPath,
    table_pack_path: value.tablePackPath,
    proof_packet_dir: value.proofPacketDir,
    citation_candidates_path: value.citationCandidatesPath,
    package_manifest_path: value.packageManifestPath,
    assembly_report_path: value.assemblyReportPath,
    section_assembly_queue_path: value.sectionAssemblyQueuePath,
    source_artifact_count: value.sourceArtifactCount,
    derived_artifact_count: value.derivedArtifactCount,
    assembled_at: value.assembledAt,
    pending_reason: value.pendingReason,
    last_updated_at: value.lastUpdatedAt,
  };
}

export function normalizePaperQcState(value: unknown): PaperQcStateLike {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    compileStatus:
      normalizeStage(record.compileStatus ?? record.compile_status) ?? "pending",
    compileRoundCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["compileRoundCount", "compile_round_count"]) ?? 0
      )
    ),
    chktexStatus:
      normalizeStage(record.chktexStatus ?? record.chktex_status) ?? "pending",
    pageBudgetStatus:
      normalizeStage(record.pageBudgetStatus ?? record.page_budget_status) ??
      "pending",
    referenceStartPage:
      pickNumber(record, ["referenceStartPage", "reference_start_page"]) ?? null,
    bodyPageCount: pickNumber(record, ["bodyPageCount", "body_page_count"]) ?? null,
    unusedFigureStatus:
      normalizeStage(record.unusedFigureStatus ?? record.unused_figure_status) ??
      "pending",
    invalidFigureRefStatus:
      normalizeStage(
        record.invalidFigureRefStatus ?? record.invalid_figure_ref_status
      ) ?? "pending",
    reflectionRoundCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["reflectionRoundCount", "reflection_round_count"]) ?? 0
      )
    ),
    latestReportPath: pickString(record, ["latestReportPath", "latest_report_path"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

export function serializePaperQcState(
  state: PaperQcStateLike
): Record<string, unknown> {
  return {
    status: state.status,
    compile_status: state.compileStatus,
    compile_round_count: state.compileRoundCount,
    chktex_status: state.chktexStatus,
    page_budget_status: state.pageBudgetStatus,
    reference_start_page: state.referenceStartPage,
    body_page_count: state.bodyPageCount,
    unused_figure_status: state.unusedFigureStatus,
    invalid_figure_ref_status: state.invalidFigureRefStatus,
    reflection_round_count: state.reflectionRoundCount,
    latest_report_path: state.latestReportPath,
    pending_reason: state.pendingReason,
    last_updated_at: state.lastUpdatedAt,
  };
}

export function normalizeCitationCollectionState(
  value: unknown
): CitationCollectionStateLike {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    progressPath: pickString(record, ["progressPath", "progress_path"]),
    cacheBibPath: pickString(record, ["cacheBibPath", "cache_bib_path"]),
    candidateCount: Math.max(
      0,
      Math.floor(pickNumber(record, ["candidateCount", "candidate_count"]) ?? 0)
    ),
    verifiedCount: Math.max(
      0,
      Math.floor(pickNumber(record, ["verifiedCount", "verified_count"]) ?? 0)
    ),
    suspiciousCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["suspiciousCount", "suspicious_count"]) ?? 0
      )
    ),
    hallucinatedCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["hallucinatedCount", "hallucinated_count"]) ?? 0
      )
    ),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

export function serializeCitationCollectionState(
  state: CitationCollectionStateLike
): Record<string, unknown> {
  return {
    status: state.status,
    progress_path: state.progressPath,
    cache_bib_path: state.cacheBibPath,
    candidate_count: state.candidateCount,
    verified_count: state.verifiedCount,
    suspicious_count: state.suspiciousCount,
    hallucinated_count: state.hallucinatedCount,
    pending_reason: state.pendingReason,
    last_updated_at: state.lastUpdatedAt,
  };
}

export function normalizeFigureQcState(value: unknown): FigureQcStateLike {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    figureReviewPath: pickString(record, [
      "figureReviewPath",
      "figure_review_path",
    ]),
    figureSelectionPath: pickString(record, [
      "figureSelectionPath",
      "figure_selection_path",
    ]),
    duplicateFigureStatus:
      normalizeStage(
        record.duplicateFigureStatus ?? record.duplicate_figure_status
      ) ?? "pending",
    captionAlignmentStatus:
      normalizeStage(
        record.captionAlignmentStatus ?? record.caption_alignment_status
      ) ?? "pending",
    textAlignmentStatus:
      normalizeStage(record.textAlignmentStatus ?? record.text_alignment_status) ??
      "pending",
    selectionStatus:
      normalizeStage(record.selectionStatus ?? record.selection_status) ?? "pending",
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

export function serializeFigureQcState(
  state: FigureQcStateLike
): Record<string, unknown> {
  return {
    status: state.status,
    figure_review_path: state.figureReviewPath,
    figure_selection_path: state.figureSelectionPath,
    duplicate_figure_status: state.duplicateFigureStatus,
    caption_alignment_status: state.captionAlignmentStatus,
    text_alignment_status: state.textAlignmentStatus,
    selection_status: state.selectionStatus,
    pending_reason: state.pendingReason,
    last_updated_at: state.lastUpdatedAt,
  };
}

export function normalizeReviewIssueCounts(
  value: unknown
): ReviewIssueCountsLike {
  const record = asRecord(value) ?? {};
  return {
    critical: Math.max(0, Math.floor(pickNumber(record, ["critical"]) ?? 0)),
    high: Math.max(0, Math.floor(pickNumber(record, ["high"]) ?? 0)),
    medium: Math.max(0, Math.floor(pickNumber(record, ["medium"]) ?? 0)),
    low: Math.max(0, Math.floor(pickNumber(record, ["low"]) ?? 0)),
  };
}

export function serializeReviewIssueCounts(
  counts: ReviewIssueCountsLike
): Record<string, unknown> {
  return {
    critical: counts.critical,
    high: counts.high,
    medium: counts.medium,
    low: counts.low,
  };
}

export function normalizeReviewIssueState(
  value: unknown
): ReviewIssueStateLike {
  const record = asRecord(value) ?? {};
  return {
    issueId:
      pickString(record, ["issueId", "issue_id", "id"]) ??
      `issue-${Math.random().toString(36).slice(2, 8)}`,
    lane: normalizeStage(record.lane) ?? null,
    severity: normalizeStage(record.severity) ?? "low",
    title: pickString(record, ["title"]),
    description: pickString(record, ["description"]),
    targetStage: normalizeStage(record.targetStage ?? record.target_stage),
    targetArtifact: pickString(record, ["targetArtifact", "target_artifact"]),
    openedBy: pickString(record, ["openedBy", "opened_by"]),
    owner: pickString(record, ["owner"]),
    status: normalizeStage(record.status) ?? "open",
    fixArtifactPaths: asStringArray(
      record.fixArtifactPaths ?? record.fix_artifact_paths
    ),
    verifiedAt: pickString(record, ["verifiedAt", "verified_at"]),
    waiverReason: pickString(record, ["waiverReason", "waiver_reason"]),
    createdAt: pickString(record, ["createdAt", "created_at"]),
    updatedAt: pickString(record, ["updatedAt", "updated_at"]),
  };
}

export function serializeReviewIssueState(
  issue: ReviewIssueStateLike
): Record<string, unknown> {
  return {
    issue_id: issue.issueId,
    lane: issue.lane,
    severity: issue.severity,
    title: issue.title,
    description: issue.description,
    target_stage: issue.targetStage,
    target_artifact: issue.targetArtifact,
    opened_by: issue.openedBy,
    owner: issue.owner,
    status: issue.status,
    fix_artifact_paths: issue.fixArtifactPaths,
    verified_at: issue.verifiedAt,
    waiver_reason: issue.waiverReason,
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
  };
}

export function normalizeReviewIssueTrackerState(
  value: unknown
): ReviewIssueTrackerStateLike {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    openCounts: normalizeReviewIssueCounts(
      record.openCounts ?? record.open_counts
    ),
    issueManifestPath:
      pickString(record, ["issueManifestPath", "issue_manifest_path"]) ??
      DEFAULT_REVIEW_ISSUES_PATH,
    issues: Array.isArray(record.issues)
      ? record.issues.map((issue) => normalizeReviewIssueState(issue))
      : [],
    scoreRecords: normalizeReviewScoreRecords(
      record.scoreRecords ?? record.score_records
    ),
    lastReviewRound: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["lastReviewRound", "last_review_round"]) ?? 0
      )
    ),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

export function serializeReviewIssueTrackerState(
  state: ReviewIssueTrackerStateLike
): Record<string, unknown> {
  return {
    status: state.status,
    open_counts: serializeReviewIssueCounts(state.openCounts),
    issue_manifest_path: state.issueManifestPath,
    issues: state.issues.map((issue) => serializeReviewIssueState(issue)),
    score_records: state.scoreRecords,
    last_review_round: state.lastReviewRound,
    last_updated_at: state.lastUpdatedAt,
    pending_reason: state.pendingReason,
  };
}
