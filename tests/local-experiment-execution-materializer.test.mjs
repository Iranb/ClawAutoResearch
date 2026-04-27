import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializeCodeExperimentBundleImpl } from "../tools/workflow-guard-materializers/code-experiment-bundle-materializer.ts";
import { materializeLocalExperimentExecutionImpl } from "../tools/workflow-guard-materializers/experiment-execution-materializer.ts";
import { collectExecutionProofReceipts } from "../tools/workflow-execution-proof.ts";
import { evaluateExperimentSearchDecision } from "../tools/workflow-experiment-decision.ts";
import { runWorkflowAutoIterator } from "../tools/workflow-guard.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
      datasets: ["synthetic-gcd-proxy"],
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
  assert.equal(bundle.experimentId, "exp-1");

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
  assert.equal(manifest.experiment_search.multi_seed_status, "complete");
  assert.equal(manifest.experiment_search.plot_pack_status, "complete");
  assert.equal(manifest.experiment_search.one_change_validation_status, "ready");
  assert.match(manifest.experiment_search.one_change_signature, /FixMatch/i);
  assert.equal(manifest.experiment_search.baseline_dataset_coverage_status, "covered");
  assert.deepEqual(manifest.experiment_search.validated_dataset_envelope, [
    "synthetic-gcd-proxy",
  ]);
  assert.equal(manifest.experiment_memory.last_completed_experiment_id, "exp-1");
  assert.equal(manifest.execution_proof.status, "ready");

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
      datasets: ["synthetic-gcd-proxy"],
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

  await materializeCodeExperimentBundleImpl({
    projectRoot,
    trigger: "test",
    agentId: "coder",
  });

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
