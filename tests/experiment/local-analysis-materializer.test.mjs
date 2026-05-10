import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializeCodeExperimentBundleImpl } from "../../tools/workflow-guard-materializers/code-experiment-bundle-materializer.ts";
import { materializeLocalExperimentExecutionImpl } from "../../tools/workflow-guard-materializers/experiment-execution-materializer.ts";
import { materializeAnalysisArtifactsImpl } from "../../tools/workflow-guard-materializers/analysis-artifacts-materializer.ts";
import { runWorkflowAutoIterator } from "../../tools/workflow-guard.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function seedExperimentReadyProject() {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-local-analysis-"));
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "local-analysis",
    current_stage: "experiment",
    owner_agent: "researcher",
    current_micro_stage: "experiment_reconciled",
    topic:
      "TOWARDS UNDERSTANDING WHY FIXMATCH GENERALIZES BETTER THAN SUPERVISED LEARNING 这篇论文里提到的方法改进GCD",
    writing_contract: {
      paper_mode: "conference",
      proof_appendix_required: true,
    },
    orchestration_state: {
      status: "running",
      current_owner: "researcher",
      next_transition_candidate: "analyze",
      handoff_phase: "idle",
      stage_run_id: "stage-local-analysis",
    },
    experiment_search: {
      candidate_head_commit: "candidate-local-analysis",
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
  await materializeCodeExperimentBundleImpl({
    projectRoot,
    trigger: "test",
    agentId: "coder",
  });
  await materializeLocalExperimentExecutionImpl({
    projectRoot,
    trigger: "test",
    agentId: "researcher",
  });
  return projectRoot;
}

async function overwriteEvaluationMetrics(projectRoot, metrics) {
  const result = {
    schema_version: 1,
    generated_at: "2026-04-28T00:00:00.000Z",
    experiment_id: "exp-1",
    status: "ready",
    metrics,
    baseline: {
      known_accuracy: metrics.baseline_known_accuracy ?? 1,
      novel_accuracy: metrics.baseline_novel_accuracy ?? 0,
      h_score: metrics.baseline_h_score,
    },
    proposed: {
      known_accuracy: metrics.known_accuracy,
      novel_accuracy: metrics.novel_accuracy,
      h_score: metrics.h_score,
    },
    ablations: {
      minus_class_balance_debiasing: { h_score: metrics.h_score },
      minus_consistency_filtering: { h_score: metrics.h_score },
    },
  };
  await writeJson(path.join(projectRoot, "researcher", "evaluation_summary.json"), result);
  await writeJson(
    path.join(projectRoot, "researcher", "artifacts", "results", "exp-1", "RESULT_SUMMARY.json"),
    result
  );
}

test("local analysis materializer writes analyzer contracts and manifest support state", async (t) => {
  const projectRoot = await seedExperimentReadyProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await overwriteEvaluationMetrics(projectRoot, {
    h_score: 0.3404,
    known_accuracy: 0.8778,
    novel_accuracy: 0.2111,
    baseline_h_score: 0,
    delta_h_score: 0.3404,
  });

  const result = await materializeAnalysisArtifactsImpl({
    projectRoot,
    trigger: "test",
    agentId: "analyzer",
  });

  assert.equal(result.materialized, true);
  assert.equal(result.claimCount, 3);
  assert.ok(result.generatedFiles.includes("analyzer/CLAIM_EVIDENCE_MATRIX.md"));
  assert.ok(result.generatedFiles.includes("analyzer/THEORY_STATE.json"));
  assert.ok(result.generatedFiles.includes("analyzer/proof-packets/lemma-fixmatch-gcd-consistency.json"));
  assert.ok(result.generatedFiles.includes("academic_writer/THEORY_APPENDIX_PLAN.md"));

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.paper_story_state.claim_support_status, "supported");
  assert.equal(manifest.paper_story_state.supported_claim_count, 3);
  assert.equal(manifest.theory_state.status, "ready");
  assert.equal(manifest.theory_state.body_ready, true);
  assert.equal(manifest.mechanism_evidence.graph_context_status, "ready");
  assert.equal(manifest.venue_competition.graph_context_status, "ready");
});

test("local analysis materializer scopes zero-delta results as partial, not supported improvement", async (t) => {
  const projectRoot = await seedExperimentReadyProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await overwriteEvaluationMetrics(projectRoot, {
    h_score: 0,
    known_accuracy: 1,
    novel_accuracy: 0,
    baseline_h_score: 0,
    delta_h_score: 0,
  });

  const result = await materializeAnalysisArtifactsImpl({
    projectRoot,
    trigger: "test",
    agentId: "analyzer",
  });

  assert.equal(result.materialized, true);
  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.paper_story_state.claim_support_status, "partial");
  assert.equal(manifest.paper_story_state.partial_claim_count, 1);
  assert.equal(manifest.paper_story_state.unsupported_claim_count, 0);

  const claimMatrix = await fs.readFile(
    path.join(projectRoot, "analyzer", "CLAIM_EVIDENCE_MATRIX.md"),
    "utf8"
  );
  assert.match(claimMatrix, /does not yet show a measured improvement/i);
  assert.match(claimMatrix, /\| partial \|/);
  assert.doesNotMatch(claimMatrix, /improves the local GCD reference H-score/i);

  const unsupported = await fs.readFile(
    path.join(projectRoot, "analyzer", "UNSUPPORTED_CLAIMS.md"),
    "utf8"
  );
  assert.match(unsupported, /Do not claim that the method improves H-score/i);
});

test("auto iterator commits experiment to analyze after local analysis target preflight", async (t) => {
  const projectRoot = await seedExperimentReadyProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await overwriteEvaluationMetrics(projectRoot, {
    h_score: 0.3404,
    known_accuracy: 0.8778,
    novel_accuracy: 0.2111,
    baseline_h_score: 0,
    delta_h_score: 0.3404,
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

  assert.equal(result.stageBefore, "experiment");
  assert.equal(result.stageAfter, "analyze");
  assert.deepEqual(result.missingStageSignals, []);
  assert.equal(result.ownerActivated, true);
  assert.equal(result.pendingHandoff, false);
  assert.ok(
    result.materializedArtifacts.some(
      (artifact) => artifact.contract === "analysis_artifacts"
    )
  );

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.current_stage, "analyze");
  assert.equal(manifest.owner_agent, "analyzer");
  assert.equal(manifest.orchestration_state.pending_handoff_id, null);
  assert.equal(manifest.paper_story_state.claim_support_status, "supported");
});
