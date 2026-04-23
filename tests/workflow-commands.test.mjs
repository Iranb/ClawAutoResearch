import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createResearchWorkflowCommands,
  resolveBindingConversationFromCommandContext,
  resolveWorkflowCommandSessionTarget,
} from "../tools/workflow-commands.ts";
import {
  clearBackgroundWorkflowQueueForTests,
  drainQueuedBackgroundWorkflowRuns,
  enqueueQueuedBackgroundWorkflowRun,
} from "../tools/workflow-fast-paths.ts";
import { readWorkflowRuntimeQueueStore } from "../tools/workflow-runtime-state.ts";
import {
  createAutoModeDiscussionRound,
  saveAutoModeDiscussionStore,
} from "../tools/workflow-auto-discussion.ts";

async function makeProjectsRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-workflow-command-"));
}

async function makeProject(projectsRoot, projectId, stage = "setup") {
  const projectRoot = path.join(projectsRoot, projectId);
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify({ project_id: projectId, current_stage: stage }, null, 2)}\n`,
    "utf8"
  );
  return projectRoot;
}

async function assertWorkflowProjectScaffold(projectRoot) {
  for (const relativePath of [
    "PROJECT_MANIFEST.json",
    "TRACK_REGISTRY.json",
    "CLAIM_POLICY.md",
    path.join("researcher", "EXPERIMENT_LEDGER.json"),
    path.join("researcher", "idle-research", "IDLE_RESEARCH.json"),
    path.join("memory", "ideation-memory.md"),
    path.join("memory", "experiment-memory.md"),
  ]) {
    await fs.access(path.join(projectRoot, relativePath));
  }
}

function makeApi(overrides = {}) {
  return {
    config: {},
    pluginConfig: {
      enableChannelProjectBindings: true,
    },
    runtime: {
      agent: {
        resolveAgentWorkspaceDir(_cfg, agentId) {
          return `/tmp/workspace-${agentId}`;
        },
      },
      channel: {
        routing: {
          resolveAgentRoute() {
            return {
              agentId: "main",
              sessionKey: "agent:main:discord:channel:paper-lab",
            };
          },
        },
      },
      subagent: {
        async run() {
          return { runId: "bg-run-1" };
        },
      },
    },
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    registerCommand() {},
    ...overrides,
  };
}

function getCommand(commands, name) {
  const command = commands.find((entry) => entry.name === name);
  assert.ok(command, `Expected command ${name} to be registered.`);
  return command;
}

test("resolveBindingConversationFromCommandContext maps Discord channels to conversation ids", () => {
  const conversation = resolveBindingConversationFromCommandContext({
    channel: "discord",
    from: "discord:channel:12345",
    to: undefined,
    accountId: "work",
  });

  assert.deepEqual(conversation, {
    channel: "discord",
    accountId: "work",
    conversationId: "channel:12345",
  });
});

test("resolveBindingConversationFromCommandContext keeps Discord thread ids", () => {
  const conversation = resolveBindingConversationFromCommandContext({
    channel: "discord",
    from: "discord:channel:12345",
    to: undefined,
    accountId: "work",
    messageThreadId: "98765",
  });

  assert.deepEqual(conversation, {
    channel: "discord",
    accountId: "work",
    conversationId: "channel:12345",
    threadId: "98765",
  });
});

test("resolveBindingConversationFromCommandContext preserves Telegram topic threads", () => {
  const conversation = resolveBindingConversationFromCommandContext({
    channel: "telegram",
    from: undefined,
    to: "telegram:-100220011:topic:77",
    accountId: "default",
    messageThreadId: undefined,
  });

  assert.deepEqual(conversation, {
    channel: "telegram",
    accountId: "default",
    conversationId: "-100220011",
    threadId: 77,
  });
});

test("resolveWorkflowCommandSessionTarget prefers the active bound session", () => {
  const api = makeApi();
  const target = resolveWorkflowCommandSessionTarget(
    api,
    {
      channel: "discord",
      from: "discord:channel:paper-lab",
      to: undefined,
      accountId: "default",
      config: {},
    },
    () => ({
      targetSessionKey: "agent:researcher:discord:group:paper-lab",
    })
  );

  assert.equal(target.sessionKey, "agent:researcher:discord:group:paper-lab");
  assert.equal(target.agentId, "researcher");
  assert.equal(target.workspaceDir, "/tmp/workspace-researcher");
});

test("research-pipeline command starts a background continuation on the bound researcher session", async () => {
  let captured = null;
  const api = makeApi();
  const pipelineCommand = getCommand(createResearchWorkflowCommands(api, {
    resolveConversationBindingRecord() {
      return {
        targetSessionKey: "agent:researcher:discord:group:paper-lab",
      };
    },
    async buildWorkflowSnapshot(params) {
      captured = {
        ...(captured ?? {}),
        snapshotParams: params,
      };
      return {
        role: "researcher",
        projectRoot: "/tmp/projects/paper-lab",
        projectId: "paper-lab",
        channelProjectBindingsEnabled: true,
      };
    },
    async startBackgroundWorkflowRun(params) {
      captured = {
        ...(captured ?? {}),
        backgroundParams: params,
      };
      return {
        started: true,
        runId: "bg-run-9",
        sessionKey: params.agentCtx.sessionKey,
        projectRoot: params.snapshot.projectRoot,
        projectId: params.snapshot.projectId,
        summary: "Background research pipeline started.",
      };
    },
  }), "research-pipeline");

  const result = await pipelineCommand.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: '/research-pipeline "semantic shift robustness"',
    args: '"semantic shift robustness"',
    config: {},
    from: "discord:channel:paper-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.equal(result.text, "Background research pipeline started.");
  assert.equal(
    captured.backgroundParams.agentCtx.sessionKey,
    "agent:researcher:discord:group:paper-lab"
  );
  assert.equal(captured.backgroundParams.agentCtx.workspaceDir, "/tmp/workspace-researcher");
  assert.equal(captured.backgroundParams.backgroundRun.kind, "research_pipeline");
  assert.match(
    captured.backgroundParams.backgroundRun.commandText,
    /^\/research-pipeline\b/
  );
  assert.equal(
    captured.backgroundParams.backgroundRun.topic,
    "semantic shift robustness"
  );
});

test("survey-pipeline command starts a projectless background continuation on the bound researcher session", async () => {
  let captured = null;
  const api = makeApi();
  const surveyCommand = getCommand(
    createResearchWorkflowCommands(api, {
      resolveConversationBindingRecord() {
        return {
          targetSessionKey: "agent:researcher:discord:group:survey-lab",
        };
      },
      async buildWorkflowSnapshot(params) {
        captured = {
          ...(captured ?? {}),
          snapshotParams: params,
        };
        return {
          role: "researcher",
          projectRoot: null,
          projectId: null,
          channelProjectBindingsEnabled: true,
        };
      },
      async startBackgroundWorkflowRun(params) {
        captured = {
          ...(captured ?? {}),
          backgroundParams: params,
        };
        return {
          started: true,
          runId: "bg-run-survey-1",
          sessionKey: params.agentCtx.sessionKey,
          projectRoot: params.snapshot.projectRoot,
          projectId: params.snapshot.projectId,
          summary: "Background survey pipeline started.",
        };
      },
    }),
    "survey-pipeline"
  );

  const result = await surveyCommand.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: '/survey-pipeline "graph reasoning survey"',
    args: '"graph reasoning survey"',
    config: {},
    from: "discord:channel:survey-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.equal(result.text, "Background survey pipeline started.");
  assert.equal(
    captured.backgroundParams.agentCtx.sessionKey,
    "agent:researcher:discord:group:survey-lab"
  );
  assert.equal(captured.backgroundParams.backgroundRun.kind, "survey_review");
  assert.equal(captured.backgroundParams.backgroundRun.topic, "graph reasoning survey");
  assert.equal(
    captured.backgroundParams.backgroundRun.projectId,
    "survey-graph-reasoning-survey"
  );
  assert.match(
    captured.backgroundParams.backgroundRun.commandText,
    /^\/survey-pipeline\b/
  );
});

test("survey-pipeline reroutes orchestrator-targeted sessions onto researcher automatically", async () => {
  let captured = null;
  const api = makeApi({
    runtime: {
      agent: {
        resolveAgentWorkspaceDir(_cfg, agentId) {
          return `/tmp/workspace-${agentId}`;
        },
      },
      channel: {
        routing: {
          resolveAgentRoute() {
            return {
              agentId: "orchestrator",
              sessionKey: "agent:orchestrator:discord:group:survey-lab",
            };
          },
        },
      },
      subagent: {
        async run() {
          return { runId: "bg-run-1" };
        },
      },
    },
  });
  const surveyCommand = getCommand(
    createResearchWorkflowCommands(api, {
      resolveConversationBindingRecord() {
        return {
          targetSessionKey: "agent:orchestrator:discord:group:survey-lab",
        };
      },
      async buildWorkflowSnapshot(params) {
        captured = {
          ...(captured ?? {}),
          snapshotParams: params,
        };
        return {
          role: "researcher",
          projectRoot: null,
          projectId: null,
          channelProjectBindingsEnabled: true,
        };
      },
      async startBackgroundWorkflowRun(params) {
        captured = {
          ...(captured ?? {}),
          backgroundParams: params,
        };
        return {
          started: true,
          runId: "bg-run-survey-reroute",
          sessionKey: params.agentCtx.sessionKey,
          projectRoot: params.snapshot.projectRoot,
          projectId: params.snapshot.projectId,
          summary: "Background survey pipeline started.",
        };
      },
    }),
    "survey-pipeline"
  );

  const result = await surveyCommand.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: '/survey-pipeline "OmniModel"',
    args: '"OmniModel"',
    config: {},
    from: "discord:channel:survey-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.equal(result.text, "Background survey pipeline started.");
  assert.equal(
    captured.snapshotParams.sessionKey,
    "agent:researcher:discord:group:survey-lab"
  );
  assert.equal(
    captured.backgroundParams.agentCtx.sessionKey,
    "agent:researcher:discord:group:survey-lab"
  );
  assert.equal(captured.backgroundParams.agentCtx.agentId, "researcher");
  assert.equal(captured.backgroundParams.backgroundRun.kind, "survey_review");
});

test("survey-pipeline command still responds when opportunistic queue replay times out", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = path.join(projectsRoot, "paper-lab");
  const queuePath = path.join(
    os.tmpdir(),
    `openclaw-research-background-queue-workflow-commands-${Date.now()}-timeout.json`
  );
  const previousQueuePath = process.env.OPENCLAW_RESEARCH_BACKGROUND_QUEUE_PATH;

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
    await fs.rm(queuePath, { force: true });
    await clearBackgroundWorkflowQueueForTests();
    if (previousQueuePath === undefined) {
      delete process.env.OPENCLAW_RESEARCH_BACKGROUND_QUEUE_PATH;
    } else {
      process.env.OPENCLAW_RESEARCH_BACKGROUND_QUEUE_PATH = previousQueuePath;
    }
  });

  process.env.OPENCLAW_RESEARCH_BACKGROUND_QUEUE_PATH = queuePath;
  await clearBackgroundWorkflowQueueForTests();
  await fs.mkdir(projectRoot, { recursive: true });

  await enqueueQueuedBackgroundWorkflowRun({
    source: "start_background_run",
    ownerAgent: "researcher",
    requesterSessionKey: "agent:researcher:discord:group:survey-lab",
    messageChannel: "discord",
    channelKey: "discord:group:survey-lab",
    preferredSessionKey: "agent:researcher:discord:group:survey-lab:queued",
    family: "research",
    kind: "survey_review",
    projectId: "paper-lab",
    projectRoot,
    projectsRoot,
    summary: "Queued background workflow for timeout test.",
    runPayload: {
      message: '/survey-pipeline "queued timeout topic"',
      lane: "nested",
      deliver: false,
      idempotencyKey: "queued-timeout-test",
      extraSystemPrompt: null,
    },
  });

  let captured = null;
  const api = makeApi({
    pluginConfig: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    runtime: {
      agent: {
        resolveAgentWorkspaceDir(_cfg, agentId) {
          return `/tmp/workspace-${agentId}`;
        },
      },
      channel: {
        routing: {
          resolveAgentRoute() {
            return {
              agentId: "researcher",
              sessionKey: "agent:researcher:discord:group:survey-lab",
            };
          },
        },
      },
      subagent: {
        async run() {
          return await new Promise(() => {});
        },
      },
    },
  });
  const surveyCommand = getCommand(
    createResearchWorkflowCommands(api, {
      resolveConversationBindingRecord() {
        return {
          targetSessionKey: "agent:researcher:discord:group:survey-lab",
        };
      },
      async buildWorkflowSnapshot(params) {
        captured = {
          ...(captured ?? {}),
          snapshotParams: params,
        };
        return {
          role: "researcher",
          projectRoot: null,
          projectId: null,
          channelProjectBindingsEnabled: true,
        };
      },
      async startBackgroundWorkflowRun(params) {
        captured = {
          ...(captured ?? {}),
          backgroundParams: params,
        };
        return {
          started: true,
          runId: "bg-run-survey-timeout",
          sessionKey: params.agentCtx.sessionKey,
          projectRoot: params.snapshot.projectRoot,
          projectId: params.snapshot.projectId,
          summary: "Background survey pipeline started.",
        };
      },
    }),
    "survey-pipeline"
  );

  const startedAt = Date.now();
  const result = await surveyCommand.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: '/survey-pipeline "OmniModel"',
    args: '"OmniModel"',
    config: {},
    from: "discord:channel:survey-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.text, "Background survey pipeline started.");
  assert.ok(elapsedMs < 3000, `Expected command to respond quickly, got ${elapsedMs}ms`);
  assert.equal(captured.backgroundParams.backgroundRun.kind, "survey_review");
});

test("survey-graph-build command starts a non-blocking literature-review continuation with graph-missing and dedupe guidance", async () => {
  let captured = null;
  const api = makeApi();
  const command = getCommand(
    createResearchWorkflowCommands(api, {
      resolveConversationBindingRecord() {
        return {
          targetSessionKey: "agent:researcher:discord:group:survey-lab",
        };
      },
      async buildWorkflowSnapshot() {
        return {
          role: "researcher",
          projectRoot: "/tmp/projects/survey-lab",
          projectId: "survey-lab",
          channelProjectBindingsEnabled: true,
        };
      },
      async startBackgroundWorkflowRun(params) {
        captured = params;
        return {
          started: true,
          runId: "bg-run-survey-graph-1",
          sessionKey: params.agentCtx.sessionKey,
          projectRoot: params.snapshot.projectRoot,
          projectId: params.snapshot.projectId,
          summary: "Background survey graph build started for survey-lab.",
        };
      },
    }),
    "survey-graph-build"
  );

  const result = await command.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: '/survey-graph-build "graph reasoning survey"',
    args: '"graph reasoning survey"',
    config: {},
    from: "discord:channel:survey-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.equal(result.text, "Background survey graph build started for survey-lab.");
  assert.equal(captured.backgroundRun.kind, "literature_review");
  assert.equal(captured.backgroundRun.projectId, "survey-lab");
  assert.match(captured.backgroundRun.commandText, /^\/literature-review\b/);
  assert.match(captured.backgroundRun.extraSystemPrompt ?? "", /topic-focused survey graph candidate set/i);
  assert.match(captured.backgroundRun.extraSystemPrompt ?? "", /Deduplicate aggressively/i);
  assert.match(captured.backgroundRun.extraSystemPrompt ?? "", /missing from the current shared graph/i);
  assert.match(captured.backgroundRun.extraSystemPrompt ?? "", /SURVEY_GRAPH_BUILD_PACKET\.md/i);
});

test("show-commands command lists the available slash commands and when to use them", async () => {
  const api = makeApi();
  const showCommands = getCommand(createResearchWorkflowCommands(api), "show-commands");

  const result = await showCommands.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: "/show-commands",
    args: undefined,
    config: {},
    from: "discord:channel:paper-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.match(result.text, /Available slash commands:/);
  assert.match(result.text, /\/project-init/);
  assert.match(result.text, /\/auto-research/);
  assert.match(result.text, /\/auto-review/);
  assert.match(result.text, /\/bind-project/);
  assert.match(result.text, /\/research-pipeline/);
  assert.match(result.text, /\/survey-pipeline/);
  assert.match(result.text, /\/clear-project-binding/);
  assert.match(result.text, /\/handoff-status/);
  assert.match(result.text, /\/idea-catalyst-search/);
  assert.match(result.text, /\/broad-paper-search/);
  assert.match(result.text, /\/citation-calibrate/);
  assert.match(result.text, /\/papernexus-stage-remote/);
  assert.match(result.text, /\/authoring-closeout/);
  assert.match(result.text, /\/capture-diagnostics/);
  assert.match(result.text, /\/show-commands/);
  assert.match(result.text, /普通论文从 \/project-init 或 \/research-pipeline 开始/);
});

test("handoff-status command summarizes the current handoff control-plane state", async () => {
  const api = makeApi();
  const command = getCommand(
    createResearchWorkflowCommands(api, {
      resolveConversationBindingRecord() {
        return {
          targetSessionKey: "agent:researcher:discord:group:paper-lab",
        };
      },
      async buildWorkflowSnapshot() {
        return {
          role: "researcher",
          projectRoot: "/tmp/projects/paper-lab",
          projectId: "paper-lab",
          channelProjectBindingsEnabled: true,
        };
      },
      async buildHandoffDashboard() {
        return {
          projectRoot: "/tmp/projects/paper-lab",
          projectId: "paper-lab",
          currentOwner: "researcher",
          pendingHandoffId: "intent-123",
          pendingOwnerCandidate: "academic_writer",
          pendingStageCandidate: "write",
          handoffPhase: "dispatched",
          bindingGate: { allowed: true, reason: "binding_match" },
          queueDepth: 1,
          activeSessionCount: 1,
          pendingMailboxCount: 0,
          intents: [
            {
              intentId: "intent-123",
              status: "dispatched",
              toRole: "academic_writer",
              stageAfter: "write",
              executionId: "exec-1",
              attempts: 1,
              lastAttemptAt: "2026-04-13T11:00:00.000Z",
              ackDeadlineAt: "2026-04-13T11:05:00.000Z",
              claimLeaseExpiresAt: null,
              terminalReason: null,
            },
          ],
        };
      },
    }),
    "handoff-status"
  );

  const result = await command.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: "/handoff-status",
    args: undefined,
    config: {},
    from: "discord:channel:paper-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.match(result.text ?? "", /Handoff status for paper-lab/);
  assert.match(result.text ?? "", /pending_handoff=intent-123/);
  assert.match(result.text ?? "", /phase=dispatched/);
  assert.match(result.text ?? "", /latest_intent=intent-123 \(dispatched -> academic_writer\)/);
});

test("idea-catalyst-search command runs project-bound research30 scouting", async () => {
  let captured = null;
  const api = makeApi();
  const command = getCommand(
    createResearchWorkflowCommands(api, {
      resolveConversationBindingRecord() {
        return {
          targetSessionKey: "agent:researcher:discord:group:paper-lab",
        };
      },
      async buildWorkflowSnapshot() {
        return {
          role: "researcher",
          projectRoot: "/tmp/projects/paper-lab",
          projectId: "paper-lab",
          channelProjectBindingsEnabled: true,
        };
      },
      async runIdeaCatalystResearch30(params) {
        captured = params;
        return {
          queryCount: 4,
          domainCount: 3,
          scoutReportUpdated: true,
          reportJsonPath: "researcher/idea-catalyst/RESEARCH30_SCOUT_REPORT.json",
          reportMarkdownPath: "researcher/idea-catalyst/RESEARCH30_SCOUT_REPORT.md",
        };
      },
    }),
    "idea-catalyst-search"
  );

  const result = await command.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: "/idea-catalyst-search --quick --days 3650",
    args: "--quick --days 3650",
    config: {},
    from: "discord:channel:paper-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.equal(captured.projectRoot, "/tmp/projects/paper-lab");
  assert.equal(captured.depth, "quick");
  assert.equal(captured.days, 3650);
  assert.match(result.text ?? "", /queries=4/);
  assert.match(result.text ?? "", /RESEARCH30_SCOUT_REPORT\.json/);
});

test("citation-calibrate command runs citation calibration for the bound project", async () => {
  let captured = null;
  const api = makeApi();
  const command = getCommand(
    createResearchWorkflowCommands(api, {
      resolveConversationBindingRecord() {
        return {
          targetSessionKey: "agent:academic_writer:discord:group:paper-lab",
        };
      },
      async buildWorkflowSnapshot() {
        return {
          role: "academic_writer",
          projectRoot: "/tmp/projects/paper-lab",
          projectId: "paper-lab",
          channelProjectBindingsEnabled: true,
        };
      },
      async runCitationCalibration(params) {
        captured = params;
        return {
          verifiedCount: 12,
          needsReviewCount: 1,
          suspiciousCount: 0,
          hallucinatedCount: 0,
          reportJsonPath: "reviewer/CITATION_CALIBRATION.json",
          reportMarkdownPath: "reviewer/CITATION_CALIBRATION.md",
        };
      },
    }),
    "citation-calibrate"
  );

  const result = await command.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: "/citation-calibrate --replace-arxiv",
    args: "--replace-arxiv",
    config: {},
    from: "discord:channel:paper-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.equal(captured.projectRoot, "/tmp/projects/paper-lab");
  assert.equal(captured.replaceArxiv, true);
  assert.match(result.text ?? "", /verified=12/);
  assert.match(result.text ?? "", /CITATION_CALIBRATION\.md/);
});

test("papernexus-stage-remote command stages the default manifest for the bound project", async () => {
  let captured = null;
  const api = makeApi();
  const command = getCommand(
    createResearchWorkflowCommands(api, {
      resolveConversationBindingRecord() {
        return {
          targetSessionKey: "agent:researcher:discord:group:paper-lab",
        };
      },
      async buildWorkflowSnapshot() {
        return {
          role: "researcher",
          projectRoot: "/tmp/projects/paper-lab",
          projectId: "paper-lab",
          channelProjectBindingsEnabled: true,
        };
      },
      async stagePapernexusRemoteSources(params) {
        captured = params;
        return {
          available: true,
          reportPath: "researcher/paper-staging/REMOTE_PAPERNEXUS_STAGE.json",
          rewriteManifestOut: "researcher/paper-staging/batch-import.remote.json",
        };
      },
    }),
    "papernexus-stage-remote"
  );

  const result = await command.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: "/papernexus-stage-remote --ssh-target hyq@10.0.0.1 --remote-base-dir /srv/pn",
    args: "--ssh-target hyq@10.0.0.1 --remote-base-dir /srv/pn",
    config: {},
    from: "discord:channel:paper-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.equal(captured.projectRoot, "/tmp/projects/paper-lab");
  assert.equal(captured.sshTarget, "hyq@10.0.0.1");
  assert.equal(captured.remoteBaseDir, "/srv/pn");
  assert.equal(captured.manifestPath, "researcher/paper-staging/batch-import.json");
  assert.match(result.text ?? "", /REMOTE_PAPERNEXUS_STAGE\.json/);
});

test("authoring-closeout command runs deterministic closeout for the bound project", async () => {
  let captured = null;
  const api = makeApi();
  const command = getCommand(
    createResearchWorkflowCommands(api, {
      resolveConversationBindingRecord() {
        return {
          targetSessionKey: "agent:academic_writer:discord:group:paper-lab",
        };
      },
      async buildWorkflowSnapshot() {
        return {
          role: "academic_writer",
          projectRoot: "/tmp/projects/paper-lab",
          projectId: "paper-lab",
          channelProjectBindingsEnabled: true,
        };
      },
      async reconcileAuthoringCloseout(params) {
        captured = params;
        return {
          paperMode: "conference",
          nextStage: "submit",
          citeCount: 7,
          sectionCount: 8,
          mainPdfExists: true,
          citationIntegrity: { verificationStatus: "verified" },
          reviewSession: { status: "completed" },
        };
      },
    }),
    "authoring-closeout"
  );

  const result = await command.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: "/authoring-closeout --no-compile",
    args: "--no-compile",
    config: {},
    from: "discord:channel:paper-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.equal(captured.projectRoot, "/tmp/projects/paper-lab");
  assert.equal(captured.compilePdf, false);
  assert.equal(captured.autoInjectConferenceCitations, true);
  assert.match(result.text ?? "", /stage=submit/);
  assert.match(result.text ?? "", /citation_status=verified/);
});

test("capture-diagnostics command materializes a diagnostic bundle for the bound project", async () => {
  let captured = null;
  const api = makeApi();
  const command = getCommand(
    createResearchWorkflowCommands(api, {
      resolveConversationBindingRecord() {
        return {
          targetSessionKey: "agent:researcher:discord:group:paper-lab",
        };
      },
      async buildWorkflowSnapshot() {
        return {
          role: "researcher",
          projectRoot: "/tmp/projects/paper-lab",
          projectId: "paper-lab",
          channelProjectBindingsEnabled: true,
        };
      },
      async captureWorkflowDiagnosticBundle(params) {
        captured = params;
        return {
          bundleRelativeDir: ".openclaw-research/diagnostics/2026-04-13T11-00-00Z-manual-capture",
          summaryRelativePath:
            ".openclaw-research/diagnostics/2026-04-13T11-00-00Z-manual-capture/SUMMARY.md",
          indexRelativePath:
            ".openclaw-research/diagnostics/2026-04-13T11-00-00Z-manual-capture/INDEX.json",
        };
      },
    }),
    "capture-diagnostics"
  );

  const result = await command.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: "/capture-diagnostics --reason discord_timeout --tail 120",
    args: "--reason discord_timeout --tail 120",
    config: {},
    from: "discord:channel:paper-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.equal(captured.projectRoot, "/tmp/projects/paper-lab");
  assert.equal(captured.reason, "discord_timeout");
  assert.equal(captured.tailLines, 120);
  assert.match(result.text ?? "", /Diagnostic bundle captured/);
  assert.match(result.text ?? "", /SUMMARY\.md/);
  assert.match(result.text ?? "", /INDEX\.json/);
});

test("clear-project-binding command removes the workflow project binding for the current channel", async () => {
  let captured = null;
  const api = makeApi();
  const clearBinding = getCommand(
    createResearchWorkflowCommands(api, {
      resolveConversationBindingRecord() {
        return {
          targetSessionKey: "agent:researcher:discord:group:paper-lab",
        };
      },
      async unbindChannelProjectForWorkflow(params) {
        captured = params;
        return {
          enabled: true,
          storePath: "/tmp/channel-project-bindings.json",
          channelKey: params.channelKey ?? null,
          removed: true,
        };
      },
    }),
    "clear-project-binding"
  );

  const result = await clearBinding.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: "/clear-project-binding",
    args: undefined,
    config: {},
    from: "discord:channel:paper-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.match(result.text, /Cleared the workflow project binding for this channel\./);
  assert.equal(captured.messageChannel, "discord");
  assert.equal(
    captured.channelKey,
    "binding:discord:default:channel:paper-lab"
  );
});

test("bind-project command binds the current channel to an existing workflow project", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = await makeProject(projectsRoot, "alpha", "code");
  let captured = null;

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  const api = makeApi({
    pluginConfig: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
  });
  const bindProject = getCommand(
    createResearchWorkflowCommands(api, {
      resolveConversationBindingRecord() {
        return {
          targetSessionKey: "agent:researcher:discord:group:paper-lab",
        };
      },
      async bindChannelProjectForWorkflow(params) {
        captured = params;
        return {
          enabled: true,
          storePath: "/tmp/channel-project-bindings.json",
          channelKey: params.channelKey ?? null,
          binding: {
            projectRoot: params.projectRoot,
            projectId: params.projectId,
          },
        };
      },
    }),
    "bind-project"
  );

  const result = await bindProject.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: '/bind-project "alpha"',
    args: '"alpha"',
    config: {},
    from: "discord:channel:paper-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.match(result.text, /Bound this channel to workflow project alpha\./);
  assert.equal(captured.projectId, "alpha");
  assert.equal(captured.projectRoot, projectRoot);
  assert.equal(captured.messageChannel, "discord");
  assert.equal(
    captured.channelKey,
    "binding:discord:default:channel:paper-lab"
  );
});

test("clear-project-binding command rejects direct conversations", async () => {
  const api = makeApi();
  const clearBinding = getCommand(
    createResearchWorkflowCommands(api),
    "clear-project-binding"
  );

  const result = await clearBinding.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: "/clear-project-binding",
    args: undefined,
    config: {},
    from: "discord:user:12345",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.match(result.text, /必须在要清理绑定的频道或群组会话里调用/);
});

test("bind-project command rejects direct conversations", async () => {
  const api = makeApi();
  const bindProject = getCommand(
    createResearchWorkflowCommands(api),
    "bind-project"
  );

  const result = await bindProject.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: '/bind-project "alpha"',
    args: '"alpha"',
    config: {},
    from: "discord:user:12345",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.match(result.text, /必须在要绑定的频道或群组会话里调用/);
});

test("literature-review command starts a project-bound background continuation on the bound researcher session", async () => {
  let captured = null;
  const api = makeApi();
  const literatureCommand = getCommand(
    createResearchWorkflowCommands(api, {
      resolveConversationBindingRecord() {
        return {
          targetSessionKey: "agent:researcher:discord:group:paper-lab",
        };
      },
      async buildWorkflowSnapshot() {
        return {
          role: "researcher",
          projectRoot: "/tmp/projects/paper-lab",
          projectId: "paper-lab",
          channelProjectBindingsEnabled: true,
        };
      },
      async startBackgroundWorkflowRun(params) {
        captured = params;
        return {
          started: true,
          runId: "bg-run-literature-1",
          sessionKey: params.agentCtx.sessionKey,
          projectRoot: params.snapshot.projectRoot,
          projectId: params.snapshot.projectId,
          summary: "Background literature review started.",
        };
      },
    }),
    "literature-review"
  );

  const result = await literatureCommand.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: '/literature-review "baseline coverage refresh"',
    args: '"baseline coverage refresh"',
    config: {},
    from: "discord:channel:paper-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.equal(result.text, "Background literature review started.");
  assert.equal(captured.agentCtx.sessionKey, "agent:researcher:discord:group:paper-lab");
  assert.equal(captured.backgroundRun.kind, "literature_review");
  assert.equal(captured.backgroundRun.projectId, "paper-lab");
  assert.equal(captured.backgroundRun.projectRoot, "/tmp/projects/paper-lab");
  assert.equal(captured.backgroundRun.topic, "baseline coverage refresh");
  assert.match(captured.backgroundRun.commandText, /^\/literature-review\b/);
});

test("project-init command scaffolds a project and seeds the onboarding contract", async (t) => {
  const projectsRoot = await makeProjectsRoot();

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  const api = makeApi({
    pluginConfig: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
  });
  const projectInitCommand = getCommand(
    createResearchWorkflowCommands(api),
    "project-init"
  );

  const result = await projectInitCommand.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: '/project-init "gcd confirmation bias mitigation"',
    args: '"gcd confirmation bias mitigation"',
    config: {},
    from: "discord:channel:gcd-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  const projectRoot = path.join(projectsRoot, "gcd-confirmation-bias-mitigation");
  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );

  assert.match(
    result.text ?? "",
    /Project init saved for gcd-confirmation-bias-mitigation/i
  );
  assert.match(
    result.text ?? "",
    /missing=baseline_reference, primary_metric, datasets, success_criteria/i
  );
  assert.equal(manifest.project_id, "gcd-confirmation-bias-mitigation");
  assert.equal(
    manifest.research_program.goal,
    "gcd confirmation bias mitigation"
  );
  assert.equal(
    manifest.research_program.problem_statement,
    "gcd confirmation bias mitigation"
  );
  assert.equal(
    manifest.research_program.zotero_project_path,
    "bot/gcd-confirmation-bias-mitigation"
  );
  assert.equal(manifest.research_program.status, "draft");
});

test("auto-research command bootstraps topic-only onboarding and starts the background pipeline", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  let captured = null;

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  const api = makeApi({
    pluginConfig: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
  });
  const autoResearchCommand = getCommand(
    createResearchWorkflowCommands(api, {
      async bindChannelProjectForWorkflow(params) {
        captured = {
          ...(captured ?? {}),
          boundProject: params,
        };
        return {
          binding: {
            channelKey: params.channelKey ?? "discord:group:gcd-lab",
            projectRoot: params.projectRoot,
            projectId: params.projectId,
          },
        };
      },
      async startBackgroundWorkflowRun(params) {
        captured = {
          ...(captured ?? {}),
          backgroundParams: params,
        };
        return {
          started: true,
          runId: "bg-run-auto-1",
          sessionKey: params.agentCtx.sessionKey,
          projectRoot: params.backgroundRun.projectRoot,
          projectId: params.backgroundRun.projectId,
          summary: "Full-auto research pipeline started.",
        };
      },
    }),
    "auto-research"
  );

  const result = await autoResearchCommand.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: '/auto-research "gcd confirmation bias mitigation"',
    args: '"gcd confirmation bias mitigation"',
    config: {},
    from: "discord:channel:gcd-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  const projectRoot = path.join(projectsRoot, "gcd-confirmation-bias-mitigation");
  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );

  await assertWorkflowProjectScaffold(projectRoot);
  assert.match(result.text ?? "", /Full-auto research pipeline started/i);
  assert.equal(manifest.current_stage, "setup");
  assert.equal(manifest.current_micro_stage, "project_init");
  assert.equal(typeof manifest.idle_research, "object");
  assert.equal(manifest.idle_research.enabled, false);
  assert.equal(manifest.idle_research.status, "disabled");
  assert.equal(
    manifest.research_program.baseline_reference,
    "gcd confirmation bias mitigation literature baseline (auto-bootstrap)"
  );
  assert.equal(
    manifest.research_program.primary_metric,
    "literature-grounded primary metric (auto-bootstrap)"
  );
  assert.deepEqual(manifest.research_program.datasets, [
    "gcd confirmation bias mitigation target dataset (auto-bootstrap)",
  ]);
  assert.ok(
    manifest.research_program.success_criteria[0]?.includes(
      "literature-grounded baseline"
    )
  );
  assert.equal(captured.boundProject.projectId, "gcd-confirmation-bias-mitigation");
  assert.equal(manifest.writing_contract.paper_mode, "conference");
  assert.equal(manifest.writing_contract.storyline_source, "idea_catalyst");
  assert.equal(manifest.writing_contract.kg_storyline_required, true);
  assert.equal(manifest.graph_guided_writing.enabled, true);
  assert.equal(manifest.graph_guided_writing.status, "pending");
  assert.equal(manifest.graph_guided_writing.citation_source_mode, "graph_only");
  assert.equal(captured.backgroundParams.backgroundRun.kind, "research_pipeline");
  assert.match(
    captured.backgroundParams.backgroundRun.commandText,
    /AUTO_PROCEED:\s*true/i
  );
});

test("auto-review command bootstraps a survey project and starts the background survey pipeline", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  let captured = null;

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  const api = makeApi({
    pluginConfig: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
  });
  const autoReviewCommand = getCommand(
    createResearchWorkflowCommands(api, {
      async bindChannelProjectForWorkflow(params) {
        captured = {
          ...(captured ?? {}),
          boundProject: params,
        };
        return {
          binding: {
            channelKey: params.channelKey ?? "discord:group:survey-lab",
            projectRoot: params.projectRoot,
            projectId: params.projectId,
          },
        };
      },
      async startBackgroundWorkflowRun(params) {
        captured = {
          ...(captured ?? {}),
          backgroundParams: params,
        };
        return {
          started: true,
          runId: "bg-run-auto-review-1",
          sessionKey: params.agentCtx.sessionKey,
          projectRoot: params.backgroundRun.projectRoot,
          projectId: params.backgroundRun.projectId,
          summary: "Full-auto survey pipeline started.",
        };
      },
    }),
    "auto-review"
  );

  const result = await autoReviewCommand.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: '/auto-review "graph reasoning survey"',
    args: '"graph reasoning survey"',
    config: {},
    from: "discord:channel:survey-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  const projectRoot = captured.boundProject.projectRoot;
  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );

  await assertWorkflowProjectScaffold(projectRoot);
  assert.match(result.text ?? "", /Full-auto survey pipeline started/i);
  assert.equal(manifest.current_stage, "survey_review");
  assert.equal(manifest.current_micro_stage, "retrieval");
  assert.equal(manifest.workflow_line, "survey");
  assert.equal(typeof manifest.idle_research, "object");
  assert.equal(manifest.idle_research.enabled, false);
  assert.equal(manifest.writing_contract.paper_mode, "survey");
  assert.equal(manifest.writing_contract.storyline_source, "survey_packet");
  assert.equal(manifest.writing_contract.kg_storyline_required, false);
  assert.equal(manifest.graph_guided_writing.enabled, false);
  assert.equal(manifest.graph_guided_writing.status, "optional");
  assert.equal(captured.boundProject.projectId, "survey-graph-reasoning-survey");
  assert.equal(captured.backgroundParams.backgroundRun.kind, "survey_review");
  assert.match(
    captured.backgroundParams.backgroundRun.commandText,
    /^\/survey-pipeline\b/
  );
});

test("auto-research keeps project naming clean while preserving richer request context", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  let captured = null;

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  const api = makeApi({
    pluginConfig: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
  });
  const autoResearchCommand = getCommand(
    createResearchWorkflowCommands(api, {
      async bindChannelProjectForWorkflow(params) {
        captured = {
          ...(captured ?? {}),
          boundProject: params,
        };
        return {
          binding: {
            channelKey: params.channelKey ?? "discord:group:gcd-lab",
            projectRoot: params.projectRoot,
            projectId: params.projectId,
          },
        };
      },
      async startBackgroundWorkflowRun(params) {
        captured = {
          ...(captured ?? {}),
          backgroundParams: params,
        };
        return {
          started: true,
          runId: "bg-run-auto-rich-1",
          sessionKey: params.agentCtx.sessionKey,
          projectRoot: params.backgroundRun.projectRoot,
          projectId: params.backgroundRun.projectId,
          summary: "Full-auto research pipeline started.",
        };
      },
    }),
    "auto-research"
  );

  const commandBody =
    '/auto-research "gcd confirmation bias mitigation" 参考 SimGCD 和 Uno 的方法；要求保留 baseline fairness；重点验证 CUB-200';
  const result = await autoResearchCommand.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody,
    args:
      '"gcd confirmation bias mitigation" 参考 SimGCD 和 Uno 的方法；要求保留 baseline fairness；重点验证 CUB-200',
    config: {},
    from: "discord:channel:gcd-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  const projectRoot = path.join(projectsRoot, "gcd-confirmation-bias-mitigation");
  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );

  assert.equal(captured.boundProject.projectId, "gcd-confirmation-bias-mitigation");
  assert.equal(captured.backgroundParams.backgroundRun.topic, "gcd confirmation bias mitigation");
  assert.match(result.text ?? "", /preserved_request=/i);
  assert.equal(manifest.bootstrap_request.clean_topic, "gcd confirmation bias mitigation");
  assert.match(manifest.bootstrap_request.raw_request, /SimGCD/);
  assert.equal(Array.isArray(manifest.bootstrap_request.reference_hints), true);
  assert.equal(manifest.bootstrap_request.reference_hints.length >= 1, true);
  assert.equal(Array.isArray(manifest.bootstrap_request.explicit_requirements), true);
  assert.equal(manifest.bootstrap_request.explicit_requirements.length >= 1, true);
  assert.equal(
    manifest.research_program.constraints.some((entry) => /SimGCD|Uno|baseline fairness|CUB-200/i.test(entry)),
    true
  );
  assert.match(captured.boundProject.notes ?? "", /Full request:/i);
  assert.match(
    captured.backgroundParams.backgroundRun.extraSystemPrompt ?? "",
    /Paper \/ method references to consider:/i
  );
  assert.match(
    captured.backgroundParams.backgroundRun.extraSystemPrompt ?? "",
    /Explicit user requirements:/i
  );
});

test("auto-review can derive a clean survey project name from an unquoted rich request", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  let captured = null;

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  const api = makeApi({
    pluginConfig: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
  });
  const autoReviewCommand = getCommand(
    createResearchWorkflowCommands(api, {
      async bindChannelProjectForWorkflow(params) {
        captured = {
          ...(captured ?? {}),
          boundProject: params,
        };
        return {
          binding: {
            channelKey: params.channelKey ?? "discord:group:survey-lab",
            projectRoot: params.projectRoot,
            projectId: params.projectId,
          },
        };
      },
      async startBackgroundWorkflowRun(params) {
        captured = {
          ...(captured ?? {}),
          backgroundParams: params,
        };
        return {
          started: true,
          runId: "bg-run-auto-review-rich-1",
          sessionKey: params.agentCtx.sessionKey,
          projectRoot: params.backgroundRun.projectRoot,
          projectId: params.backgroundRun.projectId,
          summary: "Full-auto survey pipeline started.",
        };
      },
    }),
    "auto-review"
  );

  const args =
    "graph reasoning survey 参考 GraphRAG Survey 2024 的分类方式，要求突出 benchmark gaps";
  const result = await autoReviewCommand.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: `/auto-review ${args}`,
    args,
    config: {},
    from: "discord:channel:survey-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  const projectRoot = captured.boundProject.projectRoot;
  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );

  assert.equal(captured.boundProject.projectId, "survey-graph-reasoning-survey");
  assert.equal(captured.backgroundParams.backgroundRun.topic, "graph reasoning survey");
  assert.equal(manifest.bootstrap_request.clean_topic, "graph reasoning survey");
  assert.match(manifest.bootstrap_request.raw_request, /GraphRAG Survey 2024/i);
  assert.equal(manifest.bootstrap_request.reference_hints.length >= 1, true);
  assert.equal(manifest.bootstrap_request.explicit_requirements.length >= 1, true);
  assert.match(result.text ?? "", /preserved_request=/i);
  assert.match(captured.boundProject.notes ?? "", /Full request:/i);
  assert.match(
    captured.backgroundParams.backgroundRun.extraSystemPrompt ?? "",
    /GraphRAG Survey 2024/i
  );
  assert.match(
    captured.backgroundParams.backgroundRun.commandText,
    /\/survey-pipeline "graph reasoning survey"/i
  );
});

test("project-init command uses the configured plugin-global Zotero root for new projects", async (t) => {
  const projectsRoot = await makeProjectsRoot();

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  const api = makeApi({
    pluginConfig: {
      enableChannelProjectBindings: true,
      projectsRoot,
      zoteroProjectRoot: "Bot",
    },
  });
  const projectInitCommand = getCommand(
    createResearchWorkflowCommands(api),
    "project-init"
  );

  await projectInitCommand.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: '/project-init "gcd confirmation bias mitigation"',
    args: '"gcd confirmation bias mitigation"',
    config: {},
    from: "discord:channel:gcd-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  const projectRoot = path.join(projectsRoot, "gcd-confirmation-bias-mitigation");
  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );

  assert.equal(
    manifest.research_program.zotero_project_path,
    "Bot/gcd-confirmation-bias-mitigation"
  );
});

test("research-queue command refuses to run from a non-researcher session", async () => {
  const queueCommand = getCommand(createResearchWorkflowCommands(makeApi(), {
    resolveConversationBindingRecord() {
      return {
        targetSessionKey: "agent:coder:discord:group:paper-lab",
      };
    },
  }), "research-queue");

  const result = await queueCommand.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: '/research-queue add "next experiment"',
    args: 'add "next experiment"',
    config: {},
    from: "discord:channel:paper-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.match(result.text ?? "", /Researcher workflow session/i);
  assert.match(result.text ?? "", /coder/i);
});

test("resume-pipeline command starts a background continuation for an explicit existing project id", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = path.join(projectsRoot, "paper-lab");
  let captured = null;

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify({ project_id: "paper-lab", current_stage: "graph_build" }, null, 2)}\n`,
    "utf8"
  );

  const api = makeApi({
    pluginConfig: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
  });
  const resumeCommand = getCommand(createResearchWorkflowCommands(api, {
    resolveConversationBindingRecord() {
      return {
        targetSessionKey: "agent:coder:discord:group:paper-lab",
      };
    },
    async buildWorkflowSnapshot() {
      return {
        role: "coder",
        projectRoot: null,
        projectId: null,
        projectResolutionSource: "none",
        channelProjectBindingsEnabled: true,
        unreadMailbox: [],
        idleResearchEnabled: false,
        idleResearchDue: false,
        idleResearchTopic: null,
      };
    },
    async startBackgroundWorkflowRun(params) {
      captured = params;
      return {
        started: true,
        runId: "bg-run-resume",
        sessionKey: params.agentCtx.sessionKey,
        projectRoot: params.snapshot.projectRoot,
        projectId: params.snapshot.projectId,
        summary: "Background resume pipeline started for paper-lab.",
      };
    },
  }), "resume-pipeline");

  const result = await resumeCommand.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: "/resume-pipeline paper-lab",
    args: "paper-lab",
    config: {},
    from: "discord:channel:paper-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.equal(result.text, "Background resume pipeline started for paper-lab.");
  assert.equal(captured.snapshot.projectRoot, projectRoot);
  assert.equal(captured.snapshot.projectId, "paper-lab");
  assert.equal(captured.backgroundRun.projectRoot, projectRoot);
  assert.equal(captured.backgroundRun.projectId, "paper-lab");
  assert.equal(captured.backgroundRun.kind, "resume_pipeline");
});

test("resume-pipeline command queues the continuation instead of failing when runtime subagent access is unavailable", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = path.join(projectsRoot, "paper-lab");

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify({ project_id: "paper-lab", current_stage: "graph_build" }, null, 2)}\n`,
    "utf8"
  );

  const api = makeApi({
    pluginConfig: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    runtime: {
      agent: {
        resolveAgentWorkspaceDir(_cfg, agentId) {
          return `/tmp/workspace-${agentId}`;
        },
      },
      channel: {
        routing: {
          resolveAgentRoute() {
            return {
              agentId: "main",
              sessionKey: "agent:main:discord:channel:paper-lab",
            };
          },
        },
      },
      subagent: {
        async run() {
          throw new Error(
            "Plugin runtime subagent methods are only available during a gateway request."
          );
        },
      },
    },
  });
  const resumeCommand = getCommand(createResearchWorkflowCommands(api, {
    resolveConversationBindingRecord() {
      return {
        targetSessionKey: "agent:coder:discord:group:paper-lab",
      };
    },
    async buildWorkflowSnapshot() {
      return {
        role: "coder",
        projectRoot: null,
        projectId: null,
        projectResolutionSource: "none",
        channelProjectBindingsEnabled: true,
        unreadMailbox: [],
        idleResearchEnabled: false,
        idleResearchDue: false,
        idleResearchTopic: null,
      };
    },
  }), "resume-pipeline");

  const result = await resumeCommand.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: "/resume-pipeline paper-lab",
    args: "paper-lab",
    config: {},
    from: "discord:channel:paper-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.match(result.text ?? "", /queued background workflow/i);
  assert.match(result.text ?? "", /gateway-bound subagent/i);
  assert.match(result.text ?? "", /later workflow command|workflow coordinator/i);

  const runtimeQueue = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(runtimeQueue.entries.length, 1);
  assert.equal(runtimeQueue.entries[0].status, "degraded");
  assert.equal(runtimeQueue.entries[0].kind, "resume_pipeline");
  const drained = await drainQueuedBackgroundWorkflowRuns({
    projectsRoot,
  });
  assert.equal(drained.remaining.length, 1);
  assert.ok(["queued", "degraded"].includes(drained.remaining[0].status));
  assert.equal(drained.remaining[0].kind, "resume_pipeline");
});

test("graph-build command starts a background continuation for the current project and routes it to Researcher", async () => {
  let captured = null;
  const api = makeApi();
  const graphBuildCommand = getCommand(
    createResearchWorkflowCommands(api, {
      resolveConversationBindingRecord() {
        return {
          targetSessionKey: "agent:orchestrator:discord:group:paper-lab",
        };
      },
      async buildWorkflowSnapshot() {
        return {
          role: "orchestrator",
          projectRoot: "/tmp/projects/paper-lab",
          projectId: "paper-lab",
          projectResolutionSource: "channel_binding",
          channelProjectBindingsEnabled: true,
          unreadMailbox: [],
          idleResearchEnabled: false,
          idleResearchDue: false,
          idleResearchTopic: null,
        };
      },
      async startBackgroundWorkflowRun(params) {
        captured = params;
        return {
          started: true,
          runId: "bg-run-graph-build",
          sessionKey: "agent:researcher:discord:group:paper-lab:subagent:graph-build",
          projectRoot: params.snapshot.projectRoot,
          projectId: params.snapshot.projectId,
          summary: "Background graph build started for paper-lab.",
        };
      },
    }),
    "graph-build"
  );

  const result = await graphBuildCommand.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: '/graph-build "gcd confirmation bias mitigation"',
    args: '"gcd confirmation bias mitigation"',
    config: {},
    from: "discord:channel:paper-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.equal(result.text, "Background graph build started for paper-lab.");
  assert.equal(captured.agentCtx.agentId, "researcher");
  assert.equal(captured.agentCtx.workspaceDir, "/tmp/workspace-researcher");
  assert.equal(captured.backgroundRun.kind, "graph_build");
  assert.equal(captured.backgroundRun.projectId, "paper-lab");
  assert.equal(captured.backgroundRun.projectRoot, "/tmp/projects/paper-lab");
  assert.match(captured.backgroundRun.commandText, /^\/graph-build\b/);
  assert.match(captured.backgroundRun.commandText, /__BACKGROUND_CONTINUATION__:\s*true/i);
});

test("graph-build command auto-injects repair flags when paper ingestion requires a graph sync repair", async () => {
  let captured = null;
  const api = makeApi();
  const graphBuildCommand = getCommand(
    createResearchWorkflowCommands(api, {
      resolveConversationBindingRecord() {
        return {
          targetSessionKey: "agent:orchestrator:discord:group:paper-lab",
        };
      },
      async buildWorkflowSnapshot() {
        return {
          role: "orchestrator",
          projectRoot: "/tmp/projects/paper-lab",
          projectId: "paper-lab",
          projectResolutionSource: "channel_binding",
          channelProjectBindingsEnabled: true,
          unreadMailbox: [],
          idleResearchEnabled: false,
          idleResearchDue: false,
          idleResearchTopic: null,
          paperIngestionRepairRequired: true,
          paperIngestionRepairTargetCorpus: "GCD",
        };
      },
      async startBackgroundWorkflowRun(params) {
        captured = params;
        return {
          started: true,
          runId: "bg-run-graph-build-repair",
          sessionKey: "agent:researcher:discord:group:paper-lab:subagent:graph-build",
          projectRoot: params.snapshot.projectRoot,
          projectId: params.snapshot.projectId,
          summary: "Background graph build started for paper-lab.",
        };
      },
    }),
    "graph-build"
  );

  const result = await graphBuildCommand.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: "/graph-build",
    args: "",
    config: {},
    from: "discord:channel:paper-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.equal(result.text, "Background graph build started for paper-lab.");
  assert.match(captured.backgroundRun.commandText, /\/graph-build\b/);
  assert.match(captured.backgroundRun.commandText, /--repair-import true/i);
  assert.match(captured.backgroundRun.commandText, /--shared-corpus "?GCD"?/i);
});

test("zotero-sync command starts a background continuation for the current project and routes it to Researcher", async () => {
  let captured = null;
  const api = makeApi();
  const zoteroSyncCommand = getCommand(
    createResearchWorkflowCommands(api, {
      resolveConversationBindingRecord() {
        return {
          targetSessionKey: "agent:orchestrator:discord:group:paper-lab",
        };
      },
      async buildWorkflowSnapshot() {
        return {
          role: "orchestrator",
          projectRoot: "/tmp/projects/paper-lab",
          projectId: "paper-lab",
          projectResolutionSource: "channel_binding",
          channelProjectBindingsEnabled: true,
          unreadMailbox: [],
          idleResearchEnabled: false,
          idleResearchDue: false,
          idleResearchTopic: null,
        };
      },
      async startBackgroundWorkflowRun(params) {
        captured = params;
        return {
          started: true,
          runId: "bg-run-zotero-sync",
          sessionKey: "agent:researcher:discord:group:paper-lab:subagent:zotero-sync",
          projectRoot: params.snapshot.projectRoot,
          projectId: params.snapshot.projectId,
          summary: "Background Zotero sync started for paper-lab.",
        };
      },
    }),
    "zotero-sync"
  );

  const result = await zoteroSyncCommand.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: '/zotero-sync "paper-lab"',
    args: '"paper-lab"',
    config: {},
    from: "discord:channel:paper-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.equal(result.text, "Background Zotero sync started for paper-lab.");
  assert.equal(captured.agentCtx.agentId, "researcher");
  assert.equal(captured.agentCtx.workspaceDir, "/tmp/workspace-researcher");
  assert.equal(captured.backgroundRun.kind, "zotero_sync");
  assert.equal(captured.backgroundRun.projectId, "paper-lab");
  assert.equal(captured.backgroundRun.projectRoot, "/tmp/projects/paper-lab");
  assert.match(captured.backgroundRun.commandText, /^\/zotero-sync\b/);
  assert.match(captured.backgroundRun.commandText, /__BACKGROUND_CONTINUATION__:\s*true/i);
});

test("workflow commands opportunistically replay queued background runs when runtime access returns", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = path.join(projectsRoot, "paper-lab");
  const runCalls = [];

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify({ project_id: "paper-lab", current_stage: "graph_build" }, null, 2)}\n`,
    "utf8"
  );

  const unavailableApi = makeApi({
    pluginConfig: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    runtime: {
      agent: {
        resolveAgentWorkspaceDir(_cfg, agentId) {
          return `/tmp/workspace-${agentId}`;
        },
      },
      channel: {
        routing: {
          resolveAgentRoute() {
            return {
              agentId: "main",
              sessionKey: "agent:main:discord:channel:paper-lab",
            };
          },
        },
      },
      subagent: {
        async run() {
          throw new Error(
            "Plugin runtime subagent methods are only available during a gateway request."
          );
        },
      },
    },
  });

  const resumeCommand = getCommand(
    createResearchWorkflowCommands(unavailableApi, {
      resolveConversationBindingRecord() {
        return {
          targetSessionKey: "agent:researcher:discord:group:paper-lab",
        };
      },
      async buildWorkflowSnapshot() {
        return {
          role: "researcher",
          projectRoot,
          projectId: "paper-lab",
          projectResolutionSource: "channel_binding",
          channelProjectBindingsEnabled: true,
          unreadMailbox: [],
          idleResearchEnabled: false,
          idleResearchDue: false,
          idleResearchTopic: null,
        };
      },
    }),
    "resume-pipeline"
  );

  await resumeCommand.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: "/resume-pipeline paper-lab",
    args: "paper-lab",
    config: {},
    from: "discord:channel:paper-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  const queuedBefore = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(queuedBefore.entries.length, 1);

  const recoveredApi = makeApi({
    pluginConfig: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    runtime: {
      agent: {
        resolveAgentWorkspaceDir(_cfg, agentId) {
          return `/tmp/workspace-${agentId}`;
        },
      },
      channel: {
        routing: {
          resolveAgentRoute() {
            return {
              agentId: "main",
              sessionKey: "agent:main:discord:channel:paper-lab",
            };
          },
        },
      },
      subagent: {
        async run(params) {
          runCalls.push(params);
          return { runId: `bg-run-${runCalls.length}` };
        },
      },
    },
  });

  const statusCommand = getCommand(
    createResearchWorkflowCommands(recoveredApi, {
      resolveConversationBindingRecord() {
        return {
          targetSessionKey: "agent:researcher:discord:group:paper-lab",
        };
      },
      async buildWorkflowSnapshot() {
        return {
          role: "researcher",
          projectRoot,
          projectId: "paper-lab",
          projectResolutionSource: "channel_binding",
          currentStage: "graph_build",
          currentMicroStage: "graph_refresh_requested",
          ownerAgent: "researcher",
          recommendedOwner: "researcher",
          nextAction: "/graph-build",
          resumeAction: "/resume-pipeline paper-lab",
          blockingReason: null,
          unreadMailbox: [],
          idleResearchEnabled: false,
          idleResearchDue: false,
          idleResearchTopic: null,
        };
      },
      async runWorkflowAutoIterator() {
        return null;
      },
    }),
    "workflow-status"
  );

  await statusCommand.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: "/workflow-status",
    args: undefined,
    config: {},
    from: "discord:channel:paper-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.ok(runCalls.length >= 1);
  assert.match(runCalls[0].message ?? "", /\/resume-pipeline\b/i);

  const queuedAfter = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(queuedAfter.entries.length, 1);
  assert.equal(queuedAfter.entries[0].status, "running");
});

test("workflow-status command returns a readable workflow summary", async () => {
  const api = makeApi();
  const statusCommand = getCommand(createResearchWorkflowCommands(api, {
    resolveConversationBindingRecord() {
      return {
        targetSessionKey: "agent:researcher:discord:group:paper-lab",
      };
    },
    async buildWorkflowSnapshot() {
      return {
        role: "researcher",
        projectRoot: "/tmp/projects/paper-lab",
        projectId: "paper-lab",
        projectResolutionSource: "channel_binding",
        currentStage: "experiment",
        currentMicroStage: "monitoring",
        ownerAgent: "researcher",
        recommendedOwner: "researcher",
        nextAction: "/monitor-experiment",
        resumeAction: "/resume-pipeline paper-lab",
        blockingReason: null,
        unreadMailbox: [{ id: "msg-1" }, { id: "msg-2" }],
        idleResearchEnabled: true,
        idleResearchDue: true,
        idleResearchTopic: "spectral clustering under drift",
        graphRefreshRequired: true,
        graphRefreshReason: "new core papers found",
        paperIngestionRuntimeStatus: "waiting_graph",
        paperIngestionImportTaskCount: 3,
        paperIngestionCompletedPaperCount: 11,
        paperIngestionActiveOperationCount: 2,
        paperIngestionTimedOutOperationCount: 1,
        paperIngestionFailedOperationCount: 0,
        paperIngestionBatchCount: 1,
        paperIngestionActiveBatchCount: 1,
        paperIngestionPendingBatchItemCount: 9,
        paperIngestionSyncedBatchItemCount: 4,
        paperIngestionFailedBatchItemCount: 1,
        paperIngestionLastBatchManifestPath: "/tmp/demo/batch-import.json",
        paperIngestionReconcileRequired: true,
        ideationContractStatus: "ready",
        ideationContractSelectedDirectionId: "dir-2",
        ideationContractSelectedTrackId: "track-idea-1",
        ideationContractIdeaTreePath: "researcher/ideation/IDEA_TREE.md",
        ideationContractResearchProposalPath:
          "researcher/ideation/RESEARCH_PROPOSAL.md",
        ideationContractRankingHistoryPath:
          "researcher/ideation/RANKING_HISTORY.json",
        ideationContractTournamentScoreboardPath:
          "researcher/ideation/TOURNAMENT_SCOREBOARD.json",
        ideationContractTop3SummaryPath:
          "researcher/ideation/TOP3_DIRECTION_SUMMARY.md",
        ideationContractGraphPacketPath:
          "researcher/ideation/GRAPH_IDEATION_PACKET.json",
        ideaCatalystStatus: "ready",
        ideaCatalystMode: "graph-first",
        ideaCatalystMicroStage: "judging",
        ideaCatalystTargetDomain: "Computer Science",
        ideaCatalystSourceDomainCount: 2,
        ideaCatalystBridgeCount: 5,
        ideaCatalystTopFragmentId: "frag-1",
        ideaCatalystRequisitionRequired: true,
        ideaCatalystLastRequisitionCycle: "req-computer-science-2-2",
        ideaCatalystRequisitionRetryBudget: 1,
        ideaCatalystRequisitionSaturated: false,
        ideaCatalystPendingReason:
          "Cross-domain bridge evidence is still insufficient for unresolved catalyst questions.",
        innovationReflectionStatus: "stale",
        innovationReflectionDue: true,
        researchProgramStatus: "draft",
        researchProgramTrackCount: 2,
        researchProgramActiveTrackCount: 1,
        researchProgramPrimaryGoal:
          "Improve generalized category discovery under confirmation bias.",
        researchProgramOnboardingStatus: "incomplete",
        researchProgramOnboardingMissing: [
          "baseline_reference",
          "primary_metric",
        ],
        researchProgramBaselineReference: "ResNet-50 ERM baseline",
        researchProgramPrimaryMetricName: "H-score",
        researchProgramDatasetCount: 2,
        researchProgramSuccessCriteriaCount: 1,
        researchProgramZoteroProjectPath:
          "bot/gcd-confirmation-bias-mitigation",
        benchmarkProtocolStatus: "ready",
        benchmarkProtocolFamily: "OpenWorldGraphBench",
        benchmarkProtocolLocked: true,
        benchmarkProtocolDriftStatus: "pass",
        benchmarkProtocolPrimaryMetric: "H-score",
        benchmarkProtocolSplitDescriptor: "baseline-a validation split",
        benchmarkProtocolEvaluationHarness: "open-world-hscore-v1",
        benchmarkProtocolFairCompareStatus: "pass",
        benchmarkProtocolFairCompareSummary:
          "Main compare keeps the same backbone, split, and evaluation harness.",
        benchmarkProtocolAllowedDeviationCount: 0,
        benchmarkProtocolAllowedDeviationStatus: "none",
        benchmarkProtocolFairnessReportPath:
          "researcher/BASELINE_FAIRNESS_REPORT.json",
        benchmarkProtocolPath: "researcher/BENCHMARK_PROTOCOL.json",
        statisticalEvidenceStatus: "partial",
        statisticalEvidenceAggregatePath: "analyzer/STATISTICAL_EVIDENCE.json",
        statisticalEvidenceClaimStrengthStatus: "moderate",
        statisticalEvidenceSignificantResultCount: 2,
        statisticalEvidenceInsufficientSeedCount: 1,
        venueCompetitionStatus: "partial",
        venueCompetitionTargetVenues: ["ICLR", "NeurIPS"],
        venueCompetitionCompetitorSlatePath:
          "researcher/VENUE_COMPETITION.json",
        venueCompetitionAcceptanceRiskStatus: "moderate",
        venueCompetitionGraphContextStatus: "ready",
        ablationEvidenceStatus: "ready",
        ablationEvidenceSummaryPath: "researcher/ABLATION_EVIDENCE.json",
        ablationEvidenceSufficiencyStatus: "partial",
        ablationEvidencePublicationCriticalCount: 2,
        mechanismEvidenceStatus: "partial",
        mechanismEvidencePacketPath: "researcher/MECHANISM_EVIDENCE.json",
        mechanismEvidenceTier: "moderate",
        mechanismEvidenceGraphContextStatus: "unverified_graph_context",
        reproducibilityPackStatus: "draft",
        reproducibilityPackBundlePath:
          "academic_writer/REPRODUCIBILITY_PACK.json",
        reproducibilityPackEnvironmentCaptureStatus: "ready",
        reproducibilityPackRegenerateTablesStatus: "pending",
        cameraReadyEvidenceStatus: "draft",
        cameraReadyEvidencePackagePath:
          "academic_writer/CAMERA_READY_EVIDENCE.json",
        cameraReadyEvidenceFiguresStatus: "ready",
        cameraReadyEvidenceTablesStatus: "pending",
        cameraReadyEvidenceCaptionsStatus: "pending",
        opportunityScorecardStatus: "partial",
        opportunityScorecardVerdict: "strong_but_incremental",
        opportunityScorecardPath: "researcher/TOP_TIER_OPPORTUNITY.json",
        opportunityScorecardGraphContextStatus: "ready",
        evidenceCloseoutStatus: "blocked",
        evidenceCloseoutTopTierVerdict: "worth_top_tier_bet",
        evidenceCloseoutBlockerCount: 4,
        evidenceCloseoutGraphDependentBlockerCount: 1,
        evidenceCloseoutLocalEvidenceBlockerCount: 3,
        evidenceCloseoutExperimentAnalyzeReady: false,
        evidenceCloseoutAnalyzeReviewReady: true,
        evidenceCloseoutWriteReady: false,
        evidenceCloseoutSubmitReady: false,
        evidenceCloseoutTopBlockers: [
          "benchmark protocol missing",
          "statistical evidence missing",
        ],
        teamTaskPreview: [
          {
            taskId: "experiment.lock_benchmark_protocol",
            title: "Lock the benchmark protocol",
            owner: "orchestrator",
            status: "blocked",
            reason: "Benchmark/statistical/ablation evidence is still incomplete.",
          },
          {
            taskId: "experiment.aggregate_statistics",
            title: "Materialize statistical evidence",
            owner: "analyzer",
            status: "blocked",
            reason: null,
          },
        ],
        teamTaskGraphPath:
          "/tmp/projects/paper-lab/.openclaw-research/workflow-task-graph.json",
        teamTaskGraphTaskCount: 2,
        teamTaskGraphClaimableCount: 1,
        teamTaskGraphBlockedCount: 0,
        teamTaskGraphClaimedCount: 0,
        teamTaskGraphVerifyingCount: 0,
        teamTaskGraphNeedsRepairCount: 0,
        teamTaskGraphSatisfiedCount: 1,
        teamTaskGraphOptionalCount: 0,
        teamRoundPath:
          "/tmp/projects/paper-lab/.openclaw-research/workflow-team-round.json",
        teamRoundStatus: "active",
        teamRoundLeadRole: "researcher",
        teamRoundActiveSessionCount: 1,
        teamRoundLastClaimedTaskId: "experiment.lock_benchmark_protocol",
        teamRoundLastCompletedTaskId: "experiment.aggregate_statistics",
        experimentSyncRequired: false,
        experimentPapernexusSyncStatus: null,
        surveyReviewStatus: "completed",
        surveyReviewCurrentPhase: "complete",
        surveyReviewTopic: "Generalized category discovery survey",
        surveyReviewMode: "survey",
        surveyReviewCandidatePaperCount: 51,
        surveyReviewIncludedPaperCount: 31,
        surveyReviewExcludedPaperCount: 15,
        surveyReviewQueryRoundCount: 8,
        surveyReviewGraphGroundedBriefReady: true,
        surveyReviewSurveyBriefPath: "researcher/SURVEY_BRIEF.md",
        surveyReviewPendingReason: null,
        surveyBriefRefinementStatus: "reviewing",
        surveyBriefRefinementReviewCount: 1,
        surveyBriefRefinementRoundId: "survey-brief-round-1",
        surveyBriefRefinementPacketPath:
          "reviewer/panel-discussions/survey-brief-refinement/PANEL_DISCUSSION_PACKET.md",
        surveyBriefRefinementSummary: "One refinement pass is still needed.",
        experimentActiveRunCount: 1,
        experimentTerminalRunCount: 2,
        experimentFinishedUnreconciledCount: 1,
        experimentNeedsMonitorPass: true,
        experimentMonitorRecommendedCommand: "/monitor-experiment",
        backgroundQueueEntryCount: 1,
        backgroundQueueDegradedCount: 1,
        backgroundQueueTopKind: "survey_review",
        backgroundQueueTopStatus: "degraded",
        backgroundQueueTopSummary:
          "Queued background workflow for survey-generalized-category-discovery-v3.",
        backgroundQueueTopError:
          "Plugin runtime subagent methods are only available during a gateway request.",
        experimentGpuMonitorStatus: "fresh",
        experimentGpuMonitorCheckedAt: "2026-04-11T12:00:00.000Z",
        experimentGpuMonitorServerCount: 1,
        experimentGpuMonitorBusyAssignedGpuCount: 0,
        experimentGpuMonitorIdleAssignedGpuCount: 1,
        experimentGpuMonitorLikelyFinishedRunCount: 1,
        experimentGpuMonitorRecommendation: "reconcile_finished",
        experimentSearchStatus: "running",
        experimentSearchCurrentMainStage: "creative_research",
        experimentSearchCurrentSubstage: "branch_expansion",
        experimentSearchBestNodeId: "node-7",
        experimentSearchPromotionBasisSignals: [
          "primary_metric_win",
          "promotion_rule_satisfied",
        ],
        experimentSearchPromotionEvidenceSummary:
          "Primary metric beat the incumbent under the approved promotion rule.",
        experimentSearchMultiSeedStatus: "running",
        experimentSearchPlotPackStatus: "pending",
        paperStoryStatus: "ready",
        paperStoryTrackId: "track-idea-1",
        paperStoryStorySpinePath: "academic_writer/story/STORY_SPINE.md",
        paperStoryClaimToExperimentMapPath:
          "academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md",
        paperStoryFallbackNarrativePath:
          "academic_writer/story/FALLBACK_NARRATIVE.md",
        paperStoryClaimSupportStatus: "partial",
        paperStorySupportedClaimCount: 2,
        paperStoryPartialClaimCount: 1,
        paperStoryUnsupportedClaimCount: 1,
        writingSessionStatus: "writing",
        writingCurrentSection: "results",
        writingDraftOrder: [
          "method",
          "experimental_setup",
          "results",
          "related_work",
          "introduction",
          "abstract",
          "conclusion",
        ],
        writingFinalizedSections: ["method"],
        writingCompileSafeSections: ["method"],
        writingSectionPacketsReady: false,
        writingCurrentSectionReviewVerdict: "needs_revision",
        writingGraphEvidenceCoverageStatus: "partial",
        writingGraphEvidenceCoverageSummary:
          "1/2 headline claims already have graph-backed evidence pointers.",
        reviewSessionStatus: "needs_revision",
        reviewSessionStageScope: "review",
        reviewSessionRound: 2,
        reviewSessionVerdict: "not_ready",
        reviewSessionSummary:
          "Soundness and graph-grounded evidence are still below the handoff bar.",
        reviewRubricSummary: {
          originality: 7,
          quality: 6,
          clarity: 7,
          significance: 6,
          soundness: 5,
          citationIntegrity: 8,
          graphGroundedEvidenceSufficiency: 5,
        },
        reviewPressureStatus: "ready",
        reviewPressureRejectFirstReviewPath:
          "reviewer/story-pressure/REJECT_FIRST_REVIEW.md",
        reviewPressureUnsupportedClaimAuditPath:
          "reviewer/story-pressure/UNSUPPORTED_CLAIM_AUDIT.md",
        graphGuidedWritingStatus: "partial",
        graphGuidedWritingEvidenceCoverageStatus: "partial",
        graphGuidedWritingMissingEvidenceClaims: ["claim-results-1"],
        graphGuidedWritingScholarReserved: true,
        graphGuidedWritingScholarSkillSlot: "future/literature-dehallucination",
        citationCollectionStatus: "running",
        citationCollectionCandidateCount: 24,
        citationCollectionVerifiedCount: 8,
        citationCollectionSuspiciousCount: 1,
        citationCollectionHallucinatedCount: 0,
        paperQcStatus: "running",
        paperQcCompileStatus: "pass",
        paperQcChktexStatus: "pending",
        paperQcPageBudgetStatus: "pending",
        figureQcStatus: "ready",
        figureQcDuplicateFigureStatus: "pass",
        figureQcCaptionAlignmentStatus: "pass",
        figureQcTextAlignmentStatus: "pass",
        figureQcSelectionStatus: "pass",
        reviewIssueTrackerStatus: "open",
        reviewIssueCriticalCount: 0,
        reviewIssueHighCount: 1,
        reviewIssueMediumCount: 2,
        reviewIssueLowCount: 1,
        revisionControlStatus: "active",
        revisionControlRound: 2,
        revisionControlCurrentOwner: "academic_writer",
        revisionControlNextReviewerRole: "reviewer",
        revisionControlOpenSourceCount: 2,
        revisionControlPacketPath: "reviewer/REVISION_CONTROL_PACKET.json",
        revisionControlPendingReason: "Review still requests bounded fixes.",
        paragraphLogicAuditStatus: "blocked",
        paragraphLogicAuditReportPath: "academic_writer/PARAGRAPH_LOGIC_AUDIT.md",
        paragraphLogicAuditReverseOutlinePath:
          "academic_writer/PARAGRAPH_LOGIC_REVERSE_OUTLINE.md",
        paragraphLogicAuditBlockingIssueCount: 3,
        paragraphLogicAuditSectionTransitionIssueCount: 2,
        paragraphLogicAuditWeakestSections: ["introduction", "discussion"],
        paragraphLogicAuditNextRepairAction:
          "Rewrite the introduction handoff before the next review pass.",
        executionProofStatus: "blocked",
        executionProofPath: "researcher/EXECUTION_PROOF.json",
        executionProofReceiptCount: 1,
        executionProofLineageMatchedReceiptCount: 0,
        executionProofCandidateCommit: "cand-789",
        executionProofExpectedStageRunId: "stage-run-exp-7",
        executionProofPrimaryReceiptExperimentId: "exp-7",
        executionProofPrimaryReceiptRunId: "run-exp-6",
        executionProofPrimaryReceiptStageRunId: "stage-run-exp-6",
        executionProofPrimaryReceiptGitCommit: "old-commit",
        executionProofPrimaryReceiptPath:
          "coder/experiments/track-main/exp-7__coverage/REMOTE_RUN.json",
        executionProofPendingReason:
          "Execution receipts exist, but their commit lineage or stage_run_id does not match the current candidate/search state.",
        autoDispatchDiagnosticsStatus: "waiting",
        autoDispatchBlockingLayer: "signals",
        autoDispatchBlockingReason: "graph_presence_missing",
        autoDispatchBlockingSummary: "Graph refresh and revision work are still pending.",
        autoDispatchNextRepairAction: "Regenerate the graph packet and rerun auto_iterator_tick.",
        autoGateReviewToWriteMode: "panel_gate",
        autoGateWriteToSubmitMode: "panel_gate",
        autoGateSubmitToDoneMode: "manual_gate",
        autoGateCurrentStageMode: "panel_gate",
        surveyVisualCompilerStatus: "ready",
        surveyVisualCompilerRowCount: 4,
        surveyVisualCompilerInsertionMapPath: "academic_writer/SURVEY_VISUAL_INSERTION_MAP.json",
        surveyMethodologyConsistencyStatus: "blocked",
        surveyMethodologyConsistencyPath: "researcher/SURVEY_METHODOLOGY_CONSISTENCY.json",
        surveyMethodologyConsistencyBlockingIssueCount: 2,
        externalReviewStatus: "received",
        externalReviewRecommendation: "minor_revision",
        externalReviewRequiredAction: "rollback_write",
      };
    },
    async runWorkflowAutoIterator() {
      return {
        configuredAutoMode: "aggressive",
        effectiveAutoMode: "conservative",
        autoModeRiskLevel: "caution",
        autoModeReasons: ["Citation verification is needs_revision."],
        autoModeRiskFingerprint: "risk-1",
        autoModeMitigationStatus: "needs_changes",
        autoModeMitigationRoundsStarted: 1,
        autoModeMitigationRoundsRemaining: 1,
      };
    },
  }), "workflow-status");

  const result = await statusCommand.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: "/workflow-status",
    args: undefined,
    config: {},
    from: "discord:channel:paper-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.match(result.text ?? "", /^Workflow Status/m);
  assert.match(result.text ?? "", /Project: paper-lab \(channel_binding\)/);
  assert.match(result.text ?? "", /Stage: experiment \/ monitoring/);
  assert.match(result.text ?? "", /Mailbox: 2 unread/);
  assert.match(result.text ?? "", /Idle research: enabled=true, due=true, topic=spectral clustering under drift/);
  assert.match(result.text ?? "", /Graph refresh: required \(new core papers found\)/);
  assert.match(result.text ?? "", /PaperNexus ingestion: status=waiting_graph, import_tasks=3, completed_papers=11, active_ops=2, timed_out=1, failed=0, batches=1, active_batches=1, batch_pending_items=9, batch_synced_items=4, batch_failed_items=1, queued_requests=0, running_requests=0, reconcile_required=true/);
  assert.match(result.text ?? "", /PaperNexus batch manifest: \/tmp\/demo\/batch-import\.json/);
  assert.match(result.text ?? "", /Revision control: status=active/i);
  assert.match(result.text ?? "", /Paragraph logic audit: status=blocked, blocking_issues=3, section_transition_issues=2/i);
  assert.match(result.text ?? "", /Execution proof: status=blocked, receipts=1, lineage_matched=0, path=researcher\/EXECUTION_PROOF\.json/i);
  assert.match(
    result.text ?? "",
    /Execution lineage: candidate_commit=cand-789, expected_stage_run_id=stage-run-exp-7, receipt_experiment=exp-7, receipt_run_id=run-exp-6, receipt_stage_run_id=stage-run-exp-6, receipt_git_commit=old-commit, receipt_path=coder\/experiments\/track-main\/exp-7__coverage\/REMOTE_RUN\.json/i
  );
  assert.match(result.text ?? "", /Auto dispatch diagnostics: status=waiting/i);
  assert.match(result.text ?? "", /Auto gate modes: current_stage=panel_gate, review_to_write=panel_gate, write_to_submit=panel_gate, submit_to_done=manual_gate/i);
  assert.match(result.text ?? "", /Ideation contract: status=ready, track=track-idea-1, direction=dir-2, idea_tree=researcher\/ideation\/IDEA_TREE\.md, proposal=researcher\/ideation\/RESEARCH_PROPOSAL\.md, ranking=researcher\/ideation\/RANKING_HISTORY\.json, scoreboard=researcher\/ideation\/TOURNAMENT_SCOREBOARD\.json, top3=researcher\/ideation\/TOP3_DIRECTION_SUMMARY\.md, graph_packet=researcher\/ideation\/GRAPH_IDEATION_PACKET\.json/);
  assert.match(result.text ?? "", /IDEA-CATALYST: status=ready, mode=graph-first, micro_stage=judging, target_domain=Computer Science, source_domains=2, bridges=5, top_fragment=frag-1/);
  assert.match(result.text ?? "", /IDEA-CATALYST requisition: required=true, cycle=req-computer-science-2-2, retry_budget=1, saturated=false, reason=Cross-domain bridge evidence is still insufficient for unresolved catalyst questions\./);
  assert.match(result.text ?? "", /Research program: status=draft, onboarding=incomplete, goal=Improve generalized category discovery under confirmation bias\., baseline=ResNet-50 ERM baseline, primary_metric=H-score, datasets=2, success_criteria=1, active_tracks=1\/2/);
  assert.match(result.text ?? "", /Research program Zotero path: bot\/gcd-confirmation-bias-mitigation/);
  assert.match(result.text ?? "", /Research program checklist: missing=baseline_reference, primary_metric/);
  assert.match(
    result.text ?? "",
    /Benchmark protocol: status=ready, family=OpenWorldGraphBench, metric=H-score, split=baseline-a validation split, harness=open-world-hscore-v1, locked=true, drift=pass, fair_compare=pass, deviations=none/
  );
  assert.match(result.text ?? "", /Statistical evidence: status=partial, claim_strength=moderate, significant=2, insufficient_seeds=1/);
  assert.match(result.text ?? "", /Venue competition: status=partial, venues=ICLR,NeurIPS, risk=moderate, graph_context=ready/);
  assert.match(result.text ?? "", /Ablation evidence: status=ready, sufficiency=partial, publication_critical=2/);
  assert.match(result.text ?? "", /Mechanism evidence: status=partial, tier=moderate, graph_context=unverified_graph_context/);
  assert.match(result.text ?? "", /Reproducibility pack: status=draft, environment=ready, regenerate_tables=pending/);
  assert.match(result.text ?? "", /Camera-ready evidence: status=draft, figures=ready, tables=pending, captions=pending/);
  assert.match(result.text ?? "", /Top-tier opportunity: status=partial, verdict=strong_but_incremental, graph_context=ready/);
  assert.match(result.text ?? "", /Evidence closeout: status=blocked, verdict=worth_top_tier_bet, blockers=4, graph_blockers=1, local_blockers=3/);
  assert.match(result.text ?? "", /Evidence closeout stages: experiment_to_analyze=blocked, analyze_to_review=ready, write=blocked, submit=blocked/);
  assert.match(result.text ?? "", /Evidence closeout blockers: benchmark protocol missing; statistical evidence missing/);
  assert.match(result.text ?? "", /Stage task preview: experiment\.lock_benchmark_protocol\[blocked\]@orchestrator, experiment\.aggregate_statistics\[blocked\]@analyzer/);
  assert.match(result.text ?? "", /Stage task graph: tasks=2, claimable=1, blocked=0, claimed=0, verifying=0, needs_repair=0, satisfied=1, optional=0/);
  assert.match(result.text ?? "", /Team round: status=active, lead=researcher, active_sessions=1, last_claimed_task=experiment\.lock_benchmark_protocol, last_completed_task=experiment\.aggregate_statistics/);
  assert.match(result.text ?? "", /Experiment monitor: active_runs=1, terminal_runs=2, finished_unreconciled=1, needs_monitor_pass=true, next=\/monitor-experiment/);
  assert.match(result.text ?? "", /GPU monitor: status=fresh, checked_at=2026-04-11T12:00:00.000Z, servers=1, busy_assigned=0, idle_assigned=1, likely_finished=1, recommendation=reconcile_finished/);
  assert.match(
    result.text ?? "",
    /Experiment search: status=running, .*main_stage=creative_research, substage=branch_expansion, best_node=node-7, .*multi_seed=running, plot_pack=pending/
  );
  assert.match(
    result.text ?? "",
    /Background queue: entries=1, degraded=1, next_kind=survey_review, next_status=degraded/
  );
  assert.match(
    result.text ?? "",
    /Background queue detail: summary=Queued background workflow for survey-generalized-category-discovery-v3\., error=Plugin runtime subagent methods are only available during a gateway request\./
  );
  assert.match(
    result.text ?? "",
    /Survey brief refinement: status=reviewing, reviews=1, packet=reviewer\/panel-discussions\/survey-brief-refinement\/PANEL_DISCUSSION_PACKET\.md, summary=One refinement pass is still needed\./
  );
  assert.match(
    result.text ?? "",
    /Experiment promotion evidence: basis=primary_metric_win, promotion_rule_satisfied, summary=Primary metric beat the incumbent under the approved promotion rule\./
  );
  assert.match(result.text ?? "", /Paper story: status=ready, track=track-idea-1, story_spine=academic_writer\/story\/STORY_SPINE\.md, claim_map=academic_writer\/story\/CLAIM_TO_EXPERIMENT_MAP\.md, fallback=academic_writer\/story\/FALLBACK_NARRATIVE\.md/);
  assert.match(result.text ?? "", /Survey visual compiler: status=ready/i);
  assert.match(result.text ?? "", /Survey methodology consistency: status=blocked/i);
  assert.match(result.text ?? "", /Paper story support: status=partial, supported=2, partial=1, unsupported=1/);
  assert.match(result.text ?? "", /Auto mode: configured=aggressive, effective=conservative, risk=caution/);
  assert.match(result.text ?? "", /Auto mitigation: status=needs_changes, rounds=1\/2, remaining=1, fingerprint=risk-1/);
  assert.match(result.text ?? "", /Writing session: status=writing, current_section=results, section_review=needs_revision/);
  assert.match(result.text ?? "", /Writing evidence coverage: status=partial, packets_ready=false/);
  assert.match(result.text ?? "", /Review session: status=needs_revision, scope=review, round=2, verdict=not_ready/);
  assert.match(result.text ?? "", /Reviewer rubric: originality=7, quality=6, clarity=7, significance=6, soundness=5, citation_integrity=8, graph_evidence=5/);
  assert.match(result.text ?? "", /Review pressure: status=ready, reject_first=reviewer\/story-pressure\/REJECT_FIRST_REVIEW\.md, unsupported_claim_audit=reviewer\/story-pressure\/UNSUPPORTED_CLAIM_AUDIT\.md/);
  assert.match(result.text ?? "", /Review issues: status=open, critical=0, high=1, medium=2, low=1/);
  assert.match(result.text ?? "", /Graph-guided writing: status=partial, evidence_coverage=partial, missing_claims=claim-results-1/);
  assert.match(result.text ?? "", /Citation collection: status=running, verified=8\/24, suspicious=1, hallucinated=0/);
  assert.match(result.text ?? "", /Paper QC: status=running, compile=pass, chktex=pending, page_budget=pending/);
  assert.match(result.text ?? "", /Figure QC: status=ready, duplicate_figures=pass, caption_alignment=pass, text_alignment=pass, selection=pass/);
  assert.match(result.text ?? "", /Scholar fallback slot: reserved=future\/literature-dehallucination/);
  assert.match(result.text ?? "", /External review: status=received, recommendation=minor_revision, required_action=rollback_write/);
});

test("workflow-status command shows persisted auto discussion content per agent", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = path.join(projectsRoot, "paper-lab");
  const packetPath = path.join(
    projectRoot,
    "reviewer",
    "auto-mode-discussion",
    "AUTO_MODE_DISCUSSION_PACKET.md"
  );
  const packetJsonPath = path.join(
    projectRoot,
    "reviewer",
    "auto-mode-discussion",
    "AUTO_MODE_DISCUSSION_PACKET.json"
  );

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.dirname(packetPath), { recursive: true });
  await fs.writeFile(packetPath, "# packet\n", "utf8");
  await fs.writeFile(packetJsonPath, "{}\n", "utf8");

  const round = createAutoModeDiscussionRound({
    stage: "write",
    riskLevel: "severe",
    packetPath,
    packetJsonPath,
    packetFingerprint: "risk-fingerprint-1",
    attempts: [
      {
        reviewerRole: "researcher",
        sessionKey: "agent:researcher:main",
        runId: "discussion-1",
        status: "completed",
        launchedAt: "2026-03-25T12:00:00.000Z",
        completedAt: "2026-03-25T12:01:00.000Z",
        error: null,
        result: {
          reviewerRole: "researcher",
          riskAssessment: "needs_changes",
          confidence: 8.4,
          recommendedOwner: "academic_writer",
          actionItems: ["Refresh the citation verification appendix."],
          blockers: ["Citation verification is not complete."],
          summary: "One more bounded writing pass should reconcile the citation packet.",
          createdAt: "2026-03-25T12:01:00.000Z",
          runId: "discussion-1",
          rawText: JSON.stringify({
            riskAssessment: "needs_changes",
            confidence: 8.4,
            recommendedOwner: "academic_writer",
            actionItems: ["Refresh the citation verification appendix."],
            blockers: ["Citation verification is not complete."],
            summary: "One more bounded writing pass should reconcile the citation packet.",
          }),
        },
      },
      {
        reviewerRole: "analyzer",
        sessionKey: "agent:analyzer:main",
        runId: "discussion-2",
        status: "completed",
        launchedAt: "2026-03-25T12:00:00.000Z",
        completedAt: "2026-03-25T12:01:00.000Z",
        error: null,
        result: {
          reviewerRole: "analyzer",
          riskAssessment: "needs_changes",
          confidence: 8.1,
          recommendedOwner: "academic_writer",
          actionItems: ["Tighten the claim-evidence bridge in the writing packet."],
          blockers: [],
          summary: "Evidence is almost aligned, but the paper packet still needs one tighter revision.",
          createdAt: "2026-03-25T12:01:00.000Z",
          runId: "discussion-2",
          rawText: JSON.stringify({
            riskAssessment: "needs_changes",
            confidence: 8.1,
            recommendedOwner: "academic_writer",
            actionItems: ["Tighten the claim-evidence bridge in the writing packet."],
            blockers: [],
            summary: "Evidence is almost aligned, but the paper packet still needs one tighter revision.",
          }),
        },
      },
    ],
  });
  round.aggregate = {
    status: "needs_changes",
    quorum: 2,
    reviewCount: 2,
    averageConfidence: 8.25,
    assessmentCounts: {
      needs_changes: 2,
    },
    recommendedOwner: "academic_writer",
    actionItems: [
      "Refresh the citation verification appendix.",
      "Tighten the claim-evidence bridge in the writing packet.",
    ],
    blockers: ["Citation verification is not complete."],
    summary: "Panel recommends one more bounded remediation round before keeping aggressive auto mode.",
  };
  round.status = "needs_changes";

  await saveAutoModeDiscussionStore(projectRoot, {
    schemaVersion: 1,
    updatedAt: "2026-03-25T12:02:00.000Z",
    roundsStartedByFingerprint: {
      "risk-fingerprint-1": 1,
    },
    currentRound: round,
  });

  const api = makeApi();
  const statusCommand = getCommand(createResearchWorkflowCommands(api, {
    resolveConversationBindingRecord() {
      return {
        targetSessionKey: "agent:researcher:discord:group:paper-lab",
      };
    },
    async buildWorkflowSnapshot() {
      return {
        role: "researcher",
        projectRoot,
        projectId: "paper-lab",
        projectResolutionSource: "channel_binding",
        currentStage: "write",
        currentMicroStage: "citation-fix",
        ownerAgent: "academic_writer",
        recommendedOwner: "academic_writer",
        nextAction: "/write-paper",
        resumeAction: "/resume-pipeline paper-lab",
        blockingReason: "Citation verification is not complete.",
        unreadMailbox: [],
        idleResearchEnabled: false,
        idleResearchDue: false,
        idleResearchTopic: null,
        graphRefreshRequired: false,
        graphRefreshReason: null,
        innovationReflectionStatus: "fresh",
        innovationReflectionDue: false,
        experimentSyncRequired: false,
        experimentPapernexusSyncStatus: null,
      };
    },
    async runWorkflowAutoIterator() {
      return {
        configuredAutoMode: "aggressive",
        effectiveAutoMode: "aggressive",
        autoModeRiskLevel: "severe",
        autoModeReasons: [
          "Citation integrity reports hallucinated citations.",
          "Auto discussion rounds remaining before downgrade: 1/2.",
        ],
        autoModeRiskFingerprint: "risk-fingerprint-1",
        autoModeMitigationStatus: "needs_changes",
        autoModeMitigationRoundsStarted: 1,
        autoModeMitigationRoundsRemaining: 1,
      };
    },
  }), "workflow-status");

  const result = await statusCommand.handler({
    channel: "discord",
    isAuthorizedSender: true,
    commandBody: "/workflow-status",
    args: undefined,
    config: {},
    from: "discord:channel:paper-lab",
    to: undefined,
    accountId: "default",
    requestConversationBinding: async () => ({ status: "error" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  });

  assert.match(result.text ?? "", /Auto discussion: status=needs_changes, stage=write, risk=severe, reviews=2/);
  assert.match(result.text ?? "", /Auto discussion summary: Panel recommends one more bounded remediation round/);
  assert.match(result.text ?? "", /researcher: status=completed, assessment=needs_changes, confidence=8.4/);
  assert.match(result.text ?? "", /action items: Refresh the citation verification appendix\./);
  assert.match(result.text ?? "", /blockers: Citation verification is not complete\./);
  assert.match(result.text ?? "", /response: \{.*\"riskAssessment\":\"needs_changes\"/);
});
