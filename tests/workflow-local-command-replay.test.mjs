import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import { dispatchWorkflowCommand } from "../scripts/workflow_command_harness_lib.mjs";

const execFile = promisify(execFileCb);

test("local workflow harness starts /auto-research without discord context", async (t) => {
  const projectsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-local-research-"));
  const scriptPath = path.join(process.cwd(), "scripts", "run_local_workflow_command.mjs");

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  const { stdout } = await execFile(process.execPath, [
    scriptPath,
    "--command",
    "auto-research",
    "--args",
    '"Generalized Category Discovery"',
    "--projects-root",
    projectsRoot,
    "--channel",
    "local",
    "--conversation-id",
    "gcd-local-research",
  ]);
  const output = JSON.parse(stdout);

  assert.match(output.result.text, /Full-auto research pipeline started/);
  assert.equal(output.sessionKey, "agent:researcher:local:gcd-local-research");
  const entries = await fs.readdir(projectsRoot);
  const projectDir = entries.find((entry) =>
    entry.includes("generalized-category-discovery")
  );
  assert.ok(projectDir);
  for (const relativePath of [
    "PROJECT_MANIFEST.json",
    "TRACK_REGISTRY.json",
    "CLAIM_POLICY.md",
    path.join("researcher", "EXPERIMENT_LEDGER.json"),
    path.join("researcher", "idle-research", "IDLE_RESEARCH.json"),
  ]) {
    await fs.access(path.join(projectsRoot, projectDir, relativePath));
  }
});

test("local workflow harness starts /auto-review without discord context", async (t) => {
  const projectsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-local-review-"));
  const scriptPath = path.join(process.cwd(), "scripts", "run_local_workflow_command.mjs");

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  const { stdout } = await execFile(process.execPath, [
    scriptPath,
    "--command",
    "auto-review",
    "--args",
    '"Generalized Category Discovery"',
    "--projects-root",
    projectsRoot,
    "--channel",
    "local",
    "--conversation-id",
    "gcd-local-review",
  ]);
  const output = JSON.parse(stdout);

  assert.match(output.result.text, /Full-auto survey pipeline started/);
  assert.equal(output.sessionKey, "agent:researcher:local:gcd-local-review");
  const entries = await fs.readdir(projectsRoot);
  const projectDir = entries.find((entry) =>
    entry.startsWith("survey-generalized-category-discovery")
  );
  assert.ok(projectDir);
  for (const relativePath of [
    "PROJECT_MANIFEST.json",
    "TRACK_REGISTRY.json",
    "CLAIM_POLICY.md",
    path.join("researcher", "EXPERIMENT_LEDGER.json"),
    path.join("researcher", "idle-research", "IDLE_RESEARCH.json"),
  ]) {
    await fs.access(path.join(projectsRoot, projectDir, relativePath));
  }
});

test("local workflow harness live mode starts the real background runtime", async (t) => {
  const projectsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-local-live-research-"));
  const runCalls = [];

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  const output = await dispatchWorkflowCommand({
    commandName: "auto-research",
    args: '"Generalized Category Discovery"',
    projectsRoot,
    sessionKey: "agent:researcher:local:conversation:gcd-local-live",
    channel: "local",
    from: "local:conversation:gcd-local-live",
    to: "local:conversation:gcd-local-live",
    accountId: "default",
    contextExtras: {
      sessionKey: "agent:researcher:local:conversation:gcd-local-live",
      conversationId: "gcd-local-live",
      originatingChannel: "local",
      originatingTo: "conversation:gcd-local-live",
      channelKey: "binding:local:default:gcd-local-live",
    },
    backgroundExecutionMode: "live",
    runtimeSubagent: {
      async run(params) {
        runCalls.push(params);
        return {
          runId: `run-${runCalls.length}`,
          sessionId: `session-${runCalls.length}`,
          runtime: "test-runtime",
        };
      },
      async waitForRun() {
        return { status: "ok" };
      },
      async getSessionMessages() {
        return { messages: [] };
      },
      async inspectSession() {
        return null;
      },
    },
  });

  assert.match(output.result.text, /Full-auto research pipeline started/);
  assert.equal(output.backgroundRuns[0]?.started?.started, true);
  assert.equal(output.backgroundRuns[0]?.started?.queued, false);
  assert.equal(runCalls.length, 1);
  assert.match(runCalls[0].sessionKey, /^agent:researcher:local:conversation:gcd-local-live:subagent:workflow-research-pipeline:/);
  assert.match(output.backgroundRuns[0]?.started?.sessionKey, /^agent:researcher:local:conversation:gcd-local-live:subagent:workflow-research-pipeline:/);
  assert.match(runCalls[0].message, /^\/research-pipeline "Generalized Category Discovery"/);
});
