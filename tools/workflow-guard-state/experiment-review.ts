import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";

export const DEFAULT_EXPERIMENT_REVIEW_STATE_PATH =
  "researcher/EXPERIMENT_REVIEW_STATE.json";
export const DEFAULT_EXPERIMENT_REVIEW_PACKET_PATH =
  "planner/EXPERIMENT_REVIEW_PACKET.json";
export const DEFAULT_EXPERIMENT_PLAN_PATH = "planner/EXPERIMENT_PLAN.md";
export const DEFAULT_EXPERIMENT_ANALYZER_REPORT_PATH =
  "analyzer/EXPERIMENT_REASONABLENESS_REPORT.md";
export const DEFAULT_EXPERIMENT_CROSS_REVIEWER_REPORT_PATH =
  "cross-reviewer/EXPERIMENT_ATTACK_REPORT.md";
export const DEFAULT_EXPERIMENT_LAUNCH_DECISION_PATH =
  "researcher/EXPERIMENT_LAUNCH_DECISION.json";

export type AutonomousExecutionStateLike = {
  experimentLaunchMode: "manual" | "reviewed_auto";
  maxExperimentReviewRounds: number;
  requireAnalyzerReview: boolean;
  requireCrossReview: boolean;
};

export type ExperimentReviewVerdict = "pass" | "revise" | "block" | null;

export type ExperimentReviewStateLike = {
  status: string;
  launchMode: "manual" | "reviewed_auto";
  microStage: string | null;
  reviewRound: number;
  stateFilePath: string | null;
  packetPath: string | null;
  plannerPlanPath: string | null;
  analyzerReportPath: string | null;
  crossReviewerReportPath: string | null;
  launchDecisionPath: string | null;
  packetFingerprint: string | null;
  targetTrackIds: string[];
  claimIds: string[];
  graphPacketPaths: string[];
  plannerStatus: string;
  analyzerStatus: string;
  crossReviewerStatus: string;
  synthesisStatus: string;
  analyzerVerdict: string | null;
  crossReviewerVerdict: string | null;
  launchApproved: boolean;
  blockerCount: number;
  blockers: string[];
  pendingReason: string | null;
  lastLaunchApprovedAt: string | null;
  lastUpdatedAt: string | null;
};

export function normalizeExperimentReviewVerdict(
  value: unknown
): ExperimentReviewVerdict {
  const verdict = pickString({ verdict: value }, ["verdict"])?.toLowerCase() ?? null;
  if (verdict === "pass" || verdict === "revise") {
    return verdict;
  }
  if (verdict === "block" || verdict === "blocked") {
    return "block";
  }
  return null;
}

export function coerceCompletedReviewStatus(
  status: unknown,
  verdict: unknown,
  currentStatus = "pending"
): string {
  const normalizedStatus = normalizeStage(status);
  const normalizedVerdict = normalizeExperimentReviewVerdict(verdict);
  if (normalizedVerdict) {
    return "ready";
  }
  if (normalizedStatus === "pending" || normalizedStatus === "skipped") {
    return normalizedStatus;
  }
  if (normalizedStatus === "ready" || normalizedStatus === "complete" || normalizedStatus === "completed") {
    return "ready";
  }
  return normalizeStage(currentStatus) ?? "pending";
}

export function isExperimentReviewCompleted(params: {
  status: unknown;
  verdict?: unknown;
}): boolean {
  const normalizedStatus = normalizeStage(params.status);
  if (normalizedStatus === "ready" || normalizedStatus === "skipped") {
    return true;
  }
  return normalizeExperimentReviewVerdict(params.verdict) !== null;
}

export function normalizeAutonomousExecutionState(
  value: unknown
): AutonomousExecutionStateLike {
  const record = asRecord(value) ?? {};
  const launchMode =
    pickString(record, ["experimentLaunchMode", "experiment_launch_mode"]) ===
    "reviewed_auto"
      ? "reviewed_auto"
      : "manual";
  return {
    experimentLaunchMode: launchMode,
    maxExperimentReviewRounds: Math.max(
      1,
      Math.floor(
        pickNumber(record, [
          "maxExperimentReviewRounds",
          "max_experiment_review_rounds",
        ]) ?? 2
      )
    ),
    requireAnalyzerReview:
      pickBoolean(record, ["requireAnalyzerReview", "require_analyzer_review"]) ??
      true,
    requireCrossReview:
      pickBoolean(record, ["requireCrossReview", "require_cross_review"]) ?? true,
  };
}

export function serializeAutonomousExecutionState(
  value: AutonomousExecutionStateLike
): Record<string, unknown> {
  return {
    experiment_launch_mode: value.experimentLaunchMode,
    max_experiment_review_rounds: value.maxExperimentReviewRounds,
    require_analyzer_review: value.requireAnalyzerReview,
    require_cross_review: value.requireCrossReview,
  };
}

export function normalizeExperimentReviewState(
  value: unknown
): ExperimentReviewStateLike {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    launchMode:
      pickString(record, ["launchMode", "launch_mode"]) === "reviewed_auto"
        ? "reviewed_auto"
        : "manual",
    microStage:
      normalizeStage(record.microStage ?? record.micro_stage) ??
      (normalizeStage(record.status) ?? "missing"),
    reviewRound: Math.max(
      0,
      Math.floor(pickNumber(record, ["reviewRound", "review_round"]) ?? 0)
    ),
    stateFilePath:
      pickString(record, ["stateFilePath", "state_file_path"]) ??
      DEFAULT_EXPERIMENT_REVIEW_STATE_PATH,
    packetPath:
      pickString(record, ["packetPath", "packet_path"]) ??
      DEFAULT_EXPERIMENT_REVIEW_PACKET_PATH,
    plannerPlanPath:
      pickString(record, ["plannerPlanPath", "planner_plan_path"]) ??
      DEFAULT_EXPERIMENT_PLAN_PATH,
    analyzerReportPath:
      pickString(record, ["analyzerReportPath", "analyzer_report_path"]) ??
      DEFAULT_EXPERIMENT_ANALYZER_REPORT_PATH,
    crossReviewerReportPath:
      pickString(record, [
        "crossReviewerReportPath",
        "cross_reviewer_report_path",
      ]) ?? DEFAULT_EXPERIMENT_CROSS_REVIEWER_REPORT_PATH,
    launchDecisionPath:
      pickString(record, ["launchDecisionPath", "launch_decision_path"]) ??
      DEFAULT_EXPERIMENT_LAUNCH_DECISION_PATH,
    packetFingerprint: pickString(record, [
      "packetFingerprint",
      "packet_fingerprint",
    ]),
    targetTrackIds: asStringArray(
      record.targetTrackIds ?? record.target_track_ids
    ),
    claimIds: asStringArray(record.claimIds ?? record.claim_ids),
    graphPacketPaths: asStringArray(
      record.graphPacketPaths ?? record.graph_packet_paths
    ),
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
    launchApproved:
      pickBoolean(record, ["launchApproved", "launch_approved"]) ?? false,
    blockerCount: Math.max(
      0,
      Math.floor(pickNumber(record, ["blockerCount", "blocker_count"]) ?? 0)
    ),
    blockers: asStringArray(record.blockers),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastLaunchApprovedAt: pickString(record, [
      "lastLaunchApprovedAt",
      "last_launch_approved_at",
    ]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

export function serializeExperimentReviewState(
  value: ExperimentReviewStateLike
): Record<string, unknown> {
  return {
    status: value.status,
    launch_mode: value.launchMode,
    micro_stage: value.microStage,
    review_round: value.reviewRound,
    state_file_path: value.stateFilePath,
    packet_path: value.packetPath,
    planner_plan_path: value.plannerPlanPath,
    analyzer_report_path: value.analyzerReportPath,
    cross_reviewer_report_path: value.crossReviewerReportPath,
    launch_decision_path: value.launchDecisionPath,
    packet_fingerprint: value.packetFingerprint,
    target_track_ids: value.targetTrackIds,
    claim_ids: value.claimIds,
    graph_packet_paths: value.graphPacketPaths,
    planner_status: value.plannerStatus,
    analyzer_status: value.analyzerStatus,
    cross_reviewer_status: value.crossReviewerStatus,
    synthesis_status: value.synthesisStatus,
    analyzer_verdict: value.analyzerVerdict,
    cross_reviewer_verdict: value.crossReviewerVerdict,
    launch_approved: value.launchApproved,
    blocker_count: value.blockerCount,
    blockers: value.blockers,
    pending_reason: value.pendingReason,
    last_launch_approved_at: value.lastLaunchApprovedAt,
    last_updated_at: value.lastUpdatedAt,
  };
}
