import os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  pathExists,
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import {
  asRecord,
  asStringArray,
  pickString,
} from "../workflow-guard-core/coercion";
import {
  loadExperimentSearchState,
} from "../workflow-guard-experiment-history";
import {
  buildExperimentSearchReviewPacketFingerprint,
  loadExperimentSearchReviewState,
  saveExperimentSearchReviewStateFile,
} from "../workflow-auto-experiment-search-review.js";
import {
  DEFAULT_EXPERIMENT_SEARCH_DECISION_PATH,
  DEFAULT_EXPERIMENT_SEARCH_REVIEW_PACKET_PATH,
  DEFAULT_EXPERIMENT_SEARCH_REVIEW_PLAN_PATH,
  coerceCompletedSearchReviewStatus,
  normalizeExperimentSearchReviewVerdict,
  type ExperimentSearchReviewStateLike,
} from "../workflow-guard-state/experiment-search-review.js";
import {
  normalizeExperimentSearchSpec,
  resolveExperimentSearchSpecPath,
  DEFAULT_EXPERIMENT_SEARCH_SPEC_PATH,
} from "../workflow-guard-state/experiment-search-spec.js";

type MaterializerDeps = {
  readManifestEnsured: (projectRoot: string) => Promise<Record<string, unknown>>;
  saveManifest: (
    projectRoot: string,
    manifest: Record<string, unknown>
  ) => Promise<void>;
};

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  return ordered;
}

function sanitizePathPart(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim() || fallback;
  return trimmed.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function defaultCandidateWorktreePath(params: {
  projectRoot: string;
  searchSessionId: string | null;
  experimentId: string | null;
}): string {
  return path.join(
    os.tmpdir(),
    "openclaw-worktrees",
    sanitizePathPart(path.basename(params.projectRoot), "project"),
    sanitizePathPart(params.searchSessionId, "search-session"),
    sanitizePathPart(params.experimentId, "candidate")
  );
}

function buildCandidateBranch(params: {
  prefix: string | null;
  experimentId: string | null;
  currentCandidateBranch: string | null;
}): string | null {
  const experimentId = params.experimentId?.trim();
  const sanitizedExperimentId = sanitizePathPart(experimentId, "candidate");
  const currentCandidateBranch = params.currentCandidateBranch?.trim() ?? null;
  if (
    currentCandidateBranch &&
    (!experimentId || currentCandidateBranch.endsWith(`/${sanitizedExperimentId}`))
  ) {
    return currentCandidateBranch;
  }
  if (!experimentId) {
    return null;
  }
  const prefix = params.prefix?.trim() || "experiment/candidate/";
  return `${prefix}${sanitizedExperimentId}`;
}

function buildPlannerPlanMarkdown(params: {
  actionType: string | null;
  experimentId: string | null;
  trackId: string | null;
  incumbentBranch: string | null;
  candidateBranch: string | null;
  candidateWorktreePath: string | null;
  requestSummary: string | null;
}) {
  return `# Experiment Search Git Plan

## Requested Action
- action: ${params.actionType ?? "unresolved"}
- track: ${params.trackId ?? "unresolved"}
- experiment: ${params.experimentId ?? "unresolved"}

## Git Lineage
- incumbent branch: ${params.incumbentBranch ?? "unresolved"}
- candidate branch: ${params.candidateBranch ?? "unresolved"}
- candidate worktree: ${params.candidateWorktreePath ?? "unresolved"}

## Request Summary
- ${params.requestSummary ?? "no summary provided"}

## Required Checks
- the action stays inside the approved search envelope
- the incumbent branch remains a retained-only history
- candidate creation or retention does not pollute other branches
- promotion is justified only by the approved primary metric rule
- discard is justified when the candidate does not earn retention
`;
}

function extractReviewVerdict(text: string | null): "pass" | "revise" | "block" | null {
  if (!text) {
    return null;
  }
  const match = text.match(/\bverdict\b\s*[:=-]\s*(pass|revise|block|blocked)\b/i);
  return normalizeExperimentSearchReviewVerdict(match?.[1] ?? null);
}

function extractCriticalBlockers(text: string | null): string[] {
  if (!text) {
    return [];
  }
  const explicit = [...text.matchAll(/^\s*[-*]\s*(.+)$/gm)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
  const criticalSection = text.match(
    /(?:critical(?:\s+blockers?|\s+issues?)|blockers?)\s*[:\n]([\s\S]{0,1200})/i
  )?.[1];
  const sectionBullets = criticalSection
    ? [...criticalSection.matchAll(/^\s*[-*]\s*(.+)$/gm)].map(
        (match) => match[1]?.trim() ?? ""
      )
    : [];
  return uniqueStrings([...sectionBullets, ...explicit].filter(Boolean)).slice(0, 8);
}

function readDecisionJson(value: Record<string, unknown> | null): {
  actionApproved: boolean;
  blockers: string[];
  appliedAt: string | null;
} {
  const record = value ?? {};
  return {
    actionApproved:
      record.action_approved === true || record.actionApproved === true,
    blockers: asStringArray(record.blockers ?? record.blocker_reasons),
    appliedAt:
      pickString(record, ["appliedAt", "applied_at"]) ??
      pickString(record, ["executedAt", "executed_at"]),
  };
}

function deriveStatus(state: ExperimentSearchReviewStateLike): string {
  if (state.actionStatus === "applied" || state.appliedAt) {
    return "completed";
  }
  if (
    state.crossReviewerVerdict === "block" ||
    state.analyzerVerdict === "block"
  ) {
    return "blocked";
  }
  if (
    state.crossReviewerVerdict === "revise" ||
    state.analyzerVerdict === "revise"
  ) {
    return "revise";
  }
  if (state.plannerStatus !== "ready") {
    return "planning";
  }
  if (state.analyzerStatus !== "ready" || state.crossReviewerStatus !== "ready") {
    return "reviewing";
  }
  if (state.actionApproved) {
    return "ready_for_execution";
  }
  return "synthesis";
}

async function writeJsonIfChanged(
  targetPath: string,
  value: Record<string, unknown>
): Promise<boolean> {
  const current = await readJsonIfExists<Record<string, unknown>>(targetPath);
  if (current && JSON.stringify(current) === JSON.stringify(value)) {
    return false;
  }
  await writeJsonEnsured(targetPath, value);
  return true;
}

async function writeTextIfChanged(targetPath: string, value: string): Promise<boolean> {
  const current = await readTextIfExists(targetPath);
  if (current === value) {
    return false;
  }
  await writeTextEnsured(targetPath, value);
  return true;
}

export async function materializeExperimentSearchReviewStateImpl(
  params: {
    projectRoot: string;
    experimentSearchReviewMaterialization?: Record<string, unknown>;
    trigger?: string | null;
    agentId?: string | null;
  },
  deps: MaterializerDeps
): Promise<{
  state: ExperimentSearchReviewStateLike;
  stateFilePath: string;
  stateFileExists: boolean;
  packetResolvedPath: string | null;
  packetExists: boolean;
  plannerPlanResolvedPath: string | null;
  plannerPlanExists: boolean;
  analyzerReportResolvedPath: string | null;
  analyzerReportExists: boolean;
  crossReviewerReportResolvedPath: string | null;
  crossReviewerReportExists: boolean;
  decisionResolvedPath: string | null;
  decisionExists: boolean;
  specResolvedPath: string | null;
  specExists: boolean;
}> {
  const manifest = await deps.readManifestEnsured(params.projectRoot);
  const current = await loadExperimentSearchReviewState({
    projectRoot: params.projectRoot,
    manifest,
  });
  const patch = asRecord(params.experimentSearchReviewMaterialization) ?? {};
  const searchState = await loadExperimentSearchState({
    projectRoot: params.projectRoot,
    manifest,
    readJsonIfExists,
  });
  const specResolvedPath = resolveExperimentSearchSpecPath({
    projectRoot: params.projectRoot,
    manifest,
    searchSpecPath:
      pickString(patch, ["searchSpecPath", "search_spec_path"]) ??
      searchState.searchSpecPath ??
      DEFAULT_EXPERIMENT_SEARCH_SPEC_PATH,
  });
  const specRaw = await readJsonIfExists<Record<string, unknown>>(specResolvedPath);
  const spec = normalizeExperimentSearchSpec(specRaw);
  const actionType =
    pickString(patch, ["actionType", "action_type"]) ?? current.actionType ?? null;
  const experimentId =
    pickString(patch, ["experimentId", "experiment_id"]) ??
    current.experimentId ??
    searchState.lastCandidateExperimentId ??
    null;
  const candidateBranch = buildCandidateBranch({
    prefix: spec.gitStrategy.candidateBranchPrefix,
    experimentId,
    currentCandidateBranch:
      pickString(patch, ["candidateBranch", "candidate_branch"]) ??
      current.candidateBranch ??
      searchState.lastCandidateBranch,
  });
  const candidateWorktreePath =
    pickString(patch, ["candidateWorktreePath", "candidate_worktree_path"]) ??
    current.candidateWorktreePath ??
    defaultCandidateWorktreePath({
      projectRoot: params.projectRoot,
      searchSessionId: searchState.searchSessionId ?? spec.searchSessionId,
      experimentId,
    });
  const incumbentBranch =
    pickString(patch, ["incumbentBranch", "incumbent_branch"]) ??
    current.incumbentBranch ??
    searchState.incumbentBranch ??
    spec.gitStrategy.incumbentBranch;
  const incumbentCommit =
    pickString(patch, ["incumbentCommit", "incumbent_commit"]) ??
    current.incumbentCommit ??
    searchState.incumbentCommit;
  const packetPath =
    pickString(patch, ["packetPath", "packet_path"]) ??
    current.packetPath ??
    DEFAULT_EXPERIMENT_SEARCH_REVIEW_PACKET_PATH;
  const plannerPlanPath =
    pickString(patch, ["plannerPlanPath", "planner_plan_path"]) ??
    current.plannerPlanPath ??
    DEFAULT_EXPERIMENT_SEARCH_REVIEW_PLAN_PATH;
  const analyzerReportPath =
    pickString(patch, ["analyzerReportPath", "analyzer_report_path"]) ??
    current.analyzerReportPath;
  const crossReviewerReportPath =
    pickString(patch, [
      "crossReviewerReportPath",
      "cross_reviewer_report_path",
    ]) ?? current.crossReviewerReportPath;
  const decisionPath =
    pickString(patch, ["decisionPath", "decision_path"]) ??
    current.decisionPath ??
    DEFAULT_EXPERIMENT_SEARCH_DECISION_PATH;
  const requestSummary =
    pickString(patch, ["requestSummary", "request_summary", "summary"]) ??
    current.requestSummary ??
    (actionType === "create_candidate_worktree"
      ? "Request approval to create a disposable candidate worktree inside the approved search envelope."
      : actionType === "promote_candidate"
        ? "Request approval to promote the candidate into retained incumbent history."
        : actionType === "discard_candidate"
          ? "Request approval to discard the candidate branch/worktree and keep only diagnostic memory."
          : null);

  const packet = {
    action_id:
      pickString(patch, ["actionId", "action_id"]) ?? current.actionId ?? randomUUID(),
    action_type: actionType,
    trigger: params.trigger ?? "materialize_experiment_search_review_state",
    requested_by:
      pickString(patch, ["requestedBy", "requested_by"]) ??
      params.agentId ??
      current.requestedBy,
    requested_at:
      pickString(patch, ["requestedAt", "requested_at"]) ??
      current.requestedAt ??
      new Date().toISOString(),
    request_summary: requestSummary,
    project_id:
      pickString(manifest, ["project_id", "projectId"]) ?? spec.projectId ?? null,
    track_id:
      pickString(patch, ["trackId", "track_id"]) ??
      current.trackId ??
      searchState.trackId ??
      spec.trackId,
    experiment_id: experimentId,
    search_session_id: searchState.searchSessionId ?? spec.searchSessionId,
    search_spec_path:
      searchState.searchSpecPath ?? specResolvedPath.replace(`${params.projectRoot}/`, ""),
    search_state_path:
      searchState.searchStatePath ??
      pickString(asRecord(manifest.experiment_search) ?? {}, [
        "search_state_path",
        "searchStatePath",
      ]) ??
      "researcher/EXPERIMENT_SEARCH.json",
    incumbent_branch: incumbentBranch,
    incumbent_commit: incumbentCommit,
    candidate_branch: candidateBranch,
    candidate_commit:
      pickString(patch, ["candidateCommit", "candidate_commit"]) ??
      current.candidateCommit ??
      searchState.lastCandidateCommit,
    candidate_worktree_path: candidateWorktreePath,
    comparison_policy: {
      compare_against: spec.comparisonPolicy.compareAgainst,
      promotion_rule: spec.comparisonPolicy.promotionRule,
      non_promotion_signals: spec.comparisonPolicy.nonPromotionSignals,
    },
    git_strategy: {
      incumbent_branch: spec.gitStrategy.incumbentBranch,
      candidate_branch_prefix: spec.gitStrategy.candidateBranchPrefix,
      require_clean_candidate_history:
        spec.gitStrategy.requireCleanCandidateHistory,
      promotion_commit_policy: spec.gitStrategy.promotionCommitPolicy,
      discard_unpromoted_candidates:
        spec.gitStrategy.discardUnpromotedCandidates,
    },
  };
  const packetFingerprint = buildExperimentSearchReviewPacketFingerprint({
    actionType,
    searchSessionId: searchState.searchSessionId ?? spec.searchSessionId,
    experimentId,
    candidateBranch,
    incumbentBranch,
    packet,
  });

  const packetResolvedPath = path.isAbsolute(packetPath)
    ? packetPath
    : path.join(params.projectRoot, packetPath);
  const plannerPlanResolvedPath = path.isAbsolute(plannerPlanPath)
    ? plannerPlanPath
    : path.join(params.projectRoot, plannerPlanPath);
  const analyzerReportResolvedPath =
    analyzerReportPath && path.isAbsolute(analyzerReportPath)
      ? analyzerReportPath
      : analyzerReportPath
        ? path.join(params.projectRoot, analyzerReportPath)
        : null;
  const crossReviewerReportResolvedPath =
    crossReviewerReportPath && path.isAbsolute(crossReviewerReportPath)
      ? crossReviewerReportPath
      : crossReviewerReportPath
        ? path.join(params.projectRoot, crossReviewerReportPath)
        : null;
  const decisionResolvedPath = path.isAbsolute(decisionPath)
    ? decisionPath
    : path.join(params.projectRoot, decisionPath);

  const packetChanged = await writeJsonIfChanged(packetResolvedPath, packet);
  const plannerPlanChanged = await writeTextIfChanged(
    plannerPlanResolvedPath,
    buildPlannerPlanMarkdown({
      actionType,
      experimentId,
      trackId:
        pickString(packet, ["track_id"]) ?? pickString(current, ["trackId", "track_id"]),
      incumbentBranch,
      candidateBranch,
      candidateWorktreePath,
      requestSummary,
    })
  );

  const analyzerText = analyzerReportResolvedPath
    ? await readTextIfExists(analyzerReportResolvedPath)
    : null;
  const crossText = crossReviewerReportResolvedPath
    ? await readTextIfExists(crossReviewerReportResolvedPath)
    : null;
  const decisionJson = await readJsonIfExists<Record<string, unknown>>(decisionResolvedPath);
  const decision = readDecisionJson(decisionJson);

  const fingerprintChanged = current.packetFingerprint !== packetFingerprint;
  const resetReviews = packetChanged || plannerPlanChanged || fingerprintChanged;

  const next: ExperimentSearchReviewStateLike = {
    ...current,
    status: current.status,
    microStage: current.microStage,
    actionId: pickString(packet, ["action_id"]),
    actionType,
    actionStatus:
      pickString(patch, ["actionStatus", "action_status"]) ??
      (decision.appliedAt ? "applied" : current.actionStatus),
    stateFilePath:
      pickString(patch, ["stateFilePath", "state_file_path"]) ??
      current.stateFilePath,
    packetPath,
    plannerPlanPath,
    analyzerReportPath: analyzerReportPath ?? current.analyzerReportPath,
    crossReviewerReportPath:
      crossReviewerReportPath ?? current.crossReviewerReportPath,
    decisionPath,
    packetFingerprint,
    searchSessionId:
      pickString(packet, ["search_session_id"]) ?? current.searchSessionId,
    searchSpecPath:
      pickString(packet, ["search_spec_path"]) ?? current.searchSpecPath,
    searchStatePath:
      pickString(packet, ["search_state_path"]) ?? current.searchStatePath,
    trackId: pickString(packet, ["track_id"]) ?? current.trackId,
    experimentId,
    incumbentBranch,
    incumbentCommit,
    candidateBranch,
    candidateCommit:
      pickString(packet, ["candidate_commit"]) ?? current.candidateCommit,
    candidateWorktreePath,
    requestSummary,
    requestedBy:
      pickString(packet, ["requested_by"]) ??
      current.requestedBy ??
      params.agentId ??
      null,
    requestedAt:
      pickString(packet, ["requested_at"]) ??
      current.requestedAt ??
      new Date().toISOString(),
    plannerStatus:
      resetReviews
        ? "pending"
        : coerceCompletedSearchReviewStatus(current.plannerStatus, null, current.plannerStatus),
    analyzerStatus:
      resetReviews
        ? "pending"
        : coerceCompletedSearchReviewStatus(
            current.analyzerStatus,
            extractReviewVerdict(analyzerText),
            current.analyzerStatus
          ),
    crossReviewerStatus:
      resetReviews
        ? "pending"
        : coerceCompletedSearchReviewStatus(
            current.crossReviewerStatus,
            extractReviewVerdict(crossText),
            current.crossReviewerStatus
          ),
    synthesisStatus:
      resetReviews
        ? "pending"
        : current.synthesisStatus,
    analyzerVerdict: resetReviews
      ? null
      : extractReviewVerdict(analyzerText) ?? current.analyzerVerdict,
    crossReviewerVerdict: resetReviews
      ? null
      : extractReviewVerdict(crossText) ?? current.crossReviewerVerdict,
    actionApproved: resetReviews ? false : decision.actionApproved,
    blockerCount: resetReviews
      ? 0
      : uniqueStrings([
          ...extractCriticalBlockers(analyzerText),
          ...extractCriticalBlockers(crossText),
          ...decision.blockers,
        ]).length,
    blockers: resetReviews
      ? []
      : uniqueStrings([
          ...extractCriticalBlockers(analyzerText),
          ...extractCriticalBlockers(crossText),
          ...decision.blockers,
        ]),
    appliedAt: decision.appliedAt ?? current.appliedAt,
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ??
      (resetReviews
        ? "multi-agent git review is required before creating or retaining candidate lineage"
        : current.pendingReason),
    lastUpdatedAt: new Date().toISOString(),
  };
  next.status = deriveStatus(next);
  next.microStage =
    next.status === "completed"
      ? "completed"
      : next.plannerStatus !== "ready"
        ? "planning"
        : next.analyzerStatus !== "ready"
          ? "analyzer_review"
          : next.crossReviewerStatus !== "ready"
            ? "cross_review"
            : next.actionApproved
              ? "execution_ready"
              : "synthesis";
  next.synthesisStatus =
    next.actionApproved || next.status === "completed" ? "ready" : next.synthesisStatus;

  await saveExperimentSearchReviewStateFile({
    projectRoot: params.projectRoot,
    state: next,
  });

  return {
    state: next,
    stateFilePath: path.join(
      params.projectRoot,
      next.stateFilePath ?? "researcher/EXPERIMENT_SEARCH_GIT_REVIEW_STATE.json"
    ),
    stateFileExists: await pathExists(
      path.join(
        params.projectRoot,
        next.stateFilePath ?? "researcher/EXPERIMENT_SEARCH_GIT_REVIEW_STATE.json"
      )
    ),
    packetResolvedPath,
    packetExists: await pathExists(packetResolvedPath),
    plannerPlanResolvedPath,
    plannerPlanExists: await pathExists(plannerPlanResolvedPath),
    analyzerReportResolvedPath,
    analyzerReportExists: analyzerReportResolvedPath
      ? await pathExists(analyzerReportResolvedPath)
      : false,
    crossReviewerReportResolvedPath,
    crossReviewerReportExists: crossReviewerReportResolvedPath
      ? await pathExists(crossReviewerReportResolvedPath)
      : false,
    decisionResolvedPath,
    decisionExists: await pathExists(decisionResolvedPath),
    specResolvedPath,
    specExists: await pathExists(specResolvedPath),
  };
}
