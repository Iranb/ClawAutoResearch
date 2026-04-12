import {
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";

export const DEFAULT_EXPERIMENT_SEARCH_REVIEW_STATE_PATH =
  "researcher/EXPERIMENT_SEARCH_GIT_REVIEW_STATE.json";
export const DEFAULT_EXPERIMENT_SEARCH_REVIEW_PACKET_PATH =
  "planner/EXPERIMENT_SEARCH_GIT_REVIEW_PACKET.json";
export const DEFAULT_EXPERIMENT_SEARCH_REVIEW_PLAN_PATH =
  "planner/EXPERIMENT_SEARCH_GIT_PLAN.md";
export const DEFAULT_EXPERIMENT_SEARCH_ANALYZER_REPORT_PATH =
  "analyzer/EXPERIMENT_SEARCH_GIT_REASONABLENESS_REPORT.md";
export const DEFAULT_EXPERIMENT_SEARCH_CROSS_REVIEWER_REPORT_PATH =
  "cross-reviewer/EXPERIMENT_SEARCH_GIT_ATTACK_REPORT.md";
export const DEFAULT_EXPERIMENT_SEARCH_DECISION_PATH =
  "researcher/EXPERIMENT_SEARCH_GIT_DECISION.json";

export type ExperimentSearchReviewVerdict = "pass" | "revise" | "block" | null;

export type ExperimentSearchReviewStateLike = {
  status: string;
  microStage: string | null;
  actionId: string | null;
  actionType: string | null;
  actionStatus: string;
  stateFilePath: string | null;
  packetPath: string | null;
  plannerPlanPath: string | null;
  analyzerReportPath: string | null;
  crossReviewerReportPath: string | null;
  decisionPath: string | null;
  packetFingerprint: string | null;
  searchSessionId: string | null;
  searchSpecPath: string | null;
  searchStatePath: string | null;
  trackId: string | null;
  experimentId: string | null;
  incumbentBranch: string | null;
  incumbentCommit: string | null;
  candidateBranch: string | null;
  candidateCommit: string | null;
  candidateWorktreePath: string | null;
  requestSummary: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
  plannerStatus: string;
  analyzerStatus: string;
  crossReviewerStatus: string;
  synthesisStatus: string;
  analyzerVerdict: string | null;
  crossReviewerVerdict: string | null;
  actionApproved: boolean;
  blockerCount: number;
  blockers: string[];
  promotionBasisSignals: string[];
  promotionEvidenceSummary: string | null;
  discardReason: string | null;
  failureClass: string | null;
  appliedAt: string | null;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

export function normalizeExperimentSearchReviewVerdict(
  value: unknown
): ExperimentSearchReviewVerdict {
  const verdict = pickString({ verdict: value }, ["verdict"])?.toLowerCase() ?? null;
  if (verdict === "pass" || verdict === "revise") {
    return verdict;
  }
  if (verdict === "block" || verdict === "blocked") {
    return "block";
  }
  return null;
}

export function coerceCompletedSearchReviewStatus(
  status: unknown,
  verdict: unknown,
  currentStatus = "pending"
): string {
  const normalizedStatus = normalizeStage(status);
  const normalizedVerdict = normalizeExperimentSearchReviewVerdict(verdict);
  if (normalizedVerdict) {
    return "ready";
  }
  if (normalizedStatus === "pending" || normalizedStatus === "skipped") {
    return normalizedStatus;
  }
  if (
    normalizedStatus === "ready" ||
    normalizedStatus === "complete" ||
    normalizedStatus === "completed"
  ) {
    return "ready";
  }
  return normalizeStage(currentStatus) ?? "pending";
}

export function isExperimentSearchReviewCompleted(params: {
  status: unknown;
  verdict?: unknown;
}): boolean {
  const normalizedStatus = normalizeStage(params.status);
  if (normalizedStatus === "ready" || normalizedStatus === "skipped") {
    return true;
  }
  return normalizeExperimentSearchReviewVerdict(params.verdict) !== null;
}

export function normalizeExperimentSearchReviewState(
  value: unknown
): ExperimentSearchReviewStateLike {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    microStage:
      normalizeStage(record.microStage ?? record.micro_stage) ??
      (normalizeStage(record.status) ?? "missing"),
    actionId: pickString(record, ["actionId", "action_id"]),
    actionType: pickString(record, ["actionType", "action_type"]),
    actionStatus:
      normalizeStage(record.actionStatus ?? record.action_status) ?? "requested",
    stateFilePath:
      pickString(record, ["stateFilePath", "state_file_path"]) ??
      DEFAULT_EXPERIMENT_SEARCH_REVIEW_STATE_PATH,
    packetPath:
      pickString(record, ["packetPath", "packet_path"]) ??
      DEFAULT_EXPERIMENT_SEARCH_REVIEW_PACKET_PATH,
    plannerPlanPath:
      pickString(record, ["plannerPlanPath", "planner_plan_path"]) ??
      DEFAULT_EXPERIMENT_SEARCH_REVIEW_PLAN_PATH,
    analyzerReportPath:
      pickString(record, ["analyzerReportPath", "analyzer_report_path"]) ??
      DEFAULT_EXPERIMENT_SEARCH_ANALYZER_REPORT_PATH,
    crossReviewerReportPath:
      pickString(record, [
        "crossReviewerReportPath",
        "cross_reviewer_report_path",
      ]) ?? DEFAULT_EXPERIMENT_SEARCH_CROSS_REVIEWER_REPORT_PATH,
    decisionPath:
      pickString(record, ["decisionPath", "decision_path"]) ??
      DEFAULT_EXPERIMENT_SEARCH_DECISION_PATH,
    packetFingerprint: pickString(record, [
      "packetFingerprint",
      "packet_fingerprint",
    ]),
    searchSessionId: pickString(record, [
      "searchSessionId",
      "search_session_id",
    ]),
    searchSpecPath: pickString(record, ["searchSpecPath", "search_spec_path"]),
    searchStatePath: pickString(record, ["searchStatePath", "search_state_path"]),
    trackId: pickString(record, ["trackId", "track_id"]),
    experimentId: pickString(record, ["experimentId", "experiment_id"]),
    incumbentBranch: pickString(record, [
      "incumbentBranch",
      "incumbent_branch",
    ]),
    incumbentCommit: pickString(record, [
      "incumbentCommit",
      "incumbent_commit",
    ]),
    candidateBranch: pickString(record, [
      "candidateBranch",
      "candidate_branch",
    ]),
    candidateCommit: pickString(record, [
      "candidateCommit",
      "candidate_commit",
    ]),
    candidateWorktreePath: pickString(record, [
      "candidateWorktreePath",
      "candidate_worktree_path",
    ]),
    requestSummary: pickString(record, ["requestSummary", "request_summary"]),
    requestedBy: pickString(record, ["requestedBy", "requested_by"]),
    requestedAt: pickString(record, ["requestedAt", "requested_at"]),
    plannerStatus:
      normalizeStage(record.plannerStatus ?? record.planner_status) ?? "pending",
    analyzerStatus:
      normalizeStage(record.analyzerStatus ?? record.analyzer_status) ?? "pending",
    crossReviewerStatus:
      normalizeStage(record.crossReviewerStatus ?? record.cross_reviewer_status) ??
      "pending",
    synthesisStatus:
      normalizeStage(record.synthesisStatus ?? record.synthesis_status) ??
      "pending",
    analyzerVerdict: pickString(record, [
      "analyzerVerdict",
      "analyzer_verdict",
    ]),
    crossReviewerVerdict: pickString(record, [
      "crossReviewerVerdict",
      "cross_reviewer_verdict",
    ]),
    actionApproved:
      pickBoolean(record, ["actionApproved", "action_approved"]) ?? false,
    blockerCount: Math.max(
      0,
      Math.floor(pickNumber(record, ["blockerCount", "blocker_count"]) ?? 0)
    ),
    blockers: asStringArray(record.blockers),
    promotionBasisSignals: asStringArray(
      record.promotionBasisSignals ?? record.promotion_basis_signals
    ),
    promotionEvidenceSummary: pickString(record, [
      "promotionEvidenceSummary",
      "promotion_evidence_summary",
    ]),
    discardReason: pickString(record, ["discardReason", "discard_reason"]),
    failureClass: pickString(record, ["failureClass", "failure_class"]),
    appliedAt: pickString(record, ["appliedAt", "applied_at"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

export function serializeExperimentSearchReviewState(
  value: ExperimentSearchReviewStateLike
): Record<string, unknown> {
  return {
    status: value.status,
    micro_stage: value.microStage,
    action_id: value.actionId,
    action_type: value.actionType,
    action_status: value.actionStatus,
    state_file_path: value.stateFilePath,
    packet_path: value.packetPath,
    planner_plan_path: value.plannerPlanPath,
    analyzer_report_path: value.analyzerReportPath,
    cross_reviewer_report_path: value.crossReviewerReportPath,
    decision_path: value.decisionPath,
    packet_fingerprint: value.packetFingerprint,
    search_session_id: value.searchSessionId,
    search_spec_path: value.searchSpecPath,
    search_state_path: value.searchStatePath,
    track_id: value.trackId,
    experiment_id: value.experimentId,
    incumbent_branch: value.incumbentBranch,
    incumbent_commit: value.incumbentCommit,
    candidate_branch: value.candidateBranch,
    candidate_commit: value.candidateCommit,
    candidate_worktree_path: value.candidateWorktreePath,
    request_summary: value.requestSummary,
    requested_by: value.requestedBy,
    requested_at: value.requestedAt,
    planner_status: value.plannerStatus,
    analyzer_status: value.analyzerStatus,
    cross_reviewer_status: value.crossReviewerStatus,
    synthesis_status: value.synthesisStatus,
    analyzer_verdict: value.analyzerVerdict,
    cross_reviewer_verdict: value.crossReviewerVerdict,
    action_approved: value.actionApproved,
    blocker_count: value.blockerCount,
    blockers: value.blockers,
    promotion_basis_signals: value.promotionBasisSignals,
    promotion_evidence_summary: value.promotionEvidenceSummary,
    discard_reason: value.discardReason,
    failure_class: value.failureClass,
    applied_at: value.appliedAt,
    pending_reason: value.pendingReason,
    last_updated_at: value.lastUpdatedAt,
  };
}
