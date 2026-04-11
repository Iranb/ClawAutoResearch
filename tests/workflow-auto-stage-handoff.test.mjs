import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPluginRegistrationContext } from "../tools/plugin-registration-shared.ts";
import { maybeDispatchAutoIteratorTask } from "../tools/register-workflow-tools.ts";
import { readWorkflowRuntimeQueueStore } from "../tools/workflow-runtime-state.ts";
import { materializeWorkflowTaskGraph, readWorkflowTaskGraphStore } from "../tools/workflow-team/task-graph.ts";

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
  assert.match(result.error ?? "", /runtime subagent api is unavailable/i);

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
  const store = await readWorkflowTaskGraphStore(projectRoot);
  assert.equal(store?.tasks[0].status, "claimed");
  assert.equal(store?.tasks[0].lease?.sessionKey, "agent:orchestrator:discord:group:paper-lab");
});
