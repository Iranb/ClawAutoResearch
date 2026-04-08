import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkflowDispatchMessage,
  deriveAgentSessionKeyForRole,
  deriveWorkflowDispatchSessionCandidates,
  dispatchWorkflowTaskToAgent,
} from "../tools/agent-task-dispatch.ts";

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
  assert.match(message, /@reviewer only if an immediate wake-up is required/i);
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
  });

  assert.equal(result.dispatched, true);
  assert.equal(result.channel, "sessions_spawn");
  assert.equal(result.strategy, "spawn_fallback");
  assert.equal(result.fallbackSpawned, true);
  assert.match(result.sessionKey ?? "", /^agent:coder:subagent:/);
  assert.equal(result.attempts.at(-1)?.strategy, "spawn_fallback");
  assert.equal(calls.length, 3);
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
  });

  assert.equal(result.dispatched, true);
  assert.equal(result.channel, "sessions_send");
  assert.equal(calls.length, 1);
  assert.equal(result.attempts[0].acceptedByTranscript, true);
});

test("dispatchWorkflowTaskToAgent reports a runtime error when subagent runtime is unavailable", async () => {
  const result = await dispatchWorkflowTaskToAgent({
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    requesterChannel: "discord",
    fromRole: "researcher",
    toRole: "coder",
    projectRoot: "/tmp/demo-project",
    summary: "Fallback dispatch test.",
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
