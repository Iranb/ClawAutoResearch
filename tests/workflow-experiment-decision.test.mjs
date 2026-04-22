import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateExperimentSearchDecision,
  summarizeExperimentFailureClusters,
} from "../tools/workflow-experiment-decision.ts";

test("experiment decision routes launch_not_started back to researcher orchestration", () => {
  const result = evaluateExperimentSearchDecision({
    experimentSearch: {
      status: "not_started",
      baseline_fairness_status: "unknown",
      implementation_confidence: "unknown",
      multi_seed_status: "pending",
      ablation_status: "pending",
      innovation_status: "unknown",
      search_exhaustion_status: "unknown",
      evidence_cleanliness_status: "unknown",
    },
    experimentSearchSpec: {},
    experimentLedger: { experiments: [] },
    gpuMonitor: { recommendation: "none", likelyFinishedRunCount: 0 },
  });

  assert.equal(result.decision, "launch_pending");
  assert.equal(result.validationStage, "launch_planning");
  assert.match(result.rationale, /no experiment launch has started yet/i);
});

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
      one_change_signature: "routing frequency sweep",
      one_change_validation_status: "ready",
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

test("experiment decision downgrades a promising candidate when the fixed trial budget is exceeded", () => {
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
      last_candidate_experiment_id: "exp-3",
      one_change_signature: "routing frequency sweep",
      one_change_validation_status: "ready",
    },
    experimentSearchSpec: {
      inner_loop_policy: {
        trial_time_budget_minutes: 5,
        strict_comparable_budget: true,
      },
    },
    experimentLedger: {
      experiments: [
        {
          experiment_id: "exp-3",
          launched_at: "2026-04-16T00:00:00.000Z",
          completed_at: "2026-04-16T00:07:30.000Z",
          summary: "Candidate exceeded runtime budget but looked promising.",
        },
      ],
    },
    gpuMonitor: { recommendation: "none", likelyFinishedRunCount: 0 },
  });

  assert.equal(result.decision, "continue_tuning");
  assert.equal(result.validationStage, "inner_loop_validation");
  assert.match(result.rationale, /fixed trial budget/i);
  assert.equal(result.persistedPatch.comparable_trial_budget_status, "over_budget");
});

test("experiment decision downgrades effective candidates when baseline dataset coverage is still incomplete", () => {
  const result = evaluateExperimentSearchDecision({
    experimentSearch: {
      status: "ready_for_analysis",
      baseline_fairness_status: "ready",
      implementation_confidence: "trusted",
      multi_seed_status: "ready",
      ablation_status: "ready",
      innovation_status: "supported",
      search_exhaustion_status: "active",
      evidence_cleanliness_status: "clean",
      one_change_signature: "graph grounded routing",
      one_change_validation_status: "ready",
      comparable_trial_budget_status: "within_budget",
      last_candidate_experiment_id: "exp-4",
    },
    experimentSearchSpec: {
      outer_loop_policy: {
        require_baseline_dataset_coverage_for_effective_candidates: true,
      },
    },
    manifest: {
      research_program: {
        datasets: ["CUB-200", "ImageNet-Subset"],
        tracks: [
          {
            track_id: "track-a",
            hypothesis: "Graph grounded routing improves support precision.",
            novelty_basis: "Route evidence through graph support signals.",
          },
        ],
      },
    },
    experimentLedger: {
      experiments: [
        {
          experiment_id: "exp-4",
          metadata: {
            datasets: ["CUB-200"],
          },
          summary: "The candidate improved support precision on CUB-200.",
        },
      ],
    },
    gpuMonitor: { recommendation: "none", likelyFinishedRunCount: 0 },
  });

  assert.equal(result.decision, "innovation_fragile");
  assert.equal(result.validationStage, "dataset_coverage_validation");
  assert.equal(result.persistedPatch.baseline_dataset_coverage_status, "partial");
  assert.deepEqual(result.persistedPatch.baseline_dataset_coverage_missing, [
    "ImageNet-Subset",
  ]);
});

test("experiment decision downgrades broad innovation drift only after a candidate looks effective", () => {
  const result = evaluateExperimentSearchDecision({
    experimentSearch: {
      status: "ready_for_analysis",
      baseline_fairness_status: "ready",
      implementation_confidence: "trusted",
      multi_seed_status: "ready",
      ablation_status: "ready",
      innovation_status: "supported",
      search_exhaustion_status: "active",
      evidence_cleanliness_status: "clean",
      one_change_signature: "graph grounded routing",
      one_change_validation_status: "ready",
      comparable_trial_budget_status: "within_budget",
      last_candidate_experiment_id: "exp-5",
    },
    experimentSearchSpec: {
      outer_loop_policy: {
        innovation_deviation_tolerance: "wide",
      },
    },
    manifest: {
      research_program: {
        datasets: ["CUB-200"],
        tracks: [
          {
            track_id: "track-a",
            hypothesis: "Graph grounded routing improves support precision.",
            novelty_basis: "Route evidence through graph support signals.",
            innovation_points: ["graph grounded routing", "support precision"],
          },
        ],
      },
    },
    experimentLedger: {
      experiments: [
        {
          experiment_id: "exp-5",
          metadata: {
            datasets: ["CUB-200"],
          },
          summary:
            "This candidate now focuses on a diffusion denoiser curriculum for image generation fidelity.",
        },
      ],
    },
    gpuMonitor: { recommendation: "none", likelyFinishedRunCount: 0 },
  });

  assert.equal(result.decision, "innovation_fragile");
  assert.equal(result.validationStage, "innovation_alignment_review");
  assert.equal(result.persistedPatch.innovation_deviation_status, "broad_drift");
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
