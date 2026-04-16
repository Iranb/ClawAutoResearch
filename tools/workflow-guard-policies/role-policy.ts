/**
 * 角色策略定义。
 *
 * 定义 8 种 Agent 角色的权限、可接触的目录/文件、可联系的其他角色、
 * 以及每个阶段的负责人和下一阶段。
 *
 * 将策略与代码分离的原因：策略规则经常变化（新的门禁条件、新的角色权限），
 * 将它们从主逻辑中分离出来，使得策略变更不需要修改核心代码。
 */
import { normalizeStage, asString } from "../workflow-guard-core/coercion";

/**
 * 8 种工作流角色，覆盖科研全流程：
 * - researcher: 调研、创意生成、实验规划
 * - planner: 实验设计、搜索策略规划
 * - orchestrator: 流程编排、资源协调
 * - coder: 实验实现、代码修改
 * - analyzer: 结果分析
 * - academic_writer: 论文撰写
 * - reviewer: 论文审查
 * - cross-reviewer: 独立交叉审查
 */
export type WorkflowRole =
  | "researcher"
  | "planner"
  | "orchestrator"
  | "coder"
  | "analyzer"
  | "academic_writer"
  | "reviewer"
  | "cross-reviewer";

/**
 * 角色策略。
 *
 * 定义每个角色的权限边界：
 * - allowedContacts: 可以直接联系的其他角色
 * - allowedSpawns: 可以创建的子 Agent 角色
 * - allowedProjectDirs/Files: 可以读写的目录和文件
 * - writeScopeLabels: 写入范围的标签化描述
 * - backgroundTasks: 空闲时可执行的后台任务
 */
export interface RolePolicy {
  allowedContacts: WorkflowRole[];
  allowedSpawns: WorkflowRole[];
  allowedProjectDirs: string[];
  allowedProjectFiles: string[];
  allowProjectsStateWrite: boolean;
  writeScopeLabels: string[];
  backgroundTasks: string[];
}

/**
 * 阶段需求。
 *
 * 定义每个阶段的负责人和下一阶段。
 * 这是阶段流水线的 "路由表"——修改流水线只需要改这个对象。
 */
export interface StageRequirement {
  owner: WorkflowRole;
  nextStage: string | null;
}

/**
 * 角色优先级顺序。
 *
 * 用于角色消歧——当输入模糊匹配多个角色时，靠前的优先。
 */
export const WORKFLOW_ROLE_ORDER: WorkflowRole[] = [
  "researcher",
  "planner",
  "orchestrator",
  "coder",
  "analyzer",
  "academic_writer",
  "reviewer",
  "cross-reviewer",
];

/**
 * 各角色策略配置。
 *
 * 关键设计：
 * - Researcher 是唯一可以联系所有角色的角色（协调整个流程）
 * - Cross-reviewer 是最受限的角色——不能联系任何人、不能写任何文件
 *   这是为了防止交叉审查受到外部信息影响，保持审查的独立性
 * - 每个角色的 writeScopeLabels 定义了可以写入的具体路径范围
 * - backgroundTasks 定义了角色空闲时可以做的有价值的事
 */
export const ROLE_POLICIES: Record<WorkflowRole, RolePolicy> = {
  researcher: {
    allowedContacts: [
      "planner",
      "orchestrator",
      "coder",
      "analyzer",
      "academic_writer",
      "reviewer",
      "cross-reviewer",
    ],
    allowedSpawns: [
      "planner",
      "orchestrator",
      "coder",
      "analyzer",
      "academic_writer",
      "reviewer",
      "cross-reviewer",
    ],
    allowedProjectDirs: ["researcher", "graph", "memory", "reviewer", "cross-reviewer"],
    allowedProjectFiles: [
      "PROJECT_MANIFEST.json",
      "TRACK_REGISTRY.json",
      "CLAIM_POLICY.md",
      "README.md",
    ],
    allowProjectsStateWrite: true,
    writeScopeLabels: [
      "{PROJ}/PROJECT_MANIFEST.json",
      "{PROJ}/TRACK_REGISTRY.json",
      "{PROJ}/CLAIM_POLICY.md",
      "{PROJ}/README.md",
      "{PROJ}/researcher/",
      "{PROJ}/graph/",
      "{PROJ}/memory/",
      "{PROJ}/reviewer/",
      "{PROJ}/cross-reviewer/",
      "{PROJECTS_ROOT}/PROJECTS_STATE.json",
    ],
    backgroundTasks: [
      "Continue literature survey and venue sweeps with /research-lit or /broad-paper-search; keep /papers-cool as the guaranteed baseline and use /pasa-paper-search as an optional second retrieval source when it is responsive.",
      "Acquire full text for key papers: once a paper identity is confirmed, call hugging-face-paper-pages first for arXiv papers, then arxiv2md-api, then markxiv, then arxiv2md, and use PDF fallback only if all Markdown sources are unavailable. Preserve metadata-only canonical entries for important unresolved papers and record source_provider / retrieval_providers in PAPER_SOURCE_INDEX.json.",
      "Refresh PaperNexus when newly ingested papers may change novelty, baselines, or closest prior work.",
      "Keep reasoning packets and manifest next_action/resume_action current.",
    ],
  },
  planner: {
    allowedContacts: ["researcher"],
    allowedSpawns: [],
    allowedProjectDirs: ["planner"],
    allowedProjectFiles: ["orchestrator/TODOS.md", "PROJECT_MANIFEST.json", "TRACK_REGISTRY.json"],
    allowProjectsStateWrite: false,
    writeScopeLabels: [
      "{PROJ}/planner/",
      "{PROJ}/orchestrator/TODOS.md (append-only)",
      "{PROJ}/PROJECT_MANIFEST.json via workflow tools only",
      "{PROJ}/TRACK_REGISTRY.json via workflow tools only",
    ],
    backgroundTasks: [
      "Tighten the experiment packet, claim-to-experiment alignment, and stop rules in {PROJ}/planner/.",
      "Keep compute estimates and falsifier coverage explicit before any launch request reaches Coder.",
    ],
  },
  orchestrator: {
    allowedContacts: ["researcher"],
    allowedSpawns: [],
    allowedProjectDirs: ["orchestrator"],
    allowedProjectFiles: [],
    allowProjectsStateWrite: false,
    writeScopeLabels: ["{PROJ}/orchestrator/"],
    backgroundTasks: [
      "Tighten compute estimates, ablation coverage, and rollback rules under {PROJ}/orchestrator/.",
      "Refine risk registers and blocked-task notes without changing active tracks.",
    ],
  },
  coder: {
    allowedContacts: ["researcher"],
    allowedSpawns: [],
    allowedProjectDirs: ["coder"],
    allowedProjectFiles: ["orchestrator/TODOS.md"],
    allowProjectsStateWrite: false,
    writeScopeLabels: [
      "{PROJ}/coder/",
      "{PROJ}/orchestrator/TODOS.md (append-only)",
      "Datasets are read-only inputs for Coder. Never mutate /data/datasets/ or project dataset roots.",
    ],
    backgroundTasks: [
      "Strengthen smoke tests, reproducibility notes, and launch scripts inside {PROJ}/coder/.",
      "Keep experiment bundles legible: one folder per experiment, one manifest per bundle, and a top-level coder/EXPERIMENT_INDEX.md mapping folders to tracks and questions.",
      "Treat dataset roots as read-only. Put derived caches, converted shards, and temporary files under {PROJ}/coder/ or remote scratch/results, not back into datasets/.",
      "Do not launch unassigned experiments or broaden scope on your own.",
    ],
  },
  analyzer: {
    allowedContacts: ["researcher"],
    allowedSpawns: [],
    allowedProjectDirs: ["analyzer"],
    allowedProjectFiles: ["orchestrator/TODOS.md"],
    allowProjectsStateWrite: false,
    writeScopeLabels: ["{PROJ}/analyzer/", "{PROJ}/orchestrator/TODOS.md (append-only)"],
    backgroundTasks: [
      "Prepare figure/table skeletons and claim-evidence extraction stubs in {PROJ}/analyzer/.",
      "Compare partial results against the latest synthesis packet before promoting claims.",
    ],
  },
  academic_writer: {
    allowedContacts: ["researcher", "cross-reviewer"],
    allowedSpawns: [],
    allowedProjectDirs: ["academic_writer"],
    allowedProjectFiles: ["orchestrator/TODOS.md"],
    allowProjectsStateWrite: false,
    writeScopeLabels: [
      "{PROJ}/academic_writer/",
      "{PROJ}/orchestrator/TODOS.md (append-only)",
    ],
    backgroundTasks: [
      "Tighten KG-grounded outline structure, citation queues, and conservative wording in {PROJ}/academic_writer/.",
      "Keep WRITING_SIGNALS.md current and do not invent unsupported claims.",
      "Respect the configured writing template and run paragraph-logic checks before finalizing prose.",
    ],
  },
  reviewer: {
    allowedContacts: ["researcher"],
    allowedSpawns: [],
    allowedProjectDirs: ["reviewer"],
    allowedProjectFiles: [],
    allowProjectsStateWrite: false,
    writeScopeLabels: ["{PROJ}/reviewer/"],
    backgroundTasks: [
      "Maintain isolated review rubrics and general review heuristics.",
      "Do not browse hidden project context without an explicit review packet.",
    ],
  },
  "cross-reviewer": {
    allowedContacts: [],
    allowedSpawns: [],
    allowedProjectDirs: [],
    allowedProjectFiles: [],
    allowProjectsStateWrite: false,
    writeScopeLabels: ["No project writes; respond with review text only."],
    backgroundTasks: ["No proactive background duties. Stay stateless until explicitly invoked."],
  },
};

/**
 * 阶段路由表。
 *
 * 定义每个阶段的负责人（owner）和下一阶段（nextStage）。
 * 修改流水线只需要修改这个对象。
 *
 * 流水线顺序:
 * setup → graph_build → frontier_mapping → idea → plan → code → experiment → analyze → review → write → submit → done
 * survey_review → write（综述工作流跳过实验阶段）
 * revise → write（修订阶段）
 */
export const STAGE_REQUIREMENTS: Record<string, StageRequirement> = {
  setup: { owner: "researcher", nextStage: "graph_build" },
  survey_review: { owner: "researcher", nextStage: "write" },
  graph_build: { owner: "researcher", nextStage: "frontier_mapping" },
  frontier_mapping: { owner: "researcher", nextStage: "idea" },
  idea: { owner: "researcher", nextStage: "plan" },
  plan: { owner: "orchestrator", nextStage: "code" },
  code: { owner: "coder", nextStage: "experiment" },
  experiment: { owner: "researcher", nextStage: "analyze" },
  analyze: { owner: "analyzer", nextStage: "review" },
  review: { owner: "reviewer", nextStage: "write" },
  write: { owner: "academic_writer", nextStage: "submit" },
  submit: { owner: "reviewer", nextStage: "done" },
  revise: { owner: "researcher", nextStage: "write" },
  done: { owner: "researcher", nextStage: "done" },
};

/**
 * 自动生成的前一阶段映射。
 *
 * 从 STAGE_REQUIREMENTS 反向推导——当需要知道 "从哪个阶段来的" 时使用。
 */
const PREVIOUS_STAGE: Record<string, string> = Object.entries(STAGE_REQUIREMENTS).reduce(
  (acc, [stage, requirement]) => {
    if (requirement.nextStage && requirement.nextStage !== stage && !(requirement.nextStage in acc)) {
      acc[requirement.nextStage] = stage;
    }
    return acc;
  },
  {} as Record<string, string>
);

/**
 * 标准化角色名称。
 *
 * 兼容多种输入格式：
 * - "cross_reviewer" / "cross-reviewer" → "cross-reviewer"
 * - "academic_writer" / "academic-writer" / "writer" → "academic_writer"
 * - "planner" / "planning" → "planner"
 *
 * 因为角色名称可能来自不同来源（用户输入、配置文件、其他系统），
 * 格式不统一，需要模糊匹配。
 *
 * @param value 原始角色名称
 * @returns 标准化的角色名称，或 null
 */
export function normalizeWorkflowRole(value: string | null | undefined): WorkflowRole | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized.includes("cross-reviewer") || normalized.includes("cross_reviewer")) {
    return "cross-reviewer";
  }
  if (
    normalized.includes("academic_writer") ||
    normalized.includes("academic-writer") ||
    normalized === "writer"
  ) {
    return "academic_writer";
  }
  if (normalized.includes("planner")) {
    return "planner";
  }
  return WORKFLOW_ROLE_ORDER.find((role) => normalized.includes(role)) ?? null;
}

/**
 * 检查一个角色是否可以联系另一个角色。
 *
 * 用于权限控制——防止角色越权通信。
 *
 * @param fromRole 发起方角色
 * @param toRole 目标角色
 * @returns 是否允许联系
 */
export function canRoleContact(
  fromRole: WorkflowRole | null,
  toRole: WorkflowRole | null
): boolean {
  if (!fromRole || !toRole) {
    return false;
  }
  return ROLE_POLICIES[fromRole].allowedContacts.includes(toRole);
}

/**
 * 检查一个角色是否可以创建另一个角色的子 Agent。
 *
 * 只有 Researcher 可以创建子 Agent，其他角色不可以。
 *
 * @param fromRole 发起方角色
 * @param toRole 目标角色
 * @returns 是否允许创建
 */
export function canRoleSpawn(
  fromRole: WorkflowRole | null,
  toRole: WorkflowRole | null
): boolean {
  if (!fromRole || !toRole) {
    return false;
  }
  return ROLE_POLICIES[fromRole].allowedSpawns.includes(toRole);
}

/**
 * 获取当前阶段的下一阶段负责人角色。
 *
 * 例如：当前阶段是 "experiment"，下一阶段是 "analyze"，负责人是 "analyzer"。
 *
 * @param currentStage 当前阶段
 * @returns 下一阶段负责人角色，或 null
 */
export function getForwardStageHandoffTargetRole(
  currentStage: string | null
): WorkflowRole | null {
  const normalizedStage = normalizeStage(currentStage);
  if (!normalizedStage) {
    return null;
  }
  const currentRequirement = STAGE_REQUIREMENTS[normalizedStage];
  const nextStage = currentRequirement?.nextStage ?? null;
  if (!nextStage || nextStage === normalizedStage) {
    return null;
  }
  return STAGE_REQUIREMENTS[nextStage]?.owner ?? null;
}

/**
 * 检查是否可以使用阶段前向手递手。
 *
 * 条件：当前角色是当前阶段的负责人，目标角色是下一阶段的负责人。
 *
 * @param params.fromRole 当前角色
 * @param params.toRole 目标角色
 * @param params.currentStage 当前阶段
 * @returns 是否允许
 */
export function canRoleUseForwardStageHandoff(params: {
  fromRole: WorkflowRole | null;
  toRole: WorkflowRole | null;
  currentStage: string | null | undefined;
}): boolean {
  const normalizedStage = normalizeStage(params.currentStage ?? null);
  if (!normalizedStage || !params.fromRole || !params.toRole) {
    return false;
  }
  const currentRequirement = STAGE_REQUIREMENTS[normalizedStage];
  if (!currentRequirement || currentRequirement.owner !== params.fromRole) {
    return false;
  }
  return getForwardStageHandoffTargetRole(normalizedStage) === params.toRole;
}

/**
 * 检查角色间是否可以联系（考虑当前阶段上下文）。
 *
 * 两种情况允许联系：
 * 1. 角色策略允许直接联系
 * 2. 是合法的阶段前向手递手
 *
 * @param params 联系参数
 * @returns 是否允许
 */
export function canRoleContactInWorkflow(params: {
  fromRole: WorkflowRole | null;
  toRole: WorkflowRole | null;
  currentStage: string | null | undefined;
}): boolean {
  return (
    canRoleContact(params.fromRole, params.toRole) ||
    canRoleUseForwardStageHandoff(params)
  );
}

/**
 * 检查角色间是否可以创建子 Agent（考虑当前阶段上下文）。
 *
 * 两种情况允许创建：
 * 1. 角色策略允许创建
 * 2. 是合法的阶段前向手递手
 *
 * @param params 创建参数
 * @returns 是否允许
 */
export function canRoleSpawnInWorkflow(params: {
  fromRole: WorkflowRole | null;
  toRole: WorkflowRole | null;
  currentStage: string | null | undefined;
}): boolean {
  return canRoleSpawn(params.fromRole, params.toRole) || canRoleUseForwardStageHandoff(params);
}

/**
 * 从工具调用参数中推断目标角色。
 *
 * 尝试从多个字段名中提取角色信息（agentId / label / sessionKey），
 * 兼容不同的调用方格式。
 *
 * @param params 工具调用参数
 * @returns 推断的目标角色，或 null
 */
export function inferTargetRoleFromToolParams(
  params: Record<string, unknown>
): WorkflowRole | null {
  return (
    normalizeWorkflowRole(asString(params.agentId)) ??
    normalizeWorkflowRole(asString(params.label)) ??
    normalizeWorkflowRole(asString(params.sessionKey))
  );
}
