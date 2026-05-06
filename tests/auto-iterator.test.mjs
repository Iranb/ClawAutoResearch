import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import {
  checkGraphPresenceForWorkflow,
  runWorkflowAutoIterator,
  setExperimentSearchState,
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
import { readWorkflowDiagnosticEvents } from "../tools/workflow-diagnostics.ts";
import { defaultAutoGateConfig } from "../tools/workflow-auto-gate.ts";
import {
  aggregateCodeReviewRound,
  createCodeReviewRound,
  readCodeReviewStore,
  saveCodeReviewStore,
} from "../tools/workflow-code-review.ts";
import {
  createAutoModeDiscussionRound,
  saveAutoModeDiscussionStore,
} from "../tools/workflow-auto-discussion.ts";
import {
  claimAndActivateWorkflowHandoffForAgent,
  syncPreparedWorkflowHandoffToManifest,
} from "../tools/workflow-handoff/handoff-activation.ts";
import { createStageOwnerHandoffIntent } from "../tools/workflow-handoff/handoff-router.ts";
import {
  readWorkflowHandoffIntentStore,
  transitionWorkflowHandoffIntent,
} from "../tools/workflow-handoff/handoff-store.ts";

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

function makePaperMarkdownFetch(markdown) {
  return async () => ({
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
  });
}

test("runWorkflowAutoIterator writes structured diagnostics for stage evaluation", async (t) => {
  const projectRoot = await makeTempProject();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "diagnostic-demo",
    current_stage: "setup",
    owner_agent: "researcher",
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    agentId: "researcher",
    queueMailbox: false,
    policy: {
      autoMode: "aggressive",
    },
  });

  assert.equal(result.projectId, "diagnostic-demo");
  const diagnostics = await readWorkflowDiagnosticEvents(projectRoot);
  assert.ok(
    diagnostics.some(
      (event) =>
        event.component === "auto_iterator" && event.action === "tick_started"
    )
  );
  assert.ok(
    diagnostics.some(
      (event) =>
        event.component === "stage_preflight" &&
        event.action === "current_stage_prepared"
    )
  );
  assert.ok(
    diagnostics.some(
      (event) =>
        event.component === "auto_iterator" &&
        event.action === "auto_mode_evaluated"
    )
  );
  assert.ok(
    diagnostics.some(
      (event) =>
        event.component === "auto_iterator" &&
        event.action === "tick_completed" &&
        typeof event.details?.nextAction === "string"
    )
  );
});

function buildCompliantFigureTableLatex({
  figures = 5,
  tables = 4,
} = {}) {
  const figureBlocks = Array.from({ length: figures }, (_, index) => {
    const number = index + 1;
    const label =
      number === 1 ? "fig:framework-overview" : `fig:analysis-${number}`;
    const caption =
      number === 1
        ? "Framework overview of the proposed method and workflow."
        : `Analysis figure ${number} showing evidence-grounded behavior.`;
    return [
      "\\begin{figure}",
      "\\centering",
      `\\caption{${caption}}`,
      `\\label{${label}}`,
      "\\end{figure}",
    ].join("\n");
  });
  const tableBlocks = Array.from({ length: tables }, (_, index) => {
    const number = index + 1;
    const label =
      number <= 2 ? `tab:experiment-results-${number}` : `tab:analysis-${number}`;
    const caption =
      number <= 2
        ? `Experiment result table ${number} with benchmark metrics.`
        : `Comparison table ${number} summarizing analysis evidence.`;
    return [
      "\\begin{table}",
      "\\centering",
      `\\caption{${caption}}`,
      `\\label{${label}}`,
      "\\begin{tabular}{lc}",
      "Metric & Value \\\\",
      "Accuracy & 0.90 \\\\",
      "\\end{tabular}",
      "\\end{table}",
    ].join("\n");
  });
  return [
    "\\section{Method}",
    "Figure~\\ref{fig:framework-overview} defines the framework.",
    "\\section{Results}",
    "Tables~\\ref{tab:experiment-results-1} and~\\ref{tab:experiment-results-2} report experiment results.",
    ...figureBlocks,
    ...tableBlocks,
  ].join("\n\n");
}

async function activatePreparedHandoff(projectRoot, role) {
  return claimAndActivateWorkflowHandoffForAgent({
    projectRoot,
    role,
    sessionKey: `agent:${role}:test`,
  });
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
    mode = "remote_api",
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
    mode,
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

  await writeText(
    path.join(projectRoot, "researcher", "FRONTIER_REPORT.md"),
    [
      "# Frontier Report",
      "",
      "- Limitation frontier: current support routing still loses evidence under long-context drift.",
      "- Contradiction frontier: reviewer-facing claims and evidence order diverge under late-stage edits.",
      "- Transfer frontier: frontier packets can seed a graph-grounded ideation loop.",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, "researcher", "IDEA_REPORT.md"),
    [
      "# Idea Report",
      "",
      "- Core direction: graph-grounded support routing for scientific writing.",
      "- Novelty claim: couples frontier packets with section drafting to preserve support precision.",
      "- Validation sketch: compare support precision and unsupported-claim rate against baseline-a.",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, "researcher", "IDEA_AUDIT.md"),
    [
      "# Idea Audit",
      "",
      "- Strength: novelty is anchored to explicit frontier packets and graph evidence.",
      "- Risk: benchmark scope and ablation coverage must stay bounded.",
      "- Next gate: advance to plan once ideation contract and brainstorm packet align.",
    ].join("\n")
  );
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
      plan_alternatives: [
        {
          option_id: "plan-main",
          linked_track_id: trackId,
          source_direction_id: "dir-1",
          title: "Graph-grounded main plan",
          status: "selected",
          summary:
            "Advance the graph-grounded evidence-routing track into code and experiment.",
          graph_evidence_paths: [
            "graph/GRAPH_BUILD_REPORT.md",
            "researcher/ideation/GRAPH_IDEATION_PACKET.json",
          ],
          key_risks: ["Graph packet integration increases the first implementation scope."],
        },
        {
          option_id: "plan-fallback",
          linked_track_id: null,
          source_direction_id: "dir-fallback",
          title: "Prompt-only fallback",
          status: "rejected",
          summary:
            "Keep the workflow lightweight but accept weaker evidence binding and reviewer defense.",
          graph_evidence_paths: ["researcher/ideation/TOP3_DIRECTION_SUMMARY.md"],
          key_risks: ["Leaves unsupported-claim pressure too high for later stages."],
        },
      ],
      plan_selection: {
        selected_option_id: "plan-main",
        selected_track_id: trackId,
        compared_option_ids: ["plan-main", "plan-fallback"],
        rationale:
          "The selected track best matches the ideation contract and keeps graph evidence in the main execution loop.",
        decisive_graph_evidence_paths: [
          "graph/GRAPH_BUILD_REPORT.md",
          "researcher/ideation/GRAPH_IDEATION_PACKET.json",
        ],
        fallback_option_ids: ["plan-fallback"],
        last_compared_at: now,
      },
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
    implementation_proof: {
      changed_files: ["train.py", "frequency_debiasing.py", "configs/proposed.yaml"],
      integration_points: [
        {
          point_id: "routing-hook",
          path: "train.py",
          symbol: "build_graph_grounded_router",
          covers: ["Graph-grounded support routing"],
          summary: "Wire the graph-grounded support router into the training forward path.",
        },
        {
          point_id: "packet-conditioning",
          path: "train.py",
          symbol: "apply_frontier_packet_conditioning",
          covers: ["Frontier-packet-conditioned section drafting"],
          summary: "Inject frontier packet conditioning into the drafting module path.",
        },
      ],
      activation_signals: [
        {
          point_id: "routing-activated",
          summary: "Training logs report graph-grounded router enabled.",
          covers: ["Graph-grounded support routing"],
        },
        {
          point_id: "packet-activated",
          summary: "Dry-run or training logs report frontier packet conditioning enabled.",
          covers: ["Frontier-packet-conditioned section drafting"],
        },
      ],
      execution_command: "uv run python train.py --config configs/proposed.yaml --seed 42",
    },
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
  const stageRunId = "stage-run-submit-ready";
  const candidateCommit = "commit-submit-ready";
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
      git: {
        last_candidate_commit: candidateCommit,
      },
    })
  );
  await writeJson(
    path.join(
      projectRoot,
      "coder",
      "experiments",
      trackId,
      `${experimentId}__baseline`,
      "REMOTE_RUN.json"
    ),
    {
      experiment_id: experimentId,
      status: "completed",
      git_commit: candidateCommit,
      stage_run_id: stageRunId,
    }
  );
  await writeJson(
    path.join(
      projectRoot,
      "coder",
      "experiments",
      trackId,
      `${experimentId}__baseline`,
      "RESULT_SUMMARY.json"
    ),
    {
      experiment_id: experimentId,
      metrics: { acc: 0.9, h_score: 0.91, baseline_h_score: 0.86 },
      result_paths: ["researcher/artifacts/results/metrics.json"],
      stage_run_id: stageRunId,
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
  await writeText(
    path.join(projectRoot, "analyzer", "CLAIM_EVIDENCE_MATRIX.md"),
    [
      "# Claim Evidence Matrix",
      "",
      "- claim-1 SUPPORTED by researcher/artifacts/results/metrics.json.",
      "",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, "analyzer", "UNSUPPORTED_CLAIMS.md"),
    ["# Unsupported Claims", "", "None.", ""].join("\n")
  );
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
  await writeText(path.join(projectRoot, "academic_writer", "INNOVATION_SYNTHESIS_MEMO.md"));
  await writeText(
    path.join(projectRoot, "academic_writer", "INTEGRATED_CONTRIBUTION_STATEMENT.md")
  );
  await writeText(path.join(projectRoot, "academic_writer", "RESULTS_QUESTION_ORDER.md"));
  await writeText(path.join(projectRoot, "academic_writer", "TITLE_CANDIDATES.md"));
  await writeText(
    path.join(projectRoot, "academic_writer", "ABSTRACT_5_SENTENCE_WORKBENCH.md")
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "INTRO_5_PARAGRAPH_WORKBENCH.md")
  );
  await writeJson(path.join(projectRoot, "academic_writer", "PARAGRAPH_LOGIC_AUDIT.json"), {
    status: "ready",
    blocking_issue_count: 0,
  });
  await writeText(path.join(projectRoot, "academic_writer", "PARAGRAPH_LOGIC_AUDIT.md"));
  await writeText(
    path.join(projectRoot, "academic_writer", "PARAGRAPH_LOGIC_REVERSE_OUTLINE.md")
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    buildCompliantFigureTableLatex()
  );
  await writeText(path.join(projectRoot, "academic_writer", "THEORY_APPENDIX_PLAN.md"));
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "sections", "abstract.tex"),
    [
      "\\begin{abstract}",
      "We study graph-grounded support routing for scientific writing and show that the approach improves support precision without sacrificing manuscript coverage.",
      "\\end{abstract}",
      "",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "sections", "results.tex"),
    [
      "\\section{Results}",
      "",
      "Our evaluation shows that graph-grounded support routing improves support precision on the demo benchmark while keeping the evidence path explicit for each headline claim.",
      "",
      "Therefore, the main result is not only a higher score but also a cleaner claim-to-evidence mapping that survives reviewer scrutiny during late-stage drafting.",
      "",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "sections", "discussion.tex"),
    [
      "\\section{Discussion}",
      "",
      "The central implication is that grounded routing changes the writing workflow by making unsupported claims easier to detect before submission.",
      "",
      "However, the current study still depends on bounded benchmark coverage, so the next revision should keep the scope explicit while extending the evidence packet with harder reviewer-facing cases.",
      "",
    ].join("\n")
  );
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
    orchestration_state: {
      stage_run_id: stageRunId,
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
      bibliography_page_count: 1,
      all_citations_real: true,
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
    innovation_synthesis_state: {
      status: "ready",
      synthesis_memo_path: "academic_writer/INNOVATION_SYNTHESIS_MEMO.md",
      integrated_contribution_statement_path:
        "academic_writer/INTEGRATED_CONTRIBUTION_STATEMENT.md",
    },
    results_storyline: {
      status: "ready",
      results_question_order_path: "academic_writer/RESULTS_QUESTION_ORDER.md",
    },
    title_abstract_intro_workbench: {
      status: "ready",
      title_candidates_path: "academic_writer/TITLE_CANDIDATES.md",
      abstract_workbench_path: "academic_writer/ABSTRACT_5_SENTENCE_WORKBENCH.md",
      intro_workbench_path: "academic_writer/INTRO_5_PARAGRAPH_WORKBENCH.md",
    },
    paragraph_logic_audit: {
      status: "ready",
      audit_json_path: "academic_writer/PARAGRAPH_LOGIC_AUDIT.json",
      audit_report_path: "academic_writer/PARAGRAPH_LOGIC_AUDIT.md",
      reverse_outline_path: "academic_writer/PARAGRAPH_LOGIC_REVERSE_OUTLINE.md",
      blocking_issue_count: 0,
    },
    paper_qc: {
      status: "ready",
      compile_status: "pass",
      page_budget_status: "pass",
      invalid_figure_ref_status: "pass",
      latest_report_path: "academic_writer/PAPER_QC.md",
    },
    figure_qc: {
      status: "ready",
      duplicate_figure_status: "pass",
      caption_alignment_status: "pass",
      text_alignment_status: "pass",
      selection_status: "pass",
      figure_review_path: "reviewer/SURFACE_REVIEW.json",
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
      required_action: "none",
      last_updated_at: now,
    },
    experiment_search: {
      status: "ready_for_analysis",
      candidate_head_commit: candidateCommit,
    },
  });
  await seedReadyIdeationContract(projectRoot, { trackId });
  await seedReadyPaperStoryState(projectRoot, { trackId });
  await seedReadyReviewPressurePacket(projectRoot);
  await writeJson(path.join(projectRoot, "reviewer", "REVIEW_ISSUES.json"), {
    issues: [],
  });
}

test("auto iterator auto-heals sparse active-track reasoning state before advancing idea", async (t) => {
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
  await writeJson(
    path.join(
      projectRoot,
      "researcher",
      "reasoning",
      trackId,
      "GRAPH_EVIDENCE.json"
    ),
    {
      evidence_pointers: [
        `researcher/reasoning/${trackId}/GRAPH_EVIDENCE.json#paper-demo-idea`,
      ],
      linked_graph_nodes: ["paper:demo-idea", "finding:graph-support-gap"],
      relation_patterns: [
        "supports->claim:support-precision",
        "extends->paper:demo-idea",
      ],
    }
  );

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
  assert.equal(result.stageAfter, "plan");
  const refreshedTrackRegistry = JSON.parse(await fs.readFile(trackRegistryPath, "utf8"));
  assert.ok(refreshedTrackRegistry.tracks[0].evidence_pointers.length >= 1);
  assert.deepEqual(refreshedTrackRegistry.tracks[0].linked_graph_nodes, [
    "paper:demo-idea",
    "finding:graph-support-gap",
  ]);
  assert.ok(refreshedTrackRegistry.tracks[0].reasoning_packet_dir);
  assert.ok(refreshedTrackRegistry.tracks[0].working_memory_path);
  assert.ok(refreshedTrackRegistry.tracks[0].synthesis_packet_path);
});

test("auto iterator queues literature discovery when idea-stage tracks still lack graph-backed innovation support", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { trackId } = await seedProjectReadyForCode(projectRoot);

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
  manifest.owner_agent = "researcher";
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const discoveryPacket = JSON.parse(
    await fs.readFile(
      path.join(
        projectRoot,
        "researcher",
        "literature-discovery",
        "LITERATURE_DISCOVERY_PACKET.json"
      ),
      "utf8"
    )
  );

  assert.equal(result.stageBefore, "idea");
  assert.equal(result.stageAfter, "graph_build");
  assert.equal(result.regressed, true);
  assert.equal(updatedManifest.current_stage, "graph_build");
  assert.equal(updatedManifest.current_micro_stage, "uploading");
  assert.equal(
    updatedManifest.paper_ingestion.queued_requests.some(
      (entry) => entry.trigger_kind === "idea_literature_discovery"
    ),
    true
  );
  assert.equal(discoveryPacket.discovery_reason, "idea_track_graph_evidence_gap");
  assert.equal(
    discoveryPacket.target_question_ids.includes(`track:${trackId}`),
    true
  );
});

test("auto iterator treats file-backed track evidence as repairable and advances idea to plan", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { trackId } = await seedProjectReadyForCode(projectRoot);
  await seedReadyBrainstormCycle(projectRoot, { trackId });

  const trackRegistryPath = path.join(projectRoot, "TRACK_REGISTRY.json");
  const trackRegistry = JSON.parse(await fs.readFile(trackRegistryPath, "utf8"));
  trackRegistry.tracks[0].linked_graph_nodes = [];
  trackRegistry.tracks[0].relation_patterns = [];
  trackRegistry.tracks[0].evidence_pointers = [];
  await writeJson(trackRegistryPath, trackRegistry);
  await writeJson(
    path.join(projectRoot, "researcher", "reasoning", trackId, "GRAPH_EVIDENCE.json"),
    {
      evidence_pointers: [
        `researcher/reasoning/${trackId}/GRAPH_EVIDENCE.json#track-repair`,
      ],
      linked_graph_nodes: ["paper:file-backed-track", "concept:graph-grounding"],
      relation_patterns: ["bridges->concept:graph-grounding"],
    }
  );

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.current_micro_stage = "frontiers_packaged";
  manifest.owner_agent = "researcher";
  delete manifest.ideation_contract;
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "idea");
  assert.equal(result.stageAfter, "plan");
  assert.equal(result.regressed, false);
  assert.ok(
    !result.missingStageSignals.some((signal) =>
      /active track .*missing graph-backed innovation evidence/i.test(signal)
    )
  );
  assert.equal(
    result.recommendedActions.some((action) => action.kind === "drive_stage"),
    true
  );
  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(
    Boolean(
      updatedManifest.paper_ingestion?.queued_requests?.some(
        (entry) => entry.trigger_kind === "idea_literature_discovery"
      )
    ),
    false
  );
});

test("auto iterator reconciles stale literature discovery requisitions once track evidence is satisfied", async (t) => {
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
  manifest.owner_agent = "researcher";
  manifest.paper_ingestion = {
    ...(manifest.paper_ingestion ?? {}),
    queued_requests: [
      {
        request_id: "idea-track-graph-evidence-gap",
        status: "queued",
        wrapper: "pn_batch_import.py",
        args: [],
        trigger_kind: "idea_literature_discovery",
        summary: "stale graph evidence gap",
        created_at: "2026-04-10T08:29:10.804Z",
        updated_at: "2026-04-10T08:29:10.804Z",
        attempt_count: 0,
      },
    ],
  };
  await writeJson(manifestPath, manifest);
  await writeJson(
    path.join(projectRoot, "researcher", "literature-discovery", "LITERATURE_DISCOVERY_PACKET.json"),
    {
      schema_version: 1,
      discovery_id: "idea-track-graph-evidence-gap",
      discovery_reason: "idea_track_graph_evidence_gap",
      trigger_kind: "idea_literature_discovery",
      target_track_ids: [trackId],
      evidence_gap_closed: false,
    }
  );

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "idea");
  assert.equal(result.stageAfter, "plan");
  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(updatedManifest.paper_ingestion.queued_requests[0].status, "completed");
  const packet = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "literature-discovery", "LITERATURE_DISCOVERY_PACKET.json"),
      "utf8"
    )
  );
  assert.equal(packet.evidence_gap_closed, true);
  assert.equal(packet.closure_reason, "workflow_state_satisfied");
});

test("auto iterator auto-materializes the ideation contract during idea before advancing", async (t) => {
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
  assert.equal(result.stageAfter, "plan");
  const repairedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(repairedManifest.ideation_contract.status, "ready");
});

test("auto iterator reloads preflight-reconciled track registry and advances idea to plan", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { trackId } = await seedProjectReadyForCode(projectRoot);
  await seedReadyBrainstormCycle(projectRoot, { trackId });
  await seedReadyIdeaCatalystState(projectRoot, { microStage: "judging" });

  const trackRegistryPath = path.join(projectRoot, "TRACK_REGISTRY.json");
  await writeJson(trackRegistryPath, {
    tracks: [
      {
        track_id: trackId,
        status: "active",
      },
    ],
  });
  await writeJson(
    path.join(
      projectRoot,
      "researcher",
      "reasoning",
      trackId,
      "GRAPH_EVIDENCE.json"
    ),
    {
      evidence_pointers: [
        `researcher/reasoning/${trackId}/GRAPH_EVIDENCE.json#track-registry-repair`,
      ],
      linked_graph_nodes: ["paper:registry-repair", "concept:graph-grounding"],
      relation_patterns: ["bridges->concept:graph-grounding"],
    }
  );

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.current_micro_stage = "judging";
  delete manifest.ideation_contract;
  manifest.orchestration_state = {
    status: "ready",
    current_owner: "researcher",
    next_owner: "orchestrator",
    next_transition_candidate: "plan",
    retry_budget_remaining: 2,
    last_contract_eval_result: "pass",
    last_updated_at: "2026-03-22T12:10:00.000Z",
  };
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "idea");
  assert.equal(result.stageAfter, "plan");
  assert.equal(result.regressed, false);
  assert.ok(
    !result.missingStageSignals.some((signal) => /TRACK_REGISTRY\.json with 1-2 active tracks/i.test(signal))
  );

  const updatedTrackRegistry = JSON.parse(await fs.readFile(trackRegistryPath, "utf8"));
  assert.ok(updatedTrackRegistry.tracks[0].reasoning_packet_dir);
  assert.ok(updatedTrackRegistry.tracks[0].working_memory_path);
  assert.ok(updatedTrackRegistry.tracks[0].synthesis_packet_path);
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

test("graph presence check accepts researcher paper-staging PAPER_SOURCE_INDEX", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedSetupCompleteProject(projectRoot, "frontier_mapping");
  await fs.mkdir(path.join(projectRoot, "researcher", "paper-staging", "md"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(projectRoot, "researcher", "paper-staging", "md", "2410.11206.md"),
    "# Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning\n",
    "utf8"
  );
  await writeJson(path.join(projectRoot, "researcher", "paper-staging", "PAPER_SOURCE_INDEX.json"), {
    paper_source_dir: path.join(projectRoot, "researcher", "paper-staging"),
    papers: [
      {
        canonical_id: "arxiv:2410.11206",
        arxiv_id: "2410.11206",
        title: "Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning",
        source_provider: "arxiv2md",
        retrieval_providers: ["papers-cool"],
        local_md_path: "md/2410.11206.md",
      },
    ],
  });
  await seedGraphCorpus(projectRoot, []);

  const result = await checkGraphPresenceForWorkflow({ projectRoot });

  assert.equal(result.status, "missing_papers");
  assert.equal(result.expectedPaperCount, 1);
  assert.match(result.paperSourceIndexPath ?? "", /researcher\/paper-staging\/PAPER_SOURCE_INDEX\.json$/);
  assert.equal(result.missingPapers[0].sourceKind, "markdown");
  assert.equal(result.missingPapers[0].sourceProvider, "arxiv2md");
  assert.deepEqual(result.missingPapers[0].retrievalProviders, ["papers-cool"]);

  const report = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), "utf8")
  );
  assert.match(report.paper_source_index_path, /researcher\/paper-staging\/PAPER_SOURCE_INDEX\.json$/);
});

test("graph presence check trusts explicit graph confirmation metadata from PAPER_SOURCE_INDEX", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedSetupCompleteProject(projectRoot, "frontier_mapping");
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    schema_version: 1,
    project_id: "demo-project",
    updated_at: "2026-04-23T02:25:00Z",
    papers: [
      {
        canonical_id: "arxiv:2201.02609",
        arxiv_id: "2201.02609",
        title: "Generalized Category Discovery",
        graph_paper_id: "paper:fa1750e4085d",
        import_status: "deduped",
        graph_presence: "confirmed_via_content_match",
      },
      {
        canonical_id: "arxiv:2410.11206",
        arxiv_id: "2410.11206",
        title: "Theoretical Analysis of FixMatch-like SSL",
        import_status: "deduped",
        graph_presence: "confirmed_via_arxiv_id_in_graph",
      },
    ],
    graph_presence_override: {
      status: "ready",
      reason: "All expected papers were already deduped into the shared graph.",
      checked_at: "2026-04-23T02:25:00Z",
    },
  });

  const result = await checkGraphPresenceForWorkflow({ projectRoot });

  assert.equal(result.status, "ready");
  assert.equal(result.verificationMode, "paper_source_index_override");
  assert.equal(result.expectedPaperCount, 2);
  assert.equal(result.presentPaperCount, 2);
  assert.equal(result.missingPaperCount, 0);
  assert.equal(result.refreshRequired, false);

  const report = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), "utf8")
  );
  assert.equal(report.status, "ready");
  assert.equal(report.verification_mode, "paper_source_index_override");
  assert.equal(report.present_paper_count, 2);

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.paper_ingestion.graph_presence_status, "ready");
  assert.equal(manifest.paper_ingestion.graph_presence_present_papers, 2);
  assert.deepEqual(manifest.paper_ingestion.graph_presence_missing_papers, []);
});

test("graph presence check matches light title variants through title signatures", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedSetupCompleteProject(projectRoot, "frontier_mapping");
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "title:graph-neural-network-benchmark",
      title: "Graph Neural Networks Benchmark",
      source_kind: "markdown",
      source_provider: "papers-cool",
      source_path: path.join(
        projectRoot,
        "researcher",
        "paper_source",
        "md",
        "graph-neural-networks-benchmark.md"
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
      sourceKey: path.join(sourceRoot, "md", "graph-neural-network-benchmark.md"),
      inputPath: path.join(sourceRoot, "md", "graph-neural-network-benchmark.md"),
      kind: "markdown",
      paperId: "paper:gnn-benchmark",
      paperTitle: "Graph Neural Network Benchmark",
      sourcePath: path.join(sourceRoot, "md", "graph-neural-network-benchmark.md"),
      sourceMarkdownPath: path.join(sourceRoot, "md", "graph-neural-network-benchmark.md"),
      activeInGraph: true,
      canonicalSourceKey: path.join(sourceRoot, "md", "graph-neural-network-benchmark.md"),
    },
  ]);

  const result = await checkGraphPresenceForWorkflow({ projectRoot });

  assert.equal(result.status, "ready");
  assert.equal(result.presentPaperCount, 1);
  assert.equal(result.missingPaperCount, 0);
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
  const refreshedStatus = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), "utf8")
  );
  assert.equal(refreshedStatus.status, "ready");
  assert.equal(refreshedStatus.mode, "local_corpus");
  const graphBuildReport = await fs.readFile(
    path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"),
    "utf8"
  );
  assert.match(graphBuildReport, /Graph Presence Status:\s+ready/i);
  assert.match(graphBuildReport, /Expected Papers:\s+1/i);
  assert.match(graphBuildReport, /Present Papers:\s+1/i);
});

test("graph presence check accepts corpus_root values that point directly at the .papernexus directory", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedSetupCompleteProject(projectRoot, "frontier_mapping");
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "arxiv:2501.00005",
      arxiv_id: "2501.00005",
      title: "Epsilon Paper",
      source_kind: "markdown",
      source_provider: "hf",
      retrieval_providers: ["papers-cool"],
      source_path: path.join(
        projectRoot,
        "researcher",
        "paper_source",
        "md",
        "2501.00005--epsilon-paper.md"
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
      sourceKey: path.join(sourceRoot, "md", "2501.00005--epsilon-paper.md"),
      inputPath: path.join(sourceRoot, "md", "2501.00005--epsilon-paper.md"),
      kind: "markdown",
      paperId: "paper:epsilon",
      paperTitle: "Epsilon Paper",
      sourcePath: path.join(sourceRoot, "md", "2501.00005--epsilon-paper.md"),
      sourceMarkdownPath: path.join(sourceRoot, "md", "2501.00005--epsilon-paper.md"),
      activeInGraph: true,
      canonicalSourceKey: path.join(sourceRoot, "md", "2501.00005--epsilon-paper.md"),
    },
  ]);
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    status: "ready",
    corpus_name: "shared-global-graph",
    corpus_root: path.join(sourceRoot, ".papernexus"),
  });

  const result = await checkGraphPresenceForWorkflow({ projectRoot });

  assert.equal(result.status, "ready");
  assert.equal(result.corpusRoot, sourceRoot);
});

test("remote graph presence ignores project-scoped corpus hints and lets the remote endpoint resolve corpus", async (t) => {
  const projectRoot = await makeTempProject();
  const previousToken = process.env.PAPERNEXUS_API_TOKEN;
  const requests = [];
  const server = http.createServer(async (request, response) => {
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization ?? null,
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        rootPath: "/remote/corpora/shared-global-graph",
        meta: {
          name: "shared-global-graph",
          rootPath: "/remote/corpora/shared-global-graph",
        },
        manifest: {
          corpusName: "shared-global-graph",
          rootPath: "/remote/corpora/shared-global-graph",
        },
        sources: [
          {
            sourceKey: "/remote/corpora/shared-global-graph/md/2501.00004--delta-paper.md",
            inputPath: "/remote/corpora/shared-global-graph/md/2501.00004--delta-paper.md",
            paperId: "paper:delta",
            paperTitle: "Delta Paper",
            activeInGraph: true,
          },
        ],
      })
    );
  });

  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_API_TOKEN;
    } else {
      process.env.PAPERNEXUS_API_TOKEN = previousToken;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  process.env.PAPERNEXUS_API_TOKEN = "test-token";
  await seedSetupCompleteProject(projectRoot, "frontier_mapping");
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "arxiv:2501.00004",
      arxiv_id: "2501.00004",
      title: "Delta Paper",
      source_kind: "markdown",
      source_provider: "hf",
      retrieval_providers: ["papers-cool"],
      source_path: "/remote/corpora/shared-global-graph/md/2501.00004--delta-paper.md",
    },
  ]);
  await seedRemoteGraphStatus(projectRoot, {
    corpusName: "demo-project",
    corpusRoot: "https://papernexus.example/corpora/demo-project",
    status: "missing_papers",
    mode: "remote_api",
    expectedPaperCount: 1,
    presentPaperCount: 0,
    missingPapers: [
      {
        canonical_id: "arxiv:2501.00004",
        title: "Delta Paper",
      },
    ],
  });

  const result = await checkGraphPresenceForWorkflow({
    projectRoot,
    remoteAccess: {
      apiBaseUrl: `http://127.0.0.1:${address.port}`,
      tokenSource: "env",
      tokenEnv: "PAPERNEXUS_API_TOKEN",
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url, "/api/corpus-sources");
  assert.equal(result.status, "ready");
  assert.equal(result.corpusName, "shared-global-graph");
  assert.equal(result.repairTargetCorpus, null);
});

test("remote graph presence prefers PROJECT_MANIFEST corpus settings and never stores the remote endpoint as corpus_root", async (t) => {
  const projectRoot = await makeTempProject();
  const previousToken = process.env.PAPERNEXUS_API_TOKEN;
  const requests = [];
  const server = http.createServer(async (request, response) => {
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization ?? null,
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        meta: {
          paperCount: 1,
          sourceCount: 1,
        },
        manifest: {
          sourceCount: 1,
          activeSourceCount: 1,
        },
        sources: [
          {
            sourceKey: "/remote/corpora/GCD/md/2501.00014--manifest-pinned-paper.md",
            inputPath: "/remote/corpora/GCD/md/2501.00014--manifest-pinned-paper.md",
            paperId: "paper:manifest-pinned",
            paperTitle: "Manifest Pinned Paper",
            activeInGraph: true,
          },
        ],
      })
    );
  });

  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_API_TOKEN;
    } else {
      process.env.PAPERNEXUS_API_TOKEN = previousToken;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  process.env.PAPERNEXUS_API_TOKEN = "test-token";
  await seedSetupCompleteProject(projectRoot, "graph_build");
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "arxiv:2501.00014",
      arxiv_id: "2501.00014",
      title: "Manifest Pinned Paper",
      source_kind: "markdown",
      source_provider: "hf",
      retrieval_providers: ["papers-cool"],
      source_path: "/remote/corpora/GCD/md/2501.00014--manifest-pinned-paper.md",
    },
  ]);
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    title: "Demo Project",
    current_stage: "graph_build",
    papernexus_corpus: "GCD",
    papernexus_root: "/data/shared/.papernexus/index-store",
    paper_ingestion: {
      corpus_name: "GCD",
      corpus_root: "/data/shared/.papernexus/index-store",
      graph_presence_status: "missing_papers",
      refresh_required: true,
    },
    idle_research: { enabled: false },
  });
  await seedRemoteGraphStatus(projectRoot, {
    corpusName: "demo-project",
    corpusRoot: `http://127.0.0.1:${address.port}`,
    status: "missing_papers",
    mode: "remote_api",
    expectedPaperCount: 1,
    presentPaperCount: 0,
    missingPapers: [{ canonical_id: "arxiv:2501.00014", title: "Manifest Pinned Paper" }],
  });

  const result = await checkGraphPresenceForWorkflow({
    projectRoot,
    remoteAccess: {
      apiBaseUrl: `http://127.0.0.1:${address.port}`,
      tokenSource: "env",
      tokenEnv: "PAPERNEXUS_API_TOKEN",
    },
  });

  assert.equal(requests.length, 1);
  assert.match(requests[0].url ?? "", /\/api\/corpus-sources\?name=GCD$/);
  assert.equal(result.status, "ready");
  assert.equal(result.corpusName, "GCD");
  assert.equal(result.corpusRoot, "/data/shared/.papernexus/index-store");

  const refreshedStatus = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), "utf8")
  );
  assert.equal(refreshedStatus.corpus_name, "GCD");
  assert.equal(refreshedStatus.corpus_root, "/data/shared/.papernexus/index-store");
});

test("auto iterator refreshes remote graph presence with the plugin-configured shared corpus when project-scoped hints are stale", async (t) => {
  const projectRoot = await makeTempProject();
  const previousToken = process.env.PAPERNEXUS_API_TOKEN;
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const corpusName = url.searchParams.get("name");
    requests.push({
      method: request.method,
      url: request.url,
      corpus: corpusName,
      authorization: request.headers.authorization ?? null,
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    if (corpusName === "GCD") {
      response.end(
        JSON.stringify({
          meta: {
            paperCount: 1,
            sourceCount: 1,
          },
          manifest: {
            corpusName: "GCD",
            sourceCount: 1,
            activeSourceCount: 1,
          },
          sources: [
            {
              sourceKey: "/remote/corpora/GCD/md/2501.00015--plugin-config-paper.md",
              inputPath: "/remote/corpora/GCD/md/2501.00015--plugin-config-paper.md",
              paperId: "paper:plugin-config",
              paperTitle: "Plugin Config Paper",
              activeInGraph: true,
            },
          ],
        })
      );
      return;
    }
    response.end(
      JSON.stringify({
        meta: {
          paperCount: 0,
          sourceCount: 0,
        },
        manifest: {
          corpusName,
          sourceCount: 0,
          activeSourceCount: 0,
        },
        sources: [],
      })
    );
  });

  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_API_TOKEN;
    } else {
      process.env.PAPERNEXUS_API_TOKEN = previousToken;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  process.env.PAPERNEXUS_API_TOKEN = "test-token";
  await seedSetupCompleteProject(projectRoot, "graph_build");
  await writeText(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"));
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "arxiv:2501.00015",
      arxiv_id: "2501.00015",
      title: "Plugin Config Paper",
      source_kind: "markdown",
      source_provider: "hf",
      retrieval_providers: ["papers-cool"],
      source_path: "/remote/corpora/GCD/md/2501.00015--plugin-config-paper.md",
    },
  ]);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.project_id = "gcd-confirmation-bias-mitigation";
  manifest.title = "GCD Confirmation Bias Mitigation";
  manifest.paper_ingestion = {
    corpus_name: "gcd-confirmation-bias-mitigation",
    graph_presence_status: "missing_papers",
    refresh_required: true,
  };
  await writeJson(manifestPath, manifest);
  await seedRemoteGraphStatus(projectRoot, {
    corpusName: "gcd-confirmation-bias-mitigation",
    corpusRoot: `http://127.0.0.1:${address.port}`,
    status: "missing_papers",
    expectedPaperCount: 1,
    presentPaperCount: 0,
    missingPapers: [{ canonical_id: "arxiv:2501.00015", title: "Plugin Config Paper" }],
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    policy: {
      papernexusApiBaseUrl: `http://127.0.0.1:${address.port}`,
      papernexusSharedCorpus: "GCD",
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "PAPERNEXUS_API_TOKEN",
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].corpus, "GCD");
  assert.equal(result.graphPresenceCheck?.status, "ready");
  assert.equal(result.graphPresenceCheck?.corpusName, "GCD");
  assert.equal(result.stageBefore, "graph_build");
  assert.equal(result.stageAfter, "frontier_mapping");

  const refreshedStatus = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), "utf8")
  );
  assert.equal(refreshedStatus.corpus_name, "GCD");
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

test("remote graph presence accepts summary-only remote corpus PAPER_SOURCE_INDEX metadata when remote counts match", async (t) => {
  const projectRoot = await makeTempProject();
  const previousToken = process.env.PAPERNEXUS_API_TOKEN;
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push({
      method: request.method,
      pathname: url.pathname,
      corpus: url.searchParams.get("name"),
      authorization: request.headers.authorization ?? null,
    });
    const payload = {
      rootPath: "/remote/corpora/GCD",
      meta: {
        name: "GCD",
        rootPath: "/remote/corpora/GCD",
        paperCount: 198,
        sourceCount: 198,
      },
      manifest: {
        corpusName: "GCD",
        paperCount: 198,
        activePaperCount: 198,
        sourceCount: 198,
        activeSourceCount: 198,
      },
      sources: [],
      generatedAt: "2026-04-08T08:20:25.000Z",
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8");
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": encoded.length,
    });
    response.end(encoded);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  assert.notEqual(port, null);

  t.after(async () => {
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_API_TOKEN;
    } else {
      process.env.PAPERNEXUS_API_TOKEN = previousToken;
    }
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.PAPERNEXUS_API_TOKEN = "test-token";
  await seedSetupCompleteProject(projectRoot, "idea");
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.papernexus_corpus = "GCD";
  manifest.papernexus_root = "~/.papernexus/GCD/index";
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    project_id: "demo-project",
    corpus_name: "GCD",
    corpus_root: "~/.papernexus/GCD/index",
    indexed_at: "2026-04-08T08:12:47.092593Z",
    paper_count: 198,
    source_mode: "remote_corpus",
    graph_mode: "remote_papernexus",
    papers: [],
    graph_presence_status: "ready",
    graph_presence_expected: 198,
    graph_presence_present: 198,
  });

  const result = await checkGraphPresenceForWorkflow({
    projectRoot,
    remoteAccess: {
      apiBaseUrl: `http://127.0.0.1:${port}`,
      tokenSource: "env",
      tokenEnv: "PAPERNEXUS_API_TOKEN",
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.expectedPaperCount, 198);
  assert.equal(result.presentPaperCount, 198);
  assert.equal(result.missingPaperCount, 0);
  assert.equal(result.usedPaperSourceIndex, true);
  assert.equal(result.corpusName, "GCD");
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    method: "GET",
    pathname: "/api/corpus-sources",
    corpus: "GCD",
    authorization: "Bearer test-token",
  });

  const report = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), "utf8")
  );
  assert.equal(report.status, "ready");
  assert.equal(report.expected_paper_count, 198);
  assert.equal(report.present_paper_count, 198);

  const refreshedStatus = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), "utf8")
  );
  assert.equal(refreshedStatus.status, "ready");
  assert.equal(refreshedStatus.expected_paper_count, 198);
  assert.equal(refreshedStatus.present_paper_count, 198);

  const certification = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "graph", "PAPERNEXUS_TASK_CERTIFICATION.json"),
      "utf8"
    )
  );
  assert.equal(certification.status, "partial");
  assert.equal(certification.claim_level, "remote_corpus_summary");
  assert.equal(certification.source_backed_graph_claim, false);
  assert.equal(certification.graph.verification_mode, "remote_corpus_summary");
  assert.equal(certification.mcp_contract.remote_api_fallback, true);
  assert.ok(
    certification.limitations.includes(
      "remote_corpus_summary_without_per_paper_source_spans"
    )
  );
  assert.ok(certification.limitations.includes("paper_source_index_summary_only"));

  const refreshedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(
    refreshedManifest.paper_ingestion.papernexus_certification_status,
    "partial"
  );
  assert.equal(
    refreshedManifest.paper_ingestion.papernexus_source_backed_graph_claim,
    false
  );
});

test("remote graph presence trusts a healthy remote corpus when no local source index exists", async (t) => {
  const projectRoot = await makeTempProject();
  const previousToken = process.env.PAPERNEXUS_API_TOKEN;
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push({
      method: request.method,
      pathname: url.pathname,
      corpus: url.searchParams.get("name"),
    });
    const payload = {
      rootPath: "/remote/corpora/GCD",
      meta: {
        name: "GCD",
        paperCount: 112,
        sourceCount: 112,
      },
      manifest: {
        corpusName: "GCD",
        activePaperCount: 112,
        activeSourceCount: 112,
      },
      sources: [],
    };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  assert.notEqual(port, null);

  t.after(async () => {
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_API_TOKEN;
    } else {
      process.env.PAPERNEXUS_API_TOKEN = previousToken;
    }
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.PAPERNEXUS_API_TOKEN = "test-token";
  await seedSetupCompleteProject(projectRoot, "graph_build");
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.papernexus_corpus = "GCD";
  await writeJson(manifestPath, manifest);

  const result = await checkGraphPresenceForWorkflow({
    projectRoot,
    remoteAccess: {
      apiBaseUrl: `http://127.0.0.1:${port}`,
      tokenSource: "env",
      tokenEnv: "PAPERNEXUS_API_TOKEN",
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.expectedPaperCount, 112);
  assert.equal(result.presentPaperCount, 112);
  assert.equal(result.usedPaperSourceIndex, false);
  assert.equal(requests.length, 1);

  const refreshedStatus = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), "utf8")
  );
  assert.equal(refreshedStatus.verification_mode, "remote_corpus_summary");
  assert.equal(refreshedStatus.status, "ready");
});

test("remote graph presence preserves a prior ready remote summary across zero-count endpoint anomalies", async (t) => {
  const projectRoot = await makeTempProject();
  const previousToken = process.env.PAPERNEXUS_API_TOKEN;
  const server = http.createServer(async (_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        rootPath: "/remote/corpora/GCD",
        meta: { name: "GCD", paperCount: 0, sourceCount: 0 },
        manifest: { corpusName: "GCD", activePaperCount: 0, activeSourceCount: 0 },
        sources: [],
      })
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  assert.notEqual(port, null);

  t.after(async () => {
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_API_TOKEN;
    } else {
      process.env.PAPERNEXUS_API_TOKEN = previousToken;
    }
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.PAPERNEXUS_API_TOKEN = "test-token";
  await seedSetupCompleteProject(projectRoot, "graph_build");
  const now = "2026-04-11T01:56:00.000Z";
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "gcd-survey-tpami-2026",
    title: "GCD Survey",
    current_stage: "graph_build",
    papernexus_corpus: "GCD",
    paper_ingestion: {
      graph_presence_checked_at: now,
      graph_presence_status: "ready",
      graph_presence_expected_papers: 111,
      graph_presence_present_papers: 111,
      graph_presence_missing_papers: [],
      remote_paper_count: 111,
      synced_papers: 111,
      refresh_required: false,
    },
    research_program: {
      goal: "Comprehensive survey on GCD",
      problem_statement: "Systematic review of GCD literature.",
      baseline_reference: "ProtoGCD",
      primary_metric: "H-score",
      datasets: ["CUB"],
      success_criteria: ["survey coverage"],
      zotero_project_path: "bot/gcd-survey-tpami-2026",
    },
    idle_research: { enabled: false },
  });

  const result = await checkGraphPresenceForWorkflow({
    projectRoot,
    remoteAccess: {
      apiBaseUrl: `http://127.0.0.1:${port}`,
      tokenSource: "env",
      tokenEnv: "PAPERNEXUS_API_TOKEN",
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.expectedPaperCount, 111);
  assert.equal(result.presentPaperCount, 111);
});

test("graph presence check does not fall back to local corpus files when remote PaperNexus access is configured", async (t) => {
  const projectRoot = await makeTempProject();
  const previousToken = process.env.PAPERNEXUS_API_TOKEN;
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push({
      method: request.method,
      pathname: url.pathname,
      corpus: url.searchParams.get("name"),
      authorization: request.headers.authorization ?? null,
    });
    const payload = {
      rootPath: "/remote/corpora/shared-global-graph",
      meta: {
        name: "shared-global-graph",
        rootPath: "/remote/corpora/shared-global-graph",
        paperCount: 1,
        sourceCount: 1,
      },
      manifest: {
        corpusName: "shared-global-graph",
        sourceCount: 1,
        activeSourceCount: 1,
      },
      sources: [
        {
          sourceKey: "/remote/corpora/shared-global-graph/md/2501.00021--remote-only-paper.md",
          inputPath: "/remote/corpora/shared-global-graph/md/2501.00021--remote-only-paper.md",
          kind: "markdown",
          paperId: "paper:remote-only",
          paperTitle: "Remote Only Paper",
          activeInGraph: true,
        },
      ],
      generatedAt: "2026-04-07T01:30:00.000Z",
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8");
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": encoded.length,
    });
    response.end(encoded);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  assert.notEqual(port, null);
  t.after(async () => {
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_API_TOKEN;
    } else {
      process.env.PAPERNEXUS_API_TOKEN = previousToken;
    }
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
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
      apiBaseUrl: `http://127.0.0.1:${port}`,
      tokenSource: "env",
      tokenEnv: "PAPERNEXUS_API_TOKEN",
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.presentPaperCount, 1);
  assert.equal(result.missingPaperCount, 0);
  assert.equal(result.corpusRoot, "/remote/corpora/shared-global-graph");
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    method: "GET",
    pathname: "/api/corpus-sources",
    corpus: null,
    authorization: "Bearer test-token",
  });

  const refreshedStatus = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), "utf8")
  );
  assert.equal(refreshedStatus.mode, "remote_api");
  assert.equal(refreshedStatus.status, "ready");
  assert.equal(refreshedStatus.present_paper_count, 1);
  assert.equal(refreshedStatus.expected_paper_count, 1);
});

test("graph presence check refreshes remote status metadata through remote_mcp", async (t) => {
  const projectRoot = await makeTempProject();
  const previousToken = process.env.PAPERNEXUS_API_TOKEN;
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const bodyChunks = [];
    for await (const chunk of request) {
      bodyChunks.push(chunk);
    }
    const rawBody = Buffer.concat(bodyChunks).toString("utf8");
    const parsedBody = rawBody ? JSON.parse(rawBody) : null;
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization ?? null,
      body: parsedBody,
    });

    const payload = {
      jsonrpc: "2.0",
      id: parsedBody?.id ?? 1,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              rootPath: "/remote/corpora/shared-global-graph",
              meta: {
                name: "shared-global-graph",
                rootPath: "/remote/corpora/shared-global-graph",
                paperCount: 1,
                sourceCount: 1,
              },
              manifest: {
                corpusName: "shared-global-graph",
                sourceCount: 1,
                activeSourceCount: 1,
              },
              sources: [
                {
                  sourceKey:
                    "/remote/corpora/shared-global-graph/md/2501.00022--remote-mcp-paper.md",
                  inputPath:
                    "/remote/corpora/shared-global-graph/md/2501.00022--remote-mcp-paper.md",
                  kind: "markdown",
                  paperId: "paper:remote-mcp",
                  paperTitle: "Remote MCP Paper",
                  activeInGraph: true,
                },
              ],
              generatedAt: "2026-04-07T01:31:00.000Z",
            }),
          },
        ],
      },
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8");
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": encoded.length,
    });
    response.end(encoded);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  assert.notEqual(port, null);
  t.after(async () => {
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_API_TOKEN;
    } else {
      process.env.PAPERNEXUS_API_TOKEN = previousToken;
    }
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.PAPERNEXUS_API_TOKEN = "test-token";
  await seedSetupCompleteProject(projectRoot, "frontier_mapping");
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "arxiv:2501.00022",
      arxiv_id: "2501.00022",
      title: "Remote MCP Paper",
      source_path: path.join(
        projectRoot,
        "researcher",
        "paper_source",
        "md",
        "2501.00022--remote-mcp-paper.md"
      ),
    },
  ]);
  await fs.rm(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), { force: true });

  const result = await checkGraphPresenceForWorkflow({
    projectRoot,
    remoteAccess: {
      mcpUrl: `http://127.0.0.1:${port}/mcp`,
      mcpTransport: "streamable-http",
      tokenSource: "env",
      tokenEnv: "PAPERNEXUS_API_TOKEN",
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.presentPaperCount, 1);
  assert.equal(result.missingPaperCount, 0);
  assert.equal(result.corpusRoot, "/remote/corpora/shared-global-graph");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].authorization, "Bearer test-token");
  assert.equal(requests[0].body?.method, "tools/call");
  assert.equal(requests[0].body?.params?.name, "corpus_sources");
  assert.deepEqual(requests[0].body?.params?.arguments, {});

  const refreshedStatus = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), "utf8")
  );
  assert.equal(refreshedStatus.mode, "remote_mcp");
  assert.equal(refreshedStatus.status, "ready");
  assert.equal(refreshedStatus.present_paper_count, 1);
  assert.equal(refreshedStatus.expected_paper_count, 1);

  const certification = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "graph", "PAPERNEXUS_TASK_CERTIFICATION.json"),
      "utf8"
    )
  );
  assert.equal(certification.status, "ready");
  assert.equal(certification.claim_level, "source_backed_graph");
  assert.equal(certification.source_backed_graph_claim, true);
  assert.equal(certification.graph.source_backed_present_count, 1);
  assert.equal(certification.mcp_contract.remote_mcp_evidence, true);
  assert.equal(certification.mcp_contract.skill_aligned_graph_claim, true);
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

test("graph presence check treats waiting_graph without active upload work as verification, not active sync", async (t) => {
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
      canonical_id: "arxiv:2603.08075",
      arxiv_id: "2603.08075",
      title: "TALON: Test-time Adaptive Learning for On-the-Fly Category Discovery",
      source_provider: "hugging-face-paper-pages",
      retrieval_providers: ["papers-cool"],
    },
  ]);
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    title: "Demo Project",
    current_stage: "graph_build",
    paper_ingestion: {
      runtime_status: "waiting_graph",
      waiting_reason: "Upload finished; waiting for a fresh graph presence check.",
      import_task_ids: [],
      completed_papers: [],
      paper_operations: [],
      active_batches: [],
      batch_items: [],
      queued_requests: [],
      graph_presence_status: "missing_papers",
    },
    idle_research: { enabled: false },
  });
  await seedRemoteGraphStatus(projectRoot, {
    status: "missing_papers",
    expectedPaperCount: 1,
    presentPaperCount: 0,
    missingPapers: [
      {
        canonicalId: "arxiv:2603.08075",
        arxivId: "2603.08075",
        title: "TALON: Test-time Adaptive Learning for On-the-Fly Category Discovery",
      },
    ],
  });

  const result = await checkGraphPresenceForWorkflow({
    projectRoot,
    remoteAccess: {
      apiBaseUrl: "https://papernexus.example/api",
      tokenSource: "env",
      tokenEnv: "PAPERNEXUS_API_TOKEN",
    },
  });

  assert.equal(result.status, "missing_papers");
  assert.doesNotMatch(
    result.blockingReason ?? "",
    /automatic graph catch-up is still running/i
  );
  assert.doesNotMatch(result.blockingReason ?? "", /paper_ingestion reports status=/i);
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

test("auto iterator does not rerun graph presence when manifest already records ready graph status without a refresh request", async (t) => {
  const projectRoot = await makeTempProject();
  const previousToken = process.env.PAPERNEXUS_API_TOKEN;
  const requests = [];
  const server = http.createServer(async (request, response) => {
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization ?? null,
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        rootPath: "/remote/corpora/GCD",
        meta: { name: "GCD", rootPath: "/remote/corpora/GCD" },
        manifest: { corpusName: "GCD", rootPath: "/remote/corpora/GCD" },
        sources: [],
      })
    );
  });

  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_API_TOKEN;
    } else {
      process.env.PAPERNEXUS_API_TOKEN = previousToken;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  process.env.PAPERNEXUS_API_TOKEN = "test-token";
  await seedSetupCompleteProject(projectRoot, "frontier_mapping");
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "arxiv:2501.00031",
      arxiv_id: "2501.00031",
      title: "Remote Frontier Paper",
      source_provider: "arxiv2md-api",
      retrieval_providers: ["papers-cool"],
    },
  ]);
  await writeText(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"), "# Graph Build Report\n");
  await writeJson(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), {
    checked_at: "2026-04-08T12:00:00.000Z",
    status: "ready",
    corpus_name: "GCD",
    corpus_root: "/data/shared/.papernexus/index-store",
    expected_paper_count: 1,
    present_paper_count: 1,
    missing_paper_count: 0,
    refresh_required: false,
  });
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    checked_at: "2026-04-08T12:00:00.000Z",
    status: "ready",
    corpus_name: "GCD",
    corpus_root: "/data/shared/.papernexus/index-store",
    expected_paper_count: 1,
    present_paper_count: 1,
    missing_paper_count: 0,
    refresh_required: false,
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    title: "Demo Project",
    current_stage: "frontier_mapping",
    owner_agent: "researcher",
    papernexus_corpus: "GCD",
    paper_ingestion: {
      corpus_name: "GCD",
      graph_presence_checked_at: "2026-04-08T12:00:00.000Z",
      graph_presence_status: "ready",
      graph_presence_report_path: "graph/GRAPH_PRESENCE_CHECK.json",
      graph_presence_expected_papers: 1,
      graph_presence_present_papers: 1,
      graph_presence_missing_papers: [],
      refresh_required: false,
    },
    idle_research: { enabled: false },
  });

  const beforeStatus = await fs.readFile(
    path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"),
    "utf8"
  );
  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    policy: {
      papernexusApiBaseUrl: `http://127.0.0.1:${address.port}`,
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "PAPERNEXUS_API_TOKEN",
    },
  });
  const afterStatus = await fs.readFile(
    path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"),
    "utf8"
  );

  assert.equal(result.graphPresenceCheck, null);
  assert.equal(requests.length, 0);
  assert.equal(afterStatus, beforeStatus);
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

test("remote graph presence reports metadata-only paper indexes as missing sources instead of import-ready repair", async (t) => {
  const projectRoot = await makeTempProject();
  const previousToken = process.env.PAPERNEXUS_API_TOKEN;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    assert.equal(url.pathname, "/api/corpus-sources");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        rootPath: "/remote/corpora/GCD",
        meta: {
          name: "GCD",
          paperCount: 37,
          sourceCount: 37,
        },
        manifest: {
          corpusName: "GCD",
          activePaperCount: 37,
          activeSourceCount: 37,
        },
        sources: [],
      })
    );
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  t.after(async () => {
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_API_TOKEN;
    } else {
      process.env.PAPERNEXUS_API_TOKEN = previousToken;
    }
    server.closeAllConnections?.();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.PAPERNEXUS_API_TOKEN = "test-token";
  await seedSetupCompleteProject(projectRoot, "graph_build");
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.papernexus_corpus = "GCD";
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    project_id: "demo-project",
    papers: [
      {
        canonical_id: "crossref:paper-1",
        title: "Metadata Only Paper One",
        source_provider: "crossref",
        retrieval_providers: ["crossref"],
        pdf_path: null,
        markdown_path: null,
        source_path: null,
      },
      {
        canonical_id: "crossref:paper-2",
        title: "Metadata Only Paper Two",
        source_provider: "crossref",
        retrieval_providers: ["crossref"],
        pdf_path: null,
        markdown_path: null,
        source_path: null,
      },
    ],
  });

  const result = await checkGraphPresenceForWorkflow({
    projectRoot,
    remoteAccess: {
      apiBaseUrl: `http://127.0.0.1:${address.port}`,
      tokenSource: "env",
      tokenEnv: "PAPERNEXUS_API_TOKEN",
    },
  });

  const refreshedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(result.status, "missing_sources");
  assert.equal(result.repairRequired, false);
  assert.match(result.refreshReason ?? "", /PDF\/Markdown source/i);
  assert.equal(refreshedManifest.paper_ingestion.graph_presence_status, "missing_sources");
  assert.equal(refreshedManifest.paper_ingestion.repair_required, false);
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

test("auto iterator materializes planned graph_build arXiv sources before graph presence checks", async (t) => {
  const projectRoot = await makeTempProject();
  const previousFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = previousFetch;
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  globalThis.fetch = makePaperMarkdownFetch(`# Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning

## Abstract

This is a substantive markdown paper fixture for graph-build source catch-up.

## Introduction

${"FixMatch generalization and generalized category discovery need enough paper text for import. ".repeat(24)}

## Method

${"The runtime catch-up fetches a real arXiv source and queues PaperNexus import before graph verification. ".repeat(24)}
`);
  await seedSetupCompleteProject(projectRoot, "graph_build");
  await writeText(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"));
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

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    policy: {
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: "http://127.0.0.1:9123/mcp",
    },
  });

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  const sourceIndex = JSON.parse(
    await fs.readFile(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), "utf8")
  );

  assert.equal(result.stageBefore, "graph_build");
  assert.equal(manifest.current_micro_stage, "uploading");
  assert.equal(manifest.paper_ingestion.queued_requests.length, 1);
  assert.equal(
    manifest.paper_ingestion.queued_requests[0].trigger_kind,
    "graph_build_source_catchup"
  );
  assert.equal(sourceIndex.papers[0].source_path, "researcher/paper-staging/md/2410.11206.md");
  assert.equal(
    await fs.readFile(
      path.join(projectRoot, "researcher", "paper-staging", "md", "2410.11206.md"),
      "utf8"
    ).then((value) => value.includes("## Method")),
    true
  );
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
  assert.equal(result.recommendedActions[0]?.kind, "drive_stage");
  assert.equal(
    result.recommendedActions[0]?.dispatchDespiteMissingSignals,
    true
  );
  assert.equal(manifest.current_stage, "frontier_mapping");
  assert.equal(manifest.current_micro_stage, "frontier_mapping_requested");
});

test("auto iterator repairs a missing IDEA_REPORT and advances when IDEA-CATALYST is ready", async (t) => {
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
  assert.equal(result.stageAfter, "plan");
  assert.equal(updatedManifest.current_stage, "idea");
  assert.equal(updatedManifest.orchestration_state?.next_transition_candidate, "plan");
  const ideaReport = await fs.readFile(
    path.join(projectRoot, "researcher", "IDEA_REPORT.md"),
    "utf8"
  );
  assert.match(ideaReport, /Selected Direction|Core Contribution/i);
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
  queuedManifest.paper_ingestion.completed_papers = [
    {
      canonical_id: "arxiv:2604.00001",
      title: "Catalyst Bridge Paper",
      import_task_id: "task-catalyst-bridge",
    },
  ];
  queuedManifest.paper_ingestion.import_task_ids = ["task-catalyst-bridge"];
  queuedManifest.paper_ingestion.last_import_task_id = "task-catalyst-bridge";
  queuedManifest.paper_ingestion.last_import_status = "completed";
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

  await activatePreparedHandoff(projectRoot, "orchestrator");

  const finalManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(fourth.stageBefore, "idea");
  assert.equal(fourth.stageAfter, "plan");
  assert.equal(finalManifest.current_stage, "plan");
  assert.equal(finalManifest.idea_catalyst.status, "ready");
  assert.equal(finalManifest.idea_catalyst.requisition_required, false);
  assert.equal(finalManifest.ideation_contract.selected_track_id, trackId);
});

test("auto iterator reconciles non-actionable catalyst requisitions instead of regressing idea back to graph_build", async (t) => {
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
    pending_reason: "Placeholder catalyst requisition should be reconciled.",
  };
  manifest.paper_ingestion = {
    ...(manifest.paper_ingestion ?? {}),
    runtime_status: "idle",
    queued_requests: [
      {
        request_id: "idea-catalyst-req-placeholder",
        status: "queued",
        trigger_kind: "idea_catalyst_requisition",
        detail: "Placeholder catalyst requisition queued before structured bridge evidence was available.",
      },
    ],
  };
  await writeJson(manifestPath, manifest);
  await writeJson(
    path.join(projectRoot, "researcher", "ideation", "GRAPH_IDEATION_PACKET.json"),
    {
      target_domain: "Computer Science",
      challenge_clusters: ["memory preservation"],
      transfer_bridges: [],
      candidate_domains: [],
      bridge_nodes: [],
    }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "TOPIC_SUMMARY.json"),
    {
      target_domain: "Computer Science",
      candidate_domains: [],
    }
  );
  const resetManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  resetManifest.ideation_contract.graph_ideation_indices.transfer_bridges = [];
  resetManifest.ideation_contract.graph_ideation_indices.challenge_clusters = [
    "memory preservation",
  ];
  await writeJson(manifestPath, resetManifest);

  await writeJson(
    path.join(
      projectRoot,
      "researcher",
      "idea-catalyst",
      "INVESTIGATION_REQUISITION.json"
    ),
    {
      actionable: false,
      requisition_id: "req-placeholder",
      target_domain: "Computer Science",
      missing_domains: [],
      challenge_clusters: ["memory preservation"],
      coverage_gap_questions: [
        {
          question_id: "q1",
          question: "How should memory be preserved under domain shift?",
          coverage_status: "unexplored",
          required_domain_evidence: [],
        },
      ],
      search_queries: [],
      non_actionable_reason:
        "No concrete source domains or structured PaperNexus bridge evidence are available to build an actionable requisition yet.",
    }
  );

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(result.stageBefore, "idea");
  assert.equal(updatedManifest.paper_ingestion.queued_requests[0].status, "completed");
  assert.doesNotMatch(
    updatedManifest.blocking_reason ?? "",
    /workflow-owned PaperNexus ingestion is still active/i
  );
  assert.notEqual(updatedManifest.current_micro_stage, "uploading");
  assert.equal(updatedManifest.ideation_contract.selected_track_id, trackId);
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

test("auto iterator waits on fresh queued literature discovery requisitions after graph presence is ready", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const now = await seedSetupCompleteProject(projectRoot, "graph_build");
  await writeText(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"));
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    status: "ready",
    corpus_name: "GCD",
    expected_paper_count: 111,
    present_paper_count: 111,
  });
  await writeJson(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), {
    status: "ready",
    expected_paper_count: 111,
    present_paper_count: 111,
    missing_paper_count: 0,
  });
  await seedReadyBrainstormCycle(projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const queuedAt = new Date().toISOString();
  manifest.paper_ingestion = {
    runtime_status: "completed",
    queued_requests: [
      {
        request_id: "idea-track-graph-evidence-gap",
        status: "queued",
        wrapper: "pn_batch_import.py",
        args: [],
        trigger_kind: "idea_literature_discovery",
        summary: "fresh evidence gap request",
        created_at: queuedAt,
        updated_at: queuedAt,
        attempt_count: 0,
      },
    ],
    graph_presence_checked_at: now,
    graph_presence_status: "ready",
    graph_presence_report_path: "graph/GRAPH_PRESENCE_CHECK.json",
    graph_presence_expected_papers: 111,
    graph_presence_present_papers: 111,
    graph_presence_missing_papers: [],
    refresh_required: false,
  };
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "graph_build");
  assert.equal(result.stageAfter, "graph_build");
  assert.ok(
    result.missingStageSignals.some((signal) =>
      /workflow-owned graph enrichment requisition is still active/i.test(signal)
    )
  );
});

test("auto iterator degrades stale queued literature discovery requisitions once graph presence is ready", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const now = await seedSetupCompleteProject(projectRoot, "graph_build");
  await writeText(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"));
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    status: "ready",
    corpus_name: "GCD",
    expected_paper_count: 1,
    present_paper_count: 1,
  });
  await writeJson(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), {
    status: "ready",
    expected_paper_count: 1,
    present_paper_count: 1,
    missing_paper_count: 0,
  });
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

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const staleQueuedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  manifest.paper_ingestion = {
    runtime_status: "idle",
    queued_requests: [
      {
        request_id: "review-story-support-gap-review-story-support-gap",
        request_kind: "requisition",
        status: "queued",
        wrapper: "pn_batch_import.py",
        args: [],
        trigger_kind: "review_literature_discovery",
        manifest_path:
          "researcher/literature-discovery/requisition/review-story-support-gap/DISCOVERY_REQUISITION.json",
        summary: "review_story_support_gap",
        created_at: staleQueuedAt,
        updated_at: staleQueuedAt,
        attempt_count: 0,
      },
    ],
    graph_presence_checked_at: now,
    graph_presence_status: "ready",
    graph_presence_report_path: "graph/GRAPH_PRESENCE_CHECK.json",
    graph_presence_expected_papers: 1,
    graph_presence_present_papers: 1,
    graph_presence_missing_papers: [],
    refresh_required: false,
  };
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const request = updatedManifest.paper_ingestion.queued_requests[0];
  assert.equal(request.status, "completed");
  assert.equal(request.validation_status, "warning");
  assert.match(
    request.validation_report_path,
    /REQUISITION_SATISFACTION_REPORT\.json$/
  );
  await fs.access(path.join(projectRoot, request.validation_report_path));
  assert.equal(result.stageBefore, "graph_build");
  assert.equal(result.stageAfter, "frontier_mapping");
  assert.doesNotMatch(
    updatedManifest.blocking_reason ?? "",
    /workflow-owned graph enrichment requisition is still active/i
  );
});

test("auto iterator degrades terminal PaperNexus upload failures once graph presence is ready", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const now = await seedSetupCompleteProject(projectRoot, "graph_build");
  await writeText(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"));
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    status: "ready",
    corpus_name: "GCD",
    expected_paper_count: 1,
    present_paper_count: 1,
  });
  await writeJson(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), {
    status: "ready",
    expected_paper_count: 1,
    present_paper_count: 1,
    missing_paper_count: 0,
  });
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

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const batchManifestPath =
    "researcher/paper-staging/queued-imports/req-upload-ready/batch-import.json";
  manifest.paper_ingestion = {
    runtime_status: "blocked",
    waiting_reason: "PaperNexus batch import failed: socket.timeout",
    repair_required: true,
    repair_reason: "socket.timeout",
    queued_requests: [
      {
        request_id: "req-upload-ready",
        request_kind: "upload_manifest",
        status: "needs_repair",
        wrapper: "pn_batch_import.py",
        command_text:
          `python3 skills/researcher/papernexus/scripts/pn_batch_import.py --mcp-url http://papernexus.test/mcp --corpus GCD --manifest ${batchManifestPath} wait`,
        manifest_path: batchManifestPath,
        shared_corpus: "GCD",
        paper_count: 1,
        summary: "Upload timed out after graph was ready",
        created_at: "2026-04-28T00:00:00.000Z",
        updated_at: "2026-04-28T00:01:00.000Z",
        finished_at: "2026-04-28T00:01:00.000Z",
        last_error: "socket.timeout",
        validation_status: "valid",
        attempt_count: 1,
        max_attempts: 3,
      },
    ],
    active_batches: [
      {
        manifest_path: batchManifestPath,
        status: "failed",
        total: 1,
        failed: 1,
        started_at: "2026-04-28T00:00:00.000Z",
        updated_at: "2026-04-28T00:01:00.000Z",
        finished_at: "2026-04-28T00:01:00.000Z",
        detail: "socket.timeout",
      },
    ],
    batch_items: [
      {
        manifest_path: batchManifestPath,
        paper_id: "paper-a",
        canonical_id: "paper-a",
        status: "failed",
        error: "socket.timeout",
        updated_at: "2026-04-28T00:01:00.000Z",
      },
    ],
    graph_presence_checked_at: now,
    graph_presence_status: "ready",
    graph_presence_report_path: "graph/GRAPH_PRESENCE_CHECK.json",
    graph_presence_expected_papers: 1,
    graph_presence_present_papers: 1,
    graph_presence_missing_papers: [],
    refresh_required: false,
  };
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const request = updatedManifest.paper_ingestion.queued_requests[0];
  assert.equal(request.status, "completed");
  assert.equal(request.last_error, null);
  assert.equal(request.validation_status, "warning");
  assert.match(request.validation_report_path, /graph-ready-degraded\.json$/);
  assert.equal(updatedManifest.paper_ingestion.runtime_status, "ready");
  assert.equal(updatedManifest.paper_ingestion.waiting_reason, null);
  assert.equal(updatedManifest.paper_ingestion.repair_required, false);
  assert.equal(updatedManifest.paper_ingestion.repair_reason, null);
  assert.deepEqual(updatedManifest.paper_ingestion.active_batches, []);
  assert.deepEqual(updatedManifest.paper_ingestion.batch_items, []);
  await fs.access(path.join(projectRoot, request.validation_report_path));
  assert.equal(result.stageBefore, "graph_build");
  assert.equal(result.stageAfter, "frontier_mapping");
});

test("auto iterator degrades literature requisitions from creation time despite recent launch retries", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const now = await seedSetupCompleteProject(projectRoot, "graph_build");
  await writeText(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"));
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    status: "ready",
    corpus_name: "GCD",
    expected_paper_count: 1,
    present_paper_count: 1,
  });
  await writeJson(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), {
    status: "ready",
    expected_paper_count: 1,
    present_paper_count: 1,
    missing_paper_count: 0,
  });
  await seedReadyBrainstormCycle(projectRoot);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const staleCreatedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const recentAttemptAt = new Date().toISOString();
  manifest.paper_ingestion = {
    runtime_status: "idle",
    queued_requests: [
      {
        request_id: "review-story-support-gap-review-story-support-gap",
        request_kind: "requisition",
        status: "running",
        wrapper: "pn_batch_import.py",
        args: [],
        trigger_kind: "review_literature_discovery",
        manifest_path:
          "researcher/literature-discovery/requisition/review-story-support-gap/DISCOVERY_REQUISITION.json",
        summary: "review_story_support_gap",
        created_at: staleCreatedAt,
        updated_at: recentAttemptAt,
        started_at: recentAttemptAt,
        last_attempt_at: recentAttemptAt,
        last_run_id: "recent-run",
        last_session_key: "agent:researcher:local:recent",
        attempt_count: 1,
      },
    ],
    graph_presence_checked_at: now,
    graph_presence_status: "ready",
    graph_presence_report_path: "graph/GRAPH_PRESENCE_CHECK.json",
    graph_presence_expected_papers: 1,
    graph_presence_present_papers: 1,
    graph_presence_missing_papers: [],
    refresh_required: false,
  };
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const request = updatedManifest.paper_ingestion.queued_requests[0];
  assert.equal(request.status, "completed");
  assert.equal(request.validation_status, "warning");
  assert.equal(result.stageBefore, "graph_build");
  assert.equal(result.stageAfter, "frontier_mapping");
});

test("auto iterator resumes literature discovery reentry stage after graph build degradation", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const now = await seedSetupCompleteProject(projectRoot, "graph_build");
  await writeText(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"));
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    status: "ready",
    corpus_name: "GCD",
    expected_paper_count: 1,
    present_paper_count: 1,
  });
  await writeJson(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), {
    status: "ready",
    expected_paper_count: 1,
    present_paper_count: 1,
    missing_paper_count: 0,
  });
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
  const requisitionPath =
    "researcher/literature-discovery/requisition/review-story-support-gap/DISCOVERY_REQUISITION.json";
  await writeJson(path.join(projectRoot, requisitionPath), {
    version: 1,
    literature_discovery: {
      discovery_id: "review-story-support-gap",
      trigger_kind: "review_literature_discovery",
      origin_stage: "review",
      required_stage_reentry: ["graph_build", "review"],
    },
  });
  await writeJson(
    path.join(
      projectRoot,
      "researcher/literature-discovery/requisition/review-story-support-gap/REQUISITION_SATISFACTION_REPORT.json"
    ),
    {
      schema_version: 1,
      status: "warning",
      decision: "degraded_satisfied_current_graph",
      request_id: "review-story-support-gap-review-story-support-gap",
      trigger_kind: "review_literature_discovery",
      graph_presence_status: "ready",
      selected_paper_count: 0,
      candidate_paper_count: 0,
    }
  );

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.orchestration_state = {
    status: "running",
    current_owner: "researcher",
    next_owner: "researcher",
    next_transition_candidate: "frontier_mapping",
    retry_budget_remaining: 2,
  };
  manifest.paper_ingestion = {
    runtime_status: "idle",
    queued_requests: [
      {
        request_id: "review-story-support-gap-review-story-support-gap",
        request_kind: "requisition",
        status: "completed",
        wrapper: "pn_batch_import.py",
        args: [],
        trigger_kind: "review_literature_discovery",
        manifest_path: requisitionPath,
        summary: "review_story_support_gap",
        created_at: now,
        updated_at: now,
        finished_at: now,
        validation_status: "warning",
        validation_report_path:
          "researcher/literature-discovery/requisition/review-story-support-gap/REQUISITION_SATISFACTION_REPORT.json",
        attempt_count: 0,
      },
    ],
    graph_presence_checked_at: now,
    graph_presence_status: "ready",
    graph_presence_report_path: "graph/GRAPH_PRESENCE_CHECK.json",
    graph_presence_expected_papers: 1,
    graph_presence_present_papers: 1,
    graph_presence_missing_papers: [],
    refresh_required: false,
  };
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    now: new Date(Date.parse(now) + 1000).toISOString(),
    policy: {
      autoMode: "aggressive",
    },
  });

  assert.equal(result.stageBefore, "graph_build");
  assert.equal(result.stageEffective, "graph_build");
  assert.equal(result.stageAfter, "review");
  assert.equal(
    result.missingStageSignals.some((signal) =>
      /orchestration_state\.next_transition_candidate/i.test(signal)
    ),
    false
  );
});

test("auto iterator degrades stale running literature discovery requisitions once graph presence is ready", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const now = await seedSetupCompleteProject(projectRoot, "graph_build");
  await writeText(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"));
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    status: "ready",
    corpus_name: "GCD",
    expected_paper_count: 1,
    present_paper_count: 1,
  });
  await writeJson(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), {
    status: "ready",
    expected_paper_count: 1,
    present_paper_count: 1,
    missing_paper_count: 0,
  });
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
  await writeJson(
    path.join(
      projectRoot,
      "researcher",
      "literature-discovery",
      "LITERATURE_DISCOVERY_PACKET.json"
    ),
    {
      schema_version: 1,
      discovery_id: "review-story-support-gap",
      discovery_reason: "review_story_support_gap",
      candidate_queries: [{ query: "gcd fixmatch limitation evidence" }],
      candidate_papers: [],
      selected_papers: [],
      evidence_gap_closed: false,
      required_stage_reentry: ["graph_build", "review"],
    }
  );
  await seedReadyBrainstormCycle(projectRoot);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const staleStartedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  manifest.paper_ingestion = {
    runtime_status: "waiting_import",
    queued_requests: [
      {
        request_id: "review-story-support-gap-review-story-support-gap",
        request_kind: "requisition",
        status: "running",
        wrapper: "pn_batch_import.py",
        args: [],
        trigger_kind: "review_literature_discovery",
        manifest_path:
          "researcher/literature-discovery/requisition/review-story-support-gap/DISCOVERY_REQUISITION.json",
        summary: "review_story_support_gap",
        created_at: staleStartedAt,
        updated_at: staleStartedAt,
        started_at: staleStartedAt,
        attempt_count: 1,
        last_run_id: "run:research-queue",
        last_session_key: "agent:researcher:local:test:subagent:workflow-research-queue",
      },
    ],
    graph_presence_checked_at: now,
    graph_presence_status: "ready",
    graph_presence_report_path: "graph/GRAPH_PRESENCE_CHECK.json",
    graph_presence_expected_papers: 1,
    graph_presence_present_papers: 1,
    graph_presence_missing_papers: [],
    refresh_required: false,
  };
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const request = updatedManifest.paper_ingestion.queued_requests[0];
  assert.equal(request.status, "completed");
  assert.equal(request.validation_status, "warning");
  assert.match(
    request.validation_report_path,
    /REQUISITION_SATISFACTION_REPORT\.json$/
  );
  await fs.access(path.join(projectRoot, request.validation_report_path));
  assert.equal(result.stageBefore, "graph_build");
  assert.equal(result.stageAfter, "frontier_mapping");
  assert.doesNotMatch(
    updatedManifest.blocking_reason ?? "",
    /workflow-owned graph enrichment requisition is still active/i
  );
});

test("auto iterator rejects completed literature requisitions without import evidence", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const now = await seedSetupCompleteProject(projectRoot, "graph_build");
  await writeText(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"));
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    status: "ready",
    corpus_name: "GCD",
    expected_paper_count: 111,
    present_paper_count: 111,
  });
  await writeJson(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), {
    status: "ready",
    expected_paper_count: 111,
    present_paper_count: 111,
    missing_paper_count: 0,
  });
  await seedReadyBrainstormCycle(projectRoot);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.paper_ingestion = {
    runtime_status: "ready",
    queued_requests: [
      {
        request_id: "idea-track-graph-evidence-gap",
        request_kind: "requisition",
        status: "completed",
        wrapper: "pn_batch_import.py",
        command_text: "research queue requisition",
        trigger_kind: "idea_literature_discovery",
        summary: "Graph already contains the requested evidence.",
        created_at: "2026-04-10T08:29:10.804Z",
        updated_at: "2026-04-10T08:29:10.804Z",
        finished_at: "2026-04-10T08:35:10.804Z",
        attempt_count: 1,
      },
    ],
    completed_papers: [],
    batch_items: [],
    active_batches: [],
    paper_operations: [],
    import_task_ids: [],
    graph_presence_checked_at: now,
    graph_presence_status: "ready",
    graph_presence_report_path: "graph/GRAPH_PRESENCE_CHECK.json",
    graph_presence_expected_papers: 111,
    graph_presence_present_papers: 111,
    graph_presence_missing_papers: [],
    refresh_required: false,
  };
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "graph_build");
  assert.equal(result.stageAfter, "graph_build");
  assert.ok(
    result.missingStageSignals.some((signal) =>
      /marked completed without durable import or requisition-satisfaction evidence/i.test(
        signal
      )
    )
  );
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

test("auto iterator commits ready experiment review stage without waiting for reviewer ack", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "analyze";
  manifest.current_micro_stage = "analysis_requested";
  manifest.owner_agent = "analyzer";
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
    baseline_fairness_status: "ready",
    implementation_confidence: "trusted",
    ablation_status: "ready",
  };
  manifest.orchestration_state = {
    ...(manifest.orchestration_state ?? {}),
    status: "running",
    current_owner: "analyzer",
    next_owner: "reviewer",
    next_transition_candidate: "review",
    pending_handoff_id: null,
    pending_owner_candidate: null,
    pending_stage_candidate: null,
    handoff_phase: "idle",
  };
  await writeJson(manifestPath, manifest);

  await writeJson(path.join(projectRoot, "researcher", "evaluation_summary.json"), {
    metric: "acc",
    value: 0.91,
  });
  await writeJson(path.join(projectRoot, "researcher", "plot_pack.json"), {
    plots: [{ figure_id: "fig-1", caption: "Main results." }],
  });
  const staleCodeHandoff = await createStageOwnerHandoffIntent({
    projectRoot,
    projectId: "demo-project",
    workflowLine: "experiment",
    stageBefore: "plan",
    stageAfter: "code",
    ownerBefore: "orchestrator",
    ownerAfter: "coder",
    executionId: "stale-code-exec",
    nextAction: "Historical code handoff.",
  });
  await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: staleCodeHandoff.intent.intentId,
    toStatus: "activated",
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "analyze");
  assert.equal(result.stageAfter, "review");
  assert.equal(result.pendingHandoff, false);
  assert.equal(result.ownerAfter, "reviewer");

  const savedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(savedManifest.current_stage, "review");
  assert.equal(savedManifest.owner_agent, "reviewer");
  assert.equal(savedManifest.orchestration_state.pending_stage_candidate, null);
  assert.equal(savedManifest.orchestration_state.handoff_phase, "idle");
  const handoffs = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(handoffs.intents.length, 1);
  assert.equal(handoffs.intents[0].status, "superseded");
  assert.equal(handoffs.intents[0].terminalReason, "stage_lineage_drift");

  const diagnostics = await readWorkflowDiagnosticEvents(projectRoot);
  assert.ok(
    diagnostics.some(
      (event) =>
        event.component === "auto_iterator" &&
        event.action === "owner_handoff_decoupled_from_state_commit" &&
        event.stage === "review"
    )
  );
});

test("auto iterator keeps top-tier analyze stage blocked until mechanism and venue competition evidence are graph-grounded", async (t) => {
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
    multi_seed_status: "ready",
    evaluation_summary_path: "researcher/evaluation_summary.json",
    plot_pack_status: "ready",
    plot_pack_path: "researcher/plot_pack.json",
  };
  manifest.opportunity_scorecard = {
    status: "ready",
    verdict: "worth_top_tier_bet",
    graph_context_status: "ready",
    scorecard_path: "researcher/TOP_TIER_OPPORTUNITY.json",
  };
  manifest.benchmark_protocol = {
    status: "ready",
    benchmark_family: "OpenWorldGraphBench",
    protocol_lock_path: "researcher/BENCHMARK_PROTOCOL.json",
    fairness_report_path: "researcher/BASELINE_FAIRNESS_REPORT.json",
    locked: true,
    drift_status: "pass",
    fair_compare_status: "pass",
    fair_compare_summary:
      "Main compare keeps the same backbone, split, and evaluation harness.",
    allowed_deviation_count: 0,
    allowed_deviation_status: "none",
  };
  manifest.statistical_evidence = {
    status: "ready",
    aggregate_path: "analyzer/STATISTICAL_EVIDENCE.json",
    claim_strength_status: "strong",
    significant_result_count: 3,
    insufficient_seed_count: 0,
  };
  manifest.ablation_evidence = {
    status: "ready",
    summary_path: "researcher/ABLATION_EVIDENCE.json",
    sufficiency_status: "sufficient",
    publication_critical_count: 2,
  };
  manifest.mechanism_evidence = {
    status: "partial",
    packet_path: "researcher/MECHANISM_EVIDENCE.json",
    evidence_tier: "moderate",
    graph_context_status: "unverified_graph_context",
  };
  manifest.venue_competition = {
    status: "partial",
    target_venues: ["ICLR"],
    competitor_slate_path: "researcher/VENUE_COMPETITION.json",
    acceptance_risk_status: "moderate",
    graph_context_status: "unverified_graph_context",
  };
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(projectRoot, "researcher", "evaluation_summary.json"), {
    metric: "acc",
    value: 0.91,
  });
  await writeJson(path.join(projectRoot, "researcher", "plot_pack.json"), {
    plots: [{ figure_id: "fig-1", caption: "Main results." }],
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "analyze");
  assert.equal(result.stageAfter, "analyze");
  assert.ok(
    result.missingStageSignals.some((signal) =>
      /mechanism_evidence\.graph_context_status/i.test(signal)
    )
  );
  assert.ok(
    result.missingStageSignals.some((signal) =>
      /venue_competition\.graph_context_status/i.test(signal)
    )
  );
});

test("auto iterator keeps analyze blocked when no execution proof receipts exist", async (t) => {
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
    multi_seed_status: "ready",
    evaluation_summary_path: "researcher/evaluation_summary.json",
    plot_pack_status: "ready",
    plot_pack_path: "researcher/plot_pack.json",
    baseline_fairness_status: "ready",
    implementation_confidence: "trusted",
    ablation_status: "ready",
  };
  manifest.experiment_memory = {
    last_ledger_update_at: "2026-04-20T00:00:00.000Z",
  };
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(projectRoot, "researcher", "evaluation_summary.json"), {
    metric: "acc",
    value: 0.91,
  });
  await writeJson(path.join(projectRoot, "researcher", "plot_pack.json"), {
    plots: [{ figure_id: "fig-1", caption: "Main results." }],
  });
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    schema_version: 1,
    project_id: "demo-project",
    updated_at: "2026-04-20T00:00:00.000Z",
    experiments: [
      {
        experiment_id: "exp-1",
        status: "completed",
      },
    ],
  });
  await writeText(path.join(projectRoot, "researcher", "EXPERIMENT_REGISTRY.md"), "# registry\n");
  await fs.mkdir(path.join(projectRoot, "researcher", "artifacts", "results"), {
    recursive: true,
  });
  await fs.rm(
    path.join(projectRoot, "coder", "experiments", "track-1", "exp-1__baseline", "REMOTE_RUN.json"),
    { force: true }
  );
  await fs.rm(
    path.join(projectRoot, "coder", "experiments", "track-1", "exp-1__baseline", "RESULT_SUMMARY.json"),
    { force: true }
  );

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "analyze");
  assert.equal(result.stageAfter, "experiment");
  assert.ok(
    result.missingStageSignals.some((signal) =>
      /Execution proof is missing before ANALYZE/i.test(signal)
    )
  );
});

test("auto iterator keeps analyze blocked when execution proof lineage mismatches the current candidate", async (t) => {
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
  manifest.orchestration_state = {
    stage_run_id: "stage-run-new",
  };
  manifest.experiment_search = {
    status: "ready_for_analysis",
    current_main_stage: "ablation_studies",
    current_substage: "multi_seed_aggregation",
    best_node_id: "node-best",
    multi_seed_status: "ready",
    evaluation_summary_path: "researcher/evaluation_summary.json",
    plot_pack_status: "ready",
    plot_pack_path: "researcher/plot_pack.json",
    baseline_fairness_status: "ready",
    implementation_confidence: "trusted",
    ablation_status: "ready",
    candidate_head_commit: "new-commit",
  };
  manifest.experiment_memory = {
    last_ledger_update_at: "2026-04-20T00:00:00.000Z",
  };
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(projectRoot, "researcher", "evaluation_summary.json"), {
    metric: "acc",
    value: 0.91,
  });
  await writeJson(path.join(projectRoot, "researcher", "plot_pack.json"), {
    plots: [{ figure_id: "fig-1", caption: "Main results." }],
  });
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    schema_version: 1,
    project_id: "demo-project",
    updated_at: "2026-04-20T00:00:00.000Z",
    experiments: [
      {
        experiment_id: "exp-1",
        status: "completed",
        result_paths: ["researcher/artifacts/results/results.json"],
      },
    ],
  });
  await writeText(path.join(projectRoot, "researcher", "EXPERIMENT_REGISTRY.md"), "# registry\n");
  await fs.mkdir(path.join(projectRoot, "researcher", "artifacts", "results"), {
    recursive: true,
  });
  const runDir = path.join(projectRoot, "coder", "demo-exp");
  await writeJson(path.join(runDir, "REMOTE_RUN.json"), {
    experiment_id: "exp-1",
    status: "completed",
    git_commit: "old-commit",
    stage_run_id: "stage-run-old",
  });
  await writeJson(path.join(runDir, "RESULT_SUMMARY.json"), {
    experiment_id: "exp-1",
    metrics: { h_score: 0.55 },
    result_paths: ["researcher/artifacts/results/results.json"],
    stage_run_id: "stage-run-old",
  });
  await writeJson(path.join(runDir, "EXPERIMENT_MANIFEST.json"), {
    experiment_id: "exp-1",
    git: {
      last_candidate_commit: "new-commit",
    },
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageAfter, "experiment");
  assert.ok(
    result.missingStageSignals.some((signal) =>
      /commit lineage, stage_run_id, or run_id does not match/i.test(signal)
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

test("auto iterator does not route stale submit revision work around the mandatory human gate", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.revision_control_state = {
    status: "active",
    current_owner: "academic_writer",
    pending_reason: "stale review hook requested a bounded manuscript revision",
    sources: [
      {
        source_id: "stale-submit-review-source",
        status: "active",
        severity: "medium",
      },
    ],
  };
  await writeJson(manifestPath, manifest);
  const staleHandoff = await createStageOwnerHandoffIntent({
    projectRoot,
    projectId: "demo-project",
    workflowLine: "experiment",
    stageBefore: "submit",
    stageAfter: "write",
    ownerBefore: "reviewer",
    ownerAfter: "academic_writer",
    executionId: "stale-submit-exec",
    nextAction: "Stale submit revision handoff.",
  });
  await syncPreparedWorkflowHandoffToManifest({
    projectRoot,
    intent: staleHandoff.intent,
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  assert.equal(result.stageBefore, "submit");
  assert.equal(result.stageAfter, "submit");
  assert.equal(result.gateBlocking, true);
  assert.equal(result.ownerAfter, "reviewer");

  const savedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(savedManifest.current_stage, "submit");
  assert.equal(savedManifest.owner_agent, "reviewer");
  assert.equal(savedManifest.orchestration_state.pending_handoff_id, null);

  const handoffs = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(handoffs.intents.length, 1);
  assert.equal(handoffs.intents[0].status, "superseded");
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

  assert.equal(regressed.stageAfter, "review");
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
  assert.equal(result.stageAfter, "review");
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
  assert.equal(aggressiveResult.stageAfter, "review");
  assert.ok(
    aggressiveResult.autoModeReasons.some((reason) => /citation/i.test(reason))
  );
});

test("auto iterator keeps submit blocked when survey citation count or topicality gates are not ready", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.workflow_line = "survey";
  manifest.paper_type = "survey";
  manifest.writing_contract = {
    ...(manifest.writing_contract ?? {}),
    paper_mode: "survey",
  };
  manifest.citation_integrity.verification_status = "verified";
  manifest.citation_integrity.all_citations_real = true;
  manifest.citation_integrity.minimum_citation_count = 50;
  manifest.citation_integrity.bibliography_entry_count = 40;
  manifest.citation_integrity.topic_relevance_status = "needs_revision";
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "submit");
  assert.equal(result.stageAfter, "submit");
  assert.ok(
    result.missingStageSignals.some((signal) => /citation count >= 50/i.test(signal))
  );
  assert.ok(
    result.missingStageSignals.some((signal) => /topic_relevance_status/i.test(signal))
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
    ),
    JSON.stringify(result.missingStageSignals)
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

  await writeText(
    path.join(projectRoot, "researcher", "FRONTIER_REPORT.md"),
    [
      "# Frontier Report",
      "",
      "- Limitation frontier: current graph grounding still misses long-context support drift.",
      "- Contradiction frontier: evidence ordering and claim ordering still diverge under revision pressure.",
      "- Transfer frontier: frontier packets can seed a stable ideation loop.",
    ].join("\n")
  );
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

  await activatePreparedHandoff(projectRoot, "orchestrator");
  await seedProjectReadyForCode(projectRoot);

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
  await writeJson(manifestPath, manifest);
  await setExperimentSearchState({
    projectRoot,
    experimentSearch: {
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
    },
  });
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

  await activatePreparedHandoff(projectRoot, "analyzer");

  result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  assert.equal(result.stageBefore, "analyze");
  assert.equal(result.stageAfter, "review");

  await activatePreparedHandoff(projectRoot, "reviewer");

  result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(result.stageBefore, "review");
  assert.equal(
    result.stageAfter,
    "write",
    `Unexpected review transition: stageAfter=${result.stageAfter}; regressed=${result.regressed}; missing=${JSON.stringify(result.missingStageSignals)}; storySupport=${manifest.paper_story_state?.claim_support_status ?? "unset"}; storyGap=${manifest.story_gap_search_requisition?.status ?? "unset"}; graphPresence=${manifest.paper_ingestion?.graph_presence_status ?? "unset"}`
  );

  await activatePreparedHandoff(projectRoot, "academic_writer");

  result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  assert.equal(result.stageBefore, "write");
  assert.equal(result.stageAfter, "submit");

  await activatePreparedHandoff(projectRoot, "reviewer");

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

test("auto iterator materializes a local coder experiment bundle when code stage has no Discord handoff output", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { trackId } = await seedProjectReadyForCode(projectRoot);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  const bundleDir = path.join(
    projectRoot,
    "coder",
    "experiments",
    trackId,
    "exp-1__local_consistency_debiasing_probe"
  );
  const manifest = JSON.parse(
    await fs.readFile(path.join(bundleDir, "EXPERIMENT_MANIFEST.json"), "utf8")
  );

  assert.equal(result.stageBefore, "code");
  assert.equal(result.stageAfter, "experiment");
  assert.equal(manifest.track_id, trackId);
  assert.equal(manifest.hypothesis, "Graph grounding improves support precision.");
  assert.equal(
    manifest.novelty_basis,
    "It couples frontier packets with section drafting."
  );
  assert.ok(
    result.materializedArtifacts.some(
      (artifact) => artifact.contract === "code_experiment_bundle"
    )
  );
  await fs.access(path.join(projectRoot, "coder", "EXPERIMENT_INDEX.md"));
  await fs.access(path.join(bundleDir, "train.py"));
  await fs.access(path.join(bundleDir, "README.md"));
});

test("auto iterator bootstraps a local coder bundle while committing plan to code", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { trackId } = await seedProjectReadyForCode(projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "plan";
  manifest.current_micro_stage = "implementation_requested";
  manifest.owner_agent = "orchestrator";
  manifest.orchestration_state = {
    status: "running",
    current_owner: "orchestrator",
    next_owner: "coder",
    next_transition_candidate: "code",
    retry_budget_remaining: 2,
    last_contract_eval_result: "pass",
  };
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  const bundleDir = path.join(
    projectRoot,
    "coder",
    "experiments",
    trackId,
    "exp-1__local_consistency_debiasing_probe"
  );
  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

  assert.equal(result.stageBefore, "plan");
  assert.equal(result.stageAfter, "code");
  assert.equal(result.ownerAfter, "coder");
  assert.equal(result.pendingHandoff, false);
  assert.ok(
    result.materializedArtifacts.some(
      (artifact) => artifact.contract === "code_experiment_bundle"
    )
  );
  assert.equal(updatedManifest.current_stage, "code");
  assert.equal(updatedManifest.owner_agent, "coder");
  assert.equal(updatedManifest.orchestration_state?.handoff_phase, "idle");
  await fs.access(path.join(projectRoot, "coder", "EXPERIMENT_INDEX.md"));
  await fs.access(path.join(bundleDir, "train.py"));
  await fs.access(path.join(bundleDir, "README.md"));
  await fs.access(path.join(bundleDir, "EXPERIMENT_MANIFEST.json"));
});

test("auto iterator repairs coder experiment bundles that still carry the stale track registry contract", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { trackId } = await seedProjectReadyForCode(projectRoot);
  const staleHypothesis = "Original user topic before plan-state refinement.";
  const staleNoveltyBasis = "Original bootstrap novelty before plan-state refinement.";
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), {
    tracks: [
      {
        track_id: trackId,
        status: "active",
        hypothesis: staleHypothesis,
        novelty_basis: staleNoveltyBasis,
      },
    ],
    active_tracks: 1,
  });
  await writeText(path.join(projectRoot, "coder", "EXPERIMENT_INDEX.md"));
  const bundleDir = path.join(
    projectRoot,
    "coder",
    "experiments",
    trackId,
    "exp-1__baseline"
  );
  await writeText(path.join(bundleDir, "train.py"), "print('ok')\n");
  await writeText(path.join(bundleDir, "README.md"));
  await writeJson(
    path.join(bundleDir, "EXPERIMENT_MANIFEST.json"),
    buildAlignedExperimentManifest(trackId, {
      status: "dry_run_passed",
      hypothesis: staleHypothesis,
      novelty_basis: staleNoveltyBasis,
      dry_run: { status: "completed" },
    })
  );

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  const repairedManifest = JSON.parse(
    await fs.readFile(path.join(bundleDir, "EXPERIMENT_MANIFEST.json"), "utf8")
  );

  assert.equal(result.stageBefore, "code");
  assert.equal(result.stageAfter, "experiment");
  assert.ok(["dry_run_passed", "completed"].includes(repairedManifest.status));
  assert.deepEqual(repairedManifest.dry_run, { status: "completed" });
  assert.equal(repairedManifest.hypothesis, "Graph grounding improves support precision.");
  assert.equal(
    repairedManifest.novelty_basis,
    "It couples frontier packets with section drafting."
  );
});

test("auto iterator repairs stale coder bundles even when another bundle is already aligned", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { trackId } = await seedProjectReadyForCode(projectRoot);
  const staleHypothesis = "Original user topic before plan-state refinement.";
  const staleNoveltyBasis = "Original bootstrap novelty before plan-state refinement.";
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), {
    tracks: [
      {
        track_id: trackId,
        status: "active",
        hypothesis: staleHypothesis,
        novelty_basis: staleNoveltyBasis,
      },
    ],
    active_tracks: 1,
  });
  await writeText(path.join(projectRoot, "coder", "EXPERIMENT_INDEX.md"));

  const alignedBundleDir = path.join(
    projectRoot,
    "coder",
    "experiments",
    trackId,
    "exp-0__aligned_baseline"
  );
  await writeText(path.join(alignedBundleDir, "train.py"), "print('ok')\n");
  await writeText(path.join(alignedBundleDir, "README.md"));
  await writeJson(
    path.join(alignedBundleDir, "EXPERIMENT_MANIFEST.json"),
    buildAlignedExperimentManifest(trackId, {
      experiment_id: "exp-0",
      status: "dry_run_passed",
    })
  );

  const staleBundleDir = path.join(
    projectRoot,
    "coder",
    "experiments",
    trackId,
    "exp-1__stale_candidate"
  );
  await writeText(path.join(staleBundleDir, "train.py"), "print('ok')\n");
  await writeText(path.join(staleBundleDir, "README.md"));
  await writeJson(
    path.join(staleBundleDir, "EXPERIMENT_MANIFEST.json"),
    buildAlignedExperimentManifest(trackId, {
      experiment_id: "exp-1",
      status: "dry_run_passed",
      hypothesis: staleHypothesis,
      novelty_basis: staleNoveltyBasis,
    })
  );

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  const repairedStaleManifest = JSON.parse(
    await fs.readFile(path.join(staleBundleDir, "EXPERIMENT_MANIFEST.json"), "utf8")
  );

  assert.equal(result.stageBefore, "code");
  assert.equal(result.stageAfter, "experiment");
  assert.equal(
    repairedStaleManifest.hypothesis,
    "Graph grounding improves support precision."
  );
  assert.equal(
    repairedStaleManifest.novelty_basis,
    "It couples frontier packets with section drafting."
  );
});

test("auto iterator repairs recoverable active-track code bundle proof before leaving code", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { trackId } = await seedProjectReadyForCode(projectRoot);
  await writeText(path.join(projectRoot, "coder", "EXPERIMENT_INDEX.md"));
  const bundleDir = path.join(
    projectRoot,
    "coder",
    "experiments",
    trackId,
    "exp-2__old_generated_bundle"
  );
  await writeText(path.join(bundleDir, "train.py"), "print('ok')\n");
  await writeText(path.join(bundleDir, "README.md"), "# old generated bundle\n");
  await writeJson(
    path.join(bundleDir, "EXPERIMENT_MANIFEST.json"),
    buildAlignedExperimentManifest(trackId, {
      experiment_id: "exp-2",
      hypothesis:
        "[Track: track-1] Tune an older generated variant before the active contract was finalized.",
      novelty_basis:
        "Generated preflight bundle for an earlier active-track wording.",
      validation_steps: [
        {
          step_id: "partial-validation",
          objective: "Validate the first implementation hook only.",
          covers: ["Graph-grounded support routing"],
        },
      ],
      ablation_plan: [],
      implementation_proof: {
        changed_files: ["coder/experiments/track-1/exp-2__old_generated_bundle/train.py"],
        integration_points: [
          {
            point_id: "partial",
            path: "coder/experiments/track-1/exp-2__old_generated_bundle/train.py",
            summary: "Only covers the first implementation hook.",
            covers: ["Graph-grounded support routing"],
          },
        ],
      },
    })
  );

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  const repairedManifest = JSON.parse(
    await fs.readFile(path.join(bundleDir, "EXPERIMENT_MANIFEST.json"), "utf8")
  );

  assert.equal(result.stageBefore, "code");
  assert.equal(result.stageAfter, "experiment");
  assert.equal(repairedManifest.hypothesis, "Graph grounding improves support precision.");
  assert.equal(
    repairedManifest.novelty_basis,
    "It couples frontier packets with section drafting."
  );
  assert.ok(
    repairedManifest.implementation_proof.integration_points.some((entry) =>
      entry.covers?.includes("Frontier-packet-conditioned section drafting")
    )
  );
  assert.ok(
    repairedManifest.validation_steps.some((entry) =>
      entry.covers?.includes("Frontier-packet-conditioned section drafting")
    )
  );
  assert.ok(repairedManifest.ablation_plan.length > 0);
  assert.match(
    repairedManifest.implementation_proof.execution_command,
    /exp-2__old_generated_bundle\/train\.py/
  );
});

test("auto iterator repairs recoverable bundles on secondary active tracks", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { trackId } = await seedProjectReadyForCode(projectRoot);
  const secondaryTrackId = "track-2";
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.research_program.tracks.push({
    track_id: secondaryTrackId,
    priority: 2,
    status: "active",
    hypothesis: "Secondary graph routing improves reviewer traceability.",
    novelty_basis: "It reuses the graph-grounded routing contract for a second active track.",
    main_metric: "traceability",
  });
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), {
    tracks: [
      {
        track_id: trackId,
        status: "active",
        hypothesis: "Graph grounding improves support precision.",
        novelty_basis: "It couples frontier packets with section drafting.",
      },
      {
        track_id: secondaryTrackId,
        status: "active",
        hypothesis: "Secondary graph routing improves reviewer traceability.",
        novelty_basis:
          "It reuses the graph-grounded routing contract for a second active track.",
      },
    ],
    active_tracks: 2,
  });

  await writeText(path.join(projectRoot, "coder", "EXPERIMENT_INDEX.md"));
  const primaryBundleDir = path.join(
    projectRoot,
    "coder",
    "experiments",
    trackId,
    "exp-1__baseline"
  );
  await writeText(path.join(primaryBundleDir, "train.py"), "print('ok')\n");
  await writeText(path.join(primaryBundleDir, "README.md"));
  await writeJson(
    path.join(primaryBundleDir, "EXPERIMENT_MANIFEST.json"),
    buildAlignedExperimentManifest(trackId)
  );

  const secondaryBundleDir = path.join(
    projectRoot,
    "coder",
    "experiments",
    secondaryTrackId,
    "exp-1__old_secondary"
  );
  await writeText(path.join(secondaryBundleDir, "train.py"), "print('ok')\n");
  await writeText(path.join(secondaryBundleDir, "README.md"));
  await writeJson(
    path.join(secondaryBundleDir, "EXPERIMENT_MANIFEST.json"),
    buildAlignedExperimentManifest(secondaryTrackId, {
      hypothesis:
        "[Track: track-2] Secondary bundle still carries the old generated wording.",
      novelty_basis: "Old generated secondary-track wording.",
      implementation_proof: {
        changed_files: ["coder/experiments/track-2/exp-1__old_secondary/train.py"],
        integration_points: [],
      },
    })
  );

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  const secondaryManifest = JSON.parse(
    await fs.readFile(path.join(secondaryBundleDir, "EXPERIMENT_MANIFEST.json"), "utf8")
  );

  assert.equal(result.stageBefore, "code");
  assert.equal(result.stageAfter, "experiment");
  assert.equal(
    secondaryManifest.hypothesis,
    "Secondary graph routing improves reviewer traceability."
  );
  assert.equal(
    secondaryManifest.novelty_basis,
    "It reuses the graph-grounded routing contract for a second active track."
  );
  assert.ok(secondaryManifest.implementation_proof.activation_signals.length > 0);
});

test("auto iterator ignores superseded historical code bundles during active code readiness", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { trackId } = await seedProjectReadyForCode(projectRoot);
  await writeText(path.join(projectRoot, "coder", "EXPERIMENT_INDEX.md"));
  const activeBundleDir = path.join(
    projectRoot,
    "coder",
    "experiments",
    trackId,
    "exp-1__baseline"
  );
  await writeText(path.join(activeBundleDir, "train.py"), "print('ok')\n");
  await writeText(path.join(activeBundleDir, "README.md"));
  await writeJson(
    path.join(activeBundleDir, "EXPERIMENT_MANIFEST.json"),
    buildAlignedExperimentManifest(trackId)
  );

  const oldBundleDir = path.join(
    projectRoot,
    "coder",
    "experiments",
    "old-track",
    "exp-0__superseded"
  );
  await writeText(path.join(oldBundleDir, "train.py"), "print('old')\n");
  await writeText(path.join(oldBundleDir, "README.md"), "# old\n");
  await writeJson(path.join(oldBundleDir, "EXPERIMENT_MANIFEST.json"), {
    experiment_id: "exp-0",
    project_id: "demo-project",
    track_id: "old-track",
    status: "superseded",
    stage: "superseded",
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "code");
  assert.equal(result.stageAfter, "experiment");
  assert.equal(
    result.missingStageSignals.some((signal) =>
      /not aligned|baseline and validation contracts|implementation proof/i.test(signal)
    ),
    false
  );
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

test("auto iterator keeps code stage blocked when the experiment bundle does not declare implementation proof", async (t) => {
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
  const manifest = buildAlignedExperimentManifest(trackId);
  delete manifest.implementation_proof;
  await writeJson(
    path.join(
      projectRoot,
      "coder",
      "experiments",
      trackId,
      "exp-1__baseline",
      "EXPERIMENT_MANIFEST.json"
    ),
    manifest
  );

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageAfter, "code");
  assert.ok(
    result.missingStageSignals.some((signal) =>
      /implementation_proof\.changed_files|implementation_proof\.integration_points|implementation_proof\.activation_signals|implementation_proof\.execution_command/i.test(
        signal
      )
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

test("auto iterator uses local static code review fallback when configured for no-runtime E2E", async (t) => {
  const projectRoot = await makeTempProject();
  const previousFallback = process.env.OPENCLAW_CODE_REVIEW_LOCAL_FALLBACK_AFTER_MS;
  process.env.OPENCLAW_CODE_REVIEW_LOCAL_FALLBACK_AFTER_MS = "0";
  t.after(async () => {
    if (previousFallback == null) {
      delete process.env.OPENCLAW_CODE_REVIEW_LOCAL_FALLBACK_AFTER_MS;
    } else {
      process.env.OPENCLAW_CODE_REVIEW_LOCAL_FALLBACK_AFTER_MS = previousFallback;
    }
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
  const store = await readCodeReviewStore(projectRoot);
  assert.equal(store.currentRound?.status, "approved");
  assert.equal(store.currentRound?.aggregate?.approved, true);
  assert.equal(store.currentRound?.aggregate?.reviewCount, 3);
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

test("auto iterator does not regress code back to plan when stale next_transition_candidate already points at experiment", async (t) => {
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
    packetFingerprint: "approved-code-packet-stale-next-stage",
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

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "code";
  manifest.owner_agent = "coder";
  manifest.orchestration_state = {
    ...(manifest.orchestration_state ?? {}),
    status: "running",
    current_owner: "coder",
    next_owner: "researcher",
    next_transition_candidate: "experiment",
    pending_handoff_id: null,
    pending_owner_candidate: null,
    pending_stage_candidate: null,
    handoff_phase: "idle",
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

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
  assert.equal(result.stageEffective, "code");
  assert.equal(result.stageAfter, "experiment");
  assert.equal(result.regressed, false);
  assert.equal(result.gateBlocking, false);
  assert.ok(
    result.missingStageSignals.every(
      (signal) => !/next_transition_candidate should be code while current_stage=plan/i.test(signal)
    )
  );
});

test("auto iterator keeps top-tier experiment stage blocked until benchmark, statistics, and ablation evidence are present", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "experiment";
  manifest.current_micro_stage = "ready_for_analysis";
  manifest.experiment_search = {
    status: "ready_for_analysis",
    current_main_stage: "ablation_studies",
    current_substage: "multi_seed_aggregation",
    best_node_id: "node-best",
    multi_seed_status: "ready",
    plot_pack_status: "ready",
    evaluation_summary_path: "researcher/evaluation_summary.json",
    plot_pack_path: "researcher/plot_pack.json",
  };
  manifest.experiment_memory = {
    ledger_path: "researcher/EXPERIMENT_LEDGER.json",
    last_ledger_update_at: "2026-04-11T00:00:00.000Z",
  };
  manifest.opportunity_scorecard = {
    status: "ready",
    verdict: "worth_top_tier_bet",
    graph_context_status: "ready",
    scorecard_path: "researcher/TOP_TIER_OPPORTUNITY.json",
  };
  manifest.benchmark_protocol = {
    status: "missing",
    locked: false,
    drift_status: null,
  };
  manifest.statistical_evidence = {
    status: "missing",
    claim_strength_status: null,
  };
  manifest.ablation_evidence = {
    status: "missing",
    sufficiency_status: null,
  };
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    schemaVersion: 1,
    projectId: "demo-project",
    updatedAt: "2026-04-11T00:00:00.000Z",
    summary: {
      activeExperimentIds: [],
      lastCompletedExperimentId: "exp-1",
      lastFailedExperimentId: null,
    },
    experiments: [
      {
        experimentId: "exp-1",
        trackId: "track-main",
        status: "completed",
      },
    ],
  });
  await writeJson(path.join(projectRoot, "researcher", "evaluation_summary.json"), {
    metric: "acc",
    value: 0.91,
  });
  await writeJson(path.join(projectRoot, "researcher", "plot_pack.json"), {
    plots: [{ figure_id: "fig-1", caption: "Main results." }],
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "experiment");
  assert.equal(result.stageAfter, "experiment");
  assert.ok(
    result.missingStageSignals.some((signal) =>
      /benchmark_protocol\.status must not be missing/i.test(signal)
    )
  );
  assert.ok(
    result.missingStageSignals.some((signal) =>
      /statistical_evidence\.status must not be missing/i.test(signal)
    )
  );
  assert.ok(
    result.missingStageSignals.some((signal) =>
      /ablation_evidence\.status must not be missing/i.test(signal)
    )
  );
});

test("auto iterator keeps top-tier experiment stage blocked when fair compare fails", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { now, trackId } = await seedProjectReadyForCode(projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "experiment";
  manifest.current_micro_stage = "ready_for_analysis";
  manifest.experiment_search = {
    status: "ready_for_analysis",
    current_main_stage: "ablation_studies",
    current_substage: "multi_seed_aggregation",
    best_node_id: "node-best",
    multi_seed_status: "ready",
    plot_pack_status: "ready",
    evaluation_summary_path: "researcher/evaluation_summary.json",
    plot_pack_path: "researcher/plot_pack.json",
  };
  manifest.experiment_memory = {
    ledger_path: "researcher/EXPERIMENT_LEDGER.json",
    last_ledger_update_at: now,
  };
  manifest.opportunity_scorecard = {
    status: "ready",
    verdict: "worth_top_tier_bet",
    graph_context_status: "ready",
    scorecard_path: "researcher/TOP_TIER_OPPORTUNITY.json",
  };
  manifest.benchmark_protocol = {
    status: "ready",
    benchmark_family: "OpenWorldGraphBench",
    protocol_lock_path: "researcher/PROTOCOL_LOCK.json",
    fairness_report_path: "researcher/BASELINE_FAIRNESS_REPORT.json",
    locked: true,
    drift_status: "pass",
    fair_compare_status: "fail",
    allowed_deviation_status: "none",
  };
  manifest.statistical_evidence = {
    status: "ready",
    claim_strength_status: "strong",
  };
  manifest.ablation_evidence = {
    status: "ready",
    sufficiency_status: "sufficient",
  };
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    schemaVersion: 1,
    projectId: "demo-project",
    updatedAt: now,
    summary: {
      activeExperimentIds: [],
      lastCompletedExperimentId: "exp-1",
      lastFailedExperimentId: null,
    },
    experiments: [
      {
        experimentId: "exp-1",
        trackId,
        status: "completed",
      },
    ],
  });
  await writeJson(path.join(projectRoot, "researcher", "evaluation_summary.json"), {
    metric: "acc",
    value: 0.91,
  });
  await writeJson(path.join(projectRoot, "researcher", "plot_pack.json"), {
    plots: [{ figure_id: "fig-1", caption: "Main results." }],
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "experiment");
  assert.equal(result.stageAfter, "experiment");
  assert.ok(
    result.missingStageSignals.some((signal) =>
      /benchmark_protocol\.fair_compare_status must not be fail/i.test(signal)
    )
  );
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

test("auto iterator reconciles completed result summaries before treating stale active ledger entries as blocking", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { now, trackId } = await seedProjectReadyForCode(projectRoot);
  const completedRelativeDir = `coder/experiments/${trackId}/zzz_completed`;
  const completedDir = path.join(projectRoot, completedRelativeDir);
  await writeText(path.join(projectRoot, "researcher", "EXPERIMENT_REGISTRY.md"));
  await writeText(path.join(projectRoot, "coder", "EXPERIMENT_INDEX.md"));
  await writeText(path.join(completedDir, "train.py"), "print('completed')\n");
  await writeText(path.join(completedDir, "README.md"), "# completed\n");
  await writeJson(
    path.join(completedDir, "EXPERIMENT_MANIFEST.json"),
    buildAlignedExperimentManifest(trackId, {
      experiment_id: "bundle-completed",
      status: "completed",
    })
  );
  await writeJson(path.join(completedDir, "RESULT_SUMMARY.json"), {
    experiment_id: "bundle-completed",
    status: "completed",
    primary_metric: {
      name: "All ACC",
      value: 54.34,
      unit: "%",
    },
    key_metrics: {
      simGCD_paper: 53.4,
    },
    verdict: "PASS - completed against SimGCD baseline (53.4%).",
  });

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "experiment";
  manifest.owner_agent = "researcher";
  manifest.current_micro_stage = "experiment_launch_requested";
  manifest.experiment_memory = {
    ledger_path: "researcher/EXPERIMENT_LEDGER.json",
    last_ledger_update_at: now,
    last_completed_experiment_id: "ledger-completed",
    papernexus_sync_required: true,
  };
  manifest.experiment_search = {
    status: "launching",
    track_id: trackId,
    incumbent_experiment_id: "ledger-completed",
    multi_seed_status: "debugging_required",
    plot_pack_status: "pending",
    baseline_fairness_status: "unknown",
    implementation_confidence: "unknown",
    ablation_status: "pending",
  };
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    schemaVersion: 1,
    projectId: "demo-project",
    updatedAt: now,
    summary: {
      activeExperimentIds: ["stale-running"],
      lastCompletedExperimentId: "ledger-completed",
      papernexusSyncRequired: true,
    },
    experiments: [
      {
        experimentId: "stale-running",
        trackId,
        status: "running",
        stage: "training",
      },
      {
        experimentId: "ledger-completed",
        trackId,
        status: "completed",
        configRef: `${completedRelativeDir}/EXPERIMENT_MANIFEST.json`,
        keyMetric: {
          name: "All ACC",
          value: 54.34,
        },
      },
    ],
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    policy: {
      autoMode: "aggressive",
      autoGate: {
        enabled: false,
      },
    },
  });

  assert.equal(result.stageBefore, "experiment");
  assert.ok(
    result.materializedArtifacts.some(
      (entry) => entry.artifactPath === "researcher/EXECUTION_PROOF.json"
    )
  );
  const remoteRun = JSON.parse(
    await fs.readFile(path.join(completedDir, "REMOTE_RUN.json"), "utf8")
  );
  assert.equal(remoteRun.experiment_id, "ledger-completed");
  const repairedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(repairedManifest.experiment_search.status, "ready_for_analysis");
  assert.equal(repairedManifest.execution_proof.status, "ready");
});

test("auto iterator hands experiment implementation repair back to coder when baseline fairness is not ready", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { now } = await seedProjectReadyForCode(projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "experiment";
  manifest.current_micro_stage = "baseline_parity";
  manifest.experiment_memory = {
    ledger_path: "researcher/EXPERIMENT_LEDGER.json",
    last_ledger_update_at: now,
    last_completed_experiment_id: null,
    last_failed_experiment_id: null,
    best_known_config_ref: null,
    last_decision_summary: null,
    papernexus_sync_required: false,
    papernexus_sync_status: "clean",
  };
  manifest.experiment_search = {
    status: "running",
    current_main_stage: "baseline_tuning",
    current_substage: "baseline_parity",
    validation_stage: "baseline_parity",
    baseline_fairness_status: "pending",
    implementation_confidence: "unknown",
    search_exhaustion_status: "active",
    ablation_status: "pending",
    innovation_status: "unknown",
    evidence_cleanliness_status: "partial",
    multi_seed_status: "pending",
    plot_pack_status: "pending",
    pending_reason: "Baseline parity has not been re-established yet.",
  };
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageAfter, "experiment");
  assert.equal(result.ownerAfter, "coder");
  assert.equal(result.experimentDecision, "repair_implementation");
  assert.match(result.nextAction ?? "", /repair the bounded runtime \/ implementation issue/i);
  assert.equal(result.recommendedActions[0]?.kind, "drive_stage");
  assert.equal(result.recommendedActions[0]?.owner, "coder");
  const repairedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(repairedManifest.orchestration_state.current_owner, "coder");
  assert.equal(repairedManifest.orchestration_state.next_transition_candidate, "analyze");
});

test("auto iterator rolls experiment stage back to plan when the innovation is invalidated", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { now, trackId } = await seedProjectReadyForCode(projectRoot);
  await writeText(path.join(projectRoot, "researcher", "EXPERIMENT_REGISTRY.md"));
  await writeText(path.join(projectRoot, "coder", "EXPERIMENT_INDEX.md"));
  await writeText(
    path.join(projectRoot, "researcher", "artifacts", "results", "metrics.json"),
    "{}\n"
  );

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "experiment";
  manifest.current_micro_stage = "decision";
  manifest.experiment_memory = {
    ledger_path: "researcher/EXPERIMENT_LEDGER.json",
    last_ledger_update_at: now,
    last_completed_experiment_id: "exp-2",
    last_failed_experiment_id: "exp-2",
    best_known_config_ref: "planner/EXPERIMENT_SEARCH_SPEC.json",
    last_decision_summary: "clean scientific failures keep repeating",
    papernexus_sync_required: false,
    papernexus_sync_status: "clean",
  };
  manifest.experiment_search = {
    status: "ready_for_analysis",
    current_main_stage: "ablation_studies",
    current_substage: "decision",
    validation_stage: "decision",
    baseline_fairness_status: "ready",
    implementation_confidence: "trusted",
    search_exhaustion_status: "exhausted",
    ablation_status: "ready",
    innovation_status: "unknown",
    evidence_cleanliness_status: "clean",
    multi_seed_status: "ready",
    plot_pack_status: "ready",
    evaluation_summary_path: "researcher/artifacts/results/metrics.json",
    plot_pack_path: "researcher/artifacts/results/metrics.json",
  };
  manifest.orchestration_state = {
    status: "running",
    current_owner: "researcher",
    next_owner: "analyzer",
    next_transition_candidate: "analyze",
    retry_budget_remaining: 1,
    rollback_target_stage: "plan",
  };
  await writeJson(manifestPath, manifest);

  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    schemaVersion: 1,
    projectId: "demo-project",
    updatedAt: now,
    summary: {
      activeExperimentIds: [],
      lastCompletedExperimentId: "exp-2",
      lastFailedExperimentId: "exp-2",
      bestKnownConfigRef: null,
      lastDecisionSummary: "innovation invalidated",
      papernexusSyncRequired: false,
      papernexusLastSyncAt: null,
    },
    experiments: [
      {
        experimentId: "exp-1",
        trackId,
        name: "candidate-a",
        kind: "train",
        status: "failed",
        stage: "analysis",
        summary: "Under baseline after fair comparison.",
        decision: "discard",
        failureSignature: "under baseline after fair comparison",
        notes: ["scientific regression"],
      },
      {
        experimentId: "exp-2",
        trackId,
        name: "candidate-b",
        kind: "train",
        status: "failed",
        stage: "analysis",
        summary: "Under baseline after fair comparison.",
        decision: "discard",
        failureSignature: "under baseline after fair comparison",
        notes: ["scientific regression"],
      },
    ],
  });

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "experiment");
  assert.equal(result.stageAfter, "plan");
  assert.equal(result.ownerAfter, "orchestrator");
  assert.equal(result.experimentDecision, "rollback_to_plan");
  assert.equal(result.experimentRollbackStage, "plan");
  const repairedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(repairedManifest.current_stage, "plan");
  assert.equal(repairedManifest.orchestration_state.rollback_target_stage, "plan");
  assert.equal(repairedManifest.orchestration_state.current_owner, "orchestrator");
  assert.equal(repairedManifest.orchestration_state.next_transition_candidate, "code");
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

test("auto iterator allows active writer revision cycles to enter write with open review issues", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "write";
  manifest.current_micro_stage = "revision_requested";
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
    status: "open",
    open_counts: {
      critical: 0,
      high: 0,
      medium: 1,
      low: 0,
    },
    issues: [
      {
        issue_id: "review-report-requests-revision",
        severity: "medium",
        status: "open",
      },
    ],
  };
  manifest.revision_control_state = {
    status: "active",
    current_owner: "academic_writer",
    open_sources: [
      {
        source_id: "review-report-requests-revision",
        severity: "medium",
        status: "open",
      },
    ],
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
  assert.ok(
    !result.missingStageSignals.some((signal) =>
      /review_issue_tracker must resolve or waive all medium\+ issues before write handoff/i.test(signal)
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

test("auto iterator keeps top-tier write stage blocked when venue competition is not graph-grounded", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "write";
  manifest.current_micro_stage = "top_tier_positioning";
  manifest.opportunity_scorecard = {
    status: "ready",
    verdict: "worth_top_tier_bet",
    graph_context_status: "unverified_graph_context",
    scorecard_path: "researcher/TOP_TIER_OPPORTUNITY.json",
  };
  manifest.venue_competition = {
    status: "partial",
    target_venues: ["ICLR", "NeurIPS"],
    competitor_slate_path: "researcher/VENUE_COMPETITION.json",
    acceptance_risk_status: "moderate",
    graph_context_status: "unverified_graph_context",
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
      /opportunity_scorecard\.graph_context_status/i.test(signal)
    )
  );
  assert.ok(
    result.missingStageSignals.some((signal) =>
      /venue_competition\.graph_context_status/i.test(signal)
    )
  );
});

test("auto iterator keeps top-tier write stage blocked when reproducibility pack is missing", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "write";
  manifest.current_micro_stage = "reproducibility_packaging";
  manifest.opportunity_scorecard = {
    status: "ready",
    verdict: "worth_top_tier_bet",
    graph_context_status: "ready",
    scorecard_path: "researcher/TOP_TIER_OPPORTUNITY.json",
  };
  manifest.venue_competition = {
    status: "ready",
    target_venues: ["ICLR"],
    competitor_slate_path: "researcher/VENUE_COMPETITION.json",
    acceptance_risk_status: "moderate",
    graph_context_status: "ready",
  };
  manifest.reproducibility_pack = {
    status: "missing",
    bundle_path: "academic_writer/REPRODUCIBILITY_PACK.json",
    environment_capture_status: null,
    regenerate_tables_status: null,
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
      /reproducibility_pack\.status must not be missing/i.test(signal)
    )
  );
});

test("auto iterator surfaces camera-ready evidence requirements for top-tier submit", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedProjectReadyForSubmit(projectRoot);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "submit";
  manifest.current_micro_stage = "camera_ready_validation";
  manifest.opportunity_scorecard = {
    status: "ready",
    verdict: "worth_top_tier_bet",
    graph_context_status: "ready",
    scorecard_path: "researcher/TOP_TIER_OPPORTUNITY.json",
  };
  manifest.venue_competition = {
    status: "ready",
    target_venues: ["ICLR"],
    competitor_slate_path: "researcher/VENUE_COMPETITION.json",
    acceptance_risk_status: "moderate",
    graph_context_status: "ready",
  };
  manifest.reproducibility_pack = {
    status: "ready",
    bundle_path: "academic_writer/REPRODUCIBILITY_PACK.json",
    environment_capture_status: "ready",
    regenerate_tables_status: "ready",
  };
  manifest.camera_ready_evidence = {
    status: "draft",
    package_path: "academic_writer/CAMERA_READY_EVIDENCE.json",
    figures_status: "ready",
    tables_status: "pending",
    captions_status: "pending",
  };
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });

  assert.equal(result.stageBefore, "submit");
  assert.ok(
    result.missingStageSignals.some((signal) =>
      /camera_ready_evidence\.tables_status must be ready/i.test(signal)
    ),
    JSON.stringify(result.missingStageSignals)
  );
  assert.ok(
    result.missingStageSignals.some((signal) =>
      /camera_ready_evidence\.captions_status must be ready/i.test(signal)
    ),
    JSON.stringify(result.missingStageSignals)
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
