import {
  STAGE_REQUIREMENTS,
  type WorkflowRole,
  normalizeWorkflowRole,
} from "../workflow-guard-policies/role-policy";

export type WorkflowStageLine = "experiment" | "survey";
export type WorkflowTeamRuntimePolicy = "disabled" | "pilot" | "enabled";

export type WorkflowStageDefinition = {
  stage: string;
  owner: WorkflowRole;
  nextStage: string | null;
  line: WorkflowStageLine;
  teamRuntimePolicy: WorkflowTeamRuntimePolicy;
};

const SURVEY_STAGES = new Set(["survey_review"]);
const TEAM_RUNTIME_PILOT_STAGES = new Set(["experiment", "analyze", "review"]);
const TEAM_RUNTIME_ENABLED_STAGES = new Set(["write", "submit"]);

export function listWorkflowStageDefinitions(): WorkflowStageDefinition[] {
  return Object.entries(STAGE_REQUIREMENTS).map(([stage, requirement]) =>
    buildWorkflowStageDefinition(stage, requirement.owner, requirement.nextStage)
  );
}

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

export function supportsWorkflowTeamRuntime(stage: string | null | undefined): boolean {
  const definition = getWorkflowStageDefinition(stage);
  return Boolean(
    definition &&
      (definition.teamRuntimePolicy === "pilot" ||
        definition.teamRuntimePolicy === "enabled")
  );
}

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
