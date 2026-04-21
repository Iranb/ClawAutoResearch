import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  appendWorkflowHandoffDeliveryAttempt,
  findRetriableWorkflowHandoffIntents,
  readWorkflowHandoffIntentStore,
  transitionWorkflowHandoffIntent,
  upsertWorkflowHandoffIntent,
} from "../tools/workflow-handoff/handoff-store.ts";
import { runWorkflowHandoffMaintenancePass } from "../tools/workflow-handoff/maintenance.ts";

test("failed handoffs use a shorter retry backoff than delivered handoffs", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-handoff-retry-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const failedIntent = await upsertWorkflowHandoffIntent({
    projectRoot,
    idempotencyKey: "failed-intent",
    toRole: "coder",
    reason: "stage_owner_change",
    deliveryPlan: {
      channels: ["native_runtime"],
      fallbackAfterMs: 300_000,
      maxAttemptsTotal: 5,
    },
  });
  await appendWorkflowHandoffDeliveryAttempt({
    projectRoot,
    intentId: failedIntent.intent.intentId,
    attempt: {
      channel: "native_runtime",
      status: "failed",
      runId: null,
      sessionKey: null,
      messageId: null,
      queueKey: null,
      error: "runtime unavailable",
      attemptedAt: new Date(Date.now() - 45_000).toISOString(),
    },
  });
  await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: failedIntent.intent.intentId,
    toStatus: "failed",
  });

  const dispatchedIntent = await upsertWorkflowHandoffIntent({
    projectRoot,
    idempotencyKey: "dispatched-intent",
    toRole: "reviewer",
    reason: "stage_owner_change",
    deliveryPlan: {
      channels: ["native_runtime"],
      fallbackAfterMs: 300_000,
      maxAttemptsTotal: 5,
    },
  });
  await appendWorkflowHandoffDeliveryAttempt({
    projectRoot,
    intentId: dispatchedIntent.intent.intentId,
    attempt: {
      channel: "native_runtime",
      status: "delivered",
      runId: "run-1",
      sessionKey: "agent:reviewer:main",
      messageId: null,
      queueKey: null,
      error: null,
      attemptedAt: new Date(Date.now() - 45_000).toISOString(),
    },
  });
  await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: dispatchedIntent.intent.intentId,
    toStatus: "dispatched",
  });

  const retriable = await findRetriableWorkflowHandoffIntents({ projectRoot });
  assert.equal(retriable.some((intent) => intent.intentId === failedIntent.intent.intentId), true);
  assert.equal(
    retriable.some((intent) => intent.intentId === dispatchedIntent.intent.intentId),
    false
  );
});

test("runWorkflowHandoffMaintenancePass marks long-stalled handoffs as failed", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-handoff-stall-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const created = await upsertWorkflowHandoffIntent({
    projectRoot,
    idempotencyKey: "stall-intent",
    toRole: "academic_writer",
    reason: "stage_owner_change",
    deliveryPlan: {
      channels: ["native_runtime"],
      maxAttemptsTotal: 3,
    },
  });
  await appendWorkflowHandoffDeliveryAttempt({
    projectRoot,
    intentId: created.intent.intentId,
    attempt: {
      channel: "native_runtime",
      status: "delivered",
      runId: "run-1",
      sessionKey: "agent:academic_writer:main",
      messageId: null,
      queueKey: null,
      error: null,
      attemptedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    },
  });
  await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: created.intent.intentId,
    toStatus: "dispatched",
  });

  const maintenance = await runWorkflowHandoffMaintenancePass({
    projectRoot,
    now: new Date(),
  });
  assert.equal(maintenance.stalledIntentIds.length, 1);

  const store = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(store.intents[0].status, "failed");
});

test("runWorkflowHandoffMaintenancePass supersedes stale stage-owner intents once stage lineage moved on", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-handoff-supersede-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "demo",
        current_stage: "code",
        orchestration_state: {
          pending_handoff_id: "intent-new",
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const created = await upsertWorkflowHandoffIntent({
    projectRoot,
    idempotencyKey: "old-plan-intent",
    toRole: "orchestrator",
    reason: "stage_owner_change",
    stageBefore: "idea",
    stageAfter: "plan",
    deliveryPlan: {
      channels: ["native_runtime"],
      maxAttemptsTotal: 4,
    },
  });

  const result = await runWorkflowHandoffMaintenancePass({
    projectRoot,
    now: new Date(),
  });
  assert.deepEqual(result.supersededIntentIds, [created.intent.intentId]);

  const store = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(store.intents[0].status, "superseded");
});
