import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  maybeMaterializeGraphBuildPaperSources,
} from "../tools/graph-build-source-catchup.ts";
import { checkGraphPresenceForWorkflow } from "../tools/graph-presence.ts";

async function makeProjectRoot() {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "graph-build-source-catchup-"));
  await fs.mkdir(path.join(projectRoot, "researcher"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "source-catchup-demo",
        current_stage: "graph_build",
        owner_agent: "researcher",
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return projectRoot;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeFetch(markdown) {
  return async (url) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? "text/markdown" : null;
      },
    },
    async text() {
      return markdown;
    },
    async arrayBuffer() {
      return new TextEncoder().encode(markdown).buffer;
    },
    url,
  });
}

function makeBootstrapFetch(markdown) {
  return async (url) => {
    const urlText = String(url);
    const body = urlText.includes("export.arxiv.org/api/query")
      ? `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>https://arxiv.org/abs/2410.11206v1</id>
    <title>Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning</title>
    <summary>FixMatch generalization analysis for semi-supervised learning.</summary>
  </entry>
</feed>`
      : markdown;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get(name) {
          return name.toLowerCase() === "content-type"
            ? urlText.includes("export.arxiv.org/api/query")
              ? "application/atom+xml"
              : "text/markdown"
            : null;
        },
      },
      async text() {
        return body;
      },
      async arrayBuffer() {
        return new TextEncoder().encode(body).buffer;
      },
      url,
    };
  };
}

test("graph-build source catch-up materializes planned arXiv markdown and queues PaperNexus import", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "arxiv:2410.11206",
        arxiv_id: "2410.11206",
        title: "Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning",
        source_provider: "arxiv_api",
        retrieval_providers: ["arxiv_api"],
        staging_path: "researcher/paper-staging/md/2410.11206.md",
        import_status: "pending",
      },
    ],
  });

  const markdown = `# Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning

## Abstract

This fixture represents a substantive full-text paper source for graph ingestion.
It includes enough text to avoid stub detection and contains paper-like sections.

## Introduction

${"FixMatch generalization, semi-supervised learning, augmentation consistency, and generalized category discovery are discussed with enough methodological detail. ".repeat(20)}

## Method

${"The method analysis connects unlabeled-data regularization to improved category separation and decision-boundary stability. ".repeat(20)}
`;

  const result = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: "http://127.0.0.1:9123/mcp",
    },
    now: "2026-04-24T09:00:00.000Z",
    fetchImpl: makeFetch(markdown),
  });

  assert.equal(result.queued, true);
  assert.equal(result.materializedPaperCount, 1);
  const stagedMarkdown = await fs.readFile(
    path.join(projectRoot, "researcher", "paper-staging", "md", "2410.11206.md"),
    "utf8"
  );
  assert.match(stagedMarkdown, /^# Towards Understanding Why FixMatch/);
  assert.match(stagedMarkdown, /## Method/);

  const batchManifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, result.batchManifestPath), "utf8")
  );
  assert.equal(batchManifest.defaults.corpus, "GCD");
  assert.equal(batchManifest.papers.length, 1);
  assert.equal(
    batchManifest.papers[0].source,
    path.join(projectRoot, "researcher", "paper-staging", "md", "2410.11206.md")
  );

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.paper_ingestion.runtime_status, "waiting_import");
  assert.equal(manifest.paper_ingestion.queued_requests.length, 1);
  assert.equal(manifest.paper_ingestion.queued_requests[0].wrapper, "pn_batch_import.py");
  assert.equal(
    manifest.paper_ingestion.queued_requests[0].trigger_kind,
    "graph_build_source_catchup"
  );
  assert.match(
    manifest.paper_ingestion.queued_requests[0].command_text,
    /skills\/researcher\/papernexus\/scripts\/pn_batch_import\.py/
  );

  const sourceIndex = JSON.parse(
    await fs.readFile(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), "utf8")
  );
  assert.equal(sourceIndex.papers[0].source_path, "researcher/paper-staging/md/2410.11206.md");
  assert.equal(sourceIndex.papers[0].source_provider, "hugging-face-paper-pages");
  assert.equal(sourceIndex.papers[0].resolution_status, "resolved_markdown");
});

test("graph-build source catch-up lets remote PaperNexus discover corpus when no shared corpus is configured", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "arxiv:2410.11206",
        arxiv_id: "2410.11206",
        title: "Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning",
        source_provider: "arxiv_api",
        retrieval_providers: ["arxiv_api"],
        staging_path: "researcher/paper-staging/md/2410.11206.md",
        import_status: "pending",
      },
    ],
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "source-catchup-demo",
    current_stage: "graph_build",
    owner_agent: "researcher",
    paper_ingestion: {
      repair_target_corpus: "shared-global-graph",
    },
  });

  const markdown = `# Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning

## Abstract

This fixture is long enough for import validation and includes real paper sections.

## Method

${"The staged source discusses semi-supervised consistency, pseudo-label stability, and GCD method transfer. ".repeat(35)}
`;

  const result = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusMcpUrl: "http://127.0.0.1:9123/mcp",
    },
    now: "2026-04-24T09:30:00.000Z",
    fetchImpl: makeFetch(markdown),
  });

  assert.equal(result.queued, true);
  const batchManifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, result.batchManifestPath), "utf8")
  );
  assert.deepEqual(batchManifest.defaults, {});

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  const queued = manifest.paper_ingestion.queued_requests[0];
  assert.equal(queued.shared_corpus, null);
  assert.equal(manifest.paper_ingestion.repair_target_corpus, null);
  assert.equal(queued.args.includes("--corpus"), false);
  assert.deepEqual(
    queued.args.slice(0, 2),
    ["--mcp-url", "http://127.0.0.1:9123/mcp"]
  );
});

test("graph-build source catch-up resolves researcher md_path through paper-staging", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  const stagedMarkdownPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "md",
    "2201.02609.md"
  );
  await fs.mkdir(path.dirname(stagedMarkdownPath), { recursive: true });
  await fs.writeFile(
    stagedMarkdownPath,
    "# Generalized Category Discovery\n\n## Abstract\n\nThis fixture has substantive staged markdown. ".repeat(40),
    "utf8"
  );
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        arxiv_id: "2201.02609",
        title: "Generalized Category Discovery",
        source_provider: "arxiv2md-api",
        md_path: "md/2201.02609.md",
        import_status: "staged",
      },
    ],
  });

  const result = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusSharedCorpus: "GCD",
    },
    now: "2026-04-24T09:00:00.000Z",
    fetchImpl: makeFetch("# Unused\n\n## Abstract\n\n" + "unused ".repeat(200)),
  });

  assert.equal(result.queued, true);
  assert.equal(result.materializedPaperCount, 1);
  const batchManifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, result.batchManifestPath), "utf8")
  );
  assert.deepEqual(batchManifest.papers.map((entry) => entry.source), [
    stagedMarkdownPath,
  ]);
});

test("graph-build source catch-up rebuilds a missing source index from staged markdown", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  const stagedMarkdownPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "md",
    "2410.11206.md"
  );
  await fs.mkdir(path.dirname(stagedMarkdownPath), { recursive: true });
  await fs.writeFile(
    stagedMarkdownPath,
    `## Abstract

Abstract Semi-supervised learning, FixMatch, and semantic-aware feature learning motivate this staged paper source.

## Introduction

${"FixMatch generalization and generalized category discovery are connected through semantic coverage, pseudo-label confidence, and novel-class clustering. ".repeat(28)}

## Method

${"The staged source is already substantive, so graph-build should reconstruct PAPER_SOURCE_INDEX.json instead of waiting for an agent-authored index. ".repeat(24)}
`,
    "utf8"
  );

  const result = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusSharedCorpus: "GCD",
    },
    now: "2026-04-24T09:00:00.000Z",
    fetchImpl: makeFetch("# Unused\n\n## Abstract\n\n" + "unused ".repeat(200)),
  });

  assert.equal(result.queued, true);
  assert.equal(result.sourceIndexPath, path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"));
  assert.equal(result.materializedPaperCount, 1);

  const sourceIndex = JSON.parse(
    await fs.readFile(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), "utf8")
  );
  assert.equal(sourceIndex.papers.length, 1);
  assert.equal(sourceIndex.papers[0].arxiv_id, "2410.11206");
  assert.equal(sourceIndex.papers[0].source_path, "researcher/paper-staging/md/2410.11206.md");

  const batchManifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, result.batchManifestPath), "utf8")
  );
  assert.deepEqual(batchManifest.papers.map((entry) => entry.source), [
    stagedMarkdownPath,
  ]);
});

test("graph-build source catch-up bootstraps a missing source index from the project topic", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "source-catchup-demo",
    current_stage: "graph_build",
    owner_agent: "researcher",
    research_program: {
      goal:
        "TOWARDS UNDERSTANDING WHY FIXMATCH GENERALIZES BETTER THAN SUPERVISED LEARNING 这篇论文里提到的方法改进GCD",
    },
  });

  const markdown = `# Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning

## Abstract

This fixture represents a substantive full-text paper source recovered from a topic-only no-Discord project.

## Introduction

${"The no-Discord graph build bootstrap should resolve the topic paper, fetch a source, and queue PaperNexus import without waiting for a Discord-bound researcher handoff. ".repeat(24)}

## Method

${"FixMatch analysis, pseudo-label confidence, semantic regularization, and generalized category discovery adaptation provide enough content for graph ingestion. ".repeat(24)}
`;

  const result = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: "http://127.0.0.1:9123/mcp",
    },
    now: "2026-04-24T09:30:00.000Z",
    fetchImpl: makeBootstrapFetch(markdown),
  });

  assert.equal(result.queued, true);
  assert.equal(result.materializedPaperCount, 1);
  assert.equal(result.sourceIndexPath, path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"));

  const sourceIndex = JSON.parse(
    await fs.readFile(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), "utf8")
  );
  assert.equal(sourceIndex.papers.length, 1);
  assert.equal(sourceIndex.papers[0].arxiv_id, "2410.11206");
  assert.equal(sourceIndex.papers[0].source_path, "researcher/paper-staging/md/2410.11206.md");
  assert.equal(sourceIndex.papers[0].resolution_status, "resolved_markdown");
  assert.equal(sourceIndex.papers[0].retrieval_providers.includes("bootstrap-topic"), true);

  const catchupReport = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "GRAPH_BUILD_SOURCE_CATCHUP.json"), "utf8")
  );
  assert.equal(catchupReport.bootstrap_source_index_entry_count, 1);
  assert.equal(catchupReport.materialized_sources[0].arxiv_id, "2410.11206");
});

test("graph presence treats missing planned staging paths as missing sources", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "arxiv:2410.11206",
        arxiv_id: "2410.11206",
        title: "Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning",
        source_provider: "arxiv_api",
        retrieval_providers: ["arxiv_api"],
        staging_path: "researcher/paper-staging/md/2410.11206.md",
        import_status: "pending",
      },
    ],
  });

  const result = await checkGraphPresenceForWorkflow({ projectRoot });
  assert.equal(result.status, "missing_sources");
  assert.equal(result.repairRequired, false);
  assert.equal(result.graphBuildWorkflowStatus, "blocked");
  assert.equal(result.graphBuildCanContinue, false);
  assert.equal(result.graphBuildRequiresSourceRepair, true);
  assert.match(result.refreshReason ?? "", /PDF\/Markdown source/i);

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.paper_ingestion.graph_build_workflow_status, "blocked");
  assert.equal(manifest.paper_ingestion.graph_build_can_continue, false);
  assert.equal(manifest.paper_ingestion.graph_build_requires_source_repair, true);

  const papernexusStatus = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), "utf8")
  );
  assert.equal(papernexusStatus.graph_build_workflow_status, "blocked");
  assert.equal(papernexusStatus.graph_build_can_continue, false);

  const graphBuildReport = await fs.readFile(
    path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"),
    "utf8"
  );
  assert.match(graphBuildReport, /Graph Build Workflow Status: blocked/);
});

test("graph presence ignores metadata-only source-index candidates when source-backed papers exist", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  const stagedMarkdownPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "md",
    "2410.11206.md"
  );
  await fs.mkdir(path.dirname(stagedMarkdownPath), { recursive: true });
  await fs.writeFile(
    stagedMarkdownPath,
    "# Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning\n\n## Abstract\n\n" +
      "Substantive staged source. ".repeat(80),
    "utf8"
  );

  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "arxiv:2410.11206",
        arxiv_id: "2410.11206",
        title: "Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning",
        source_provider: "filesystem",
        source_path: "researcher/paper-staging/md/2410.11206.md",
        resolution_status: "resolved_markdown",
      },
      {
        canonical_id: "doi:10.1016/j.drudis.2018.05.036",
        doi: "10.1016/j.drudis.2018.05.036",
        title: "Why breast cancer signatures are no better than random signatures explained",
        source_provider: "crossref",
        resolution_status: "metadata_only_unresolved",
      },
    ],
  });

  const result = await checkGraphPresenceForWorkflow({ projectRoot });

  assert.equal(result.expectedPaperCount, 1);
  assert.equal(result.missingPapers.length, 1);
  assert.equal(result.missingPapers[0].canonicalId, "arxiv:2410.11206");
});

test("graph-build source catch-up materializes metadata-only canonical_papers without duplicate queue requests", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    canonical_papers: [
      {
        canonical_id: "arxiv:2604.14762",
        arxiv_id: "2604.14762",
        title: "OmniGCD: Abstracting Generalized Category Discovery for Modality Agnosticism",
        import_status: "pending",
      },
    ],
  });

  const markdown = `# OmniGCD: Abstracting Generalized Category Discovery for Modality Agnosticism

## Abstract

This fixture represents a substantive full-text source for a metadata-only canonical paper.

## Introduction

${"Generalized category discovery needs stable pseudo-label transfer, unlabeled calibration, and cross-modal evidence grounded in full paper sources. ".repeat(24)}

## Method

${"The method section contains enough source content for staged import validation and graph-build catch-up. ".repeat(24)}
`;

  const first = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: "http://127.0.0.1:9123/mcp",
    },
    now: "2026-04-24T10:00:00.000Z",
    fetchImpl: makeFetch(markdown),
  });

  assert.equal(first.queued, true);
  assert.equal(first.materializedPaperCount, 1);
  assert.equal(first.requestId.startsWith("graph-build-source-catchup-"), true);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.paper_ingestion.queued_requests[0].status = "completed";
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const sourceIndexPath = path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json");
  const sourceIndex = JSON.parse(await fs.readFile(sourceIndexPath, "utf8"));
  sourceIndex.papers[0].import_status = "pending";
  sourceIndex.papers[0].staging_path = sourceIndex.papers[0].source_path;
  await writeJson(sourceIndexPath, sourceIndex);

  const second = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: "http://127.0.0.1:9123/mcp",
    },
    now: "2026-04-24T10:05:00.000Z",
    fetchImpl: makeFetch(markdown),
  });

  assert.equal(second.queued, false);
  assert.equal(second.skippedReason, "source_catchup_already_completed");
  assert.equal(second.requestId, first.requestId);

  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(updatedManifest.paper_ingestion.queued_requests.length, 1);
});

test("graph-build source catch-up can recover past unrelated needs-repair import requests", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.paper_ingestion = {
    queued_requests: [
      {
        request_id: "agent-authored-broken-manifest",
        status: "needs_repair",
        wrapper: "pn_batch_import.py",
        manifest_path: "researcher/paper-staging/broken-batch-import.json",
      },
    ],
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "arxiv:2410.11206",
        arxiv_id: "2410.11206",
        title: "Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning",
        import_status: "pending",
      },
    ],
  });

  const markdown = `# Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning

## Abstract

This fixture represents a substantive full-text source for repair recovery.

## Introduction

${"The staged repair path should queue a workflow-owned import even when an older agent-authored import request needs repair. ".repeat(24)}

## Method

${"The method discussion supplies enough body text for source validation and graph ingestion. ".repeat(24)}
`;

  const result = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: "http://127.0.0.1:9123/mcp",
    },
    now: "2026-04-24T11:00:00.000Z",
    fetchImpl: makeFetch(markdown),
  });

  assert.equal(result.queued, true);
  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(updatedManifest.paper_ingestion.queued_requests.length, 2);
  assert.equal(
    updatedManifest.paper_ingestion.queued_requests[1].trigger_kind,
    "graph_build_source_catchup"
  );
});
