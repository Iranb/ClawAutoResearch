import path from "node:path";

import { pathExists } from "./fs.js";

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

export async function resolveExistingProjectRoot(params: {
  projectsRoot: string;
  projectId: string | null | undefined;
}): Promise<string | null> {
  const projectRoot = resolveProjectRoot(params.projectsRoot, params.projectId);
  if (!projectRoot) {
    return null;
  }
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  return (await pathExists(manifestPath)) ? projectRoot : null;
}
