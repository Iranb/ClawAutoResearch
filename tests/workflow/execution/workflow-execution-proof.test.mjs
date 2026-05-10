import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { collectExecutionProofReceipts } from "../../../tools/workflow-execution-proof.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("collectExecutionProofReceipts reports ready when a remote run, result summary, and ledger entry line up", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-execution-proof-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const runDir = path.join(projectRoot, "coder", "track-main", "exp-1__baseline");
  await writeJson(path.join(runDir, "REMOTE_RUN.json"), {
    experiment_id: "exp-1",
    status: "completed",
    git_commit: "abc123",
    stage_run_id: "stage-run-1",
  });
  await writeJson(path.join(runDir, "RESULT_SUMMARY.json"), {
    experiment_id: "exp-1",
    metrics: { h_score: 0.55 },
    result_paths: ["researcher/artifacts/results/results.json"],
    stage_run_id: "stage-run-1",
  });
  await writeJson(path.join(runDir, "EXPERIMENT_MANIFEST.json"), {
    experiment_id: "exp-1",
    git: {
      last_candidate_commit: "abc123",
    },
  });

  const result = await collectExecutionProofReceipts({
    projectRoot,
    manifest: {
      experiment_search: {
        candidate_head_commit: "abc123",
      },
      orchestration_state: {
        stage_run_id: "stage-run-1",
      },
    },
    experimentLedger: {
      experiments: [
        {
          experiment_id: "exp-1",
          result_paths: ["researcher/artifacts/results/results.json"],
        },
      ],
    },
  });

  assert.equal(result.ready, true);
  assert.equal(result.receiptCount, 1);
  assert.equal(result.expectedCandidateCommit, "abc123");
  assert.equal(result.expectedStageRunId, "stage-run-1");
  assert.equal(result.receipts[0].ledgerMatched, true);
  assert.equal(result.receipts[0].manifestCommitMatched, true);
  assert.equal(result.receipts[0].searchCommitMatched, true);
  assert.equal(result.receipts[0].stageRunMatched, true);
  assert.equal(result.receipts[0].remoteRunId, null);
  assert.equal(result.receipts[0].remoteRunStageRunId, "stage-run-1");
  assert.equal(result.receipts[0].remoteRunCommit, "abc123");
  assert.equal(result.receipts[0].manifestCandidateCommit, "abc123");
});

test("collectExecutionProofReceipts reports not ready when commit or stage lineage mismatches", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-execution-proof-mismatch-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const runDir = path.join(projectRoot, "coder", "track-main", "exp-1__baseline");
  await writeJson(path.join(runDir, "REMOTE_RUN.json"), {
    experiment_id: "exp-1",
    status: "completed",
    git_commit: "old-commit",
    stage_run_id: "stage-run-old",
  });
  await writeJson(path.join(runDir, "RESULT_SUMMARY.json"), {
    experiment_id: "exp-1",
    metrics: { h_score: 0.55 },
    result_paths: ["researcher/artifacts/results/results.json"],
    stage_run_id: "stage-run-old",
    run_id: "run-old",
  });
  await writeJson(path.join(runDir, "EXPERIMENT_MANIFEST.json"), {
    experiment_id: "exp-1",
    git: {
      last_candidate_commit: "new-commit",
    },
  });

  const result = await collectExecutionProofReceipts({
    projectRoot,
    manifest: {
      experiment_search: {
        candidate_head_commit: "new-commit",
      },
      orchestration_state: {
        stage_run_id: "stage-run-new",
      },
    },
    experimentLedger: {
      experiments: [
        {
          experiment_id: "exp-1",
          result_paths: ["researcher/artifacts/results/results.json"],
          metadata: {
            execution: {
              run_id: "run-new",
            },
          },
        },
      ],
    },
  });

  assert.equal(result.ready, false);
  assert.match(
    result.missingReasons.join(" "),
    /commit lineage, stage_run_id, or run_id does not match/i
  );
});

test("collectExecutionProofReceipts reports not ready when run_id mismatches ledger execution metadata", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-execution-proof-runid-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const runDir = path.join(projectRoot, "coder", "track-main", "exp-1__baseline");
  await writeJson(path.join(runDir, "REMOTE_RUN.json"), {
    experiment_id: "exp-1",
    status: "completed",
    git_commit: "abc123",
    stage_run_id: "stage-run-1",
    run_id: "run-old",
  });
  await writeJson(path.join(runDir, "RESULT_SUMMARY.json"), {
    experiment_id: "exp-1",
    metrics: { h_score: 0.55 },
    result_paths: ["researcher/artifacts/results/results.json"],
    stage_run_id: "stage-run-1",
    run_id: "run-old",
  });
  await writeJson(path.join(runDir, "EXPERIMENT_MANIFEST.json"), {
    experiment_id: "exp-1",
    git: {
      last_candidate_commit: "abc123",
    },
  });

  const result = await collectExecutionProofReceipts({
    projectRoot,
    manifest: {
      experiment_search: {
        candidate_head_commit: "abc123",
      },
      orchestration_state: {
        stage_run_id: "stage-run-1",
      },
    },
    experimentLedger: {
      experiments: [
        {
          experiment_id: "exp-1",
          result_paths: ["researcher/artifacts/results/results.json"],
          metadata: {
            execution: {
              run_id: "run-new",
            },
          },
        },
      ],
    },
  });

  assert.equal(result.ready, false);
  assert.match(result.missingReasons.join(" "), /run_id does not match/i);
});
