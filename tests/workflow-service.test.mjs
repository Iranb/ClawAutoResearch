import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  listWorkflowCoordinatorProjects,
  maybeLaunchIdleResearchForProject,
  runWorkflowCoordinatorPass,
} from "../tools/register-workflow-service.ts";

async function makeProjectsRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-workflow-service-"));
}

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
  assert.equal(launch.sessionKey, "agent:researcher:discord:group:paper-lab");
  assert.equal(runs.length, 1);
  assert.equal(runs[0].sessionKey, "agent:researcher:discord:group:paper-lab");
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
