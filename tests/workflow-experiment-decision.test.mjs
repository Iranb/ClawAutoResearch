import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateExperimentSearchDecision,
  summarizeExperimentFailureClusters,
} from "../tools/workflow-experiment-decision.ts";

test("experiment decision requests implementation repair when baseline fairness is not yet clean", () => {
  const result = evaluateExperimentSearchDecision({
    experimentSearch: {
      status: "running",
      baseline_fairness_status: "pending",
      implementation_confidence: "unknown",
      multi_seed_status: "pending",
      ablation_status: "pending",
      innovation_status: "unknown",
      search_exhaustion_status: "active",
      evidence_cleanliness_status: "partial",
    },
    experimentSearchSpec: {},
    experimentLedger: { experiments: [] },
    gpuMonitor: { recommendation: "none", likelyFinishedRunCount: 0 },
  });

  assert.equal(result.decision, "repair_implementation");
  assert.match(result.rationale, /baseline fairness/i);
  assert.equal(result.persistedPatch.baseline_fairness_status, "pending");
});

test("experiment decision requires multi-seed after a promising candidate but before stability validation", () => {
  const result = evaluateExperimentSearchDecision({
    experimentSearch: {
      status: "running",
      last_decision: "advance",
      baseline_fairness_status: "ready",
      implementation_confidence: "trusted",
      multi_seed_status: "pending",
      plot_pack_status: "ready",
      ablation_status: "pending",
      innovation_status: "unknown",
      search_exhaustion_status: "active",
      evidence_cleanliness_status: "clean",
    },
    experimentSearchSpec: {},
    experimentLedger: { experiments: [] },
    gpuMonitor: { recommendation: "none", likelyFinishedRunCount: 0 },
  });

  assert.equal(result.decision, "require_multi_seed");
  assert.equal(result.validationStage, "multi_seed_validation");
});

test("experiment decision rolls back only after repeated clean scientific failures", () => {
  const result = evaluateExperimentSearchDecision({
    experimentSearch: {
      status: "running",
      baseline_fairness_status: "ready",
      implementation_confidence: "trusted",
      multi_seed_status: "ready",
      ablation_status: "ready",
      innovation_status: "unknown",
      search_exhaustion_status: "exhausted",
      evidence_cleanliness_status: "clean",
    },
    experimentSearchSpec: {},
    experimentLedger: {
      project_id: "demo",
      experiments: [
        {
          experiment_id: "exp-1",
          status: "failed",
          failure_signature: "under baseline after fair comparison",
          decision: "discard",
          notes: ["scientific regression"],
        },
        {
          experiment_id: "exp-2",
          status: "failed",
          failure_signature: "under baseline after fair comparison",
          decision: "discard",
          notes: ["scientific regression"],
        },
      ],
    },
    gpuMonitor: { recommendation: "none", likelyFinishedRunCount: 0 },
  });

  assert.equal(result.decision, "rollback_to_plan");
  assert.equal(result.decisionConfidence, "high");
});

test("experiment decision prioritizes runtime reconciliation when likely-finished runs exist", () => {
  const result = evaluateExperimentSearchDecision({
    experimentSearch: {
      status: "running",
      baseline_fairness_status: "ready",
      implementation_confidence: "trusted",
      multi_seed_status: "pending",
      ablation_status: "pending",
      innovation_status: "unknown",
      search_exhaustion_status: "active",
      evidence_cleanliness_status: "partial",
    },
    experimentSearchSpec: {},
    experimentLedger: { experiments: [] },
    gpuMonitor: { recommendation: "reconcile_finished", likelyFinishedRunCount: 1 },
  });

  assert.equal(result.decision, "reconcile_runtime");
  assert.equal(result.validationStage, "runtime_reconciliation");
});

test("experiment decision respects unresolved review blockers before searching further", () => {
  const result = evaluateExperimentSearchDecision({
    experimentSearch: {
      status: "running",
      baseline_fairness_status: "ready",
      implementation_confidence: "trusted",
      multi_seed_status: "pending",
      ablation_status: "pending",
      innovation_status: "unknown",
      search_exhaustion_status: "active",
      evidence_cleanliness_status: "clean",
    },
    experimentSearchSpec: {},
    experimentLedger: { experiments: [] },
    experimentReviewState: {
      blocker_count: 1,
      blockers: ["baseline protocol drift must be fixed"],
    },
    experimentMemory: {
      last_decision_summary: "Previous run drifted from the baseline protocol.",
    },
    gpuMonitor: { recommendation: "none", likelyFinishedRunCount: 0 },
  });

  assert.equal(result.decision, "repair_implementation");
  assert.equal(result.validationStage, "review_blockers");
  assert.match(String(result.persistedPatch.pending_reason), /Previous memory summary/i);
});

test("experiment decision rolls back when baseline fairness stays broken until search exhaustion", () => {
  const result = evaluateExperimentSearchDecision({
    experimentSearch: {
      status: "running",
      baseline_fairness_status: "pending",
      implementation_confidence: "trusted",
      multi_seed_status: "pending",
      ablation_status: "pending",
      innovation_status: "unknown",
      search_exhaustion_status: "exhausted",
      evidence_cleanliness_status: "partial",
    },
    experimentSearchSpec: {},
    experimentLedger: { experiments: [] },
    gpuMonitor: { recommendation: "none", likelyFinishedRunCount: 0 },
  });

  assert.equal(result.decision, "rollback_to_plan");
  assert.match(result.rationale, /baseline fairness/i);
});

test("experiment decision rolls back when implementation instability exhausts the search budget", () => {
  const result = evaluateExperimentSearchDecision({
    experimentSearch: {
      status: "running",
      baseline_fairness_status: "ready",
      implementation_confidence: "untrusted",
      multi_seed_status: "pending",
      ablation_status: "pending",
      innovation_status: "unknown",
      search_exhaustion_status: "exhausted",
      evidence_cleanliness_status: "partial",
    },
    experimentSearchSpec: {},
    experimentLedger: {
      project_id: "demo",
      experiments: [
        {
          experiment_id: "exp-1",
          status: "failed",
          failure_signature: "traceback shape mismatch",
        },
        {
          experiment_id: "exp-2",
          status: "failed",
          failure_signature: "traceback shape mismatch",
        },
      ],
    },
    gpuMonitor: { recommendation: "none", likelyFinishedRunCount: 0 },
  });

  assert.equal(result.decision, "rollback_to_plan");
  assert.match(result.rationale, /implementation\/runtime instability/i);
});

test("failure clustering groups repeated signatures by failure class", () => {
  const clusters = summarizeExperimentFailureClusters({
    project_id: "demo",
    experiments: [
      {
        experiment_id: "exp-1",
        status: "failed",
        failure_signature: "CUDA OOM during training",
      },
      {
        experiment_id: "exp-2",
        status: "failed",
        failure_signature: "CUDA OOM during training",
      },
      {
        experiment_id: "exp-3",
        status: "failed",
        failure_signature: "under baseline after ablation",
        decision: "discard",
      },
    ],
  });

  assert.equal(clusters[0].failureClass, "runtime");
  assert.equal(clusters[0].count, 2);
  assert.equal(clusters.some((cluster) => cluster.failureClass === "scientific"), true);
});
