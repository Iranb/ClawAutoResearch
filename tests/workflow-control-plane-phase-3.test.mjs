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

function buildCompliantFigureTableLatex() {
  const figures = Array.from({ length: 5 }, (_, index) => {
    const number = index + 1;
    const label =
      number === 1 ? "fig:framework-overview" : `fig:analysis-${number}`;
    const caption =
      number === 1
        ? "Framework overview of the proposed workflow."
        : `Analysis figure ${number} supporting the evidence narrative.`;
    return [
      "\\begin{figure}",
      "\\centering",
      `\\caption{${caption}}`,
      `\\label{${label}}`,
      "\\end{figure}",
    ].join("\n");
  });
  const tables = Array.from({ length: 4 }, (_, index) => {
    const number = index + 1;
    const label =
      number <= 2 ? `tab:experiment-results-${number}` : `tab:analysis-${number}`;
    const caption =
      number <= 2
        ? `Experiment result table ${number} with benchmark metrics.`
        : `Comparison table ${number} summarizing evidence.`;
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
    "Figure~\\ref{fig:framework-overview} explains the framework.",
    "\\section{Results}",
    "Tables~\\ref{tab:experiment-results-1} and~\\ref{tab:experiment-results-2} report experiments.",
    ...figures,
    ...tables,
  ].join("\n\n");
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

async function seedReadyIdeationContract(
  projectRoot,
  { trackId = "track-main" } = {}
) {
  await writeText(path.join(projectRoot, "researcher", "ideation", "NOVELTY_TREE.md"));
  await writeText(
    path.join(projectRoot, "researcher", "ideation", "CHALLENGE_INSIGHT_TREE.md")
  );
  await writeText(
    path.join(
      projectRoot,
      "researcher",
      "ideation",
      "WELL_ESTABLISHED_SOLUTION_CHECK.md"
    )
  );
  await writeText(
    path.join(projectRoot, "researcher", "ideation", "CROSS_DOMAIN_TRANSFER.md")
  );
  await writeText(
    path.join(projectRoot, "researcher", "ideation", "PROBLEM_DECOMPOSITION.md")
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
    path.join(projectRoot, "researcher", "ideation", "TOURNAMENT_SCOREBOARD.json"),
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
  await writeText(path.join(projectRoot, "researcher", "ideation", "IDEA_TREE.md"));
  await writeJson(
    path.join(projectRoot, "researcher", "ideation", "RANKING_HISTORY.json"),
    {
      status: "completed",
      method: "equivalent_elo_v1",
      rounds: [],
    }
  );
  await writeText(
    path.join(projectRoot, "researcher", "ideation", "TOP3_DIRECTION_SUMMARY.md")
  );
  await writeText(
    path.join(projectRoot, "researcher", "ideation", "RESEARCH_PROPOSAL.md")
  );
  await writeJson(
    path.join(projectRoot, "researcher", "ideation", "GRAPH_IDEATION_PACKET.json"),
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
    graph_ideation_indices: {
      status: "ready",
      novelty_candidate_clusters: ["zone:1"],
      challenge_clusters: ["cluster:challenge-1"],
      insight_clusters: ["cluster:insight-1"],
      occupied_solution_zones: [],
      transfer_bridges: ["bridge:1"],
      last_refresh_at: "2026-03-26T09:00:00.000Z",
    },
    novelty_tree_path: "researcher/ideation/NOVELTY_TREE.md",
    challenge_insight_tree_path: "researcher/ideation/CHALLENGE_INSIGHT_TREE.md",
    solution_check_path: "researcher/ideation/WELL_ESTABLISHED_SOLUTION_CHECK.md",
    cross_domain_transfer_path: "researcher/ideation/CROSS_DOMAIN_TRANSFER.md",
    problem_decomposition_path: "researcher/ideation/PROBLEM_DECOMPOSITION.md",
    candidate_pool_path: "researcher/ideation/CANDIDATE_POOL.json",
    idea_tree_path: "researcher/ideation/IDEA_TREE.md",
    ranking_history_path: "researcher/ideation/RANKING_HISTORY.json",
    tournament_scoreboard_path: "researcher/ideation/TOURNAMENT_SCOREBOARD.json",
    top3_summary_path: "researcher/ideation/TOP3_DIRECTION_SUMMARY.md",
    research_proposal_path: "researcher/ideation/RESEARCH_PROPOSAL.md",
    graph_ideation_packet_path: "researcher/ideation/GRAPH_IDEATION_PACKET.json",
    selected_direction_id: "dir-1",
    selected_track_id: trackId,
    pending_reason: null,
    last_updated_at: "2026-03-26T09:00:00.000Z",
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
    last_updated_at: "2026-03-26T09:00:00.000Z",
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
  await writeJson(
    path.join(projectRoot, "researcher", "idea-catalyst", "IDEA_TO_CLAIM_MAP.json"),
    {
      claims: [
        {
          claim_id: "claim-1",
          fragment_id: "frag-1",
          track_id: trackId,
        },
      ],
    }
  );

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.paper_story_state = {
    status: "ready",
    track_id: trackId,
    task_summary_path: "academic_writer/story/TASK_SUMMARY.md",
    challenge_statement_path: "academic_writer/story/CHALLENGE_STATEMENT.md",
    insight_summary_path: "academic_writer/story/INSIGHT_SUMMARY.md",
    contribution_map_path: "academic_writer/story/CONTRIBUTION_MAP.md",
    advantage_map_path: "academic_writer/story/ADVANTAGE_MAP.md",
    story_spine_path: "academic_writer/story/STORY_SPINE.md",
    pipeline_figure_sketch_path: "academic_writer/story/PIPELINE_FIGURE_SKETCH.md",
    module_motivation_map_path: "academic_writer/story/MODULE_MOTIVATION_MAP.md",
    claim_to_experiment_map_path: "academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md",
    idea_to_claim_map_path: "researcher/idea-catalyst/IDEA_TO_CLAIM_MAP.json",
    fallback_narrative_path: "academic_writer/story/FALLBACK_NARRATIVE.md",
    rejection_risk_table_path: "academic_writer/story/REJECTION_RISK_TABLE.md",
    claim_support_status: "supported",
    supported_claim_count: 1,
    partial_claim_count: 0,
    unsupported_claim_count: 0,
    pending_reason: null,
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
    mode: "aggressive",
    track_id: "track-main",
    reject_first_review_path: "reviewer/story-pressure/REJECT_FIRST_REVIEW.md",
    novelty_attack_path: "reviewer/story-pressure/NOVELTY_ATTACK.md",
    unsupported_claim_audit_path: "reviewer/story-pressure/UNSUPPORTED_CLAIM_AUDIT.md",
    reverse_outline_path: "reviewer/story-pressure/REVERSE_OUTLINE.md",
    figure_table_qc_path: "reviewer/story-pressure/FIGURE_TABLE_QC.md",
    limitation_audit_path: "reviewer/story-pressure/LIMITATION_AUDIT.md",
    latest_round_at: "2026-03-26T10:30:00.000Z",
    pending_reason: null,
  };
  await writeJson(manifestPath, manifest);
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
      "Match baseline-a optimizer, schedule, seeds, epochs, and preprocessing unless allowed_deviations says otherwise.",
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
  await writeText(
    path.join(projectRoot, "researcher", "FRONTIER_REPORT.md"),
    [
      "# Frontier Report",
      "- limitation: current corpus under-covers long-tail failure modes.",
      "- contradiction: methods with stronger benchmarks still depend on brittle supervision.",
      "- transfer opportunity: graph-grounded retrieval could stabilize evaluation coverage.",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, "researcher", "IDEA_REPORT.md"),
    [
      "# Idea Report",
      "- candidate: build a graph-grounded benchmark taxonomy and compare families by evidence regime.",
      "- advantage: creates a stronger planning target than a generic benchmark expansion.",
      "- tradeoff: requires tighter screening discipline and clearer exclusion rules.",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, "researcher", "IDEA_AUDIT.md"),
    [
      "# Idea Audit",
      "- risk: taxonomy-first framing may hide unresolved benchmark gaps unless exclusion logic stays explicit.",
      "- reject: generic corpus growth without a benchmark taxonomy because it does not create a sharp plan target.",
    ].join("\n")
  );
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
  await seedReadyIdeationContract(projectRoot);
  await seedReadyIdeaCatalystState(projectRoot);
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
    buildAlignedExperimentManifest("track-main", {
      hypothesis: "Demo hypothesis",
      novelty_basis: "Demo novelty",
    })
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
  await seedReadyIdeationContract(projectRoot);
  await seedReadyIdeaCatalystState(projectRoot);
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
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    buildCompliantFigureTableLatex()
  );
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
    body_guidance:
      "Keep the main text to the stability claim and push derivation detail into the appendix.",
    theorem_candidates: [{ statement: "Bounded drift preserves ranking stability." }],
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
  await seedReadyPaperStoryState(projectRoot);
  await seedReadyReviewPressurePacket(projectRoot);
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
      plan_alternatives: [
        {
          option_id: "plan-graph-router",
          linked_track_id: "track-main",
          source_direction_id: "dir-graph-router",
          title: "Graph-grounded router plan",
          status: "selected",
          summary:
            "Keep graph evidence routing in the loop from ideation through writing.",
          graph_evidence_paths: [
            "graph/LIMITATION_FRONTIER.md",
            "researcher/ideation/GRAPH_IDEATION_PACKET.json",
          ],
          key_risks: ["Implementation complexity may slow the first baseline round."],
        },
        {
          option_id: "plan-prompt-only",
          linked_track_id: null,
          source_direction_id: "dir-prompt-only",
          title: "Prompt-only fallback plan",
          status: "rejected",
          summary:
            "Keep the drafting pipeline lightweight but lose graph-backed routing guarantees.",
          graph_evidence_paths: ["researcher/ideation/TOP3_DIRECTION_SUMMARY.md"],
          key_risks: ["Unsupported-claim risk remains too high without graph routing."],
        },
      ],
      plan_selection: {
        selected_option_id: "plan-graph-router",
        selected_track_id: "track-main",
        compared_option_ids: ["plan-graph-router", "plan-prompt-only"],
        rationale:
          "Graph-backed routing is the only option that closes the frontier support gap while preserving a credible fallback path.",
        decisive_graph_evidence_paths: [
          "graph/LIMITATION_FRONTIER.md",
          "researcher/ideation/GRAPH_IDEATION_PACKET.json",
        ],
        fallback_option_ids: ["plan-prompt-only"],
        last_compared_at: "2026-03-26T10:00:00.000Z",
      },
    },
  });
  assert.equal(researchProgram.state.status, "approved");
  assert.equal(researchProgram.state.tracks.length, 1);
  assert.equal(researchProgram.state.planAlternatives.length, 2);
  assert.equal(researchProgram.state.planSelection.selectedTrackId, "track-main");

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
  assert.equal(researchProgramSummary.state.planAlternatives.length, 2);
  assert.equal(
    researchProgramSummary.state.planSelection.selectedOptionId,
    "plan-graph-router"
  );
  assert.equal(orchestrationSummary.state.nextTransitionCandidate, "code");
  assert.equal(writePackageSummary.state.status, "ready");

  const rawTrace = await fs.readFile(tracePath, "utf8");
  assert.match(rawTrace, /set_research_program/);
  assert.match(rawTrace, /set_orchestration_state/);
  assert.match(rawTrace, /set_write_package/);
});

test("materialize_plan_state repairs malformed plan payloads into auto-iterator-ready research_program state", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await seedPlanProject(projectRoot);

  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  await executeWorkflowTool(tool, {
    action: "set_research_program",
    researchProgram: {
      status: "approved",
      goal: "Complete program",
      problem_statement: "Demo plan payload drift",
      baseline_reference: "SimGCD",
      primary_metric: "acc",
      datasets: ["CUB-200"],
      success_criteria: ["acc>=0.9"],
      tracks: {
        main: {
          track_id: "track-main",
          priority: 1,
          status: "active",
          hypothesis: "Demo hypothesis",
          novelty_basis: "Demo novelty",
          main_metric: "acc",
          success_threshold: "acc>=0.9",
          required_baselines: "baseline-a",
          required_ablations: ["ablation-a"],
          required_controls: { primary: "seed-control" },
          experiment_stage_matrix: {
            baseline_implementation: { ready: true },
            baseline_tuning: { ready: true },
            creative_research: { ready: true },
            ablation_studies: { ready: true },
          },
          budget: {
            gpu_hours: 8,
            max_runs: 4,
            max_debug_iterations: 1,
          },
          stop_rules: "stop after no improvement",
          rollback_triggers: ["baseline regression"],
          write_scope: {
            allowed_claim_ids: "claim-1",
            allowed_figure_ids: ["fig-1"],
          },
        },
      },
      task_graph: {
        tasks: {
          plan_main: {
            task_id: "plan-main",
            stage: "plan",
            track_id: "track-main",
            owner: "researcher",
            dependencies: [],
            entry_criteria: "track active",
            expected_outputs: { primary: "plan complete" },
            retry_budget: 1,
            exit_criteria: ["plan ready"],
          },
        },
      },
    },
  });

  const materialized = await executeWorkflowTool(tool, {
    action: "materialize_plan_state",
    planMaterialization: {
      selectedTrackId: "track-main",
    },
  });
  assert.equal(
    materialized.validationErrors.some((signal) =>
      signal.includes("experiment_stage_matrix")
    ),
    false
  );
  assert.equal(
    materialized.validationErrors.some((signal) => signal.includes("task_graph coverage")),
    false
  );
  assert.equal(
    materialized.validationErrors.some((signal) =>
      signal.includes("plan_alternatives")
    ),
    false
  );
  assert.equal(
    materialized.validationErrors.some((signal) => signal.includes("plan_selection")),
    false
  );
  assert.ok(materialized.generatedFiles.includes("orchestrator/PLAN.md"));
  assert.ok(materialized.generatedFiles.includes("orchestrator/TODOS.md"));
  assert.ok(materialized.generatedFiles.includes("orchestrator/PLAN_AUDIT.md"));
  const planText = await fs.readFile(path.join(projectRoot, "orchestrator", "PLAN.md"), "utf8");
  assert.match(planText, /Implementation Strategy/);
  const auditText = await fs.readFile(
    path.join(projectRoot, "orchestrator", "PLAN_AUDIT.md"),
    "utf8"
  );
  assert.match(auditText, /Handoff Decision/);
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
  assert.equal(result.stageAfter, "code");
  assert.ok(
    result.materializedArtifacts.some((artifact) => artifact.contract === "plan_state")
  );
  assert.equal(
    result.missingStageSignals.some((signal) => signal.includes("research_program")),
    false
  );
  const planText = await fs.readFile(path.join(projectRoot, "orchestrator", "PLAN.md"), "utf8");
  assert.match(planText, /Implementation Strategy/);

  await seedExperimentProject(projectRoot);
  result = await runWorkflowAutoIterator({
    projectRoot,
    agentId: "researcher",
    mode: "phase-3-experiment-gate",
    queueMailbox: false,
  });
  assert.equal(result.stageAfter, "experiment");
  assert.match(result.nextAction ?? "", /monitor-experiment/i);

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
  await writeJson(path.join(projectRoot, "researcher", "EXECUTION_PROOF.json"), {
    schema_version: 1,
    status: "ready",
    path: "researcher/EXECUTION_PROOF.json",
    receipt_count: 1,
    ledger_matched_receipt_count: 1,
    lineage_matched_receipt_count: 1,
    candidate_commit: "cand-123",
    expected_stage_run_id: "stage-run-exp-1",
    primary_receipt_experiment_id: "exp-1",
    primary_receipt_run_id: "run-exp-1",
    primary_receipt_stage_run_id: "stage-run-exp-1",
    primary_receipt_git_commit: "cand-123",
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    ...(JSON.parse(await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8"))),
    execution_proof: {
      status: "ready",
      path: "researcher/EXECUTION_PROOF.json",
      receipt_count: 1,
      ledger_matched_receipt_count: 1,
      lineage_matched_receipt_count: 1,
      candidate_commit: "cand-123",
      expected_stage_run_id: "stage-run-exp-1",
      primary_receipt_experiment_id: "exp-1",
      primary_receipt_run_id: "run-exp-1",
      primary_receipt_stage_run_id: "stage-run-exp-1",
      primary_receipt_git_commit: "cand-123",
    },
  });

  result = await runWorkflowAutoIterator({
    projectRoot,
    agentId: "researcher",
    mode: "phase-3-experiment-gate",
    queueMailbox: false,
  });
  assert.equal(result.stageAfter, "experiment");
  assert.match(result.nextAction ?? "", /monitor-experiment/i);

  await seedWriteProject(projectRoot);
  result = await runWorkflowAutoIterator({
    projectRoot,
    agentId: "academic_writer",
    mode: "phase-3-write-gate",
    queueMailbox: false,
  });
  assert.equal(result.stageAfter, "write");
  assert.ok(
    result.missingStageSignals.some((signal) => /citation|topic_relevance|count/i.test(signal))
  );
});

test("frontier auto-recovers brainstorm state, and aggressive mode keeps the highest-scoring option", async (t) => {
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
  assert.equal(result.stageBefore, "frontier_mapping");
  assert.equal(result.stageAfter, "idea");
  let refreshedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.match(refreshedManifest.brainstorm_cycle?.status ?? "", /ready|reconciled/);

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

  refreshedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  refreshedManifest.current_stage = "idea";
  refreshedManifest.owner_agent = "researcher";
  await writeJson(manifestPath, refreshedManifest);

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
      papernexusProgressSummary:
        "phase=verifying_graph, progress=3/4 synced, graph=3/4 present, next=rerun graph check",
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
  assert.match(assembly.text, /PaperNexus progress: phase=verifying_graph/i);
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
