/**
 * 实验搜索规范（Spec）类型定义。
 *
 * 定义实验搜索的配置规范——git 策略、比较策略、预算、内环/外环策略、
 * 指标合约、基线公平性等。
 *
 * 为什么这么多策略对象？因为实验搜索借鉴了超参数优化的概念——
 * - innerLoop: 快速迭代，每次只改一个变量，类似 coordinate descent
 * - outerLoop: 宏观策略，决定搜索方向，类似 Bayesian optimization 的 acquisition function
 * - gitStrategy: 用 git branch 隔离候选实验，类似 MLflow 的 run tracking
 * - baselineFairnessContract: 确保基线和候选在相同数据集/指标/评估器下比较
 *
 * 这种分离使得搜索策略可以独立配置——不同的 track 可以有不同的搜索策略。
 */
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

/**
 * git 策略配置。
 *
 * 定义如何用 git branch 隔离候选实验——
 * incumbentBranch 是当前最优实验的分支，candidateBranchPrefix 是候选分支前缀。
 * requireCleanCandidateHistory 确保候选分支没有无关提交，
 * discardUnpromotedCandidates 在搜索结束后清理未晋升的候选。
 */
export type ExperimentSearchGitStrategyLike = {
  incumbentBranch: string | null;
  candidateBranchPrefix: string | null;
  requireCleanCandidateHistory: boolean;
  promotionCommitPolicy: string | null;
  discardUnpromotedCandidates: boolean;
};

/**
 * 比较策略。
 *
 * 定义候选实验与谁比较、晋升规则、什么信号阻止晋升。
 * promotionRule 决定何时将候选晋升为新的 incumbent。
 */
export type ExperimentSearchComparisonPolicyLike = {
  compareAgainst: string | null;
  promotionRule: string | null;
  nonPromotionSignals: string[];
};

/**
 * 搜索预算。
 *
 * 限制搜索资源的各项指标——最大运行次数、GPU 小时、
 * 无改进耐心（类似 early stopping）、基线欠表现耐心、单次试验时间预算。
 */
export type ExperimentSearchBudgetLike = {
  maxRuns: number | null;
  maxGpuHours: number | null;
  noImprovementPatience: number | null;
  baselineUnderperformPatience: number | null;
  trialTimeBudgetMinutes: number | null;
};

/**
 * 内环策略。
 *
 * 内环是实验搜索的快速迭代层——每次只改一个变量，快速评估效果。
 * mode 决定迭代模式（如 karpathy_fast_keep_discard），
 * requireOneChangeSignature 确保每次试验只改变一个因素（控制变量法）。
 */
export type ExperimentSearchInnerLoopPolicyLike = {
  mode: string | null;
  trialTimeBudgetMinutes: number | null;
  strictComparableBudget: boolean;
  requireOneChangeSignature: boolean;
  keepDiscardRule: string | null;
};

/**
 * 外环策略。
 *
 * 外环是宏观搜索策略——决定是否要求基线数据集覆盖、
 * 创新偏差容忍度（wide/narrow/strict）。
 */
export type ExperimentSearchOuterLoopPolicyLike = {
  requireBaselineDatasetCoverageForEffectiveCandidates: boolean;
  innovationDeviationTolerance: string | null;
};

/**
 * 图记忆基础配置。
 *
 * 定义知识图谱记忆的数据包路径和同步状态路径。
 */
export type ExperimentSearchGraphMemoryBasisLike = {
  packetPath: string | null;
  syncStatusPath: string | null;
};

/**
 * 指标合约。
 *
 * 定义主要评估指标——指标名称、优化方向（higher_is_better / lower_is_better）、
 * 最小改进阈值、主要证据文件列表。
 */
export type ExperimentSearchMetricContractLike = {
  metricName: string | null;
  direction: string | null;
  minimumImprovement: number | null;
  primaryEvidence: string[];
};

/**
 * 基线公平性合约。
 *
 * 确保基线和候选实验在公平条件下比较——锁定数据集、指标协议、评估器。
 * 防止"不公平比较"——比如候选用了更多数据或不同的评估方式。
 */
export type ExperimentSearchBaselineFairnessContractLike = {
  requireBaselineParity: boolean;
  lockedDatasetProtocol: boolean;
  lockedMetricProtocol: boolean;
  lockedEvaluationHarness: boolean;
};

/**
 * 验证步骤。
 *
 * 定义实验搜索过程中必须完成的验证步骤——
 * stepId 标识、kind 类型、是否必需、完成信号。
 */
export type ExperimentSearchValidationStepLike = {
  stepId: string | null;
  kind: string | null;
  required: boolean;
  completionSignal: string | null;
};

/**
 * 实验搜索规范。
 *
 * 实验搜索的完整配置——搜索会话 ID、git 策略、冻结合约、
 * 搜索包、比较策略、预算、内环/外环策略、图记忆、
 * 指标合约、公平性合约、验证步骤、搜索阶梯。
 *
 * frozenContract 定义搜索过程中不可更改的合约（防止搜索中途改规则），
 * searchLadder 定义搜索的阶梯（从简单到复杂的实验序列）。
 */
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
  innerLoopPolicy: ExperimentSearchInnerLoopPolicyLike;
  outerLoopPolicy: ExperimentSearchOuterLoopPolicyLike;
  graphMemoryBasis: ExperimentSearchGraphMemoryBasisLike;
  primaryMetricContract: ExperimentSearchMetricContractLike;
  baselineFairnessContract: ExperimentSearchBaselineFairnessContractLike;
  requiredValidationSteps: ExperimentSearchValidationStepLike[];
  innovationInvalidityCriteria: Record<string, unknown> | null;
  tuningExhaustionCriteria: Record<string, unknown> | null;
  searchLadder: string[];
};

/**
 * 解析实验搜索规范。
 *
 * 从 unknown JSON 安全转换为强类型 Spec。
 * 内环策略默认值为 "karpathy_fast_keep_discard"（参考 Karpathy 的快速迭代方法），
 * trialTimeBudgetMinutes 默认 5 分钟（快速反馈循环）。
 */
export function normalizeExperimentSearchSpec(
  value: unknown
): ExperimentSearchSpecLike {
  const record = asRecord(value) ?? {};
  const gitStrategy = asRecord(record.gitStrategy ?? record.git_strategy) ?? {};
  const comparisonPolicy =
    asRecord(record.comparisonPolicy ?? record.comparison_policy) ?? {};
  const budget = asRecord(record.budget) ?? {};
  const innerLoopPolicy =
    asRecord(record.innerLoopPolicy ?? record.inner_loop_policy) ?? {};
  const outerLoopPolicy =
    asRecord(record.outerLoopPolicy ?? record.outer_loop_policy) ?? {};
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
      trialTimeBudgetMinutes:
        pickNumber(budget, [
          "trialTimeBudgetMinutes",
          "trial_time_budget_minutes",
        ]) == null
          ? null
          : Math.max(
              0,
              Number(
                pickNumber(budget, [
                  "trialTimeBudgetMinutes",
                  "trial_time_budget_minutes",
                ])!
              )
            ),
    },
    innerLoopPolicy: {
      mode:
        pickString(innerLoopPolicy, ["mode"]) ??
        pickString(record, ["innerLoopMode", "inner_loop_mode"]) ??
        "karpathy_fast_keep_discard",
      trialTimeBudgetMinutes:
        pickNumber(innerLoopPolicy, [
          "trialTimeBudgetMinutes",
          "trial_time_budget_minutes",
        ]) ??
        pickNumber(budget, [
          "trialTimeBudgetMinutes",
          "trial_time_budget_minutes",
        ]) ??
        5,
      strictComparableBudget:
        pickBoolean(innerLoopPolicy, [
          "strictComparableBudget",
          "strict_comparable_budget",
        ]) ?? true,
      requireOneChangeSignature:
        pickBoolean(innerLoopPolicy, [
          "requireOneChangeSignature",
          "require_one_change_signature",
        ]) ?? true,
      keepDiscardRule:
        pickString(innerLoopPolicy, ["keepDiscardRule", "keep_discard_rule"]) ??
        "primary_metric_keep_discard",
    },
    outerLoopPolicy: {
      requireBaselineDatasetCoverageForEffectiveCandidates:
        pickBoolean(outerLoopPolicy, [
          "requireBaselineDatasetCoverageForEffectiveCandidates",
          "require_baseline_dataset_coverage_for_effective_candidates",
        ]) ?? true,
      innovationDeviationTolerance:
        pickString(outerLoopPolicy, [
          "innovationDeviationTolerance",
          "innovation_deviation_tolerance",
        ]) ?? "wide",
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

/**
 * 解析实验搜索规范文件路径。
 *
 * 优先级：显式指定路径 > manifest 中配置 > 默认路径。
 * 支持绝对路径和相对路径（相对于项目根目录）。
 */
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
