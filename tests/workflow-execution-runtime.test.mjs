import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createWorkflowExecutionRuntimeFromApi } from "../tools/workflow-execution-runtime.ts";

function createEmbeddedRuntimeHarness(rootDir) {
  const sessionStores = new Map();

  const resolveStorePath = (_store, opts = {}) =>
    path.join(rootDir, "agents", opts.agentId ?? "main", "sessions", "sessions.json");

  const resolveSessionFilePath = (sessionId, entry, opts = {}) =>
    entry?.sessionFile ??
    path.join(opts.sessionsDir ?? path.join(rootDir, "agents", opts.agentId ?? "main", "sessions"), `${sessionId}.jsonl`);

  const api = {
    config: {
      session: {
        store: path.join(rootDir, "agents", "{agentId}", "sessions", "sessions.json"),
      },
    },
    runtime: {
      agent: {
        async runEmbeddedAgent(params) {
          const storePath = resolveStorePath(undefined, { agentId: params.agentId });
          const sessionFile = resolveSessionFilePath(
            params.sessionId,
            undefined,
            {
              agentId: params.agentId,
              sessionsDir: path.dirname(storePath),
            }
          );
          await fs.mkdir(path.dirname(sessionFile), { recursive: true });
          const store = sessionStores.get(storePath) ?? {};
          store[params.sessionKey] = {
            sessionId: params.sessionId,
            sessionFile,
          };
          sessionStores.set(storePath, store);
          await fs.writeFile(
            sessionFile,
            [
              JSON.stringify({ type: "session", id: params.sessionId }),
              JSON.stringify({
                message: {
                  role: "assistant",
                  content: [
                    {
                      type: "text",
                      text: `Embedded workflow completed: ${params.prompt}`,
                    },
                  ],
                },
              }),
            ].join("\n") + "\n",
            "utf8"
          );
          return {
            ok: true,
          };
        },
        resolveAgentDir(_cfg, agentId) {
          return path.join(rootDir, "agents", agentId ?? "main", "agent");
        },
        resolveAgentWorkspaceDir(_cfg, agentId) {
          return path.join(rootDir, "workspace", agentId ?? "main");
        },
        resolveAgentTimeoutMs() {
          return 5_000;
        },
        session: {
          resolveStorePath,
          loadSessionStore(storePath) {
            return sessionStores.get(storePath) ?? {};
          },
          async saveSessionStore(storePath, store) {
            sessionStores.set(storePath, { ...store });
          },
          resolveSessionFilePath,
        },
      },
    },
    logger: {
      debug() {},
      warn() {},
    },
  };

  return { api, sessionStores };
}

test("embedded workflow runtime launches local agent runs and reads transcript state", async (t) => {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-workflow-runtime-")
  );
  t.after(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  const harness = createEmbeddedRuntimeHarness(rootDir);
  const runtime = createWorkflowExecutionRuntimeFromApi({
    api: harness.api,
    defaultWorkspaceDir: rootDir,
    defaultAgentId: "researcher",
    defaultMessageChannel: "discord",
  });

  assert.ok(runtime);
  assert.equal(runtime.runtimeKind, "embedded_agent");

  const started = await runtime.run({
    sessionKey: "agent:researcher:discord:group:paper-room",
    requesterSessionKey: "agent:researcher:discord:group:paper-room",
    message: "Run /graph-build for the current project.",
    projectRoot: rootDir,
    ownerAgent: "researcher",
  });

  assert.ok(started.runId);
  assert.match(started.sessionId ?? "", /^workflow\.researcher\.[a-f0-9]{24}$/);
  assert.equal(started.runtime, "embedded_agent");

  const waited = await runtime.waitForRun({
    runId: started.runId,
    timeoutMs: 500,
  });
  assert.equal(waited.status, "ok");

  const transcript = await runtime.getSessionMessages({
    sessionKey: "agent:researcher:discord:group:paper-room",
    limit: 5,
  });
  assert.equal(Array.isArray(transcript.messages), true);
  assert.match(
    JSON.stringify(transcript.messages),
    /Embedded workflow completed: Run \/graph-build/
  );

  await runtime.deleteSession({
    sessionKey: "agent:researcher:discord:group:paper-room",
    deleteTranscript: true,
  });

  const storePath = path.join(
    rootDir,
    "agents",
    "researcher",
    "sessions",
    "sessions.json"
  );
  assert.deepEqual(harness.sessionStores.get(storePath) ?? {}, {});
});

test("embedded workflow runtime can inspect persisted session metadata", async (t) => {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-workflow-runtime-inspect-")
  );
  t.after(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  const harness = createEmbeddedRuntimeHarness(rootDir);
  const runtime = createWorkflowExecutionRuntimeFromApi({
    api: harness.api,
    defaultWorkspaceDir: rootDir,
    defaultAgentId: "researcher",
    defaultMessageChannel: "discord",
  });

  const storePath = path.join(
    rootDir,
    "agents",
    "researcher",
    "sessions",
    "sessions.json"
  );
  harness.sessionStores.set(storePath, {
    "agent:researcher:discord:group:paper-room:subagent:workflow-research-pipeline:demo": {
      sessionId: "workflow.researcher.demo123",
      sessionFile: path.join(
        rootDir,
        "agents",
        "researcher",
        "sessions",
        "workflow.researcher.demo123.jsonl"
      ),
      status: "failed",
      startedAt: 100,
      endedAt: 200,
      updatedAt: 300,
      abortedLastRun: false,
      providerOverride: "qwen",
      modelOverride: "qwen3.6-plus",
      liveModelSwitchPending: true,
    },
  });

  const inspection = await runtime.inspectSession({
    sessionKey:
      "agent:researcher:discord:group:paper-room:subagent:workflow-research-pipeline:demo",
  });

  assert.deepEqual(inspection, {
    sessionKey:
      "agent:researcher:discord:group:paper-room:subagent:workflow-research-pipeline:demo",
    sessionId: "workflow.researcher.demo123",
    sessionFile: path.join(
      rootDir,
      "agents",
      "researcher",
      "sessions",
      "workflow.researcher.demo123.jsonl"
    ),
    status: "failed",
    startedAt: 100,
    endedAt: 200,
    updatedAt: 300,
    abortedLastRun: false,
    providerOverride: "qwen",
    modelOverride: "qwen3.6-plus",
    liveModelSwitchPending: true,
  });
});
