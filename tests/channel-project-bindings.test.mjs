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
import {
  buildWorkflowSubagentSessionKey,
  buildWorkflowRuntimeSessionBinding,
  deriveWorkflowSubagentImmediateParentSessionKey,
  normalizeWorkflowSubagentParentSessionKey,
} from "../tools/workflow-subagent-sessions.ts";

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

test("non-workflow agents do not inherit project workflow bindings from the shared channel", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectRoot = await makeTempProject(workspaceRoot, "isolated-track");
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
    agentId: "designer",
    workspaceDir: workspaceRoot,
    sessionKey: "agent:designer:discord:group:paper-lab",
    messageChannel: "discord",
  });

  assert.equal(snapshot.projectRoot, null);
  assert.equal(snapshot.projectId, null);
  assert.equal(snapshot.projectResolutionSource, "none");
});

test("workflow snapshot suppresses local PaperNexus defaults when remote access is configured", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectRoot = await makeTempProject(workspaceRoot, "remote-only-track");
  const sessionKey = "agent:researcher:discord:group:remote-only-room";
  delete process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    delete process.env.OPENCLAW_PROJECT;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await bindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
      papernexusApiBaseUrl: "https://papernexus.example/api",
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "PAPERNEXUS_API_TOKEN",
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
      papernexusApiBaseUrl: "https://papernexus.example/api",
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "PAPERNEXUS_API_TOKEN",
    },
    agentId: "researcher",
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
  });

  assert.equal(snapshot.projectRoot, projectRoot);
  assert.equal(snapshot.defaultPapernexusSourceDir, null);
  assert.equal(snapshot.defaultPapernexusIndexRoot, null);
  assert.equal(snapshot.papernexusApiBaseUrl, "https://papernexus.example/api");
});

test("legacy subagent-scoped channel bindings still resolve against the root workflow channel", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const projectRoot = await makeTempProject(workspaceRoot, "legacy-track");
  const rootSessionKey = "agent:researcher:discord:group:paper-lab";
  const subagentSessionKey =
    "agent:researcher:discord:group:paper-lab:subagent:papernexus-skill:task:legacy-track";
  const storePath = path.join(
    projectRoot,
    ".openclaw-research",
    "channel-project-bindings.json"
  );
  delete process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    delete process.env.OPENCLAW_PROJECT;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(
    storePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: "2026-04-08T00:00:00.000Z",
        bindings: [
          {
            channelKey: "discord:group:paper-lab:subagent:papernexus-skill:task:legacy-track",
            projectRoot,
            projectId: "legacy-track",
            messageChannel: "discord",
            sessionKeySample: subagentSessionKey,
            sessionId: "session-legacy-track",
            boundAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:00:00.000Z",
            boundByAgent: "researcher",
            workflowRole: "researcher",
            workflowSessionKey: subagentSessionKey,
            workflowSessionId: "session-legacy-track",
            parentWorkflowSessionKey: rootSessionKey,
            threadBindingKey: rootSessionKey,
            depth: 1,
            lineageKey: `legacy-track:researcher:${rootSessionKey}:${subagentSessionKey}`,
            workflowBindingMode: "derived_thread",
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const rootSnapshot = await buildWorkflowSnapshot({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    agentId: "researcher",
    workspaceDir: workspaceRoot,
    sessionKey: rootSessionKey,
    messageChannel: "discord",
  });
  assert.equal(rootSnapshot.projectRoot, projectRoot);
  assert.equal(rootSnapshot.projectResolutionSource, "channel_binding");
  assert.equal(rootSnapshot.channelProjectBindingKey, "discord:group:paper-lab");

  const subagentSnapshot = await buildWorkflowSnapshot({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    agentId: "researcher",
    workspaceDir: workspaceRoot,
    sessionKey: subagentSessionKey,
    messageChannel: "discord",
  });
  assert.equal(subagentSnapshot.projectRoot, projectRoot);
  assert.equal(subagentSnapshot.projectResolutionSource, "channel_binding");
  assert.equal(subagentSnapshot.channelProjectBindingKey, "discord:group:paper-lab");
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

test("channel-project bindings ignore custom store path overrides and stay under the project-local runtime dir", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectRoot = await makeTempProject(workspaceRoot, "override-track");
  const sessionKey = "agent:researcher:discord:group:override-room";
  const projectsRoot = path.join(workspaceRoot, "projects");
  const customStorePath = path.join(workspaceRoot, "custom", "bindings.json");
  delete process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    delete process.env.OPENCLAW_PROJECT;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const binding = await bindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
      channelProjectBindingsPath: customStorePath,
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    projectRoot,
    boundByAgent: "researcher",
  });

  assert.equal(
    binding.storePath,
    path.join(projectRoot, ".openclaw-research", "channel-project-bindings.json")
  );
  await assert.rejects(() => fs.access(customStorePath), /ENOENT/);
});

test("unresolved channel-project lookup stays under projectsRoot instead of falling back to workspace", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const sessionKey = "agent:researcher:discord:group:lookup-room";
  delete process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    delete process.env.OPENCLAW_PROJECT;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const binding = getChannelProjectBindingForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
  });

  assert.equal(
    binding.storePath,
    path.join(projectsRoot, ".openclaw-research", "channel-project-bindings.json")
  );
});

test("research memory rejects OPENCLAW_PROJECT values outside the configured projectsRoot", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const strayProjectRoot = path.join(workspaceRoot, "..", "repo-like-location");
  const sessionKey = "agent:researcher:discord:group:memory-room";
  process.env.OPENCLAW_PROJECT = strayProjectRoot;

  t.after(async () => {
    delete process.env.OPENCLAW_PROJECT;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  assert.throws(
    () =>
      getResolvedResearchMemoryPaths(
        {
          enableChannelProjectBindings: true,
          projectsRoot,
          requireProjectIsolation: true,
        },
        {
          workspaceDir: workspaceRoot,
          sessionKey,
          messageChannel: "discord",
        }
      ),
    /must live under the configured projectsRoot/i
  );
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

test("workflow bindings persist runtime session lineage metadata without breaking project binding lookup", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectRoot = await makeTempProject(workspaceRoot, "runtime-track");
  const sessionKey =
    "agent:researcher:discord:group:runtime-room:subagent:workflow-stage";
  const projectsRoot = path.join(workspaceRoot, "projects");
  delete process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    delete process.env.OPENCLAW_PROJECT;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const runtimeBinding = buildWorkflowRuntimeSessionBinding({
    projectRoot,
    projectId: "runtime-track",
    role: "researcher",
    sessionKey,
    sessionId: "session-runtime-track",
    parentSessionKey: normalizeWorkflowSubagentParentSessionKey(sessionKey),
    depth: 1,
  });

  const result = await bindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    sessionId: "session-runtime-track",
    messageChannel: "discord",
    projectRoot,
    projectId: "runtime-track",
    boundByAgent: "researcher",
    notes: "runtime binding regression test",
    runtimeSession: runtimeBinding,
  });

  assert.equal(result.binding.workflowRole, "researcher");
  assert.equal(result.binding.workflowSessionKey, sessionKey);
  assert.equal(result.binding.workflowSessionId, "session-runtime-track");
  assert.equal(
    result.binding.parentWorkflowSessionKey,
    "agent:researcher:discord:group:runtime-room"
  );
  assert.equal(result.binding.threadBindingKey, runtimeBinding.threadBindingKey);
  assert.equal(result.binding.depth, 1);

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
  assert.equal(lookup.binding?.workflowSessionKey, sessionKey);
});

test("non-workflow rebinding preserves the workflow-owned broadcast session", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectRoot = await makeTempProject(workspaceRoot, "workflow-ownership");
  const researcherSessionKey = "agent:researcher:discord:group:runtime-room";
  const designerSessionKey = "agent:designer:discord:group:runtime-room";
  delete process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    delete process.env.OPENCLAW_PROJECT;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const initial = await bindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey: researcherSessionKey,
    messageChannel: "discord",
    projectRoot,
    boundByAgent: "researcher",
  });

  const rebound = await bindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    workspaceDir: workspaceRoot,
    sessionKey: designerSessionKey,
    messageChannel: "discord",
    projectRoot,
    boundByAgent: "designer",
  });

  assert.equal(initial.binding.workflowSessionKey, researcherSessionKey);
  assert.equal(rebound.binding.workflowSessionKey, researcherSessionKey);
  assert.equal(rebound.binding.workflowRole, "researcher");
  assert.equal(rebound.binding.workflowBroadcastSessionKey, researcherSessionKey);
  assert.equal(rebound.binding.sessionKeySample, designerSessionKey);
});

test("nested workflow runtime bindings keep the immediate parent session while preserving the root thread binding", async () => {
  const parentSessionKey =
    "agent:researcher:discord:group:runtime-room:subagent:workflow-stage";
  const nestedSessionKey =
    "agent:researcher:discord:group:runtime-room:subagent:workflow-stage:subagent:code-review";

  assert.equal(
    deriveWorkflowSubagentImmediateParentSessionKey(nestedSessionKey),
    parentSessionKey
  );
  assert.equal(
    normalizeWorkflowSubagentParentSessionKey(nestedSessionKey),
    "agent:researcher:discord:group:runtime-room"
  );

  const binding = buildWorkflowRuntimeSessionBinding({
    projectRoot: "/tmp/runtime-room",
    projectId: "runtime-room",
    role: "researcher",
    sessionKey: nestedSessionKey,
  });

  assert.equal(binding.parentSessionKey, parentSessionKey);
  assert.equal(binding.threadBindingKey, "agent:researcher:discord:group:runtime-room");
  assert.equal(binding.depth, 2);
  assert.equal(
    buildWorkflowSubagentSessionKey({
      parentSessionKey: nestedSessionKey,
      purpose: "artifact-sync",
    }),
    `${nestedSessionKey}:subagent:artifact-sync`
  );
});
