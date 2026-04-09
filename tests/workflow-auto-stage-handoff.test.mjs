import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPluginRegistrationContext } from "../tools/plugin-registration-shared.ts";
import { maybeDispatchAutoIteratorTask } from "../tools/register-workflow-tools.ts";
import { readWorkflowRuntimeQueueStore } from "../tools/workflow-runtime-state.ts";

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
