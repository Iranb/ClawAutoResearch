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
];
/**
 * 钩子类型。目前只有 file_audit（文件审计）。
 *
 * 未来可扩展：custom_check（自定义检查）、notification（通知）等。
 */
export const WORKFLOW_HOOK_TYPES = ["file_audit"];
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
];
/**
 * 文件审计裁决。
 *
 * - pass: 通过
 * - revise: 需要修改（触发修订分发）
 * - block: 阻塞（触发阻塞流程）
 */
export const WORKFLOW_FILE_AUDIT_VERDICTS = ["pass", "revise", "block"];
/**
 * 工作流线。
 *
 * - experiment: 实验论文工作流
 * - survey: 综述论文工作流
 * - unknown: 无法确定（新项目或数据缺失时）
 */
export const WORKFLOW_LINES = ["experiment", "survey", "unknown"];
/**
 * 论文模式。
 *
 * - conference: 会议论文（页数限制严格、格式要求高）
 * - journal: 期刊论文（篇幅较长、理论要求深）
 * - survey: 综述论文（覆盖度要求高）
 */
export const WORKFLOW_PAPER_MODES = ["conference", "journal", "survey"];
