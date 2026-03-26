import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_WORKFLOW_LOBSTER_HANDOFF_CONFIG,
  handoffWorkflowTaskToAgent,
  normalizeWorkflowLobsterHandoffConfig,
  shouldUseLobsterForWorkflowHandoff,
} from "../tools/lobster-handoff.ts";

function buildDispatchResult(overrides = {}) {
  return {
    dispatched: true,
    sessionKey: "agent:coder:discord:group:paper-lab",
    runId: "run-1",
    waitStatus: "ok",
    channel: "sessions_send",
    strategy: "direct_session",
    attempts: [],
    fallbackSpawned: false,
    error: null,
    ...overrides,
  };
}

test("normalizeWorkflowLobsterHandoffConfig returns stable defaults", () => {
  const config = normalizeWorkflowLobsterHandoffConfig(undefined);

  assert.deepEqual(config, DEFAULT_WORKFLOW_LOBSTER_HANDOFF_CONFIG);
});

test("shouldUseLobsterForWorkflowHandoff respects autoModeOnly", () => {
  assert.equal(
    shouldUseLobsterForWorkflowHandoff({
      config: {
        ...DEFAULT_WORKFLOW_LOBSTER_HANDOFF_CONFIG,
        enabled: true,
        autoModeOnly: true,
      },
      autoModeActive: false,
    }),
    false
  );

  assert.equal(
    shouldUseLobsterForWorkflowHandoff({
      config: {
        ...DEFAULT_WORKFLOW_LOBSTER_HANDOFF_CONFIG,
        enabled: true,
        autoModeOnly: false,
      },
      autoModeActive: false,
    }),
    true
  );
});

test("handoffWorkflowTaskToAgent keeps native dispatch when Lobster is disabled", async () => {
  const calls = [];

  const result = await handoffWorkflowTaskToAgent(
    {
      workflowPolicy: {
        lobsterHandoff: {
          ...DEFAULT_WORKFLOW_LOBSTER_HANDOFF_CONFIG,
          enabled: false,
        },
      },
      requesterSessionKey: "agent:researcher:discord:group:paper-lab",
      requesterChannel: "discord",
      fromRole: "researcher",
      toRole: "coder",
      projectRoot: "/tmp/projects/demo",
      projectId: "demo",
      stage: "code",
      summary: "Implement the approved experiment bundle.",
      command: "/implement-experiment",
      autoModeActive: true,
    },
    {
      nativeDispatch: async (params) => {
        calls.push(params);
        return buildDispatchResult();
      },
      invokeLobsterDispatch: async () => {
        throw new Error("should not run lobster");
      },
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(result.backend, "native");
  assert.equal(result.fallbackReason, null);
});

test("handoffWorkflowTaskToAgent uses Lobster when enabled for auto mode", async () => {
  const result = await handoffWorkflowTaskToAgent(
    {
      workflowPolicy: {
        lobsterHandoff: {
          ...DEFAULT_WORKFLOW_LOBSTER_HANDOFF_CONFIG,
          enabled: true,
        },
      },
      requesterSessionKey: "agent:researcher:discord:group:paper-lab",
      requesterChannel: "discord",
      fromRole: "researcher",
      toRole: "coder",
      projectRoot: "/tmp/projects/demo",
      projectId: "demo",
      stage: "code",
      summary: "Implement the approved experiment bundle.",
      command: "/implement-experiment",
      autoModeActive: true,
    },
    {
      nativeDispatch: async () => {
        throw new Error("should not fall back");
      },
      invokeLobsterDispatch: async () => ({
        envelope: {
          ok: true,
          status: "ok",
          output: [{ dispatchResult: buildDispatchResult({ runId: "lobster-run-1" }) }],
        },
        dispatch: buildDispatchResult({ runId: "lobster-run-1" }),
      }),
    }
  );

  assert.equal(result.backend, "lobster");
  assert.equal(result.runId, "lobster-run-1");
  assert.equal(result.fallbackReason, null);
});

test("handoffWorkflowTaskToAgent falls back to native when Lobster fails", async () => {
  const nativeCalls = [];

  const result = await handoffWorkflowTaskToAgent(
    {
      workflowPolicy: {
        lobsterHandoff: {
          ...DEFAULT_WORKFLOW_LOBSTER_HANDOFF_CONFIG,
          enabled: true,
          fallbackToNative: true,
        },
      },
      requesterSessionKey: "agent:researcher:discord:group:paper-lab",
      requesterChannel: "discord",
      fromRole: "researcher",
      toRole: "coder",
      projectRoot: "/tmp/projects/demo",
      projectId: "demo",
      stage: "code",
      summary: "Implement the approved experiment bundle.",
      command: "/implement-experiment",
      autoModeActive: true,
    },
    {
      nativeDispatch: async (params) => {
        nativeCalls.push(params);
        return buildDispatchResult({ runId: "native-run-2" });
      },
      invokeLobsterDispatch: async () => {
        throw new Error("tool lobster is not allowed");
      },
    }
  );

  assert.equal(nativeCalls.length, 1);
  assert.equal(result.backend, "native");
  assert.match(result.fallbackReason, /tool lobster is not allowed/i);
  assert.equal(result.runId, "native-run-2");
});
