import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildCanonicalPaperRecordFromRecord,
  normalizeArxivId,
} from "../../tools/paper-source-contract.ts";
import { upsertPaperSourceIndexEntries } from "../../tools/paper-source-index-writer.ts";
import { readWorkflowPaperSourceIndex } from "../../tools/paper-source-index.ts";

test("paper source contract does not extract fake arXiv ids from non-arXiv DOI suffixes", () => {
  assert.equal(normalizeArxivId("10.1109/cvpr52729.2023.00732"), null);
  assert.equal(normalizeArxivId("https://doi.org/10.1109/iccv51070.2023.01524"), null);
  assert.equal(normalizeArxivId("10.48550/arxiv.2301.10921"), "2301.10921");
  assert.equal(normalizeArxivId("https://arxiv.org/abs/2410.11206"), "2410.11206");

  const record = buildCanonicalPaperRecordFromRecord({
    title: "Dynamic Conceptional Contrastive Learning for Generalized Category Discovery",
    doi: "10.1109/cvpr52729.2023.00732",
  });
  assert.equal(record.arxivId, null);
  assert.equal(record.canonicalId, "doi:10.1109/cvpr52729.2023.00732");
});

test("paper source contract recognizes planned staging paths as source paths", () => {
  const record = buildCanonicalPaperRecordFromRecord({
    arxiv_id: "2410.11206",
    title: "Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning",
    staging_path: "researcher/paper-staging/md/2410.11206.md",
  });

  assert.equal(record.sourcePath, "researcher/paper-staging/md/2410.11206.md");
  assert.equal(record.sourceKind, "markdown");
  assert.equal(record.resolutionStatus, "resolved_markdown");
});

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
