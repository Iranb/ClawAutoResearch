import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  acknowledgeWorkflowMailboxMessage,
  queueWorkflowMailboxMessage,
  readWorkflowMailbox,
} from "../tools/workflow-collaboration/mailbox";
import {
  getWorkflowContactCooldown,
  recordWorkflowContactEvent,
} from "../tools/workflow-collaboration/contacts";
import {
  maybeQueueAutoIteratorMailbox,
  resolveWorkflowHandoffPolicy,
} from "../tools/workflow-collaboration/handoff-policy";

test("workflow collaboration mailbox kernel dedupes, reads, and acknowledges mailbox items", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-collaboration-kernel-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const first = await queueWorkflowMailboxMessage({
    projectRoot,
    fromAgent: "researcher",
    toAgent: "orchestrator",
    subject: "auto-iterator: plan owner handoff",
    body: "Please resume plan stage.",
    kind: "handoff",
    priority: "high",
  });
  const duplicate = await queueWorkflowMailboxMessage({
    projectRoot,
    fromAgent: "researcher",
    toAgent: "orchestrator",
    subject: "auto-iterator: plan owner handoff",
    body: "Please resume plan stage.",
    kind: "handoff",
    priority: "high",
  });

  assert.equal(duplicate.id, first.id);
  const mailbox = await readWorkflowMailbox(projectRoot);
  assert.equal(mailbox.messages.length, 1);

  const acknowledged = await acknowledgeWorkflowMailboxMessage({
    projectRoot,
    messageId: first.id,
    agentId: "orchestrator",
  });
  assert.equal(acknowledged?.status, "acknowledged");
});

test("workflow collaboration kernel enforces contact cooldowns for mailbox handoffs", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-collaboration-cooldown-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await recordWorkflowContactEvent({
    projectRoot,
    fromAgent: "researcher",
    toAgent: "orchestrator",
    channel: "mailbox",
  });
  const cooldown = await getWorkflowContactCooldown({
    projectRoot,
    fromAgent: "researcher",
    toAgent: "orchestrator",
    cooldownSeconds: 30,
  });
  assert.equal(cooldown.blocked, true);

  const queued = await maybeQueueAutoIteratorMailbox({
    projectRoot,
    fromRole: "researcher",
    toRole: "orchestrator",
    stage: "plan",
    nextAction: "Finish the planning packet.",
    missingStageSignals: ["plan alternatives missing"],
    cooldownSeconds: 30,
  });
  assert.equal(queued.queued, false);
  assert.ok((queued.cooldownRemainingSeconds ?? 0) > 0);
});

test("workflow collaboration handoff policy prefers runtime dispatch when available", () => {
  assert.deepEqual(
    resolveWorkflowHandoffPolicy({
      fromRole: "researcher",
      toRole: "reviewer",
      runtimeAvailable: true,
    }),
    {
      canMailboxHandoff: true,
      shouldPreferMailbox: false,
      shouldPreferRuntimeDispatch: true,
    }
  );
});
