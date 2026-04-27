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
import { bindChannelProjectForWorkflow } from "../tools/workflow-guard.ts";
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
  maybeAdvanceSurveyBriefRefinementForProject,
  maybeAdvanceWorkflowPanelDiscussionForProject,
  maybeAdvanceAutoGateReviewForProject,
  maybeAdvanceWorkflowHookPointForProject,
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
import { readWorkflowHooksStateStore } from "../tools/workflow-hooks/state.ts";
import { recordWorkflowNotificationChannelForProject } from "../tools/workflow-notification-channels.ts";

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

async function writeFakePapernexusBatchScript(scriptDir) {
  await fs.mkdir(scriptDir, { recursive: true });
  const scriptPath = path.join(scriptDir, "pn_batch_import.py");
  await fs.writeFile(
    scriptPath,
    [
      "#!/usr/bin/env python3",
      "import json, sys",
      "args = sys.argv[1:]",
      "def opt(name):",
      "    if name in args:",
      "        index = args.index(name)",
      "        return args[index + 1] if index + 1 < len(args) else None",
      "    prefix = name + '='",
      "    for arg in args:",
      "        if arg.startswith(prefix):",
      "            return arg[len(prefix):]",
      "    return None",
      "payload = {",
      "    'manifest': opt('--manifest'),",
      "    'corpus': opt('--corpus'),",
      "    'summary': {'total': 1, 'submitted': 1, 'completed': 1, 'running': 0, 'pending': 0, 'failed': 0, 'remaining': 0, 'overallPercent': 100},",
      "    'queueSummary': {'total': 1, 'pending': 0, 'running': 0, 'completed': 1, 'failed': 0, 'remaining': 0, 'overallPercent': 100},",
      "    'items': [",
      "        {'paperId': 'demo-paper', 'canonicalId': 'demo-paper', 'title': 'Demo Paper', 'taskId': 'task-demo', 'status': 'completed', 'stage': 'completed', 'submitted': True, 'synced': True},",
      "    ],",
      "}",
      "print(json.dumps(payload))",
      "",
    ].join("\n"),
    "utf8"
  );
  await fs.chmod(scriptPath, 0o755);
  return scriptPath;
}

function createEmbeddedAgentRuntime(rootDir, runs) {
  const sessionStores = new Map();
  const resolveStorePath = (_store, opts = {}) =>
    path.join(rootDir, "agents", opts.agentId ?? "main", "sessions", "sessions.json");
  const resolveSessionFilePath = (sessionId, entry, opts = {}) =>
    entry?.sessionFile ??
    path.join(opts.sessionsDir ?? path.join(rootDir, "agents", opts.agentId ?? "main", "sessions"), `${sessionId}.jsonl`);
  return {
    agent: {
      async runEmbeddedAgent(params) {
        runs.push(params);
        const storePath = resolveStorePath(undefined, { agentId: params.agentId });
        const sessionFile = resolveSessionFilePath(params.sessionId, undefined, {
          agentId: params.agentId,
          sessionsDir: path.dirname(storePath),
        });
        await fs.mkdir(path.dirname(sessionFile), { recursive: true });
        const store = sessionStores.get(storePath) ?? {};
        store[params.sessionKey] = {
          sessionId: params.sessionId,
          sessionFile,
        };
        sessionStores.set(storePath, store);
        await fs.writeFile(
          sessionFile,
          [
            JSON.stringify({ type: "session", id: params.sessionId }),
            JSON.stringify({
              message: {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: `Embedded coordinator run: ${params.prompt}`,
                  },
                ],
              },
            }),
          ].join("\n") + "\n",
          "utf8"
        );
        return { ok: true };
      },
      resolveAgentDir(_cfg, agentId) {
        return path.join(rootDir, "agents", agentId ?? "main", "agent");
      },
      resolveAgentWorkspaceDir(_cfg, agentId) {
        return path.join(rootDir, "workspace", agentId ?? "main");
      },
      resolveAgentTimeoutMs() {
        return 5_000;
      },
      session: {
        resolveStorePath,
        loadSessionStore(storePath) {
          return sessionStores.get(storePath) ?? {};
        },
        async saveSessionStore(storePath, store) {
          sessionStores.set(storePath, { ...store });
        },
        resolveSessionFilePath,
      },
    },
  };
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

async function recordDiscordNotificationTarget(
  projectRoot,
  projectId = path.basename(projectRoot)
) {
  await recordWorkflowNotificationChannelForProject({
    projectRoot,
    projectId,
    messageChannel: "discord",
    channelKey: "discord:group:paper-lab",
    sessionKey: "agent:researcher:discord:group:paper-lab",
    source: "test",
    notes: "Discord is a notification channel, not a project binding.",
  });
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

test("selectDispatchableAutoStageAction allows explicitly self-driven stage output repair", () => {
  const action = selectDispatchableAutoStageAction({
    autoIteratorResult: {
      gateBlocking: false,
      missingStageSignals: ["{PROJ}/researcher/FRONTIER_REPORT.md"],
      recommendedActions: [
        {
          kind: "drive_stage",
          stage: "frontier_mapping",
          owner: "researcher",
          summary: "Package graph-grounded frontiers for ideation.",
          command: "/frontier-mapping",
          mailboxQueued: false,
          mailboxMessageId: null,
          cooldownRemainingSeconds: null,
          blocking: false,
          dispatchDespiteMissingSignals: true,
        },
      ],
    },
  });

  assert.equal(action?.stage, "frontier_mapping");
});

test("maybeAdvanceWorkflowHookPointForProject skips before-handoff audits while stage signals are missing", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = path.join(projectsRoot, "alpha");
  let reviewerRuns = 0;
  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });
  await fs.mkdir(projectRoot, { recursive: true });

  const attempt = await maybeAdvanceWorkflowHookPointForProject({
    workflowRuntime: {
      async run() {
        reviewerRuns += 1;
        return { runId: "unexpected-review-run" };
      },
    },
    workflowPolicy: {
      autoMode: "aggressive",
      autoGate: defaultAutoGateConfig(),
      enableChannelProjectBindings: false,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot,
    projectId: "alpha",
    hookPoint: "before_stage_handoff",
    autoIteratorResult: {
      effectiveAutoMode: "aggressive",
      stageAfter: "frontier_mapping",
      ownerAfter: "researcher",
      missingStageSignals: ["{PROJ}/researcher/FRONTIER_REPORT.md"],
      materializedArtifacts: [],
      hookEvents: [],
    },
  });

  assert.equal(attempt.approved, true);
  assert.equal(attempt.status, "skipped_stage_not_ready");
  assert.equal(reviewerRuns, 0);
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

  const prunedState = JSON.parse(
    await fs.readFile(path.join(projectsRoot, "PROJECTS_STATE.json"), "utf8")
  );
  assert.deepEqual(
    prunedState.projects.map((entry) => entry.id).sort(),
    ["alpha", "beta"]
  );
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

test("runWorkflowCoordinatorPass isolates one project failure instead of aborting the whole pass", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const alphaRoot = await makeProject(projectsRoot, "alpha", "graph_build");
  const betaRoot = await makeProject(projectsRoot, "beta", "code");
  const calls = [];
  const warnings = [];

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  const results = await runWorkflowCoordinatorPass({
    projectsRoot,
    cooldownSeconds: 90,
    queueMailbox: true,
    maxProjects: 3,
    logger: {
      warn(message, meta) {
        warnings.push({ message, meta });
      },
    },
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
          {
            projectId: "beta",
            projectRoot: betaRoot,
            source: "scan",
            stage: "code",
            updatedAt: null,
          },
        ];
      },
      async runWorkflowAutoIterator(params) {
        calls.push(params);
        if (params.projectRoot === alphaRoot) {
          throw new Error("alpha iterator exploded");
        }
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
              summary: "Continue implementation.",
              command: "/implement-experiment",
              mailboxMessageId: null,
              cooldownRemainingSeconds: 0,
              blocking: false,
            },
          ],
        };
      },
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(results.length, 2);
  assert.equal(results[0].projectId, "alpha");
  assert.equal(results[0].result.gateBlocking, true);
  assert.match(results[0].result.blockingReason ?? "", /alpha iterator exploded/i);
  assert.equal(results[1].projectId, "beta");
  assert.equal(results[1].result.stageAfter, "code");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message ?? "", /auto[_ ]iterator failed for one project/i);
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
    workflowRuntime: {
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
    workflowRuntime: {
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
  const workflowRuntime = {
    async run(params) {
      runCalls.push(params);
      return { runId: `idle-run-${runCalls.length}` };
    },
  };

  await maybeLaunchIdleResearchForProject({
    workflowRuntime,
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
    workflowRuntime,
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
    workflowRuntime,
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
  await recordDiscordNotificationTarget(projectRoot, "alpha");
  const launch = await maybeLaunchAutoStageForProject({
    workflowRuntime: {
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
  await recordDiscordNotificationTarget(projectRoot, "alpha");
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
    workflowRuntime: {
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
  await recordDiscordNotificationTarget(projectRoot, "alpha");

  const launch = await maybeLaunchAutoStageForProject({
    workflowRuntime: {
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

test("maybeLaunchAutoStageForProject dispatches a prepared owner handoff even when next-owner bootstrap signals are still missing", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = path.join(projectsRoot, "alpha");
  const runs = [];
  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });
  await fs.mkdir(projectRoot, { recursive: true });
  await recordDiscordNotificationTarget(projectRoot, "alpha");

  const launch = await maybeLaunchAutoStageForProject({
    workflowRuntime: {
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
      stageAfter: "write",
      pendingHandoff: true,
      pendingHandoffPhase: "prepared",
      missingStageSignals: [
        "PROJECT_MANIFEST.json.results_storyline.status must not be missing during WRITE",
      ],
      recommendedActions: [
        {
          kind: "drive_stage",
          owner: "academic_writer",
          stage: "write",
          summary: "Draft the paper under the active writing contract.",
          command: "/paper-phase",
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

  assert.equal(launch.launched, true);
  assert.equal(launch.owner, "academic_writer");
  assert.equal(launch.sessionKey, "agent:academic_writer:discord:group:paper-lab");
  assert.equal(runs.length, 1);
  assert.match(runs[0].message, /Immediate command: \/paper-phase/);
});

test("maybeLaunchAutoStageForProject launches self-driven frontier mapping despite missing stage outputs", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = path.join(projectsRoot, "alpha");
  const runs = [];
  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });
  await fs.mkdir(projectRoot, { recursive: true });

  const launch = await maybeLaunchAutoStageForProject({
    workflowRuntime: {
      async run(params) {
        runs.push(params);
        return { runId: `frontier-run-${runs.length}` };
      },
    },
    workflowPolicy: {
      autoMode: "aggressive",
      autoGate: defaultAutoGateConfig(),
      enableChannelProjectBindings: false,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot,
    projectId: "alpha",
    autoIteratorResult: {
      gateBlocking: false,
      stageAfter: "frontier_mapping",
      missingStageSignals: ["{PROJ}/researcher/FRONTIER_REPORT.md"],
      recommendedActions: [
        {
          kind: "drive_stage",
          owner: "researcher",
          stage: "frontier_mapping",
          summary: "Package graph-grounded frontiers for ideation.",
          command: "/frontier-mapping",
          mailboxMessageId: null,
          cooldownRemainingSeconds: 0,
          blocking: false,
          dispatchDespiteMissingSignals: true,
        },
      ],
    },
    launchedStageKeys: new Map(),
  });

  assert.equal(launch.launched, true);
  assert.equal(launch.reason, "started");
  assert.equal(runs.length, 1);
  assert.match(runs[0].message, /\/frontier-mapping/);
});

test("maybeLaunchAutoStageForProject runs researcher-owned work on a dedicated subagent session", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = path.join(projectsRoot, "alpha");
  const runs = [];
  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });
  await fs.mkdir(projectRoot, { recursive: true });
  await recordDiscordNotificationTarget(projectRoot, "alpha");

  const launch = await maybeLaunchAutoStageForProject({
    workflowRuntime: {
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
    workflowRuntime: {
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
    workflowRuntime: {
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

test("maybeLaunchAutoStageForProject can dispatch coder-owned search-experiment work for experiment auto loops", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = path.join(projectsRoot, "alpha");
  const runs = [];

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  await fs.mkdir(projectRoot, { recursive: true });

  const launch = await maybeLaunchAutoStageForProject({
    workflowRuntime: {
      async run(params) {
        runs.push(params);
        await acknowledgePendingWorkflowMailboxes([projectRoot]);
        return { runId: `search-run-${runs.length}` };
      },
    },
    workflowPolicy: {
      autoMode: "aggressive",
      autoGate: defaultAutoGateConfig(),
      enableChannelProjectBindings: true,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 30,
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
          owner: "coder",
          stage: "experiment",
          summary: "Continue the approved bounded experiment search loop.",
          command:
            "Run /search-experiment and continue the approved bounded search loop from the current incumbent without widening the envelope.",
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
  assert.equal(launch.owner, "coder");
  assert.equal(launch.stage, "experiment");
  assert.equal(runs.length, 1);
  assert.match(runs[0].message ?? "", /\/search-experiment/i);
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
    workflowRuntime: {
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
  const fakeScriptDir = path.join(projectsRoot, "fake-papernexus-scripts");
  const previousScriptDir = process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR;
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
    if (previousScriptDir === undefined) {
      delete process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR;
    } else {
      process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR = previousScriptDir;
    }
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  await writeFakePapernexusBatchScript(fakeScriptDir);
  process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR = fakeScriptDir;
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
    workflowRuntime: {
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
  assert.equal(runs.length, 0);
  assert.equal(manifest.paper_ingestion.runtime_status, "waiting_graph");
  assert.equal(manifest.paper_ingestion.queued_requests[0].status, "completed");
  assert.equal(
    manifest.paper_ingestion.queued_requests[0].last_run_id,
    "direct-papernexus-batch-req-batch-1"
  );
  assert.equal(
    manifest.paper_ingestion.queued_requests[0].last_session_key,
    "local:papernexus:direct-batch-import"
  );
  assert.equal(
    manifest.paper_ingestion.queued_requests[0].trigger_kind,
    "coordinator_heartbeat"
  );
  assert.equal(manifest.paper_ingestion.completed_papers.length, 1);
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
    workflowRuntime: {
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

  const workflowRuntime = {
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
    workflowRuntime,
    workflowPolicy: {
      autoMode: "aggressive",
      autoGate: defaultAutoGateConfig(),
      enableChannelProjectBindings: true,
      projectsRoot,
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
      lobsterHandoff: {
        enabled: false,
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
    workflowRuntime: {
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
    workflowRuntime: {
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
    workflowRuntime: {
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
  const hookStore = await readWorkflowHooksStateStore(projectRoot);
  assert.equal(
    hookStore.hooks["builtin.auto-mode-risk:write"]?.status,
    "passed"
  );
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
    workflowRuntime: {
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
    workflowRuntime: {
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

test("maybeAdvanceAutoModeDiscussionForProject resolves caution risk locally when no runtime is available", async (t) => {
  const projectRoot = await makeProject(await makeProjectsRoot(), "alpha", "code");

  t.after(async () => {
    await fs.rm(path.dirname(projectRoot), { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "alpha",
    current_stage: "code",
    citation_integrity: {
      verification_status: "ready",
    },
    writing_contract: {
      template_status: "ready",
    },
    innovation_reflection: {
      status: "fresh",
    },
  });

  const result = await maybeAdvanceAutoModeDiscussionForProject({
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
      autoModeRiskLevel: "caution",
      autoModeRiskFingerprint: "risk-fingerprint-local",
      autoModeReasons: ["Provider capacity prevented a live auto-mode panel."],
      stageAfter: "code",
      ownerAfter: "coder",
      nextAction: "/implement-experiment",
      blockingReason: null,
      missingStageSignals: [],
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

  assert.equal(result.launched, false);
  assert.equal(result.reason, "local_static_discussion_no_runtime");
  assert.equal(result.resolved, true);
  assert.equal(result.status, "resolved");

  const store = await readAutoModeDiscussionStore(projectRoot);
  assert.equal(store.currentRound?.status, "resolved");
  assert.equal(store.currentRound?.aggregate?.reviewCount, 3);
  assert.equal(
    store.currentRound?.attempts.every((attempt) =>
      attempt.runId?.startsWith("local-auto-discussion:")
    ),
    true
  );
  const hookStore = await readWorkflowHooksStateStore(projectRoot);
  assert.equal(
    hookStore.hooks["builtin.auto-mode-risk:code"]?.status,
    "passed"
  );
});

test("maybeAdvanceAutoModeDiscussionForProject replaces stale runtime discussion with local fallback", async (t) => {
  const previousFallbackAfter =
    process.env.OPENCLAW_AUTO_MODE_DISCUSSION_LOCAL_FALLBACK_AFTER_MS;
  process.env.OPENCLAW_AUTO_MODE_DISCUSSION_LOCAL_FALLBACK_AFTER_MS = "0";
  t.after(() => {
    if (previousFallbackAfter == null) {
      delete process.env.OPENCLAW_AUTO_MODE_DISCUSSION_LOCAL_FALLBACK_AFTER_MS;
    } else {
      process.env.OPENCLAW_AUTO_MODE_DISCUSSION_LOCAL_FALLBACK_AFTER_MS =
        previousFallbackAfter;
    }
  });

  const projectRoot = await makeProject(await makeProjectsRoot(), "alpha", "code");
  const runtimeCalls = [];

  t.after(async () => {
    await fs.rm(path.dirname(projectRoot), { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "alpha",
    current_stage: "code",
    citation_integrity: {
      verification_status: "ready",
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
    autoModeRiskLevel: "caution",
    autoModeRiskFingerprint: "risk-fingerprint-stale",
    autoModeReasons: ["Auto-mode risk discussion was rate limited."],
    stageAfter: "code",
    ownerAfter: "coder",
    nextAction: "/implement-experiment",
    blockingReason: null,
    missingStageSignals: [],
  };

  const started = await maybeAdvanceAutoModeDiscussionForProject({
    workflowRuntime: {
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

  assert.equal(started.launched, true);
  assert.equal(runtimeCalls.length, 3);

  const fallback = await maybeAdvanceAutoModeDiscussionForProject({
    workflowRuntime: {
      async run() {
        throw new Error("should not relaunch a new discussion round");
      },
      async waitForRun() {
        return { status: "timeout" };
      },
      async getSessionMessages() {
        return { messages: [] };
      },
    },
    workflowPolicy: policy,
    projectRoot,
    projectId: "alpha",
    autoIteratorResult,
    deps,
  });

  assert.equal(fallback.reason, "local_static_discussion_runtime_stale");
  assert.equal(fallback.resolved, true);
  const store = await readAutoModeDiscussionStore(projectRoot);
  assert.equal(store.currentRound?.status, "resolved");
  assert.equal(store.currentRound?.aggregate?.reviewCount, 3);
  assert.equal(store.roundsStartedByFingerprint[store.currentRound?.packetFingerprint], 1);
});

test("maybeAdvanceAutoModeDiscussionForProject retires superseded runtime state when risk fingerprint changes", async (t) => {
  const projectRoot = await makeProject(await makeProjectsRoot(), "alpha", "idea");
  const runtimeCalls = [];

  t.after(async () => {
    await fs.rm(path.dirname(projectRoot), { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "alpha",
    current_stage: "idea",
    citation_integrity: {
      verification_status: "ready",
    },
    writing_contract: {
      template_status: "pending",
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
  const workflowRuntime = {
    async run(params) {
      runtimeCalls.push(params);
      return { runId: `discussion-run-${runtimeCalls.length}` };
    },
    async waitForRun() {
      return { status: "timeout" };
    },
    async getSessionMessages() {
      return { messages: [] };
    },
  };
  const buildAutoIteratorResult = (riskReason) => ({
    configuredAutoMode: "aggressive",
    autoModeRiskLevel: "caution",
    autoModeRiskFingerprint: riskReason,
    autoModeReasons: [riskReason],
    stageAfter: "idea",
    ownerAfter: "researcher",
    nextAction: "/idea-phase",
    blockingReason: riskReason,
    missingStageSignals: [],
  });

  const first = await maybeAdvanceAutoModeDiscussionForProject({
    workflowRuntime,
    workflowPolicy: policy,
    projectRoot,
    projectId: "alpha",
    autoIteratorResult: buildAutoIteratorResult("first graph-backed evidence risk"),
    deps,
  });

  assert.equal(first.launched, true);
  const firstStore = await readAutoModeDiscussionStore(projectRoot);
  const firstQueueKeys = new Set(
    firstStore.currentRound?.attempts.map((attempt) => attempt.queueKey) ?? []
  );
  const firstSessionKeys = new Set(
    firstStore.currentRound?.attempts.map((attempt) => attempt.sessionKey) ?? []
  );
  assert.equal(firstQueueKeys.size, 3);
  assert.equal(firstSessionKeys.size, 3);

  const second = await maybeAdvanceAutoModeDiscussionForProject({
    workflowRuntime,
    workflowPolicy: policy,
    projectRoot,
    projectId: "alpha",
    autoIteratorResult: buildAutoIteratorResult("second innovation evidence risk"),
    deps,
  });

  assert.equal(second.launched, true);
  assert.equal(runtimeCalls.length, 6);
  const secondStore = await readAutoModeDiscussionStore(projectRoot);
  const secondQueueKeys = new Set(
    secondStore.currentRound?.attempts.map((attempt) => attempt.queueKey) ?? []
  );
  assert.equal(secondQueueKeys.size, 3);
  assert.deepEqual(
    [...firstQueueKeys].filter((queueKey) => secondQueueKeys.has(queueKey)),
    []
  );

  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  const firstQueueEntries = queueStore.entries.filter((entry) =>
    firstQueueKeys.has(entry.queueKey)
  );
  const secondQueueEntries = queueStore.entries.filter((entry) =>
    secondQueueKeys.has(entry.queueKey)
  );
  assert.equal(firstQueueEntries.length, 3);
  assert.equal(secondQueueEntries.length, 3);
  assert.deepEqual(
    firstQueueEntries.map((entry) => entry.status).sort(),
    ["completed", "completed", "completed"]
  );
  assert.deepEqual(
    secondQueueEntries.map((entry) => entry.status).sort(),
    ["running", "running", "running"]
  );

  const sessionsStore = await readWorkflowRuntimeSessionsStore(projectRoot);
  const firstSessions = sessionsStore.entries.filter((entry) =>
    firstSessionKeys.has(entry.sessionKey)
  );
  const activeDiscussionSessions = sessionsStore.entries.filter(
    (entry) => entry.kind === "workflow_auto_discussion" && entry.status === "active"
  );
  assert.equal(firstSessions.length, 3);
  assert.equal(firstSessions.every((entry) => entry.status !== "active"), true);
  assert.equal(activeDiscussionSessions.length, 3);
});

test("maybeAdvanceAutoModeDiscussionForProject retires stale runtime state when risk becomes stable", async (t) => {
  const projectRoot = await makeProject(await makeProjectsRoot(), "alpha", "experiment");
  const runtimeCalls = [];

  t.after(async () => {
    await fs.rm(path.dirname(projectRoot), { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "alpha",
    current_stage: "experiment",
    citation_integrity: {
      verification_status: "ready",
    },
    writing_contract: {
      template_status: "ready",
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

  const start = await maybeAdvanceAutoModeDiscussionForProject({
    workflowRuntime: {
      async run(params) {
        runtimeCalls.push(params);
        return { runId: `discussion-run-${runtimeCalls.length}` };
      },
    },
    workflowPolicy: policy,
    projectRoot,
    projectId: "alpha",
    autoIteratorResult: {
      configuredAutoMode: "aggressive",
      autoModeRiskLevel: "caution",
      autoModeRiskFingerprint: "risk-clears-after-local-materialization",
      autoModeReasons: ["Experiment stage was missing local reconciled artifacts."],
      stageAfter: "experiment",
      ownerAfter: "researcher",
      nextAction: "/experiment-phase",
      blockingReason: "missing experiment artifacts",
      missingStageSignals: ["researcher/EXPERIMENT_LEDGER.json"],
    },
    deps,
  });

  assert.equal(start.launched, true);
  const startedStore = await readAutoModeDiscussionStore(projectRoot);
  const queueKeys = new Set(
    startedStore.currentRound?.attempts
      .map((attempt) => attempt.queueKey)
      .filter(Boolean) ?? []
  );
  const sessionKeys = new Set(
    startedStore.currentRound?.attempts
      .map((attempt) => attempt.sessionKey)
      .filter(Boolean) ?? []
  );
  assert.equal(queueKeys.size, 3);

  const stable = await maybeAdvanceAutoModeDiscussionForProject({
    workflowRuntime: {
      async run() {
        throw new Error("stable risk should not launch another discussion");
      },
    },
    workflowPolicy: policy,
    projectRoot,
    projectId: "alpha",
    autoIteratorResult: {
      configuredAutoMode: "aggressive",
      autoModeRiskLevel: "stable",
      autoModeRiskFingerprint: null,
      autoModeReasons: [],
      stageAfter: "analyze",
      ownerAfter: "analyzer",
      nextAction: "/analyze",
      blockingReason: null,
      missingStageSignals: [],
    },
    deps,
  });

  assert.equal(stable.reason, "stable");
  const clearedStore = await readAutoModeDiscussionStore(projectRoot);
  assert.equal(clearedStore.currentRound, null);
  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.deepEqual(
    queueStore.entries
      .filter((entry) => queueKeys.has(entry.queueKey))
      .map((entry) => entry.status)
      .sort(),
    ["completed", "completed", "completed"]
  );
  const sessionsStore = await readWorkflowRuntimeSessionsStore(projectRoot);
  assert.deepEqual(
    sessionsStore.entries
      .filter((entry) => sessionKeys.has(entry.sessionKey))
      .map((entry) => entry.status)
      .sort(),
    ["completed", "completed", "completed"]
  );
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
    workflowRuntime: {
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
  const discussionWorkflowRuntime = {
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
    workflowRuntime: discussionWorkflowRuntime,
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
  assert.match(
    queuedResearcherAttempt?.queueKey ?? "",
    /^openclaw-research:auto-discussion:/
  );
  assert.equal(queuedResearcherAttempt?.status, "pending");
  const gammaSessions = await readWorkflowRuntimeSessionsStore(gammaRoot);
  const researcherSession = gammaSessions.entries.find(
    (entry) => entry.runId === queuedResearcherAttempt?.runId
  );
  assert.equal(researcherSession?.queueKey, queuedResearcherAttempt?.queueKey);

  const updated = await maybeAdvanceAutoModeDiscussionForProject({
    workflowRuntime: discussionWorkflowRuntime,
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

test("maybeAdvanceWorkflowPanelDiscussionForProject creates and resolves a reusable discussion round", async (t) => {
  const projectRoot = await makeProject(await makeProjectsRoot(), "alpha", "review");
  const runtimeCalls = [];

  t.after(async () => {
    await fs.rm(path.dirname(projectRoot), { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "alpha",
    current_stage: "review",
  });

  const start = await maybeAdvanceWorkflowPanelDiscussionForProject({
    workflowRuntime: {
      async run(params) {
        runtimeCalls.push(params);
        return { runId: `panel-run-${runtimeCalls.length}` };
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
    panelDiscussionPolicy: {
      discussionId: "write-logic-review",
      topic: "Decide whether the revise packet is sufficiently bounded",
      stage: "review",
      participants: ["reviewer", "cross-reviewer"],
      maxRounds: 2,
      quorum: 2,
      summary: ["focus on paragraph logic and revise packet specificity"],
      context: {
        artifact: "academic_writer/PARAGRAPH_LOGIC_AUDIT.md",
      },
    },
  });

  assert.equal(start.launched, true);
  assert.equal(start.reason, "started");
  assert.equal(runtimeCalls.length, 2);

  const updated = await maybeAdvanceWorkflowPanelDiscussionForProject({
    workflowRuntime: {
      async run() {
        throw new Error("should not relaunch a new panel discussion round");
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
                    decision: "resolved",
                    confidence: 8.6,
                    recommendedOwner: "academic_writer",
                    actionItems: ["perform one final bounded rewrite"],
                    blockers: [],
                    summary: "The revise packet is now sufficiently bounded.",
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
    panelDiscussionPolicy: {
      discussionId: "write-logic-review",
      topic: "Decide whether the revise packet is sufficiently bounded",
      stage: "review",
      participants: ["reviewer", "cross-reviewer"],
      maxRounds: 2,
      quorum: 2,
      summary: ["focus on paragraph logic and revise packet specificity"],
      context: {
        artifact: "academic_writer/PARAGRAPH_LOGIC_AUDIT.md",
      },
    },
  });

  assert.equal(updated.resolved, true);
  assert.equal(updated.reviewCount, 2);
  assert.equal(updated.recommendedOwner, "academic_writer");
});

test("maybeAdvanceSurveyBriefRefinementForProject launches a survey brief refinement panel when survey synthesis remains blocked", async (t) => {
  const projectRoot = await makeProject(await makeProjectsRoot(), "alpha", "survey_review");
  const runtimeCalls = [];

  t.after(async () => {
    await fs.rm(path.dirname(projectRoot), { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "alpha",
    current_stage: "survey_review",
    survey_review: {
      status: "synthesizing",
      current_phase: "taxonomy_refinement",
      topic: "Generalized Category Discovery",
      survey_brief_path: "researcher/SURVEY_BRIEF.md",
      diagnostics_path: "researcher/SURVEY_GATE_DIAGNOSTICS.json",
      literature_review_path: "researcher/LITERATURE_REVIEW.md",
      sota_matrix_path: "researcher/SOTA_MATRIX.md",
      gap_synthesis_path: "researcher/GAP_SYNTHESIS.md",
      gate_ready: false,
      gate_blocking_issues: [
        "Strengthen the taxonomy/theme sections so the survey is organized by method families instead of a flat bibliography.",
      ],
    },
  });
  await fs.mkdir(path.join(projectRoot, "researcher"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "researcher", "SURVEY_BRIEF.md"), "# Survey Brief\n", "utf8");
  await fs.writeFile(path.join(projectRoot, "researcher", "SURVEY_GATE_DIAGNOSTICS.json"), "{}\n", "utf8");
  await fs.writeFile(path.join(projectRoot, "researcher", "LITERATURE_REVIEW.md"), "# Literature Review\n", "utf8");
  await fs.writeFile(path.join(projectRoot, "researcher", "SOTA_MATRIX.md"), "# SOTA Matrix\n", "utf8");
  await fs.writeFile(path.join(projectRoot, "researcher", "GAP_SYNTHESIS.md"), "# Gap Synthesis\n", "utf8");

  const result = await maybeAdvanceSurveyBriefRefinementForProject({
    workflowRuntime: {
      async run(params) {
        runtimeCalls.push(params);
        return { runId: `survey-brief-panel-${runtimeCalls.length}` };
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
      stageAfter: "survey_review",
    },
  });

  assert.equal(result.launched, true);
  assert.equal(result.discussionId, "survey-brief-refinement");
  assert.equal(runtimeCalls.length, 4);
});

test("maybeDispatchAutoModeMitigationForProject routes the remediation plan to the chosen owner", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = path.join(projectsRoot, "alpha");
  const runs = [];
  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });
  await fs.mkdir(projectRoot, { recursive: true });
  await recordDiscordNotificationTarget(projectRoot, "alpha");

  const dispatch = await maybeDispatchAutoModeMitigationForProject({
    workflowRuntime: {
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
    workflowRuntime: {
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
    workflowRuntime: {
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

  const hookBlocked = deriveWorkflowCoordinatorStatusUpdate({
    projectId: "alpha",
    projectRoot: "/tmp/projects/alpha",
    stageAfter: "write",
    artifactHooks: {
      launched: false,
      reason: "blocked",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      hookPoint: "artifact_materialized",
      stage: "write",
      status: "revise_requested",
      hookCount: 1,
      approved: false,
      aggregateVerdict: "revise",
      blockingReason: "A file audit hook requested revision before handoff.",
      aggregateRevisionPacketPath:
        "reviewer/file-audits/_aggregate/write-artifact_materialized/AGGREGATE_REVISION_PACKET.md",
    },
    autoGateReview: {
      launched: false,
      reason: "not_submit_gate",
      projectId: "alpha",
      projectRoot: "/tmp/projects/alpha",
      gateId: null,
      stage: "write",
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
      stage: "write",
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
      stage: "write",
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
      stage: "write",
      owner: null,
      sessionKey: null,
      runId: null,
      dispatchStrategy: null,
      launchKey: null,
      error: null,
      reusedServiceSession: false,
      activeResearcherSessionsInChannel: null,
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
  assert.equal(hookBlocked?.status, "blocked");
  assert.match(hookBlocked?.summary ?? "", /file audit hook requested revision/i);

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

  await bindChannelProjectForWorkflow({
    projectRoot,
    sessionKey: "agent:researcher:discord:group:paper-lab",
    sessionId: "session-alpha",
    channelKey: "discord:group:paper-lab",
    messageChannel: "discord",
    policy: plugin.getWorkflowPolicy(),
    boundByAgent: "researcher",
  });
  await recordWorkflowNotificationChannelForProject({
    projectRoot,
    projectId: "alpha",
    messageChannel: "discord",
    channelKey: "discord:group:paper-lab",
    sessionKey: "agent:researcher:discord:group:paper-lab",
    source: "test",
    notes: "Discord is a notification target, not a project binding.",
  });

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
  for (let attempt = 0; attempt < 50; attempt += 1) {
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
  assert.ok(
    runs.some(
      (entry) =>
        entry.deliver === true &&
        entry.sessionKey === "agent:researcher:discord:group:paper-lab"
    )
  );
});

test("workflow coordinator can launch the next stage owner through embedded runtime without gateway subagent access", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const projectRoot = await makeProject(projectsRoot, "alpha", "code");
  const runs = [];

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
      config: {
        session: {
          store: path.join(projectsRoot, "agents", "{agentId}", "sessions", "sessions.json"),
        },
      },
      runtime: createEmbeddedAgentRuntime(projectsRoot, runs),
      registerService() {},
      logger: {
        debug() {},
        info() {},
        warn() {},
      },
    },
  };

  await bindChannelProjectForWorkflow({
    projectRoot,
    sessionKey: "agent:researcher:discord:group:paper-lab",
    sessionId: "session-alpha",
    channelKey: "discord:group:paper-lab",
    messageChannel: "discord",
    policy: plugin.getWorkflowPolicy(),
    boundByAgent: "researcher",
  });

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
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (
      runs.some((entry) =>
        typeof entry.prompt === "string" &&
        /Immediate command: \/implement-experiment/.test(entry.prompt)
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

  assert.ok(
    runs.some(
      (entry) =>
        typeof entry.prompt === "string" &&
        /Immediate command: \/implement-experiment/.test(entry.prompt)
    )
  );
});

test("workflow coordinator isolates runtime maintenance failure for one project", async (t) => {
  const projectsRoot = await makeProjectsRoot();
  const alphaRoot = await makeProject(projectsRoot, "alpha", "code");
  const betaRoot = await makeProject(projectsRoot, "beta", "code");
  const runs = [];
  const warnings = [];

  t.after(async () => {
    await fs.rm(projectsRoot, { recursive: true, force: true });
  });

  const plugin = {
    getWorkflowPolicy() {
      return {
        autoMode: "conservative",
        autoGate: defaultAutoGateConfig(),
        enableChannelProjectBindings: false,
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
      registerService() {},
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
          projectRoot: alphaRoot,
          source: "scan",
          stage: "code",
          updatedAt: null,
        },
        {
          projectId: "beta",
          projectRoot: betaRoot,
          source: "scan",
          stage: "code",
          updatedAt: null,
        },
      ];
    },
    async runWorkflowAutoIterator(params) {
      if (params.projectRoot === alphaRoot) {
        return {
          stageBefore: "code",
          stageAfter: "code",
          stageChanged: false,
          regressed: false,
          gateBlocking: false,
          recommendedActions: [],
        };
      }
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
    async runWorkflowRuntimeMaintenancePass(params) {
      if (params.projectRoot === alphaRoot) {
        throw new Error("alpha maintenance exploded");
      }
      return {};
    },
  });

  await service.start({
    logger: {
      debug() {},
      info() {},
      warn(message, meta) {
        warnings.push({ message, meta });
      },
    },
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (
      runs.some(
        (entry) =>
          entry.deliver === false &&
          /Immediate command: \/implement-experiment/.test(entry.message)
      ) &&
      warnings.some((entry) =>
        /runtime[_ ]maintenance failed for one project/i.test(entry.message ?? "")
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

  assert.ok(
    runs.some(
      (entry) =>
        entry.deliver === false &&
        /Immediate command: \/implement-experiment/.test(entry.message)
    )
  );
  assert.ok(
    warnings.some((entry) =>
      /runtime[_ ]maintenance failed for one project/i.test(entry.message ?? "")
    )
  );
  assert.ok(
    warnings.every(
      (entry) => !/Workflow coordinator pass failed/i.test(entry.message ?? "")
    )
  );
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
      bibliography_page_count: 1,
      all_citations_real: true,
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
    workflowRuntime: {
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
  const hookStore = await readWorkflowHooksStateStore(projectRoot);
  assert.equal(
    hookStore.hooks["builtin.submit-readiness:submit"]?.status,
    "revise_requested"
  );
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
      bibliography_page_count: 1,
      all_citations_real: true,
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
    workflowRuntime: {
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
    workflowRuntime: {
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

test("maybeAdvanceAutoGateReviewForProject routes review-stage panel gates through reusable panel discussion", async (t) => {
  const projectRoot = await makeProject(await makeProjectsRoot(), "alpha", "review");
  const runtimeCalls = [];

  t.after(async () => {
    await fs.rm(path.dirname(projectRoot), { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "alpha",
    current_stage: "review",
    citation_integrity: {
      verification_status: "verified",
      bibliography_page_count: 1,
      all_citations_real: true,
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
    workflowRuntime: {
      async run(params) {
        runtimeCalls.push(params);
        return { runId: `gate-run-${runtimeCalls.length}` };
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
                    summary: "Approved by review panel.",
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
        gateModes: {
          review_to_write: "panel_gate",
          write_to_submit: "panel_gate",
          submit_to_done: "manual_gate",
        },
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
      stageAfter: "review",
      recommendedActions: [],
    },
  });

  assert.equal(start.reason, "started");
  assert.equal(runtimeCalls.length, 3);

  const updated = await maybeAdvanceAutoGateReviewForProject({
    workflowRuntime: {
      async run() {
        throw new Error("should not relaunch a new gate panel round");
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
                    summary: "Approved by review panel.",
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
        gateModes: {
          review_to_write: "panel_gate",
          write_to_submit: "panel_gate",
          submit_to_done: "manual_gate",
        },
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
      stageAfter: "review",
      recommendedActions: [],
    },
  });

  assert.equal(updated.approved, true);
  const gateStore = await readGateReviewStore(projectRoot);
  assert.equal(gateStore.currentRound?.gateId, "GATE-REVIEW-TO-WRITE");
  assert.equal(gateStore.currentRound?.aggregate?.reviewCount, 3);
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
      implementation_proof: {
        changed_files: ["train.py", "configs/proposed.yaml"],
        integration_points: [
          {
            point_id: "routing-hook",
            path: "train.py",
            symbol: "graph_router_forward",
            covers: ["Graph-grounded support routing"],
            summary: "Wire graph-grounded routing into the main forward path.",
          },
        ],
        activation_signals: [
          {
            point_id: "routing-log",
            summary: "Logs report graph routing enabled.",
            covers: ["Graph-grounded support routing"],
          },
        ],
        execution_command: "uv run python train.py --config configs/proposed.yaml --seed 42",
      },
    }
  );
  await fs.writeFile(path.join(projectRoot, "orchestrator", "PLAN.md"), "# plan\n", "utf8");
  await fs.writeFile(path.join(projectRoot, "orchestrator", "TODOS.md"), "# todos\n", "utf8");
  await fs.writeFile(
    path.join(projectRoot, "orchestrator", "PLAN_AUDIT.md"),
    "# audit\n",
    "utf8"
  );
  await writeJson(path.join(projectRoot, "researcher", "EXECUTION_PROOF.json"), {
    schema_version: 1,
    status: "blocked",
    receipt_count: 1,
    lineage_matched_receipt_count: 0,
    candidate_commit: "cand-789",
    expected_stage_run_id: "stage-run-exp-7",
    primary_receipt_experiment_id: "exp-1",
    primary_receipt_run_id: "run-exp-6",
    primary_receipt_stage_run_id: "stage-run-exp-6",
    primary_receipt_git_commit: "old-commit",
    pending_reason:
      "Execution receipts exist, but their commit lineage, stage_run_id, or run_id does not match the current candidate/search state.",
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
    workflowRuntime: {
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
  const startedCodeReviewQueueKeys = new Set(
    startedStore.currentRound?.attempts
      .map((attempt) => attempt.queueKey)
      .filter(Boolean) ?? []
  );
  const startedCodeReviewSessionKeys = new Set(
    startedStore.currentRound?.attempts
      .map((attempt) => attempt.sessionKey)
      .filter(Boolean) ?? []
  );
  assert.equal(startedCodeReviewQueueKeys.size, 3);
  const codeReviewPacket = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "reviewer", "code-review", "CODE_REVIEW_PACKET.json"),
      "utf8"
    )
  );
  assert.equal(codeReviewPacket.executionProof.status, "blocked");
  assert.equal(codeReviewPacket.executionProof.candidateCommit, "cand-789");
  assert.equal(codeReviewPacket.executionProof.receiptRunId, "run-exp-6");
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
    workflowRuntime: {
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
  const hookStore = await readWorkflowHooksStateStore(projectRoot);
  assert.equal(
    hookStore.hooks["builtin.code-innovation-review:code"]?.status,
    "passed"
  );
  assert.equal(
    hookStore.hookPoints.before_stage_handoff?.code?.aggregateVerdict,
    "pass"
  );
  const handoffStoreAfterApproval = await readWorkflowHandoffIntentStore(projectRoot);
  assert.deepEqual(
    handoffStoreAfterApproval.intents
      .filter((intent) => intent.reason === "code_review_required")
      .map((intent) => intent.status)
      .sort(),
    ["completed", "completed", "completed"]
  );
  const runtimeQueueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  const retiredQueueEntries = runtimeQueueStore.entries.filter((entry) =>
    startedCodeReviewQueueKeys.has(entry.queueKey)
  );
  assert.equal(retiredQueueEntries.length, 3);
  assert.deepEqual(
    retiredQueueEntries.map((entry) => entry.status).sort(),
    ["completed", "completed", "completed"]
  );
  const runtimeSessionsStore = await readWorkflowRuntimeSessionsStore(projectRoot);
  const retiredSessions = runtimeSessionsStore.entries.filter((entry) =>
    startedCodeReviewSessionKeys.has(entry.sessionKey)
  );
  assert.equal(retiredSessions.length, 3);
  assert.deepEqual(
    retiredSessions.map((entry) => entry.status).sort(),
    ["completed", "completed", "completed"]
  );
});

test("maybeAdvanceAutoCodeReviewForProject completes local static review when runtime is unavailable", async (t) => {
  const projectRoot = await makeProject(await makeProjectsRoot(), "alpha", "code");

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
          hypothesis: "Consistency debiasing improves GCD calibration.",
          novelty_basis: "It adapts FixMatch consistency to unknown-class discovery.",
        },
      ],
    },
  });
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), {
    tracks: [{ track_id: "track-1", status: "active" }],
  });
  await fs.mkdir(path.join(projectRoot, "orchestrator"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "orchestrator", "PLAN.md"), "# plan\n", "utf8");
  await fs.writeFile(path.join(projectRoot, "orchestrator", "TODOS.md"), "# todos\n", "utf8");
  await fs.writeFile(
    path.join(projectRoot, "orchestrator", "PLAN_AUDIT.md"),
    "# audit\n",
    "utf8"
  );
  const bundleDir = path.join(
    projectRoot,
    "coder",
    "experiments",
    "track-1",
    "exp-1__fixmatch_gcd"
  );
  await fs.mkdir(bundleDir, { recursive: true });
  await fs.writeFile(path.join(projectRoot, "coder", "EXPERIMENT_INDEX.md"), "# index\n", "utf8");
  await fs.writeFile(path.join(bundleDir, "train.py"), "print('ok')\n", "utf8");
  await fs.writeFile(path.join(bundleDir, "README.md"), "# experiment\n", "utf8");
  await writeJson(path.join(bundleDir, "EXPERIMENT_MANIFEST.json"), {
    experiment_id: "exp-1",
    project_id: "alpha",
    track_id: "track-1",
    question: "Does FixMatch consistency debias GCD pseudo-labels?",
    hypothesis: "Consistency debiasing improves GCD calibration.",
    novelty_basis: "It adapts FixMatch consistency to unknown-class discovery.",
    baseline_reference: "Supervised GCD baseline",
    primary_baseline_metric: "novel_class_accuracy",
    target_improvement: "Improve novel_class_accuracy by >= 2 points.",
    baseline_training_protocol: "Reuse the supervised GCD training schedule.",
    baseline_eval_protocol: "Reuse the GCD novel/known split evaluation.",
    innovation_points: ["Consistency debiasing for pseudo-label confidence"],
    validation_steps: [
      {
        step_id: "step-1",
        objective: "Enable consistency debiasing only.",
        covers: ["Consistency debiasing for pseudo-label confidence"],
      },
    ],
    ablation_plan: [
      {
        ablation_id: "minus-consistency",
        objective: "Disable consistency debiasing.",
        covers: ["Consistency debiasing for pseudo-label confidence"],
      },
    ],
    implementation_proof: {
      changed_files: ["train.py"],
      integration_points: [
        {
          point_id: "loss-hook",
          path: "train.py",
          symbol: "consistency_debiasing_loss",
          covers: ["Consistency debiasing for pseudo-label confidence"],
        },
      ],
      activation_signals: [
        {
          point_id: "metrics-log",
          summary: "Logs report consistency debiasing enabled.",
          covers: ["Consistency debiasing for pseudo-label confidence"],
        },
      ],
      execution_command: "python train.py",
    },
  });

  const result = await maybeAdvanceAutoCodeReviewForProject({
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
      gateReason:
        "CODE innovation review is pending; wait for the reviewer panel to validate baseline alignment, execution viability, and innovation-step coverage.",
      stageAfter: "code",
      missingStageSignals: [],
      recommendedActions: [],
    },
  });

  assert.equal(result.reason, "local_static_review_no_runtime");
  assert.equal(result.approved, true);
  assert.equal(result.reviewCount, 3);
  const store = await readCodeReviewStore(projectRoot);
  assert.equal(store.currentRound?.status, "approved");
  assert.equal(
    store.currentRound?.attempts.every((attempt) =>
      attempt.runId?.startsWith("local-code-review:")
    ),
    true
  );
  const hookStore = await readWorkflowHooksStateStore(projectRoot);
  assert.equal(
    hookStore.hooks["builtin.code-innovation-review:code"]?.status,
    "passed"
  );
});

test("maybeAdvanceAutoCodeReviewForProject retires superseded reviewer runtime when packet changes", async (t) => {
  const projectRoot = await makeProject(await makeProjectsRoot(), "alpha", "code");
  let runCount = 0;

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
    tracks: [{ track_id: "track-1", status: "active" }],
  });
  await fs.mkdir(path.join(projectRoot, "orchestrator"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "orchestrator", "PLAN.md"), "# plan\n", "utf8");
  await fs.writeFile(path.join(projectRoot, "orchestrator", "TODOS.md"), "# todos\n", "utf8");
  await fs.writeFile(
    path.join(projectRoot, "orchestrator", "PLAN_AUDIT.md"),
    "# audit\n",
    "utf8"
  );
  const bundleDir = path.join(
    projectRoot,
    "coder",
    "experiments",
    "track-1",
    "exp-1__baseline"
  );
  await fs.mkdir(bundleDir, { recursive: true });
  await fs.writeFile(path.join(projectRoot, "coder", "EXPERIMENT_INDEX.md"), "# index\n", "utf8");
  await fs.writeFile(path.join(bundleDir, "train.py"), "print('ok')\n", "utf8");
  await fs.writeFile(path.join(bundleDir, "README.md"), "# experiment\n", "utf8");
  await writeJson(path.join(bundleDir, "EXPERIMENT_MANIFEST.json"), {
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
    implementation_proof: {
      changed_files: ["train.py"],
      integration_points: [
        {
          point_id: "routing-hook",
          path: "train.py",
          symbol: "graph_router_forward",
          covers: ["Graph-grounded support routing"],
        },
      ],
      activation_signals: [
        {
          point_id: "routing-log",
          summary: "Logs report graph routing enabled.",
          covers: ["Graph-grounded support routing"],
        },
      ],
      execution_command: "python train.py",
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
  const autoIteratorResult = {
    gateBlocking: true,
    gateReason:
      "CODE innovation review is pending; wait for the reviewer panel to validate baseline alignment, execution viability, and innovation-step coverage.",
    stageAfter: "code",
    missingStageSignals: [],
    recommendedActions: [],
  };
  const workflowRuntime = {
    async run() {
      runCount += 1;
      return { runId: `code-review-run-${runCount}` };
    },
  };

  const first = await maybeAdvanceAutoCodeReviewForProject({
    workflowRuntime,
    workflowPolicy: policy,
    projectRoot,
    projectId: "alpha",
    autoIteratorResult,
  });
  assert.equal(first.reason, "started");
  const firstStore = await readCodeReviewStore(projectRoot);
  const firstQueueKeys = new Set(
    firstStore.currentRound?.attempts.map((attempt) => attempt.queueKey).filter(Boolean) ??
      []
  );
  assert.equal(firstQueueKeys.size, 3);

  const manifestPath = path.join(bundleDir, "EXPERIMENT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.target_improvement = "Improve acc by >= 3 points over baseline-a.";
  await writeJson(manifestPath, manifest);

  const second = await maybeAdvanceAutoCodeReviewForProject({
    workflowRuntime,
    workflowPolicy: policy,
    projectRoot,
    projectId: "alpha",
    autoIteratorResult,
  });
  assert.equal(second.reason, "started");
  assert.equal(runCount, 6);

  const runtimeQueueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  const retiredQueueEntries = runtimeQueueStore.entries.filter((entry) =>
    firstQueueKeys.has(entry.queueKey)
  );
  assert.equal(retiredQueueEntries.length, 3);
  assert.deepEqual(
    retiredQueueEntries.map((entry) => entry.status).sort(),
    ["completed", "completed", "completed"]
  );
});
