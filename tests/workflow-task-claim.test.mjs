import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  claimNextWorkflowTaskForOwner,
  materializeWorkflowTaskGraph,
  readWorkflowTaskGraphStore,
} from "../tools/workflow-team/task-graph.ts";
import { completeWorkflowTaskAndContinue } from "../tools/workflow-team/task-hooks.ts";

test("workflow task claim runtime skips dependency-blocked tasks and auto-continues after completion", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-task-claim-runtime-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await materializeWorkflowTaskGraph({
    projectRoot,
    projectId: "demo-project",
    stage: "experiment",
    topTierVerdict: null,
    evidenceCloseout: {
      status: "not_applicable",
      topTierVerdict: null,
      blockers: [],
      experimentAnalyzeReady: true,
      analyzeReviewReady: true,
      writeReady: true,
      submitReady: true,
      graphDependentBlockerCount: 0,
      localEvidenceBlockerCount: 0,
    },
    previewTasks: [
      {
        taskId: "experiment.prepare_bundle",
        title: "Prepare the bundle",
        owner: "researcher",
        status: "blocked",
        reason: "Bundle still needs a first pass.",
        dependsOn: [],
        verificationRule: "none",
      },
      {
        taskId: "experiment.publish_bundle",
        title: "Publish the bundle",
        owner: "researcher",
        status: "blocked",
        reason: "Wait until the bundle is prepared.",
        dependsOn: ["experiment.prepare_bundle"],
        verificationRule: "none",
      },
    ],
  });

  const first = await claimNextWorkflowTaskForOwner({
    projectRoot,
    owner: "researcher",
    sessionKey: "agent:researcher:discord:group:paper-lab",
  });
  assert.equal(first.claimed, true);
  assert.equal(first.task?.taskId, "experiment.prepare_bundle");

  const completion = await completeWorkflowTaskAndContinue({
    projectRoot,
    taskId: "experiment.prepare_bundle",
    sessionKey: "agent:researcher:discord:group:paper-lab",
    role: "researcher",
    completionNote: "Prepared the bundle.",
  });
  assert.equal(completion.completed, true);
  assert.equal(completion.nextTask?.taskId, "experiment.publish_bundle");

  const store = await readWorkflowTaskGraphStore(projectRoot);
  assert.equal(
    store?.tasks.find((task) => task.taskId === "experiment.prepare_bundle")?.status,
    "satisfied"
  );
  assert.equal(
    store?.tasks.find((task) => task.taskId === "experiment.publish_bundle")?.status,
    "claimed"
  );
});
