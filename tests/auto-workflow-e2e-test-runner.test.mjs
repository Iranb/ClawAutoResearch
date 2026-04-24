import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import {
  configuredProjectsRootFromOpenClawConfig,
  configuredModelRefsForAgent,
  normalizeAutoWorkflowCommand,
  normalizeAutoWorkflowMode,
  shouldEnableAgentModelSyncWatchdog,
  shouldRestartGatewayAfterAgentModelSync,
  verifyAgentRuntimeModelConfig,
} from "../scripts/run_auto_workflow_e2e_test.mjs";

const execFile = promisify(execFileCb);

test("auto workflow E2E runner normalizes user-facing command aliases", () => {
  assert.deepEqual(normalizeAutoWorkflowCommand("/autoresearch"), {
    requestedCommand: "/autoresearch",
    canonicalCommand: "auto-research",
    displayCommand: "/auto-research",
    lane: "experiment",
  });
  assert.deepEqual(normalizeAutoWorkflowCommand("autoreview"), {
    requestedCommand: "autoreview",
    canonicalCommand: "auto-review",
    displayCommand: "/auto-review",
    lane: "survey",
  });
  assert.equal(normalizeAutoWorkflowCommand("full").lane, "full");
  assert.equal(normalizeAutoWorkflowMode("real"), "live");
  assert.equal(normalizeAutoWorkflowMode("deterministic"), "fixture");
  assert.equal(
    configuredProjectsRootFromOpenClawConfig({
      plugins: {
        entries: {
          ClawAutoResearch: {
            config: {
              projectsRoot: "/tmp/openclaw-projects",
            },
          },
        },
      },
    }),
    "/tmp/openclaw-projects"
  );
});

test("auto workflow E2E runner validates exact runtime model provider state", () => {
  const config = {
    models: {
      providers: {
        bailian: {
          models: [{ id: "qwen3.6-plus" }],
        },
      },
    },
    agents: {
      defaults: {
        model: {
          primary: "bailian/qwen3.6-plus",
        },
      },
      list: [{ id: "researcher" }],
    },
  };

  assert.deepEqual(configuredModelRefsForAgent(config, "researcher"), [
    "bailian/qwen3.6-plus",
  ]);

  assert.equal(
    verifyAgentRuntimeModelConfig({
      config,
      agentId: "researcher",
      agentDir: "/tmp/agent",
      modelsCatalog: {
        providers: {
          bailian: {
            apiKey: "test-key",
            models: [{ id: "qwen3.6-plus" }],
          },
        },
      },
      authProfile: null,
      acceptedAuthProviders: [],
    }).ok,
    true
  );

  const missing = verifyAgentRuntimeModelConfig({
    config,
    agentId: "researcher",
    agentDir: "/tmp/agent",
    modelsCatalog: {
      providers: {
        bailian: {
          apiKey: "test-key",
          models: [{ id: "qwen3.5-plus" }],
        },
      },
    },
    authProfile: {
      providers: {
        openai: {},
      },
    },
    acceptedAuthProviders: [],
  });
  assert.equal(missing.ok, false);
  assert.match(missing.detail, /missing_models=bailian\/qwen3\.6-plus/);
});

test("auto workflow E2E runner restarts live gateway after model catalog repair", () => {
  assert.equal(
    shouldRestartGatewayAfterAgentModelSync({
      mode: "live",
      isolatedGateway: false,
      skipAgentModelSync: false,
      skipGatewayRestartAfterAgentSync: false,
      repairedCount: 1,
    }),
    true
  );
  assert.equal(
    shouldRestartGatewayAfterAgentModelSync({
      mode: "live",
      isolatedGateway: true,
      skipAgentModelSync: false,
      skipGatewayRestartAfterAgentSync: false,
      repairedCount: 1,
    }),
    false
  );
  assert.equal(
    shouldRestartGatewayAfterAgentModelSync({
      mode: "live",
      isolatedGateway: false,
      skipAgentModelSync: false,
      skipGatewayRestartAfterAgentSync: false,
      repairedCount: 0,
    }),
    false
  );
});

test("auto workflow E2E runner enables live agent model watchdog only for shared gateway runs", () => {
  assert.equal(
    shouldEnableAgentModelSyncWatchdog({
      mode: "live",
      isolatedGateway: false,
      skipAgentModelSync: false,
      noPreflight: false,
      intervalMs: 1000,
      agentIds: ["researcher"],
    }),
    true
  );
  assert.equal(
    shouldEnableAgentModelSyncWatchdog({
      mode: "live",
      isolatedGateway: true,
      skipAgentModelSync: false,
      noPreflight: false,
      intervalMs: 1000,
      agentIds: ["researcher"],
    }),
    false
  );
  assert.equal(
    shouldEnableAgentModelSyncWatchdog({
      mode: "fixture",
      isolatedGateway: false,
      skipAgentModelSync: false,
      noPreflight: false,
      intervalMs: 1000,
      agentIds: ["researcher"],
    }),
    false
  );
});

test("auto workflow E2E runner creates a durable local summary for /autoresearch", async (t) => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-auto-workflow-runner-"));
  t.after(() => fs.rm(runRoot, { recursive: true, force: true }));

  const { stdout } = await execFile(
    process.execPath,
    [
      path.join(process.cwd(), "scripts", "run_auto_workflow_e2e_test.mjs"),
      "--command",
      "/autoresearch",
      "--topic",
      "Generalized Category Discovery",
      "--project-id",
      "gcd-explicit-e2e",
      "--mode",
      "fixture",
      "--bootstrap-transport",
      "local",
      "--run-root",
      runRoot,
      "--json",
    ],
    { maxBuffer: 20 * 1024 * 1024 }
  );
  const payload = JSON.parse(stdout);

  assert.equal(payload.status, "pass");
  assert.equal(payload.command.canonicalCommand, "auto-research");
  assert.equal(payload.command.lane, "experiment");
  assert.equal(payload.mode, "fixture");
  assert.equal(payload.bootstrapTransport, "local");
  assert.equal(payload.projectId, "gcd-explicit-e2e");
  assert.match(payload.conversationId, /^e2e-/);
  assert.equal(payload.result.conversationId, payload.conversationId);
  assert.equal(payload.result.lanes.length, 1);
  assert.equal(payload.result.lanes[0].lane, "experiment");
  assert.equal(payload.result.lanes[0].conversationId, payload.conversationId);
  assert.equal(payload.result.lanes[0].finalVerdict, "pass");
  assert.match(payload.result.lanes[0].projectRoot, /gcd-explicit-e2e$/);

  await fs.access(payload.summaryPath);
  await fs.access(payload.markdownSummaryPath);
  await fs.access(payload.stdoutPath);
  await fs.access(payload.stderrPath);
  await fs.access(payload.payloadPath);
  await fs.access(path.join(payload.result.lanes[0].projectRoot, ".openclaw-research", "E2E_RUN_REPORT.md"));
});
