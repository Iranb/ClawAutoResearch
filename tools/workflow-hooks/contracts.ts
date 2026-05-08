/**
 * 工作流钩子系统契约。
 *
 * 钩子系统允许在工作流的关键时刻执行自定义检查。
 * 比如：阶段切换前检查文件是否符合格式、手递手后验证接收方是否能正常工作、
 * 任务完成前检查是否真的完成了。
 *
 * 为什么用钩子而不是直接在代码里调用？因为钩子是可插拔的——
 * 新增一个检查不需要修改核心代码。
 *
 * 核心概念：
 * - Hook Point: 钩子触发点（何时执行）
 * - Hook Type: 钩子类型（目前只有 file_audit）
 * - Blocking Mode: 失败时的后果（阻塞/警告/回滚）
 * - Verdict: 审计裁决（pass/revise/block）
 */

/**
 * 10 种钩子触发点，覆盖工作流的关键时刻。
 *
 * 按执行顺序排列：
 * 1. artifact_materialized — 产物物化后（最频繁的事件）
 * 2. before_prepare_handoff — 准备手递手前
 * 3. before_stage_handoff — 阶段手递手前
 * 4. before_handoff_delivery — 手递手投递前
 * 5. after_stage_handoff — 阶段手递手后
 * 6. before_task_complete — 任务完成前
 * 7. before_stage_complete — 阶段完成前
 * 8. before_handoff_activation — 手递手激活前
 * 9. after_handoff_activation — 手递手激活后
 */
export const WORKFLOW_HOOK_POINTS = [
  "artifact_materialized",
  "before_prepare_handoff",
  "before_stage_handoff",
  "before_handoff_delivery",
  "after_stage_handoff",
  "before_task_complete",
  "before_stage_complete",
  "before_handoff_activation",
  "after_handoff_activation",
] as const;

/** 钩子触发点类型 */
export type WorkflowHookPoint = (typeof WORKFLOW_HOOK_POINTS)[number];

/**
 * 钩子类型。目前只有 file_audit（文件审计）。
 *
 * 未来可扩展：custom_check（自定义检查）、notification（通知）等。
 */
export const WORKFLOW_HOOK_TYPES = ["file_audit"] as const;
export type WorkflowHookType = (typeof WORKFLOW_HOOK_TYPES)[number];

/**
 * 阻塞模式——审计失败时的后果。
 *
 * - block_stage: 阻塞阶段切换，必须修复后才能继续
 * - warn_only: 只记录警告，不阻塞（用于非关键检查）
 * - rollback_stage: 回滚阶段（最严厉，用于严重不一致）
 */
export const WORKFLOW_HOOK_BLOCKING_MODES = [
  "block_stage",
  "warn_only",
  "rollback_stage",
] as const;
export type WorkflowHookBlockingMode = (typeof WORKFLOW_HOOK_BLOCKING_MODES)[number];

/**
 * Gate disposition 把“是否阻塞”和“阻塞后怎么推进”分开。
 *
 * 旧的 blockingMode 仍然保留，用于向后兼容；新的 disposition 用于
 * auto-iterator / handoff 生成可执行 repair、debt 或 rollback 路由。
 */
export const WORKFLOW_GATE_DISPOSITIONS = [
  "hard_block",
  "repair_required",
  "defer_with_debt",
  "warn_only",
  "human_gate",
  "rollback_stage",
] as const;
export type WorkflowGateDisposition = (typeof WORKFLOW_GATE_DISPOSITIONS)[number];

export type WorkflowGateScope = {
  level: "claim" | "section" | "artifact" | "stage";
  targets: string[];
};

export type WorkflowGateRepairRoute = {
  owner: string | null;
  command: string | null;
  repairPacketPath: string | null;
  recheckHookId: string | null;
  rollbackStage: string | null;
  retryBudget: number | null;
};

export type WorkflowGateControlIssue = {
  hookId: string;
  disposition: WorkflowGateDisposition;
  scope: WorkflowGateScope;
  reason: string | null;
  severity: "low" | "medium" | "high" | "critical" | null;
  confidence: number | null;
  recoverable: boolean;
  repairRoute: WorkflowGateRepairRoute | null;
};

export type WorkflowGateControlPackage = {
  blocking: boolean;
  primaryDisposition: WorkflowGateDisposition | null;
  hardBlockCount: number;
  repairRequiredCount: number;
  deferredDebtCount: number;
  warnOnlyCount: number;
  humanGateCount: number;
  rollbackRequiredCount: number;
  issues: WorkflowGateControlIssue[];
  repairRoutes: WorkflowGateRepairRoute[];
};

/**
 * 文件审计裁决。
 *
 * - pass: 通过
 * - revise: 需要修改（触发修订分发）
 * - block: 阻塞（触发阻塞流程）
 */
export const WORKFLOW_FILE_AUDIT_VERDICTS = ["pass", "revise", "block"] as const;
export type WorkflowFileAuditVerdict = (typeof WORKFLOW_FILE_AUDIT_VERDICTS)[number];

/**
 * 工作流线。
 *
 * - experiment: 实验论文工作流
 * - survey: 综述论文工作流
 * - unknown: 无法确定（新项目或数据缺失时）
 */
export const WORKFLOW_LINES = ["experiment", "survey", "unknown"] as const;
export type WorkflowLine = (typeof WORKFLOW_LINES)[number];

/**
 * 论文模式。
 *
 * - conference: 会议论文（页数限制严格、格式要求高）
 * - journal: 期刊论文（篇幅较长、理论要求深）
 * - survey: 综述论文（覆盖度要求高）
 */
export const WORKFLOW_PAPER_MODES = ["conference", "journal", "survey"] as const;
export type WorkflowPaperMode = (typeof WORKFLOW_PAPER_MODES)[number];

/**
 * 文件审计违规记录。
 *
 * 记录违反了哪条规则、严重程度、位置和消息。
 */
export type WorkflowFileAuditViolation = {
  rule: string;
  severity: "low" | "medium" | "high" | "critical";
  location: string | null;
  message: string;
};

/**
 * 文件审计结果。
 *
 * 包含裁决（verdict）、违规列表、需要修复的项目列表、
 * 以及审计元信息（指纹、运行ID、创建时间等）。
 *
 * fileFingerprint 和 packetFingerprint 用于检测文件是否在审计后被修改——
 * 如果指纹变了，审计结果自动失效。
 */
export type WorkflowFileAuditResult = {
  verdict: WorkflowFileAuditVerdict;
  summary: string | null;
  violations: WorkflowFileAuditViolation[];
  requiredFixes: string[];
  reviewedArtifacts: string[];
  confidence: number | null;
  runId: string | null;
  rawText: string | null;
  reviewerRole: string;
  filePath: string;
  fileFingerprint: string | null;
  packetFingerprint: string | null;
  createdAt: string;
};

/**
 * 已物化的制品。
 *
 * contract 标识制品对应的契约（状态类型），
 * artifactPath 是物化后的文件路径，
 * fingerprint 用于检测变更，
 * action 标识是新建、更新还是协调。
 */
export type WorkflowMaterializedArtifact = {
  contract: string;
  artifactPath: string | null;
  fingerprint: string | null;
  action: "created" | "updated" | "reconciled";
  kind?: string | null;
};

/**
 * 钩子事件。
 *
 * 记录在某个 hookPoint 触发了什么事件。
 */
export type WorkflowHookEvent = {
  hookPoint: WorkflowHookPoint;
  contract: string | null;
  artifactPath: string | null;
};

/**
 * 钩子触发点上下文。
 *
 * 钩子执行时可访问的完整上下文——当前项目、阶段、角色、
 * 工作流线、已物化的制品列表、变更的文件路径等。
 *
 * 这使得钩子可以根据上下文做出精细的判断。
 */
export type WorkflowHookPointContext = {
  projectRoot: string;
  projectId: string | null;
  stage: string | null;
  hookPoint: WorkflowHookPoint;
  ownerRole: string | null;
  actorRole: string | null;
  targetRole: string | null;
  taskId: string | null;
  taskTitle: string | null;
  handoffIntentId: string | null;
  workflowLine: WorkflowLine;
  paperMode: WorkflowPaperMode | null;
  targetStage: string | null;
  transition: string | null;
  materializedArtifacts: WorkflowMaterializedArtifact[];
  emittedHookEvents: WorkflowHookEvent[];
  artifactKinds: string[];
  changedPaths: string[];
};

/**
 * 钩子过滤条件。
 *
 * 定义钩子对哪些场景生效——按工作流线、论文模式、
 * 目标角色、任务ID、文件 glob 等过滤。
 *
 * 这使得同一个钩子可以配置为只对特定场景生效。
 */
export type WorkflowHookFilters = {
  workflowLines?: WorkflowLine[];
  paperModes?: WorkflowPaperMode[];
  targetRoles?: string[];
  taskIds?: string[];
  taskPrefixes?: string[];
  fileGlobs?: string[];
  materializedContracts?: string[];
  changedPathsAny?: string[];
};

/**
 * 钩子适用条件。
 *
 * 定义钩子在哪些阶段、工作流线、论文模式下生效。
 */
export type WorkflowHookAppliesWhen = {
  workflowLines?: WorkflowLine[];
  paperModes?: WorkflowPaperMode[];
  stages?: string[];
};

/**
 * 文件审计钩子策略。
 *
 * 定义单个文件审计钩子的完整配置——在哪个 hookPoint 触发、
 * 审查哪个文件、谁负责审查、失败后如何处理。
 *
 * 关键设计：
 * - maxRounds / maxUnchangedRounds: 防止无限循环——文件没改就重试没意义
 * - stateScope: 状态隔离级别，决定钩子状态是否跨阶段共享
 * - filters / appliesWhen: 双重过滤，精确控制生效场景
 */
export type WorkflowFileAuditHookPolicy = {
  hookId: string;
  hookType: "file_audit";
  enabled: boolean;
  stage: string | null;
  hookPoint: WorkflowHookPoint;
  order: number;
  parallelGroup: string | null;
  targetRole: string | null;
  auditorRole: string;
  filePath: string;
  requirementPrompt: string;
  supportingArtifacts: string[];
  blockingMode: WorkflowHookBlockingMode;
  maxRounds: number;
  maxUnchangedRounds: number;
  reviseOwnerRole: string | null;
  reviseCommand: string | null;
  gateDisposition?: WorkflowGateDisposition | null;
  gateScope?: WorkflowGateScope | null;
  repairOwnerRole?: string | null;
  repairCommand?: string | null;
  rollbackStage?: string | null;
  recheckHookId?: string | null;
  retryBudget?: number | null;
  reportDir: string | null;
  filters: WorkflowHookFilters | null;
  appliesWhen: WorkflowHookAppliesWhen | null;
  stateScope: "isolated" | "shared_by_stage" | "shared_by_transition";
};

/**
 * 钩子策略集合。
 *
 * 顶层配置——enabled 全局开关 + auditHooks 列表。
 * 关闭 enabled 即可禁用所有钩子。
 */
export type WorkflowHooksPolicy = {
  enabled: boolean;
  auditHooks: WorkflowFileAuditHookPolicy[];
};

/** 钩子尝试状态：pending（执行中）、completed（完成）、error（出错） */
export type WorkflowHookAttemptStatus = "pending" | "completed" | "error";

/**
 * 钩子运行状态。
 *
 * - idle: 未开始
 * - auditing: 正在审计
 * - revise_requested: 已请求修订，等待修订完成
 * - passed: 通过
 * - failed: 失败（超过 maxRounds 或其他不可恢复错误）
 * - escalated: 已上报（人工介入）
 */
export type WorkflowHookRunStatus =
  | "idle"
  | "auditing"
  | "revise_requested"
  | "passed"
  | "failed"
  | "escalated";

/**
 * 审查者尝试记录。
 *
 * 记录一次审查会话的完整信息——谁审查的、结果如何、是否出错。
 * 泛型 T 是审查结果的类型（通常是 WorkflowFileAuditResult）。
 */
export type WorkflowHookReviewerAttempt<T> = {
  hookId: string;
  reviewerRole: string;
  sessionKey: string;
  runId: string | null;
  status: WorkflowHookAttemptStatus;
  launchedAt: string;
  completedAt: string | null;
  error: string | null;
  result: T | null;
};

/**
 * 文件审计轮次状态。
 *
 * 记录一轮审计的完整信息——输入文件、输出报告、
 * 指纹（用于检测变更）、执行结果。
 *
 * 指纹设计：fileFingerprint（文件内容）、packetFingerprint（审查包）、
 * executionFingerprint（执行环境）——三者任一变化都说明需要重新审计。
 */
export type WorkflowFileAuditRoundState = {
  roundId: string;
  status: WorkflowHookAttemptStatus;
  hookId: string;
  hookPoint: WorkflowHookPoint;
  stage: string | null;
  auditorRole: string;
  targetRole: string | null;
  filePath: string;
  fileFingerprint: string | null;
  packetFingerprint: string | null;
  executionFingerprint?: string | null;
  packetPath: string;
  packetJsonPath: string;
  reportPath: string;
  reportMarkdownPath: string;
  runId: string | null;
  sessionKey: string;
  launchedAt: string;
  completedAt: string | null;
  result: WorkflowFileAuditResult | null;
  error: string | null;
};

/**
 * 修订分发状态。
 *
 * 审计发现问题后，将修改请求分发给原文件的负责人。
 * 记录分发给谁、何时分发、修改包路径。
 */
export type WorkflowHookRevisionDispatchState = {
  runId: string | null;
  sessionKey: string | null;
  dispatchedAt: string;
  targetRole: string | null;
  aggregateRevisionPacketPath: string | null;
};

/**
 * 文件审计钩子状态。
 *
 * 单个钩子的运行时状态——当前轮次、历史指纹、
 * 裁决历史、是否上报、阻塞原因。
 *
 * 关键设计：
 * - lastPassedFingerprint / lastReviewedFingerprint: 记录最近一次通过和审查的指纹
 *   用于快速判断是否需要重新审计（指纹未变则跳过）
 * - consecutiveUnchangedRounds: 连续未变化轮数，超过 maxUnchangedRounds 自动终止
 * - lastRevisionDispatch: 最近一次修订分发，避免重复分发
 */
export type WorkflowFileAuditHookState = {
  hookId: string;
  stage: string | null;
  hookPoint: WorkflowHookPoint;
  status: WorkflowHookRunStatus;
  roundsStarted: number;
  activeRound: WorkflowFileAuditRoundState | null;
  lastPassedFingerprint: string | null;
  lastPassedPacketFingerprint: string | null;
  lastPassedExecutionFingerprint: string | null;
  lastReviewedFingerprint: string | null;
  lastReviewedPacketFingerprint: string | null;
  lastReviewedExecutionFingerprint: string | null;
  lastVerdict: WorkflowFileAuditVerdict | null;
  lastRevisionDispatch: WorkflowHookRevisionDispatchState | null;
  consecutiveUnchangedRounds: number;
  blockedReason: string | null;
  escalationReason: string | null;
  updatedAt: string;
};

/** 钩子点聚合裁决：pass（全部通过）、revise（有修订）、block（有阻塞）、null（无结果） */
export type WorkflowHookPointAggregateVerdict = "pass" | "revise" | "block" | null;

/**
 * 钩子点聚合状态。
 *
 * 同一 hookPoint 可能有多个钩子并行执行。
 * 聚合状态汇总所有钩子的结果——总体裁决、总体状态、修订包路径。
 */
export type WorkflowHookPointAggregateState = {
  aggregateStatus: WorkflowHookRunStatus;
  aggregateVerdict: WorkflowHookPointAggregateVerdict;
  aggregateRevisionPacketPath: string | null;
  gateControl: WorkflowGateControlPackage | null;
  updatedAt: string;
};

/**
 * 钩子状态存储。
 *
 * 持久化的钩子状态快照——schemaVersion 用于迁移、
 * hookPoints 存储聚合状态（按阶段和钩子点索引）、
 * hooks 存储单个钩子状态（按 hookId 索引）。
 */
export type WorkflowHooksStateStore = {
  schemaVersion: 1;
  updatedAt: string;
  hookPoints: Record<string, Record<string, WorkflowHookPointAggregateState>>;
  hooks: Record<string, WorkflowFileAuditHookState>;
};

/**
 * 单次钩子执行结果。
 *
 * 核心输出——verdict（裁决）、status（状态）、
 * 是否触发了修订/上报/阻塞。
 *
 * pending 表示需要等待修订完成后再重新执行，
 * launched 表示已成功启动审查会话。
 */
export type WorkflowHookExecutionResult = {
  hookId: string;
  hookPoint: WorkflowHookPoint;
  stage: string | null;
  verdict: WorkflowHookPointAggregateVerdict;
  status: WorkflowHookRunStatus;
  pending: boolean;
  launched: boolean;
  revisedRequested: boolean;
  escalated: boolean;
  fileFingerprint: string | null;
  result: WorkflowFileAuditResult | null;
  revisionDispatch: WorkflowHookRevisionDispatchState | null;
  blockingReason: string | null;
  gateDisposition?: WorkflowGateDisposition | null;
  gateScope?: WorkflowGateScope | null;
  repairRoute?: WorkflowGateRepairRoute | null;
};

/**
 * 钩子点执行摘要。
 *
 * 汇总同一 hookPoint 下所有钩子的执行结果——
 * 聚合裁决、聚合状态、各钩子详情、阻塞原因、修订包路径。
 * 用于向用户/上游系统报告钩子执行概况。
 */
export type WorkflowHookPointExecutionSummary = {
  hookPoint: WorkflowHookPoint;
  stage: string | null;
  aggregateVerdict: WorkflowHookPointAggregateVerdict;
  aggregateStatus: WorkflowHookRunStatus;
  hooksRun: WorkflowHookExecutionResult[];
  blockingReason: string | null;
  aggregateRevisionPacketPath: string | null;
  gateControl: WorkflowGateControlPackage;
};
