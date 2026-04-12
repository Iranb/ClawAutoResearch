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

export type ExperimentSearchMetricContractLike = {
  metricName: string | null;
  direction: string | null;
  minimumImprovement: number | null;
  primaryEvidence: string[];
};

export type ExperimentSearchBaselineFairnessContractLike = {
  requireBaselineParity: boolean;
  lockedDatasetProtocol: boolean;
  lockedMetricProtocol: boolean;
  lockedEvaluationHarness: boolean;
};

export type ExperimentSearchValidationStepLike = {
  stepId: string | null;
  kind: string | null;
  required: boolean;
  completionSignal: string | null;
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
  primaryMetricContract: ExperimentSearchMetricContractLike;
  baselineFairnessContract: ExperimentSearchBaselineFairnessContractLike;
  requiredValidationSteps: ExperimentSearchValidationStepLike[];
  innovationInvalidityCriteria: Record<string, unknown> | null;
  tuningExhaustionCriteria: Record<string, unknown> | null;
  searchLadder: string[];
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
  const primaryMetricContract =
    asRecord(record.primaryMetricContract ?? record.primary_metric_contract) ?? {};
  const baselineFairnessContract =
    asRecord(
      record.baselineFairnessContract ?? record.baseline_fairness_contract
    ) ?? {};
  const requiredValidationSteps = Array.isArray(
    record.requiredValidationSteps ?? record.required_validation_steps
  )
    ? ((record.requiredValidationSteps ??
        record.required_validation_steps) as unknown[])
        .map((entry: unknown) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        .map((entry: Record<string, unknown>) => ({
          stepId: pickString(entry, ["stepId", "step_id"]),
          kind: pickString(entry, ["kind"]),
          required: pickBoolean(entry, ["required"]) ?? true,
          completionSignal: pickString(entry, [
            "completionSignal",
            "completion_signal",
          ]),
        }))
    : [];
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
    primaryMetricContract: {
      metricName: pickString(primaryMetricContract, [
        "metricName",
        "metric_name",
      ]),
      direction: pickString(primaryMetricContract, ["direction"]),
      minimumImprovement:
        pickNumber(primaryMetricContract, [
          "minimumImprovement",
          "minimum_improvement",
        ]) ?? null,
      primaryEvidence: asStringArray(
        primaryMetricContract.primaryEvidence ??
          primaryMetricContract.primary_evidence
      ),
    },
    baselineFairnessContract: {
      requireBaselineParity:
        pickBoolean(baselineFairnessContract, [
          "requireBaselineParity",
          "require_baseline_parity",
        ]) ?? true,
      lockedDatasetProtocol:
        pickBoolean(baselineFairnessContract, [
          "lockedDatasetProtocol",
          "locked_dataset_protocol",
        ]) ?? true,
      lockedMetricProtocol:
        pickBoolean(baselineFairnessContract, [
          "lockedMetricProtocol",
          "locked_metric_protocol",
        ]) ?? true,
      lockedEvaluationHarness:
        pickBoolean(baselineFairnessContract, [
          "lockedEvaluationHarness",
          "locked_evaluation_harness",
        ]) ?? true,
    },
    requiredValidationSteps,
    innovationInvalidityCriteria:
      asRecord(
        record.innovationInvalidityCriteria ??
          record.innovation_invalidity_criteria
      ) ?? null,
    tuningExhaustionCriteria:
      asRecord(
        record.tuningExhaustionCriteria ?? record.tuning_exhaustion_criteria
      ) ?? null,
    searchLadder: asStringArray(record.searchLadder ?? record.search_ladder),
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
