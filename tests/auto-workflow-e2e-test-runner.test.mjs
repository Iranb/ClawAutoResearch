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
  deriveAutoWorkflowChildMaxIterations,
  defaultProjectIdForAutoWorkflowRun,
  normalizeAutoWorkflowCommand,
  normalizeAutoWorkflowMode,
  resolveAutoWorkflowLocalFallbackEnv,
  shouldEnableAgentModelSyncWatchdog,
  shouldRestartGatewayAfterAgentModelSync,
  verifyAgentRuntimeModelConfig,
} from "../scripts/run_auto_workflow_e2e_test.mjs";
import {
  buildLiveHandoffWorkflowTaskParams,
  buildLiveAutoIteratorParams,
  deriveStageCommand,
  readLiveWorkflowActivation,
} from "../scripts/auto_command_live_orchestrator.mjs";

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

test("auto workflow E2E runner generates isolated live project ids by default", () => {
  assert.equal(
    defaultProjectIdForAutoWorkflowRun({
      command: normalizeAutoWorkflowCommand("/autoresearch"),
      topic: "Generalized Category Discovery",
      timestamp: "2026-04-24T09:34:12Z",
    }),
    "research-2026-04-24t09-34-12z-generalize"
  );
  assert.equal(
    defaultProjectIdForAutoWorkflowRun({
      command: normalizeAutoWorkflowCommand("/autoreview"),
      topic: "Generalized Category Discovery",
      timestamp: "2026-04-24T09:34:12Z",
    }),
    "survey-2026-04-24t09-34-12z-generalized"
  );
});

test("auto workflow E2E runner derives live iteration budget from timeout", () => {
  assert.equal(
    deriveAutoWorkflowChildMaxIterations({
      mode: "live",
      timeoutMs: 15 * 60_000,
      maxIterations: null,
    }),
    30
  );
  assert.equal(
    deriveAutoWorkflowChildMaxIterations({
      mode: "live",
      timeoutMs: 45 * 60_000,
      maxIterations: null,
    }),
    90
  );
  assert.equal(
    deriveAutoWorkflowChildMaxIterations({
      mode: "live",
      timeoutMs: 45 * 60_000,
      maxIterations: 7,
    }),
    7
  );
  assert.equal(
    deriveAutoWorkflowChildMaxIterations({
      mode: "fixture",
      timeoutMs: 15 * 60_000,
      maxIterations: null,
    }),
    null
  );
});

test("auto workflow E2E runner injects short local fallback timeouts for no-Discord live runs", () => {
  const resolved = resolveAutoWorkflowLocalFallbackEnv(
    {
      mode: "live",
      bootstrapTransport: "local",
    },
    {}
  );

  assert.deepEqual(resolved.envOverrides, {
    OPENCLAW_CODE_REVIEW_LOCAL_FALLBACK_AFTER_MS: "30000",
    OPENCLAW_AUTO_MODE_DISCUSSION_LOCAL_FALLBACK_AFTER_MS: "30000",
  });
  assert.equal(resolved.summary.codeReviewFallbackAfterMs, 30_000);
  assert.equal(resolved.summary.codeReviewSource, "local_e2e_default");
  assert.equal(resolved.summary.autoModeDiscussionFallbackAfterMs, 30_000);
  assert.equal(resolved.summary.autoModeDiscussionSource, "local_e2e_default");

  const fixture = resolveAutoWorkflowLocalFallbackEnv(
    {
      mode: "fixture",
      bootstrapTransport: "local",
    },
    {}
  );
  assert.deepEqual(fixture.envOverrides, {});
  assert.equal(fixture.summary.codeReviewFallbackAfterMs, null);
  assert.equal(fixture.summary.autoModeDiscussionFallbackAfterMs, null);
});

test("auto workflow E2E runner preserves explicit fallback configuration", () => {
  const fromEnv = resolveAutoWorkflowLocalFallbackEnv(
    {
      mode: "live",
      bootstrapTransport: "local",
    },
    {
      OPENCLAW_CODE_REVIEW_LOCAL_FALLBACK_AFTER_MS: "7000",
      OPENCLAW_AUTO_MODE_DISCUSSION_LOCAL_FALLBACK_AFTER_MS: "9000",
    }
  );
  assert.deepEqual(fromEnv.envOverrides, {});
  assert.equal(fromEnv.summary.codeReviewFallbackAfterMs, 7_000);
  assert.equal(fromEnv.summary.codeReviewSource, "environment");
  assert.equal(fromEnv.summary.autoModeDiscussionFallbackAfterMs, 9_000);
  assert.equal(fromEnv.summary.autoModeDiscussionSource, "environment");

  const fromCli = resolveAutoWorkflowLocalFallbackEnv(
    {
      mode: "live",
      bootstrapTransport: "local",
      workflowLocalFallbackAfterMs: 12_000,
      autoModeDiscussionLocalFallbackAfterMs: 15_000,
    },
    {
      OPENCLAW_CODE_REVIEW_LOCAL_FALLBACK_AFTER_MS: "7000",
      OPENCLAW_AUTO_MODE_DISCUSSION_LOCAL_FALLBACK_AFTER_MS: "9000",
    }
  );
  assert.deepEqual(fromCli.envOverrides, {
    OPENCLAW_CODE_REVIEW_LOCAL_FALLBACK_AFTER_MS: "12000",
    OPENCLAW_AUTO_MODE_DISCUSSION_LOCAL_FALLBACK_AFTER_MS: "15000",
  });
  assert.equal(fromCli.summary.codeReviewSource, "cli");
  assert.equal(fromCli.summary.autoModeDiscussionSource, "cli");
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

test("live E2E harness detects local workflow activation without Discord acknowledgement", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-live-activation-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(projectRoot, ".openclaw-research"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "activation-project",
        current_stage: "idea",
        owner_agent: "researcher",
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await fs.writeFile(
    path.join(projectRoot, ".openclaw-research", "workflow-agent-sessions.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: "2026-04-25T00:00:00.000Z",
        entries: [
          {
            role: "orchestrator",
            sessionKey: "agent:orchestrator:local:e2e",
            sessionId: "workflow.orchestrator.1",
            projectId: "activation-project",
            projectRoot,
            currentStage: "plan",
            status: "active",
            source: "workflow_tool",
            updatedAt: "2026-04-25T00:00:00.000Z",
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  assert.deepEqual(
    await readLiveWorkflowActivation({
      projectRoot,
      projectId: "activation-project",
      stage: "plan",
      owner: "orchestrator",
    }),
    {
      active: true,
      reason: "agent_session_active",
    }
  );
});

test("auto workflow E2E runner merges default model fallbacks into agent-specific model config", () => {
  const config = {
    models: {
      providers: {
        bailian: {
          models: [{ id: "qwen3.5-plus" }, { id: "qwen3.6-plus" }],
        },
      },
    },
    agents: {
      defaults: {
        model: {
          primary: "bailian/qwen3.6-plus",
          fallbacks: ["bailian/qwen3.5-plus"],
        },
      },
      list: [
        {
          id: "researcher",
          model: {
            primary: "bailian/qwen3.6-plus",
            fallbacks: [],
          },
        },
      ],
    },
  };

  assert.deepEqual(configuredModelRefsForAgent(config, "researcher"), [
    "bailian/qwen3.6-plus",
    "bailian/qwen3.5-plus",
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
    false
  );
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

test("live no-Discord orchestrator injects workflow policy into auto iterator", () => {
  const workflowPolicy = {
    autoMode: "aggressive",
    autoGate: {
      enabled: true,
      maxReviewRounds: 4,
      maxMitigationRounds: 3,
    },
  };

  assert.deepEqual(
    buildLiveAutoIteratorParams({
      projectRoot: "/tmp/openclaw-project",
      workflowPolicy,
    }),
    {
      projectRoot: "/tmp/openclaw-project",
      mode: "test",
      queueMailbox: false,
      policy: workflowPolicy,
    }
  );
});

test("live no-Discord orchestrator derives handoff commands from the target stage", () => {
  assert.equal(
    deriveStageCommand({
      lane: "experiment",
      topic: "Generalized Category Discovery",
      manifest: {
        current_stage: "idea",
        next_action: "/idea-phase",
        resume_action: "/idea-phase",
      },
      iterator: {
        stageAfter: "plan",
        nextAction:
          "Run /plan-research using IDEA_REPORT.md and TRACK_REGISTRY.json.",
      },
    }),
    "/plan-research"
  );

  assert.equal(
    deriveStageCommand({
      lane: "experiment",
      topic: "Generalized Category Discovery",
      manifest: {
        current_stage: "plan",
        next_action:
          "Implement the approved experiments as structured bundles.",
        resume_action: "/plan-research",
      },
      iterator: {
        stageAfter: "code",
        nextAction:
          "Implement the approved experiments as structured bundles.",
      },
    }),
    "/implement-experiment"
  );

  assert.equal(
    deriveStageCommand({
      lane: "experiment",
      topic: "Generalized Category Discovery",
      manifest: {
        current_stage: "experiment",
        next_action: "/monitor-experiment",
      },
      iterator: {
        stageAfter: "experiment",
        recommendedActions: [
          {
            kind: "drive_stage",
            stage: "experiment",
            command: "/monitor-experiment",
          },
        ],
      },
    }),
    "/monitor-experiment"
  );
});

test("live no-Discord orchestrator passes the gateway runtime into owner handoffs", () => {
  const runtimeSubagent = {
    async run() {
      return { runId: "run-1" };
    },
  };
  const params = buildLiveHandoffWorkflowTaskParams({
    runtimeSubagent,
    projectRoot: "/tmp/openclaw-live-project",
    projectId: "openclaw-live-project",
    lane: "experiment",
    stage: "plan",
    topic: "Generalized Category Discovery",
    command: "/plan-research",
    fromRole: "researcher",
    owner: "orchestrator",
    fromSessionKey: "agent:researcher:local:e2e",
    transportContext: {
      requesterChannel: "local",
    },
    agentWaitTimeoutMs: 45_000,
  });

  assert.equal(params.workflowRuntime, runtimeSubagent);
  assert.equal(params.toRole, "orchestrator");
  assert.equal(params.requesterSessionKey, "agent:researcher:local:e2e");
  assert.equal(params.waitTimeoutMs, 45_000);
  assert.match(params.extraBody, /Produce a real research plan/);
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
      "--bootstrap-timeout-ms",
      "1234",
      "--project-root-timeout-ms",
      "2345",
      "--max-no-progress-turns",
      "2",
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

  const commandText = await fs.readFile(path.join(runRoot, "command.txt"), "utf8");
  assert.match(commandText, /"--bootstrap-timeout-ms" "1234"/);
  assert.match(commandText, /"--project-root-timeout-ms" "2345"/);
  assert.match(commandText, /"--max-no-progress-turns" "2"/);
});
