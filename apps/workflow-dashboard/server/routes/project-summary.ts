import type { Router } from "express";

import type { CreateAppOptions } from "../app.js";
import { readProjectDetailSummary } from "../read-models/project-detail.js";

export function registerProjectSummaryRoute(
  router: Router,
  options: CreateAppOptions,
): void {
  router.get("/:projectId/summary", async (req, res) => {
    const projectId = req.params.projectId;
    const summary = await readProjectDetailSummary({
      projectsRoot: options.projectsRoot,
      projectId,
    });

    if (!summary) {
      res.status(404).json({
        error: "Project not found",
        projectId,
      });
      return;
    }

    res.json(summary);
  });
}
