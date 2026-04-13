import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createStageOwnerHandoffIntent } from "../tools/workflow-handoff/handoff-router.ts";
import {
  claimAndActivateWorkflowHandoffForAgent,
  syncPreparedWorkflowHandoffToManifest,
} from "../tools/workflow-handoff/handoff-activation.ts";
import { readWorkflowHandoffIntentStore } from "../tools/workflow-handoff/handoff-store.ts";

test("claimAndActivateWorkflowHandoffForAgent switches owner only after the target role claims the prepared handoff", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-handoff-activation-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "demo-project",
        current_stage: "survey_review",
        current_micro_stage: "synthesis",
        owner_agent: "researcher",
        orchestration_state: {
          status: "waiting",
          current_owner: "researcher",
          next_transition_candidate: "write",
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const created = await createStageOwnerHandoffIntent({
    projectRoot,
    projectId: "demo-project",
    workflowLine: "survey",
    stageBefore: "survey_review",
    stageAfter: "write",
    ownerBefore: "researcher",
    ownerAfter: "academic_writer",
    executionId: "exec-1",
    nextAction: "Begin survey paper writing from survey review artifacts.",
    nextMicroStage: "bootstrap",
  });

  await syncPreparedWorkflowHandoffToManifest({
    projectRoot,
    intent: created.intent,
  });

  let manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.owner_agent, "researcher");
  assert.equal(manifest.current_stage, "survey_review");
  assert.equal(manifest.orchestration_state.pending_handoff_id, created.intent.intentId);

  const activation = await claimAndActivateWorkflowHandoffForAgent({
    projectRoot,
    role: "academic_writer",
    sessionKey: "agent:academic_writer:discord:channel:paper-lab",
  });

  assert.equal(activation.claimed, true);
  assert.equal(activation.activated, true);

  manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.owner_agent, "academic_writer");
  assert.equal(manifest.current_stage, "write");
  assert.equal(manifest.current_micro_stage, "bootstrap");
  assert.equal(manifest.orchestration_state.current_owner, "academic_writer");
  assert.equal(manifest.orchestration_state.pending_handoff_id, null);
  assert.equal(manifest.orchestration_state.handoff_phase, "activated");

  const store = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(store.intents[0].status, "activated");
  assert.equal(store.intents[0].toSessionKey, "agent:academic_writer:discord:channel:paper-lab");
});
