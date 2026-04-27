import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializeCodeExperimentBundleImpl } from "../tools/workflow-guard-materializers/code-experiment-bundle-materializer.ts";
import { materializeLocalExperimentExecutionImpl } from "../tools/workflow-guard-materializers/experiment-execution-materializer.ts";
import { materializeAnalysisArtifactsImpl } from "../tools/workflow-guard-materializers/analysis-artifacts-materializer.ts";
import { runWorkflowAutoIterator } from "../tools/workflow-guard.ts";

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

test("local analysis materializer writes analyzer contracts and manifest support state", async (t) => {
  const projectRoot = await seedExperimentReadyProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
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

test("auto iterator commits experiment to analyze after local analysis target preflight", async (t) => {
  const projectRoot = await seedExperimentReadyProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
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
