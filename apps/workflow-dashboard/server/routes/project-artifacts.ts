import type { Router } from "express";

import type { CreateAppOptions } from "../app.js";
import { listProjectArtifacts } from "../read-models/project-artifacts.js";
import { readProjectDetailSummary } from "../read-models/project-detail.js";

export function registerProjectArtifactsRoute(
  router: Router,
  options: CreateAppOptions,
): void {
  router.get("/:projectId/artifacts", async (req, res) => {
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

    res.json(
      await listProjectArtifacts({
        projectRoot: summary.projectRoot,
      }),
    );
  });
}
