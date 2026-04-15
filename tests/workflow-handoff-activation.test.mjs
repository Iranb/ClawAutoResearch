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
import {
  readWorkflowRuntimeQueueStore,
  writeWorkflowRuntimeQueueStore,
} from "../tools/workflow-runtime-state.ts";

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
  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    projectId: "demo-project",
    entries: [
      {
        transitionId: "queue-1",
        queueId: "queue-1",
        queueKey: `handoff:${created.intent.intentId}`,
        source: "workflow_auto_stage",
        entryType: "dispatch_task",
        ownerAgent: "academic_writer",
        channelKey: "discord:channel:paper-lab",
        requesterSessionKey: "agent:researcher:discord:channel:paper-lab",
        messageChannel: "discord",
        preferredSessionKey: "agent:academic_writer:discord:channel:paper-lab",
        family: "research",
        kind: "workflow_stage_dispatch",
        projectId: "demo-project",
        projectRoot,
        queuedAt: "2026-04-14T02:00:00.000Z",
        lastAttemptedAt: "2026-04-14T02:01:00.000Z",
        lastCheckedAt: "2026-04-14T02:01:00.000Z",
        attemptCount: 1,
        summary: "queued writer handoff",
        status: "degraded",
        fallbackMode: null,
        lastError: "Queued workflow dispatch did not start.",
        parentSessionKey: null,
        threadBindingKey: null,
        depth: 0,
        runPayload: null,
        dispatchPayload: null,
      },
    ],
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
  const queue = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(queue.entries[0].status, "completed");
  assert.equal(queue.entries[0].lastError, null);
});

test("claimAndActivateWorkflowHandoffForAgent can be blocked by a before-activation hook", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-handoff-hook-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "demo-project",
        current_stage: "review",
        owner_agent: "reviewer",
        orchestration_state: {
          status: "waiting",
          current_owner: "reviewer",
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
    workflowLine: "experiment",
    stageBefore: "review",
    stageAfter: "write",
    ownerBefore: "reviewer",
    ownerAfter: "academic_writer",
    executionId: "exec-2",
    nextAction: "Start writing.",
  });
  await syncPreparedWorkflowHandoffToManifest({
    projectRoot,
    intent: created.intent,
  });

  const activation = await claimAndActivateWorkflowHandoffForAgent({
    projectRoot,
    role: "academic_writer",
    sessionKey: "agent:academic_writer:test",
    beforeActivateHook: async () => ({
      allow: false,
      blockingReason: "File audit hook blocked activation.",
    }),
  });

  assert.equal(activation.claimed, true);
  assert.equal(activation.activated, false);

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.owner_agent, "reviewer");
  assert.equal(manifest.current_stage, "review");
  assert.equal(manifest.blocking_reason, "File audit hook blocked activation.");
});
