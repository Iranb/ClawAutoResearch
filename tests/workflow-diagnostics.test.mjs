import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  appendWorkflowDiagnosticEvent,
  getWorkflowDiagnosticsArchiveLogPath,
  getWorkflowDiagnosticsLogPath,
  readWorkflowDiagnosticEventTail,
  readWorkflowDiagnosticEvents,
} from "../tools/workflow-diagnostics.ts";

function buildLargeDetails(label) {
  return {
    marker: label,
    payload: `${label}:${"x".repeat(220)}`,
  };
}

test("workflow diagnostics rotates the active log once the size budget is exceeded", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-workflow-diagnostics-")
  );
  const previousMaxBytes = process.env.OPENCLAW_WORKFLOW_DIAGNOSTICS_MAX_BYTES;
  const previousMaxArchives = process.env.OPENCLAW_WORKFLOW_DIAGNOSTICS_MAX_ARCHIVES;
  process.env.OPENCLAW_WORKFLOW_DIAGNOSTICS_MAX_BYTES = "280";
  process.env.OPENCLAW_WORKFLOW_DIAGNOSTICS_MAX_ARCHIVES = "2";

  t.after(async () => {
    if (previousMaxBytes === undefined) {
      delete process.env.OPENCLAW_WORKFLOW_DIAGNOSTICS_MAX_BYTES;
    } else {
      process.env.OPENCLAW_WORKFLOW_DIAGNOSTICS_MAX_BYTES = previousMaxBytes;
    }
    if (previousMaxArchives === undefined) {
      delete process.env.OPENCLAW_WORKFLOW_DIAGNOSTICS_MAX_ARCHIVES;
    } else {
      process.env.OPENCLAW_WORKFLOW_DIAGNOSTICS_MAX_ARCHIVES = previousMaxArchives;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await appendWorkflowDiagnosticEvent({
    projectRoot,
    projectId: "demo-project",
    component: "auto_iterator",
    action: "first",
    status: "started",
    summary: "first event",
    details: buildLargeDetails("first"),
  });
  await appendWorkflowDiagnosticEvent({
    projectRoot,
    projectId: "demo-project",
    component: "auto_iterator",
    action: "second",
    status: "completed",
    summary: "second event",
    details: buildLargeDetails("second"),
  });

  const currentLog = await fs.readFile(
    getWorkflowDiagnosticsLogPath({ projectRoot }),
    "utf8"
  );
  const archiveLog = await fs.readFile(
    getWorkflowDiagnosticsArchiveLogPath({ projectRoot, index: 1 }),
    "utf8"
  );
  assert.match(currentLog, /"action":"second"/);
  assert.doesNotMatch(currentLog, /"action":"first"/);
  assert.match(archiveLog, /"action":"first"/);

  const currentEvents = await readWorkflowDiagnosticEvents(projectRoot);
  assert.equal(currentEvents.length, 1);
  assert.equal(currentEvents[0].action, "second");
});

test("workflow diagnostics tail spans active log and archives after rotation", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-workflow-diagnostics-tail-")
  );
  const previousMaxBytes = process.env.OPENCLAW_WORKFLOW_DIAGNOSTICS_MAX_BYTES;
  const previousMaxArchives = process.env.OPENCLAW_WORKFLOW_DIAGNOSTICS_MAX_ARCHIVES;
  process.env.OPENCLAW_WORKFLOW_DIAGNOSTICS_MAX_BYTES = "280";
  process.env.OPENCLAW_WORKFLOW_DIAGNOSTICS_MAX_ARCHIVES = "3";

  t.after(async () => {
    if (previousMaxBytes === undefined) {
      delete process.env.OPENCLAW_WORKFLOW_DIAGNOSTICS_MAX_BYTES;
    } else {
      process.env.OPENCLAW_WORKFLOW_DIAGNOSTICS_MAX_BYTES = previousMaxBytes;
    }
    if (previousMaxArchives === undefined) {
      delete process.env.OPENCLAW_WORKFLOW_DIAGNOSTICS_MAX_ARCHIVES;
    } else {
      process.env.OPENCLAW_WORKFLOW_DIAGNOSTICS_MAX_ARCHIVES = previousMaxArchives;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  for (const marker of ["first", "second", "third"]) {
    await appendWorkflowDiagnosticEvent({
      projectRoot,
      projectId: "demo-project",
      component: "dispatch",
      action: marker,
      status: "completed",
      summary: `${marker} event`,
      details: buildLargeDetails(marker),
    });
  }

  const tail = await readWorkflowDiagnosticEventTail({
    projectRoot,
    tailLines: 3,
  });
  assert.equal(tail.exists, true);
  assert.equal(tail.lineCount, 3);

  const parsedTail = tail.tail.map((line) => JSON.parse(line));
  assert.deepEqual(
    parsedTail.map((entry) => entry.action),
    ["first", "second", "third"]
  );
});
