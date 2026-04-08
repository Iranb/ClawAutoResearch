import test from "node:test";
import assert from "node:assert/strict";

import {
  getIdeaCatalystPromptContract,
  getIdeaCatalystRankingCriteria,
} from "../tools/idea-catalyst/prompt-contracts.ts";

test("prompt-contract helpers expose the public repo stage fields", () => {
  const contract = getIdeaCatalystPromptContract();
  assert.ok(contract.initial_decomposition.required_fields.includes("coarse_grained_domain"));
  assert.ok(contract.initial_decomposition.required_fields.includes("target_domain_queries"));
  assert.ok(contract.target_domain_analysis.required_fields.includes("remaining_challenges"));
  assert.ok(contract.cross_domain_queries.required_fields.includes("cross_domain_searches"));
  assert.ok(contract.integration.required_fields.includes("idea_fragment"));
});

test("ranking criteria mirror the public four-dimension comparison", () => {
  const criteria = getIdeaCatalystRankingCriteria();
  assert.ok(criteria.includes("DEPTH OF INTEGRATION"));
  assert.ok(criteria.includes("MULTI-STAGE DISCIPLINARY ENGAGEMENT"));
  assert.ok(criteria.includes("INNOVATION PAYOFF"));
  assert.ok(criteria.includes("NOVELTY + FEASIBILITY"));
});
