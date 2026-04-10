import path from "node:path";

import { getWorkflowStageIndex } from "../constants/workflow-stages.js";
import { readJsonFile } from "../file-access/fs.js";
import { resolveExistingProjectRoot } from "../file-access/project-root.js";

type ManifestFile = {
  project_id?: string | null;
  title?: string | null;
  current_stage?: string | null;
  owner_agent?: string | null;
  updated_at?: string | null;
  blocking_reason?: string | null;
  next_action?: string | null;
  resume_action?: string | null;
  survey_review?: {
    status?: string | null;
    topic?: string | null;
    candidate_paper_count?: number | null;
    included_paper_count?: number | null;
    excluded_paper_count?: number | null;
    graph_grounded_brief_ready?: boolean | null;
  } | null;
  writing_contract?: {
    paper_mode?: string | null;
    paperMode?: string | null;
  } | null;
};

type PapernexusProgressFile = {
  phase?: string | null;
  progress?: {
    total?: number | null;
    completed?: number | null;
    remaining?: number | null;
  } | null;
};

export type ProjectDetailSummary = {
  id: string;
  title: string | null;
  projectRoot: string;
  currentStage: string | null;
  workflowLine: "experiment" | "survey";
  paperMode: string | null;
  owner: string | null;
  status: "blocked" | "active" | "ready" | "incomplete";
  updatedAt: string | null;
  blockingReason: string | null;
  nextAction: string | null;
  resumeAction: string | null;
  surveyStatus: string | null;
  surveyTopic: string | null;
  surveyProgressSummary: string | null;
  papernexusPhase: string | null;
  papernexusProgressSummary: string | null;
  source: Array<"manifest" | "papernexus_progress" | "fallback">;
};

export async function readProjectDetailSummary(params: {
  projectsRoot: string;
  projectId: string;
}): Promise<ProjectDetailSummary | null> {
  const projectRoot = await resolveExistingProjectRoot({
    projectsRoot: params.projectsRoot,
    projectId: params.projectId,
  });

  if (!projectRoot) {
    return null;
  }

  const manifest = await readJsonFile<ManifestFile>(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
  );
  const progress = await readJsonFile<PapernexusProgressFile>(
    path.join(projectRoot, "graph", "PAPERNEXUS_PROGRESS.json"),
  );
  const source: ProjectDetailSummary["source"] = [];

  if (manifest) {
    source.push("manifest");
  }

  if (progress) {
    source.push("papernexus_progress");
  }

  if (!asString(manifest?.project_id)) {
    source.push("fallback");
  }

  const currentStage = asString(manifest?.current_stage);
  const blockingReason = asString(manifest?.blocking_reason);
  const nextAction = asString(manifest?.next_action);
  const paperMode = getPaperMode(manifest?.writing_contract);
  const surveyStatus = asString(manifest?.survey_review?.status);

  return {
    id: asString(manifest?.project_id) ?? params.projectId,
    title: asString(manifest?.title),
    projectRoot,
    currentStage,
    workflowLine: deriveWorkflowLine({
      currentStage,
      paperMode,
      surveyStatus,
    }),
    paperMode,
    owner: asString(manifest?.owner_agent),
    status: deriveStatus({ currentStage, blockingReason, nextAction }),
    updatedAt: asString(manifest?.updated_at),
    blockingReason,
    nextAction,
    resumeAction: asString(manifest?.resume_action),
    surveyStatus,
    surveyTopic: asString(manifest?.survey_review?.topic),
    surveyProgressSummary: formatSurveyProgressSummary(manifest?.survey_review),
    papernexusPhase: asString(progress?.phase),
    papernexusProgressSummary: formatPapernexusProgressSummary(progress?.progress),
    source,
  };
}

function deriveWorkflowLine(params: {
  currentStage: string | null;
  paperMode: string | null;
  surveyStatus: string | null;
}): ProjectDetailSummary["workflowLine"] {
  if (
    params.currentStage === "survey_review" ||
    params.paperMode === "survey" ||
    (params.surveyStatus !== null && params.surveyStatus !== "missing")
  ) {
    return "survey";
  }

  return "experiment";
}

function deriveStatus(params: {
  currentStage: string | null;
  blockingReason: string | null;
  nextAction: string | null;
}): ProjectDetailSummary["status"] {
  if (params.blockingReason) {
    return "blocked";
  }

  if (getWorkflowStageIndex(params.currentStage) === null) {
    return "incomplete";
  }

  if (params.currentStage === "submit" || params.currentStage === "done" || !params.nextAction) {
    return "ready";
  }

  return "active";
}

function formatPapernexusProgressSummary(
  progress: PapernexusProgressFile["progress"],
): string | null {
  const total = asNumber(progress?.total);
  const completed = asNumber(progress?.completed);
  const remaining =
    asNumber(progress?.remaining) ??
    (typeof total === "number" && typeof completed === "number"
      ? total - completed
      : null);

  if (total === null || completed === null) {
    return null;
  }

  if (remaining === null) {
    return `${completed}/${total} completed`;
  }

  return `${completed}/${total} completed (${remaining} remaining)`;
}

function formatSurveyProgressSummary(
  survey: ManifestFile["survey_review"],
): string | null {
  const candidateCount = asNumber(survey?.candidate_paper_count);
  const includedCount = asNumber(survey?.included_paper_count);
  const excludedCount = asNumber(survey?.excluded_paper_count);
  const briefReady = survey?.graph_grounded_brief_ready === true;
  const parts: string[] = [];

  if (candidateCount !== null) {
    parts.push(`${candidateCount} candidates`);
  }
  if (includedCount !== null) {
    parts.push(`${includedCount} included`);
  }
  if (excludedCount !== null) {
    parts.push(`${excludedCount} excluded`);
  }
  if (briefReady) {
    parts.push("brief ready");
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

function getPaperMode(value: ManifestFile["writing_contract"]): string | null {
  return asString(value?.paper_mode) ?? asString(value?.paperMode);
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
