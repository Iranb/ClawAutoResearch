import path from "node:path";

import type { Router } from "express";

import type { CreateAppOptions } from "../app.js";
import {
  getProjectArtifact,
  isArtifactKey,
} from "../read-models/project-artifacts.js";
import { readProjectDetailSummary } from "../read-models/project-detail.js";
import { readRawArtifact } from "../read-models/raw-artifact.js";

export function registerProjectRawRoute(
  router: Router,
  options: CreateAppOptions,
): void {
  router.get("/:projectId/raw/:artifactKey", async (req, res) => {
    const projectId = req.params.projectId;
    const artifactKey = req.params.artifactKey;

    if (!isArtifactKey(artifactKey)) {
      res.status(400).json({
        error: "Invalid artifact key",
        artifactKey,
      });
      return;
    }

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

    const artifact = await getProjectArtifact({
      projectRoot: summary.projectRoot,
      artifactKey,
    });

    res.json(
      await readRawArtifact({
        filePath: path.join(summary.projectRoot, artifact.path),
        kind: artifact.kind,
      }),
    );
  });
}
