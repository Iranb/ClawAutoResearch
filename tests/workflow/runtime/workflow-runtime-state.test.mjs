import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  getWorkflowAnnounceOutboxPath,
  getWorkflowBroadcastOutboxPath,
  getWorkflowRuntimeQueuePath,
  getWorkflowRuntimeSessionsPath,
  readWorkflowAnnounceOutboxStore,
  readWorkflowBroadcastOutboxStore,
  readWorkflowRuntimeQueueStore,
  readWorkflowRuntimeSessionsStore,
} from "../../../tools/workflow-runtime-state.ts";

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function makeProject(parentDir, projectId) {
  const projectRoot = path.join(parentDir, projectId);
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: projectId,
    current_stage: "experiment",
  });
  return projectRoot;
}

function queueEntry(overrides) {
  const queueKey = overrides.queueKey;
  return {
    transitionId: queueKey,
    queueId: queueKey,
    queueKey,
    source: "test",
    entryType: "dispatch_task",
    ownerAgent: "researcher",
    channelKey: "local:conversation:project-a",
    requesterSessionKey: "agent:researcher:local:conversation:project-a",
    messageChannel: "local",
    preferredSessionKey: null,
    family: "workflow",
    kind: "stage",
    projectId: overrides.projectId ?? null,
    projectRoot: overrides.projectRoot ?? null,
    queuedAt: "2026-05-07T00:00:00.000Z",
    lastAttemptedAt: null,
    lastCheckedAt: null,
    attemptCount: 0,
    summary: "queued test",
    status: "queued",
    fallbackMode: null,
    lastError: null,
    parentSessionKey: null,
    threadBindingKey: null,
    depth: 0,
    runPayload: null,
    dispatchPayload: overrides.dispatchPayload ?? null,
  };
}

function sessionEntry(overrides) {
  return {
    sessionKey: overrides.sessionKey,
    sessionId: null,
    runtime: "subagent",
    role: "researcher",
    agentId: "researcher",
    ownerAgent: "researcher",
    family: "workflow",
    kind: "stage",
    channelKey: "local:conversation:project-a",
    requesterSessionKey: null,
    projectId: overrides.projectId ?? null,
    projectRoot: overrides.projectRoot ?? null,
    parentSessionKey: null,
    threadBindingKey: null,
    depth: 0,
    status: "active",
    runId: null,
    queueKey: null,
    startedAt: "2026-05-07T00:00:00.000Z",
    lastHeartbeatAt: null,
    lastAnnounceAt: null,
    lastCheckedAt: null,
    lastFinishedAt: null,
    lastError: null,
  };
}

test("project-scoped runtime stores ignore foreign project entries", async (t) => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-runtime-state-isolation-")
  );
  const projectRoot = await makeProject(workspaceRoot, "project-a");
  const foreignProjectRoot = await makeProject(workspaceRoot, "project-b");

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeJson(getWorkflowRuntimeQueuePath(projectRoot), {
    entries: [
      queueEntry({ queueKey: "queue-good" }),
      queueEntry({ queueKey: "queue-foreign-entry", projectRoot: foreignProjectRoot }),
      queueEntry({
        queueKey: "queue-foreign-dispatch",
        projectRoot,
        dispatchPayload: {
          requesterChannel: null,
          requesterAccountId: null,
          preferredSessionKeys: [],
          fromRole: "researcher",
          toRole: "coder",
          projectRoot: foreignProjectRoot,
          projectId: "project-b",
          stage: "experiment",
          summary: "foreign dispatch",
          command: null,
          mailboxMessageId: null,
          requireMailboxAcknowledgement: false,
          extraBody: null,
          waitTimeoutMs: null,
          retryOnTimeout: false,
          enableSpawnFallback: true,
          useWorkflowHandoff: false,
          autoModeActive: false,
        },
      }),
    ],
  });

  await writeJson(getWorkflowRuntimeSessionsPath(projectRoot), {
    entries: [
      sessionEntry({ sessionKey: "agent:researcher:local:conversation:project-a" }),
      sessionEntry({
        sessionKey: "agent:researcher:local:conversation:project-b",
        projectRoot: foreignProjectRoot,
      }),
    ],
  });

  await writeJson(getWorkflowAnnounceOutboxPath(projectRoot), {
    entries: [
      {
        announceId: "announce-good",
        sourceTransitionId: null,
        projectId: "project-a",
        projectRoot,
        parentSessionKey: null,
        childSessionKey: "agent:coder:local:conversation:project-a",
        deliveryMode: "internal",
        status: "pending",
        summary: "good announce",
        payload: null,
        createdAt: "2026-05-07T00:00:00.000Z",
        consumedAt: null,
        lastError: null,
      },
      {
        announceId: "announce-foreign",
        sourceTransitionId: null,
        projectId: "project-b",
        projectRoot: foreignProjectRoot,
        parentSessionKey: null,
        childSessionKey: "agent:coder:local:conversation:project-b",
        deliveryMode: "internal",
        status: "pending",
        summary: "foreign announce",
        payload: null,
        createdAt: "2026-05-07T00:00:00.000Z",
        consumedAt: null,
        lastError: null,
      },
    ],
  });

  await writeJson(getWorkflowBroadcastOutboxPath(projectRoot), {
    entries: [
      {
        broadcastId: "broadcast-good",
        idempotencyKey: "broadcast-good",
        projectId: "project-a",
        projectRoot,
        sessionKey: "agent:researcher:local:conversation:project-a",
        status: "queued",
        stage: "experiment",
        summary: "good broadcast",
        deliveryStatus: "pending",
        attempts: 0,
        createdAt: "2026-05-07T00:00:00.000Z",
        lastAttemptedAt: null,
        deliveredAt: null,
        lastError: null,
      },
      {
        broadcastId: "broadcast-foreign",
        idempotencyKey: "broadcast-foreign",
        projectId: "project-b",
        projectRoot: foreignProjectRoot,
        sessionKey: "agent:researcher:local:conversation:project-b",
        status: "queued",
        stage: "experiment",
        summary: "foreign broadcast",
        deliveryStatus: "pending",
        attempts: 0,
        createdAt: "2026-05-07T00:00:00.000Z",
        lastAttemptedAt: null,
        deliveredAt: null,
        lastError: null,
      },
    ],
  });

  const queue = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.deepEqual(queue.entries.map((entry) => entry.queueKey), ["queue-good"]);
  assert.equal(queue.entries[0].projectRoot, projectRoot);
  assert.equal(queue.entries[0].projectId, "project-a");

  const sessions = await readWorkflowRuntimeSessionsStore(projectRoot);
  assert.deepEqual(
    sessions.entries.map((entry) => entry.sessionKey),
    ["agent:researcher:local:conversation:project-a"]
  );
  assert.equal(sessions.entries[0].projectRoot, projectRoot);

  const announces = await readWorkflowAnnounceOutboxStore(projectRoot);
  assert.deepEqual(
    announces.entries.map((entry) => entry.announceId),
    ["announce-good"]
  );

  const broadcasts = await readWorkflowBroadcastOutboxStore(projectRoot);
  assert.deepEqual(
    broadcasts.entries.map((entry) => entry.broadcastId),
    ["broadcast-good"]
  );
});
