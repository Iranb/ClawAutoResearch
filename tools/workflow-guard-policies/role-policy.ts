import { normalizeStage, asString } from "../workflow-guard-core/coercion";

export type WorkflowRole =
  | "researcher"
  | "planner"
  | "orchestrator"
  | "coder"
  | "analyzer"
  | "academic_writer"
  | "reviewer"
  | "cross-reviewer";

export interface RolePolicy {
  allowedContacts: WorkflowRole[];
  allowedSpawns: WorkflowRole[];
  allowedProjectDirs: string[];
  allowedProjectFiles: string[];
  allowProjectsStateWrite: boolean;
  writeScopeLabels: string[];
  backgroundTasks: string[];
}

export interface StageRequirement {
  owner: WorkflowRole;
  nextStage: string | null;
}

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
      "Continue literature survey and venue sweeps with /research-lit or /papers-cool; if PASA is responsive, use /pasa-paper-search as a second retrieval source and merge by canonical identity.",
      "Acquire full text for key papers: once a paper identity is confirmed, call hugging-face-paper-pages first, then arxiv2md-api for arXiv papers, then arxiv2md as the legacy webpage fallback, and use papers-cool PDF fallback only if all Markdown sources are unavailable. Record source_provider and retrieval_providers in PAPER_SOURCE_INDEX.json.",
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

export const STAGE_REQUIREMENTS: Record<string, StageRequirement> = {
  setup: { owner: "researcher", nextStage: "graph_build" },
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

const PREVIOUS_STAGE: Record<string, string> = Object.entries(STAGE_REQUIREMENTS).reduce(
  (acc, [stage, requirement]) => {
    if (requirement.nextStage && requirement.nextStage !== stage && !(requirement.nextStage in acc)) {
      acc[requirement.nextStage] = stage;
    }
    return acc;
  },
  {} as Record<string, string>
);

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

export function canRoleContact(
  fromRole: WorkflowRole | null,
  toRole: WorkflowRole | null
): boolean {
  if (!fromRole || !toRole) {
    return false;
  }
  return ROLE_POLICIES[fromRole].allowedContacts.includes(toRole);
}

export function canRoleSpawn(
  fromRole: WorkflowRole | null,
  toRole: WorkflowRole | null
): boolean {
  if (!fromRole || !toRole) {
    return false;
  }
  return ROLE_POLICIES[fromRole].allowedSpawns.includes(toRole);
}

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

export function canRoleSpawnInWorkflow(params: {
  fromRole: WorkflowRole | null;
  toRole: WorkflowRole | null;
  currentStage: string | null | undefined;
}): boolean {
  return canRoleSpawn(params.fromRole, params.toRole) || canRoleUseForwardStageHandoff(params);
}

export function inferTargetRoleFromToolParams(
  params: Record<string, unknown>
): WorkflowRole | null {
  return (
    normalizeWorkflowRole(asString(params.agentId)) ??
    normalizeWorkflowRole(asString(params.label)) ??
    normalizeWorkflowRole(asString(params.sessionKey))
  );
}
