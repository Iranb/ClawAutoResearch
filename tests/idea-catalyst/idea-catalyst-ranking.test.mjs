import test from "node:test";
import assert from "node:assert/strict";

import { rankIdeaCatalystFragments } from "../../tools/idea-catalyst/ranking.ts";
import { buildIdeaCatalystTournament } from "../../tools/idea-catalyst/tournament.ts";

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

function tournamentCandidate(overrides) {
  return {
    candidate_id: "cand-base",
    parent_candidate_id: null,
    generation_round: 1,
    source_domain: "Psychology",
    frontier_type: "transfer",
    transferred_mechanism: "metacontrol arbitration",
    idea_fragment: {
      title: "Metacontrol memory router",
      core_insight: "Gate prototype updates with metacontrol.",
      challenge_resolution: "Stabilize memory updates under domain shift.",
      concrete_realization: "Add an arbitration head over prototype updates.",
    },
    evidence_chain_refs: [{ ref_id: "chain-base" }],
    source_spans: [{ span_id: "span-base" }],
    bridge_path_ids: ["bridge-base"],
    path_trace: [{ from: "source", to: "target" }],
    path_completeness: 0.85,
    domain_distance: 0.7,
    baseline_to_compare: "SimGCD",
    primary_metric: "ACC",
    falsifier_pilot: "Ablate the transferred mechanism and compare ACC.",
    weakest_assumption: "The mechanism transfers without collapsing prototypes.",
    claim_cap: "confirmatory",
    evidence_tier: "strong",
    evidence_density: 0.8,
    mechanism_support_density: 0.75,
    supporting_papers: ["paper-base"],
    source_path: "test",
    ...overrides,
  };
}

test("candidate tournament persists scorecards, diversity-aware selected ideas, and rejection reasons", () => {
  const result = buildIdeaCatalystTournament({
    topK: 2,
    candidatePool: {
      candidates: [
        tournamentCandidate({
          candidate_id: "cand-psych",
          source_domain: "Psychology",
          transferred_mechanism: "metacontrol arbitration",
          evidence_chain_refs: [{ ref_id: "chain-psych" }],
          source_spans: [{ span_id: "span-psych" }],
          bridge_path_ids: ["bridge-psych"],
          domain_distance: 0.72,
        }),
        tournamentCandidate({
          candidate_id: "cand-robot",
          source_domain: "Robotics",
          transferred_mechanism: "curriculum relay",
          evidence_chain_refs: [{ ref_id: "chain-robot" }],
          source_spans: [{ span_id: "span-robot" }],
          bridge_path_ids: ["bridge-robot"],
          domain_distance: 0.66,
          evidence_density: 0.76,
          mechanism_support_density: 0.78,
        }),
        tournamentCandidate({
          candidate_id: "cand-psych-duplicate",
          source_domain: "Psychology",
          transferred_mechanism: "metacontrol arbitration",
          evidence_chain_refs: [{ ref_id: "chain-psych-duplicate" }],
          source_spans: [{ span_id: "span-psych-duplicate" }],
          bridge_path_ids: ["bridge-psych-duplicate"],
          weighted_score_hint: 0.4,
          evidence_density: 0.62,
          mechanism_support_density: 0.6,
        }),
        tournamentCandidate({
          candidate_id: "cand-missing-metric",
          source_domain: "Control Theory",
          transferred_mechanism: "adaptive regulation",
          baseline_to_compare: null,
          primary_metric: null,
          claim_cap: "exploratory",
          evidence_tier: "moderate",
        }),
      ],
    },
  });

  assert.equal(result.scorecard.contract_version, "idea-catalyst-candidate-scorecard-v1");
  assert.equal(result.tournament.contract_version, "idea-catalyst-candidate-tournament-v1");
  assert.equal(result.selectedIdeas.contract_version, "idea-catalyst-selected-ideas-v1");
  assert.equal(result.rejectedIdeas.contract_version, "idea-catalyst-rejected-ideas-v1");
  assert.equal(result.scorecard.scoring_policy.hard_filters_first, true);
  assert.match(
    result.scorecard.scoring_policy.llm_judge_policy,
    /existing candidate evidence/i
  );

  const psychScorecard = result.scorecard.candidates.find(
    (candidate) => candidate.candidate_id === "cand-psych"
  );
  assert.ok(psychScorecard);
  assert.deepEqual(Object.keys(psychScorecard.dimensions), [
    "evidence_support",
    "source_span_support",
    "path_completeness",
    "graph_novelty",
    "domain_distance",
    "mechanism_transferability",
    "target_challenge_alignment",
    "feasibility",
    "falsifiability",
    "baseline_metric_readiness",
    "claim_safety",
    "diversity_penalty",
  ]);
  assert.equal(typeof psychScorecard.dimensions.evidence_support.weight, "number");
  assert.equal(typeof psychScorecard.dimensions.evidence_support.rationale, "string");
  assert.equal(
    psychScorecard.dimensions.evidence_support.evidence_refs[0].ref_id,
    "chain-psych"
  );

  assert.equal(result.tournament.pairwise_results.length >= 1, true);
  assert.ok(
    result.tournament.pairwise_results.every(
      (entry) =>
        entry.allowed_evidence_scope === "candidate_existing_evidence_only" &&
        /no new evidence/i.test(entry.rationale)
    )
  );

  assert.equal(result.selectedIdeas.selected_count, 2);
  assert.deepEqual(
    result.selectedIdeas.selected_ideas.map((candidate) => candidate.source_domain).sort(),
    ["Psychology", "Robotics"]
  );
  assert.ok(
    result.selectedIdeas.selected_ideas.every(
      (candidate) =>
        candidate.baseline_to_compare &&
        candidate.primary_metric &&
        candidate.falsifier_pilot &&
        candidate.weakest_assumption &&
        candidate.claim_cap
    )
  );

  const rejectionReasons = result.rejectedIdeas.rejected_ideas.map(
    (candidate) => candidate.rejection_reason
  );
  assert.ok(rejectionReasons.includes("duplicate_mechanism"));
  assert.ok(rejectionReasons.includes("missing_metric"));
});

test("confirmatory candidates without source spans remain blocked from experiment entry", () => {
  const result = buildIdeaCatalystTournament({
    topK: 1,
    candidatePool: {
      candidates: [
        tournamentCandidate({
          candidate_id: "cand-confirmatory-no-span",
          source_spans: [],
          bridge_path_ids: ["bridge-no-span"],
          evidence_chain_refs: [{ ref_id: "chain-no-span" }],
          claim_cap: "confirmatory",
          evidence_tier: "strong",
        }),
      ],
    },
  });

  const scorecard = result.scorecard.candidates.find(
    (candidate) => candidate.candidate_id === "cand-confirmatory-no-span"
  );
  assert.ok(scorecard);
  assert.ok(scorecard.hard_filters.rejection_reasons.includes("claim_unsafe"));
  assert.equal(scorecard.hard_filters.eligible_for_experiment, false);
  assert.equal(result.selectedIdeas.selected_count, 0);
});
