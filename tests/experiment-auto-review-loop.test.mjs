import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH = path.join(
  os.tmpdir(),
  "openclaw-research-background-runs-experiment-auto-review.json"
);
process.env.OPENCLAW_RESEARCH_BACKGROUND_QUEUE_PATH = path.join(
  os.tmpdir(),
  "openclaw-research-background-queue-experiment-auto-review.json"
);

import { createPluginRegistrationContext } from "../tools/plugin-registration-shared.ts";
import { registerWorkflowTools } from "../tools/register-workflow-tools.ts";
import {
  clearBackgroundWorkflowQueueForTests,
  clearBackgroundWorkflowRunRegistryForTests,
} from "../tools/workflow-fast-paths.ts";
import {
  maybeLaunchAutoStageForProject,
} from "../tools/register-workflow-service.ts";
import { defaultAutoGateConfig } from "../tools/workflow-auto-gate.ts";
import { runWorkflowAutoIterator } from "../tools/workflow-guard.ts";

test.beforeEach(async () => {
  await clearBackgroundWorkflowRunRegistryForTests();
  await clearBackgroundWorkflowQueueForTests();
});

test.afterEach(async () => {
  await clearBackgroundWorkflowRunRegistryForTests();
  await clearBackgroundWorkflowQueueForTests();
});

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(targetPath, value = "") {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

async function makeExperimentProject() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-experiment-auto-review-")
  );
  const now = "2026-04-08T10:00:00.000Z";
  const trackId = "fd-gcd-freq-debiased";
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "experiment",
    current_micro_stage: "planning",
    owner_agent: "researcher",
    idle_research: { enabled: false },
    autonomous_execution: {
      experiment_launch_mode: "reviewed_auto",
      max_experiment_review_rounds: 2,
      require_analyzer_review: true,
      require_cross_review: true,
    },
    paper_ingestion: {
      graph_presence_status: "ready",
      graph_presence_checked_at: now,
      refresh_required: false,
    },
    experiment_memory: {
      ledger_path: "researcher/EXPERIMENT_LEDGER.json",
      last_ledger_update_at: now,
      papernexus_sync_required: false,
      papernexus_sync_status: "synced",
    },
    experiment_search: {
      status: "missing",
      multi_seed_status: "pending",
      plot_pack_status: "pending",
      pending_reason: "Pre-launch review has not approved a bundle yet.",
    },
    innovation_reflection: {
      required_after_experiments: true,
      status: "fresh",
      last_reflection_at: now,
      last_reflection_path: "researcher/INNOVATION_REFLECTION.md",
      reflected_through_experiment_update_at: now,
      reflected_experiment_ids: [],
    },
    ideation_contract: {
      status: "ready",
      selected_track_id: trackId,
      graph_ideation_packet_path: "researcher/ideation/GRAPH_IDEATION_PACKET.json",
      research_proposal_path: "researcher/ideation/RESEARCH_PROPOSAL.md",
    },
    research_program: {
      status: "ready",
      goal: "Test reviewed full-auto experiment launch.",
      problem_statement: "Need a graph-grounded prelaunch review loop.",
      baseline_reference: "ProtoGCD",
      primary_metric: "H-score",
      datasets: ["CIFAR-100"],
      success_criteria: ["improve H-score"],
      zotero_project_path: "bot/demo-project",
      tracks: [
        {
          track_id: trackId,
          status: "active",
          hypothesis: "Frequency debiasing improves generalized category discovery.",
          required_baselines: ["ProtoGCD"],
          required_ablations: ["remove_freq_debias"],
          required_controls: ["seed-control"],
          experiment_stage_matrix: ["baseline_implementation", "creative_research"],
          budget: {
            gpu_hours: 12,
            max_runs: 4,
            max_debug_iterations: 1,
          },
          stop_rules: ["stop if baseline fairness is violated"],
          write_scope: {
            allowed_claim_ids: ["claim-1", "claim-2"],
            allowed_figure_ids: ["fig-1"],
          },
        },
      ],
    },
  });
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), {
    tracks: [
      {
        track_id: trackId,
        name: "Frequency-Debiased GCD",
        status: "active",
        linked_graph_nodes: ["paper:freq-debias"],
        relation_patterns: ["extends->paper:protogcd"],
        evidence_pointers: ["graph/LIMITATION_FRONTIER.md#gap-1"],
        reasoning_packet_dir: `researcher/reasoning/${trackId}`,
        working_memory_path: `researcher/reasoning/${trackId}/working-memory.md`,
        synthesis_packet_path: `researcher/reasoning/${trackId}/synthesis.md`,
      },
    ],
  });
  await writeText(
    path.join(projectRoot, "researcher", "reasoning", trackId, "working-memory.md"),
    "# working memory\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "reasoning", trackId, "synthesis.md"),
    "# synthesis\n"
  );
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    status: "ready",
    corpus_name: "shared-global-graph",
    corpus_root: path.join(projectRoot, ".papernexus-home", "corpora", "shared-global-graph"),
  });
  await writeText(path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"), "# graph build\n");
  await writeJson(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), {
    status: "ready",
    expected_paper_count: 1,
    present_paper_count: 1,
    missing_paper_count: 0,
  });
  await writeText(path.join(projectRoot, "graph", "ANCHOR_INDEX.md"), "# anchor index\n");
  await writeText(path.join(projectRoot, "graph", "LIMITATION_FRONTIER.md"), "# limitation frontier\n");
  await writeText(path.join(projectRoot, "graph", "CONTRADICTION_FRONTIER.md"), "# contradiction frontier\n");
  await writeText(path.join(projectRoot, "graph", "TRANSFER_FRONTIER.md"), "# transfer frontier\n");
  await writeText(path.join(projectRoot, "graph", "COMPOSITION_FRONTIER.md"), "# composition frontier\n");
  await writeText(path.join(projectRoot, "researcher", "FRONTIER_REPORT.md"), "# frontier\n");
  await writeText(path.join(projectRoot, "researcher", "IDEA_REPORT.md"), "# idea report\n");
  await writeText(path.join(projectRoot, "researcher", "IDEA_AUDIT.md"), "# idea audit\n");
  await writeText(path.join(projectRoot, "researcher", "INNOVATION_REFLECTION.md"), "# innovation reflection\n");
  await writeText(path.join(projectRoot, "orchestrator", "PLAN.md"), "# plan\n");
  await writeText(path.join(projectRoot, "orchestrator", "TODOS.md"), "# todos\n");
  await writeText(path.join(projectRoot, "orchestrator", "PLAN_AUDIT.md"), "# plan audit\n");
  await writeText(path.join(projectRoot, "coder", "EXPERIMENT_INDEX.md"), "# experiment index\n");
  await writeText(
    path.join(projectRoot, "coder", "experiments", trackId, "exp-1__baseline", "train.py"),
    "print('ok')\n"
  );
  await writeText(
    path.join(projectRoot, "coder", "experiments", trackId, "exp-1__baseline", "README.md"),
    "# baseline bundle\n"
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
      question: "Does frequency debiasing improve H-score?",
      hypothesis: "Frequency debiasing improves generalized category discovery.",
      novelty_basis: "Adds a single debiasing term while preserving the baseline protocol.",
      baseline_reference: "ProtoGCD",
      primary_baseline_metric: "H-score",
      target_improvement: "Improve H-score by >= 2 points over ProtoGCD.",
      baseline_training_protocol:
        "Match ProtoGCD optimizer, schedule, seeds, epochs, and preprocessing unless deviations are explicitly justified.",
      baseline_eval_protocol:
        "Use the ProtoGCD validation split, checkpoint selection, and H-score evaluation unchanged.",
      innovation_points: ["frequency debiasing term"],
      validation_steps: [
        {
          step_id: "baseline-repro",
          objective: "Reproduce ProtoGCD with unchanged evaluation.",
          covers: ["frequency debiasing term"],
        },
      ],
      ablation_plan: [
        {
          ablation_id: "minus-freq-debias",
          objective: "Disable the frequency debiasing term to verify its contribution.",
          covers: ["frequency debiasing term"],
        },
      ],
      status: "draft",
      entry_point: "train.py",
      name: "baseline",
    }
  );
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    schemaVersion: 1,
    projectId: "demo-project",
    updatedAt: now,
    experiments: [],
    summary: {
      activeExperimentIds: [],
      lastCompletedExperimentId: null,
      lastFailedExperimentId: null,
      papernexusSyncRequired: false,
      papernexusLastSyncAt: now,
    },
  });
  await writeText(
    path.join(projectRoot, "academic_writer", "story", "CLAIM_TO_EXPERIMENT_MAP.md"),
    "# Claim Map\n\n- claim-1: Frequency debiasing improves H-score.\n- claim-2: The gain survives ablation.\n"
  );
  await writeJson(
    path.join(projectRoot, "researcher", "ideation", "GRAPH_IDEATION_PACKET.json"),
    {
      selected_track_id: trackId,
      graph_basis_paths: {
        storyline_brief_path: "researcher/papernexus/GRAPH_STORYLINE_PACKET.json",
      },
    }
  );
  await writeText(
    path.join(projectRoot, "researcher", "ideation", "RESEARCH_PROPOSAL.md"),
    "# Proposal\n\nTest frequency debiasing against ProtoGCD.\n"
  );
  await writeJson(
    path.join(projectRoot, "researcher", "papernexus", "MECHANISM_BRIDGE_PACKET.json"),
    { bridges: [{ id: "bridge-1", mechanism: "frequency debiasing" }] }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "papernexus", "CHALLENGE_INSIGHT_PACKET.json"),
    { challenges: [{ id: "challenge-1", limitation: "bias amplification" }] }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "papernexus", "GRAPH_STORYLINE_PACKET.json"),
    { storyline: [{ id: "story-1", claim: "bias mitigation needs controlled launch" }] }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "TOPIC_SUMMARY.json"),
    { objective: "Seeded brainstorm bundle" }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "RESEARCH_BRIEF.json"),
    { anchors: ["paper:seed"] }
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
    { thesis: "Graph-grounded support routing tightens claim precision." }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "WORKING_MEMORY.json"),
    { hypothesis: "demo" }
  );
  await writeText(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "SYNTHESIS_PACKET.md"),
    "# Synthesis\n"
  );
  await writeText(path.join(projectRoot, "researcher", "ideation", "NOVELTY_TREE.md"), "# Novelty\n");
  await writeText(
    path.join(projectRoot, "researcher", "ideation", "CHALLENGE_INSIGHT_TREE.md"),
    "# Challenge Insight\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "ideation", "WELL_ESTABLISHED_SOLUTION_CHECK.md"),
    "# Solution Check\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "ideation", "CROSS_DOMAIN_TRANSFER.md"),
    "# Cross Domain Transfer\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "ideation", "PROBLEM_DECOMPOSITION.md"),
    "# Problem Decomposition\n"
  );
  await writeJson(
    path.join(projectRoot, "researcher", "ideation", "CANDIDATE_POOL.json"),
    { candidates: [{ id: "dir-1", status: "surviving" }] }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "ideation", "TOURNAMENT_SCOREBOARD.json"),
    { status: "completed", selected_direction_id: "dir-1" }
  );
  await writeText(path.join(projectRoot, "researcher", "ideation", "IDEA_TREE.md"), "# Idea Tree\n");
  await writeJson(
    path.join(projectRoot, "researcher", "ideation", "RANKING_HISTORY.json"),
    { status: "completed", method: "equivalent_elo_v1", rounds: [] }
  );
  await writeText(
    path.join(projectRoot, "researcher", "ideation", "TOP3_DIRECTION_SUMMARY.md"),
    "# Top 3 Directions\n"
  );
  await writeJson(
    path.join(projectRoot, "researcher", "idea-catalyst", "DECOMPOSITION_PACKET.json"),
    { version: 1 }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "idea-catalyst", "ABSTRACTION_PACKET.json"),
    { version: 1 }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "idea-catalyst", "SCOUTING_REPORT.json"),
    { target_domain: "Computer Science", candidate_domains: [{ domain: "Psychology" }] }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "idea-catalyst", "GATE_DECISION.json"),
    { decision: "brainstorm" }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "idea-catalyst", "IDEA_FRAGMENTS.json"),
    { fragments: [{ fragment_id: "frag-1", source_domain: "Psychology" }] }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "idea-catalyst", "RANKED_FRAGMENTS.json"),
    { ranking: [{ rank: 1, fragment_id: "frag-1" }] }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "idea-catalyst", "CATALYST_SESSION_STATE.json"),
    { status: "ready", micro_stage: "judging" }
  );
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.brainstorm_cycle = {
    status: "reconciled",
    mode: "aggressive",
    topic: "Seeded brainstorm bundle",
    basis_stage: "graph_build",
    track_id: trackId,
    provider: "workflow_core_brainstorm",
    provider_mode: "core",
    provider_status: "ready",
    contract_version: 1,
    rounds: [{ round_id: "seed-round", options: [{ option_id: "seed-option", score: 0.8 }] }],
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
      last_refresh_at: now,
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
    last_updated_at: now,
  };
  manifest.idea_catalyst = {
    status: "ready",
    contract_version: 1,
    mode: "graph-first",
    micro_stage: "judging",
    decomposition_packet_path: "researcher/idea-catalyst/DECOMPOSITION_PACKET.json",
    abstraction_packet_path: "researcher/idea-catalyst/ABSTRACTION_PACKET.json",
    scouting_report_path: "researcher/idea-catalyst/SCOUTING_REPORT.json",
    gate_decision_path: "researcher/idea-catalyst/GATE_DECISION.json",
    idea_fragments_path: "researcher/idea-catalyst/IDEA_FRAGMENTS.json",
    ranked_fragments_path: "researcher/idea-catalyst/RANKED_FRAGMENTS.json",
    investigation_requisition_path: "researcher/idea-catalyst/INVESTIGATION_REQUISITION.json",
    session_state_path: "researcher/idea-catalyst/CATALYST_SESSION_STATE.json",
    target_domain: "Computer Science",
    source_domains: ["Psychology"],
    bridge_count: 2,
    top_fragment_id: "frag-1",
    requisition_required: false,
    pending_reason: null,
    last_updated_at: now,
  };
  manifest.research_program.plan_alternatives = [
    {
      option_id: "plan-main",
      linked_track_id: trackId,
      source_direction_id: "dir-1",
      title: "Graph-grounded main plan",
      status: "selected",
      summary: "Advance the graph-grounded evidence-routing track into code and experiment.",
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
      summary: "Keep the workflow lighter but accept weaker evidence binding.",
      graph_evidence_paths: ["researcher/ideation/TOP3_DIRECTION_SUMMARY.md"],
      key_risks: ["Leaves reviewer pressure too high for later stages."],
    },
  ];
  manifest.research_program.plan_selection = {
    selected_option_id: "plan-main",
    selected_track_id: trackId,
    compared_option_ids: ["plan-main", "plan-fallback"],
    rationale: "The selected track keeps graph evidence in the execution loop.",
    decisive_graph_evidence_paths: [
      "graph/GRAPH_BUILD_REPORT.md",
      "researcher/ideation/GRAPH_IDEATION_PACKET.json",
    ],
    fallback_option_ids: ["plan-fallback"],
    last_compared_at: now,
  };
  manifest.research_program.task_graph = [
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
  ];
  manifest.orchestration_state = {
    status: "running",
    current_owner: "researcher",
    next_owner: "coder",
    next_transition_candidate: "experiment",
    retry_budget_remaining: 2,
    last_contract_eval_result: "pass",
  };
  await writeJson(manifestPath, manifest);
  return { projectRoot, trackId };
}

function createResearchWorkflowTool(params = {}) {
  let registeredTool = null;
  const api = {
    runtime: params.runtime ?? {},
    logger: {},
    pluginConfig: params.pluginConfig,
    registerTool(spec) {
      registeredTool = spec;
    },
  };
  const plugin = createPluginRegistrationContext(api);
  registerWorkflowTools(plugin);
  const tool =
    typeof registeredTool === "function"
      ? registeredTool({
          workspaceDir: params.workspaceDir,
          agentId: params.agentId ?? "researcher",
          sessionKey: params.sessionKey ?? "agent:researcher:test",
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

async function syncExperimentReviewState(projectRoot, manifest) {
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);
  if (manifest.experiment_review_state) {
    await writeJson(
      path.join(projectRoot, "researcher", "EXPERIMENT_REVIEW_STATE.json"),
      manifest.experiment_review_state
    );
  }
}

test("research_workflow experiment review actions persist durable reviewed-auto launch state", async (t) => {
  const { projectRoot } = await makeExperimentProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
  });

  const materialized = await executeWorkflowTool(tool, {
    action: "materialize_experiment_review_state",
  });
  assert.equal(materialized.state.launchMode, "reviewed_auto");
  assert.equal(materialized.state.plannerStatus, "pending");
  assert.equal(materialized.state.targetTrackIds.length, 1);
  assert.equal(materialized.packetExists, true);
  const packet = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "planner", "EXPERIMENT_REVIEW_PACKET.json"),
      "utf8"
    )
  );
  assert.equal(packet.baselines[0], "ProtoGCD");
  assert.equal(packet.metrics[0], "H-score");
  assert.match(packet.one_variable_change ?? "", /frequency/i);
  assert.equal(packet.one_change_signature, packet.one_variable_change);
  assert.equal(packet.inner_loop?.mode, "karpathy_fast_keep_discard");
  assert.equal(packet.inner_loop?.trial_time_budget_minutes, 5);
  assert.equal(packet.inner_loop?.require_one_change_signature, true);
  assert.equal(
    packet.outer_loop?.require_baseline_dataset_coverage_for_effective_candidates,
    true
  );
  assert.equal(Array.isArray(packet.prior_experiment_verdicts), true);

  const updated = await executeWorkflowTool(tool, {
    action: "set_experiment_review_state",
    experimentReview: {
      planner_status: "ready",
      analyzer_status: "ready",
      cross_reviewer_status: "revise",
      blocker_count: 1,
      blockers: ["Need a falsifier experiment before launch."],
      pending_reason: "Cross-reviewer requested revision.",
    },
  });
  assert.equal(updated.state.crossReviewerStatus, "ready");
  assert.equal(updated.state.crossReviewerVerdict, "revise");
  assert.equal(updated.state.blockerCount, 1);

  const summary = await executeWorkflowTool(tool, {
    action: "get_experiment_review_state",
  });
  assert.equal(summary.state.crossReviewerStatus, "ready");
  assert.equal(summary.state.crossReviewerVerdict, "revise");
  assert.match(summary.summary, /blockers=1/);
  assert.equal(summary.reviewedAutoLaunchEnabled, true);

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.experiment_review_state.cross_reviewer_status, "ready");
  assert.equal(manifest.experiment_review_state.cross_reviewer_verdict, "revise");
  assert.equal(manifest.experiment_review_state.blocker_count, 1);
  const stateFile = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "EXPERIMENT_REVIEW_STATE.json"),
      "utf8"
    )
  );
  assert.equal(stateFile.cross_reviewer_status, "ready");
  assert.equal(stateFile.cross_reviewer_verdict, "revise");
});

test("experiment review materializer reconciles reviewer artifacts and launch decision into durable state", async (t) => {
  const { projectRoot } = await makeExperimentProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
  });

  await executeWorkflowTool(tool, {
    action: "materialize_experiment_review_state",
  });

  await writeText(
    path.join(projectRoot, "analyzer", "EXPERIMENT_REASONABLENESS_REPORT.md"),
    [
      "# Experiment Reasonableness Review",
      "",
      "Verdict: pass",
      "",
      "- baseline fidelity looks correct",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, "cross-reviewer", "EXPERIMENT_ATTACK_REPORT.md"),
    [
      "# Experiment Attack",
      "",
      "Verdict: block",
      "",
      "Critical blockers:",
      "- Missing negative control for the frequency debiasing term",
    ].join("\n")
  );
  await writeJson(
    path.join(projectRoot, "researcher", "EXPERIMENT_LAUNCH_DECISION.json"),
    {
      status: "revise",
      launch_approved: false,
      blockers: ["Missing negative control for the frequency debiasing term"],
      review_round: 1,
    }
  );

  const rematerialized = await executeWorkflowTool(tool, {
    action: "materialize_experiment_review_state",
  });

  assert.equal(rematerialized.state.analyzerStatus, "ready");
  assert.equal(rematerialized.state.analyzerVerdict, "pass");
  assert.equal(rematerialized.state.crossReviewerStatus, "ready");
  assert.equal(rematerialized.state.crossReviewerVerdict, "block");
  assert.equal(rematerialized.state.reviewRound, 1);
  assert.equal(rematerialized.state.blockerCount, 1);
  assert.match(
    rematerialized.state.pendingReason ?? "",
    /negative control/i
  );
  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.experiment_review_state.analyzer_status, "ready");
  assert.equal(manifest.experiment_review_state.cross_reviewer_status, "ready");
  assert.equal(manifest.experiment_review_state.cross_reviewer_verdict, "block");
});

test("auto iterator routes reviewed-auto experiment stage through planner, analyzer, cross-reviewer, synthesis, and coder", async (t) => {
  const { projectRoot } = await makeExperimentProject();
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  let result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    policy: {
      autoMode: "aggressive",
      autoGate: defaultAutoGateConfig(),
    },
  });
  assert.equal(result.stageAfter, "experiment");
  assert.equal(result.ownerAfter, "planner");
  let manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(manifest.current_micro_stage, "planning");
  assert.match(result.nextAction ?? "", /\/experiment-plan/i);

  manifest.experiment_review_state = {
    ...manifest.experiment_review_state,
    status: "reviewing",
    micro_stage: "analyzer_review",
    planner_status: "ready",
    analyzer_status: "pending",
    cross_reviewer_status: "pending",
    synthesis_status: "pending",
    launch_approved: false,
  };
  await syncExperimentReviewState(projectRoot, manifest);

  result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    policy: {
      autoMode: "aggressive",
      autoGate: defaultAutoGateConfig(),
    },
  });
  assert.equal(result.ownerAfter, "analyzer");
  manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(manifest.current_micro_stage, "analyzer_review");
  assert.match(result.nextAction ?? "", /\/experiment-design-review/i);

  manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.experiment_review_state = {
    ...manifest.experiment_review_state,
    analyzer_status: "ready",
    analyzer_verdict: "pass",
    cross_reviewer_status: "pending",
    micro_stage: "cross_review",
  };
  await syncExperimentReviewState(projectRoot, manifest);

  result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    policy: {
      autoMode: "aggressive",
      autoGate: defaultAutoGateConfig(),
    },
  });
  assert.equal(result.ownerAfter, "cross-reviewer");
  manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(manifest.current_micro_stage, "cross_review");
  assert.match(result.nextAction ?? "", /\/experiment-attack/i);

  manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.experiment_review_state = {
    ...manifest.experiment_review_state,
    cross_reviewer_status: "ready",
    cross_reviewer_verdict: "pass",
    synthesis_status: "pending",
    launch_approved: false,
    micro_stage: "synthesis",
  };
  await syncExperimentReviewState(projectRoot, manifest);

  result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    policy: {
      autoMode: "aggressive",
      autoGate: defaultAutoGateConfig(),
    },
  });
  assert.equal(result.ownerAfter, "researcher");
  manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(manifest.current_micro_stage, "synthesis");
  assert.match(result.nextAction ?? "", /EXPERIMENT_LAUNCH_DECISION\.json/i);

  manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.experiment_review_state = {
    ...manifest.experiment_review_state,
    synthesis_status: "ready",
    launch_approved: true,
    last_launch_approved_at: "2026-04-08T10:30:00.000Z",
    micro_stage: "launch_ready",
    status: "ready_for_launch",
  };
  await syncExperimentReviewState(projectRoot, manifest);

  result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    policy: {
      autoMode: "aggressive",
      autoGate: defaultAutoGateConfig(),
    },
  });
  assert.equal(result.ownerAfter, "coder");
  manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(manifest.current_micro_stage, "launching");
  assert.match(result.nextAction ?? "", /\/run-experiment/i);
});

test("maybeLaunchAutoStageForProject dispatches planner-owned reviewed-auto experiment work", async (t) => {
  const projectsRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-experiment-auto-service-")
  );
  const projectRoot = path.join(projectsRoot, "demo-project");
  await fs.mkdir(projectRoot, { recursive: true });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "experiment",
  });
  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  const runtimeCalls = [];
  const result = await maybeLaunchAutoStageForProject({
    runtimeSubagent: {
      async run(params) {
        runtimeCalls.push(params);
        return { runId: "planner-run-1" };
      },
    },
    workflowPolicy: {
      autoMode: "aggressive",
      autoGate: defaultAutoGateConfig(),
      enableChannelProjectBindings: true,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: false,
    },
    projectRoot,
    projectId: "demo-project",
    autoIteratorResult: {
      gateBlocking: false,
      stageAfter: "experiment",
      recommendedActions: [
        {
          kind: "drive_stage",
          owner: "planner",
          stage: "experiment",
          summary: "Prepare the reviewed-auto experiment packet.",
          command: "/experiment-plan",
          mailboxMessageId: null,
          cooldownRemainingSeconds: 0,
          blocking: false,
        },
      ],
    },
    launchedStageKeys: new Map(),
    deps: {
      listChannelProjectBindingsForWorkflow() {
        return {
          enabled: true,
          storePath: projectsRoot,
          bindings: [
            {
              channelKey: "discord:demo",
              projectRoot,
              projectId: "demo-project",
              messageChannel: "discord",
              sessionKeySample: "agent:researcher:discord:demo",
              sessionId: null,
              boundAt: "2026-04-08T10:00:00.000Z",
              updatedAt: "2026-04-08T10:00:00.000Z",
              boundByAgent: "researcher",
              notes: null,
            },
          ],
        };
      },
    },
  });

  assert.equal(result.launched, true);
  assert.equal(result.owner, "planner");
  assert.equal(runtimeCalls.length, 1);
  assert.match(runtimeCalls[0].sessionKey ?? "", /agent:planner:/i);
  assert.match(runtimeCalls[0].message ?? "", /\/experiment-plan/i);
});
