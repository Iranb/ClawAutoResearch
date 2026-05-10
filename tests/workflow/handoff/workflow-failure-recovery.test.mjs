import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { routeWorkflowFailure } from "../../../tools/workflow-handoff/failure-router.ts";
import {
  closeWorkflowRepairItemsForTask,
  readWorkflowRepairQueueStore,
} from "../../../tools/workflow-handoff/repair-queue.ts";
import { readWorkflowHandoffIntentStore } from "../../../tools/workflow-handoff/handoff-store.ts";

test("repair lifecycle reuses same fingerprint, decrements budget, and closes on success", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-failure-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const first = await routeWorkflowFailure({
    projectRoot,
    projectId: "demo",
    stage: "code",
    sourceTaskId: "code.task",
    originalOwner: "coder",
    failureKind: "verification_failed",
    failureReason: "missing validation result",
    verificationRule: "none",
  });
  const second = await routeWorkflowFailure({
    projectRoot,
    projectId: "demo",
    stage: "code",
    sourceTaskId: "code.task",
    originalOwner: "coder",
    failureKind: "verification_failed",
    failureReason: "missing validation result",
    verificationRule: "none",
  });
  assert.equal(first.handoff.failureFingerprint, second.handoff.failureFingerprint);
  let queue = await readWorkflowRepairQueueStore(projectRoot);
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].retryBudgetRemaining, 1);

  const closed = await closeWorkflowRepairItemsForTask({
    projectRoot,
    sourceTaskId: "code.task",
  });
  assert.equal(closed.length, 1);
  queue = await readWorkflowRepairQueueStore(projectRoot);
  assert.equal(queue.items[0].status, "completed");
});

test("exhausted repair creates visible human escalation handoff", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-failure-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await routeWorkflowFailure({
    projectRoot,
    projectId: "demo",
    stage: "code",
    sourceTaskId: "code.task",
    originalOwner: "coder",
    failureKind: "exec_approval_required",
    failureReason: "approval unavailable",
    verificationRule: "exec",
  });
  await routeWorkflowFailure({
    projectRoot,
    projectId: "demo",
    stage: "code",
    sourceTaskId: "code.task",
    originalOwner: "coder",
    failureKind: "exec_approval_required",
    failureReason: "approval unavailable",
    verificationRule: "exec",
  });

  const handoffs = await readWorkflowHandoffIntentStore(projectRoot);
  assert.ok(
    handoffs.intents.some(
      (intent) =>
        intent.toRole === "human" &&
        intent.deliveryPlan.channels.includes("human_escalation")
    )
  );
});
