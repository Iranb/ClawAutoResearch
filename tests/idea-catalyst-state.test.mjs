import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeCatalystSessionState,
  serializeCatalystSessionState,
  summarizeIdeaCatalystSessionState,
} from "../tools/idea-catalyst/state.ts";

test("CatalystSessionState normalizes richer iteration history with durable defaults", () => {
  const state = normalizeCatalystSessionState({
    status: "requisition",
    micro_stage: "gatekeeping",
    iteration_count: 2,
    iterations: [
      {
        iteration: 0,
        strategy: "initial_scan",
        coverage_summary: {
          total_questions: 3,
          resolved_questions: 1,
          partial_questions: 1,
          unexplored_questions: 1,
          unresolved_questions: 2,
        },
        selected_domains: ["Psychology"],
        pruned_domains: [],
        bridge_evidence_tier: "weak",
        gate_decision: "requisition",
        timestamp: "2026-04-05T00:00:00.000Z",
      },
      {
        iteration: 1,
        strategy: "requisition",
        coverage_summary: {
          total_questions: 3,
          resolved_questions: 1,
          partial_questions: 1,
          unexplored_questions: 1,
          unresolved_questions: 2,
        },
        selected_domains: ["Psychology"],
        pruned_domains: ["Economics"],
        bridge_evidence_tier: "weak",
        gate_decision: "requisition",
        timestamp: "2026-04-05T00:00:01.000Z",
      },
    ],
    final_strategy: "requisition",
    trigger: "idea_catalyst",
    agent_id: "researcher",
    updated_at: "2026-04-05T00:00:01.000Z",
  });

  assert.equal(state.iterationCount, 2);
  assert.equal(state.iterations.length, 2);
  assert.equal(state.iterations[1].strategy, "requisition");
  assert.equal(state.finalStrategy, "requisition");
  assert.deepEqual(state.prunedSourceDomains, []);

  const serialized = serializeCatalystSessionState(state);
  assert.equal(serialized.iteration_count, 2);
  assert.equal(serialized.final_strategy, "requisition");
});

test("summarizeIdeaCatalystSessionState surfaces validation errors for malformed iteration history", () => {
  const summary = summarizeIdeaCatalystSessionState({
    status: "ready",
    micro_stage: "judging",
    iteration_count: 2,
    iterations: [
      {
        iteration: 0,
        strategy: "initial_scan",
      },
    ],
  });

  assert.equal(summary.state.iterationCount, 2);
  assert.equal(summary.validationErrors.length >= 1, true);
  assert.match(summary.validationErrors.join("\n"), /iteration_count|iterations/i);
});
