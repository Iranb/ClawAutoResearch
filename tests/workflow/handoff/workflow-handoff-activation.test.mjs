import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createStageOwnerHandoffIntent } from "../../../tools/workflow-handoff/handoff-router.ts";
import {
  claimAndActivateWorkflowHandoffForAgent,
  syncPreparedWorkflowHandoffToManifest,
} from "../../../tools/workflow-handoff/handoff-activation.ts";
import {
  readWorkflowHandoffIntentStore,
  transitionWorkflowHandoffIntent,
  writeWorkflowHandoffIntentStore,
} from "../../../tools/workflow-handoff/handoff-store.ts";
import {
  readWorkflowRuntimeQueueStore,
  writeWorkflowRuntimeQueueStore,
} from "../../../tools/workflow-runtime-state.ts";

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

  const retried = await claimAndActivateWorkflowHandoffForAgent({
    projectRoot,
    role: "academic_writer",
    sessionKey: "agent:academic_writer:test",
    intentId: created.intent.intentId,
    beforeActivateHook: async () => ({
      allow: true,
    }),
  });

  assert.equal(retried.claimed, true);
  assert.equal(retried.activated, true);
});

test("claimAndActivateWorkflowHandoffForAgent ignores older failed handoffs for the same role", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-handoff-stale-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "demo-project",
        current_stage: "write",
        owner_agent: "academic_writer",
        orchestration_state: {
          status: "waiting",
          current_owner: "academic_writer",
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const stale = await createStageOwnerHandoffIntent({
    projectRoot,
    projectId: "demo-project",
    workflowLine: "experiment",
    stageBefore: "analyze",
    stageAfter: "review",
    ownerBefore: "analyzer",
    ownerAfter: "reviewer",
    nextAction: "Old review handoff.",
  });
  const current = await createStageOwnerHandoffIntent({
    projectRoot,
    projectId: "demo-project",
    workflowLine: "experiment",
    stageBefore: "write",
    stageAfter: "submit",
    ownerBefore: "academic_writer",
    ownerAfter: "reviewer",
    nextAction: "Current submit handoff.",
  });

  const store = await readWorkflowHandoffIntentStore(projectRoot);
  await writeWorkflowHandoffIntentStore({
    ...store,
    intents: store.intents.map((intent) =>
      intent.intentId === stale.intent.intentId
        ? {
            ...intent,
            status: "failed",
            updatedAt: "2999-01-01T00:00:00.000Z",
          }
        : intent
    ),
  });
  await syncPreparedWorkflowHandoffToManifest({
    projectRoot,
    intent: current.intent,
  });

  const activation = await claimAndActivateWorkflowHandoffForAgent({
    projectRoot,
    role: "reviewer",
    sessionKey: "agent:reviewer:test",
  });

  assert.equal(activation.intent.intentId, current.intent.intentId);
  assert.equal(activation.activated, true);
  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.current_stage, "submit");
});

test("failed handoff intents do not absorb a fresh retry with the same idempotency key", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-handoff-failed-retry-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "demo-project",
        current_stage: "write",
        owner_agent: "academic_writer",
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const first = await createStageOwnerHandoffIntent({
    projectRoot,
    projectId: "demo-project",
    workflowLine: "experiment",
    stageBefore: "write",
    stageAfter: "submit",
    ownerBefore: "academic_writer",
    ownerAfter: "reviewer",
    executionId: "exec-retry",
    manifestRevision: "rev-retry",
    nextAction: "Submit handoff.",
  });
  await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: first.intent.intentId,
    toStatus: "failed",
    terminalReason: "test_failure",
  });

  const second = await createStageOwnerHandoffIntent({
    projectRoot,
    projectId: "demo-project",
    workflowLine: "experiment",
    stageBefore: "write",
    stageAfter: "submit",
    ownerBefore: "academic_writer",
    ownerAfter: "reviewer",
    executionId: "exec-retry",
    manifestRevision: "rev-retry",
    nextAction: "Submit handoff.",
  });

  assert.equal(second.created, true);
  assert.notEqual(second.intent.intentId, first.intent.intentId);
  assert.equal(second.intent.status, "prepared");

  const store = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(store.intents.filter((intent) => intent.status === "failed").length, 1);
  assert.equal(store.intents.filter((intent) => intent.status === "prepared").length, 1);
});

test("claimAndActivateWorkflowHandoffForAgent does not auto-claim unbound prepared handoffs", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-handoff-unbound-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "demo-project",
        current_stage: "submit",
        owner_agent: "reviewer",
        orchestration_state: {
          status: "waiting",
          current_owner: "reviewer",
          pending_handoff_id: null,
          pending_owner_candidate: null,
          pending_stage_candidate: null,
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
    stageBefore: "submit",
    stageAfter: "write",
    ownerBefore: "reviewer",
    ownerAfter: "academic_writer",
    nextAction: "Historical revision handoff.",
  });

  const autoActivation = await claimAndActivateWorkflowHandoffForAgent({
    projectRoot,
    role: "academic_writer",
    sessionKey: "agent:academic_writer:test",
  });

  assert.equal(autoActivation.intent, null);
  assert.equal(autoActivation.claimed, false);
  assert.equal(autoActivation.activated, false);

  const explicitActivation = await claimAndActivateWorkflowHandoffForAgent({
    projectRoot,
    role: "academic_writer",
    sessionKey: "agent:academic_writer:test",
    intentId: created.intent.intentId,
  });

  assert.equal(explicitActivation.intent.intentId, created.intent.intentId);
  assert.equal(explicitActivation.claimed, true);
});
