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
});

test("isWorkflowStageBroadcastMessage recognizes rendered stage updates", () => {
  assert.equal(isWorkflowStageBroadcastMessage("[Workflow Stage Update]\nNotify: @Researcher"), true);
  assert.equal(isWorkflowStageBroadcastMessage("plain status update"), false);
});

test("maybeBroadcastAutoIteratorStageChange skips when the stage is unchanged", async () => {
  const result = await maybeBroadcastAutoIteratorStageChange({
    runtimeSubagent: {
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
  const calls = [];
  const result = await maybeBroadcastAutoIteratorStageChange({
    runtimeSubagent: {
      async run(params) {
        calls.push(params);
        return { runId: "broadcast-run-1" };
      },
    },
    sessionKey: "agent:researcher:discord:group:paper-lab",
    projectId: "demo-project",
    projectRoot: "/tmp/demo-project",
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
    runtimeSubagent: {
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
