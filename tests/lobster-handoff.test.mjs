import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  classifyWorkflowLobsterFailureReason,
  DEFAULT_WORKFLOW_LOBSTER_HANDOFF_CONFIG,
  handoffWorkflowTaskToAgent,
  inspectWorkflowLobsterReadiness,
  normalizeWorkflowLobsterHandoffConfig,
  shouldUseLobsterForWorkflowHandoff,
} from "../tools/lobster-handoff.ts";
import { readWorkflowRuntimeIncidentsStore } from "../tools/workflow-runtime-incidents.ts";

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
    acknowledgedByMailbox: false,
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
  assert.equal(result.fallbackReason, "lobster_config_disabled");
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
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-lobster-fallback-")
  );

  try {
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
        projectRoot,
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

    const incidents = await readWorkflowRuntimeIncidentsStore(projectRoot, "demo");
    assert.equal(
      incidents.entries.some((entry) => entry.kind === "lobster_fallback"),
      true
    );
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("inspectWorkflowLobsterReadiness reports config-disabled and auto-mode-inactive states", async () => {
  const disabled = await inspectWorkflowLobsterReadiness({
    config: {
      ...DEFAULT_WORKFLOW_LOBSTER_HANDOFF_CONFIG,
      enabled: false,
    },
    autoModeActive: true,
  });
  assert.equal(disabled.status, "config_disabled");

  const autoModeInactive = await inspectWorkflowLobsterReadiness({
    config: {
      ...DEFAULT_WORKFLOW_LOBSTER_HANDOFF_CONFIG,
      enabled: true,
      autoModeOnly: true,
    },
    autoModeActive: false,
  });
  assert.equal(autoModeInactive.status, "auto_mode_inactive");
});

test("classifyWorkflowLobsterFailureReason preserves concrete root causes", () => {
  assert.equal(
    classifyWorkflowLobsterFailureReason("Tool not available: lobster"),
    "lobster_plugin_not_loaded"
  );
  assert.equal(
    classifyWorkflowLobsterFailureReason("spawn lobster ENOENT"),
    "lobster_binary_missing"
  );
  assert.equal(
    classifyWorkflowLobsterFailureReason("tool execution failed"),
    "lobster_tool_error"
  );
  assert.equal(
    classifyWorkflowLobsterFailureReason("OpenClaw tools invoke timed out after 30000ms"),
    "lobster_gateway_timeout"
  );
});
