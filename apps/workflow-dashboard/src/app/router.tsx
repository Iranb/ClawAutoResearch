import { BrowserRouter, MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";

import { AppShell } from "../components/layout/AppShell";
import { ProjectsMatrixPage } from "../pages/ProjectsMatrixPage";

type AppRouterProps = {
  initialEntries?: string[];
};

type DetailRouteState = {
  title?: string;
};

export function AppRouter(props: AppRouterProps) {
  if (props.initialEntries) {
    return (
      <MemoryRouter initialEntries={props.initialEntries}>
        <AppRoutes />
      </MemoryRouter>
    );
  }

  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<ProjectsMatrixPage />} />
      <Route path="/projects/:projectId" element={<ProjectDetailPlaceholder />} />
    </Routes>
  );
}

function ProjectDetailPlaceholder() {
  const { projectId } = useParams();
  const location = useLocation();
  const state = (location.state ?? null) as DetailRouteState | null;
  const title = state?.title ?? projectId ?? "Project Detail";

  return (
    <AppShell
      eyebrow="Project Detail"
      title={title}
      description="Project drill-down placeholder."
    >
      <section className="placeholder-panel">
        <p>
          Detail view coming soon for <strong>{title}</strong>.
        </p>
      </section>
    </AppShell>
  );
}
