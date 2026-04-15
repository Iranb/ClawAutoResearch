import path from "node:path";

import { pathExists, readJsonFileSafe } from "./fs.js";

type ProjectsStateEntry = {
  id?: string | null;
  dir?: string | null;
};

type ProjectsStateFile = {
  projects?: ProjectsStateEntry[] | null;
};

function normalizeProjectId(projectId: string | null | undefined): string | null {
  const normalized =
    typeof projectId === "string" && projectId.trim().length > 0
      ? projectId.trim()
      : null;
  if (!normalized) {
    return null;
  }
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    normalized.includes("\0")
  ) {
    return null;
  }
  return normalized;
}

function normalizeProjectDir(projectDir: string | null | undefined): string | null {
  const normalized =
    typeof projectDir === "string" && projectDir.trim().length > 0
      ? projectDir.trim()
      : null;
  if (!normalized || normalized.includes("\0")) {
    return null;
  }
  return normalized;
}

export function resolveProjectRoot(
  projectsRoot: string,
  projectId: string | null | undefined,
): string | null {
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) {
    return null;
  }
  const resolvedProjectsRoot = path.resolve(projectsRoot);
  const projectRoot = path.resolve(resolvedProjectsRoot, normalizedProjectId);
  const relative = path.relative(resolvedProjectsRoot, projectRoot);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative.includes(path.sep)
  ) {
    return null;
  }
  return projectRoot;
}

export function resolveProjectRootFromDir(
  projectsRoot: string,
  projectDir: string | null | undefined,
): string | null {
  const normalizedProjectDir = normalizeProjectDir(projectDir);
  if (!normalizedProjectDir) {
    return null;
  }
  if (path.isAbsolute(normalizedProjectDir)) {
    return path.resolve(normalizedProjectDir);
  }
  const resolvedProjectsRoot = path.resolve(projectsRoot);
  const projectRoot = path.resolve(resolvedProjectsRoot, normalizedProjectDir);
  const relative = path.relative(resolvedProjectsRoot, projectRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return projectRoot;
}

async function resolveProjectRootFromProjectsState(params: {
  projectsRoot: string;
  projectId: string | null | undefined;
}): Promise<string | null> {
  const normalizedProjectId = normalizeProjectId(params.projectId);
  if (!normalizedProjectId) {
    return null;
  }
  const projectsState = await readJsonFileSafe<ProjectsStateFile>(
    path.join(params.projectsRoot, "PROJECTS_STATE.json"),
  );
  for (const entry of projectsState?.projects ?? []) {
    if (normalizeProjectId(entry?.id) !== normalizedProjectId) {
      continue;
    }
    return (
      resolveProjectRootFromDir(params.projectsRoot, entry?.dir) ??
      resolveProjectRoot(params.projectsRoot, normalizedProjectId)
    );
  }
  return null;
}

export async function resolveExistingProjectRoot(params: {
  projectsRoot: string;
  projectId: string | null | undefined;
}): Promise<string | null> {
  const projectRoots = [
    await resolveProjectRootFromProjectsState(params),
    resolveProjectRoot(params.projectsRoot, params.projectId),
  ].filter((projectRoot, index, roots): projectRoot is string =>
    Boolean(projectRoot) && roots.indexOf(projectRoot) === index,
  );
  for (const projectRoot of projectRoots) {
    const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
    if (await pathExists(manifestPath)) {
      return projectRoot;
    }
  }
  return null;
}
