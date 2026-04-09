import path from "node:path";

import { pathExists, readDirectoryNames, readJsonFile } from "./fs.js";

type ProjectsStateEntry = {
  id?: string | null;
};

type ProjectsStateFile = {
  projects?: ProjectsStateEntry[] | null;
};

export type DiscoveredProject = {
  id: string;
  projectRoot: string;
  source: "projects_state" | "manifest_fallback";
};

export async function discoverProjects(
  projectsRoot: string,
): Promise<DiscoveredProject[]> {
  const projectsStatePath = path.join(projectsRoot, "PROJECTS_STATE.json");
  const projectsState = await readJsonFile<ProjectsStateFile>(projectsStatePath);
  const discoveredProjects: DiscoveredProject[] = [];
  const knownIds = new Set<string>();

  for (const entry of projectsState?.projects ?? []) {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";

    if (!id || knownIds.has(id)) {
      continue;
    }

    knownIds.add(id);
    discoveredProjects.push({
      id,
      projectRoot: path.join(projectsRoot, id),
      source: "projects_state",
    });
  }

  for (const dirName of await readDirectoryNames(projectsRoot)) {
    if (knownIds.has(dirName)) {
      continue;
    }

    const manifestPath = path.join(projectsRoot, dirName, "PROJECT_MANIFEST.json");

    if (!(await pathExists(manifestPath))) {
      continue;
    }

    knownIds.add(dirName);
    discoveredProjects.push({
      id: dirName,
      projectRoot: path.join(projectsRoot, dirName),
      source: "manifest_fallback",
    });
  }

  return discoveredProjects;
}
