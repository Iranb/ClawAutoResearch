import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  auditLiteratureCoverage,
  planCitationExpansion,
} from "../tools/paper-discovery-diagnostics.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("literature coverage audit focuses on screened survey papers and keeps pending retrieval visible", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-paper-diagnostics-")
  );
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "survey-gcd",
    survey_review: {
      topic: "Generalized Category Discovery v3",
      included_papers_path: "researcher/INCLUDED_PAPERS.json",
      excluded_papers_path: "researcher/EXCLUDED_PAPERS.json",
      query_registry_path: "researcher/SURVEY_QUERY_REGISTRY.json",
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "SURVEY_QUERY_REGISTRY.json"), {
    rounds: [
      { query: "generalized category discovery", provider: "zotero" },
      { query: "gcd prompt tuning", provider: "openalex" },
      { query: "gcd debiasing", provider: "semanticscholar" },
    ],
    pending_rounds: ["Citation expansion from top seeds"],
    saturation: {
      assessed: true,
      verdict: "saturated",
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "INCLUDED_PAPERS.json"), {
    papers: [
      {
        canonical_id: "doi:10.1109/cvpr52688.2022.00734",
        title: "Generalized Category Discovery",
        year: 2022,
      },
      {
        canonical_id: "arxiv:2403.13684",
        title: "SPTNet: An Efficient Alternative Framework for Generalized Category Discovery with Spatial Prompt Tuning",
        year: 2024,
      },
    ],
  });
  await writeJson(path.join(projectRoot, "researcher", "EXCLUDED_PAPERS.json"), {
    excludedPapers: [
      { title: "A Review of Deep Learning in Medical Imaging" },
    ],
    backgroundPapers: [
      { title: "Open World Object Detection: A Survey" },
    ],
  });
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "doi:10.1109/cvpr52688.2022.00734",
        title: "Generalized Category Discovery",
        year: 2022,
        venue: "Computer Vision and Pattern Recognition",
        source_provider: "openalex",
        citation_count: 150,
        resolution_status: "resolved_pdf",
      },
      {
        canonical_id: "arxiv:2403.13684",
        title: "SPTNet: An Efficient Alternative Framework for Generalized Category Discovery with Spatial Prompt Tuning",
        year: 2024,
        venue: "International Conference on Learning Representations",
        source_provider: "semanticscholar",
        citation_count: 20,
        resolution_status: "resolved_pdf",
      },
      {
        canonical_id: "doi:10.1609/aaai.v32i1.11491",
        title: "Anchors: High-Precision Model-Agnostic Explanations",
        year: 2018,
        venue: "Proceedings of the AAAI Conference on Artificial Intelligence",
        source_provider: "openalex",
        citation_count: 2037,
        resolution_status: "metadata_only_unresolved",
      },
      {
        canonical_id: "doi:10.1109/jproc.2021.3054390",
        title: "A Review of Deep Learning in Medical Imaging: Imaging Traits, Technology Trends, Case Studies With Progress Highlights, and Future Promises",
        year: 2021,
        venue: "Proceedings of the IEEE",
        source_provider: "openalex",
        citation_count: 930,
        resolution_status: "unknown",
      },
    ],
  });

  const audit = await auditLiteratureCoverage({ projectRoot });
  const packet = await planCitationExpansion({ projectRoot, maxSeeds: 2 });

  assert.equal(audit.focusSource, "screened_included");
  assert.equal(audit.totalPapers, 2);
  assert.equal(audit.screenedIncludedCount, 2);
  assert.equal(audit.backgroundPaperCount, 1);
  assert.equal(audit.pendingRoundCount, 1);
  assert.equal(audit.verdict, "thin");
  assert.equal(packet.seeds.some((seed) => /Anchors/i.test(seed.title ?? "")), false);
  assert.equal(
    packet.seeds.some((seed) =>
      /Generalized Category Discovery|SPTNet/i.test(seed.title ?? "")
    ),
    true
  );
});
