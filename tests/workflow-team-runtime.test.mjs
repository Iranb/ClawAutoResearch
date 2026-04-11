import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializeWorkflowTaskGraph, readWorkflowTaskGraphStore, summarizeWorkflowTaskGraphStore } from "../tools/workflow-team/task-graph.ts";

test("workflow task graph store persists preview tasks as claimable/satisfied summary state", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-task-graph-")
  );

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await materializeWorkflowTaskGraph({
    projectRoot,
    projectId: "demo-project",
    stage: "experiment",
    topTierVerdict: "worth_top_tier_bet",
    evidenceCloseout: {
      status: "blocked",
      topTierVerdict: "worth_top_tier_bet",
      blockers: ["benchmark protocol missing"],
      experimentAnalyzeReady: false,
      analyzeReviewReady: true,
      writeReady: false,
      submitReady: false,
      graphDependentBlockerCount: 0,
      localEvidenceBlockerCount: 1,
    },
    previewTasks: [
      {
        taskId: "experiment.lock_benchmark_protocol",
        title: "Lock benchmark protocol",
        owner: "orchestrator",
        status: "blocked",
        reason: "Benchmark/statistical/ablation evidence is still incomplete.",
      },
      {
        taskId: "experiment.aggregate_statistics",
        title: "Aggregate statistics",
        owner: "analyzer",
        status: "ready",
        reason: null,
      },
      {
        taskId: "experiment.optional_note",
        title: "Optional note",
        owner: "researcher",
        status: "optional",
        reason: null,
      },
    ],
  });

  const store = await readWorkflowTaskGraphStore(projectRoot);
  assert.ok(store);
  assert.equal(store?.stage, "experiment");
  assert.equal(store?.tasks[0].status, "claimable");
  assert.equal(store?.tasks[1].status, "satisfied");
  assert.equal(store?.tasks[2].status, "optional");

  const summary = summarizeWorkflowTaskGraphStore(store);
  assert.deepEqual(summary, {
    taskCount: 3,
    claimableCount: 1,
    satisfiedCount: 1,
    optionalCount: 1,
  });
});
