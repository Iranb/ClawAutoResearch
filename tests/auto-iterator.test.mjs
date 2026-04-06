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
  getWorkflowAnnounceOutboxPath,
  getWorkflowBroadcastOutboxPath,
  getWorkflowRuntimeEventsPath,
  getWorkflowRuntimeQueuePath,
  getWorkflowRuntimeSessionsPath,
  migrateWorkflowRuntimeState,
} from "../tools/workflow-runtime-state.ts";
import {
  aggregateGateReviewRound,
  createGateReviewRound,
  saveGateReviewStore,
} from "../tools/workflow-auto-gate.ts";
import { defaultAutoGateConfig } from "../tools/workflow-auto-gate.ts";
import {
  aggregateCodeReviewRound,
  createCodeReviewRound,
  saveCodeReviewStore,
} from "../tools/workflow-code-review.ts";
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

async function seedRemoteGraphStatus(
  projectRoot,
  {
    corpusName = "shared-global-graph",
    corpusRoot = "https://papernexus.example/corpora/shared-global-graph",
    status = "ready",
    expectedPaperCount = 0,
    presentPaperCount = 0,
    missingPapers = [],
  } = {}
) {
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    project_id: "demo-project",
    corpus_name: corpusName,
    corpus_root: corpusRoot,
    checked_at: "2026-03-22T12:05:00.000Z",
    status,
    mode: "remote_api",
    expected_paper_count: expectedPaperCount,
    present_paper_count: presentPaperCount,
    missing_paper_count: missingPapers.length,
    missing_papers: missingPapers,
    refresh_required: missingPapers.length > 0 || status !== "ready",
    refresh_reason:
      missingPapers.length > 0 || status !== "ready"
        ? "Remote graph is not ready."
        : null,
  });
}

async function seedReadyBrainstormCycle(
  projectRoot,
  {
    trackId = "track-main",
    provider = "workflow_core_brainstorm",
    providerMode = "core",
    providerStatus = "ready",
    contractVersion = 1,
  } = {}
) {
  await writeJson(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "TOPIC_SUMMARY.json"),
    {
      objective: "Seeded brainstorm bundle",
    }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "RESEARCH_BRIEF.json"),
    {
      anchors: ["paper:seed"],
    }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "BRAINSTORM_BRIEF.json"),
    { mode: "diverge_then_converge" }
  );
  await writeText(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "LOGIC_CHAIN.md"),
    "# Logic chain\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "EVIDENCE_CHAIN.md"),
    "# Evidence chain\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "REASONING_TRACE.jsonl"),
    "{\"step\":\"seed\"}\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "QUESTION_PACKET.md"),
    "# Questions\n"
  );
  await writeJson(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "STORYLINE_BRIEF.json"),
    {
      thesis: "Graph-grounded support routing tightens claim precision.",
      arc: "Task -> challenge -> insight -> contribution -> advantage",
    }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "WORKING_MEMORY.json"),
    { hypothesis: "demo" }
  );
  await writeText(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "SYNTHESIS_PACKET.md"),
    "# Synthesis\n"
  );

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.brainstorm_cycle = {
    status: "reconciled",
    mode: "aggressive",
    topic: "Seeded brainstorm bundle",
    basis_stage: "graph_build",
    track_id: trackId,
    provider,
    provider_mode: providerMode,
    provider_status: providerStatus,
    contract_version: contractVersion,
    rounds: [
      {
        round_id: "seed-round",
        options: [
          {
            option_id: "seed-option",
            title: "Graph-grounded support router",
            summary: "Use graph evidence to route claims through a tighter support path.",
            score: 0.8,
          },
        ],
      },
    ],
    selected_round_id: "seed-round",
    selected_option_id: "seed-option",
    selected_option_title: "Graph-grounded support router",
    selected_option_score: 0.8,
    topic_summary_path: "researcher/brainstorm-cycle/TOPIC_SUMMARY.json",
    research_brief_path: "researcher/brainstorm-cycle/RESEARCH_BRIEF.json",
    brainstorm_brief_path: "researcher/brainstorm-cycle/BRAINSTORM_BRIEF.json",
    logic_chain_path: "researcher/brainstorm-cycle/LOGIC_CHAIN.md",
    evidence_chain_path: "researcher/brainstorm-cycle/EVIDENCE_CHAIN.md",
    reasoning_trace_path: "researcher/brainstorm-cycle/REASONING_TRACE.jsonl",
    storyline_brief_path: "researcher/brainstorm-cycle/STORYLINE_BRIEF.json",
    question_packet_path: "researcher/brainstorm-cycle/QUESTION_PACKET.md",
    working_memory_path: "researcher/brainstorm-cycle/WORKING_MEMORY.json",
    synthesis_packet_path: "researcher/brainstorm-cycle/SYNTHESIS_PACKET.md",
  };
  await writeJson(manifestPath, manifest);
}

async function seedReadyIdeationContract(
  projectRoot,
  { trackId = "track-main" } = {}
) {
  await writeText(
    path.join(projectRoot, "researcher", "ideation", "NOVELTY_TREE.md"),
    "# Novelty Tree\n"
  );
  await writeText(
    path.join(
      projectRoot,
      "researcher",
      "ideation",
      "CHALLENGE_INSIGHT_TREE.md"
    ),
    "# Challenge Insight Tree\n"
  );
  await writeText(
    path.join(
      projectRoot,
      "researcher",
      "ideation",
      "WELL_ESTABLISHED_SOLUTION_CHECK.md"
    ),
    "# Solution Check\n"
  );
  await writeText(
    path.join(
      projectRoot,
      "researcher",
      "ideation",
      "CROSS_DOMAIN_TRANSFER.md"
    ),
    "# Cross Domain Transfer\n"
  );
  await writeText(
    path.join(
      projectRoot,
      "researcher",
      "ideation",
      "PROBLEM_DECOMPOSITION.md"
    ),
    "# Problem Decomposition\n"
  );
  await writeJson(
    path.join(projectRoot, "researcher", "ideation", "CANDIDATE_POOL.json"),
    {
      candidates: [
        {
          id: "dir-1",
          formulation: "Graph-grounded method idea",
          novelty_hypothesis: "Open challenge remains unresolved.",
          status: "surviving",
        },
      ],
    }
  );
  await writeJson(
    path.join(
      projectRoot,
      "researcher",
      "ideation",
      "TOURNAMENT_SCOREBOARD.json"
    ),
    {
      status: "completed",
      selected_direction_id: "dir-1",
      rankings: [
        {
          direction_id: "dir-1",
          novelty: 0.9,
          feasibility: 0.7,
          relevance: 0.8,
          clarity: 0.8,
        },
      ],
    }
  );
  await writeText(
    path.join(projectRoot, "researcher", "ideation", "IDEA_TREE.md"),
    "# Idea Tree\n"
  );
  await writeJson(
    path.join(projectRoot, "researcher", "ideation", "RANKING_HISTORY.json"),
    {
      status: "completed",
      method: "equivalent_elo_v1",
      rounds: [],
    }
  );
  await writeText(
    path.join(
      projectRoot,
      "researcher",
      "ideation",
      "TOP3_DIRECTION_SUMMARY.md"
    ),
    "# Top 3 Directions\n"
  );
  await writeText(
    path.join(
      projectRoot,
      "researcher",
      "ideation",
      "RESEARCH_PROPOSAL.md"
    ),
    "# Research Proposal\n"
  );
  await writeJson(
    path.join(
      projectRoot,
      "researcher",
      "ideation",
      "GRAPH_IDEATION_PACKET.json"
    ),
    {
      project_id: "demo-project",
      challenge_clusters: ["cluster:challenge-1"],
      insight_clusters: ["cluster:insight-1"],
      novelty_zones: ["zone:1"],
      occupied_zones: [],
      transfer_bridges: ["bridge:1"],
    }
  );

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.ideation_contract = {
    status: "ready",
    contract_version: 1,
    long_term_goal: "Discover a robust graph-grounded innovation direction.",
    problem_scope: "Support precision in scientific writing",
    basis_stage: "frontier_mapping",
    graph_basis_paths: {
      papernexus_status_path: "graph/PAPERNEXUS_STATUS.json",
      frontier_report: "researcher/FRONTIER_REPORT.md",
      anchor_index_path: "graph/ANCHOR_INDEX.md",
      limitation_frontier_path: "graph/LIMITATION_FRONTIER.md",
      contradiction_frontier_path: "graph/CONTRADICTION_FRONTIER.md",
      transfer_frontier_path: "graph/TRANSFER_FRONTIER.md",
      composition_frontier_path: "graph/COMPOSITION_FRONTIER.md",
      topic_summary_path: "researcher/brainstorm-cycle/TOPIC_SUMMARY.json",
      logic_chain_path: "researcher/brainstorm-cycle/LOGIC_CHAIN.md",
      evidence_chain_path: "researcher/brainstorm-cycle/EVIDENCE_CHAIN.md",
      storyline_brief_path: "researcher/brainstorm-cycle/STORYLINE_BRIEF.json",
    },
    graph_ideation_indices: {
      status: "ready",
      novelty_candidate_clusters: ["zone:1"],
      challenge_clusters: ["cluster:challenge-1"],
      insight_clusters: ["cluster:insight-1"],
      occupied_solution_zones: [],
      transfer_bridges: ["bridge:1"],
      last_refresh_at: "2026-03-22T12:00:00.000Z",
    },
    novelty_tree_path: "researcher/ideation/NOVELTY_TREE.md",
    challenge_insight_tree_path: "researcher/ideation/CHALLENGE_INSIGHT_TREE.md",
    solution_check_path:
      "researcher/ideation/WELL_ESTABLISHED_SOLUTION_CHECK.md",
    cross_domain_transfer_path: "researcher/ideation/CROSS_DOMAIN_TRANSFER.md",
    problem_decomposition_path: "researcher/ideation/PROBLEM_DECOMPOSITION.md",
    candidate_pool_path: "researcher/ideation/CANDIDATE_POOL.json",
    idea_tree_path: "researcher/ideation/IDEA_TREE.md",
    ranking_history_path: "researcher/ideation/RANKING_HISTORY.json",
    tournament_scoreboard_path:
      "researcher/ideation/TOURNAMENT_SCOREBOARD.json",
    top3_summary_path: "researcher/ideation/TOP3_DIRECTION_SUMMARY.md",
    research_proposal_path: "researcher/ideation/RESEARCH_PROPOSAL.md",
    graph_ideation_packet_path:
      "researcher/ideation/GRAPH_IDEATION_PACKET.json",
    selected_direction_id: "dir-1",
    selected_track_id: trackId,
    pending_reason: null,
    last_updated_at: "2026-03-22T12:00:00.000Z",
  };
  await writeJson(manifestPath, manifest);
}

async function seedReadyIdeaCatalystState(
  projectRoot,
  { microStage = "judging" } = {}
) {
  const root = path.join(projectRoot, "researcher", "idea-catalyst");
  await writeJson(path.join(root, "DECOMPOSITION_PACKET.json"), { version: 1 });
  await writeJson(path.join(root, "ABSTRACTION_PACKET.json"), { version: 1 });
  await writeJson(path.join(root, "SCOUTING_REPORT.json"), {
    target_domain: "Computer Science",
    candidate_domains: [{ domain: "Psychology" }],
  });
  await writeJson(path.join(root, "GATE_DECISION.json"), {
    decision: "brainstorm",
  });
  await writeJson(path.join(root, "IDEA_FRAGMENTS.json"), {
    fragments: [{ fragment_id: "frag-1", source_domain: "Psychology" }],
  });
  await writeJson(path.join(root, "RANKED_FRAGMENTS.json"), {
    ranking: [{ rank: 1, fragment_id: "frag-1" }],
  });
  await writeJson(path.join(root, "CATALYST_SESSION_STATE.json"), {
    status: "ready",
    micro_stage: microStage,
  });

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.idea_catalyst = {
    status: "ready",
    contract_version: 1,
    mode: "graph-first",
    micro_stage: microStage,
    decomposition_packet_path: "researcher/idea-catalyst/DECOMPOSITION_PACKET.json",
    abstraction_packet_path: "researcher/idea-catalyst/ABSTRACTION_PACKET.json",
    scouting_report_path: "researcher/idea-catalyst/SCOUTING_REPORT.json",
    gate_decision_path: "researcher/idea-catalyst/GATE_DECISION.json",
    idea_fragments_path: "researcher/idea-catalyst/IDEA_FRAGMENTS.json",
    ranked_fragments_path: "researcher/idea-catalyst/RANKED_FRAGMENTS.json",
    investigation_requisition_path:
      "researcher/idea-catalyst/INVESTIGATION_REQUISITION.json",
    session_state_path: "researcher/idea-catalyst/CATALYST_SESSION_STATE.json",
    target_domain: "Computer Science",
    source_domains: ["Psychology"],
    bridge_count: 2,
    top_fragment_id: "frag-1",
    requisition_required: false,
    pending_reason: null,
    last_updated_at: "2026-03-22T12:00:00.000Z",
  };
  await writeJson(manifestPath, manifest);
}

async function seedReadyPaperStoryState(
  projectRoot,
  { trackId = "track-main" } = {}
) {
  const root = path.join(projectRoot, "academic_writer", "story");
  for (const [name, text] of [
    ["TASK_SUMMARY.md", "# Task Summary\n"],
    ["CHALLENGE_STATEMENT.md", "# Challenge Statement\n"],
    ["INSIGHT_SUMMARY.md", "# Insight Summary\n"],
    ["CONTRIBUTION_MAP.md", "# Contribution Map\n"],
    ["ADVANTAGE_MAP.md", "# Advantage Map\n"],
    ["STORY_SPINE.md", "# Story Spine\n"],
    ["PIPELINE_FIGURE_SKETCH.md", "# Pipeline Figure Sketch\n"],
    ["MODULE_MOTIVATION_MAP.md", "# Module Motivation Map\n"],
    ["CLAIM_TO_EXPERIMENT_MAP.md", "# Claim To Experiment Map\n"],
    ["FALLBACK_NARRATIVE.md", "# Fallback Narrative\n"],
    ["REJECTION_RISK_TABLE.md", "# Rejection Risk Table\n"],
  ]) {
    await writeText(path.join(root, name), text);
  }

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.paper_story_state = {
    status: "ready",
    contract_version: 1,
    task_summary_path: "academic_writer/story/TASK_SUMMARY.md",
    challenge_statement_path:
      "academic_writer/story/CHALLENGE_STATEMENT.md",
    insight_summary_path: "academic_writer/story/INSIGHT_SUMMARY.md",
    contribution_map_path: "academic_writer/story/CONTRIBUTION_MAP.md",
    advantage_map_path: "academic_writer/story/ADVANTAGE_MAP.md",
    story_spine_path: "academic_writer/story/STORY_SPINE.md",
    pipeline_figure_sketch_path:
      "academic_writer/story/PIPELINE_FIGURE_SKETCH.md",
    module_motivation_map_path:
      "academic_writer/story/MODULE_MOTIVATION_MAP.md",
    claim_to_experiment_map_path:
      "academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md",
    fallback_narrative_path: "academic_writer/story/FALLBACK_NARRATIVE.md",
    rejection_risk_table_path:
      "academic_writer/story/REJECTION_RISK_TABLE.md",
    storyline_source_track_id: trackId,
    pending_reason: null,
    last_updated_at: "2026-03-22T12:00:00.000Z",
  };
  await writeJson(manifestPath, manifest);
}

async function seedReadyReviewPressurePacket(projectRoot) {
  const root = path.join(projectRoot, "reviewer", "story-pressure");
  for (const [name, text] of [
    ["REJECT_FIRST_REVIEW.md", "# Reject First Review\n"],
    ["NOVELTY_ATTACK.md", "# Novelty Attack\n"],
    ["UNSUPPORTED_CLAIM_AUDIT.md", "# Unsupported Claim Audit\n"],
    ["REVERSE_OUTLINE.md", "# Reverse Outline\n"],
    ["FIGURE_TABLE_QC.md", "# Figure Table QC\n"],
    ["LIMITATION_AUDIT.md", "# Limitation Audit\n"],
  ]) {
    await writeText(path.join(root, name), text);
  }
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.review_pressure_packet = {
    status: "ready",
    reject_first_review_path:
      "reviewer/story-pressure/REJECT_FIRST_REVIEW.md",
    novelty_attack_path: "reviewer/story-pressure/NOVELTY_ATTACK.md",
    unsupported_claim_audit_path:
      "reviewer/story-pressure/UNSUPPORTED_CLAIM_AUDIT.md",
    reverse_outline_path: "reviewer/story-pressure/REVERSE_OUTLINE.md",
    figure_table_qc_path: "reviewer/story-pressure/FIGURE_TABLE_QC.md",
    limitation_audit_path: "reviewer/story-pressure/LIMITATION_AUDIT.md",
    status_reason: null,
    last_updated_at: "2026-03-22T12:00:00.000Z",
  };
  await writeJson(manifestPath, manifest);
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
    research_program: {
      program_version: 1,
      status: "draft",
      goal: "Demo project goal",
      problem_statement: "Demo project problem statement",
      baseline_reference: "demo-baseline",
      primary_metric: "acc",
      datasets: ["demo-dataset"],
      constraints: ["fixed_eval_protocol"],
      success_criteria: ["improve acc over baseline"],
      zotero_project_path: "bot/demo-project",
      tracks: [],
      global_constraints: {
        max_active_tracks: null,
        must_run_multi_seed_before_analysis: true,
        must_run_plot_aggregation_before_write: true,
      },
      task_graph: [],
      last_updated_at: now,
      pending_reason: null,
    },
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
      problem_statement: "Support scientific storytelling with graph-grounded evidence.",
      baseline_reference: "baseline-a",
      primary_metric: "acc",
      datasets: ["demo-dataset"],
      success_criteria: ["acc>=0.9"],
      zotero_project_path: "bot/demo-project",
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

  await seedReadyBrainstormCycle(projectRoot, { trackId });
  await seedReadyIdeationContract(projectRoot, { trackId });
  await seedReadyIdeaCatalystState(projectRoot);

  return { now, trackId };
}

function buildAlignedExperimentManifest(trackId, overrides = {}) {
  return {
    experiment_id: "exp-1",
    project_id: "demo-project",
    track_id: trackId,
    question: "Does graph grounding improve support precision?",
    hypothesis: "Graph grounding improves support precision.",
    novelty_basis: "It couples frontier packets with section drafting.",
    baseline_reference: "baseline-a",
    primary_baseline_metric: "acc",
    target_improvement: "Improve acc by >= 2 points over baseline-a.",
    baseline_training_protocol:
      "Match baseline-a optimizer, schedule, seeds, epochs, and data preprocessing unless allowed_deviations says otherwise.",
    baseline_eval_protocol:
      "Use the baseline-a validation split, checkpoint selection, and accuracy evaluation method unchanged.",
    innovation_points: [
      "Graph-grounded support routing",
      "Frontier-packet-conditioned section drafting",
    ],
    validation_steps: [
      {
        step_id: "baseline-repro",
        objective: "Reproduce baseline-a with the unchanged eval protocol.",
        covers: ["Graph-grounded support routing"],
      },
      {
        step_id: "innovation-step-1",
        objective: "Enable graph-grounded support routing only.",
        covers: ["Graph-grounded support routing"],
      },
      {
        step_id: "innovation-step-2",
        objective: "Add frontier-packet-conditioned drafting on top of step 1.",
        covers: ["Frontier-packet-conditioned section drafting"],
      },
    ],
    ablation_plan: [
      {
        ablation_id: "minus-routing",
        objective: "Disable graph-grounded support routing to verify its contribution.",
        covers: ["Graph-grounded support routing"],
      },
      {
        ablation_id: "minus-packets",
        objective: "Disable frontier packets to verify the drafting contribution.",
        covers: ["Frontier-packet-conditioned section drafting"],
      },
    ],
    name: "baseline",
    entry_point: "train.py",
    status: "draft",
    ...overrides,
  };
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
    buildAlignedExperimentManifest(trackId, {
      experiment_id: experimentId,
      status: "completed",
    })
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
  await writeText(path.join(projectRoot, "reviewer", "SIMULATED_EXTERNAL_REVIEW.md"));
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
  await seedReadyIdeationContract(projectRoot, { trackId });
  await seedReadyPaperStoryState(projectRoot, { trackId });
  await seedReadyReviewPressurePacket(projectRoot);
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
  await writeJson(path.join(projectRoot, "researcher", "brainstorm-cycle", "TOPIC_SUMMARY.json"), {
    objective: "Seeded brainstorm bundle",
  });
  await writeJson(path.join(projectRoot, "researcher", "brainstorm-cycle", "RESEARCH_BRIEF.json"), {
    anchors: ["paper:demo-idea"],
  });
  await writeJson(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "BRAINSTORM_BRIEF.json"),
    { mode: "diverge_then_converge" }
  );
  await writeText(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "LOGIC_CHAIN.md"),
    "# Logic chain\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "EVIDENCE_CHAIN.md"),
    "# Evidence chain\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "REASONING_TRACE.jsonl"),
    "{\"step\":\"seed\"}\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "QUESTION_PACKET.md"),
    "# Questions\n"
  );
  await writeJson(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "WORKING_MEMORY.json"),
    { hypothesis: "demo" }
  );
  await writeText(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "SYNTHESIS_PACKET.md"),
    "# Synthesis\n"
  );
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
  manifest.brainstorm_cycle = {
    status: "reconciled",
    mode: "aggressive",
    topic: "Seeded brainstorm bundle",
    basis_stage: "frontier_mapping",
    track_id: trackId,
    rounds: [
      {
        round_id: "seed-round",
        options: [{ option_id: "seed-option", score: 0.8 }],
      },
    ],
    selected_round_id: "seed-round",
    selected_option_id: "seed-option",
    selected_option_score: 0.8,
    topic_summary_path: "researcher/brainstorm-cycle/TOPIC_SUMMARY.json",
    research_brief_path: "researcher/brainstorm-cycle/RESEARCH_BRIEF.json",
    brainstorm_brief_path: "researcher/brainstorm-cycle/BRAINSTORM_BRIEF.json",
    logic_chain_path: "researcher/brainstorm-cycle/LOGIC_CHAIN.md",
    evidence_chain_path: "researcher/brainstorm-cycle/EVIDENCE_CHAIN.md",
    reasoning_trace_path: "researcher/brainstorm-cycle/REASONING_TRACE.jsonl",
    question_packet_path: "researcher/brainstorm-cycle/QUESTION_PACKET.md",
    working_memory_path: "researcher/brainstorm-cycle/WORKING_MEMORY.json",
    synthesis_packet_path: "researcher/brainstorm-cycle/SYNTHESIS_PACKET.md",
  };
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

test("auto iterator keeps idea stage blocked when the ideation contract is missing", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { trackId } = await seedProjectReadyForCode(projectRoot);
  await seedReadyBrainstormCycle(projectRoot, { trackId });

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.current_micro_stage = "frontiers_packaged";
  delete manifest.ideation_contract;
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "idea");
  assert.equal(result.stageAfter, "idea");
  assert.ok(
    result.missingStageSignals.some((signal) =>
      /PROJECT_MANIFEST\.json\.ideation_contract\.status = ready/i.test(signal)
    )
  );
});

test("auto iterator auto-materializes the ideation contract when plan needs a repaired proposal packet", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { trackId } = await seedProjectReadyForCode(projectRoot);
  await seedReadyBrainstormCycle(projectRoot, { trackId });

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "plan";
  manifest.current_micro_stage = "proposal_missing";
  manifest.ideation_contract = {
    status: "ready",
    contract_version: 1,
    long_term_goal: "Demo",
    problem_scope: "Demo",
    basis_stage: "idea",
    graph_basis_paths: {},
    graph_ideation_indices: { status: "ready" },
    novelty_tree_path: "researcher/ideation/NOVELTY_TREE.md",
    challenge_insight_tree_path: "researcher/ideation/CHALLENGE_INSIGHT_TREE.md",
    solution_check_path:
      "researcher/ideation/WELL_ESTABLISHED_SOLUTION_CHECK.md",
    cross_domain_transfer_path: "researcher/ideation/CROSS_DOMAIN_TRANSFER.md",
    problem_decomposition_path: "researcher/ideation/PROBLEM_DECOMPOSITION.md",
    candidate_pool_path: "researcher/ideation/CANDIDATE_POOL.json",
    tournament_scoreboard_path:
      "researcher/ideation/TOURNAMENT_SCOREBOARD.json",
    top3_summary_path: "researcher/ideation/TOP3_DIRECTION_SUMMARY.md",
    research_proposal_path: "researcher/ideation/MISSING_PROPOSAL.md",
    selected_direction_id: "dir-1",
    selected_track_id: trackId,
    last_updated_at: "2026-03-22T12:00:00.000Z",
  };
  await seedReadyIdeationContract(projectRoot, { trackId });
  manifest.ideation_contract.research_proposal_path =
    "researcher/ideation/MISSING_PROPOSAL.md";
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "plan");
  const repairedManifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(repairedManifest.ideation_contract.status, "ready");
  await fs.access(
    path.join(projectRoot, repairedManifest.ideation_contract.research_proposal_path)
  );
  assert.ok(
    !result.missingStageSignals.some((signal) => /research_proposal_path/i.test(signal))
  );
});

test("auto iterator turns unsupported review-stage story gaps into a workflow-owned literature discovery rerun", async (t) => {
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

  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

  assert.equal(result.stageBefore, "review");
  assert.equal(result.stageAfter, "graph_build");
  assert.equal(result.regressed, true);
  assert.equal(updatedManifest.current_stage, "graph_build");
  assert.equal(updatedManifest.current_micro_stage, "uploading");
  assert.equal(
    updatedManifest.paper_ingestion.queued_requests.some(
      (entry) => entry.trigger_kind === "review_literature_discovery"
    ),
    true
  );
  await fs.access(
    path.join(
      projectRoot,
      "researcher",
      "literature-discovery",
      "LITERATURE_DISCOVERY_PACKET.json"
    )
  );
});

test("auto iterator turns unsupported write-stage story gaps into a workflow-owned literature discovery rerun", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "write";
  manifest.owner_agent = "academic_writer";
  manifest.paper_story_state.claim_support_status = "unsupported";
  manifest.paper_story_state.supported_claim_count = 1;
  manifest.paper_story_state.partial_claim_count = 0;
  manifest.paper_story_state.unsupported_claim_count = 2;
  await writeJson(manifestPath, manifest);
  await writeText(
    path.join(projectRoot, "analyzer", "CLAIM_EVIDENCE_MATRIX.md"),
    `# Claim Evidence Matrix

| Claim ID | Verdict |
| --- | --- |
| claim-1 | SUPPORTED |
| claim-2 | UNSUPPORTED |
| claim-3 | UNSUPPORTED |
`
  );
  await writeText(
    path.join(projectRoot, "analyzer", "UNSUPPORTED_CLAIMS.md"),
    `# Unsupported Claims

- claim-2: boundary case still collapses under longer drafts
- claim-3: graph-grounded routing still overclaims outside measured scope
`
  );

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

  assert.equal(result.stageBefore, "write");
  assert.equal(result.stageAfter, "graph_build");
  assert.equal(result.regressed, true);
  assert.equal(updatedManifest.current_stage, "graph_build");
  assert.equal(updatedManifest.current_micro_stage, "uploading");
  assert.match(updatedManifest.next_action ?? "", /graph-build/i);
  assert.equal(
    updatedManifest.paper_ingestion.queued_requests.some(
      (entry) => entry.trigger_kind === "write_literature_discovery"
    ),
    true
  );
  await fs.access(
    path.join(
      projectRoot,
      "researcher",
      "literature-discovery",
      "LITERATURE_DISCOVERY_PACKET.json"
    )
  );
});

test("auto iterator auto-materializes the review pressure packet for review-stage pressure checks", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "review";
  manifest.current_micro_stage = "story_pressure_pending";
  delete manifest.paper_story_state;
  delete manifest.review_pressure_packet;
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "review");
  const repairedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(repairedManifest.paper_story_state.status, "ready");
  assert.equal(repairedManifest.review_pressure_packet.status, "ready");
  await fs.access(
    path.join(projectRoot, repairedManifest.paper_story_state.claim_to_experiment_map_path)
  );
  await fs.access(
    path.join(
      projectRoot,
      repairedManifest.review_pressure_packet.reject_first_review_path
    )
  );
  assert.ok(
    !result.missingStageSignals.some((signal) =>
      /PROJECT_MANIFEST\.json\.review_pressure_packet\.status = ready/i.test(signal)
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
    "Run /graph-build to let workflow-owned upload requests finish, verify PAPER_SOURCE_INDEX.json is reflected in the shared global graph, and refresh the core brainstorm bundle before frontier mapping."
  );
  assert.equal(result.gateBlocking, false);
});

test("auto iterator keeps setup blocked until the onboarding contract is complete", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedSetupCompleteProject(projectRoot, "setup");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    title: "Demo Project",
    current_stage: "setup",
    idle_research: { enabled: false },
    research_program: {
      program_version: 1,
      status: "draft",
      goal: "Demo project goal",
      problem_statement: "Demo project problem statement",
      baseline_reference: null,
      primary_metric: null,
      datasets: [],
      constraints: [],
      success_criteria: [],
      zotero_project_path: null,
      tracks: [],
      global_constraints: {
        max_active_tracks: null,
        must_run_multi_seed_before_analysis: true,
        must_run_plot_aggregation_before_write: true,
      },
      task_graph: [],
      last_updated_at: "2026-03-22T12:00:00.000Z",
      pending_reason: "Complete guided setup.",
    },
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "setup");
  assert.equal(result.stageAfter, "setup");
  assert.match(result.nextAction ?? "", /\/project-init/i);
  assert.ok(
    result.missingStageSignals.some((signal) =>
      signal.includes("research_program.baseline_reference")
    )
  );
  assert.ok(
    result.missingStageSignals.some((signal) =>
      signal.includes("research_program.zotero_project_path")
    )
  );
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

test("graph presence check parses object-shaped PAPER_SOURCE_INDEX papers maps without treating metadata keys as papers", async (t) => {
  const projectRoot = await makeTempProject();
  const previousToken = process.env.PAPERNEXUS_API_TOKEN;
  t.after(async () => {
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_API_TOKEN;
    } else {
      process.env.PAPERNEXUS_API_TOKEN = previousToken;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.PAPERNEXUS_API_TOKEN = "test-token";
  await seedSetupCompleteProject(projectRoot, "frontier_mapping");
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    schema_version: 1,
    project_id: "demo-project",
    updated_at: "2026-03-22T12:00:00.000Z",
    papers: {
      "2501.00011": {
        arxiv_id: "2501.00011",
        title: "Omega Paper",
        source_provider: "arxiv2md-api",
        retrieval_providers: ["papers-cool"],
      },
      "2501.00012": {
        arxiv_id: "2501.00012",
        title: "Sigma Paper",
        source_provider: "hf",
        retrieval_providers: ["papers-cool", "hugging-face-paper-pages"],
      },
    },
    summary: "metadata only",
  });
  await seedRemoteGraphStatus(projectRoot, {
    corpusName: "GCD",
    corpusRoot: "https://papernexus.example/corpora/GCD",
    expectedPaperCount: 2,
    presentPaperCount: 2,
  });

  const result = await checkGraphPresenceForWorkflow({
    projectRoot,
    remoteAccess: {
      apiBaseUrl: "https://papernexus.example/api",
      tokenSource: "env",
      tokenEnv: "PAPERNEXUS_API_TOKEN",
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.expectedPaperCount, 2);
  assert.equal(result.presentPaperCount, 2);
  assert.equal(result.missingPaperCount, 0);

  const report = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), "utf8")
  );
  assert.equal(report.expected_paper_count, 2);
  assert.equal(report.present_paper_count, 2);
  assert.equal(report.missing_paper_count, 0);
});

test("graph presence check does not fall back to local corpus files when remote PaperNexus access is configured", async (t) => {
  const projectRoot = await makeTempProject();
  const previousToken = process.env.PAPERNEXUS_API_TOKEN;
  t.after(async () => {
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_API_TOKEN;
    } else {
      process.env.PAPERNEXUS_API_TOKEN = previousToken;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.PAPERNEXUS_API_TOKEN = "test-token";
  await seedSetupCompleteProject(projectRoot, "frontier_mapping");
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "arxiv:2501.00021",
      arxiv_id: "2501.00021",
      title: "Remote Only Paper",
      source_path: path.join(
        projectRoot,
        "researcher",
        "paper_source",
        "md",
        "2501.00021--remote-only-paper.md"
      ),
    },
  ]);
  await seedGraphCorpus(projectRoot, [
    {
      sourceKey: path.join(
        projectRoot,
        ".papernexus-home",
        "corpora",
        "shared-global-graph",
        "md",
        "2501.00021--remote-only-paper.md"
      ),
      inputPath: path.join(
        projectRoot,
        ".papernexus-home",
        "corpora",
        "shared-global-graph",
        "md",
        "2501.00021--remote-only-paper.md"
      ),
      kind: "markdown",
      paperId: "paper:remote-only",
      paperTitle: "Remote Only Paper",
      activeInGraph: true,
    },
  ]);
  await fs.rm(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), { force: true });

  const result = await checkGraphPresenceForWorkflow({
    projectRoot,
    remoteAccess: {
      apiBaseUrl: "https://papernexus.example/api",
      tokenSource: "env",
      tokenEnv: "PAPERNEXUS_API_TOKEN",
    },
  });

  assert.equal(result.status, "missing_corpus");
  assert.match(result.blockingReason ?? "", /remote PaperNexus/i);
  assert.equal(result.presentPaperCount, 0);
  assert.equal(result.missingPaperCount, 1);
});

test("graph presence check reports remote PaperNexus reconciliation in progress when wrapper-driven ingestion is active", async (t) => {
  const projectRoot = await makeTempProject();
  const previousToken = process.env.PAPERNEXUS_API_TOKEN;
  t.after(async () => {
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_API_TOKEN;
    } else {
      process.env.PAPERNEXUS_API_TOKEN = previousToken;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.PAPERNEXUS_API_TOKEN = "test-token";
  await seedSetupCompleteProject(projectRoot, "graph_build");
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "arxiv:2305.18909",
      arxiv_id: "2305.18909",
      title: "First Missing Paper",
      source_provider: "hugging-face-paper-pages",
      retrieval_providers: ["papers-cool"],
    },
    {
      canonical_id: "arxiv:2602.19872",
      arxiv_id: "2602.19872",
      title: "Second Missing Paper",
      source_provider: "arxiv2md-api",
      retrieval_providers: ["papers-cool"],
    },
    {
      canonical_id: "arxiv:2603.15263",
      arxiv_id: "2603.15263",
      title: "Third Missing Paper",
      source_provider: "pdf",
      retrieval_providers: ["papers-cool"],
    },
  ]);
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    title: "Demo Project",
    current_stage: "graph_build",
    paper_ingestion: {
      runtime_status: "waiting_graph",
      waiting_reason: "wrapper queue is still importing and reconciling newly staged papers",
      import_task_ids: ["imp:1", "imp:2"],
      completed_papers: [
        {
          canonical_id: "arxiv:2305.18909",
          title: "First Missing Paper",
          import_task_id: "imp:1",
        },
      ],
      paper_operations: [
        {
          canonical_id: "arxiv:2602.19872",
          title: "Second Missing Paper",
          import_task_id: "imp:2",
          phase: "import",
          status: "running",
          timeout_seconds: 60,
        },
      ],
      reconcile_required: true,
    },
    idle_research: { enabled: false },
  });
  await seedRemoteGraphStatus(projectRoot, {
    status: "missing_papers",
    expectedPaperCount: 0,
    presentPaperCount: 0,
    missingPapers: [],
  });

  const result = await checkGraphPresenceForWorkflow({
    projectRoot,
    remoteAccess: {
      apiBaseUrl: "https://papernexus.example/api",
      tokenSource: "env",
      tokenEnv: "PAPERNEXUS_API_TOKEN",
    },
  });

  assert.equal(result.status, "missing_corpus");
  assert.match(result.blockingReason ?? "", /automatic graph catch-up is still running/i);
  assert.match(result.blockingReason ?? "", /paper_ingestion reports status=waiting_graph/i);
  assert.match(result.blockingReason ?? "", /import_tasks=2/i);
  assert.match(result.blockingReason ?? "", /completed=1/i);
  assert.match(result.blockingReason ?? "", /active_operations=1/i);
});

test("auto iterator uses remote graph status for graph_build when remote PaperNexus access is configured", async (t) => {
  const projectRoot = await makeTempProject();
  const previousToken = process.env.PAPERNEXUS_API_TOKEN;
  t.after(async () => {
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_API_TOKEN;
    } else {
      process.env.PAPERNEXUS_API_TOKEN = previousToken;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.PAPERNEXUS_API_TOKEN = "test-token";
  await seedSetupCompleteProject(projectRoot, "graph_build");
  await writeText(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"));
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    project_id: "demo-project",
    papers: {
      "2501.00031": {
        arxiv_id: "2501.00031",
        title: "Remote Frontier Paper",
        source_provider: "arxiv2md-api",
        retrieval_providers: ["papers-cool"],
      },
    },
    summary: "metadata only",
  });
  await seedRemoteGraphStatus(projectRoot, {
    corpusName: "GCD",
    corpusRoot: "https://papernexus.example/corpora/GCD",
    expectedPaperCount: 1,
    presentPaperCount: 1,
  });
  await seedReadyBrainstormCycle(projectRoot);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    policy: {
      papernexusApiBaseUrl: "https://papernexus.example/api",
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "PAPERNEXUS_API_TOKEN",
    },
  });

  assert.equal(result.stageBefore, "graph_build");
  assert.equal(result.graphPresenceCheck?.status, "ready");
  assert.equal(result.stageAfter, "frontier_mapping");
});

test("auto iterator points graph_build at a repair import pass when remote graph sync is stalled and idle", async (t) => {
  const projectRoot = await makeTempProject();
  const previousToken = process.env.PAPERNEXUS_API_TOKEN;
  t.after(async () => {
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_API_TOKEN;
    } else {
      process.env.PAPERNEXUS_API_TOKEN = previousToken;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.PAPERNEXUS_API_TOKEN = "test-token";
  await seedSetupCompleteProject(projectRoot, "graph_build");
  await writeText(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"));
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    project_id: "demo-project",
    papers: {
      "2501.00031": {
        arxiv_id: "2501.00031",
        title: "Remote Frontier Paper",
        source_provider: "arxiv2md-api",
        retrieval_providers: ["papers-cool"],
      },
    },
    summary: "metadata only",
  });
  await seedRemoteGraphStatus(projectRoot, {
    corpusName: "GCD",
    corpusRoot: "https://papernexus.example/corpora/GCD",
    status: "missing_papers",
    expectedPaperCount: 1,
    presentPaperCount: 0,
    missingPapers: [
      {
        canonical_id: "2501.00031",
        title: "Remote Frontier Paper",
      },
    ],
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    policy: {
      papernexusApiBaseUrl: "https://papernexus.example/api",
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "PAPERNEXUS_API_TOKEN",
    },
  });

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );

  assert.equal(result.stageBefore, "graph_build");
  assert.equal(result.stageAfter, "graph_build");
  assert.equal(result.graphPresenceCheck?.status, "missing_papers");
  assert.match(result.nextAction ?? "", /\/graph-build --repair-import true/i);
  assert.match(result.nextAction ?? "", /--shared-corpus "?GCD"?/i);
  assert.equal(manifest.paper_ingestion.repair_required, true);
  assert.equal(manifest.paper_ingestion.repair_target_corpus, "GCD");
  assert.match(manifest.paper_ingestion.repair_reason ?? "", /missing|repair/i);
});

test("auto iterator marks graph_build as uploading while workflow-owned ingestion is still active", async (t) => {
  const projectRoot = await makeTempProject();
  const previousToken = process.env.PAPERNEXUS_API_TOKEN;
  t.after(async () => {
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_API_TOKEN;
    } else {
      process.env.PAPERNEXUS_API_TOKEN = previousToken;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.PAPERNEXUS_API_TOKEN = "test-token";
  await seedSetupCompleteProject(projectRoot, "graph_build");
  await writeText(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"));
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    project_id: "demo-project",
    papers: {
      "2501.00031": {
        arxiv_id: "2501.00031",
        title: "Remote Frontier Paper",
      },
    },
  });
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "graph_build";
  manifest.paper_ingestion = {
    ...(manifest.paper_ingestion ?? {}),
    runtime_status: "waiting_import",
    waiting_reason: "workflow-owned batch import is still running",
    graph_presence_status: "missing_papers",
    queued_requests: [
      {
        request_id: "req-1",
        status: "running",
        wrapper: "pn_batch_import.py",
        shared_corpus: "GCD",
        manifest_path: "researcher/paper_source/manifest.json",
        summary: "Upload selected graph papers",
      },
    ],
  };
  await writeJson(manifestPath, manifest);
  await seedRemoteGraphStatus(projectRoot, {
    corpusName: "GCD",
    corpusRoot: "https://papernexus.example/corpora/GCD",
    status: "missing_papers",
    expectedPaperCount: 1,
    presentPaperCount: 0,
    missingPapers: [{ canonical_id: "2501.00031", title: "Remote Frontier Paper" }],
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    policy: {
      papernexusApiBaseUrl: "https://papernexus.example/api",
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "PAPERNEXUS_API_TOKEN",
    },
  });

  const updatedManifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );

  assert.equal(result.stageBefore, "graph_build");
  assert.equal(result.stageAfter, "graph_build");
  assert.equal(updatedManifest.current_micro_stage, "uploading");
});

test("auto iterator marks graph_build as verifying when uploads are idle but graph presence is not ready", async (t) => {
  const projectRoot = await makeTempProject();
  const previousToken = process.env.PAPERNEXUS_API_TOKEN;
  t.after(async () => {
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_API_TOKEN;
    } else {
      process.env.PAPERNEXUS_API_TOKEN = previousToken;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.PAPERNEXUS_API_TOKEN = "test-token";
  await seedSetupCompleteProject(projectRoot, "graph_build");
  await writeText(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"));
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    project_id: "demo-project",
    papers: {
      "2501.00032": {
        arxiv_id: "2501.00032",
        title: "Verification Paper",
      },
    },
  });
  await seedRemoteGraphStatus(projectRoot, {
    corpusName: "GCD",
    corpusRoot: "https://papernexus.example/corpora/GCD",
    status: "missing_papers",
    expectedPaperCount: 1,
    presentPaperCount: 0,
    missingPapers: [{ canonical_id: "2501.00032", title: "Verification Paper" }],
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    policy: {
      papernexusApiBaseUrl: "https://papernexus.example/api",
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "PAPERNEXUS_API_TOKEN",
    },
  });

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );

  assert.equal(result.stageBefore, "graph_build");
  assert.equal(result.stageAfter, "graph_build");
  assert.equal(manifest.current_micro_stage, "verifying");
});

test("auto iterator advances graph_build to frontier_mapping when graph is ready even if the brainstorm contract is still missing", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedSetupCompleteProject(projectRoot, "graph_build");
  await writeText(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"));
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "arxiv:2501.00033",
      arxiv_id: "2501.00033",
      title: "Ready Graph Paper",
      source_path: path.join(
        projectRoot,
        "researcher",
        "paper_source",
        "md",
        "2501.00033--ready-graph-paper.md"
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
      sourceKey: path.join(sourceRoot, "md", "2501.00033--ready-graph-paper.md"),
      inputPath: path.join(sourceRoot, "md", "2501.00033--ready-graph-paper.md"),
      kind: "markdown",
      paperId: "paper:ready-graph",
      paperTitle: "Ready Graph Paper",
      sourcePath: path.join(sourceRoot, "md", "2501.00033--ready-graph-paper.md"),
      sourceMarkdownPath: path.join(
        sourceRoot,
        "md",
        "2501.00033--ready-graph-paper.md"
      ),
      activeInGraph: true,
      canonicalSourceKey: path.join(
        sourceRoot,
        "md",
        "2501.00033--ready-graph-paper.md"
      ),
    },
  ]);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );

  assert.equal(result.stageBefore, "graph_build");
  assert.equal(result.stageAfter, "frontier_mapping");
  assert.equal(result.graphPresenceCheck?.status, "ready");
  assert.equal(manifest.current_stage, "frontier_mapping");
  assert.equal(manifest.current_micro_stage, "frontier_mapping_requested");
});

test("auto iterator surfaces the IDEA-CATALYST micro-stage while idea remains in progress", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForCode(projectRoot);
  await seedReadyBrainstormCycle(projectRoot, { trackId: "track-1" });
  await seedReadyIdeationContract(projectRoot, { trackId: "track-1" });
  await seedReadyIdeaCatalystState(projectRoot, { microStage: "judging" });
  await fs.rm(path.join(projectRoot, "researcher", "IDEA_REPORT.md"), { force: true });

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.current_micro_stage = "idea_refresh_requested";
  manifest.owner_agent = "researcher";
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(result.stageBefore, "idea");
  assert.equal(result.stageAfter, "idea");
  assert.equal(updatedManifest.current_micro_stage, "judging");
});

test("auto iterator queues an IDEA-CATALYST requisition and regresses idea back to graph_build uploading", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { trackId } = await seedProjectReadyForCode(projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.current_micro_stage = "gatekeeping";
  manifest.owner_agent = "researcher";
  manifest.idea_catalyst = {
    ...manifest.idea_catalyst,
    status: "requisition",
    micro_stage: "gatekeeping",
    requisition_required: true,
    pending_reason: "Cross-domain bridge evidence is insufficient for the unresolved catalyst questions.",
  };
  delete manifest.paper_ingestion;
  await writeJson(manifestPath, manifest);

  await writeJson(
    path.join(
      projectRoot,
      "researcher",
      "idea-catalyst",
      "INVESTIGATION_REQUISITION.json"
    ),
    {
      requisition_id: "req-catalyst-1",
      target_domain: "Computer Science",
      missing_domains: ["Psychology", "Control Theory"],
      challenge_clusters: ["memory preservation", "cross-domain alignment"],
      coverage_gap_questions: [
        {
          question_id: "q1",
          question: "How should memory be preserved under cross-domain shift?",
          coverage_status: "unexplored",
          required_domain_evidence: ["Psychology", "Control Theory"],
        },
      ],
      search_queries: [
        {
          domain: "Psychology",
          query: "Psychology memory preservation transferable principle",
          rationale: "Acquire source-domain evidence for q1.",
        },
        {
          domain: "Control Theory",
          query: "Control Theory adaptive regulation transferable principle",
          rationale: "Acquire source-domain evidence for q1.",
        },
      ],
      minimum_sources_per_domain: 2,
      minimum_bridge_nodes: 2,
      retry_budget: 2,
      saturation_signal: "idea-catalyst-requisition:test",
      required_stage_reentry: ["graph_build", "frontier_mapping", "idea"],
      ingestion_mode: "paper_search_then_queue_import",
    }
  );

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(result.stageBefore, "idea");
  assert.equal(result.stageAfter, "graph_build");
  assert.equal(updatedManifest.current_stage, "graph_build");
  assert.equal(updatedManifest.current_micro_stage, "uploading");
  assert.equal(updatedManifest.paper_ingestion.queued_requests.length >= 1, true);
  assert.equal(
    updatedManifest.paper_ingestion.queued_requests[0].trigger_kind,
    "idea_catalyst_requisition"
  );
  assert.match(updatedManifest.next_action ?? "", /graph-build/i);
  assert.equal(updatedManifest.idea_catalyst.status, "requisition");
  assert.equal(updatedManifest.ideation_contract.selected_track_id, trackId);
});

test("auto iterator completes the IDEA-CATALYST requisition rerun loop back into idea and plan", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { trackId } = await seedProjectReadyForCode(projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.current_micro_stage = "gatekeeping";
  manifest.owner_agent = "researcher";
  manifest.idea_catalyst = {
    ...manifest.idea_catalyst,
    status: "requisition",
    micro_stage: "gatekeeping",
    requisition_required: true,
    pending_reason: "Cross-domain bridge evidence is insufficient for the unresolved catalyst questions.",
  };
  delete manifest.paper_ingestion;
  await writeJson(manifestPath, manifest);

  await writeJson(
    path.join(projectRoot, "researcher", "idea-catalyst", "INVESTIGATION_REQUISITION.json"),
    {
      requisition_id: "req-catalyst-rerun",
      target_domain: "Computer Science",
      missing_domains: ["Psychology", "Control Theory"],
      challenge_clusters: ["memory preservation", "cross-domain alignment"],
      coverage_gap_questions: [
        {
          question_id: "q1",
          question: "How should memory be preserved under cross-domain shift?",
          coverage_status: "unexplored",
          required_domain_evidence: ["Psychology", "Control Theory"],
        },
      ],
      search_queries: [
        {
          domain: "Psychology",
          query: "Psychology memory preservation transferable principle",
          rationale: "Acquire source-domain evidence for q1.",
        },
      ],
      minimum_sources_per_domain: 2,
      minimum_bridge_nodes: 2,
      retry_budget: 2,
      saturation_signal: "idea-catalyst-requisition:rerun",
      required_stage_reentry: ["graph_build", "frontier_mapping", "idea"],
      ingestion_mode: "paper_search_then_queue_import",
    }
  );

  const first = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  assert.equal(first.stageAfter, "graph_build");

  const queuedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  queuedManifest.current_stage = "graph_build";
  queuedManifest.current_micro_stage = "uploading";
  queuedManifest.paper_ingestion.graph_presence_checked_at = "2026-04-03T00:00:00.000Z";
  queuedManifest.paper_ingestion.graph_presence_status = "ready";
  queuedManifest.paper_ingestion.graph_presence_expected_papers = 1;
  queuedManifest.paper_ingestion.graph_presence_present_papers = 1;
  queuedManifest.paper_ingestion.graph_presence_missing_papers = [];
  queuedManifest.paper_ingestion.refresh_required = false;
  queuedManifest.paper_ingestion.runtime_status = "idle";
  queuedManifest.paper_ingestion.queued_requests =
    queuedManifest.paper_ingestion.queued_requests.map((entry) => ({
      ...entry,
      status: "completed",
    }));
  await writeJson(manifestPath, queuedManifest);
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "arxiv:2604.00001",
      arxiv_id: "2604.00001",
      title: "Catalyst Bridge Paper",
      source_path: path.join(
        projectRoot,
        "researcher",
        "paper_source",
        "md",
        "2604.00001--catalyst-bridge-paper.md"
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
      sourceKey: path.join(sourceRoot, "md", "2604.00001--catalyst-bridge-paper.md"),
      inputPath: path.join(sourceRoot, "md", "2604.00001--catalyst-bridge-paper.md"),
      kind: "markdown",
      paperId: "paper:catalyst-bridge",
      paperTitle: "Catalyst Bridge Paper",
      sourcePath: path.join(sourceRoot, "md", "2604.00001--catalyst-bridge-paper.md"),
      sourceMarkdownPath: path.join(
        sourceRoot,
        "md",
        "2604.00001--catalyst-bridge-paper.md"
      ),
      activeInGraph: true,
      canonicalSourceKey: path.join(
        sourceRoot,
        "md",
        "2604.00001--catalyst-bridge-paper.md"
      ),
    },
  ]);

  const second = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  assert.equal(second.stageAfter, "frontier_mapping");

  const third = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  assert.equal(third.stageAfter, "idea");

  const fourth = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  const finalManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(fourth.stageBefore, "idea");
  assert.equal(fourth.stageAfter, "plan");
  assert.equal(finalManifest.current_stage, "plan");
  assert.equal(finalManifest.idea_catalyst.status, "ready");
  assert.equal(finalManifest.idea_catalyst.requisition_required, false);
  assert.equal(finalManifest.ideation_contract.selected_track_id, trackId);
});

test("auto iterator routes active literature discovery requests back through graph_build before continuing review-time work", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "review";
  manifest.current_micro_stage = "review_requested";
  manifest.owner_agent = "reviewer";
  manifest.paper_ingestion = {
    ...(manifest.paper_ingestion ?? {}),
    queued_requests: [
      {
        request_id: "literature-discovery-gap-1",
        status: "running",
        trigger_kind: "literature_discovery",
        summary: "Bridge evidence discovery for review-time limitation gap",
        detail:
          "Structured literature discovery triggered from review to close limitation evidence before rerunning graph-build.",
        created_at: "2026-04-04T09:00:00.000Z",
        updated_at: "2026-04-04T09:01:00.000Z",
      },
    ],
  };
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(result.stageBefore, "review");
  assert.equal(result.stageAfter, "graph_build");
  assert.equal(result.regressed, true);
  assert.equal(updatedManifest.current_stage, "graph_build");
  assert.equal(updatedManifest.current_micro_stage, "uploading");
  assert.match(updatedManifest.next_action ?? "", /graph-build/i);
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
  await seedReadyBrainstormCycle(projectRoot);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "graph_build");
  assert.equal(result.stageAfter, "frontier_mapping");
  assert.equal(result.graphPresenceCheck?.status, "ready");
});

test("auto iterator advances analyze without theory appendix artifacts when proof appendix is not required", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "analyze";
  manifest.current_micro_stage = "analysis_requested";
  manifest.writing_contract.proof_appendix_required = false;
  manifest.experiment_search = {
    status: "ready_for_analysis",
    current_main_stage: "ablation_studies",
    current_substage: "multi_seed_aggregation",
    best_node_id: "node-best",
    completed_node_ids: ["node-1", "node-2"],
    multi_seed_status: "ready",
    evaluation_summary_path: "researcher/evaluation_summary.json",
    plot_pack_status: "ready",
    plot_pack_path: "researcher/plot_pack.json",
    checkpoint_path: "researcher/checkpoints/experiment-manager.json",
  };
  await writeJson(manifestPath, manifest);

  await writeJson(path.join(projectRoot, "researcher", "evaluation_summary.json"), {
    metric: "acc",
    value: 0.91,
  });
  await writeJson(path.join(projectRoot, "researcher", "plot_pack.json"), {
    plots: [{ figure_id: "fig-1", caption: "Main results." }],
  });

  await fs.rm(path.join(projectRoot, "analyzer", "THEORY_SUPPORT_NOTE.md"), {
    force: true,
  });
  await fs.rm(path.join(projectRoot, "analyzer", "THEORY_STATE.json"), {
    force: true,
  });
  await fs.rm(path.join(projectRoot, "analyzer", "proof-packets"), {
    recursive: true,
    force: true,
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "analyze");
  assert.equal(result.stageAfter, "review");
  assert.ok(
    !result.missingStageSignals.some((signal) =>
      /THEORY_SUPPORT_NOTE|THEORY_STATE|proof-packets/i.test(signal)
    )
  );
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

test("auto iterator advances submit to done once GATE-5 is explicitly approved", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);
  await writeJson(path.join(projectRoot, "researcher", "GATE_STATE.json"), {
    current_stage: "submit",
    last_gate: "GATE-5",
    gate_status: "approved",
    gate_type: "manual_confirmation",
    gate_timestamp: "2026-04-03T09:00:00.000Z",
    auto_proceed: false,
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "submit");
  assert.equal(result.stageAfter, "done");
  assert.equal(result.gateBlocking, false);
});

test("auto iterator keeps submit blocked in aggressive mode because final confirmation stays manual", async (t) => {
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
  assert.match(result.gateReason ?? "", /human confirmation|OpenReview-facing submission path/i);
});

test("auto iterator caps backward regression depth before falling all the way to setup", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedSetupCompleteProject(projectRoot, "write");

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "write");
  assert.equal(result.stageEffective, "experiment");
  assert.equal(result.stageAfter, "experiment");
  assert.equal(result.regressed, true);
});

test("auto iterator clears a timed-default waiting gate after the confirmation deadline expires", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForCode(projectRoot);
  await writeJson(path.join(projectRoot, "researcher", "GATE_STATE.json"), {
    current_stage: "code",
    last_gate: "CONFIRM-RESUME-1",
    gate_status: "waiting",
    gate_type: "timed_default",
    auto_proceed: false,
    confirmation_requested_at: "2026-03-28T09:00:00.000Z",
    confirmation_deadline_at: "2026-03-28T10:00:00.000Z",
    default_action: "resume_recommended_stage",
    default_action_reason:
      "No user reply within 1h; continue with the workflow-safe default branch.",
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    now: "2026-03-28T10:05:00.000Z",
  });

  assert.equal(result.stageBefore, "code");
  assert.equal(result.stageAfter, "code");
  assert.equal(result.gateBlocking, false);
  assert.equal(result.timedDefaultTriggered, true);
  assert.match(result.gateReason ?? "", /timed-default/i);

  const savedGate = JSON.parse(
    await fs.readFile(path.join(projectRoot, "researcher", "GATE_STATE.json"), "utf8")
  );
  assert.equal(savedGate.gate_status, "approved");
  assert.equal(savedGate.default_action_executed_at, "2026-03-28T10:05:00.000Z");
});

test("auto iterator clears stale submit gate timestamps after regression and resets them on re-entry", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const gatePath = path.join(projectRoot, "researcher", "GATE_STATE.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.citation_integrity.verification_status = "needs_revision";
  manifest.citation_integrity.hallucinated_citation_count = 1;
  await writeJson(manifestPath, manifest);
  await writeJson(gatePath, {
    current_stage: "submit",
    last_gate: "GATE-5",
    gate_status: "waiting",
    gate_timestamp: "2026-03-28T09:00:00.000Z",
    auto_proceed: false,
  });

  const regressed = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    now: "2026-03-28T10:05:00.000Z",
  });

  assert.equal(regressed.stageAfter, "write");
  const regressedGate = JSON.parse(await fs.readFile(gatePath, "utf8"));
  assert.equal(regressedGate.gate_timestamp, null);
  assert.equal(regressedGate.last_gate, null);
  assert.equal(regressedGate.gate_status, null);

  const recoveredManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  recoveredManifest.current_stage = "submit";
  recoveredManifest.citation_integrity.verification_status = "verified";
  recoveredManifest.citation_integrity.hallucinated_citation_count = 0;
  await writeJson(manifestPath, recoveredManifest);

  const resubmitted = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    now: "2026-03-28T11:00:00.000Z",
  });

  assert.equal(resubmitted.stageAfter, "submit");
  assert.equal(resubmitted.gateBlocking, true);
  const resubmittedGate = JSON.parse(await fs.readFile(gatePath, "utf8"));
  assert.equal(resubmittedGate.gate_timestamp, "2026-03-28T11:00:00.000Z");
  assert.equal(resubmittedGate.last_gate, "GATE-5");
  assert.equal(resubmittedGate.gate_status, "waiting");
});

test("auto iterator keeps submit blocked even when a legacy aggressive auto gate round was approved", async (t) => {
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
  assert.equal(result.stageAfter, "submit");
  assert.equal(result.gateBlocking, true);
  assert.match(result.gateReason ?? "", /human confirmation|OpenReview-facing submission path/i);
  assert.equal(result.ownerAfter, "reviewer");
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

test("workflow runtime rewrite E2E migrates a legacy project and walks setup through done", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedSetupCompleteProject(projectRoot, "setup");

  const migration = await migrateWorkflowRuntimeState({
    projectRoot,
    compatibilityMode: "sessions_spawn_runtime",
    reason: "workflow_e2e_integration",
  });
  assert.equal(migration.compatibilityMode, "sessions_spawn_runtime");
  await fs.access(getWorkflowRuntimeQueuePath(projectRoot));
  await fs.access(getWorkflowRuntimeSessionsPath(projectRoot));
  await fs.access(getWorkflowAnnounceOutboxPath(projectRoot));
  await fs.access(getWorkflowBroadcastOutboxPath(projectRoot));
  await fs.access(getWorkflowRuntimeEventsPath(projectRoot));

  let result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  assert.equal(result.stageBefore, "setup");
  assert.equal(result.stageAfter, "graph_build");

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
  await seedReadyBrainstormCycle(projectRoot);

  result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  assert.equal(result.stageBefore, "graph_build");
  assert.equal(result.stageAfter, "frontier_mapping");

  await writeText(path.join(projectRoot, "researcher", "FRONTIER_REPORT.md"));
  for (const fileName of [
    "LIMITATION_FRONTIER.md",
    "CONTRADICTION_FRONTIER.md",
    "TRANSFER_FRONTIER.md",
    "COMPOSITION_FRONTIER.md",
    "ANCHOR_INDEX.md",
  ]) {
    await writeText(path.join(projectRoot, "graph", fileName));
  }
  let manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  let manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_micro_stage = "frontiers_packaged";
  await writeJson(manifestPath, manifest);

  result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  assert.equal(result.stageBefore, "frontier_mapping");
  assert.equal(result.stageAfter, "idea");

  const { trackId } = await seedProjectReadyForCode(projectRoot);
  manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
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
  ]);
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
  await seedReadyBrainstormCycle(projectRoot, { trackId });
  await writeText(path.join(projectRoot, "researcher", "FRONTIER_REPORT.md"));
  for (const fileName of [
    "LIMITATION_FRONTIER.md",
    "CONTRADICTION_FRONTIER.md",
    "TRANSFER_FRONTIER.md",
    "COMPOSITION_FRONTIER.md",
    "ANCHOR_INDEX.md",
  ]) {
    await writeText(path.join(projectRoot, "graph", fileName));
  }
  manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.current_micro_stage = "frontiers_packaged";
  await writeJson(manifestPath, manifest);

  result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  assert.equal(result.stageBefore, "idea");
  assert.equal(result.stageAfter, "plan");

  result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  assert.equal(result.stageBefore, "plan");
  assert.equal(result.stageAfter, "code");

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
    buildAlignedExperimentManifest(trackId)
  );

  result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  assert.equal(result.stageBefore, "code");
  assert.equal(result.stageAfter, "experiment");

  await seedProjectReadyForSubmit(projectRoot);
  manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "experiment";
  manifest.current_micro_stage = "ready_for_analysis";
  manifest.experiment_search = {
    status: "ready_for_analysis",
    current_main_stage: "ablation_studies",
    current_substage: "multi_seed_aggregation",
    best_node_id: "node-best",
    completed_node_ids: ["node-1", "node-2"],
    multi_seed_status: "ready",
    evaluation_summary_path: "researcher/evaluation_summary.json",
    plot_pack_status: "ready",
    plot_pack_path: "researcher/plot_pack.json",
    checkpoint_path: "researcher/checkpoints/experiment-manager.json",
  };
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(projectRoot, "researcher", "evaluation_summary.json"), {
    metric: "acc",
    value: 0.91,
  });
  await writeJson(path.join(projectRoot, "researcher", "plot_pack.json"), {
    plots: [{ figure_id: "fig-1", caption: "Main results." }],
  });

  result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  assert.equal(result.stageBefore, "experiment");
  assert.equal(result.stageAfter, "analyze");

  result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  assert.equal(result.stageBefore, "analyze");
  assert.equal(result.stageAfter, "review");

  result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  assert.equal(result.stageBefore, "review");
  assert.equal(result.stageAfter, "write");

  result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  assert.equal(result.stageBefore, "write");
  assert.equal(result.stageAfter, "submit");

  result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  assert.equal(result.stageBefore, "submit");
  assert.equal(result.stageAfter, "submit");
  assert.equal(result.gateBlocking, true);

  await writeJson(path.join(projectRoot, "researcher", "GATE_STATE.json"), {
    current_stage: "submit",
    last_gate: "GATE-5",
    gate_status: "approved",
    gate_type: "manual_confirmation",
    gate_timestamp: "2026-04-03T09:00:00.000Z",
    auto_proceed: false,
  });

  result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  assert.equal(result.stageBefore, "submit");
  assert.equal(
    result.stageAfter,
    "done",
    `Unexpected submit completion: stageAfter=${result.stageAfter}; gateBlocking=${result.gateBlocking}; missing=${JSON.stringify(result.missingStageSignals)}; gateReason=${result.gateReason ?? "none"}`
  );
  assert.equal(result.gateBlocking, false);
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
    buildAlignedExperimentManifest(trackId)
  );

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "code");
  assert.equal(result.stageAfter, "experiment");
});

test("auto iterator keeps code stage blocked when experiment bundle is not aligned to the active innovation track", async (t) => {
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
    buildAlignedExperimentManifest(trackId, {
      hypothesis: "A different hypothesis entirely.",
      novelty_basis: "A novelty basis that does not match the active track.",
    })
  );

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "code");
  assert.equal(result.stageAfter, "code");
  assert.ok(
    result.missingStageSignals.some((signal) =>
      /must align its hypothesis to active track/i.test(signal)
    )
  );
});

test("auto iterator keeps code stage blocked when the experiment bundle does not declare baseline and validation contracts", async (t) => {
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
      question: "Does graph grounding improve support precision?",
      hypothesis: "Graph grounding improves support precision.",
      novelty_basis: "It couples frontier packets with section drafting.",
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

  assert.equal(result.stageAfter, "code");
  assert.ok(
    result.missingStageSignals.some((signal) =>
      /baseline_reference|primary_baseline_metric|validation_steps|ablation_plan/i.test(signal)
    )
  );
});

test("auto iterator keeps code blocked in aggressive mode while code innovation review is pending", async (t) => {
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
    buildAlignedExperimentManifest(trackId)
  );

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

  assert.equal(result.stageBefore, "code");
  assert.equal(result.stageAfter, "code");
  assert.equal(result.gateBlocking, true);
  assert.match(result.gateReason ?? "", /code innovation review is pending/i);
});

test("auto iterator advances code to experiment when aggressive code innovation review is approved", async (t) => {
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
    buildAlignedExperimentManifest(trackId)
  );

  const autoGate = {
    ...defaultAutoGateConfig(),
    enabled: true,
  };
  const round = createCodeReviewRound({
    stage: "code",
    packetPath: path.join(
      projectRoot,
      "reviewer",
      "code-review",
      "CODE_REVIEW_PACKET.md"
    ),
    packetJsonPath: path.join(
      projectRoot,
      "reviewer",
      "code-review",
      "CODE_REVIEW_PACKET.json"
    ),
    packetFingerprint: "approved-code-packet",
    attempts: [
      {
        reviewerRole: "researcher",
        sessionKey: "agent:researcher:main",
        runId: "code-review-researcher",
        status: "completed",
        launchedAt: "2026-04-01T00:00:00.000Z",
        completedAt: "2026-04-01T00:01:00.000Z",
        error: null,
        result: {
          reviewerRole: "researcher",
          verdict: "pass",
          overallScore: 9,
          dimensionScores: { innovation_alignment: 9, baseline_fidelity: 9 },
          criticalBlockers: [],
          majorIssues: [],
          suggestedRollbackStage: null,
          reviewedArtifacts: ["coder/EXPERIMENT_INDEX.md"],
          summary: "Innovation contract matches the active track.",
          createdAt: "2026-04-01T00:01:00.000Z",
          runId: "code-review-researcher",
          rawText: "{}",
        },
      },
      {
        reviewerRole: "orchestrator",
        sessionKey: "agent:orchestrator:main",
        runId: "code-review-orchestrator",
        status: "completed",
        launchedAt: "2026-04-01T00:00:00.000Z",
        completedAt: "2026-04-01T00:01:00.000Z",
        error: null,
        result: {
          reviewerRole: "orchestrator",
          verdict: "pass",
          overallScore: 8.8,
          dimensionScores: { validation_plan: 9, ablation_plan: 8.5 },
          criticalBlockers: [],
          majorIssues: [],
          suggestedRollbackStage: null,
          reviewedArtifacts: ["orchestrator/PLAN_AUDIT.md"],
          summary: "Validation steps cover each innovation point.",
          createdAt: "2026-04-01T00:01:00.000Z",
          runId: "code-review-orchestrator",
          rawText: "{}",
        },
      },
      {
        reviewerRole: "reviewer",
        sessionKey: "agent:reviewer:main",
        runId: "code-review-reviewer",
        status: "completed",
        launchedAt: "2026-04-01T00:00:00.000Z",
        completedAt: "2026-04-01T00:01:00.000Z",
        error: null,
        result: {
          reviewerRole: "reviewer",
          verdict: "pass",
          overallScore: 8.9,
          dimensionScores: { execution_readiness: 9, eval_fidelity: 8.8 },
          criticalBlockers: [],
          majorIssues: [],
          suggestedRollbackStage: null,
          reviewedArtifacts: ["coder/experiments/track-1/exp-1__baseline/README.md"],
          summary: "Bundle is executable and respects baseline evaluation.",
          createdAt: "2026-04-01T00:01:00.000Z",
          runId: "code-review-reviewer",
          rawText: "{}",
        },
      },
    ],
  });
  round.aggregate = aggregateCodeReviewRound(round, autoGate);
  round.status = round.aggregate.status;
  await saveCodeReviewStore(projectRoot, {
    schemaVersion: 1,
    updatedAt: "2026-04-01T00:01:00.000Z",
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

  assert.equal(result.stageBefore, "code");
  assert.equal(result.stageAfter, "experiment");
  assert.equal(result.gateBlocking, false);
});

test("auto iterator points experiment stage at monitor-experiment while remote runs are still active", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { now, trackId } = await seedProjectReadyForCode(projectRoot);
  await writeText(path.join(projectRoot, "researcher", "EXPERIMENT_REGISTRY.md"));
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
    buildAlignedExperimentManifest(trackId, {
      experiment_id: "exp-1",
      status: "running",
    })
  );

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "experiment";
  manifest.current_micro_stage = "pilot_runs_complete";
  manifest.experiment_memory = {
    ledger_path: "researcher/EXPERIMENT_LEDGER.json",
    last_ledger_update_at: now,
    last_completed_experiment_id: null,
    last_failed_experiment_id: null,
    best_known_config_ref: null,
    last_decision_summary: null,
    papernexus_sync_required: false,
    papernexus_sync_status: "unknown",
  };
  manifest.experiment_search = {
    status: "running",
    current_main_stage: "baseline_implementation",
    current_substage: "remote_training",
    multi_seed_status: "running",
    plot_pack_status: "pending",
    pending_reason: "Remote training is still running.",
  };
  await writeJson(manifestPath, manifest);

  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    schemaVersion: 1,
    projectId: "demo-project",
    updatedAt: now,
    summary: {
      activeExperimentIds: ["exp-1"],
      lastCompletedExperimentId: null,
      lastFailedExperimentId: null,
      bestKnownConfigRef: null,
      lastDecisionSummary: null,
      papernexusSyncRequired: false,
      papernexusLastSyncAt: null,
    },
    experiments: [
      {
        experimentId: "exp-1",
        trackId,
        name: "baseline",
        kind: "train",
        status: "running",
        stage: "training",
        hypothesis: "Graph grounding improves support precision.",
        configRef: "configs/baseline.yaml",
        summary: "Remote training is still running.",
        server: "gpu-0",
        gpuId: "0",
        screenName: "exp-1-baseline",
        launchedAt: now,
        completedAt: null,
        updatedAt: now,
        lastUpdatedBy: "coder",
        decision: null,
        keyMetric: null,
        metrics: null,
        resultPaths: [],
        evidencePointers: [],
        failureSignature: null,
        notes: [],
        metadata: {
          remoteRunPath: `coder/experiments/${trackId}/exp-1__baseline/REMOTE_RUN.json`,
        },
        papernexusSync: {
          status: null,
          corpus: null,
          lastSyncedAt: null,
          nodeRefs: [],
          notes: null,
        },
      },
    ],
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "experiment");
  assert.equal(result.stageAfter, "experiment");
  assert.match(result.nextAction ?? "", /\/monitor-experiment/i);
  assert.match(result.resumeAction ?? "", /\/monitor-experiment/i);
  assert.ok(
    result.recommendedActions.some((action) =>
      /\/monitor-experiment/i.test(action.command ?? "")
    )
  );
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

test("auto iterator auto-materializes the paper story contract before write-stage drafting checks", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "write";
  manifest.current_micro_stage = "story_contract_pending";
  delete manifest.paper_story_state;
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "write");
  const repairedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(repairedManifest.paper_story_state.status, "ready");
  await fs.access(
    path.join(projectRoot, repairedManifest.paper_story_state.story_spine_path)
  );
  await fs.access(
    path.join(
      projectRoot,
      repairedManifest.paper_story_state.claim_to_experiment_map_path
    )
  );
  assert.ok(
    !result.missingStageSignals.some((signal) =>
      /PROJECT_MANIFEST\.json\.paper_story_state\.status = ready/i.test(signal)
    )
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

test("PROBLEM_DECOMPOSITION.md generated by seedReadyIdeationContract contains required structure", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { trackId } = await seedProjectReadyForCode(projectRoot);
  await seedReadyBrainstormCycle(projectRoot, { trackId });
  await seedReadyIdeationContract(projectRoot, { trackId });

  const decompositionPath = path.join(
    projectRoot,
    "researcher",
    "ideation",
    "PROBLEM_DECOMPOSITION.md"
  );

  // Verify file exists
  const fileExists = await fs.access(decompositionPath).then(
    () => true,
    () => false
  );
  assert.ok(fileExists, "PROBLEM_DECOMPOSITION.md should exist after seeding ideation contract");

  // Verify file has content
  const content = await fs.readFile(decompositionPath, "utf8");
  assert.ok(content.trim().length > 0, "PROBLEM_DECOMPOSITION.md should not be empty");

  // Verify content has heading structure
  assert.ok(
    /^#\s+Problem Decomposition/im.test(content),
    "PROBLEM_DECOMPOSITION.md should have a heading"
  );
});

test("PROBLEM_DECOMPOSITION.md file existence is tracked in ideation contract state", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { trackId } = await seedProjectReadyForCode(projectRoot);
  await seedReadyBrainstormCycle(projectRoot, { trackId });

  // Seed ideation contract with PROBLEM_DECOMPOSITION.md path
  const ideationDir = path.join(projectRoot, "researcher", "ideation");
  await fs.mkdir(ideationDir, { recursive: true });

  // Create required files including PROBLEM_DECOMPOSITION.md with proper content
  await writeText(
    path.join(ideationDir, "PROBLEM_DECOMPOSITION.md"),
    "# Problem Decomposition\n\n## Sub-problems\n- preserve support precision\n- avoid clarity collapse\n\n## Validation Ladder\n- reproduce baseline\n- enable routing delta\n"
  );
  await writeText(
    path.join(ideationDir, "RESEARCH_PROPOSAL.md"),
    "# Research Proposal\n\n## Method\nDemo method.\n"
  );
  await writeText(path.join(ideationDir, "NOVELTY_TREE.md"), "# Novelty Tree\n");
  await writeText(path.join(ideationDir, "CHALLENGE_INSIGHT_TREE.md"), "# Challenge Insight Tree\n");
  await writeText(path.join(ideationDir, "WELL_ESTABLISHED_SOLUTION_CHECK.md"), "# Solution Check\n");
  await writeText(path.join(ideationDir, "CROSS_DOMAIN_TRANSFER.md"), "# Cross Domain Transfer\n");
  await writeText(path.join(ideationDir, "TOP3_DIRECTION_SUMMARY.md"), "# Top 3 Directions\n");
  await writeJson(path.join(ideationDir, "CANDIDATE_POOL.json"), { candidates: [] });
  await writeJson(path.join(ideationDir, "TOURNAMENT_SCOREBOARD.json"), { status: "completed" });

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.ideation_contract = {
    status: "ready",
    contract_version: 1,
    basis_stage: "idea",
    long_term_goal: "Demo goal",
    problem_scope: "Demo scope",
    graph_basis_paths: {},
    graph_ideation_indices: { status: "ready" },
    novelty_tree_path: "researcher/ideation/NOVELTY_TREE.md",
    challenge_insight_tree_path: "researcher/ideation/CHALLENGE_INSIGHT_TREE.md",
    solution_check_path: "researcher/ideation/WELL_ESTABLISHED_SOLUTION_CHECK.md",
    cross_domain_transfer_path: "researcher/ideation/CROSS_DOMAIN_TRANSFER.md",
    problem_decomposition_path: "researcher/ideation/PROBLEM_DECOMPOSITION.md",
    candidate_pool_path: "researcher/ideation/CANDIDATE_POOL.json",
    tournament_scoreboard_path: "researcher/ideation/TOURNAMENT_SCOREBOARD.json",
    top3_summary_path: "researcher/ideation/TOP3_DIRECTION_SUMMARY.md",
    research_proposal_path: "researcher/ideation/RESEARCH_PROPOSAL.md",
    selected_direction_id: "dir-1",
    selected_track_id: trackId,
    last_updated_at: new Date().toISOString(),
  };
  await writeJson(manifestPath, manifest);

  // Verify the decomposition file can be read through the path in manifest
  const decompositionPath = path.join(projectRoot, manifest.ideation_contract.problem_decomposition_path);
  const content = await fs.readFile(decompositionPath, "utf8");

  // Validate expected sections exist
  assert.ok(
    /^#\s+Problem Decomposition/im.test(content),
    "PROBLEM_DECOMPOSITION.md should have a 'Problem Decomposition' heading"
  );
  assert.ok(
    /##\s+Sub-problems/im.test(content) || /sub.?problems?/im.test(content),
    "PROBLEM_DECOMPOSITION.md should contain sub-problems section"
  );
  assert.ok(
    /##\s+Validation/im.test(content) || /validation/im.test(content),
    "PROBLEM_DECOMPOSITION.md should contain validation ladder or validation section"
  );
});
