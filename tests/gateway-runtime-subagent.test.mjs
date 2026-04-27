import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildGatewayRuntimeMessage,
  healthUrlsForGateway,
  inspectGatewayAgentSessionFromStore,
  isGatewayConnectHandshakeFailure,
  isGatewayProviderCapacityFailure,
  isGatewayTransientAgentWaitFailure,
  reconcileGatewayWaitResultWithSessionInspection,
} from "../scripts/gateway_runtime_subagent.mjs";

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

test("gateway runtime message keeps non-Researcher agents from rebinding local project context", () => {
  const message = buildGatewayRuntimeMessage({
    sessionKey: "agent:orchestrator:local:conversation:e2e",
    message: "/plan-research",
    projectRoot: "/tmp/openclaw-e2e/projects/gcd",
    projectId: "gcd",
    workspaceDir: "/tmp/openclaw-e2e/projects/gcd",
    ownerAgent: "orchestrator",
    requesterSessionKey: "agent:researcher:local:conversation:e2e",
    messageChannel: "local",
  });

  assert.match(message, /treat Project root and Project ID above as resolved context/);
  assert.match(message, /get_channel_project_binding/);
  assert.doesNotMatch(message, /bind_channel_project with projectRoot/);
  assert.match(message, /Task:\n\/plan-research/);
});

test("gateway runtime message preserves a plain task when no runtime context is supplied", () => {
  assert.equal(buildGatewayRuntimeMessage({ message: "/graph-build" }), "/graph-build");
});

test("gateway runtime treats agent.wait socket loss as a transient wait failure", () => {
  assert.equal(
    isGatewayTransientAgentWaitFailure(
      new Error("socket closed while waiting for agent.wait response: 1006")
    ),
    true
  );
  assert.equal(
    isGatewayTransientAgentWaitFailure(
      new Error("timeout waiting for agent.wait response")
    ),
    true
  );
  assert.equal(
    isGatewayTransientAgentWaitFailure(new Error("chat.send failed")),
    false
  );
});

test("gateway runtime treats connect handshake timeouts as retryable startup failures", () => {
  assert.equal(
    isGatewayConnectHandshakeFailure(new Error("timeout waiting for connect response")),
    true
  );
  assert.equal(
    isGatewayConnectHandshakeFailure(
      new Error("socket closed while waiting for connect.challenge: 1006")
    ),
    true
  );
  assert.equal(
    isGatewayConnectHandshakeFailure(new Error("timeout waiting for chat.send response")),
    false
  );
});

test("gateway runtime probes both legacy and current gateway health paths", () => {
  assert.deepEqual(healthUrlsForGateway("ws://127.0.0.1:58408"), [
    "http://127.0.0.1:58408/health",
    "http://127.0.0.1:58408/healthz",
  ]);
  assert.deepEqual(healthUrlsForGateway("not a url"), []);
});

test("gateway runtime identifies provider quota and rate-limit failures", () => {
  assert.equal(
    isGatewayProviderCapacityFailure(
      new Error("429 usage allocated quota exceeded. please try again later.")
    ),
    true
  );
  assert.equal(
    isGatewayProviderCapacityFailure({ error: "rate_limit from bailian/qwen3.6-plus" }),
    true
  );
  assert.equal(
    isGatewayProviderCapacityFailure(new Error("timeout waiting for connect response")),
    false
  );
});

test("gateway runtime inspects local agent session failures case-insensitively", async (t) => {
  const openclawHome = await fs.mkdtemp(
    path.join(os.tmpdir(), "gateway-runtime-session-store-")
  );
  t.after(async () => {
    await fs.rm(openclawHome, { recursive: true, force: true });
  });
  const sessionsDir = path.join(openclawHome, "agents", "researcher", "sessions");
  await fs.mkdir(sessionsDir, { recursive: true });
  const sessionFile = path.join(sessionsDir, "session-1.jsonl");
  await fs.writeFile(
    sessionFile,
    `${JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: "Connection error.",
      },
    })}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(sessionsDir, "sessions.json"),
    `${JSON.stringify(
      {
        "agent:researcher:local:conversation:e2e-test:subagent:bg": {
          sessionId: "session-1",
          sessionFile,
          status: "failed",
          startedAt: 100,
          endedAt: 200,
          updatedAt: 300,
          abortedLastRun: false,
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const inspection = await inspectGatewayAgentSessionFromStore({
    openclawHome,
    sessionKey: "agent:researcher:local:conversation:E2E-TEST:subagent:bg",
  });

  assert.equal(inspection?.sessionId, "session-1");
  assert.equal(inspection?.status, "failed");
  assert.equal(inspection?.error, "Connection error.");
  assert.equal(inspection?.lastError, "Connection error.");
  assert.equal(
    reconcileGatewayWaitResultWithSessionInspection(
      { status: "ok", error: null },
      inspection
    ).status,
    "error"
  );
});

test("gateway runtime infers failed status from ended session transcript errors", async (t) => {
  const openclawHome = await fs.mkdtemp(
    path.join(os.tmpdir(), "gateway-runtime-ended-error-")
  );
  t.after(async () => {
    await fs.rm(openclawHome, { recursive: true, force: true });
  });
  const sessionsDir = path.join(openclawHome, "agents", "researcher", "sessions");
  await fs.mkdir(sessionsDir, { recursive: true });
  const sessionFile = path.join(sessionsDir, "session-2.jsonl");
  await fs.writeFile(
    sessionFile,
    `${JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: "429 usage allocated quota exceeded. please try again later.",
      },
    })}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(sessionsDir, "sessions.json"),
    `${JSON.stringify(
      {
        "agent:researcher:local:conversation:e2e-test:subagent:bg": {
          sessionId: "session-2",
          sessionFile,
          startedAt: 100,
          endedAt: 200,
          updatedAt: 300,
          abortedLastRun: false,
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const inspection = await inspectGatewayAgentSessionFromStore({
    openclawHome,
    sessionKey: "agent:researcher:local:conversation:e2e-test:subagent:bg",
  });

  assert.equal(inspection?.status, "failed");
  assert.equal(
    inspection?.lastError,
    "429 usage allocated quota exceeded. please try again later."
  );
  assert.deepEqual(
    reconcileGatewayWaitResultWithSessionInspection(
      { status: "timeout", error: null },
      inspection
    ),
    {
      status: "error",
      error: "429 usage allocated quota exceeded. please try again later.",
    }
  );
});
