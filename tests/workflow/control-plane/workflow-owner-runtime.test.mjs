import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ensureWorkflowOwnerRuntime,
} from "../../../tools/workflow-owner-runtime.ts";

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function makeProject(t, prefix) {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: path.basename(projectRoot),
    current_stage: "experiment",
    owner_agent: "researcher",
    workflow_control: {
      schema_version: 1,
      contract_id: "existing",
      reconciled_at: "2026-05-12T00:00:00.000Z",
      stage: "experiment",
      owner: "researcher",
      next_action: "/monitor-experiment",
      status: "ready",
      blocking_reason: null,
      completion: {
        status: "complete",
        source: "fixture",
        reason: null,
      },
      runtime_state: "idle",
      queue_key: null,
      session_key: null,
    },
  });
  return projectRoot;
}

async function writeRuntimeQueue(projectRoot, entries) {
  await writeJson(
    path.join(projectRoot, ".openclaw-research", "workflow-runtime-queue.json"),
    { entries }
  );
}

async function writeRuntimeSessions(projectRoot, entries) {
  await writeJson(
    path.join(projectRoot, ".openclaw-research", "workflow-runtime-sessions.json"),
    { entries }
  );
}

function queueEntry(projectRoot, patch = {}) {
  return {
    transition_id: patch.transition_id ?? "transition-1",
    queue_key: patch.queue_key ?? "queue:experiment:researcher",
    owner_agent: patch.owner_agent ?? "researcher",
    channel_key: "local",
    requester_session_key: "agent:researcher:main",
    family: "research",
    kind: "workflow_stage_dispatch",
    queued_at: "2026-05-12T00:00:00.000Z",
    status: patch.status ?? "queued",
    project_root: projectRoot,
    dispatch_payload: {
      to_role: patch.owner_agent ?? "researcher",
      project_root: projectRoot,
      stage: patch.stage ?? "experiment",
      summary: "runtime fixture",
    },
    ...patch,
  };
}

function sessionEntry(projectRoot, patch = {}) {
  return {
    session_key: patch.session_key ?? "agent:researcher:local:experiment",
    runtime: "sessions_spawn_v1",
    role: patch.role ?? "researcher",
    owner_agent: patch.owner_agent ?? "researcher",
    family: "research",
    kind: "workflow_stage_dispatch",
    project_root: projectRoot,
    status: patch.status ?? "active",
    started_at: "2026-05-12T00:00:00.000Z",
    queue_key: patch.queue_key ?? null,
    ...patch,
  };
}

test("ensureWorkflowOwnerRuntime reuses active owner session without touching completion", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-owner-runtime-active-");
  await writeRuntimeQueue(projectRoot, []);
  await writeRuntimeSessions(projectRoot, [
    sessionEntry(projectRoot, {
      session_key: "agent:researcher:local:experiment",
      queue_key: "queue:experiment:researcher",
    }),
  ]);

  const result = await ensureWorkflowOwnerRuntime({
    projectRoot,
    stage: "experiment",
    owner: "researcher",
    nextAction: "/monitor-experiment",
    writeRuntimeEvent: false,
    dispatch: async () => {
      throw new Error("dispatch must not run");
    },
  });

  assert.equal(result.status, "active");
  assert.equal(result.didDispatch, false);
  assert.equal(result.sessionKey, "agent:researcher:local:experiment");

  const manifest = await readJson(path.join(projectRoot, "PROJECT_MANIFEST.json"));
  assert.equal(manifest.workflow_control.completion.status, "complete");
});

test("ensureWorkflowOwnerRuntime reports queued runtime without dispatching again", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-owner-runtime-queued-");
  await writeRuntimeQueue(projectRoot, [
    queueEntry(projectRoot, { status: "queued" }),
  ]);
  await writeRuntimeSessions(projectRoot, []);

  const result = await ensureWorkflowOwnerRuntime({
    projectRoot,
    stage: "experiment",
    owner: "researcher",
    nextAction: "/monitor-experiment",
    writeRuntimeEvent: false,
    dispatch: async () => {
      throw new Error("dispatch must not run");
    },
  });

  assert.equal(result.status, "queued");
  assert.equal(result.didDispatch, false);
  assert.equal(result.queueKey, "queue:experiment:researcher");
});

test("ensureWorkflowOwnerRuntime blocks stale running queue without active session", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-owner-runtime-degraded-");
  await writeRuntimeQueue(projectRoot, [
    queueEntry(projectRoot, { status: "running" }),
  ]);
  await writeRuntimeSessions(projectRoot, []);

  const result = await ensureWorkflowOwnerRuntime({
    projectRoot,
    stage: "experiment",
    owner: "researcher",
    nextAction: "/monitor-experiment",
    writeRuntimeEvent: false,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.runtimeState, "degraded");
  assert.equal(result.reason, "stale_runtime_queue_without_active_session");
});

test("ensureWorkflowOwnerRuntime classifies idle runtime with no dispatcher as blocked", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-owner-runtime-idle-");
  await writeRuntimeQueue(projectRoot, []);
  await writeRuntimeSessions(projectRoot, []);

  const result = await ensureWorkflowOwnerRuntime({
    projectRoot,
    stage: "experiment",
    owner: "researcher",
    nextAction: "/monitor-experiment",
    writeRuntimeEvent: false,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.runtimeState, "idle");
  assert.equal(result.reason, "owner_runtime_dispatch_unavailable");
});

test("ensureWorkflowOwnerRuntime starts through injected runtime dispatcher", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-owner-runtime-started-");
  await writeRuntimeQueue(projectRoot, []);
  await writeRuntimeSessions(projectRoot, []);

  const calls = [];
  const result = await ensureWorkflowOwnerRuntime({
    projectRoot,
    stage: "experiment",
    owner: "researcher",
    nextAction: "/monitor-experiment",
    queueKey: "queue:experiment:researcher",
    writeRuntimeEvent: false,
    dispatch: async (request) => {
      calls.push(request);
      return {
        started: true,
        queueKey: request.queueKey,
        sessionKey: "agent:researcher:local:experiment",
        runId: "run-1",
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].queueKey, "queue:experiment:researcher");
  assert.equal(result.status, "started");
  assert.equal(result.runtimeState, "active");
  assert.equal(result.didDispatch, true);
  assert.equal(result.sessionKey, "agent:researcher:local:experiment");
});

test("ensureWorkflowOwnerRuntime blocks dispatch results without durable mapping", async (t) => {
  const projectRoot = await makeProject(t, "openclaw-owner-runtime-mapping-");
  await writeRuntimeQueue(projectRoot, []);
  await writeRuntimeSessions(projectRoot, []);

  const result = await ensureWorkflowOwnerRuntime({
    projectRoot,
    stage: "experiment",
    owner: "researcher",
    nextAction: "/monitor-experiment",
    queueKey: "",
    writeRuntimeEvent: false,
    dispatch: async () => ({
      started: true,
    }),
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.runtimeState, "degraded");
  assert.equal(result.reason, "runtime_dispatch_missing_durable_mapping");
});
