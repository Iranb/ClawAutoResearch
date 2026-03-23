import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getResolvedResearchMemoryPaths } from "../tools/research-memory.ts";
import {
  bindChannelProjectForWorkflow,
  buildWorkflowSnapshot,
  ensureChannelProjectBindingForWorkflow,
  getChannelProjectBindingForWorkflow,
  unbindChannelProjectForWorkflow,
} from "../tools/workflow-guard.ts";

async function makeTempWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-channel-bindings-"));
}

async function makeTempProject(workspaceRoot, projectId = "demo-project") {
  const projectRoot = path.join(workspaceRoot, "projects", projectId);
  await fs.mkdir(path.join(projectRoot, "researcher"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify({ project_id: projectId, current_stage: "setup" }, null, 2)}\n`,
    "utf8"
  );
  return projectRoot;
}

test("channel-project binding resolves workflow snapshot without OPENCLAW_PROJECT", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectRoot = await makeTempProject(workspaceRoot, "nlp-track");
  const sessionKey = "agent:researcher:discord:group:paper-lab";
  delete process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    delete process.env.OPENCLAW_PROJECT;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await bindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    projectRoot,
    boundByAgent: "researcher",
  });

  const snapshot = await buildWorkflowSnapshot({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    agentId: "researcher",
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
  });

  assert.equal(snapshot.projectRoot, projectRoot);
  assert.equal(snapshot.projectId, "nlp-track");
  assert.equal(snapshot.projectResolutionSource, "channel_binding");
  assert.equal(snapshot.channelProjectBindingKey, "discord:group:paper-lab");
});

test("research memory paths follow the current channel binding", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectRoot = await makeTempProject(workspaceRoot, "vision-track");
  const sessionKey = "agent:researcher:discord:group:vision-room";
  delete process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    delete process.env.OPENCLAW_PROJECT;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await bindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    projectRoot,
    boundByAgent: "researcher",
  });

  const paths = getResolvedResearchMemoryPaths(
    {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
      requireProjectIsolation: true,
    },
    {
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "discord",
    }
  );

  assert.equal(paths.projectRoot, projectRoot);
  assert.equal(paths.projectResolutionSource, "channel_binding");
  assert.equal(
    paths.ideationMemoryPath,
    path.join(projectRoot, "memory", "ideation-memory.md")
  );
  assert.equal(
    paths.reviewStatePath,
    path.join(projectRoot, "researcher", "REVIEW_STATE.json")
  );
});

test("channel-project bindings can be inspected and removed", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectRoot = await makeTempProject(workspaceRoot, "graph-track");
  const sessionKey = "agent:researcher:discord:group:graph-room";
  delete process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    delete process.env.OPENCLAW_PROJECT;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await bindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    projectRoot,
    boundByAgent: "researcher",
  });

  const binding = getChannelProjectBindingForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
  });
  assert.equal(binding.binding?.projectRoot, projectRoot);
  assert.equal(
    binding.storePath,
    path.join(projectRoot, ".openclaw-research", "channel-project-bindings.json")
  );

  const removed = await unbindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
  });
  assert.equal(removed.removed, true);

  const after = getChannelProjectBindingForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
  });
  assert.equal(after.binding, null);
});

test("channel-project bindings default to the project-local store when projectRoot is known", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectRoot = await makeTempProject(workspaceRoot, "birds-track");
  const sessionKey = "agent:researcher:discord:group:cub-room";
  const projectsRoot = path.join(workspaceRoot, "projects");
  delete process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    delete process.env.OPENCLAW_PROJECT;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const binding = await bindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    projectRoot,
    boundByAgent: "researcher",
  });

  const expectedStorePath = path.join(
    projectRoot,
    ".openclaw-research",
    "channel-project-bindings.json"
  );
  assert.equal(binding.storePath, expectedStorePath);
  await fs.access(expectedStorePath);
});

test("automatic channel binding creates the project-local file once a project is resolved", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectRoot = await makeTempProject(workspaceRoot, "auto-bind-track");
  const sessionKey = "agent:researcher:discord:group:auto-bind-room";
  const projectsRoot = path.join(workspaceRoot, "projects");
  delete process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    delete process.env.OPENCLAW_PROJECT;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const result = await ensureChannelProjectBindingForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    projectRoot,
    projectId: "auto-bind-track",
    boundByAgent: "researcher",
  });

  assert.equal(result.autoBound, true);
  assert.equal(
    result.storePath,
    path.join(projectRoot, ".openclaw-research", "channel-project-bindings.json")
  );
  const lookup = getChannelProjectBindingForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
  });
  assert.equal(lookup.binding?.projectRoot, projectRoot);
});
