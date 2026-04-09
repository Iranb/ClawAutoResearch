import { useEffect, useState } from "react";

import { AppShell } from "../components/layout/AppShell";
import { StageMatrix } from "../components/matrix/StageMatrix";
import { fetchProjectsOverview, type ProjectOverview } from "../lib/api";

export function ProjectsMatrixPage() {
  const [projects, setProjects] = useState<ProjectOverview[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    void fetchProjectsOverview()
      .then((response) => {
        if (!isMounted) {
          return;
        }

        setProjects(response);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!isMounted) {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : "Failed to load projects.");
        setStatus("error");
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <AppShell
      eyebrow="Workflow Dashboard"
      title="Projects Matrix"
      description="Read-only visibility into current project stages, blockers, and next drill-down paths."
    >
      {status === "loading" ? (
        <section className="status-panel">
          <p>Loading projects...</p>
        </section>
      ) : null}

      {status === "error" ? (
        <section className="status-panel status-panel--error">
          <p>{errorMessage}</p>
        </section>
      ) : null}

      {status === "ready" ? <StageMatrix projects={projects} /> : null}
    </AppShell>
  );
}
