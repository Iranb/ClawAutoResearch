import path from "node:path";

import { getWorkflowStageIndex } from "../constants/workflow-stages.js";
import { pathExists, readJsonFile } from "../file-access/fs.js";

type ManifestFile = {
  project_id?: string | null;
  title?: string | null;
  current_stage?: string | null;
  owner_agent?: string | null;
  updated_at?: string | null;
  blocking_reason?: string | null;
  next_action?: string | null;
  resume_action?: string | null;
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
  owner: string | null;
  status: "blocked" | "active" | "ready" | "incomplete";
  updatedAt: string | null;
  blockingReason: string | null;
  nextAction: string | null;
  resumeAction: string | null;
  papernexusPhase: string | null;
  papernexusProgressSummary: string | null;
  source: Array<"manifest" | "papernexus_progress" | "fallback">;
};

export async function readProjectDetailSummary(params: {
  projectsRoot: string;
  projectId: string;
}): Promise<ProjectDetailSummary | null> {
  const projectRoot = path.join(params.projectsRoot, params.projectId);

  if (!(await pathExists(projectRoot))) {
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

  return {
    id: asString(manifest?.project_id) ?? params.projectId,
    title: asString(manifest?.title),
    projectRoot,
    currentStage,
    owner: asString(manifest?.owner_agent),
    status: deriveStatus({ currentStage, blockingReason, nextAction }),
    updatedAt: asString(manifest?.updated_at),
    blockingReason,
    nextAction,
    resumeAction: asString(manifest?.resume_action),
    papernexusPhase: asString(progress?.phase),
    papernexusProgressSummary: formatPapernexusProgressSummary(progress?.progress),
    source,
  };
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

  if (params.currentStage === "submit" || !params.nextAction) {
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

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
