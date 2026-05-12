import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializeCodeExperimentBundleImpl } from "../../tools/workflow-guard-materializers/code-experiment-bundle-materializer.ts";
import { materializeLocalExperimentExecutionImpl } from "../../tools/workflow-guard-materializers/experiment-execution-materializer.ts";
import { collectExecutionProofReceipts } from "../../tools/workflow-execution-proof.ts";
import { evaluateExperimentSearchDecision } from "../../tools/workflow-experiment-decision.ts";
import { runWorkflowAutoIterator } from "../../tools/workflow-guard.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(targetPath, value = "") {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

test("local experiment execution materializer runs and reconciles a code bundle for analysis", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-local-experiment-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "local-exp",
    current_stage: "experiment",
    topic:
      "TOWARDS UNDERSTANDING WHY FIXMATCH GENERALIZES BETTER THAN SUPERVISED LEARNING 这篇论文里提到的方法改进GCD",
    orchestration_state: {
      stage_run_id: "stage-local-exp",
    },
    experiment_search: {
      candidate_head_commit: "candidate-local-exp",
    },
    research_program: {
      goal: "Improve generalized category discovery with FixMatch-style consistency.",
      primary_metric: "H-score",
      baseline_reference: "supervised GCD baseline",
      datasets: ["local-gcd-reference-benchmark"],
      tracks: [
        {
          track_id: "track-main",
          status: "active",
          hypothesis:
            "FixMatch consistency filtering improves novel-class discovery without hurting known-class accuracy.",
          novelty_basis:
            "Adapt FixMatch pseudo-label consistency to known/novel GCD calibration.",
          main_metric: "H-score",
          required_baselines: ["SimGCD"],
          required_ablations: ["minus consistency filtering"],
          write_scope: {
            allowed_claim_ids: ["claim-fixmatch-consistency"],
          },
        },
      ],
      plan_alternatives: [
        {
          option_id: "plan-fixmatch",
          linked_track_id: "track-main",
          graph_evidence_paths: ["researcher/SOTA_MATRIX.md#simgcd"],
        },
      ],
      plan_selection: {
        selected_option_id: "plan-fixmatch",
        selected_track_id: "track-main",
        decisive_graph_evidence_paths: ["researcher/LITERATURE_REVIEW.md#fixmatch"],
      },
    },
  });

  const bundle = await materializeCodeExperimentBundleImpl({
    projectRoot,
    trigger: "test",
    agentId: "coder",
  });
  assert.equal(bundle.experimentId, "exp-1");
  assert.ok(bundle.generatedFiles.some((entry) => entry.endsWith("/GCD_PROTOCOL.json")));
  assert.ok(bundle.generatedFiles.some((entry) => entry.endsWith("/data/gcd_reference_split.jsonl")));
  const trainPy = await fs.readFile(path.join(projectRoot, bundle.bundleDir, "train.py"), "utf8");
  assert.match(trainPy, /def run_fixmatch_consistency/);
  assert.match(trainPy, /def apply_class_balance_debiasing/);
  assert.match(trainPy, /def compute_known_novel_h_score/);
  const readme = await fs.readFile(path.join(projectRoot, bundle.bundleDir, "README.md"), "utf8");
  assert.doesNotMatch(readme, /synthetic proxy|local proxy/i);
  assert.match(readme, /IMPLEMENTATION_EVIDENCE_PACKET\.json/);

  const evidencePacketPaths = [
    "coder/IMPLEMENTATION_EVIDENCE_PACKET.json",
    "coder/BASELINE_ALIGNMENT_PACKET.json",
    "coder/HYPERPARAMETER_SOURCE_MAP.json",
    "coder/DATASET_PROTOCOL_LOCK.json",
    "coder/REPRODUCTION_RISK_LEDGER.json",
  ];
  for (const packetPath of evidencePacketPaths) {
    assert.ok(bundle.generatedFiles.includes(packetPath), `${packetPath} was generated`);
    await fs.access(path.join(projectRoot, packetPath));
  }

  const bundleManifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, bundle.bundleDir, "EXPERIMENT_MANIFEST.json"), "utf8")
  );
  assert.equal(
    bundleManifest.implementation_evidence_packet_path,
    "coder/IMPLEMENTATION_EVIDENCE_PACKET.json"
  );
  assert.equal(
    bundleManifest.hyperparameter_source_map_path,
    "coder/HYPERPARAMETER_SOURCE_MAP.json"
  );

  const implementationEvidence = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "coder", "IMPLEMENTATION_EVIDENCE_PACKET.json"),
      "utf8"
    )
  );
  assert.equal(implementationEvidence.track_id, "track-main");
  assert.equal(implementationEvidence.status, "citation_grounded");
  assert.ok(
    implementationEvidence.citation_grounding.selected_plan_evidence_paths.includes(
      "researcher/SOTA_MATRIX.md#simgcd"
    )
  );
  assert.ok(
    implementationEvidence.citation_grounding.allowed_claim_ids.includes(
      "claim-fixmatch-consistency"
    )
  );
  assert.match(
    implementationEvidence.implementation_contract.changed_files.join("\n"),
    /train\.py/
  );
  assert.match(
    JSON.stringify(implementationEvidence.implementation_contract.integration_points),
    /run_fixmatch_consistency|FixMatch/i
  );

  const baselineAlignment = JSON.parse(
    await fs.readFile(path.join(projectRoot, "coder", "BASELINE_ALIGNMENT_PACKET.json"), "utf8")
  );
  assert.ok(baselineAlignment.required_baselines.includes("SimGCD"));
  assert.equal(baselineAlignment.primary_metric, "H-score");
  assert.equal(baselineAlignment.dataset_path, `${bundle.bundleDir}/data/gcd_reference_split.jsonl`);

  const hyperparameterMap = JSON.parse(
    await fs.readFile(path.join(projectRoot, "coder", "HYPERPARAMETER_SOURCE_MAP.json"), "utf8")
  );
  assert.equal(
    hyperparameterMap.parameters.find((entry) => entry.name === "weak_confidence_threshold").value,
    0.18
  );
  assert.equal(
    hyperparameterMap.parameters.find((entry) => entry.name === "per_class_cap").source_symbol,
    "apply_class_balance_debiasing"
  );

  const datasetLock = JSON.parse(
    await fs.readFile(path.join(projectRoot, "coder", "DATASET_PROTOCOL_LOCK.json"), "utf8")
  );
  assert.equal(datasetLock.status, "locked");
  assert.equal(datasetLock.split_contract.validation.total_rows, 180);

  const riskLedger = JSON.parse(
    await fs.readFile(path.join(projectRoot, "coder", "REPRODUCTION_RISK_LEDGER.json"), "utf8")
  );
  assert.equal(riskLedger.status, "bounded_reference");
  assert.equal(
    riskLedger.risks.find((entry) => entry.risk_id === "citation_grounding_gap").status,
    "mitigated"
  );

  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    schema_version: 1,
    project_id: "local-exp",
    updated_at: "2026-04-27T00:00:00.000Z",
    summary: {
      active_experiment_ids: ["exp-1"],
      last_completed_experiment_id: null,
      last_failed_experiment_id: null,
      best_known_config_ref: bundle.bundleDir,
      last_decision_summary: "dry-run completed successfully",
      papernexus_sync_required: false,
      papernexus_last_sync_at: null,
    },
    experiments: [
      {
        experiment_id: "exp-1",
        track_id: "track-main",
        config_ref: bundle.bundleDir,
        status: "dry_run_complete",
        updated_at: "2026-04-27T00:00:00.000Z",
        summary: "Code-stage dry run completed before experiment launch.",
      },
    ],
  });
  await writeJson(path.join(projectRoot, bundle.bundleDir, "RESULT_SUMMARY.json"), {
    run_id: "local-reference-gcd-42",
    status: "completed",
    baseline: {
      known_accuracy: 0.72,
      novel_accuracy: 0.31,
      h_score: 0.4334,
    },
    proposed: {
      known_accuracy: 0.74,
      novel_accuracy: 0.45,
      h_score: 0.5597,
    },
    ablations: {
      minus_class_balance_debiasing: { h_score: 0.5 },
      minus_consistency_filtering: { h_score: 0.49 },
    },
  });

  const result = await materializeLocalExperimentExecutionImpl({
    projectRoot,
    trigger: "test",
    agentId: "researcher",
  });
  assert.equal(result.experimentId, "exp-1");
  assert.ok(result.generatedFiles.includes("researcher/EXPERIMENT_LEDGER.json"));
  assert.ok(result.generatedFiles.includes("researcher/EXPERIMENT_SEARCH.json"));
  assert.ok(result.generatedFiles.includes("researcher/EXECUTION_PROOF.json"));

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.experiment_search.status, "ready_for_analysis");
  assert.equal(manifest.experiment_search.inner_loop_mode, "karpathy_fast_keep_discard");
  assert.equal(manifest.experiment_search.keep_discard_rule, "primary_metric_keep_discard");
  assert.equal(manifest.experiment_search.last_trial_outcome, "keep");
  assert.equal(manifest.experiment_search.comparable_trial_budget_status, "within_budget");
  assert.equal(manifest.experiment_search.multi_seed_status, "complete");
  assert.equal(manifest.experiment_search.plot_pack_status, "complete");
  assert.equal(manifest.experiment_search.one_change_validation_status, "ready");
  assert.match(manifest.experiment_search.one_change_signature, /FixMatch/i);
  assert.equal(manifest.experiment_search.baseline_dataset_coverage_status, "covered");
  assert.deepEqual(manifest.experiment_search.validated_dataset_envelope, [
    "local-gcd-reference-benchmark",
  ]);
  assert.equal(manifest.experiment_memory.last_completed_experiment_id, "exp-1");
  assert.equal(manifest.experiment_memory.karpathy_inner_loop_status, "completed");
  assert.equal(manifest.experiment_memory.karpathy_keep_discard_decision, "keep");
  assert.equal(manifest.execution_proof.status, "ready");

  const karpathyLoop = JSON.parse(
    await fs.readFile(path.join(projectRoot, "researcher", "KARPATHY_EXPERIMENT_LOOP.json"), "utf8")
  );
  assert.equal(karpathyLoop.status, "completed");
  assert.equal(karpathyLoop.mode, "karpathy_fast_keep_discard");
  assert.equal(karpathyLoop.keep_discard_decision, "keep");
  assert.equal(karpathyLoop.comparable_trial_budget_status, "within_budget");
  assert.equal(karpathyLoop.primary_metric.direction, "higher_is_better");

  const ledger = JSON.parse(
    await fs.readFile(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), "utf8")
  );
  assert.equal(ledger.experiments.length, 1);
  assert.equal(ledger.experiments[0].experiment_id, "exp-1");
  assert.equal(ledger.experiments[0].status, "completed");
  assert.match(ledger.experiments[0].metadata.execution.run_id, /^local-/);
  assert.equal(
    ledger.experiments[0].metadata.one_change_signature,
    manifest.experiment_search.one_change_signature
  );
  assert.equal(ledger.experiments[0].metadata.karpathy_inner_loop.mode, "karpathy_fast_keep_discard");
  assert.equal(ledger.experiments[0].metadata.karpathy_inner_loop.keep_discard_decision, "keep");

  const decision = evaluateExperimentSearchDecision({
    experimentSearch: manifest.experiment_search,
    experimentLedger: ledger,
    manifest,
  });
  assert.equal(decision.decision, "innovation_supported");

  const proof = await collectExecutionProofReceipts({
    projectRoot,
    manifest,
    experimentLedger: ledger,
  });
  assert.equal(proof.ready, true);
  assert.equal(proof.receiptCount, 1);
  assert.equal(proof.receipts[0].ledgerMatched, true);
  assert.equal(proof.receipts[0].stageRunMatched, true);
  assert.equal(proof.receipts[0].hasResultMetrics, true);
});

test("auto iterator commits code to experiment after local execution materializes ready evidence", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-local-experiment-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "local-exp-auto",
    current_stage: "code",
    owner_agent: "coder",
    current_micro_stage: "implementation_ready",
    topic:
      "TOWARDS UNDERSTANDING WHY FIXMATCH GENERALIZES BETTER THAN SUPERVISED LEARNING 这篇论文里提到的方法改进GCD",
    orchestration_state: {
      status: "running",
      current_owner: "coder",
      next_owner: "researcher",
      next_transition_candidate: "experiment",
      handoff_phase: "idle",
      stage_run_id: "stage-local-exp-auto",
    },
    experiment_search: {
      candidate_head_commit: "candidate-local-exp-auto",
    },
    research_program: {
      status: "approved",
      goal: "Improve generalized category discovery with FixMatch-style consistency.",
      primary_metric: "H-score",
      baseline_reference: "supervised GCD baseline",
      datasets: ["local-gcd-reference-benchmark"],
      tracks: [
        {
          track_id: "track-main",
          status: "active",
          hypothesis:
            "FixMatch consistency filtering improves novel-class discovery without hurting known-class accuracy.",
          novelty_basis:
            "Adapt FixMatch pseudo-label consistency to known/novel GCD calibration.",
          main_metric: "H-score",
        },
      ],
      plan_selection: {
        selected_track_id: "track-main",
      },
    },
  });

  const bundle = await materializeCodeExperimentBundleImpl({
    projectRoot,
    trigger: "test",
    agentId: "coder",
  });
  await writeJson(
    path.join(projectRoot, bundle.bundleDir, "RESULT_SUMMARY.json"),
    {
      run_id: "local-reference-gcd-42",
      status: "completed",
      baseline: {
        known_accuracy: 0.72,
        novel_accuracy: 0.31,
        h_score: 0.4334,
      },
      proposed: {
        known_accuracy: 0.74,
        novel_accuracy: 0.45,
        h_score: 0.5597,
      },
      ablations: {
        minus_class_balance_debiasing: { h_score: 0.5 },
        minus_consistency_filtering: { h_score: 0.49 },
      },
    }
  );

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    policy: {
      autoMode: "aggressive",
      autoGate: {
        enabled: false,
      },
    },
  });

  assert.equal(result.stageBefore, "code");
  assert.equal(result.stageAfter, "experiment");
  assert.deepEqual(result.missingStageSignals, []);
  assert.equal(result.ownerActivated, true);
  assert.equal(result.pendingHandoff, false);

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.current_stage, "experiment");
  assert.equal(manifest.owner_agent, "researcher");
  assert.equal(manifest.experiment_search.status, "ready_for_analysis");
  assert.equal(manifest.orchestration_state.pending_handoff_id, null);
});

test("local experiment execution repairs raw ready_for_analysis artifacts into execution proof", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-local-experiment-repair-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "local-exp-repair",
    current_stage: "experiment",
    topic: "Use FixMatch consistency to improve GCD",
    experiment_search: {
      status: "ready_for_analysis",
      evaluation_summary_path: "researcher/evaluation_summary.json",
      plot_pack_path: "researcher/plot_pack.json",
      candidate_head_commit: "candidate-repair",
    },
    orchestration_state: {
      stage_run_id: "stage-repair",
    },
    research_program: {
      status: "approved",
      goal: "Improve generalized category discovery with FixMatch-style consistency.",
      primary_metric: "H-score",
      baseline_reference: "prototype GCD baseline",
      datasets: ["local-gcd-reference-benchmark"],
      tracks: [
        {
          track_id: "track-main",
          status: "active",
          hypothesis:
            "FixMatch consistency filtering improves novel-class discovery without hurting known-class accuracy.",
          novelty_basis:
            "Adapt FixMatch pseudo-label consistency to known/novel GCD calibration.",
          main_metric: "H-score",
        },
      ],
      plan_selection: {
        selected_track_id: "track-main",
      },
    },
  });

  const bundle = await materializeCodeExperimentBundleImpl({
    projectRoot,
    trigger: "test",
    agentId: "coder",
  });
  const bundleDir = path.join(projectRoot, bundle.bundleDir);
  await writeJson(path.join(bundleDir, "RESULT_SUMMARY.json"), {
    run_id: "local-reference-gcd-42",
    status: "completed",
    baseline: {
      known_accuracy: 0.72,
      novel_accuracy: 0.31,
      h_score: 0.4334,
    },
    proposed: {
      known_accuracy: 0.74,
      novel_accuracy: 0.45,
      h_score: 0.5597,
    },
    ablations: {
      minus_class_balance_debiasing: { h_score: 0.5 },
      minus_consistency_filtering: { h_score: 0.49 },
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    schema_version: 1,
    project_id: "local-exp-repair",
    experiments: [
      {
        experiment_id: "exp-1",
        track_id: "track-main",
        config_ref: bundle.bundleDir,
        status: "completed",
        metadata: {
          execution: {
            run_id: "local-reference-gcd-42",
          },
        },
      },
    ],
  });

  const result = await materializeLocalExperimentExecutionImpl({
    projectRoot,
    trigger: "test-repair",
    agentId: "researcher",
  });
  assert.equal(result.experimentId, "exp-1");
  assert.ok(result.generatedFiles.includes("researcher/EXECUTION_PROOF.json"));

  const repairedSummary = JSON.parse(
    await fs.readFile(path.join(bundleDir, "RESULT_SUMMARY.json"), "utf8")
  );
  assert.equal(repairedSummary.metrics.delta_h_score, 0.1263);
  assert.equal(repairedSummary.key_metric.name, "h_score");
  assert.ok(Array.isArray(repairedSummary.result_paths));

  const proof = await collectExecutionProofReceipts({
    projectRoot,
    manifest: JSON.parse(await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")),
    experimentLedger: JSON.parse(
      await fs.readFile(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), "utf8")
    ),
  });
  assert.equal(proof.ready, true);
  assert.equal(proof.receipts[0].hasResultMetrics, true);
});

test("local experiment execution keeps Karpathy loop running when primary metric has no gain", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-local-experiment-zero-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "local-exp-zero",
    current_stage: "experiment",
    topic: "Try one graph-grounded candidate without metric gain",
    experiment_search: {
      status: "launching",
      track_id: "track-main",
      multi_seed_status: "pending",
      ablation_status: "pending",
      candidate_head_commit: "candidate-zero",
    },
    research_program: {
      status: "approved",
      primary_metric: "H-score",
      baseline_reference: "local GCD baseline",
      datasets: ["local-gcd-reference-benchmark"],
      tracks: [
        {
          track_id: "track-main",
          status: "active",
          hypothesis: "A graph-derived confidence gate improves GCD.",
          novelty_basis: "Transfer confidence gating from semi-supervised learning.",
          main_metric: "H-score",
        },
      ],
      plan_selection: {
        selected_track_id: "track-main",
      },
    },
  });

  const bundleDir = path.join(projectRoot, "coder", "experiments", "track-main", "exp_zero");
  await writeText(path.join(bundleDir, "train.py"), "print('precomputed zero-gain result')\n");
  await writeText(path.join(bundleDir, "README.md"), "# zero gain\n");
  await writeJson(path.join(bundleDir, "EXPERIMENT_MANIFEST.json"), {
    experiment_id: "exp-zero",
    track_id: "track-main",
    status: "completed",
    hypothesis: "A graph-derived confidence gate improves GCD.",
    one_change_signature: "confidence gate threshold only",
    datasets: ["local-gcd-reference-benchmark"],
  });
  await writeJson(path.join(bundleDir, "RESULT_SUMMARY.json"), {
    run_id: "zero-gain",
    experiment_id: "exp-zero",
    status: "completed",
    baseline: {
      known_accuracy: 0.7,
      novel_accuracy: 0.4,
      h_score: 0.5091,
    },
    proposed: {
      known_accuracy: 0.7,
      novel_accuracy: 0.4,
      h_score: 0.5091,
    },
    ablations: {},
  });
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    schema_version: 1,
    project_id: "local-exp-zero",
    experiments: [
      {
        experiment_id: "exp-zero",
        track_id: "track-main",
        config_ref: "coder/experiments/track-main/exp_zero",
        status: "running",
      },
    ],
  });

  const result = await materializeLocalExperimentExecutionImpl({
    projectRoot,
    trigger: "test-zero-gain",
    agentId: "researcher",
  });
  assert.equal(result.experimentId, "exp-zero");
  assert.ok(result.generatedFiles.includes("researcher/AUTORESEARCH_LOOP_STATE.json"));

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.experiment_search.status, "searching");
  assert.equal(manifest.experiment_search.last_trial_outcome, "discard");
  assert.equal(manifest.experiment_search.last_decision, "continue_tuning");
  assert.equal(manifest.experiment_search.multi_seed_status, "pending");
  assert.equal(manifest.experiment_search.ablation_status, "pending");
  assert.equal(manifest.experiment_memory.karpathy_inner_loop_status, "running");
  assert.equal(manifest.experiment_memory.karpathy_keep_discard_decision, "discard");

  const loopState = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "AUTORESEARCH_LOOP_STATE.json"),
      "utf8"
    )
  );
  assert.equal(loopState.trial_history[0].decision.outcome, "discard");
  assert.equal(loopState.advance.analyze.allowed, false);
  assert.match(loopState.blocking_reason, /No promoted trial exists/i);
});

test("local experiment execution reconciles completed result summaries despite stale active ledger entries", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-local-experiment-stale-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "local-exp-stale",
    current_stage: "experiment",
    topic: "Use frequency debiasing to improve GCD",
    experiment_search: {
      status: "launching",
      track_id: "track-main",
      incumbent_experiment_id: "ledger-completed",
    },
    research_program: {
      status: "approved",
      goal: "Improve generalized category discovery.",
      primary_metric: "All ACC",
      datasets: ["Cars"],
      tracks: [
        {
          track_id: "track-main",
          status: "active",
          hypothesis: "Frequency debiasing improves generalized category discovery.",
          novelty_basis: "Frequency-aware pseudo-label debiasing.",
          main_metric: "All ACC",
        },
      ],
      plan_selection: {
        selected_track_id: "track-main",
      },
    },
  });

  const staleDir = path.join(
    projectRoot,
    "coder",
    "experiments",
    "track-main",
    "aaa_stale_running"
  );
  await writeText(path.join(staleDir, "train.py"), "print('stale')\n");
  await writeText(path.join(staleDir, "README.md"), "# stale\n");
  await writeJson(path.join(staleDir, "EXPERIMENT_MANIFEST.json"), {
    experiment_id: "stale-running",
    track_id: "track-main",
    status: "running",
  });

  const completedRelativeDir = "coder/experiments/track-main/zzz_completed";
  const completedDir = path.join(projectRoot, completedRelativeDir);
  await writeText(path.join(completedDir, "train.py"), "print('completed')\n");
  await writeText(path.join(completedDir, "README.md"), "# completed\n");
  await writeJson(path.join(completedDir, "EXPERIMENT_MANIFEST.json"), {
    experiment_id: "bundle-completed",
    track_id: "track-main",
    status: "completed",
    hypothesis: "Frequency debiasing improves generalized category discovery.",
    implementation_proof: {
      execution_command: "python train.py --seed 42",
    },
  });
  await writeJson(path.join(completedDir, "RESULT_SUMMARY.json"), {
    experiment_id: "bundle-completed",
    status: "completed",
    primary_metric: {
      name: "All ACC",
      value: 54.34,
      unit: "%",
    },
    key_metrics: {
      simGCD_paper: 53.4,
    },
    verdict: "PASS - completed against SimGCD baseline (53.4%).",
  });
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    schema_version: 1,
    project_id: "local-exp-stale",
    experiments: [
      {
        experiment_id: "stale-running",
        track_id: "track-main",
        status: "running",
      },
      {
        experiment_id: "ledger-completed",
        track_id: "track-main",
        status: "completed",
        config_ref: `${completedRelativeDir}/EXPERIMENT_MANIFEST.json`,
        key_metric: {
          name: "All ACC",
          value: 54.34,
        },
      },
    ],
  });

  const result = await materializeLocalExperimentExecutionImpl({
    projectRoot,
    trigger: "test-stale-reconcile",
    agentId: "researcher",
  });

  assert.equal(result.experimentId, "ledger-completed");
  assert.equal(result.bundleDir, completedRelativeDir);
  assert.ok(result.generatedFiles.includes(`${completedRelativeDir}/REMOTE_RUN.json`));
  assert.ok(result.generatedFiles.includes("researcher/EXECUTION_PROOF.json"));

  const remoteRun = JSON.parse(
    await fs.readFile(path.join(completedDir, "REMOTE_RUN.json"), "utf8")
  );
  assert.equal(remoteRun.experiment_id, "ledger-completed");
  assert.equal(remoteRun.key_metric.name, "All ACC");
  assert.equal(remoteRun.key_metric.delta, 0.94);

  const proof = await collectExecutionProofReceipts({
    projectRoot,
    manifest: JSON.parse(await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")),
    experimentLedger: JSON.parse(
      await fs.readFile(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), "utf8")
    ),
  });
  assert.equal(proof.ready, true);
  assert.equal(proof.receipts[0].ledgerMatched, true);
});
