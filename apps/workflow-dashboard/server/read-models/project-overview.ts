import path from "node:path";

import { WORKFLOW_STAGES, getWorkflowStageIndex } from "../constants/workflow-stages.js";
import { discoverProjects } from "../file-access/project-discovery.js";
import { readJsonFile } from "../file-access/fs.js";
import { toBlockerLabel } from "../utils/blocker-label.js";

type ProjectsStateEntry = {
  id?: string | null;
  title?: string | null;
  stage?: string | null;
  next_action?: string | null;
  blocked_by?: string | null;
  updated?: string | null;
};

type ProjectsStateFile = {
  projects?: ProjectsStateEntry[] | null;
};

type ManifestFile = {
  project_id?: string | null;
  title?: string | null;
  current_stage?: string | null;
  next_action?: string | null;
  blocking_reason?: string | null;
  updated_at?: string | null;
  survey_review?: {
    status?: string | null;
  } | null;
  writing_contract?: {
    paper_mode?: string | null;
    paperMode?: string | null;
  } | null;
};

type PapernexusProgressFile = {
  next_action?: string | null;
  blocking_reason?: string | null;
  updated_at?: string | null;
};

export type ProjectOverview = {
  id: string;
  title: string | null;
  projectRoot: string;
  currentStage: string | null;
  currentStageIndex: number | null;
  workflowLine: "experiment" | "survey";
  paperMode: string | null;
  surveyStatus: string | null;
  status: "blocked" | "active" | "ready" | "incomplete";
  blockerLabel: string | null;
  blockerReason: string | null;
  nextAction: string | null;
  updatedAt: string | null;
  source: "projects_state" | "manifest_fallback";
};

export async function readProjectOverviews(params: {
  projectsRoot: string;
}): Promise<ProjectOverview[]> {
  const projectsState = await readJsonFile<ProjectsStateFile>(
    path.join(params.projectsRoot, "PROJECTS_STATE.json"),
  );
  const stateEntries = new Map<string, ProjectsStateEntry>();

  for (const entry of projectsState?.projects ?? []) {
    const id = asString(entry?.id);

    if (id) {
      stateEntries.set(id, entry);
    }
  }

  const discoveredProjects = await discoverProjects(params.projectsRoot);

  return Promise.all(
    discoveredProjects.map(async (project) => {
      const manifest = await readJsonFile<ManifestFile>(
        path.join(project.projectRoot, "PROJECT_MANIFEST.json"),
      );
      const progress = await readJsonFile<PapernexusProgressFile>(
        path.join(project.projectRoot, "graph", "PAPERNEXUS_PROGRESS.json"),
      );
      const stateEntry = stateEntries.get(project.id);
      const currentStage =
        asString(stateEntry?.stage) ??
        asString(manifest?.current_stage);
      const paperMode = getPaperMode(manifest?.writing_contract);
      const surveyStatus = asString(manifest?.survey_review?.status);
      const blockerReason =
        asString(stateEntry?.blocked_by) ??
        asString(manifest?.blocking_reason) ??
        asString(progress?.blocking_reason);
      const nextAction =
        asString(stateEntry?.next_action) ??
        asString(manifest?.next_action) ??
        asString(progress?.next_action);

      return {
        id: project.id,
        title:
          asString(stateEntry?.title) ??
          asString(manifest?.title) ??
          asString(manifest?.project_id) ??
          null,
        projectRoot: project.projectRoot,
        currentStage,
        currentStageIndex: getWorkflowStageIndex(currentStage),
        workflowLine: deriveWorkflowLine({
          currentStage,
          paperMode,
          surveyStatus,
        }),
        paperMode,
        surveyStatus,
        status: deriveStatus({ currentStage, blockerReason, nextAction }),
        blockerLabel: toBlockerLabel(blockerReason),
        blockerReason,
        nextAction,
        updatedAt:
          asString(stateEntry?.updated) ??
          asString(manifest?.updated_at) ??
          asString(progress?.updated_at),
        source: project.source,
      } satisfies ProjectOverview;
    }),
  );
}

function deriveWorkflowLine(params: {
  currentStage: string | null;
  paperMode: string | null;
  surveyStatus: string | null;
}): ProjectOverview["workflowLine"] {
  if (
    params.currentStage === "survey_review" ||
    params.paperMode === "survey" ||
    (params.surveyStatus !== null && params.surveyStatus !== "missing")
  ) {
    return "survey";
  }

  return "experiment";
}

function getPaperMode(value: ManifestFile["writing_contract"]): string | null {
  return asString(value?.paper_mode) ?? asString(value?.paperMode);
}

function deriveStatus(params: {
  currentStage: string | null;
  blockerReason: string | null;
  nextAction: string | null;
}): ProjectOverview["status"] {
  if (params.blockerReason) {
    return "blocked";
  }

  if (getWorkflowStageIndex(params.currentStage) === null) {
    return "incomplete";
  }

  if (params.currentStage === "submit" || !params.nextAction) {
    return "ready";
  }

  return "active";
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
