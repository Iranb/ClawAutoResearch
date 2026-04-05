import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPluginRegistrationContext } from "../tools/plugin-registration-shared.ts";
import { registerWorkflowTools } from "../tools/register-workflow-tools.ts";
import { maybePrepareWorkflowStageContracts } from "../tools/workflow-guard-runtime/stage-preflight.ts";
import { materializeIdeationContract } from "../tools/workflow-guard.ts";
import { materializeIdeaCatalystState } from "../tools/idea-catalyst/materializers.ts";
import { materializePaperStoryState, materializeReviewPressurePacket } from "../tools/workflow-guard.ts";
import { materializeLiteratureDiscoveryPacket } from "../tools/literature-discovery/materializer.ts";
import { queueIdeaCatalystRequisition } from "../tools/idea-catalyst/workflow-bridge.ts";
import { queueLiteratureDiscoveryRequisition } from "../tools/literature-discovery/workflow-bridge.ts";
import { materializePapernexusPacketContracts } from "../tools/papernexus-packets/materializer.ts";

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

async function makeProjectRoot() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-papernexus-packets-")
  );
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "packet-demo",
    current_stage: "write",
    owner_agent: "academic_writer",
    research_program: {
      status: "ready",
      goal: "Use graph-native interdisciplinary packets to strengthen GCD writing and ideation.",
      problem_statement:
        "Generalized category discovery still lacks a disciplined cross-domain and story-grounded workflow.",
      baseline_reference: "SimGCD",
      primary_metric: "ACC",
      datasets: ["CIFAR100"],
      success_criteria: ["Beat baseline ACC by 2 points"],
      zotero_project_path: "bot/packet-demo",
    },
    ideation_contract: {
      status: "ready",
      contract_version: 1,
      long_term_goal: "Build graph-native interdisciplinary research directions.",
      problem_scope: "GCD cross-domain ideation",
      basis_stage: "idea",
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
        novelty_candidate_clusters: ["open-world discovery under shift"],
        challenge_clusters: ["memory preservation"],
        insight_clusters: ["uncertainty gating"],
        occupied_solution_zones: ["occupied:plain contrastive baseline"],
        transfer_bridges: ["psychology:metacontrol"],
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
    writing_contract: {
      paper_mode: "conference",
      template_required: false,
      kg_storyline_required: false,
      kg_storyline_status: "missing",
    },
    paper_story_state: {
      status: "ready",
      contract_version: 1,
      story_spine_path: "academic_writer/story/STORY_SPINE.md",
      claim_to_experiment_map_path: "academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md",
      fallback_narrative_path: "academic_writer/story/FALLBACK_NARRATIVE.md",
      rejection_risk_table_path: "academic_writer/story/REJECTION_RISK_TABLE.md",
      claim_support_status: "partial",
      supported_claim_count: 1,
      partial_claim_count: 1,
      unsupported_claim_count: 1,
      storyline_source_track_id: "track-main",
    },
    review_pressure_packet: {
      status: "ready",
      reject_first_review_path: "reviewer/story-pressure/REJECT_FIRST_REVIEW.md",
      novelty_attack_path: "reviewer/story-pressure/NOVELTY_ATTACK.md",
      unsupported_claim_audit_path: "reviewer/story-pressure/UNSUPPORTED_CLAIM_AUDIT.md",
      reverse_outline_path: "reviewer/story-pressure/REVERSE_OUTLINE.md",
      figure_table_qc_path: "reviewer/story-pressure/FIGURE_TABLE_QC.md",
      limitation_audit_path: "reviewer/story-pressure/LIMITATION_AUDIT.md",
    },
    paper_ingestion: {
      runtime_status: "idle",
      queued_requests: [],
    },
  });

  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), {
    tracks: [
      {
        track_id: "track-main",
        status: "active",
        question:
          "How can GCD retain support evidence while adapting across distant domains?",
        hypothesis:
          "Metacontrol-inspired support routing can stabilize adaptation under domain shift.",
        novelty_basis: "Transfer metacontrol from psychology and curriculum relay from robotics.",
        graph_backed_evidence: true,
      },
    ],
  });

  await writeText(path.join(projectRoot, "researcher", "FRONTIER_REPORT.md"), "# Frontier\n");
  await writeText(path.join(projectRoot, "graph", "ANCHOR_INDEX.md"), "# Anchor\n");
  await writeText(path.join(projectRoot, "graph", "LIMITATION_FRONTIER.md"), "- limitation\n");
  await writeText(path.join(projectRoot, "graph", "TRANSFER_FRONTIER.md"), "- psychology:metacontrol\n");
  await writeText(path.join(projectRoot, "researcher", "brainstorm-cycle", "LOGIC_CHAIN.md"), "# Logic\n");
  await writeText(path.join(projectRoot, "researcher", "brainstorm-cycle", "EVIDENCE_CHAIN.md"), "# Evidence\n");
  await writeJson(path.join(projectRoot, "researcher", "brainstorm-cycle", "TOPIC_SUMMARY.json"), {
    target_domain: "Computer Science",
    candidate_domains: ["Psychology"],
  });
  await writeJson(path.join(projectRoot, "researcher", "brainstorm-cycle", "STORYLINE_BRIEF.json"), {
    thesis: "A graph-native support router improves GCD.",
    arc: "challenge -> mechanism -> evidence",
  });
  await writeJson(path.join(projectRoot, "researcher", "ideation", "GRAPH_IDEATION_PACKET.json"), {
    target_domain: "Computer Science",
    challenge_clusters: ["memory preservation"],
    transfer_bridges: ["psychology:metacontrol"],
  });
  await writeJson(path.join(projectRoot, "researcher", "ideation", "CANDIDATE_POOL.json"), {
    candidates: [
      {
        direction_id: "dir-main",
        track_id: "track-main",
        title: "Psychology metacontrol for support routing",
        summary: "Use metacontrol to decide when to preserve evidence anchors.",
        novelty: 0.86,
        feasibility: 0.72,
        relevance: 0.84,
        clarity: 0.81,
        composite_score: 0.8075,
        status: "surviving",
      },
    ],
  });
  await writeJson(path.join(projectRoot, "researcher", "ideation", "RANKING_HISTORY.json"), { comparisons: [] });
  await writeJson(path.join(projectRoot, "researcher", "ideation", "TOURNAMENT_SCOREBOARD.json"), { rounds: [] });
  await writeText(path.join(projectRoot, "researcher", "ideation", "TOP3_DIRECTION_SUMMARY.md"), "# Top3\n");
  await writeText(path.join(projectRoot, "researcher", "ideation", "RESEARCH_PROPOSAL.md"), "# Proposal\n");
  await writeText(path.join(projectRoot, "researcher", "ideation", "PROBLEM_DECOMPOSITION.md"), "# Decomposition\n");

  await writeJson(
    path.join(projectRoot, "researcher", "papernexus", "MECHANISM_BRIDGE_PACKET.json"),
    {
      target_domain: "Computer Science",
      candidate_domains: ["Psychology", "Robotics", "Economics"],
      selected_domains: ["Psychology", "Robotics"],
      pruned_domains: ["Economics"],
      bridge_evidence_tier: "strong",
      transfer_bridges: [
        "psychology:metacontrol policy",
        "robotics:curriculum relay",
      ],
      bridge_nodes: [
        {
          node_id: "bridge-psy",
          node_name: "metacontrol policy",
          domain: "Psychology",
          mechanism: "adaptive control",
          properties: {
            abstract:
              "Psychology frames metacontrol as adaptive choice between persistence and flexibility.",
            evidenceText:
              "The mechanism balances preserving old strategies with adapting to new demands.",
          },
        },
        {
          node_id: "bridge-robotics",
          node_name: "curriculum relay",
          domain: "Robotics",
          mechanism: "curriculum relay",
          properties: {
            abstract:
              "Robotics uses curriculum relay to stage transfer from stable subtasks into harder ones.",
          },
        },
      ],
      domain_distance_matrix: {
        "computer science": {
          psychology: 0.81,
          robotics: 0.74,
          economics: 0.32,
        },
      },
    }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "papernexus", "CHALLENGE_INSIGHT_PACKET.json"),
    {
      challenge_clusters: [
        "preserve evidence anchors under domain shift",
        "avoid over-adaptation during open-world updates",
      ],
      insight_clusters: [
        "metacontrol chooses preservation vs adaptation",
        "curriculum relay stages transfer progressively",
      ],
      occupied_solution_zones: ["occupied:contrastive-only adaptation"],
    }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "papernexus", "GRAPH_STORYLINE_PACKET.json"),
    {
      task_summary:
        "Build a graph-grounded support-routing method for generalized category discovery.",
      challenge_statement:
        "Current GCD systems adapt too aggressively and lose support anchors needed for defensible claims.",
      insight_summary:
        "Cross-domain metacontrol and curriculum relay suggest routing when to preserve evidence vs adapt.",
      contribution_bullets: [
        "A graph-grounded support router",
        "A claim-evidence alignment layer",
      ],
      advantage_bullets: [
        "Improves support precision while staying baseline-comparable",
        "Turns interdisciplinary bridges into auditable story structure",
      ],
      module_motivations: [
        {
          module: "support router",
          motivation: "Prevent support drift during domain adaptation",
          design: "Use bridge evidence to route preservation vs adaptation",
          advantage: "Keeps claims defensible",
        },
      ],
      evidence_coverage_status: "covered",
      covered_headline_claim_count: 3,
      total_headline_claim_count: 3,
      missing_claims: [],
      claim_evidence_packet_paths: [
        "analyzer/CLAIM_EVIDENCE_MATRIX.md",
      ],
      limitation_boundaries: [
        "The gain is bounded to support routing under the unchanged baseline protocol.",
      ],
      related_work_tension: [
        "Existing GCD methods emphasize adaptation but under-specify support preservation.",
      ],
    }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "literature-discovery", "LITERATURE_DISCOVERY_PACKET.json"),
    {
      discovery_id: "disc-001",
      discovery_reason: "Need contradiction and limitation evidence from robotics transfer literature.",
      target_domains: ["Robotics"],
      candidate_queries: [
        {
          domain: "Robotics",
          query: "curriculum relay contradiction limitation transfer learning",
        },
      ],
      required_stage_reentry: ["graph_build", "frontier_mapping", "idea"],
      selected_papers: [],
      trigger_kind: "idea_catalyst_requisition",
      status: "ready",
    }
  );

  return projectRoot;
}

test("research_workflow materialize_papernexus_packet_contracts syncs PaperNexus packets into ideation and writing contracts", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) delete process.env.OPENCLAW_PROJECT;
    else process.env.OPENCLAW_PROJECT = previousProjectRoot;
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  const result = await executeWorkflowTool(tool, {
    action: "materialize_papernexus_packet_contracts",
  });

  assert.equal(result.state.mechanismBridgePacketReady, true);
  assert.equal(result.state.challengeInsightPacketReady, true);
  assert.equal(result.state.graphStorylinePacketReady, true);
  assert.ok(
    result.generatedFiles.some((entry) =>
      /academic_writer\/KG_STORYLINE_PACKET\.md$/.test(entry)
    )
  );

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.deepEqual(
    manifest.ideation_contract.graph_ideation_indices.selected_source_domains,
    ["Psychology", "Robotics"]
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
  assert.equal(manifest.writing_contract.kg_storyline_required, true);
  assert.equal(manifest.writing_contract.kg_storyline_status, "ready");
  assert.equal(
    manifest.graph_guided_writing.evidence_coverage_status,
    "covered"
  );
  assert.deepEqual(manifest.graph_guided_writing.missing_evidence_claims, []);

  const kgStorylineMarkdown = await fs.readFile(
    path.join(projectRoot, "academic_writer", "KG_STORYLINE_PACKET.md"),
    "utf8"
  );
  assert.match(kgStorylineMarkdown, /graph-grounded support-routing method/i);
  assert.match(kgStorylineMarkdown, /metacontrol and curriculum relay/i);
});

test("stage preflight syncs PaperNexus packets and queues a packet-backed literature discovery requisition", async (t) => {
  const projectRoot = await makeProjectRoot();
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.owner_agent = "researcher";
  await writeJson(manifestPath, manifest);

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await maybePrepareWorkflowStageContracts({
    projectRoot,
    manifest,
    stage: "idea",
    trigger: "test",
    agentId: "researcher",
    deps: {
      materializeIdeationContract,
      materializePaperStoryState,
      materializeReviewPressurePacket,
      materializeIdeaCatalystState,
      materializeLiteratureDiscoveryPacket,
      materializePapernexusPacketContracts,
      queueIdeaCatalystRequisition,
      queueLiteratureDiscoveryRequisition,
    },
  });

  assert.equal(result.errors.length, 0);
  assert.ok(result.materializedContracts.includes("papernexus_packet_contracts"));
  assert.ok(result.materializedContracts.includes("literature_discovery_requisition"));

  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(
    updatedManifest.writing_contract.kg_storyline_status,
    "ready"
  );
  assert.equal(
    updatedManifest.paper_ingestion.queued_requests.some(
      (entry) =>
        entry.trigger_kind === "idea_catalyst_requisition" &&
        /disc-001/i.test(entry.request_id)
    ),
    true
  );
});
