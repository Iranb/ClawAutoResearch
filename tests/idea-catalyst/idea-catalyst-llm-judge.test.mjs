import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPairwiseComparisonPrompt,
  parsePairwiseJudgment,
} from "../../tools/idea-catalyst/llm-judge.ts";
import { rankIdeaCatalystFragments } from "../../tools/idea-catalyst/ranking.ts";

test("llm judge prompt includes the research problem, target domain, and both fragments", () => {
  const prompt = buildPairwiseComparisonPrompt({
    researchProblem: "Improve graph-grounded interdisciplinary idea generation.",
    targetDomain: "Computer Science",
    fragmentA: {
      fragment_id: "frag-a",
      title: "Metacontrol-guided memory regulation",
      source_domain: "Psychology",
      target_domain: "Computer Science",
      transferred_mechanism: "metacontrol state regulation",
      core_insight:
        "Balance persistence and flexibility to adapt without forgetting prior collaborative context.",
      integration_mechanism: {
        target_domain_elements: ["graph-grounded ideation", "memory regulation"],
        selected_takeaways: [
          {
            source_domain_formulation: "Goal-directed behavior balances persistence and flexibility.",
            mechanism_explanation: "Adaptive control changes state update policy under shifting goals.",
          },
        ],
      },
      challenge_resolution: {
        addresses_target_challenge:
          "Preserves prior state while adapting to evolving research constraints.",
      },
      concrete_realization: {
        proposed_approach:
          "Add a bounded metacontrol gate to regulate when evidence updates rewrite a candidate idea.",
      },
      evidence_tier: "strong",
      claim_cap: "confirmatory",
      bridge_path_ids: ["bridge-1"],
      source_spans: [{ span_id: "span-1" }],
      evidence_chain_refs: [{ ref_id: "chain-1" }],
      novelty: 0.82,
      feasibility: 0.74,
      relevance: 0.86,
      clarity: 0.8,
      interdisciplinary_potential: 0.84,
    },
    fragmentB: {
      fragment_id: "frag-b",
      title: "Control-theoretic adaptive prototype relay",
      source_domain: "Control Theory",
      novelty: 0.84,
      feasibility: 0.69,
      relevance: 0.83,
      clarity: 0.78,
      interdisciplinary_potential: 0.82,
    },
  });

  assert.match(prompt, /Improve graph-grounded interdisciplinary idea generation/i);
  assert.match(prompt, /Computer Science/i);
  assert.match(prompt, /Metacontrol-guided memory regulation/i);
  assert.match(prompt, /Control-theoretic adaptive prototype relay/i);
  assert.match(prompt, /depth of integration/i);
  assert.match(prompt, /Balance persistence and flexibility/i);
  assert.match(prompt, /source_span_count: 1/i);
  assert.match(prompt, /larger source-target distance/i);
  assert.match(prompt, /Dimension definitions/i);
});

test("llm judge parser accepts structured JSON responses", () => {
  const judgment = parsePairwiseJudgment(
    JSON.stringify({
      fragment_a: "frag-a",
      fragment_b: "frag-b",
      preferred: "b",
      reasoning:
        "Fragment B integrates a more explicit control mechanism into the target domain.",
      dimensions: {
        depth_of_integration: "b",
        multi_stage_disciplinary_engagement: "b",
        innovation_payoff: "b",
        novelty_feasibility: "b",
      },
    })
  );

  assert.equal(judgment.preferred, "b");
  assert.match(judgment.reasoning, /control mechanism/i);
  assert.equal(judgment.dimensions.depth_of_integration, "b");
});

test("rankIdeaCatalystFragments incorporates optional llm pairwise judgments", () => {
  const result = rankIdeaCatalystFragments(
    [
      {
        fragment_id: "frag-a",
        title: "Adaptive Memory Bridge",
        source_domain: "Neuroscience",
        novelty: 0.91,
        feasibility: 0.64,
        relevance: 0.87,
        clarity: 0.8,
        interdisciplinary_potential: 0.94,
      },
      {
        fragment_id: "frag-b",
        title: "Constraint Transfer Curriculum",
        source_domain: "Robotics",
        novelty: 0.74,
        feasibility: 0.89,
        relevance: 0.79,
        clarity: 0.83,
        interdisciplinary_potential: 0.76,
      },
    ],
    {
      llmJudgments: [
        {
          fragment_a: "frag-a",
          fragment_b: "frag-b",
          preferred: "b",
          reasoning:
            "Fragment B shows deeper interdisciplinary integration despite lower base novelty.",
          dimensions: {
            depth_of_integration: "b",
            multi_stage_disciplinary_engagement: "b",
            innovation_payoff: "b",
            novelty_feasibility: "b",
          },
        },
      ],
    }
  );

  assert.equal(result.judging_summary.llm_judgment_count, 1);
  assert.equal(result.pairwise_results.some((entry) => entry.judge_type === "llm"), true);
  assert.equal(result.ranking[0].fragment_id, "frag-b");
});
