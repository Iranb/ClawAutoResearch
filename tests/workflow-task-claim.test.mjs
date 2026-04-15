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

test("workflow task claim blocks active write-scope conflicts", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-task-write-scope-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await materializeWorkflowTaskGraph({
    projectRoot,
    projectId: "demo-project",
    stage: "code",
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
        taskId: "code.shared_a",
        title: "Edit shared file A",
        owner: "coder",
        status: "blocked",
        reason: "Needs implementation.",
        dependsOn: [],
        verificationRule: "none",
      },
      {
        taskId: "code.shared_b",
        title: "Edit shared file B",
        owner: "coder",
        status: "blocked",
        reason: "Needs implementation.",
        dependsOn: [],
        verificationRule: "none",
      },
    ],
  });

  const graph = await readWorkflowTaskGraphStore(projectRoot);
  graph.tasks = graph.tasks.map((task) => ({
    ...task,
    writeScope: {
      ownedDirs: [],
      exclusiveFiles: ["coder/shared-plan.md"],
      mode: "exclusive_write",
    },
  }));
  await fs.writeFile(
    path.join(projectRoot, ".openclaw-research", "workflow-task-graph.json"),
    `${JSON.stringify(graph, null, 2)}\n`,
    "utf8"
  );

  const first = await claimNextWorkflowTaskForOwner({
    projectRoot,
    owner: "coder",
    sessionKey: "agent:coder:one",
  });
  const second = await claimNextWorkflowTaskForOwner({
    projectRoot,
    owner: "coder",
    sessionKey: "agent:coder:two",
  });

  assert.equal(first.claimed, true);
  assert.equal(second.claimed, false);
  assert.match(second.reason ?? "", /^write_scope_conflict:/);
});

test("completeWorkflowTaskAndContinue can be blocked by a before-complete hook", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-task-complete-hook-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await materializeWorkflowTaskGraph({
    projectRoot,
    projectId: "demo-project",
    stage: "review",
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
        taskId: "review.audit_main_tex",
        title: "Audit the main tex",
        owner: "reviewer",
        status: "blocked",
        reason: "Needs audit",
        dependsOn: [],
        verificationRule: "none",
      },
    ],
  });

  const claimed = await claimNextWorkflowTaskForOwner({
    projectRoot,
    owner: "reviewer",
    sessionKey: "agent:reviewer:test",
  });
  assert.equal(claimed.claimed, true);

  const completion = await completeWorkflowTaskAndContinue({
    projectRoot,
    taskId: "review.audit_main_tex",
    sessionKey: "agent:reviewer:test",
    role: "reviewer",
    beforeCompleteHook: async () => ({
      allow: false,
      reason: "Workflow hook requested another revision round.",
    }),
  });

  assert.equal(completion.completed, false);
  assert.equal(completion.verification.verified, false);
  assert.match(completion.verification.reason ?? "", /revision round/i);

  const store = await readWorkflowTaskGraphStore(projectRoot);
  assert.equal(
    store?.tasks.find((task) => task.taskId === "review.audit_main_tex")?.status,
    "needs_repair"
  );
});
