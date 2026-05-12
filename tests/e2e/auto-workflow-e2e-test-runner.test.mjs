import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import {
  buildAutoWorkflowTransportParityScorecard,
  configuredProjectsRootFromOpenClawConfig,
  configuredModelRefsForAgent,
  deriveAutoWorkflowChildMaxIterations,
  defaultProjectIdForAutoWorkflowRun,
  materializeAutoWorkflowModelOverrideConfig,
  normalizeAutoWorkflowBootstrapTransport,
  normalizeAutoWorkflowCommand,
  normalizeAutoWorkflowMode,
  resolveAutoWorkflowProjectsRoot,
  resolveAutoWorkflowLocalFallbackEnv,
  shouldAutoGenerateLiveProjectId,
  shouldEnableAgentModelSyncWatchdog,
  shouldRestartGatewayAfterAgentModelSync,
  verifyAgentRuntimeModelConfig,
} from "../../scripts/run_auto_workflow_e2e_test.mjs";
import {
  buildLiveHandoffWorkflowTaskParams,
  buildLiveAutoIteratorParams,
  deriveStageCommand,
  detectLivePaperArtifactTerminal,
  detectLiveSubstantiveRevisionTerminal,
  readLiveWorkflowActivation,
  resolveLiveStageHandoffRevision,
  waitForProgress,
  workflowRuntimeProgressFingerprint,
} from "../../scripts/auto_command_live_orchestrator.mjs";

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
  assert.equal(normalizeAutoWorkflowBootstrapTransport("local-live"), "local");
  assert.equal(normalizeAutoWorkflowBootstrapTransport("discord-parity"), "discord");
  assert.equal(
    configuredProjectsRootFromOpenClawConfig({
      projectsRoot: "/tmp/top-level-projects",
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
  assert.equal(
    configuredProjectsRootFromOpenClawConfig({
      plugins: {
        entries: {
          "openclaw-research": {
            config: {
              projectsRoot: "/tmp/openclaw-research-projects",
            },
          },
        },
      },
    }),
    "/tmp/openclaw-research-projects"
  );
});

test("package scripts make real runs use Discord parity and preserve local-live aliases", async () => {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(process.cwd(), "package.json"), "utf8")
  );

  assert.match(
    packageJson.scripts["test:autoresearch:real"],
    /--bootstrap-transport discord/
  );
  assert.match(
    packageJson.scripts["test:autoreview:real"],
    /--bootstrap-transport discord/
  );
  assert.match(
    packageJson.scripts["test:autoresearch:local-live"],
    /--bootstrap-transport local/
  );
  assert.match(
    packageJson.scripts["test:autoreview:local-live"],
    /--bootstrap-transport local/
  );
});

test("auto workflow E2E runner help exits before live preflight", async () => {
  const { stdout, stderr } = await execFile(
    process.execPath,
    [
      path.join(process.cwd(), "scripts", "run_auto_workflow_e2e_test.mjs"),
      "--help",
    ],
    { maxBuffer: 1024 * 1024 }
  );

  assert.match(stdout, /Usage: node scripts\/run_auto_workflow_e2e_test\.mjs/);
  assert.match(stdout, /--mode live\|fixture/);
  assert.match(stdout, /--strict-content/);
  assert.doesNotMatch(stdout, /Auto workflow E2E: fail/);
  assert.equal(stderr, "");
});

test("auto workflow E2E runner rejects hidden project ids in live Discord parity", async () => {
  await assert.rejects(
    execFile(process.execPath, [
      path.join(process.cwd(), "scripts", "run_auto_workflow_e2e_test.mjs"),
      "--mode",
      "live",
      "--command",
      "/auto-research",
      "--bootstrap-transport",
      "discord",
      "--project-id",
      "hidden-project",
      "--no-preflight",
      "--json",
    ]),
    (error) => {
      assert.match(
        error.stderr,
        /--project-id cannot be used with live Discord parity/
      );
      return true;
    }
  );
});

test("auto workflow E2E runner forwards strict content to fixture child runs", async (t) => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "auto-workflow-strict-forward-"));
  t.after(async () => {
    await fs.rm(runRoot, { recursive: true, force: true });
  });

  const { stdout } = await execFile(
    process.execPath,
    [
      path.join(process.cwd(), "scripts", "run_auto_workflow_e2e_test.mjs"),
      "--mode",
      "fixture",
      "--command",
      "/auto-review",
      "--topic",
      "PaperGuru SurveyBench alignment",
      "--run-root",
      runRoot,
      "--no-preflight",
      "--strict-content",
      "--json",
    ],
    { maxBuffer: 20 * 1024 * 1024 }
  );
  const summary = JSON.parse(stdout);
  const commandText = await fs.readFile(path.join(runRoot, "command.txt"), "utf8");
  const payload = JSON.parse(await fs.readFile(path.join(runRoot, "payload.json"), "utf8"));

  assert.equal(summary.status, "pass");
  assert.equal(summary.strictContent, true);
  assert.match(commandText, /--strict-content/);
  assert.equal(payload.strictContent, true);
  assert.equal(payload.result.survey.harness.strictContent, true);
  assert.equal(payload.result.survey.harness.contentQuality.status, "pass");
});

test("auto workflow E2E runner defaults live projects root to plugin config", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "auto-workflow-root-config-"));
  const sourceConfigPath = path.join(tempRoot, "openclaw.json");
  const projectsRoot = path.join(tempRoot, "configured-projects");

  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await fs.writeFile(
    sourceConfigPath,
    `${JSON.stringify(
      {
        plugins: {
          entries: {
            ClawAutoResearch: {
              config: {
                projectsRoot,
              },
            },
          },
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  assert.equal(
    await resolveAutoWorkflowProjectsRoot({
      mode: "live",
      sourceConfigPath,
      fallback: path.join(tempRoot, "run-root", "projects"),
    }),
    path.resolve(projectsRoot)
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

test("auto workflow E2E runner does not auto-generate hidden project ids for Discord parity", () => {
  assert.equal(
    shouldAutoGenerateLiveProjectId({
      mode: "live",
      bootstrapTransport: "local",
      reuseProject: false,
      projectIdArg: null,
    }),
    true
  );
  assert.equal(
    shouldAutoGenerateLiveProjectId({
      mode: "live",
      bootstrapTransport: "discord",
      reuseProject: false,
      projectIdArg: null,
    }),
    false
  );
  assert.equal(
    shouldAutoGenerateLiveProjectId({
      mode: "fixture",
      bootstrapTransport: "local",
      reuseProject: false,
      projectIdArg: null,
    }),
    false
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

  const discord = resolveAutoWorkflowLocalFallbackEnv(
    {
      mode: "live",
      bootstrapTransport: "discord",
    },
    {}
  );
  assert.deepEqual(discord.envOverrides, {});
  assert.equal(discord.summary.codeReviewFallbackAfterMs, null);
  assert.equal(discord.summary.codeReviewSource, "unset");
  assert.equal(discord.summary.autoModeDiscussionFallbackAfterMs, null);
  assert.equal(discord.summary.autoModeDiscussionSource, "unset");
});

test("auto workflow E2E runner builds a Discord parity scorecard", () => {
  const scorecard = buildAutoWorkflowTransportParityScorecard({
    command: normalizeAutoWorkflowCommand("/auto-research"),
    mode: "live",
    bootstrapTransport: "discord",
    conversationId: "gcd-research-lab",
    resultSummary: {
      lanes: [
        {
          lane: "experiment",
          transport: "discord",
          conversationId: "gcd-research-lab",
          projectRoot: "/tmp/projects/generalized-category-discovery",
          finalVerdict: "partial",
        },
      ],
    },
    workflowLocalFallback: {
      codeReviewFallbackAfterMs: null,
      autoModeDiscussionFallbackAfterMs: null,
    },
    projectIdArg: null,
    generatedProjectId: null,
    explicitProjectId: null,
  });

  assert.equal(scorecard.profile, "discord-parity");
  assert.equal(scorecard.userPathAligned, true);
  assert.equal(scorecard.expectedCommandSource, "native");
  assert.equal(scorecard.localFallbackInjected, false);
  assert.equal(scorecard.hiddenProjectIdOverrideUsed, false);
  assert.equal(
    scorecard.lanes[0].bootstrapSessionKey,
    "agent:researcher:discord:slash:owner"
  );
  assert.equal(
    scorecard.lanes[0].commandTargetSessionKey,
    "agent:researcher:discord:channel:gcd-research-lab"
  );
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

test("auto workflow E2E runner materializes temporary model override config from agent catalog", async (t) => {
  const openclawHome = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-model-override-"));
  t.after(async () => {
    await fs.rm(openclawHome, { recursive: true, force: true });
  });
  const agentDir = path.join(openclawHome, "agents", "researcher", "agent");
  await fs.mkdir(agentDir, { recursive: true });
  const sourceConfigPath = path.join(openclawHome, "openclaw.json");
  await fs.writeFile(
    sourceConfigPath,
    `${JSON.stringify(
      {
        models: {
          providers: {
            bailian: {
              apiKey: "bailian-key",
              models: [{ id: "qwen3.5-plus" }],
            },
          },
        },
        agents: {
          defaults: {
            model: {
              primary: "bailian/qwen3.5-plus",
              fallbacks: ["bailian/qwen3.6-plus"],
            },
          },
          list: [
            {
              id: "researcher",
              agentDir,
              model: {
                primary: "bailian/qwen3.5-plus",
                fallbacks: ["bailian/qwen3.6-plus"],
              },
            },
          ],
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(agentDir, "models.json"),
    `${JSON.stringify(
      {
        providers: {
          codex: {
            apiKey: "codex-key",
            models: [{ id: "gpt-5.4" }],
          },
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const materialized = await materializeAutoWorkflowModelOverrideConfig({
    sourceConfigPath,
    modelOverride: {
      enabled: true,
      primary: "codex/gpt-5.4",
      fallbacks: [],
      requestedRefs: ["codex/gpt-5.4"],
    },
    agentIds: ["researcher"],
  });
  t.after(async () => {
    await materialized.cleanup();
  });

  const effectiveConfig = JSON.parse(await fs.readFile(materialized.configPath, "utf8"));
  const sourceConfig = JSON.parse(await fs.readFile(sourceConfigPath, "utf8"));
  assert.equal(effectiveConfig.agents.defaults.model.primary, "codex/gpt-5.4");
  assert.deepEqual(effectiveConfig.agents.defaults.model.fallbacks, []);
  assert.equal(effectiveConfig.agents.list[0].model.primary, "codex/gpt-5.4");
  assert.deepEqual(effectiveConfig.agents.list[0].model.fallbacks, []);
  assert.equal(sourceConfig.agents.defaults.model.primary, "bailian/qwen3.5-plus");
  assert.deepEqual(
    effectiveConfig.models.providers.codex.models.map((entry) => entry.id),
    ["gpt-5.4"]
  );
  assert.deepEqual(materialized.summary.backfilledProviders, [
    {
      provider: "codex",
      models: ["gpt-5.4"],
      sourceAgentId: "researcher",
    },
  ]);

  await materialized.cleanup();
  await assert.rejects(fs.access(materialized.configPath));
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

test("live E2E progress waits treat runtime queue changes as observable progress", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-live-runtime-progress-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const manifest = {
    project_id: "runtime-progress-project",
    current_stage: "code",
    owner_agent: "coder",
    next_action: "Wait for local code review fallback.",
  };
  await fs.mkdir(path.join(projectRoot, ".openclaw-research"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  const before = await workflowRuntimeProgressFingerprint(projectRoot);
  const delayedRuntimeWrite = new Promise((resolve, reject) => {
    setTimeout(() => {
      fs.writeFile(
        path.join(projectRoot, ".openclaw-research", "workflow-runtime-queue.json"),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            entries: [
              {
                queueKey: "openclaw-research:auto-discussion:runtime-progress-project:reviewer:1",
                kind: "workflow_auto_discussion",
                ownerAgent: "reviewer",
                projectId: "runtime-progress-project",
                projectRoot,
                status: "running",
                runId: "review-run-1",
              },
            ],
          },
          null,
          2
        )}\n`,
        "utf8"
      ).then(resolve, reject);
    }, 100);
  });

  const progress = await waitForProgress({
    projectRoot,
    baselineManifest: manifest,
    timeoutMs: 2_000,
    pollMs: 50,
  });
  await delayedRuntimeWrite;
  const after = await workflowRuntimeProgressFingerprint(projectRoot);

  assert.notEqual(after, before);
  assert.equal(progress.progressed, true);
  assert.equal(progress.reason, "runtime_state_changed");
});

test("live E2E ignores stale paper artifact readiness before write stage", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-live-paper-ready-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(projectRoot, "academic_writer", "paper"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "academic_writer", "paper", "main.pdf"), "pdf");
  await fs.writeFile(path.join(projectRoot, "academic_writer", "paper", "main.tex"), "\\section{Done}");

  const manifest = {
    project_id: "paper-ready-project",
    current_stage: "idea",
    owner_agent: "researcher",
    experiment_search: { status: "ready_for_analysis" },
    write_package: { status: "ready" },
    paper_qc: { status: "ready" },
  };

  const terminal = await detectLivePaperArtifactTerminal({
    projectRoot,
    manifest,
    lane: "experiment",
  });

  assert.equal(terminal.terminal, false);
  assert.equal(terminal.reason, null);
  assert.equal(terminal.details.stage, "idea");
  assert.equal(terminal.details.writeReady, true);
  assert.equal(terminal.details.paperQcReady, true);
  assert.equal(terminal.details.experimentReady, true);
  assert.equal(terminal.details.stageAllowsTerminal, false);
});

test("live E2E progress wait ignores stale paper artifacts before write stage", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-live-paper-terminal-progress-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(projectRoot, "academic_writer", "paper"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "academic_writer", "paper", "main.pdf"), "pdf");
  await fs.writeFile(path.join(projectRoot, "academic_writer", "paper", "main.tex"), "\\section{Done}");

  const manifest = {
    project_id: "paper-terminal-progress-project",
    current_stage: "idea",
    owner_agent: "researcher",
    experiment_search: { status: "ready_for_analysis" },
    write_package: { status: "ready" },
    paper_qc: { status: "ready" },
  };
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  const progress = await waitForProgress({
    projectRoot,
    baselineManifest: manifest,
    lane: "experiment",
    timeoutMs: 200,
    pollMs: 50,
  });

  assert.equal(progress.progressed, false);
  assert.equal(progress.reason, "timeout");
});

test("live E2E progress wait accepts paper artifacts once workflow reaches write", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-live-paper-write-terminal-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(projectRoot, "academic_writer", "paper"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "academic_writer", "paper", "main.pdf"), "pdf");
  await fs.writeFile(path.join(projectRoot, "academic_writer", "paper", "main.tex"), "\\section{Done}");

  const manifest = {
    project_id: "paper-write-terminal-project",
    current_stage: "write",
    owner_agent: "academic_writer",
    experiment_search: { status: "ready_for_analysis" },
    write_package: { status: "ready" },
    paper_qc: { status: "ready" },
  };
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  const progress = await waitForProgress({
    projectRoot,
    baselineManifest: manifest,
    lane: "experiment",
    timeoutMs: 2_000,
    pollMs: 50,
  });

  assert.equal(progress.progressed, true);
  assert.equal(progress.reason, "live_paper_artifact_ready");
  assert.equal(progress.terminal.terminal, true);
  assert.equal(progress.terminal.details.stageAllowsTerminal, true);
});

test("live E2E reuses auto-iterator prepared handoff revision", () => {
  assert.equal(
    resolveLiveStageHandoffRevision({
      pendingHandoff: true,
      pendingHandoffPhase: "prepared",
      pendingHandoffExecutionId: " execution-1 ",
    }),
    "execution-1"
  );
  assert.equal(
    resolveLiveStageHandoffRevision({
      pendingHandoff: true,
      pendingHandoffPhase: "dispatched",
      pendingHandoffExecutionId: "execution-2",
    }),
    null
  );
});

test("live E2E harness treats durable reviewer revision as a terminal real-run outcome", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-live-revision-terminal-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(projectRoot, "academic_writer", "paper"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "reviewer"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "academic_writer", "paper", "main.pdf"), "pdf");
  await fs.writeFile(
    path.join(projectRoot, "reviewer", "REVIEW_PACKET.json"),
    `${JSON.stringify({ action_items: ["P1: add stronger baseline"] })}\n`
  );
  await fs.writeFile(
    path.join(projectRoot, "reviewer", "REVIEW_ISSUES.json"),
    `${JSON.stringify({ status: "open", open_counts: { high: 1 } })}\n`
  );

  const terminal = await detectLiveSubstantiveRevisionTerminal({
    projectRoot,
    manifest: {
      current_stage: "write",
      owner_agent: "academic_writer",
      innovation_synthesis_state: { status: "needs_revision" },
    },
    lane: "experiment",
  });

  assert.equal(terminal.terminal, true);
  assert.equal(terminal.reason, "live_reviewer_revision_requested");
  assert.equal(terminal.details.reviewIssueCount, 1);
  assert.equal(terminal.details.actionItemCount, 1);
  assert.equal(terminal.details.blockingActionItemCount, 1);
});

test("live E2E harness does not treat submit-ready review closeout as revision terminal", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-live-submit-ready-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(projectRoot, "academic_writer", "paper"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "reviewer"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "academic_writer"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "academic_writer", "paper", "main.pdf"), "pdf");
  await fs.writeFile(
    path.join(projectRoot, "reviewer", "REVIEW_PACKET.json"),
    `${JSON.stringify({
      status: "completed",
      verdict: "ready",
      action_items: ["Proceed to submit-stage gate with review artifacts available."],
    })}\n`
  );
  await fs.writeFile(
    path.join(projectRoot, "reviewer", "REVIEW_ISSUES.json"),
    `${JSON.stringify({ open_counts: { critical: 0, high: 0, medium: 0, low: 0 } })}\n`
  );
  await fs.writeFile(
    path.join(projectRoot, "reviewer", "REVISION_CONTROL_PACKET.json"),
    `${JSON.stringify({ status: "ready" })}\n`
  );
  await fs.writeFile(
    path.join(projectRoot, "academic_writer", "PAPER_REVISION_STATE.json"),
    `${JSON.stringify({ status: "ready" })}\n`
  );

  const terminal = await detectLiveSubstantiveRevisionTerminal({
    projectRoot,
    manifest: {
      current_stage: "write",
      owner_agent: "academic_writer",
      innovation_synthesis_state: { status: "needs_revision" },
      review_session: { status: "completed", verdict: "ready" },
    },
    lane: "experiment",
  });

  assert.equal(terminal.terminal, false);
  assert.equal(terminal.details.reviewReady, true);
  assert.equal(terminal.details.blockingActionItemCount, 0);
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
  await fs.access(payload.projectsDashboardPath);
  await fs.access(payload.projectsDashboardHtmlPath);
  await fs.access(path.join(payload.result.lanes[0].projectRoot, ".openclaw-research", "E2E_RUN_REPORT.md"));
  assert.match(payload.projectsDashboardPath, /E2E_PROJECTS_DASHBOARD\.json$/);
  assert.match(payload.projectsDashboardHtmlPath, /E2E_PROJECTS_DASHBOARD\.html$/);
  assert.equal(payload.projectsDashboard.project_count, 1);
  assert.deepEqual(payload.projectsDashboard.final_verdict, { pass: 1 });

  const commandText = await fs.readFile(path.join(runRoot, "command.txt"), "utf8");
  assert.match(commandText, /"--bootstrap-timeout-ms" "1234"/);
  assert.match(commandText, /"--project-root-timeout-ms" "2345"/);
  assert.match(commandText, /"--max-no-progress-turns" "2"/);
});
