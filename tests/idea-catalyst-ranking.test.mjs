import test from "node:test";
import assert from "node:assert/strict";

import { rankIdeaCatalystFragments } from "../tools/idea-catalyst/ranking.ts";

test("rankIdeaCatalystFragments emits pairwise Elo judging details and a top-3 summary", () => {
  const result = rankIdeaCatalystFragments([
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
    {
      fragment_id: "frag-c",
      title: "Bayesian Prototype Relay",
      source_domain: "Statistics",
      novelty: 0.8,
      feasibility: 0.71,
      relevance: 0.76,
      clarity: 0.77,
      interdisciplinary_potential: 0.81,
    },
  ]);

  assert.equal(result.pairwise_results.length, 3);
  assert.equal(result.ranking.length, 3);
  assert.equal(result.judging_summary.compared_pairs, 3);
  assert.deepEqual(result.judging_summary.scoring_dimensions, [
    "novelty",
    "feasibility",
    "relevance",
    "clarity",
    "interdisciplinary_potential",
  ]);
  assert.equal(result.judging_summary.top_3.length, 3);
  assert.equal(result.judging_summary.top_fragment_id, result.ranking[0].fragment_id);

  const firstPair = result.pairwise_results[0];
  assert.ok(firstPair);
  assert.equal(typeof firstPair.overall_winner, "string");
  assert.equal(typeof firstPair.elo_delta, "number");
  assert.equal(typeof firstPair.margin, "number");
  assert.equal(typeof firstPair.vote_breakdown, "object");
  assert.equal(Array.isArray(firstPair.reasoning_points), true);
  assert.match(firstPair.reasoning_points[0] ?? "", /dominates|wins|leads/i);

  const leader = result.ranking[0];
  assert.ok(leader.elo_score > result.ranking[1].elo_score);
  assert.equal(typeof leader.head_to_head_wins, "number");
  assert.equal(typeof leader.average_margin, "number");

  const topSummary = result.judging_summary.top_3[0];
  assert.equal(topSummary.fragment_id, leader.fragment_id);
  assert.match(topSummary.summary, /novelty|feasibility|relevance|clarity/i);
});
