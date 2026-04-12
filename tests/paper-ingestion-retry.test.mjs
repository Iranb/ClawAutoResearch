import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  classifyPaperIngestionFailure,
  materializePaperIngestionRetry,
} from "../tools/paper-ingestion-failures.ts";

test("paper ingestion failure classifier treats PaperNexus race failures as retryable", () => {
  assert.equal(
    classifyPaperIngestionFailure("Source inputs changed while PaperNexus was processing").retryable,
    true
  );
  assert.equal(
    classifyPaperIngestionFailure(
      "Another PaperNexus run committed newer corpus state"
    ).retryable,
    true
  );
  assert.equal(
    classifyPaperIngestionFailure("invalid markdown: missing title").retryable,
    false
  );
});

test("paper ingestion retry materializer writes a sequential retry manifest", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-paper-retry-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const materialized = await materializePaperIngestionRetry({
    projectRoot,
    projectId: "demo-project",
    intervalSeconds: 45,
    manifest: {
      paper_ingestion: {
        batch_items: [
          {
            paper_id: "paper:1",
            title: "Retryable Paper",
            status: "failed",
            error: "Source inputs changed while PaperNexus was processing",
          },
          {
            paper_id: "paper:2",
            title: "Invalid Paper",
            status: "failed",
            error: "invalid markdown",
          },
        ],
      },
    },
  });

  assert.equal(materialized.retryableFailures.length, 1);
  assert.equal(materialized.nonRetryableFailures.length, 1);
  assert.equal(materialized.retryManifest.retryMode, "sequential");
  assert.equal(materialized.retryManifest.intervalSeconds, 45);
  assert.match(materialized.commandText, /--sequential/);

  const manifestPath = path.join(projectRoot, materialized.retryManifestPath);
  const retryManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(retryManifest.items.length, 1);
  assert.equal(retryManifest.items[0].paperId, "paper:1");
});
