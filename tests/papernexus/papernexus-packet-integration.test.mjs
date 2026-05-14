import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPluginRegistrationContext } from "../../tools/plugin-registration-shared.ts";
import { registerWorkflowTools } from "../../tools/register-workflow-tools.ts";
import { maybePrepareWorkflowStageContracts } from "../../tools/workflow-guard-runtime/stage-preflight.ts";
import { materializeIdeationContract } from "../../tools/workflow-guard.ts";
import { materializeIdeaCatalystState } from "../../tools/idea-catalyst/materializers.ts";
import { materializePaperStoryState, materializeReviewPressurePacket } from "../../tools/workflow-guard.ts";
import { materializeLiteratureDiscoveryPacket } from "../../tools/literature-discovery/materializer.ts";
import { queueIdeaCatalystRequisition } from "../../tools/idea-catalyst/workflow-bridge.ts";
import { queueLiteratureDiscoveryRequisition } from "../../tools/literature-discovery/workflow-bridge.ts";
import { materializePapernexusPacketContracts } from "../../tools/papernexus-packets/materializer.ts";
import { resolveExperimentPlanCompletion } from "../../tools/workflow-stage-completion.ts";
import {
  DEFAULT_GRAPH_BUILD_DECISION_PATH,
  DEFAULT_IDEA_CATALYST_CONTRACT_PATH,
} from "../../tools/workflow-authority-registry.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

async function writeAuthorityCascadeInputs(projectRoot) {
  const reportPath =
    "researcher/literature-discovery/requisition/req-packet-demo/REQUISITION_SATISFACTION_REPORT.json";
  await writeJson(path.join(projectRoot, reportPath), {
    schema_version: 1,
    authority: "literature_requisition_satisfaction",
    status: "valid",
    decision: "satisfied_remote_import_evidence",
    request_id: "req-packet-demo",
    selected_paper_count: 1,
    candidate_paper_count: 1,
    source_backed_count: 1,
    metadata_only_count: 0,
    evidence_gap_closed: true,
  });
  await writeJson(path.join(projectRoot, "researcher", "literature-discovery", "LITERATURE_DISCOVERY_PACKET.json"), {
    status: "completed",
    selected_papers: [{ canonical_id: "paper:belief-updating" }],
  });
  await writeJson(path.join(projectRoot, DEFAULT_GRAPH_BUILD_DECISION_PATH), {
    schema_version: 1,
    authority: "graph_build_decision",
    decision: "complete",
    status: "complete",
    request_id: "req-packet-demo",
    requisition_satisfaction_report_path: reportPath,
    graph_presence_report_path: "graph/GRAPH_PRESENCE_CHECK.json",
    graph_receipt_path: "graph/PAPERNEXUS_GRAPH_BUILD_RECEIPT.json",
    source_index_path: "researcher/PAPER_SOURCE_INDEX.json",
    source_backed_graph_claim: true,
    reason: "fixture graph decision",
    limitations: [],
    created_at: "2026-05-14T00:00:00.000Z",
    updated_at: "2026-05-14T00:00:00.000Z",
  });
}

function buildIdeaCatalystPacketBundleFixture() {
  return {
    contractVersion: "idea-catalyst-packet-bundle-v1",
    decomposition: {
      coarse_grained_domain: "Computer Science",
      fine_grained_domain: "Generalized Category Discovery",
      core_challenge: "preserve evidence anchors under open-world shift",
      research_questions: [
        {
          question_id: "rq-1",
          domain_specific_question:
            "How can GCD preserve evidence anchors under open-world shift?",
          domain_agnostic_question:
            "How can a learning system preserve support evidence while adapting under shifting environments?",
          rationale:
            "Current graph evidence shows strong adaptation methods but weak support-preservation mechanisms.",
          target_domain_queries: [
            "Generalized Category Discovery preserve evidence anchors",
            "GCD support preservation under open-world shift",
            "open-world category discovery support evidence mechanism",
          ],
        },
      ],
      questions: [
        {
          question_id: "rq-1",
          domain_specific_question:
            "How can GCD preserve evidence anchors under open-world shift?",
          domain_agnostic_question:
            "How can a learning system preserve support evidence while adapting under shifting environments?",
          rationale:
            "Current graph evidence shows strong adaptation methods but weak support-preservation mechanisms.",
          target_domain_queries: [
            "Generalized Category Discovery preserve evidence anchors",
            "GCD support preservation under open-world shift",
            "open-world category discovery support evidence mechanism",
          ],
        },
      ],
    },
    target_domain_analysis: [
      {
        target_domain: "Computer Science",
        fine_grained_domain: "Generalized Category Discovery",
        addressed_aspects: [
          {
            sub_question:
              "How can GCD preserve evidence anchors under open-world shift?",
            evidence:
              "Existing GCD methods partially address adaptation but not explicit support preservation.",
          },
        ],
        remaining_challenges: [
          {
            challenge_id: "challenge-1",
            domain_specific_challenge_question:
              "How can GCD preserve evidence anchors under open-world shift?",
            domain_agnostic_challenge_question:
              "How can a learning system preserve support evidence while adapting under shifting environments?",
            why_unaddressed:
              "The graph shows no stable bridge between adaptation quality and support-evidence retention.",
            importance: "high",
          },
        ],
        overall_assessment: "partially addressed",
      },
    ],
    cross_domain_queries: [
      {
        domain: "Psychology",
        domain_rationale:
          "Psychology provides metacontrol theories for preserving vs adapting behavior.",
        queries: [
          "Psychology metacontrol support preservation adaptation",
          "metacontrol flexibility persistence evidence retention",
        ],
        shared_mechanisms: ["metacontrol policy"],
        supporting_papers: ["Belief Updating Under Uncertainty"],
      },
      {
        domain: "Robotics",
        domain_rationale:
          "Robotics contributes curriculum relay strategies for staged transfer.",
        queries: [
          "Robotics curriculum relay transfer support preservation",
          "curriculum relay staged adaptation stability",
        ],
        shared_mechanisms: ["curriculum relay"],
        supporting_papers: ["Curriculum Relay for Staged Transfer"],
      },
    ],
    cross_domain_searches: [
      {
        domain: "Psychology",
        domain_rationale:
          "Psychology provides metacontrol theories for preserving vs adapting behavior.",
        queries: [
          "Psychology metacontrol support preservation adaptation",
          "metacontrol flexibility persistence evidence retention",
        ],
        shared_mechanisms: ["metacontrol policy"],
        supporting_papers: ["Belief Updating Under Uncertainty"],
      },
      {
        domain: "Robotics",
        domain_rationale:
          "Robotics contributes curriculum relay strategies for staged transfer.",
        queries: [
          "Robotics curriculum relay transfer support preservation",
          "curriculum relay staged adaptation stability",
        ],
        shared_mechanisms: ["curriculum relay"],
        supporting_papers: ["Curriculum Relay for Staged Transfer"],
      },
    ],
    source_domain_analyses: [
      {
        source_domain: "Psychology",
        domain_rationale:
          "Psychology provides metacontrol theories for preserving vs adapting behavior.",
        shared_mechanisms: ["metacontrol policy"],
        supporting_papers: ["Belief Updating Under Uncertainty"],
        takeaways: [
          {
            concept: "metacontrol policy",
            source_domain_formulation:
              "Metacontrol balances persistence and flexibility under uncertainty.",
            mechanism_explanation:
              "A controller chooses when to preserve prior evidence versus adapt to new signals.",
            selection_rationale:
              "Selected because it directly matches the support-preservation vs adaptation tradeoff.",
            relevance_to_challenge:
              "Maps onto deciding when GCD should preserve support anchors.",
            supporting_papers: ["Belief Updating Under Uncertainty"],
            kg_node_id: "bridge-psy",
            bridge_path_ids: ["bridge-psy-path"],
            evidence_chain_refs: [
              { ref_id: "chain-psy-1", node_id: "bridge-psy" },
            ],
            source_spans: [
              { span_id: "span-psy-1", snippet_node_id: "snippet-psy-1" },
            ],
            path_trace: [{ from: "Psychology", to: "Computer Science" }],
            path_completeness: 0.86,
            evidence_density: 0.78,
            mechanism_support_density: 0.74,
            evidence_tier: "strong",
          },
        ],
        domain_distance: 0.81,
        path_completeness: 0.86,
        evidence_density: 0.78,
        mechanism_support_density: 0.74,
        interdisciplinary_potential: 0.92,
        selection_rationale:
          "Metacontrol is the strongest graph-backed bridge for support-preserving adaptation.",
      },
      {
        source_domain: "Robotics",
        domain_rationale:
          "Robotics contributes curriculum relay strategies for staged transfer.",
        shared_mechanisms: ["curriculum relay"],
        supporting_papers: ["Curriculum Relay for Staged Transfer"],
        takeaways: [
          {
            concept: "curriculum relay",
            source_domain_formulation:
              "Curriculum relay stages stable subskills before harder transfer.",
            mechanism_explanation:
              "Transfer is stabilized by relaying progressively harder support conditions.",
            selection_rationale:
              "Selected because staged relay offers a second bridge for preserving support quality.",
            relevance_to_challenge:
              "Suggests a staged route for preserving anchors before full adaptation.",
            supporting_papers: ["Curriculum Relay for Staged Transfer"],
            kg_node_id: "bridge-robotics",
            bridge_path_ids: ["bridge-robotics-path"],
            evidence_chain_refs: [
              { ref_id: "chain-robotics-1", node_id: "bridge-robotics" },
            ],
            source_spans: [
              { span_id: "span-robotics-1", snippet_node_id: "snippet-robotics-1" },
            ],
            path_trace: [{ from: "Robotics", to: "Computer Science" }],
            path_completeness: 0.8,
            evidence_density: 0.72,
            mechanism_support_density: 0.7,
            evidence_tier: "strong",
          },
        ],
        domain_distance: 0.74,
        path_completeness: 0.8,
        evidence_density: 0.72,
        mechanism_support_density: 0.7,
        interdisciplinary_potential: 0.84,
        selection_rationale:
          "Curriculum relay complements metacontrol with staged transfer structure.",
      },
    ],
    cross_domain_analysis: [
      {
        source_domain: "Psychology",
        domain_rationale:
          "Psychology provides metacontrol theories for preserving vs adapting behavior.",
        shared_mechanisms: ["metacontrol policy"],
        supporting_papers: ["Belief Updating Under Uncertainty"],
        takeaways: [
          {
            concept: "metacontrol policy",
            source_domain_formulation:
              "Metacontrol balances persistence and flexibility under uncertainty.",
            mechanism_explanation:
              "A controller chooses when to preserve prior evidence versus adapt to new signals.",
            selection_rationale:
              "Selected because it directly matches the support-preservation vs adaptation tradeoff.",
            relevance_to_challenge:
              "Maps onto deciding when GCD should preserve support anchors.",
            supporting_papers: ["Belief Updating Under Uncertainty"],
            kg_node_id: "bridge-psy",
            bridge_path_ids: ["bridge-psy-path"],
            evidence_chain_refs: [
              { ref_id: "chain-psy-1", node_id: "bridge-psy" },
            ],
            source_spans: [
              { span_id: "span-psy-1", snippet_node_id: "snippet-psy-1" },
            ],
            path_trace: [{ from: "Psychology", to: "Computer Science" }],
            path_completeness: 0.86,
            evidence_density: 0.78,
            mechanism_support_density: 0.74,
            evidence_tier: "strong",
          },
        ],
        domain_distance: 0.81,
        path_completeness: 0.86,
        evidence_density: 0.78,
        mechanism_support_density: 0.74,
        interdisciplinary_potential: 0.92,
        selection_rationale:
          "Metacontrol is the strongest graph-backed bridge for support-preserving adaptation.",
      },
    ],
    idea_fragments: [
      {
        rank: 1,
        title: "Psychology bridge for Computer Science",
        source_domain: "Psychology",
        target_challenge: "preserve evidence anchors under open-world shift",
        core_insight:
          "Metacontrol can decide when to preserve support anchors versus adapt to new evidence.",
        integration_mechanism: "metacontrol policy",
        challenge_resolution:
          "Use metacontrol to route preservation vs adaptation decisions inside GCD.",
        concrete_realization:
          "Operationalize metacontrol as a support router over anchor updates.",
        source_takeaways: ["metacontrol policy"],
        supporting_papers: ["Belief Updating Under Uncertainty"],
        bridge_path_ids: ["bridge-psy-path"],
        evidence_chain_refs: [
          { ref_id: "chain-psy-1", node_id: "bridge-psy" },
        ],
        source_spans: [
          { span_id: "span-psy-1", snippet_node_id: "snippet-psy-1" },
        ],
        path_completeness: 0.86,
        evidence_density: 0.78,
        mechanism_support_density: 0.74,
        ranking_signals: {
          interdisciplinary_potential: 0.92,
        },
        idea_fragment: {
          title: "Psychology bridge for Computer Science",
          core_insight:
            "Metacontrol can decide when to preserve support anchors versus adapt to new evidence.",
          integration_mechanism: "metacontrol policy",
          challenge_resolution:
            "Use metacontrol to route preservation vs adaptation decisions inside GCD.",
          concrete_realization:
            "Operationalize metacontrol as a support router over anchor updates.",
        },
      },
    ],
    interdisciplinary_ranking: {
      ranking_criteria: [
        "DEPTH OF INTEGRATION",
        "MULTI-STAGE DISCIPLINARY ENGAGEMENT",
        "INNOVATION PAYOFF",
        "NOVELTY + FEASIBILITY",
      ],
      ranked_candidates: [
        {
          rank: 1,
          source_domain: "Psychology",
          interdisciplinary_potential: 0.92,
          depth_of_integration: 0.88,
          multi_stage_disciplinary_engagement: 0.86,
          innovation_payoff: 0.9,
          novelty_plus_feasibility: 0.83,
          supporting_papers: ["Belief Updating Under Uncertainty"],
          shared_mechanisms: ["metacontrol policy"],
          rationale:
            "Psychology provides the strongest bridge for the target challenge.",
        },
      ],
    },
    requisition_report: null,
  };
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
      fixed_budget: "5 minute CPU trial",
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

test("queueing a literature discovery requisition preserves graph presence manifest fields", async (t) => {
  const projectRoot = await makeProjectRoot();
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const checkedAt = "2026-05-10T12:00:00.000Z";
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "submit";
  manifest.owner_agent = "reviewer";
  manifest.paper_ingestion = {
    runtime_status: "ready",
    graph_presence_checked_at: checkedAt,
    graph_presence_status: "ready",
    graph_presence_report_path: "graph/GRAPH_PRESENCE_CHECK.json",
    graph_presence_expected_papers: 5,
    graph_presence_present_papers: 5,
    graph_presence_missing_papers: [],
    papernexus_certification_status: "ready",
    papernexus_claim_level: "source_backed_graph",
    queued_requests: [],
  };
  await writeJson(manifestPath, manifest);
  await writeJson(
    path.join(projectRoot, "researcher", "literature-discovery", "LITERATURE_DISCOVERY_PACKET.json"),
    {
      schema_version: 1,
      discovery_id: "submit-story-support-gap",
      discovery_reason: "submit_story_support_gap",
      target_domains: ["Generalized Category Discovery"],
      candidate_queries: [{ query: "gcd limitation evidence" }],
      candidate_papers: [],
      selected_papers: [],
      required_stage_reentry: ["graph_build", "submit"],
    }
  );

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const queued = await queueLiteratureDiscoveryRequisition({
    projectRoot,
    packetPath: "researcher/literature-discovery/LITERATURE_DISCOVERY_PACKET.json",
    triggerKind: "submit_literature_discovery",
    originStage: "submit",
    requestIdPrefix: "submit-story-support-gap",
  });

  assert.equal(queued.created, true);
  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(updatedManifest.paper_ingestion.graph_presence_status, "ready");
  assert.equal(updatedManifest.paper_ingestion.graph_presence_checked_at, checkedAt);
  assert.equal(updatedManifest.paper_ingestion.graph_presence_present_papers, 5);
  assert.equal(updatedManifest.paper_ingestion.papernexus_claim_level, "source_backed_graph");
  assert.equal(updatedManifest.paper_ingestion.queued_requests.length, 1);
  assert.equal(
    updatedManifest.paper_ingestion.queued_requests[0].trigger_kind,
    "submit_literature_discovery"
  );
});

test("research_workflow materialize_papernexus_packet_contracts bridges a PaperNexus bundle through idea contract authority", async (t) => {
  const projectRoot = await makeProjectRoot();
  await fs.rm(
    path.join(projectRoot, "researcher", "papernexus", "MECHANISM_BRIDGE_PACKET.json"),
    { force: true }
  );
  await fs.rm(
    path.join(projectRoot, "researcher", "papernexus", "CHALLENGE_INSIGHT_PACKET.json"),
    { force: true }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "papernexus", "IDEA_CATALYST_PACKET_BUNDLE.json"),
    buildIdeaCatalystPacketBundleFixture()
  );
  await writeAuthorityCascadeInputs(projectRoot);

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await materializePapernexusPacketContracts({
    projectRoot,
    trigger: "bundle-test",
    agentId: "researcher",
  });

  assert.equal(result.state.ideaCatalystPacketBundleReady, true);
  assert.equal(result.state.ideaCatalystContractReady, true);
  assert.equal(result.state.mechanismBridgePacketReady, true);
  assert.equal(result.state.challengeInsightPacketReady, true);
  assert.equal(result.state.innovationPacketReady, true);
  assert.ok(
    result.generatedFiles.includes(DEFAULT_IDEA_CATALYST_CONTRACT_PATH)
  );
  assert.ok(result.generatedFiles.includes("orchestrator/INNOVATION_PACKET.json"));

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(
    manifest.ideation_contract.graph_ideation_indices.candidate_source_domains.includes(
      "Psychology"
    ),
    true
  );
  assert.equal(
    manifest.ideation_contract.graph_ideation_indices.selected_source_domains.includes(
      "Psychology"
    ),
    true
  );
  assert.equal(
    manifest.ideation_contract.graph_ideation_indices.transfer_bridges.some((entry) =>
      /Psychology:metacontrol policy/i.test(entry)
    ),
    true
  );

  const innovationPacket = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "orchestrator", "INNOVATION_PACKET.json"),
      "utf8"
    )
  );
  assert.match(innovationPacket.selected_idea_fragment_id, /^psychology-1$/);
  assert.equal(innovationPacket.baseline, "SimGCD");
  assert.equal(innovationPacket.primary_metric, "ACC");
  assert.equal(innovationPacket.fixed_budget, "5 minute CPU trial");
  assert.equal(innovationPacket.source_domains.includes("Psychology"), true);
  assert.equal(
    innovationPacket.supporting_papers.includes("Belief Updating Under Uncertainty"),
    true
  );
  assert.equal(innovationPacket.supporting_kg_nodes.includes("bridge-psy"), true);
  assert.equal(
    innovationPacket.evidence_paths.includes(
      DEFAULT_IDEA_CATALYST_CONTRACT_PATH
    ),
    true
  );
  assert.equal(
    innovationPacket.evidence_paths.includes(
      "researcher/papernexus/IDEA_CATALYST_PACKET_BUNDLE.json"
    ),
    true
  );

  const experimentPlanCompletion =
    await resolveExperimentPlanCompletion(projectRoot);
  assert.equal(experimentPlanCompletion.completionStatus, "complete");
  assert.equal(experimentPlanCompletion.nextAction, "/run-experiment");

  const derivedMechanismPacket = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "papernexus", "MECHANISM_BRIDGE_PACKET.json"),
      "utf8"
    )
  );
  const derivedChallengePacket = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "papernexus", "CHALLENGE_INSIGHT_PACKET.json"),
      "utf8"
    )
  );
  assert.equal(derivedMechanismPacket.selected_domains.includes("Psychology"), true);
  assert.equal(derivedChallengePacket.challenge_clusters.length >= 1, true);
  assert.equal(derivedChallengePacket.insight_clusters.length >= 1, true);
});

test("research_workflow materialize_papernexus_packet_contracts does not produce innovation packet from bundle alone", async (t) => {
  const projectRoot = await makeProjectRoot();
  await fs.rm(path.join(projectRoot, "orchestrator", "INNOVATION_PACKET.json"), {
    force: true,
  });
  await writeJson(
    path.join(projectRoot, "researcher", "papernexus", "IDEA_CATALYST_PACKET_BUNDLE.json"),
    buildIdeaCatalystPacketBundleFixture()
  );

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await materializePapernexusPacketContracts({
    projectRoot,
    trigger: "bundle-alone-test",
    agentId: "researcher",
  });

  assert.equal(result.state.ideaCatalystPacketBundleReady, true);
  assert.equal(result.state.ideaCatalystContractReady, false);
  assert.equal(result.state.innovationPacketReady, false);
  assert.equal(
    result.generatedFiles.includes("orchestrator/INNOVATION_PACKET.json"),
    false
  );
  const ideaContract = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, DEFAULT_IDEA_CATALYST_CONTRACT_PATH),
      "utf8"
    )
  );
  assert.equal(ideaContract.status, "blocked");
  assert.equal(ideaContract.reason, "Graph build decision authority is missing.");
});

test("research_workflow materialize_papernexus_packet_contracts builds idea contract from requisition and literature packet without bundle", async (t) => {
  const projectRoot = await makeProjectRoot();
  await fs.rm(path.join(projectRoot, "researcher", "papernexus"), {
    recursive: true,
    force: true,
  });
  await fs.rm(path.join(projectRoot, "orchestrator", "INNOVATION_PACKET.json"), {
    force: true,
  });
  await writeAuthorityCascadeInputs(projectRoot);
  await writeJson(
    path.join(projectRoot, "researcher", "literature-discovery", "LITERATURE_DISCOVERY_PACKET.json"),
    {
      schema_version: 1,
      status: "completed",
      evidence_gap_closed: true,
      selected_papers: [
        {
          canonical_id: "paper:belief-updating",
          title: "Belief Updating Under Uncertainty",
          source_kind: "markdown",
          source_path: "researcher/paper_source/md/belief-updating.md",
          import_status: "completed",
        },
      ],
      candidate_papers: [
        {
          canonical_id: "paper:belief-updating",
          title: "Belief Updating Under Uncertainty",
          source_kind: "markdown",
          source_path: "researcher/paper_source/md/belief-updating.md",
          import_status: "completed",
        },
      ],
    }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "idea-catalyst", "IDEA_FRAGMENTS.json"),
    {
      fragments: [
        {
          fragment_id: "frag-literature-1",
          source_domain: "Psychology",
          summary: "Use belief updating as the cross-domain support mechanism.",
        },
      ],
    }
  );

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await materializePapernexusPacketContracts({
    projectRoot,
    trigger: "literature-packet-contract-test",
    agentId: "researcher",
  });

  assert.equal(result.state.ideaCatalystPacketBundleReady, false);
  assert.equal(result.state.ideaCatalystContractReady, true);
  assert.equal(result.state.innovationPacketReady, false);
  const ideaContract = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, DEFAULT_IDEA_CATALYST_CONTRACT_PATH),
      "utf8"
    )
  );
  assert.equal(ideaContract.status, "ready");
  assert.equal(ideaContract.source_requisition_report_path.endsWith("REQUISITION_SATISFACTION_REPORT.json"), true);
  assert.equal(ideaContract.supporting_papers.includes("paper:belief-updating"), true);
  assert.equal(ideaContract.source_spans.length, 1);
  assert.equal(ideaContract.payload_paths.includes("researcher/idea-catalyst/IDEA_FRAGMENTS.json"), true);
  assert.equal(
    result.generatedFiles.includes("orchestrator/INNOVATION_PACKET.json"),
    false
  );
});

test("stage preflight detects a packet bundle even when split PaperNexus packets are absent", async (t) => {
  const projectRoot = await makeProjectRoot();
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.owner_agent = "researcher";
  await writeJson(manifestPath, manifest);
  await fs.rm(
    path.join(projectRoot, "researcher", "papernexus", "MECHANISM_BRIDGE_PACKET.json"),
    { force: true }
  );
  await fs.rm(
    path.join(projectRoot, "researcher", "papernexus", "CHALLENGE_INSIGHT_PACKET.json"),
    { force: true }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "papernexus", "IDEA_CATALYST_PACKET_BUNDLE.json"),
    buildIdeaCatalystPacketBundleFixture()
  );

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await maybePrepareWorkflowStageContracts({
    projectRoot,
    manifest,
    stage: "idea",
    trigger: "bundle-preflight",
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
  const refreshedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(
    refreshedManifest.ideation_contract.graph_ideation_indices.selected_source_domains.includes(
      "Psychology"
    ),
    true
  );
});
