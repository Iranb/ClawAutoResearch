import test from "node:test";
import assert from "node:assert/strict";

import { buildGatewayRuntimeMessage } from "../scripts/gateway_runtime_subagent.mjs";

test("gateway runtime message carries project context and continuation instructions", () => {
  const message = buildGatewayRuntimeMessage({
    sessionKey: "agent:researcher:local:conversation:e2e",
    message: '/research-pipeline "GCD"',
    extraSystemPrompt: "BACKGROUND_WORKFLOW_CONTINUATION=1",
    projectRoot: "/tmp/openclaw-e2e/projects/gcd",
    projectId: "gcd",
    workspaceDir: "/tmp/openclaw-e2e/projects/gcd",
    ownerAgent: "researcher",
    requesterSessionKey: "agent:researcher:local:conversation:e2e",
    messageChannel: "local",
  });

  assert.match(message, /Project root: \/tmp\/openclaw-e2e\/projects\/gcd/);
  assert.match(message, /Project ID: gcd/);
  assert.match(message, /research_workflow\.bind_channel_project/);
  assert.match(message, /Do not create or use a sibling\/default project directory/);
  assert.match(message, /BACKGROUND_WORKFLOW_CONTINUATION=1/);
  assert.match(message, /Task:\n\/research-pipeline "GCD"/);
});

test("gateway runtime message preserves a plain task when no runtime context is supplied", () => {
  assert.equal(buildGatewayRuntimeMessage({ message: "/graph-build" }), "/graph-build");
});
