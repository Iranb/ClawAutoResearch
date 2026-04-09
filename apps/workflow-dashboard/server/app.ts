import express, { Router } from "express";

import { registerProjectArtifactsRoute } from "./routes/project-artifacts.js";
import { registerProjectRawRoute } from "./routes/project-raw.js";
import { registerProjectSummaryRoute } from "./routes/project-summary.js";
import { registerProjectsRoute } from "./routes/projects.js";

export type CreateAppOptions = {
  projectsRoot: string;
};

export function createApp(options: CreateAppOptions) {
  const app = express();
  const projectsRouter = Router();

  app.disable("x-powered-by");

  app.get("/api/config", (_req, res) => {
    res.json({
      projectsRoot: options.projectsRoot,
      readOnly: true,
    });
  });

  registerProjectsRoute(projectsRouter, options);
  registerProjectSummaryRoute(projectsRouter, options);
  registerProjectArtifactsRoute(projectsRouter, options);
  registerProjectRawRoute(projectsRouter, options);

  app.use("/api/projects", projectsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}
