import { BrowserRouter, MemoryRouter, Route, Routes } from "react-router-dom";

import { ProjectsMatrixPage } from "../pages/ProjectsMatrixPage";
import { ProjectDetailPage } from "../pages/ProjectDetailPage";

type AppRouterProps = {
  initialEntries?: string[];
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
      <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
    </Routes>
  );
}
