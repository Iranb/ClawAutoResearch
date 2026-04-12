import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  readWorkflowHandoffIntentStore,
  transitionWorkflowHandoffIntent,
  upsertWorkflowHandoffIntent,
} from "../tools/workflow-handoff/handoff-store.ts";
import {
  canTransitionWorkflowHandoffStatus,
  isWorkflowHandoffTerminalStatus,
} from "../tools/workflow-handoff/handoff-types.ts";

test("handoff intent store dedupes active intents by idempotency key", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-handoff-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const first = await upsertWorkflowHandoffIntent({
    projectRoot,
    projectId: "demo",
    idempotencyKey: "stage:demo:plan:coder",
    toRole: "coder",
    reason: "stage_owner_change",
    stage: "code",
  });
  const second = await upsertWorkflowHandoffIntent({
    projectRoot,
    projectId: "demo",
    idempotencyKey: "stage:demo:plan:coder",
    toRole: "coder",
    reason: "stage_owner_change",
    stage: "code",
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.intent.intentId, second.intent.intentId);
  const store = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(store.intents.length, 1);
});

test("handoff status machine rejects invalid terminal transitions", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-handoff-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const created = await upsertWorkflowHandoffIntent({
    projectRoot,
    idempotencyKey: "terminal-demo",
    toRole: "researcher",
    reason: "manual_recovery",
  });
  const completed = await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: created.intent.intentId,
    toStatus: "dispatching",
  });
  assert.equal(completed?.status, "dispatching");
  const terminal = await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: created.intent.intentId,
    toStatus: "escalated",
    terminalReason: "test",
  });
  assert.equal(terminal?.status, "escalated");
  assert.equal(isWorkflowHandoffTerminalStatus(terminal.status), true);
  const rejected = await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: created.intent.intentId,
    toStatus: "queued",
  });
  assert.equal(rejected?.status, "escalated");
  assert.equal(canTransitionWorkflowHandoffStatus({ from: "escalated", to: "queued" }), false);
});
