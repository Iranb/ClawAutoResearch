import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createWorkflowInboundBudgetContext,
  getWorkflowInboundTurnsPath,
  readWorkflowInboundTurnRecords,
  readWorkflowInboundTurnTail,
  recordWorkflowInboundTurnCompleted,
  recordWorkflowInboundTurnStarted,
} from "../../../tools/workflow-handoff/inbound-budget.ts";

test("inbound budget records deferred turns without mutating workflow state", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-inbound-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const context = createWorkflowInboundBudgetContext({
    projectRoot,
    projectId: "demo",
    channelKey: "discord:channel:1",
    sessionKey: "agent:researcher:main",
    agentId: "researcher",
    action: "auto_iterator_tick",
    inboundBudgetMs: 100,
  });
  await recordWorkflowInboundTurnStarted(context);
  await recordWorkflowInboundTurnCompleted({
    context,
    status: "deferred",
    deferredQueueKey: "queue-1",
  });

  const records = await readWorkflowInboundTurnRecords(projectRoot);
  assert.equal(records.length, 2);
  assert.equal(records[0].status, "started");
  assert.equal(records[1].status, "deferred");
  assert.equal(records[1].deferredQueueKey, "queue-1");
});

test("inbound budget coalesces duplicate active turns for same project channel action", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-inbound-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  const first = createWorkflowInboundBudgetContext({
    projectRoot,
    projectId: "demo",
    channelKey: "discord:channel:1",
    sessionKey: "agent:researcher:main",
    action: "get_snapshot",
    inboundBudgetMs: 10_000,
  });
  const second = createWorkflowInboundBudgetContext({
    projectRoot,
    projectId: "demo",
    channelKey: "discord:channel:1",
    sessionKey: "agent:researcher:main",
    action: "get_snapshot",
    inboundBudgetMs: 10_000,
  });
  await recordWorkflowInboundTurnStarted(first);
  await recordWorkflowInboundTurnStarted(second);
  const records = await readWorkflowInboundTurnRecords(projectRoot);
  assert.equal(records.length, 1);
  assert.equal(second.turn.turnId, first.turn.turnId);
});

test("inbound budget log rotates and tail spans archives", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-inbound-"));
  const previousMaxBytes = process.env.OPENCLAW_WORKFLOW_INBOUND_TURNS_MAX_BYTES;
  const previousMaxArchives = process.env.OPENCLAW_WORKFLOW_INBOUND_TURNS_MAX_ARCHIVES;
  process.env.OPENCLAW_WORKFLOW_INBOUND_TURNS_MAX_BYTES = "280";
  process.env.OPENCLAW_WORKFLOW_INBOUND_TURNS_MAX_ARCHIVES = "8";

  t.after(async () => {
    if (previousMaxBytes === undefined) {
      delete process.env.OPENCLAW_WORKFLOW_INBOUND_TURNS_MAX_BYTES;
    } else {
      process.env.OPENCLAW_WORKFLOW_INBOUND_TURNS_MAX_BYTES = previousMaxBytes;
    }
    if (previousMaxArchives === undefined) {
      delete process.env.OPENCLAW_WORKFLOW_INBOUND_TURNS_MAX_ARCHIVES;
    } else {
      process.env.OPENCLAW_WORKFLOW_INBOUND_TURNS_MAX_ARCHIVES = previousMaxArchives;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  for (const action of ["first", "second", "third"]) {
    const context = createWorkflowInboundBudgetContext({
      projectRoot,
      projectId: "demo",
      channelKey: "discord:channel:1",
      sessionKey: "agent:researcher:main",
      action,
      inboundBudgetMs: 100,
    });
    await recordWorkflowInboundTurnStarted(context);
    await recordWorkflowInboundTurnCompleted({
      context,
      status: "completed_inline",
    });
  }

  const activePath = getWorkflowInboundTurnsPath(projectRoot);
  const archivePath = activePath.replace(/\.jsonl$/, ".1.jsonl");
  await fs.access(archivePath);

  const tail = await readWorkflowInboundTurnTail({
    projectRoot,
    tailLines: 6,
  });
  assert.equal(tail.exists, true);
  assert.equal(tail.lineCount, 6);
  const parsed = tail.tail.map((line) => JSON.parse(line));
  assert.deepEqual(
    parsed.map((entry) => entry.action),
    ["first", "first", "second", "second", "third", "third"]
  );
});
