import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  finalizeQueuedPaperIngestionAttempt,
  markQueuedPaperIngestionLaunchFailure,
  validateQueuedPaperIngestionRequest,
} from "../../tools/paper-ingestion-validation.ts";

function makeQueuedRequest(overrides = {}) {
  return {
    requestId: "req-1",
    requestKind: "upload_manifest",
    status: "queued",
    wrapper: "pn_batch_import.py",
    args: [],
    commandText: "python3 scripts/pn_batch_import.py --manifest graph/batch-import.json submit",
    manifestPath: "graph/batch-import.json",
    sharedCorpus: "GCD",
    paperCount: 2,
    summary: "demo import",
    createdAt: "2026-04-10T01:00:00.000Z",
    updatedAt: "2026-04-10T01:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    lastRunId: null,
    lastSessionKey: null,
    lastError: null,
    detail: null,
    triggerKind: null,
    progress: null,
    queueProgress: null,
    validationStatus: "valid",
    validationSummary: "Validated 2 staged paper source(s): 2 valid, 0 warning, 0 invalid.",
    validationReportPath: "/tmp/validation.json",
    attemptCount: 0,
    maxAttempts: 3,
    lastAttemptAt: null,
    nextRetryAt: null,
    deadLetterAt: null,
    deadLetterReason: null,
    ...overrides,
  };
}

test("markQueuedPaperIngestionLaunchFailure dead-letters the request after the bounded retry budget is exhausted", () => {
  const request = makeQueuedRequest({
    status: "needs_repair",
    attemptCount: 2,
    maxAttempts: 3,
  });
  const updated = markQueuedPaperIngestionLaunchFailure({
    request,
    nowIso: "2026-04-10T02:00:00.000Z",
    error: "Manifest validation keeps failing.",
  });

  assert.equal(updated.status, "failed");
  assert.equal(updated.attemptCount, 3);
  assert.equal(updated.deadLetterAt, "2026-04-10T02:00:00.000Z");
  assert.match(updated.deadLetterReason ?? "", /validation/i);
});

test("finalizeQueuedPaperIngestionAttempt requeues a failed background run for bounded repair before dead-lettering", () => {
  const request = makeQueuedRequest({
    status: "running",
    attemptCount: 1,
    maxAttempts: 3,
    startedAt: "2026-04-10T01:30:00.000Z",
  });
  const updated = finalizeQueuedPaperIngestionAttempt({
    request,
    terminalStatus: "failed",
    finishedAt: "2026-04-10T02:15:00.000Z",
    error: "Remote import worker timed out.",
  });

  assert.equal(updated.status, "needs_repair");
  assert.equal(updated.deadLetterAt, null);
  assert.equal(typeof updated.nextRetryAt, "string");
  assert.match(updated.detail ?? "", /bounded repair/i);
});

test("finalizeQueuedPaperIngestionAttempt requeues completed batch wrapper exits for remote wait", () => {
  const request = makeQueuedRequest({
    status: "running",
    attemptCount: 1,
    args: ["--manifest", "graph/batch-import.json", "submit"],
    commandText:
      "python3 skills/researcher/papernexus/scripts/pn_batch_import.py --manifest graph/batch-import.json submit",
  });
  const updated = finalizeQueuedPaperIngestionAttempt({
    request,
    terminalStatus: "completed",
    finishedAt: "2026-04-10T02:15:00.000Z",
    error: null,
  });

  assert.equal(updated.status, "queued");
  assert.match(updated.commandText ?? "", /\bwait\b/);
  assert.match(updated.detail ?? "", /remote import completion is not implied/i);
});

test("validateQueuedPaperIngestionRequest treats literature discovery scaffolds as requisitions instead of broken upload manifests", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-paper-ingestion-validation-")
  );
  const manifestPath = path.join(
    projectRoot,
    "researcher",
    "literature-discovery",
    "requisition",
    "demo",
    "DISCOVERY_REQUISITION.json"
  );
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        version: 1,
        defaults: {
          corpus: "GCD",
        },
        papers: [],
        literature_discovery: {
          discovery_id: "demo",
          selected_papers: [],
          candidate_queries: [
            {
              domain: "current-domain",
              query: "graph grounded gap repair",
            },
          ],
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const report = await validateQueuedPaperIngestionRequest({
    projectRoot,
    request: makeQueuedRequest({
      manifestPath: path.relative(projectRoot, manifestPath),
      triggerKind: "literature_discovery",
      requestKind: null,
    }),
  });

  assert.equal(report.requestKind, "requisition");
  assert.equal(report.status, "warning");
  assert.equal(report.invalidCount, 0);
  assert.equal(report.warningCount, 1);
  assert.match(report.summary, /requisition/i);
  assert.equal(report.entries[0]?.issues[0]?.code, "requisition_not_upload_ready");
});
