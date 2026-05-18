import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { certifyPapernexusTaskForProject } from "../../tools/papernexus-task-certification.ts";

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sourceBackedEvidence(paperId, sourceKey) {
  return {
    graph_index_evidence: {
      available: true,
      paper_node_id: paperId,
      paper_id: paperId,
      source_key: sourceKey,
    },
    source_span_evidence: {
      available: true,
      count: 1,
      spans: [
        {
          span_id: `span:${paperId}`,
          source_type: "source_text",
          source_key: sourceKey,
          paper_id: paperId,
          start_line: 1,
          end_line: 1,
          evidence_text: "source-backed excerpt",
          source_span_available: true,
        },
      ],
    },
  };
}

test("PaperNexus certification records per-import task completion and stage evidence", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "papernexus-cert-"));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const batchManifestPath = "researcher/paper-staging/batch-import.json";
  await writeJson(path.join(projectRoot, batchManifestPath), {
    papers: [
      {
        canonical_id: "paper-a",
        title: "FixMatch for Generalized Category Discovery",
        source: "researcher/paper-staging/fixmatch.md",
      },
      {
        canonical_id: "paper-b",
        title: "Contrastive Discovery Baselines",
        source: "researcher/paper-staging/contrastive.md",
      },
    ],
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "gcd-papernexus-cert",
    paper_ingestion: {
      runtime_status: "waiting_graph",
      import_task_ids: ["task-a", "task-b"],
      last_batch_manifest_path: batchManifestPath,
      batch_items: [
        {
          manifest_path: batchManifestPath,
          canonical_id: "paper-a",
          title: "FixMatch for Generalized Category Discovery",
          import_task_id: "task-a",
          status: "completed",
          stage: "completed",
          submitted: true,
          synced: true,
          matched_by: "title",
          updated_at: "2026-04-28T00:00:00.000Z",
        },
        {
          manifest_path: batchManifestPath,
          canonical_id: "paper-b",
          title: "Contrastive Discovery Baselines",
          import_task_id: "task-b",
          status: "running",
          stage: "llm-optimize",
          submitted: true,
          synced: false,
          updated_at: "2026-04-28T00:00:10.000Z",
        },
      ],
      paper_operations: [
        {
          canonical_id: "paper-a",
          title: "FixMatch for Generalized Category Discovery",
          import_task_id: "task-a",
          phase: "import",
          status: "completed",
        },
        {
          canonical_id: "paper-b",
          title: "Contrastive Discovery Baselines",
          import_task_id: "task-b",
          phase: "import",
          status: "running",
        },
      ],
      completed_papers: [
        {
          canonical_id: "paper-a",
          title: "FixMatch for Generalized Category Discovery",
          import_task_id: "task-a",
        },
      ],
    },
  });
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    status: "ready",
    mode: "remote_mcp",
    verification_mode: "remote_paper_index",
  });
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_PROGRESS.json"), {
    phase: "waiting_import",
    batch: {
      manifest_path: batchManifestPath,
      total_items: 2,
      synced_items: 1,
      failed_items: 0,
    },
    queue_progress: {
      total: 2,
      completed: 1,
      running: 1,
      remaining: 1,
    },
  });
  await writeJson(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), {
    status: "ready",
    verification_mode: "remote_paper_index",
    expected_paper_count: 2,
    present_paper_count: 2,
    missing_paper_count: 0,
    present_papers: [
      {
        canonical_id: "paper-a",
        title: "FixMatch for Generalized Category Discovery",
        corpus_paper_id: "remote-paper-a",
        corpus_source_key: "sources/fixmatch.md",
        ...sourceBackedEvidence("remote-paper-a", "sources/fixmatch.md"),
      },
      {
        canonical_id: "paper-b",
        title: "Contrastive Discovery Baselines",
        corpus_paper_id: "remote-paper-b",
        corpus_source_key: "sources/contrastive.md",
        ...sourceBackedEvidence("remote-paper-b", "sources/contrastive.md"),
      },
    ],
  });

  const certification = await certifyPapernexusTaskForProject({
    projectRoot,
    checkedAt: "2026-04-28T00:01:00.000Z",
  });

  assert.equal(certification.status, "ready");
  assert.equal(certification.claim_level, "source_backed_graph");
  assert.equal(certification.source_backed_graph_claim, true);
  assert.equal(
    certification.limitations.includes("missing_per_paper_source_span_evidence"),
    false
  );
  assert.equal(certification.upload.import_tasks.task_count, 2);
  assert.equal(certification.upload.import_tasks.completed_task_count, 1);
  assert.equal(certification.upload.import_tasks.stage_completed_task_count, 1);
  assert.equal(certification.upload.import_tasks.synced_task_count, 1);
  assert.equal(certification.upload.import_tasks.missing_task_id_count, 0);
  assert.equal(certification.upload.remote_task_completed, false);
  assert.equal(certification.upload.import_tasks.all_tasks_completed, false);
  assert.equal(certification.upload.import_tasks.all_task_stages_completed, false);
  assert.ok(
    certification.limitations.includes("incomplete_import_task_completion_evidence")
  );
  assert.ok(
    certification.limitations.includes("incomplete_import_task_stage_completion_evidence")
  );
  assert.deepEqual(
    certification.upload.import_tasks.items.map((entry) => ({
      task_id: entry.task_id,
      completed: entry.task_completed,
      stage_completed: entry.stage_completed,
      graph_index_confirmed: entry.graph_index_confirmed,
      source_span_confirmed: entry.source_span_confirmed,
    })),
    [
      {
        task_id: "task-a",
        completed: true,
        stage_completed: true,
        graph_index_confirmed: true,
        source_span_confirmed: true,
      },
      {
        task_id: "task-b",
        completed: false,
        stage_completed: null,
        graph_index_confirmed: true,
        source_span_confirmed: true,
      },
    ]
  );
  await fs.access(path.join(projectRoot, "graph", "PAPERNEXUS_TASK_CERTIFICATION.json"));
});

test("PaperNexus certification accepts remote corpus summary with per-paper graph and source-span evidence", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "papernexus-cert-summary-"));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "gcd-papernexus-cert-summary",
    paper_ingestion: {},
  });
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    mode: "remote_mcp",
  });
  await writeJson(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), {
    status: "ready",
    verification_mode: "remote_corpus_summary",
    expected_paper_count: 2,
    present_paper_count: 2,
    missing_paper_count: 0,
    present_papers: [
      {
        canonical_id: "paper-a",
        title: "FixMatch for Generalized Category Discovery",
        corpus_paper_id: "remote-paper-a",
        corpus_source_key: "sources/fixmatch.md",
        ...sourceBackedEvidence("remote-paper-a", "sources/fixmatch.md"),
      },
      {
        canonical_id: "paper-b",
        title: "Contrastive Discovery Baselines",
        corpus_paper_id: "remote-paper-b",
        corpus_source_key: "sources/contrastive.md",
        ...sourceBackedEvidence("remote-paper-b", "sources/contrastive.md"),
      },
    ],
  });

  const certification = await certifyPapernexusTaskForProject({ projectRoot });

  assert.equal(certification.status, "ready");
  assert.equal(certification.claim_level, "source_backed_graph");
  assert.equal(certification.source_backed_graph_claim, true);
  assert.equal(certification.graph.paper_index_present_count, 2);
  assert.equal(certification.graph.source_backed_present_count, 2);
  assert.equal(
    certification.limitations.includes("remote_corpus_summary_without_per_paper_source_spans"),
    false
  );
});

test("PaperNexus certification prefers fetched paper_source index over stale metadata-only root index", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "papernexus-cert-paper-source-")
  );
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "gcd-papernexus-cert-paper-source",
    paper_ingestion: {},
  });
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "arxiv:2501.00022",
        arxiv_id: "2501.00022",
        title: "Remote MCP Paper",
        source_provider: "papers-cool",
      },
    ],
  });
  await writeJson(path.join(projectRoot, "researcher", "paper_source", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "arxiv:2501.00022",
        arxiv_id: "2501.00022",
        title: "Remote MCP Paper",
        source_provider: "arxiv2md-api",
        md_path: "md/2501.00022.md",
      },
    ],
  });
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    mode: "remote_mcp",
  });
  await writeJson(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), {
    status: "ready",
    verification_mode: "canonical_paper_index",
    expected_paper_count: 1,
    present_paper_count: 1,
    missing_paper_count: 0,
    present_papers: [
      {
        canonical_id: "arxiv:2501.00022",
        title: "Remote MCP Paper",
        corpus_paper_id: "remote-paper-a",
        corpus_source_key: "sources/remote.md",
        ...sourceBackedEvidence("remote-paper-a", "sources/remote.md"),
      },
    ],
  });

  const certification = await certifyPapernexusTaskForProject({ projectRoot });

  assert.match(
    certification.source_index.path ?? "",
    /researcher\/paper_source\/PAPER_SOURCE_INDEX\.json$/
  );
  assert.equal(certification.source_index.metadata_only_paper_count, 0);
  assert.equal(
    certification.limitations.includes("metadata_only_source_index_entries"),
    false
  );
});

test("PaperNexus certification keeps remote corpus summary partial without explicit per-paper evidence", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "papernexus-cert-summary-soft-")
  );
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "gcd-papernexus-cert-summary-soft",
    paper_ingestion: {},
  });
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    mode: "remote_mcp",
  });
  await writeJson(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), {
    status: "ready",
    verification_mode: "remote_corpus_summary",
    expected_paper_count: 2,
    present_paper_count: 2,
    missing_paper_count: 0,
    present_papers: [
      {
        canonical_id: "paper-a",
        title: "FixMatch for Generalized Category Discovery",
        corpus_paper_id: "remote-paper-a",
        corpus_source_key: "sources/fixmatch.md",
      },
      {
        canonical_id: "paper-b",
        title: "Contrastive Discovery Baselines",
        corpus_paper_id: "remote-paper-b",
        corpus_source_key: "sources/contrastive.md",
      },
    ],
  });

  const certification = await certifyPapernexusTaskForProject({ projectRoot });

  assert.equal(certification.status, "partial");
  assert.equal(certification.claim_level, "remote_corpus_summary");
  assert.equal(certification.source_backed_graph_claim, false);
  assert.equal(certification.graph.paper_index_present_count, 0);
  assert.equal(certification.graph.source_backed_present_count, 0);
  assert.ok(certification.limitations.includes("missing_per_paper_graph_index_evidence"));
  assert.ok(certification.limitations.includes("missing_per_paper_source_span_evidence"));
  assert.ok(
    certification.limitations.includes(
      "remote_corpus_summary_without_per_paper_source_spans"
    )
  );
});

test("PaperNexus certification accepts active remote graph evidence with source spans", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "papernexus-cert-active-graph-")
  );
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "gcd-papernexus-cert-active-graph",
    paper_ingestion: {},
  });
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    status: "ready",
    mode: "remote_mcp",
    verification_mode: "remote_corpus_summary",
  });
  await writeJson(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), {
    status: "ready",
    verification_mode: "remote_corpus_summary",
    ready_proof_level: "source_span",
    expected_paper_count: 2,
    present_paper_count: 2,
    missing_paper_count: 0,
    present_papers: [
      {
        canonical_id: "paper-a",
        title: "FixMatch for Generalized Category Discovery",
        corpus_paper_id: "remote-paper-a",
        corpus_source_key: "sources/fixmatch.md",
        ...sourceBackedEvidence("remote-paper-a", "sources/fixmatch.md"),
      },
      {
        canonical_id: "paper-b",
        title: "Contrastive Discovery Baselines",
        corpus_paper_id: "remote-paper-b",
        corpus_source_key: "sources/contrastive.md",
        graph_index_evidence: {
          available: false,
          active_in_graph: true,
          paper_id: "remote-paper-b",
          source_key: "sources/contrastive.md",
        },
        source_span_evidence: {
          available: true,
          count: 1,
          spans: [
            {
              span_id: "span:remote-paper-b",
              source_type: "source_text",
              source_key: "sources/contrastive.md",
              paper_id: "remote-paper-b",
              start_line: 1,
              end_line: 1,
              evidence_text: "source-backed excerpt",
              source_span_available: true,
            },
          ],
        },
      },
    ],
  });

  const certification = await certifyPapernexusTaskForProject({ projectRoot });

  assert.equal(certification.status, "ready");
  assert.equal(certification.claim_level, "source_backed_graph");
  assert.equal(certification.source_backed_graph_claim, true);
  assert.equal(certification.graph.paper_index_present_count, 2);
  assert.equal(certification.graph.source_backed_present_count, 2);
  assert.equal(
    certification.limitations.includes("missing_per_paper_graph_index_evidence"),
    false
  );
  assert.equal(
    certification.limitations.includes("missing_per_paper_source_span_evidence"),
    false
  );
});

test("PaperNexus certification flags manifest items that never received remote task ids", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "papernexus-cert-missing-task-"));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const batchManifestPath = "researcher/paper-staging/batch-import.json";
  await writeJson(path.join(projectRoot, batchManifestPath), {
    papers: [
      {
        canonical_id: "paper-a",
        title: "FixMatch for Generalized Category Discovery",
        source: "researcher/paper-staging/fixmatch.md",
      },
    ],
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "gcd-papernexus-cert-missing-task",
    paper_ingestion: {
      runtime_status: "waiting_import",
      last_batch_manifest_path: batchManifestPath,
    },
  });
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    status: "ready",
    mode: "remote_mcp",
    verification_mode: "remote_paper_index",
  });
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_PROGRESS.json"), {
    phase: "waiting_import",
    batch: {
      manifest_path: batchManifestPath,
      total_items: 1,
    },
  });
  await writeJson(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), {
    status: "ready",
    verification_mode: "remote_paper_index",
    expected_paper_count: 1,
    present_paper_count: 1,
    missing_paper_count: 0,
    present_papers: [
      {
        canonical_id: "paper-a",
        title: "FixMatch for Generalized Category Discovery",
        corpus_paper_id: "remote-paper-a",
        corpus_source_key: "sources/fixmatch.md",
      },
    ],
  });

  const certification = await certifyPapernexusTaskForProject({ projectRoot });

  assert.equal(certification.upload.import_tasks.task_count, 1);
  assert.equal(certification.upload.import_tasks.missing_task_id_count, 1);
  assert.equal(certification.upload.import_tasks.completed_task_count, 0);
  assert.equal(certification.upload.remote_task_completed, false);
  assert.ok(certification.limitations.includes("missing_import_task_ids"));
});
