import test from "node:test";
import assert from "node:assert/strict";

import { acquireBackgroundWorkflowSession } from "../../../tools/workflow-execution/background-pool";
import {
  buildWorkflowDispatchPlan,
} from "../../../tools/workflow-execution/dispatch-plan";
import { resolveWorkflowDeliveryAdapter } from "../../../tools/workflow-execution/delivery-adapter";

test("workflow execution kernel builds a stable dispatch plan from runtime payloads", () => {
  assert.deepEqual(
    buildWorkflowDispatchPlan({
      requesterChannel: "discord",
      requesterAccountId: null,
      preferredSessionKeys: ["agent:coder:discord:group:paper-lab"],
      fromRole: "researcher",
      toRole: "coder",
      projectRoot: "/tmp/project",
      projectId: "demo-project",
      stage: "code",
      summary: "Implement the experiment bundle.",
      command: "/code",
      mailboxMessageId: null,
      requireMailboxAcknowledgement: true,
      extraBody: null,
      waitTimeoutMs: 5000,
      retryOnTimeout: true,
      enableSpawnFallback: true,
      useWorkflowHandoff: true,
      autoModeActive: true,
    }),
    {
      toRole: "coder",
      summary: "Implement the experiment bundle.",
      command: "/code",
      stage: "code",
      useWorkflowHandoff: true,
      autoModeActive: true,
    }
  );
});

test("workflow execution kernel resolves Lobster only when the config enables it", () => {
  assert.deepEqual(
    resolveWorkflowDeliveryAdapter({
      toRole: "reviewer",
      workflowPolicy: {
        lobsterHandoff: {
          enabled: true,
          autoModeOnly: true,
          gatewayUrl: "http://127.0.0.1:7777",
          pipelinePath: "lobster/workflows/workflow-agent-dispatch.lobster",
          timeoutMs: 10_000,
          maxStdoutBytes: 32_768,
          fallbackToNative: true,
        },
      },
      autoModeActive: true,
    }),
    {
      adapter: "lobster",
      shouldUseLobster: true,
    }
  );
});

test("workflow execution kernel background pool is role-aware for non-researcher owners", async () => {
  const lease = await acquireBackgroundWorkflowSession({
    ownerAgent: "coder",
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    channelKey: "discord:group:paper-lab",
    preferredSessionKey: "agent:coder:discord:group:paper-lab",
    family: "research",
    kind: "workflow_stage_dispatch",
    projectId: "demo-project",
    projectRoot: "/tmp/project",
  });
  assert.equal(lease.acquired, true);
  assert.equal(lease.sessionKey, "agent:coder:discord:group:paper-lab");
  assert.equal(lease.ownerAgent, "coder");
});
