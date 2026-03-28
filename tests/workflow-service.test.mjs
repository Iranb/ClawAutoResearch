import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  clearBackgroundWorkflowRunRegistryForTests,
} from "../tools/workflow-fast-paths.ts";
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
import { readGateReviewStore } from "../tools/workflow-auto-gate.ts";
import { defaultAutoGateConfig } from "../tools/workflow-auto-gate.ts";
import { readAutoModeDiscussionStore } from "../tools/workflow-auto-discussion.ts";

async function makeProjectsRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-workflow-service-"));
}

test.beforeEach(async () => {
  await clearBackgroundWorkflowRunRegistryForTests();
});

test.afterEach(async () => {
  await clearBackgroundWorkflowRunRegistryForTests();
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

test("maybeLaunchIdleResearchForProject starts one bounded researcher background run for a due idle topic", async () => {
  const runs = [];
  const launchedDueKeys = new Map();

  const launch = await maybeLaunchIdleResearchForProject({
    runtimeSubagent: {
      async run(params) {
        runs.push(params);
        return { runId: "idle-run-1" };
      },
    },
    workflowPolicy: {
      enableChannelProjectBindings: true,
      projectsRoot: "/tmp/projects",
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot: "/tmp/projects/alpha",
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
          storePath: "/tmp/projects",
          bindings: [
            {
              channelKey: "discord:group:paper-lab",
              projectRoot: "/tmp/projects/alpha",
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
      projectsRoot: "/tmp/projects",
      heartbeatBackgroundChecks: true,
      agentContactCooldownSeconds: 300,
      enableWorkflowMailbox: true,
    },
    projectRoot: "/tmp/projects/alpha",
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
          storePath: "/tmp/projects",
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
    projectRoot: "/tmp/projects/alpha",
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
              projectRoot: "/tmp/projects/alpha",
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
    projectRoot: "/tmp/projects/beta",
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
              projectRoot: "/tmp/projects/beta",
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
    projectRoot: "/tmp/projects/gamma",
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
              projectRoot: "/tmp/projects/gamma",
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
  assert.equal(launch.dispatchStrategy, "direct_session");
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
  assert.equal(timedDefault?.status, "started");
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
  assert.equal(idleCapacity?.status, "waiting");
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
