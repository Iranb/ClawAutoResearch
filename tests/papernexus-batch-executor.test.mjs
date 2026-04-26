import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { executePapernexusBatchImportRequest } from "../tools/papernexus-batch-executor.ts";

async function writeFakeBatchScript(scriptDir, scenario) {
  await fs.mkdir(scriptDir, { recursive: true });
  const scriptPath = path.join(scriptDir, "pn_batch_import.py");
  await fs.writeFile(
    scriptPath,
    [
      "#!/usr/bin/env python3",
      "import json, sys",
      `scenario = json.loads(${JSON.stringify(JSON.stringify(scenario))})`,
      "args = sys.argv[1:]",
      "subcommand = next((arg for arg in args if arg in ('submit', 'wait', 'status')), 'status')",
      "payload = scenario.get(subcommand, {})",
      "print(json.dumps(payload))",
      "sys.exit(int(payload.get('_exitCode', 0)))",
      "",
    ].join("\n"),
    "utf8"
  );
  await fs.chmod(scriptPath, 0o755);
}

function makeQueuedRequest(overrides = {}) {
  const manifestPath = "researcher/paper-staging/queued-imports/req-1/batch-import.json";
  return {
    requestId: "req-1",
    requestKind: "upload_manifest",
    status: "queued",
    wrapper: "pn_batch_import.py",
    args: ["--corpus", "demo", "--manifest", manifestPath, "submit"],
    commandText:
      `python3 skills/researcher/papernexus/scripts/pn_batch_import.py --corpus demo --manifest ${manifestPath} submit`,
    manifestPath,
    sharedCorpus: "demo",
    paperCount: 2,
    summary: "Test batch import",
    createdAt: null,
    updatedAt: null,
    startedAt: null,
    finishedAt: null,
    lastRunId: null,
    lastSessionKey: null,
    lastError: null,
    detail: null,
    triggerKind: "graph_build",
    progress: null,
    queueProgress: null,
    validationStatus: "valid",
    validationSummary: null,
    validationReportPath: null,
    attemptCount: 0,
    maxAttempts: 3,
    lastAttemptAt: null,
    nextRetryAt: null,
    deadLetterAt: null,
    deadLetterReason: null,
    ...overrides,
  };
}

test("PaperNexus batch executor retries submit for plain not-submitted items", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pn-batch-retry-"));
  const scriptDir = path.join(projectRoot, "scripts");
  const previousScriptDir = process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR;
  t.after(async () => {
    if (previousScriptDir === undefined) {
      delete process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR;
    } else {
      process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR = previousScriptDir;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR = scriptDir;
  await writeFakeBatchScript(scriptDir, {
    submit: {
      summary: { total: 2, submitted: 1, completed: 0, running: 1, pending: 1, failed: 0, remaining: 2 },
      items: [
        { paperId: "paper-a", canonicalId: "paper-a", taskId: "task-a", status: "running", submitted: true },
        { paperId: "paper-b", canonicalId: "paper-b", status: "not-submitted", submitted: false },
      ],
    },
    wait: {
      summary: { total: 2, submitted: 1, completed: 1, running: 0, pending: 1, failed: 0, remaining: 1 },
      items: [
        { paperId: "paper-a", canonicalId: "paper-a", taskId: "task-a", status: "completed", stage: "completed", submitted: true, synced: true },
        { paperId: "paper-b", canonicalId: "paper-b", status: "not-submitted", submitted: false },
      ],
    },
  });

  const result = await executePapernexusBatchImportRequest({
    projectRoot,
    request: makeQueuedRequest(),
    waitTimeoutSeconds: 1,
    waitIntervalSeconds: 0.1,
  });

  assert.equal(result?.request.status, "queued");
  assert.match(result?.request.commandText ?? "", /\bsubmit\b/);
  assert.equal(result?.runtimeStatus, "waiting_import");
  assert.equal(result?.repairRequired, false);
  assert.match(result?.waitingReason ?? "", /retry submit/i);
});

test("PaperNexus batch executor preserves submit-failed item errors across wait output", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pn-batch-submit-failed-"));
  const scriptDir = path.join(projectRoot, "scripts");
  const previousScriptDir = process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR;
  t.after(async () => {
    if (previousScriptDir === undefined) {
      delete process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR;
    } else {
      process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR = previousScriptDir;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR = scriptDir;
  await writeFakeBatchScript(scriptDir, {
    submit: {
      summary: { total: 2, submitted: 1, completed: 0, running: 1, pending: 0, failed: 0, submitFailed: 1, remaining: 1 },
      items: [
        { paperId: "paper-a", canonicalId: "paper-a", taskId: "task-a", status: "running", submitted: true },
        { paperId: "paper-b", canonicalId: "paper-b", status: "submit-failed", submitted: false, error: "backend rejected source" },
      ],
    },
    wait: {
      summary: { total: 2, submitted: 1, completed: 1, running: 0, pending: 0, failed: 0, remaining: 1 },
      items: [
        { paperId: "paper-a", canonicalId: "paper-a", taskId: "task-a", status: "completed", stage: "completed", submitted: true, synced: true },
        { paperId: "paper-b", canonicalId: "paper-b", status: "not-submitted", submitted: false },
      ],
    },
  });

  const result = await executePapernexusBatchImportRequest({
    projectRoot,
    request: makeQueuedRequest(),
    waitTimeoutSeconds: 1,
    waitIntervalSeconds: 0.1,
  });

  assert.equal(result?.request.status, "needs_repair");
  assert.equal(result?.runtimeStatus, "blocked");
  assert.match(result?.request.lastError ?? "", /backend rejected source/);
  assert.equal(
    result?.batchItems.find((item) => item.canonicalId === "paper-b")?.status,
    "submit_failed"
  );
});
