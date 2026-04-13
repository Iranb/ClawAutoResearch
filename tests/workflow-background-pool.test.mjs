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
  clearBackgroundWorkflowRunRegistryForTests,
  listBackgroundWorkflowRuns,
  recordBackgroundWorkflowRun,
  retireBackgroundWorkflowRuns,
} from "../tools/workflow-background-pool.ts";

test.beforeEach(async () => {
  await clearBackgroundWorkflowRunRegistryForTests();
});

test.afterEach(async () => {
  await clearBackgroundWorkflowRunRegistryForTests();
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
    runtimeSubagent: {
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
