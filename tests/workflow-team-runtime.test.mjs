import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  claimNextWorkflowTaskForOwner,
  claimWorkflowTask,
  materializeWorkflowTaskGraph,
  readWorkflowTaskGraphStore,
  releaseWorkflowTaskClaim,
  renewWorkflowTaskLease,
  summarizeWorkflowTaskGraphStore,
} from "../tools/workflow-team/task-graph.ts";

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
    claimedCount: 0,
    satisfiedCount: 1,
    optionalCount: 1,
  });
});

test("workflow task graph supports claim, renew, and release semantics", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-task-claim-")
  );

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await materializeWorkflowTaskGraph({
    projectRoot,
    projectId: "demo-project",
    stage: "analyze",
    topTierVerdict: "worth_top_tier_bet",
    evidenceCloseout: {
      status: "blocked",
      topTierVerdict: "worth_top_tier_bet",
      blockers: ["mechanism evidence missing"],
      experimentAnalyzeReady: true,
      analyzeReviewReady: false,
      writeReady: false,
      submitReady: false,
      graphDependentBlockerCount: 1,
      localEvidenceBlockerCount: 0,
    },
    previewTasks: [
      {
        taskId: "analyze.materialize_mechanism_packet",
        title: "Produce a mechanism evidence packet",
        owner: "analyzer",
        status: "blocked",
        reason: "Mechanism evidence or venue competition context is not graph-grounded.",
      },
    ],
  });

  const claim = await claimWorkflowTask({
    projectRoot,
    taskId: "analyze.materialize_mechanism_packet",
    sessionKey: "agent:analyzer:discord:group:paper-lab",
    role: "analyzer",
  });
  assert.equal(claim.claimed, true);
  assert.equal(claim.task?.status, "claimed");
  assert.equal(claim.task?.lease?.sessionKey, "agent:analyzer:discord:group:paper-lab");

  const secondClaim = await claimWorkflowTask({
    projectRoot,
    taskId: "analyze.materialize_mechanism_packet",
    sessionKey: "agent:researcher:discord:group:paper-lab",
    role: "researcher",
  });
  assert.equal(secondClaim.claimed, false);
  assert.equal(secondClaim.reason, "already_claimed");

  const renewed = await renewWorkflowTaskLease({
    projectRoot,
    taskId: "analyze.materialize_mechanism_packet",
    sessionKey: "agent:analyzer:discord:group:paper-lab",
  });
  assert.equal(renewed.renewed, true);
  assert.equal(renewed.task?.status, "claimed");

  const released = await releaseWorkflowTaskClaim({
    projectRoot,
    taskId: "analyze.materialize_mechanism_packet",
    sessionKey: "agent:analyzer:discord:group:paper-lab",
  });
  assert.equal(released.released, true);
  assert.equal(released.task?.status, "claimable");

  const finalStore = await readWorkflowTaskGraphStore(projectRoot);
  const finalSummary = summarizeWorkflowTaskGraphStore(finalStore);
  assert.deepEqual(finalSummary, {
    taskCount: 1,
    claimableCount: 1,
    claimedCount: 0,
    satisfiedCount: 0,
    optionalCount: 0,
  });
});

test("workflow task graph can assign the next claimable task for an owner session", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-task-claim-next-")
  );

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await materializeWorkflowTaskGraph({
    projectRoot,
    projectId: "demo-project",
    stage: "write",
    topTierVerdict: "worth_top_tier_bet",
    evidenceCloseout: {
      status: "blocked",
      topTierVerdict: "worth_top_tier_bet",
      blockers: ["reproducibility pack missing"],
      experimentAnalyzeReady: true,
      analyzeReviewReady: true,
      writeReady: false,
      submitReady: false,
      graphDependentBlockerCount: 0,
      localEvidenceBlockerCount: 1,
    },
    previewTasks: [
      {
        taskId: "write.complete_repro_pack",
        title: "Finish reproducibility pack",
        owner: "academic_writer",
        status: "blocked",
        reason: "Reproducibility pack is incomplete.",
      },
      {
        taskId: "write.keep_story_and_evidence_aligned",
        title: "Keep story aligned",
        owner: "academic_writer",
        status: "ready",
        reason: null,
      },
    ],
  });

  const claim = await claimNextWorkflowTaskForOwner({
    projectRoot,
    owner: "academic_writer",
    sessionKey: "agent:academic_writer:discord:group:paper-lab",
  });

  assert.equal(claim.claimed, true);
  assert.equal(claim.task?.taskId, "write.complete_repro_pack");
  assert.equal(claim.task?.status, "claimed");

  const summary = summarizeWorkflowTaskGraphStore(
    await readWorkflowTaskGraphStore(projectRoot)
  );
  assert.deepEqual(summary, {
    taskCount: 2,
    claimableCount: 0,
    claimedCount: 1,
    satisfiedCount: 1,
    optionalCount: 0,
  });
});
