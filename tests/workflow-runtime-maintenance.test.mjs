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
    runtimeSubagent: {
      async run(params) {
        started.push(params);
        return { runId: "replayed-bg-run-1" };
      },
    },
    maxRepairAttempts: 3,
    staleSessionAgeMs: 0,
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
    staleSessionAgeMs: 0,
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
