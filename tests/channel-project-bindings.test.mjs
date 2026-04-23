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
import {
  ensureProjectsBindingIndex,
  readProjectBindingAuditTail,
  readProjectsBindingAuditTail,
  getProjectBindingAuditPath,
  getProjectsBindingAuditPath,
  getProjectsBindingIndexPath,
} from "../tools/channel-project-bindings.ts";

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

test("dashboard workspace agents do not inherit workflow bindings from reused researcher main sessions", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectRoot = await makeTempProject(workspaceRoot, "dashboard-isolated-track");
  const sessionKey = "agent:researcher:main";
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
    projectRoot,
    boundByAgent: "researcher",
  });

  const snapshot = await buildWorkflowSnapshot({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot: path.join(workspaceRoot, "projects"),
    },
    agentId: "work",
    workspaceDir: path.join(workspaceRoot, "workspace-work"),
    sessionKey,
  });

  assert.equal(snapshot.projectRoot, null);
  assert.equal(snapshot.projectId, null);
  assert.equal(snapshot.projectResolutionSource, "none");
});

test("dashboard workflow sessions prefer explicit conversation bindings and refuse weak cross-project main-session fallback", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const reviewProjectRoot = await makeTempProject(workspaceRoot, "gcd-survey-tpami-2026");
  const labProjectRoot = await makeTempProject(workspaceRoot, "gcd-part-manifold-2026");
  const dashboardSessionKey = "agent:researcher:dashboard:main";
  const reviewChannelKey = "binding:discord:default:channel:1491811255814586530";
  delete process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    delete process.env.OPENCLAW_PROJECT;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await bindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey: dashboardSessionKey,
    messageChannel: "discord",
    channelKey: reviewChannelKey,
    projectRoot: reviewProjectRoot,
    boundByAgent: "researcher",
  });
  await bindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey: dashboardSessionKey,
    messageChannel: "main",
    projectRoot: labProjectRoot,
    boundByAgent: "researcher",
  });

  const explicitSnapshot = await buildWorkflowSnapshot({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    agentId: "researcher",
    workspaceDir: workspaceRoot,
    sessionKey: dashboardSessionKey,
    messageChannel: "discord",
    channelKey: reviewChannelKey,
  });
  assert.equal(explicitSnapshot.projectRoot, reviewProjectRoot);
  assert.equal(explicitSnapshot.projectId, "gcd-survey-tpami-2026");
  assert.equal(explicitSnapshot.projectResolutionSource, "channel_binding");

  const weakSnapshot = await buildWorkflowSnapshot({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    agentId: "researcher",
    workspaceDir: workspaceRoot,
    sessionKey: dashboardSessionKey,
    messageChannel: "main",
  });
  assert.equal(weakSnapshot.projectRoot, null);
  assert.equal(weakSnapshot.projectId, null);
  assert.equal(weakSnapshot.projectResolutionSource, "none");
});

test("workflow snapshot does not inherit channel project bindings when agent identity is missing", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectRoot = await makeTempProject(workspaceRoot, "missing-agent-track");
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
    workspaceDir: workspaceRoot,
    sessionKey: "discord:group:paper-lab",
    messageChannel: "discord",
  });

  assert.equal(snapshot.projectRoot, null);
  assert.equal(snapshot.projectId, null);
  assert.equal(snapshot.projectResolutionSource, "none");
});

test("binding updates maintain a projects-root binding index", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const projectRoot = await makeTempProject(workspaceRoot, "indexed-track");
  const sessionKey = "agent:researcher:discord:group:index-room";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await bindChannelProjectForWorkflow({
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

  const indexPath = path.join(
    projectsRoot,
    ".openclaw-research",
    "channel-project-bindings.index.json"
  );
  const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
  assert.equal(Array.isArray(index.bindings), true);
  assert.equal(index.bindings.some((entry) => entry.projectRoot === projectRoot), true);

  const lookup = await getChannelProjectBindingForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    agentId: "researcher",
  });
  assert.equal(lookup.binding?.projectRoot, projectRoot);
});

test("ensureProjectsBindingIndex recovers a stale projects-root binding index lock", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const projectRoot = await makeTempProject(workspaceRoot, "stale-index-track");
  const sessionKey = "agent:researcher:discord:group:stale-index-room";
  const channelKey = "discord:group:stale-index-room";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const projectStorePath = path.join(
    projectRoot,
    ".openclaw-research",
    "channel-project-bindings.json"
  );
  await fs.mkdir(path.dirname(projectStorePath), { recursive: true });
  await fs.writeFile(
    projectStorePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: "2026-04-23T02:00:00.000Z",
        bindings: [
          {
            channelKey,
            projectRoot,
            projectId: "stale-index-track",
            messageChannel: "discord",
            sessionKeySample: sessionKey,
            boundAt: "2026-04-23T02:00:00.000Z",
            updatedAt: "2026-04-23T02:00:00.000Z",
            boundByAgent: "researcher",
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const lockPath = `${getProjectsBindingIndexPath(projectsRoot)}.lock`;
  await fs.mkdir(lockPath, { recursive: true });
  const staleDate = new Date(Date.now() - 2 * 60_000);
  await fs.utimes(lockPath, staleDate, staleDate);

  const index = await ensureProjectsBindingIndex({
    projectsRoot,
    maxAgeMs: 0,
  });

  assert.equal(index.bindings.some((entry) => entry.projectRoot === projectRoot), true);
  await assert.rejects(fs.access(lockPath));
});

test("binding updates recover a stale projects-root index lock before refreshing the index", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const projectRoot = await makeTempProject(workspaceRoot, "stale-bind-track");
  const sessionKey = "agent:researcher:discord:group:stale-bind-room";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const lockPath = `${getProjectsBindingIndexPath(projectsRoot)}.lock`;
  await fs.mkdir(lockPath, { recursive: true });
  const staleDate = new Date(Date.now() - 2 * 60_000);
  await fs.utimes(lockPath, staleDate, staleDate);

  await bindChannelProjectForWorkflow({
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

  const index = JSON.parse(
    await fs.readFile(getProjectsBindingIndexPath(projectsRoot), "utf8")
  );
  assert.equal(index.bindings.some((entry) => entry.projectRoot === projectRoot), true);
  await assert.rejects(fs.access(lockPath));
});

test("binding updates append a queryable audit trail under the project and projects root", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const projectRoot = await makeTempProject(workspaceRoot, "audited-track");
  const sessionKey = "agent:researcher:discord:group:audit-room";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await bindChannelProjectForWorkflow({
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
  await unbindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
  });

  const projectAudit = (await fs.readFile(getProjectBindingAuditPath(projectRoot), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const rootAudit = (await fs.readFile(getProjectsBindingAuditPath(projectsRoot), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.deepEqual(projectAudit.map((entry) => entry.action), ["bind", "unbind"]);
  assert.deepEqual(rootAudit.map((entry) => entry.action), ["bind", "unbind"]);
  assert.equal(projectAudit[0].projectRoot, projectRoot);
  assert.equal(projectAudit[1].previousProjectRoot, projectRoot);
});

test("binding audit logs rotate and tails span archives", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const projectRoot = await makeTempProject(workspaceRoot, "audit-rotation");
  const previousMaxBytes = process.env.OPENCLAW_CHANNEL_BINDING_AUDIT_MAX_BYTES;
  const previousMaxArchives = process.env.OPENCLAW_CHANNEL_BINDING_AUDIT_MAX_ARCHIVES;
  process.env.OPENCLAW_CHANNEL_BINDING_AUDIT_MAX_BYTES = "320";
  process.env.OPENCLAW_CHANNEL_BINDING_AUDIT_MAX_ARCHIVES = "8";

  t.after(async () => {
    if (previousMaxBytes === undefined) {
      delete process.env.OPENCLAW_CHANNEL_BINDING_AUDIT_MAX_BYTES;
    } else {
      process.env.OPENCLAW_CHANNEL_BINDING_AUDIT_MAX_BYTES = previousMaxBytes;
    }
    if (previousMaxArchives === undefined) {
      delete process.env.OPENCLAW_CHANNEL_BINDING_AUDIT_MAX_ARCHIVES;
    } else {
      process.env.OPENCLAW_CHANNEL_BINDING_AUDIT_MAX_ARCHIVES = previousMaxArchives;
    }
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  for (const suffix of ["1", "2", "3"]) {
    const sessionKey = `agent:researcher:discord:group:audit-rotation-${suffix}`;
    await bindChannelProjectForWorkflow({
      policy: {
        enableChannelProjectBindings: true,
        projectsRoot,
      },
      workspaceDir: workspaceRoot,
      projectRoot,
      projectId: "audit-rotation",
      sessionKey,
      messageChannel: "discord",
      agentId: "researcher",
    });
    await unbindChannelProjectForWorkflow({
      policy: {
        enableChannelProjectBindings: true,
        projectsRoot,
      },
      workspaceDir: workspaceRoot,
      sessionKey,
      messageChannel: "discord",
    });
  }

  await fs.access(getProjectBindingAuditPath(projectRoot).replace(/\.jsonl$/, ".1.jsonl"));
  await fs.access(getProjectsBindingAuditPath(projectsRoot).replace(/\.jsonl$/, ".1.jsonl"));

  const projectTail = await readProjectBindingAuditTail({
    projectRoot,
    tailLines: 6,
  });
  const rootTail = await readProjectsBindingAuditTail({
    projectsRoot,
    tailLines: 6,
  });

  assert.equal(projectTail.exists, true);
  assert.equal(rootTail.exists, true);
  assert.equal(projectTail.lineCount, 6);
  assert.equal(rootTail.lineCount, 6);
  assert.deepEqual(
    projectTail.tail.map((line) => JSON.parse(line).action),
    ["bind", "unbind", "bind", "unbind", "bind", "unbind"]
  );
  assert.deepEqual(
    rootTail.tail.map((line) => JSON.parse(line).action),
    ["bind", "unbind", "bind", "unbind", "bind", "unbind"]
  );
});

test("explicit discord binding also persists a direct session-key alias for background continuations", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const projectRoot = await makeTempProject(workspaceRoot, "alias-track");
  const explicitChannelKey = "binding:discord:researcher:channel:1493115773701329030";
  const sessionKey = "agent:researcher:discord:channel:1493115773701329030";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await bindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    channelKey: explicitChannelKey,
    projectRoot,
    boundByAgent: "researcher",
  });

  const store = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, ".openclaw-research", "channel-project-bindings.json"),
      "utf8"
    )
  );
  const keys = store.bindings.map((entry) => entry.channelKey).sort();
  assert.deepEqual(keys, [
    "binding:discord:researcher:channel:1493115773701329030",
    "discord:channel:1493115773701329030",
  ]);

  const lookup = getChannelProjectBindingForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey:
      "agent:researcher:discord:channel:1493115773701329030:subagent:workflow-research-pipeline:alias-track",
    messageChannel: "discord",
  });
  assert.equal(lookup.binding?.projectRoot, projectRoot);
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

test("workflow snapshot uses the shared PaperNexus source root in local mode", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectRoot = await makeTempProject(workspaceRoot, "shared-root-track");
  const sessionKey = "agent:researcher:discord:group:shared-root-room";
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
  assert.equal(
    snapshot.defaultPapernexusSourceDir,
    path.join(os.homedir(), ".papernexus", "papers", "shared-root-track")
  );
  assert.equal(snapshot.defaultPapernexusIndexRoot, path.join(os.homedir(), ".papernexus", "index-store"));
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
  await ensureProjectsBindingIndex({
    projectsRoot,
  });

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
      agentId: "researcher",
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

test("rebinding the same channel to a new project supersedes the older project binding", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectRootA = await makeTempProject(workspaceRoot, "survey-a");
  const projectRootB = await makeTempProject(workspaceRoot, "survey-b");
  const projectsRoot = path.join(workspaceRoot, "projects");
  const sessionKey = "agent:researcher:discord:group:survey-lab";
  delete process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    delete process.env.OPENCLAW_PROJECT;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await bindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    projectRoot: projectRootA,
    projectId: "survey-a",
    boundByAgent: "researcher",
  });

  await bindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    projectRoot: projectRootB,
    projectId: "survey-b",
    boundByAgent: "researcher",
    notes: "rebind to newer survey project",
  });

  const lookup = getChannelProjectBindingForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
  });

  assert.equal(lookup.binding?.projectRoot, projectRootB);
  assert.equal(lookup.binding?.projectId, "survey-b");

  const firstStore = JSON.parse(
    await fs.readFile(
      path.join(projectRootA, ".openclaw-research", "channel-project-bindings.json"),
      "utf8"
    )
  );
  assert.equal(
    firstStore.bindings.some((entry) => entry.channelKey === "discord:group:survey-lab"),
    false
  );
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

test("binding resolution reloads a freshly updated projects index instead of serving a stale empty cache", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const projectRoot = await makeTempProject(workspaceRoot, "fresh-binding-track");
  const sessionKey = "agent:researcher:discord:group:paper-lab";
  const channelKey = "discord:group:paper-lab";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const initialSnapshot = await buildWorkflowSnapshot({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    agentId: "researcher",
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
  });
  assert.equal(initialSnapshot.projectRoot, null);
  assert.equal(initialSnapshot.projectResolutionSource, "none");

  const projectStorePath = path.join(
    projectRoot,
    ".openclaw-research",
    "channel-project-bindings.json"
  );
  await fs.mkdir(path.dirname(projectStorePath), { recursive: true });
  await fs.writeFile(
    projectStorePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: "2026-04-11T09:00:00.000Z",
        bindings: [
          {
            channelKey,
            projectRoot,
            projectId: "fresh-binding-track",
            messageChannel: "discord",
            sessionKeySample: sessionKey,
            sessionId: null,
            boundAt: "2026-04-11T09:00:00.000Z",
            updatedAt: "2026-04-11T09:00:00.000Z",
            boundByAgent: "researcher",
            workflowRole: "researcher",
            workflowSessionKey: sessionKey,
            workflowSessionId: null,
            parentWorkflowSessionKey: null,
            threadBindingKey: null,
            depth: 0,
            lineageKey: null,
            workflowBindingMode: "channel_only",
            workflowIsolationMode: "channel_shared",
            workflowAllowedRoles: [],
            workflowAllowedAgentIds: [],
            workflowBroadcastSessionKey: sessionKey,
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const indexPath = getProjectsBindingIndexPath(projectsRoot);
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(
    indexPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: "2026-04-11T09:00:01.000Z",
        bindings: [
          {
            channelKey,
            projectRoot,
            projectId: "fresh-binding-track",
            messageChannel: "discord",
            sessionKeySample: sessionKey,
            sessionId: null,
            boundAt: "2026-04-11T09:00:00.000Z",
            updatedAt: "2026-04-11T09:00:00.000Z",
            boundByAgent: "researcher",
            workflowRole: "researcher",
            workflowSessionKey: sessionKey,
            workflowSessionId: null,
            parentWorkflowSessionKey: null,
            threadBindingKey: null,
            depth: 0,
            lineageKey: null,
            workflowBindingMode: "channel_only",
            workflowIsolationMode: "channel_shared",
            workflowAllowedRoles: [],
            workflowAllowedAgentIds: [],
            workflowBroadcastSessionKey: sessionKey,
            storePath: projectStorePath,
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const refreshedSnapshot = await buildWorkflowSnapshot({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    agentId: "researcher",
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
  });
  assert.equal(refreshedSnapshot.projectRoot, projectRoot);
  assert.equal(refreshedSnapshot.projectId, "fresh-binding-track");
  assert.equal(refreshedSnapshot.projectResolutionSource, "channel_binding");
});
