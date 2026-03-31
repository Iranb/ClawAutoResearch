import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH = path.join(
  os.tmpdir(),
  "openclaw-research-background-runs-workflow-service.json"
);
process.env.OPENCLAW_RESEARCH_BACKGROUND_QUEUE_PATH = path.join(
  os.tmpdir(),
  "openclaw-research-background-queue-workflow-service.json"
);

import {
  clearBackgroundWorkflowQueueForTests,
  clearBackgroundWorkflowRunRegistryForTests,
  drainQueuedBackgroundWorkflowRuns,
} from "../tools/workflow-fast-paths.ts";
import {
  readWorkflowRuntimeQueueStore,
  readWorkflowRuntimeSessionsStore,
} from "../tools/workflow-runtime-state.ts";
import {
  createWorkflowCoordinatorService,
  deriveWorkflowCoordinatorStatusUpdate,
  listWorkflowCoordinatorProjects,
  maybeAdvanceAutoModeDiscussionForProject,
  maybeAdvanceAutoGateReviewForProject,
  maybeDispatchAutoModeMitigationForProject,
  maybeLaunchAutoStageForProject,
  maybeLaunchIdleResearchForProject,
  runWorkflowCoordinatorPass,
} from "../tools/register-workflow-service.ts";
import { recordWorkflowAnnounceEvent } from "../tools/workflow-session-orchestrator.ts";
import { readGateReviewStore } from "../tools/workflow-auto-gate.ts";
import { defaultAutoGateConfig } from "../tools/workflow-auto-gate.ts";
import { readAutoModeDiscussionStore } from "../tools/workflow-auto-discussion.ts";

async function makeProjectsRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-workflow-service-"));
}

test.beforeEach(async () => {
  await clearBackgroundWorkflowRunRegistryForTests();
  await clearBackgroundWorkflowQueueForTests();
});

test.afterEach(async () => {
  await clearBackgroundWorkflowRunRegistryForTests();
  await clearBackgroundWorkflowQueueForTests();
});

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function makeProject(projectsRoot, projectId, stage = "setup") {
  const projectRoot = path.join(projectsRoot, projectId);
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: projectId,
    current_stage: stage,
  });
  return projectRoot;
}

test("listWorkflowCoordinatorProjects prefers active projects from PROJECTS_STATE", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const alphaRoot = await makeProject(projectsRoot, "alpha", "code");
  await makeProject(projectsRoot, "beta", "done");

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectsRoot, "PROJECTS_STATE.json"), {
    projects: [
      {
        id: "alpha",
        dir: "alpha/",
        stage: "code",
        status: "active",
        updated: "2026-03-25T09:00:00.000Z",
      },
      {
        id: "missing",
        dir: "missing/",
        stage: "idea",
        status: "active",
        updated: "2026-03-25T08:00:00.000Z",
      },
      {
        id: "beta",
        dir: "beta/",
        stage: "done",
        status: "completed",
        updated: "2026-03-25T07:00:00.000Z",
      },
    ],
  });

  const projects = await listWorkflowCoordinatorProjects({
    projectsRoot,
    maxProjects: 5,
  });

  assert.deepEqual(projects, [
    {
      projectId: "alpha",
      projectRoot: alphaRoot,
      source: "projects_state",
      stage: "code",
      updatedAt: "2026-03-25T09:00:00.000Z",
    },
  ]);
});

test("runWorkflowCoordinatorPass invokes auto iterator in service mode", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const alphaRoot = await makeProject(projectsRoot, "alpha", "graph_build");
  const calls = [];

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  const results = await runWorkflowCoordinatorPass({
    projectsRoot,
    cooldownSeconds: 90,
    queueMailbox: true,
    maxProjects: 2,
    deps: {
      async listWorkflowCoordinatorProjects() {
        return [
          {
            projectId: "alpha",
            projectRoot: alphaRoot,
            source: "scan",
            stage: "graph_build",
            updatedAt: null,
          },
        ];
      },
      async runWorkflowAutoIterator(params) {
        calls.push(params);
        return {
          stageBefore: "graph_build",
          stageAfter: "graph_build",
          stageChanged: false,
          regressed: false,
          recommendedActions: [],
        };
      },
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].projectRoot, alphaRoot);
  assert.equal(calls[0].agentId, "researcher");
  assert.equal(calls[0].mode, "service");
  assert.equal(calls[0].queueMailbox, true);
  assert.equal(calls[0].cooldownSeconds, 90);
  assert.equal(results.length, 1);
  assert.equal(results[0].projectId, "alpha");
});

test("maybeLaunchIdleResearchForProject starts one bounded researcher background run for a due idle topic", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const alphaRoot = path.join(projectsRoot, "alpha");
  const runs = [];
  const launchedDueKeys = new Map();

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  const launch = await maybeLaunchIdleResearchForProject({
    runtimeSubagent: {
      async run(params) {
        runs.push(params);
        return { runId: "idle-run-1" };
      },
    },
    workflowPolicy: {
      enableChannelProjectBindings: true,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot: alphaRoot,
    projectId: "alpha",
    autoIteratorResult: {
      recommendedActions: [
        {
          kind: "background",
          owner: "researcher",
          command:
            'Run /idle-research for "contrastive spectral pruning" and record the round through research_workflow.record_idle_research_run.',
        },
      ],
    },
    launchedDueKeys,
    deps: {
      async getIdleResearchStateSummary() {
        return {
          state: {
            enabled: true,
            topic: "contrastive spectral pruning",
          },
          due: true,
          nextDueAt: null,
        };
      },
      listChannelProjectBindingsForWorkflow() {
        return {
          enabled: true,
          storePath: projectsRoot,
          bindings: [
            {
              channelKey: "discord:group:paper-lab",
              projectRoot: alphaRoot,
              projectId: "alpha",
              messageChannel: "discord",
              sessionKeySample: "agent:coder:discord:group:paper-lab",
              sessionId: null,
              boundAt: "2026-03-25T00:00:00.000Z",
              updatedAt: "2026-03-25T00:05:00.000Z",
              boundByAgent: "researcher",
              notes: null,
            },
          ],
        };
      },
    },
  });

  assert.equal(launch.launched, true);
  assert.equal(launch.reason, "started");
  assert.match(
    launch.sessionKey ?? "",
    /^agent:researcher:discord:group:paper-lab:subagent:/
  );
  assert.equal(runs.length, 1);
  assert.match(
    runs[0].sessionKey,
    /^agent:researcher:discord:group:paper-lab:subagent:/
  );
  assert.match(runs[0].message, /\/idle-research "contrastive spectral pruning"/);
  assert.match(runs[0].message, /record_idle_research_run/);

  const duplicate = await maybeLaunchIdleResearchForProject({
    runtimeSubagent: {
      async run(params) {
        runs.push(params);
        return { runId: "idle-run-2" };
      },
    },
    workflowPolicy: {
      enableChannelProjectBindings: true,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot: alphaRoot,
    projectId: "alpha",
    autoIteratorResult: {
      recommendedActions: [
        {
          kind: "background",
          owner: "researcher",
          command:
            'Run /idle-research for "contrastive spectral pruning" and record the round through research_workflow.record_idle_research_run.',
        },
      ],
    },
    launchedDueKeys,
    deps: {
      async getIdleResearchStateSummary() {
        return {
          state: {
            enabled: true,
            topic: "contrastive spectral pruning",
          },
          due: true,
          nextDueAt: null,
        };
      },
      listChannelProjectBindingsForWorkflow() {
        return {
          enabled: true,
          storePath: projectsRoot,
          bindings: [],
        };
      },
    },
  });

  assert.equal(duplicate.launched, false);
  assert.equal(duplicate.reason, "idle_research_already_launched");
  assert.equal(runs.length, 1);
});

test("maybeLaunchIdleResearchForProject reports channel capacity pressure instead of masking it as runtime failure", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const alphaRoot = path.join(projectsRoot, "alpha");
  const betaRoot = path.join(projectsRoot, "beta");
  const gammaRoot = path.join(projectsRoot, "gamma");
  const runCalls = [];
  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });
  const runtimeSubagent = {
    async run(params) {
      runCalls.push(params);
      return { runId: `idle-run-${runCalls.length}` };
    },
  };

  await maybeLaunchIdleResearchForProject({
    runtimeSubagent,
    workflowPolicy: {
      enableChannelProjectBindings: true,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot: alphaRoot,
    projectId: "alpha",
    autoIteratorResult: {
      recommendedActions: [
        {
          kind: "background",
          owner: "researcher",
          command:
            'Run /idle-research for "contrastive spectral pruning" and record the round through research_workflow.record_idle_research_run.',
        },
      ],
    },
    launchedDueKeys: new Map(),
    deps: {
      async getIdleResearchStateSummary() {
        return {
          state: {
            enabled: true,
            topic: "contrastive spectral pruning",
          },
          due: true,
          nextDueAt: null,
        };
      },
      listChannelProjectBindingsForWorkflow() {
        return {
          enabled: true,
          storePath: projectsRoot,
          bindings: [
            {
              channelKey: "discord:group:paper-lab",
              projectRoot: alphaRoot,
              projectId: "alpha",
              messageChannel: "discord",
              sessionKeySample: "agent:researcher:discord:group:paper-lab",
              sessionId: null,
              boundAt: "2026-03-25T00:00:00.000Z",
              updatedAt: "2026-03-25T00:05:00.000Z",
              boundByAgent: "researcher",
            },
          ],
        };
      },
    },
  });
  await maybeLaunchIdleResearchForProject({
    runtimeSubagent,
    workflowPolicy: {
      enableChannelProjectBindings: true,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot: betaRoot,
    projectId: "beta",
    autoIteratorResult: {
      recommendedActions: [
        {
          kind: "background",
          owner: "researcher",
          command:
            'Run /idle-research for "semantic shift robustness" and record the round through research_workflow.record_idle_research_run.',
        },
      ],
    },
    launchedDueKeys: new Map(),
    deps: {
      async getIdleResearchStateSummary() {
        return {
          state: {
            enabled: true,
            topic: "semantic shift robustness",
          },
          due: true,
          nextDueAt: null,
        };
      },
      listChannelProjectBindingsForWorkflow() {
        return {
          enabled: true,
          storePath: projectsRoot,
          bindings: [
            {
              channelKey: "discord:group:paper-lab",
              projectRoot: betaRoot,
              projectId: "beta",
              messageChannel: "discord",
              sessionKeySample: "agent:researcher:discord:group:paper-lab",
              sessionId: null,
              boundAt: "2026-03-25T00:00:00.000Z",
              updatedAt: "2026-03-25T00:05:00.000Z",
              boundByAgent: "researcher",
            },
          ],
        };
      },
    },
  });

  const blocked = await maybeLaunchIdleResearchForProject({
    runtimeSubagent,
    workflowPolicy: {
      enableChannelProjectBindings: true,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot: gammaRoot,
    projectId: "gamma",
    autoIteratorResult: {
      recommendedActions: [
        {
          kind: "background",
          owner: "researcher",
          command:
            'Run /idle-research for "robust calibration drift" and record the round through research_workflow.record_idle_research_run.',
        },
      ],
    },
    launchedDueKeys: new Map(),
    deps: {
      async getIdleResearchStateSummary() {
        return {
          state: {
            enabled: true,
            topic: "robust calibration drift",
          },
          due: true,
          nextDueAt: null,
        };
      },
      listChannelProjectBindingsForWorkflow() {
        return {
          enabled: true,
          storePath: projectsRoot,
          bindings: [
            {
              channelKey: "discord:group:paper-lab",
              projectRoot: gammaRoot,
              projectId: "gamma",
              messageChannel: "discord",
              sessionKeySample: "agent:researcher:discord:group:paper-lab",
              sessionId: null,
              boundAt: "2026-03-25T00:00:00.000Z",
              updatedAt: "2026-03-25T00:05:00.000Z",
              boundByAgent: "researcher",
            },
          ],
        };
      },
    },
  });

  assert.equal(blocked.launched, false);
  assert.equal(blocked.reason, "channel_capacity_reached");
  assert.equal(blocked.activeResearcherSessionsInChannel, 2);
  assert.match(blocked.summary ?? "", /already has 2 active researcher background subagents/i);
});

test("maybeLaunchAutoStageForProject dispatches the current stage owner in auto mode", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = path.join(projectsRoot, "alpha");
  const runs = [];
  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });
  await fs.mkdir(projectRoot, { recursive: true });
  const launch = await maybeLaunchAutoStageForProject({
    runtimeSubagent: {
      async run(params) {
        runs.push(params);
        return { runId: `stage-run-${runs.length}` };
      },
    },
    workflowPolicy: {
      autoMode: "conservative",
      autoGate: defaultAutoGateConfig(),
      enableChannelProjectBindings: true,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot,
    projectId: "alpha",
    autoIteratorResult: {
      gateBlocking: false,
      stageAfter: "code",
      recommendedActions: [
        {
          kind: "drive_stage",
          owner: "coder",
          stage: "code",
          summary: "Implement the approved experiments as runnable bundles.",
          command: "/implement-experiment",
          mailboxMessageId: "mailbox-1",
          cooldownRemainingSeconds: 0,
          blocking: false,
        },
      ],
    },
    launchedStageKeys: new Map(),
    deps: {
      listChannelProjectBindingsForWorkflow() {
        return {
          enabled: true,
          storePath: "/tmp/projects",
          bindings: [
            {
              channelKey: "discord:group:paper-lab",
              projectRoot,
              projectId: "alpha",
              messageChannel: "discord",
              sessionKeySample: "agent:researcher:discord:group:paper-lab",
              sessionId: null,
              boundAt: "2026-03-25T00:00:00.000Z",
              updatedAt: "2026-03-25T00:05:00.000Z",
              boundByAgent: "researcher",
              notes: null,
            },
          ],
        };
      },
    },
  });

  assert.equal(launch.launched, true);
  assert.equal(launch.owner, "coder");
  assert.equal(launch.sessionKey, "agent:coder:discord:group:paper-lab");
  assert.equal(launch.dispatchStrategy, "sessions_spawn");
  assert.equal(runs.length, 1);
  assert.match(runs[0].message, /Immediate command: \/implement-experiment/);
});

test("maybeLaunchAutoStageForProject runs researcher-owned work on a dedicated subagent session", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = path.join(projectsRoot, "alpha");
  const runs = [];
  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });
  await fs.mkdir(projectRoot, { recursive: true });

  const launch = await maybeLaunchAutoStageForProject({
    runtimeSubagent: {
      async run(params) {
        runs.push(params);
        return { runId: `stage-run-${runs.length}` };
      },
    },
    workflowPolicy: {
      autoMode: "conservative",
      autoGate: defaultAutoGateConfig(),
      enableChannelProjectBindings: true,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot,
    projectId: "alpha",
    autoIteratorResult: {
      gateBlocking: false,
      stageAfter: "experiment",
      recommendedActions: [
        {
          kind: "drive_stage",
          owner: "researcher",
          stage: "experiment",
          summary: "Run one bounded experiment-search pass.",
          command: "/run-experiments",
          mailboxMessageId: null,
          cooldownRemainingSeconds: 0,
          blocking: false,
        },
      ],
    },
    launchedStageKeys: new Map(),
    deps: {
      listChannelProjectBindingsForWorkflow() {
        return {
          enabled: true,
          storePath: projectsRoot,
          bindings: [
            {
              channelKey: "discord:group:paper-lab",
              projectRoot,
              projectId: "alpha",
              messageChannel: "discord",
              sessionKeySample: "agent:researcher:discord:group:paper-lab",
              sessionId: null,
              boundAt: "2026-03-25T00:00:00.000Z",
              updatedAt: "2026-03-25T00:05:00.000Z",
              boundByAgent: "researcher",
              notes: null,
            },
          ],
        };
      },
    },
  });

  assert.equal(launch.launched, true);
  assert.match(
    launch.sessionKey ?? "",
    /^agent:researcher:discord:group:paper-lab:subagent:/
  );
  assert.equal(runs.length, 1);
  assert.match(
    runs[0].sessionKey,
    /^agent:researcher:discord:group:paper-lab:subagent:/
  );
  assert.match(runs[0].message, /Immediate command: \/run-experiments/);
});

test("maybeLaunchAutoStageForProject shares the researcher service session pool across projects", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const alphaRoot = path.join(projectsRoot, "alpha");
  const betaRoot = path.join(projectsRoot, "beta");
  const gammaRoot = path.join(projectsRoot, "gamma");
  const runs = [];
  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });
  await fs.mkdir(alphaRoot, { recursive: true });
  await fs.mkdir(betaRoot, { recursive: true });
  await fs.mkdir(gammaRoot, { recursive: true });

  const bindings = [alphaRoot, betaRoot, gammaRoot].map((projectRoot, index) => ({
    channelKey: "discord:group:paper-lab",
    projectRoot,
    projectId: ["alpha", "beta", "gamma"][index],
    messageChannel: "discord",
    sessionKeySample: "agent:researcher:discord:group:paper-lab",
    sessionId: null,
    boundAt: "2026-03-25T00:00:00.000Z",
    updatedAt: "2026-03-25T00:05:00.000Z",
    boundByAgent: "researcher",
    notes: null,
  }));

  const makeParams = (projectRoot, projectId) => ({
    runtimeSubagent: {
      async run(params) {
        runs.push(params);
        return { runId: `stage-run-${runs.length}` };
      },
    },
    workflowPolicy: {
      autoMode: "conservative",
      autoGate: defaultAutoGateConfig(),
      enableChannelProjectBindings: true,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot,
    projectId,
    autoIteratorResult: {
      gateBlocking: false,
      stageAfter: "experiment",
      recommendedActions: [
        {
          kind: "drive_stage",
          owner: "researcher",
          stage: "experiment",
          summary: "Run one bounded experiment-search pass.",
          command: "/run-experiments",
          mailboxMessageId: null,
          cooldownRemainingSeconds: 0,
          blocking: false,
        },
      ],
    },
    launchedStageKeys: new Map(),
    deps: {
      listChannelProjectBindingsForWorkflow() {
        return {
          enabled: true,
          storePath: projectsRoot,
          bindings,
        };
      },
    },
  });

  const first = await maybeLaunchAutoStageForProject(makeParams(alphaRoot, "alpha"));
  const second = await maybeLaunchAutoStageForProject(makeParams(betaRoot, "beta"));
  const third = await maybeLaunchAutoStageForProject(makeParams(gammaRoot, "gamma"));

  assert.equal(first.launched, true);
  assert.equal(second.launched, true);
  assert.equal(third.launched, false);
  assert.equal(third.reason, "session_pool_full");
  assert.match(third.error ?? "", /session pool is at capacity/i);
  assert.equal(runs.length, 2);
});

test("queued aggressive auto-stage handoffs replay through workflow handoff routing with the bound channel", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const alphaRoot = path.join(projectsRoot, "alpha");
  const betaRoot = path.join(projectsRoot, "beta");
  const gammaRoot = path.join(projectsRoot, "gamma");
  const runtimeRuns = [];
  const handoffCalls = [];
  const completedRunIds = new Set();
  const sessionMessageCounts = new Map();
  let allowDrain = false;

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  await fs.mkdir(alphaRoot, { recursive: true });
  await fs.mkdir(betaRoot, { recursive: true });
  await fs.mkdir(gammaRoot, { recursive: true });

  const bindings = [alphaRoot, betaRoot, gammaRoot].map((projectRoot, index) => ({
    channelKey: "telegram:topic:paper-lab",
    projectRoot,
    projectId: ["alpha", "beta", "gamma"][index],
    messageChannel: "telegram",
    sessionKeySample: "agent:researcher:telegram:topic:paper-lab",
    sessionId: null,
    boundAt: "2026-03-25T00:00:00.000Z",
    updatedAt: "2026-03-25T00:05:00.000Z",
    boundByAgent: "researcher",
    notes: null,
  }));

  const runtimeSubagent = {
    async run(params) {
      runtimeRuns.push(params);
      sessionMessageCounts.set(
        params.sessionKey,
        (sessionMessageCounts.get(params.sessionKey) ?? 0) + 1
      );
      return { runId: `seed-run-${runtimeRuns.length}` };
    },
    async waitForRun({ runId }) {
      if (!allowDrain) {
        return { status: "timeout" };
      }
      if (runId === "seed-run-1" && !completedRunIds.has(runId)) {
        completedRunIds.add(runId);
        return { status: "ok" };
      }
      return { status: "timeout" };
    },
    async getSessionMessages({ sessionKey }) {
      const count = sessionMessageCounts.get(sessionKey) ?? 0;
      return {
        messages: Array.from({ length: count }, (_, index) => ({ id: `${sessionKey}:${index}` })),
      };
    },
  };

  const makeStageParams = (projectRoot, projectId) => ({
    runtimeSubagent,
    workflowPolicy: {
      autoMode: "aggressive",
      autoGate: defaultAutoGateConfig(),
      enableChannelProjectBindings: true,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
      lobsterHandoff: {
        enabled: true,
        autoModeOnly: true,
        gatewayUrl: "http://127.0.0.1:18789",
        pipelinePath: "",
        timeoutMs: 30000,
        maxStdoutBytes: 512000,
        fallbackToNative: true,
      },
    },
    projectRoot,
    projectId,
    autoIteratorResult: {
      configuredAutoMode: "aggressive",
      effectiveAutoMode: "aggressive",
      gateBlocking: false,
      stageAfter: "experiment",
      recommendedActions: [
        {
          kind: "drive_stage",
          owner: "researcher",
          stage: "experiment",
          summary: "Run one bounded experiment-search pass.",
          command: "/run-experiments",
          mailboxMessageId: null,
          cooldownRemainingSeconds: 0,
          blocking: false,
        },
      ],
    },
    launchedStageKeys: new Map(),
    deps: {
      listChannelProjectBindingsForWorkflow() {
        return {
          enabled: true,
          storePath: projectsRoot,
          bindings,
        };
      },
    },
  });

  const first = await maybeLaunchAutoStageForProject(makeStageParams(alphaRoot, "alpha"));
  const second = await maybeLaunchAutoStageForProject(makeStageParams(betaRoot, "beta"));
  const queued = await maybeLaunchAutoStageForProject(makeStageParams(gammaRoot, "gamma"));

  assert.equal(first.launched, true);
  assert.equal(second.launched, true);
  assert.equal(queued.launched, false);
  assert.equal(queued.reason, "session_pool_full");

  const alphaSessions = await readWorkflowRuntimeSessionsStore(alphaRoot);
  const alphaQueue = await readWorkflowRuntimeQueueStore(alphaRoot);
  const gammaQueue = await readWorkflowRuntimeQueueStore(gammaRoot);
  assert.equal(alphaSessions.entries.length, 1);
  assert.equal(alphaSessions.entries[0].status, "active");
  assert.equal(alphaQueue.entries.length, 1);
  assert.equal(alphaQueue.entries[0].status, "running");
  assert.equal(alphaQueue.entries[0].entryType, "dispatch_task");
  assert.equal(gammaQueue.entries.length, 1);
  assert.equal(gammaQueue.entries[0].status, "queued");

  allowDrain = true;
  const drained = await drainQueuedBackgroundWorkflowRuns({
    runtimeSubagent,
    workflowPolicy: makeStageParams(gammaRoot, "gamma").workflowPolicy,
    handoffWorkflowTaskToAgent: async (params) => {
      handoffCalls.push(params);
      return {
        dispatched: true,
        sessionKey:
          "agent:researcher:telegram:topic:paper-lab:subagent:workflow-stage:gamma:experiment",
        runId: "handoff-run-1",
        waitStatus: "ok",
        channel: "sessions_send",
        strategy: "direct_session",
        attempts: [],
        fallbackSpawned: false,
        error: null,
        backend: "native",
        lobsterStatus: null,
        fallbackReason: null,
      };
    },
  });

  assert.equal(drained.started.length, 1);
  assert.equal(handoffCalls.length, 1);
  assert.equal(handoffCalls[0].requesterChannel, "telegram");
  assert.equal(handoffCalls[0].autoModeActive, true);
});

test("maybeLaunchAutoStageForProject waits for risk discussion before generic stage dispatch", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = path.join(projectsRoot, "alpha");
  const runs = [];
  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });
  await fs.mkdir(projectRoot, { recursive: true });

  const launch = await maybeLaunchAutoStageForProject({
    runtimeSubagent: {
      async run(params) {
        runs.push(params);
        return { runId: `stage-run-${runs.length}` };
      },
    },
    workflowPolicy: {
      autoMode: "aggressive",
      autoGate: defaultAutoGateConfig(),
      enableChannelProjectBindings: true,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot,
    projectId: "alpha",
    autoIteratorResult: {
      configuredAutoMode: "aggressive",
      effectiveAutoMode: "aggressive",
      autoModeRiskLevel: "severe",
      autoModeMitigationStatus: null,
      gateBlocking: false,
      stageAfter: "write",
      recommendedActions: [
        {
          kind: "drive_stage",
          owner: "academic_writer",
          stage: "write",
          summary: "Write the current submission packet.",
          command: "/write-paper",
          mailboxMessageId: null,
          cooldownRemainingSeconds: 0,
          blocking: false,
        },
      ],
    },
    launchedStageKeys: new Map(),
    deps: {
      listChannelProjectBindingsForWorkflow() {
        return {
          enabled: true,
          storePath: projectsRoot,
          bindings: [],
        };
      },
    },
  });

  assert.equal(launch.launched, false);
  assert.equal(launch.reason, "risk_discussion_pending");
  assert.equal(runs.length, 0);
});

test("maybeAdvanceAutoModeDiscussionForProject creates and resolves a risk discussion round", async (t) => {
  const projectRoot = await makeProject(await makeProjectsRoot(), "alpha", "write");
  const runtimeCalls = [];

  t.after(async () => {
    await fs.rm(path.dirname(projectRoot), { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "alpha",
    current_stage: "write",
    citation_integrity: {
      verification_status: "needs_revision",
      hallucinated_citation_count: 1,
    },
    writing_contract: {
      template_status: "ready",
    },
    innovation_reflection: {
      status: "fresh",
    },
  });

  const start = await maybeAdvanceAutoModeDiscussionForProject({
    runtimeSubagent: {
      async run(params) {
        runtimeCalls.push(params);
        return { runId: `discussion-run-${runtimeCalls.length}` };
      },
    },
    workflowPolicy: {
      autoMode: "aggressive",
      autoGate: {
        ...defaultAutoGateConfig(),
        enabled: true,
      },
      enableChannelProjectBindings: true,
      projectsRoot: path.dirname(projectRoot),
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot,
    projectId: "alpha",
    autoIteratorResult: {
      configuredAutoMode: "aggressive",
      autoModeRiskLevel: "severe",
      autoModeRiskFingerprint: "risk-fingerprint-1",
      autoModeReasons: ["Citation integrity reports hallucinated citations."],
      stageAfter: "write",
      ownerAfter: "academic_writer",
      nextAction: "/write-paper",
      blockingReason: "Citation verification is not complete.",
      missingStageSignals: ["citation_integrity.verification_status must be verified"],
    },
    deps: {
      listChannelProjectBindingsForWorkflow() {
        return {
          enabled: true,
          storePath: path.dirname(projectRoot),
          bindings: [],
        };
      },
    },
  });

  assert.equal(start.launched, true);
  assert.equal(start.reason, "started");
  assert.equal(runtimeCalls.length, 3);
  assert.match(
    runtimeCalls.find((call) => call.sessionKey.includes("agent:researcher:"))?.sessionKey ?? "",
    /^agent:researcher:.*:subagent:/
  );

  const updated = await maybeAdvanceAutoModeDiscussionForProject({
    runtimeSubagent: {
      async run() {
        throw new Error("should not relaunch a new discussion round");
      },
      async waitForRun() {
        return { status: "ok" };
      },
      async getSessionMessages(params) {
        return {
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    riskAssessment: "resolved",
                    confidence: 8.5,
                    recommendedOwner: "academic_writer",
                    actionItems: [
                      "Tighten the citation verification summary in reviewer/CITATION_VERIFICATION.md",
                    ],
                    blockers: [],
                    summary: `Resolved by ${params.sessionKey}.`,
                  }),
                },
              ],
            },
          ],
        };
      },
    },
    workflowPolicy: {
      autoMode: "aggressive",
      autoGate: {
        ...defaultAutoGateConfig(),
        enabled: true,
      },
      enableChannelProjectBindings: true,
      projectsRoot: path.dirname(projectRoot),
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot,
    projectId: "alpha",
    autoIteratorResult: {
      configuredAutoMode: "aggressive",
      autoModeRiskLevel: "severe",
      autoModeRiskFingerprint: "risk-fingerprint-1",
      autoModeReasons: ["Citation integrity reports hallucinated citations."],
      stageAfter: "write",
      ownerAfter: "academic_writer",
      nextAction: "/write-paper",
      blockingReason: "Citation verification is not complete.",
      missingStageSignals: ["citation_integrity.verification_status must be verified"],
    },
    deps: {
      listChannelProjectBindingsForWorkflow() {
        return {
          enabled: true,
          storePath: path.dirname(projectRoot),
          bindings: [],
        };
      },
    },
  });

  assert.equal(updated.resolved, true);
  const store = await readAutoModeDiscussionStore(projectRoot);
  assert.equal(store.currentRound?.status, "resolved");
  assert.equal(store.currentRound?.aggregate?.reviewCount, 3);
});

test("maybeAdvanceAutoModeDiscussionForProject prefers announce payloads over transcript polling", async (t) => {
  const projectRoot = await makeProject(await makeProjectsRoot(), "alpha", "write");
  const runtimeCalls = [];

  t.after(async () => {
    await fs.rm(path.dirname(projectRoot), { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "alpha",
    current_stage: "write",
    citation_integrity: {
      verification_status: "needs_revision",
      hallucinated_citation_count: 1,
    },
    writing_contract: {
      template_status: "ready",
    },
    innovation_reflection: {
      status: "fresh",
    },
  });

  const policy = {
    autoMode: "aggressive",
    autoGate: {
      ...defaultAutoGateConfig(),
      enabled: true,
    },
    enableChannelProjectBindings: true,
    projectsRoot: path.dirname(projectRoot),
    heartbeatBackgroundChecks: true,
    agentContactCooldownSeconds: 300,
    enableWorkflowMailbox: true,
  };
  const deps = {
    listChannelProjectBindingsForWorkflow() {
      return {
        enabled: true,
        storePath: path.dirname(projectRoot),
        bindings: [],
      };
    },
  };
  const autoIteratorResult = {
    configuredAutoMode: "aggressive",
    autoModeRiskLevel: "severe",
    autoModeRiskFingerprint: "risk-fingerprint-announce",
    autoModeReasons: ["Citation integrity reports hallucinated citations."],
    stageAfter: "write",
    ownerAfter: "academic_writer",
    nextAction: "/write-paper",
    blockingReason: "Citation verification is not complete.",
    missingStageSignals: ["citation_integrity.verification_status must be verified"],
  };

  const start = await maybeAdvanceAutoModeDiscussionForProject({
    runtimeSubagent: {
      async run(params) {
        runtimeCalls.push(params);
        return { runId: `discussion-run-${runtimeCalls.length}` };
      },
    },
    workflowPolicy: policy,
    projectRoot,
    projectId: "alpha",
    autoIteratorResult,
    deps,
  });

  assert.equal(start.launched, true);
  const startedStore = await readAutoModeDiscussionStore(projectRoot);
  assert.equal(startedStore.currentRound?.attempts.length, 3);

  for (const attempt of startedStore.currentRound?.attempts ?? []) {
    await recordWorkflowAnnounceEvent({
      projectRoot,
      projectId: "alpha",
      announceId: `auto-discussion:${attempt.runId}:${attempt.reviewerRole}`,
      parentSessionKey: null,
      childSessionKey: attempt.sessionKey,
      deliveryMode: "internal",
      summary: `Auto discussion reviewer ${attempt.reviewerRole} completed ${attempt.runId}.`,
      payload: {
        reviewerRole: attempt.reviewerRole,
        runId: attempt.runId,
        status: "completed",
        result: {
          reviewerRole: attempt.reviewerRole,
          riskAssessment: "resolved",
          confidence: 8.5,
          recommendedOwner: "academic_writer",
          actionItems: [
            "Tighten the citation verification summary in reviewer/CITATION_VERIFICATION.md",
          ],
          blockers: [],
          summary: `Resolved by ${attempt.reviewerRole}.`,
          createdAt: "2026-03-31T00:00:00.000Z",
          runId: attempt.runId,
          rawText: JSON.stringify({ source: "announce" }),
        },
      },
    });
  }

  const updated = await maybeAdvanceAutoModeDiscussionForProject({
    runtimeSubagent: {
      async run() {
        throw new Error("should not relaunch a new discussion round");
      },
      async waitForRun() {
        throw new Error("waitForRun should not be called when announce payloads are present");
      },
      async getSessionMessages() {
        throw new Error(
          "getSessionMessages should not be called when announce payloads are present"
        );
      },
    },
    workflowPolicy: policy,
    projectRoot,
    projectId: "alpha",
    autoIteratorResult,
    deps,
  });

  assert.equal(updated.resolved, true);
  const resolvedStore = await readAutoModeDiscussionStore(projectRoot);
  assert.equal(resolvedStore.currentRound?.status, "resolved");
  assert.equal(resolvedStore.currentRound?.aggregate?.reviewCount, 3);
});

test("maybeAdvanceAutoModeDiscussionForProject queues and replays the researcher reviewer when the shared service pool is full", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const alphaRoot = path.join(projectsRoot, "alpha");
  const betaRoot = path.join(projectsRoot, "beta");
  const gammaRoot = path.join(projectsRoot, "gamma");
  const runtimeCalls = [];

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  for (const [projectRoot, projectId] of [
    [alphaRoot, "alpha"],
    [betaRoot, "beta"],
    [gammaRoot, "gamma"],
  ]) {
    await fs.mkdir(projectRoot, { recursive: true });
    await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
      project_id: projectId,
      current_stage: "write",
      citation_integrity: {
        verification_status: "needs_revision",
        hallucinated_citation_count: 1,
      },
      writing_contract: {
        template_status: "ready",
      },
      innovation_reflection: {
        status: "fresh",
      },
    });
  }

  const bindings = [alphaRoot, betaRoot, gammaRoot].map((projectRoot, index) => ({
    channelKey: "discord:group:paper-lab",
    projectRoot,
    projectId: ["alpha", "beta", "gamma"][index],
    messageChannel: "discord",
    sessionKeySample: "agent:researcher:discord:group:paper-lab",
    sessionId: null,
    boundAt: "2026-03-25T00:00:00.000Z",
    updatedAt: "2026-03-25T00:05:00.000Z",
    boundByAgent: "researcher",
    notes: null,
  }));

  const makeStageParams = (projectRoot, projectId) => ({
    runtimeSubagent: {
      async run(params) {
        runtimeCalls.push(params);
        return { runId: `seed-run-${runtimeCalls.length}` };
      },
    },
    workflowPolicy: {
      autoMode: "conservative",
      autoGate: defaultAutoGateConfig(),
      enableChannelProjectBindings: true,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot,
    projectId,
    autoIteratorResult: {
      gateBlocking: false,
      stageAfter: "experiment",
      recommendedActions: [
        {
          kind: "drive_stage",
          owner: "researcher",
          stage: "experiment",
          summary: "Run one bounded experiment-search pass.",
          command: "/run-experiments",
          mailboxMessageId: null,
          cooldownRemainingSeconds: 0,
          blocking: false,
        },
      ],
    },
    launchedStageKeys: new Map(),
    deps: {
      listChannelProjectBindingsForWorkflow() {
        return {
          enabled: true,
          storePath: projectsRoot,
          bindings,
        };
      },
    },
  });

  await maybeLaunchAutoStageForProject(makeStageParams(alphaRoot, "alpha"));
  await maybeLaunchAutoStageForProject(makeStageParams(betaRoot, "beta"));
  runtimeCalls.length = 0;
  const completedRunIds = new Set();
  let allowQueueDrain = false;
  const discussionRuntimeSubagent = {
    async run(params) {
      runtimeCalls.push(params);
      return { runId: `discussion-run-${runtimeCalls.length}` };
    },
    async waitForRun({ runId }) {
      if (allowQueueDrain && runId === "seed-run-1" && !completedRunIds.has(runId)) {
        completedRunIds.add(runId);
        return { status: "ok" };
      }
      return { status: "timeout" };
    },
    async getSessionMessages() {
      return { messages: [] };
    },
  };

  const start = await maybeAdvanceAutoModeDiscussionForProject({
    runtimeSubagent: discussionRuntimeSubagent,
    workflowPolicy: {
      autoMode: "aggressive",
      autoGate: {
        ...defaultAutoGateConfig(),
        enabled: true,
      },
      enableChannelProjectBindings: true,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot: gammaRoot,
    projectId: "gamma",
    autoIteratorResult: {
      configuredAutoMode: "aggressive",
      autoModeRiskLevel: "severe",
      autoModeRiskFingerprint: "risk-fingerprint-1",
      autoModeReasons: ["Citation integrity reports hallucinated citations."],
      stageAfter: "write",
      ownerAfter: "academic_writer",
      nextAction: "/write-paper",
      blockingReason: "Citation verification is not complete.",
      missingStageSignals: ["citation_integrity.verification_status must be verified"],
    },
    deps: {
      listChannelProjectBindingsForWorkflow() {
        return {
          enabled: true,
          storePath: projectsRoot,
          bindings,
        };
      },
    },
  });

  assert.equal(start.launched, true);
  assert.equal(start.reason, "started");
  assert.equal(runtimeCalls.length, 2);
  assert.equal(
    runtimeCalls.some((call) => String(call.sessionKey).startsWith("agent:researcher:")),
    false
  );
  const store = await readAutoModeDiscussionStore(gammaRoot);
  assert.equal(store.currentRound?.attempts.length, 3);
  const queuedResearcherAttempt = store.currentRound?.attempts.find(
    (attempt) => attempt.reviewerRole === "researcher"
  );
  assert.equal(queuedResearcherAttempt?.runId, null);
  assert.match(queuedResearcherAttempt?.queueKey ?? "", /^auto-discussion:/);

  allowQueueDrain = true;
  const drained = await drainQueuedBackgroundWorkflowRuns({
    runtimeSubagent: discussionRuntimeSubagent,
    projectsRoot,
  });
  assert.equal(drained.started.length, 1);
  assert.equal(drained.remaining.length, 0);
  assert.match(drained.started[0].summary, /queued/i);

  const updated = await maybeAdvanceAutoModeDiscussionForProject({
    runtimeSubagent: discussionRuntimeSubagent,
    workflowPolicy: {
      autoMode: "aggressive",
      autoGate: {
        ...defaultAutoGateConfig(),
        enabled: true,
      },
      enableChannelProjectBindings: true,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot: gammaRoot,
    projectId: "gamma",
    autoIteratorResult: {
      configuredAutoMode: "aggressive",
      autoModeRiskLevel: "severe",
      autoModeRiskFingerprint: "risk-fingerprint-1",
      autoModeReasons: ["Citation integrity reports hallucinated citations."],
      stageAfter: "write",
      ownerAfter: "academic_writer",
      nextAction: "/write-paper",
      blockingReason: "Citation verification is not complete.",
      missingStageSignals: ["citation_integrity.verification_status must be verified"],
    },
    deps: {
      listChannelProjectBindingsForWorkflow() {
        return {
          enabled: true,
          storePath: projectsRoot,
          bindings,
        };
      },
    },
  });

  assert.equal(updated.reason, "reviewing");
  const updatedStore = await readAutoModeDiscussionStore(gammaRoot);
  const replayedResearcherAttempt = updatedStore.currentRound?.attempts.find(
    (attempt) => attempt.reviewerRole === "researcher"
  );
  assert.equal(replayedResearcherAttempt?.runId, "discussion-run-3");
});

test("maybeDispatchAutoModeMitigationForProject routes the remediation plan to the chosen owner", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = path.join(projectsRoot, "alpha");
  const runs = [];
  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });
  await fs.mkdir(projectRoot, { recursive: true });

  const dispatch = await maybeDispatchAutoModeMitigationForProject({
    runtimeSubagent: {
      async run(params) {
        runs.push(params);
        return { runId: `mitigation-run-${runs.length}` };
      },
    },
    workflowPolicy: {
      autoMode: "aggressive",
      autoGate: defaultAutoGateConfig(),
      enableChannelProjectBindings: true,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot,
    projectId: "alpha",
    autoIteratorResult: {
      stageAfter: "write",
      nextAction: "/write-paper",
      ownerAfter: "academic_writer",
    },
    discussionAttempt: {
      launched: false,
      reason: "updated",
      projectId: "alpha",
      projectRoot,
      fingerprint: "risk-fingerprint-1",
      stage: "write",
      riskLevel: "severe",
      status: "needs_changes",
      reviewCount: 3,
      roundsStarted: 1,
      recommendedOwner: "academic_writer",
      actionItems: ["Refresh reviewer/CITATION_VERIFICATION.md with the final evidence audit."],
      blockers: ["Citation verification is still incomplete."],
      summary: "One more bounded writing pass is needed before auto mode should continue.",
      roundId: "round-1",
      packetPath: path.join(
        projectRoot,
        "reviewer",
        "auto-mode-discussion",
        "AUTO_MODE_DISCUSSION_PACKET.md"
      ),
      resolved: false,
    },
    launchedMitigationKeys: new Map(),
    deps: {
      listChannelProjectBindingsForWorkflow() {
        return {
          enabled: true,
          storePath: projectsRoot,
          bindings: [
            {
              channelKey: "discord:group:paper-lab",
              projectRoot,
              projectId: "alpha",
              messageChannel: "discord",
              sessionKeySample: "agent:researcher:discord:group:paper-lab",
              sessionId: null,
              boundAt: "2026-03-25T00:00:00.000Z",
              updatedAt: "2026-03-25T00:05:00.000Z",
              boundByAgent: "researcher",
              notes: null,
            },
          ],
        };
      },
    },
  });

  assert.equal(dispatch.launched, true);
  assert.equal(dispatch.owner, "academic_writer");
  assert.equal(dispatch.sessionKey, "agent:academic_writer:discord:group:paper-lab");
  assert.equal(runs.length, 1);
  assert.match(runs[0].message, /bounded remediation pass/i);
});

test("maybeDispatchAutoModeMitigationForProject respects the shared researcher service session pool", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const alphaRoot = path.join(projectsRoot, "alpha");
  const betaRoot = path.join(projectsRoot, "beta");
  const gammaRoot = path.join(projectsRoot, "gamma");
  const runs = [];
  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });
  await fs.mkdir(alphaRoot, { recursive: true });
  await fs.mkdir(betaRoot, { recursive: true });
  await fs.mkdir(gammaRoot, { recursive: true });

  const bindings = [alphaRoot, betaRoot, gammaRoot].map((projectRoot, index) => ({
    channelKey: "discord:group:paper-lab",
    projectRoot,
    projectId: ["alpha", "beta", "gamma"][index],
    messageChannel: "discord",
    sessionKeySample: "agent:researcher:discord:group:paper-lab",
    sessionId: null,
    boundAt: "2026-03-25T00:00:00.000Z",
    updatedAt: "2026-03-25T00:05:00.000Z",
    boundByAgent: "researcher",
    notes: null,
  }));

  const makeStageParams = (projectRoot, projectId) => ({
    runtimeSubagent: {
      async run(params) {
        runs.push(params);
        return { runId: `seed-run-${runs.length}` };
      },
    },
    workflowPolicy: {
      autoMode: "conservative",
      autoGate: defaultAutoGateConfig(),
      enableChannelProjectBindings: true,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot,
    projectId,
    autoIteratorResult: {
      gateBlocking: false,
      stageAfter: "experiment",
      recommendedActions: [
        {
          kind: "drive_stage",
          owner: "researcher",
          stage: "experiment",
          summary: "Run one bounded experiment-search pass.",
          command: "/run-experiments",
          mailboxMessageId: null,
          cooldownRemainingSeconds: 0,
          blocking: false,
        },
      ],
    },
    launchedStageKeys: new Map(),
    deps: {
      listChannelProjectBindingsForWorkflow() {
        return {
          enabled: true,
          storePath: projectsRoot,
          bindings,
        };
      },
    },
  });

  await maybeLaunchAutoStageForProject(makeStageParams(alphaRoot, "alpha"));
  await maybeLaunchAutoStageForProject(makeStageParams(betaRoot, "beta"));
  runs.length = 0;

  const dispatch = await maybeDispatchAutoModeMitigationForProject({
    runtimeSubagent: {
      async run(params) {
        runs.push(params);
        return { runId: `mitigation-run-${runs.length}` };
      },
    },
    workflowPolicy: {
      autoMode: "aggressive",
      autoGate: defaultAutoGateConfig(),
      enableChannelProjectBindings: true,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot: gammaRoot,
    projectId: "gamma",
    autoIteratorResult: {
      stageAfter: "write",
      nextAction: "/write-paper",
      ownerAfter: "researcher",
    },
    discussionAttempt: {
      launched: false,
      reason: "updated",
      projectId: "gamma",
      projectRoot: gammaRoot,
      fingerprint: "risk-fingerprint-1",
      stage: "write",
      riskLevel: "severe",
      status: "needs_changes",
      reviewCount: 2,
      roundsStarted: 1,
      recommendedOwner: "researcher",
      actionItems: ["Refresh the current evidence pack before continuing."],
      blockers: ["Researcher needs one more bounded mitigation pass."],
      summary: "Run a bounded mitigation pass before the next auto iterator tick.",
      roundId: "round-1",
      packetPath: path.join(
        gammaRoot,
        "reviewer",
        "auto-mode-discussion",
        "AUTO_MODE_DISCUSSION_PACKET.md"
      ),
      resolved: false,
    },
    launchedMitigationKeys: new Map(),
    deps: {
      listChannelProjectBindingsForWorkflow() {
        return {
          enabled: true,
          storePath: projectsRoot,
          bindings,
        };
      },
    },
  });

  assert.equal(dispatch.launched, false);
  assert.equal(dispatch.reason, "session_pool_full");
  assert.match(dispatch.error ?? "", /session pool is at capacity/i);
  assert.equal(runs.length, 0);
});

test("deriveWorkflowCoordinatorStatusUpdate summarizes visible auto-mode states", () => {
  const handedOff = deriveWorkflowCoordinatorStatusUpdate({
    projectId: "alpha",
    projectRoot: "/tmp/projects/alpha",
    stageAfter: "code",
    autoGateReview: {
      launched: false,
      reason: "not_submit_gate",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      gateId: null,
      stage: "code",
      status: null,
      reviewCount: 0,
      approved: false,
    },
    autoModeDiscussion: {
      launched: false,
      reason: "stable",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      fingerprint: null,
      stage: "code",
      riskLevel: null,
      status: null,
      reviewCount: 0,
      roundsStarted: 0,
      recommendedOwner: null,
      actionItems: [],
      blockers: [],
      summary: null,
      roundId: null,
      packetPath: null,
      resolved: false,
    },
    autoMitigationDispatch: {
      launched: false,
      reason: "not_needed",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      fingerprint: null,
      stage: "code",
      owner: null,
      sessionKey: null,
      runId: null,
      dispatchStrategy: null,
      error: null,
    },
    autoStageLaunch: {
      launched: true,
      reason: "started",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      stage: "code",
      owner: "coder",
      sessionKey: "agent:coder:discord:group:paper-lab",
      runId: "stage-run-1",
      dispatchStrategy: "direct_session",
      launchKey: "code",
      error: null,
    },
    idleResearchLaunch: {
      launched: false,
      reason: "idle_research_not_due",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      topic: null,
      sessionKey: null,
      runId: null,
      dueKey: null,
    },
  });
  assert.equal(handedOff?.status, "handed_off");
  assert.match(handedOff?.summary ?? "", /handed off/i);

  const waiting = deriveWorkflowCoordinatorStatusUpdate({
    projectId: "alpha",
    projectRoot: "/tmp/projects/alpha",
    stageAfter: "submit",
    autoGateReview: {
      launched: true,
      reason: "started",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      gateId: "GATE-5",
      stage: "submit",
      status: "reviewing",
      reviewCount: 0,
      approved: false,
    },
    autoModeDiscussion: {
      launched: false,
      reason: "stable",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      fingerprint: null,
      stage: "submit",
      riskLevel: null,
      status: null,
      reviewCount: 0,
      roundsStarted: 0,
      recommendedOwner: null,
      actionItems: [],
      blockers: [],
      summary: null,
      roundId: null,
      packetPath: null,
      resolved: false,
    },
    autoMitigationDispatch: {
      launched: false,
      reason: "not_needed",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      fingerprint: null,
      stage: "submit",
      owner: null,
      sessionKey: null,
      runId: null,
      dispatchStrategy: null,
      error: null,
    },
    autoStageLaunch: {
      launched: false,
      reason: "gate_blocked",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      stage: "submit",
      owner: null,
      sessionKey: null,
      runId: null,
      dispatchStrategy: null,
      launchKey: null,
      error: null,
    },
    idleResearchLaunch: {
      launched: false,
      reason: "idle_research_not_due",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      topic: null,
      sessionKey: null,
      runId: null,
      dueKey: null,
    },
  });
  assert.equal(waiting?.status, "waiting");
  assert.match(waiting?.summary ?? "", /waiting/i);

  const timedDefault = deriveWorkflowCoordinatorStatusUpdate({
    projectId: "alpha",
    projectRoot: "/tmp/projects/alpha",
    stageAfter: "code",
    timedDefaultTriggered: true,
    timedDefaultSummary:
      "Timed-default GATE-2 expired after the confirmation deadline; continuing via the default workflow-safe branch.",
    autoGateReview: {
      launched: false,
      reason: "not_submit_gate",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      gateId: null,
      stage: "code",
      status: null,
      reviewCount: 0,
      approved: false,
    },
    autoModeDiscussion: {
      launched: false,
      reason: "stable",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      fingerprint: null,
      stage: "code",
      riskLevel: null,
      status: null,
      reviewCount: 0,
      roundsStarted: 0,
      recommendedOwner: null,
      actionItems: [],
      blockers: [],
      summary: null,
      roundId: null,
      packetPath: null,
      resolved: false,
    },
    autoMitigationDispatch: {
      launched: false,
      reason: "not_needed",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      fingerprint: null,
      stage: "code",
      owner: null,
      sessionKey: null,
      runId: null,
      dispatchStrategy: null,
      error: null,
    },
    autoStageLaunch: {
      launched: false,
      reason: "no_drive_stage_action",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      stage: "code",
      owner: null,
      sessionKey: null,
      runId: null,
      dispatchStrategy: null,
      launchKey: null,
      error: null,
    },
    idleResearchLaunch: {
      launched: false,
      reason: "idle_research_not_due",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      topic: null,
      sessionKey: null,
      runId: null,
      dueKey: null,
      summary: null,
      reusedIdleSession: false,
      activeResearcherSessionsInChannel: null,
    },
  });
  assert.equal(timedDefault?.status, "continued");
  assert.match(timedDefault?.summary ?? "", /timed-default/i);

  const idleCapacity = deriveWorkflowCoordinatorStatusUpdate({
    projectId: "alpha",
    projectRoot: "/tmp/projects/alpha",
    stageAfter: "idea",
    autoGateReview: {
      launched: false,
      reason: "not_submit_gate",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      gateId: null,
      stage: "idea",
      status: null,
      reviewCount: 0,
      approved: false,
    },
    autoModeDiscussion: {
      launched: false,
      reason: "stable",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      fingerprint: null,
      stage: "idea",
      riskLevel: null,
      status: null,
      reviewCount: 0,
      roundsStarted: 0,
      recommendedOwner: null,
      actionItems: [],
      blockers: [],
      summary: null,
      roundId: null,
      packetPath: null,
      resolved: false,
    },
    autoMitigationDispatch: {
      launched: false,
      reason: "not_needed",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      fingerprint: null,
      stage: "idea",
      owner: null,
      sessionKey: null,
      runId: null,
      dispatchStrategy: null,
      error: null,
    },
    autoStageLaunch: {
      launched: false,
      reason: "no_drive_stage_action",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      stage: "idea",
      owner: null,
      sessionKey: null,
      runId: null,
      dispatchStrategy: null,
      launchKey: null,
      error: null,
    },
    idleResearchLaunch: {
      launched: false,
      reason: "channel_capacity_reached",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      topic: "contrastive spectral pruning",
      sessionKey: null,
      runId: null,
      dueKey: "due-now",
      summary:
        "Background workflow not started: this channel already has 2 active Researcher background subagents. Wait for one to finish before starting another.",
      reusedIdleSession: false,
      activeResearcherSessionsInChannel: 2,
    },
  });
  assert.equal(idleCapacity?.status, "queued");
  assert.match(idleCapacity?.summary ?? "", /already has 2 active Researcher background subagents/i);
});

test("workflow coordinator broadcasts visible handed-off status updates to the bound session", async (t) => {
  const runs = [];
  const services = [];
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = await makeProject(projectsRoot, "alpha", "code");

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  const plugin = {
    getWorkflowPolicy() {
      return {
        autoMode: "conservative",
        autoGate: defaultAutoGateConfig(),
        enableChannelProjectBindings: true,
        projectsRoot,
        heartbeatBackgroundChecks: true,
        agentContactCooldownSeconds: 300,
        enableWorkflowMailbox: true,
      };
    },
    api: {
      runtime: {
        subagent: {
          async run(params) {
            runs.push(params);
            return { runId: `run-${runs.length}` };
          },
        },
      },
      registerService(service) {
        services.push(service);
      },
      logger: {
        debug() {},
        info() {},
        warn() {},
      },
    },
  };

  const service = createWorkflowCoordinatorService(plugin, {
    async listWorkflowCoordinatorProjects() {
      return [
        {
          projectId: "alpha",
          projectRoot,
          source: "scan",
          stage: "code",
          updatedAt: null,
        },
      ];
    },
    async runWorkflowAutoIterator() {
      return {
        stageBefore: "code",
        stageAfter: "code",
        stageChanged: false,
        regressed: false,
        gateBlocking: false,
        recommendedActions: [
          {
            kind: "drive_stage",
            owner: "coder",
            stage: "code",
            summary: "Implement the approved experiments as runnable bundles.",
            command: "/implement-experiment",
            mailboxMessageId: null,
            cooldownRemainingSeconds: 0,
            blocking: false,
          },
        ],
      };
    },
    listChannelProjectBindingsForWorkflow() {
      return {
        enabled: true,
        storePath: projectsRoot,
        bindings: [
          {
            channelKey: "discord:group:paper-lab",
            projectRoot,
            projectId: "alpha",
            messageChannel: "discord",
            sessionKeySample: "agent:researcher:discord:group:paper-lab",
            sessionId: null,
            boundAt: "2026-03-25T00:00:00.000Z",
            updatedAt: "2026-03-25T00:05:00.000Z",
            boundByAgent: "researcher",
            notes: null,
          },
        ],
      };
    },
  });

  await service.start({
    logger: {
      debug() {},
      info() {},
      warn() {},
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await service.stop({
    logger: {
      debug() {},
      info() {},
      warn() {},
    },
  });

  assert.ok(runs.some((entry) => entry.deliver === false && /Immediate command: \/implement-experiment/.test(entry.message)));
  assert.ok(runs.some((entry) => entry.deliver === true && /\[Workflow Status\]/.test(entry.message)));
  assert.ok(runs.some((entry) => entry.deliver === true && /handed off/i.test(entry.message)));
});

test("maybeAdvanceAutoGateReviewForProject creates and advances a submit gate review round", async (t) => {
  const projectRoot = await makeProject(await makeProjectsRoot(), "alpha", "submit");
  const runtimeCalls = [];

  t.after(async () => {
    await fs.rm(path.dirname(projectRoot), { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "alpha",
    current_stage: "submit",
    citation_integrity: {
      verification_status: "verified",
    },
    writing_contract: {
      template_status: "ready",
    },
    innovation_reflection: {
      status: "fresh",
    },
  });
  await fs.mkdir(path.join(projectRoot, "academic_writer", "paper"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "academic_writer", "paper", "main.pdf"), "pdf", "utf8");

  const start = await maybeAdvanceAutoGateReviewForProject({
    runtimeSubagent: {
      async run(params) {
        runtimeCalls.push(params);
        return { runId: `gate-run-${runtimeCalls.length}` };
      },
      async waitForRun() {
        return { status: "ok" };
      },
      async getSessionMessages(params) {
        return {
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    verdict: "pass",
                    overallScore: 9,
                    dimensionScores: {
                      quality: 9,
                      evidence: 9,
                      clarity: 9,
                      citation: 9,
                      publishability: 9,
                    },
                    criticalBlockers: [],
                    majorIssues: [],
                    suggestedRollbackStage: null,
                    reviewedArtifacts: ["academic_writer/paper/main.pdf"],
                    summary: `Approved by ${params.sessionKey}.`,
                  }),
                },
              ],
            },
          ],
        };
      },
    },
    workflowPolicy: {
      autoMode: "aggressive",
      autoGate: {
        ...defaultAutoGateConfig(),
        enabled: true,
      },
      enableChannelProjectBindings: true,
      projectsRoot: path.dirname(projectRoot),
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot,
    projectId: "alpha",
    autoIteratorResult: {
      gateBlocking: true,
      stageAfter: "submit",
      recommendedActions: [],
    },
    deps: {
      listChannelProjectBindingsForWorkflow() {
        return {
          enabled: true,
          storePath: path.dirname(projectRoot),
          bindings: [
            {
              channelKey: "discord:group:paper-lab",
              projectRoot,
              projectId: "alpha",
              messageChannel: "discord",
              sessionKeySample: "agent:researcher:discord:group:paper-lab",
              sessionId: null,
              boundAt: "2026-03-25T00:00:00.000Z",
              updatedAt: "2026-03-25T00:05:00.000Z",
              boundByAgent: "researcher",
              notes: null,
            },
          ],
        };
      },
    },
  });

  assert.equal(start.launched, true);
  assert.equal(start.reason, "started");
  assert.equal(runtimeCalls.length, 3);

  const updated = await maybeAdvanceAutoGateReviewForProject({
    runtimeSubagent: {
      async run() {
        throw new Error("should not relaunch a new round");
      },
      async waitForRun() {
        return { status: "ok" };
      },
      async getSessionMessages() {
        return {
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    verdict: "pass",
                    overallScore: 9,
                    dimensionScores: {
                      quality: 9,
                      evidence: 9,
                      clarity: 9,
                      citation: 9,
                      publishability: 9,
                    },
                    criticalBlockers: [],
                    majorIssues: [],
                    suggestedRollbackStage: null,
                    reviewedArtifacts: ["academic_writer/paper/main.pdf"],
                    summary: "Approved.",
                  }),
                },
              ],
            },
          ],
        };
      },
    },
    workflowPolicy: {
      autoMode: "aggressive",
      autoGate: {
        ...defaultAutoGateConfig(),
        enabled: true,
      },
      enableChannelProjectBindings: true,
      projectsRoot: path.dirname(projectRoot),
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot,
    projectId: "alpha",
    autoIteratorResult: {
      gateBlocking: true,
      stageAfter: "submit",
      recommendedActions: [],
    },
    deps: {
      listChannelProjectBindingsForWorkflow() {
        return {
          enabled: true,
          storePath: path.dirname(projectRoot),
          bindings: [
            {
              channelKey: "discord:group:paper-lab",
              projectRoot,
              projectId: "alpha",
              messageChannel: "discord",
              sessionKeySample: "agent:researcher:discord:group:paper-lab",
              sessionId: null,
              boundAt: "2026-03-25T00:00:00.000Z",
              updatedAt: "2026-03-25T00:05:00.000Z",
              boundByAgent: "researcher",
              notes: null,
            },
          ],
        };
      },
    },
  });

  assert.equal(updated.approved, true);
  const store = await readGateReviewStore(projectRoot);
  assert.equal(store.currentRound?.status, "approved");
  assert.equal(store.currentRound?.aggregate?.reviewCount, 3);
});

test("maybeAdvanceAutoGateReviewForProject prefers announce payloads over transcript polling", async (t) => {
  const projectRoot = await makeProject(await makeProjectsRoot(), "alpha", "submit");
  const runtimeCalls = [];

  t.after(async () => {
    await fs.rm(path.dirname(projectRoot), { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "alpha",
    current_stage: "submit",
    citation_integrity: {
      verification_status: "verified",
    },
    writing_contract: {
      template_status: "ready",
    },
    innovation_reflection: {
      status: "fresh",
    },
  });
  await fs.mkdir(path.join(projectRoot, "academic_writer", "paper"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "academic_writer", "paper", "main.pdf"), "pdf", "utf8");

  const policy = {
    autoMode: "aggressive",
    autoGate: {
      ...defaultAutoGateConfig(),
      enabled: true,
    },
    enableChannelProjectBindings: true,
    projectsRoot: path.dirname(projectRoot),
    heartbeatBackgroundChecks: true,
    agentContactCooldownSeconds: 300,
    enableWorkflowMailbox: true,
  };
  const deps = {
    listChannelProjectBindingsForWorkflow() {
      return {
        enabled: true,
        storePath: path.dirname(projectRoot),
        bindings: [
          {
            channelKey: "discord:group:paper-lab",
            projectRoot,
            projectId: "alpha",
            messageChannel: "discord",
            sessionKeySample: "agent:researcher:discord:group:paper-lab",
            sessionId: null,
            boundAt: "2026-03-25T00:00:00.000Z",
            updatedAt: "2026-03-25T00:05:00.000Z",
            boundByAgent: "researcher",
            notes: null,
          },
        ],
      };
    },
  };

  const start = await maybeAdvanceAutoGateReviewForProject({
    runtimeSubagent: {
      async run(params) {
        runtimeCalls.push(params);
        return { runId: `gate-run-${runtimeCalls.length}` };
      },
    },
    workflowPolicy: policy,
    projectRoot,
    projectId: "alpha",
    autoIteratorResult: {
      gateBlocking: true,
      stageAfter: "submit",
      recommendedActions: [],
    },
    deps,
  });

  assert.equal(start.launched, true);
  const startedStore = await readGateReviewStore(projectRoot);
  assert.equal(startedStore.currentRound?.attempts.length, 3);

  for (const attempt of startedStore.currentRound?.attempts ?? []) {
    await recordWorkflowAnnounceEvent({
      projectRoot,
      projectId: "alpha",
      announceId: `gate-review:${attempt.runId}:${attempt.reviewerRole}`,
      parentSessionKey: null,
      childSessionKey: attempt.sessionKey,
      deliveryMode: "internal",
      summary: `Gate reviewer ${attempt.reviewerRole} completed ${attempt.runId}.`,
      payload: {
        reviewerRole: attempt.reviewerRole,
        runId: attempt.runId,
        status: "completed",
        result: {
          reviewerRole: attempt.reviewerRole,
          verdict: "pass",
          overallScore: 9,
          dimensionScores: {
            quality: 9,
            evidence: 9,
            clarity: 9,
            citation: 9,
            publishability: 9,
          },
          criticalBlockers: [],
          majorIssues: [],
          suggestedRollbackStage: null,
          reviewedArtifacts: ["academic_writer/paper/main.pdf"],
          summary: `Approved by ${attempt.reviewerRole}.`,
          createdAt: "2026-03-31T00:00:00.000Z",
          runId: attempt.runId,
          rawText: JSON.stringify({ source: "announce" }),
        },
      },
    });
  }

  const updated = await maybeAdvanceAutoGateReviewForProject({
    runtimeSubagent: {
      async run() {
        throw new Error("should not relaunch a new round");
      },
      async waitForRun() {
        throw new Error("waitForRun should not be called when announce payloads are present");
      },
      async getSessionMessages() {
        throw new Error(
          "getSessionMessages should not be called when announce payloads are present"
        );
      },
    },
    workflowPolicy: policy,
    projectRoot,
    projectId: "alpha",
    autoIteratorResult: {
      gateBlocking: true,
      stageAfter: "submit",
      recommendedActions: [],
    },
    deps,
  });

  assert.equal(updated.approved, true);
  const approvedStore = await readGateReviewStore(projectRoot);
  assert.equal(approvedStore.currentRound?.status, "approved");
  assert.equal(approvedStore.currentRound?.aggregate?.reviewCount, 3);
});
