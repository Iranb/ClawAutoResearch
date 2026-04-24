import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createWorkflowTransitionIntent,
  recordWorkflowRuntimeSession,
} from "../tools/workflow-session-orchestrator.ts";
import {
  migrateWorkflowRuntimeState,
  readWorkflowRuntimeQueueStore,
  readWorkflowRuntimeSessionsStore,
  writeWorkflowRuntimeQueueStore,
} from "../tools/workflow-runtime-state.ts";
import { readWorkflowRuntimeIncidentsStore } from "../tools/workflow-runtime-incidents.ts";
import { runWorkflowRuntimeMaintenancePass } from "../tools/workflow-runtime-maintenance.ts";
import { readWorkflowHandoffIntentStore } from "../tools/workflow-handoff/handoff-store.ts";
import { bindChannelProjectForWorkflow } from "../tools/workflow-guard.ts";
import { readWorkflowDiagnosticEvents } from "../tools/workflow-diagnostics.ts";

async function makeProjectRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-runtime-maintenance-"));
}

async function makeProject(projectRoot, projectId) {
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: projectId,
        current_stage: "idea",
        owner_agent: "researcher",
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeExecutable(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, { mode: 0o755 });
}

test("runWorkflowRuntimeMaintenancePass replays repairable background transitions", async (t) => {
  const projectRoot = await makeProjectRoot();
  const queueKey = "repair:bg:q1";

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "alpha");
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId: "alpha",
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });

  await createWorkflowTransitionIntent({
    projectRoot,
    projectId: "alpha",
    queueKey,
    source: "start_background_run",
    entryType: "background_run",
    ownerAgent: "researcher",
    channelKey: "discord:group:paper-lab",
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    preferredSessionKey: "agent:researcher:discord:group:paper-lab:subagent:bg",
    family: "research",
    kind: "literature_review",
    summary: "Resume the literature review background run.",
    runPayload: {
      message: "Continue the bounded literature review task.",
      lane: "nested",
      deliver: false,
      idempotencyKey: "bg-repair-1",
      extraSystemPrompt: "Stay bounded.",
    },
  });

  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    projectId: "alpha",
    entries: queueStore.entries.map((entry) =>
      entry.queueKey === queueKey
        ? {
            ...entry,
            status: "needs_repair",
            lastAttemptedAt: "2026-04-10T09:00:00.000Z",
            lastCheckedAt: "2026-04-10T09:00:00.000Z",
          }
        : entry
    ),
  });
  await recordWorkflowRuntimeSession({
    projectRoot,
    projectId: "alpha",
    sessionKey: "agent:researcher:discord:group:paper-lab:subagent:bg",
    sessionId: "runtime-session-alpha",
    runtime: "subagent",
    role: "researcher",
    agentId: "researcher",
    ownerAgent: "researcher",
    family: "research",
    kind: "literature_review",
    channelKey: "discord:group:paper-lab",
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    projectRoot,
    status: "needs_repair",
    runId: "runtime-run-alpha",
    queueKey,
    startedAt: "2026-04-10T09:00:00.000Z",
    lastHeartbeatAt: "2026-04-10T09:00:00.000Z",
  });

  const started = [];
  const result = await runWorkflowRuntimeMaintenancePass({
    projectRoot,
    projectId: "alpha",
    workflowRuntime: {
      async run(params) {
        started.push(params);
        return { runId: "replayed-bg-run-1" };
      },
    },
    maxRepairAttempts: 3,
    staleSessionAgeMs: 365 * 24 * 60 * 60 * 1000,
  });

  assert.deepEqual(result.replayedQueueKeys, [queueKey]);
  assert.equal(result.watchdogSummary.queueRepairPending, 0);
  assert.equal(started.length, 1);
  assert.equal(started[0].sessionKey, "agent:researcher:discord:group:paper-lab:subagent:bg");

  const refreshedQueue = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(
    refreshedQueue.entries.find((entry) => entry.queueKey === queueKey)?.status,
    "running"
  );
  const refreshedSessions = await readWorkflowRuntimeSessionsStore(projectRoot);
  assert.equal(
    refreshedSessions.entries.some(
      (entry) => entry.queueKey === queueKey && entry.status === "active"
    ),
    true
  );
  const diagnostics = await readWorkflowDiagnosticEvents(projectRoot);
  assert.ok(
    diagnostics.some(
      (event) =>
        event.component === "runtime_maintenance" &&
        event.action === "maintenance_started"
    )
  );
  assert.ok(
    diagnostics.some(
      (event) =>
        event.component === "runtime_maintenance" &&
        event.action === "maintenance_completed" &&
        event.details?.watchdogSummary
    )
  );
  assert.ok(
    diagnostics.some(
      (event) =>
        event.component === "runtime_recovery" &&
        event.action === "recovery_completed"
    )
  );
});

test("runWorkflowRuntimeMaintenancePass escalates exhausted transitions and orphan sessions", async (t) => {
  const projectRoot = await makeProjectRoot();
  const queueKey = "repair:dispatch:q2";

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "beta");
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId: "beta",
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });

  await createWorkflowTransitionIntent({
    projectRoot,
    projectId: "beta",
    queueKey,
    source: "workflow_auto_stage",
    entryType: "dispatch_task",
    ownerAgent: "researcher",
    channelKey: "discord:group:paper-lab",
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    preferredSessionKey: "agent:researcher:discord:group:paper-lab:subagent:workflow-stage",
    family: "research",
    kind: "workflow_stage_dispatch",
    summary: "Replay the stalled stage dispatch.",
    dispatchPayload: {
      requesterChannel: "discord",
      requesterAccountId: null,
      preferredSessionKeys: [
        "agent:researcher:discord:group:paper-lab:subagent:workflow-stage",
      ],
      fromRole: "researcher",
      toRole: "researcher",
      projectRoot,
      projectId: "beta",
      stage: "idea",
      summary: "Replay the stalled stage dispatch.",
      command: "/idea-phase",
      mailboxMessageId: null,
      requireMailboxAcknowledgement: true,
      extraBody: "Continue only the assigned stage.",
      waitTimeoutMs: 5_000,
      retryOnTimeout: true,
      enableSpawnFallback: true,
      useWorkflowHandoff: true,
      autoModeActive: true,
    },
  });

  const initialQueueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    projectId: "beta",
    entries: initialQueueStore.entries.map((entry) =>
      entry.queueKey === queueKey
        ? {
            ...entry,
            status: "needs_repair",
            attemptCount: 3,
            lastAttemptedAt: "2026-04-10T09:00:00.000Z",
            lastCheckedAt: "2026-04-10T09:00:00.000Z",
            lastError: "stuck",
          }
        : entry
    ),
  });

  await recordWorkflowRuntimeSession({
    projectRoot,
    projectId: "beta",
    sessionKey: "agent:researcher:discord:group:paper-lab:subagent:workflow-stage",
    sessionId: "runtime-session-beta",
    runtime: "subagent",
    role: "researcher",
    agentId: "researcher",
    ownerAgent: "researcher",
    family: "research",
    kind: "workflow_stage_dispatch",
    channelKey: "discord:group:paper-lab",
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    projectRoot,
    status: "needs_repair",
    runId: "runtime-run-beta",
    queueKey,
    startedAt: "2026-04-10T09:00:00.000Z",
    lastHeartbeatAt: "2026-04-10T09:00:00.000Z",
  });
  await recordWorkflowRuntimeSession({
    projectRoot,
    projectId: "beta",
    sessionKey: "agent:researcher:discord:group:paper-lab:orphan",
    sessionId: "runtime-session-orphan",
    runtime: "subagent",
    role: "researcher",
    agentId: "researcher",
    ownerAgent: "researcher",
    family: "research",
    kind: "workflow_stage_dispatch",
    channelKey: "discord:group:paper-lab",
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    projectRoot,
    status: "needs_repair",
    runId: "runtime-run-orphan",
    queueKey: null,
    startedAt: "2026-04-10T09:00:00.000Z",
    lastHeartbeatAt: "2026-04-10T09:00:00.000Z",
  });

  const result = await runWorkflowRuntimeMaintenancePass({
    projectRoot,
    projectId: "beta",
    maxRepairAttempts: 3,
    staleSessionAgeMs: 365 * 24 * 60 * 60 * 1000,
  });

  assert.deepEqual(result.exhaustedQueueKeys, [queueKey]);
  assert.equal(result.exhaustedSessionKeys.includes("agent:researcher:discord:group:paper-lab:orphan"), true);

  const refreshedQueue = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(
    refreshedQueue.entries.find((entry) => entry.queueKey === queueKey)?.status,
    "failed"
  );
  const refreshedSessions = await readWorkflowRuntimeSessionsStore(projectRoot);
  assert.equal(
    refreshedSessions.entries.find((entry) => entry.sessionKey.endsWith(":orphan"))?.status,
    "failed"
  );

  const incidents = await readWorkflowRuntimeIncidentsStore(projectRoot, "beta");
  assert.equal(
    incidents.entries.some((entry) => entry.kind === "repair_exhausted"),
    true
  );
  assert.equal(
    incidents.entries.some((entry) => entry.kind === "repair_orphan_session"),
    true
  );
});

test("runWorkflowRuntimeMaintenancePass repairs active sessions whose underlying session store is already terminal", async (t) => {
  const projectRoot = await makeProjectRoot();
  const queueKey = "repair:dispatch:terminal-inspection";
  const sessionKey = "agent:researcher:discord:group:paper-lab:subagent:stale-terminal";

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "beta-inspection");
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId: "beta-inspection",
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });

  await createWorkflowTransitionIntent({
    projectRoot,
    projectId: "beta-inspection",
    queueKey,
    source: "workflow_auto_stage",
    entryType: "dispatch_task",
    ownerAgent: "researcher",
    channelKey: "discord:group:paper-lab",
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    preferredSessionKey: sessionKey,
    family: "research",
    kind: "workflow_stage_dispatch",
    summary: "Replay the stale stage dispatch.",
    dispatchPayload: {
      requesterChannel: "discord",
      requesterAccountId: null,
      preferredSessionKeys: [sessionKey],
      fromRole: "researcher",
      toRole: "researcher",
      projectRoot,
      projectId: "beta-inspection",
      stage: "idea",
      summary: "Replay the stale stage dispatch.",
      command: "/idea-phase",
      mailboxMessageId: null,
      requireMailboxAcknowledgement: true,
      extraBody: "Continue only the assigned stage.",
      waitTimeoutMs: 5_000,
      retryOnTimeout: true,
      enableSpawnFallback: true,
      useWorkflowHandoff: true,
      autoModeActive: true,
    },
  });

  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    projectId: "beta-inspection",
    entries: queueStore.entries.map((entry) =>
      entry.queueKey === queueKey
        ? {
            ...entry,
            status: "running",
            attemptCount: 1,
            lastAttemptedAt: "2026-04-10T09:00:00.000Z",
            lastCheckedAt: "2026-04-10T09:00:00.000Z",
          }
        : entry
    ),
  });

  await recordWorkflowRuntimeSession({
    projectRoot,
    projectId: "beta-inspection",
    sessionKey,
    sessionId: "runtime-session-terminal",
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
    runId: "runtime-run-terminal",
    queueKey,
    startedAt: "2026-04-10T09:00:00.000Z",
    lastHeartbeatAt: "2026-04-10T09:00:00.000Z",
  });

  const result = await runWorkflowRuntimeMaintenancePass({
    projectRoot,
    projectId: "beta-inspection",
    maxRepairAttempts: 1,
    workflowRuntime: {
      async run() {
        throw new Error("terminal inspected sessions should exhaust before replay");
      },
      async inspectSession(params) {
        assert.equal(params.sessionKey, sessionKey);
        return {
          sessionKey,
          sessionId: "runtime-session-terminal",
          sessionFile: "/tmp/runtime-session-terminal.jsonl",
          status: "done",
          startedAt: Date.parse("2026-04-10T09:00:00.000Z"),
          endedAt: Date.parse("2026-04-10T09:05:00.000Z"),
          updatedAt: Date.parse("2026-04-10T09:05:00.000Z"),
          abortedLastRun: false,
          providerOverride: null,
          modelOverride: null,
          liveModelSwitchPending: false,
        };
      },
    },
    staleSessionAgeMs: 365 * 24 * 60 * 60 * 1000,
  });

  assert.equal(result.repairedSessionKeys.includes(sessionKey), true);
  assert.deepEqual(result.exhaustedQueueKeys, [queueKey]);

  const refreshedQueue = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(
    refreshedQueue.entries.find((entry) => entry.queueKey === queueKey)?.status,
    "failed"
  );
  const refreshedSessions = await readWorkflowRuntimeSessionsStore(projectRoot);
  assert.equal(
    refreshedSessions.entries.find((entry) => entry.sessionKey === sessionKey)?.status,
    "failed"
  );

  const diagnostics = await readWorkflowDiagnosticEvents(projectRoot);
  assert.equal(
    diagnostics.some(
      (event) =>
        event.component === "runtime_maintenance" &&
        event.action === "session_inspection_repair"
    ),
    true
  );
});

test("runWorkflowRuntimeMaintenancePass does not repair newly launched active sessions before persistence grace expires", async (t) => {
  const projectRoot = await makeProjectRoot();
  const queueKey = "repair:dispatch:newborn-inspection";
  const sessionKey = "agent:researcher:local:group:paper-lab:subagent:newborn";

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "newborn-inspection");
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId: "newborn-inspection",
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });

  await createWorkflowTransitionIntent({
    projectRoot,
    projectId: "newborn-inspection",
    queueKey,
    source: "workflow_auto_stage",
    entryType: "dispatch_task",
    ownerAgent: "researcher",
    channelKey: "local:group:paper-lab",
    requesterSessionKey: "agent:researcher:local:group:paper-lab",
    preferredSessionKey: sessionKey,
    family: "research",
    kind: "workflow_stage_dispatch",
    summary: "Keep the newly launched dispatch running.",
    dispatchPayload: {
      requesterChannel: "local",
      requesterAccountId: null,
      preferredSessionKeys: [sessionKey],
      fromRole: "researcher",
      toRole: "researcher",
      projectRoot,
      projectId: "newborn-inspection",
      stage: "graph_build",
      summary: "Keep the newly launched dispatch running.",
      command: "/graph-build",
      mailboxMessageId: null,
      requireMailboxAcknowledgement: false,
      extraBody: "Continue only the assigned stage.",
      waitTimeoutMs: 5_000,
      retryOnTimeout: true,
      enableSpawnFallback: true,
      useWorkflowHandoff: false,
      autoModeActive: true,
    },
  });
  const now = new Date().toISOString();
  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    projectId: "newborn-inspection",
    entries: queueStore.entries.map((entry) =>
      entry.queueKey === queueKey
        ? {
            ...entry,
            status: "running",
            attemptCount: 1,
            lastAttemptedAt: now,
            lastCheckedAt: now,
          }
        : entry
    ),
  });

  await recordWorkflowRuntimeSession({
    projectRoot,
    projectId: "newborn-inspection",
    sessionKey,
    sessionId: null,
    runtime: "embedded_agent",
    role: "researcher",
    agentId: "researcher",
    ownerAgent: "researcher",
    family: "research",
    kind: "workflow_stage_dispatch",
    channelKey: "local:group:paper-lab",
    requesterSessionKey: "agent:researcher:local:group:paper-lab",
    projectRoot,
    status: "active",
    runId: "runtime-run-newborn",
    queueKey,
    startedAt: now,
    lastHeartbeatAt: now,
  });

  let inspectCalls = 0;
  const result = await runWorkflowRuntimeMaintenancePass({
    projectRoot,
    projectId: "newborn-inspection",
    workflowRuntime: {
      async inspectSession() {
        inspectCalls += 1;
        return null;
      },
    },
    staleSessionAgeMs: 365 * 24 * 60 * 60 * 1000,
  });

  assert.equal(inspectCalls, 0);
  assert.deepEqual(result.repairedSessionKeys, []);
  assert.deepEqual(result.replayedQueueKeys, []);

  const refreshedQueue = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(
    refreshedQueue.entries.find((entry) => entry.queueKey === queueKey)?.status,
    "running"
  );
  const refreshedSessions = await readWorkflowRuntimeSessionsStore(projectRoot);
  assert.equal(
    refreshedSessions.entries.find((entry) => entry.sessionKey === sessionKey)?.status,
    "active"
  );
  const diagnostics = await readWorkflowDiagnosticEvents(projectRoot);
  assert.equal(
    diagnostics.some(
      (event) =>
        event.component === "runtime_maintenance" &&
        event.action === "session_inspection_repair"
    ),
    false
  );
});

test("runWorkflowRuntimeMaintenancePass defers missing active embedded session inspection until stale", async (t) => {
  const projectRoot = await makeProjectRoot();
  const queueKey = "repair:dispatch:embedded-deferred-inspection";
  const sessionKey = "agent:researcher:local:group:paper-lab:subagent:embedded-deferred";

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "embedded-deferred-inspection");
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId: "embedded-deferred-inspection",
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });

  await createWorkflowTransitionIntent({
    projectRoot,
    projectId: "embedded-deferred-inspection",
    queueKey,
    source: "workflow_auto_stage",
    entryType: "dispatch_task",
    ownerAgent: "researcher",
    channelKey: "local:group:paper-lab",
    requesterSessionKey: "agent:researcher:local:group:paper-lab",
    preferredSessionKey: sessionKey,
    family: "research",
    kind: "workflow_stage_dispatch",
    summary: "Keep the embedded dispatch running while session metadata catches up.",
    dispatchPayload: {
      requesterChannel: "local",
      requesterAccountId: null,
      preferredSessionKeys: [sessionKey],
      fromRole: "researcher",
      toRole: "researcher",
      projectRoot,
      projectId: "embedded-deferred-inspection",
      stage: "graph_build",
      summary: "Keep the embedded dispatch running while session metadata catches up.",
      command: "/graph-build",
      mailboxMessageId: null,
      requireMailboxAcknowledgement: false,
      extraBody: "Continue only the assigned stage.",
      waitTimeoutMs: 5_000,
      retryOnTimeout: true,
      enableSpawnFallback: true,
      useWorkflowHandoff: false,
      autoModeActive: true,
    },
  });
  const recentlyStarted = new Date(Date.now() - 60_000).toISOString();
  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    projectId: "embedded-deferred-inspection",
    entries: queueStore.entries.map((entry) =>
      entry.queueKey === queueKey
        ? {
            ...entry,
            status: "running",
            attemptCount: 1,
            lastAttemptedAt: recentlyStarted,
            lastCheckedAt: recentlyStarted,
          }
        : entry
    ),
  });

  await recordWorkflowRuntimeSession({
    projectRoot,
    projectId: "embedded-deferred-inspection",
    sessionKey,
    sessionId: null,
    runtime: "embedded_agent",
    role: "researcher",
    agentId: "researcher",
    ownerAgent: "researcher",
    family: "research",
    kind: "workflow_stage_dispatch",
    channelKey: "local:group:paper-lab",
    requesterSessionKey: "agent:researcher:local:group:paper-lab",
    projectRoot,
    status: "active",
    runId: "runtime-run-embedded-deferred",
    queueKey,
    startedAt: recentlyStarted,
    lastHeartbeatAt: recentlyStarted,
  });

  let inspectCalls = 0;
  const result = await runWorkflowRuntimeMaintenancePass({
    projectRoot,
    projectId: "embedded-deferred-inspection",
    workflowRuntime: {
      async inspectSession(params) {
        inspectCalls += 1;
        assert.equal(params.sessionKey, sessionKey);
        return null;
      },
    },
    activeSessionInspectionGraceMs: 30_000,
    staleSessionAgeMs: 15 * 60 * 1000,
  });

  assert.equal(inspectCalls, 1);
  assert.deepEqual(result.repairedSessionKeys, []);
  assert.deepEqual(result.replayedQueueKeys, []);

  const refreshedQueue = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(
    refreshedQueue.entries.find((entry) => entry.queueKey === queueKey)?.status,
    "running"
  );
  const refreshedSessions = await readWorkflowRuntimeSessionsStore(projectRoot);
  assert.equal(
    refreshedSessions.entries.find((entry) => entry.sessionKey === sessionKey)?.status,
    "active"
  );
  const diagnostics = await readWorkflowDiagnosticEvents(projectRoot);
  assert.equal(
    diagnostics.some(
      (event) =>
        event.component === "runtime_maintenance" &&
        event.action === "session_inspection_deferred"
    ),
    true
  );
});

test("runWorkflowRuntimeMaintenancePass lets stale recovery repair missing active embedded sessions after stale", async (t) => {
  const projectRoot = await makeProjectRoot();
  const queueKey = "repair:dispatch:embedded-stale-missing";
  const sessionKey = "agent:researcher:local:group:paper-lab:subagent:embedded-stale";

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "embedded-stale-missing");
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId: "embedded-stale-missing",
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });

  await createWorkflowTransitionIntent({
    projectRoot,
    projectId: "embedded-stale-missing",
    queueKey,
    source: "workflow_auto_stage",
    entryType: "dispatch_task",
    ownerAgent: "researcher",
    channelKey: "local:group:paper-lab",
    requesterSessionKey: "agent:researcher:local:group:paper-lab",
    preferredSessionKey: sessionKey,
    family: "research",
    kind: "workflow_stage_dispatch",
    summary: "Repair the stale embedded dispatch.",
    dispatchPayload: {
      requesterChannel: "local",
      requesterAccountId: null,
      preferredSessionKeys: [sessionKey],
      fromRole: "researcher",
      toRole: "researcher",
      projectRoot,
      projectId: "embedded-stale-missing",
      stage: "graph_build",
      summary: "Repair the stale embedded dispatch.",
      command: "/graph-build",
      mailboxMessageId: null,
      requireMailboxAcknowledgement: false,
      extraBody: "Continue only the assigned stage.",
      waitTimeoutMs: 5_000,
      retryOnTimeout: true,
      enableSpawnFallback: true,
      useWorkflowHandoff: false,
      autoModeActive: true,
    },
  });
  const staleStarted = new Date(Date.now() - 60_000).toISOString();
  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    projectId: "embedded-stale-missing",
    entries: queueStore.entries.map((entry) =>
      entry.queueKey === queueKey
        ? {
            ...entry,
            status: "running",
            attemptCount: 1,
            lastAttemptedAt: staleStarted,
            lastCheckedAt: staleStarted,
          }
        : entry
    ),
  });

  await recordWorkflowRuntimeSession({
    projectRoot,
    projectId: "embedded-stale-missing",
    sessionKey,
    sessionId: null,
    runtime: "embedded_agent",
    role: "researcher",
    agentId: "researcher",
    ownerAgent: "researcher",
    family: "research",
    kind: "workflow_stage_dispatch",
    channelKey: "local:group:paper-lab",
    requesterSessionKey: "agent:researcher:local:group:paper-lab",
    projectRoot,
    status: "active",
    runId: "runtime-run-embedded-stale",
    queueKey,
    startedAt: staleStarted,
    lastHeartbeatAt: staleStarted,
  });

  const result = await runWorkflowRuntimeMaintenancePass({
    projectRoot,
    projectId: "embedded-stale-missing",
    workflowRuntime: {
      async run() {
        throw new Error("stale missing sessions should exhaust before replay");
      },
      async inspectSession() {
        return null;
      },
    },
    activeSessionInspectionGraceMs: 0,
    staleSessionAgeMs: 1_000,
    maxRepairAttempts: 1,
  });

  assert.equal(
    result.recovery.repairedSessions.some((entry) => entry.sessionKey === sessionKey),
    true
  );
  assert.deepEqual(result.exhaustedQueueKeys, [queueKey]);

  const refreshedQueue = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(
    refreshedQueue.entries.find((entry) => entry.queueKey === queueKey)?.status,
    "failed"
  );
  const refreshedSessions = await readWorkflowRuntimeSessionsStore(projectRoot);
  assert.equal(
    refreshedSessions.entries.find((entry) => entry.sessionKey === sessionKey)?.status,
    "failed"
  );
});

test("runWorkflowRuntimeMaintenancePass suppresses stale queue replays when the channel binding moved to another project", async (t) => {
  const workspaceRoot = await makeProjectRoot();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const staleProjectRoot = path.join(projectsRoot, "generalized-category-discovery");
  const reboundProjectRoot = path.join(projectsRoot, "gcd-survey-tpami-2026");
  const queueKey = "repair:dispatch:binding-mismatch";
  const sessionKey = "agent:researcher:discord:channel:1491811255814586530";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await makeProject(staleProjectRoot, "generalized-category-discovery");
  await makeProject(reboundProjectRoot, "gcd-survey-tpami-2026");
  await migrateWorkflowRuntimeState({
    projectRoot: staleProjectRoot,
    projectId: "generalized-category-discovery",
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });
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

  await createWorkflowTransitionIntent({
    projectRoot: staleProjectRoot,
    projectId: "generalized-category-discovery",
    queueKey,
    source: "workflow_auto_stage",
    entryType: "dispatch_task",
    ownerAgent: "researcher",
    channelKey: "discord:channel:1491811255814586530",
    requesterSessionKey: sessionKey,
    preferredSessionKey: `${sessionKey}:subagent:workflow-stage`,
    family: "research",
    kind: "workflow_stage_dispatch",
    summary: "Replay the stale stage dispatch.",
    dispatchPayload: {
      requesterChannel: "discord",
      requesterAccountId: "default",
      preferredSessionKeys: [`${sessionKey}:subagent:workflow-stage`],
      fromRole: "researcher",
      toRole: "coder",
      projectRoot: staleProjectRoot,
      projectId: "generalized-category-discovery",
      stage: "plan",
      summary: "Replay the stale stage dispatch.",
      command: "/plan-research",
      mailboxMessageId: null,
      requireMailboxAcknowledgement: true,
      extraBody: "Continue only the assigned stage.",
      waitTimeoutMs: 5_000,
      retryOnTimeout: true,
      enableSpawnFallback: true,
      useWorkflowHandoff: true,
      autoModeActive: true,
    },
  });
  const queueStore = await readWorkflowRuntimeQueueStore(staleProjectRoot);
  await writeWorkflowRuntimeQueueStore({
    projectRoot: staleProjectRoot,
    projectId: "generalized-category-discovery",
    entries: queueStore.entries.map((entry) =>
      entry.queueKey === queueKey
        ? {
            ...entry,
            status: "needs_repair",
            attemptCount: 0,
            lastAttemptedAt: "2026-04-10T09:00:00.000Z",
            lastCheckedAt: "2026-04-10T09:00:00.000Z",
          }
        : entry
    ),
  });

  const result = await runWorkflowRuntimeMaintenancePass({
    projectRoot: staleProjectRoot,
    projectId: "generalized-category-discovery",
    workflowPolicy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    staleSessionAgeMs: 0,
  });

  assert.equal(result.exhaustedQueueKeys.includes(queueKey), true);
  assert.equal(result.replayedQueueKeys.includes(queueKey), false);
  const refreshedQueue = await readWorkflowRuntimeQueueStore(staleProjectRoot);
  assert.equal(
    refreshedQueue.entries.find((entry) => entry.queueKey === queueKey)?.status,
    "failed"
  );
  const incidents = await readWorkflowRuntimeIncidentsStore(
    staleProjectRoot,
    "generalized-category-discovery"
  );
  assert.equal(
    incidents.entries.some((entry) => entry.kind === "binding_gate_mismatch"),
    true
  );
});

test("runWorkflowRuntimeMaintenancePass routes terminal PaperNexus retry failures to repair handoff", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await makeProject(projectRoot, "gamma");
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.paper_ingestion = {
    retry_status: "completed_with_failures",
    retryable_failed_papers: [{ source_key: "paper-1", title: "Failed paper" }],
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await runWorkflowRuntimeMaintenancePass({
    projectRoot,
    projectId: "gamma",
  });

  const handoffs = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(
    handoffs.intents.some((intent) => intent.reason === "paper_ingestion_failed"),
    true
  );
});

test("runWorkflowRuntimeMaintenancePass consumes queued handoff queue entries and syncs the handoff intent", async (t) => {
  const projectRoot = await makeProjectRoot();
  const intentId = "intent-queued-demo";
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await makeProject(projectRoot, "handoff-queue");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "handoff-queue",
    current_stage: "plan",
    owner_agent: "researcher",
    orchestration_state: {
      pending_handoff_id: intentId,
      handoff_phase: "prepared",
    },
  });
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId: "handoff-queue",
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });
  await writeJson(path.join(projectRoot, ".openclaw-research", "workflow-handoff-intents.json"), {
    schemaVersion: 1,
    projectRoot,
    projectId: "handoff-queue",
    updatedAt: "2026-04-21T00:00:00.000Z",
    intents: [
      {
        schemaVersion: 1,
        intentId,
        idempotencyKey: "queued-demo",
        projectId: "handoff-queue",
        projectRoot,
        workflowLine: "experiment",
        stage: "code",
        fromRole: "researcher",
        fromSessionKey: "agent:researcher:discord:group:paper-lab",
        toRole: "coder",
        toSessionKey: null,
        reason: "stage_owner_change",
        priority: "normal",
        sourceTaskId: null,
        targetTaskId: null,
        artifactReceiptId: null,
        failureId: null,
        failureFingerprint: null,
        repairLineageId: null,
        status: "queued",
        stageBefore: "plan",
        stageAfter: "code",
        executionId: "exec-queued-demo",
        sessionBindingKey: "discord:group:paper-lab",
        preferredSessionKeys: ["agent:coder:discord:group:paper-lab"],
        deliveryPlan: {
          channels: ["runtime_queue"],
          requireAck: true,
          ackDeadlineAt: "2026-04-21T00:10:00.000Z",
          fallbackAfterMs: 600000,
          maxAttemptsTotal: 4,
          maxAttemptsByChannel: { runtime_queue: 1 },
          staleClaimAfterMs: 900000,
        },
        deliveryAttempts: [],
        dispatchedAt: null,
        acknowledgedAt: null,
        claimedAt: null,
        activatedAt: null,
        claimLeaseExpiresAt: null,
        terminalReason: null,
        createdAt: "2026-04-21T00:00:00.000Z",
        updatedAt: "2026-04-21T00:00:00.000Z",
        expiresAt: "2126-04-21T01:00:00.000Z",
        summary: "Queued coder handoff.",
        command: "/implement-experiment",
        blockerSummary: null,
        payload: {},
      },
    ],
  });

  await createWorkflowTransitionIntent({
    projectRoot,
    projectId: "handoff-queue",
    queueKey: `handoff:${intentId}`,
    source: "workflow_auto_stage",
    entryType: "dispatch_task",
    ownerAgent: "coder",
    channelKey: "discord:group:paper-lab",
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    preferredSessionKey: "agent:coder:discord:group:paper-lab",
    family: "research",
    kind: "workflow_stage_dispatch",
    summary: "Replay the queued handoff.",
    dispatchPayload: {
      requesterChannel: "discord",
      requesterAccountId: null,
      preferredSessionKeys: ["agent:coder:discord:group:paper-lab"],
      fromRole: "researcher",
      toRole: "coder",
      projectRoot,
      projectId: "handoff-queue",
      stage: "code",
      summary: "Replay the queued handoff.",
      command: "/implement-experiment",
      mailboxMessageId: null,
      requireMailboxAcknowledgement: true,
      extraBody: "Continue only the assigned stage.",
      waitTimeoutMs: 5000,
      retryOnTimeout: true,
      enableSpawnFallback: true,
      useWorkflowHandoff: true,
      autoModeActive: true,
    },
  });

  const result = await runWorkflowRuntimeMaintenancePass({
    projectRoot,
    projectId: "handoff-queue",
    workflowRuntime: {
      async run() {
        return { runId: "queued-handoff-run-1" };
      },
    },
    staleSessionAgeMs: 0,
  });

  assert.equal(result.replayedQueueKeys.includes(`handoff:${intentId}`), true);
  const handoffStore = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(handoffStore.intents[0].status, "dispatched");
  assert.match(handoffStore.intents[0].toSessionKey ?? "", /^agent:coder:/);
});

test("runWorkflowRuntimeMaintenancePass refreshes experiment monitor and persists decision without a foreground agent", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-runtime-maintenance-ssh-"));

  t.after(async () => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await fs.rm(binDir, { recursive: true, force: true });
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeExecutable(
    path.join(binDir, "ssh"),
    [
      "#!/bin/sh",
      "printf '\\n---SCREENS---\\n'",
      "printf 'No Sockets found in /run/screen.\\n'",
      "",
    ].join("\n")
  );
  process.env.PATH = `${binDir}:${previousPath ?? ""}`;

  await makeProject(projectRoot, "delta");
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "experiment";
  manifest.owner_agent = "researcher";
  manifest.experiment_search = {
    status: "running",
    search_spec_path: "planner/EXPERIMENT_SEARCH_SPEC.json",
    baseline_fairness_status: "ready",
    implementation_confidence: "trusted",
    multi_seed_status: "pending",
    ablation_status: "pending",
    search_exhaustion_status: "active",
    evidence_cleanliness_status: "clean",
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeJson(path.join(projectRoot, "planner", "EXPERIMENT_SEARCH_SPEC.json"), {
    search_session_id: "search-delta",
  });
  const runDir = path.join(projectRoot, "coder", "demo-exp");
  await writeJson(path.join(runDir, "REMOTE_RUN.json"), {
    experiment_id: "exp-delta",
    experiment_name: "candidate",
    track_id: "track-main",
    server: "gpu-server",
    gpu_id: "0",
    screen_name: "timed-run",
    status: "running",
  });
  await writeJson(path.join(runDir, "RUN_HEARTBEAT.json"), {
    status: "running",
    heartbeat_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  });

  const result = await runWorkflowRuntimeMaintenancePass({
    projectRoot,
    projectId: "delta",
  });

  assert.equal(result.experimentMaintenance.attempted, true);
  assert.equal(result.experimentMaintenance.monitorRefreshed, true);
  assert.equal(result.experimentMaintenance.decisionPersisted, true);
  assert.equal(result.experimentMaintenance.recommendation, "reconcile_finished");
  assert.equal(result.experimentMaintenance.decision, "reconcile_runtime");

  const refreshedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(
    refreshedManifest.experiment_search.last_decision,
    "reconcile_runtime"
  );
});
