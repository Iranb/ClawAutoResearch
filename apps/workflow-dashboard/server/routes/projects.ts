import type { Router } from "express";

import type { CreateAppOptions } from "../app.js";
import { readProjectOverviews } from "../read-models/project-overview.js";

export function registerProjectsRoute(
  router: Router,
  options: CreateAppOptions,
): void {
  router.get("/", async (_req, res) => {
    res.json(
      await readProjectOverviews({
        projectsRoot: options.projectsRoot,
      }),
    );
  });
}
