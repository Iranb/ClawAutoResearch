import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  reconcileWorkflowControl,
} from "../../../tools/workflow-control-reconciler.ts";
import {
  resolveCodeCompletion,
  resolveExperimentCompletion,
  resolveExperimentPlanCompletion,
  resolveFrontierMappingCompletion,
  resolveGraphCompletion,
  resolveIdeationCompletion,
  resolveLiteratureReviewCompletion,
  resolvePolishReviewCompletion,
  resolvePlanCompletion,
  resolveRuntimeOwnership,
  resolveSurveyReviewCompletion,
  resolveSubmissionReadyCompletion,
  resolveTopicSearchCompletion,
  resolveWritingCompletion,
  resolveWorkflowStageCompletion,
  resolveAnalysisCompletion,
} from "../../../tools/workflow-stage-completion.ts";

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath, value = "ready\n") {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

const PAPERGURU_PASS_IDS = [
  "pass_1_structure",
  "pass_2_argumentation",
  "pass_3_sentence_precision",
  "pass_4_grammar_terminology",
  "pass_5_typography_latex",
  "pass_6_integrity_audit",
];

async function makeProject(t, prefix) {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  return projectRoot;
}

async function writePaperGuruReadyArtifacts(projectRoot) {
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "paperguru-ready",
    writing_contract: {
      scientific_editing_required: true,
      scientific_editing_status: "ready",
      scientific_editing_passes: PAPERGURU_PASS_IDS,
      scientific_editing_ledger_path: "academic_writer/SCIENTIFIC_EDIT_LEDGER.json",
      scientific_editing_report_path: "academic_writer/SCIENTIFIC_EDIT_REPORT.md",
    },
    paper_qc: {
      status: "ready",
      compile_status: "pass",
      page_budget_status: "pass",
      invalid_figure_ref_status: "pass",
    },
  });
  await writeJson(path.join(projectRoot, "academic_writer", "SCIENTIFIC_EDIT_LEDGER.json"), {
    pass_results: PAPERGURU_PASS_IDS.map((pass_id) => ({
      pass_id,
      status: "completed",
    })),
    compile_receipts: ["academic_writer/build.log"],
    reference_verification_receipts: ["reviewer/CITATION_VERIFICATION.md"],
    number_consistency_receipts: ["academic_writer/NUMBER_AUDIT.md"],
    claim_evidence_consistency_receipts: ["reviewer/CLAIM_EVIDENCE_AUDIT.md"],
  });
  await writeText(
    path.join(projectRoot, "academic_writer", "SCIENTIFIC_EDIT_REPORT.md"),
    "# Scientific edit report\n"
  );
}

async function writeReadyWritePackage(projectRoot, overrides = {}) {
  const files = {
    claim_evidence_matrix_path: "analyzer/CLAIM_EVIDENCE_MATRIX.json",
    narrative_report_path: "analyzer/NARRATIVE_REPORT.md",
    track_verdicts_path: "analyzer/TRACK_VERDICTS.json",
    unsupported_claims_path: "analyzer/UNSUPPORTED_CLAIMS.json",
    baseline_summary_path: "analyzer/BASELINE_SUMMARY.md",
    research_summary_path: "analyzer/RESEARCH_SUMMARY.md",
    ablation_summary_path: "analyzer/ABLATION_SUMMARY.md",
    evaluation_summary_path: "analyzer/EVALUATION_SUMMARY.md",
    figure_pack_path: "academic_writer/FIGURE_PACK.json",
    table_pack_path: "academic_writer/TABLE_PACK.json",
    proof_packet_dir: "academic_writer/proof-packets",
    citation_candidates_path: "academic_writer/CITATION_CANDIDATES.json",
  };
  await Promise.all(
    Object.values(files).map((relativePath) =>
      relativePath.endsWith("proof-packets")
        ? fs.mkdir(path.join(projectRoot, relativePath), { recursive: true })
        : writeText(path.join(projectRoot, relativePath), "ready\n")
    )
  );
  return {
    status: "ready",
    winning_track_ids: ["track-1"],
    source_artifact_count: 4,
    derived_artifact_count: 8,
    ...files,
    ...overrides,
  };
}

test("graph completion ignores stale remote discovery warning when graph proof is ready", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-graph-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "graph-ready",
    current_stage: "graph_build",
    owner_agent: "researcher",
    paper_ingestion: {
      graph_presence_status: "missing_sources",
      repair_required: true,
      repair_reason: "stale remote discovery warning",
    },
  });
  await writeJson(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), {
    status: "ready",
    checked_at: "2026-05-12T00:00:00.000Z",
    graph_build_can_continue: true,
  });
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_SYNC_STATE.json"), {
    workflow_projection: {
      can_continue: true,
      runtime_status: "ready",
    },
  });

  const completion = await resolveGraphCompletion(projectRoot);
  assert.equal(completion.completionStatus, "complete");
  assert.equal(completion.blockingReason, null);
  assert.equal(completion.contractSource, "graph_completion");
  assert.equal(completion.repairProjection, true);

  const reconciled = await reconcileWorkflowControl({
    projectRoot,
    now: "2026-05-12T00:01:00.000Z",
  });
  assert.equal(reconciled.contract.stage, "graph_build");
  assert.equal(reconciled.contract.completion.status, "complete");
  assert.equal(reconciled.contract.blocking_reason, null);
  assert.equal(reconciled.manifest.current_stage, "graph_build");
  assert.equal(
    reconciled.manifest.paper_ingestion.graph_presence_status,
    "ready"
  );
});

test("graph completion waits on active workflow-owned literature requisitions", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-graph-active-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "graph-active-requisition",
    current_stage: "graph_build",
    owner_agent: "researcher",
    paper_ingestion: {
      graph_presence_status: "ready",
      queued_requests: [
        {
          request_id: "idea-gap",
          request_kind: "requisition",
          trigger_kind: "idea_literature_discovery",
          status: "queued",
          attempt_count: 0,
        },
      ],
    },
  });
  await writeJson(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), {
    status: "ready",
    expected_paper_count: 1,
    present_paper_count: 1,
  });
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_SYNC_STATE.json"), {
    workflow_projection: {
      can_continue: true,
      runtime_status: "ready",
    },
  });

  const completion = await resolveGraphCompletion(projectRoot);
  assert.equal(completion.completionStatus, "incomplete");
  assert.equal(completion.blockingReason, "graph_reentry_request_active");
  assert.equal(completion.nextAction, "/graph-build");
  assert.match(
    completion.missingSignals.join("\n"),
    /workflow-owned graph enrichment requisition is still active/i
  );
});

test("graph completion rejects degraded literature reports without coverage evidence", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-graph-invalid-report-");
  const reportPath =
    "researcher/idea-catalyst/requisition/req-gap/REQUISITION_SATISFACTION_REPORT.json";
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "graph-invalid-requisition-report",
    current_stage: "graph_build",
    owner_agent: "researcher",
    paper_ingestion: {
      graph_presence_status: "ready",
      queued_requests: [
        {
          request_id: "idea-catalyst-req-gap",
          request_kind: "requisition",
          trigger_kind: "idea_catalyst_requisition",
          status: "completed",
          validation_status: "warning",
          validation_report_path: reportPath,
          attempt_count: 1,
        },
      ],
      completed_papers: [],
      batch_items: [],
      paper_operations: [],
      import_task_ids: [],
    },
  });
  await writeJson(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), {
    status: "ready",
    expected_paper_count: 23,
    present_paper_count: 23,
  });
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_SYNC_STATE.json"), {
    workflow_projection: {
      can_continue: true,
      runtime_status: "ready",
    },
  });
  await writeJson(path.join(projectRoot, reportPath), {
    schema_version: 1,
    status: "warning",
    decision: "degraded_satisfied_current_graph",
    request_id: "idea-catalyst-req-gap",
    selected_paper_count: 0,
    candidate_paper_count: 0,
  });

  const completion = await resolveGraphCompletion(projectRoot);
  assert.equal(completion.completionStatus, "blocked");
  assert.equal(
    completion.blockingReason,
    "literature_requisition_completed_without_evidence"
  );
});

test("plan completion repairs sparse manifest projection from plan artifacts", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-plan-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "plan-ready",
    current_stage: "plan",
    owner_agent: "orchestrator",
    research_program: {
      status: "incomplete",
    },
  });
  await writeText(path.join(projectRoot, "orchestrator", "PLAN.md"));
  await writeText(path.join(projectRoot, "orchestrator", "PLAN_AUDIT.md"));

  const completion = await resolvePlanCompletion(projectRoot);
  assert.equal(completion.completionStatus, "complete");
  assert.equal(completion.repairProjection, true);

  const reconciled = await reconcileWorkflowControl({
    projectRoot,
    now: "2026-05-12T00:02:00.000Z",
  });
  assert.equal(reconciled.contract.stage, "plan");
  assert.equal(reconciled.contract.completion.status, "complete");
  assert.equal(reconciled.contract.completion.source, "plan_completion");
  assert.equal(reconciled.manifest.research_program.status, "ready");
  assert.equal(reconciled.manifest.current_stage, "plan");
});

test("frontier mapping completion uses canonical brainstorm-cycle state", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-frontier-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "frontier",
    current_stage: "frontier_mapping",
    owner_agent: "researcher",
    brainstorm_cycle: {
      status: "reconciled",
      topic: "Graph-grounded novelty route",
      basis_stage: "frontier_mapping",
      provider: "workflow_core_brainstorm",
      provider_mode: "core",
      provider_status: "ready",
      contract_version: 1,
      rounds: [
        {
          round_id: "round-1",
          status: "completed",
          options: [{ option_id: "opt-1", title: "Route", score: 0.9 }],
        },
      ],
      selected_round_id: "round-1",
      selected_option_id: "opt-1",
    },
  });

  const completion = await resolveFrontierMappingCompletion(projectRoot);
  assert.equal(completion.completionStatus, "complete");
  assert.equal(completion.nextAction, "/idea-catalyst");
});

test("code completion uses local code review bundle blockers as canonical readiness", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-code-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "code",
    current_stage: "code",
    owner_agent: "coder",
    research_program: {
      tracks: [
        {
          track_id: "track-main",
          status: "active",
          hypothesis: "Graph evidence improves routing.",
          novelty_basis: "Graph-grounded claim support.",
          main_metric: "support_precision",
          required_baselines: ["baseline"],
          required_ablations: ["minus-graph"],
          required_controls: ["seed-control"],
        },
      ],
    },
  });
  for (const relativePath of [
    "orchestrator/PLAN.md",
    "orchestrator/TODOS.md",
    "orchestrator/PLAN_AUDIT.md",
    "coder/EXPERIMENT_INDEX.md",
  ]) {
    await writeText(path.join(projectRoot, relativePath));
  }
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), {
    tracks: [{ track_id: "track-main", status: "active" }],
  });
  const bundleDir = path.join(projectRoot, "coder", "experiments", "track-main", "exp-1");
  await writeText(path.join(bundleDir, "train.py"), "print('ok')\n");
  await writeText(path.join(bundleDir, "README.md"), "# Experiment\n");
  await writeJson(path.join(bundleDir, "EXPERIMENT_MANIFEST.json"), {
    track_id: "track-main",
    question: "Does graph evidence improve routing?",
    hypothesis: "Graph evidence improves routing.",
    novelty_basis: "Graph-grounded claim support.",
    baseline_reference: "baseline",
    primary_baseline_metric: "support_precision",
    target_improvement: "+5%",
    baseline_training_protocol: "Run baseline training.",
    baseline_eval_protocol: "Evaluate support precision.",
    innovation_points: ["graph evidence"],
    validation_steps: ["Validate graph evidence"],
    ablation_plan: ["Ablate graph evidence"],
    implementation_proof: {
      changed_files: ["train.py"],
      integration_points: [{ path: "train.py", summary: "wire graph evidence" }],
      activation_signals: [{ summary: "logs graph evidence enabled" }],
      execution_command: "python train.py",
    },
  });

  const completion = await resolveCodeCompletion(projectRoot);
  assert.equal(completion.completionStatus, "complete");
  assert.equal(completion.nextAction, "/monitor-experiment");
});

test("experiment completion remains waiting while multi seed validation is pending", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-experiment-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "experiment-pending",
    current_stage: "experiment",
    owner_agent: "researcher",
    experiment_search: {
      status: "ready_for_analysis",
      last_decision: "continue_tuning",
      multi_seed_status: "pending",
    },
  });

  const completion = await resolveExperimentCompletion(projectRoot);
  assert.equal(completion.completionStatus, "incomplete");
  assert.equal(completion.blockingReason, "multi_seed_validation_pending");
  assert.equal(completion.nextAction, "/monitor-experiment");

  const reconciled = await reconcileWorkflowControl({
    projectRoot,
    now: "2026-05-12T00:03:00.000Z",
  });
  assert.equal(reconciled.contract.stage, "experiment");
  assert.equal(reconciled.contract.owner, "researcher");
  assert.equal(reconciled.contract.next_action, "/monitor-experiment");
  assert.equal(reconciled.contract.status, "waiting");
  assert.equal(reconciled.contract.completion.status, "incomplete");
  assert.equal(reconciled.contract.blocking_reason, "multi_seed_validation_pending");

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  manifest.experiment_search.last_decision = "advance";
  manifest.experiment_search.multi_seed_status = "ready";
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);

  const missingPlotPack = await resolveExperimentCompletion(projectRoot);
  assert.equal(missingPlotPack.completionStatus, "incomplete");
  assert.equal(missingPlotPack.blockingReason, "plot_pack_aggregation_pending");

  manifest.experiment_search.plot_pack_status = "ready";
  manifest.experiment_search.plot_pack_path = "researcher/plot_pack.json";
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);
  await writeJson(path.join(projectRoot, "researcher", "plot_pack.json"), {
    status: "ready",
    plots: [{ figure_id: "fig-1" }],
  });
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    experiments: [
      {
        experiment_id: "exp-1",
        status: "completed",
        resultPaths: ["researcher/artifacts/results/metrics.json"],
      },
    ],
  });
  const runDir = path.join(projectRoot, "coder", "experiments", "track-main", "exp-1");
  await writeJson(path.join(runDir, "EXPERIMENT_MANIFEST.json"), {
    git: { last_candidate_commit: "abc1234" },
  });
  await writeJson(path.join(runDir, "REMOTE_RUN.json"), {
    experiment_id: "exp-1",
    status: "completed",
    git_commit: "abc1234",
  });
  await writeJson(path.join(runDir, "RESULT_SUMMARY.json"), {
    experiment_id: "exp-1",
    metrics: { h_score: 0.61 },
    result_paths: ["researcher/artifacts/results/metrics.json"],
  });

  const ready = await resolveExperimentCompletion(projectRoot);
  assert.equal(ready.completionStatus, "complete");
  assert.equal(ready.nextAction, "/analyze-results");
});

test("topic search and literature review require discovery packet evidence", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-literature-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "literature-evidence",
    current_stage: "topic_search",
    owner_agent: "researcher",
  });
  await writeJson(path.join(projectRoot, "researcher", "LITERATURE_DISCOVERY_RUN.json"), {
    status: "ready",
  });

  const shallowTopic = await resolveTopicSearchCompletion(projectRoot);
  assert.equal(shallowTopic.completionStatus, "incomplete");
  assert.equal(
    shallowTopic.blockingReason,
    "literature_discovery_packet_missing_or_empty"
  );

  await writeJson(
    path.join(projectRoot, "researcher", "literature-discovery", "LITERATURE_DISCOVERY_PACKET.json"),
    {
      discovery_id: "lit-1",
      target_domains: ["Generalized Category Discovery"],
      candidate_queries: [{ query: "GCD support preservation" }],
      selected_papers: ["paper-1"],
    }
  );

  const topic = await resolveTopicSearchCompletion(projectRoot);
  assert.equal(topic.completionStatus, "complete");
  assert.equal(topic.nextAction, "/research-briefing");

  const noBrief = await resolveLiteratureReviewCompletion(projectRoot);
  assert.equal(noBrief.completionStatus, "incomplete");
  assert.equal(noBrief.blockingReason, "literature_review_brief_missing");

  await writeText(
    path.join(projectRoot, "researcher", "LITERATURE_REVIEW.md"),
    "# Literature Review\n- Paper-backed gap synthesis\n"
  );
  const review = await resolveLiteratureReviewCompletion(projectRoot);
  assert.equal(review.completionStatus, "complete");
  assert.equal(review.nextAction, "/idea-catalyst");
});

test("ideation completion rejects shallow packet status without idea evidence", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-ideation-shallow-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "ideation-shallow",
    current_stage: "ideation",
    owner_agent: "researcher",
  });
  await writeJson(path.join(projectRoot, "researcher", "IDEA_CATALYST_PACKET.json"), {
    status: "ready",
  });

  const completion = await resolveIdeationCompletion(projectRoot);
  assert.equal(completion.completionStatus, "incomplete");
  assert.equal(completion.blockingReason, "idea_catalyst_packet_incomplete");
});

test("ideation completion accepts PaperNexus idea-catalyst bundle evidence", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-ideation-bundle-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "ideation-bundle",
    current_stage: "ideation",
    owner_agent: "researcher",
  });
  await writeJson(
    path.join(projectRoot, "researcher", "papernexus", "IDEA_CATALYST_PACKET_BUNDLE.json"),
    {
      packet_bundle: {
        source_domain_analyses: [
          {
            source_domain: "Psychology",
            supporting_papers: ["Belief Updating Under Uncertainty"],
            takeaways: [
              {
                concept: "metacontrol policy",
                mechanism_explanation:
                  "Balances persistence and flexibility under uncertainty.",
                supporting_papers: ["Belief Updating Under Uncertainty"],
              },
            ],
          },
        ],
        idea_fragments: [
          {
            candidate_id: "idea-1",
            source_domain: "Psychology",
            title: "Metacontrol support router",
            supporting_papers: ["Belief Updating Under Uncertainty"],
            evidence_chain_refs: [{ ref_id: "chain-1" }],
          },
        ],
      },
    }
  );

  const completion = await resolveIdeationCompletion(projectRoot);
  assert.equal(completion.completionStatus, "complete");
  assert.equal(completion.nextAction, "/plan-experiment");
});

test("ideation completion accepts canonical ready idea-catalyst state", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-ideation-state-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "ideation-state",
    current_stage: "idea",
    owner_agent: "researcher",
    idea_catalyst: {
      status: "ready",
      contract_version: 1,
      top_fragment_id: "frag-1",
      requisition_required: false,
    },
  });

  const completion = await resolveIdeationCompletion(projectRoot);
  assert.equal(completion.completionStatus, "complete");
  assert.equal(completion.nextAction, "/plan-experiment");
});

test("experiment plan completion requires innovation packet evidence trace", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-experiment-plan-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "experiment-plan",
    current_stage: "experiment_plan",
    owner_agent: "orchestrator",
  });
  await writeJson(path.join(projectRoot, "orchestrator", "INNOVATION_PACKET.json"), {
    selected_idea_fragment_id: "idea-1",
    baseline: "FixMatch baseline",
    primary_metric: "H-score",
    fixed_budget: "5m CPU trial",
  });

  const shallow = await resolveExperimentPlanCompletion(projectRoot);
  assert.equal(shallow.completionStatus, "incomplete");
  assert.equal(shallow.blockingReason, "innovation_packet_missing_traceable_evidence");

  await writeJson(path.join(projectRoot, "orchestrator", "INNOVATION_PACKET.json"), {
    selected_idea_fragment_id: "idea-1",
    baseline: "FixMatch baseline",
    primary_metric: "H-score",
    fixed_budget: "5m CPU trial",
    evidence_paths: ["researcher/papernexus/IDEA_CATALYST_PACKET_BUNDLE.json"],
  });
  const ready = await resolveExperimentPlanCompletion(projectRoot);
  assert.equal(ready.completionStatus, "complete");
  assert.equal(ready.owner, "coder");
});

test("analysis completion requires report plus experiment ledger evidence", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-analysis-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "analysis",
    current_stage: "analysis",
    owner_agent: "analyzer",
  });
  await writeText(
    path.join(projectRoot, "analyzer", "ANALYSIS_REPORT.md"),
    "# Analysis\n"
  );

  const noLedger = await resolveAnalysisCompletion(projectRoot);
  assert.equal(noLedger.completionStatus, "incomplete");
  assert.equal(noLedger.blockingReason, "experiment_results_missing");

  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    experiments: [
      {
        experiment_id: "trial-1",
        status: "completed",
        git_branch: "trial/trial-1",
        commit_hash: "abc1234",
        fixed_budget: "5m CPU",
        seed: 1,
        decision: "promote",
        metrics: { h_score: 0.61 },
      },
    ],
  });
  const ready = await resolveAnalysisCompletion(projectRoot);
  assert.equal(ready.completionStatus, "complete");
  assert.equal(ready.nextAction, "/write-paper");
});

test("analysis completion rejects shallow experiment ledger without git-managed trial evidence", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-analysis-shallow-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "analysis-shallow",
    current_stage: "analysis",
    owner_agent: "analyzer",
  });
  await writeText(path.join(projectRoot, "analyzer", "ANALYSIS_REPORT.md"), "# Analysis\n");
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    experiments: [
      {
        experiment_id: "trial-1",
        status: "completed",
        metrics: { h_score: 0.61 },
      },
    ],
  });

  const completion = await resolveAnalysisCompletion(projectRoot);
  assert.equal(completion.completionStatus, "incomplete");
  assert.equal(completion.blockingReason, "experiment_results_missing");
});

test("analysis completion accepts execution proof receipts as result evidence", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-analysis-proof-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "analysis-proof",
    current_stage: "analysis",
    owner_agent: "analyzer",
    experiment_search: {
      status: "ready_for_analysis",
      candidate_head_commit: "abc1234",
      multi_seed_status: "ready",
    },
    orchestration_state: {
      stage_run_id: "stage-run-proof",
    },
  });
  await writeText(path.join(projectRoot, "analyzer", "ANALYSIS_REPORT.md"), "# Analysis\n");
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    experiments: [
      {
        experiment_id: "trial-proof",
        status: "completed",
        metrics: { h_score: 0.61 },
        resultPaths: ["researcher/artifacts/results/metrics.json"],
      },
    ],
  });
  const runDir = path.join(projectRoot, "coder", "experiments", "track-1", "trial-proof");
  await writeJson(path.join(runDir, "EXPERIMENT_MANIFEST.json"), {
    git: { last_candidate_commit: "abc1234" },
  });
  await writeJson(path.join(runDir, "REMOTE_RUN.json"), {
    experiment_id: "trial-proof",
    status: "completed",
    git_commit: "abc1234",
    stage_run_id: "stage-run-proof",
  });
  await writeJson(path.join(runDir, "RESULT_SUMMARY.json"), {
    experiment_id: "trial-proof",
    metrics: { h_score: 0.61 },
    result_paths: ["researcher/artifacts/results/metrics.json"],
    stage_run_id: "stage-run-proof",
  });

  const completion = await resolveAnalysisCompletion(projectRoot);
  assert.equal(completion.completionStatus, "complete");
  assert.equal(completion.nextAction, "/write-paper");
});

test("analysis completion accepts nested canonical trial contract evidence", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-analysis-trial-contract-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "analysis-trial-contract",
    current_stage: "analysis",
    owner_agent: "analyzer",
  });
  await writeText(path.join(projectRoot, "analyzer", "ANALYSIS_REPORT.md"), "# Analysis\n");
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    experiments: [
      {
        experiment_id: "trial-contract-1",
        status: "completed",
        key_metric: { name: "h_score", value: 0.64 },
        metadata: {
          trial_contract: {
            git_branch: "experiment/candidate/trial-contract-1",
            worktree_path: "/tmp/trial-contract-1",
            commit_hash: "abc1234",
            fixed_budget_minutes: 5,
            seed: 42,
            decision: "advance",
          },
        },
      },
    ],
  });

  const completion = await resolveAnalysisCompletion(projectRoot);
  assert.equal(completion.completionStatus, "complete");
  assert.equal(completion.nextAction, "/write-paper");
});

test("analysis completion blocks promoted trials until multi-seed gate is ready", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-analysis-multiseed-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "analysis-multiseed",
    current_stage: "analysis",
    owner_agent: "analyzer",
    experiment_search: {
      status: "ready_for_analysis",
      multi_seed_status: "pending",
    },
    research_program: {
      global_constraints: {
        must_run_multi_seed_before_analysis: true,
      },
    },
  });
  await writeText(path.join(projectRoot, "analyzer", "ANALYSIS_REPORT.md"), "# Analysis\n");
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    experiments: [
      {
        experiment_id: "trial-contract-1",
        status: "completed",
        key_metric: { name: "h_score", value: 0.64 },
        metadata: {
          trial_contract: {
            worktree_path: "/tmp/trial-contract-1",
            commit_hash: "abc1234",
            fixed_budget_minutes: 5,
            seed: 42,
            decision: "advance",
          },
        },
      },
    ],
  });

  const blocked = await resolveAnalysisCompletion(projectRoot);
  assert.equal(blocked.completionStatus, "incomplete");
  assert.equal(blocked.blockingReason, "multi_seed_validation_pending");

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  manifest.experiment_search.multi_seed_status = "complete";
  manifest.experiment_search.plot_pack_status = "complete";
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);

  const ready = await resolveAnalysisCompletion(projectRoot);
  assert.equal(ready.completionStatus, "complete");
});

test("survey review completion requires the canonical survey gate and brief evidence", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-survey-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "survey",
    current_stage: "survey_review",
    owner_agent: "researcher",
    survey_review: {
      status: "completed",
      graph_grounded_brief_ready: true,
      gate_ready: false,
      survey_brief_path: "researcher/SURVEY_BRIEF.md",
    },
  });

  const shallow = await resolveSurveyReviewCompletion(projectRoot);
  assert.equal(shallow.completionStatus, "incomplete");
  assert.equal(shallow.blockingReason, "survey_review_brief_missing");

  await writeText(path.join(projectRoot, "researcher", "SURVEY_BRIEF.md"), "# Survey\n");
  const noGate = await resolveSurveyReviewCompletion(projectRoot);
  assert.equal(noGate.completionStatus, "incomplete");
  assert.equal(noGate.blockingReason, "survey_review_gate_not_ready");

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  manifest.survey_review.gate_ready = true;
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);

  const ready = await resolveWorkflowStageCompletion({
    projectRoot,
    stage: "survey_review",
  });
  assert.equal(ready.completionStatus, "complete");
  assert.equal(ready.nextAction, "/write-paper");
});

test("writing completion requires draft plus quality evidence", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-writing-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "writing-quality",
    current_stage: "writing",
    owner_agent: "academic_writer",
  });
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    "\\section{Draft}\n"
  );

  const shallow = await resolveWritingCompletion(projectRoot);
  assert.equal(shallow.completionStatus, "incomplete");
  assert.equal(shallow.blockingReason, "writing_quality_not_ready");

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "writing-quality",
    current_stage: "writing",
    owner_agent: "academic_writer",
    paper_qc: {
      status: "ready",
      compile_status: "pass",
    },
  });

  const ready = await resolveWritingCompletion(projectRoot);
  assert.equal(ready.completionStatus, "complete");
  assert.equal(ready.nextAction, "/submit-ready");
});

test("writing completion keeps single-seed experiment wins out of paper drafting", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-writing-multiseed-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "writing-multiseed",
    current_stage: "writing",
    owner_agent: "academic_writer",
    experiment_search: {
      status: "ready_for_analysis",
      multi_seed_status: "pending",
    },
    research_program: {
      global_constraints: {
        must_run_multi_seed_before_analysis: true,
      },
    },
    paper_qc: {
      status: "ready",
      compile_status: "pass",
    },
  });
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    "\\section{Draft}\n"
  );

  const blocked = await resolveWritingCompletion(projectRoot);
  assert.equal(blocked.completionStatus, "incomplete");
  assert.equal(blocked.blockingReason, "experiment_multi_seed_validation_pending");

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  manifest.experiment_search.multi_seed_status = "complete";
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);

  const missingPlotPack = await resolveWritingCompletion(projectRoot);
  assert.equal(missingPlotPack.completionStatus, "incomplete");
  assert.equal(missingPlotPack.blockingReason, "experiment_plot_pack_pending");

  manifest.experiment_search.plot_pack_status = "complete";
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);

  const ready = await resolveWritingCompletion(projectRoot);
  assert.equal(ready.completionStatus, "complete");
});

test("legacy write stage uses canonical write package and hook gate evidence", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-write-legacy-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "write-legacy",
    current_stage: "write",
    owner_agent: "academic_writer",
    write_package: {
      status: "ready",
    },
    paper_qc: {
      status: "ready",
      compile_status: "pass",
    },
  });
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    "\\section{Draft}\n"
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "sections", "appendix_theory.tex"),
    "\\section{Theory appendix}\n"
  );

  const shallowPackage = await resolveWorkflowStageCompletion({
    projectRoot,
    stage: "write",
  });
  assert.equal(shallowPackage.completionStatus, "incomplete");
  assert.equal(shallowPackage.blockingReason, "write_package_not_ready");

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  manifest.write_package = await writeReadyWritePackage(projectRoot);
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);

  await writeJson(
    path.join(projectRoot, ".openclaw-research", "workflow-hooks-state.json"),
    {
      hook_points: {
        before_stage_complete: {
          write: {
            aggregate_status: "revise_requested",
            aggregate_verdict: "revise",
          },
        },
      },
    }
  );
  const hookBlocked = await resolveWorkflowStageCompletion({
    projectRoot,
    stage: "write",
  });
  assert.equal(hookBlocked.completionStatus, "incomplete");
  assert.equal(hookBlocked.blockingReason, "workflow_hooks_revision_requested");

  await writeJson(
    path.join(projectRoot, ".openclaw-research", "workflow-hooks-state.json"),
    {
      hook_points: {
        before_stage_complete: {
          write: {
            aggregate_status: "passed",
            aggregate_verdict: "pass",
          },
        },
      },
    }
  );
  const ready = await resolveWorkflowStageCompletion({
    projectRoot,
    stage: "write",
  });
  assert.equal(ready.completionStatus, "complete");
  assert.equal(ready.contractSource, "write_completion");
});

test("polish review completion is blocked by incomplete PaperGuru six-pass gate", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-polish-blocked-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "polish-blocked",
    current_stage: "polish_review",
    owner_agent: "reviewer",
    writing_contract: {
      scientific_editing_required: true,
      scientific_editing_status: "ready",
      scientific_editing_passes: PAPERGURU_PASS_IDS,
      scientific_editing_ledger_path: "academic_writer/SCIENTIFIC_EDIT_LEDGER.json",
      scientific_editing_report_path: "academic_writer/SCIENTIFIC_EDIT_REPORT.md",
    },
  });
  await writeJson(path.join(projectRoot, "academic_writer", "SCIENTIFIC_EDIT_LEDGER.json"), {
    pass_results: [
      { pass_id: "pass_1_structure", status: "completed" },
    ],
  });
  await writeText(path.join(projectRoot, "academic_writer", "SCIENTIFIC_EDIT_REPORT.md"));
  await writeJson(path.join(projectRoot, "reviewer", "REVIEW_FINDINGS.json"), {
    status: "ready",
  });

  const completion = await resolvePolishReviewCompletion(projectRoot);
  assert.equal(completion.completionStatus, "blocked");
  assert.equal(completion.blockingReason, "paperguru_gate_blocked");
  assert.equal(completion.nextAction, "/review-paper");
});

test("polish review completion is blocked by unverified citation integrity", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-review-citation-");
  await writePaperGuruReadyArtifacts(projectRoot);
  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  manifest.current_stage = "review";
  manifest.owner_agent = "reviewer";
  manifest.citation_integrity = {
    verification_status: "needs_revision",
    hallucinated_citation_count: 1,
  };
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);
  await writeJson(path.join(projectRoot, "reviewer", "REVIEW_FINDINGS.json"), {
    status: "ready",
  });

  const completion = await resolvePolishReviewCompletion(projectRoot, {
    stage: "review",
    incompleteNextAction: "/review-paper",
    contractSource: "review_completion",
  });

  assert.equal(completion.completionStatus, "incomplete");
  assert.equal(completion.blockingReason, "citation_integrity_not_verified");
  assert.match(completion.missingSignals[0] ?? "", /verification_status/i);
});

test("polish review and submission complete only after PaperGuru and terminal paper artifacts are ready", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-submission-");
  await writePaperGuruReadyArtifacts(projectRoot);
  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  manifest.current_stage = "polish_review";
  manifest.owner_agent = "reviewer";
  manifest.submission_ready = { status: "ready" };
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);
  await writeText(path.join(projectRoot, "reviewer", "REVIEW_FINDINGS.json"), "{\"status\":\"ready\"}\n");
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    "\\section{Ready}\n"
  );

  const review = await resolvePolishReviewCompletion(projectRoot);
  assert.equal(review.completionStatus, "complete");

  const missingPdf = await resolveSubmissionReadyCompletion(projectRoot);
  assert.equal(missingPdf.completionStatus, "incomplete");
  assert.equal(missingPdf.blockingReason, "terminal_paper_artifacts_not_ready");

  await writeText(path.join(projectRoot, "academic_writer", "paper", "main.pdf"), "%PDF-1.4\n");
  const ready = await resolveSubmissionReadyCompletion(projectRoot);
  assert.equal(ready.completionStatus, "complete");
  assert.equal(ready.nextAction, "/done");
});

test("done completion does not mask unfinished experiment promotion gates", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-done-gate-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "done-gate",
    current_stage: "done",
    owner_agent: "researcher",
    next_action: "/monitor-experiment",
    blocking_reason: "multi_seed_validation_pending",
    experiment_search: {
      status: "searching",
      last_decision: "continue_tuning",
      multi_seed_status: "pending",
      ablation_status: "pending",
      innovation_status: "unsupported",
    },
    research_program: {
      global_constraints: {
        must_run_multi_seed_before_analysis: true,
      },
    },
  });

  const completion = await resolveWorkflowStageCompletion({
    projectRoot,
    stage: "done",
  });
  assert.equal(completion.stage, "experiment");
  assert.equal(completion.completionStatus, "incomplete");
  assert.equal(completion.owner, "researcher");
  assert.equal(completion.nextAction, "/monitor-experiment");
  assert.equal(completion.blockingReason, "multi_seed_validation_pending");
  assert.equal(completion.contractSource, "done_completion");

  const reconciled = await reconcileWorkflowControl({
    projectRoot,
    now: "2026-05-14T00:00:00.000Z",
  });
  assert.equal(reconciled.contract.stage, "experiment");
  assert.equal(reconciled.contract.completion.status, "incomplete");
  assert.equal(reconciled.contract.blocking_reason, "multi_seed_validation_pending");
});

test("done completion does not mask active workflow-owned literature requisitions", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-done-requisition-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "done-requisition",
    current_stage: "done",
    owner_agent: "researcher",
    paper_ingestion: {
      graph_presence_status: "ready",
      queued_requests: [
        {
          request_id: "idea-catalyst-req-gap",
          request_kind: "requisition",
          trigger_kind: "idea_catalyst_requisition",
          status: "running",
          started_at: "2026-05-14T00:00:00.000Z",
          attempt_count: 1,
        },
      ],
    },
  });

  const completion = await resolveWorkflowStageCompletion({
    projectRoot,
    stage: "done",
  });
  assert.equal(completion.stage, "graph_build");
  assert.equal(completion.completionStatus, "incomplete");
  assert.equal(completion.owner, "researcher");
  assert.equal(completion.nextAction, "/graph-build");
  assert.equal(completion.blockingReason, "graph_reentry_request_active");
  assert.equal(completion.contractSource, "done_completion");
});

test("done completion requires terminal analysis writing review and submit evidence", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-done-terminal-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "done-terminal",
    current_stage: "done",
    owner_agent: "orchestrator",
    paper_qc: {
      status: "ready",
      compile_status: "pass",
      page_budget_status: "pass",
      invalid_figure_ref_status: "pass",
    },
    submission_ready: {
      status: "ready",
    },
  });

  const shallow = await resolveWorkflowStageCompletion({
    projectRoot,
    stage: "done",
  });
  assert.equal(shallow.completionStatus, "incomplete");
  assert.equal(shallow.stage, "analysis");
  assert.equal(shallow.blockingReason, "analysis_report_missing");

  await writeText(path.join(projectRoot, "analyzer", "ANALYSIS_REPORT.md"), "# Analysis\n");
  await writeJson(
    path.join(projectRoot, "researcher", "artifacts", "results", "results.json"),
    { metrics: [{ name: "score", value: 0.91 }] }
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    "\\section{Ready}\n"
  );
  await writeText(path.join(projectRoot, "reviewer", "REVIEW_FINDINGS.json"), "{\"status\":\"ready\"}\n");

  const missingPdf = await resolveWorkflowStageCompletion({
    projectRoot,
    stage: "done",
  });
  assert.equal(missingPdf.completionStatus, "incomplete");
  assert.equal(missingPdf.stage, "submit");
  assert.equal(missingPdf.blockingReason, "terminal_paper_artifacts_not_ready");

  await writeText(path.join(projectRoot, "academic_writer", "paper", "main.pdf"), "%PDF-1.4\n");

  const ready = await resolveWorkflowStageCompletion({
    projectRoot,
    stage: "done",
  });
  assert.equal(ready.stage, "done");
  assert.equal(ready.completionStatus, "complete");
  assert.equal(ready.nextAction, null);
  assert.equal(ready.contractSource, "done_completion");
});

test("runtime ownership marks stale running queue degraded when no active session exists", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-runtime-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "runtime-degraded",
    current_stage: "experiment",
    owner_agent: "researcher",
  });
  await writeJson(
    path.join(projectRoot, ".openclaw-research", "workflow-runtime-queue.json"),
    {
      entries: [
        {
          transition_id: "transition-1",
          queue_key: "queue:experiment:researcher",
          owner_agent: "researcher",
          channel_key: "local",
          requester_session_key: "requester",
          family: "workflow",
          kind: "dispatch",
          queued_at: "2026-05-12T00:00:00.000Z",
          status: "running",
          project_root: projectRoot,
          dispatch_payload: {
            to_role: "researcher",
            project_root: projectRoot,
            stage: "experiment",
            summary: "stale running queue",
          },
        },
      ],
    }
  );
  await writeJson(
    path.join(projectRoot, ".openclaw-research", "workflow-runtime-sessions.json"),
    {
      entries: [],
    }
  );

  const runtime = await resolveRuntimeOwnership(projectRoot, {
    stage: "experiment",
    owner: "researcher",
    nextAction: "/monitor-experiment",
  });
  assert.equal(runtime.runtimeState, "degraded");
  assert.equal(runtime.queueKey, "queue:experiment:researcher");
  assert.equal(runtime.sessionKey, null);
  assert.equal(
    runtime.blockingReason,
    "stale_runtime_queue_without_active_session"
  );
});

test("setup completion owner stays aligned with stage routing policy", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-setup-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "setup-owner",
    current_stage: "setup",
    owner_agent: "researcher",
  });

  const completion = await resolveWorkflowStageCompletion({
    projectRoot,
    stage: "setup",
  });
  assert.equal(completion.owner, "researcher");

  const reconciled = await reconcileWorkflowControl({
    projectRoot,
    now: "2026-05-12T00:04:00.000Z",
  });
  assert.equal(reconciled.contract.stage, "setup");
  assert.equal(reconciled.contract.owner, "researcher");
});

test("default legacy stage completion keeps the registered next action", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-wf-stage-default-action-");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "code-action",
    current_stage: "code",
    owner_agent: "coder",
  });

  const completion = await resolveWorkflowStageCompletion({
    projectRoot,
    stage: "code",
  });
  assert.equal(completion.owner, "coder");
  assert.equal(completion.nextAction, "/run-experiment");
  assert.equal(completion.contractSource, "code_completion");
});

test("workflow control modules obey canonical dependency direction", async () => {
  const repoRoot = path.resolve(
    "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research"
  );
  const stageCompletion = await fs.readFile(
    path.join(repoRoot, "tools", "workflow-stage-completion.ts"),
    "utf8"
  );
  const reconciler = await fs.readFile(
    path.join(repoRoot, "tools", "workflow-control-reconciler.ts"),
    "utf8"
  );

  assert.doesNotMatch(stageCompletion, /register-workflow-tools|discord|gateway/i);
  assert.doesNotMatch(reconciler, /register-workflow-tools|discord-panel|sessions\.create/i);
});
