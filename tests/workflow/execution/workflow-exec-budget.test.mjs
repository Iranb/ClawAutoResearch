import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  isExecApprovalRequiredError,
  isWorkflowCommandTooLong,
  summarizeExecPayloadForDispatch,
} from "../../../tools/workflow-execution/exec-budget.ts";
import { materializeExecPacketIfNeeded } from "../../../tools/workflow-execution/exec-packet.ts";

test("workflow exec budget identifies long command payloads", () => {
  assert.equal(isWorkflowCommandTooLong("echo ok"), false);
  assert.equal(isWorkflowCommandTooLong("x".repeat(2000)), true);
  assert.match(summarizeExecPayloadForDispatch("x".repeat(2000)), /\.\.\.$/);
});

test("workflow exec packet materializes long commands into project-local files", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-exec-packet-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await materializeExecPacketIfNeeded({
    projectRoot,
    projectId: "demo-project",
    stage: "graph_build",
    ownerRole: "researcher",
    commandText: `node ${"x".repeat(2000)}`,
    budgetKind: "dispatch_command",
  });
  assert.equal(result.materialized, true);
  assert.ok(result.packet?.packetPath);
  assert.match(result.commandForDispatch, /Use file-backed exec packet/);
  assert.doesNotMatch(result.commandForDispatch, /x{500}/);

  const packetPath = path.join(projectRoot, result.packet.packetPath);
  const scriptPath = path.join(projectRoot, result.packet.scriptPath);
  const packet = JSON.parse(await fs.readFile(packetPath, "utf8"));
  const script = await fs.readFile(scriptPath, "utf8");
  assert.equal(packet.projectId, "demo-project");
  assert.match(script, /node x+/);
});

test("workflow exec budget recognizes OpenClaw exec approval errors", () => {
  assert.equal(
    isExecApprovalRequiredError(
      new Error("Obfuscated command detected: Command too long; potential obfuscation")
    ),
    true
  );
  assert.equal(isExecApprovalRequiredError(new Error("ordinary runtime error")), false);
});
