import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH = path.join(
  os.tmpdir(),
  "openclaw-research-background-runs-workflow-background-pool.json"
);

import {
  acquireBackgroundWorkflowSession,
  clearBackgroundWorkflowRunRegistryForTests,
  listBackgroundWorkflowRuns,
  recordBackgroundWorkflowRun,
  retireBackgroundWorkflowRuns,
} from "../tools/workflow-background-pool.ts";
import {
  inferBackgroundRunTerminalStateFromDurableState,
  reconcileBackgroundRunTerminalState,
} from "../tools/workflow-background-run-reconcile.ts";
import {
  readWorkflowRuntimeQueueStore,
  writeWorkflowRuntimeQueueStore,
} from "../tools/workflow-runtime-state.ts";

async function makeProjectRoot(projectId = "background-pool-project") {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-background-pool-project-")
  );
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: projectId,
        current_stage: "graph_build",
        owner_agent: "researcher",
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return projectRoot;
}

function makeQueueEntry(projectRoot, overrides = {}) {
  return {
    transitionId: "transition-tracking-miss",
    queueId: "queue-tracking-miss",
    queueKey: "bg:tracking-miss",
    source: "start_background_run",
    entryType: "background_run",
    ownerAgent: "researcher",
    channelKey: "local:autoresearch",
    requesterSessionKey: "agent:researcher:local:autoresearch",
    messageChannel: "local",
    preferredSessionKey: "agent:researcher:local:autoresearch:subagent:bg",
    family: "research",
    kind: "research_pipeline",
    projectId: "background-pool-project",
    projectRoot,
    queuedAt: new Date().toISOString(),
    lastAttemptedAt: null,
    lastCheckedAt: null,
    attemptCount: 1,
    summary: "Run research pipeline.",
    status: "running",
    fallbackMode: null,
    lastError: null,
    parentSessionKey: null,
    threadBindingKey: null,
    depth: 1,
    runPayload: null,
    dispatchPayload: null,
    ...overrides,
  };
}

test.beforeEach(async () => {
  await clearBackgroundWorkflowRunRegistryForTests();
});

test.afterEach(async () => {
  await clearBackgroundWorkflowRunRegistryForTests();
});

test("background reconcile ignores runtime tracking misses as durable task failures", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    entries: [
      makeQueueEntry(projectRoot, {
        status: "failed",
        lastError: "Embedded workflow run is not tracked in the local registry.",
      }),
    ],
  });

  const terminal = await inferBackgroundRunTerminalStateFromDurableState({
    entry: {
      backgroundSessionKey: "agent:researcher:local:autoresearch:subagent:bg",
      runId: "run-tracking-miss",
      queueKey: "bg:tracking-miss",
      kind: "research_pipeline",
      family: "research",
      projectId: "background-pool-project",
      projectRoot,
    },
  });

  assert.equal(terminal, null);
});

test("background reconcile does not write tracking misses back as failed queue state", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    entries: [makeQueueEntry(projectRoot)],
  });

  const reconciled = await reconcileBackgroundRunTerminalState({
    entry: {
      backgroundSessionKey: "agent:researcher:local:autoresearch:subagent:bg",
      runId: "run-tracking-miss",
      queueKey: "bg:tracking-miss",
      kind: "research_pipeline",
      family: "research",
      projectId: "background-pool-project",
      projectRoot,
    },
    terminalStatus: "failed",
    finishedAt: new Date().toISOString(),
    error: "Embedded workflow run is not tracked in the local registry.",
  });

  assert.deepEqual(reconciled, {
    queuePatched: false,
    manifestPatched: false,
  });
  const queue = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(queue.entries[0].status, "running");
  assert.equal(queue.entries[0].lastError, null);
});

test("workflow background pool lists and retires researcher sessions", async () => {
  const deletedSessionKeys = [];
  await recordBackgroundWorkflowRun({
    ownerAgent: "researcher",
    channelKey: "discord:channel:test-room",
    requesterSessionKey: "agent:researcher:discord:channel:test-room",
    backgroundSessionKey: "agent:researcher:discord:channel:test-room:subagent:abc",
    runId: "run:test",
    family: "research",
    kind: "resume_pipeline",
  });

  const listed = await listBackgroundWorkflowRuns({
    ownerAgent: "researcher",
    channelKey: "discord:channel:test-room",
  });
  assert.equal(listed.entries.length, 1);
  assert.equal(listed.entries[0].status, "active");

  const retired = await retireBackgroundWorkflowRuns({
    ownerAgent: "researcher",
    channelKey: "discord:channel:test-room",
    statuses: ["active"],
    deleteSessions: true,
    workflowRuntime: {
      async deleteSession(params) {
        deletedSessionKeys.push(params.sessionKey);
      },
    },
  });

  assert.equal(retired.removed.length, 1);
  assert.deepEqual(deletedSessionKeys, [
    "agent:researcher:discord:channel:test-room:subagent:abc",
  ]);
});

test("workflow background pool refuses ephemeral registry fallback without project scope", async (t) => {
  const previousRegistryPath =
    process.env.OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH;

  delete process.env.OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH;

  try {
    await assert.rejects(
      () => listBackgroundWorkflowRuns({}),
      /project-scoped background run registry path/i
    );
  } finally {
    if (previousRegistryPath) {
      process.env.OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH =
        previousRegistryPath;
    } else {
      delete process.env.OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH;
    }
  }
});

test("workflow background pool tolerates an empty legacy registry file left by an interrupted write", async () => {
  const registryPath = process.env.OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH;
  if (!registryPath) {
    throw new Error("Expected OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH to be configured.");
  }
  await fs.writeFile(registryPath, "", "utf8");

  const listed = await listBackgroundWorkflowRuns({
    ownerAgent: "researcher",
    channelKey: "discord:channel:test-room",
  });

  assert.deepEqual(listed.entries, []);
});

test("workflow background pool serializes concurrent registry writes", async () => {
  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      recordBackgroundWorkflowRun({
        ownerAgent: "researcher",
        channelKey: "discord:channel:test-room",
        requesterSessionKey: "agent:researcher:discord:channel:test-room",
        backgroundSessionKey: `agent:researcher:discord:channel:test-room:subagent:${index}`,
        runId: `run:${index}`,
        family: "research",
        kind: "resume_pipeline",
      })
    )
  );

  const listed = await listBackgroundWorkflowRuns({
    ownerAgent: "researcher",
    channelKey: "discord:channel:test-room",
  });

  assert.equal(listed.entries.length, 8);
  assert.deepEqual(
    listed.entries.map((entry) => entry.runId).sort(),
    Array.from({ length: 8 }, (_, index) => `run:${index}`)
  );
});

test("workflow background pool reuses idle sessions only for the same workflow kind", async () => {
  const requesterSessionKey = "agent:researcher:local:conversation:test";
  const pipelineSessionKey =
    "agent:researcher:local:conversation:test:subagent:workflow-research-pipeline:demo";

  await recordBackgroundWorkflowRun({
    ownerAgent: "researcher",
    channelKey: "local:conversation:test",
    requesterSessionKey,
    backgroundSessionKey: pipelineSessionKey,
    runId: "run:research-pipeline",
    family: "research",
    kind: "research_pipeline",
  });

  const lease = await acquireBackgroundWorkflowSession({
    workflowRuntime: {
      async waitForRun() {
        return { status: "ok" };
      },
    },
    ownerAgent: "researcher",
    channelKey: "local:conversation:test",
    requesterSessionKey,
    preferredSessionKey: pipelineSessionKey,
    family: "research",
    kind: "workflow_auto_discussion",
  });

  assert.equal(lease.acquired, true);
  assert.equal(lease.reusedIdleSession, false);
  assert.match(lease.sessionKey ?? "", /workflow-auto-discussion$/);

  const listed = await listBackgroundWorkflowRuns({
    ownerAgent: "researcher",
    channelKey: "local:conversation:test",
  });
  assert.equal(listed.entries.length, 1);
  assert.equal(listed.entries[0].backgroundSessionKey, pipelineSessionKey);
  assert.equal(listed.entries[0].kind, "research_pipeline");
});

test("workflow background pool preserves concurrent project-scoped runtime session writes", async (t) => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "workflow-background-pool-project-scope-")
  );
  const projectRoot = path.join(workspaceRoot, "demo-project");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    JSON.stringify(
      {
        project_id: "demo-project",
        current_stage: "graph_build",
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      recordBackgroundWorkflowRun({
        ownerAgent: "researcher",
        channelKey: "discord:channel:test-room",
        requesterSessionKey: "agent:researcher:discord:channel:test-room",
        backgroundSessionKey: `agent:researcher:discord:channel:test-room:subagent:${index}`,
        runId: `run:${index}`,
        family: "research",
        kind: "resume_pipeline",
        projectId: "demo-project",
        projectRoot,
      })
    )
  );

  const listed = await listBackgroundWorkflowRuns({
    ownerAgent: "researcher",
    projectId: "demo-project",
    projectRoot,
  });

  assert.equal(listed.entries.length, 8);
  assert.deepEqual(
    listed.entries.map((entry) => entry.runId).sort(),
    Array.from({ length: 8 }, (_, index) => `run:${index}`)
  );
});

test("workflow background pool tolerates malformed project manifests while reconciling stale papernexus sessions", async (t) => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "workflow-background-pool-bad-manifest-")
  );
  const projectRoot = path.join(workspaceRoot, "demo-project");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    '{"project_id":"demo-project",',
    "utf8"
  );

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await recordBackgroundWorkflowRun({
    ownerAgent: "researcher",
    channelKey: "discord:channel:test-room",
    requesterSessionKey: "agent:researcher:discord:channel:test-room",
    backgroundSessionKey:
      "agent:researcher:discord:channel:test-room:subagent:papernexus-skill:corpus:demo-project",
    runId: "run:papernexus-import",
    queueKey:
      "background-run:agent:researcher:discord:channel:test-room:papernexus:papernexus_wrapper:demo-project:python3 scripts/pn_batch_import.py --shared-corpus GCD --refresh",
    family: "papernexus",
    kind: "papernexus_wrapper",
    projectId: "demo-project",
    projectRoot,
  });

  const sessionsPath = path.join(
    projectRoot,
    ".openclaw-research",
    "workflow-runtime-sessions.json"
  );
  const sessionsStore = JSON.parse(await fs.readFile(sessionsPath, "utf8"));
  sessionsStore.entries[0].startedAt = new Date(Date.now() - 20_000).toISOString();
  await fs.writeFile(sessionsPath, `${JSON.stringify(sessionsStore, null, 2)}\n`, "utf8");

  const listed = await listBackgroundWorkflowRuns({
    ownerAgent: "researcher",
    projectId: "demo-project",
    projectRoot,
  });
  assert.equal(listed.entries.length, 1);
  assert.ok(["active", "idle", "needs_repair"].includes(listed.entries[0].status));
});

test("workflow background pool releases stale active sessions even when maintenance refreshed lastCheckedAt", async (t) => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "workflow-background-pool-stale-active-")
  );
  const projectRoot = path.join(workspaceRoot, "demo-project");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    JSON.stringify(
      {
        project_id: "demo-project",
        current_stage: "idea",
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await recordBackgroundWorkflowRun({
    ownerAgent: "researcher",
    channelKey: "local:conversation:test",
    requesterSessionKey: "agent:researcher:local:conversation:test",
    backgroundSessionKey:
      "agent:researcher:local:conversation:test:subagent:research:stale",
    runId: "run:stale-research",
    family: "research",
    kind: "research_pipeline",
    projectId: "demo-project",
    projectRoot,
  });

  const sessionsPath = path.join(
    projectRoot,
    ".openclaw-research",
    "workflow-runtime-sessions.json"
  );
  const sessionsStore = JSON.parse(await fs.readFile(sessionsPath, "utf8"));
  const freshCheck = new Date().toISOString();
  sessionsStore.entries[0].startedAt = new Date(
    Date.now() - 61 * 60 * 1000
  ).toISOString();
  sessionsStore.entries[0].lastCheckedAt = freshCheck;
  sessionsStore.entries[0].lastHeartbeatAt = freshCheck;
  await fs.writeFile(sessionsPath, `${JSON.stringify(sessionsStore, null, 2)}\n`, "utf8");

  const listed = await listBackgroundWorkflowRuns({
    ownerAgent: "researcher",
    channelKey: "local:conversation:test",
    projectId: "demo-project",
    projectRoot,
  });
  assert.equal(listed.entries.length, 1);
  assert.equal(listed.entries[0].status, "needs_repair");

  const lease = await acquireBackgroundWorkflowSession({
    ownerAgent: "researcher",
    channelKey: "local:conversation:test",
    requesterSessionKey: "agent:researcher:local:conversation:test",
    family: "research",
    kind: "research_pipeline",
    projectId: "demo-project",
    projectRoot,
  });
  assert.equal(lease.acquired, true);
});

test("workflow background pool scopes capacity by workflow family so PaperNexus is not starved by other researcher work", async (t) => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "workflow-background-pool-family-capacity-")
  );
  const projectRoot = path.join(workspaceRoot, "demo-project");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    JSON.stringify(
      {
        project_id: "demo-project",
        current_stage: "graph_build",
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const requesterSessionKey = "agent:researcher:local:conversation:test";
  await recordBackgroundWorkflowRun({
    ownerAgent: "researcher",
    channelKey: "local:conversation:test",
    requesterSessionKey,
    backgroundSessionKey:
      "agent:researcher:local:conversation:test:subagent:research:one",
    runId: "run:research-one",
    family: "research",
    kind: "research_pipeline",
    projectId: "demo-project",
    projectRoot,
  });
  await recordBackgroundWorkflowRun({
    ownerAgent: "researcher",
    channelKey: "local:conversation:test",
    requesterSessionKey,
    backgroundSessionKey:
      "agent:researcher:local:conversation:test:subagent:review:one",
    runId: "run:review-one",
    family: "review",
    kind: "workflow_auto_discussion",
    projectId: "demo-project",
    projectRoot,
  });

  const lease = await acquireBackgroundWorkflowSession({
    ownerAgent: "researcher",
    channelKey: "local:conversation:test",
    requesterSessionKey,
    preferredSessionKey:
      "agent:researcher:local:conversation:test:subagent:papernexus:one",
    family: "papernexus",
    kind: "papernexus_wrapper",
    projectId: "demo-project",
    projectRoot,
  });

  assert.equal(lease.acquired, true);
  assert.equal(lease.activeOwnerSessionsInChannel, 2);
  assert.equal(
    lease.sessionKey,
    "agent:researcher:local:conversation:test:subagent:papernexus:one"
  );
});

test("workflow background pool does not consume active PaperNexus tracking misses from early needs-repair durable state", async (t) => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "workflow-background-pool-pn-needs-repair-")
  );
  const projectRoot = path.join(workspaceRoot, "demo-project");
  await fs.mkdir(projectRoot, { recursive: true });
  const backgroundSessionKey =
    "agent:researcher:local:conversation:test:subagent:papernexus:one";
  const queueKey =
    "background-run:agent:researcher:local:conversation:test:papernexus:papernexus_wrapper:demo-project:python3 scripts/pn_batch_import.py --shared-corpus GCD --refresh";
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    JSON.stringify(
      {
        project_id: "demo-project",
        current_stage: "graph_build",
        paper_ingestion: {
          runtime_status: "blocked",
          graph_presence_status: "missing_papers",
          queued_requests: [
            {
              wrapper: "python3 scripts/pn_batch_import.py --shared-corpus GCD --refresh",
              status: "needs_repair",
              lastRunId: "run:papernexus-import",
              lastSessionKey: backgroundSessionKey,
              lastError: "Prior project state says ingestion needs repair.",
            },
          ],
          active_batches: [],
          batch_items: [],
          paper_operations: [],
          import_task_ids: [],
          completed_papers: [],
        },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    entries: [
      makeQueueEntry(projectRoot, {
        queueKey,
        family: "papernexus",
        kind: "papernexus_wrapper",
        status: "needs_repair",
        lastError: "Prior project state says ingestion needs repair.",
      }),
    ],
  });

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await recordBackgroundWorkflowRun({
    ownerAgent: "researcher",
    channelKey: "local:conversation:test",
    requesterSessionKey: "agent:researcher:local:conversation:test",
    backgroundSessionKey,
    runId: "run:papernexus-import",
    queueKey,
    family: "papernexus",
    kind: "papernexus_wrapper",
    projectId: "demo-project",
    projectRoot,
  });

  const sessionsPath = path.join(
    projectRoot,
    ".openclaw-research",
    "workflow-runtime-sessions.json"
  );
  const sessionsStore = JSON.parse(await fs.readFile(sessionsPath, "utf8"));
  sessionsStore.entries[0].startedAt = new Date(Date.now() - 20_000).toISOString();
  await fs.writeFile(sessionsPath, `${JSON.stringify(sessionsStore, null, 2)}\n`, "utf8");

  const listed = await listBackgroundWorkflowRuns({
    workflowRuntime: {
      async waitForRun() {
        return {
          status: "error",
          error: "Embedded workflow run is not tracked in the local registry.",
        };
      },
    },
    ownerAgent: "researcher",
    channelKey: "local:conversation:test",
    family: "papernexus",
    projectId: "demo-project",
    projectRoot,
  });

  assert.equal(listed.entries.length, 1);
  assert.equal(listed.entries[0].status, "active");
});

test("background durable inference can defer needs-repair state while accepting it for stale cleanup", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  const entry = {
    backgroundSessionKey: "agent:researcher:local:autoresearch:subagent:pn",
    runId: "run:papernexus-import",
    queueKey: "python3 scripts/pn_batch_import.py --shared-corpus GCD --refresh",
    kind: "papernexus_wrapper",
    family: "papernexus",
    projectId: "background-pool-project",
    projectRoot,
  };

  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    entries: [
      makeQueueEntry(projectRoot, {
        queueKey: entry.queueKey,
        family: "papernexus",
        kind: "papernexus_wrapper",
        status: "needs_repair",
        lastError: "Prior durable state needs repair.",
      }),
    ],
  });

  const deferred = await inferBackgroundRunTerminalStateFromDurableState({
    entry,
    allowNeedsRepair: false,
  });
  assert.equal(deferred, null);

  const terminal = await inferBackgroundRunTerminalStateFromDurableState({
    entry,
  });
  assert.equal(terminal?.terminalStatus, "needs_repair");
  assert.equal(terminal?.source, "runtime_queue");
});

test("workflow background pool reconciles stale active PaperNexus import sessions from durable state", async (t) => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "workflow-background-pool-project-")
  );
  const projectRoot = path.join(workspaceRoot, "demo-project");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    JSON.stringify(
      {
        project_id: "demo-project",
        current_stage: "graph_build",
        paper_ingestion: {
          runtime_status: "idle",
          graph_presence_status: "missing_papers",
          queued_requests: [],
          active_batches: [],
          batch_items: [],
          paper_operations: [],
          import_task_ids: [],
          completed_papers: [],
        },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await recordBackgroundWorkflowRun({
    ownerAgent: "researcher",
    channelKey: "discord:channel:test-room",
    requesterSessionKey: "agent:researcher:discord:channel:test-room",
    backgroundSessionKey:
      "agent:researcher:discord:channel:test-room:subagent:papernexus-skill:corpus:demo-project",
    runId: "run:papernexus-import",
    queueKey:
      "background-run:agent:researcher:discord:channel:test-room:papernexus:papernexus_wrapper:demo-project:python3 scripts/pn_batch_import.py --shared-corpus 'GCD' --refresh",
    family: "papernexus",
    kind: "papernexus_wrapper",
    projectId: "demo-project",
    projectRoot,
  });

  const sessionsPath = path.join(
    projectRoot,
    ".openclaw-research",
    "workflow-runtime-sessions.json"
  );
  const sessionsStore = JSON.parse(await fs.readFile(sessionsPath, "utf8"));
  sessionsStore.entries[0].startedAt = new Date(Date.now() - 20_000).toISOString();
  await fs.writeFile(sessionsPath, `${JSON.stringify(sessionsStore, null, 2)}\n`, "utf8");

  const listed = await listBackgroundWorkflowRuns({
    ownerAgent: "researcher",
    projectId: "demo-project",
    projectRoot,
  });
  assert.equal(listed.entries.length, 1);
  assert.equal(listed.entries[0].status, "idle");

  const progress = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "PAPERNEXUS_PROGRESS.json"), "utf8")
  );
  assert.equal(progress.phase, "verifying_graph");
});
