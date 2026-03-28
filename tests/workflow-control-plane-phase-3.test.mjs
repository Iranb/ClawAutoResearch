import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  assembleWritePackage,
  buildFocusedPromptAssembly,
  getBrainstormCycleStateSummary,
  getOrchestrationStateSummary,
  getResearchProgramStateSummary,
  getReviewIssueTrackerStateSummary,
  getWritePackageStateSummary,
  runBrainstormCycle,
  runWorkflowAutoIterator,
  setExperimentSearchState,
  setOrchestrationState,
  setResearchProgramState,
  setWritePackageState,
} from "../tools/workflow-guard.ts";
import { createPluginRegistrationContext } from "../tools/plugin-registration-shared.ts";
import { registerWorkflowTools } from "../tools/register-workflow-tools.ts";
import { getWorkflowTraceLogPath } from "../tools/workflow-trace.ts";

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath, value = "# artifact\n") {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
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
}

async function makeProjectRoot() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-control-plane-phase-3-")
  );
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    title: "Demo Project",
    owner_agent: "orchestrator",
    current_stage: "plan",
    current_micro_stage: "planning_requested",
    idle_research: { enabled: false },
  });
  return projectRoot;
}

function createResearchWorkflowTool(params = {}) {
  let registeredTool = null;
  const api = {
    runtime: {},
    logger: {},
    registerTool(spec) {
      registeredTool = spec;
    },
  };
  const plugin = createPluginRegistrationContext(api);
  registerWorkflowTools(plugin);
  assert.ok(registeredTool);
  const tool =
    typeof registeredTool === "function"
      ? registeredTool({
          workspaceDir: params.workspaceDir,
          agentId: params.agentId ?? "orchestrator",
          sessionKey: params.sessionKey ?? "agent:orchestrator:test",
          sessionId: params.sessionId ?? "session-test",
          messageChannel: params.messageChannel ?? "discord",
        })
      : registeredTool;
  assert.equal(tool?.name, "research_workflow");
  return tool;
}

async function executeWorkflowTool(tool, params) {
  const response = await tool.execute("test-call", params);
  assert.equal(response.content[0]?.type, "text");
  return JSON.parse(response.content[0].text);
}

async function seedPlanProject(projectRoot) {
  const now = "2026-03-26T09:00:00.000Z";
  await writeText(path.join(projectRoot, "CLAIM_POLICY.md"));
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), {
    tracks: [
      {
        track_id: "track-main",
        status: "active",
        evidence_pointers: ["graph/ANCHOR_INDEX.md"],
        reasoning_packet_dir: "researcher/reasoning/track-main",
        working_memory_path: "researcher/working-memory/track-main.md",
        synthesis_packet_path: "researcher/synthesis/track-main.md",
      },
    ],
  });
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "paper-1",
      title: "Demo Paper",
      arxiv_id: "1234.56789",
      source_provider: "hugging-face-paper-pages",
      retrieval_providers: ["hugging-face-paper-pages"],
    },
  ]);
  await seedGraphCorpus(projectRoot, [
    {
      canonicalId: "paper-1",
      title: "Demo Paper",
      sourceProvider: "hugging-face-paper-pages",
      retrievalProviders: ["hugging-face-paper-pages"],
      activeInGraph: true,
    },
  ]);
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    schemaVersion: 1,
    projectId: "demo-project",
    updatedAt: now,
    summary: {
      activeExperimentIds: [],
      lastCompletedExperimentId: null,
      lastFailedExperimentId: null,
      bestKnownConfigRef: null,
      lastDecisionSummary: null,
      papernexusSyncRequired: false,
      papernexusLastSyncAt: now,
    },
    experiments: [],
  });
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    status: "ready",
  });
  await writeJson(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), {
    status: "ready",
  });
  await writeText(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"));
  for (const name of [
    "LIMITATION_FRONTIER.md",
    "CONTRADICTION_FRONTIER.md",
    "TRANSFER_FRONTIER.md",
    "COMPOSITION_FRONTIER.md",
    "ANCHOR_INDEX.md",
  ]) {
    await writeText(path.join(projectRoot, "graph", name));
  }
  await writeText(path.join(projectRoot, "researcher", "FRONTIER_REPORT.md"));
  await writeText(path.join(projectRoot, "researcher", "IDEA_REPORT.md"));
  await writeText(path.join(projectRoot, "researcher", "IDEA_AUDIT.md"));
  await writeJson(
    path.join(projectRoot, "researcher", "reasoning", "track-main", "TOPIC_SUMMARY.json"),
    {
      objective: "Demo brainstorm topic",
    }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "reasoning", "track-main", "RESEARCH_BRIEF.json"),
    {
      anchors: ["anchor-demo"],
    }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "reasoning", "track-main", "BRAINSTORM_BRIEF.json"),
    {
      mode: "diverge_then_converge",
    }
  );
  await writeText(
    path.join(projectRoot, "researcher", "reasoning", "track-main", "LOGIC_CHAIN.md"),
    "# Logic chain\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "reasoning", "track-main", "EVIDENCE_CHAIN.md"),
    "# Evidence chain\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "reasoning", "track-main", "REASONING_TRACE.jsonl"),
    "{\"step\":\"seed\"}\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "reasoning", "track-main", "QUESTION_PACKET.md"),
    "# Question packet\n"
  );
  await writeJson(
    path.join(projectRoot, "researcher", "reasoning", "track-main", "WORKING_MEMORY.json"),
    {
      hypothesis: "track-main",
    }
  );
  await writeText(
    path.join(projectRoot, "researcher", "reasoning", "track-main", "SYNTHESIS_PACKET.md"),
    "# Synthesis packet\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "working-memory", "track-main.md"),
    "working memory\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "synthesis", "track-main.md"),
    "synthesis packet\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "INNOVATION_REFLECTION.md"),
    "reflection\n"
  );
  await fs.mkdir(path.join(projectRoot, "researcher", "reasoning", "track-main"), {
    recursive: true,
  });
  await writeText(
    path.join(projectRoot, "researcher", "reasoning", "track-main", "packet.md"),
    "reasoning packet\n"
  );
  await writeText(path.join(projectRoot, "orchestrator", "PLAN.md"));
  await writeText(path.join(projectRoot, "orchestrator", "TODOS.md"));
  await writeText(path.join(projectRoot, "orchestrator", "PLAN_AUDIT.md"));
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    title: "Demo Project",
    owner_agent: "orchestrator",
    current_stage: "plan",
    current_micro_stage: "frontiers_packaged",
    idle_research: { enabled: false },
    innovation_reflection: {
      required_after_experiments: false,
      status: "ready",
      last_reflection_at: now,
      last_reflection_path: "researcher/INNOVATION_REFLECTION.md",
    },
    brainstorm_cycle: {
      status: "reconciled",
      mode: "aggressive",
      topic: "Demo brainstorm topic",
      basis_stage: "frontier_mapping",
      track_id: "track-main",
      rounds: [
        {
          round_id: "seed-round",
          label: "seed",
          status: "completed",
          options: [
            {
              option_id: "seed-option",
              title: "Seed option",
              score: 0.9,
            },
          ],
        },
      ],
      selected_round_id: "seed-round",
      selected_option_id: "seed-option",
      selected_option_title: "Seed option",
      selected_option_score: 0.9,
      selection_mode: "aggressive",
      topic_summary_path: "researcher/reasoning/track-main/TOPIC_SUMMARY.json",
      research_brief_path: "researcher/reasoning/track-main/RESEARCH_BRIEF.json",
      brainstorm_brief_path: "researcher/reasoning/track-main/BRAINSTORM_BRIEF.json",
      logic_chain_path: "researcher/reasoning/track-main/LOGIC_CHAIN.md",
      evidence_chain_path: "researcher/reasoning/track-main/EVIDENCE_CHAIN.md",
      reasoning_trace_path: "researcher/reasoning/track-main/REASONING_TRACE.jsonl",
      question_packet_path: "researcher/reasoning/track-main/QUESTION_PACKET.md",
      working_memory_path: "researcher/reasoning/track-main/WORKING_MEMORY.json",
      synthesis_packet_path: "researcher/reasoning/track-main/SYNTHESIS_PACKET.md",
      graph_version_seen: "global-v0",
      import_task_ids_seen: [],
      latest_run_at: now,
    },
    paper_ingestion: {
      graph_presence_checked_at: now,
      graph_presence_status: "ready",
    },
  });
}

async function seedExperimentProject(projectRoot) {
  const now = "2026-03-26T10:00:00.000Z";
  await seedPlanProject(projectRoot);
  await writeText(
    path.join(
      projectRoot,
      "coder",
      "experiments",
      "track-main",
      "exp-1__baseline",
      "train.py"
    ),
    "print('train')\n"
  );
  await writeText(
    path.join(
      projectRoot,
      "coder",
      "experiments",
      "track-main",
      "exp-1__baseline",
      "README.md"
    ),
    "# baseline\n"
  );
  await writeJson(
    path.join(
      projectRoot,
      "coder",
      "experiments",
      "track-main",
      "exp-1__baseline",
      "EXPERIMENT_MANIFEST.json"
    ),
    { experiment_id: "exp-1", track_id: "track-main" }
  );
  await writeText(path.join(projectRoot, "coder", "EXPERIMENT_INDEX.md"));
  await writeText(path.join(projectRoot, "researcher", "EXPERIMENT_REGISTRY.md"));
  await writeText(
    path.join(projectRoot, "researcher", "artifacts", "results", "metrics.json"),
    "{}\n"
  );
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    schemaVersion: 1,
    projectId: "demo-project",
    updatedAt: now,
    summary: {
      activeExperimentIds: [],
      lastCompletedExperimentId: "exp-1",
      lastFailedExperimentId: null,
      bestKnownConfigRef: "configs/best.yaml",
      lastDecisionSummary: "baseline validated",
      papernexusSyncRequired: false,
      papernexusLastSyncAt: now,
    },
    experiments: [
      {
        experimentId: "exp-1",
        trackId: "track-main",
        name: "baseline",
        kind: "train",
        status: "completed",
        stage: "experiment",
        hypothesis: "baseline works",
        configRef: "configs/best.yaml",
        summary: "completed run",
        updatedAt: now,
        resultPaths: ["researcher/artifacts/results/metrics.json"],
        evidencePointers: ["researcher/artifacts/results/metrics.json"],
      },
    ],
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    title: "Demo Project",
    owner_agent: "researcher",
    current_stage: "experiment",
    current_micro_stage: "frontiers_packaged",
    idle_research: { enabled: false },
    paper_ingestion: {
      graph_presence_checked_at: now,
      graph_presence_status: "ready",
    },
    innovation_reflection: {
      required_after_experiments: false,
      status: "ready",
      last_reflection_at: now,
      last_reflection_path: "researcher/INNOVATION_REFLECTION.md",
    },
    research_program: {
      status: "approved",
      goal: "Seed experiment search",
      tracks: [
        {
          track_id: "track-main",
          priority: 1,
          status: "active",
          hypothesis: "Demo hypothesis",
          novelty_basis: "Demo novelty",
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
          track_id: "track-main",
          owner: "researcher",
          dependencies: [],
          entry_criteria: ["track active"],
          expected_outputs: ["plan complete"],
          retry_budget: 1,
          exit_criteria: ["plan ready"],
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
    experiment_memory: {
      last_ledger_update_at: now,
      papernexus_sync_required: false,
      papernexus_sync_status: "synced",
    },
  });
}

async function seedWriteProject(projectRoot) {
  const now = "2026-03-26T10:30:00.000Z";
  await seedExperimentProject(projectRoot);
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
  await writeText(path.join(projectRoot, "academic_writer", "PAPER_PLAN.md"));
  await writeText(path.join(projectRoot, "academic_writer", "STORYLINE_SKETCH.md"));
  await writeText(path.join(projectRoot, "academic_writer", "WRITING_SIGNALS.md"));
  await writeText(path.join(projectRoot, "academic_writer", "THEORY_APPENDIX_PLAN.md"));
  await writeText(path.join(projectRoot, "academic_writer", "paper", "main.pdf"), "%PDF-1.4\n");
  await writeText(path.join(projectRoot, "academic_writer", "paper", "refs.bib"), "@article{demo}\n");
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "sections", "appendix_theory.tex"),
    "% appendix\n"
  );
  await writeText(path.join(projectRoot, "cross-reviewer", "notes.md"));
  await writeText(path.join(projectRoot, "analyzer", "THEORY_SUPPORT_NOTE.md"));
  await writeJson(path.join(projectRoot, "analyzer", "THEORY_STATE.json"), {
    schema_version: 1,
    status: "draft",
    overall_signal: "green",
    theorem_candidates: [],
    lemma_packets: [],
    appendix_sections: [],
  });
  await writeJson(
    path.join(projectRoot, "analyzer", "proof-packets", "lemma_demo.json"),
    { packet_id: "lemma_demo", role: "lemma", statement: "Demo lemma." }
  );
  await writeJson(path.join(projectRoot, "reviewer", "REVIEW_ISSUES.json"), {
    issues: [],
  });
  await writeText(path.join(projectRoot, "reviewer", "REVIEW_REPORT.md"));
  await writeJson(path.join(projectRoot, "reviewer", "SURFACE_REVIEW.json"), {
    status: "pass",
  });
  await writeJson(
    path.join(projectRoot, "reviewer", "SUBMISSION_SIMULATION_REVIEW.json"),
    { status: "pass" }
  );
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    title: "Demo Project",
    owner_agent: "academic_writer",
    current_stage: "write",
    current_micro_stage: "frontiers_packaged",
    idle_research: { enabled: false },
    paper_ingestion: {
      graph_presence_checked_at: now,
      graph_presence_status: "ready",
    },
    innovation_reflection: {
      required_after_experiments: false,
      status: "ready",
      last_reflection_at: now,
      last_reflection_path: "researcher/INNOVATION_REFLECTION.md",
    },
    research_program: {
      status: "approved",
      goal: "Seed write package",
      tracks: [
        {
          track_id: "track-main",
          priority: 1,
          status: "active",
          hypothesis: "Demo hypothesis",
          novelty_basis: "Demo novelty",
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
          track_id: "track-main",
          owner: "researcher",
          dependencies: [],
          entry_criteria: ["track active"],
          expected_outputs: ["plan complete"],
          retry_budget: 1,
          exit_criteria: ["plan ready"],
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
    theory_state: {
      status: "draft",
      overall_signal: "green",
      theory_state_path: "analyzer/THEORY_STATE.json",
      source_theory_note_path: "analyzer/THEORY_SUPPORT_NOTE.md",
      proof_packet_dir: "analyzer/proof-packets",
      appendix_packet_path: "academic_writer/THEORY_APPENDIX_PLAN.md",
      body_ready: true,
      theorem_count: 0,
      lemma_count: 1,
      proof_packet_count: 1,
      last_updated_at: now,
    },
    writing_contract: {
      template_required: false,
      template_status: "optional",
      required_sections: ["method", "results"],
      section_order: ["method", "results"],
      proof_appendix_required: true,
      proof_appendix_path: "academic_writer/paper/sections/appendix_theory.tex",
      paragraph_logic_status: "pending",
    },
    citation_integrity: {
      enabled: true,
      verification_required: true,
      bibliography_path: "academic_writer/paper/refs.bib",
      verification_report_path: "reviewer/CITATION_VERIFICATION.md",
      verification_status: "pending",
      allowed_placeholder_count: 0,
      unresolved_placeholder_count: 0,
      verified_citation_count: 0,
      suspicious_citation_count: 0,
      hallucinated_citation_count: 0,
    },
    writing_session: {
      status: "ready_for_submit",
      current_section: "results",
      draft_order: ["method", "results"],
      finalized_sections: ["method", "results"],
      compile_safe_sections: ["method", "results"],
      section_packets: {
        method: {
          section: "method",
          status: "finalized",
          review_verdict: "publication_ready",
        },
        results: {
          section: "results",
          status: "finalized",
          review_verdict: "publication_ready",
        },
      },
      headline_claim_evidence_status: "covered",
      graph_evidence_coverage_status: "covered",
    },
    graph_guided_writing: {
      enabled: true,
      status: "ready",
      anchor_index_path: "graph/ANCHOR_INDEX.md",
      frontier_files: ["graph/LIMITATION_FRONTIER.md"],
      claim_evidence_packet_paths: ["analyzer/CLAIM_EVIDENCE_MATRIX.md"],
      required_evidence_pointer_count: 1,
      covered_headline_claim_count: 1,
      total_headline_claim_count: 1,
      evidence_coverage_status: "covered",
      missing_evidence_claims: [],
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
    },
    paper_qc: {
      status: "running",
      compile_status: "pass",
      page_budget_status: "pending",
      invalid_figure_ref_status: "pending",
    },
    figure_qc: {
      status: "running",
      duplicate_figure_status: "pass",
      caption_alignment_status: "pending",
      text_alignment_status: "pending",
      selection_status: "pending",
    },
    citation_collection: {
      status: "running",
      candidate_count: 12,
      verified_count: 4,
      suspicious_count: 0,
      hallucinated_count: 0,
    },
    review_session: {
      status: "completed",
      stage_scope: "review",
      round: 2,
      verdict: "ready",
      latest_review_path: "reviewer/REVIEW_REPORT.md",
    },
    experiment_search: {
      status: "ready_for_analysis",
      current_main_stage: "ablation_studies",
      multi_seed_status: "ready",
      evaluation_summary_path: "researcher/evaluation_summary.json",
      plot_pack_status: "ready",
      plot_pack_path: "researcher/plot_pack.json",
    },
  });
}

async function seedWritePackageSourceSummaries(projectRoot) {
  await writeJson(path.join(projectRoot, "researcher", "baseline_summary.json"), {
    summary_id: "baseline",
    metrics: {
      acc: 0.84,
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "research_summary.json"), {
    summary_id: "research",
    winning_track_ids: ["track-main"],
    claim_ids: ["claim-1"],
  });
  await writeJson(path.join(projectRoot, "researcher", "ablation_summary.json"), {
    summary_id: "ablation",
    deltas: {
      remove_graph_router: -0.03,
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "evaluation_summary.json"), {
    summary_id: "evaluation",
    verdict: "keep",
    leaderboards: [
      {
        track_id: "track-main",
        score: 0.91,
      },
    ],
  });
  await writeJson(path.join(projectRoot, "researcher", "plot_pack.json"), {
    plots: [
      {
        figure_id: "fig-1",
        source: "researcher/artifacts/results/metrics.json",
        caption: "Main results.",
      },
    ],
  });
}

test("control-plane runtime states persist through workflow tool actions and summaries", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const tracePath = getWorkflowTraceLogPath({
    projectRoot,
    projectId: "demo-project",
  });

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(tracePath, { force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  const researchProgram = await executeWorkflowTool(tool, {
    action: "set_research_program",
    researchProgram: {
      status: "approved",
      program_version: 1,
      goal: "Validate a graph-grounded writing workflow.",
      tracks: [
        {
          track_id: "track-main",
          priority: 1,
          status: "active",
          hypothesis: "Graph-grounded writing reduces unsupported claims.",
          novelty_basis: "It couples evidence routing with section-packet drafting.",
          main_metric: "support_rate",
          success_threshold: "support_rate >= 0.9",
          required_baselines: ["baseline-plain-writing"],
          required_ablations: ["remove_graph_router"],
          required_controls: ["fixed_prompt_budget"],
          experiment_stage_matrix: [
            "baseline_implementation",
            "baseline_tuning",
            "creative_research",
            "ablation_studies",
          ],
          budget: {
            gpu_hours: 16,
            max_runs: 8,
            max_debug_iterations: 2,
          },
          stop_rules: ["stop after three consecutive non-improving runs"],
          rollback_triggers: ["baseline regresses below parity"],
          write_scope: {
            allowed_claim_ids: ["claim-1"],
            allowed_figure_ids: ["fig-1"],
          },
        },
      ],
      global_constraints: {
        max_active_tracks: 2,
        must_run_multi_seed_before_analysis: true,
        must_run_plot_aggregation_before_write: true,
      },
      task_graph: [
        {
          task_id: "plan-baseline",
          stage: "plan",
          track_id: "track-main",
          owner: "researcher",
          dependencies: [],
          entry_criteria: ["track is active"],
          expected_outputs: ["baseline spec"],
          retry_budget: 1,
          exit_criteria: ["baseline is specified"],
        },
      ],
    },
  });
  assert.equal(researchProgram.state.status, "approved");
  assert.equal(researchProgram.state.tracks.length, 1);

  const orchestrationState = await executeWorkflowTool(tool, {
    action: "set_orchestration_state",
    orchestrationState: {
      status: "running",
      active_ticket_id: "ticket-1",
      stage_run_id: "plan-run-1",
      current_owner: "orchestrator",
      next_owner: "researcher",
      next_transition_candidate: "code",
      blocking_category: null,
      blocking_reason: null,
      retry_budget_remaining: 2,
      last_contract_eval_at: "2026-03-26T10:00:00.000Z",
      last_contract_eval_result: "pass",
      rollback_target_stage: null,
      resume_cursor: "plan:plan-baseline",
    },
  });
  assert.equal(orchestrationState.state.currentOwner, "orchestrator");

  const writePackage = await executeWorkflowTool(tool, {
    action: "set_write_package",
    writePackage: {
      status: "ready",
      winning_track_ids: ["track-main"],
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
  });
  assert.equal(writePackage.state.status, "ready");

  const researchProgramSummary = await getResearchProgramStateSummary({
    projectRoot,
  });
  const orchestrationSummary = await getOrchestrationStateSummary({
    projectRoot,
  });
  const writePackageSummary = await getWritePackageStateSummary({
    projectRoot,
  });

  assert.equal(researchProgramSummary.state.status, "approved");
  assert.equal(orchestrationSummary.state.nextTransitionCandidate, "code");
  assert.equal(writePackageSummary.state.status, "ready");

  const rawTrace = await fs.readFile(tracePath, "utf8");
  assert.match(rawTrace, /set_research_program/);
  assert.match(rawTrace, /set_orchestration_state/);
  assert.match(rawTrace, /set_write_package/);
});

test("write-package assembler derives secondary artifacts and marks the package ready", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedWriteProject(projectRoot);
  await seedWritePackageSourceSummaries(projectRoot);

  const result = await assembleWritePackage({
    projectRoot,
    mode: "aggressive",
    trigger: "test",
  });

  assert.equal(result.state.status, "ready");
  assert.equal(result.validationErrors.length, 0);
  assert.equal(result.derivedArtifacts.length >= 4, true);
  await assert.doesNotReject(
    fs.readFile(path.join(projectRoot, "academic_writer", "WRITE_PACKAGE.json"), "utf8")
  );
  await assert.doesNotReject(
    fs.readFile(path.join(projectRoot, "academic_writer", "FIGURE_PACK.json"), "utf8")
  );
  await assert.doesNotReject(
    fs.readFile(path.join(projectRoot, "academic_writer", "TABLE_PACK.json"), "utf8")
  );
  await assert.doesNotReject(
    fs.readFile(
      path.join(projectRoot, "academic_writer", "CITATION_CANDIDATES.json"),
      "utf8"
    )
  );
  await assert.doesNotReject(
    fs.readFile(
      path.join(projectRoot, "academic_writer", "SECTION_ASSEMBLY_QUEUE.json"),
      "utf8"
    )
  );

  const manifestPayload = JSON.parse(
    await fs.readFile(path.join(projectRoot, "academic_writer", "WRITE_PACKAGE.json"), "utf8")
  );
  assert.deepEqual(manifestPayload.winning_track_ids, ["track-main"]);
  assert.equal(manifestPayload.status, "ready");
  assert.equal(Array.isArray(manifestPayload.section_queue), true);
});

test("research_workflow tool can invoke the write-package assembler explicitly", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedWriteProject(projectRoot);
  await seedWritePackageSourceSummaries(projectRoot);
  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  const result = await executeWorkflowTool(tool, {
    action: "assemble_write_package",
    writePackageAssembly: {
      mode: "aggressive",
      trigger: "tool-test",
    },
  });

  assert.equal(result.state.status, "ready");
  assert.equal(result.validationErrors.length, 0);
});

test("write-package assembler converts missing upstream evidence into review issues instead of silent readiness", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedWriteProject(projectRoot);

  const result = await assembleWritePackage({
    projectRoot,
    mode: "aggressive",
    trigger: "test",
  });

  assert.notEqual(result.state.status, "ready");
  assert.equal(result.blockingInputs.length > 0, true);

  const issueTracker = await getReviewIssueTrackerStateSummary({
    projectRoot,
  });
  assert.equal(issueTracker.state.openCounts.medium > 0, true);
  assert.equal(
    issueTracker.state.issues.some((issue) => issue.title?.includes("write_package")),
    true
  );
});

test("auto iterator enforces research program semantics, experiment-search readiness, and write-package submit prerequisites", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedPlanProject(projectRoot);

  let result = await runWorkflowAutoIterator({
    projectRoot,
    agentId: "orchestrator",
    mode: "phase-3-plan-gate",
    queueMailbox: false,
  });
  assert.equal(result.stageAfter, "plan");
  assert.ok(
    result.missingStageSignals.some((signal) => signal.includes("research_program"))
  );

  await setResearchProgramState({
    projectRoot,
    researchProgram: {
      status: "approved",
      goal: "Incomplete program",
      tracks: [
        {
          track_id: "track-main",
          status: "active",
          hypothesis: "Demo hypothesis",
          novelty_basis: "Demo novelty",
          required_baselines: [],
          required_ablations: [],
          stop_rules: [],
          rollback_triggers: [],
          experiment_stage_matrix: ["baseline_implementation"],
        },
      ],
    },
  });

  await setOrchestrationState({
    projectRoot,
    orchestrationState: {
      status: "running",
      current_owner: "orchestrator",
      next_owner: "coder",
      next_transition_candidate: "code",
      retry_budget_remaining: 2,
      last_contract_eval_result: "pass",
    },
  });

  result = await runWorkflowAutoIterator({
    projectRoot,
    agentId: "orchestrator",
    mode: "phase-3-plan-gate",
    queueMailbox: false,
  });
  assert.equal(result.stageAfter, "plan");
  assert.ok(
    result.missingStageSignals.some((signal) => signal.includes("baseline"))
  );

  await setResearchProgramState({
    projectRoot,
    researchProgram: {
      status: "approved",
      goal: "Complete program",
      tracks: [
        {
          track_id: "track-main",
          priority: 1,
          status: "active",
          hypothesis: "Demo hypothesis",
          novelty_basis: "Demo novelty",
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
          track_id: "track-main",
          owner: "researcher",
          dependencies: [],
          entry_criteria: ["track active"],
          expected_outputs: ["plan complete"],
          retry_budget: 1,
          exit_criteria: ["plan ready"],
        },
      ],
    },
  });

  result = await runWorkflowAutoIterator({
    projectRoot,
    agentId: "orchestrator",
    mode: "phase-3-plan-gate",
    queueMailbox: false,
  });
  assert.equal(result.stageAfter, "code");

  await seedExperimentProject(projectRoot);
  result = await runWorkflowAutoIterator({
    projectRoot,
    agentId: "researcher",
    mode: "phase-3-experiment-gate",
    queueMailbox: false,
  });
  assert.equal(result.stageAfter, "experiment");
  assert.ok(
    result.missingStageSignals.some((signal) => signal.includes("experiment_search"))
  );

  await setExperimentSearchState({
    projectRoot,
    experimentSearch: {
      status: "ready_for_analysis",
      current_main_stage: "ablation_studies",
      multi_seed_status: "ready",
      evaluation_summary_path: "researcher/evaluation_summary.json",
      plot_pack_status: "ready",
      plot_pack_path: "researcher/plot_pack.json",
    },
  });

  result = await runWorkflowAutoIterator({
    projectRoot,
    agentId: "researcher",
    mode: "phase-3-experiment-gate",
    queueMailbox: false,
  });
  assert.equal(result.stageAfter, "analyze");

  await seedWriteProject(projectRoot);
  result = await runWorkflowAutoIterator({
    projectRoot,
    agentId: "academic_writer",
    mode: "phase-3-write-gate",
    queueMailbox: false,
  });
  assert.equal(result.stageAfter, "write");
  assert.ok(
    result.missingStageSignals.some((signal) => signal.includes("write_package"))
  );
  assert.ok(
    result.missingStageSignals.some((signal) => signal.includes("citation_integrity"))
  );
});

test("frontier and idea stages require a reconciled brainstorm cycle, and aggressive mode keeps the highest-scoring option", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedPlanProject(projectRoot);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "frontier_mapping";
  manifest.owner_agent = "researcher";
  manifest.brainstorm_cycle = {
    status: "missing",
  };
  await writeJson(manifestPath, manifest);

  let result = await runWorkflowAutoIterator({
    projectRoot,
    agentId: "researcher",
    mode: "phase-3-brainstorm-frontier-gate",
    queueMailbox: false,
  });
  assert.equal(result.stageAfter, "frontier_mapping");
  assert.ok(
    result.missingStageSignals.some((signal) => signal.includes("brainstorm_cycle"))
  );

  const brainstormCycle = await runBrainstormCycle({
    projectRoot,
    brainstormCycle: {
      mode: "aggressive",
      topic: "Graph-grounded novelty selection",
      basis_stage: "frontier_mapping",
      track_id: "track-main",
      graph_version_seen: "global-v7",
      import_task_ids_seen: ["imp-a", "imp-b"],
      topic_summary: {
        objective: "Select the strongest novelty route from shared graph evidence.",
      },
      research_brief: {
        anchors: ["anchor-main"],
        graph_scope: "shared-global",
      },
      brainstorm_brief: {
        mode: "diverge_then_converge",
      },
      rounds: [
        {
          round_id: "round-1",
          label: "diverge",
          status: "completed",
          options: [
            {
              option_id: "opt-low",
              title: "Conservative extension",
              score: 0.51,
              summary: "Safe but weak novelty.",
              logic_chain: "# Logic low\n",
              evidence_chain: "# Evidence low\n",
              reasoning_trace: [{ step: "baseline", conclusion: "weak gap" }],
              question_packet: "# Questions low\n",
              working_memory: { hypothesis: "low" },
              synthesis_packet: "# Synthesis low\n",
            },
            {
              option_id: "opt-high",
              title: "Best novelty route",
              score: 0.97,
              summary: "Strongest graph-grounded novelty route.",
              logic_chain: "# Logic high\n",
              evidence_chain: "# Evidence high\n",
              reasoning_trace: [{ step: "compose anchors", conclusion: "strong gap" }],
              question_packet: "# Questions high\n",
              working_memory: { hypothesis: "high" },
              synthesis_packet: "# Synthesis high\n",
            },
          ],
        },
      ],
    },
  });
  assert.equal(brainstormCycle.state.selectedOptionId, "opt-high");
  assert.equal(brainstormCycle.validationErrors.length, 0);

  result = await runWorkflowAutoIterator({
    projectRoot,
    agentId: "researcher",
    mode: "phase-3-brainstorm-frontier-gate",
    queueMailbox: false,
  });
  assert.equal(result.stageAfter, "idea");

  result = await runWorkflowAutoIterator({
    projectRoot,
    agentId: "researcher",
    mode: "phase-3-brainstorm-idea-gate",
    queueMailbox: false,
  });
  assert.equal(result.stageAfter, "plan");

  const summary = await getBrainstormCycleStateSummary({
    projectRoot,
  });
  assert.equal(summary.state.selectedOptionId, "opt-high");
  assert.equal(summary.chainBundleReady, true);
});

test("aggressive auto iterator auto-assembles the write package before evaluating the write-stage gate", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedWriteProject(projectRoot);
  await seedWritePackageSourceSummaries(projectRoot);
  await writeText(path.join(projectRoot, "reviewer", "CITATION_VERIFICATION.md"));

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.citation_integrity.verification_status = "verified";
  manifest.citation_integrity.last_verified_at = "2026-03-26T10:35:00.000Z";
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    agentId: "academic_writer",
    mode: "phase-3-write-package-auto-assembly",
    queueMailbox: false,
    policy: {
      autoMode: "aggressive",
    },
  });

  assert.equal(result.configuredAutoMode, "aggressive");
  assert.equal(result.stageBefore, "write");
  assert.equal(result.stageAfter, "submit");

  const writePackage = await getWritePackageStateSummary({
    projectRoot,
  });
  assert.equal(writePackage.state.status, "ready");
  assert.equal(writePackage.validationErrors.length, 0);
});

test("focused prompt assembly returns layered payload metadata for current section work", () => {
  const assembly = buildFocusedPromptAssembly({
    snapshot: {
      projectRoot: "/tmp/demo-project",
      projectId: "demo-project",
      role: "academic_writer",
      currentStage: "write",
      currentMicroStage: "drafting",
      ownerAgent: "academic_writer",
      recommendedOwner: "academic_writer",
      nextAction: "Revise the results section packet.",
      resumeAction: "/resume-pipeline",
      blockingReason: "results packet still has one missing citation placeholder",
      allowedWriteScopes: ["{PROJ}/academic_writer/**"],
      missingStageSignals: ["results packet still has one missing citation placeholder"],
      writingCurrentSection: "results",
      writingSessionStatus: "revise_required",
      writingCurrentSectionReviewVerdict: "needs_revision",
      writingGraphEvidenceCoverageStatus: "partial",
      reviewIssueTrackerStatus: "open",
      reviewIssueCriticalCount: 0,
      reviewIssueHighCount: 1,
      reviewIssueMediumCount: 1,
      reviewIssueLowCount: 0,
      paperQcStatus: "running",
      paperQcCompileStatus: "pass",
      paperQcPageBudgetStatus: "pending",
      figureQcCaptionAlignmentStatus: "pending",
      figureQcTextAlignmentStatus: "pending",
      reviewSessionStatus: "needs_revision",
      reviewSessionRound: 2,
      reviewSessionVerdict: "not_ready",
    },
  });

  assert.match(assembly.text, /Layer 1: Stable Policy/i);
  assert.match(assembly.text, /Layer 2: Stage-Local Control State/i);
  assert.match(assembly.text, /Layer 3: Primary Payload/i);
  assert.match(assembly.text, /results/i);
  assert.equal(assembly.metadata.sectionContextId, "results");
  assert.equal(assembly.metadata.roundId, "review-round-2");
  assert.deepEqual(assembly.metadata.promptLayerProfile, {
    stable_policy: true,
    stage_local_state: true,
    primary_payload: true,
    supporting_evidence: true,
    reflection_delta: true,
  });
  assert.equal(typeof assembly.metadata.promptPayloadSizes.primary_payload, "number");
  assert.match(assembly.text, /formal academic tone/i);
  assert.match(assembly.text, /consistent terminology/i);
  assert.match(assembly.text, /one paragraph = one message|one paragraph for one message/i);
  assert.match(assembly.text, /proper paragraphs/i);
  assert.match(assembly.text, /smooth transitions|bridge to the next paragraph/i);
});

test("focused prompt assembly gives reviewers the same writing constitution", () => {
  const assembly = buildFocusedPromptAssembly({
    snapshot: {
      projectRoot: "/tmp/demo-project",
      projectId: "demo-project",
      role: "reviewer",
      currentStage: "review",
      currentMicroStage: "prose",
      ownerAgent: "reviewer",
      recommendedOwner: "reviewer",
      nextAction: "Review the discussion section for clarity and citation support.",
      resumeAction: "/review-phase",
      blockingReason: "discussion section still has vague transitions",
      allowedWriteScopes: ["{PROJ}/reviewer/**"],
      missingStageSignals: ["discussion section still has vague transitions"],
      reviewSessionStatus: "running",
      reviewSessionRound: 3,
      reviewSessionVerdict: "needs_revision",
      reviewIssueCriticalCount: 0,
      reviewIssueHighCount: 1,
      reviewIssueMediumCount: 2,
      reviewIssueLowCount: 1,
      paperQcStatus: "running",
      paperQcCompileStatus: "pass",
      paperQcPageBudgetStatus: "pass",
      figureQcCaptionAlignmentStatus: "pass",
      figureQcTextAlignmentStatus: "pass",
    },
  });

  assert.match(assembly.text, /review against the shared writing constitution/i);
  assert.match(assembly.text, /formal academic tone/i);
  assert.match(assembly.text, /consistent terminology/i);
  assert.match(assembly.text, /smooth transitions|paragraph-to-paragraph flow/i);
});
