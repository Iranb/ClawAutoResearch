import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import {
  buildAutoWorkflowResearchHarnessScorecard,
  buildAutoWorkflowPrChecklist,
  buildAutoWorkflowTransportParityScorecard,
  buildAutoWorkflowTraceEvalScorecard,
  collectAutoWorkflowEnvironmentPreflight,
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
  resolveLiveNoProgressGrace,
  resolveLiveStageHandoffRevision,
  shouldReplayNativeSlashBootstrap,
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

test("isolated Discord parity uses native slash replay for live bootstrap", () => {
  assert.equal(
    shouldReplayNativeSlashBootstrap({
      bootstrapTransport: "discord",
      isolatedGatewayEnabled: true,
    }),
    true
  );
  assert.equal(
    shouldReplayNativeSlashBootstrap({
      bootstrapTransport: "discord",
      isolatedGatewayEnabled: false,
    }),
    false
  );
  assert.equal(
    shouldReplayNativeSlashBootstrap({
      bootstrapTransport: "local",
      isolatedGatewayEnabled: false,
    }),
    true
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
  const fallbackProjectsRoot = path.join(tempRoot, "run-root", "projects");

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
      fallback: fallbackProjectsRoot,
    }),
    path.resolve(projectsRoot)
  );

  assert.equal(
    await resolveAutoWorkflowProjectsRoot({
      mode: "live",
      sourceConfigPath,
      fallback: fallbackProjectsRoot,
      isolatedGateway: true,
      reuseProject: false,
    }),
    path.resolve(fallbackProjectsRoot)
  );

  assert.equal(
    await resolveAutoWorkflowProjectsRoot({
      mode: "live",
      sourceConfigPath,
      fallback: fallbackProjectsRoot,
      isolatedGateway: true,
      reuseProject: true,
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

test("auto workflow E2E runner builds a compact trace/eval scorecard", () => {
  const scorecard = buildAutoWorkflowTraceEvalScorecard({
    generatedAt: "2026-05-12T00:00:00.000Z",
    status: "partial",
    failureReason: "max_iterations_reached",
    command: normalizeAutoWorkflowCommand("/auto-research"),
    topic: "SQLite index design",
    mode: "live",
    bootstrapTransport: "discord",
    preflight: [
      { name: "node_version", ok: true, detail: "25.4.0" },
      { name: "papernexus_reachability", ok: false, detail: "timeout" },
    ],
    transportParity: { profile: "discord-parity" },
    resultSummary: {
      lanes: [
        {
          lane: "experiment",
          transport: "discord",
          projectRoot: "/tmp/project",
          finalVerdict: "partial",
          finalStage: "idea",
          finalOwner: "researcher",
          blockingReason: "idea_catalyst_pending",
          turnCount: 2,
          turns: [
            { stage: "graph_build", owner: "researcher", progressed: true },
            { stage: "idea", owner: "researcher", progressed: false },
          ],
          handoffCount: 1,
          qualityScore100: 48.5,
          claimStrengthCap: "blocked",
        },
      ],
    },
  });

  assert.equal(scorecard.preflight.passed, false);
  assert.equal(scorecard.preflight.failed[0].name, "papernexus_reachability");
  assert.equal(scorecard.lanes[0].progressedTurnCount, 1);
  assert.equal(scorecard.lanes[0].lastTurn.stage, "idea");
  assert.equal(scorecard.lanes[0].blockingReason, "idea_catalyst_pending");
});

test("auto workflow E2E runner builds a PR checklist artifact model", () => {
  const checklist = buildAutoWorkflowPrChecklist({
    generatedAt: "2026-05-12T00:00:00.000Z",
    status: "partial",
    failureReason: "max_iterations_reached",
    command: normalizeAutoWorkflowCommand("/auto-research"),
    topic: "SQLite index design",
    mode: "live",
    bootstrapTransport: "discord",
    preflight: [
      { name: "node_version", ok: true, detail: "25.4.0" },
      { name: "papernexus_reachability", ok: true, detail: "status=200" },
    ],
    resultSummary: {
      lanes: [
        {
          lane: "experiment",
          transport: "discord",
          projectRoot: "/tmp/project",
          finalVerdict: "partial",
          finalStage: "idea",
          finalOwner: "researcher",
          blockingReason: "idea_catalyst_pending",
        },
      ],
    },
    transportParity: {
      profile: "discord-parity",
      userPathAligned: true,
      expectedCommandSource: "native",
    },
    summaryPath: "/tmp/run/AUTO_WORKFLOW_E2E_SUMMARY.json",
    traceEvalScorecardPath: "/tmp/run/TRACE_EVAL_SCORECARD.json",
    researchHarnessScorecardPath: "/tmp/run/RESEARCH_HARNESS_SCORECARD.json",
    runRoot: "/tmp/run",
    projectsRoot: "/tmp/projects",
  });

  assert.equal(checklist.validationEvidence[0].status, "pass");
  assert.equal(checklist.validationEvidence[3].profile, "discord-parity");
  assert.equal(checklist.externalSideEffects.liveRuntimeDispatch, true);
  assert.equal(checklist.externalSideEffects.discordGatewayUse, true);
  assert.match(checklist.rollback.strategy, /Revert the code diff/);
  assert.ok(checklist.residualRisks.includes("run_status_partial"));
  assert.ok(checklist.residualRisks.includes("writing_stage_not_reached_by_this_run"));
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

test("auto workflow E2E runner preflights environment without leaking secrets", async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-e2e-env-"));
  t.after(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(repoRoot, "package.json"), "{}\n");
  await fs.writeFile(path.join(repoRoot, "package-lock.json"), "{}\n");
  await fs.mkdir(path.join(repoRoot, "node_modules", "typescript"), { recursive: true });
  await fs.writeFile(
    path.join(repoRoot, "node_modules", "typescript", "package.json"),
    "{}\n"
  );
  const sourceConfigPath = path.join(repoRoot, "openclaw.json");
  await fs.writeFile(sourceConfigPath, JSON.stringify({ gateway: { auth: {} } }));

  let fetched = false;
  const checks = await collectAutoWorkflowEnvironmentPreflight({
    repoRoot,
    mode: "live",
    bootstrapTransport: "discord",
    isolatedGateway: false,
    sourceConfigPath,
    localPapernexus: {
      enabled: true,
      envOverrides: {},
      pluginOverrides: { papernexusApiTokenEnv: "PAPERNEXUS_API_TOKEN" },
      summary: {
        accessMode: "remote_mcp",
        mcpUrl: "http://user:super-secret@127.0.0.1:4821/mcp?token=super-secret",
        apiBaseUrl: null,
        tokenEnv: "PAPERNEXUS_API_TOKEN",
        tokenProvidedBy: "environment",
        corpusProvidedBy: "cli",
        sshTarget: "10.126.56.41",
        remoteStagingRoot: "/tmp/pn",
      },
    },
    env: {
      HOME: "/tmp/home",
      PATH: "/bin",
      OPENCLAW_GATEWAY_TOKEN: "gateway-secret",
      PAPERNEXUS_API_TOKEN: "paper-secret",
      PAPERNEXUS_CORPUS: "EML",
    },
    fetchImpl: async (_url, options) => {
      fetched = true;
      assert.equal(options.headers.Authorization, "Bearer paper-secret");
      return { status: 200 };
    },
  });

  const byName = Object.fromEntries(checks.map((entry) => [entry.name, entry]));
  assert.equal(byName.node_dependencies.ok, true);
  assert.equal(byName.runtime_env.ok, true);
  assert.equal(byName.papernexus_config.ok, true);
  assert.equal(byName.papernexus_reachability.ok, true);
  assert.equal(byName.discord_readiness.ok, true);
  assert.equal(fetched, true);
  assert.match(byName.discord_readiness.detail, /gateway_token_source=environment/);
  assert.match(byName.papernexus_config.detail, /token=environment/);

  const renderedDetails = checks.map((entry) => entry.detail).join("\n");
  assert.doesNotMatch(renderedDetails, /paper-secret|gateway-secret|super-secret/);
  assert.doesNotMatch(renderedDetails, /user:super-secret/);
});

test("auto workflow E2E runner does not require repo node_modules for fixture preflight", async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-e2e-fixture-env-"));
  t.after(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(repoRoot, "package.json"), "{}\n");

  const checks = await collectAutoWorkflowEnvironmentPreflight({
    repoRoot,
    mode: "fixture",
    bootstrapTransport: "local",
    env: {
      HOME: "/tmp/home",
      PATH: "/bin",
    },
  });
  const nodeDependencies = checks.find((entry) => entry.name === "node_dependencies");
  assert.equal(nodeDependencies.ok, true);
  assert.match(nodeDependencies.detail, /required=false/);
  assert.match(nodeDependencies.detail, /node_modules=missing/);
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

test("live E2E no-progress grace accepts late workflow advancement", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-live-progress-grace-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(projectRoot, ".openclaw-research"), { recursive: true });
  const manifest = {
    project_id: "progress-grace-project",
    current_stage: "graph_build",
    owner_agent: "researcher",
    next_action: "Run /graph-build.",
    blocking_reason: "graph_presence_not_ready",
  };
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  const lateAdvance = new Promise((resolve, reject) => {
    setTimeout(() => {
      fs.writeFile(
        path.join(projectRoot, "PROJECT_MANIFEST.json"),
        `${JSON.stringify(
          {
            ...manifest,
            current_stage: "frontier_mapping",
            next_action: "Run /frontier-mapping.",
            blocking_reason: null,
          },
          null,
          2
        )}\n`,
        "utf8"
      ).then(resolve, reject);
    }, 100);
  });

  const turn = await resolveLiveNoProgressGrace({
    projectRoot,
    lane: "experiment",
    turn: {
      owner: "researcher",
      stage: "graph_build",
      command: "/graph-build",
      intentId: null,
      progressed: false,
      progressReason: "timeout",
      manifest,
    },
    graceMs: 2_000,
    pollMs: 50,
  });
  await lateAdvance;

  assert.equal(turn.progressed, true);
  assert.equal(turn.progressReason, "post_timeout_stage_or_owner_changed");
  assert.equal(turn.manifest.current_stage, "frontier_mapping");
});

test("live E2E no-progress grace runs one auto-iterator reconciliation before failing", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-live-progress-reconcile-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(projectRoot, ".openclaw-research"), { recursive: true });
  const manifest = {
    project_id: "progress-reconcile-project",
    current_stage: "graph_build",
    owner_agent: "researcher",
    next_action: "Run /graph-build.",
    paper_ingestion: {
      graph_presence_status: "ready",
      queued_requests: [
        {
          request_id: "idea-catalyst-req-demo",
          request_kind: "requisition",
          status: "queued",
          trigger_kind: "idea_catalyst_requisition",
          attempt_count: 0,
        },
      ],
    },
  };
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  let reconcileCallCount = 0;
  const turn = await resolveLiveNoProgressGrace({
    projectRoot,
    lane: "experiment",
    turn: {
      owner: "researcher",
      stage: "graph_build",
      command: "/graph-build",
      intentId: null,
      progressed: false,
      progressReason: "timeout",
      manifest,
    },
    graceMs: 120,
    pollMs: 20,
    reconcileAfterGrace: async ({ baselineManifest }) => {
      reconcileCallCount += 1;
      const nextManifest = {
        ...baselineManifest,
        paper_ingestion: {
          ...baselineManifest.paper_ingestion,
          queued_requests: baselineManifest.paper_ingestion.queued_requests.map((entry) => ({
            ...entry,
            status: "completed",
            validation_status: "warning",
          })),
        },
      };
      await fs.writeFile(
        path.join(projectRoot, "PROJECT_MANIFEST.json"),
        `${JSON.stringify(nextManifest, null, 2)}\n`,
        "utf8"
      );
      return {
        progressed: true,
        reason: "auto_iterator_reconciled",
        manifest: nextManifest,
      };
    },
  });

  assert.equal(reconcileCallCount, 1);
  assert.equal(turn.progressed, true);
  assert.equal(turn.progressReason, "post_timeout_auto_iterator_reconciled");
  assert.equal(turn.manifest.paper_ingestion.queued_requests[0].status, "completed");
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

test("live E2E progress wait treats literature requisition queue progress as workflow progress", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-live-lit-progress-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const manifest = {
    project_id: "lit-progress-project",
    current_stage: "idea",
    owner_agent: "researcher",
    next_action: "Wait for PaperNexus literature discovery.",
    paper_ingestion: {
      queued_requests: [
        {
          request_id: "idea-catalyst-req-demo",
          request_kind: "requisition",
          trigger_kind: "idea_catalyst_requisition",
          status: "running",
          started_at: "2026-05-13T10:00:00.000Z",
          last_run_id: "lit-run-1",
          attempt_count: 1,
          queue_progress: {
            sequence: 1,
            last_event_at: "2026-05-13T10:00:01.000Z",
            remaining: 4,
            completed: 1,
            failed: 0,
          },
        },
      ],
    },
  };
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  const update = new Promise((resolve, reject) => {
    setTimeout(() => {
      const nextManifest = {
        ...manifest,
        paper_ingestion: {
          queued_requests: [
            {
              ...manifest.paper_ingestion.queued_requests[0],
              queue_progress: {
                sequence: 2,
                last_event_at: "2026-05-13T10:00:10.000Z",
                remaining: 3,
                completed: 2,
                failed: 0,
              },
            },
          ],
        },
      };
      fs.writeFile(
        path.join(projectRoot, "PROJECT_MANIFEST.json"),
        `${JSON.stringify(nextManifest, null, 2)}\n`,
        "utf8"
      ).then(resolve, reject);
    }, 100);
  });

  const progress = await waitForProgress({
    projectRoot,
    baselineManifest: manifest,
    lane: "experiment",
    timeoutMs: 2_000,
    pollMs: 50,
  });
  await update;

  assert.equal(progress.progressed, true);
  assert.equal(progress.reason, "workflow_state_changed");
  assert.equal(progress.manifest.paper_ingestion.queued_requests[0].queue_progress.sequence, 2);
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

test("research harness scorecard reports literature requisition progress fields", async (t) => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-requisition-scorecard-"));
  t.after(async () => {
    await fs.rm(runRoot, { recursive: true, force: true });
  });

  const createLaneProject = async (name, request, sourceIndex = null) => {
    const projectRoot = path.join(runRoot, name);
    await fs.mkdir(path.join(projectRoot, "researcher"), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, "PROJECT_MANIFEST.json"),
      `${JSON.stringify(
        {
          project_id: name,
          current_stage: "idea",
          owner_agent: "researcher",
          paper_ingestion: {
            queued_requests: [request],
          },
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    if (sourceIndex) {
      await fs.writeFile(
        path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"),
        `${JSON.stringify(sourceIndex, null, 2)}\n`,
        "utf8"
      );
    }
    return projectRoot;
  };

  const unlaunchedRoot = await createLaneProject("unlaunched", {
    request_id: "req-unlaunched",
    request_kind: "requisition",
    trigger_kind: "idea_catalyst_requisition",
    status: "queued",
    started_at: null,
    attempt_count: 0,
  });
  const remoteRoot = await createLaneProject("remote-progress", {
    request_id: "req-remote",
    request_kind: "requisition",
    trigger_kind: "idea_catalyst_requisition",
    status: "running",
    started_at: "2026-05-13T10:00:00.000Z",
    last_run_id: "lit-run-remote",
    attempt_count: 1,
    queue_progress: {
      sequence: 7,
      last_event_at: "2026-05-13T10:05:00.000Z",
      remaining: 2,
      completed: 3,
      failed: 0,
    },
  });
  const noSourcesRoot = await createLaneProject("completed-no-sources", {
    request_id: "req-no-sources",
    request_kind: "requisition",
    trigger_kind: "idea_catalyst_requisition",
    status: "completed",
    started_at: "2026-05-13T10:00:00.000Z",
    last_run_id: "lit-run-no-sources",
    attempt_count: 1,
    validation_status: "warning",
  });
  const indexedRoot = await createLaneProject(
    "completed-indexed",
    {
      request_id: "req-indexed",
      request_kind: "requisition",
      trigger_kind: "idea_catalyst_requisition",
      status: "completed",
      started_at: "2026-05-13T10:00:00.000Z",
      last_run_id: "lit-run-indexed",
      attempt_count: 1,
      validation_status: "valid",
      validation_report_path: "graph/paper-ingestion-validation/req-indexed.json",
    },
    {
      papers: [
        {
          canonical_id: "paper-1",
          title: "A source backed paper",
          source_kind: "markdown",
          source_path: "researcher/paper_source/md/paper-1.md",
        },
      ],
    }
  );
  const failedRoot = await createLaneProject("failed-needs-repair", {
    request_id: "req-failed",
    request_kind: "requisition",
    trigger_kind: "idea_catalyst_requisition",
    status: "failed",
    started_at: "2026-05-13T10:00:00.000Z",
    last_run_id: "lit-run-failed",
    attempt_count: 2,
    validation_status: "invalid",
  });

  const scorecard = await buildAutoWorkflowResearchHarnessScorecard({
    status: "fail",
    topic: "GCD",
    mode: "live",
    resultSummary: {
      lanes: [
        { lane: "unlaunched", projectRoot: unlaunchedRoot },
        { lane: "remote", projectRoot: remoteRoot },
        { lane: "no-sources", projectRoot: noSourcesRoot },
        { lane: "indexed", projectRoot: indexedRoot },
        { lane: "failed", projectRoot: failedRoot },
      ],
    },
  });

  const byLane = Object.fromEntries(
    scorecard.lanes.map((lane) => [lane.lane, lane.literature.requisition])
  );
  assert.equal(
    byLane.unlaunched.summaryStatus,
    "literature_requisition_unlaunched"
  );
  assert.equal(byLane.remote.summaryStatus, "literature_requisition_remote_progress");
  assert.equal(byLane.remote.attemptCount, 1);
  assert.equal(byLane.remote.lastRunId, "lit-run-remote");
  assert.equal(byLane.remote.queueProgress.sequence, 7);
  assert.equal(byLane.remote.queueProgress.remaining, 2);
  assert.equal(
    byLane["no-sources"].summaryStatus,
    "literature_requisition_completed_no_sources"
  );
  assert.equal(
    byLane.indexed.summaryStatus,
    "literature_requisition_completed_source_indexed"
  );
  assert.equal(byLane.indexed.sourceIndex.paperCount, 1);
  assert.equal(byLane.indexed.sourceIndex.sourceBackedPaperCount, 1);
  assert.equal(
    byLane.failed.summaryStatus,
    "literature_requisition_failed_needs_repair"
  );
  assert.equal(byLane.failed.status, "failed");
  assert.equal(byLane.failed.attemptCount, 2);
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
  await fs.access(payload.traceEvalScorecardPath);
  await fs.access(payload.researchHarnessScorecardPath);
  await fs.access(payload.prChecklistPath);
  await fs.access(payload.prChecklistMarkdownPath);
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
  assert.equal(payload.traceEvalScorecard.status, "pass");
  assert.equal(payload.traceEvalScorecard.preflight.passed, true);
  assert.equal(payload.traceEvalScorecard.lanes[0].finalVerdict, "pass");
  assert.equal(payload.researchHarnessScorecard.status, "pass");
  assert.equal(typeof payload.researchHarnessScorecard.lanes[0].literature.papernexusStatus, "string");
  assert.equal(payload.researchHarnessScorecard.lanes[0].experiment.benchmarkStatus, "pass");
  assert.equal(payload.researchHarnessScorecard.lanes[0].writing.claimStrengthCap, "artifact_complete_content_unscored");
  assert.equal(payload.prChecklist.status, "pass");
  assert.equal(payload.prChecklist.validationEvidence[0].status, "pass");
  assert.equal(payload.prChecklist.externalSideEffects.liveRuntimeDispatch, false);
  const prChecklistMarkdown = await fs.readFile(payload.prChecklistMarkdownPath, "utf8");
  assert.match(prChecklistMarkdown, /## Rollback/);

  const commandText = await fs.readFile(path.join(runRoot, "command.txt"), "utf8");
  assert.match(commandText, /"--bootstrap-timeout-ms" "1234"/);
  assert.match(commandText, /"--project-root-timeout-ms" "2345"/);
  assert.match(commandText, /"--max-no-progress-turns" "2"/);
});
