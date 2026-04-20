/**
 * 阶段注册表。
 *
 * 内核是最小但必须独立的核心逻辑。阶段注册表定义了系统的阶段流水线——
 * 哪些阶段存在、谁负责、下一个是什么、属于哪条工作流线。
 *
 * 与 role-policy.ts 的 STAGE_REQUIREMENTS 的关系：
 * - STAGE_REQUIREMENTS 是原始数据（owner + nextStage）
 * - stage-registry 将其扩展为完整的阶段定义（增加 line 和 teamRuntimePolicy）
 *
 * 这种分离使得阶段路由表（role-policy）和阶段运行时行为（stage-registry）可以独立演进。
 */
import {
  STAGE_REQUIREMENTS,
  type WorkflowRole,
  normalizeWorkflowRole,
} from "../workflow-guard-policies/role-policy";

/**
 * 工作流线。
 * - experiment: 实验论文工作流（从 setup 到 done，经过 ideation → experiment → writing）
 * - survey: 综述论文工作流（从 survey_review 到 write，跳过实验阶段）
 */
export type WorkflowStageLine = "experiment" | "survey";

/**
 * 团队运行策略。
 * - disabled: 不支持团队协作，单 Agent 运行
 * - pilot: 试点阶段，支持有限团队协作
 * - enabled: 完整支持团队协作，多 Agent 并行
 */
export type WorkflowTeamRuntimePolicy = "disabled" | "pilot" | "enabled";

/**
 * 完整的阶段定义。
 *
 * 比 STAGE_REQUIREMENTS 多了两个运行时字段：
 * - line: 区分实验线和综述线
 * - teamRuntimePolicy: 定义团队协作级别
 */
export type WorkflowStageDefinition = {
  stage: string;
  owner: WorkflowRole;
  nextStage: string | null;
  line: WorkflowStageLine;
  teamRuntimePolicy: WorkflowTeamRuntimePolicy;
};

/**
 * 综述工作流专用阶段。
 */
const SURVEY_STAGES = new Set(["survey_review"]);

/**
 * 试点团队协作阶段。
 * 实验、分析、审查阶段支持有限的团队协作。
 */
const TEAM_RUNTIME_PILOT_STAGES = new Set(["experiment", "analyze", "review"]);

/**
 * 完整团队协作阶段。
 * 写作和提交阶段需要完整团队协作（Writer + Reviewer 并行）。
 */
const TEAM_RUNTIME_ENABLED_STAGES = new Set(["write", "submit"]);

/**
 * 列出所有阶段定义。
 *
 * 将 STAGE_REQUIREMENTS 的原始数据扩展为完整的阶段定义。
 *
 * @returns 所有阶段的定义列表
 */
export function listWorkflowStageDefinitions(): WorkflowStageDefinition[] {
  return Object.entries(STAGE_REQUIREMENTS).map(([stage, requirement]) =>
    buildWorkflowStageDefinition(stage, requirement.owner, requirement.nextStage)
  );
}

/**
 * 获取特定阶段的定义。
 *
 * @param stage 阶段名称
 * @returns 阶段定义，或 null（阶段不存在时）
 */
export function getWorkflowStageDefinition(
  stage: string | null | undefined
): WorkflowStageDefinition | null {
  const normalized = typeof stage === "string" && stage.trim() ? stage.trim() : null;
  if (!normalized) {
    return null;
  }
  const requirement = STAGE_REQUIREMENTS[normalized];
  if (!requirement) {
    return null;
  }
  return buildWorkflowStageDefinition(normalized, requirement.owner, requirement.nextStage);
}

/**
 * 解析阶段负责人角色。
 *
 * 优先使用显式指定的 ownerAgent，如果未指定则从阶段定义中获取默认 owner。
 *
 * @param params.stage 阶段名称
 * @param params.ownerAgent 显式指定的负责人 Agent
 * @returns 阶段负责人角色，或 null
 */
export function resolveWorkflowStageLeadRole(params: {
  stage: string | null | undefined;
  ownerAgent?: string | null;
}): WorkflowRole | null {
  const explicitOwner = normalizeWorkflowRole(params.ownerAgent ?? null);
  if (explicitOwner) {
    return explicitOwner;
  }
  return getWorkflowStageDefinition(params.stage)?.owner ?? null;
}

/**
 * 检查阶段是否支持团队运行。
 *
 * pilot 和 enabled 阶段支持团队协作，disabled 不支持。
 *
 * @param stage 阶段名称
 * @returns 是否支持团队运行
 */
export function supportsWorkflowTeamRuntime(stage: string | null | undefined): boolean {
  const definition = getWorkflowStageDefinition(stage);
  return Boolean(
    definition &&
      (definition.teamRuntimePolicy === "pilot" ||
        definition.teamRuntimePolicy === "enabled")
  );
}

/**
 * 构建完整的阶段定义。
 *
 * 从原始的 owner + nextStage 扩展为包含 line 和 teamRuntimePolicy 的完整定义。
 *
 * @param stage 阶段名称
 * @param owner 负责人角色
 * @param nextStage 下一阶段
 * @returns 完整的阶段定义
 */
function buildWorkflowStageDefinition(
  stage: string,
  owner: WorkflowRole,
  nextStage: string | null
): WorkflowStageDefinition {
  return {
    stage,
    owner,
    nextStage,
    line: SURVEY_STAGES.has(stage) ? "survey" : "experiment",
    teamRuntimePolicy: TEAM_RUNTIME_PILOT_STAGES.has(stage)
      ? "pilot"
      : TEAM_RUNTIME_ENABLED_STAGES.has(stage)
        ? "enabled"
        : "disabled",
  };
}
