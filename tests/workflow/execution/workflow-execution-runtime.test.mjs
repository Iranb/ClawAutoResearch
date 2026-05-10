import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createWorkflowExecutionRuntimeFromApi } from "../../../tools/workflow-execution-runtime.ts";

function createEmbeddedRuntimeHarness(rootDir, options = {}) {
  const sessionStores = new Map();
  const embeddedRuns = [];

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
      ...(options.config ?? {}),
    },
    runtime: {
      agent: {
        async runEmbeddedAgent(params) {
          embeddedRuns.push({ ...params });
          if (typeof options.runEmbeddedAgent === "function") {
            return options.runEmbeddedAgent(params, {
              sessionStores,
              resolveStorePath,
              resolveSessionFilePath,
            });
          }
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

  return { api, sessionStores, embeddedRuns };
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

test("embedded workflow runtime treats already-active synthetic run ids as non-terminal", async (t) => {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-workflow-runtime-already-active-")
  );
  t.after(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  const harness = createEmbeddedRuntimeHarness(rootDir);
  const runtime = createWorkflowExecutionRuntimeFromApi({
    api: harness.api,
    defaultWorkspaceDir: rootDir,
    defaultAgentId: "researcher",
    defaultMessageChannel: "local",
  });

  const waited = await runtime.waitForRun({
    runId: "already-active:abc123",
    timeoutMs: 1,
  });

  assert.equal(waited.status, "timeout");
});

test("embedded workflow runtime passes the configured agent primary model to embedded runs", async (t) => {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-workflow-runtime-model-")
  );
  t.after(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  const harness = createEmbeddedRuntimeHarness(rootDir, {
    config: {
      agents: {
        defaults: {
          model: {
            primary: "openai/gpt-5.4",
          },
        },
        list: [
          {
            id: "researcher",
            model: {
              primary: "bailian/qwen3.6-plus",
            },
          },
        ],
      },
    },
  });
  const runtime = createWorkflowExecutionRuntimeFromApi({
    api: harness.api,
    defaultWorkspaceDir: rootDir,
    defaultAgentId: "researcher",
    defaultMessageChannel: "local",
  });

  await runtime.run({
    sessionKey: "agent:researcher:local:group:model-room",
    message: "Run /graph-build for the current project.",
    ownerAgent: "researcher",
  });

  assert.equal(harness.embeddedRuns[0]?.provider, "bailian");
  assert.equal(harness.embeddedRuns[0]?.model, "qwen3.6-plus");
});

test("embedded workflow runtime falls back to configured model on provider capacity failure", async (t) => {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-workflow-runtime-model-fallback-")
  );
  t.after(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  let attempts = 0;
  const harness = createEmbeddedRuntimeHarness(rootDir, {
    config: {
      agents: {
        defaults: {
          model: {
            primary: "bailian/qwen3.6-plus",
            fallbacks: ["bailian/qwen3.5-plus"],
          },
        },
      },
    },
    async runEmbeddedAgent(params, helpers) {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("429 usage allocated quota exceeded. please try again later.");
      }
      const storePath = helpers.resolveStorePath(undefined, {
        agentId: params.agentId,
      });
      const sessionFile = helpers.resolveSessionFilePath(params.sessionId, undefined, {
        agentId: params.agentId,
        sessionsDir: path.dirname(storePath),
      });
      await fs.mkdir(path.dirname(sessionFile), { recursive: true });
      helpers.sessionStores.set(storePath, {
        [params.sessionKey]: {
          sessionId: params.sessionId,
          sessionFile,
          status: "completed",
        },
      });
      await fs.writeFile(sessionFile, "", "utf8");
      return { ok: true };
    },
  });
  const runtime = createWorkflowExecutionRuntimeFromApi({
    api: harness.api,
    defaultWorkspaceDir: rootDir,
    defaultAgentId: "researcher",
    defaultMessageChannel: "local",
  });

  const started = await runtime.run({
    sessionKey: "agent:researcher:local:group:model-fallback-room",
    message: "Run /graph-build for the current project.",
    ownerAgent: "researcher",
  });
  const waited = await runtime.waitForRun({
    runId: started.runId,
    timeoutMs: 500,
  });

  assert.equal(waited.status, "ok");
  assert.equal(harness.embeddedRuns.length, 2);
  assert.equal(harness.embeddedRuns[0]?.model, "qwen3.6-plus");
  assert.equal(harness.embeddedRuns[1]?.model, "qwen3.5-plus");
});

test("embedded workflow runtime keeps default fallbacks when an agent declares no fallbacks", async (t) => {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-workflow-runtime-default-fallback-")
  );
  t.after(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  let attempts = 0;
  const harness = createEmbeddedRuntimeHarness(rootDir, {
    config: {
      agents: {
        defaults: {
          model: {
            primary: "bailian/qwen3.6-plus",
            fallbacks: ["bailian/qwen3.5-plus"],
          },
        },
        list: [
          {
            id: "researcher",
            model: {
              primary: "bailian/qwen3.6-plus",
              fallbacks: [],
            },
          },
        ],
      },
    },
    async runEmbeddedAgent() {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("429 usage allocated quota exceeded. please try again later.");
      }
      return { ok: true };
    },
  });
  const runtime = createWorkflowExecutionRuntimeFromApi({
    api: harness.api,
    defaultWorkspaceDir: rootDir,
    defaultAgentId: "researcher",
    defaultMessageChannel: "local",
  });

  const started = await runtime.run({
    sessionKey: "agent:researcher:local:group:default-fallback-room",
    message: "Run /graph-build for the current project.",
    ownerAgent: "researcher",
  });
  const waited = await runtime.waitForRun({
    runId: started.runId,
    timeoutMs: 500,
  });

  assert.equal(waited.status, "ok");
  assert.equal(harness.embeddedRuns.length, 2);
  assert.equal(harness.embeddedRuns[0]?.model, "qwen3.6-plus");
  assert.equal(harness.embeddedRuns[1]?.model, "qwen3.5-plus");
  const firstRunAgentModel = harness.embeddedRuns[0]?.config?.agents?.list?.find(
    (entry) => entry?.id === "researcher"
  )?.model;
  assert.deepEqual(firstRunAgentModel?.fallbacks, ["bailian/qwen3.5-plus"]);
});

test("embedded workflow runtime appends fallbacks from the OpenClaw config file", async (t) => {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-workflow-runtime-external-config-")
  );
  const previousConfigPath = process.env.OPENCLAW_CONFIG_PATH;
  t.after(async () => {
    if (previousConfigPath == null) {
      delete process.env.OPENCLAW_CONFIG_PATH;
    } else {
      process.env.OPENCLAW_CONFIG_PATH = previousConfigPath;
    }
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  const externalConfigPath = path.join(rootDir, "openclaw.json");
  await fs.writeFile(
    externalConfigPath,
    `${JSON.stringify(
      {
        agents: {
          defaults: {
            model: {
              primary: "bailian/qwen3.6-plus",
              fallbacks: ["bailian/qwen3.5-plus"],
            },
          },
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  process.env.OPENCLAW_CONFIG_PATH = externalConfigPath;

  let attempts = 0;
  const harness = createEmbeddedRuntimeHarness(rootDir, {
    config: {
      agents: {
        defaults: {
          model: {
            primary: "bailian/qwen3.6-plus",
          },
        },
      },
    },
    async runEmbeddedAgent() {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("429 usage allocated quota exceeded. please try again later.");
      }
      return { ok: true };
    },
  });
  const runtime = createWorkflowExecutionRuntimeFromApi({
    api: harness.api,
    defaultWorkspaceDir: rootDir,
    defaultAgentId: "researcher",
    defaultMessageChannel: "local",
  });

  const started = await runtime.run({
    sessionKey: "agent:researcher:local:group:external-config-room",
    message: "Run /graph-build for the current project.",
    ownerAgent: "researcher",
  });
  const waited = await runtime.waitForRun({
    runId: started.runId,
    timeoutMs: 500,
  });

  assert.equal(waited.status, "ok");
  assert.equal(harness.embeddedRuns.length, 2);
  assert.equal(harness.embeddedRuns[1]?.model, "qwen3.5-plus");
});

test("embedded workflow runtime falls back when embedded runner returns an error payload", async (t) => {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-workflow-runtime-returned-error-")
  );
  t.after(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  let attempts = 0;
  const harness = createEmbeddedRuntimeHarness(rootDir, {
    config: {
      agents: {
        defaults: {
          model: {
            primary: "bailian/qwen3.6-plus",
            fallbacks: ["bailian/qwen3.5-plus"],
          },
        },
        list: [
          {
            id: "researcher",
            model: {
              primary: "bailian/qwen3.6-plus",
              fallbacks: [],
            },
          },
        ],
      },
    },
    async runEmbeddedAgent() {
      attempts += 1;
      if (attempts === 1) {
        return {
          payloads: [
            {
              isError: true,
              text: "⚠️ usage allocated quota exceeded. please try again later.",
            },
          ],
        };
      }
      return { ok: true };
    },
  });
  const runtime = createWorkflowExecutionRuntimeFromApi({
    api: harness.api,
    defaultWorkspaceDir: rootDir,
    defaultAgentId: "researcher",
    defaultMessageChannel: "local",
  });

  const started = await runtime.run({
    sessionKey: "agent:researcher:local:group:returned-error-room",
    message: "Run /graph-build for the current project.",
    ownerAgent: "researcher",
  });
  const waited = await runtime.waitForRun({
    runId: started.runId,
    timeoutMs: 500,
  });

  assert.equal(waited.status, "ok");
  assert.equal(harness.embeddedRuns.length, 2);
  assert.equal(harness.embeddedRuns[0]?.model, "qwen3.6-plus");
  assert.equal(harness.embeddedRuns[1]?.model, "qwen3.5-plus");
});

test("embedded workflow runtime exposes failed run error during session inspection", async (t) => {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-workflow-runtime-error-inspect-")
  );
  t.after(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  const harness = createEmbeddedRuntimeHarness(rootDir, {
    async runEmbeddedAgent() {
      throw new Error("429 usage allocated quota exceeded. please try again later.");
    },
  });
  const runtime = createWorkflowExecutionRuntimeFromApi({
    api: harness.api,
    defaultWorkspaceDir: rootDir,
    defaultAgentId: "researcher",
    defaultMessageChannel: "local",
  });
  const sessionKey = "agent:researcher:local:group:error-room";

  const started = await runtime.run({
    sessionKey,
    message: "Run /research-pipeline for the current project.",
    ownerAgent: "researcher",
  });
  const waited = await runtime.waitForRun({
    runId: started.runId,
    timeoutMs: 500,
  });
  assert.equal(waited.status, "error");

  const inspection = await runtime.inspectSession({ sessionKey });
  assert.equal(inspection?.status, "failed");
  assert.match(inspection?.lastError ?? "", /allocated quota exceeded/);
});

test("embedded workflow runtime reports in-memory active runs before session store persistence", async (t) => {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-workflow-runtime-active-inspect-")
  );
  t.after(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  let releaseRun;
  const runBlocked = new Promise((resolve) => {
    releaseRun = resolve;
  });
  const harness = createEmbeddedRuntimeHarness(rootDir, {
    async runEmbeddedAgent() {
      await runBlocked;
      return { ok: true };
    },
  });
  const runtime = createWorkflowExecutionRuntimeFromApi({
    api: harness.api,
    defaultWorkspaceDir: rootDir,
    defaultAgentId: "researcher",
    defaultMessageChannel: "local",
  });
  const sessionKey = "agent:researcher:local:group:active-room";

  const started = await runtime.run({
    sessionKey,
    message: "Run /research-pipeline for the current project.",
    ownerAgent: "researcher",
  });
  const inspection = await runtime.inspectSession({
    sessionKey,
  });

  assert.equal(inspection?.sessionKey, sessionKey);
  assert.equal(inspection?.sessionId, started.sessionId);
  assert.equal(inspection?.status, "running");
  assert.equal(typeof inspection?.startedAt, "number");
  assert.equal(inspection?.endedAt, null);

  releaseRun();
  const waited = await runtime.waitForRun({
    runId: started.runId,
    timeoutMs: 500,
  });
  assert.equal(waited.status, "ok");
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
    lastError: null,
  });
});
