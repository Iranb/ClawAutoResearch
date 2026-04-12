import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { deliverWorkflowHandoffIntent } from "../tools/workflow-handoff/handoff-delivery.ts";
import {
  readWorkflowHandoffIntentStore,
  upsertWorkflowHandoffIntent,
} from "../tools/workflow-handoff/handoff-store.ts";

test("deliverWorkflowHandoffIntent records native delivery and waits for ack", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-delivery-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  const created = await upsertWorkflowHandoffIntent({
    projectRoot,
    idempotencyKey: "deliver-native",
    toRole: "coder",
    reason: "stage_owner_change",
    deliveryPlan: {
      channels: ["native_runtime"],
      maxAttemptsTotal: 2,
    },
  });

  const result = await deliverWorkflowHandoffIntent({
    intent: created.intent,
    runtime: {
      async nativeDispatch() {
        return {
          ok: true,
          runId: "run-1",
          sessionKey: "agent:coder:main",
        };
      },
    },
  });

  assert.equal(result.delivered, true);
  assert.equal(result.intent.status, "delivered");
  const store = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(store.intents[0].deliveryAttempts[0].channel, "native_runtime");
  assert.equal(store.intents[0].deliveryAttempts[0].status, "delivered");
});

test("deliverWorkflowHandoffIntent treats Lobster dry-run as non-delivery", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-delivery-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  const created = await upsertWorkflowHandoffIntent({
    projectRoot,
    idempotencyKey: "deliver-lobster-dry-run",
    toRole: "coder",
    reason: "stage_owner_change",
    deliveryPlan: {
      channels: ["lobster"],
      maxAttemptsTotal: 2,
    },
  });

  const result = await deliverWorkflowHandoffIntent({
    intent: created.intent,
    lobsterMode: "dry_run",
    runtime: {
      async lobsterDispatch() {
        return {
          ok: true,
          dryRun: true,
        };
      },
    },
  });

  assert.equal(result.delivered, false);
  assert.equal(result.intent.status, "failed");
  const store = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(store.intents[0].deliveryAttempts[0].status, "skipped");
});

test("deliverWorkflowHandoffIntent falls back from native failure to runtime queue", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-delivery-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  const created = await upsertWorkflowHandoffIntent({
    projectRoot,
    idempotencyKey: "deliver-native-to-queue",
    toRole: "coder",
    reason: "stage_owner_change",
    deliveryPlan: {
      channels: ["native_runtime", "runtime_queue"],
      maxAttemptsTotal: 3,
    },
  });

  const result = await deliverWorkflowHandoffIntent({
    intent: created.intent,
    runtime: {
      async nativeDispatch() {
        return { ok: false, error: "runtime unavailable" };
      },
      async runtimeQueue() {
        return { ok: true, queueKey: "queue-1" };
      },
    },
  });

  assert.equal(result.delivered, true);
  assert.equal(result.intent.status, "queued");
  const store = await readWorkflowHandoffIntentStore(projectRoot);
  assert.deepEqual(
    store.intents[0].deliveryAttempts.map((attempt) => [attempt.channel, attempt.status]),
    [
      ["native_runtime", "failed"],
      ["runtime_queue", "delivered"],
    ]
  );
});

test("deliverWorkflowHandoffIntent escalates when all automatic delivery channels fail", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-delivery-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  const created = await upsertWorkflowHandoffIntent({
    projectRoot,
    idempotencyKey: "deliver-human-escalation",
    toRole: "coder",
    reason: "stage_owner_change",
    deliveryPlan: {
      channels: ["native_runtime", "channel_broadcast", "runtime_queue", "human_escalation"],
      maxAttemptsTotal: 5,
    },
  });

  const result = await deliverWorkflowHandoffIntent({
    intent: created.intent,
    runtime: {
      async nativeDispatch() {
        return { ok: false, error: "runtime unavailable" };
      },
      async channelBroadcast() {
        return { ok: false, error: "broadcast unavailable" };
      },
      async runtimeQueue() {
        return { ok: false, error: "queue unavailable" };
      },
    },
  });

  assert.equal(result.terminal, true);
  assert.equal(result.intent.status, "escalated");
  assert.equal(result.intent.terminalReason, "human_escalation");
  const store = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(store.intents[0].deliveryAttempts.at(-1).channel, "human_escalation");
});
