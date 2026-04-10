import * as path from "node:path";
import {
  asRecord,
  asStringArray,
  pickBoolean,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";

export const DEFAULT_EXPERIMENT_SEARCH_SPEC_PATH =
  "planner/EXPERIMENT_SEARCH_SPEC.json";

export type ExperimentSearchGitStrategyLike = {
  incumbentBranch: string | null;
  candidateBranchPrefix: string | null;
  requireCleanCandidateHistory: boolean;
  promotionCommitPolicy: string | null;
  discardUnpromotedCandidates: boolean;
};

export type ExperimentSearchComparisonPolicyLike = {
  compareAgainst: string | null;
  promotionRule: string | null;
  nonPromotionSignals: string[];
};

export type ExperimentSearchBudgetLike = {
  maxRuns: number | null;
  maxGpuHours: number | null;
  noImprovementPatience: number | null;
  baselineUnderperformPatience: number | null;
};

export type ExperimentSearchGraphMemoryBasisLike = {
  packetPath: string | null;
  syncStatusPath: string | null;
};

export type ExperimentSearchSpecLike = {
  searchSessionId: string | null;
  projectId: string | null;
  trackId: string | null;
  basisPacketPath: string | null;
  searchMode: string | null;
  gitStrategy: ExperimentSearchGitStrategyLike;
  frozenContract: string[];
  searchEnvelope: Record<string, unknown> | null;
  comparisonPolicy: ExperimentSearchComparisonPolicyLike;
  budget: ExperimentSearchBudgetLike;
  graphMemoryBasis: ExperimentSearchGraphMemoryBasisLike;
};

export function normalizeExperimentSearchSpec(
  value: unknown
): ExperimentSearchSpecLike {
  const record = asRecord(value) ?? {};
  const gitStrategy = asRecord(record.gitStrategy ?? record.git_strategy) ?? {};
  const comparisonPolicy =
    asRecord(record.comparisonPolicy ?? record.comparison_policy) ?? {};
  const budget = asRecord(record.budget) ?? {};
  const graphMemoryBasis =
    asRecord(record.graphMemoryBasis ?? record.graph_memory_basis) ?? {};
  return {
    searchSessionId: pickString(record, ["searchSessionId", "search_session_id"]),
    projectId: pickString(record, ["projectId", "project_id"]),
    trackId: pickString(record, ["trackId", "track_id"]),
    basisPacketPath: pickString(record, ["basisPacketPath", "basis_packet_path"]),
    searchMode: pickString(record, ["searchMode", "search_mode"]),
    gitStrategy: {
      incumbentBranch: pickString(gitStrategy, [
        "incumbentBranch",
        "incumbent_branch",
      ]),
      candidateBranchPrefix: pickString(gitStrategy, [
        "candidateBranchPrefix",
        "candidate_branch_prefix",
      ]),
      requireCleanCandidateHistory:
        pickBoolean(gitStrategy, [
          "requireCleanCandidateHistory",
          "require_clean_candidate_history",
        ]) ?? true,
      promotionCommitPolicy: pickString(gitStrategy, [
        "promotionCommitPolicy",
        "promotion_commit_policy",
      ]),
      discardUnpromotedCandidates:
        pickBoolean(gitStrategy, [
          "discardUnpromotedCandidates",
          "discard_unpromoted_candidates",
        ]) ?? true,
    },
    frozenContract: asStringArray(
      record.frozenContract ?? record.frozen_contract
    ),
    searchEnvelope:
      asRecord(record.searchEnvelope ?? record.search_envelope) ?? null,
    comparisonPolicy: {
      compareAgainst: pickString(comparisonPolicy, [
        "compareAgainst",
        "compare_against",
      ]),
      promotionRule: pickString(comparisonPolicy, [
        "promotionRule",
        "promotion_rule",
      ]),
      nonPromotionSignals: asStringArray(
        comparisonPolicy.nonPromotionSignals ??
          comparisonPolicy.non_promotion_signals
      ),
    },
    budget: {
      maxRuns:
        pickNumber(budget, ["maxRuns", "max_runs"]) == null
          ? null
          : Math.max(0, Math.floor(pickNumber(budget, ["maxRuns", "max_runs"])!)),
      maxGpuHours:
        pickNumber(budget, ["maxGpuHours", "max_gpu_hours"]) == null
          ? null
          : Math.max(
              0,
              Number(pickNumber(budget, ["maxGpuHours", "max_gpu_hours"])!)
            ),
      noImprovementPatience:
        pickNumber(budget, [
          "noImprovementPatience",
          "no_improvement_patience",
        ]) == null
          ? null
          : Math.max(
              0,
              Math.floor(
                pickNumber(budget, [
                  "noImprovementPatience",
                  "no_improvement_patience",
                ])!
              )
            ),
      baselineUnderperformPatience:
        pickNumber(budget, [
          "baselineUnderperformPatience",
          "baseline_underperform_patience",
        ]) == null
          ? null
          : Math.max(
              0,
              Math.floor(
                pickNumber(budget, [
                  "baselineUnderperformPatience",
                  "baseline_underperform_patience",
                ])!
              )
            ),
    },
    graphMemoryBasis: {
      packetPath: pickString(graphMemoryBasis, ["packetPath", "packet_path"]),
      syncStatusPath: pickString(graphMemoryBasis, [
        "syncStatusPath",
        "sync_status_path",
      ]),
    },
  };
}

export function resolveExperimentSearchSpecPath(params: {
  projectRoot: string;
  manifest?: Record<string, unknown> | null;
  searchSpecPath?: string | null;
}): string {
  const manifestRecord = asRecord(params.manifest);
  const manifestSearch = asRecord(manifestRecord?.experiment_search);
  const configuredPath =
    params.searchSpecPath?.trim() ||
    pickString(manifestSearch ?? {}, ["searchSpecPath", "search_spec_path"]) ||
    DEFAULT_EXPERIMENT_SEARCH_SPEC_PATH;
  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(params.projectRoot, configuredPath);
}
