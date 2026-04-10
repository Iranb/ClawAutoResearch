import * as path from "node:path";
import {
  readJsonIfExists,
  withAdvisoryLock,
  writeJsonAtomicEnsured,
} from "./workflow-guard-core/fs";

type ProjectsStateLike = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateOnly(isoTs: string): string {
  return isoTs.slice(0, 10);
}

function formatProjectDirEntry(projectId: string | null): string | null {
  if (!projectId) {
    return null;
  }
  return `${projectId}/`;
}

function defaultProjectsState(): ProjectsStateLike {
  return {
    updated_at: null,
    gpu_allocation: {},
    total_gpu_hours_used: 0,
    projects: [],
  };
}

function getProjectRegistryLockPath(projectRoot: string): string {
  return `${getProjectsStatePath(projectRoot)}.lock`;
}

export function getProjectsStatePath(projectRoot: string): string {
  return path.join(path.dirname(path.resolve(projectRoot)), "PROJECTS_STATE.json");
}

export async function readProjectsStateRaw(projectRoot: string): Promise<ProjectsStateLike> {
  return (
    (await readJsonIfExists<ProjectsStateLike>(getProjectsStatePath(projectRoot))) ??
    defaultProjectsState()
  );
}

export async function updateProjectsState<T>(params: {
  projectRoot: string;
  task: (state: ProjectsStateLike) => Promise<{ state: ProjectsStateLike; result: T }> | {
    state: ProjectsStateLike;
    result: T;
  };
}): Promise<T> {
  return withAdvisoryLock({
    lockPath: getProjectRegistryLockPath(params.projectRoot),
    task: async () => {
      const current = await readProjectsStateRaw(params.projectRoot);
      const next = await params.task(current);
      await writeJsonAtomicEnsured(getProjectsStatePath(params.projectRoot), next.state);
      return next.result;
    },
  });
}

export async function syncProjectsStateEntry(params: {
  projectRoot: string;
  projectId: string | null;
  manifest: Record<string, unknown>;
  trackRegistry: Record<string, unknown> | null;
  stage: string | null;
  nextAction: string | null;
  blockingReason: string | null;
  getActiveTracks: (trackRegistry: Record<string, unknown> | null) => unknown[];
}): Promise<boolean> {
  if (!params.projectId) {
    return false;
  }

  return updateProjectsState({
    projectRoot: params.projectRoot,
    task: async (projectsState) => {
      const projects = Array.isArray(projectsState.projects)
        ? projectsState.projects.filter(
            (entry): entry is Record<string, unknown> => Boolean(asRecord(entry))
          )
        : [];
      const now = new Date().toISOString();
      const existing =
        projects.find((entry) => readString(entry.id) === params.projectId) ?? null;
      const nextEntry: Record<string, unknown> = {
        ...(existing ?? {}),
        id: params.projectId,
        title:
          readString(params.manifest.title ?? params.manifest.project_title) ??
          readString(existing?.title) ??
          params.projectId,
        stage: params.stage,
        active_tracks: params.getActiveTracks(params.trackRegistry).length,
        dir: readString(existing?.dir) ?? formatProjectDirEntry(params.projectId),
        created:
          readString(existing?.created) ??
          readString(params.manifest.created_at)?.slice(0, 10) ??
          dateOnly(now),
        updated: now,
        status: params.stage === "done" ? "completed" : "active",
        next_action: params.nextAction,
        blocked_by: params.blockingReason,
        estimated_gpu_h_remaining:
          readNumber(asRecord(params.manifest.budget)?.remaining_gpu_hours) ??
          readNumber(asRecord(params.manifest.budget)?.remaining_gpu_h) ??
          readNumber(existing?.estimated_gpu_h_remaining),
      };

      const nextProjects = projects.filter(
        (entry) => readString(entry.id) !== params.projectId
      );
      nextProjects.push(nextEntry);
      nextProjects.sort((left, right) => {
        const leftPriority = readNumber(left.priority) ?? Number.MAX_SAFE_INTEGER;
        const rightPriority = readNumber(right.priority) ?? Number.MAX_SAFE_INTEGER;
        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }
        const leftUpdated = readString(left.updated) ?? "";
        const rightUpdated = readString(right.updated) ?? "";
        return rightUpdated.localeCompare(leftUpdated);
      });

      const nextState: ProjectsStateLike = {
        ...projectsState,
        projects: nextProjects,
        updated_at: now,
      };
      return {
        state: nextState,
        result: true,
      };
    },
  });
}

export async function listActiveProjectsFromRegistry(params: {
  projectsRoot: string;
  maxProjects: number;
  pathExists: (targetPath: string) => Promise<boolean>;
}): Promise<
  Array<{
    projectId: string | null;
    projectRoot: string;
    stage: string | null;
    updatedAt: string | null;
  }>
> {
  const state =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(path.resolve(params.projectsRoot), "PROJECTS_STATE.json")
    )) ?? null;
  const projects = Array.isArray(state?.projects)
    ? state.projects.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
      )
    : [];
  const results: Array<{
    projectId: string | null;
    projectRoot: string;
    stage: string | null;
    updatedAt: string | null;
  }> = [];

  for (const entry of projects) {
    if (readString(entry.status)?.toLowerCase() === "completed") {
      continue;
    }
    if (readString(entry.stage)?.toLowerCase() === "done") {
      continue;
    }
    const dir = readString(entry.dir);
    const projectRoot = dir
      ? path.isAbsolute(dir)
        ? path.resolve(dir)
        : path.resolve(params.projectsRoot, dir)
      : readString(entry.id)
        ? path.resolve(params.projectsRoot, String(readString(entry.id)))
        : null;
    if (!projectRoot) {
      continue;
    }
    if (!(await params.pathExists(path.join(projectRoot, "PROJECT_MANIFEST.json")))) {
      continue;
    }
    results.push({
      projectId: readString(entry.id),
      projectRoot,
      stage: readString(entry.stage),
      updatedAt: readString(entry.updated),
    });
    if (results.length >= params.maxProjects) {
      break;
    }
  }

  return results;
}
