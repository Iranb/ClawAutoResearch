export type ProjectOverview = {
  id: string;
  title: string | null;
  projectRoot: string;
  currentStage: string | null;
  currentStageIndex: number | null;
  status: "blocked" | "active" | "ready" | "incomplete";
  blockerLabel: string | null;
  blockerReason: string | null;
  nextAction: string | null;
  updatedAt: string | null;
  source: "projects_state" | "manifest_fallback";
};

export async function fetchProjectsOverview(): Promise<ProjectOverview[]> {
  const response = await fetch("/api/projects");

  if (!response.ok) {
    throw new Error(`Failed to load project overview (${response.status})`);
  }

  return response.json() as Promise<ProjectOverview[]>;
}
