import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPluginRegistrationContext } from "../tools/plugin-registration-shared.ts";
import { registerWorkflowTools } from "../tools/register-workflow-tools.ts";
import { maybePrepareWorkflowStageContracts } from "../tools/workflow-guard-runtime/stage-preflight.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
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
  assert.ok(registeredTool);
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

async function makeCatalystProjectRoot() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-idea-catalyst-")
  );
  const manifest = {
    project_id: "idea-catalyst-demo",
    current_stage: "idea",
    owner_agent: "researcher",
    research_program: {
      status: "ready",
      goal: "Improve generalized category discovery with more transferable innovation search.",
      problem_statement: "Generalized category discovery struggles with cross-domain analogical idea search.",
      baseline_reference: "SimGCD",
      primary_metric: "ACC",
      datasets: ["CIFAR100"],
      success_criteria: ["Beat baseline ACC by 2 points"],
      zotero_project_path: "bot/idea-catalyst-demo",
    },
    ideation_contract: {
      status: "ready",
      contract_version: 1,
      long_term_goal: "Build graph-grounded interdisciplinary innovation loops.",
      problem_scope: "GCD cross-domain ideation",
      basis_stage: "frontier_mapping",
      graph_basis_paths: {
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
        novelty_candidate_clusters: ["open-world discovery under domain shift"],
        challenge_clusters: ["memory preservation", "cross-domain alignment"],
        insight_clusters: ["consistency regularization", "uncertainty gating"],
        occupied_solution_zones: ["occupied:plain contrastive baseline"],
        transfer_bridges: ["psychology:metacontrol", "control theory:adaptive regulation"],
      },
      idea_tree_path: "researcher/ideation/IDEA_TREE.md",
      novelty_tree_path: "researcher/ideation/NOVELTY_TREE.md",
      challenge_insight_tree_path: "researcher/ideation/CHALLENGE_INSIGHT_TREE.md",
      solution_check_path: "researcher/ideation/WELL_ESTABLISHED_SOLUTION_CHECK.md",
      cross_domain_transfer_path: "researcher/ideation/CROSS_DOMAIN_TRANSFER.md",
      problem_decomposition_path: "researcher/ideation/PROBLEM_DECOMPOSITION.md",
      candidate_pool_path: "researcher/ideation/CANDIDATE_POOL.json",
      ranking_history_path: "researcher/ideation/RANKING_HISTORY.json",
      tournament_scoreboard_path: "researcher/ideation/TOURNAMENT_SCOREBOARD.json",
      top3_summary_path: "researcher/ideation/TOP3_DIRECTION_SUMMARY.md",
      research_proposal_path: "researcher/ideation/RESEARCH_PROPOSAL.md",
      graph_ideation_packet_path: "researcher/ideation/GRAPH_IDEATION_PACKET.json",
      selected_direction_id: "dir-main",
      selected_track_id: "track-main",
    },
  };
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), {
    tracks: [
      {
        track_id: "track-main",
        status: "active",
        question: "How can GCD retain old category evidence while adapting to new domains?",
        hypothesis:
          "Cross-domain metacontrol can regulate when to preserve or adapt prototype memory.",
        novelty_basis: "Transfer metacontrol ideas from psychology into GCD memory adaptation.",
        reasoning_packet_dir: "researcher/reasoning/track-main",
        working_memory_path: "researcher/brainstorm-cycle/WORKING_MEMORY.md",
        synthesis_packet_path: "researcher/reasoning/track-main/SYNTHESIS.md",
        graph_backed_evidence: true,
      },
    ],
  });

  await writeText(path.join(projectRoot, "researcher", "FRONTIER_REPORT.md"), "# Frontier\n- challenge: memory preservation under shift\n- insight: uncertainty-aware adaptation\n");
  await writeText(path.join(projectRoot, "graph", "ANCHOR_INDEX.md"), "# Anchors\n- SimGCD\n");
  await writeText(path.join(projectRoot, "graph", "LIMITATION_FRONTIER.md"), "- memory preservation remains weak\n");
  await writeText(path.join(projectRoot, "graph", "TRANSFER_FRONTIER.md"), "- psychology -> metacontrol\n- control theory -> adaptive regulation\n");
  await writeJson(path.join(projectRoot, "researcher", "brainstorm-cycle", "TOPIC_SUMMARY.json"), {
    target_domain: "Computer Science",
    candidate_domains: ["Psychology", "Control Theory"],
  });
  await writeText(path.join(projectRoot, "researcher", "brainstorm-cycle", "LOGIC_CHAIN.md"), "# Logic\n- preserve memory\n- adapt under shift\n");
  await writeText(path.join(projectRoot, "researcher", "brainstorm-cycle", "EVIDENCE_CHAIN.md"), "# Evidence\n- evidence A\n");
  await writeJson(path.join(projectRoot, "researcher", "brainstorm-cycle", "STORYLINE_BRIEF.json"), {
    thesis: "Metacontrol-inspired memory regulation can improve GCD.",
    arc: "challenge -> transfer -> integration",
  });
  await writeText(path.join(projectRoot, "researcher", "ideation", "IDEA_TREE.md"), "# Idea Tree\n");
  await writeText(path.join(projectRoot, "researcher", "ideation", "NOVELTY_TREE.md"), "# Novelty Tree\n");
  await writeText(path.join(projectRoot, "researcher", "ideation", "CHALLENGE_INSIGHT_TREE.md"), "# Challenge Insight Tree\n");
  await writeText(path.join(projectRoot, "researcher", "ideation", "WELL_ESTABLISHED_SOLUTION_CHECK.md"), "# Solution Check\n");
  await writeText(path.join(projectRoot, "researcher", "ideation", "CROSS_DOMAIN_TRANSFER.md"), "# Transfer\n- psychology metacontrol\n");
  await writeText(path.join(projectRoot, "researcher", "ideation", "PROBLEM_DECOMPOSITION.md"), "# Decomposition\n- q1: retain memory\n- q2: adapt prototypes\n");
  await writeJson(path.join(projectRoot, "researcher", "ideation", "GRAPH_IDEATION_PACKET.json"), {
    target_domain: "Computer Science",
    challenge_clusters: ["memory preservation"],
    transfer_bridges: ["psychology:metacontrol", "control theory:adaptive regulation"],
  });
  await writeJson(path.join(projectRoot, "researcher", "ideation", "CANDIDATE_POOL.json"), {
    candidates: [
      {
        direction_id: "dir-main",
        track_id: "track-main",
        title: "Psychology metacontrol for GCD memory retention",
        summary: "Use metacontrol to modulate prototype updates.",
        novelty: 0.88,
        feasibility: 0.74,
        relevance: 0.86,
        clarity: 0.82,
        composite_score: 0.825,
        status: "surviving",
      },
      {
        direction_id: "dir-alt",
        track_id: "track-main",
        title: "Control-theoretic adaptive prototype regulator",
        summary: "Borrow adaptive regulation policies for prototype updates.",
        novelty: 0.8,
        feasibility: 0.76,
        relevance: 0.8,
        clarity: 0.78,
        composite_score: 0.785,
        status: "surviving",
      },
    ],
  });
  await writeJson(path.join(projectRoot, "researcher", "ideation", "RANKING_HISTORY.json"), { comparisons: [] });
  await writeJson(path.join(projectRoot, "researcher", "ideation", "TOURNAMENT_SCOREBOARD.json"), { rounds: [] });
  await writeText(path.join(projectRoot, "researcher", "ideation", "TOP3_DIRECTION_SUMMARY.md"), "# Top 3\n");
  await writeText(path.join(projectRoot, "researcher", "ideation", "RESEARCH_PROPOSAL.md"), "# Proposal\n");
  await writeText(path.join(projectRoot, "researcher", "IDEA_REPORT.md"), "# Idea Report\n");
  await writeText(path.join(projectRoot, "researcher", "IDEA_AUDIT.md"), "# Idea Audit\n");
  await writeText(path.join(projectRoot, "researcher", "brainstorm-cycle", "WORKING_MEMORY.md"), "# Working Memory\n");
  await writeText(path.join(projectRoot, "researcher", "reasoning", "track-main", "SYNTHESIS.md"), "# Synthesis\n");

  return projectRoot;
}

test("research_workflow materialize_idea_catalyst_state scaffolds IDEA-CATALYST packets from graph-first ideation artifacts", async (t) => {
  const projectRoot = await makeCatalystProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) delete process.env.OPENCLAW_PROJECT;
    else process.env.OPENCLAW_PROJECT = previousProjectRoot;
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  const result = await executeWorkflowTool(tool, {
    action: "materialize_idea_catalyst_state",
    ideaCatalystMaterialization: {
      basis_stage: "idea",
    },
  });

  assert.equal(result.state.status, "ready");
  assert.equal(result.state.targetDomain, "Computer Science");
  assert.ok(result.state.sourceDomains.includes("Psychology"));
  assert.ok(result.generatedFiles.some((filePath) => /DECOMPOSITION_PACKET\.json$/.test(filePath)));
  assert.ok(result.generatedFiles.some((filePath) => /RANKED_FRAGMENTS\.json$/.test(filePath)));

  const decompositionPacket = JSON.parse(
    await fs.readFile(
      path.join(
        projectRoot,
        "researcher",
        "idea-catalyst",
        "DECOMPOSITION_PACKET.json"
      ),
      "utf8"
    )
  );
  assert.ok(Array.isArray(decompositionPacket.questions));
  assert.ok(
    decompositionPacket.questions.some(
      (question) => question.coverage_status === "partial"
    )
  );
  assert.ok(
    decompositionPacket.questions.some(
      (question) => question.coverage_status === "unexplored"
    )
  );
  assert.ok(
    decompositionPacket.questions.every(
      (question) =>
        question.coverage_evidence &&
        typeof question.coverage_evidence === "object"
    )
  );
  assert.ok(
    decompositionPacket.questions
      .filter((question) => question.coverage_status !== "resolved")
      .every(
        (question) =>
          Array.isArray(question.remaining_non_incremental_challenges) &&
          question.remaining_non_incremental_challenges.length >= 1
      )
  );

  const abstractionPacket = JSON.parse(
    await fs.readFile(
      path.join(
        projectRoot,
        "researcher",
        "idea-catalyst",
        "ABSTRACTION_PACKET.json"
      ),
      "utf8"
    )
  );
  assert.ok(
    abstractionPacket.abstractions.every(
      (entry) =>
        ["exploratory", "targeted", "resolved"].includes(entry.strategy) &&
        Array.isArray(entry.transfer_axes) &&
        (entry.mechanism_hypothesis === null ||
          (typeof entry.mechanism_hypothesis === "string" &&
            entry.mechanism_hypothesis.length > 0))
    )
  );

  const ideaFragmentsPacket = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "idea-catalyst", "IDEA_FRAGMENTS.json"),
      "utf8"
    )
  );
  assert.ok(
    ideaFragmentsPacket.fragments.every(
      (fragment) =>
        fragment.integration_mechanism &&
        Array.isArray(fragment.integration_mechanism.selected_takeaways) &&
        fragment.integration_mechanism.selected_takeaways.length >= 1 &&
        typeof fragment.integration_mechanism.selected_takeaways[0]
          .mechanism_explanation === "string" &&
        fragment.challenge_resolution &&
        typeof fragment.challenge_resolution.addresses_target_challenge === "string"
    )
  );

  const gateDecision = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "idea-catalyst", "GATE_DECISION.json"),
      "utf8"
    )
  );
  assert.equal(gateDecision.decision, "brainstorm");
  assert.equal(gateDecision.evidence.coverage_summary.unresolved_questions >= 1, true);
});

test("research_workflow materialize_idea_catalyst_state prunes unsupported scout domains and syncs bridge evidence back into ideation contract", async (t) => {
  const projectRoot = await makeCatalystProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) delete process.env.OPENCLAW_PROJECT;
    else process.env.OPENCLAW_PROJECT = previousProjectRoot;
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  await writeJson(path.join(projectRoot, "researcher", "brainstorm-cycle", "TOPIC_SUMMARY.json"), {
    target_domain: "Computer Science",
    candidate_domains: ["Psychology", "Control Theory", "Economics", "Robotics"],
  });
  await writeJson(path.join(projectRoot, "researcher", "ideation", "GRAPH_IDEATION_PACKET.json"), {
    target_domain: "Computer Science",
    challenge_clusters: ["memory preservation"],
    transfer_bridges: [
      "psychology:metacontrol",
      "control theory:adaptive regulation",
      "robotics:curriculum relay",
    ],
  });

  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  await executeWorkflowTool(tool, {
    action: "materialize_idea_catalyst_state",
    ideaCatalystMaterialization: {
      basis_stage: "idea",
    },
  });
  await executeWorkflowTool(tool, {
    action: "materialize_ideation_contract",
    ideationMaterialization: {
      basis_stage: "idea",
    },
  });

  const scoutReport = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "idea-catalyst", "SCOUTING_REPORT.json"),
      "utf8"
    )
  );
  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );

  assert.deepEqual(
    scoutReport.selected_source_domains,
    ["Psychology", "Control Theory", "Robotics"]
  );
  assert.deepEqual(scoutReport.pruned_domains, ["Economics"]);
  assert.equal(scoutReport.bridge_evidence_tier, "strong");
  assert.equal(
    scoutReport.candidate_domains.find((entry) => entry.domain === "Economics")?.pruned,
    true
  );
  assert.deepEqual(
    manifest.idea_catalyst.source_domains,
    ["Psychology", "Control Theory", "Robotics"]
  );
  assert.deepEqual(
    manifest.ideation_contract.graph_ideation_indices.candidate_source_domains,
    ["Psychology", "Control Theory", "Economics", "Robotics"]
  );
  assert.deepEqual(
    manifest.ideation_contract.graph_ideation_indices.selected_source_domains,
    ["Psychology", "Control Theory", "Robotics"]
  );
  assert.deepEqual(
    manifest.ideation_contract.graph_ideation_indices.pruned_source_domains,
    ["Economics"]
  );
  assert.equal(
    manifest.ideation_contract.graph_ideation_indices.bridge_evidence_tier,
    "strong"
  );
  assert.equal(
    manifest.ideation_contract.graph_ideation_indices.transfer_bridges.includes(
      "robotics:curriculum relay"
    ),
    true
  );

  const candidatePool = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "ideation", "CANDIDATE_POOL.json"),
      "utf8"
    )
  );
  const scoreboard = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "ideation", "TOURNAMENT_SCOREBOARD.json"),
      "utf8"
    )
  );
  const top3Summary = await fs.readFile(
    path.join(projectRoot, "researcher", "ideation", "TOP3_DIRECTION_SUMMARY.md"),
    "utf8"
  );

  assert.equal(candidatePool.candidate_target_count, 15);
  assert.equal(candidatePool.hard_floor_candidate_count, 9);
  assert.match(candidatePool.candidate_scarcity_reason ?? "", /graph|evidence|scarcity/i);
  assert.equal(scoreboard.candidate_target_count, 15);
  assert.equal(scoreboard.hard_floor_candidate_count, 9);
  assert.equal(scoreboard.candidate_pool_status, "below_floor");
  assert.match(scoreboard.candidate_scarcity_reason ?? "", /graph|evidence|scarcity/i);
  assert.match(top3Summary, /Contribution hints:/i);
});

test("stage preflight materializes idea_catalyst after ideation_contract becomes ready", async (t) => {
  const projectRoot = await makeCatalystProjectRoot();
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  delete manifest.idea_catalyst;
  await writeJson(manifestPath, manifest);

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  let called = 0;
  const result = await maybePrepareWorkflowStageContracts({
    projectRoot,
    manifest,
    stage: "plan",
    agentId: "researcher",
    trigger: "test",
    deps: {
      materializeIdeationContract: async () => ({ ok: true }),
      materializePaperStoryState: async () => ({ ok: true }),
      materializeReviewPressurePacket: async () => ({ ok: true }),
      materializeIdeaCatalystState: async () => {
        called += 1;
        const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
        await executeWorkflowTool(tool, {
          action: "materialize_idea_catalyst_state",
          ideaCatalystMaterialization: { basis_stage: "plan" },
        });
        return { ok: true };
      },
      queueIdeaCatalystRequisition: async () => ({ ok: true }),
    },
  });

  assert.equal(called, 1);
  assert.ok(result.materializedContracts.includes("idea_catalyst"));
});

test("stage preflight reconciles a satisfied IDEA-CATALYST requisition before deciding whether to requeue or block idea", async (t) => {
  const projectRoot = await makeCatalystProjectRoot();
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.idea_catalyst = {
    ...(manifest.idea_catalyst ?? {}),
    status: "requisition",
    micro_stage: "gatekeeping",
    requisition_required: true,
    pending_reason:
      "Cross-domain bridge evidence is still insufficient for unresolved catalyst questions; request more ingestion before proceeding.",
  };
  await writeJson(manifestPath, manifest);
  await writeJson(
    path.join(projectRoot, "researcher", "idea-catalyst", "INVESTIGATION_REQUISITION.json"),
    {
      schema_version: 1,
      generated_at: "2026-04-08T07:45:00.000Z",
      project_id: "idea-catalyst-demo",
      status: "satisfied",
      requisition_type: "cross_domain_papers",
      requested_papers: [],
      import_queue_status: "not_required",
      graph_build_status: "completed",
      frontier_refresh_status: "completed",
      satisfied_at: "2026-04-08T08:14:44.036091Z",
      satisfied_by: "researcher",
      rationale:
        "All required papers are already present in the configured corpus; no additional imports required.",
    }
  );

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  let materialized = 0;
  let queued = 0;
  const result = await maybePrepareWorkflowStageContracts({
    projectRoot,
    manifest,
    stage: "idea",
    agentId: "researcher",
    trigger: "test",
    deps: {
      materializeIdeationContract: async () => ({ ok: true }),
      materializePaperStoryState: async () => ({ ok: true }),
      materializeReviewPressurePacket: async () => ({ ok: true }),
      materializeLiteratureDiscoveryPacket: async () => ({ ok: true }),
      queueLiteratureDiscoveryRequisition: async () => ({ ok: true }),
      materializeIdeaCatalystState: async () => {
        materialized += 1;
        const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
        await executeWorkflowTool(tool, {
          action: "materialize_idea_catalyst_state",
          ideaCatalystMaterialization: { basis_stage: "idea" },
        });
        return { ok: true };
      },
      queueIdeaCatalystRequisition: async () => {
        queued += 1;
        return { ok: true };
      },
    },
  });

  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(queued, 0);
  assert.equal(materialized, 1);
  assert.ok(result.materializedContracts.includes("idea_catalyst"));
  assert.notEqual(updatedManifest.idea_catalyst.status, "requisition");
  assert.equal(updatedManifest.idea_catalyst.requisition_required, false);
});

test("research_workflow materialize_idea_catalyst_state emits a structured requisition when graph bridge evidence is insufficient", async (t) => {
  const projectRoot = await makeCatalystProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) delete process.env.OPENCLAW_PROJECT;
    else process.env.OPENCLAW_PROJECT = previousProjectRoot;
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const graphPacketPath = path.join(
    projectRoot,
    "researcher",
    "ideation",
    "GRAPH_IDEATION_PACKET.json"
  );
  await writeJson(graphPacketPath, {
    target_domain: "Computer Science",
    challenge_clusters: ["memory preservation"],
    transfer_bridges: [],
  });
  await writeJson(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "TOPIC_SUMMARY.json"),
    {
      target_domain: "Computer Science",
      candidate_domains: ["Psychology", "Control Theory"],
    }
  );
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.ideation_contract.graph_ideation_indices.transfer_bridges = [];
  await writeJson(manifestPath, manifest);

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  const result = await executeWorkflowTool(tool, {
    action: "materialize_idea_catalyst_state",
    ideaCatalystMaterialization: {
      basis_stage: "idea",
    },
  });

  assert.equal(result.state.status, "requisition");
  assert.equal(result.state.requisitionRequired, true);

  const requisition = JSON.parse(
    await fs.readFile(
      path.join(
        projectRoot,
        "researcher",
        "idea-catalyst",
        "INVESTIGATION_REQUISITION.json"
      ),
      "utf8"
    )
  );
  assert.deepEqual(requisition.missing_domains, ["Psychology", "Control Theory"]);
  assert.equal(requisition.required_stage_reentry.join(" -> "), "graph_build -> frontier_mapping -> idea");
  assert.ok(Array.isArray(requisition.search_queries));
  assert.ok(requisition.search_queries.length >= 2);
  assert.ok(
    requisition.search_queries.every(
        (entry) => typeof entry.query === "string" && entry.query.trim().length > 0
    )
  );
  assert.equal(typeof requisition.requisition_id, "string");
  assert.equal(requisition.requisition_id.length > 0, true);
  assert.ok(Array.isArray(requisition.coverage_gap_questions));
  assert.ok(requisition.coverage_gap_questions.length >= 1);
  assert.equal(typeof requisition.minimum_bridge_nodes, "number");
  assert.equal(requisition.minimum_bridge_nodes >= 2, true);
  assert.equal(typeof requisition.retry_budget, "number");
  assert.equal(requisition.retry_budget >= 1, true);
  assert.equal(typeof requisition.saturation_signal, "string");
  assert.equal(requisition.saturation_signal.length > 0, true);

  const sessionState = JSON.parse(
    await fs.readFile(
      path.join(
        projectRoot,
        "researcher",
        "idea-catalyst",
        "CATALYST_SESSION_STATE.json"
      ),
      "utf8"
    )
  );
  assert.equal(typeof sessionState.iteration_count, "number");
  assert.equal(sessionState.iteration_count >= 2, true);
  assert.equal(Array.isArray(sessionState.iterations), true);
  assert.equal(sessionState.iterations.length, sessionState.iteration_count);
  assert.equal(
    sessionState.iterations.some((entry) =>
      ["refine_questions", "expand_domains", "requisition"].includes(entry.strategy)
    ),
    true
  );
});

test("research_workflow materialize_idea_catalyst_state downgrades placeholder requisitions to pending when no concrete source domains can be derived", async (t) => {
  const projectRoot = await makeCatalystProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) delete process.env.OPENCLAW_PROJECT;
    else process.env.OPENCLAW_PROJECT = previousProjectRoot;
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const graphPacketPath = path.join(
    projectRoot,
    "researcher",
    "ideation",
    "GRAPH_IDEATION_PACKET.json"
  );
  await writeJson(graphPacketPath, {
    target_domain: "Computer Science",
    challenge_clusters: ["memory preservation"],
    transfer_bridges: [],
    candidate_domains: [],
    bridge_nodes: [],
  });
  await writeJson(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "TOPIC_SUMMARY.json"),
    {
      target_domain: "Computer Science",
      candidate_domains: [],
    }
  );
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.ideation_contract.graph_ideation_indices.transfer_bridges = [];
  manifest.ideation_contract.graph_ideation_indices.challenge_clusters = [
    "memory preservation",
  ];
  await writeJson(manifestPath, manifest);

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  const result = await executeWorkflowTool(tool, {
    action: "materialize_idea_catalyst_state",
    ideaCatalystMaterialization: {
      basis_stage: "idea",
    },
  });

  assert.equal(result.state.status, "pending");
  assert.equal(result.state.requisitionRequired, false);
  assert.match(
    result.state.pendingReason ?? "",
    /no concrete source domains|structured papernexus/i
  );

  const gateDecision = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "idea-catalyst", "GATE_DECISION.json"),
      "utf8"
    )
  );
  assert.equal(gateDecision.decision, "requisition");
  assert.equal(gateDecision.requisition.actionable, false);
  assert.equal(gateDecision.requisition.missing_domains.length, 0);
});

test("research_workflow queue_idea_catalyst_requisition bridges a catalyst requisition into durable paper_ingestion queued requests", async (t) => {
  const projectRoot = await makeCatalystProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) delete process.env.OPENCLAW_PROJECT;
    else process.env.OPENCLAW_PROJECT = previousProjectRoot;
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  const graphPacketPath = path.join(
    projectRoot,
    "researcher",
    "ideation",
    "GRAPH_IDEATION_PACKET.json"
  );
  await writeJson(graphPacketPath, {
    target_domain: "Computer Science",
    challenge_clusters: ["memory preservation"],
    transfer_bridges: [],
  });
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.ideation_contract.graph_ideation_indices.transfer_bridges = [];
  await writeJson(manifestPath, manifest);
  await executeWorkflowTool(tool, {
    action: "materialize_idea_catalyst_state",
    ideaCatalystMaterialization: {
      basis_stage: "idea",
      target_domain: "Computer Science",
    },
  });

  const result = await executeWorkflowTool(tool, {
    action: "queue_idea_catalyst_requisition",
  });

  assert.equal(result.created ?? false, true);
  assert.equal(result.request.triggerKind, "idea_catalyst_requisition");
  assert.match(result.request.requestId, /^idea-catalyst-/);
  assert.match(result.request.summary ?? "", /IDEA-CATALYST/i);
  assert.match(result.request.commandText ?? "", /INVESTIGATION_REQUISITION\.json/);
  assert.match(result.request.commandText ?? "", /graph-build/i);

  const updatedManifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.ok(Array.isArray(updatedManifest.paper_ingestion?.queued_requests));
  assert.equal(updatedManifest.paper_ingestion.queued_requests.length >= 1, true);
  assert.equal(
    updatedManifest.paper_ingestion.queued_requests[0].trigger_kind,
    "idea_catalyst_requisition"
  );
  assert.equal(updatedManifest.idea_catalyst.requisition_required, true);
  assert.equal(
    updatedManifest.idea_catalyst.last_requisition_cycle,
    result.request.requestId.replace(/^idea-catalyst-/, "")
  );
  assert.equal(updatedManifest.idea_catalyst.requisition_retry_budget, 2);
  assert.equal(updatedManifest.idea_catalyst.requisition_saturated, false);
});

test("research_workflow queue_idea_catalyst_requisition skips non-actionable placeholder requisitions", async (t) => {
  const projectRoot = await makeCatalystProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) delete process.env.OPENCLAW_PROJECT;
    else process.env.OPENCLAW_PROJECT = previousProjectRoot;
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.idea_catalyst = {
    ...manifest.idea_catalyst,
    status: "requisition",
    micro_stage: "gatekeeping",
    requisition_required: true,
    pending_reason: "Placeholder requisition awaiting reconciliation.",
  };
  await writeJson(manifestPath, manifest);
  await writeJson(
    path.join(projectRoot, "researcher", "idea-catalyst", "INVESTIGATION_REQUISITION.json"),
    {
      actionable: false,
      requisition_id: "req-placeholder",
      target_domain: "Computer Science",
      missing_domains: [],
      search_queries: [],
      non_actionable_reason:
        "No concrete source domains or structured PaperNexus bridge evidence are available yet.",
    }
  );

  const result = await executeWorkflowTool(tool, {
    action: "queue_idea_catalyst_requisition",
  });

  assert.equal(result.created, false);
  assert.match(result.reason ?? "", /not actionable|no concrete source domains/i);

  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(updatedManifest.idea_catalyst.status, "pending");
  assert.equal(updatedManifest.idea_catalyst.requisition_required, false);
  assert.equal(updatedManifest.paper_ingestion?.queued_requests?.length ?? 0, 0);
});

test("research_workflow queue_idea_catalyst_requisition decrements retry budget and saturates repeated requisition retries", async (t) => {
  const projectRoot = await makeCatalystProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) delete process.env.OPENCLAW_PROJECT;
    else process.env.OPENCLAW_PROJECT = previousProjectRoot;
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  await writeJson(
    path.join(projectRoot, "researcher", "ideation", "GRAPH_IDEATION_PACKET.json"),
    {
      target_domain: "Computer Science",
      challenge_clusters: ["memory preservation"],
      transfer_bridges: [],
    }
  );
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.ideation_contract.graph_ideation_indices.transfer_bridges = [];
  await writeJson(manifestPath, manifest);

  await executeWorkflowTool(tool, {
    action: "materialize_idea_catalyst_state",
    ideaCatalystMaterialization: {
      basis_stage: "idea",
    },
  });

  const first = await executeWorkflowTool(tool, {
    action: "queue_idea_catalyst_requisition",
  });
  assert.equal(first.created, true);

  await executeWorkflowTool(tool, {
    action: "set_paper_ingestion",
    paperIngestion: {
      queued_requests: [
        {
          request_id: first.request.requestId,
          status: "failed",
          trigger_kind: "idea_catalyst_requisition",
          detail: "first catalyst retry failed",
        },
      ],
    },
  });

  const second = await executeWorkflowTool(tool, {
    action: "queue_idea_catalyst_requisition",
  });
  assert.equal(second.created, true);

  await executeWorkflowTool(tool, {
    action: "set_paper_ingestion",
    paperIngestion: {
      queued_requests: [
        {
          request_id: second.request.requestId,
          status: "failed",
          trigger_kind: "idea_catalyst_requisition",
          detail: "second catalyst retry failed",
        },
      ],
    },
  });

  const third = await executeWorkflowTool(tool, {
    action: "queue_idea_catalyst_requisition",
  });
  assert.equal(third.created, false);
  assert.match(third.reason ?? "", /retry budget is exhausted/i);

  const finalManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(finalManifest.idea_catalyst.requisition_retry_budget, 0);
  assert.equal(finalManifest.idea_catalyst.requisition_saturated, true);
});
