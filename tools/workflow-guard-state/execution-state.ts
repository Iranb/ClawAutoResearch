/**
 * 执行状态类型定义。
 *
 * 定义工作流执行过程中各子系统的状态结构及其 normalize/serialize 函数。
 * 这些状态从 JSON 文件读取（unknown），通过 normalize 转为安全类型，
 * 写回时通过 serialize 转为 snake_case 键名（与存储格式一致）。
 *
 * 包含 8 种子状态：
 * - ExperimentSearch: 实验搜索（搜索会话、候选实验、git 操作、数据集覆盖）
 * - Orchestration: 流程编排（手递手、阻塞、回滚、重试）
 * - WritePackage: 写作包组装（证据矩阵、图表、引用）
 * - PaperQc: 论文质量检查（编译、页数、LaTeX 检查）
 * - CitationCollection: 引用收集（候选、验证、幻觉检测）
 * - FigureQc: 图表质检（重复、标题对齐、文本对齐）
 * - ReviewIssue: 审查问题（单个问题的跟踪）
 * - ReviewIssueTracker: 审查问题集合（汇总计数、分数记录）
 *
 * 为什么 camelCase vs snake_case 分离？
 * - TypeScript 代码内部用 camelCase（符合 JS 惯例）
 * - JSON 存储用 snake_case（符合 Python/其他系统惯例）
 * - normalize/serialize 负责双向转换
 */
import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";
import { normalizeReviewScoreRecords } from "./authoring-review-state";

const DEFAULT_REVIEW_ISSUES_PATH = "reviewer/REVIEW_ISSUES.json";

/**
 * 实验搜索状态（原始输入）。
 *
 * 记录实验搜索全流程的状态——搜索会话、候选实验跟踪、
 * git 操作状态、数据集覆盖、创新锚点等。
 *
 * 为什么这么多字段？因为实验搜索借鉴了超参数优化的概念——
 * 需要跟踪 baseline、incumbent、frontier、completed、failed、discarded
 * 等多种实验状态，以及 multi-seed 公平性、ablation 状态等。
 */
type ExperimentSearchStateLike = {
  status: string;
  projectId: string | null;
  trackId: string | null;
  currentMainStage: string | null;
  currentSubstage: string | null;
  validationStage: string | null;
  innerLoopMode: string | null;
  trialTimeBudgetMinutes: number | null;
  strictComparableBudget: boolean;
  requireOneChangeSignature: boolean;
  oneChangeSignature: string | null;
  oneChangeValidationStatus: string;
  keepDiscardRule: string | null;
  lastTrialOutcome: string | null;
  comparableTrialBudgetStatus: string;
  searchSessionId: string | null;
  searchSpecPath: string | null;
  searchStatePath: string | null;
  baselineExperimentId: string | null;
  frontierNodeIds: string[];
  frontierExperimentIds: string[];
  bestNodeId: string | null;
  incumbentExperimentId: string | null;
  incumbentBranch: string | null;
  incumbentCommit: string | null;
  completedNodeIds: string[];
  completedExperimentIds: string[];
  failedNodeIds: string[];
  failedExperimentIds: string[];
  discardedExperimentIds: string[];
  triedHyperparams: string[];
  completedAblations: string[];
  lastCandidateExperimentId: string | null;
  lastCandidateBranch: string | null;
  lastCandidateCommit: string | null;
  requestedGitOp: string | null;
  gitOpStatus: string | null;
  gitReviewStorePath: string | null;
  gitReviewPacketPath: string | null;
  candidateWorktreePath: string | null;
  candidateBaseCommit: string | null;
  candidateHeadCommit: string | null;
  lastGitOpResult: string | null;
  lastDecision: string | null;
  multiSeedStatus: string;
  baselineFairnessStatus: string;
  implementationConfidence: string;
  searchExhaustionStatus: string;
  ablationStatus: string;
  innovationStatus: string;
  decisionConfidence: string;
  recommendedNextAction: string | null;
  failureClusterIds: string[];
  evidenceCleanlinessStatus: string;
  baselineDatasetEnvelope: string[];
  validatedDatasetEnvelope: string[];
  baselineDatasetCoverageStatus: string;
  baselineDatasetCoverageMissing: string[];
  baselineDatasetCoverageSummary: string | null;
  innovationAnchorPoints: string[];
  innovationDeviationStatus: string;
  innovationDeviationScore: number | null;
  innovationDeviationSummary: string | null;
  evaluationSummaryPath: string | null;
  plotPackStatus: string;
  plotPackPath: string | null;
  stageProgressPath: string | null;
  checkpointPath: string | null;
  graphMemoryPacketPath: string | null;
  graphMemorySyncStatus: string;
  lastGraphMemoryRefreshAt: string | null;
  createdAt: string | null;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

/**
 * 流程编排状态（原始输入）。
 *
 * 记录手递手流水线的执行状态——当前执行者、待交接、
 * 阻塞/回滚原因、重试预算等。
 *
 * 关键设计：retryBudgetRemaining 防止无限重试，
 * resumeCursor 记录从哪里恢复执行。
 */
type OrchestrationStateLike = {
  status: string;
  activeTicketId: string | null;
  stageRunId: string | null;
  currentExecutionId: string | null;
  currentOwner: string | null;
  nextOwner: string | null;
  pendingHandoffId: string | null;
  pendingOwnerCandidate: string | null;
  pendingStageCandidate: string | null;
  handoffPhase: string | null;
  ownerClaimedAt: string | null;
  ownerActivationDeadline: string | null;
  rollbackTargetOwner: string | null;
  lastHandoffError: string | null;
  nextTransitionCandidate: string | null;
  blockingCategory: string | null;
  blockingReason: string | null;
  rollbackReasonCategory: string | null;
  rollbackEvidenceSummary: string | null;
  retryBudgetRemaining: number | null;
  lastContractEvalAt: string | null;
  lastContractEvalResult: string | null;
  rollbackTargetStage: string | null;
  resumeCursor: string | null;
  lastUpdatedAt: string | null;
};

/**
 * 写作包组装状态（原始输入）。
 *
 * 记录论文写作所需的所有输入制品——证据矩阵、叙事报告、
 * 图表包、引用候选、证据计数等。
 *
 * assemblyStatus 跟踪组装进度，sectionAssemblyQueuePath 记录待组装章节队列。
 */
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

/**
 * 论文质量检查状态（原始输入）。
 *
 * 记录 LaTeX 编译状态、页数预算、chktex 检查结果、
 * 图表引用检查、反思轮次等。
 *
 * bodyPageCount 和 referenceStartPage 用于精确控制论文页数——
 * 这是会议论文投稿的关键约束。
 */
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

/**
 * 引用收集状态（原始输入）。
 *
 * 跟踪引用收集进度——候选数量、已验证、可疑、幻觉。
 * hallucinatedCount 是关键指标——LLM 可能编造不存在的引用，
 * 需要逐个验证。
 */
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

/**
 * 图表质检状态（原始输入）。
 *
 * 检查图表重复、标题对齐、文本引用对齐、图表选择。
 *
 * 为什么需要图表质检？因为论文中的每个图表必须在正文中被正确引用，
 * 且标题必须与正文描述一致——这是学术写作的基本要求。
 */
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

/** 审查问题计数（按严重程度分桶）。 */
type ReviewIssueCountsLike = {
  critical: number;
  high: number;
  medium: number;
  low: number;
};

/**
 * 单个审查问题（原始输入）。
 *
 * 记录一个审查发现的问题——严重程度、描述、目标制品、
 * 负责人、修复路径、验证状态。
 *
 * issueId 自动生成（如果未提供），确保每个问题有唯一标识。
 * waiverReason 记录豁免原因——有些问题可以不修复但需要说明理由。
 */
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

/**
 * 审查问题跟踪器状态（原始输入）。
 *
 * 汇总所有审查问题——开放计数、问题列表、分数记录、最近审查轮次。
 * DEFAULT_REVIEW_ISSUES_PATH 是默认存储路径。
 */
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

/**
 * 解析实验搜索状态。
 *
 * 从 unknown JSON 安全转换为强类型状态。兼容 camelCase 和 snake_case 键名。
 * 所有状态字段通过 normalizeStage 标准化，数值字段通过 pickNumber 安全提取。
 */
export function normalizeExperimentSearchState(
  value: unknown
): ExperimentSearchStateLike {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "not_started",
    projectId: pickString(record, ["projectId", "project_id"]),
    trackId: pickString(record, ["trackId", "track_id"]),
    currentMainStage:
      normalizeStage(record.currentMainStage ?? record.current_main_stage) ?? null,
    currentSubstage:
      normalizeStage(record.currentSubstage ?? record.current_substage) ?? null,
    validationStage:
      normalizeStage(record.validationStage ?? record.validation_stage) ?? null,
    innerLoopMode:
      normalizeStage(record.innerLoopMode ?? record.inner_loop_mode) ?? null,
    trialTimeBudgetMinutes:
      pickNumber(record, ["trialTimeBudgetMinutes", "trial_time_budget_minutes"]) ??
      null,
    strictComparableBudget:
      typeof record.strictComparableBudget === "boolean"
        ? record.strictComparableBudget
        : typeof record.strict_comparable_budget === "boolean"
          ? record.strict_comparable_budget
          : false,
    requireOneChangeSignature:
      typeof record.requireOneChangeSignature === "boolean"
        ? record.requireOneChangeSignature
        : typeof record.require_one_change_signature === "boolean"
          ? record.require_one_change_signature
          : false,
    oneChangeSignature: pickString(record, [
      "oneChangeSignature",
      "one_change_signature",
    ]),
    oneChangeValidationStatus:
      normalizeStage(
        record.oneChangeValidationStatus ?? record.one_change_validation_status
      ) ?? "unknown",
    keepDiscardRule: pickString(record, [
      "keepDiscardRule",
      "keep_discard_rule",
    ]),
    lastTrialOutcome: pickString(record, [
      "lastTrialOutcome",
      "last_trial_outcome",
    ]),
    comparableTrialBudgetStatus:
      normalizeStage(
        record.comparableTrialBudgetStatus ??
          record.comparable_trial_budget_status
      ) ?? "unknown",
    searchSessionId: pickString(record, ["searchSessionId", "search_session_id"]),
    searchSpecPath: pickString(record, ["searchSpecPath", "search_spec_path"]),
    searchStatePath: pickString(record, ["searchStatePath", "search_state_path"]),
    baselineExperimentId: pickString(record, [
      "baselineExperimentId",
      "baseline_experiment_id",
    ]),
    frontierNodeIds: asStringArray(
      record.frontierNodeIds ?? record.frontier_node_ids
    ),
    frontierExperimentIds: asStringArray(
      record.frontierExperimentIds ?? record.frontier_experiment_ids
    ),
    bestNodeId: pickString(record, ["bestNodeId", "best_node_id"]),
    incumbentExperimentId: pickString(record, [
      "incumbentExperimentId",
      "incumbent_experiment_id",
    ]),
    incumbentBranch: pickString(record, [
      "incumbentBranch",
      "incumbent_branch",
    ]),
    incumbentCommit: pickString(record, [
      "incumbentCommit",
      "incumbent_commit",
    ]),
    completedNodeIds: asStringArray(
      record.completedNodeIds ?? record.completed_node_ids
    ),
    completedExperimentIds: asStringArray(
      record.completedExperimentIds ?? record.completed_experiment_ids
    ),
    failedNodeIds: asStringArray(record.failedNodeIds ?? record.failed_node_ids),
    failedExperimentIds: asStringArray(
      record.failedExperimentIds ?? record.failed_experiment_ids
    ),
    discardedExperimentIds: asStringArray(
      record.discardedExperimentIds ?? record.discarded_experiment_ids
    ),
    triedHyperparams: asStringArray(
      record.triedHyperparams ?? record.tried_hyperparams
    ),
    completedAblations: asStringArray(
      record.completedAblations ?? record.completed_ablations
    ),
    lastCandidateExperimentId: pickString(record, [
      "lastCandidateExperimentId",
      "last_candidate_experiment_id",
    ]),
    lastCandidateBranch: pickString(record, [
      "lastCandidateBranch",
      "last_candidate_branch",
    ]),
    lastCandidateCommit: pickString(record, [
      "lastCandidateCommit",
      "last_candidate_commit",
    ]),
    requestedGitOp: pickString(record, ["requestedGitOp", "requested_git_op"]),
    gitOpStatus:
      normalizeStage(record.gitOpStatus ?? record.git_op_status) ?? null,
    gitReviewStorePath: pickString(record, [
      "gitReviewStorePath",
      "git_review_store_path",
    ]),
    gitReviewPacketPath: pickString(record, [
      "gitReviewPacketPath",
      "git_review_packet_path",
    ]),
    candidateWorktreePath: pickString(record, [
      "candidateWorktreePath",
      "candidate_worktree_path",
    ]),
    candidateBaseCommit: pickString(record, [
      "candidateBaseCommit",
      "candidate_base_commit",
    ]),
    candidateHeadCommit: pickString(record, [
      "candidateHeadCommit",
      "candidate_head_commit",
    ]),
    lastGitOpResult: pickString(record, [
      "lastGitOpResult",
      "last_git_op_result",
    ]),
    lastDecision: pickString(record, ["lastDecision", "last_decision"]),
    multiSeedStatus:
      normalizeStage(record.multiSeedStatus ?? record.multi_seed_status) ??
      "pending",
    baselineFairnessStatus:
      normalizeStage(
        record.baselineFairnessStatus ?? record.baseline_fairness_status
      ) ?? "unknown",
    implementationConfidence:
      normalizeStage(
        record.implementationConfidence ?? record.implementation_confidence
      ) ?? "unknown",
    searchExhaustionStatus:
      normalizeStage(
        record.searchExhaustionStatus ?? record.search_exhaustion_status
      ) ?? "unknown",
    ablationStatus:
      normalizeStage(record.ablationStatus ?? record.ablation_status) ??
      "pending",
    innovationStatus:
      normalizeStage(record.innovationStatus ?? record.innovation_status) ??
      "unknown",
    decisionConfidence:
      normalizeStage(record.decisionConfidence ?? record.decision_confidence) ??
      "unknown",
    recommendedNextAction: pickString(record, [
      "recommendedNextAction",
      "recommended_next_action",
    ]),
    failureClusterIds: asStringArray(
      record.failureClusterIds ?? record.failure_cluster_ids
    ),
    evidenceCleanlinessStatus:
      normalizeStage(
        record.evidenceCleanlinessStatus ?? record.evidence_cleanliness_status
      ) ?? "unknown",
    baselineDatasetEnvelope: asStringArray(
      record.baselineDatasetEnvelope ?? record.baseline_dataset_envelope
    ),
    validatedDatasetEnvelope: asStringArray(
      record.validatedDatasetEnvelope ?? record.validated_dataset_envelope
    ),
    baselineDatasetCoverageStatus:
      normalizeStage(
        record.baselineDatasetCoverageStatus ??
          record.baseline_dataset_coverage_status
      ) ?? "unknown",
    baselineDatasetCoverageMissing: asStringArray(
      record.baselineDatasetCoverageMissing ??
        record.baseline_dataset_coverage_missing
    ),
    baselineDatasetCoverageSummary: pickString(record, [
      "baselineDatasetCoverageSummary",
      "baseline_dataset_coverage_summary",
    ]),
    innovationAnchorPoints: asStringArray(
      record.innovationAnchorPoints ?? record.innovation_anchor_points
    ),
    innovationDeviationStatus:
      normalizeStage(
        record.innovationDeviationStatus ??
          record.innovation_deviation_status
      ) ?? "unknown",
    innovationDeviationScore:
      pickNumber(record, [
        "innovationDeviationScore",
        "innovation_deviation_score",
      ]) ?? null,
    innovationDeviationSummary: pickString(record, [
      "innovationDeviationSummary",
      "innovation_deviation_summary",
    ]),
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
    graphMemoryPacketPath: pickString(record, [
      "graphMemoryPacketPath",
      "graph_memory_packet_path",
    ]),
    graphMemorySyncStatus:
      normalizeStage(record.graphMemorySyncStatus ?? record.graph_memory_sync_status) ??
      "unknown",
    lastGraphMemoryRefreshAt: pickString(record, [
      "lastGraphMemoryRefreshAt",
      "last_graph_memory_refresh_at",
    ]),
    createdAt: pickString(record, ["createdAt", "created_at"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

/**
 * 序列化实验搜索状态。
 *
 * 将 camelCase 内部表示转为 snake_case JSON 格式，与存储格式一致。
 */
export function serializeExperimentSearchState(
  state: ExperimentSearchStateLike
): Record<string, unknown> {
  return {
    status: state.status,
    project_id: state.projectId,
    track_id: state.trackId,
    current_main_stage: state.currentMainStage,
    current_substage: state.currentSubstage,
    inner_loop_mode: state.innerLoopMode,
    trial_time_budget_minutes: state.trialTimeBudgetMinutes,
    strict_comparable_budget: state.strictComparableBudget,
    require_one_change_signature: state.requireOneChangeSignature,
    one_change_signature: state.oneChangeSignature,
    one_change_validation_status: state.oneChangeValidationStatus,
    keep_discard_rule: state.keepDiscardRule,
    last_trial_outcome: state.lastTrialOutcome,
    comparable_trial_budget_status: state.comparableTrialBudgetStatus,
    search_session_id: state.searchSessionId,
    search_spec_path: state.searchSpecPath,
    search_state_path: state.searchStatePath,
    baseline_experiment_id: state.baselineExperimentId,
    frontier_node_ids: state.frontierNodeIds,
    frontier_experiment_ids: state.frontierExperimentIds,
    best_node_id: state.bestNodeId,
    incumbent_experiment_id: state.incumbentExperimentId,
    incumbent_branch: state.incumbentBranch,
    incumbent_commit: state.incumbentCommit,
    completed_node_ids: state.completedNodeIds,
    completed_experiment_ids: state.completedExperimentIds,
    failed_node_ids: state.failedNodeIds,
    failed_experiment_ids: state.failedExperimentIds,
    discarded_experiment_ids: state.discardedExperimentIds,
    tried_hyperparams: state.triedHyperparams,
    completed_ablations: state.completedAblations,
    last_candidate_experiment_id: state.lastCandidateExperimentId,
    last_candidate_branch: state.lastCandidateBranch,
    last_candidate_commit: state.lastCandidateCommit,
    requested_git_op: state.requestedGitOp,
    git_op_status: state.gitOpStatus,
    git_review_store_path: state.gitReviewStorePath,
    git_review_packet_path: state.gitReviewPacketPath,
    candidate_worktree_path: state.candidateWorktreePath,
    candidate_base_commit: state.candidateBaseCommit,
    candidate_head_commit: state.candidateHeadCommit,
    last_git_op_result: state.lastGitOpResult,
    last_decision: state.lastDecision,
    multi_seed_status: state.multiSeedStatus,
    validation_stage: state.validationStage,
    baseline_fairness_status: state.baselineFairnessStatus,
    implementation_confidence: state.implementationConfidence,
    search_exhaustion_status: state.searchExhaustionStatus,
    ablation_status: state.ablationStatus,
    innovation_status: state.innovationStatus,
    decision_confidence: state.decisionConfidence,
    recommended_next_action: state.recommendedNextAction,
    failure_cluster_ids: state.failureClusterIds,
    evidence_cleanliness_status: state.evidenceCleanlinessStatus,
    baseline_dataset_envelope: state.baselineDatasetEnvelope,
    validated_dataset_envelope: state.validatedDatasetEnvelope,
    baseline_dataset_coverage_status: state.baselineDatasetCoverageStatus,
    baseline_dataset_coverage_missing: state.baselineDatasetCoverageMissing,
    baseline_dataset_coverage_summary: state.baselineDatasetCoverageSummary,
    innovation_anchor_points: state.innovationAnchorPoints,
    innovation_deviation_status: state.innovationDeviationStatus,
    innovation_deviation_score: state.innovationDeviationScore,
    innovation_deviation_summary: state.innovationDeviationSummary,
    evaluation_summary_path: state.evaluationSummaryPath,
    plot_pack_status: state.plotPackStatus,
    plot_pack_path: state.plotPackPath,
    stage_progress_path: state.stageProgressPath,
    checkpoint_path: state.checkpointPath,
    graph_memory_packet_path: state.graphMemoryPacketPath,
    graph_memory_sync_status: state.graphMemorySyncStatus,
    last_graph_memory_refresh_at: state.lastGraphMemoryRefreshAt,
    created_at: state.createdAt,
    pending_reason: state.pendingReason,
    last_updated_at: state.lastUpdatedAt,
  };
}

/**
 * 解析流程编排状态。
 *
 * 从 unknown JSON 安全转换。记录手递手流水线的执行状态——
 * 当前执行者、待交接、阻塞/回滚原因、重试预算。
 */
export function normalizeOrchestrationState(
  value: unknown
): OrchestrationStateLike {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    activeTicketId: pickString(record, ["activeTicketId", "active_ticket_id"]),
    stageRunId: pickString(record, ["stageRunId", "stage_run_id"]),
    currentExecutionId: pickString(record, [
      "currentExecutionId",
      "current_execution_id",
    ]),
    currentOwner: pickString(record, ["currentOwner", "current_owner"]),
    nextOwner: pickString(record, ["nextOwner", "next_owner"]),
    pendingHandoffId: pickString(record, [
      "pendingHandoffId",
      "pending_handoff_id",
    ]),
    pendingOwnerCandidate: pickString(record, [
      "pendingOwnerCandidate",
      "pending_owner_candidate",
    ]),
    pendingStageCandidate: pickString(record, [
      "pendingStageCandidate",
      "pending_stage_candidate",
    ]),
    handoffPhase: pickString(record, ["handoffPhase", "handoff_phase"]),
    ownerClaimedAt: pickString(record, ["ownerClaimedAt", "owner_claimed_at"]),
    ownerActivationDeadline: pickString(record, [
      "ownerActivationDeadline",
      "owner_activation_deadline",
    ]),
    rollbackTargetOwner: pickString(record, [
      "rollbackTargetOwner",
      "rollback_target_owner",
    ]),
    lastHandoffError: pickString(record, [
      "lastHandoffError",
      "last_handoff_error",
    ]),
    nextTransitionCandidate: pickString(record, [
      "nextTransitionCandidate",
      "next_transition_candidate",
    ]),
    blockingCategory: pickString(record, [
      "blockingCategory",
      "blocking_category",
    ]),
    blockingReason: pickString(record, ["blockingReason", "blocking_reason"]),
    rollbackReasonCategory: pickString(record, [
      "rollbackReasonCategory",
      "rollback_reason_category",
    ]),
    rollbackEvidenceSummary: pickString(record, [
      "rollbackEvidenceSummary",
      "rollback_evidence_summary",
    ]),
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

/**
 * 序列化流程编排状态。
 */
export function serializeOrchestrationState(
  value: OrchestrationStateLike
): Record<string, unknown> {
  return {
    status: value.status,
    active_ticket_id: value.activeTicketId,
    stage_run_id: value.stageRunId,
    current_execution_id: value.currentExecutionId,
    current_owner: value.currentOwner,
    next_owner: value.nextOwner,
    pending_handoff_id: value.pendingHandoffId,
    pending_owner_candidate: value.pendingOwnerCandidate,
    pending_stage_candidate: value.pendingStageCandidate,
    handoff_phase: value.handoffPhase,
    owner_claimed_at: value.ownerClaimedAt,
    owner_activation_deadline: value.ownerActivationDeadline,
    rollback_target_owner: value.rollbackTargetOwner,
    last_handoff_error: value.lastHandoffError,
    next_transition_candidate: value.nextTransitionCandidate,
    blocking_category: value.blockingCategory,
    blocking_reason: value.blockingReason,
    rollback_reason_category: value.rollbackReasonCategory,
    rollback_evidence_summary: value.rollbackEvidenceSummary,
    retry_budget_remaining: value.retryBudgetRemaining,
    last_contract_eval_at: value.lastContractEvalAt,
    last_contract_eval_result: value.lastContractEvalResult,
    rollback_target_stage: value.rollbackTargetStage,
    resume_cursor: value.resumeCursor,
    last_updated_at: value.lastUpdatedAt,
  };
}

/**
 * 解析写作包组装状态。
 *
 * 从 unknown JSON 安全转换。记录论文写作所需的所有输入制品。
 * sourceArtifactCount / derivedArtifactCount 确保为非负整数。
 */
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

/**
 * 序列化写作包组装状态。
 */
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

/**
 * 解析论文质量检查状态。
 *
 * 从 unknown JSON 安全转换。记录 LaTeX 编译、页数预算、chktex 检查等结果。
 */
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

/**
 * 序列化论文质量检查状态。
 */
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

/**
 * 解析引用收集状态。
 *
 * 从 unknown JSON 安全转换。跟踪引用收集的候选、验证、可疑、幻觉计数。
 */
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

/**
 * 序列化引用收集状态。
 */
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

/**
 * 解析图表质检状态。
 *
 * 从 unknown JSON 安全转换。检查图表重复、标题对齐、文本引用对齐。
 */
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

/**
 * 序列化图表质检状态。
 */
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

/**
 * 解析审查问题计数。
 *
 * 从 unknown JSON 安全转换，确保所有计数为非负整数。
 */
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

/**
 * 序列化审查问题计数。
 */
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

/**
 * 解析单个审查问题。
 *
 * 从 unknown JSON 安全转换。如果未提供 issueId，自动生成唯一标识。
 * 所有状态字段通过 normalizeStage 标准化。
 */
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

/**
 * 序列化单个审查问题。
 */
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

/**
 * 解析审查问题跟踪器状态。
 *
 * 从 unknown JSON 安全转换。汇总所有审查问题——
 * 开放计数、问题列表（递归 normalize）、分数记录。
 * issueManifestPath 默认为 DEFAULT_REVIEW_ISSUES_PATH。
 */
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

/**
 * 序列化审查问题跟踪器状态。
 *
 * 将 camelCase 内部表示转为 snake_case JSON，递归序列化每个问题。
 */
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
