import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { applyWorkflowBroadcastBudget } from "../../../tools/workflow-handoff/broadcast-budget.ts";

test("broadcast budget materializes oversized payloads and returns compact pointer", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-broadcast-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await applyWorkflowBroadcastBudget({
    projectRoot,
    projectId: "demo",
    sessionKey: "agent:researcher:main",
    broadcastId: "broadcast-demo",
    idempotencyKey: "broadcast-demo",
    message: `WORKFLOW_STAGE_BROADCAST=1\n${"x".repeat(4000)}`,
    summary: "Large workflow update",
    maxInlineChars: 800,
  });

  assert.equal(result.budget.truncated, true);
  assert.equal(result.budget.deliveryMode, "payload_pointer");
  assert.ok(result.budget.payloadPath);
  assert.match(result.message, /Full update payload:/);
  const fullPayload = await fs.readFile(result.budget.payloadPath, "utf8");
  assert.match(fullPayload, /xxxx/);
});
