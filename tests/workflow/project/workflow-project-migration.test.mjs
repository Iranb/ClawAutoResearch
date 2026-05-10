import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  discoverWorkflowProjects,
  migrateWorkflowProjectsBatch,
} from "../../../tools/workflow-project-migration.ts";

async function makeProjectsRoot() {
  return await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-workflow-migration-")
  );
}

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("workflow project migration discovers manifest-backed projects and migrates them to the latest runtime", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const expRoot = path.join(projectsRoot, "legacy-exp");
  const surveyRoot = path.join(projectsRoot, "legacy-survey");

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(expRoot, "PROJECT_MANIFEST.json"), {
    project_id: "legacy-exp",
    title: "Legacy Experiment",
    current_stage: "experiment",
    owner_agent: "researcher",
    experiment_search: {
      status: "running",
      baseline_fairness_status: "pending",
      implementation_confidence: "unknown",
      multi_seed_status: "pending",
      ablation_status: "pending",
      search_exhaustion_status: "active",
      evidence_cleanliness_status: "partial",
    },
  });
  await writeJson(path.join(surveyRoot, "PROJECT_MANIFEST.json"), {
    project_id: "legacy-survey",
    title: "Legacy Survey",
    current_stage: "idea",
    survey_review: {
      topic: "graph reasoning survey",
      status: "searching",
    },
  });

  const discovered = await discoverWorkflowProjects({ projectsRoot });
  assert.deepEqual(discovered, [expRoot, surveyRoot]);

  const results = await migrateWorkflowProjectsBatch({
    projectsRoot,
    policy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
  });

  assert.equal(results.length, 2);
  assert.equal(results.some((entry) => entry.projectId === "legacy-exp"), true);
  assert.equal(results.some((entry) => entry.projectId === "legacy-survey"), true);

  await fs.access(path.join(expRoot, ".openclaw-research", "workflow-runtime-queue.json"));
  const surveyManifest = JSON.parse(
    await fs.readFile(path.join(surveyRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(surveyManifest.workflow_line, "survey");
  assert.equal(surveyManifest.writing_contract.paper_mode, "survey");
});
