import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  claimWorkflowTask,
  materializeWorkflowTaskGraph,
  readWorkflowTaskGraphStore,
  releaseWorkflowTasksForSession,
} from "../../../tools/workflow-team/task-graph.ts";
import {
  materializeWorkflowTeamRound,
  readWorkflowTeamRoundStore,
  recordWorkflowTeamRoundClaim,
  releaseWorkflowTeamRoundSession,
} from "../../../tools/workflow-team/team-round.ts";
import { completeWorkflowTaskAndContinue } from "../../../tools/workflow-team/task-hooks.ts";

test("workflow team recovery returns needs-repair tasks to the queue when the owning session exits", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-team-recovery-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        benchmark_protocol: {
          status: "missing",
          locked: false,
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

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
      writeReady: true,
      submitReady: true,
      graphDependentBlockerCount: 0,
      localEvidenceBlockerCount: 1,
    },
    previewTasks: [
      {
        taskId: "experiment.lock_benchmark_protocol",
        title: "Lock the benchmark protocol",
        owner: "researcher",
        status: "blocked",
        reason: "Benchmark protocol is still missing.",
        dependsOn: [],
        verificationRule: "benchmark_protocol",
      },
    ],
  });

  await claimWorkflowTask({
    projectRoot,
    taskId: "experiment.lock_benchmark_protocol",
    sessionKey: "agent:researcher:discord:group:paper-lab",
    role: "researcher",
  });
  await materializeWorkflowTeamRound({
    projectRoot,
    projectId: "demo-project",
    stage: "experiment",
    leadRole: "researcher",
    topTierVerdict: "worth_top_tier_bet",
    evidenceCloseoutStatus: "blocked",
    taskGraphPath: path.join(projectRoot, ".openclaw-research", "workflow-task-graph.json"),
    taskCount: 1,
    claimableCount: 0,
    blockedCount: 0,
    claimedCount: 1,
    verifyingCount: 0,
    needsRepairCount: 0,
    satisfiedCount: 0,
    optionalCount: 0,
  });
  await recordWorkflowTeamRoundClaim({
    projectRoot,
    sessionKey: "agent:researcher:discord:group:paper-lab",
    taskId: "experiment.lock_benchmark_protocol",
  });

  const failed = await completeWorkflowTaskAndContinue({
    projectRoot,
    taskId: "experiment.lock_benchmark_protocol",
    sessionKey: "agent:researcher:discord:group:paper-lab",
    role: "researcher",
  });
  assert.equal(failed.completed, false);
  assert.equal(failed.task?.status, "needs_repair");

  await releaseWorkflowTasksForSession({
    projectRoot,
    sessionKey: "agent:researcher:discord:group:paper-lab",
  });
  await releaseWorkflowTeamRoundSession({
    projectRoot,
    sessionKey: "agent:researcher:discord:group:paper-lab",
  });

  const store = await readWorkflowTaskGraphStore(projectRoot);
  const round = await readWorkflowTeamRoundStore(projectRoot);
  assert.equal(store?.tasks[0].status, "claimable");
  assert.equal(round?.activeSessionKeys.length, 0);
});
