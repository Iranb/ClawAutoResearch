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
import { readWorkflowLocalOperatorRelayEntries } from "../tools/workflow-local-operator-relay.ts";

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

test("runWorkflowRuntimeMaintenancePass restores missing background queue entries from repair sessions", async (t) => {
  const projectRoot = await makeProjectRoot();
  const queueKey = "repair:bg:missing-queue";
  const requesterSessionKey = "agent:researcher:local:conversation:gcd";

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "missing-queue-alpha",
    current_stage: "frontier_mapping",
    owner_agent: "researcher",
    title: "Use FixMatch insights to improve GCD",
  });
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId: "missing-queue-alpha",
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });
  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    projectId: "missing-queue-alpha",
    entries: [],
  });
  await recordWorkflowRuntimeSession({
    projectRoot,
    projectId: "missing-queue-alpha",
    sessionKey: "agent:researcher:local:conversation:gcd:subagent:lost-research-pipeline",
    sessionId: "runtime-session-lost",
    runtime: "subagent",
    role: "researcher",
    agentId: "researcher",
    ownerAgent: "researcher",
    family: "research",
    kind: "research_pipeline",
    channelKey: "local:conversation:gcd",
    requesterSessionKey,
    projectRoot,
    status: "needs_repair",
    runId: "runtime-run-lost",
    queueKey,
    startedAt: "2026-04-10T09:00:00.000Z",
    lastHeartbeatAt: "2026-04-10T09:00:00.000Z",
    lastError: "Workflow runtime session is missing from the underlying session store.",
  });

  const started = [];
  const result = await runWorkflowRuntimeMaintenancePass({
    projectRoot,
    projectId: "missing-queue-alpha",
    workflowRuntime: {
      async run(params) {
        started.push(params);
        return { runId: "replayed-missing-queue-run" };
      },
    },
    maxRepairAttempts: 3,
    staleSessionAgeMs: 365 * 24 * 60 * 60 * 1000,
  });

  assert.deepEqual(result.replayedQueueKeys, [queueKey]);
  assert.deepEqual(result.exhaustedSessionKeys, []);
  assert.equal(started.length, 1);
  assert.equal(started[0].sessionKey, requesterSessionKey);
  assert.match(started[0].message, /\/research-pipeline/);
  assert.match(started[0].message, /Use FixMatch insights to improve GCD/);

  const refreshedQueue = await readWorkflowRuntimeQueueStore(projectRoot);
  const restoredEntry = refreshedQueue.entries.find(
    (entry) => entry.queueKey === queueKey
  );
  assert.equal(restoredEntry?.status, "running");
  assert.equal(restoredEntry?.source, "runtime_orphan_repair");

  const diagnostics = await readWorkflowDiagnosticEvents(projectRoot);
  assert.ok(
    diagnostics.some(
      (event) =>
        event.component === "runtime_maintenance" &&
        event.action === "missing_queue_restored"
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

test("runWorkflowRuntimeMaintenancePass repairs missing active embedded session after inspection grace", async (t) => {
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
    summary: "Repair the embedded dispatch when the underlying session is missing.",
    dispatchPayload: {
      requesterChannel: "local",
      requesterAccountId: null,
      preferredSessionKeys: [sessionKey],
      fromRole: "researcher",
      toRole: "researcher",
      projectRoot,
      projectId: "embedded-deferred-inspection",
      stage: "graph_build",
      summary: "Repair the embedded dispatch when the underlying session is missing.",
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

  assert.ok(inspectCalls >= 1);
  assert.deepEqual(result.repairedSessionKeys, [sessionKey]);
  assert.deepEqual(result.replayedQueueKeys, []);

  const refreshedQueue = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(
    refreshedQueue.entries.find((entry) => entry.queueKey === queueKey)?.status,
    "needs_repair"
  );
  const refreshedSessions = await readWorkflowRuntimeSessionsStore(projectRoot);
  assert.equal(
    refreshedSessions.entries.find((entry) => entry.sessionKey === sessionKey)?.status,
    "needs_repair"
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

test("runWorkflowRuntimeMaintenancePass keeps active sessions when only local run tracking is missing", async (t) => {
  const projectRoot = await makeProjectRoot();
  const queueKey = "repair:dispatch:embedded-tracking-miss";
  const sessionKey = "agent:researcher:local:group:paper-lab:subagent:tracking-miss";

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "embedded-tracking-miss");
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId: "embedded-tracking-miss",
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });

  await createWorkflowTransitionIntent({
    projectRoot,
    projectId: "embedded-tracking-miss",
    queueKey,
    source: "workflow_auto_stage",
    entryType: "dispatch_task",
    ownerAgent: "researcher",
    channelKey: "local:group:paper-lab",
    requesterSessionKey: "agent:researcher:local:group:paper-lab",
    preferredSessionKey: sessionKey,
    family: "research",
    kind: "workflow_stage_dispatch",
    summary: "Keep the live embedded dispatch running.",
    dispatchPayload: {
      requesterChannel: "local",
      requesterAccountId: null,
      preferredSessionKeys: [sessionKey],
      fromRole: "researcher",
      toRole: "researcher",
      projectRoot,
      projectId: "embedded-tracking-miss",
      stage: "frontier_mapping",
      summary: "Keep the live embedded dispatch running.",
      command: "/frontier-mapping",
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
  const startedAt = new Date(Date.now() - 60_000).toISOString();
  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    projectId: "embedded-tracking-miss",
    entries: queueStore.entries.map((entry) =>
      entry.queueKey === queueKey
        ? {
            ...entry,
            status: "running",
            attemptCount: 1,
            lastAttemptedAt: startedAt,
            lastCheckedAt: startedAt,
          }
        : entry
    ),
  });

  await recordWorkflowRuntimeSession({
    projectRoot,
    projectId: "embedded-tracking-miss",
    sessionKey,
    sessionId: "workflow.researcher.tracking-miss",
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
    runId: "runtime-run-tracking-miss",
    queueKey,
    startedAt,
    lastHeartbeatAt: startedAt,
  });

  let waited = 0;
  const result = await runWorkflowRuntimeMaintenancePass({
    projectRoot,
    projectId: "embedded-tracking-miss",
    workflowRuntime: {
      async waitForRun(params) {
        waited += 1;
        assert.equal(params.runId, "runtime-run-tracking-miss");
        return {
          status: "error",
          error: "Embedded workflow run is not tracked in the local registry.",
        };
      },
      async inspectSession(params) {
        assert.equal(params.sessionKey, sessionKey);
        return {
          sessionKey,
          sessionId: "workflow.researcher.tracking-miss",
          sessionFile: null,
          status: "running",
          startedAt: Date.now() - 60_000,
          endedAt: null,
          updatedAt: Date.now(),
          abortedLastRun: false,
          providerOverride: null,
          modelOverride: null,
          liveModelSwitchPending: false,
          lastError: null,
        };
      },
    },
    activeSessionInspectionGraceMs: 0,
    staleSessionAgeMs: 15 * 60 * 1000,
    maxRepairAttempts: 3,
  });

  assert.equal(waited, 1);
  assert.deepEqual(result.replayedQueueKeys, []);
  assert.deepEqual(result.exhaustedQueueKeys, []);
  assert.deepEqual(result.repairedSessionKeys, []);

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

test("runWorkflowRuntimeMaintenancePass reactivates repair sessions that are still live", async (t) => {
  const projectRoot = await makeProjectRoot();
  const queueKey = "repair:dispatch:live-needs-repair";
  const sessionKey = "agent:researcher:local:group:paper-lab:subagent:live-needs-repair";

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "live-needs-repair");
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId: "live-needs-repair",
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });

  await createWorkflowTransitionIntent({
    projectRoot,
    projectId: "live-needs-repair",
    queueKey,
    source: "workflow_auto_stage",
    entryType: "dispatch_task",
    ownerAgent: "researcher",
    channelKey: "local:group:paper-lab",
    requesterSessionKey: "agent:researcher:local:group:paper-lab",
    preferredSessionKey: sessionKey,
    family: "research",
    kind: "workflow_stage_dispatch",
    summary: "Do not replay while the original runtime is still live.",
    dispatchPayload: {
      requesterChannel: "local",
      requesterAccountId: null,
      preferredSessionKeys: [sessionKey],
      fromRole: "researcher",
      toRole: "researcher",
      projectRoot,
      projectId: "live-needs-repair",
      stage: "idea",
      summary: "Do not replay while the original runtime is still live.",
      command: "/idea-phase",
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
  const startedAt = new Date(Date.now() - 60_000).toISOString();
  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    projectId: "live-needs-repair",
    entries: queueStore.entries.map((entry) =>
      entry.queueKey === queueKey
        ? {
            ...entry,
            status: "running",
            attemptCount: 2,
            lastAttemptedAt: startedAt,
            lastCheckedAt: startedAt,
          }
        : entry
    ),
  });

  await recordWorkflowRuntimeSession({
    projectRoot,
    projectId: "live-needs-repair",
    sessionKey,
    sessionId: "workflow.researcher.live-needs-repair",
    runtime: "embedded_agent",
    role: "researcher",
    agentId: "researcher",
    ownerAgent: "researcher",
    family: "research",
    kind: "workflow_stage_dispatch",
    channelKey: "local:group:paper-lab",
    requesterSessionKey: "agent:researcher:local:group:paper-lab",
    projectRoot,
    status: "needs_repair",
    runId: "runtime-run-live-needs-repair",
    queueKey,
    startedAt,
    lastHeartbeatAt: startedAt,
    lastError: "Background workflow session needs repair after runtime recovery.",
  });

  const result = await runWorkflowRuntimeMaintenancePass({
    projectRoot,
    projectId: "live-needs-repair",
    workflowRuntime: {
      async run() {
        throw new Error("live repair-marked sessions should not be replayed");
      },
      async inspectSession(params) {
        assert.equal(params.sessionKey, sessionKey);
        return {
          sessionKey,
          sessionId: "workflow.researcher.live-needs-repair",
          sessionFile: null,
          status: "running",
          startedAt: Date.now() - 60_000,
          endedAt: null,
          updatedAt: Date.now(),
          abortedLastRun: false,
          providerOverride: null,
          modelOverride: null,
          liveModelSwitchPending: false,
          lastError: null,
        };
      },
    },
    activeSessionInspectionGraceMs: 0,
    staleSessionAgeMs: 15 * 60 * 1000,
    maxRepairAttempts: 3,
  });

  assert.deepEqual(result.replayedQueueKeys, []);
  assert.deepEqual(result.exhaustedQueueKeys, []);
  assert.deepEqual(result.repairedSessionKeys, []);

  const refreshedQueue = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(
    refreshedQueue.entries.find((entry) => entry.queueKey === queueKey)?.status,
    "running"
  );
  const refreshedSessions = await readWorkflowRuntimeSessionsStore(projectRoot);
  const refreshedSession = refreshedSessions.entries.find(
    (entry) => entry.sessionKey === sessionKey
  );
  assert.equal(refreshedSession?.status, "active");
  assert.equal(refreshedSession?.lastError, null);
  assert.equal(refreshedSession?.lastFinishedAt, null);

  const diagnostics = await readWorkflowDiagnosticEvents(projectRoot);
  assert.equal(
    diagnostics.some(
      (event) =>
        event.component === "runtime_maintenance" &&
        event.action === "repair_session_reactivated_from_live_runtime"
    ),
    true
  );
  assert.equal(
    diagnostics.some(
      (event) =>
        event.component === "runtime_maintenance" &&
        event.action === "linked_queue_repair_marked"
    ),
    false
  );
});

test("runWorkflowRuntimeMaintenancePass cools down provider capacity failures and writes local relay", async (t) => {
  const projectRoot = await makeProjectRoot();
  const queueKey = "repair:dispatch:provider-capacity";
  const sessionKey = "agent:researcher:local:group:paper-lab:subagent:capacity";

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "provider-capacity");
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId: "provider-capacity",
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });

  await createWorkflowTransitionIntent({
    projectRoot,
    projectId: "provider-capacity",
    queueKey,
    source: "workflow_auto_stage",
    entryType: "dispatch_task",
    ownerAgent: "researcher",
    channelKey: "local:group:paper-lab",
    requesterSessionKey: "agent:researcher:local:group:paper-lab",
    preferredSessionKey: sessionKey,
    family: "research",
    kind: "workflow_stage_dispatch",
    summary: "Replay should wait when the provider quota is exhausted.",
    dispatchPayload: {
      requesterChannel: "local",
      requesterAccountId: null,
      preferredSessionKeys: [sessionKey],
      fromRole: "researcher",
      toRole: "researcher",
      projectRoot,
      projectId: "provider-capacity",
      stage: "graph_build",
      summary: "Replay should wait when the provider quota is exhausted.",
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
    projectId: "provider-capacity",
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
    projectId: "provider-capacity",
    sessionKey,
    sessionId: "workflow.researcher.capacity",
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
    runId: "runtime-run-capacity",
    queueKey,
    startedAt: staleStarted,
    lastHeartbeatAt: staleStarted,
  });

  const result = await runWorkflowRuntimeMaintenancePass({
    projectRoot,
    projectId: "provider-capacity",
    workflowRuntime: {
      async run() {
        throw new Error("capacity failures should not replay before cooldown");
      },
      async waitForRun(params) {
        assert.equal(params.runId, "runtime-run-capacity");
        return {
          status: "error",
          error: "429 usage allocated quota exceeded. please try again later.",
        };
      },
      async inspectSession(params) {
        assert.equal(params.sessionKey, sessionKey);
        return {
          sessionKey,
          sessionId: "workflow.researcher.capacity",
          sessionFile: null,
          status: "running",
          startedAt: Date.now() - 60_000,
          endedAt: null,
          updatedAt: Date.now(),
          abortedLastRun: false,
          providerOverride: null,
          modelOverride: null,
          liveModelSwitchPending: false,
          lastError: null,
        };
      },
    },
    activeSessionInspectionGraceMs: 0,
    staleSessionAgeMs: 15 * 60 * 1000,
    maxRepairAttempts: 3,
  });

  assert.deepEqual(result.replayedQueueKeys, []);
  assert.deepEqual(result.exhaustedQueueKeys, []);
  assert.deepEqual(result.repairedSessionKeys, [sessionKey]);

  const refreshedQueue = await readWorkflowRuntimeQueueStore(projectRoot);
  const refreshedEntry = refreshedQueue.entries.find(
    (entry) => entry.queueKey === queueKey
  );
  assert.equal(refreshedEntry?.status, "needs_repair");
  assert.match(refreshedEntry?.lastError ?? "", /allocated quota exceeded/);
  assert.ok(Date.parse(refreshedEntry?.nextRetryAt ?? "") > Date.now());

  const relays = await readWorkflowLocalOperatorRelayEntries(projectRoot);
  assert.equal(relays.length, 1);
  assert.equal(relays[0]?.queueKey, queueKey);
  assert.match(relays[0]?.operatorPrompt ?? "", /without Discord/);

  const diagnostics = await readWorkflowDiagnosticEvents(projectRoot);
  assert.equal(
    diagnostics.some(
      (event) =>
        event.component === "runtime_maintenance" &&
        event.action === "repair_replay_deferred_until_retry_at"
    ),
    true
  );
});

test("runWorkflowRuntimeMaintenancePass restores failed provider capacity queues to cooldown", async (t) => {
  const projectRoot = await makeProjectRoot();
  const queueKey = "repair:bg:failed-provider-capacity";

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "failed-provider-capacity");
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId: "failed-provider-capacity",
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });

  await createWorkflowTransitionIntent({
    projectRoot,
    projectId: "failed-provider-capacity",
    queueKey,
    source: "workflow_auto_discussion",
    entryType: "background_run",
    ownerAgent: "reviewer",
    channelKey: "local:conversation:capacity",
    requesterSessionKey: "agent:researcher:local:conversation:capacity",
    preferredSessionKey:
      "agent:reviewer:local:conversation:capacity:subagent:auto-discussion",
    family: "review",
    kind: "workflow_auto_discussion",
    summary: "Review round should wait when the provider quota is exhausted.",
    runPayload: {
      message: "Continue the auto discussion review task.",
      lane: "nested",
      deliver: false,
      idempotencyKey: "failed-provider-capacity",
      extraSystemPrompt: "Stay bounded.",
    },
  });

  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    projectId: "failed-provider-capacity",
    entries: queueStore.entries.map((entry) =>
      entry.queueKey === queueKey
        ? {
            ...entry,
            status: "failed",
            attemptCount: 5,
            lastAttemptedAt: "2026-04-10T09:00:00.000Z",
            lastCheckedAt: "2026-04-10T09:00:00.000Z",
            nextRetryAt: null,
            lastError:
              "Background workflow session hit provider capacity while still marked active: 429 usage allocated quota exceeded. please try again later.",
          }
        : entry
    ),
  });

  const result = await runWorkflowRuntimeMaintenancePass({
    projectRoot,
    projectId: "failed-provider-capacity",
    workflowRuntime: {
      async run() {
        throw new Error("provider capacity failures must not replay before cooldown");
      },
    },
    maxRepairAttempts: 3,
    staleSessionAgeMs: 15 * 60 * 1000,
  });

  assert.deepEqual(result.replayedQueueKeys, []);
  assert.deepEqual(result.exhaustedQueueKeys, []);
  assert.deepEqual(result.watchdogSummary.queueRepairPending, 1);

  const refreshedQueue = await readWorkflowRuntimeQueueStore(projectRoot);
  const refreshedEntry = refreshedQueue.entries.find(
    (entry) => entry.queueKey === queueKey
  );
  assert.equal(refreshedEntry?.status, "needs_repair");
  assert.match(refreshedEntry?.lastError ?? "", /allocated quota exceeded/);
  assert.ok(Date.parse(refreshedEntry?.nextRetryAt ?? "") > Date.now());

  const relays = await readWorkflowLocalOperatorRelayEntries(projectRoot);
  assert.equal(relays.length, 1);
  assert.equal(relays[0]?.queueKey, queueKey);
  assert.match(relays[0]?.operatorPrompt ?? "", /without Discord/);

  const diagnostics = await readWorkflowDiagnosticEvents(projectRoot);
  assert.equal(
    diagnostics.some(
      (event) =>
        event.component === "runtime_maintenance" &&
        event.action === "provider_capacity_failed_queue_recovered"
    ),
    true
  );
});

test("runWorkflowRuntimeMaintenancePass cools down active sessions whose transcript ends in provider capacity errors", async (t) => {
  const projectRoot = await makeProjectRoot();
  const queueKey = "repair:dispatch:transcript-capacity";
  const sessionKey = "agent:researcher:local:group:paper-lab:subagent:transcript-capacity";

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "transcript-capacity");
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId: "transcript-capacity",
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });

  await createWorkflowTransitionIntent({
    projectRoot,
    projectId: "transcript-capacity",
    queueKey,
    source: "workflow_auto_stage",
    entryType: "dispatch_task",
    ownerAgent: "researcher",
    channelKey: "local:group:paper-lab",
    requesterSessionKey: "agent:researcher:local:group:paper-lab",
    preferredSessionKey: sessionKey,
    family: "research",
    kind: "workflow_stage_dispatch",
    summary: "Replay should wait when transcript shows provider capacity.",
    dispatchPayload: {
      requesterChannel: "local",
      requesterAccountId: null,
      preferredSessionKeys: [sessionKey],
      fromRole: "researcher",
      toRole: "researcher",
      projectRoot,
      projectId: "transcript-capacity",
      stage: "frontier_mapping",
      summary: "Replay should wait when transcript shows provider capacity.",
      command: "/frontier-mapping",
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
    projectId: "transcript-capacity",
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
    projectId: "transcript-capacity",
    sessionKey,
    sessionId: "workflow.researcher.transcript-capacity",
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
    runId: "runtime-run-transcript-capacity",
    queueKey,
    startedAt: staleStarted,
    lastHeartbeatAt: staleStarted,
  });

  const result = await runWorkflowRuntimeMaintenancePass({
    projectRoot,
    projectId: "transcript-capacity",
    workflowRuntime: {
      async run() {
        throw new Error("capacity transcript failures should not replay before cooldown");
      },
      async waitForRun() {
        return { status: "timeout" };
      },
      async getSessionMessages(params) {
        assert.equal(params.sessionKey, sessionKey);
        return {
          messages: [
            {
              role: "assistant",
              stopReason: "toolUse",
              content: [{ type: "toolCall", name: "exec" }],
            },
            {
              role: "assistant",
              stopReason: "error",
              errorMessage: "429 usage allocated quota exceeded. please try again later.",
            },
          ],
        };
      },
      async inspectSession(params) {
        assert.equal(params.sessionKey, sessionKey);
        return {
          sessionKey,
          sessionId: "workflow.researcher.transcript-capacity",
          sessionFile: null,
          status: "running",
          startedAt: Date.now() - 60_000,
          endedAt: null,
          updatedAt: Date.now(),
          abortedLastRun: false,
          providerOverride: null,
          modelOverride: null,
          liveModelSwitchPending: false,
          lastError: null,
        };
      },
    },
    activeSessionInspectionGraceMs: 0,
    staleSessionAgeMs: 15 * 60 * 1000,
    maxRepairAttempts: 3,
  });

  assert.deepEqual(result.replayedQueueKeys, []);
  assert.deepEqual(result.exhaustedQueueKeys, []);
  assert.deepEqual(result.repairedSessionKeys, [sessionKey]);

  const refreshedQueue = await readWorkflowRuntimeQueueStore(projectRoot);
  const refreshedEntry = refreshedQueue.entries.find(
    (entry) => entry.queueKey === queueKey
  );
  assert.equal(refreshedEntry?.status, "needs_repair");
  assert.match(refreshedEntry?.lastError ?? "", /allocated quota exceeded/);
  assert.ok(Date.parse(refreshedEntry?.nextRetryAt ?? "") > Date.now());
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

test("runWorkflowRuntimeMaintenancePass marks PaperNexus requests without runtime linkage as needs-repair", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await makeProject(projectRoot, "stale-papernexus");
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "graph_build";
  manifest.paper_ingestion = {
    runtime_status: "waiting_import",
    graph_presence_status: "missing_corpus",
    queued_requests: [
      {
        request_id: "stale-upload",
        request_kind: "upload_manifest",
        status: "running",
        wrapper: "pn_batch_import.py",
        command_text:
          "python3 skills/papernexus/scripts/pn_batch_import.py --manifest batch.json submit",
        updated_at: "2026-04-20T00:00:00.000Z",
        last_run_id: "run:missing-upload",
        last_session_key: "agent:researcher:local:subagent:missing-papernexus",
      },
    ],
    active_batches: [],
    batch_items: [],
    paper_operations: [],
    import_task_ids: [],
    completed_papers: [],
  };
  await writeJson(manifestPath, manifest);

  const result = await runWorkflowRuntimeMaintenancePass({
    projectRoot,
    projectId: "stale-papernexus",
    activeSessionInspectionGraceMs: 0,
  });

  assert.deepEqual(result.repairedPaperIngestionRequestIds, ["stale-upload"]);
  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(
    updatedManifest.paper_ingestion.queued_requests[0].status,
    "needs_repair"
  );
  assert.equal(updatedManifest.paper_ingestion.runtime_status, "blocked");
  assert.match(
    updatedManifest.paper_ingestion.repair_reason,
    /lost runtime tracking/
  );
  const progress = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "PAPERNEXUS_PROGRESS.json"), "utf8")
  );
  assert.equal(progress.phase, "needs_repair");
  const diagnostics = (await readWorkflowDiagnosticEvents(projectRoot)).filter(
    (entry) => entry.component === "runtime_maintenance"
  );
  assert.equal(
    diagnostics.some(
      (entry) => entry.action === "paper_ingestion_request_repair"
    ),
    true
  );
});

test("runWorkflowRuntimeMaintenancePass reconciles terminal PaperNexus queue entries before stale repair", async (t) => {
  const projectRoot = await makeProjectRoot();
  const queueKey =
    "background-run:agent:researcher:local:papernexus:pn_batch_import";
  const sessionKey =
    "agent:researcher:local:subagent:papernexus-skill:batch-submit";

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "terminal-papernexus");
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId: "terminal-papernexus",
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "graph_build";
  manifest.paper_ingestion = {
    runtime_status: "waiting_import",
    graph_presence_status: "missing_corpus",
    queued_requests: [
      {
        request_id: "submitted-upload",
        request_kind: "upload_manifest",
        status: "running",
        wrapper: "pn_batch_import.py",
        command_text:
          "python3 skills/papernexus/scripts/pn_batch_import.py --manifest batch.json submit",
        updated_at: "2026-04-20T00:00:00.000Z",
        last_run_id: "run:submitted-upload",
        last_session_key: sessionKey,
      },
    ],
    active_batches: [],
    batch_items: [],
    paper_operations: [],
    import_task_ids: [],
    completed_papers: [],
  };
  await writeJson(manifestPath, manifest);

  await createWorkflowTransitionIntent({
    projectRoot,
    projectId: "terminal-papernexus",
    queueKey,
    source: "start_background_run",
    entryType: "background_run",
    ownerAgent: "researcher",
    channelKey: "local:conversation:terminal-papernexus",
    requesterSessionKey: "agent:researcher:local:conversation:terminal-papernexus",
    preferredSessionKey: sessionKey,
    family: "papernexus",
    kind: "papernexus_wrapper",
    summary: "Queue PaperNexus batch import.",
    runPayload: {
      message:
        "python3 skills/papernexus/scripts/pn_batch_import.py --manifest batch.json submit",
      lane: "nested",
      deliver: false,
      idempotencyKey: "terminal-papernexus-submit",
    },
  });
  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    projectId: "terminal-papernexus",
    entries: queueStore.entries.map((entry) =>
      entry.queueKey === queueKey
        ? {
            ...entry,
            status: "completed",
            lastAttemptedAt: "2026-04-20T00:01:00.000Z",
            lastCheckedAt: "2026-04-20T00:02:00.000Z",
          }
        : entry
    ),
  });

  const result = await runWorkflowRuntimeMaintenancePass({
    projectRoot,
    projectId: "terminal-papernexus",
    activeSessionInspectionGraceMs: 0,
  });

  assert.deepEqual(result.repairedPaperIngestionRequestIds, []);
  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(
    updatedManifest.paper_ingestion.queued_requests[0].status,
    "queued"
  );
  assert.match(
    updatedManifest.paper_ingestion.queued_requests[0].command_text,
    /\bwait\b/
  );
  assert.equal(updatedManifest.paper_ingestion.runtime_status, "waiting_import");
  assert.match(
    updatedManifest.paper_ingestion.waiting_reason,
    /remote import still requires bounded wait\/status verification/
  );
  const diagnostics = (await readWorkflowDiagnosticEvents(projectRoot)).filter(
    (entry) => entry.component === "runtime_maintenance"
  );
  assert.equal(
    diagnostics.some(
      (entry) =>
        entry.action === "paper_ingestion_request_runtime_reconciled"
    ),
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
