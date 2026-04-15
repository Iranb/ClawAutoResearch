import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createWorkflowReviewRoundHandoff,
  recordWorkflowReviewRoundResults,
} from "../tools/workflow-handoff/review-rounds.ts";
import { readWorkflowHandoffIntentStore } from "../tools/workflow-handoff/handoff-store.ts";
import { readWorkflowArtifactReceiptStore } from "../tools/workflow-handoff/artifact-receipts.ts";
import { readWorkflowHooksStateStore } from "../tools/workflow-hooks/state.ts";

test("review round creates handoff intents and receipts", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-review-round-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const handoff = await createWorkflowReviewRoundHandoff({
    projectRoot,
    projectId: "demo",
    stage: "code",
    fromRole: "orchestrator",
    reviewerRole: "reviewer",
    subject: "Review code packet",
  });
  assert.equal(handoff.created, true);
  assert.equal(handoff.intent.reason, "code_review_required");

  const results = await recordWorkflowReviewRoundResults({
    projectRoot,
    projectId: "demo",
    stage: "code",
    handoffIntentId: handoff.intent.intentId,
    results: [
      {
        reviewerRole: "reviewer",
        verdict: "revise",
        summary: "Needs a fix.",
        blockers: ["Missing baseline check."],
      },
    ],
  });
  assert.equal(results.aggregateVerdict, "revise");
  assert.equal(results.nextHandoff?.reason, "plan_inconsistent");

  const handoffStore = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(handoffStore.intents.length, 2);
  const receiptStore = await readWorkflowArtifactReceiptStore(projectRoot);
  assert.equal(receiptStore.receipts.length, 1);
  assert.equal(receiptStore.receipts[0].verificationResult, "failed");
  const hookStore = await readWorkflowHooksStateStore(projectRoot);
  assert.equal(
    hookStore.hooks["builtin.review-round:experiment:code"]?.status,
    "revise_requested"
  );
  assert.equal(
    hookStore.hookPoints.before_stage_handoff?.code?.aggregateVerdict,
    "revise"
  );
});
