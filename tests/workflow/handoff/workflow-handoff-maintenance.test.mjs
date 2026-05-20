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
} from "../../../tools/workflow-handoff/handoff-store.ts";
import { runWorkflowHandoffMaintenancePass } from "../../../tools/workflow-handoff/maintenance.ts";
import {
  buildWorkflowControlContract,
} from "../../../tools/workflow-control-contract.ts";

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

test("runWorkflowHandoffMaintenancePass preserves handoffs that match canonical stage despite stale mirror", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-handoff-canonical-stage-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "canonical-stage-demo",
        current_stage: "code",
        workflow_control: buildWorkflowControlContract({
          contractId: "canonical-stage-demo-control",
          reconciledAt: "2026-05-19T07:59:00.000Z",
          stage: "plan",
          owner: "orchestrator",
          nextAction: "/plan-project",
          status: "waiting",
          blockingReason: "plan_handoff_pending",
          completionStatus: "incomplete",
          completionSource: "plan_completion",
          completionReason: "plan_handoff_pending",
          runtimeState: "queued",
        }),
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const created = await upsertWorkflowHandoffIntent({
    projectRoot,
    idempotencyKey: "canonical-plan-intent",
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
    now: new Date("2026-05-19T07:59:30.000Z"),
  });
  assert.deepEqual(result.supersededIntentIds, []);

  const store = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(store.intents[0].intentId, created.intent.intentId);
  assert.equal(store.intents[0].status, "prepared");
});

test("runWorkflowHandoffMaintenancePass supersedes duplicate active handoffs", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-handoff-duplicates-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(projectRoot, ".openclaw-research"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, ".openclaw-research", "workflow-handoff-intents.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        projectRoot,
        updatedAt: new Date().toISOString(),
        intents: [
          {
            schemaVersion: 1,
            intentId: "intent-completed",
            idempotencyKey: "stage:demo:write:revision-1",
            projectId: "demo",
            projectRoot,
            workflowLine: "experiment",
            stage: "write",
            fromRole: "reviewer",
            toRole: "academic_writer",
            reason: "stage_owner_change",
            priority: "normal",
            status: "completed",
            stageAfter: "write",
            deliveryPlan: {
              channels: ["native_runtime"],
              requireAck: false,
              ackDeadlineAt: null,
              fallbackAfterMs: 0,
              maxAttemptsTotal: 3,
              maxAttemptsByChannel: { native_runtime: 3 },
              staleClaimAfterMs: 900000,
            },
            deliveryAttempts: [],
            createdAt: "2026-04-28T05:00:00.000Z",
            updatedAt: "2026-04-28T05:00:10.000Z",
          },
          {
            schemaVersion: 1,
            intentId: "intent-duplicate",
            idempotencyKey: "stage:demo:write:revision-1",
            projectId: "demo",
            projectRoot,
            workflowLine: "experiment",
            stage: "write",
            fromRole: "reviewer",
            toRole: "academic_writer",
            reason: "stage_owner_change",
            priority: "normal",
            status: "prepared",
            stageAfter: "write",
            deliveryPlan: {
              channels: ["native_runtime"],
              requireAck: false,
              ackDeadlineAt: null,
              fallbackAfterMs: 0,
              maxAttemptsTotal: 3,
              maxAttemptsByChannel: { native_runtime: 3 },
              staleClaimAfterMs: 900000,
            },
            deliveryAttempts: [],
            createdAt: "2026-04-28T05:00:11.000Z",
            updatedAt: "2026-04-28T05:00:11.000Z",
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const result = await runWorkflowHandoffMaintenancePass({
    projectRoot,
    now: new Date("2026-04-28T05:00:12.000Z"),
  });
  assert.deepEqual(result.supersededIntentIds, ["intent-duplicate"]);

  const store = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(
    store.intents.find((intent) => intent.intentId === "intent-completed")?.status,
    "completed"
  );
  assert.equal(
    store.intents.find((intent) => intent.intentId === "intent-duplicate")?.status,
    "superseded"
  );
});

test("runWorkflowHandoffMaintenancePass preserves active reissue after expired duplicate", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-handoff-reissue-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const first = await upsertWorkflowHandoffIntent({
    projectRoot,
    projectId: "demo",
    idempotencyKey: "stage:demo:plan:orchestrator:revision-1",
    toRole: "orchestrator",
    reason: "stage_owner_change",
    stageBefore: "idea",
    stageAfter: "plan",
  });
  await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: first.intent.intentId,
    toStatus: "expired",
    terminalReason: "expiresAt elapsed",
  });
  const reissued = await upsertWorkflowHandoffIntent({
    projectRoot,
    projectId: "demo",
    idempotencyKey: "stage:demo:plan:orchestrator:revision-1",
    toRole: "orchestrator",
    reason: "stage_owner_change",
    stageBefore: "idea",
    stageAfter: "plan",
  });

  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "demo",
        current_stage: "idea",
        orchestration_state: {
          pending_handoff_id: reissued.intent.intentId,
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const result = await runWorkflowHandoffMaintenancePass({
    projectRoot,
    now: new Date(),
  });

  assert.deepEqual(result.supersededIntentIds, []);
  const store = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(
    store.intents.find((intent) => intent.intentId === first.intent.intentId)?.status,
    "expired"
  );
  assert.equal(
    store.intents.find((intent) => intent.intentId === reissued.intent.intentId)?.status,
    "prepared"
  );
});
