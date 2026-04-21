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
        resolution_status: "resolved_markdown",
        source_path: path.join(projectRoot, "researcher", "paper-staging", "md", "2403.13684--sptnet.md"),
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
  await fs.mkdir(path.join(projectRoot, "researcher", "paper-staging", "md"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "researcher", "paper-staging", "md", "2403.13684--sptnet.md"),
    [
      "# SPTNet",
      "",
      "Generalized Category Discovery (GCD) is the main task studied in this paper.",
      "We evaluate generalized category discovery on ImageNet-100 and fine-grained benchmarks.",
    ].join("\n"),
    "utf8"
  );

  const audit = await auditLiteratureCoverage({ projectRoot });
  const packet = await planCitationExpansion({ projectRoot, maxSeeds: 2 });

  assert.equal(audit.focusSource, "screened_included");
  assert.equal(audit.totalPapers, 2);
  assert.equal(audit.screenedIncludedCount, 2);
  assert.equal(audit.backgroundPaperCount, 1);
  assert.equal(audit.pendingRoundCount, 1);
  assert.equal(audit.verdict, "thin");
  assert.equal(audit.topicRelevance.fullTextReviewedCount >= 1, true);
  assert.equal(packet.seeds.some((seed) => /Anchors/i.test(seed.title ?? "")), false);
  assert.equal(
    packet.seeds.some((seed) =>
      /Generalized Category Discovery|SPTNet/i.test(seed.title ?? "")
    ),
    true
  );
});

test("topic relevance audit can rescue a paper with a generic title when markdown body is on-topic", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-topic-relevance-")
  );
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "survey-gcd",
    survey_review: {
      topic: "Generalized Category Discovery",
    },
  });
  const markdownPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "md",
    "creation-paper.md"
  );
  await fs.mkdir(path.dirname(markdownPath), { recursive: true });
  await fs.writeFile(
    markdownPath,
    [
      "# Learning through Creation",
      "",
      "This work studies Generalized Category Discovery in an on-the-fly setting.",
      "The generalized category discovery problem is discussed throughout the paper.",
    ].join("\n"),
    "utf8"
  );
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "arxiv:2603.13858",
        title: "Learning through Creation",
        year: 2026,
        source_kind: "markdown",
        source_path: markdownPath,
        source_provider: "hf",
        resolution_status: "resolved_markdown",
      },
    ],
  });

  const audit = await auditLiteratureCoverage({ projectRoot });
  const topicAudit = JSON.parse(
    await fs.readFile(path.join(projectRoot, "researcher", "TOPIC_RELEVANCE_AUDIT.json"), "utf8")
  );

  assert.equal(audit.topicRelevance.relevantCount, 1);
  assert.equal(topicAudit.entries[0].evidenceSource, "full_text");
  assert.equal(topicAudit.entries[0].status, "relevant");
});

test("semantic reranker rescues synonym-heavy body text when lexical overlap is weak", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-semantic-relevance-")
  );
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "survey-gcd",
    survey_review: {
      topic: "Generalized Category Discovery",
    },
  });
  const markdownPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "md",
    "semantic-body.md"
  );
  await fs.mkdir(path.dirname(markdownPath), { recursive: true });
  await fs.writeFile(
    markdownPath,
    [
      "# A Practical Recipe",
      "",
      "We study open-world recognition with unseen class clustering under a shared protocol.",
      "The method targets novel label grouping and class discovery without relying on known taxonomy size.",
    ].join("\n"),
    "utf8"
  );
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "arxiv:2604.00001",
        title: "A Practical Recipe",
        year: 2026,
        source_kind: "markdown",
        source_path: markdownPath,
        source_provider: "hf",
        resolution_status: "resolved_markdown",
      },
    ],
  });

  await auditLiteratureCoverage({ projectRoot });
  const topicAudit = JSON.parse(
    await fs.readFile(path.join(projectRoot, "researcher", "TOPIC_RELEVANCE_AUDIT.json"), "utf8")
  );

  assert.equal(topicAudit.entries[0].lexicalScore < topicAudit.entries[0].score, true);
  assert.equal(topicAudit.entries[0].semanticScore > topicAudit.entries[0].lexicalScore, true);
  assert.equal(topicAudit.entries[0].learnedScore > topicAudit.entries[0].lexicalScore, true);
  assert.equal(topicAudit.entries[0].status, "relevant");
});
