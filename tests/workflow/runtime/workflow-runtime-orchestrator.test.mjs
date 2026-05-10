import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  getWorkflowAnnounceOutboxPath,
  getWorkflowBroadcastOutboxPath,
  getWorkflowRuntimeEventsPath,
  getWorkflowRuntimeQueuePath,
  getWorkflowRuntimeSessionsPath,
  migrateWorkflowRuntimeState,
  readWorkflowAnnounceOutboxStore,
  readWorkflowBroadcastOutboxStore,
  readWorkflowRuntimeEvents,
  readWorkflowRuntimeQueueStore,
  readWorkflowRuntimeSessionsStore,
  writeWorkflowAnnounceOutboxStore,
  writeWorkflowBroadcastOutboxStore,
  writeWorkflowRuntimeQueueStore,
  writeWorkflowRuntimeSessionsStore,
} from "../../../tools/workflow-runtime-state.ts";
import {
  orchestrateWorkflowTransition,
  recordWorkflowAnnounceEvent,
  recordWorkflowBroadcastEvent,
  recordWorkflowRuntimeSession,
} from "../../../tools/workflow-session-orchestrator.ts";
import {
  consumeWorkflowAnnounceOutbox,
  replayWorkflowBroadcastOutbox,
} from "../../../tools/workflow-announce-runtime.ts";
import { recoverWorkflowRuntimeState } from "../../../tools/workflow-runtime-recovery.ts";
import { bindChannelProjectForWorkflow } from "../../../tools/workflow-guard.ts";

async function makeProjectRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-runtime-orchestrator-"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function makeProject(projectRoot, projectId = "alpha") {
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: projectId,
    current_stage: "frontier_mapping",
    owner_agent: "researcher",
    audit: {
      last_stage_audited: null,
      last_audit_at: null,
    },
  });
}

function buildTransitionInput(projectRoot, projectId = "alpha") {
  return {
    projectRoot,
    projectId,
    queueKey: `auto-stage:${projectId}:frontier_mapping`,
    source: "workflow_auto_stage",
    entryType: "dispatch_task",
    ownerAgent: "researcher",
    channelKey: "discord:group:paper-lab",
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    preferredSessionKey:
      "agent:researcher:discord:group:paper-lab:subagent:workflow-stage",
    family: "research",
    kind: "workflow_stage_dispatch",
    summary: "Run the next frontier-mapping stage handoff.",
    dispatchPayload: {
      requesterChannel: "discord",
      requesterAccountId: "default",
      preferredSessionKeys: [
        "agent:researcher:discord:group:paper-lab:subagent:workflow-stage",
      ],
      fromRole: "researcher",
      toRole: "researcher",
      projectRoot,
      projectId,
      stage: "frontier_mapping",
      summary: "Run the next frontier-mapping stage handoff.",
      command: "/frontier-mapping",
      mailboxMessageId: null,
      requireMailboxAcknowledgement: true,
      extraBody: "Continue only the assigned stage.",
      waitTimeoutMs: 5_000,
      retryOnTimeout: true,
      enableSpawnFallback: true,
      useWorkflowHandoff: true,
      autoModeActive: true,
    },
  };
}

test("migrateWorkflowRuntimeState lazily initializes runtime files without rewriting workflow facts", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "alpha");

  const migrated = await migrateWorkflowRuntimeState({
    projectRoot,
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });

  assert.equal(migrated.migrated, true);
  assert.equal(migrated.compatibilityMode, "sessions_spawn_runtime");
  await fs.access(getWorkflowRuntimeQueuePath(projectRoot));
  await fs.access(getWorkflowRuntimeSessionsPath(projectRoot));
  await fs.access(getWorkflowAnnounceOutboxPath(projectRoot));
  await fs.access(getWorkflowBroadcastOutboxPath(projectRoot));
  await fs.access(getWorkflowRuntimeEventsPath(projectRoot));

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.current_stage, "frontier_mapping");
  assert.equal(manifest.owner_agent, "researcher");
  assert.equal(manifest.audit.runtime_framework, "sessions_spawn_v1");
  assert.equal(manifest.audit.runtime_framework_version, 1);
  assert.equal(manifest.audit.runtime_migration.status, "completed");
  assert.equal(
    manifest.audit.runtime_migration.compatibility_mode,
    "sessions_spawn_runtime"
  );

  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  const sessionsStore = await readWorkflowRuntimeSessionsStore(projectRoot);
  const announceStore = await readWorkflowAnnounceOutboxStore(projectRoot);
  const broadcastStore = await readWorkflowBroadcastOutboxStore(projectRoot);
  assert.equal(queueStore.entries.length, 0);
  assert.equal(sessionsStore.entries.length, 0);
  assert.equal(announceStore.entries.length, 0);
  assert.equal(broadcastStore.entries.length, 0);
});

test("migrateWorkflowRuntimeState does not rewrite manifest audit after initialization", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "alpha-noop");
  await migrateWorkflowRuntimeState({
    projectRoot,
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const initializedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  initializedManifest.updated_at = "2026-04-27T00:00:00.000Z";
  await writeJson(manifestPath, initializedManifest);

  const remigration = await migrateWorkflowRuntimeState({
    projectRoot,
    compatibilityMode: "sessions_spawn_runtime",
    reason: "append_runtime_event",
  });

  const manifestAfterRemigration = JSON.parse(
    await fs.readFile(manifestPath, "utf8")
  );
  assert.equal(remigration.migrated, false);
  assert.equal(manifestAfterRemigration.updated_at, "2026-04-27T00:00:00.000Z");
  assert.deepEqual(manifestAfterRemigration.audit, initializedManifest.audit);
});

test("orchestrateWorkflowTransition persists the intent before spawn and skips spawn when persistence fails", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "beta");

  let sawPersistedIntentInsideSpawn = false;
  const success = await orchestrateWorkflowTransition({
    transition: buildTransitionInput(projectRoot, "beta"),
    spawn: async () => {
      const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
      sawPersistedIntentInsideSpawn = queueStore.entries.some(
        (entry) =>
          entry.queueKey === "auto-stage:beta:frontier_mapping" &&
          entry.status === "launching"
      );
      return {
        runId: "spawn-run-1",
        sessionKey:
          "agent:researcher:discord:group:paper-lab:subagent:workflow-stage:beta",
        sessionId: "workflow-session-beta",
        runtime: "subagent",
        role: "researcher",
        agentId: "researcher",
      };
    },
  });

  assert.equal(success.launched, true);
  assert.equal(success.strategy, "sessions_spawn");
  assert.equal(sawPersistedIntentInsideSpawn, true);

  const queueAfterSuccess = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(queueAfterSuccess.entries.length, 1);
  assert.equal(queueAfterSuccess.entries[0].status, "running");

  let spawnCalls = 0;
  const failedPersist = await orchestrateWorkflowTransition({
    transition: buildTransitionInput(projectRoot, "beta"),
    spawn: async () => {
      spawnCalls += 1;
      return {
        runId: "spawn-run-2",
        sessionKey:
          "agent:researcher:discord:group:paper-lab:subagent:workflow-stage:beta",
      };
    },
    deps: {
      persistIntent: async () => {
        throw new Error("intent persistence failed");
      },
    },
  });

  assert.equal(failedPersist.launched, false);
  assert.equal(failedPersist.reason, "intent_persist_failed");
  assert.equal(spawnCalls, 0);
});

test("orchestrateWorkflowTransition only uses legacy fallback after an explicit new-runtime failure", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "gamma");

  let fallbackCalls = 0;
  const success = await orchestrateWorkflowTransition({
    transition: buildTransitionInput(projectRoot, "gamma"),
    spawn: async () => ({
      runId: "spawn-run-success",
      sessionKey:
        "agent:researcher:discord:group:paper-lab:subagent:workflow-stage:gamma",
      sessionId: "workflow-session-gamma",
      runtime: "subagent",
      role: "researcher",
      agentId: "researcher",
    }),
    legacyFallback: async () => {
      fallbackCalls += 1;
      return {
        runId: "legacy-run-should-not-happen",
        sessionKey: "agent:researcher:legacy:gamma",
        strategy: "legacy_dispatch",
      };
    },
  });

  assert.equal(success.launched, true);
  assert.equal(success.fallbackUsed, false);
  assert.equal(fallbackCalls, 0);

  const degraded = await orchestrateWorkflowTransition({
    transition: {
      ...buildTransitionInput(projectRoot, "gamma"),
      queueKey: "auto-stage:gamma:retry-1",
    },
    spawn: async () => {
      throw new Error("spawn runtime unavailable");
    },
    legacyFallback: async () => {
      fallbackCalls += 1;
      return {
        runId: "legacy-run-1",
        sessionKey: "agent:researcher:legacy:gamma",
        sessionId: "legacy-session-gamma",
        runtime: "legacy_dispatch",
        role: "researcher",
        agentId: "researcher",
        strategy: "legacy_dispatch",
      };
    },
  });

  assert.equal(degraded.launched, true);
  assert.equal(degraded.fallbackUsed, true);
  assert.equal(degraded.strategy, "legacy_dispatch");
  assert.equal(fallbackCalls, 1);

  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  const degradedEntry = queueStore.entries.find(
    (entry) => entry.queueKey === "auto-stage:gamma:retry-1"
  );
  assert.equal(degradedEntry?.fallbackMode, "legacy_dispatch");
  assert.equal(degradedEntry?.status, "running");
});

test("announce and broadcast outboxes persist records and suppress duplicate ids", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "delta");
  await migrateWorkflowRuntimeState({
    projectRoot,
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });

  const announceOne = await recordWorkflowAnnounceEvent({
    projectRoot,
    projectId: "delta",
    announceId: "announce:delta:1",
    sourceTransitionId: "transition-delta-1",
    parentSessionKey: "agent:researcher:parent:delta",
    childSessionKey: "agent:reviewer:child:delta",
    deliveryMode: "internal",
    summary: "Child reviewer completed the packet analysis.",
    payload: {
      verdict: "needs mitigation",
    },
  });
  const announceTwo = await recordWorkflowAnnounceEvent({
    projectRoot,
    projectId: "delta",
    announceId: "announce:delta:1",
    sourceTransitionId: "transition-delta-1",
    parentSessionKey: "agent:researcher:parent:delta",
    childSessionKey: "agent:reviewer:child:delta",
    deliveryMode: "internal",
    summary: "Child reviewer completed the packet analysis.",
    payload: {
      verdict: "needs mitigation",
    },
  });
  assert.equal(announceOne.created, true);
  assert.equal(announceTwo.created, false);

  const broadcastOne = await recordWorkflowBroadcastEvent({
    projectRoot,
    projectId: "delta",
    broadcastId: "broadcast:delta:1",
    idempotencyKey: "broadcast:delta:recovered",
    sessionKey: "agent:researcher:discord:group:paper-lab",
    status: "recovered_after_restart",
    stage: "frontier_mapping",
    summary: "Recovered the workflow runtime after restart.",
  });
  const broadcastTwo = await recordWorkflowBroadcastEvent({
    projectRoot,
    projectId: "delta",
    broadcastId: "broadcast:delta:2",
    idempotencyKey: "broadcast:delta:recovered",
    sessionKey: "agent:researcher:discord:group:paper-lab",
    status: "recovered_after_restart",
    stage: "frontier_mapping",
    summary: "Recovered the workflow runtime after restart.",
  });

  assert.equal(broadcastOne.created, true);
  assert.equal(broadcastTwo.created, false);

  const announceStore = await readWorkflowAnnounceOutboxStore(projectRoot);
  const broadcastStore = await readWorkflowBroadcastOutboxStore(projectRoot);
  assert.equal(announceStore.entries.length, 1);
  assert.equal(broadcastStore.entries.length, 1);
  assert.equal(broadcastStore.entries[0].deliveryStatus, "pending");
});

test("recordWorkflowAnnounceEvent backfills parent lineage and terminal runtime state for nested child sessions", async (t) => {
  const projectRoot = await makeProjectRoot();
  const parentSessionKey =
    "agent:researcher:discord:group:paper-lab:subagent:workflow-stage";
  const childSessionKey =
    "agent:researcher:discord:group:paper-lab:subagent:workflow-stage:subagent:code-review";
  const completedAt = "2026-04-01T00:00:00.000Z";

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "announce-runtime");
  await migrateWorkflowRuntimeState({
    projectRoot,
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });
  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    projectId: "announce-runtime",
    entries: [
      {
        transitionId: "transition-child-1",
        queueId: "transition-child-1",
        queueKey: "queue-child-1",
        source: "workflow_auto_stage",
        entryType: "dispatch_task",
        ownerAgent: "reviewer",
        channelKey: "discord:group:paper-lab",
        requesterSessionKey: parentSessionKey,
        messageChannel: "discord",
        preferredSessionKey: childSessionKey,
        family: "research",
        kind: "workflow_stage_dispatch",
        projectId: "announce-runtime",
        projectRoot,
        queuedAt: completedAt,
        lastAttemptedAt: completedAt,
        attemptCount: 1,
        summary: "child queue",
        status: "running",
        fallbackMode: null,
        lastError: null,
        parentSessionKey,
        threadBindingKey: "agent:researcher:discord:group:paper-lab",
        depth: 2,
        runPayload: null,
        dispatchPayload: null,
      },
    ],
  });
  await writeWorkflowRuntimeSessionsStore({
    projectRoot,
    projectId: "announce-runtime",
    entries: [
      {
        sessionKey: parentSessionKey,
        sessionId: "session-parent",
        runtime: "subagent",
        role: "researcher",
        agentId: "researcher",
        ownerAgent: "researcher",
        family: "research",
        kind: "workflow_stage_dispatch",
        channelKey: "discord:group:paper-lab",
        requesterSessionKey: "agent:researcher:discord:group:paper-lab",
        projectId: "announce-runtime",
        projectRoot,
        parentSessionKey: "agent:researcher:discord:group:paper-lab",
        threadBindingKey: "agent:researcher:discord:group:paper-lab",
        depth: 1,
        status: "active",
        runId: "run-parent",
        queueKey: "queue-parent",
        startedAt: completedAt,
        lastHeartbeatAt: completedAt,
        lastAnnounceAt: null,
        lastCheckedAt: null,
        lastFinishedAt: null,
        lastError: null,
      },
      {
        sessionKey: childSessionKey,
        sessionId: "session-child",
        runtime: "subagent",
        role: "reviewer",
        agentId: "reviewer",
        ownerAgent: "reviewer",
        family: "research",
        kind: "workflow_stage_dispatch",
        channelKey: "discord:group:paper-lab",
        requesterSessionKey: parentSessionKey,
        projectId: "announce-runtime",
        projectRoot,
        parentSessionKey: null,
        threadBindingKey: "agent:researcher:discord:group:paper-lab",
        depth: 2,
        status: "active",
        runId: "run-child",
        queueKey: "queue-child-1",
        startedAt: completedAt,
        lastHeartbeatAt: completedAt,
        lastAnnounceAt: null,
        lastCheckedAt: null,
        lastFinishedAt: null,
        lastError: null,
      },
    ],
  });

  const announce = await recordWorkflowAnnounceEvent({
    projectRoot,
    projectId: "announce-runtime",
    announceId: "announce:runtime:1",
    parentSessionKey: null,
    childSessionKey,
    deliveryMode: "internal",
    summary: "child reviewer completed",
    payload: {
      status: "completed",
      completedAt,
      result: {
        verdict: "pass",
      },
    },
  });

  assert.equal(announce.entry.parentSessionKey, parentSessionKey);

  const sessionsStore = await readWorkflowRuntimeSessionsStore(projectRoot);
  const parentSession = sessionsStore.entries.find(
    (entry) => entry.sessionKey === parentSessionKey
  );
  const childSession = sessionsStore.entries.find(
    (entry) => entry.sessionKey === childSessionKey
  );
  assert.equal(parentSession?.lastAnnounceAt, completedAt);
  assert.equal(childSession?.parentSessionKey, parentSessionKey);
  assert.equal(childSession?.status, "completed");
  assert.equal(childSession?.lastFinishedAt, completedAt);

  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(queueStore.entries[0]?.status, "completed");
});

test("recoverWorkflowRuntimeState marks orphan active sessions as needs_repair and emits a recovery broadcast once", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "epsilon");
  await migrateWorkflowRuntimeState({
    projectRoot,
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });

  await recordWorkflowRuntimeSession({
    projectRoot,
    projectId: "epsilon",
    sessionKey: "agent:researcher:discord:group:paper-lab:epsilon",
    sessionId: "runtime-session-epsilon",
    runtime: "subagent",
    role: "researcher",
    agentId: "researcher",
    ownerAgent: "researcher",
    family: "research",
    kind: "workflow_stage_dispatch",
    channelKey: "discord:group:paper-lab",
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    projectRoot,
    status: "active",
    runId: "runtime-run-epsilon",
    startedAt: "2026-03-30T00:00:00.000Z",
    lastHeartbeatAt: "2026-03-30T00:00:00.000Z",
  });

  const firstRecovery = await recoverWorkflowRuntimeState({
    projectRoot,
    projectId: "epsilon",
    staleSessionAgeMs: 0,
    enqueueRecoveryBroadcast: true,
  });
  const secondRecovery = await recoverWorkflowRuntimeState({
    projectRoot,
    projectId: "epsilon",
    staleSessionAgeMs: 0,
    enqueueRecoveryBroadcast: true,
  });

  assert.equal(firstRecovery.repairedSessions.length, 1);
  assert.equal(secondRecovery.repairedSessions.length, 0);

  const sessionsStore = await readWorkflowRuntimeSessionsStore(projectRoot);
  assert.equal(sessionsStore.entries.length, 1);
  assert.equal(sessionsStore.entries[0].status, "needs_repair");

  const broadcastStore = await readWorkflowBroadcastOutboxStore(projectRoot);
  const recoveryBroadcasts = broadcastStore.entries.filter(
    (entry) => entry.status === "recovered_after_restart"
  );
  assert.equal(recoveryBroadcasts.length, 1);

  const events = await readWorkflowRuntimeEvents(projectRoot);
  assert.equal(
    events.some(
      (event) =>
        event.kind === "runtime_recovery" && event.summary?.includes("needs_repair")
    ),
    true
  );
});

test("recoverWorkflowRuntimeState repairs stale running queue entries with no active session", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "stale-running-queue");
  const oldIso = "2026-03-30T00:00:00.000Z";
  const freshIso = new Date().toISOString();
  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    projectId: "stale-running-queue",
    entries: [
      {
        transitionId: "orphan-transition",
        queueId: "orphan-transition",
        queueKey: "queue-orphan-running",
        source: "workflow_auto_stage",
        entryType: "dispatch_task",
        ownerAgent: "academic_writer",
        channelKey: "local:conversation:test",
        requesterSessionKey: "agent:researcher:local:conversation:test",
        messageChannel: "local",
        preferredSessionKey: "agent:academic_writer:local:conversation:test",
        family: "research",
        kind: "workflow_stage_dispatch",
        projectId: "stale-running-queue",
        projectRoot,
        queuedAt: oldIso,
        lastAttemptedAt: oldIso,
        attemptCount: 1,
        summary: "orphan running dispatch",
        status: "running",
        fallbackMode: null,
        lastError: null,
        parentSessionKey: null,
        threadBindingKey: null,
        depth: 0,
        runPayload: null,
        dispatchPayload: null,
      },
      {
        transitionId: "active-transition",
        queueId: "active-transition",
        queueKey: "queue-active-running",
        source: "workflow_auto_stage",
        entryType: "dispatch_task",
        ownerAgent: "academic_writer",
        channelKey: "local:conversation:test",
        requesterSessionKey: "agent:researcher:local:conversation:test",
        messageChannel: "local",
        preferredSessionKey: "agent:academic_writer:local:conversation:fresh",
        family: "research",
        kind: "workflow_stage_dispatch",
        projectId: "stale-running-queue",
        projectRoot,
        queuedAt: oldIso,
        lastAttemptedAt: oldIso,
        attemptCount: 1,
        summary: "active running dispatch",
        status: "running",
        fallbackMode: null,
        lastError: null,
        parentSessionKey: null,
        threadBindingKey: null,
        depth: 0,
        runPayload: null,
        dispatchPayload: null,
      },
    ],
  });
  await writeWorkflowRuntimeSessionsStore({
    projectRoot,
    projectId: "stale-running-queue",
    entries: [
      {
        sessionKey: "agent:academic_writer:local:conversation:fresh",
        sessionId: "session-fresh",
        runtime: "subagent",
        role: "academic_writer",
        agentId: "academic_writer",
        ownerAgent: "academic_writer",
        family: "research",
        kind: "workflow_stage_dispatch",
        channelKey: "local:conversation:test",
        requesterSessionKey: "agent:researcher:local:conversation:test",
        projectId: "stale-running-queue",
        projectRoot,
        parentSessionKey: null,
        threadBindingKey: null,
        depth: 0,
        status: "active",
        runId: "run-fresh",
        queueKey: "queue-active-running",
        startedAt: freshIso,
        lastHeartbeatAt: freshIso,
        lastAnnounceAt: null,
        lastCheckedAt: freshIso,
        lastFinishedAt: null,
        lastError: null,
      },
    ],
  });

  const result = await recoverWorkflowRuntimeState({
    projectRoot,
    projectId: "stale-running-queue",
    staleSessionAgeMs: 60 * 60 * 1000,
  });

  assert.deepEqual(
    result.queue.repaired.map((entry) => entry.queueKey),
    ["queue-orphan-running"]
  );
  assert.equal(result.sessions.repaired.length, 0);

  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(
    queueStore.entries.find((entry) => entry.queueKey === "queue-orphan-running")?.status,
    "needs_repair"
  );
  assert.equal(
    queueStore.entries.find((entry) => entry.queueKey === "queue-active-running")?.status,
    "running"
  );

  const idempotent = await recoverWorkflowRuntimeState({
    projectRoot,
    projectId: "stale-running-queue",
    staleSessionAgeMs: 60 * 60 * 1000,
  });
  assert.equal(idempotent.queue.repaired.length, 0);
});

test("consumeWorkflowAnnounceOutbox groups by parent session, skips duplicates, and leaves orphans pending", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "announce-project");
  await writeWorkflowRuntimeSessionsStore({
    projectRoot,
    projectId: "announce-project",
    entries: [
      {
        sessionKey: "agent:researcher:root",
        sessionId: null,
        runtime: "subagent",
        role: "researcher",
        agentId: "researcher",
        ownerAgent: "researcher",
        family: "research",
        kind: "workflow_stage_dispatch",
        channelKey: "discord:group:paper-lab",
        requesterSessionKey: "agent:researcher:root",
        projectId: "announce-project",
        projectRoot,
        parentSessionKey: null,
        threadBindingKey: null,
        depth: 0,
        status: "active",
        runId: "run-parent",
        queueKey: null,
        startedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
        lastAnnounceAt: null,
        lastCheckedAt: null,
        lastFinishedAt: null,
        lastError: null,
      },
    ],
  });
  await writeWorkflowAnnounceOutboxStore({
    projectRoot,
    projectId: "announce-project",
    entries: [
      {
        announceId: "announce-1",
        sourceTransitionId: "transition-1",
        projectId: "announce-project",
        projectRoot,
        parentSessionKey: "agent:researcher:root",
        childSessionKey: "agent:researcher:child-1",
        deliveryMode: "internal",
        status: "pending",
        summary: "child complete",
        payload: { child: 1 },
        createdAt: "2026-03-31T00:00:00.000Z",
        consumedAt: null,
        lastError: null,
      },
      {
        announceId: "announce-1",
        sourceTransitionId: "transition-1-dupe",
        projectId: "announce-project",
        projectRoot,
        parentSessionKey: "agent:researcher:root",
        childSessionKey: "agent:researcher:child-1b",
        deliveryMode: "internal",
        status: "pending",
        summary: "duplicate child complete",
        payload: { child: "dupe" },
        createdAt: "2026-03-31T00:00:01.000Z",
        consumedAt: null,
        lastError: null,
      },
      {
        announceId: "announce-2",
        sourceTransitionId: "transition-2",
        projectId: "announce-project",
        projectRoot,
        parentSessionKey: "agent:researcher:missing-parent",
        childSessionKey: "agent:researcher:child-2",
        deliveryMode: "internal",
        status: "pending",
        summary: "orphaned child",
        payload: { child: 2 },
        createdAt: "2026-03-31T00:00:02.000Z",
        consumedAt: null,
        lastError: null,
      },
      {
        announceId: "announce-3",
        sourceTransitionId: "transition-3",
        projectId: "announce-project",
        projectRoot,
        parentSessionKey: null,
        childSessionKey: "agent:researcher:child-3",
        deliveryMode: "external",
        status: "pending",
        summary: "root level completion",
        payload: { child: 3 },
        createdAt: "2026-03-31T00:00:03.000Z",
        consumedAt: null,
        lastError: null,
      },
    ],
  });

  const result = await consumeWorkflowAnnounceOutbox({
    projectRoot,
    projectId: "announce-project",
    markConsumed: true,
  });

  assert.equal(result.duplicates.length, 1);
  assert.equal(result.orphans.length, 1);
  assert.equal(result.groups.length, 2);
  assert.deepEqual(
    result.groups
      .map((group) => group.parentSessionKey)
      .sort((left, right) => String(left ?? "").localeCompare(String(right ?? ""))),
    [null, "agent:researcher:root"]
  );
  assert.equal(
    result.groups.find((group) => group.parentSessionKey === "agent:researcher:root")?.entries.length,
    1
  );
  assert.equal(
    result.groups.find((group) => group.parentSessionKey === null)?.entries.length,
    1
  );

  const announceStore = await readWorkflowAnnounceOutboxStore(projectRoot);
  const consumed = announceStore.entries.find((entry) => entry.announceId === "announce-1");
  const duplicate = announceStore.entries.filter((entry) => entry.announceId === "announce-1")[1];
  const orphan = announceStore.entries.find((entry) => entry.announceId === "announce-2");
  assert.equal(consumed?.status, "consumed");
  assert.ok(consumed?.consumedAt);
  assert.equal(duplicate?.status, "skipped");
  assert.equal(orphan?.status, "pending");
});

test("consumeWorkflowAnnounceOutbox repairs legacy nested child announces into parent-visible failed state", async (t) => {
  const projectRoot = await makeProjectRoot();
  const parentSessionKey =
    "agent:researcher:discord:group:paper-lab:subagent:workflow-stage";
  const childSessionKey =
    "agent:researcher:discord:group:paper-lab:subagent:workflow-stage:subagent:analysis";
  const finishedAt = "2026-04-02T00:00:00.000Z";

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "announce-recovery");
  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    projectId: "announce-recovery",
    entries: [
      {
        transitionId: "transition-child-2",
        queueId: "transition-child-2",
        queueKey: "queue-child-2",
        source: "workflow_auto_stage",
        entryType: "dispatch_task",
        ownerAgent: "analyzer",
        channelKey: "discord:group:paper-lab",
        requesterSessionKey: parentSessionKey,
        messageChannel: "discord",
        preferredSessionKey: childSessionKey,
        family: "research",
        kind: "workflow_stage_dispatch",
        projectId: "announce-recovery",
        projectRoot,
        queuedAt: finishedAt,
        lastAttemptedAt: finishedAt,
        attemptCount: 1,
        summary: "legacy child queue",
        status: "running",
        fallbackMode: null,
        lastError: null,
        parentSessionKey,
        threadBindingKey: "agent:researcher:discord:group:paper-lab",
        depth: 2,
        runPayload: null,
        dispatchPayload: null,
      },
    ],
  });
  await writeWorkflowRuntimeSessionsStore({
    projectRoot,
    projectId: "announce-recovery",
    entries: [
      {
        sessionKey: parentSessionKey,
        sessionId: "session-parent-2",
        runtime: "subagent",
        role: "researcher",
        agentId: "researcher",
        ownerAgent: "researcher",
        family: "research",
        kind: "workflow_stage_dispatch",
        channelKey: "discord:group:paper-lab",
        requesterSessionKey: "agent:researcher:discord:group:paper-lab",
        projectId: "announce-recovery",
        projectRoot,
        parentSessionKey: "agent:researcher:discord:group:paper-lab",
        threadBindingKey: "agent:researcher:discord:group:paper-lab",
        depth: 1,
        status: "active",
        runId: "run-parent-2",
        queueKey: "queue-parent-2",
        startedAt: finishedAt,
        lastHeartbeatAt: finishedAt,
        lastAnnounceAt: null,
        lastCheckedAt: null,
        lastFinishedAt: null,
        lastError: null,
      },
      {
        sessionKey: childSessionKey,
        sessionId: "session-child-2",
        runtime: "subagent",
        role: "analyzer",
        agentId: "analyzer",
        ownerAgent: "analyzer",
        family: "research",
        kind: "workflow_stage_dispatch",
        channelKey: "discord:group:paper-lab",
        requesterSessionKey: parentSessionKey,
        projectId: "announce-recovery",
        projectRoot,
        parentSessionKey: null,
        threadBindingKey: "agent:researcher:discord:group:paper-lab",
        depth: 2,
        status: "active",
        runId: "run-child-2",
        queueKey: "queue-child-2",
        startedAt: finishedAt,
        lastHeartbeatAt: finishedAt,
        lastAnnounceAt: null,
        lastCheckedAt: null,
        lastFinishedAt: null,
        lastError: null,
      },
    ],
  });
  await writeWorkflowAnnounceOutboxStore({
    projectRoot,
    projectId: "announce-recovery",
    entries: [
      {
        announceId: "announce-legacy-failure",
        sourceTransitionId: "transition-child-2",
        projectId: "announce-recovery",
        projectRoot,
        parentSessionKey: null,
        childSessionKey,
        deliveryMode: "internal",
        status: "pending",
        summary: "legacy nested failure",
        payload: {
          status: "error",
          completedAt: finishedAt,
          error: "analysis failed",
        },
        createdAt: finishedAt,
        consumedAt: null,
        lastError: null,
      },
    ],
  });

  const consumed = await consumeWorkflowAnnounceOutbox({
    projectRoot,
    projectId: "announce-recovery",
    markConsumed: true,
  });

  assert.deepEqual(
    consumed.groups.map((group) => group.parentSessionKey),
    [parentSessionKey]
  );

  const sessionsStore = await readWorkflowRuntimeSessionsStore(projectRoot);
  const parentSession = sessionsStore.entries.find(
    (entry) => entry.sessionKey === parentSessionKey
  );
  const childSession = sessionsStore.entries.find(
    (entry) => entry.sessionKey === childSessionKey
  );
  assert.equal(parentSession?.lastAnnounceAt, finishedAt);
  assert.equal(parentSession?.lastError, "analysis failed");
  assert.equal(childSession?.status, "failed");
  assert.equal(childSession?.lastFinishedAt, finishedAt);
  assert.equal(childSession?.lastError, "analysis failed");

  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(queueStore.entries[0]?.status, "failed");
  assert.equal(queueStore.entries[0]?.lastError, "analysis failed");

  const announceStore = await readWorkflowAnnounceOutboxStore(projectRoot);
  assert.equal(announceStore.entries[0]?.parentSessionKey, parentSessionKey);
  assert.equal(announceStore.entries[0]?.status, "consumed");
});

test("replayWorkflowBroadcastOutbox delivers pending and failed entries once", async (t) => {
  const projectRoot = await makeProjectRoot();
  const deliveries = [];

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "broadcast-project");
  await writeWorkflowBroadcastOutboxStore({
    projectRoot,
    projectId: "broadcast-project",
    entries: [
      {
        broadcastId: "broadcast-1",
        idempotencyKey: "broadcast-1",
        projectId: "broadcast-project",
        projectRoot,
        sessionKey: "agent:researcher:discord:group:paper-lab",
        status: "started",
        stage: "idea",
        summary: "ready",
        deliveryStatus: "pending",
        attempts: 0,
        createdAt: "2026-03-31T00:00:00.000Z",
        lastAttemptedAt: null,
        deliveredAt: null,
        lastError: null,
      },
      {
        broadcastId: "broadcast-2",
        idempotencyKey: "broadcast-2",
        projectId: "broadcast-project",
        projectRoot,
        sessionKey: "agent:researcher:discord:group:paper-lab",
        status: "handed_off",
        stage: "graph_build",
        summary: "retry me",
        deliveryStatus: "failed",
        attempts: 1,
        createdAt: "2026-03-31T00:00:01.000Z",
        lastAttemptedAt: "2026-03-31T00:00:01.000Z",
        deliveredAt: null,
        lastError: "temporary failure",
      },
      {
        broadcastId: "broadcast-3",
        idempotencyKey: "broadcast-3",
        projectId: "broadcast-project",
        projectRoot,
        sessionKey: "agent:researcher:discord:group:paper-lab",
        status: "completed",
        stage: "frontier_mapping",
        summary: "already delivered",
        deliveryStatus: "delivered",
        attempts: 1,
        createdAt: "2026-03-31T00:00:02.000Z",
        lastAttemptedAt: "2026-03-31T00:00:02.000Z",
        deliveredAt: "2026-03-31T00:00:02.500Z",
        lastError: null,
      },
    ],
  });

  const firstPass = await replayWorkflowBroadcastOutbox({
    projectRoot,
    projectId: "broadcast-project",
    sendBroadcast: async (entry) => {
      deliveries.push(entry.idempotencyKey);
      return { runId: `run-${entry.idempotencyKey}` };
    },
  });

  assert.equal(firstPass.delivered.length, 2);
  assert.deepEqual(deliveries.sort(), ["broadcast-1", "broadcast-2"]);

  const secondPass = await replayWorkflowBroadcastOutbox({
    projectRoot,
    projectId: "broadcast-project",
    sendBroadcast: async (entry) => {
      deliveries.push(`second-${entry.idempotencyKey}`);
      return { runId: `run-${entry.idempotencyKey}` };
    },
  });

  assert.equal(secondPass.delivered.length, 0);
  assert.equal(secondPass.skipped.length >= 2, true);
  assert.equal(deliveries.length, 2);

  const broadcastStore = await readWorkflowBroadcastOutboxStore(projectRoot);
  assert.equal(
    broadcastStore.entries.filter((entry) => entry.deliveryStatus === "delivered").length,
    3
  );
});

test("replayWorkflowBroadcastOutbox supersedes stale entries when the channel binding points at another project", async (t) => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-runtime-broadcast-binding-")
  );
  const projectsRoot = path.join(workspaceRoot, "projects");
  const staleProjectRoot = path.join(projectsRoot, "generalized-category-discovery");
  const reboundProjectRoot = path.join(projectsRoot, "gcd-survey-tpami-2026");
  const sessionKey = "agent:researcher:discord:channel:1491811255814586530";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await makeProject(staleProjectRoot, "generalized-category-discovery");
  await makeProject(reboundProjectRoot, "gcd-survey-tpami-2026");
  await bindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    projectRoot: reboundProjectRoot,
    boundByAgent: "researcher",
  });
  await writeWorkflowBroadcastOutboxStore({
    projectRoot: staleProjectRoot,
    projectId: "generalized-category-discovery",
    entries: [
      {
        broadcastId: "broadcast-stale",
        idempotencyKey: "broadcast-stale",
        projectId: "generalized-category-discovery",
        projectRoot: staleProjectRoot,
        sessionKey,
        status: "continued",
        stage: "plan",
        summary: "stale replay",
        deliveryStatus: "pending",
        attempts: 0,
        createdAt: "2026-03-31T00:00:00.000Z",
        lastAttemptedAt: null,
        deliveredAt: null,
        lastError: null,
      },
    ],
  });

  const result = await replayWorkflowBroadcastOutbox({
    projectRoot: staleProjectRoot,
    projectId: "generalized-category-discovery",
    workflowPolicy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    sendBroadcast: async () => {
      throw new Error("should not deliver");
    },
  });

  assert.equal(result.delivered.length, 0);
  assert.equal(result.skipped.length, 1);
  const broadcastStore = await readWorkflowBroadcastOutboxStore(staleProjectRoot);
  assert.equal(broadcastStore.entries[0].deliveryStatus, "superseded");
});

test("recoverWorkflowRuntimeState repairs stale queue and sessions after replaying announce and broadcast outboxes", async (t) => {
  const projectRoot = await makeProjectRoot();
  const deliveries = [];

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "recovery-project");
  const oldIso = "2026-03-30T00:00:00.000Z";

  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    projectId: "recovery-project",
    entries: [
      {
        transitionId: "transition-1",
        queueId: "transition-1",
        queueKey: "queue-1",
        source: "workflow_auto_stage",
        entryType: "dispatch_task",
        ownerAgent: "researcher",
        channelKey: "discord:group:paper-lab",
        requesterSessionKey: "agent:researcher:root",
        messageChannel: "discord",
        preferredSessionKey: null,
        family: "research",
        kind: "workflow_stage_dispatch",
        projectId: "recovery-project",
        projectRoot,
        queuedAt: oldIso,
        lastAttemptedAt: oldIso,
        attemptCount: 1,
        summary: "stale transition",
        status: "queued",
        fallbackMode: null,
        lastError: null,
        parentSessionKey: null,
        threadBindingKey: null,
        depth: 0,
        runPayload: null,
        dispatchPayload: null,
      },
    ],
  });
  await writeWorkflowRuntimeSessionsStore({
    projectRoot,
    projectId: "recovery-project",
    entries: [
      {
        sessionKey: "agent:researcher:stale",
        sessionId: "session-stale",
        runtime: "subagent",
        role: "researcher",
        agentId: "researcher",
        ownerAgent: "researcher",
        family: "research",
        kind: "workflow_stage_dispatch",
        channelKey: "discord:group:paper-lab",
        requesterSessionKey: "agent:researcher:root",
        projectId: "recovery-project",
        projectRoot,
        parentSessionKey: null,
        threadBindingKey: null,
        depth: 0,
        status: "active",
        runId: "run-stale",
        queueKey: "queue-1",
        startedAt: oldIso,
        lastHeartbeatAt: oldIso,
        lastAnnounceAt: null,
        lastCheckedAt: oldIso,
        lastFinishedAt: null,
        lastError: null,
      },
    ],
  });
  await writeWorkflowAnnounceOutboxStore({
    projectRoot,
    projectId: "recovery-project",
    entries: [
      {
        announceId: "announce-recovery",
        sourceTransitionId: "transition-1",
        projectId: "recovery-project",
        projectRoot,
        parentSessionKey: "agent:researcher:stale",
        childSessionKey: "agent:researcher:child",
        deliveryMode: "internal",
        status: "pending",
        summary: "child complete",
        payload: null,
        createdAt: oldIso,
        consumedAt: null,
        lastError: null,
      },
    ],
  });
  await writeWorkflowBroadcastOutboxStore({
    projectRoot,
    projectId: "recovery-project",
    entries: [
      {
        broadcastId: "broadcast-recovery",
        idempotencyKey: "broadcast-recovery",
        projectId: "recovery-project",
        projectRoot,
        sessionKey: "agent:researcher:stale",
        status: "recovered_after_restart",
        stage: null,
        summary: "Recovered after restart.",
        deliveryStatus: "pending",
        attempts: 0,
        createdAt: oldIso,
        lastAttemptedAt: null,
        deliveredAt: null,
        lastError: null,
      },
    ],
  });

  const result = await recoverWorkflowRuntimeState({
    projectRoot,
    projectId: "recovery-project",
    staleSessionAgeMs: 1,
    sendBroadcast: async (entry) => {
      deliveries.push(entry.idempotencyKey);
      return { runId: `broadcast-${entry.idempotencyKey}` };
    },
  });

  assert.deepEqual(result.stageOrder, [
    "announce_replay",
    "broadcast_replay",
    "queued_transitions",
    "stale_sessions",
  ]);
  assert.equal(result.announce.consumed.length, 1);
  assert.equal(result.broadcast.delivered.length >= 1, true);
  assert.equal(result.queue.repaired.length, 1);
  assert.equal(result.sessions.repaired.length, 1);
  assert.equal(deliveries.includes("broadcast-recovery"), true);

  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  const sessionsStore = await readWorkflowRuntimeSessionsStore(projectRoot);
  const announceStore = await readWorkflowAnnounceOutboxStore(projectRoot);
  assert.equal(queueStore.entries[0].status, "needs_repair");
  assert.equal(sessionsStore.entries[0].status, "needs_repair");
  assert.equal(announceStore.entries[0].status, "consumed");
});
