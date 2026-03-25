import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  bindChannelProjectForWorkflow,
  ensureWorkflowProjectRoot,
  getChannelProjectBindingForWorkflow,
} from "../tools/workflow-guard.ts";
import {
  buildResearchPipelineBackgroundCommand,
  buildResearchQueueBackgroundCommand,
  startBackgroundWorkflowRun,
} from "../tools/workflow-fast-paths.ts";

async function makeTempWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-fast-paths-"));
}

test("ensureWorkflowProjectRoot creates a project from configured projectsRoot and topic", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const ensured = await ensureWorkflowProjectRoot({
    policy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    workspaceDir: workspaceRoot,
    sessionKey: "agent:researcher:discord:group:cub-room",
    messageChannel: "discord",
    topic: "CUB confirmation bias mitigation",
  });

  assert.equal(ensured.projectRoot, path.join(projectsRoot, "cub-confirmation-bias-mitigation"));
  assert.equal(ensured.created, true);
  await fs.access(path.join(ensured.projectRoot, "PROJECT_MANIFEST.json"));
  await fs.access(path.join(ensured.projectRoot, "TRACK_REGISTRY.json"));
  await fs.access(path.join(ensured.projectRoot, "CLAIM_POLICY.md"));
  await fs.access(path.join(ensured.projectRoot, "researcher", "EXPERIMENT_LEDGER.json"));
  const idleResearchTemplate = JSON.parse(
    await fs.readFile(
      path.join(ensured.projectRoot, "researcher", "idle-research", "IDLE_RESEARCH.json"),
      "utf8"
    )
  );
  assert.equal(idleResearchTemplate.enabled, false);
  assert.equal(idleResearchTemplate.topic, "CUB confirmation bias mitigation");
  assert.match(idleResearchTemplate.pending_reason, /sync the approved config/i);
});

test("ensureWorkflowProjectRoot fails fast when projectsRoot is missing and workspace fallback is disabled", async (t) => {
  const workspaceRoot = await makeTempWorkspace();

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await assert.rejects(
    () =>
      ensureWorkflowProjectRoot({
        policy: {
          allowWorkspaceFallback: false,
          enableChannelProjectBindings: true,
        },
        workspaceDir: workspaceRoot,
        sessionKey: "agent:researcher:discord:group:cub-room",
        messageChannel: "discord",
        topic: "CUB confirmation bias mitigation",
      }),
    /projectsRoot is not configured/i
  );
});

test("ensureWorkflowProjectRoot backfills idle_research for an existing legacy manifest", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const projectRoot = path.join(projectsRoot, "legacy-project");

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    JSON.stringify(
      {
        project_id: "legacy-project",
        title: "Legacy project",
        status: "active",
        owner_agent: "researcher",
        current_stage: "setup",
        current_micro_stage: "project_init",
        created_at: "2026-03-23T00:00:00.000Z",
        updated_at: "2026-03-23T00:00:00.000Z",
      },
      null,
      2
    )
  );

  const ensured = await ensureWorkflowProjectRoot({
    policy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    workspaceDir: workspaceRoot,
    projectId: "legacy-project",
    topic: "Legacy project",
  });

  assert.equal(ensured.created, false);
  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(typeof manifest.idle_research, "object");
  assert.equal(manifest.idle_research.enabled, false);
  assert.equal(manifest.idle_research.status, "disabled");
  const idleResearchTemplate = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "idle-research", "IDLE_RESEARCH.json"),
      "utf8"
    )
  );
  assert.equal(idleResearchTemplate.enabled, false);
  assert.equal(idleResearchTemplate.topic, "Legacy project");
});

test("bindChannelProjectForWorkflow can auto-create and bind a missing project", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const sessionKey = "agent:researcher:discord:group:gcd-room";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const bound = await bindChannelProjectForWorkflow({
    policy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    projectId: "gcd-confirmation-bias",
    topic: "GCD confirmation bias",
    boundByAgent: "researcher",
  });

  assert.equal(
    bound.binding.projectRoot,
    path.join(projectsRoot, "gcd-confirmation-bias")
  );
  const lookup = getChannelProjectBindingForWorkflow({
    policy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
  });
  assert.equal(lookup.binding?.projectRoot, bound.binding.projectRoot);
});

test("buildResearchPipelineBackgroundCommand appends the continuation marker once", () => {
  const command = buildResearchPipelineBackgroundCommand(
    '/research-pipeline "semantic shift robustness" -- AUTO_PROCEED: false'
  );
  assert.match(command, /__BACKGROUND_CONTINUATION__:\s*true/i);
  assert.equal(
    buildResearchPipelineBackgroundCommand(command),
    command
  );
});

test("buildResearchQueueBackgroundCommand appends the continuation marker once", () => {
  const command = buildResearchQueueBackgroundCommand(
    '/research-queue add "semantic shift queue topic"'
  );
  assert.match(command, /__BACKGROUND_CONTINUATION__:\s*true/i);
  assert.equal(buildResearchQueueBackgroundCommand(command), command);
});

test("startBackgroundWorkflowRun launches a deliverable background continuation and binds the project", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const runCalls = [];
  const sessionKey = "agent:researcher:discord:group:birds-room";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const result = await startBackgroundWorkflowRun({
    runtimeSubagent: {
      async run(params) {
        runCalls.push(params);
        return { runId: "bg-run-1" };
      },
    },
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey,
      sessionId: "session-bg-1",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: null,
      projectId: null,
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "research_pipeline",
      topic: "bird species discovery with semantic shift",
      summary: "Starting background pipeline",
    },
  });

  assert.equal(result.started, true);
  assert.equal(result.runId, "bg-run-1");
  assert.equal(runCalls.length, 1);
  assert.equal(runCalls[0].sessionKey, sessionKey);
  assert.equal(runCalls[0].deliver, true);
  assert.equal(runCalls[0].lane, "nested");
  assert.match(runCalls[0].message, /^\/research-pipeline\b/);
  assert.match(runCalls[0].message, /__BACKGROUND_CONTINUATION__:\s*true/i);

  await fs.access(path.join(result.projectRoot, "PROJECT_MANIFEST.json"));
  await fs.access(
    path.join(result.projectRoot, ".openclaw-research", "channel-project-bindings.json")
  );
});

test("startBackgroundWorkflowRun can bootstrap a research-queue continuation", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const runCalls = [];

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const result = await startBackgroundWorkflowRun({
    runtimeSubagent: {
      async run(params) {
        runCalls.push(params);
        return { runId: "bg-run-queue-1" };
      },
    },
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:queue-room",
      sessionId: "session-bg-queue-1",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: null,
      projectId: null,
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "research_queue",
      topic: 'add "semantic shift queue topic"',
      summary: "Starting queue background task",
    },
  });

  assert.equal(result.started, true);
  assert.equal(result.runId, "bg-run-queue-1");
  assert.equal(runCalls.length, 1);
  assert.match(runCalls[0].message, /^\/research-queue\b/);
  assert.match(runCalls[0].message, /__BACKGROUND_CONTINUATION__:\s*true/i);
});
