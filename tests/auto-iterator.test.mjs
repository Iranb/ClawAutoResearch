import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  checkGraphPresenceForWorkflow,
  runWorkflowAutoIterator,
} from "../tools/workflow-guard.ts";
import {
  aggregateGateReviewRound,
  createGateReviewRound,
  saveGateReviewStore,
} from "../tools/workflow-auto-gate.ts";
import { defaultAutoGateConfig } from "../tools/workflow-auto-gate.ts";
import {
  createAutoModeDiscussionRound,
  saveAutoModeDiscussionStore,
} from "../tools/workflow-auto-discussion.ts";

async function makeTempProject() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-auto-iterator-")
  );
  await fs.mkdir(path.join(projectRoot, "researcher"), { recursive: true });
  return projectRoot;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath, text = "ok\n") {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
}

async function seedPaperSourceIndex(projectRoot, papers) {
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers,
  });
}

async function seedGraphCorpus(projectRoot, corpusEntries, corpusName = "shared-global-graph") {
  const papernexusHome = path.join(projectRoot, ".papernexus-home");
  process.env.PAPERNEXUS_HOME = papernexusHome;
  const sourceRoot = path.join(papernexusHome, "corpora", corpusName);
  const indexedAt = new Date("2026-03-22T12:05:00.000Z").toISOString();
  await writeJson(path.join(papernexusHome, "registry.json"), {
    corpora: [
      {
        name: corpusName,
        rootPath: sourceRoot,
      },
    ],
  });
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    status: "ready",
    corpus_name: corpusName,
    corpus_root: sourceRoot,
  });
  await writeJson(path.join(sourceRoot, ".papernexus", "sources.json"), {
    version: 3,
    corpusName,
    rootPath: sourceRoot,
    inputPath: sourceRoot,
    inputPaths: [sourceRoot],
    sourceMode: "markdown",
    indexedAt,
    sources: corpusEntries,
  });
  await writeJson(path.join(sourceRoot, ".papernexus", "meta.json"), {
    name: corpusName,
    rootPath: sourceRoot,
    indexedAt,
    paperCount: corpusEntries.filter((entry) => entry.activeInGraph !== false).length,
    sourceCount: corpusEntries.length,
  });
  return { sourceRoot, indexedAt };
}

function buildEmptyLedger(projectId, updatedAt) {
  return {
    schemaVersion: 1,
    projectId,
    updatedAt,
    summary: {
      activeExperimentIds: [],
      lastCompletedExperimentId: null,
      lastFailedExperimentId: null,
      bestKnownConfigRef: null,
      lastDecisionSummary: null,
      papernexusSyncRequired: false,
      papernexusLastSyncAt: null,
    },
    experiments: [],
  };
}

async function seedSetupCompleteProject(projectRoot, stage = "setup") {
  const now = new Date("2026-03-22T12:00:00.000Z").toISOString();
  await fs.mkdir(path.join(projectRoot, "graph"), { recursive: true });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    title: "Demo Project",
    current_stage: stage,
    idle_research: { enabled: false },
  });
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), { tracks: [] });
  await writeText(path.join(projectRoot, "CLAIM_POLICY.md"));
  await writeJson(
    path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"),
    buildEmptyLedger("demo-project", now)
  );
  return now;
}

async function seedProjectReadyForCode(projectRoot) {
  const now = await seedSetupCompleteProject(projectRoot, "code");
  const trackId = "track-1";
  const sharedCorpusRoot = path.join(
    projectRoot,
    ".papernexus-home",
    "corpora",
    "shared-global-graph"
  );

  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    status: "ready",
    corpus_name: "shared-global-graph",
    corpus_root: sharedCorpusRoot,
  });
  await writeText(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"));
  await writeJson(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), {
    status: "ready",
    expected_paper_count: 1,
    present_paper_count: 1,
    missing_paper_count: 0,
  });
  await fs.mkdir(path.join(projectRoot, "graph", "subgraphs"), { recursive: true });
  await writeText(path.join(projectRoot, "graph", "subgraphs", "cluster.md"));

  await writeText(path.join(projectRoot, "researcher", "FRONTIER_REPORT.md"));
  await writeText(path.join(projectRoot, "researcher", "IDEA_REPORT.md"));
  await writeText(path.join(projectRoot, "researcher", "IDEA_AUDIT.md"));
  await writeText(path.join(projectRoot, "researcher", "INNOVATION_REFLECTION.md"));

  await writeText(path.join(projectRoot, "orchestrator", "PLAN.md"));
  await writeText(path.join(projectRoot, "orchestrator", "TODOS.md"));
  await writeText(path.join(projectRoot, "orchestrator", "PLAN_AUDIT.md"));

  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), {
    tracks: [
      {
        track_id: trackId,
        status: "active",
        linked_graph_nodes: ["paper:demo", "concept:contrastive-pruning"],
        relation_patterns: ["extends->paper:demo"],
        evidence_pointers: ["graph/LIMITATION_FRONTIER.md#candidate-1"],
        reasoning_packet_dir: `researcher/reasoning/${trackId}`,
        working_memory_path: `researcher/reasoning/${trackId}/working-memory.md`,
        synthesis_packet_path: `researcher/reasoning/${trackId}/synthesis.md`,
      },
    ],
  });
  await writeText(
    path.join(projectRoot, "researcher", "reasoning", trackId, "packet.md"),
    "# reasoning packet\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "reasoning", trackId, "working-memory.md"),
    "# working memory\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "reasoning", trackId, "synthesis.md"),
    "# synthesis\n"
  );

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    title: "Demo Project",
    current_stage: "code",
    current_micro_stage: "frontiers_packaged",
    idle_research: { enabled: false },
    paper_ingestion: {
      graph_presence_checked_at: now,
      graph_presence_status: "ready",
      graph_presence_report_path: "graph/GRAPH_PRESENCE_CHECK.json",
      graph_presence_expected_papers: 1,
      graph_presence_present_papers: 1,
      graph_presence_missing_papers: [],
      refresh_required: false,
    },
    innovation_reflection: {
      required_after_experiments: true,
      status: "fresh",
      last_reflection_at: now,
      last_reflection_path: "researcher/INNOVATION_REFLECTION.md",
      reflected_through_experiment_update_at: now,
      reflected_experiment_ids: [],
    },
    research_program: {
      status: "approved",
      goal: "Demo workflow control plane",
      tracks: [
        {
          track_id: trackId,
          priority: 1,
          status: "active",
          hypothesis: "Graph grounding improves support precision.",
          novelty_basis: "It couples frontier packets with section drafting.",
          main_metric: "acc",
          success_threshold: "acc>=0.9",
          required_baselines: ["baseline-a"],
          required_ablations: ["ablation-a"],
          required_controls: ["seed-control"],
          experiment_stage_matrix: [
            "baseline_implementation",
            "baseline_tuning",
            "creative_research",
            "ablation_studies",
          ],
          budget: {
            gpu_hours: 8,
            max_runs: 4,
            max_debug_iterations: 1,
          },
          stop_rules: ["stop after no improvement"],
          rollback_triggers: ["baseline regression"],
          write_scope: {
            allowed_claim_ids: ["claim-1"],
            allowed_figure_ids: ["fig-1"],
          },
        },
      ],
      task_graph: [
        {
          task_id: "plan-main",
          stage: "plan",
          track_id: trackId,
          owner: "researcher",
          dependencies: [],
          entry_criteria: ["track active"],
          expected_outputs: ["plan ready"],
          retry_budget: 1,
          exit_criteria: ["plan locked"],
        },
      ],
    },
    orchestration_state: {
      status: "running",
      current_owner: "orchestrator",
      next_owner: "coder",
      next_transition_candidate: "code",
      retry_budget_remaining: 2,
      last_contract_eval_result: "pass",
    },
  });

  return { now, trackId };
}

async function seedProjectReadyForSubmit(projectRoot) {
  const { now, trackId } = await seedProjectReadyForCode(projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const experimentId = "exp-1";
  await writeText(path.join(projectRoot, "researcher", "EXPERIMENT_REGISTRY.md"));
  await writeText(
    path.join(projectRoot, "researcher", "artifacts", "results", "metrics.json"),
    "{}\n"
  );
  await writeText(path.join(projectRoot, "coder", "EXPERIMENT_INDEX.md"));
  await writeText(
    path.join(
      projectRoot,
      "coder",
      "experiments",
      trackId,
      `${experimentId}__baseline`,
      "train.py"
    ),
    "print('ok')\n"
  );
  await writeText(
    path.join(
      projectRoot,
      "coder",
      "experiments",
      trackId,
      `${experimentId}__baseline`,
      "README.md"
    )
  );
  await writeJson(
    path.join(
      projectRoot,
      "coder",
      "experiments",
      trackId,
      `${experimentId}__baseline`,
      "EXPERIMENT_MANIFEST.json"
    ),
    {
      experiment_id: experimentId,
      project_id: "demo-project",
      track_id: trackId,
      name: "baseline",
      entry_point: "train.py",
      status: "completed",
    }
  );

  for (const fileName of [
    "NARRATIVE_REPORT.md",
    "CLAIM_EVIDENCE_MATRIX.md",
    "TRACK_VERDICTS.md",
    "UNSUPPORTED_CLAIMS.md",
    "QUALITY_AUDIT.md",
    "THEORY_SUPPORT_NOTE.md",
  ]) {
    await writeText(path.join(projectRoot, "analyzer", fileName));
  }
  await writeJson(path.join(projectRoot, "analyzer", "THEORY_STATE.json"), {
    schema_version: 1,
    status: "draft",
    overall_signal: "green",
    theorem_candidates: [
      {
        packet_id: "theorem_demo",
        role: "theorem",
        statement: "Demo theorem statement.",
      },
    ],
    lemma_packets: [],
    appendix_sections: [],
  });
  await writeJson(
    path.join(projectRoot, "analyzer", "proof-packets", "lemma_demo.json"),
    {
      packet_id: "lemma_demo",
      role: "lemma",
      statement: "Demo lemma statement.",
      body_safe: true,
    }
  );

  await writeText(path.join(projectRoot, "reviewer", "REVIEW_REPORT.md"));
  await writeJson(path.join(projectRoot, "reviewer", "SURFACE_REVIEW.json"), {
    status: "pass",
  });
  await writeJson(
    path.join(projectRoot, "reviewer", "SUBMISSION_SIMULATION_REVIEW.json"),
    { status: "pass" }
  );
  await writeText(path.join(projectRoot, "reviewer", "external_review_2026-03-22.md"));
  await writeText(path.join(projectRoot, "reviewer", "rebuttal_2026-03-22.md"));
  await writeText(path.join(projectRoot, "reviewer", "CITATION_VERIFICATION.md"));

  await writeText(path.join(projectRoot, "academic_writer", "PAPER_PLAN.md"));
  await writeText(path.join(projectRoot, "academic_writer", "STORYLINE_SKETCH.md"));
  await writeText(path.join(projectRoot, "academic_writer", "THEORY_APPENDIX_PLAN.md"));
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "sections", "appendix_theory.tex")
  );
  await writeText(path.join(projectRoot, "academic_writer", "paper", "main.pdf"), "%PDF-1.4\n");
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "refs.bib"),
    "@article{demo,title={Demo}}\n"
  );
  await writeText(path.join(projectRoot, "academic_writer", "WRITING_SIGNALS.md"));
  await writeText(path.join(projectRoot, "cross-reviewer", "notes.md"));

  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    schemaVersion: 1,
    projectId: "demo-project",
    updatedAt: now,
    summary: {
      activeExperimentIds: [],
      lastCompletedExperimentId: experimentId,
      lastFailedExperimentId: null,
      bestKnownConfigRef: "configs/best.yaml",
      lastDecisionSummary: "baseline validated",
      papernexusSyncRequired: false,
      papernexusLastSyncAt: now,
    },
    experiments: [
      {
        experimentId,
        trackId,
        name: "baseline",
        kind: "train",
        status: "completed",
        stage: "experiment",
        hypothesis: "baseline works",
        configRef: "configs/best.yaml",
        summary: "completed run",
        server: "gpu-0",
        gpuId: "0",
        screenName: "baseline",
        launchedAt: now,
        completedAt: now,
        updatedAt: now,
        lastUpdatedBy: "researcher",
        decision: "keep",
        keyMetric: { name: "acc", value: 0.9 },
        metrics: { acc: 0.9 },
        resultPaths: ["researcher/artifacts/results/metrics.json"],
        evidencePointers: ["researcher/artifacts/results/metrics.json"],
        failureSignature: null,
        notes: ["stable"],
        metadata: {},
        papernexusSync: {
          status: "synced",
          corpus: "demo-project",
          lastSyncedAt: now,
          nodeRefs: ["paper:demo"],
          notes: null,
        },
      },
    ],
  });

  await writeJson(manifestPath, {
    project_id: "demo-project",
    title: "Demo Project",
    current_stage: "submit",
    current_micro_stage: "frontiers_packaged",
    idle_research: { enabled: false },
    paper_ingestion: {
      graph_presence_checked_at: now,
      graph_presence_status: "ready",
      graph_presence_report_path: "graph/GRAPH_PRESENCE_CHECK.json",
      graph_presence_expected_papers: 1,
      graph_presence_present_papers: 1,
      graph_presence_missing_papers: [],
      refresh_required: false,
    },
    experiment_memory: {
      last_ledger_update_at: now,
      papernexus_sync_required: false,
      papernexus_sync_status: "synced",
    },
    innovation_reflection: {
      required_after_experiments: true,
      status: "fresh",
      last_reflection_at: now,
      last_reflection_path: "researcher/INNOVATION_REFLECTION.md",
      reflected_through_experiment_update_at: now,
      reflected_experiment_ids: [experimentId],
    },
    theory_state: {
      status: "draft",
      overall_signal: "green",
      theory_state_path: "analyzer/THEORY_STATE.json",
      source_theory_note_path: "analyzer/THEORY_SUPPORT_NOTE.md",
      proof_packet_dir: "analyzer/proof-packets",
      appendix_packet_path: "academic_writer/THEORY_APPENDIX_PLAN.md",
      main_text_proof_style: "lemma_result_only",
      body_ready: true,
      theorem_count: 1,
      lemma_count: 1,
      proof_packet_count: 1,
      last_updated_at: now,
    },
    writing_contract: {
      template_required: false,
      template_status: "optional",
      required_sections: ["abstract", "results", "discussion"],
      section_order: ["abstract", "results", "discussion"],
      proof_appendix_required: true,
      proof_appendix_path: "academic_writer/paper/sections/appendix_theory.tex",
      paragraph_logic_status: "pending",
    },
    citation_integrity: {
      enabled: true,
      verification_required: true,
      bibliography_path: "academic_writer/paper/refs.bib",
      verification_report_path: "reviewer/CITATION_VERIFICATION.md",
      verification_status: "verified",
      allowed_placeholder_count: 0,
      unresolved_placeholder_count: 0,
      verified_citation_count: 12,
      suspicious_citation_count: 0,
      hallucinated_citation_count: 0,
      last_verified_at: now,
    },
    writing_session: {
      status: "ready_for_submit",
      current_section: "discussion",
      draft_order: ["abstract", "results", "discussion"],
      finalized_sections: ["abstract", "results", "discussion"],
      compile_safe_sections: ["abstract", "results", "discussion"],
      section_packets: {
        abstract: {
          section: "abstract",
          packet_path: "academic_writer/section_packets/abstract.md",
          status: "finalized",
          review_verdict: "publication_ready",
        },
        results: {
          section: "results",
          packet_path: "academic_writer/section_packets/results.md",
          status: "finalized",
          review_verdict: "publication_ready",
        },
        discussion: {
          section: "discussion",
          packet_path: "academic_writer/section_packets/discussion.md",
          status: "finalized",
          review_verdict: "publication_ready",
        },
      },
      headline_claim_evidence_status: "covered",
      graph_evidence_coverage_status: "covered",
      citation_plan_mode: "graph_only",
      external_scholar_query_mode: "reserved",
    },
    review_session: {
      status: "completed",
      stage_scope: "review",
      round: 1,
      review_packet_path: "reviewer/REVIEW_REPORT.md",
      graph_evidence_summary_path: "analyzer/CLAIM_EVIDENCE_MATRIX.md",
      latest_review_path: "reviewer/REVIEW_REPORT.md",
      verdict: "ready",
      reviewer_summary: "Review loop complete.",
    },
    graph_guided_writing: {
      enabled: true,
      status: "ready",
      anchor_index_path: "graph/ANCHOR_INDEX.md",
      frontier_files: [
        "graph/LIMITATION_FRONTIER.md",
        "graph/CONTRADICTION_FRONTIER.md",
      ],
      literature_path: "researcher/LITERATURE.md",
      claim_evidence_packet_paths: ["analyzer/proof-packets/lemma_demo.json"],
      required_evidence_pointer_count: 3,
      covered_headline_claim_count: 3,
      total_headline_claim_count: 3,
      evidence_coverage_status: "covered",
      missing_evidence_claims: [],
      citation_source_mode: "graph_only",
      scholar_query_reserved: true,
    },
    write_package: {
      status: "ready",
      winning_track_ids: [trackId],
      claim_evidence_matrix_path: "analyzer/CLAIM_EVIDENCE_MATRIX.md",
      narrative_report_path: "analyzer/NARRATIVE_REPORT.md",
      track_verdicts_path: "analyzer/TRACK_VERDICTS.md",
      unsupported_claims_path: "analyzer/UNSUPPORTED_CLAIMS.md",
      baseline_summary_path: "researcher/baseline_summary.json",
      research_summary_path: "researcher/research_summary.json",
      ablation_summary_path: "researcher/ablation_summary.json",
      evaluation_summary_path: "researcher/evaluation_summary.json",
      figure_pack_path: "academic_writer/FIGURE_PACK.json",
      table_pack_path: "academic_writer/TABLE_PACK.json",
      proof_packet_dir: "analyzer/proof-packets",
      citation_candidates_path: "academic_writer/CITATION_CANDIDATES.json",
    },
    review_issue_tracker: {
      status: "ready",
      issue_manifest_path: "reviewer/REVIEW_ISSUES.json",
      open_counts: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      },
      issues: [],
    },
    external_review_state: {
      status: "received",
      provider: "paperreview.ai",
      review_skill: "paperreview-submit",
      source_label: "Stanford Agentic Reviewer",
      submitted_pdf_path: "academic_writer/paper/main.pdf",
      external_review_path: "reviewer/external_review_2026-03-22.md",
      review_response_path: "reviewer/rebuttal_2026-03-22.md",
      overall_recommendation: "minor_revision",
      required_action: "human_decision",
      last_updated_at: now,
    },
  });
  await writeJson(path.join(projectRoot, "reviewer", "REVIEW_ISSUES.json"), {
    issues: [],
  });
}

test("auto iterator keeps idea stage blocked when active tracks lack materialized reasoning evidence", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { trackId } = await seedProjectReadyForCode(projectRoot);
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "arxiv:2501.00011",
      arxiv_id: "2501.00011",
      title: "Demo Idea Paper",
      source_path: path.join(
        projectRoot,
        "researcher",
        "paper_source",
        "md",
        "2501.00011--demo-idea-paper.md"
      ),
    },
  ]);
  const graphSourceRoot = path.join(
    projectRoot,
    ".papernexus-home",
    "corpora",
    "shared-global-graph"
  );
  await seedGraphCorpus(projectRoot, [
    {
      sourceKey: path.join(graphSourceRoot, "md", "2501.00011--demo-idea-paper.md"),
      inputPath: path.join(graphSourceRoot, "md", "2501.00011--demo-idea-paper.md"),
      kind: "markdown",
      paperId: "paper:demo-idea",
      paperTitle: "Demo Idea Paper",
      sourcePath: path.join(graphSourceRoot, "md", "2501.00011--demo-idea-paper.md"),
      sourceMarkdownPath: path.join(
        graphSourceRoot,
        "md",
        "2501.00011--demo-idea-paper.md"
      ),
      activeInGraph: true,
      canonicalSourceKey: path.join(
        graphSourceRoot,
        "md",
        "2501.00011--demo-idea-paper.md"
      ),
    },
  ]);
  await fs.rm(path.join(projectRoot, "researcher", "reasoning", trackId), {
    recursive: true,
    force: true,
  });

  const trackRegistryPath = path.join(projectRoot, "TRACK_REGISTRY.json");
  const trackRegistry = JSON.parse(await fs.readFile(trackRegistryPath, "utf8"));
  trackRegistry.tracks[0].linked_graph_nodes = [];
  trackRegistry.tracks[0].relation_patterns = [];
  trackRegistry.tracks[0].evidence_pointers = [];
  await writeJson(trackRegistryPath, trackRegistry);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.current_micro_stage = "frontiers_packaged";
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "idea");
  assert.equal(result.stageAfter, "idea");
  assert.ok(
    result.missingStageSignals.some((signal) => /graph-backed innovation evidence/i.test(signal))
  );
  assert.ok(
    result.missingStageSignals.some((signal) => /reasoning packet/i.test(signal))
  );
});

test("auto iterator keeps review stage blocked when unsupported primary claims remain in scope", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);
  await writeText(
    path.join(projectRoot, "analyzer", "UNSUPPORTED_CLAIMS.md"),
    [
      "# Unsupported Claims",
      "## abstract",
      "- PRIMARY claim claim-unsupported-1 remains UNSUPPORTED in the abstract.",
    ].join("\n")
  );

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "review";
  manifest.current_micro_stage = "review_requested";
  manifest.writing_contract.required_sections = ["abstract", "results"];
  manifest.writing_session.current_section = "abstract";
  manifest.writing_session.section_packets.abstract.forbidden_unsupported_claims = [
    "claim-unsupported-1",
  ];
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "review");
  assert.equal(result.stageAfter, "review");
  assert.ok(
    result.missingStageSignals.some((signal) =>
      /unsupported primary claims remain in the selected writing scope/i.test(signal)
    )
  );
});

test("auto iterator stays in setup when required setup signals are missing", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "setup");
  assert.equal(result.stageAfter, "setup");
  assert.equal(result.ownerAfter, "researcher");
  assert.equal(result.gateBlocking, false);
  assert.match(result.blockingReason ?? "", /PROJECT_MANIFEST\.json/);
  assert.ok(result.auditPath);
});

test("auto iterator advances setup to graph_build when setup signals are complete", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedSetupCompleteProject(projectRoot, "setup");

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "setup");
  assert.equal(result.stageAfter, "graph_build");
  assert.equal(result.ownerAfter, "researcher");
  assert.equal(
    result.nextAction,
    "Run /graph-build to reconcile PAPER_SOURCE_INDEX.json against the shared global graph and update graph readiness metadata before frontier mapping."
  );
  assert.equal(result.gateBlocking, false);
});

test("graph presence check reports missing canonical papers before novelty-sensitive work", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedSetupCompleteProject(projectRoot, "frontier_mapping");
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "arxiv:2501.00001",
      arxiv_id: "2501.00001",
      title: "Alpha Paper",
      source_path: path.join(projectRoot, "researcher", "paper_source", "md", "2501.00001--alpha-paper.md"),
    },
    {
      canonical_id: "arxiv:2501.00002",
      arxiv_id: "2501.00002",
      title: "Beta Paper",
      source_path: path.join(projectRoot, "researcher", "paper_source", "md", "2501.00002--beta-paper.md"),
    },
  ]);
  const sourceRoot = path.join(
    projectRoot,
    ".papernexus-home",
    "corpora",
    "shared-global-graph"
  );
  await seedGraphCorpus(projectRoot, [
    {
      sourceKey: path.join(sourceRoot, "md", "2501.00001--alpha-paper.md"),
      inputPath: path.join(sourceRoot, "md", "2501.00001--alpha-paper.md"),
      kind: "markdown",
      paperId: "paper:alpha",
      paperTitle: "Alpha Paper",
      sourcePath: path.join(sourceRoot, "md", "2501.00001--alpha-paper.md"),
      sourceMarkdownPath: path.join(sourceRoot, "md", "2501.00001--alpha-paper.md"),
      activeInGraph: true,
      canonicalSourceKey: path.join(sourceRoot, "md", "2501.00001--alpha-paper.md"),
    },
  ]);

  const result = await checkGraphPresenceForWorkflow({ projectRoot });

  assert.equal(result.status, "missing_papers");
  assert.equal(result.expectedPaperCount, 2);
  assert.equal(result.presentPaperCount, 1);
  assert.equal(result.missingPaperCount, 1);
  assert.equal(result.corpusRoot, sourceRoot);
  assert.match(result.blockingReason ?? "", /missing 1\/2 expected paper/);

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.paper_ingestion.graph_presence_status, "missing_papers");
  assert.equal(manifest.paper_ingestion.graph_presence_missing_papers.length, 1);
});

test("graph presence check preserves source provider and retrieval providers from PAPER_SOURCE_INDEX", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedSetupCompleteProject(projectRoot, "frontier_mapping");
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "arxiv:2501.00003",
      arxiv_id: "2501.00003",
      title: "Gamma Paper",
      source_kind: "markdown",
      source_provider: "arxiv2md",
      retrieval_providers: ["papers-cool", "pasa-paper-search"],
      source_path: path.join(
        projectRoot,
        "researcher",
        "paper_source",
        "md",
        "2501.00003--gamma-paper.md"
      ),
    },
  ]);
  await seedGraphCorpus(projectRoot, []);

  const result = await checkGraphPresenceForWorkflow({ projectRoot });

  assert.equal(result.status, "missing_papers");
  assert.equal(result.missingPapers.length, 1);
  assert.equal(result.missingPapers[0].sourceKind, "markdown");
  assert.equal(result.missingPapers[0].sourceProvider, "arxiv2md");
  assert.deepEqual(result.missingPapers[0].retrievalProviders, [
    "papers-cool",
    "pasa-paper-search",
  ]);

  const report = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), "utf8")
  );
  assert.equal(report.missing_papers[0].source_provider, "arxiv2md");
  assert.deepEqual(report.missing_papers[0].retrieval_providers, [
    "papers-cool",
    "pasa-paper-search",
  ]);
});

test("graph presence check resolves the shared global corpus from registry when the project does not pin one", async (t) => {
  const projectRoot = await makeTempProject();
  const priorPapernexusHome = process.env.PAPERNEXUS_HOME;
  t.after(async () => {
    if (priorPapernexusHome === undefined) {
      delete process.env.PAPERNEXUS_HOME;
    } else {
      process.env.PAPERNEXUS_HOME = priorPapernexusHome;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedSetupCompleteProject(projectRoot, "frontier_mapping");
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "arxiv:2501.00004",
      arxiv_id: "2501.00004",
      title: "Delta Paper",
      source_kind: "markdown",
      source_provider: "hf",
      retrieval_providers: ["papers-cool"],
      source_path: "/Users/iranb/.papernexus/papers/shared/md/2501.00004--delta-paper.md",
    },
  ]);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  delete manifest.papernexus_corpus;
  await writeJson(manifestPath, manifest);
  await fs.rm(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), { force: true });

  const sourceRoot = path.join(
    projectRoot,
    ".papernexus-home",
    "corpora",
    "shared-global-graph"
  );
  await seedGraphCorpus(projectRoot, [
    {
      sourceKey: path.join(sourceRoot, "md", "2501.00004--delta-paper.md"),
      inputPath: path.join(sourceRoot, "md", "2501.00004--delta-paper.md"),
      kind: "markdown",
      paperId: "paper:delta",
      paperTitle: "Delta Paper",
      sourcePath: path.join(sourceRoot, "md", "2501.00004--delta-paper.md"),
      sourceMarkdownPath: path.join(sourceRoot, "md", "2501.00004--delta-paper.md"),
      activeInGraph: true,
      canonicalSourceKey: path.join(sourceRoot, "md", "2501.00004--delta-paper.md"),
    },
  ]);
  await fs.rm(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), { force: true });

  const result = await checkGraphPresenceForWorkflow({ projectRoot });

  assert.equal(result.status, "ready");
  assert.equal(result.corpusRoot, sourceRoot);
});

test("auto iterator advances graph_build once graph presence is ready", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedSetupCompleteProject(projectRoot, "graph_build");
  await writeText(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"));
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "arxiv:2501.00001",
      arxiv_id: "2501.00001",
      title: "Alpha Paper",
      source_path: path.join(projectRoot, "researcher", "paper_source", "md", "2501.00001--alpha-paper.md"),
    },
  ]);
  const sourceRoot = path.join(
    projectRoot,
    ".papernexus-home",
    "corpora",
    "shared-global-graph"
  );
  await seedGraphCorpus(projectRoot, [
    {
      sourceKey: path.join(sourceRoot, "md", "2501.00001--alpha-paper.md"),
      inputPath: path.join(sourceRoot, "md", "2501.00001--alpha-paper.md"),
      kind: "markdown",
      paperId: "paper:alpha",
      paperTitle: "Alpha Paper",
      sourcePath: path.join(sourceRoot, "md", "2501.00001--alpha-paper.md"),
      sourceMarkdownPath: path.join(sourceRoot, "md", "2501.00001--alpha-paper.md"),
      activeInGraph: true,
      canonicalSourceKey: path.join(sourceRoot, "md", "2501.00001--alpha-paper.md"),
    },
  ]);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "graph_build");
  assert.equal(result.stageAfter, "frontier_mapping");
  assert.equal(result.graphPresenceCheck?.status, "ready");
});

test("auto iterator regresses frontier_mapping back to graph_build when graph misses canonical papers", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedSetupCompleteProject(projectRoot, "frontier_mapping");
  await writeText(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"));
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "arxiv:2501.00001",
      arxiv_id: "2501.00001",
      title: "Alpha Paper",
      source_path: path.join(projectRoot, "researcher", "paper_source", "md", "2501.00001--alpha-paper.md"),
    },
    {
      canonical_id: "arxiv:2501.00002",
      arxiv_id: "2501.00002",
      title: "Beta Paper",
      source_path: path.join(projectRoot, "researcher", "paper_source", "md", "2501.00002--beta-paper.md"),
    },
  ]);
  const sourceRoot = path.join(
    projectRoot,
    ".papernexus-home",
    "corpora",
    "shared-global-graph"
  );
  await seedGraphCorpus(projectRoot, [
    {
      sourceKey: path.join(sourceRoot, "md", "2501.00001--alpha-paper.md"),
      inputPath: path.join(sourceRoot, "md", "2501.00001--alpha-paper.md"),
      kind: "markdown",
      paperId: "paper:alpha",
      paperTitle: "Alpha Paper",
      sourcePath: path.join(sourceRoot, "md", "2501.00001--alpha-paper.md"),
      sourceMarkdownPath: path.join(sourceRoot, "md", "2501.00001--alpha-paper.md"),
      activeInGraph: true,
      canonicalSourceKey: path.join(sourceRoot, "md", "2501.00001--alpha-paper.md"),
    },
  ]);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "frontier_mapping");
  assert.equal(result.stageEffective, "graph_build");
  assert.equal(result.stageAfter, "graph_build");
  assert.equal(result.graphPresenceCheck?.status, "missing_papers");
  assert.match(result.blockingReason ?? "", /graph_presence_status = ready/);

  const aggressiveResult = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    policy: {
      autoMode: "aggressive",
      autoGate: {
        ...defaultAutoGateConfig(),
        enabled: true,
      },
    },
  });

  assert.equal(aggressiveResult.configuredAutoMode, "aggressive");
  assert.equal(aggressiveResult.effectiveAutoMode, "aggressive");
  assert.equal(aggressiveResult.autoModeRiskLevel, "severe");
  assert.equal(aggressiveResult.autoModeMitigationRoundsStarted, 0);
  assert.equal(aggressiveResult.autoModeMitigationRoundsRemaining, 2);
  assert.ok(
    aggressiveResult.autoModeReasons.some((reason) =>
      /Auto discussion rounds remaining before downgrade/i.test(reason)
    )
  );
});

test("auto iterator blocks on the mandatory submit human gate once submit artifacts are ready", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "submit");
  assert.equal(result.stageAfter, "submit");
  assert.equal(result.gateBlocking, true);
  assert.match(result.gateReason ?? "", /GATE-5/);
  assert.equal(result.ownerAfter, "reviewer");
  assert.equal(result.recommendedActions[0]?.kind, "wait_human");
});

test("auto iterator keeps submit blocked in aggressive mode while auto gate review is pending", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    policy: {
      autoMode: "aggressive",
      autoGate: {
        ...defaultAutoGateConfig(),
        enabled: true,
      },
    },
  });

  assert.equal(result.stageBefore, "submit");
  assert.equal(result.stageAfter, "submit");
  assert.equal(result.gateBlocking, true);
  assert.match(result.gateReason ?? "", /auto review is pending/i);
});

test("auto iterator advances submit to done when aggressive auto gate review is approved", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);

  const autoGate = {
    ...defaultAutoGateConfig(),
    enabled: true,
  };
  const round = createGateReviewRound({
    gateId: "GATE-5",
    stage: "submit",
    packetPath: path.join(projectRoot, "reviewer", "gates", "GATE-5", "AUTO_GATE_PACKET.md"),
    packetJsonPath: path.join(
      projectRoot,
      "reviewer",
      "gates",
      "GATE-5",
      "AUTO_GATE_PACKET.json"
    ),
    packetFingerprint: "approved-packet",
    attempts: [
      {
        reviewerRole: "reviewer",
        sessionKey: "agent:reviewer:main",
        runId: "gate-run-reviewer",
        status: "completed",
        launchedAt: "2026-03-25T12:00:00.000Z",
        completedAt: "2026-03-25T12:01:00.000Z",
        error: null,
        result: {
          reviewerRole: "reviewer",
          verdict: "pass",
          overallScore: 9.2,
          dimensionScores: { quality: 9, evidence: 9, citation: 10 },
          criticalBlockers: [],
          majorIssues: [],
          suggestedRollbackStage: null,
          reviewedArtifacts: ["academic_writer/paper/main.pdf"],
          summary: "Looks submission-ready.",
          createdAt: "2026-03-25T12:01:00.000Z",
          runId: "gate-run-reviewer",
          rawText: "{}",
        },
      },
      {
        reviewerRole: "cross-reviewer",
        sessionKey: "agent:cross-reviewer:main",
        runId: "gate-run-cross-reviewer",
        status: "completed",
        launchedAt: "2026-03-25T12:00:00.000Z",
        completedAt: "2026-03-25T12:01:00.000Z",
        error: null,
        result: {
          reviewerRole: "cross-reviewer",
          verdict: "pass",
          overallScore: 8.9,
          dimensionScores: { quality: 9, clarity: 9, publishability: 9 },
          criticalBlockers: [],
          majorIssues: [],
          suggestedRollbackStage: null,
          reviewedArtifacts: ["reviewer/rebuttal_2026-03-22.md"],
          summary: "Readable and persuasive.",
          createdAt: "2026-03-25T12:01:00.000Z",
          runId: "gate-run-cross-reviewer",
          rawText: "{}",
        },
      },
      {
        reviewerRole: "analyzer",
        sessionKey: "agent:analyzer:main",
        runId: "gate-run-analyzer",
        status: "completed",
        launchedAt: "2026-03-25T12:00:00.000Z",
        completedAt: "2026-03-25T12:01:00.000Z",
        error: null,
        result: {
          reviewerRole: "analyzer",
          verdict: "pass",
          overallScore: 9.0,
          dimensionScores: { quality: 9, evidence: 9, publishability: 9 },
          criticalBlockers: [],
          majorIssues: [],
          suggestedRollbackStage: null,
          reviewedArtifacts: ["analyzer/CLAIM_EVIDENCE_MATRIX.md"],
          summary: "Evidence packet is coherent.",
          createdAt: "2026-03-25T12:01:00.000Z",
          runId: "gate-run-analyzer",
          rawText: "{}",
        },
      },
    ],
  });
  round.aggregate = aggregateGateReviewRound(round, autoGate);
  round.status = round.aggregate.status;
  await saveGateReviewStore(projectRoot, {
    schemaVersion: 1,
    updatedAt: "2026-03-25T12:01:00.000Z",
    roundsStarted: 1,
    currentRound: round,
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    policy: {
      autoMode: "aggressive",
      autoGate,
    },
  });

  assert.equal(result.stageBefore, "submit");
  assert.equal(result.stageAfter, "done");
  assert.equal(result.gateBlocking, false);
  assert.equal(result.ownerAfter, "researcher");
});

test("auto iterator keeps submit blocked when citation verification is not complete", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.citation_integrity.verification_status = "needs_revision";
  manifest.citation_integrity.hallucinated_citation_count = 1;
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "submit");
  assert.equal(result.stageAfter, "write");
  assert.equal(result.gateBlocking, false);
  assert.match(result.blockingReason ?? "", /citation/i);
  assert.ok(
    result.missingStageSignals.some((signal) => /verification_status/i.test(signal))
  );

  const aggressiveResult = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    policy: {
      autoMode: "aggressive",
      autoGate: {
        ...defaultAutoGateConfig(),
        enabled: true,
      },
    },
  });
  assert.equal(aggressiveResult.stageAfter, "write");
  assert.ok(
    aggressiveResult.autoModeReasons.some((reason) => /citation/i.test(reason))
  );
});

test("auto iterator keeps submit blocked when external Stanford review has not reached a conclusion", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.external_review_state.status = "submitted";
  manifest.external_review_state.overall_recommendation = null;
  manifest.external_review_state.required_action = null;
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "submit");
  assert.equal(result.stageAfter, "submit");
  assert.ok(
    result.missingStageSignals.some((signal) =>
      signal.includes("external_review_state")
    )
  );
});

test("auto iterator downgrades only after mitigation rounds are exhausted for the same risk", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedSetupCompleteProject(projectRoot, "graph_build");
  await writeText(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"));
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "arxiv:2501.00001",
      arxiv_id: "2501.00001",
      title: "Alpha Paper",
      source_path: path.join(
        projectRoot,
        "researcher",
        "paper_source",
        "md",
        "2501.00001--alpha-paper.md"
      ),
    },
    {
      canonical_id: "arxiv:2501.00002",
      arxiv_id: "2501.00002",
      title: "Beta Paper",
      source_path: path.join(
        projectRoot,
        "researcher",
        "paper_source",
        "md",
        "2501.00002--beta-paper.md"
      ),
    },
  ]);
  const sourceRoot = path.join(
    projectRoot,
    ".papernexus-home",
    "corpora",
    "shared-global-graph"
  );
  await seedGraphCorpus(projectRoot, [
    {
      sourceKey: path.join(sourceRoot, "md", "2501.00001--alpha-paper.md"),
      inputPath: path.join(sourceRoot, "md", "2501.00001--alpha-paper.md"),
      kind: "markdown",
      paperId: "paper:alpha",
      paperTitle: "Alpha Paper",
      sourcePath: path.join(sourceRoot, "md", "2501.00001--alpha-paper.md"),
      sourceMarkdownPath: path.join(
        sourceRoot,
        "md",
        "2501.00001--alpha-paper.md"
      ),
      activeInGraph: true,
      canonicalSourceKey: path.join(
        sourceRoot,
        "md",
        "2501.00001--alpha-paper.md"
      ),
    },
  ]);

  const firstResult = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    policy: {
      autoMode: "aggressive",
      autoGate: {
        ...defaultAutoGateConfig(),
        enabled: true,
      },
    },
  });

  assert.equal(firstResult.effectiveAutoMode, "aggressive");
  assert.ok(firstResult.autoModeRiskFingerprint);

  const round = createAutoModeDiscussionRound({
    stage: "graph_build",
    riskLevel: "severe",
    packetPath: path.join(
      projectRoot,
      "reviewer",
      "auto-mode-discussion",
      "AUTO_MODE_DISCUSSION_PACKET.md"
    ),
    packetJsonPath: path.join(
      projectRoot,
      "reviewer",
      "auto-mode-discussion",
      "AUTO_MODE_DISCUSSION_PACKET.json"
    ),
    packetFingerprint: firstResult.autoModeRiskFingerprint,
    attempts: [],
  });
  round.status = "blocked";
  await saveAutoModeDiscussionStore(projectRoot, {
    schemaVersion: 1,
    updatedAt: "2026-03-25T12:20:00.000Z",
    roundsStartedByFingerprint: {
      [firstResult.autoModeRiskFingerprint]: 2,
    },
    currentRound: round,
  });

  let downgradedResult = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    policy: {
      autoMode: "aggressive",
      autoGate: {
        ...defaultAutoGateConfig(),
        enabled: true,
      },
    },
  });

  if (
    downgradedResult.effectiveAutoMode !== "off" &&
    downgradedResult.autoModeRiskFingerprint
  ) {
    const followupRound = createAutoModeDiscussionRound({
      stage: "graph_build",
      riskLevel: "severe",
      packetPath: path.join(
        projectRoot,
        "reviewer",
        "auto-mode-discussion",
        "AUTO_MODE_DISCUSSION_PACKET.md"
      ),
      packetJsonPath: path.join(
        projectRoot,
        "reviewer",
        "auto-mode-discussion",
        "AUTO_MODE_DISCUSSION_PACKET.json"
      ),
      packetFingerprint: downgradedResult.autoModeRiskFingerprint,
      attempts: [],
    });
    followupRound.status = "blocked";
    await saveAutoModeDiscussionStore(projectRoot, {
      schemaVersion: 1,
      updatedAt: "2026-03-25T12:21:00.000Z",
      roundsStartedByFingerprint: {
        [downgradedResult.autoModeRiskFingerprint]: 2,
      },
      currentRound: followupRound,
    });
    downgradedResult = await runWorkflowAutoIterator({
      projectRoot,
      mode: "test",
      queueMailbox: false,
      policy: {
        autoMode: "aggressive",
        autoGate: {
          ...defaultAutoGateConfig(),
          enabled: true,
        },
      },
    });
  }

  assert.equal(downgradedResult.effectiveAutoMode, "off");
  assert.equal(downgradedResult.autoModeMitigationStatus, "blocked");
  assert.equal(downgradedResult.autoModeMitigationRoundsStarted, 2);
  assert.equal(downgradedResult.autoModeMitigationRoundsRemaining, 0);
  assert.ok(
    downgradedResult.autoModeReasons.some((reason) =>
      /Auto discussion rounds were exhausted without resolving the current risk/i.test(
        reason
      )
    )
  );
});

test("auto iterator accepts structured coder experiment bundles with index file", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { trackId } = await seedProjectReadyForCode(projectRoot);
  await writeText(path.join(projectRoot, "coder", "EXPERIMENT_INDEX.md"));
  await writeText(
    path.join(
      projectRoot,
      "coder",
      "experiments",
      trackId,
      "exp-1__baseline",
      "train.py"
    ),
    "print('ok')\n"
  );
  await writeText(
    path.join(
      projectRoot,
      "coder",
      "experiments",
      trackId,
      "exp-1__baseline",
      "README.md"
    )
  );
  await writeJson(
    path.join(
      projectRoot,
      "coder",
      "experiments",
      trackId,
      "exp-1__baseline",
      "EXPERIMENT_MANIFEST.json"
    ),
    {
      experiment_id: "exp-1",
      project_id: "demo-project",
      track_id: trackId,
      name: "baseline",
      entry_point: "train.py",
      status: "draft",
    }
  );

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "code");
  assert.equal(result.stageAfter, "experiment");
});

test("auto iterator keeps write stage blocked when theory appendix draft is missing", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);
  await fs.rm(
    path.join(projectRoot, "academic_writer", "paper", "sections", "appendix_theory.tex"),
    { force: true }
  );

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "write";
  manifest.current_micro_stage = "drafting";
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "write");
  assert.equal(result.stageAfter, "write");
  assert.ok(
    result.missingStageSignals.some((signal) => /appendix_theory\.tex/i.test(signal))
  );
});

test("auto iterator keeps write stage blocked when paper QC reports a hard compile failure", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "write";
  manifest.current_micro_stage = "compile_and_surface_fix";
  manifest.paper_qc = {
    status: "blocked",
    compile_status: "fail",
    compile_round_count: 3,
    chktex_status: "pass",
    page_budget_status: "pass",
    unused_figure_status: "pass",
    invalid_figure_ref_status: "pass",
    reflection_round_count: 1,
    latest_report_path: "academic_writer/PAPER_QC.md",
  };
  manifest.review_issue_tracker = {
    status: "ready",
    open_counts: {
      critical: 0,
      high: 0,
      medium: 1,
      low: 0,
    },
  };
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "write");
  assert.equal(result.stageAfter, "write");
  assert.ok(
    result.missingStageSignals.some((signal) =>
      /paper_qc.*compile_status = pass/i.test(signal)
    )
  );
});

test("auto iterator keeps write stage blocked when figure QC reports caption alignment failure", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "write";
  manifest.current_micro_stage = "citation_and_figure_qc";
  manifest.figure_qc = {
    status: "blocked",
    duplicate_figure_status: "pass",
    caption_alignment_status: "fail",
    text_alignment_status: "pass",
    selection_status: "pass",
    figure_review_path: "reviewer/SURFACE_REVIEW.json",
  };
  manifest.review_issue_tracker = {
    status: "ready",
    open_counts: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
  };
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "write");
  assert.equal(result.stageAfter, "write");
  assert.ok(
    result.missingStageSignals.some((signal) =>
      /figure_qc.*caption_alignment_status = pass/i.test(signal)
    )
  );
});
