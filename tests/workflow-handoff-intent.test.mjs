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
import { buildStageOwnerHandoffIdempotencyKey } from "../tools/workflow-handoff/handoff-router.ts";

test("stage owner handoff idempotency is stable across command text when manifest revision is bound", () => {
  const base = {
    projectId: "demo",
    workflowLine: "experiment",
    stageAfter: "plan",
    ownerAfter: "orchestrator",
    manifestRevision: "execution-1",
  };

  assert.equal(
    buildStageOwnerHandoffIdempotencyKey({
      ...base,
      nextAction: "Run /plan-research using IDEA_REPORT.md.",
    }),
    buildStageOwnerHandoffIdempotencyKey({
      ...base,
      nextAction: "/plan-research",
    })
  );
  assert.notEqual(
    buildStageOwnerHandoffIdempotencyKey({
      ...base,
      routeRevision: "route-a",
      nextAction: "Run /plan-research using IDEA_REPORT.md.",
    }),
    buildStageOwnerHandoffIdempotencyKey({
      ...base,
      routeRevision: "route-b",
      nextAction: "Run /plan-research using IDEA_REPORT.md.",
    })
  );
});

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

test("handoff intent store reuses terminal intents by idempotency key", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-handoff-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const created = await upsertWorkflowHandoffIntent({
    projectRoot,
    projectId: "demo",
    idempotencyKey: "stage:demo:write:academic_writer:revision-1",
    toRole: "academic_writer",
    reason: "stage_owner_change",
    stage: "write",
  });
  await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: created.intent.intentId,
    toStatus: "claimed",
  });
  const completed = await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: created.intent.intentId,
    toStatus: "completed",
    terminalReason: "writer finished",
  });
  const repeated = await upsertWorkflowHandoffIntent({
    projectRoot,
    projectId: "demo",
    idempotencyKey: "stage:demo:write:academic_writer:revision-1",
    toRole: "academic_writer",
    reason: "stage_owner_change",
    stage: "write",
  });

  assert.equal(repeated.created, false);
  assert.equal(repeated.intent.intentId, completed.intentId);
  assert.equal(repeated.intent.status, "completed");
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

test("handoff status machine accepts fast local claim completion", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-handoff-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const created = await upsertWorkflowHandoffIntent({
    projectRoot,
    idempotencyKey: "local-claim-complete",
    toRole: "researcher",
    reason: "stage_owner_change",
    stage: "review",
  });
  const claimed = await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: created.intent.intentId,
    toStatus: "claimed",
  });
  assert.equal(claimed?.status, "claimed");
  const completed = await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: created.intent.intentId,
    toStatus: "completed",
    terminalReason: "local no-discord worker finished synchronously",
  });
  assert.equal(completed?.status, "completed");
  assert.equal(isWorkflowHandoffTerminalStatus(completed.status), true);
  assert.equal(canTransitionWorkflowHandoffStatus({ from: "claimed", to: "completed" }), true);
});
