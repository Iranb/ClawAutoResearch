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

async function makeProjectsRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-workflow-command-"));
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
        innovationReflectionStatus: "stale",
        innovationReflectionDue: true,
        experimentSyncRequired: false,
        experimentPapernexusSyncStatus: null,
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
});
