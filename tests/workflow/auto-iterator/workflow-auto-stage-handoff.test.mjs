import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPluginRegistrationContext } from "../../../tools/plugin-registration-shared.ts";
import { maybeDispatchAutoIteratorTask } from "../../../tools/register-workflow-tools.ts";
import {
  readWorkflowRuntimeQueueStore,
  readWorkflowRuntimeSessionsStore,
  writeWorkflowRuntimeSessionsStore,
} from "../../../tools/workflow-runtime-state.ts";
import { materializeWorkflowTaskGraph, readWorkflowTaskGraphStore } from "../../../tools/workflow-team/task-graph.ts";

async function makeProjectRoot() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-auto-stage-handoff-")
  );
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "demo-project",
        current_stage: "idea",
        owner_agent: "researcher",
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return projectRoot;
}

function createPlugin() {
  return createPluginRegistrationContext({
    runtime: {},
    logger: {},
    registerTool() {},
  });
}

async function acknowledgePendingWorkflowMailboxes(projectRoots) {
  for (const projectRoot of projectRoots) {
    const mailboxPath = path.join(
      projectRoot,
      ".openclaw-research",
      "workflow-mailbox.json"
    );
    try {
      const mailbox = JSON.parse(await fs.readFile(mailboxPath, "utf8"));
      let changed = false;
      for (const entry of mailbox.messages ?? []) {
        if (entry?.status === "pending") {
          entry.status = "acknowledged";
          entry.acknowledgedAt = "2026-04-10T12:00:00.000Z";
          changed = true;
        }
      }
      if (changed) {
        await fs.writeFile(mailboxPath, `${JSON.stringify(mailbox, null, 2)}\n`, "utf8");
      }
    } catch {
      // Some tests do not materialize a mailbox; ignore those cases.
    }
  }
}

test("maybeDispatchAutoIteratorTask queues an orchestrator auto-stage fallback when immediate handoff fails", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await maybeDispatchAutoIteratorTask({
    plugin: createPlugin(),
    workflowPolicy: {
      enforceWorkflowBoundaries: true,
      autoMode: "aggressive",
      projectsRoot: path.dirname(projectRoot),
    },
    agentCtx: {
      agentId: "researcher",
      sessionKey: "agent:researcher:discord:group:paper-lab",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot,
      projectId: "demo-project",
      currentStage: "idea",
    },
    result: {
      ownerAfter: "orchestrator",
      stageAfter: "plan",
      effectiveAutoMode: "aggressive",
      recommendedActions: [
        {
          kind: "drive_stage",
          owner: "orchestrator",
          stage: "plan",
          summary: "Run the plan stage and write the canonical planning packets.",
          command: "/plan-research",
          mailboxMessageId: null,
          cooldownRemainingSeconds: 0,
          blocking: false,
        },
      ],
    },
    waitTimeoutMs: 5000,
    retryOnTimeout: true,
    enableSpawnFallback: true,
  });

  assert.equal(result.dispatched, false);
  assert.equal(result.queuedFallback, true);
  assert.match(result.error ?? "", /workflow execution runtime is unavailable/i);
  assert.equal(result.ownerRuntimeStatus.status, "queued");
  assert.equal(result.ownerRuntimeStatus.queueKey, result.queueKey);
  assert.equal(result.ownerRuntimeStatus.runtimeState, "queued");
  assert.notEqual(
    result.ownerRuntimeStatus.reason,
    "owner_runtime_dispatch_unavailable"
  );

  const queue = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(queue.entries.length, 1);
  assert.equal(queue.entries[0].entryType, "dispatch_task");
  assert.equal(queue.entries[0].ownerAgent, "orchestrator");
  assert.equal(queue.entries[0].status, "queued");
  assert.equal(queue.entries[0].dispatchPayload?.toRole, "orchestrator");
  assert.equal(queue.entries[0].dispatchPayload?.fromRole, "researcher");
  assert.equal(queue.entries[0].dispatchPayload?.command, "/plan-research");
  assert.equal(queue.entries[0].dispatchPayload?.autoModeActive, true);
});

test("maybeDispatchAutoIteratorTask does not queue a durable fallback when auto mode is off", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await maybeDispatchAutoIteratorTask({
    plugin: createPlugin(),
    workflowPolicy: {
      enforceWorkflowBoundaries: true,
      autoMode: "off",
      projectsRoot: path.dirname(projectRoot),
    },
    agentCtx: {
      agentId: "researcher",
      sessionKey: "agent:researcher:discord:group:paper-lab",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot,
      projectId: "demo-project",
      currentStage: "idea",
    },
    result: {
      ownerAfter: "orchestrator",
      stageAfter: "plan",
      effectiveAutoMode: "off",
      recommendedActions: [
        {
          kind: "drive_stage",
          owner: "orchestrator",
          stage: "plan",
          summary: "Run the plan stage and write the canonical planning packets.",
          command: "/plan-research",
          mailboxMessageId: null,
          cooldownRemainingSeconds: 0,
          blocking: false,
        },
      ],
    },
    waitTimeoutMs: 5000,
    retryOnTimeout: true,
    enableSpawnFallback: true,
  });

  assert.equal(result.dispatched, false);
  assert.equal(result.queuedFallback ?? false, false);

  const queue = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(queue.entries.length, 0);
});

test("maybeDispatchAutoIteratorTask waits on a fresh orphan owner session instead of redispatching", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const now = new Date().toISOString();
  await writeWorkflowRuntimeSessionsStore({
    projectRoot,
    projectId: "demo-project",
    entries: [
      {
        sessionKey: "agent:researcher:discord:group:paper-lab:subagent:experiment",
        sessionId: "session-active",
        runtime: "subagent",
        role: "researcher",
        agentId: "researcher",
        ownerAgent: "researcher",
        family: "research",
        kind: "workflow_stage_dispatch",
        channelKey: "discord:group:paper-lab",
        requesterSessionKey: "agent:orchestrator:discord:group:paper-lab",
        projectId: "demo-project",
        projectRoot,
        parentSessionKey: "agent:orchestrator:discord:group:paper-lab",
        threadBindingKey: null,
        depth: 1,
        status: "active",
        runId: "run-active",
        queueKey: null,
        startedAt: now,
        lastHeartbeatAt: now,
        lastAnnounceAt: null,
        lastCheckedAt: now,
        lastFinishedAt: null,
        lastError: null,
      },
    ],
  });

  const result = await maybeDispatchAutoIteratorTask({
    plugin: createPlugin(),
    workflowPolicy: {
      enforceWorkflowBoundaries: true,
      autoMode: "aggressive",
      projectsRoot: path.dirname(projectRoot),
      agentContactCooldownSeconds: 300,
    },
    agentCtx: {
      agentId: "orchestrator",
      sessionKey: "agent:orchestrator:discord:group:paper-lab",
      messageChannel: "discord",
    },
    snapshot: {
      role: "orchestrator",
      projectRoot,
      projectId: "demo-project",
      currentStage: "experiment",
    },
    result: {
      ownerAfter: "researcher",
      stageAfter: "experiment",
      effectiveAutoMode: "aggressive",
      recommendedActions: [
        {
          kind: "drive_stage",
          owner: "researcher",
          stage: "experiment",
          summary: "Run one bounded experiment-search pass.",
          command: "/run-experiments",
          mailboxMessageId: null,
          cooldownRemainingSeconds: 0,
          blocking: false,
        },
      ],
    },
  });

  assert.equal(result.dispatched, false);
  assert.equal(result.blockedByRuntimeReconciliation, true);
  assert.equal(result.runtimeDispatchStatus.status, "waiting_for_owner");
  assert.equal(result.ownerRuntimeStatus.status, "active");
  assert.equal(
    result.ownerRuntimeStatus.sessionKey,
    "agent:researcher:discord:group:paper-lab:subagent:experiment"
  );
  const queue = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(queue.entries.length, 0);
});

test("maybeDispatchAutoIteratorTask reclaims a stale orphan owner session before redispatching", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeWorkflowRuntimeSessionsStore({
    projectRoot,
    projectId: "demo-project",
    entries: [
      {
        sessionKey: "agent:researcher:discord:group:paper-lab:subagent:experiment",
        sessionId: "session-stale",
        runtime: "subagent",
        role: "researcher",
        agentId: "researcher",
        ownerAgent: "researcher",
        family: "research",
        kind: "workflow_stage_dispatch",
        channelKey: "discord:group:paper-lab",
        requesterSessionKey: "agent:orchestrator:discord:group:paper-lab",
        projectId: "demo-project",
        projectRoot,
        parentSessionKey: "agent:orchestrator:discord:group:paper-lab",
        threadBindingKey: null,
        depth: 1,
        status: "active",
        runId: "run-stale",
        queueKey: null,
        startedAt: "2026-04-10T12:00:00.000Z",
        lastHeartbeatAt: "2026-04-10T12:00:00.000Z",
        lastAnnounceAt: null,
        lastCheckedAt: "2026-04-10T12:00:00.000Z",
        lastFinishedAt: null,
        lastError: null,
      },
    ],
  });

  const result = await maybeDispatchAutoIteratorTask({
    plugin: createPlugin(),
    workflowPolicy: {
      enforceWorkflowBoundaries: true,
      autoMode: "aggressive",
      projectsRoot: path.dirname(projectRoot),
      agentContactCooldownSeconds: 60,
    },
    agentCtx: {
      agentId: "orchestrator",
      sessionKey: "agent:orchestrator:discord:group:paper-lab",
      messageChannel: "discord",
    },
    snapshot: {
      role: "orchestrator",
      projectRoot,
      projectId: "demo-project",
      currentStage: "experiment",
    },
    result: {
      ownerAfter: "researcher",
      stageAfter: "experiment",
      effectiveAutoMode: "aggressive",
      recommendedActions: [
        {
          kind: "drive_stage",
          owner: "researcher",
          stage: "experiment",
          summary: "Run one bounded experiment-search pass.",
          command: "/run-experiments",
          mailboxMessageId: null,
          cooldownRemainingSeconds: 0,
          blocking: false,
        },
      ],
    },
  });

  assert.equal(result.queuedFallback, true);
  assert.equal(result.runtimeDispatchStatus.status, "stale_reclaimed");
  assert.equal(result.dispatchTerminality.ok, true);

  const sessions = await readWorkflowRuntimeSessionsStore(projectRoot);
  assert.equal(sessions.entries[0].status, "needs_repair");
  const queue = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(queue.entries.length, 1);
  assert.equal(queue.entries[0].ownerAgent, "researcher");
});

test("maybeDispatchAutoIteratorTask queues same-owner repair dispatch when auto iterator marks it executable", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await maybeDispatchAutoIteratorTask({
    plugin: createPlugin(),
    workflowPolicy: {
      enforceWorkflowBoundaries: true,
      autoMode: "aggressive",
      projectsRoot: path.dirname(projectRoot),
    },
    agentCtx: {
      agentId: "academic_writer",
      sessionKey: "agent:academic_writer:discord:group:paper-lab",
      messageChannel: "discord",
    },
    snapshot: {
      role: "academic_writer",
      projectRoot,
      projectId: "demo-project",
      currentStage: "write",
    },
    result: {
      ownerAfter: "academic_writer",
      stageAfter: "write",
      effectiveAutoMode: "aggressive",
      nextAction: "Repair citation coverage and paper story support.",
      recommendedActions: [
        {
          kind: "drive_stage",
          owner: "academic_writer",
          stage: "write",
          summary: "Repair citation coverage and paper story support.",
          command: "Repair citation coverage and paper story support.",
          mailboxMessageId: null,
          cooldownRemainingSeconds: 0,
          blocking: false,
          dispatchDespiteMissingSignals: true,
        },
      ],
    },
    waitTimeoutMs: 5000,
    retryOnTimeout: false,
    enableSpawnFallback: true,
  });

  assert.equal(result.dispatched, false);
  assert.equal(result.sameOwnerRepairDispatch, true);
  assert.equal(result.queuedFallback, true);
  assert.equal(result.ownerRuntimeStatus.status, "queued");
  assert.equal(result.ownerRuntimeStatus.queueKey, result.queueKey);
  assert.equal(result.ownerRuntimeStatus.runtimeState, "queued");
  assert.notEqual(
    result.ownerRuntimeStatus.reason,
    "owner_runtime_dispatch_unavailable"
  );

  const queue = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(queue.entries.length, 1);
  assert.equal(queue.entries[0].entryType, "dispatch_task");
  assert.equal(queue.entries[0].ownerAgent, "academic_writer");
  assert.equal(queue.entries[0].dispatchPayload?.fromRole, "academic_writer");
  assert.equal(queue.entries[0].dispatchPayload?.toRole, "academic_writer");
  assert.equal(queue.entries[0].dispatchPayload?.useWorkflowHandoff, false);
  assert.equal(queue.entries[0].dispatchPayload?.requireMailboxAcknowledgement, false);
});

test("maybeDispatchAutoIteratorTask ignores ordinary same-owner ticks", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await maybeDispatchAutoIteratorTask({
    plugin: createPlugin(),
    workflowPolicy: {
      enforceWorkflowBoundaries: true,
      autoMode: "aggressive",
      projectsRoot: path.dirname(projectRoot),
    },
    agentCtx: {
      agentId: "academic_writer",
      sessionKey: "agent:academic_writer:discord:group:paper-lab",
      messageChannel: "discord",
    },
    snapshot: {
      role: "academic_writer",
      projectRoot,
      projectId: "demo-project",
      currentStage: "write",
    },
    result: {
      ownerAfter: "academic_writer",
      stageAfter: "write",
      effectiveAutoMode: "aggressive",
      recommendedActions: [
        {
          kind: "drive_stage",
          owner: "academic_writer",
          stage: "write",
          summary: "Continue ordinary writing.",
          command: "/write-paper",
          mailboxMessageId: null,
          cooldownRemainingSeconds: 0,
          blocking: false,
        },
      ],
    },
  });

  assert.equal(result, null);
  const queue = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(queue.entries.length, 0);
});

test("maybeDispatchAutoIteratorTask claims the next matching task when dispatch succeeds", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await materializeWorkflowTaskGraph({
    projectRoot,
    projectId: "demo-project",
    stage: "plan",
    topTierVerdict: "worth_top_tier_bet",
    evidenceCloseout: {
      status: "blocked",
      topTierVerdict: "worth_top_tier_bet",
      blockers: ["benchmark protocol missing"],
      experimentAnalyzeReady: false,
      analyzeReviewReady: true,
      writeReady: false,
      submitReady: false,
      graphDependentBlockerCount: 0,
      localEvidenceBlockerCount: 1,
    },
    previewTasks: [
      {
        taskId: "plan.write_canonical_packets",
        title: "Write the canonical planning packets",
        owner: "orchestrator",
        status: "blocked",
        reason: "Plan packets are still missing.",
      },
    ],
  });

  const plugin = createPluginRegistrationContext({
    runtime: {
      subagent: {
        async run() {
          await acknowledgePendingWorkflowMailboxes([projectRoot]);
          return { runId: "tool-run-1" };
        },
      },
    },
    logger: {},
    registerTool() {},
  });

  const result = await maybeDispatchAutoIteratorTask({
    plugin,
    workflowPolicy: {
      enforceWorkflowBoundaries: true,
      autoMode: "aggressive",
      projectsRoot: path.dirname(projectRoot),
    },
    agentCtx: {
      agentId: "researcher",
      sessionKey: "agent:researcher:discord:group:paper-lab",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot,
      projectId: "demo-project",
      currentStage: "idea",
    },
    result: {
      ownerAfter: "orchestrator",
      stageAfter: "plan",
      effectiveAutoMode: "aggressive",
      recommendedActions: [
        {
          kind: "drive_stage",
          owner: "orchestrator",
          stage: "plan",
          summary: "Run the plan stage and write the canonical planning packets.",
          command: "/plan-research",
          mailboxMessageId: null,
          cooldownRemainingSeconds: 0,
          blocking: false,
        },
      ],
    },
    waitTimeoutMs: 5000,
    retryOnTimeout: true,
    enableSpawnFallback: true,
  });

  assert.equal(result?.dispatched, true);
  assert.ok(["active", "started"].includes(result.ownerRuntimeStatus.status));
  assert.equal(
    result.ownerRuntimeStatus.sessionKey,
    "agent:orchestrator:discord:group:paper-lab"
  );
  assert.notEqual(
    result.ownerRuntimeStatus.reason,
    "owner_runtime_dispatch_unavailable"
  );
  const store = await readWorkflowTaskGraphStore(projectRoot);
  assert.equal(store?.tasks[0].status, "claimed");
  assert.equal(store?.tasks[0].lease?.sessionKey, "agent:orchestrator:discord:group:paper-lab");
});
