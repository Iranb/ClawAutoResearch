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
import { drainQueuedBackgroundWorkflowRuns } from "../tools/workflow-fast-paths.ts";
import { readWorkflowRuntimeQueueStore } from "../tools/workflow-runtime-state.ts";
import {
  createAutoModeDiscussionRound,
  saveAutoModeDiscussionStore,
} from "../tools/workflow-auto-discussion.ts";

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
        experimentSyncRequired: false,
        experimentPapernexusSyncStatus: null,
        experimentSearchStatus: "running",
        experimentSearchCurrentMainStage: "creative_research",
        experimentSearchCurrentSubstage: "branch_expansion",
        experimentSearchBestNodeId: "node-7",
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
  assert.match(result.text ?? "", /Ideation contract: status=ready, track=track-idea-1, direction=dir-2, idea_tree=researcher\/ideation\/IDEA_TREE\.md, proposal=researcher\/ideation\/RESEARCH_PROPOSAL\.md, ranking=researcher\/ideation\/RANKING_HISTORY\.json, scoreboard=researcher\/ideation\/TOURNAMENT_SCOREBOARD\.json, top3=researcher\/ideation\/TOP3_DIRECTION_SUMMARY\.md, graph_packet=researcher\/ideation\/GRAPH_IDEATION_PACKET\.json/);
  assert.match(result.text ?? "", /IDEA-CATALYST: status=ready, mode=graph-first, micro_stage=judging, target_domain=Computer Science, source_domains=2, bridges=5, top_fragment=frag-1/);
  assert.match(result.text ?? "", /IDEA-CATALYST requisition: required=true, cycle=req-computer-science-2-2, retry_budget=1, saturated=false, reason=Cross-domain bridge evidence is still insufficient for unresolved catalyst questions\./);
  assert.match(result.text ?? "", /Research program: status=draft, onboarding=incomplete, goal=Improve generalized category discovery under confirmation bias\., baseline=ResNet-50 ERM baseline, primary_metric=H-score, datasets=2, success_criteria=1, active_tracks=1\/2/);
  assert.match(result.text ?? "", /Research program Zotero path: bot\/gcd-confirmation-bias-mitigation/);
  assert.match(result.text ?? "", /Research program checklist: missing=baseline_reference, primary_metric/);
  assert.match(result.text ?? "", /Experiment search: status=running, main_stage=creative_research, substage=branch_expansion, best_node=node-7, multi_seed=running, plot_pack=pending/);
  assert.match(result.text ?? "", /Paper story: status=ready, track=track-idea-1, story_spine=academic_writer\/story\/STORY_SPINE\.md, claim_map=academic_writer\/story\/CLAIM_TO_EXPERIMENT_MAP\.md, fallback=academic_writer\/story\/FALLBACK_NARRATIVE\.md/);
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
