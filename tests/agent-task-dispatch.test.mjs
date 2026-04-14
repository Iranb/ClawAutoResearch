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
} from "../tools/agent-task-dispatch.ts";
import {
  downgradeWorkflowAgentCapability,
  upsertWorkflowAgentCapability,
} from "../tools/workflow-handoff/agent-capabilities.ts";

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
    runtimeSubagent: {
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
            sessionKey: "agent:academic_writer:discord:group:paper-lab",
            role: "academic_writer",
            agentId: "academic_writer",
            ownerAgent: "academic_writer",
            projectRoot,
            status: "active",
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
    runtimeSubagent: {
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
    runtimeSubagent: {
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
    runtimeSubagent: {
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
    runtimeSubagent: {
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
    runtimeSubagent: {
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
    runtimeSubagent: {
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
    runtimeSubagent: {
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
    runtimeSubagent: {
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
    runtimeSubagent: {
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
    runtimeSubagent: {
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
