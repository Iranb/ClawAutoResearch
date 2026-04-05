import test from "node:test";
import assert from "node:assert/strict";

import { buildIdeaCatalystDecompositionPacket } from "../tools/idea-catalyst/decomposer.ts";
import { buildIdeaCatalystAbstractionPacket } from "../tools/idea-catalyst/translator.ts";
import { deriveIdeaCatalystScoutReport } from "../tools/idea-catalyst/scout-adapter.ts";
import { buildIdeaCatalystIdeaFragments } from "../tools/idea-catalyst/integrator.ts";

test("decomposer produces dual-representation questions and structured remaining challenges", () => {
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
  assert.ok(
    packet.questions.every(
      (question) =>
        typeof question.domain_agnostic_question === "string" &&
        question.domain_agnostic_question.trim().length > 0
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
