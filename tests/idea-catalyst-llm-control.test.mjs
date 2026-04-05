import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSufficiencyPrompt,
  parseSufficiencyJudgment,
} from "../tools/idea-catalyst/llm-sufficiency.ts";
import {
  buildQuestionGenerationPrompt,
  parseGeneratedQuestions,
} from "../tools/idea-catalyst/llm-question-generator.ts";
import { buildIdeaCatalystGateDecision } from "../tools/idea-catalyst/gatekeeper.ts";
import { buildIdeaCatalystDecompositionPacket } from "../tools/idea-catalyst/decomposer.ts";

test("llm sufficiency prompt includes unresolved questions and target domain", () => {
  const prompt = buildSufficiencyPrompt({
    targetDomain: "Computer Science",
    questionGaps: [
      {
        question_id: "q1",
        question: "memory preservation under domain shift",
        coverage_status: "partial",
      },
    ],
    selectedDomains: ["Psychology"],
    insufficientDomains: ["Control Theory"],
  });

  assert.match(prompt, /Computer Science/i);
  assert.match(prompt, /memory preservation under domain shift/i);
  assert.match(prompt, /Control Theory/i);
  assert.match(prompt, /brainstorm|requisition/i);
});

test("llm sufficiency judgment can override threshold gating when confidence is high", () => {
  const judgment = parseSufficiencyJudgment(
    JSON.stringify({
      preferred_decision: "brainstorm",
      reasoning: "Psychology already provides sufficient bridge evidence for the unresolved question.",
      confidence: 0.92,
      missing_domains: [],
      missing_question_ids: [],
      recommended_retry_budget: 1,
    })
  );

  const decision = buildIdeaCatalystGateDecision(
    {
      target_domain: "Computer Science",
      challenge_clusters: ["memory preservation under domain shift"],
      candidate_domains: [
        {
          domain: "Psychology",
          pruned: false,
          retrieved_nodes: ["bridge-psych-1"],
          takeaways: [{ takeaway_id: "tk-1" }],
          relevance_ratio: 0.3,
          bridge_quality: 0.45,
        },
      ],
      bridge_nodes: [{ domain: "Psychology" }],
    },
    {
      questions: [
        {
          question_id: "q1",
          domain_specific_question: "memory preservation under domain shift",
          coverage_status: "partial",
        },
      ],
    },
    {
      llmJudgment: judgment,
    }
  );

  assert.equal(decision.decision, "brainstorm");
  assert.equal(decision.evidence.gating_mode, "graph-bridge-sufficiency+llm");
  assert.equal(decision.evidence.llm_confidence, 0.92);
});

test("llm question generator prompt and parser support decomposition augmentation", () => {
  const prompt = buildQuestionGenerationPrompt({
    targetDomain: "Computer Science",
    problemStatement: "GCD needs better memory-preserving adaptation.",
    challengeClusters: ["memory preservation under domain shift"],
    longTermGoal: "Build stronger cross-domain research ideation.",
  });
  assert.match(prompt, /Computer Science/i);
  assert.match(prompt, /memory preservation under domain shift/i);

  const generated = parseGeneratedQuestions(
    JSON.stringify({
      questions: [
        {
          domain_specific_question: "collaborative uncertainty-aware prototype regulation",
          domain_agnostic_question:
            "How can a system regulate uncertainty-aware state updates across collaborators?",
          rationale: "Adds a non-incremental collaboration angle missing from the base graph.",
        },
      ],
    })
  );
  assert.equal(generated.length, 1);

  const packet = buildIdeaCatalystDecompositionPacket(
    {
      targetDomain: "Computer Science",
      longTermGoal: "Build stronger cross-domain research ideation.",
      problemStatement: "GCD needs better memory-preserving adaptation.",
      selectedTrackId: "track-main",
      challengeClusters: ["memory preservation under domain shift"],
      graphChallengeClusters: ["memory preservation under domain shift"],
      occupiedSolutionZones: [],
      transferBridges: ["psychology:metacontrol"],
    },
    {
      llmGeneratedQuestions: generated,
    }
  );

  assert.equal(
    packet.questions.some(
      (entry) =>
        entry.source === "llm_generated" &&
        /collaborative uncertainty-aware prototype regulation/i.test(
          entry.domain_specific_question
        )
    ),
    true
  );
});
