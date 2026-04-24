import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import {
  normalizeAutoWorkflowCommand,
  normalizeAutoWorkflowMode,
} from "../scripts/run_auto_workflow_e2e_test.mjs";

const execFile = promisify(execFileCb);

test("auto workflow E2E runner normalizes user-facing command aliases", () => {
  assert.deepEqual(normalizeAutoWorkflowCommand("/autoresearch"), {
    requestedCommand: "/autoresearch",
    canonicalCommand: "auto-research",
    displayCommand: "/auto-research",
    lane: "experiment",
  });
  assert.deepEqual(normalizeAutoWorkflowCommand("autoreview"), {
    requestedCommand: "autoreview",
    canonicalCommand: "auto-review",
    displayCommand: "/auto-review",
    lane: "survey",
  });
  assert.equal(normalizeAutoWorkflowCommand("full").lane, "full");
  assert.equal(normalizeAutoWorkflowMode("real"), "live");
  assert.equal(normalizeAutoWorkflowMode("deterministic"), "fixture");
});

test("auto workflow E2E runner creates a durable local summary for /autoresearch", async (t) => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-auto-workflow-runner-"));
  t.after(() => fs.rm(runRoot, { recursive: true, force: true }));

  const { stdout } = await execFile(
    process.execPath,
    [
      path.join(process.cwd(), "scripts", "run_auto_workflow_e2e_test.mjs"),
      "--command",
      "/autoresearch",
      "--topic",
      "Generalized Category Discovery",
      "--mode",
      "fixture",
      "--bootstrap-transport",
      "local",
      "--run-root",
      runRoot,
      "--json",
    ],
    { maxBuffer: 20 * 1024 * 1024 }
  );
  const payload = JSON.parse(stdout);

  assert.equal(payload.status, "pass");
  assert.equal(payload.command.canonicalCommand, "auto-research");
  assert.equal(payload.command.lane, "experiment");
  assert.equal(payload.mode, "fixture");
  assert.equal(payload.bootstrapTransport, "local");
  assert.match(payload.conversationId, /^e2e-/);
  assert.equal(payload.result.conversationId, payload.conversationId);
  assert.equal(payload.result.lanes.length, 1);
  assert.equal(payload.result.lanes[0].lane, "experiment");
  assert.equal(payload.result.lanes[0].conversationId, payload.conversationId);
  assert.equal(payload.result.lanes[0].finalVerdict, "pass");
  assert.match(payload.result.lanes[0].projectRoot, /generalized-category-discovery/);

  await fs.access(payload.summaryPath);
  await fs.access(payload.markdownSummaryPath);
  await fs.access(payload.stdoutPath);
  await fs.access(payload.stderrPath);
  await fs.access(payload.payloadPath);
  await fs.access(path.join(payload.result.lanes[0].projectRoot, ".openclaw-research", "E2E_RUN_REPORT.md"));
});
