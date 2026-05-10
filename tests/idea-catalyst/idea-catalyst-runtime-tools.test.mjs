import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPluginRegistrationContext } from "../../tools/plugin-registration-shared.ts";
import { registerWorkflowTools } from "../../tools/register-workflow-tools.ts";
import { maybePrepareWorkflowStageContracts } from "../../tools/workflow-guard-runtime/stage-preflight.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

async function writeFakeResearch30Script(targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(
    targetPath,
    `#!/usr/bin/env python3
import json
import os
from types import SimpleNamespace

RESPONSES = {}
payload_path = os.environ.get("OPENCLAW_RESEARCH30_FAKE_RESPONSES")
if payload_path:
    with open(payload_path, "r", encoding="utf-8") as handle:
        RESPONSES = json.load(handle)

class OpenAlexItem(dict):
    pass

class Report:
    def __init__(self, topic, from_date, to_date, mode):
        self.topic = topic
        self.range_from = from_date
        self.range_to = to_date
        self.generated_at = "2026-04-12T00:00:00Z"
        self.mode = mode
        self.openalex = []
        self.semanticscholar = []
        self.pubmed = []
        self.biorxiv = []
        self.medrxiv = []
        self.arxiv = []
        self.huggingface = []
        self.openalex_error = None
        self.semanticscholar_error = None
        self.pubmed_error = None
        self.biorxiv_error = None
        self.medrxiv_error = None
        self.arxiv_error = None
        self.huggingface_error = None

    def to_dict(self):
        return {
            "topic": self.topic,
            "range": {"from": self.range_from, "to": self.range_to},
            "generated_at": self.generated_at,
            "mode": self.mode,
            "openalex": [dict(item) for item in self.openalex],
            "semanticscholar": [],
            "pubmed": [],
            "biorxiv": [],
            "medrxiv": [],
            "arxiv": [],
            "huggingface": [],
        }

def create_report(topic, from_date, to_date, mode):
    return Report(topic, from_date, to_date, mode)

class Normalize:
    @staticmethod
    def normalize_openalex_items(items, *_args):
        return [OpenAlexItem(item) for item in items]
    @staticmethod
    def normalize_semanticscholar_items(items, *_args):
        return []
    @staticmethod
    def normalize_biorxiv_items(items, *_args):
        return []
    @staticmethod
    def normalize_arxiv_items(items, *_args):
        return []
    @staticmethod
    def normalize_pubmed_items(items, *_args):
        return []
    @staticmethod
    def normalize_huggingface_items(items, *_args):
        return []
    @staticmethod
    def filter_by_date_range(items, *_args):
        return items

class Score:
    @staticmethod
    def score_openalex_items(items):
        return items
    @staticmethod
    def score_semanticscholar_items(items):
        return items
    @staticmethod
    def score_biorxiv_items(items):
        return items
    @staticmethod
    def score_arxiv_items(items):
        return items
    @staticmethod
    def score_pubmed_items(items):
        return items
    @staticmethod
    def score_huggingface_items(items):
        return items
    @staticmethod
    def sort_items(items):
        return sorted(items, key=lambda item: -int(item.get("score", 0)))

class Dedupe:
    @staticmethod
    def dedupe_within_source(items):
        return items
    @staticmethod
    def dedupe_cross_source(items):
        return items

dates = SimpleNamespace(get_date_range=lambda days: ("2016-01-01", "2026-04-12"))
env = SimpleNamespace(get_config=lambda: {})
normalize = Normalize()
score = Score()
dedupe = Dedupe()
schema = SimpleNamespace(create_report=create_report)

def determine_sources(requested):
    return {requested}

def run_research(topic, sources_set, config, from_date, to_date, depth="default", mock=False, progress=None):
    return {
        "openalex": (RESPONSES.get(topic, []), None),
        "semanticscholar": ([], None),
        "pubmed": ([], None),
        "biorxiv": ([], None),
        "medrxiv": ([], None),
        "arxiv": ([], None),
        "huggingface": ([], None),
    }
`,
    "utf8"
  );
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
    bridge_retrieval: {
      candidate_bridge_paths: [
        {
          path_id: "bridge-psych-1",
          source_domain: "Psychology",
          candidate_node_name: "metacontrol",
          mechanism: "metacontrol",
          matched_challenges: ["memory preservation"],
          path_completeness: 0.82,
          evidence_density: 0.74,
          mechanism_support_density: 0.7,
          evidence_refs: [
            { ref_id: "chain-psych-1", node_id: "node-psych-1" },
          ],
          source_spans: [
            { span_id: "span-psych-1", snippet_node_id: "snippet-psych-1" },
          ],
          path_trace: [{ from: "psychology", to: "computer-science" }],
        },
        {
          path_id: "bridge-control-1",
          source_domain: "Control Theory",
          candidate_node_name: "adaptive regulation",
          mechanism: "adaptive regulation",
          matched_challenges: ["memory preservation"],
          path_completeness: 0.78,
          evidence_density: 0.68,
          mechanism_support_density: 0.66,
          evidence_refs: [
            { ref_id: "chain-control-1", node_id: "node-control-1" },
          ],
          source_spans: [
            { span_id: "span-control-1", snippet_node_id: "snippet-control-1" },
          ],
          path_trace: [{ from: "control-theory", to: "computer-science" }],
        },
      ],
    },
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
  assert.ok(result.generatedFiles.some((filePath) => /CANDIDATE_POOL\.json$/.test(filePath)));
  assert.ok(result.generatedFiles.some((filePath) => /CANDIDATE_SCORECARD\.json$/.test(filePath)));
  assert.ok(result.generatedFiles.some((filePath) => /CANDIDATE_TOURNAMENT\.json$/.test(filePath)));
  assert.ok(result.generatedFiles.some((filePath) => /SELECTED_IDEAS\.json$/.test(filePath)));
  assert.ok(result.generatedFiles.some((filePath) => /REJECTED_IDEAS\.json$/.test(filePath)));

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
  const candidatePoolPacket = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "idea-catalyst", "CANDIDATE_POOL.json"),
      "utf8"
    )
  );
  assert.equal(candidatePoolPacket.contract_version, "idea-catalyst-candidate-pool-v1");
  assert.equal(candidatePoolPacket.candidate_pool_size >= 3, true);

  const scorecardPacket = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "idea-catalyst", "CANDIDATE_SCORECARD.json"),
      "utf8"
    )
  );
  assert.equal(scorecardPacket.contract_version, "idea-catalyst-candidate-scorecard-v1");
  assert.equal(scorecardPacket.scoring_policy.hard_filters_first, true);
  assert.ok(scorecardPacket.candidates[0].dimensions.evidence_support);

  const tournamentPacket = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "idea-catalyst", "CANDIDATE_TOURNAMENT.json"),
      "utf8"
    )
  );
  assert.equal(tournamentPacket.contract_version, "idea-catalyst-candidate-tournament-v1");
  assert.equal(Array.isArray(tournamentPacket.pairwise_results), true);

  const selectedIdeasPacket = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "idea-catalyst", "SELECTED_IDEAS.json"),
      "utf8"
    )
  );
  assert.equal(selectedIdeasPacket.contract_version, "idea-catalyst-selected-ideas-v1");
  assert.equal(selectedIdeasPacket.selected_count >= 1, true);
  assert.ok(
    selectedIdeasPacket.selected_ideas.every(
      (candidate) =>
        candidate.baseline_to_compare &&
        candidate.primary_metric &&
        candidate.falsifier_pilot &&
        candidate.weakest_assumption &&
        candidate.claim_cap
    )
  );

  const rejectedIdeasPacket = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "idea-catalyst", "REJECTED_IDEAS.json"),
      "utf8"
    )
  );
  assert.equal(rejectedIdeasPacket.contract_version, "idea-catalyst-rejected-ideas-v1");
  assert.ok(
    rejectedIdeasPacket.rejected_ideas.every(
      (candidate) => typeof candidate.rejection_reason === "string"
    )
  );

  assert.ok(
    ideaFragmentsPacket.fragments.every(
      (fragment) =>
        fragment.candidate_id &&
        fragment.baseline_to_compare &&
        fragment.primary_metric &&
        fragment.falsifier_pilot &&
        fragment.weakest_assumption &&
        fragment.claim_cap &&
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

test("research_workflow materialize_idea_catalyst_state recovers EML profile from stale FixMatch/GCD ideation drift", async (t) => {
  const projectRoot = await makeCatalystProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const emlTopic =
    "EML operator small basemodels: use EML from arXiv:2603.21852 (All elementary functions from a single binary operator, eml(x,y)=exp(x)-ln(y)) to construct new small base models analogous to ResNet and Transformer blocks; compare same-parameter baselines on MNIST and toy text with NaN/Inf guardrails.";

  t.after(async () => {
    if (previousProjectRoot === undefined) delete process.env.OPENCLAW_PROJECT;
    else process.env.OPENCLAW_PROJECT = previousProjectRoot;
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.title = emlTopic;
  manifest.papernexus_corpus = "EML";
  manifest.primary_track_id = "track-eml-residual-and-mixer-blocks";
  manifest.active_track_ids = ["track-eml-residual-and-mixer-blocks"];
  manifest.research_program = {
    status: "ready",
    goal: emlTopic,
    problem_statement: emlTopic,
    baseline_reference: "Same-parameter CNN, ResNet-like, Transformer, and MLP-Mixer toy baselines",
    primary_metric: "accuracy plus finite-loss rate",
    datasets: ["MNIST", "Fashion-MNIST", "toy text"],
    success_criteria: [
      "Compare EML blocks against same-parameter baselines with explicit exp/log stability checks.",
    ],
    zotero_project_path: "bot/eml-small-basemodel-toy-validation",
  };
  manifest.brainstorm_cycle = {
    status: "ready",
    topic: emlTopic,
    selected_option_title: "EML residual and mixer blocks for small basemodel validation",
  };
  manifest.idea_catalyst = {
    status: "requisition",
    contract_version: 1,
    mode: "graph-first",
    micro_stage: "gatekeeping",
    investigation_requisition_path: "researcher/idea-catalyst/INVESTIGATION_REQUISITION.json",
    requisition_required: true,
    source_domains: [
      "Transfer FixMatch's weak-to-strong consistency onto the unlabeled GCD branch",
    ],
    pending_reason:
      "Legacy bridge relevance and quality signals are present, but graph-backed source-span and evidence-chain grounding is incomplete.",
  };
  manifest.ideation_contract.selected_track_id =
    "track-eml-residual-and-mixer-blocks";
  manifest.ideation_contract.graph_ideation_indices = {
    status: "ready",
    novelty_candidate_clusters: [
      "Adaptive FixMatch consistency for generalized category discovery",
    ],
    challenge_clusters: [
      "GCD pseudo-labels are not equally reliable across known and novel candidates.",
      "A direct FixMatch transfer can worsen confirmation bias.",
    ],
    insight_clusters: [
      "Adaptive FixMatch consistency for generalized category discovery",
    ],
    occupied_solution_zones: [],
    transfer_bridges: [
      "Transfer FixMatch's weak-to-strong consistency onto the unlabeled GCD branch",
    ],
    candidate_source_domains: [
      "Transfer FixMatch's weak-to-strong consistency onto the unlabeled GCD branch",
    ],
    selected_source_domains: [
      "Transfer FixMatch's weak-to-strong consistency onto the unlabeled GCD branch",
    ],
    pruned_source_domains: [],
    bridge_evidence_tier: "strong",
  };
  await writeJson(manifestPath, manifest);

  await writeJson(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "TOPIC_SUMMARY.json"),
    {
      topic: emlTopic,
      summary:
        "Use the EML operator as a guarded primitive for compact residual, mixer, and Transformer-like basemodels.",
      recovery_profile: "eml_operator",
      target_domain: "Computer Science",
    }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"),
    {
      schema_version: 1,
      topic: emlTopic,
      recovery_profile: "eml_operator",
      source_backed_paper_count: 5,
      metadata_only_paper_count: 0,
      papers: [
        {
          canonical_id: "arxiv:2603.21852",
          title: "All elementary functions from a single binary operator",
          source_path:
            "researcher/paper-staging/eml-core-sources/2603.21852-all-elementary-functions-from-a-single-binary-operator.pdf",
        },
        {
          canonical_id: "arxiv:1512.03385",
          title: "Deep Residual Learning for Image Recognition",
          source_path:
            "researcher/paper-staging/eml-core-sources/1512.03385-deep-residual-learning-for-image-recognition.pdf",
        },
        {
          canonical_id: "arxiv:1706.03762",
          title: "Attention Is All You Need",
          source_path:
            "researcher/paper-staging/eml-core-sources/1706.03762-attention-is-all-you-need.pdf",
        },
        {
          canonical_id: "arxiv:2105.01601",
          title: "MLP-Mixer: An all-MLP Architecture for Vision",
          source_path:
            "researcher/paper-staging/eml-core-sources/2105.01601-mlp-mixer-an-all-mlp-architecture-for-vision.pdf",
        },
        {
          canonical_id: "arxiv:1708.07747",
          title:
            "Fashion-MNIST: a Novel Image Dataset for Benchmarking Machine Learning Algorithms",
          source_path:
            "researcher/paper-staging/eml-core-sources/1708.07747-fashion-mnist-a-novel-image-dataset.pdf",
        },
      ],
    }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "ideation", "GRAPH_IDEATION_PACKET.json"),
    {
      status: "ready",
      selected_track_id: "track-eml-residual-and-mixer-blocks",
      graph_basis: ["arXiv:2603.21852", "ResNet", "Transformer", "MNIST"],
    }
  );
  await writeJson(
    path.join(projectRoot, "researcher", "ideation", "CANDIDATE_POOL.json"),
    {
      candidates: [
        {
          direction_id: "opt_1",
          track_id:
            "track-adaptive-fixmatch-consistency-for-generalized-category-discovery",
          title:
            "Adaptive FixMatch consistency for generalized category discovery",
          summary: "Use pseudo-label confidence thresholds for GCD.",
          novelty: 0.7,
          feasibility: 0.7,
          relevance: 0.7,
          clarity: 0.7,
          composite_score: 0.7,
        },
      ],
    }
  );
  await writeJson(
    path.join(
      projectRoot,
      "researcher",
      "idea-catalyst",
      "INVESTIGATION_REQUISITION.json"
    ),
    {
      actionable: true,
      status: "pending",
      requisition_id: "req-old-gcd",
      missing_domains: [
        "Transfer FixMatch's weak-to-strong consistency onto the unlabeled GCD branch",
      ],
      search_queries: [
        {
          domain: "GCD",
          query: "FixMatch generalized category discovery pseudo-labels",
        },
      ],
    }
  );

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  const result = await executeWorkflowTool(tool, {
    action: "materialize_idea_catalyst_state",
    ideaCatalystMaterialization: {
      basis_stage: "idea",
    },
  });

  assert.equal(result.state.status, "ready");
  assert.equal(result.state.requisitionRequired, false);
  assert.ok(
    result.state.sourceDomains.includes(
      "EML operator semantics and neural-cell mapping"
    )
  );

  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const scoutReport = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "idea-catalyst", "SCOUTING_REPORT.json"),
      "utf8"
    )
  );
  const candidatePool = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "idea-catalyst", "CANDIDATE_POOL.json"),
      "utf8"
    )
  );
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
  const contamination = JSON.stringify({
    idea_catalyst: updatedManifest.idea_catalyst,
    graph_ideation_indices:
      updatedManifest.ideation_contract.graph_ideation_indices,
    scoutReport,
    candidatePool,
    requisition,
  });
  assert.doesNotMatch(
    contamination,
    /fixmatch|generalized category discovery|\bgcd\b|pseudo-?label/i
  );
  assert.equal(requisition.status, "not_required");
  assert.equal(requisition.actionable, false);
  assert.ok(candidatePool.candidates.length >= 3);
  assert.match(JSON.stringify(candidatePool), /Safe EML residual block|EML mixer block/i);

  const manifestBeforeReopen = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const pseudoDomains = [
    "Insert a safe EML branch inside a residual block and compare it against a same-parameter MLP or convolutional residual branch.",
    "Build a channel/token mixer where one operand is a learned positive gate and the other is the feature activation.",
    "Use residual scaling, finite-value checks, and per-layer activation statistics as first-class experiment outputs.",
  ];
  manifestBeforeReopen.idea_catalyst = {
    ...manifestBeforeReopen.idea_catalyst,
    status: "requisition",
    micro_stage: "gatekeeping",
    source_domains: pseudoDomains,
    requisition_required: true,
    pending_reason:
      "Legacy bridge relevance is incomplete even though the EML source index is source backed.",
  };
  manifestBeforeReopen.ideation_contract.graph_ideation_indices = {
    ...manifestBeforeReopen.ideation_contract.graph_ideation_indices,
    status: "ready",
    candidate_source_domains: pseudoDomains,
    selected_source_domains: pseudoDomains,
    transfer_bridges: pseudoDomains,
    bridge_evidence_tier: "weak",
  };
  manifestBeforeReopen.paper_ingestion = {
    ...(manifestBeforeReopen.paper_ingestion ?? {}),
    queued_requests: [
      {
        request_id: "idea-catalyst-req-eml-pseudo-domains",
        request_kind: "requisition",
        status: "running",
        trigger_kind: "idea_catalyst_requisition",
        summary: "Stale IDEA-CATALYST requisition reopened after EML profile recovery.",
        detail: "Live-like stale queue entry from a previously reopened requisition.",
      },
    ],
  };
  await writeJson(manifestPath, manifestBeforeReopen);
  await writeJson(
    path.join(
      projectRoot,
      "researcher",
      "idea-catalyst",
      "INVESTIGATION_REQUISITION.json"
    ),
    {
      actionable: true,
      status: "pending",
      requisition_id: "req-eml-pseudo-domains",
      missing_domains: pseudoDomains,
      missing_evidence_types: ["source_span"],
    }
  );

  const reopenedResult = await executeWorkflowTool(tool, {
    action: "materialize_idea_catalyst_state",
    ideaCatalystMaterialization: {
      basis_stage: "idea",
    },
  });
  assert.equal(reopenedResult.state.status, "ready");
  assert.equal(reopenedResult.state.requisitionRequired, false);
  assert.ok(
    reopenedResult.state.sourceDomains.includes(
      "EML operator semantics and neural-cell mapping"
    )
  );
  assert.doesNotMatch(
    JSON.stringify(reopenedResult.state.sourceDomains),
    /Insert a safe EML branch|learned positive gate|first-class experiment outputs/i
  );
  const retiredReopenedRequisition = JSON.parse(
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
  assert.equal(retiredReopenedRequisition.status, "not_required");
  assert.equal(retiredReopenedRequisition.actionable, false);
  const manifestAfterReopen = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const retiredQueuedRequest =
    manifestAfterReopen.paper_ingestion.queued_requests.find(
      (entry) => entry.request_id === "idea-catalyst-req-eml-pseudo-domains"
    );
  assert.equal(retiredQueuedRequest.status, "completed");
  assert.equal(retiredQueuedRequest.last_error, null);
  assert.equal(retiredQueuedRequest.validation_status, "valid");
  assert.match(
    retiredQueuedRequest.validation_report_path ?? "",
    /REQUISITION_RETIREMENT_REPORT\.json$/
  );
  assert.ok(retiredQueuedRequest.finished_at);
  assert.match(retiredQueuedRequest.detail ?? "", /no longer requires|retired/i);
  const retirementReport = JSON.parse(
    await fs.readFile(
      path.join(
        projectRoot,
        "researcher",
        "idea-catalyst",
        "REQUISITION_RETIREMENT_REPORT.json"
      ),
      "utf8"
    )
  );
  assert.equal(retirementReport.status, "valid");
  assert.deepEqual(retirementReport.retired_request_ids, [
    "idea-catalyst-req-eml-pseudo-domains",
  ]);

  const idempotentResult = await executeWorkflowTool(tool, {
    action: "materialize_idea_catalyst_state",
    ideaCatalystMaterialization: {
      basis_stage: "idea",
    },
  });
  assert.equal(idempotentResult.state.status, "ready");
  assert.equal(idempotentResult.state.requisitionRequired, false);
  const idempotentRequisition = JSON.parse(
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
  assert.equal(idempotentRequisition.status, "not_required");
  assert.equal(idempotentRequisition.actionable, false);
});

test("research_workflow run_idea_catalyst_research30 persists cross-domain search evidence and syncs scout summaries", async (t) => {
  const projectRoot = await makeCatalystProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const previousResearch30Script = process.env.OPENCLAW_RESEARCH30_SCRIPT;
  const previousResearch30Responses = process.env.OPENCLAW_RESEARCH30_FAKE_RESPONSES;
  const fakeResearch30 = path.join(projectRoot, "research30", "scripts", "research30.py");
  const fakeResponses = path.join(projectRoot, "research30-responses.json");

  t.after(async () => {
    if (previousProjectRoot === undefined) delete process.env.OPENCLAW_PROJECT;
    else process.env.OPENCLAW_PROJECT = previousProjectRoot;
    if (previousResearch30Script === undefined) delete process.env.OPENCLAW_RESEARCH30_SCRIPT;
    else process.env.OPENCLAW_RESEARCH30_SCRIPT = previousResearch30Script;
    if (previousResearch30Responses === undefined) delete process.env.OPENCLAW_RESEARCH30_FAKE_RESPONSES;
    else process.env.OPENCLAW_RESEARCH30_FAKE_RESPONSES = previousResearch30Responses;
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeFakeResearch30Script(fakeResearch30);
  await writeText(
    fakeResponses,
    `${JSON.stringify(
      {
        "Psychology memory preservation transferable principle Computer Science": [
          {
            title: "Metacontrol for Adaptive Memory",
            authors: "A. Researcher",
            abstract: "Psychology view on memory preservation and flexible control.",
            doi: "10.1000/metacontrol",
            url: "https://openalex.org/Wmetacontrol",
            source_name: "Psych Review",
            date: "2024-04-18",
            score: 93,
            why_relevant: "Direct transfer evidence",
          },
        ],
        "Control Theory memory preservation transferable principle Computer Science": [
          {
            title: "Adaptive Regulation for Stable Controllers",
            authors: "B. Researcher",
            abstract: "Control-theoretic stabilization under changing evidence.",
            doi: "10.1000/controller",
            url: "https://openalex.org/Wcontroller",
            source_name: "Control Letters",
            date: "2023-11-03",
            score: 89,
            why_relevant: "Mechanism overlap",
          },
        ],
      },
      null,
      2
    )}\n`
  );

  process.env.OPENCLAW_PROJECT = projectRoot;
  process.env.OPENCLAW_RESEARCH30_SCRIPT = fakeResearch30;
  process.env.OPENCLAW_RESEARCH30_FAKE_RESPONSES = fakeResponses;

  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  await executeWorkflowTool(tool, {
    action: "materialize_idea_catalyst_state",
    ideaCatalystMaterialization: {
      basis_stage: "idea",
    },
  });

  const result = await executeWorkflowTool(tool, {
    action: "run_idea_catalyst_research30",
    ideaCatalystResearch30: {
      days: 3650,
      depth: "quick",
    },
  });

  assert.equal(result.queryCount >= 2, true);
  assert.equal(result.scoutReportUpdated, true);

  const report = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "idea-catalyst", "RESEARCH30_SCOUT_REPORT.json"),
      "utf8"
    )
  );
  assert.equal(report.backend, "research30");
  assert.equal(report.available, true);
  assert.equal(Array.isArray(report.queries), true);

  const scoutReport = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "idea-catalyst", "SCOUTING_REPORT.json"),
      "utf8"
    )
  );
  assert.equal(scoutReport.research30_validation.backend, "research30");
  const psychology = scoutReport.candidate_domains.find((entry) => entry.domain === "Psychology");
  assert.equal(psychology.research30_validation.total_hits >= 1, true);
  assert.equal(psychology.research30_validation.top_results[0].doi, "10.1000/metacontrol");
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

test("stage preflight accepts canonical degraded IDEA-CATALYST satisfaction reports when queue links drift", async (t) => {
  const projectRoot = await makeCatalystProjectRoot();
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.idea_catalyst = {
    ...(manifest.idea_catalyst ?? {}),
    status: "requisition",
    micro_stage: "gatekeeping",
    requisition_required: true,
    last_requisition_cycle: "req-computer-science-8-5",
    pending_reason:
      "Live project drift left the queued request detached from its satisfaction report.",
  };
  manifest.paper_ingestion = {
    ...(manifest.paper_ingestion ?? {}),
    queued_requests: [],
  };
  await writeJson(manifestPath, manifest);
  await writeJson(
    path.join(projectRoot, "researcher", "idea-catalyst", "INVESTIGATION_REQUISITION.json"),
    {
      schema_version: 1,
      requisition_id: "req-computer-science-8-5",
      status: "requisition",
      actionable: false,
      retry_budget: 0,
      non_actionable_reason:
        "Remote import stalled, but the current graph and local staged papers are sufficient for degraded continuation.",
    }
  );
  await writeJson(
    path.join(
      projectRoot,
      "researcher",
      "idea-catalyst",
      "requisition",
      "req-computer-science-8-5",
      "REQUISITION_SATISFACTION_REPORT.json"
    ),
    {
      schema_version: 1,
      status: "satisfied_degraded_pass_19_final",
      decision: "proceed_to_idea_synthesis",
      request_id: "idea-catalyst-req-computer-science-8-5",
      graph_presence_status: "ready",
      import_status:
        "Batch import confirmed failed after timeout; proceeding with locally staged papers.",
      reason:
        "All panel blockers resolved via degraded mode against the current ready graph.",
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
  const updatedRequisition = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "idea-catalyst", "INVESTIGATION_REQUISITION.json"),
      "utf8"
    )
  );
  assert.equal(queued, 0);
  assert.equal(materialized, 1);
  assert.ok(result.materializedContracts.includes("idea_catalyst"));
  assert.notEqual(updatedManifest.idea_catalyst.status, "requisition");
  assert.equal(updatedManifest.idea_catalyst.requisition_required, false);
  assert.equal(updatedRequisition.status, "completed");
  assert.equal(
    updatedRequisition.validation_report_path,
    "researcher/idea-catalyst/requisition/req-computer-science-8-5/REQUISITION_SATISFACTION_REPORT.json"
  );
});

test("stage preflight repairs brainstorm JSON path drift before readiness checks", async (t) => {
  const projectRoot = await makeCatalystProjectRoot();
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.brainstorm_cycle = {
    status: "reconciled",
    mode: "frontier",
    topic: "EML operator small basemodels",
    basis_stage: "frontier_mapping",
    provider: "workflow_core_brainstorm",
    provider_mode: "core",
    provider_status: "completed",
    contract_version: 2,
    rounds: [
      {
        round_id: "round-1",
        status: "completed",
        options: [
          {
            option_id: "opt-1",
            title: "Safe EML residual block",
          },
        ],
      },
    ],
    selected_round_id: "round-1",
    selected_option_id: "opt-1",
    selected_option_title: "Safe EML residual block",
    topic_summary_path: "researcher/brainstorm-cycle/TOPIC_SUMMARY.md",
    research_brief_path: "researcher/brainstorm-cycle/RESEARCH_BRIEF.md",
    brainstorm_brief_path: "researcher/brainstorm-cycle/BRAINSTORM_BRIEF.md",
    logic_chain_path: "researcher/brainstorm-cycle/LOGIC_CHAIN.md",
    evidence_chain_path: "researcher/brainstorm-cycle/EVIDENCE_CHAIN.md",
    reasoning_trace_path: "researcher/brainstorm-cycle/REASONING_TRACE.jsonl",
    question_packet_path: "researcher/brainstorm-cycle/QUESTION_PACKET.md",
    working_memory_path: "researcher/brainstorm-cycle/WORKING_MEMORY.json",
    synthesis_packet_path: "researcher/brainstorm-cycle/SYNTHESIS_PACKET.md",
  };
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(projectRoot, "researcher", "brainstorm-cycle", "RESEARCH_BRIEF.json"), {
    anchors: ["paper:eml"],
  });
  await writeJson(path.join(projectRoot, "researcher", "brainstorm-cycle", "BRAINSTORM_BRIEF.json"), {
    mode: "reconciled",
  });
  await writeJson(path.join(projectRoot, "researcher", "brainstorm-cycle", "WORKING_MEMORY.json"), {
    hypothesis: "bounded EML",
  });
  await writeText(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "RESEARCH_BRIEF.md"),
    "# stale markdown mirror\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "BRAINSTORM_BRIEF.md"),
    "# stale markdown mirror\n"
  );

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

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
      materializeIdeaCatalystState: async () => ({ ok: true }),
      queueIdeaCatalystRequisition: async () => ({ ok: true }),
    },
  });

  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.ok(
    result.materializedContracts.includes(
      "brainstorm_cycle_manifest_paths_reconciled"
    )
  );
  assert.equal(
    updatedManifest.brainstorm_cycle.topic_summary_path,
    "researcher/brainstorm-cycle/TOPIC_SUMMARY.json"
  );
  assert.equal(
    updatedManifest.brainstorm_cycle.research_brief_path,
    "researcher/brainstorm-cycle/RESEARCH_BRIEF.json"
  );
  assert.equal(
    updatedManifest.brainstorm_cycle.brainstorm_brief_path,
    "researcher/brainstorm-cycle/BRAINSTORM_BRIEF.json"
  );
  assert.equal(updatedManifest.brainstorm_cycle.provider_status, "ready");
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

  const gateDecision = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "idea-catalyst", "GATE_DECISION.json"),
      "utf8"
    )
  );
  assert.equal(gateDecision.decision, "requisition");
  assert.equal(typeof gateDecision.evidence.bridge_path_count, "number");
  assert.equal(typeof gateDecision.evidence.source_span_count, "number");
  assert.equal(typeof gateDecision.evidence.path_completeness, "number");
  assert.equal(typeof gateDecision.evidence.evidence_density, "number");
  assert.equal(typeof gateDecision.evidence.mechanism_support_density, "number");
  assert.equal(typeof gateDecision.evidence.claim_cap, "string");
  assert.ok(gateDecision.evidence.missing_evidence_types.includes("bridge_path"));

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
  assert.ok(requisition.missing_evidence_types.includes("bridge_path"));
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
  assert.equal(result.request.requestKind, "requisition");
  assert.match(result.request.requestId, /^idea-catalyst-/);
  assert.match(result.request.summary ?? "", /IDEA-CATALYST/i);
  assert.match(result.request.commandText ?? "", /INVESTIGATION_REQUISITION\.json/);
  assert.match(result.request.commandText ?? "", /graph-build/i);
  assert.match(result.request.manifestPath ?? "", /CATALYST_REQUISITION\.json$/);

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
