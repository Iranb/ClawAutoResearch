import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { upsertPaperSourceIndexEntries } from "../tools/paper-source-index-writer.ts";
import { readWorkflowPaperSourceIndex } from "../tools/paper-source-index.ts";

test("paper source index writer preserves metadata-only entries and upgrades them when full text resolves", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paper-source-index-writer-"));
  await fs.mkdir(path.join(projectRoot, "researcher"), { recursive: true });
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await upsertPaperSourceIndexEntries({
    projectRoot,
    entries: [
      {
        doi: "10.1145/1234567.1234568",
        title: "Example Top Tier Paper",
        venue: "Proceedings of the ACM Something",
        year: 2024,
        retrieval_providers: ["openalex", "crossref"],
        resolution_status: "metadata_only_unresolved",
      },
    ],
  });

  await upsertPaperSourceIndexEntries({
    projectRoot,
    entries: [
      {
        doi: "10.1145/1234567.1234568",
        title: "Example Top Tier Paper",
        source_kind: "pdf",
        source_provider: "unpaywall",
        source_path: path.join(projectRoot, "researcher", "paper-staging", "pdf", "doi-10.1145-1234567.1234568.pdf"),
        retrieval_providers: ["openalex", "crossref", "unpaywall"],
        resolution_status: "resolved_pdf",
      },
    ],
  });

  const { entries } = await readWorkflowPaperSourceIndex({ projectRoot });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].doi, "10.1145/1234567.1234568");
  assert.equal(entries[0].resolutionStatus, "resolved_pdf");
  assert.equal(entries[0].sourceKind, "pdf");
  assert.equal(entries[0].sourceProvider, "unpaywall");
  assert.deepEqual(
    new Set(entries[0].retrievalProviders),
    new Set(["openalex", "crossref", "unpaywall"])
  );
});
