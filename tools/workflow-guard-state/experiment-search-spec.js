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
import { asRecord, asStringArray, pickBoolean, pickNumber, pickString, } from "../workflow-guard-core/coercion";
export const DEFAULT_EXPERIMENT_SEARCH_SPEC_PATH = "planner/EXPERIMENT_SEARCH_SPEC.json";
/**
 * 解析实验搜索规范。
 *
 * 从 unknown JSON 安全转换为强类型 Spec。
 * 内环策略默认值为 "karpathy_fast_keep_discard"（参考 Karpathy 的快速迭代方法），
 * trialTimeBudgetMinutes 默认 5 分钟（快速反馈循环）。
 */
export function normalizeExperimentSearchSpec(value) {
    const record = asRecord(value) ?? {};
    const gitStrategy = asRecord(record.gitStrategy ?? record.git_strategy) ?? {};
    const comparisonPolicy = asRecord(record.comparisonPolicy ?? record.comparison_policy) ?? {};
    const budget = asRecord(record.budget) ?? {};
    const innerLoopPolicy = asRecord(record.innerLoopPolicy ?? record.inner_loop_policy) ?? {};
    const outerLoopPolicy = asRecord(record.outerLoopPolicy ?? record.outer_loop_policy) ?? {};
    const graphMemoryBasis = asRecord(record.graphMemoryBasis ?? record.graph_memory_basis) ?? {};
    const primaryMetricContract = asRecord(record.primaryMetricContract ?? record.primary_metric_contract) ?? {};
    const baselineFairnessContract = asRecord(record.baselineFairnessContract ?? record.baseline_fairness_contract) ?? {};
    const protocolLockContract = asRecord(record.protocolLockContract ?? record.protocol_lock_contract) ?? {};
    const protocolLockFairnessChecks = asRecord(protocolLockContract.fairnessChecks ?? protocolLockContract.fairness_checks) ?? {};
    const allowedDeviations = Array.isArray(protocolLockContract.allowedDeviations ??
        protocolLockContract.allowed_deviations)
        ? (protocolLockContract.allowedDeviations ??
            protocolLockContract.allowed_deviations)
            .map((entry) => asRecord(entry))
            .filter((entry) => Boolean(entry))
            .map((entry) => ({
            deviationId: pickString(entry, ["deviationId", "deviation_id"]),
            scope: pickString(entry, ["scope"]),
            rationale: pickString(entry, ["rationale"]),
            allowedInMainResults: pickBoolean(entry, [
                "allowedInMainResults",
                "allowed_in_main_results",
            ]) ?? false,
            label: pickString(entry, ["label"]),
        }))
        : [];
    const requiredValidationSteps = Array.isArray(record.requiredValidationSteps ?? record.required_validation_steps)
        ? (record.requiredValidationSteps ??
            record.required_validation_steps)
            .map((entry) => asRecord(entry))
            .filter((entry) => Boolean(entry))
            .map((entry) => ({
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
            requireCleanCandidateHistory: pickBoolean(gitStrategy, [
                "requireCleanCandidateHistory",
                "require_clean_candidate_history",
            ]) ?? true,
            promotionCommitPolicy: pickString(gitStrategy, [
                "promotionCommitPolicy",
                "promotion_commit_policy",
            ]),
            discardUnpromotedCandidates: pickBoolean(gitStrategy, [
                "discardUnpromotedCandidates",
                "discard_unpromoted_candidates",
            ]) ?? true,
        },
        frozenContract: asStringArray(record.frozenContract ?? record.frozen_contract),
        searchEnvelope: asRecord(record.searchEnvelope ?? record.search_envelope) ?? null,
        comparisonPolicy: {
            compareAgainst: pickString(comparisonPolicy, [
                "compareAgainst",
                "compare_against",
            ]),
            promotionRule: pickString(comparisonPolicy, [
                "promotionRule",
                "promotion_rule",
            ]),
            nonPromotionSignals: asStringArray(comparisonPolicy.nonPromotionSignals ??
                comparisonPolicy.non_promotion_signals),
        },
        budget: {
            maxRuns: pickNumber(budget, ["maxRuns", "max_runs"]) == null
                ? null
                : Math.max(0, Math.floor(pickNumber(budget, ["maxRuns", "max_runs"]))),
            maxGpuHours: pickNumber(budget, ["maxGpuHours", "max_gpu_hours"]) == null
                ? null
                : Math.max(0, Number(pickNumber(budget, ["maxGpuHours", "max_gpu_hours"]))),
            noImprovementPatience: pickNumber(budget, [
                "noImprovementPatience",
                "no_improvement_patience",
            ]) == null
                ? null
                : Math.max(0, Math.floor(pickNumber(budget, [
                    "noImprovementPatience",
                    "no_improvement_patience",
                ]))),
            baselineUnderperformPatience: pickNumber(budget, [
                "baselineUnderperformPatience",
                "baseline_underperform_patience",
            ]) == null
                ? null
                : Math.max(0, Math.floor(pickNumber(budget, [
                    "baselineUnderperformPatience",
                    "baseline_underperform_patience",
                ]))),
            trialTimeBudgetMinutes: pickNumber(budget, [
                "trialTimeBudgetMinutes",
                "trial_time_budget_minutes",
            ]) == null
                ? null
                : Math.max(0, Number(pickNumber(budget, [
                    "trialTimeBudgetMinutes",
                    "trial_time_budget_minutes",
                ]))),
        },
        innerLoopPolicy: {
            mode: pickString(innerLoopPolicy, ["mode"]) ??
                pickString(record, ["innerLoopMode", "inner_loop_mode"]) ??
                "karpathy_fast_keep_discard",
            trialTimeBudgetMinutes: pickNumber(innerLoopPolicy, [
                "trialTimeBudgetMinutes",
                "trial_time_budget_minutes",
            ]) ??
                pickNumber(budget, [
                    "trialTimeBudgetMinutes",
                    "trial_time_budget_minutes",
                ]) ??
                5,
            strictComparableBudget: pickBoolean(innerLoopPolicy, [
                "strictComparableBudget",
                "strict_comparable_budget",
            ]) ?? true,
            requireOneChangeSignature: pickBoolean(innerLoopPolicy, [
                "requireOneChangeSignature",
                "require_one_change_signature",
            ]) ?? true,
            keepDiscardRule: pickString(innerLoopPolicy, ["keepDiscardRule", "keep_discard_rule"]) ??
                "primary_metric_keep_discard",
        },
        outerLoopPolicy: {
            requireBaselineDatasetCoverageForEffectiveCandidates: pickBoolean(outerLoopPolicy, [
                "requireBaselineDatasetCoverageForEffectiveCandidates",
                "require_baseline_dataset_coverage_for_effective_candidates",
            ]) ?? true,
            innovationDeviationTolerance: pickString(outerLoopPolicy, [
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
            minimumImprovement: pickNumber(primaryMetricContract, [
                "minimumImprovement",
                "minimum_improvement",
            ]) ?? null,
            primaryEvidence: asStringArray(primaryMetricContract.primaryEvidence ??
                primaryMetricContract.primary_evidence),
        },
        baselineFairnessContract: {
            requireBaselineParity: pickBoolean(baselineFairnessContract, [
                "requireBaselineParity",
                "require_baseline_parity",
            ]) ?? true,
            lockedDatasetProtocol: pickBoolean(baselineFairnessContract, [
                "lockedDatasetProtocol",
                "locked_dataset_protocol",
            ]) ?? true,
            lockedMetricProtocol: pickBoolean(baselineFairnessContract, [
                "lockedMetricProtocol",
                "locked_metric_protocol",
            ]) ?? true,
            lockedEvaluationHarness: pickBoolean(baselineFairnessContract, [
                "lockedEvaluationHarness",
                "locked_evaluation_harness",
            ]) ?? true,
        },
        protocolLockContract: {
            benchmarkFamily: pickString(protocolLockContract, [
                "benchmarkFamily",
                "benchmark_family",
            ]),
            canonicalDataset: pickString(protocolLockContract, [
                "canonicalDataset",
                "canonical_dataset",
            ]),
            splitDescriptor: pickString(protocolLockContract, [
                "splitDescriptor",
                "split_descriptor",
            ]),
            splitSource: pickString(protocolLockContract, [
                "splitSource",
                "split_source",
            ]),
            splitChecksum: pickString(protocolLockContract, [
                "splitChecksum",
                "split_checksum",
            ]),
            evaluationHarness: pickString(protocolLockContract, [
                "evaluationHarness",
                "evaluation_harness",
            ]),
            officialEvalRecipe: pickString(protocolLockContract, [
                "officialEvalRecipe",
                "official_eval_recipe",
            ]),
            allowedDeviations,
            fairCompareNotes: asStringArray(protocolLockContract.fairCompareNotes ??
                protocolLockContract.fair_compare_notes),
            fairnessChecks: {
                sameBackbone: pickString(protocolLockFairnessChecks, [
                    "sameBackbone",
                    "same_backbone",
                ]),
                samePretraining: pickString(protocolLockFairnessChecks, [
                    "samePretraining",
                    "same_pretraining",
                ]),
                sameSplit: pickString(protocolLockFairnessChecks, [
                    "sameSplit",
                    "same_split",
                ]),
                sameEvaluationHarness: pickString(protocolLockFairnessChecks, [
                    "sameEvaluationHarness",
                    "same_evaluation_harness",
                ]),
                baselineReferenceMode: pickString(protocolLockFairnessChecks, [
                    "baselineReferenceMode",
                    "baseline_reference_mode",
                ]),
            },
        },
        requiredValidationSteps,
        innovationInvalidityCriteria: asRecord(record.innovationInvalidityCriteria ??
            record.innovation_invalidity_criteria) ?? null,
        tuningExhaustionCriteria: asRecord(record.tuningExhaustionCriteria ?? record.tuning_exhaustion_criteria) ?? null,
        searchLadder: asStringArray(record.searchLadder ?? record.search_ladder),
    };
}
/**
 * 解析实验搜索规范文件路径。
 *
 * 优先级：显式指定路径 > manifest 中配置 > 默认路径。
 * 支持绝对路径和相对路径（相对于项目根目录）。
 */
export function resolveExperimentSearchSpecPath(params) {
    const manifestRecord = asRecord(params.manifest);
    const manifestSearch = asRecord(manifestRecord?.experiment_search);
    const configuredPath = params.searchSpecPath?.trim() ||
        pickString(manifestSearch ?? {}, ["searchSpecPath", "search_spec_path"]) ||
        DEFAULT_EXPERIMENT_SEARCH_SPEC_PATH;
    return path.isAbsolute(configuredPath)
        ? configuredPath
        : path.join(params.projectRoot, configuredPath);
}
