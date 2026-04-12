import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createWorkflowArtifactReceipt,
  findWorkflowArtifactReceiptsForTask,
  readWorkflowArtifactReceiptStore,
} from "../tools/workflow-handoff/artifact-receipts.ts";

test("artifact receipts persist structured paths and dedupe receipt IDs", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-receipt-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const first = await createWorkflowArtifactReceipt({
    projectRoot,
    receiptId: "receipt-1",
    taskId: "task-1",
    producedByRole: "coder",
    summary: "Implemented task.",
    changedFiles: ["a.ts", "a.ts", "b.ts"],
    artifactPaths: ["coder/EXPERIMENT_INDEX.md"],
    verificationCommands: ["npm test"],
    verificationResult: "passed",
  });
  const second = await createWorkflowArtifactReceipt({
    projectRoot,
    receiptId: "receipt-1",
    taskId: "task-1",
    producedByRole: "coder",
    summary: "Duplicate receipt.",
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  const store = await readWorkflowArtifactReceiptStore(projectRoot);
  assert.equal(store.receipts.length, 1);
  assert.deepEqual(store.receipts[0].changedFiles, ["a.ts", "b.ts"]);
  assert.equal((await findWorkflowArtifactReceiptsForTask({ projectRoot, taskId: "task-1" })).length, 1);
});
