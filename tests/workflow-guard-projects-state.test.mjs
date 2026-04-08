import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readJsonIfExists, writeJsonEnsured } from "../tools/workflow-guard-core/fs.ts";
import {
  formatWorkflowProjectDirEntry,
  getWorkflowProjectsStatePath,
  syncWorkflowProjectsStateEntry,
  workflowDateOnly,
} from "../tools/workflow-guard-project/projects-state.ts";

async function makeProjectRoot() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-projects-state-")
  );
  await fs.mkdir(path.join(projectRoot, "researcher"), { recursive: true });
  return projectRoot;
}

test("projects state entries are written into the parent PROJECTS_STATE.json", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const written = await syncWorkflowProjectsStateEntry(
    {
      projectRoot,
      projectId: "demo-project",
      manifest: {
        title: "Demo Project",
        created_at: "2026-04-08T09:00:00.000Z",
        budget: { remaining_gpu_hours: 12 },
      },
      trackRegistry: { tracks: [{ status: "active" }, { status: "paused" }] },
      stage: "idea",
      nextAction: "/idea-phase",
      blockingReason: "waiting for ideation refresh",
    },
    {
      readJsonIfExists,
      writeJsonEnsured,
      getActiveTracks(trackRegistry) {
        return Array.isArray(trackRegistry?.tracks)
          ? trackRegistry.tracks.filter((track) => track.status === "active")
          : [];
      },
    }
  );

  assert.equal(written, true);
  assert.equal(formatWorkflowProjectDirEntry("demo-project"), "demo-project/");
  assert.equal(workflowDateOnly("2026-04-08T12:34:56.000Z"), "2026-04-08");

  const projectsStatePath = getWorkflowProjectsStatePath(projectRoot);
  assert.equal(projectsStatePath, path.join(path.dirname(projectRoot), "PROJECTS_STATE.json"));

  const state = await readJsonIfExists(projectsStatePath);
  assert.ok(state);
  assert.equal(state.projects[0].id, "demo-project");
  assert.equal(state.projects[0].status, "active");
  assert.equal(state.projects[0].estimated_gpu_h_remaining, 12);
});

