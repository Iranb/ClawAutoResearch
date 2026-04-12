import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createWorkflowRepairQueueItem,
  readWorkflowRepairQueueStore,
} from "../tools/workflow-handoff/repair-queue.ts";
import {
  downgradeWorkflowAgentCapability,
  selectWorkflowCapableSession,
  upsertWorkflowAgentCapability,
} from "../tools/workflow-handoff/agent-capabilities.ts";
import {
  claimWorkflowWriteScope,
  releaseStaleWorkflowWriteScopes,
} from "../tools/workflow-handoff/write-scope.ts";
import {
  transitionWorkflowHandoffIntent,
  upsertWorkflowHandoffIntent,
} from "../tools/workflow-handoff/handoff-store.ts";
import { runWorkflowHandoffMaintenancePass } from "../tools/workflow-handoff/maintenance.ts";

test("repair queue dedupes active failures and caps repair depth", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-repair-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const first = await createWorkflowRepairQueueItem({
    projectRoot,
    failureKind: "verification_failed",
    failureReason: "missing benchmark lock",
    verificationRule: "benchmark_protocol",
    repairOwner: "orchestrator",
  });
  const second = await createWorkflowRepairQueueItem({
    projectRoot,
    failureKind: "verification_failed",
    failureReason: "missing benchmark lock",
    verificationRule: "benchmark_protocol",
    repairOwner: "orchestrator",
  });
  const escalated = await createWorkflowRepairQueueItem({
    projectRoot,
    failureKind: "verification_failed",
    failureReason: "new failure kind",
    repairOwner: "orchestrator",
    repairDepth: 2,
    maxRepairDepth: 2,
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.item.repairId, second.item.repairId);
  assert.equal(escalated.item.status, "escalated");
  const store = await readWorkflowRepairQueueStore(projectRoot);
  assert.equal(store.items.length, 2);
});

test("capability downgrade prevents selecting stale incapable sessions", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cap-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await upsertWorkflowAgentCapability({
    projectRoot,
    sessionKey: "agent:researcher:main",
    role: "researcher",
    canUseResearchWorkflow: true,
    confidence: "high",
  });
  assert.equal(
    (await selectWorkflowCapableSession({
      projectRoot,
      role: "researcher",
      requiresResearchWorkflow: true,
    }))?.sessionKey,
    "agent:researcher:main"
  );

  await downgradeWorkflowAgentCapability({
    projectRoot,
    sessionKey: "agent:researcher:main",
    reason: "research_workflow unavailable",
  });
  assert.equal(
    await selectWorkflowCapableSession({
      projectRoot,
      role: "researcher",
      requiresResearchWorkflow: true,
    }),
    null
  );
});

test("write-scope blocks active conflicts and releases stale leases", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-scope-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const first = await claimWorkflowWriteScope({
    projectRoot,
    sessionKey: "agent:coder:one",
    mode: "exclusive_write",
    exclusiveFiles: ["PROJECT_MANIFEST.json"],
    leaseTtlMs: 50,
  });
  const conflict = await claimWorkflowWriteScope({
    projectRoot,
    sessionKey: "agent:coder:two",
    mode: "exclusive_write",
    exclusiveFiles: ["PROJECT_MANIFEST.json"],
  });
  assert.equal(first.claimed, true);
  assert.equal(conflict.claimed, false);
  assert.equal(conflict.conflicts.length, 1);

  await new Promise((resolve) => setTimeout(resolve, 75));
  const released = await releaseStaleWorkflowWriteScopes({ projectRoot });
  assert.equal(released.length, 1);
  const afterRelease = await claimWorkflowWriteScope({
    projectRoot,
    sessionKey: "agent:coder:two",
    mode: "exclusive_write",
    exclusiveFiles: ["PROJECT_MANIFEST.json"],
  });
  assert.equal(afterRelease.claimed, true);
});

test("handoff maintenance turns ack timeouts and stale claims into bounded states", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-maint-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  const now = new Date();
  const ack = await upsertWorkflowHandoffIntent({
    projectRoot,
    idempotencyKey: "ack-timeout",
    toRole: "coder",
    reason: "stage_owner_change",
    deliveryPlan: {
      ackDeadlineAt: new Date(now.getTime() - 1000).toISOString(),
    },
  });
  await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: ack.intent.intentId,
    toStatus: "dispatching",
  });
  await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: ack.intent.intentId,
    toStatus: "delivered",
  });

  const stale = await upsertWorkflowHandoffIntent({
    projectRoot,
    idempotencyKey: "stale-claim",
    toRole: "coder",
    reason: "stage_owner_change",
  });
  await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: stale.intent.intentId,
    toStatus: "dispatching",
  });
  await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: stale.intent.intentId,
    toStatus: "delivered",
  });
  await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: stale.intent.intentId,
    toStatus: "acknowledged",
  });
  await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: stale.intent.intentId,
    toStatus: "claimed",
    patch: {
      claimLeaseExpiresAt: new Date(now.getTime() - 1000).toISOString(),
    },
  });

  const result = await runWorkflowHandoffMaintenancePass({ projectRoot, now });
  assert.deepEqual(result.ackTimeoutIntentIds, [ack.intent.intentId]);
  assert.deepEqual(result.staleClaimIntentIds, [stale.intent.intentId]);
});
