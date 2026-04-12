import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
  uniqueStrings,
} from "./workflow-guard-core/coercion";
import {
  readJsonIfExists,
  writeJsonEnsured,
} from "./workflow-guard-core/fs";
import {
  loadExperimentSearchState,
  saveExperimentSearchStateFile,
} from "./workflow-guard-experiment-history";
import {
  materializeExperimentSearchReviewStateImpl,
} from "./workflow-guard-materializers/experiment-search-review-materializer.js";
import {
  buildExperimentSearchReviewSummary,
  loadExperimentSearchReviewState,
  saveExperimentSearchReviewStateFile,
} from "./workflow-auto-experiment-search-review.js";
import {
  coerceCompletedSearchReviewStatus,
  type ExperimentSearchReviewStateLike,
} from "./workflow-guard-state/experiment-search-review.js";
import {
  normalizeExperimentSearchSpec,
  resolveExperimentSearchSpecPath,
} from "./workflow-guard-state/experiment-search-spec.js";
import {
  serializeExperimentSearchState,
} from "./workflow-guard-state/execution-state";
import {
  executeExperimentGitAction,
  type ExperimentGitActionResult,
  type ExperimentGitActionType,
} from "./workflow-experiment-git.js";

type Deps = {
  readManifestEnsured: (projectRoot: string) => Promise<Record<string, unknown>>;
  saveManifest: (
    projectRoot: string,
    manifest: Record<string, unknown>
  ) => Promise<void>;
};

function deriveSearchGitOpStatus(
  reviewState: ExperimentSearchReviewStateLike
): string {
  if (reviewState.actionStatus === "applied" || reviewState.appliedAt) {
    return "applied";
  }
  if (
    reviewState.analyzerVerdict === "block" ||
    reviewState.crossReviewerVerdict === "block"
  ) {
    return "blocked";
  }
  if (reviewState.actionApproved) {
    return "approved";
  }
  if (
    reviewState.plannerStatus === "ready" ||
    reviewState.analyzerStatus === "ready" ||
    reviewState.crossReviewerStatus === "ready"
  ) {
    return "reviewing";
  }
  return "requested";
}

async function persistSearchState(params: {
  projectRoot: string;
  manifest: Record<string, unknown>;
  searchState: ReturnType<typeof loadExperimentSearchState> extends Promise<infer T>
    ? T
    : never;
  deps: Deps;
}) {
  params.manifest.experiment_search = serializeExperimentSearchState(params.searchState);
  await saveExperimentSearchStateFile({
    projectRoot: params.projectRoot,
    state: params.searchState,
    writeJsonEnsured,
  });
  await params.deps.saveManifest(params.projectRoot, params.manifest);
}

function removeString(values: string[], value: string | null): string[] {
  if (!value) {
    return values;
  }
  return values.filter((entry) => entry !== value);
}

function uniqueNormalizedSignals(values: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    const normalized = normalizeStage(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

function classifyDiscardFailure(params: {
  reviewState: ExperimentSearchReviewStateLike;
  searchState: Awaited<ReturnType<typeof loadExperimentSearchState>>;
}): string {
  const explicit = normalizeStage(params.reviewState.failureClass);
  if (explicit) {
    return explicit;
  }
  if (
    ["repair_implementation"].includes(
      normalizeStage(params.searchState.lastDecision) ?? ""
    )
  ) {
    return "implementation";
  }
  const pendingReason = `${params.reviewState.pendingReason ?? ""} ${params.reviewState.discardReason ?? ""}`.toLowerCase();
  if (/\boom\b|timeout|ssh|disk full|killed|connection/i.test(pendingReason)) {
    return "runtime";
  }
  if (/baseline fairness|implementation|protocol drift|shape mismatch|nan|traceback/i.test(pendingReason)) {
    return "implementation";
  }
  return "scientific";
}

export async function requestExperimentGitOpImpl(
  params: {
    projectRoot: string;
    agentId?: string | null;
    request: Record<string, unknown>;
  },
  deps: Deps
): Promise<{
  reviewState: ExperimentSearchReviewStateLike;
  reviewSummary: string;
  searchState: Awaited<ReturnType<typeof loadExperimentSearchState>>;
}> {
  const manifest = await deps.readManifestEnsured(params.projectRoot);
  const materialized = await materializeExperimentSearchReviewStateImpl(
    {
      projectRoot: params.projectRoot,
      experimentSearchReviewMaterialization: params.request,
      trigger: "request_experiment_git_op",
      agentId: params.agentId ?? null,
    },
    deps
  );
  const searchState = await loadExperimentSearchState({
    projectRoot: params.projectRoot,
    manifest,
    readJsonIfExists,
  });
  const nextSearchState = {
    ...searchState,
    requestedGitOp: materialized.state.actionType,
    gitOpStatus: deriveSearchGitOpStatus(materialized.state),
    gitReviewStorePath:
      materialized.state.stateFilePath ?? searchState.gitReviewStorePath,
    gitReviewPacketPath: materialized.state.packetPath ?? searchState.gitReviewPacketPath,
    candidateWorktreePath:
      materialized.state.candidateWorktreePath ?? searchState.candidateWorktreePath,
    candidateBaseCommit:
      materialized.state.incumbentCommit ?? searchState.candidateBaseCommit,
    candidateHeadCommit:
      materialized.state.candidateCommit ?? searchState.candidateHeadCommit,
    pendingReason:
      materialized.state.pendingReason ??
      "multi-agent workflow review is required before experiment git lineage changes",
    lastUpdatedAt: new Date().toISOString(),
  };
  await persistSearchState({
    projectRoot: params.projectRoot,
    manifest,
    searchState: nextSearchState,
    deps,
  });
  return {
    reviewState: materialized.state,
    reviewSummary: buildExperimentSearchReviewSummary(materialized.state),
    searchState: nextSearchState,
  };
}

export async function getExperimentGitReviewSummaryImpl(
  params: {
    projectRoot: string;
  },
  deps: Deps
): Promise<{
  reviewState: ExperimentSearchReviewStateLike;
  reviewSummary: string;
  searchState: Awaited<ReturnType<typeof loadExperimentSearchState>>;
}> {
  const manifest = await deps.readManifestEnsured(params.projectRoot);
  const searchState = await loadExperimentSearchState({
    projectRoot: params.projectRoot,
    manifest,
    readJsonIfExists,
  });
  const reviewState = await loadExperimentSearchReviewState({
    projectRoot: params.projectRoot,
    manifest: {
      ...manifest,
      experiment_search: {
        ...(asRecord(manifest.experiment_search) ?? {}),
        git_review_store_path: searchState.gitReviewStorePath,
      },
    },
  });
  return {
    reviewState,
    reviewSummary: buildExperimentSearchReviewSummary(reviewState),
    searchState,
  };
}

export async function setExperimentGitReviewStateImpl(
  params: {
    projectRoot: string;
    experimentGitReview: Record<string, unknown>;
  },
  deps: Deps
): Promise<{
  reviewState: ExperimentSearchReviewStateLike;
  reviewSummary: string;
  searchState: Awaited<ReturnType<typeof loadExperimentSearchState>>;
}> {
  const manifest = await deps.readManifestEnsured(params.projectRoot);
  const searchState = await loadExperimentSearchState({
    projectRoot: params.projectRoot,
    manifest,
    readJsonIfExists,
  });
  const current = await loadExperimentSearchReviewState({
    projectRoot: params.projectRoot,
    manifest: {
      ...manifest,
      experiment_search: {
        ...(asRecord(manifest.experiment_search) ?? {}),
        git_review_store_path: searchState.gitReviewStorePath,
      },
    },
  });
  const patch = asRecord(params.experimentGitReview) ?? {};
  const next: ExperimentSearchReviewStateLike = {
    ...current,
    status: normalizeStage(patch.status) ?? current.status,
    microStage:
      normalizeStage(patch.microStage ?? patch.micro_stage) ?? current.microStage,
    actionId: pickString(patch, ["actionId", "action_id"]) ?? current.actionId,
    actionType:
      pickString(patch, ["actionType", "action_type"]) ?? current.actionType,
    actionStatus:
      normalizeStage(patch.actionStatus ?? patch.action_status) ??
      current.actionStatus,
    stateFilePath:
      pickString(patch, ["stateFilePath", "state_file_path"]) ??
      current.stateFilePath,
    packetPath:
      pickString(patch, ["packetPath", "packet_path"]) ?? current.packetPath,
    plannerPlanPath:
      pickString(patch, ["plannerPlanPath", "planner_plan_path"]) ??
      current.plannerPlanPath,
    analyzerReportPath:
      pickString(patch, ["analyzerReportPath", "analyzer_report_path"]) ??
      current.analyzerReportPath,
    crossReviewerReportPath:
      pickString(patch, ["crossReviewerReportPath", "cross_reviewer_report_path"]) ??
      current.crossReviewerReportPath,
    decisionPath:
      pickString(patch, ["decisionPath", "decision_path"]) ?? current.decisionPath,
    packetFingerprint:
      pickString(patch, ["packetFingerprint", "packet_fingerprint"]) ??
      current.packetFingerprint,
    searchSessionId:
      pickString(patch, ["searchSessionId", "search_session_id"]) ??
      current.searchSessionId,
    searchSpecPath:
      pickString(patch, ["searchSpecPath", "search_spec_path"]) ??
      current.searchSpecPath,
    searchStatePath:
      pickString(patch, ["searchStatePath", "search_state_path"]) ??
      current.searchStatePath,
    trackId: pickString(patch, ["trackId", "track_id"]) ?? current.trackId,
    experimentId:
      pickString(patch, ["experimentId", "experiment_id"]) ?? current.experimentId,
    incumbentBranch:
      pickString(patch, ["incumbentBranch", "incumbent_branch"]) ??
      current.incumbentBranch,
    incumbentCommit:
      pickString(patch, ["incumbentCommit", "incumbent_commit"]) ??
      current.incumbentCommit,
    candidateBranch:
      pickString(patch, ["candidateBranch", "candidate_branch"]) ??
      current.candidateBranch,
    candidateCommit:
      pickString(patch, ["candidateCommit", "candidate_commit"]) ??
      current.candidateCommit,
    candidateWorktreePath:
      pickString(patch, ["candidateWorktreePath", "candidate_worktree_path"]) ??
      current.candidateWorktreePath,
    requestSummary:
      pickString(patch, ["requestSummary", "request_summary"]) ??
      current.requestSummary,
    requestedBy:
      pickString(patch, ["requestedBy", "requested_by"]) ?? current.requestedBy,
    requestedAt:
      pickString(patch, ["requestedAt", "requested_at"]) ?? current.requestedAt,
    plannerStatus: coerceCompletedSearchReviewStatus(
      patch.plannerStatus ?? patch.planner_status,
      null,
      current.plannerStatus
    ),
    analyzerStatus: coerceCompletedSearchReviewStatus(
      patch.analyzerStatus ?? patch.analyzer_status,
      pickString(patch, ["analyzerVerdict", "analyzer_verdict"]) ??
        current.analyzerVerdict,
      current.analyzerStatus
    ),
    crossReviewerStatus: coerceCompletedSearchReviewStatus(
      patch.crossReviewerStatus ?? patch.cross_reviewer_status,
      pickString(patch, [
        "crossReviewerVerdict",
        "cross_reviewer_verdict",
      ]) ?? current.crossReviewerVerdict,
      current.crossReviewerStatus
    ),
    synthesisStatus:
      normalizeStage(patch.synthesisStatus ?? patch.synthesis_status) ??
      current.synthesisStatus,
    analyzerVerdict:
      pickString(patch, ["analyzerVerdict", "analyzer_verdict"]) ??
      current.analyzerVerdict,
    crossReviewerVerdict:
      pickString(patch, [
        "crossReviewerVerdict",
        "cross_reviewer_verdict",
      ]) ?? current.crossReviewerVerdict,
    actionApproved:
      pickBoolean(patch, ["actionApproved", "action_approved"]) ??
      current.actionApproved,
    blockerCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["blockerCount", "blocker_count"]) ??
          current.blockerCount
      )
    ),
    blockers:
      patch.blockers != null ? asStringArray(patch.blockers) : current.blockers,
    promotionBasisSignals:
      patch.promotionBasisSignals != null || patch.promotion_basis_signals != null
        ? asStringArray(
            patch.promotionBasisSignals ?? patch.promotion_basis_signals
          )
        : current.promotionBasisSignals,
    promotionEvidenceSummary:
      pickString(patch, [
        "promotionEvidenceSummary",
        "promotion_evidence_summary",
      ]) ?? current.promotionEvidenceSummary,
    discardReason:
      pickString(patch, ["discardReason", "discard_reason"]) ??
      current.discardReason,
    failureClass:
      pickString(patch, ["failureClass", "failure_class"]) ??
      current.failureClass,
    appliedAt:
      pickString(patch, ["appliedAt", "applied_at"]) ?? current.appliedAt,
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ??
      current.pendingReason,
    lastUpdatedAt: new Date().toISOString(),
  };
  await saveExperimentSearchReviewStateFile({
    projectRoot: params.projectRoot,
    state: next,
  });
  const nextSearchState = {
    ...searchState,
    requestedGitOp: next.actionType,
    gitOpStatus: deriveSearchGitOpStatus(next),
    gitReviewStorePath: next.stateFilePath ?? searchState.gitReviewStorePath,
    gitReviewPacketPath: next.packetPath ?? searchState.gitReviewPacketPath,
    candidateWorktreePath:
      next.candidateWorktreePath ?? searchState.candidateWorktreePath,
    candidateBaseCommit:
      next.incumbentCommit ?? searchState.candidateBaseCommit,
    candidateHeadCommit:
      next.candidateCommit ?? searchState.candidateHeadCommit,
    pendingReason: next.pendingReason ?? searchState.pendingReason,
    lastUpdatedAt: new Date().toISOString(),
  };
  await persistSearchState({
    projectRoot: params.projectRoot,
    manifest,
    searchState: nextSearchState,
    deps,
  });
  return {
    reviewState: next,
    reviewSummary: buildExperimentSearchReviewSummary(next),
    searchState: nextSearchState,
  };
}

export async function applyExperimentGitOpImpl(
  params: {
    projectRoot: string;
  },
  deps: Deps
): Promise<{
  gitResult: ExperimentGitActionResult;
  reviewState: ExperimentSearchReviewStateLike;
  searchState: Awaited<ReturnType<typeof loadExperimentSearchState>>;
}> {
  const manifest = await deps.readManifestEnsured(params.projectRoot);
  const searchState = await loadExperimentSearchState({
    projectRoot: params.projectRoot,
    manifest,
    readJsonIfExists,
  });
  const reviewState = await loadExperimentSearchReviewState({
    projectRoot: params.projectRoot,
    manifest: {
      ...manifest,
      experiment_search: {
        ...(asRecord(manifest.experiment_search) ?? {}),
        git_review_store_path: searchState.gitReviewStorePath,
      },
    },
  });
  if (!reviewState.actionType) {
    throw new Error("No reviewed experiment git action is pending.");
  }
  const actionType =
    (searchState.requestedGitOp ?? reviewState.actionType) as ExperimentGitActionType;
  const specPath = resolveExperimentSearchSpecPath({
    projectRoot: params.projectRoot,
    manifest,
    searchSpecPath: reviewState.searchSpecPath ?? searchState.searchSpecPath,
  });
  const spec = normalizeExperimentSearchSpec(
    await readJsonIfExists<Record<string, unknown>>(specPath)
  );
  if (reviewState.actionApproved !== true) {
    throw new Error(
      "Experiment git action is not approved; planner/analyzer/cross-reviewer review must pass before workflow may execute git side effects."
    );
  }
  if (
    reviewState.plannerStatus !== "ready" ||
    reviewState.analyzerStatus !== "ready" ||
    reviewState.crossReviewerStatus !== "ready" ||
    reviewState.analyzerVerdict === "block" ||
    reviewState.analyzerVerdict === "revise" ||
    reviewState.crossReviewerVerdict === "block" ||
    reviewState.crossReviewerVerdict === "revise"
  ) {
    throw new Error(
      "Experiment git action lacks full multi-agent approval; planner plus analyzer plus cross-reviewer must all be ready with no revise/block verdicts before execution."
    );
  }
  if (actionType === "promote_candidate") {
    const basisSignals = uniqueNormalizedSignals(reviewState.promotionBasisSignals);
    if (basisSignals.length === 0) {
      throw new Error(
        "Promotion is blocked until experiment_search_review_state.promotion_basis_signals explicitly records the retention basis."
      );
    }
    const nonPromotionSignals = new Set(
      uniqueNormalizedSignals(spec.comparisonPolicy.nonPromotionSignals)
    );
    const hasPrimaryBasis = basisSignals.some(
      (signal) =>
        !nonPromotionSignals.has(signal) ||
        signal === "primary_metric_win" ||
        signal === "beat_incumbent" ||
        signal === "promotion_rule_satisfied"
    );
    if (!hasPrimaryBasis) {
      throw new Error(
        `Promotion is blocked because the recorded basis only cites non-promotion signals (${basisSignals.join(", ")}).`
      );
    }
  }
  const gitResult = await executeExperimentGitAction({
    projectRoot: params.projectRoot,
    actionType,
    incumbentBranch: reviewState.incumbentBranch ?? searchState.incumbentBranch,
    incumbentCommit: reviewState.incumbentCommit ?? searchState.incumbentCommit,
    candidateBranch: reviewState.candidateBranch ?? searchState.lastCandidateBranch,
    candidateWorktreePath:
      reviewState.candidateWorktreePath ?? searchState.candidateWorktreePath,
    candidateBaseRef:
      reviewState.incumbentBranch ??
      searchState.incumbentBranch ??
      reviewState.incumbentCommit ??
      searchState.incumbentCommit,
    candidateHeadCommit:
      reviewState.candidateCommit ?? searchState.lastCandidateCommit,
    requireCleanCandidateHistory: true,
    discardCandidateBranchAfterPromote: true,
  });
  const now = new Date().toISOString();
  const nextReviewState: ExperimentSearchReviewStateLike = {
    ...reviewState,
    actionType,
    actionStatus: "applied",
    appliedAt: now,
    pendingReason: null,
    lastUpdatedAt: now,
  };
  await saveExperimentSearchReviewStateFile({
    projectRoot: params.projectRoot,
    state: nextReviewState,
  });

  const experimentId =
    reviewState.experimentId ?? searchState.lastCandidateExperimentId ?? null;
  let nextSearchState = {
    ...searchState,
    requestedGitOp: null,
    gitOpStatus: "idle",
    gitReviewStorePath: nextReviewState.stateFilePath ?? searchState.gitReviewStorePath,
    gitReviewPacketPath: nextReviewState.packetPath ?? searchState.gitReviewPacketPath,
    candidateWorktreePath:
      gitResult.actionType === "create_candidate_worktree"
        ? gitResult.candidateWorktreePath
        : null,
    candidateBaseCommit: gitResult.candidateBaseCommit,
    candidateHeadCommit:
      gitResult.actionType === "discard_candidate" ? null : gitResult.candidateHeadCommit,
    lastGitOpResult: gitResult.summary,
    lastUpdatedAt: now,
    pendingReason: null,
  };

  if (gitResult.actionType === "create_candidate_worktree") {
    nextSearchState = {
      ...nextSearchState,
      lastCandidateExperimentId:
        experimentId ?? nextSearchState.lastCandidateExperimentId,
      lastCandidateBranch: gitResult.candidateBranch,
      lastCandidateCommit: gitResult.candidateHeadCommit,
      candidateWorktreePath: gitResult.candidateWorktreePath,
      candidateBaseCommit: gitResult.candidateBaseCommit,
      candidateHeadCommit: gitResult.candidateHeadCommit,
      frontierExperimentIds: uniqueStrings([
        ...nextSearchState.frontierExperimentIds,
        ...(experimentId ? [experimentId] : []),
      ]),
    };
  } else if (gitResult.actionType === "promote_candidate") {
    nextSearchState = {
      ...nextSearchState,
      lastCandidateExperimentId:
        experimentId ?? nextSearchState.lastCandidateExperimentId,
      incumbentBranch: gitResult.incumbentBranch ?? nextSearchState.incumbentBranch,
      incumbentCommit: gitResult.incumbentCommit,
      incumbentExperimentId:
        experimentId ?? nextSearchState.incumbentExperimentId,
      candidateWorktreePath: null,
      candidateHeadCommit: null,
      lastDecision: "advance",
      frontierExperimentIds: removeString(
        nextSearchState.frontierExperimentIds,
        experimentId
      ),
      completedExperimentIds: uniqueStrings([
        ...nextSearchState.completedExperimentIds,
        ...(experimentId ? [experimentId] : []),
      ]),
    };
  } else {
    nextSearchState = {
      ...nextSearchState,
      lastCandidateExperimentId:
        experimentId ?? nextSearchState.lastCandidateExperimentId,
      candidateWorktreePath: null,
      candidateHeadCommit: null,
      lastDecision: "discard",
      frontierExperimentIds: removeString(
        nextSearchState.frontierExperimentIds,
        experimentId
      ),
      discardedExperimentIds: uniqueStrings([
        ...nextSearchState.discardedExperimentIds,
        ...(experimentId ? [experimentId] : []),
      ]),
    };
  }

  await persistSearchState({
    projectRoot: params.projectRoot,
    manifest,
    searchState: nextSearchState,
    deps,
  });
  return {
    gitResult,
    reviewState: nextReviewState,
    searchState: nextSearchState,
  };
}
