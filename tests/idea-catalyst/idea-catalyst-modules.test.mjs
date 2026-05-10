import test from "node:test";
import assert from "node:assert/strict";

import { buildIdeaCatalystDecompositionPacket } from "../../tools/idea-catalyst/decomposer.ts";
import { buildIdeaCatalystAbstractionPacket } from "../../tools/idea-catalyst/translator.ts";
import { buildIdeaCatalystCandidatePool } from "../../tools/idea-catalyst/candidate-pool.ts";
import { deriveIdeaCatalystScoutReport } from "../../tools/idea-catalyst/scout-adapter.ts";
import { buildIdeaCatalystIdeaFragments } from "../../tools/idea-catalyst/integrator.ts";

test("decomposition packet carries public-repo question metadata and rubric-backed target analysis", () => {
  const packet = buildIdeaCatalystDecompositionPacket({
    targetDomain: "Computer Science",
    longTermGoal: "Build stronger cross-domain research ideation.",
    problemStatement: "Generalized category discovery needs better memory adaptation.",
    selectedTrackId: "track-main",
    challengeClusters: [
      "memory preservation under domain shift",
      "socially aware prototype updates",
    ],
    graphChallengeClusters: ["memory preservation under domain shift"],
    occupiedSolutionZones: [],
    transferBridges: ["psychology:metacontrol"],
  });

  assert.ok(Array.isArray(packet.questions));
  assert.equal(packet.questions.length, 2);
  assert.equal(packet.coarse_grained_domain, "Computer Science");
  assert.equal(packet.fine_grained_domain, "Computer Science");
  assert.ok(
    packet.questions.every(
      (question) =>
        typeof question.domain_agnostic_question === "string" &&
        question.domain_agnostic_question.trim().length > 0 &&
        Array.isArray(question.target_domain_queries) &&
        question.target_domain_queries.length >= 3 &&
        ["largely unaddressed", "partially addressed", "substantially addressed"].includes(
          question.target_domain_analysis?.overall_assessment
        )
    )
  );

  const unresolved = packet.questions.filter(
    (question) => question.coverage_status !== "resolved"
  );
  assert.ok(unresolved.length >= 1);
  assert.ok(
    unresolved.every(
      (question) =>
        Array.isArray(question.remaining_non_incremental_challenges) &&
        question.remaining_non_incremental_challenges.length >= 1 &&
        question.remaining_non_incremental_challenges.every(
          (entry) =>
            typeof entry.challenge_specific === "string" &&
            entry.challenge_specific.length > 0 &&
            typeof entry.challenge_agnostic === "string" &&
            entry.challenge_agnostic.length > 0
        )
    )
  );
});

test("translator uses coverage-aware abstraction strategies", () => {
  const abstractionPacket = buildIdeaCatalystAbstractionPacket(
    {
      questions: [
        {
          question_id: "q1",
          domain_specific_question: "memory preservation under domain shift",
          domain_agnostic_question:
            "How can a learning system preserve prior state while adapting under changing evidence?",
          coverage_status: "partial",
          coverage_evidence: {
            transfer_bridge_matches: ["metacontrol", "adaptive regulation"],
            graph_signal_matches: ["prototype memory"],
          },
          remaining_non_incremental_challenges: [
            {
              challenge_specific:
                "Prevent prototype collapse while adapting to new domains.",
              challenge_agnostic:
                "Preserve long-term state while updating behavior under distribution change.",
            },
          ],
        },
        {
          question_id: "q2",
          domain_specific_question: "socially aware prototype updates",
          domain_agnostic_question:
            "How can a system adapt to diverse collaborators with changing goals?",
          coverage_status: "unexplored",
          coverage_evidence: {},
          remaining_non_incremental_challenges: [
            {
              challenge_specific:
                "Infer collaborator-sensitive update policies for prototype revision.",
              challenge_agnostic:
                "Adapt behavior for collaborators with different roles and goals.",
            },
          ],
        },
      ],
    },
    "Computer Science"
  );

  const partial = abstractionPacket.abstractions.find((entry) => entry.question_id === "q1");
  const exploratory = abstractionPacket.abstractions.find(
    (entry) => entry.question_id === "q2"
  );

  assert.equal(partial.strategy, "targeted");
  assert.ok(typeof partial.mechanism_hypothesis === "string");
  assert.ok(partial.transfer_axes.includes("metacontrol"));

  assert.equal(exploratory.strategy, "exploratory");
  assert.equal(exploratory.mechanism_hypothesis, null);
  assert.deepEqual(exploratory.transfer_axes, []);
  assert.equal(exploratory.domain_agnostic_question.includes("collaborators"), true);
});

test("scout-adapter consumes domain distance matrices and emits structured takeaways", () => {
  const report = deriveIdeaCatalystScoutReport({
    graphIdeationPacket: {
      target_domain: "Computer Science",
      candidate_domains: ["Psychology", "Control Theory", "Economics"],
      domain_distance_matrix: {
        "computer science": {
          psychology: 0.91,
          "control theory": 0.77,
          economics: 0.62,
        },
      },
      bridge_nodes: [
        {
          node_id: "bridge-psych-1",
          node_name: "Metacontrol state model",
          domain: "Psychology",
          mechanism: "metacontrol",
          score: 0.92,
          properties: {
            abstract:
              "Balance persistence and flexibility to respond to uncertain behavior.",
            evidenceText:
              "Psychology models dynamic control of persistence vs. flexibility.",
          },
        },
      ],
    },
    topicSummary: {
      target_domain: "Computer Science",
    },
    challengeClusters: ["memory preservation under domain shift"],
    transferBridges: ["psychology:metacontrol", "control theory:adaptive regulation"],
    targetDomain: "Computer Science",
  });

  const psychology = report.candidate_domains.find((entry) => entry.domain === "Psychology");
  assert.equal(psychology.domain_distance, 0.91);
  assert.equal(Array.isArray(report.cross_domain_searches), true);
  assert.equal(report.cross_domain_searches[0].queries.length >= 1, true);
  assert.equal(typeof report.cross_domain_searches[0].domain_rationale, "string");
  assert.equal(psychology.takeaways.length >= 1, true);
  assert.equal(
    typeof psychology.takeaways[0].source_domain_formulation === "string",
    true
  );
  assert.equal(
    typeof psychology.takeaways[0].mechanism_explanation === "string",
    true
  );
  assert.equal(
    typeof psychology.takeaways[0].selection_rationale === "string",
    true
  );
  assert.equal(
    typeof psychology.takeaways[0].relevance_to_challenge === "string",
    true
  );
  assert.equal(Array.isArray(psychology.takeaways[0].supporting_papers), true);
});

test("integrator builds graph-grounded fragments from scouting takeaways and decomposition questions", () => {
  const decompositionPacket = buildIdeaCatalystDecompositionPacket({
    targetDomain: "Computer Science",
    longTermGoal: "Improve interdisciplinary GCD ideation.",
    problemStatement: "GCD needs better memory-preserving adaptation.",
    selectedTrackId: "track-main",
    challengeClusters: ["memory preservation under domain shift"],
    graphChallengeClusters: ["memory preservation under domain shift"],
    transferBridges: ["psychology:metacontrol"],
  });

  const scoutingReport = deriveIdeaCatalystScoutReport({
    graphIdeationPacket: {
      target_domain: "Computer Science",
      candidate_domains: ["Psychology"],
      bridge_nodes: [
        {
          node_id: "bridge-psych-1",
          node_name: "Metacontrol state model",
          domain: "Psychology",
          mechanism: "metacontrol",
          score: 0.92,
          properties: {
            abstract:
              "Balance persistence and flexibility to respond to uncertain behavior.",
            evidenceText:
              "Psychology models dynamic control of persistence vs. flexibility.",
          },
        },
      ],
    },
    topicSummary: { target_domain: "Computer Science" },
    challengeClusters: ["memory preservation under domain shift"],
    transferBridges: ["psychology:metacontrol"],
    targetDomain: "Computer Science",
  });

  const packet = buildIdeaCatalystIdeaFragments({
    candidates: [
      {
        direction_id: "dir-main",
        track_id: "track-main",
        title: "Metacontrol-guided memory regulation",
        summary: "Use metacontrol to regulate when prototypes are updated or preserved.",
        novelty: 0.88,
        feasibility: 0.74,
        relevance: 0.86,
        clarity: 0.82,
        composite_score: 0.83,
      },
    ],
    sourceDomains: ["Psychology"],
    targetDomain: "Computer Science",
    selectedTrackId: "track-main",
    problemStatement: "GCD needs better memory-preserving adaptation.",
    decompositionPacket,
    scoutingReport,
  });

  assert.equal(Array.isArray(packet.fragments), true);
  assert.equal(packet.fragments.length, 1);
  const fragment = packet.fragments[0];
  assert.equal(fragment.source_domain, "Psychology");
  assert.equal(typeof fragment.idea_fragment.title, "string");
  assert.equal(typeof fragment.idea_fragment.core_insight, "string");
  assert.equal(Array.isArray(fragment.integration_mechanism.selected_takeaways), true);
  assert.equal(fragment.integration_mechanism.selected_takeaways.length >= 1, true);
  assert.equal(
    typeof fragment.integration_mechanism.selected_takeaways[0].mechanism_explanation,
    "string"
  );
  assert.equal(
    typeof fragment.challenge_resolution.addresses_target_challenge,
    "string"
  );
  assert.equal(Array.isArray(fragment.concrete_realization.key_innovations), true);
  assert.equal(fragment.concrete_realization.key_innovations.length >= 2, true);
});

test("candidate pool materializes PaperNexus bundle fields into evidence-rich candidates", () => {
  const pool = buildIdeaCatalystCandidatePool({
    graphPacket: {
      target_domain: "Computer Science",
      status: "ready",
      domain_distance_matrix: {
        distances: {
          "computer science": {
            psychology: 0.72,
            robotics: 0.66,
            neuroscience: 0.8,
          },
        },
      },
      idea_fragments: [
        {
          candidate_id: "cand-psych",
          source_domain: "Psychology",
          frontier_type: "transfer",
          transferred_mechanism: "metacontrol arbitration",
          bridge_path_ids: ["bridge-psych-1"],
          path_completeness: 0.9,
          evidence_density: 0.8,
          mechanism_support_density: 0.75,
          evidence_chain_refs: [{ ref_id: "chain-psych-1", node_id: "node-psych-1" }],
          source_spans: [{ span_id: "span-psych-1", snippet_node_id: "snippet-psych-1" }],
          idea_fragment: {
            title: "Metacontrol memory router",
            core_insight: "Gate prototype preservation and adaptation with metacontrol.",
            challenge_resolution: "Stabilize memory updates under domain shift.",
            concrete_realization: "Add an arbitration head over prototype updates.",
          },
        },
      ],
      bridge_retrieval: {
        candidate_bridge_paths: [
          {
            path_id: "bridge-robot-1",
            source_domain: "Robotics",
            candidate_node_name: "Curriculum relay",
            mechanism: "curriculum relay",
            path_completeness: 0.82,
            evidence_refs: [{ ref_id: "chain-robot-1", node_id: "node-robot-1" }],
            source_spans: [{ span_id: "span-robot-1" }],
            path_trace: [{ from: "robotics", to: "gcd" }],
          },
        ],
      },
      structural_analogy: {
        alignments: [
          {
            bridge_path_id: "bridge-neuro-1",
            source_domain: "Neuroscience",
            candidate_node_name: "Memory consolidation",
            transferred_mechanism: "consolidation replay",
            path_completeness: 0.78,
            evidence_chain_refs: [{ ref_id: "chain-neuro-1", node_id: "node-neuro-1" }],
            source_spans: [{ span_id: "span-neuro-1" }],
            alignment_rationale: "Replay-based consolidation maps to prototype retention.",
          },
        ],
      },
    },
    candidatePool: null,
    scoutingReport: null,
    targetDomain: "Computer Science",
    selectedTrackId: "track-main",
    baselineReference: "SimGCD",
    primaryMetric: "ACC",
  });

  assert.equal(pool.candidate_pool_size >= 3, true);
  assert.equal(pool.data_starvation, false);
  assert.deepEqual(pool.generation_summary.source_paths, [
    "idea_fragments[0]",
    "bridge_retrieval.candidate_bridge_paths[0]",
    "structural_analogy.alignments[0]",
  ]);

  const psychology = pool.candidates.find(
    (candidate) => candidate.candidate_id === "cand-psych"
  );
  assert.equal(psychology.source_domain, "Psychology");
  assert.equal(psychology.transferred_mechanism, "metacontrol arbitration");
  assert.deepEqual(psychology.bridge_path_ids, ["bridge-psych-1"]);
  assert.equal(psychology.path_completeness, 0.9);
  assert.equal(psychology.domain_distance, 0.72);
  assert.equal(psychology.baseline_to_compare, "SimGCD");
  assert.equal(psychology.primary_metric, "ACC");
  assert.equal(typeof psychology.falsifier_pilot, "string");
  assert.equal(typeof psychology.weakest_assumption, "string");
  assert.equal(psychology.claim_cap, "confirmatory");
  assert.equal(psychology.evidence_tier, "strong");
  assert.equal(psychology.evidence_chain_refs.length, 1);
  assert.equal(psychology.source_spans.length, 1);
});
