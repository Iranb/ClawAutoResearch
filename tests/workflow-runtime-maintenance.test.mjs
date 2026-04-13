import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createWorkflowTransitionIntent,
  recordWorkflowRuntimeSession,
} from "../tools/workflow-session-orchestrator.ts";
import {
  migrateWorkflowRuntimeState,
  readWorkflowRuntimeQueueStore,
  readWorkflowRuntimeSessionsStore,
  writeWorkflowRuntimeQueueStore,
} from "../tools/workflow-runtime-state.ts";
import { readWorkflowRuntimeIncidentsStore } from "../tools/workflow-runtime-incidents.ts";
import { runWorkflowRuntimeMaintenancePass } from "../tools/workflow-runtime-maintenance.ts";
import { readWorkflowHandoffIntentStore } from "../tools/workflow-handoff/handoff-store.ts";
import { bindChannelProjectForWorkflow } from "../tools/workflow-guard.ts";

async function makeProjectRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-runtime-maintenance-"));
}

async function makeProject(projectRoot, projectId) {
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: projectId,
        current_stage: "idea",
        owner_agent: "researcher",
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeExecutable(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, { mode: 0o755 });
}

test("runWorkflowRuntimeMaintenancePass replays repairable background transitions", async (t) => {
  const projectRoot = await makeProjectRoot();
  const queueKey = "repair:bg:q1";

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "alpha");
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId: "alpha",
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });

  await createWorkflowTransitionIntent({
    projectRoot,
    projectId: "alpha",
    queueKey,
    source: "start_background_run",
    entryType: "background_run",
    ownerAgent: "researcher",
    channelKey: "discord:group:paper-lab",
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    preferredSessionKey: "agent:researcher:discord:group:paper-lab:subagent:bg",
    family: "research",
    kind: "literature_review",
    summary: "Resume the literature review background run.",
    runPayload: {
      message: "Continue the bounded literature review task.",
      lane: "nested",
      deliver: false,
      idempotencyKey: "bg-repair-1",
      extraSystemPrompt: "Stay bounded.",
    },
  });

  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    projectId: "alpha",
    entries: queueStore.entries.map((entry) =>
      entry.queueKey === queueKey
        ? {
            ...entry,
            status: "needs_repair",
            lastAttemptedAt: "2026-04-10T09:00:00.000Z",
            lastCheckedAt: "2026-04-10T09:00:00.000Z",
          }
        : entry
    ),
  });
  await recordWorkflowRuntimeSession({
    projectRoot,
    projectId: "alpha",
    sessionKey: "agent:researcher:discord:group:paper-lab:subagent:bg",
    sessionId: "runtime-session-alpha",
    runtime: "subagent",
    role: "researcher",
    agentId: "researcher",
    ownerAgent: "researcher",
    family: "research",
    kind: "literature_review",
    channelKey: "discord:group:paper-lab",
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    projectRoot,
    status: "needs_repair",
    runId: "runtime-run-alpha",
    queueKey,
    startedAt: "2026-04-10T09:00:00.000Z",
    lastHeartbeatAt: "2026-04-10T09:00:00.000Z",
  });

  const started = [];
  const result = await runWorkflowRuntimeMaintenancePass({
    projectRoot,
    projectId: "alpha",
    runtimeSubagent: {
      async run(params) {
        started.push(params);
        return { runId: "replayed-bg-run-1" };
      },
    },
    maxRepairAttempts: 3,
    staleSessionAgeMs: 0,
  });

  assert.deepEqual(result.replayedQueueKeys, [queueKey]);
  assert.equal(result.watchdogSummary.queueRepairPending, 0);
  assert.equal(started.length, 1);
  assert.equal(started[0].sessionKey, "agent:researcher:discord:group:paper-lab:subagent:bg");

  const refreshedQueue = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(
    refreshedQueue.entries.find((entry) => entry.queueKey === queueKey)?.status,
    "running"
  );
  const refreshedSessions = await readWorkflowRuntimeSessionsStore(projectRoot);
  assert.equal(
    refreshedSessions.entries.some(
      (entry) => entry.queueKey === queueKey && entry.status === "active"
    ),
    true
  );
});

test("runWorkflowRuntimeMaintenancePass escalates exhausted transitions and orphan sessions", async (t) => {
  const projectRoot = await makeProjectRoot();
  const queueKey = "repair:dispatch:q2";

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await makeProject(projectRoot, "beta");
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId: "beta",
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });

  await createWorkflowTransitionIntent({
    projectRoot,
    projectId: "beta",
    queueKey,
    source: "workflow_auto_stage",
    entryType: "dispatch_task",
    ownerAgent: "researcher",
    channelKey: "discord:group:paper-lab",
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    preferredSessionKey: "agent:researcher:discord:group:paper-lab:subagent:workflow-stage",
    family: "research",
    kind: "workflow_stage_dispatch",
    summary: "Replay the stalled stage dispatch.",
    dispatchPayload: {
      requesterChannel: "discord",
      requesterAccountId: null,
      preferredSessionKeys: [
        "agent:researcher:discord:group:paper-lab:subagent:workflow-stage",
      ],
      fromRole: "researcher",
      toRole: "researcher",
      projectRoot,
      projectId: "beta",
      stage: "idea",
      summary: "Replay the stalled stage dispatch.",
      command: "/idea-phase",
      mailboxMessageId: null,
      requireMailboxAcknowledgement: true,
      extraBody: "Continue only the assigned stage.",
      waitTimeoutMs: 5_000,
      retryOnTimeout: true,
      enableSpawnFallback: true,
      useWorkflowHandoff: true,
      autoModeActive: true,
    },
  });

  const initialQueueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    projectId: "beta",
    entries: initialQueueStore.entries.map((entry) =>
      entry.queueKey === queueKey
        ? {
            ...entry,
            status: "needs_repair",
            attemptCount: 3,
            lastAttemptedAt: "2026-04-10T09:00:00.000Z",
            lastCheckedAt: "2026-04-10T09:00:00.000Z",
            lastError: "stuck",
          }
        : entry
    ),
  });

  await recordWorkflowRuntimeSession({
    projectRoot,
    projectId: "beta",
    sessionKey: "agent:researcher:discord:group:paper-lab:subagent:workflow-stage",
    sessionId: "runtime-session-beta",
    runtime: "subagent",
    role: "researcher",
    agentId: "researcher",
    ownerAgent: "researcher",
    family: "research",
    kind: "workflow_stage_dispatch",
    channelKey: "discord:group:paper-lab",
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    projectRoot,
    status: "needs_repair",
    runId: "runtime-run-beta",
    queueKey,
    startedAt: "2026-04-10T09:00:00.000Z",
    lastHeartbeatAt: "2026-04-10T09:00:00.000Z",
  });
  await recordWorkflowRuntimeSession({
    projectRoot,
    projectId: "beta",
    sessionKey: "agent:researcher:discord:group:paper-lab:orphan",
    sessionId: "runtime-session-orphan",
    runtime: "subagent",
    role: "researcher",
    agentId: "researcher",
    ownerAgent: "researcher",
    family: "research",
    kind: "workflow_stage_dispatch",
    channelKey: "discord:group:paper-lab",
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    projectRoot,
    status: "needs_repair",
    runId: "runtime-run-orphan",
    queueKey: null,
    startedAt: "2026-04-10T09:00:00.000Z",
    lastHeartbeatAt: "2026-04-10T09:00:00.000Z",
  });

  const result = await runWorkflowRuntimeMaintenancePass({
    projectRoot,
    projectId: "beta",
    maxRepairAttempts: 3,
    staleSessionAgeMs: 0,
  });

  assert.deepEqual(result.exhaustedQueueKeys, [queueKey]);
  assert.equal(result.exhaustedSessionKeys.includes("agent:researcher:discord:group:paper-lab:orphan"), true);

  const refreshedQueue = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(
    refreshedQueue.entries.find((entry) => entry.queueKey === queueKey)?.status,
    "failed"
  );
  const refreshedSessions = await readWorkflowRuntimeSessionsStore(projectRoot);
  assert.equal(
    refreshedSessions.entries.find((entry) => entry.sessionKey.endsWith(":orphan"))?.status,
    "failed"
  );

  const incidents = await readWorkflowRuntimeIncidentsStore(projectRoot, "beta");
  assert.equal(
    incidents.entries.some((entry) => entry.kind === "repair_exhausted"),
    true
  );
  assert.equal(
    incidents.entries.some((entry) => entry.kind === "repair_orphan_session"),
    true
  );
});

test("runWorkflowRuntimeMaintenancePass suppresses stale queue replays when the channel binding moved to another project", async (t) => {
  const workspaceRoot = await makeProjectRoot();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const staleProjectRoot = path.join(projectsRoot, "generalized-category-discovery");
  const reboundProjectRoot = path.join(projectsRoot, "gcd-survey-tpami-2026");
  const queueKey = "repair:dispatch:binding-mismatch";
  const sessionKey = "agent:researcher:discord:channel:1491811255814586530";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await makeProject(staleProjectRoot, "generalized-category-discovery");
  await makeProject(reboundProjectRoot, "gcd-survey-tpami-2026");
  await migrateWorkflowRuntimeState({
    projectRoot: staleProjectRoot,
    projectId: "generalized-category-discovery",
    compatibilityMode: "sessions_spawn_runtime",
    reason: "test_bootstrap",
  });
  await bindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    projectRoot: reboundProjectRoot,
    boundByAgent: "researcher",
  });

  await createWorkflowTransitionIntent({
    projectRoot: staleProjectRoot,
    projectId: "generalized-category-discovery",
    queueKey,
    source: "workflow_auto_stage",
    entryType: "dispatch_task",
    ownerAgent: "researcher",
    channelKey: "discord:channel:1491811255814586530",
    requesterSessionKey: sessionKey,
    preferredSessionKey: `${sessionKey}:subagent:workflow-stage`,
    family: "research",
    kind: "workflow_stage_dispatch",
    summary: "Replay the stale stage dispatch.",
    dispatchPayload: {
      requesterChannel: "discord",
      requesterAccountId: "default",
      preferredSessionKeys: [`${sessionKey}:subagent:workflow-stage`],
      fromRole: "researcher",
      toRole: "coder",
      projectRoot: staleProjectRoot,
      projectId: "generalized-category-discovery",
      stage: "plan",
      summary: "Replay the stale stage dispatch.",
      command: "/plan-research",
      mailboxMessageId: null,
      requireMailboxAcknowledgement: true,
      extraBody: "Continue only the assigned stage.",
      waitTimeoutMs: 5_000,
      retryOnTimeout: true,
      enableSpawnFallback: true,
      useWorkflowHandoff: true,
      autoModeActive: true,
    },
  });
  const queueStore = await readWorkflowRuntimeQueueStore(staleProjectRoot);
  await writeWorkflowRuntimeQueueStore({
    projectRoot: staleProjectRoot,
    projectId: "generalized-category-discovery",
    entries: queueStore.entries.map((entry) =>
      entry.queueKey === queueKey
        ? {
            ...entry,
            status: "needs_repair",
            attemptCount: 0,
            lastAttemptedAt: "2026-04-10T09:00:00.000Z",
            lastCheckedAt: "2026-04-10T09:00:00.000Z",
          }
        : entry
    ),
  });

  const result = await runWorkflowRuntimeMaintenancePass({
    projectRoot: staleProjectRoot,
    projectId: "generalized-category-discovery",
    workflowPolicy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    staleSessionAgeMs: 0,
  });

  assert.equal(result.exhaustedQueueKeys.includes(queueKey), true);
  assert.equal(result.replayedQueueKeys.includes(queueKey), false);
  const refreshedQueue = await readWorkflowRuntimeQueueStore(staleProjectRoot);
  assert.equal(
    refreshedQueue.entries.find((entry) => entry.queueKey === queueKey)?.status,
    "failed"
  );
  const incidents = await readWorkflowRuntimeIncidentsStore(
    staleProjectRoot,
    "generalized-category-discovery"
  );
  assert.equal(
    incidents.entries.some((entry) => entry.kind === "binding_gate_mismatch"),
    true
  );
});

test("runWorkflowRuntimeMaintenancePass routes terminal PaperNexus retry failures to repair handoff", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await makeProject(projectRoot, "gamma");
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.paper_ingestion = {
    retry_status: "completed_with_failures",
    retryable_failed_papers: [{ source_key: "paper-1", title: "Failed paper" }],
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await runWorkflowRuntimeMaintenancePass({
    projectRoot,
    projectId: "gamma",
  });

  const handoffs = await readWorkflowHandoffIntentStore(projectRoot);
  assert.equal(
    handoffs.intents.some((intent) => intent.reason === "paper_ingestion_failed"),
    true
  );
});

test("runWorkflowRuntimeMaintenancePass refreshes experiment monitor and persists decision without a foreground agent", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-runtime-maintenance-ssh-"));

  t.after(async () => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await fs.rm(binDir, { recursive: true, force: true });
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeExecutable(
    path.join(binDir, "ssh"),
    [
      "#!/bin/sh",
      "printf '\\n---SCREENS---\\n'",
      "printf 'No Sockets found in /run/screen.\\n'",
      "",
    ].join("\n")
  );
  process.env.PATH = `${binDir}:${previousPath ?? ""}`;

  await makeProject(projectRoot, "delta");
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "experiment";
  manifest.owner_agent = "researcher";
  manifest.experiment_search = {
    status: "running",
    search_spec_path: "planner/EXPERIMENT_SEARCH_SPEC.json",
    baseline_fairness_status: "ready",
    implementation_confidence: "trusted",
    multi_seed_status: "pending",
    ablation_status: "pending",
    search_exhaustion_status: "active",
    evidence_cleanliness_status: "clean",
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeJson(path.join(projectRoot, "planner", "EXPERIMENT_SEARCH_SPEC.json"), {
    search_session_id: "search-delta",
  });
  const runDir = path.join(projectRoot, "coder", "demo-exp");
  await writeJson(path.join(runDir, "REMOTE_RUN.json"), {
    experiment_id: "exp-delta",
    experiment_name: "candidate",
    track_id: "track-main",
    server: "gpu-server",
    gpu_id: "0",
    screen_name: "timed-run",
    status: "running",
  });
  await writeJson(path.join(runDir, "RUN_HEARTBEAT.json"), {
    status: "running",
    heartbeat_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  });

  const result = await runWorkflowRuntimeMaintenancePass({
    projectRoot,
    projectId: "delta",
  });

  assert.equal(result.experimentMaintenance.attempted, true);
  assert.equal(result.experimentMaintenance.monitorRefreshed, true);
  assert.equal(result.experimentMaintenance.decisionPersisted, true);
  assert.equal(result.experimentMaintenance.recommendation, "reconcile_finished");
  assert.equal(result.experimentMaintenance.decision, "reconcile_runtime");

  const refreshedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(
    refreshedManifest.experiment_search.last_decision,
    "reconcile_runtime"
  );
});
