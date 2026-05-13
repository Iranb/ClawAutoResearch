import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildWorkflowDispatchMessage,
  deriveAgentSessionKeyForRole,
  deriveWorkflowDispatchSessionCandidates,
  dispatchWorkflowTaskToAgent,
} from "../../tools/agent-task-dispatch.ts";
import { readWorkflowDiagnosticEvents } from "../../tools/workflow-diagnostics.ts";
import {
  downgradeWorkflowAgentCapability,
  upsertWorkflowAgentCapability,
} from "../../tools/workflow-handoff/agent-capabilities.ts";
import { buildWorkflowControlContract } from "../../tools/workflow-control-contract.ts";

test("deriveAgentSessionKeyForRole keeps the same channel peer and swaps the agent id", () => {
  const sessionKey = deriveAgentSessionKeyForRole({
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    targetRole: "coder",
  });
  assert.equal(sessionKey, "agent:coder:discord:group:paper-lab");
});

test("deriveWorkflowDispatchSessionCandidates falls back from thread to parent session and main", () => {
  const candidates = deriveWorkflowDispatchSessionCandidates({
    requesterSessionKey: "agent:researcher:discord:group:paper-lab:thread:idea-1",
    targetRole: "coder",
  });
  assert.deepEqual(candidates, [
    "agent:coder:discord:group:paper-lab:thread:idea-1",
    "agent:coder:discord:group:paper-lab",
    "agent:coder:main",
  ]);
});

test("deriveAgentSessionKeyForRole strips workflow subagent lineage before swapping roles", () => {
  const sessionKey = deriveAgentSessionKeyForRole({
    requesterSessionKey:
      "agent:researcher:discord:channel:1493115797856452619:subagent:workflow-survey-review:survey-generalized-category-discovery:generalized-category-discovery",
    targetRole: "academic_writer",
  });
  assert.equal(sessionKey, "agent:academic_writer:discord:channel:1493115797856452619");
});

test("buildWorkflowDispatchMessage includes project and mailbox context", () => {
  const message = buildWorkflowDispatchMessage({
    projectRoot: "/tmp/demo-project",
    projectId: "demo-project",
    fromRole: "researcher",
    toRole: "reviewer",
    stage: "review",
    summary: "Please review the latest idea report.",
    command: "/review-phase",
    mailboxMessageId: "msg-123",
  });
  assert.match(message, /Project ID: demo-project/);
  assert.match(message, /Mailbox message id: msg-123/);
  assert.match(message, /Immediate command: \/review-phase/);
  assert.match(message, /\[STATUS\] review complete/);
  assert.match(message, /\[HANDOFF\] next owner: reviewer/);
  assert.match(message, /Target owner label: \[reviewer\]/i);
});

test("dispatchWorkflowTaskToAgent sends a nested fire-and-forget run to the target session", async () => {
  const calls = [];
  const result = await dispatchWorkflowTaskToAgent({
    workflowRuntime: {
      async run(params) {
        calls.push(params);
        return { runId: "run-1" };
      },
    },
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    requesterChannel: "discord",
    fromRole: "researcher",
    toRole: "coder",
    projectRoot: "/tmp/demo-project",
    projectId: "demo-project",
    stage: "code",
    summary: "Implement the current experiment plan.",
    command: "/implement-experiment",
    mailboxMessageId: "msg-001",
    requireMailboxAcknowledgement: false,
  });

  assert.equal(result.dispatched, true);
  assert.equal(result.sessionKey, "agent:coder:discord:group:paper-lab");
  assert.equal(result.runId, "run-1");
  assert.equal(result.channel, "sessions_send");
  assert.equal(result.strategy, "direct_session");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sessionKey, "agent:coder:discord:group:paper-lab");
  assert.equal(calls[0].lane, "nested");
  assert.equal(calls[0].deliver, false);
  assert.match(calls[0].message, /Implement the current experiment plan/);
});

test("dispatchWorkflowTaskToAgent resets an existing target session on the first project handoff", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-dispatch-first-reset-")
  );
  const events = [];

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await dispatchWorkflowTaskToAgent({
    workflowRuntime: {
      async getSessionMessages({ sessionKey }) {
        if (sessionKey === "agent:coder:discord:group:paper-lab") {
          return { messages: [{ id: "stale-msg" }] };
        }
        return { messages: [] };
      },
      async deleteSession({ sessionKey, deleteTranscript }) {
        events.push(`delete:${sessionKey}:${deleteTranscript === true ? "full" : "partial"}`);
      },
      async run(params) {
        events.push(`run:${params.sessionKey}`);
        return { runId: "run-reset-1" };
      },
    },
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    requesterChannel: "discord",
    fromRole: "researcher",
    toRole: "coder",
    projectRoot,
    projectId: "demo-project",
    stage: "code",
    summary: "Implement the current experiment plan.",
    command: "/implement-experiment",
    requireMailboxAcknowledgement: false,
  });

  assert.equal(result.dispatched, true);
  assert.deepEqual(events, [
    "delete:agent:coder:discord:group:paper-lab:full",
    "run:agent:coder:discord:group:paper-lab",
  ]);
});

test("dispatchWorkflowTaskToAgent does not reset the requester's own session on first same-role dispatch", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-dispatch-same-role-")
  );
  let deleteCalls = 0;

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await dispatchWorkflowTaskToAgent({
    workflowRuntime: {
      async getSessionMessages() {
        return { messages: [{ id: "existing-msg" }] };
      },
      async deleteSession() {
        deleteCalls += 1;
      },
      async run() {
        return { runId: "run-same-role-1" };
      },
    },
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    requesterChannel: "discord",
    fromRole: "researcher",
    toRole: "researcher",
    projectRoot,
    projectId: "demo-project",
    stage: "research",
    summary: "Continue the foreground researcher session.",
    requireMailboxAcknowledgement: false,
  });

  assert.equal(result.dispatched, true);
  assert.equal(result.sessionKey, "agent:researcher:discord:group:paper-lab");
  assert.equal(deleteCalls, 0);
});

test("dispatchWorkflowTaskToAgent records structured diagnostics with candidate resolution and final attempts", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-dispatch-diagnostics-")
  );

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await dispatchWorkflowTaskToAgent({
    workflowRuntime: {
      async run() {
        return { runId: "run-diagnostic-1" };
      },
    },
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    requesterChannel: "discord",
    fromRole: "researcher",
    toRole: "coder",
    projectRoot,
    projectId: "demo-project",
    stage: "code",
    summary: "Implement the current experiment plan.",
    command: "/implement-experiment",
    requireMailboxAcknowledgement: false,
  });

  assert.equal(result.dispatched, true);
  const diagnostics = await readWorkflowDiagnosticEvents(projectRoot);
  assert.ok(
    diagnostics.some(
      (event) =>
        event.component === "dispatch" &&
        event.action === "dispatch_candidates_resolved" &&
        Array.isArray(event.details?.candidates)
    )
  );
  assert.ok(
    diagnostics.some(
      (event) =>
        event.component === "dispatch" &&
        event.action === "dispatch_completed" &&
        Array.isArray(event.details?.attempts)
    )
  );
});

test("dispatchWorkflowTaskToAgent reuses an already active owner session instead of spawning a fallback", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-dispatch-already-active-")
  );

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(projectRoot, ".openclaw-research"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "demo-project",
        current_stage: "graph_build",
        owner_agent: "researcher",
        workflow_control: buildWorkflowControlContract({
          contractId: "wfctl_write_active",
          reconciledAt: "2026-04-14T02:00:00.000Z",
          stage: "write",
          owner: "academic_writer",
          nextAction: "/write-paper",
          status: "ready",
          completionStatus: "incomplete",
          completionSource: "write_completion",
          runtimeState: "active",
          sessionKey: "agent:academic_writer:discord:group:paper-lab",
        }),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, ".openclaw-research", "workflow-runtime-sessions.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: "2026-04-14T02:00:00.000Z",
        projectId: "demo-project",
        projectRoot,
        entries: [
          {
            sessionKey: "agent:academic_writer:discord:group:paper-lab",
            role: "academic_writer",
            agentId: "academic_writer",
            ownerAgent: "academic_writer",
            family: "write",
            kind: "workflow_stage_dispatch",
            projectRoot,
            status: "active",
            startedAt: "2026-04-14T02:00:00.000Z",
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, ".openclaw-research", "workflow-agent-sessions.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: "2026-04-14T02:00:00.000Z",
        entries: [
          {
            role: "academic_writer",
            sessionKey: "agent:academic_writer:discord:group:paper-lab",
            sessionId: null,
            projectId: "demo-project",
            projectRoot,
            currentStage: "write",
            status: "active",
            source: "workflow_tool",
            updatedAt: "2026-04-14T02:00:00.000Z",
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  let runCalls = 0;
  const result = await dispatchWorkflowTaskToAgent({
    workflowRuntime: {
      async run() {
        runCalls += 1;
        throw new Error("should not dispatch a new writer run");
      },
    },
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    requesterChannel: "discord",
    fromRole: "researcher",
    toRole: "academic_writer",
    projectRoot,
    projectId: "demo-project",
    stage: "write",
    summary: "Continue the active write stage.",
    requireMailboxAcknowledgement: false,
  });

  assert.equal(result.dispatched, true);
  assert.equal(result.strategy, "already_active");
  assert.equal(result.sessionKey, "agent:academic_writer:discord:group:paper-lab");
  assert.equal(result.runId, null);
  assert.equal(runCalls, 0);
});

test("dispatchWorkflowTaskToAgent ignores a preferred owner session after runtime repair", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-dispatch-repaired-session-")
  );

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const sessionKey = "agent:academic_writer:discord:group:paper-lab";
  await fs.mkdir(path.join(projectRoot, ".openclaw-research"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "demo-project",
        current_stage: "write",
        owner_agent: "academic_writer",
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, ".openclaw-research", "workflow-runtime-sessions.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: "2026-04-14T02:00:00.000Z",
        projectId: "demo-project",
        projectRoot,
        entries: [
          {
            sessionKey,
            role: "academic_writer",
            agentId: "academic_writer",
            ownerAgent: "academic_writer",
            family: "write",
            kind: "workflow_stage_dispatch",
            projectRoot,
            status: "needs_repair",
            startedAt: "2026-04-14T02:00:00.000Z",
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, ".openclaw-research", "workflow-agent-sessions.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: "2026-04-14T02:00:00.000Z",
        entries: [
          {
            role: "academic_writer",
            sessionKey,
            sessionId: null,
            projectId: "demo-project",
            projectRoot,
            currentStage: "write",
            status: "active",
            source: "workflow_tool",
            updatedAt: "2026-04-14T02:00:00.000Z",
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const calls = [];
  const result = await dispatchWorkflowTaskToAgent({
    workflowRuntime: {
      async run(params) {
        calls.push(params);
        return { runId: "run-after-repair" };
      },
    },
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    requesterChannel: "discord",
    fromRole: "researcher",
    toRole: "academic_writer",
    projectRoot,
    projectId: "demo-project",
    stage: "write",
    summary: "Continue the write stage after repairing the stale session.",
    requireMailboxAcknowledgement: false,
  });

  assert.equal(result.dispatched, true);
  assert.equal(result.strategy, "direct_session");
  assert.equal(result.sessionKey, sessionKey);
  assert.equal(result.runId, "run-after-repair");
  assert.equal(calls.length, 1);
});

test("dispatchWorkflowTaskToAgent materializes overlong commands into exec packets", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-dispatch-exec-packet-")
  );
  const calls = [];

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const longCommand = `python3 scripts/do_work.py --payload ${"x".repeat(2200)}`;
  const result = await dispatchWorkflowTaskToAgent({
    workflowRuntime: {
      async run(params) {
        calls.push(params);
        return { runId: "run-long-command" };
      },
    },
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    requesterChannel: "discord",
    fromRole: "researcher",
    toRole: "coder",
    projectRoot,
    projectId: "demo-project",
    stage: "code",
    summary: "Run a long command safely.",
    command: longCommand,
    requireMailboxAcknowledgement: false,
  });

  assert.equal(result.dispatched, true);
  assert.match(calls[0].message, /file-backed exec packet/i);
  assert.doesNotMatch(calls[0].message, /x{500}/);

  const packetDir = path.join(projectRoot, ".openclaw-research", "exec-packets");
  const files = await fs.readdir(packetDir);
  assert.ok(files.some((entry) => entry.endsWith(".json")));
  assert.ok(files.some((entry) => entry.endsWith(".sh")));
});

test("dispatchWorkflowTaskToAgent retries alternate direct session candidates before giving up", async () => {
  const calls = [];
  const result = await dispatchWorkflowTaskToAgent({
    workflowRuntime: {
      async run(params) {
        calls.push(params.sessionKey);
        if (params.sessionKey === "agent:coder:discord:group:paper-lab:thread:idea-1") {
          throw new Error("thread-bound target unavailable");
        }
        return { runId: "run-2" };
      },
    },
    requesterSessionKey: "agent:researcher:discord:group:paper-lab:thread:idea-1",
    requesterChannel: "discord",
    fromRole: "researcher",
    toRole: "coder",
    projectRoot: "/tmp/demo-project",
    projectId: "demo-project",
    summary: "Retry dispatch.",
    requireMailboxAcknowledgement: false,
  });

  assert.equal(result.dispatched, true);
  assert.equal(result.sessionKey, "agent:coder:discord:group:paper-lab");
  assert.equal(result.channel, "sessions_send");
  assert.equal(result.strategy, "alternate_session");
  assert.deepEqual(calls, [
    "agent:coder:discord:group:paper-lab:thread:idea-1",
    "agent:coder:discord:group:paper-lab",
  ]);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].dispatched, false);
  assert.equal(result.attempts[1].dispatched, true);
});

test("dispatchWorkflowTaskToAgent falls back to a spawned session when direct delivery fails", async () => {
  const calls = [];
  const result = await dispatchWorkflowTaskToAgent({
    workflowRuntime: {
      async run(params) {
        calls.push(params.sessionKey);
        if (!params.sessionKey.includes(":subagent:")) {
          throw new Error("direct session unavailable");
        }
        return { runId: "run-spawn" };
      },
    },
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    requesterChannel: "discord",
    fromRole: "researcher",
    toRole: "coder",
    projectRoot: "/tmp/demo-project",
    projectId: "demo-project",
    summary: "Spawn fallback dispatch.",
    requireMailboxAcknowledgement: false,
  });

  assert.equal(result.dispatched, true);
  assert.equal(result.channel, "sessions_spawn");
  assert.equal(result.strategy, "spawn_fallback");
  assert.equal(result.fallbackSpawned, true);
  assert.match(result.sessionKey ?? "", /^agent:coder:subagent:/);
  assert.equal(result.attempts.at(-1)?.strategy, "spawn_fallback");
  assert.equal(calls.length, 3);
});

test("dispatchWorkflowTaskToAgent skips tainted persisted session state and spawns a fresh fallback", async () => {
  const calls = [];
  const result = await dispatchWorkflowTaskToAgent({
    workflowRuntime: {
      async inspectSession(params) {
        if (params.sessionKey === "agent:coder:discord:group:paper-lab") {
          return {
            sessionKey: params.sessionKey,
            sessionId: "workflow.coder.old123",
            sessionFile: "/tmp/old-coder-session.jsonl",
            status: "failed",
            startedAt: 100,
            endedAt: 200,
            updatedAt: 300,
            abortedLastRun: false,
            providerOverride: "qwen",
            modelOverride: "qwen3.6-plus",
            liveModelSwitchPending: true,
          };
        }
        return null;
      },
      async run(params) {
        calls.push(params.sessionKey);
        return { runId: "run-fresh-fallback" };
      },
    },
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    requesterChannel: "discord",
    fromRole: "researcher",
    toRole: "coder",
    projectRoot: "/tmp/demo-project",
    projectId: "demo-project",
    summary: "Dispatch with tainted prior session state.",
    requireMailboxAcknowledgement: false,
  });

  assert.equal(result.dispatched, true);
  assert.notEqual(result.sessionKey, "agent:coder:discord:group:paper-lab");
  assert.ok(
    result.attempts.some(
      (attempt) =>
        attempt.sessionKey === "agent:coder:discord:group:paper-lab" &&
        attempt.error === "session_liveness_probe:tainted_session_state"
    )
  );
});

test("dispatchWorkflowTaskToAgent skips persisted openai override session state", async () => {
  const calls = [];
  const result = await dispatchWorkflowTaskToAgent({
    workflowRuntime: {
      async inspectSession(params) {
        if (params.sessionKey === "agent:coder:discord:group:paper-lab") {
          return {
            sessionKey: params.sessionKey,
            sessionId: "workflow.coder.openai123",
            sessionFile: "/tmp/openai-coder-session.jsonl",
            status: "failed",
            startedAt: 100,
            endedAt: 200,
            updatedAt: 300,
            abortedLastRun: false,
            providerOverride: "openai",
            modelOverride: "gpt-5.4",
            liveModelSwitchPending: false,
          };
        }
        return null;
      },
      async run(params) {
        calls.push(params.sessionKey);
        return { runId: "run-openai-fallback" };
      },
    },
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    requesterChannel: "discord",
    fromRole: "researcher",
    toRole: "coder",
    projectRoot: "/tmp/demo-project",
    projectId: "demo-project",
    summary: "Dispatch with openai-tainted prior session state.",
    requireMailboxAcknowledgement: false,
  });

  assert.equal(result.dispatched, true);
  assert.notEqual(result.sessionKey, "agent:coder:discord:group:paper-lab");
  assert.ok(
    result.attempts.some(
      (attempt) =>
        attempt.sessionKey === "agent:coder:discord:group:paper-lab" &&
        attempt.error === "session_liveness_probe:tainted_session_state"
    )
  );
  assert.ok(calls.length >= 1);
});

test("dispatchWorkflowTaskToAgent avoids stale same-role capability records", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-dispatch-capability-")
  );
  const calls = [];

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await upsertWorkflowAgentCapability({
    projectRoot,
    sessionKey: "agent:coder:discord:group:paper-lab",
    role: "coder",
    canUseResearchWorkflow: true,
    confidence: "high",
  });
  await downgradeWorkflowAgentCapability({
    projectRoot,
    sessionKey: "agent:coder:discord:group:paper-lab",
    reason: "research_workflow unavailable",
  });

  const result = await dispatchWorkflowTaskToAgent({
    workflowRuntime: {
      async run(params) {
        calls.push(params.sessionKey);
        return { runId: "spawn-after-stale-capability" };
      },
    },
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    requesterChannel: "discord",
    fromRole: "researcher",
    toRole: "coder",
    projectRoot,
    projectId: "demo-project",
    summary: "Dispatch with stale capability.",
    requireMailboxAcknowledgement: false,
  });

  assert.equal(result.dispatched, true);
  assert.equal(result.channel, "sessions_spawn");
  assert.match(result.sessionKey ?? "", /^agent:coder:subagent:/);
  assert.deepEqual(calls, [result.sessionKey]);
});

test("dispatchWorkflowTaskToAgent retries timeout only when requested and transcript did not advance", async () => {
  const calls = [];
  const counts = new Map();
  const result = await dispatchWorkflowTaskToAgent({
    workflowRuntime: {
      async run(params) {
        calls.push(params.sessionKey);
        counts.set(params.sessionKey, (counts.get(params.sessionKey) ?? 0) + 1);
        return { runId: `run-${calls.length}` };
      },
      async waitForRun() {
        return { status: "timeout" };
      },
      async getSessionMessages(params) {
        const count = counts.get(params.sessionKey) ?? 0;
        return { messages: Array.from({ length: count > 0 ? 1 : 0 }, (_, i) => ({ id: i })) };
      },
    },
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    requesterChannel: "discord",
    fromRole: "researcher",
    toRole: "coder",
    projectRoot: "/tmp/demo-project",
    projectId: "demo-project",
    summary: "Timeout retry dispatch.",
    waitTimeoutMs: 2000,
    retryOnTimeout: true,
    requireMailboxAcknowledgement: false,
  });

  assert.equal(result.dispatched, true);
  assert.equal(result.channel, "sessions_send");
  assert.equal(calls.length, 1);
  assert.equal(result.attempts[0].acceptedByMailbox, false);
  assert.equal(result.attempts[0].acceptedByTranscript, true);
});

test("dispatchWorkflowTaskToAgent waits for workflow mailbox acknowledgement when a mailbox handoff exists", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-dispatch-mailbox-")
  );
  const mailboxPath = path.join(projectRoot, ".openclaw-research", "workflow-mailbox.json");

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.dirname(mailboxPath), { recursive: true });
  await fs.writeFile(
    mailboxPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: "2026-04-10T10:00:00.000Z",
        messages: [
          {
            id: "msg-ack-1",
            fromAgent: "researcher",
            toAgent: "coder",
            subject: "auto-iterator: code owner handoff",
            body: "Please resume code stage.",
            kind: "handoff",
            priority: "high",
            status: "pending",
            createdAt: "2026-04-10T10:00:00.000Z",
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const result = await dispatchWorkflowTaskToAgent({
    workflowRuntime: {
      async run() {
        setTimeout(async () => {
          const mailbox = JSON.parse(await fs.readFile(mailboxPath, "utf8"));
          mailbox.messages[0].status = "acknowledged";
          mailbox.messages[0].acknowledgedAt = "2026-04-10T10:00:01.000Z";
          await fs.writeFile(mailboxPath, `${JSON.stringify(mailbox, null, 2)}\n`, "utf8");
        }, 50);
        return { runId: "run-mailbox-1" };
      },
    },
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    requesterChannel: "discord",
    fromRole: "researcher",
    toRole: "coder",
    projectRoot,
    projectId: "demo-project",
    stage: "code",
    summary: "Continue the code stage.",
    mailboxMessageId: "msg-ack-1",
    waitTimeoutMs: 2000,
    retryOnTimeout: true,
  });

  assert.equal(result.dispatched, true);
  assert.equal(result.acknowledgedByMailbox, true);
  assert.equal(result.attempts[0].acceptedByMailbox, true);
  assert.equal(result.attempts[0].acceptedByTranscript, false);
});

test("dispatchWorkflowTaskToAgent accepts transcript progress after mailbox ack timeout", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-dispatch-mailbox-transcript-")
  );
  const calls = [];
  const counts = new Map();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await dispatchWorkflowTaskToAgent({
    workflowRuntime: {
      async run(params) {
        calls.push(params.sessionKey);
        counts.set(params.sessionKey, (counts.get(params.sessionKey) ?? 0) + 1);
        return { runId: "run-mailbox-transcript-1" };
      },
      async waitForRun() {
        return { status: "timeout" };
      },
      async getSessionMessages(params) {
        const count = counts.get(params.sessionKey) ?? 0;
        return {
          messages: Array.from({ length: count > 0 ? 1 : 0 }, (_, i) => ({ id: i })),
        };
      },
    },
    requesterSessionKey: "agent:researcher:local:conversation:e2e",
    requesterChannel: "local",
    fromRole: "researcher",
    toRole: "coder",
    projectRoot,
    projectId: "demo-project",
    stage: "code",
    summary: "Continue the code stage.",
    mailboxMessageId: "msg-timeout-1",
    waitTimeoutMs: 25,
    retryOnTimeout: true,
  });

  assert.equal(result.dispatched, true);
  assert.equal(result.acknowledgedByMailbox, false);
  assert.equal(result.waitStatus, "timeout");
  assert.equal(result.attempts[0].acceptedByMailbox, false);
  assert.equal(result.attempts[0].acceptedByTranscript, true);
  assert.equal(calls.length, 1);
});

test("dispatchWorkflowTaskToAgent treats a started run as dispatched even before mailbox acknowledgement lands", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-dispatch-mailbox-pending-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await dispatchWorkflowTaskToAgent({
    workflowRuntime: {
      async run() {
        return { runId: "run-mailbox-pending-1" };
      },
    },
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    requesterChannel: "discord",
    fromRole: "researcher",
    toRole: "coder",
    projectRoot,
    projectId: "demo-project",
    stage: "code",
    summary: "Continue the code stage.",
    mailboxMessageId: "msg-pending-1",
    waitTimeoutMs: 2000,
    retryOnTimeout: true,
  });

  assert.equal(result.dispatched, true);
  assert.equal(result.acknowledgedByMailbox, false);
  assert.equal(result.attempts[0].acceptedByMailbox, false);
  assert.equal(result.attempts[0].error, null);
});

test("dispatchWorkflowTaskToAgent accepts a spawned fallback run when mailbox ack times out", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-dispatch-spawn-pending-")
  );
  const calls = [];

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await dispatchWorkflowTaskToAgent({
    workflowRuntime: {
      async run(params) {
        calls.push(params.sessionKey);
        if (!params.sessionKey.includes(":subagent:")) {
          throw new Error("direct session unavailable");
        }
        return { runId: "run-spawn-pending-1" };
      },
      async waitForRun() {
        return { status: "timeout" };
      },
      async getSessionMessages() {
        return { messages: [] };
      },
    },
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    requesterChannel: "discord",
    fromRole: "researcher",
    toRole: "coder",
    projectRoot,
    projectId: "demo-project",
    stage: "code",
    summary: "Continue the code stage.",
    mailboxMessageId: "msg-spawn-pending-1",
    waitTimeoutMs: 25,
    retryOnTimeout: true,
  });

  assert.equal(result.dispatched, true);
  assert.equal(result.channel, "sessions_spawn");
  assert.equal(result.strategy, "spawn_fallback");
  assert.equal(result.runId, "run-spawn-pending-1");
  assert.equal(result.waitStatus, "timeout");
  assert.equal(result.acknowledgedByMailbox, false);
  assert.equal(result.error, null);
  assert.equal(result.attempts.at(-1)?.acceptedByMailbox, false);
  assert.equal(result.attempts.at(-1)?.acceptedByTranscript, false);
  assert.equal(calls.length, 2);
});

test("dispatchWorkflowTaskToAgent reports a runtime error when subagent runtime is unavailable", async () => {
  const result = await dispatchWorkflowTaskToAgent({
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    requesterChannel: "discord",
    fromRole: "researcher",
    toRole: "coder",
    projectRoot: "/tmp/demo-project",
    summary: "Fallback dispatch test.",
    requireMailboxAcknowledgement: false,
  });

  assert.equal(result.dispatched, false);
  assert.equal(result.channel, null);
  assert.match(result.error ?? "", /unavailable/i);
});

test("dispatchWorkflowTaskToAgent prefers a dedicated subagent session for PaperNexus-heavy commands", async () => {
  const calls = [];
  const result = await dispatchWorkflowTaskToAgent({
    workflowRuntime: {
      async run(params) {
        calls.push(params);
        return { runId: "run-papernexus-1" };
      },
    },
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    requesterChannel: "discord",
    fromRole: "researcher",
    toRole: "analyzer",
    projectRoot: "/tmp/demo-project",
    projectId: "demo-project",
    stage: "frontier_mapping",
    summary: "Run PaperNexus reflection over the current frontier pack.",
    command: "/papernexus-reflection",
    requireMailboxAcknowledgement: false,
  });

  assert.equal(result.dispatched, true);
  assert.match(
    result.sessionKey ?? "",
    /^agent:analyzer:discord:group:paper-lab:subagent:papernexus-skill:/
  );
  assert.doesNotMatch(result.sessionKey ?? "", /:demo-project\b/);
  assert.equal(calls.length, 1);
  assert.match(
    calls[0].sessionKey,
    /^agent:analyzer:discord:group:paper-lab:subagent:papernexus-skill:/
  );
  assert.doesNotMatch(calls[0].sessionKey, /:demo-project\b/);
});

test("dispatchWorkflowTaskToAgent treats remote typed PaperNexus brief calls as heavy work", async () => {
  const calls = [];
  const result = await dispatchWorkflowTaskToAgent({
    workflowRuntime: {
      async run(params) {
        calls.push(params);
        return { runId: "run-papernexus-typed-1" };
      },
    },
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    requesterChannel: "discord",
    fromRole: "researcher",
    toRole: "researcher",
    projectRoot: "/tmp/demo-project",
    projectId: "demo-project",
    stage: "frontier_mapping",
    summary: "Run a typed brainstorm brief against the shared graph.",
    command:
      "curl -X POST https://papernexus.example/api/brainstorm-brief -H 'Authorization: Bearer $PAPERNEXUS_API_TOKEN'",
    requireMailboxAcknowledgement: false,
  });

  assert.equal(result.dispatched, true);
  assert.match(
    result.sessionKey ?? "",
    /^agent:researcher:discord:group:paper-lab:subagent:papernexus-skill:brainstorm-brief/
  );
  assert.doesNotMatch(result.sessionKey ?? "", /:demo-project\b/);
  assert.equal(calls.length, 1);
  assert.match(
    calls[0].sessionKey,
    /^agent:researcher:discord:group:paper-lab:subagent:papernexus-skill:brainstorm-brief/
  );
  assert.doesNotMatch(calls[0].sessionKey, /:demo-project\b/);
});

test("dispatchWorkflowTaskToAgent treats wrapper-based PaperNexus chains as heavy work", async () => {
  const calls = [];
  const result = await dispatchWorkflowTaskToAgent({
    workflowRuntime: {
      async run(params) {
        calls.push(params);
        return { runId: "run-papernexus-wrapper-1" };
      },
    },
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    requesterChannel: "discord",
    fromRole: "researcher",
    toRole: "researcher",
    projectRoot: "/tmp/demo-project",
    projectId: "demo-project",
    stage: "frontier_mapping",
    summary: "Run wrapper-based evidence chain against the shared graph.",
    command:
      'python3 scripts/pn_research_chains.py --api-base "https://papernexus.example/api" --corpus "demo" evidence-chain "topic" --limit 5',
    requireMailboxAcknowledgement: false,
  });

  assert.equal(result.dispatched, true);
  assert.match(
    result.sessionKey ?? "",
    /^agent:researcher:discord:group:paper-lab:subagent:papernexus-skill:evidence-chain/
  );
  assert.doesNotMatch(result.sessionKey ?? "", /:demo-project\b/);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].sessionKey, /:demo-project\b/);
});
