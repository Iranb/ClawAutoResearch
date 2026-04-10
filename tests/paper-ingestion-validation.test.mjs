import test from "node:test";
import assert from "node:assert/strict";

import {
  finalizeQueuedPaperIngestionAttempt,
  markQueuedPaperIngestionLaunchFailure,
} from "../tools/paper-ingestion-validation.ts";

function makeQueuedRequest(overrides = {}) {
  return {
    requestId: "req-1",
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
