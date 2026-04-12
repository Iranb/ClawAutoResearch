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
  claimWorkflowTask,
  materializeWorkflowTaskGraph,
  readWorkflowTaskGraphStore,
} from "../tools/workflow-team/task-graph.ts";
import {
  materializeWorkflowTeamRound,
  readWorkflowTeamRoundStore,
  recordWorkflowTeamRoundClaim,
} from "../tools/workflow-team/team-round.ts";
import {
  createWorkflowCoordinatorService,
  deriveWorkflowCoordinatorStatusUpdate,
  maybeAdvanceAutoCodeReviewForProject,
  listWorkflowCoordinatorProjects,
  maybeAdvanceAutoModeDiscussionForProject,
  maybeAdvanceAutoGateReviewForProject,
  maybeDispatchAutoModeMitigationForProject,
  maybeLaunchAutoStageForProject,
  maybeLaunchAutoZoteroSyncForProject,
  maybeLaunchIdleResearchForProject,
  maybeLaunchPaperIngestionWorkerForProject,
  reconcileClaimedWorkflowTasksForProject,
  runWorkflowCoordinatorPass,
} from "../tools/register-workflow-service.ts";
import {
  selectDispatchableAutoStageAction,
} from "../tools/workflow-guard-runtime/auto-iterator.ts";
import { recordWorkflowAnnounceEvent } from "../tools/workflow-session-orchestrator.ts";
import { readGateReviewStore } from "../tools/workflow-auto-gate.ts";
import { defaultAutoGateConfig } from "../tools/workflow-auto-gate.ts";
import { readCodeReviewStore } from "../tools/workflow-code-review.ts";
import { readAutoModeDiscussionStore } from "../tools/workflow-auto-discussion.ts";
import { readWorkflowHandoffIntentStore } from "../tools/workflow-handoff/handoff-store.ts";
import { readWorkflowArtifactReceiptStore } from "../tools/workflow-handoff/artifact-receipts.ts";

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

async function acknowledgePendingWorkflowMailboxes(projectRoots) {
  for (const projectRoot of projectRoots) {
    const mailboxPath = path.join(
      projectRoot,
      ".openclaw-research",
      "workflow-mailbox.json"
    );
    try {
      const mailbox = JSON.parse(await fs.readFile(mailboxPath, "utf8"));
      let changed = false;
      for (const entry of mailbox.messages ?? []) {
        if (entry?.status === "pending") {
          entry.status = "acknowledged";
          entry.acknowledgedAt = "2026-04-10T12:00:00.000Z";
          changed = true;
        }
      }
      if (changed) {
        await fs.writeFile(mailboxPath, `${JSON.stringify(mailbox, null, 2)}\n`, "utf8");
      }
    } catch {
      // Some tests do not materialize a mailbox; ignore those cases.
    }
  }
}

async function makeProject(projectsRoot, projectId, stage = "setup") {
  const projectRoot = path.join(projectsRoot, projectId);
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: projectId,
    current_stage: stage,
  });
  return projectRoot;
}

async function seedProjectPapers(projectRoot, extraManifest = {}) {
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: path.basename(projectRoot),
    current_stage: "idea",
    graph_last_built_at: "2026-04-09T10:00:00.000Z",
    research_program: {
      baseline_reference: "Baseline Paper",
    },
    ...extraManifest,
  });
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "arxiv:1111.1111",
        title: "Baseline Paper",
      },
      {
        canonical_id: "arxiv:2222.2222",
        title: "Followup Paper",
      },
    ],
  });
}

test("selectDispatchableAutoStageAction withholds drive_stage when stage signals remain", () => {
  const action = selectDispatchableAutoStageAction({
    autoIteratorResult: {
      gateBlocking: false,
      missingStageSignals: ["PROJECT_MANIFEST.json.research_program.plan_selection"],
      recommendedActions: [
        {
          kind: "background",
          stage: "code",
          owner: "researcher",
          summary: "Repair workflow-owned readiness gaps before handing off code.",
          command: "Resolve the readiness blockers and materialize the missing workflow-owned gap.",
          mailboxQueued: false,
          mailboxMessageId: null,
          cooldownRemainingSeconds: null,
          blocking: false,
        },
        {
          kind: "drive_stage",
          stage: "code",
          owner: "coder",
          summary: "Implement the approved experiments as runnable bundles.",
          command: "/implement-experiment",
          mailboxQueued: false,
          mailboxMessageId: "mailbox-1",
          cooldownRemainingSeconds: 0,
          blocking: false,
        },
      ],
    },
  });

  assert.equal(action, null);
});

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
      channelKey: null,
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

test("maybeLaunchIdleResearchForProject keeps researcher background capacity isolated per project on the same channel", async (t) => {
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

  assert.equal(blocked.launched, true);
  assert.equal(blocked.reason, "started");
  assert.equal(runCalls.length, 3);
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
        await acknowledgePendingWorkflowMailboxes([projectRoot]);
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

test("maybeLaunchAutoStageForProject claims the next matching task for the launched owner session", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = path.join(projectsRoot, "alpha");
  const runs = [];
  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });
  await fs.mkdir(projectRoot, { recursive: true });
  await materializeWorkflowTaskGraph({
    projectRoot,
    projectId: "alpha",
    stage: "code",
    topTierVerdict: "worth_top_tier_bet",
    evidenceCloseout: {
      status: "blocked",
      topTierVerdict: "worth_top_tier_bet",
      blockers: ["benchmark protocol missing"],
      experimentAnalyzeReady: false,
      analyzeReviewReady: true,
      writeReady: false,
      submitReady: false,
      graphDependentBlockerCount: 0,
      localEvidenceBlockerCount: 1,
    },
    previewTasks: [
      {
        taskId: "code.implement_experiment_bundle",
        title: "Implement the approved experiment bundle",
        owner: "coder",
        status: "blocked",
        reason: "Bundle implementation is pending.",
      },
    ],
  });

  const launch = await maybeLaunchAutoStageForProject({
    runtimeSubagent: {
      async run(params) {
        runs.push(params);
        await acknowledgePendingWorkflowMailboxes([projectRoot]);
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
  const store = await readWorkflowTaskGraphStore(projectRoot);
  assert.equal(store?.tasks[0].status, "claimed");
  assert.equal(store?.tasks[0].lease?.sessionKey, "agent:coder:discord:group:paper-lab");
  const teamRound = await readWorkflowTeamRoundStore(projectRoot);
  assert.equal(teamRound?.activeSessionKeys.includes("agent:coder:discord:group:paper-lab"), true);
  assert.equal(teamRound?.lastClaimedTaskId, "code.implement_experiment_bundle");
});

test("reconcileClaimedWorkflowTasksForProject releases claimed tasks for completed runtime sessions", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = path.join(projectsRoot, "alpha");
  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(projectRoot, ".openclaw-research"), { recursive: true });
  await materializeWorkflowTaskGraph({
    projectRoot,
    projectId: "alpha",
    stage: "code",
    topTierVerdict: "worth_top_tier_bet",
    evidenceCloseout: {
      status: "blocked",
      topTierVerdict: "worth_top_tier_bet",
      blockers: ["benchmark protocol missing"],
      experimentAnalyzeReady: false,
      analyzeReviewReady: true,
      writeReady: false,
      submitReady: false,
      graphDependentBlockerCount: 0,
      localEvidenceBlockerCount: 1,
    },
    previewTasks: [
      {
        taskId: "code.implement_experiment_bundle",
        title: "Implement the approved experiment bundle",
        owner: "coder",
        status: "blocked",
        reason: "Bundle implementation is pending.",
      },
    ],
  });
  await claimWorkflowTask({
    projectRoot,
    taskId: "code.implement_experiment_bundle",
    sessionKey: "agent:coder:discord:group:paper-lab",
    role: "coder",
  });
  await materializeWorkflowTeamRound({
    projectRoot,
    projectId: "alpha",
    stage: "code",
    leadRole: "coder",
    topTierVerdict: "worth_top_tier_bet",
    evidenceCloseoutStatus: "blocked",
    taskGraphPath: path.join(projectRoot, ".openclaw-research", "workflow-task-graph.json"),
    taskCount: 1,
    claimableCount: 0,
    blockedCount: 0,
    claimedCount: 1,
    verifyingCount: 0,
    needsRepairCount: 0,
    satisfiedCount: 0,
    optionalCount: 0,
  });
  await recordWorkflowTeamRoundClaim({
    projectRoot,
    sessionKey: "agent:coder:discord:group:paper-lab",
    taskId: "code.implement_experiment_bundle",
  });
  await writeJson(path.join(projectRoot, ".openclaw-research", "workflow-runtime-sessions.json"), {
    schemaVersion: 1,
    runtimeFramework: "sessions_spawn_v1",
    compatibilityMode: "sessions_spawn_runtime",
    updatedAt: "2026-04-11T00:00:00.000Z",
    migration: {
      version: 1,
      status: "completed",
      compatibilityMode: "sessions_spawn_runtime",
      migratedAt: "2026-04-11T00:00:00.000Z",
      reason: null,
      preservedFiles: [],
      notes: [],
    },
    projectId: "alpha",
    projectRoot,
    entries: [
      {
        sessionKey: "agent:coder:discord:group:paper-lab",
        sessionId: null,
        runtime: "subagent",
        role: "coder",
        agentId: "coder",
        ownerAgent: "coder",
        family: "research",
        kind: "workflow_stage_dispatch",
        channelKey: "discord:group:paper-lab",
        requesterSessionKey: "agent:researcher:discord:group:paper-lab",
        projectId: "alpha",
        projectRoot,
        parentSessionKey: "agent:researcher:discord:group:paper-lab",
        threadBindingKey: null,
        depth: 1,
        status: "completed",
        runId: "run-1",
        queueKey: "alpha::code::coder",
        startedAt: "2026-04-11T00:00:00.000Z",
        lastHeartbeatAt: "2026-04-11T00:01:00.000Z",
        lastAnnounceAt: null,
        lastCheckedAt: "2026-04-11T00:01:00.000Z",
        lastFinishedAt: "2026-04-11T00:02:00.000Z",
        lastError: null,
      },
    ],
  });

  const released = await reconcileClaimedWorkflowTasksForProject({
    projectRoot,
    projectId: "alpha",
  });

  assert.deepEqual(released.releasedTaskIds, ["code.implement_experiment_bundle"]);
  const store = await readWorkflowTaskGraphStore(projectRoot);
  assert.equal(store?.tasks[0].status, "claimable");
  const teamRound = await readWorkflowTeamRoundStore(projectRoot);
  assert.equal(teamRound?.activeSessionKeys.includes("agent:coder:discord:group:paper-lab"), false);
});

test("maybeLaunchAutoStageForProject keeps readiness-blocked stages on repair guidance instead of drive_stage handoff", async (t) => {
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
        await acknowledgePendingWorkflowMailboxes([projectRoot]);
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
      missingStageSignals: [
        "PROJECT_MANIFEST.json.research_program.plan_selection",
      ],
      recommendedActions: [
        {
          kind: "background",
          owner: "researcher",
          stage: "code",
          summary:
            "Repair workflow-owned readiness gaps before handing off the stage.",
          command:
            "Resolve the readiness blockers and materialize the missing workflow-owned gap before handing off code.",
          mailboxMessageId: null,
          cooldownRemainingSeconds: null,
          blocking: false,
        },
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

  assert.equal(launch.launched, false);
  assert.equal(launch.reason, "no_drive_stage_action");
  assert.equal(runs.length, 0);
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
        await acknowledgePendingWorkflowMailboxes([projectRoot]);
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

test("maybeLaunchAutoStageForProject honors configured experiment monitor cooldowns", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = path.join(projectsRoot, "alpha");
  const runs = [];
  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });
  await fs.mkdir(projectRoot, { recursive: true });

  const monitorCommand =
    "Run /monitor-experiment to reconcile active remote experiments and promote completed runs into artifacts/results/, EXPERIMENT_REGISTRY.md, EXPERIMENT_LEDGER.json, and experiment_search until ready_for_analysis.";
  const launchedStageKeys = new Map([
    [
      projectRoot,
      {
        key: `${projectRoot}::experiment::researcher::${monitorCommand}`,
        launchedAt: Date.now() - 61_000,
      },
    ],
  ]);

  const launch = await maybeLaunchAutoStageForProject({
    runtimeSubagent: {
      async run(params) {
        runs.push(params);
        await acknowledgePendingWorkflowMailboxes([projectRoot]);
        return { runId: `monitor-run-${runs.length}` };
      },
    },
    workflowPolicy: {
      autoMode: "conservative",
      autoGate: {
        ...defaultAutoGateConfig(),
        experimentMonitorCooldownMs: 60 * 1000,
      },
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
          summary: "Monitor active remote experiments and reconcile finished runs.",
          command: monitorCommand,
          mailboxMessageId: null,
          cooldownRemainingSeconds: 0,
          blocking: false,
        },
      ],
    },
    launchedStageKeys,
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
  assert.equal(launch.reason, "started");
  assert.equal(launch.stage, "experiment");
  assert.equal(launch.owner, "researcher");
  assert.equal(runs.length, 1);
  assert.match(runs[0].message ?? "", /\/monitor-experiment/i);
});

test("maybeLaunchAutoStageForProject defaults experiment monitor cooldown to five minutes", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = path.join(projectsRoot, "alpha");
  const runs = [];
  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });
  await fs.mkdir(projectRoot, { recursive: true });

  const monitorCommand =
    "Run /monitor-experiment to reconcile active remote experiments and promote completed runs into artifacts/results/, EXPERIMENT_REGISTRY.md, EXPERIMENT_LEDGER.json, and experiment_search until ready_for_analysis.";
  const launchedStageKeys = new Map([
    [
      projectRoot,
      {
        key: `${projectRoot}::experiment::researcher::${monitorCommand}`,
        launchedAt: Date.now() - 61_000,
      },
    ],
  ]);

  const launch = await maybeLaunchAutoStageForProject({
    runtimeSubagent: {
      async run(params) {
        runs.push(params);
        return { runId: `monitor-run-${runs.length}` };
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
          summary: "Monitor active remote experiments and reconcile finished runs.",
          command: monitorCommand,
          mailboxMessageId: null,
          cooldownRemainingSeconds: 0,
          blocking: false,
        },
      ],
    },
    launchedStageKeys,
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

  assert.equal(launch.launched, false);
  assert.equal(launch.reason, "already_launched");
  assert.equal(runs.length, 0);
});

test("maybeLaunchAutoZoteroSyncForProject starts a non-blocking researcher continuation after graph refresh", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = path.join(projectsRoot, "alpha");
  const runs = [];

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  await fs.mkdir(projectRoot, { recursive: true });
  await seedProjectPapers(projectRoot);

  const launch = await maybeLaunchAutoZoteroSyncForProject({
    runtimeSubagent: {
      async run(params) {
        runs.push(params);
        return { runId: `zotero-run-${runs.length}` };
      },
    },
    workflowPolicy: {
      enableChannelProjectBindings: true,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
      zoteroProjectRoot: "Bot",
    },
    projectRoot,
    projectId: "alpha",
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
  assert.equal(launch.trigger, "auto_graph_refresh");
  assert.equal(runs.length, 1);
  assert.match(runs[0].message ?? "", /\/zotero-sync/i);
  assert.match(runs[0].extraSystemPrompt ?? "", /Workflow coordinator soft Zotero sync trigger/i);
  assert.match(runs[0].extraSystemPrompt ?? "", /Trigger:\s+auto_graph_refresh/i);
});

test("maybeLaunchAutoZoteroSyncForProject queues non-blocking work when gateway runtime access is unavailable", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = path.join(projectsRoot, "alpha");

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  await fs.mkdir(projectRoot, { recursive: true });
  await seedProjectPapers(projectRoot);

  const launch = await maybeLaunchAutoZoteroSyncForProject({
    workflowPolicy: {
      enableChannelProjectBindings: true,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
      zoteroProjectRoot: "Bot",
    },
    projectRoot,
    projectId: "alpha",
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

  assert.equal(launch.launched, false);
  assert.equal(launch.queued, true);
  assert.equal(launch.reason, "queued");
  assert.equal(launch.trigger, "auto_graph_refresh");
});

test("maybeLaunchPaperIngestionWorkerForProject starts queued PaperNexus uploads without a graph-build agent turn", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = path.join(projectsRoot, "alpha");
  const batchManifestPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "batch-import.json"
  );
  const stagedMarkdownPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "demo-paper.md"
  );
  const runs = [];

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.dirname(batchManifestPath), { recursive: true });
  await fs.writeFile(
    stagedMarkdownPath,
    "# Demo Paper\n\nThis markdown fixture is long enough for staged validation. ".repeat(30),
    "utf8"
  );
  await writeJson(batchManifestPath, {
    version: 1,
    papers: [
      {
        paperId: "demo-paper",
        source: stagedMarkdownPath,
        sourceKind: "markdown",
      },
    ],
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "alpha",
    current_stage: "graph_build",
    owner_agent: "researcher",
    paper_ingestion: {
      queued_requests: [
        {
          request_id: "req-batch-1",
          status: "queued",
          wrapper: "pn_batch_import.py",
          command_text:
            `python3 scripts/pn_batch_import.py --api-base https://papernexus.example/api --corpus GCD --manifest ${batchManifestPath} submit`,
          manifest_path: batchManifestPath,
          shared_corpus: "GCD",
          paper_count: 1,
          summary: "Queued corpus upload",
          created_at: "2026-04-02T00:00:00.000Z",
          updated_at: "2026-04-02T00:00:00.000Z",
        },
      ],
    },
  });

  const launch = await maybeLaunchPaperIngestionWorkerForProject({
    runtimeSubagent: {
      async run(params) {
        runs.push(params);
        return { runId: `upload-run-${runs.length}` };
      },
    },
    workflowPolicy: {
      enableChannelProjectBindings: true,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot,
    projectId: "alpha",
    triggerKind: "coordinator_heartbeat",
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

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(launch.launched, true);
  assert.equal(launch.reason, "started");
  assert.equal(runs.length, 1);
  assert.match(runs[0].message, /^python3 scripts\/pn_batch_import\.py\b/);
  assert.match(runs[0].extraSystemPrompt ?? "", /WORKFLOW_OWNED_PAPER_INGESTION_REQUEST_ID=req-batch-1/);
  assert.equal(manifest.paper_ingestion.queued_requests[0].status, "running");
  assert.equal(manifest.paper_ingestion.queued_requests[0].last_run_id, "upload-run-1");
  assert.equal(
    manifest.paper_ingestion.queued_requests[0].trigger_kind,
    "coordinator_heartbeat"
  );
});

test("maybeLaunchAutoStageForProject keeps the researcher service session pool isolated per project", async (t) => {
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
        await acknowledgePendingWorkflowMailboxes([alphaRoot, betaRoot, gammaRoot]);
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
  assert.equal(third.launched, true);
  assert.equal(runs.length, 3);
});

test("aggressive auto-stage handoffs no longer queue purely because another project is active on the same channel", async (t) => {
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
      await acknowledgePendingWorkflowMailboxes([alphaRoot, betaRoot, gammaRoot]);
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
  assert.equal(queued.launched, true);
  assert.equal(runtimeRuns.length, 3);
  assert.equal(handoffCalls.length, 0);

  const alphaSessions = await readWorkflowRuntimeSessionsStore(alphaRoot);
  const alphaQueue = await readWorkflowRuntimeQueueStore(alphaRoot);
  const gammaQueue = await readWorkflowRuntimeQueueStore(gammaRoot);
  assert.equal(alphaSessions.entries.length, 1);
  assert.equal(alphaSessions.entries[0].status, "active");
  assert.equal(alphaQueue.entries.length, 1);
  assert.equal(alphaQueue.entries[0].status, "running");
  assert.equal(gammaQueue.entries.length, 1);
  assert.equal(gammaQueue.entries[0].status, "running");
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

test("maybeAdvanceAutoModeDiscussionForProject can still launch the researcher reviewer for another project on the same channel", async (t) => {
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
  assert.equal(runtimeCalls.length, 3);
  assert.equal(
    runtimeCalls.some((call) => String(call.sessionKey).startsWith("agent:researcher:")),
    true
  );
  const store = await readAutoModeDiscussionStore(gammaRoot);
  assert.equal(store.currentRound?.attempts.length, 3);
  const queuedResearcherAttempt = store.currentRound?.attempts.find(
    (attempt) => attempt.reviewerRole === "researcher"
  );
  assert.equal(typeof queuedResearcherAttempt?.runId, "string");
  assert.equal(typeof queuedResearcherAttempt?.queueKey, "string");
  assert.equal(queuedResearcherAttempt?.status, "pending");

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
  assert.equal(replayedResearcherAttempt?.runId, queuedResearcherAttempt?.runId);
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
        await acknowledgePendingWorkflowMailboxes([projectRoot]);
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

test("maybeDispatchAutoModeMitigationForProject does not block another project on the same channel", async (t) => {
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
        await acknowledgePendingWorkflowMailboxes([alphaRoot, betaRoot, gammaRoot]);
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
        await acknowledgePendingWorkflowMailboxes([alphaRoot, betaRoot, gammaRoot]);
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

  assert.equal(dispatch.launched, true);
  assert.equal(dispatch.reason, "started");
  assert.equal(runs.length, 1);
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
      launched: false,
      reason: "manual_confirmation_required",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      gateId: "GATE-5",
      stage: "submit",
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
  assert.match(waiting?.summary ?? "", /human confirmation|OpenReview/i);

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
            await acknowledgePendingWorkflowMailboxes([projectRoot]);
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
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (
      runs.some(
        (entry) =>
          entry.deliver === false &&
          /Immediate command: \/implement-experiment/.test(entry.message)
      ) &&
      runs.some(
        (entry) => entry.deliver === true && /\[Workflow Status\]/.test(entry.message)
      )
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
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

test("maybeAdvanceAutoGateReviewForProject leaves submit under manual confirmation and does not launch reviewers", async (t) => {
  const projectRoot = await makeProject(await makeProjectsRoot(), "alpha", "submit");

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
        throw new Error(`should not launch submit auto review: ${params.sessionKey}`);
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

  assert.equal(start.launched, false);
  assert.equal(start.reason, "manual_confirmation_required");
  const store = await readGateReviewStore(projectRoot);
  assert.equal(store.currentRound, null);
});

test("maybeAdvanceAutoGateReviewForProject ignores legacy submit announce data because final confirmation is manual", async (t) => {
  const projectRoot = await makeProject(await makeProjectsRoot(), "alpha", "submit");

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
        throw new Error(`should not launch submit auto review: ${params.sessionKey}`);
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

  assert.equal(start.launched, false);
  assert.equal(start.reason, "manual_confirmation_required");

  await recordWorkflowAnnounceEvent({
    projectRoot,
    projectId: "alpha",
    announceId: "gate-review:legacy-run:reviewer",
    parentSessionKey: null,
    childSessionKey: "agent:reviewer:main",
    deliveryMode: "internal",
    summary: "Legacy gate reviewer announce should be ignored for manual submit confirmation.",
    payload: {
      reviewerRole: "reviewer",
      runId: "legacy-run",
      status: "completed",
      result: {
        reviewerRole: "reviewer",
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
        summary: "Approved by reviewer.",
        createdAt: "2026-03-31T00:00:00.000Z",
        runId: "legacy-run",
        rawText: JSON.stringify({ source: "announce" }),
      },
    },
  });

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

  assert.equal(updated.launched, false);
  assert.equal(updated.reason, "manual_confirmation_required");
  const approvedStore = await readGateReviewStore(projectRoot);
  assert.equal(approvedStore.currentRound, null);
});

test("maybeAdvanceAutoCodeReviewForProject creates and advances a code innovation review round", async (t) => {
  const projectRoot = await makeProject(await makeProjectsRoot(), "alpha", "code");
  const runtimeCalls = [];

  t.after(async () => {
    await fs.rm(path.dirname(projectRoot), { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "alpha",
    current_stage: "code",
    research_program: {
      tracks: [
        {
          track_id: "track-1",
          status: "active",
          hypothesis: "Graph grounding improves support precision.",
          novelty_basis: "It couples frontier packets with section drafting.",
        },
      ],
    },
  });
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), {
    tracks: [
      {
        track_id: "track-1",
        status: "active",
      },
    ],
  });
  await fs.mkdir(path.join(projectRoot, "coder", "experiments", "track-1", "exp-1__baseline"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(projectRoot, "coder", "EXPERIMENT_INDEX.md"),
    "# experiment index\n",
    "utf8"
  );
  await fs.mkdir(path.join(projectRoot, "orchestrator"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "coder", "experiments", "track-1", "exp-1__baseline", "train.py"),
    "print('ok')\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "coder", "experiments", "track-1", "exp-1__baseline", "README.md"),
    "# readme\n",
    "utf8"
  );
  await writeJson(
    path.join(
      projectRoot,
      "coder",
      "experiments",
      "track-1",
      "exp-1__baseline",
      "EXPERIMENT_MANIFEST.json"
    ),
    {
      experiment_id: "exp-1",
      project_id: "alpha",
      track_id: "track-1",
      question: "Does graph grounding improve support precision?",
      hypothesis: "Graph grounding improves support precision.",
      novelty_basis: "It couples frontier packets with section drafting.",
      baseline_reference: "baseline-a",
      primary_baseline_metric: "acc",
      target_improvement: "Improve acc by >= 2 points over baseline-a.",
      baseline_training_protocol: "Reuse baseline-a training settings.",
      baseline_eval_protocol: "Reuse baseline-a evaluation protocol.",
      innovation_points: ["Graph-grounded support routing"],
      validation_steps: [
        {
          step_id: "step-1",
          objective: "Enable graph-grounded support routing only.",
          covers: ["Graph-grounded support routing"],
        },
      ],
      ablation_plan: [
        {
          ablation_id: "minus-routing",
          objective: "Disable graph routing.",
          covers: ["Graph-grounded support routing"],
        },
      ],
    }
  );
  await fs.writeFile(path.join(projectRoot, "orchestrator", "PLAN.md"), "# plan\n", "utf8");
  await fs.writeFile(path.join(projectRoot, "orchestrator", "TODOS.md"), "# todos\n", "utf8");
  await fs.writeFile(
    path.join(projectRoot, "orchestrator", "PLAN_AUDIT.md"),
    "# audit\n",
    "utf8"
  );

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
            boundAt: "2026-04-01T00:00:00.000Z",
            updatedAt: "2026-04-01T00:05:00.000Z",
            boundByAgent: "researcher",
            notes: null,
          },
        ],
      };
    },
  };

  const start = await maybeAdvanceAutoCodeReviewForProject({
    runtimeSubagent: {
      async run(params) {
        runtimeCalls.push(params);
        return { runId: `code-review-run-${runtimeCalls.length}` };
      },
    },
    workflowPolicy: policy,
    projectRoot,
    projectId: "alpha",
    autoIteratorResult: {
      gateBlocking: true,
      gateReason: "CODE innovation review is pending; wait for the reviewer panel to validate baseline alignment, execution viability, and innovation-step coverage.",
      stageAfter: "code",
      missingStageSignals: [],
      recommendedActions: [],
    },
    deps,
  });

  assert.equal(start.launched, true);
  assert.equal(start.reason, "started");
  assert.equal(runtimeCalls.length, 3);
  const handoffStoreAfterStart = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(
    handoffStoreAfterStart.intents.filter(
      (intent) => intent.reason === "code_review_required"
    ).length,
    3
  );

  const startedStore = await readCodeReviewStore(projectRoot);
  for (const attempt of startedStore.currentRound?.attempts ?? []) {
    await recordWorkflowAnnounceEvent({
      projectRoot,
      projectId: "alpha",
      announceId: `code-review:${attempt.runId}:${attempt.reviewerRole}`,
      parentSessionKey: null,
      childSessionKey: attempt.sessionKey,
      deliveryMode: "internal",
      summary: `Code reviewer ${attempt.reviewerRole} completed ${attempt.runId}.`,
      payload: {
        reviewerRole: attempt.reviewerRole,
        runId: attempt.runId,
        status: "completed",
        result: {
          reviewerRole: attempt.reviewerRole,
          verdict: "pass",
          overallScore: 9,
          dimensionScores: {
            innovation_alignment: 9,
            baseline_fidelity: 9,
            validation_plan: 9,
            execution_readiness: 9,
          },
          criticalBlockers: [],
          majorIssues: [],
          suggestedRollbackStage: null,
          reviewedArtifacts: ["coder/EXPERIMENT_INDEX.md"],
          summary: `Approved by ${attempt.reviewerRole}.`,
          createdAt: "2026-04-01T00:00:00.000Z",
          runId: attempt.runId,
          rawText: JSON.stringify({ source: "announce" }),
        },
      },
    });
  }

  const updated = await maybeAdvanceAutoCodeReviewForProject({
    runtimeSubagent: {
      async run() {
        throw new Error("should not relaunch a new code review round");
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
      gateReason: "CODE innovation review is pending; wait for the reviewer panel to validate baseline alignment, execution viability, and innovation-step coverage.",
      stageAfter: "code",
      missingStageSignals: [],
      recommendedActions: [],
    },
    deps,
  });

  assert.equal(updated.approved, true);
  const approvedStore = await readCodeReviewStore(projectRoot);
  assert.equal(approvedStore.currentRound?.status, "approved");
  assert.equal(approvedStore.currentRound?.aggregate?.reviewCount, 3);
  const receiptStore = await readWorkflowArtifactReceiptStore(projectRoot);
  assert.equal(receiptStore.receipts.length, 3);
  assert.equal(
    receiptStore.receipts.every((receipt) => receipt.verificationResult === "passed"),
    true
  );
});
