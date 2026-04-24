import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildAutoIteratorStageBroadcastMessage,
  isWorkflowStageBroadcastMessage,
  maybeBroadcastAutoIteratorStageChange,
  maybeBroadcastWorkflowStatusUpdate,
} from "../tools/stage-broadcast.ts";
import { readWorkflowBroadcastOutboxStore } from "../tools/workflow-runtime-state.ts";
import { readWorkflowRuntimeIncidentsStore } from "../tools/workflow-runtime-incidents.ts";
import { bindChannelProjectForWorkflow } from "../tools/workflow-guard.ts";

test("buildAutoIteratorStageBroadcastMessage captures transition, owner, and dispatch context", () => {
  const message = buildAutoIteratorStageBroadcastMessage({
    projectId: "demo-project",
    projectRoot: "/tmp/demo-project",
    stageBefore: "setup",
    stageAfter: "graph_build",
    ownerBefore: "researcher",
    ownerAfter: "orchestrator",
    nextAction: "/graph-build",
    blockingReason: null,
    recommendedActions: [
      {
        kind: "drive_stage",
        owner: "orchestrator",
        stage: "graph_build",
        summary: "Build the graph before frontier mapping.",
        command: "/graph-build",
        mailboxMessageId: "msg-123",
        blocking: false,
      },
      {
        kind: "background",
        owner: "researcher",
        stage: "graph_build",
        summary: "Refresh graph inputs and verify missing papers.",
        command: "/graph-build",
        blocking: false,
      },
    ],
    agentTaskDispatch: {
      dispatched: true,
      owner: "orchestrator",
      strategy: "direct_session",
      channel: "sessions_send",
    },
    handoffIntentId: "intent-123",
  });

  assert.match(message, /Workflow advanced: setup -> graph build/);
  assert.match(message, /^\s*WORKFLOW_STAGE_BROADCAST=1[\s\S]*\[Workflow Stage Update\]/);
  assert.match(message, /Notify: @Orchestrator/);
  assert.match(message, /\[STATUS\] Workflow advanced: setup -> graph build/);
  assert.match(message, /\[HANDOFF\] next owner: @Orchestrator/);
  assert.match(message, /\[NEXT\] \/graph-build/);
  assert.match(message, /Owner: researcher -> orchestrator/);
  assert.match(message, /Responsible agent: @Orchestrator/);
  assert.match(message, /Next action: \/graph-build/);
  assert.match(message, /Mailbox: msg-123/);
  assert.match(
    message,
    /Agent participation: orchestrator: task dispatched, via direct_session \| researcher: Refresh graph inputs and verify missing papers., command \/graph-build/
  );
  assert.match(message, /Dispatch: dispatched=yes, owner=orchestrator/);
  assert.match(message, /Handoff Intent: intent-123/);
  assert.match(message, /ack_handoff_intent/);
});

test("isWorkflowStageBroadcastMessage recognizes rendered stage updates", () => {
  assert.equal(isWorkflowStageBroadcastMessage("[Workflow Stage Update]\nNotify: @Researcher"), true);
  assert.equal(isWorkflowStageBroadcastMessage("plain status update"), false);
});

test("maybeBroadcastAutoIteratorStageChange skips when the stage is unchanged", async () => {
  const result = await maybeBroadcastAutoIteratorStageChange({
    workflowRuntime: {
      async run() {
        throw new Error("should not run");
      },
    },
    sessionKey: "agent:researcher:discord:group:paper-lab",
    projectId: "demo-project",
    projectRoot: "/tmp/demo-project",
    stageBefore: "graph_build",
    stageAfter: "graph_build",
    stageChanged: false,
    ownerBefore: "researcher",
    ownerAfter: "researcher",
    nextAction: "/graph-build",
    blockingReason: null,
  });

  assert.equal(result.broadcasted, false);
  assert.equal(result.reasonSkipped, "stage_unchanged");
});

test("maybeBroadcastAutoIteratorStageChange posts a deliverable nested run when the stage changes", async () => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-stage-broadcast-")
  );
  const calls = [];
  try {
    const result = await maybeBroadcastAutoIteratorStageChange({
      workflowRuntime: {
        async run(params) {
          calls.push(params);
          return { runId: "broadcast-run-1" };
        },
      },
      sessionKey: "agent:researcher:discord:group:paper-lab",
      projectId: "demo-project",
      projectRoot,
      stageBefore: "frontier_mapping",
      stageAfter: "idea",
      stageChanged: true,
      ownerBefore: "researcher",
      ownerAfter: "researcher",
      nextAction: "/idea-phase",
      blockingReason: null,
      regressed: false,
      recommendedActions: [
        {
          kind: "drive_stage",
          owner: "researcher",
          stage: "idea",
          summary: "Advance to ideation with the refreshed graph.",
          command: "/idea-phase",
          blocking: false,
        },
      ],
    });

    assert.equal(result.broadcasted, true);
    assert.equal(result.runId, "broadcast-run-1");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sessionKey, "agent:researcher:discord:group:paper-lab");
    assert.equal(calls[0].lane, "nested");
    assert.equal(calls[0].deliver, true);
    assert.match(calls[0].message, /WORKFLOW_STAGE_BROADCAST=1/);
    assert.match(calls[0].extraSystemPrompt, /synthetic workflow stage-change broadcast/i);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("maybeBroadcastWorkflowStatusUpdate records delivery in the project-local broadcast outbox", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-stage-broadcast-")
  );
  const calls = [];

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify({ project_id: "demo-project", current_stage: "idea" }, null, 2)}\n`,
    "utf8"
  );

  const result = await maybeBroadcastWorkflowStatusUpdate({
    workflowRuntime: {
      async run(params) {
        calls.push(params);
        return { runId: "status-run-1" };
      },
    },
    sessionKey: "agent:researcher:discord:group:paper-lab",
    projectId: "demo-project",
    projectRoot,
    status: "recovered_after_restart",
    stage: "idea",
    summary: "Recovered the workflow runtime after restart.",
    idempotencyKeySuffix: "recovery",
  });

  assert.equal(result.broadcasted, true);
  assert.equal(result.runId, "status-run-1");
  assert.equal(calls.length, 1);

  const outbox = await readWorkflowBroadcastOutboxStore(projectRoot);
  assert.equal(outbox.entries.length, 1);
  assert.equal(outbox.entries[0].status, "recovered_after_restart");
  assert.equal(outbox.entries[0].deliveryStatus, "delivered");
});

test("maybeBroadcastAutoIteratorStageChange short-circuits duplicate broadcast idempotency", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-stage-broadcast-")
  );
  const calls = [];

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const base = {
    workflowRuntime: {
      async run(params) {
        calls.push(params);
        return { runId: `broadcast-run-${calls.length}` };
      },
    },
    sessionKey: "agent:researcher:discord:group:paper-lab",
    projectId: "demo-project",
    projectRoot,
    stageBefore: "plan",
    stageAfter: "code",
    stageChanged: true,
    ownerBefore: "orchestrator",
    ownerAfter: "coder",
    nextAction: "/code-phase",
    blockingReason: null,
  };

  const first = await maybeBroadcastAutoIteratorStageChange(base);
  const second = await maybeBroadcastAutoIteratorStageChange(base);

  assert.equal(first.broadcasted, true);
  assert.equal(second.broadcasted, false);
  assert.equal(second.reasonSkipped, "duplicate_delivered");
  assert.equal(calls.length, 1);
});

test("maybeBroadcastAutoIteratorStageChange records Discord inbound timeout as incident", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-stage-broadcast-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await maybeBroadcastAutoIteratorStageChange({
    workflowRuntime: {
      async run() {
        throw new Error("Discord inbound worker timed out.");
      },
    },
    sessionKey: "agent:researcher:discord:group:paper-lab",
    projectId: "demo-project",
    projectRoot,
    stageBefore: "plan",
    stageAfter: "code",
    stageChanged: true,
    ownerBefore: "orchestrator",
    ownerAfter: "coder",
    nextAction: "/code-phase",
    blockingReason: null,
  });

  assert.equal(result.broadcasted, false);
  assert.equal(result.reasonSkipped, "runtime_error");
  const incidents = await readWorkflowRuntimeIncidentsStore(projectRoot, "demo-project");
  assert.equal(incidents.entries.length, 1);
  assert.equal(incidents.entries[0].kind, "discord_inbound_timeout");
});

test("maybeBroadcastAutoIteratorStageChange supersedes stale pending/failed stage broadcasts", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-stage-broadcast-")
  );
  let shouldFail = true;
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await maybeBroadcastAutoIteratorStageChange({
    workflowRuntime: {
      async run() {
        if (shouldFail) throw new Error("temporary broadcast failure");
        return { runId: "run-ok" };
      },
    },
    sessionKey: "agent:researcher:discord:group:paper-lab",
    projectId: "demo-project",
    projectRoot,
    stageBefore: "code",
    stageAfter: "plan",
    stageChanged: true,
    ownerBefore: "coder",
    ownerAfter: "orchestrator",
    nextAction: "/plan",
    blockingReason: null,
  });
  shouldFail = false;
  await maybeBroadcastAutoIteratorStageChange({
    workflowRuntime: {
      async run() {
        return { runId: "run-ok" };
      },
    },
    sessionKey: "agent:researcher:discord:group:paper-lab",
    projectId: "demo-project",
    projectRoot,
    stageBefore: "plan",
    stageAfter: "code",
    stageChanged: true,
    ownerBefore: "orchestrator",
    ownerAfter: "coder",
    nextAction: "/code",
    blockingReason: null,
  });

  const outbox = await readWorkflowBroadcastOutboxStore(projectRoot);
  assert.equal(outbox.entries[0].deliveryStatus, "superseded");
  assert.equal(outbox.entries[1].deliveryStatus, "delivered");
});

test("maybeBroadcastWorkflowStatusUpdate suppresses stale cross-project broadcasts when the channel binding moved", async (t) => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-stage-broadcast-binding-")
  );
  const projectsRoot = path.join(workspaceRoot, "projects");
  const staleProjectRoot = path.join(projectsRoot, "generalized-category-discovery");
  const boundProjectRoot = path.join(projectsRoot, "gcd-survey-tpami-2026");
  const sessionKey = "agent:researcher:local:channel:1491811255814586530";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await fs.mkdir(staleProjectRoot, { recursive: true });
  await fs.mkdir(boundProjectRoot, { recursive: true });
  await fs.writeFile(
    path.join(staleProjectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify({ project_id: "generalized-category-discovery" }, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(boundProjectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify({ project_id: "gcd-survey-tpami-2026" }, null, 2)}\n`,
    "utf8"
  );
  await bindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "local",
    projectRoot: boundProjectRoot,
    boundByAgent: "researcher",
  });

  const result = await maybeBroadcastWorkflowStatusUpdate({
    workflowRuntime: {
      async run() {
        throw new Error("should not send");
      },
    },
    bindingPolicy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    sessionKey,
    projectId: "generalized-category-discovery",
    projectRoot: staleProjectRoot,
    status: "waiting",
    stage: "plan",
    summary: "A stale test broadcast should not leak into the rebound channel.",
    idempotencyKeySuffix: "binding-mismatch",
  });

  assert.equal(result.broadcasted, false);
  assert.equal(result.reasonSkipped, "binding_mismatch");
  const outbox = await readWorkflowBroadcastOutboxStore(staleProjectRoot);
  assert.equal(outbox.entries.length, 1);
  assert.equal(outbox.entries[0].deliveryStatus, "superseded");
});

test("maybeBroadcastWorkflowStatusUpdate treats Discord sessions as notification-only even when legacy bindings moved", async (t) => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-stage-broadcast-discord-")
  );
  const projectsRoot = path.join(workspaceRoot, "projects");
  const staleProjectRoot = path.join(projectsRoot, "generalized-category-discovery");
  const boundProjectRoot = path.join(projectsRoot, "gcd-survey-tpami-2026");
  const sessionKey = "agent:researcher:discord:channel:1491811255814586530";
  const calls = [];

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await fs.mkdir(staleProjectRoot, { recursive: true });
  await fs.mkdir(boundProjectRoot, { recursive: true });
  await fs.writeFile(
    path.join(staleProjectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify({ project_id: "generalized-category-discovery" }, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(boundProjectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify({ project_id: "gcd-survey-tpami-2026" }, null, 2)}\n`,
    "utf8"
  );
  await bindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    projectRoot: boundProjectRoot,
    boundByAgent: "researcher",
  });

  const result = await maybeBroadcastWorkflowStatusUpdate({
    workflowRuntime: {
      async run(params) {
        calls.push(params);
        return { runId: "discord-notify-run-1" };
      },
    },
    bindingPolicy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    sessionKey,
    projectId: "generalized-category-discovery",
    projectRoot: staleProjectRoot,
    status: "waiting",
    stage: "plan",
    summary: "Discord should remain a notification target, not a project binding gate.",
    idempotencyKeySuffix: "discord-notification-only",
  });

  assert.equal(result.broadcasted, true);
  assert.equal(result.reasonSkipped, null);
  assert.equal(calls.length, 1);
  const outbox = await readWorkflowBroadcastOutboxStore(staleProjectRoot);
  assert.equal(outbox.entries.length, 1);
  assert.equal(outbox.entries[0].deliveryStatus, "delivered");
});
