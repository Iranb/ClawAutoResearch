import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH = path.join(
  os.tmpdir(),
  "openclaw-research-background-runs-workflow-fast-paths.json"
);
process.env.OPENCLAW_RESEARCH_BACKGROUND_QUEUE_PATH = path.join(
  os.tmpdir(),
  "openclaw-research-background-queue-workflow-fast-paths.json"
);

import {
  bindChannelProjectForWorkflow,
  ensureWorkflowProjectRoot,
  getChannelProjectBindingForWorkflow,
  getPaperIngestionStateSummary,
  setPaperIngestionState,
} from "../tools/workflow-guard.ts";
import {
  readWorkflowRuntimeEvents,
  readWorkflowRuntimeQueueStore,
  readWorkflowRuntimeSessionsStore,
  writeWorkflowRuntimeQueueStore,
} from "../tools/workflow-runtime-state.ts";
import {
  buildPapernexusWrapperCommand,
  buildPapernexusSkillBackgroundCommand,
  buildGraphBuildBackgroundCommand,
  buildLiteratureReviewBackgroundCommand,
  buildResearchPipelineBackgroundCommand,
  buildResearchQueueBackgroundCommand,
  buildSurveyReviewBackgroundCommand,
  buildZoteroSyncBackgroundCommand,
  clearBackgroundWorkflowQueueForTests,
  drainQueuedBackgroundWorkflowRuns,
  maybeTriggerQueuedPaperIngestionRequest,
  clearBackgroundWorkflowRunRegistryForTests,
  enqueueQueuedBackgroundWorkflowRun,
  hasPendingBackgroundWorkflowQueueKey,
  listBackgroundWorkflowRuns,
  pruneBackgroundWorkflowRuns,
  recordBackgroundWorkflowRun,
  retireBackgroundWorkflowRuns,
  startBackgroundWorkflowRun,
} from "../tools/workflow-fast-paths.ts";
import { createWorkflowExecutionRuntimeFromApi } from "../tools/workflow-execution-runtime.ts";
import { listWorkflowNotificationChannelsForProject } from "../tools/workflow-notification-channels.ts";

async function makeTempWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-fast-paths-"));
}

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeFakePapernexusBatchScript(scriptDir) {
  await fs.mkdir(scriptDir, { recursive: true });
  const scriptPath = path.join(scriptDir, "pn_batch_import.py");
  await fs.writeFile(
    scriptPath,
    [
      "#!/usr/bin/env python3",
      "import json, sys",
      "args = sys.argv[1:]",
      "def opt(name):",
      "    if name in args:",
      "        index = args.index(name)",
      "        return args[index + 1] if index + 1 < len(args) else None",
      "    prefix = name + '='",
      "    for arg in args:",
      "        if arg.startswith(prefix):",
      "            return arg[len(prefix):]",
      "    return None",
      "payload = {",
      "    'manifest': opt('--manifest'),",
      "    'corpus': opt('--corpus'),",
      "    'summary': {'total': 2, 'submitted': 2, 'completed': 2, 'running': 0, 'pending': 0, 'failed': 0, 'remaining': 0, 'overallPercent': 100},",
      "    'queueSummary': {'total': 2, 'pending': 0, 'running': 0, 'completed': 2, 'failed': 0, 'remaining': 0, 'overallPercent': 100},",
      "    'items': [",
      "        {'paperId': 'paper-a', 'canonicalId': 'paper-a', 'title': 'Paper A', 'taskId': 'task-a', 'status': 'completed', 'stage': 'completed', 'submitted': True, 'synced': True},",
      "        {'paperId': 'paper-b', 'canonicalId': 'paper-b', 'title': 'Paper B', 'taskId': 'task-b', 'status': 'completed', 'stage': 'completed', 'submitted': True, 'synced': True},",
      "    ],",
      "}",
      "print(json.dumps(payload))",
      "",
    ].join("\n"),
    "utf8"
  );
  await fs.chmod(scriptPath, 0o755);
  return scriptPath;
}

async function writeTokenCheckingPapernexusBatchScript(scriptDir) {
  await fs.mkdir(scriptDir, { recursive: true });
  const scriptPath = path.join(scriptDir, "pn_batch_import.py");
  await fs.writeFile(
    scriptPath,
    [
      "#!/usr/bin/env python3",
      "import json, os, sys",
      "args = sys.argv[1:]",
      "expected_token = os.environ.get('WORKFLOW_TEST_EXPECTED_PAPERNEXUS_TOKEN')",
      "if not expected_token or os.environ.get('PAPERNEXUS_API_TOKEN') != expected_token:",
      "    print(json.dumps({'error': 'missing expected child token env'}))",
      "    sys.exit(2)",
      "def opt(name):",
      "    if name in args:",
      "        index = args.index(name)",
      "        return args[index + 1] if index + 1 < len(args) else None",
      "    prefix = name + '='",
      "    for arg in args:",
      "        if arg.startswith(prefix):",
      "            return arg[len(prefix):]",
      "    return None",
      "payload = {",
      "    'manifest': opt('--manifest'),",
      "    'corpus': opt('--corpus'),",
      "    'summary': {'total': 1, 'submitted': 1, 'completed': 1, 'running': 0, 'pending': 0, 'failed': 0, 'remaining': 0, 'overallPercent': 100},",
      "    'queueSummary': {'total': 1, 'pending': 0, 'running': 0, 'completed': 1, 'failed': 0, 'remaining': 0, 'overallPercent': 100},",
      "    'items': [",
      "        {'paperId': 'paper-token', 'canonicalId': 'paper-token', 'title': 'Token Paper', 'taskId': 'task-token', 'status': 'completed', 'stage': 'completed', 'submitted': True, 'synced': True},",
      "    ],",
      "}",
      "print(json.dumps(payload))",
      "",
    ].join("\n"),
    "utf8"
  );
  await fs.chmod(scriptPath, 0o755);
  return scriptPath;
}

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
          const sessionFile = resolveSessionFilePath(params.sessionId, undefined, {
            agentId: params.agentId,
            sessionsDir: path.dirname(storePath),
          });
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
          return { ok: true };
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
  return createWorkflowExecutionRuntimeFromApi({
    api,
    defaultWorkspaceDir: rootDir,
    defaultAgentId: "researcher",
    defaultMessageChannel: "discord",
  });
}

test.beforeEach(async () => {
  await clearBackgroundWorkflowRunRegistryForTests();
  await clearBackgroundWorkflowQueueForTests();
});

test.afterEach(async () => {
  await clearBackgroundWorkflowRunRegistryForTests();
  await clearBackgroundWorkflowQueueForTests();
});

test("pending background queue check releases provider-capacity active runs", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectRoot = path.join(workspaceRoot, "capacity-project");
  const queueKey = "background-run:provider-capacity";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await fs.mkdir(projectRoot, { recursive: true });
  await recordBackgroundWorkflowRun({
    ownerAgent: "researcher",
    channelKey: "local:conversation:capacity",
    requesterSessionKey: "agent:researcher:local:conversation:capacity",
    backgroundSessionKey: "agent:researcher:local:conversation:capacity:subagent:run",
    runId: "run-provider-capacity",
    queueKey,
    kind: "workflow_stage_dispatch",
    family: "research",
    projectId: "capacity-project",
    projectRoot,
  });

  const pending = await hasPendingBackgroundWorkflowQueueKey({
    queueKey,
    projectId: "capacity-project",
    projectRoot,
    workflowRuntime: {
      async waitForRun(params) {
        assert.equal(params.runId, "run-provider-capacity");
        return {
          status: "error",
          error: "429 usage allocated quota exceeded. please try again later.",
        };
      },
    },
  });

  assert.deepEqual(pending, { queued: false, active: false });
  const runs = await listBackgroundWorkflowRuns({
    projectId: "capacity-project",
    projectRoot,
  });
  assert.equal(runs.entries.length, 1);
  assert.equal(runs.entries[0].status, "needs_repair");
});

test("background queue refuses ephemeral fallback without project scope", async (t) => {
  const previousQueuePath = process.env.OPENCLAW_RESEARCH_BACKGROUND_QUEUE_PATH;

  delete process.env.OPENCLAW_RESEARCH_BACKGROUND_QUEUE_PATH;

  try {
    await assert.rejects(
      () =>
        enqueueQueuedBackgroundWorkflowRun({
          source: "start_background_run",
          ownerAgent: "researcher",
          requesterSessionKey: "agent:researcher:discord:channel:test-room",
          messageChannel: "discord",
          kind: "resume_pipeline",
          summary: "Queue a background resume run",
          runPayload: {
            message: "/resume-pipeline",
            lane: "nested",
            deliver: false,
            idempotencyKey: null,
            extraSystemPrompt: null,
          },
        }),
      /project-scoped background queue path/i
    );
  } finally {
    if (previousQueuePath) {
      process.env.OPENCLAW_RESEARCH_BACKGROUND_QUEUE_PATH = previousQueuePath;
    } else {
      delete process.env.OPENCLAW_RESEARCH_BACKGROUND_QUEUE_PATH;
    }
  }
});

test("drainQueuedBackgroundWorkflowRuns replays running queue entries with no active registry session", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const projectRoot = path.join(projectsRoot, "orphan-queue-project");
  const queueKey = "orphan-running-background-run";
  const runCalls = [];

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "orphan-queue-project",
    current_stage: "graph_build",
    owner_agent: "researcher",
  });
  await enqueueQueuedBackgroundWorkflowRun({
    source: "start_background_run",
    ownerAgent: "researcher",
    requesterSessionKey: "agent:researcher:local:conversation:orphan",
    messageChannel: "local",
    preferredSessionKey:
      "agent:researcher:local:conversation:orphan:subagent:workflow-research-pipeline:orphan",
    family: "research",
    kind: "research_pipeline",
    projectId: "orphan-queue-project",
    projectRoot,
    projectsRoot,
    queueKey,
    summary: "Replay an orphaned running background queue entry.",
    runPayload: {
      message: "/research-pipeline orphan",
      lane: "nested",
      deliver: false,
      idempotencyKey: null,
      extraSystemPrompt: null,
    },
  });
  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  queueStore.entries = queueStore.entries.map((entry) =>
    entry.queueKey === queueKey
      ? {
          ...entry,
          status: "running",
          lastAttemptedAt: new Date(Date.now() - 60_000).toISOString(),
        }
      : entry
  );
  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    projectId: "orphan-queue-project",
    entries: queueStore.entries,
  });

  const drained = await drainQueuedBackgroundWorkflowRuns({
    workflowRuntime: {
      async run(params) {
        runCalls.push(params);
        return { runId: "run-replayed-orphan" };
      },
      async waitForRun() {
        return { status: "timeout" };
      },
    },
    projectsRoot,
  });

  assert.equal(runCalls.length, 1);
  assert.equal(drained.started.length, 1);
  assert.equal(drained.started[0].runId, "run-replayed-orphan");
});

test("finished papernexus wrapper runs reconcile runtime queue and durable paper_ingestion state", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const completedRunIds = new Set();
  const workflowRuntime = {
    async run() {
      return { runId: "bg-run-paper-1" };
    },
    async waitForRun(params) {
      return completedRunIds.has(params.runId)
        ? { status: "ok" }
        : { status: "timeout" };
    },
  };

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const launch = await startBackgroundWorkflowRun({
    workflowRuntime,
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
      zoteroProjectRoot: "Bot",
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:paper-room",
      sessionId: "session-paper-room-1",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: null,
      projectId: null,
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "papernexus_wrapper",
      projectId: "paper-sync-project",
      commandText:
        "python3 scripts/pn_batch_import.py --api-base https://papernexus.example/api --corpus GCD --manifest /tmp/demo/batch-import.json submit",
    },
  });

  assert.equal(launch.started, true);
  assert.match(launch.sessionKey ?? "", /^agent:researcher:discord:group:paper-room:subagent:papernexus-skill:/);
  assert.doesNotMatch(launch.sessionKey ?? "", /:paper-sync-project\b/);
  const projectRoot = path.join(projectsRoot, "paper-sync-project");
  await setPaperIngestionState({
    projectRoot,
    paperIngestion: {
      runtime_status: "waiting_import",
      waiting_reason: "Batch import is still running.",
      queued_requests: [
        {
          request_id: "req-paper-sync-1",
          wrapper: "pn_batch_import.py",
          command_text:
            "python3 scripts/pn_batch_import.py --api-base https://papernexus.example/api --corpus GCD --manifest /tmp/demo/batch-import.json submit",
          status: "running",
          last_run_id: launch.runId,
          last_session_key: launch.sessionKey,
          updated_at: "2026-04-08T01:00:00.000Z",
        },
      ],
    },
  });
  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  manifest.paper_ingestion = {
    ...(manifest.paper_ingestion ?? {}),
    graph_presence_status: "missing_papers",
    refresh_required: true,
    refresh_reason: "Graph presence has not been rechecked yet.",
  };
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  completedRunIds.add(String(launch.runId));
  const inventory = await listBackgroundWorkflowRuns({
    workflowRuntime,
    ownerAgent: "researcher",
    projectId: "paper-sync-project",
    projectRoot,
    projectsRoot,
  });

  assert.equal(inventory.entries.length, 1);
  assert.equal(inventory.entries[0].status, "idle");

  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  const queueEntry = queueStore.entries.find(
    (entry) => entry.queueKey === launch.queueKey
  );
  assert.equal(queueEntry?.status, "completed");

  const ingestionSummary = await getPaperIngestionStateSummary({ projectRoot });
  assert.equal(ingestionSummary.state.queuedRequests[0]?.status, "queued");
  assert.equal(ingestionSummary.state.runtimeStatus, "waiting_import");
  assert.match(
    ingestionSummary.state.waitingReason ?? "",
    /remote import completion is not implied|bounded wait\/status/i
  );
});

test("ensureWorkflowProjectRoot creates a project from configured projectsRoot and topic", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const ensured = await ensureWorkflowProjectRoot({
    policy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    workspaceDir: workspaceRoot,
    sessionKey: "agent:researcher:discord:group:cub-room",
    messageChannel: "discord",
    topic: "CUB confirmation bias mitigation",
  });

  assert.equal(ensured.projectRoot, path.join(projectsRoot, "cub-confirmation-bias-mitigation"));
  assert.equal(ensured.created, true);
  await fs.access(path.join(ensured.projectRoot, "PROJECT_MANIFEST.json"));
  await fs.access(path.join(ensured.projectRoot, "TRACK_REGISTRY.json"));
  await fs.access(path.join(ensured.projectRoot, "CLAIM_POLICY.md"));
  await fs.access(path.join(ensured.projectRoot, "researcher", "EXPERIMENT_LEDGER.json"));
  const idleResearchTemplate = JSON.parse(
    await fs.readFile(
      path.join(ensured.projectRoot, "researcher", "idle-research", "IDLE_RESEARCH.json"),
      "utf8"
    )
  );
  assert.equal(idleResearchTemplate.enabled, false);
  assert.equal(idleResearchTemplate.topic, "CUB confirmation bias mitigation");
  assert.match(idleResearchTemplate.pending_reason, /sync the approved config/i);
  const manifest = JSON.parse(
    await fs.readFile(path.join(ensured.projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.paper_source_dir, null);
  assert.equal(manifest.graph_source_dir, null);
  assert.equal(manifest.papernexus_corpus, null);
});

test("ensureWorkflowProjectRoot bootstraps survey projects onto the survey_review line", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const ensured = await ensureWorkflowProjectRoot({
    policy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    workspaceDir: workspaceRoot,
    sessionKey: "agent:researcher:discord:group:survey-room",
    messageChannel: "discord",
    topic: "Graph reasoning survey",
    workflowLine: "survey",
  });

  const manifest = JSON.parse(
    await fs.readFile(path.join(ensured.projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.current_stage, "survey_review");
  assert.equal(manifest.owner_agent, "researcher");
  assert.equal(manifest.survey_review.topic, "Graph reasoning survey");
  assert.equal(manifest.survey_review.status, "searching");
  assert.equal(manifest.writing_contract.paper_mode, "survey");
  assert.equal(manifest.writing_contract.proof_appendix_required, false);
  assert.deepEqual(manifest.writing_contract.required_sections, [
    "abstract",
    "introduction",
    "scope_and_protocol",
    "taxonomy",
    "evidence_synthesis",
    "benchmark_landscape",
    "open_problems",
    "conclusion",
  ]);
  assert.match(manifest.next_action, /^\/survey-pipeline\b/);
});

test("ensureWorkflowProjectRoot fails fast when projectsRoot is missing and workspace fallback is disabled", async (t) => {
  const workspaceRoot = await makeTempWorkspace();

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await assert.rejects(
    () =>
      ensureWorkflowProjectRoot({
        policy: {
          allowWorkspaceFallback: false,
          enableChannelProjectBindings: true,
        },
        workspaceDir: workspaceRoot,
        sessionKey: "agent:researcher:discord:group:cub-room",
        messageChannel: "discord",
        topic: "CUB confirmation bias mitigation",
      }),
    /projectsRoot is not configured/i
  );
});

test("ensureWorkflowProjectRoot rejects an explicit projectRoot outside the configured projectsRoot", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const strayProjectRoot = path.join(workspaceRoot, "..", "stray-project-root");

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await assert.rejects(
    () =>
      ensureWorkflowProjectRoot({
        policy: {
          projectsRoot,
          enableChannelProjectBindings: true,
        },
        workspaceDir: workspaceRoot,
        projectRoot: strayProjectRoot,
        projectId: "stray-project",
        topic: "Stray project",
      }),
    /must live under the configured projectsRoot/i
  );
});

test("ensureWorkflowProjectRoot backfills idle_research for an existing legacy manifest", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const projectRoot = path.join(projectsRoot, "legacy-project");

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    JSON.stringify(
      {
        project_id: "legacy-project",
        title: "Legacy project",
        status: "active",
        owner_agent: "researcher",
        current_stage: "setup",
        current_micro_stage: "project_init",
        created_at: "2026-03-23T00:00:00.000Z",
        updated_at: "2026-03-23T00:00:00.000Z",
      },
      null,
      2
    )
  );

  const ensured = await ensureWorkflowProjectRoot({
    policy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    workspaceDir: workspaceRoot,
    projectId: "legacy-project",
    topic: "Legacy project",
  });

  assert.equal(ensured.created, false);
  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(typeof manifest.idle_research, "object");
  assert.equal(manifest.idle_research.enabled, false);
  assert.equal(manifest.idle_research.status, "disabled");
  const idleResearchTemplate = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "idle-research", "IDLE_RESEARCH.json"),
      "utf8"
    )
  );
  assert.equal(idleResearchTemplate.enabled, false);
  assert.equal(idleResearchTemplate.topic, "Legacy project");
});

test("bindChannelProjectForWorkflow can auto-create and bind a missing project", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const sessionKey = "agent:researcher:discord:group:gcd-room";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const bound = await bindChannelProjectForWorkflow({
    policy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
    projectId: "gcd-confirmation-bias",
    topic: "GCD confirmation bias",
    boundByAgent: "researcher",
  });

  assert.equal(
    bound.binding.projectRoot,
    path.join(projectsRoot, "gcd-confirmation-bias")
  );
  const lookup = getChannelProjectBindingForWorkflow({
    policy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    workspaceDir: workspaceRoot,
    sessionKey,
    messageChannel: "discord",
  });
  assert.equal(lookup.binding?.projectRoot, bound.binding.projectRoot);
});

test("buildResearchPipelineBackgroundCommand appends the continuation marker once", () => {
  const command = buildResearchPipelineBackgroundCommand(
    '/research-pipeline "semantic shift robustness" -- AUTO_PROCEED: false'
  );
  assert.match(command, /__BACKGROUND_CONTINUATION__:\s*true/i);
  assert.equal(
    buildResearchPipelineBackgroundCommand(command),
    command
  );
});

test("buildResearchQueueBackgroundCommand appends the continuation marker once", () => {
  const command = buildResearchQueueBackgroundCommand(
    '/research-queue add "semantic shift queue topic"'
  );
  assert.match(command, /__BACKGROUND_CONTINUATION__:\s*true/i);
  assert.equal(buildResearchQueueBackgroundCommand(command), command);
});

test("buildGraphBuildBackgroundCommand appends the continuation marker once", () => {
  const command = buildGraphBuildBackgroundCommand(
    '/graph-build "gcd confirmation bias mitigation"'
  );
  assert.match(command, /__BACKGROUND_CONTINUATION__:\s*true/i);
  assert.equal(buildGraphBuildBackgroundCommand(command), command);
});

test("buildZoteroSyncBackgroundCommand appends the continuation marker once", () => {
  const command = buildZoteroSyncBackgroundCommand('/zotero-sync "paper-lab"');
  assert.match(command, /__BACKGROUND_CONTINUATION__:\s*true/i);
  assert.equal(buildZoteroSyncBackgroundCommand(command), command);
});

test("buildPapernexusSkillBackgroundCommand appends the continuation marker once", () => {
  const command = buildPapernexusSkillBackgroundCommand(
    'python3 scripts/pn_graph_query.py --api-base "https://papernexus.example/api" --corpus "demo" query "topic" --limit 8'
  );
  assert.match(command, /__BACKGROUND_CONTINUATION__:\s*true/i);
  assert.equal(buildPapernexusSkillBackgroundCommand(command), command);
});

test("buildPapernexusWrapperCommand renders an MCP-backed skill wrapper command", () => {
  const command = buildPapernexusWrapperCommand({
    wrapper: "pn_graph_query",
    args: [
      "--api-base",
      "https://papernexus.example/api",
      "--corpus",
      "demo",
      "query",
      "graph topic",
      "--limit",
      8,
    ],
  });

  assert.match(command, /^python3 skills\/researcher\/papernexus\/scripts\/pn_graph_query\.py\b/);
  assert.match(command, /--api-base 'https:\/\/papernexus\.example\/api'/);
  assert.match(command, /--corpus 'demo'/);
  assert.match(command, /query 'graph topic'/);
  assert.match(command, /--limit '8'/);
});

test("buildPapernexusWrapperCommand renders a batch-import wrapper command", () => {
  const command = buildPapernexusWrapperCommand({
    wrapper: "pn_batch_import",
    args: [
      "--api-base",
      "https://papernexus.example/api",
      "--corpus",
      "demo",
      "--manifest",
      "/tmp/demo/batch-import.json",
      "submit",
    ],
  });

  assert.match(command, /^python3 skills\/researcher\/papernexus\/scripts\/pn_batch_import\.py\b/);
  assert.match(command, /--manifest '\/tmp\/demo\/batch-import\.json'/);
  assert.match(command, /\bsubmit\b/);
});

test("startBackgroundWorkflowRun requires an explicit wrapper command for legacy papernexus_skill runs", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await assert.rejects(
    () =>
      startBackgroundWorkflowRun({
        workflowRuntime: {
          async run() {
            throw new Error("should not launch");
          },
        },
        workflowPolicy: {
          projectsRoot,
          enableChannelProjectBindings: true,
        },
        agentCtx: {
          agentId: "researcher",
          workspaceDir: workspaceRoot,
          sessionKey: "agent:researcher:discord:group:birds-room",
          sessionId: "session-bg-legacy",
          messageChannel: "discord",
        },
        snapshot: {
          role: "researcher",
          projectRoot: null,
          projectId: null,
          channelProjectBindingsEnabled: true,
        },
        backgroundRun: {
          kind: "papernexus_skill",
          topic: "legacy graph run",
        },
      }),
    /run_papernexus_wrapper|explicit wrapper command/i
  );
});

test("startBackgroundWorkflowRun gives PaperNexus import continuations explicit per-paper state-feedback instructions", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const runCalls = [];

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const result = await startBackgroundWorkflowRun({
    workflowRuntime: {
      async run(params) {
        runCalls.push(params);
        return { runId: "bg-run-import-1" };
      },
    },
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:imports-room",
      sessionId: "session-bg-import-1",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: null,
      projectId: null,
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "papernexus_wrapper",
      title: "import one paper",
      commandText:
        "python3 scripts/pn_import_submit.py --api-base 'https://papernexus.example/api' --corpus 'demo' --paper-id 'arxiv:2501.00031' --server-file-path '/tmp/demo/2501.00031.pdf'",
      summary: "Queued wrapper-driven PaperNexus import",
    },
  });

  assert.equal(result.started, true);
  assert.equal(runCalls.length, 1);
  assert.match(runCalls[0].message, /^python3 scripts\/pn_import_submit\.py\b/);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /research_workflow\.set_paper_ingestion/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /one paper per import/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /60s|60 seconds/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /completed_papers/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /paper_operations/i);
});

test("startBackgroundWorkflowRun gives PaperNexus batch continuations explicit manifest-driven state-feedback instructions", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const runCalls = [];

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const result = await startBackgroundWorkflowRun({
    workflowRuntime: {
      async run(params) {
        runCalls.push(params);
        return { runId: "bg-run-batch-import-1" };
      },
    },
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:imports-room",
      sessionId: "session-bg-batch-import-1",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: null,
      projectId: null,
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "papernexus_wrapper",
      title: "batch import papers",
      commandText:
        "python3 scripts/pn_batch_import.py --api-base 'https://papernexus.example/api' --corpus 'demo' --manifest '/tmp/demo/batch-import.json' submit",
      summary: "Queued wrapper-driven PaperNexus batch import",
    },
  });

  assert.equal(result.started, true);
  assert.equal(runCalls.length, 1);
  assert.match(runCalls[0].message, /^python3 scripts\/pn_batch_import\.py\b/);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /same manifest/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /active_batches/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /batch_items/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /summary\/items|summary and items/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /completed_papers/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /60s|60 seconds/i);
});

test("startBackgroundWorkflowRun executes workflow-owned PaperNexus batch imports directly", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectRoot = path.join(workspaceRoot, "project");
  const fakeScriptDir = path.join(workspaceRoot, "fake-papernexus-scripts");
  const previousScriptDir = process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR;
  const runCalls = [];

  t.after(async () => {
    if (previousScriptDir === undefined) {
      delete process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR;
    } else {
      process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR = previousScriptDir;
    }
    await clearBackgroundWorkflowRunRegistryForTests();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR = fakeScriptDir;
  await writeFakePapernexusBatchScript(fakeScriptDir);
  const batchManifestPath =
    "researcher/paper-staging/queued-imports/req-batch-1/batch-import.json";
  await writeJson(path.join(projectRoot, batchManifestPath), {
    papers: [{ id: "paper-a" }, { id: "paper-b" }],
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "direct-batch-project",
    title: "Direct batch project",
    current_stage: "graph_build",
    owner_agent: "researcher",
    paper_ingestion: {
      runtime_status: "waiting_import",
      queued_requests: [
        {
          request_id: "req-batch-1",
          request_kind: "upload_manifest",
          status: "queued",
          wrapper: "pn_batch_import.py",
          command_text:
            `python3 skills/researcher/papernexus/scripts/pn_batch_import.py --mcp-url http://papernexus.test/mcp --corpus demo --manifest ${batchManifestPath} submit`,
          manifest_path: batchManifestPath,
          shared_corpus: "demo",
          paper_count: 2,
          summary: "Queue test batch import.",
          validation_status: "valid",
        },
      ],
    },
  });

  const result = await startBackgroundWorkflowRun({
    workflowRuntime: {
      async run(params) {
        runCalls.push(params);
        return { runId: "unexpected-subagent-run" };
      },
    },
    workflowPolicy: {
      projectsRoot: path.join(workspaceRoot, "projects"),
      enableChannelProjectBindings: false,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:local:conversation:direct-batch",
      messageChannel: "local",
      channelKey: "local:direct-batch",
    },
    snapshot: {
      role: "researcher",
      projectRoot,
      projectId: "direct-batch-project",
      channelProjectBindingsEnabled: false,
    },
    backgroundRun: {
      kind: "papernexus_wrapper",
      projectId: "direct-batch-project",
      projectRoot,
      ensureProjectBinding: false,
      commandText:
        `python3 skills/researcher/papernexus/scripts/pn_batch_import.py --mcp-url http://papernexus.test/mcp --corpus demo --manifest ${batchManifestPath} submit -- __BACKGROUND_CONTINUATION__: true`,
      summary: "Queue test batch import.",
      extraSystemPrompt:
        "WORKFLOW_OWNED_PAPER_INGESTION_REQUEST_ID=req-batch-1\nUse the locked shared corpus demo.",
    },
  });

  assert.equal(result.started, true);
  assert.equal(result.sessionKey, "local:papernexus:direct-batch-import");
  assert.equal(runCalls.length, 0);

  const ingestion = await getPaperIngestionStateSummary({ projectRoot });
  assert.equal(ingestion.state.runtimeStatus, "waiting_graph");
  assert.equal(ingestion.state.queuedRequests[0].status, "completed");
  assert.equal(ingestion.state.completedPapers.length, 2);
  assert.equal(ingestion.state.activeBatches[0].status, "completed");
  assert.equal(ingestion.state.queuedRequests[0].queueProgress?.completed, 2);

  const events = await readWorkflowRuntimeEvents(projectRoot);
  assert.ok(
    events.some(
      (event) =>
        event.kind === "paper_ingestion_direct_batch_import" &&
        event.details?.source === "start_background_run" &&
        event.details?.requestId === "req-batch-1"
    )
  );
});

test("maybeTriggerQueuedPaperIngestionRequest injects configured PaperNexus token into direct batch child env", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectRoot = path.join(workspaceRoot, "projects", "token-batch-project");
  const fakeScriptDir = path.join(workspaceRoot, "fake-papernexus-scripts");
  const batchManifestPath =
    "researcher/paper-staging/queued-imports/req-token-1/batch-import.json";
  const stagedMarkdownPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "token-paper.md"
  );
  const previousScriptDir = process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR;
  const previousApiToken = process.env.PAPERNEXUS_API_TOKEN;
  const previousConfiguredToken = process.env.WORKFLOW_TEST_PAPERNEXUS_TOKEN;
  const previousExpectedToken = process.env.WORKFLOW_TEST_EXPECTED_PAPERNEXUS_TOKEN;
  const fakeToken = "unit-token-for-direct-papernexus-child-env";

  t.after(async () => {
    if (previousScriptDir === undefined) {
      delete process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR;
    } else {
      process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR = previousScriptDir;
    }
    if (previousApiToken === undefined) {
      delete process.env.PAPERNEXUS_API_TOKEN;
    } else {
      process.env.PAPERNEXUS_API_TOKEN = previousApiToken;
    }
    if (previousConfiguredToken === undefined) {
      delete process.env.WORKFLOW_TEST_PAPERNEXUS_TOKEN;
    } else {
      process.env.WORKFLOW_TEST_PAPERNEXUS_TOKEN = previousConfiguredToken;
    }
    if (previousExpectedToken === undefined) {
      delete process.env.WORKFLOW_TEST_EXPECTED_PAPERNEXUS_TOKEN;
    } else {
      process.env.WORKFLOW_TEST_EXPECTED_PAPERNEXUS_TOKEN = previousExpectedToken;
    }
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR = fakeScriptDir;
  delete process.env.PAPERNEXUS_API_TOKEN;
  process.env.WORKFLOW_TEST_PAPERNEXUS_TOKEN = fakeToken;
  process.env.WORKFLOW_TEST_EXPECTED_PAPERNEXUS_TOKEN = fakeToken;
  await writeTokenCheckingPapernexusBatchScript(fakeScriptDir);
  await fs.mkdir(path.dirname(stagedMarkdownPath), { recursive: true });
  await fs.writeFile(
    stagedMarkdownPath,
    "# Token Paper\n\nThis staged markdown fixture is long enough for upload validation. ".repeat(30),
    "utf8"
  );
  await writeJson(path.join(projectRoot, batchManifestPath), {
    version: 1,
    papers: [
      {
        paperId: "paper-token",
        source: stagedMarkdownPath,
        sourceKind: "markdown",
      },
    ],
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "token-batch-project",
    title: "Token batch project",
    current_stage: "graph_build",
    owner_agent: "researcher",
    paper_ingestion: {
      runtime_status: "waiting_import",
      queued_requests: [
        {
          request_id: "req-token-1",
          request_kind: "upload_manifest",
          status: "queued",
          wrapper: "pn_batch_import.py",
          command_text:
            `python3 skills/researcher/papernexus/scripts/pn_batch_import.py --mcp-url http://papernexus.test/mcp --corpus demo --manifest ${batchManifestPath} submit`,
          manifest_path: batchManifestPath,
          shared_corpus: "demo",
          paper_count: 1,
          summary: "Queue token batch import.",
          validation_status: "valid",
        },
      ],
    },
  });

  const result = await maybeTriggerQueuedPaperIngestionRequest({
    workflowPolicy: {
      projectsRoot: path.join(workspaceRoot, "projects"),
      enableChannelProjectBindings: false,
      papernexusMcpUrl: "http://papernexus.test/mcp",
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "WORKFLOW_TEST_PAPERNEXUS_TOKEN",
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:local:conversation:direct-token",
      messageChannel: "local",
      channelKey: "local:direct-token",
    },
    snapshot: {
      role: "researcher",
      projectRoot,
      projectId: "token-batch-project",
      currentStage: "graph_build",
      channelProjectBindingsEnabled: false,
    },
    triggerKind: "graph_build",
    projectRoot,
    projectId: "token-batch-project",
  });

  assert.equal(result?.started, true);
  assert.equal(result?.sessionKey, "local:papernexus:direct-batch-import");

  const manifestText = await fs.readFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    "utf8"
  );
  assert.doesNotMatch(manifestText, new RegExp(fakeToken));

  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.paper_ingestion.runtime_status, "waiting_graph");
  assert.equal(manifest.paper_ingestion.queued_requests[0].status, "completed");
  assert.equal(manifest.paper_ingestion.completed_papers.length, 1);
  assert.doesNotMatch(
    manifest.paper_ingestion.queued_requests[0].command_text,
    new RegExp(fakeToken)
  );
});

test("startBackgroundWorkflowRun gives graph-build continuations explicit Zotero bot sync instructions", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const runCalls = [];

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const result = await startBackgroundWorkflowRun({
    workflowRuntime: {
      async run(params) {
        runCalls.push(params);
        return { runId: "bg-run-graph-build-1" };
      },
    },
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:graph-room",
      sessionId: "session-bg-graph-build-1",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: path.join(projectsRoot, "paper-lab"),
      projectId: "paper-lab",
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "graph_build",
      projectId: "paper-lab",
      projectRoot: path.join(projectsRoot, "paper-lab"),
      commandText: '/graph-build "gcd confirmation bias mitigation" -- __BACKGROUND_CONTINUATION__: true',
      summary: "Background graph build started for paper-lab.",
    },
  });

  assert.equal(result.started, true);
  assert.equal(runCalls.length, 1);
  assert.match(runCalls[0].message, /^\/graph-build\b/);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /zotero-project-library/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /Bot\/paper-lab|<configured-root>\/<project-id>/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /ZOTERO_PACKET\.md/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /graph readiness|brainstorm bundle/i);
});

test("startBackgroundWorkflowRun gives zotero-sync continuations explicit non-blocking reconciliation instructions", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const runCalls = [];

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const result = await startBackgroundWorkflowRun({
    workflowRuntime: {
      async run(params) {
        runCalls.push(params);
        return { runId: "bg-run-zotero-sync-1" };
      },
    },
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
      zoteroProjectRoot: "Bot",
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:graph-room",
      sessionId: "session-bg-zotero-sync-1",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: path.join(projectsRoot, "paper-lab"),
      projectId: "paper-lab",
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "zotero_sync",
      projectId: "paper-lab",
      projectRoot: path.join(projectsRoot, "paper-lab"),
      commandText: '/zotero-sync "paper-lab" -- __BACKGROUND_CONTINUATION__: true',
      summary: "Background Zotero sync started for paper-lab.",
    },
  });

  assert.equal(result.started, true);
  assert.equal(runCalls.length, 1);
  assert.match(runCalls[0].message, /^\/zotero-sync\b/);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /zotero-project-library/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /Bot\/paper-lab|<configured-root>\/<project-id>/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /do not block the foreground session|stay responsive/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /remove.*project collections/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /ZOTERO_SYNC_PACKET\.json/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /local Zotero MCP server/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /ZOTERO_API_KEY|ZOTERO_USER_ID/i);
  assert.doesNotMatch(runCalls[0].extraSystemPrompt ?? "", /zoteroApiKey|zoteroApiKeyEnv|zoteroUserId/);
  assert.doesNotMatch(runCalls[0].extraSystemPrompt ?? "", /plugin_config|configured Zotero API key|configured Zotero user id/i);
});

test("startBackgroundWorkflowRun keeps survey continuations on the survey line and seeds survey bootstrap state", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const runCalls = [];

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const result = await startBackgroundWorkflowRun({
    workflowRuntime: {
      async run(params) {
        runCalls.push(params);
        return { runId: "bg-run-survey-1" };
      },
    },
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:survey-room",
      sessionId: "session-bg-survey-1",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: null,
      projectId: null,
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "survey_review",
      topic: "Graph reasoning survey",
    },
  });

  assert.equal(result.started, true);
  assert.equal(runCalls.length, 1);
  assert.match(runCalls[0].message, /^\/survey-pipeline\b/);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /survey_review -> write/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /set_survey_review/i);

  const manifest = JSON.parse(
    await fs.readFile(
      path.join(projectsRoot, "survey-graph-reasoning-survey", "PROJECT_MANIFEST.json"),
      "utf8"
    )
  );
  assert.equal(manifest.current_stage, "survey_review");
  assert.equal(manifest.survey_review.topic, "Graph reasoning survey");
  assert.equal(manifest.writing_contract.paper_mode, "survey");
});

test("startBackgroundWorkflowRun binds a non-Discord channel back to the manifest owner instead of the invoking orchestrator", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const projectRoot = path.join(projectsRoot, "survey-omnimodel");

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await fs.mkdir(projectRoot, { recursive: true });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "survey-omnimodel",
    current_stage: "survey_review",
    owner_agent: "researcher",
    survey_review: {
      topic: "OmniModel",
      status: "searching",
    },
  });

  const result = await startBackgroundWorkflowRun({
    workflowRuntime: {
      async run() {
        return { runId: "bg-run-resume-owner-fix" };
      },
    },
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "orchestrator",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:orchestrator:local:channel:1493115797856452619",
      sessionId: "session-bg-owner-fix",
      messageChannel: "local",
      channelKey: "binding:local:researcher:channel:1493115797856452619",
    },
    snapshot: {
      role: "orchestrator",
      projectRoot,
      projectId: "survey-omnimodel",
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "resume_pipeline",
      projectId: "survey-omnimodel",
      projectRoot,
      summary: "Resume the survey project.",
      commandText: "/resume-pipeline survey-omnimodel -- __BACKGROUND_CONTINUATION__: true",
    },
  });

  assert.equal(result.started, true);

  const bound = await getChannelProjectBindingForWorkflow({
    policy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    channelKey: "binding:local:researcher:channel:1493115797856452619",
  });
  assert.equal(bound.binding?.workflowRole, "researcher");
  assert.equal(
    bound.binding?.workflowSessionKey,
    "agent:researcher:local:channel:1493115797856452619"
  );
  assert.equal(bound.binding?.boundByAgent, "researcher");
});

test("buildLiteratureReviewBackgroundCommand appends the background continuation marker once", () => {
  assert.equal(
    buildLiteratureReviewBackgroundCommand('/literature-review "baseline coverage refresh"'),
    '/literature-review "baseline coverage refresh" -- __BACKGROUND_CONTINUATION__: true'
  );
  assert.equal(
    buildLiteratureReviewBackgroundCommand(
      '/literature-review "baseline coverage refresh" -- __BACKGROUND_CONTINUATION__: true'
    ),
    '/literature-review "baseline coverage refresh" -- __BACKGROUND_CONTINUATION__: true'
  );
});

test("buildSurveyReviewBackgroundCommand appends the background continuation marker once", () => {
  assert.equal(
    buildSurveyReviewBackgroundCommand('/survey-pipeline "graph reasoning survey"'),
    '/survey-pipeline "graph reasoning survey" -- __BACKGROUND_CONTINUATION__: true'
  );
  assert.equal(
    buildSurveyReviewBackgroundCommand(
      '/survey-pipeline "graph reasoning survey" -- __BACKGROUND_CONTINUATION__: true'
    ),
    '/survey-pipeline "graph reasoning survey" -- __BACKGROUND_CONTINUATION__: true'
  );
});

test("startBackgroundWorkflowRun gives graph-build repair continuations explicit import repair instructions", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const runCalls = [];

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const result = await startBackgroundWorkflowRun({
    workflowRuntime: {
      async run(params) {
        runCalls.push(params);
        return { runId: "bg-run-graph-build-repair-1" };
      },
    },
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:graph-room",
      sessionId: "session-bg-graph-build-repair-1",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: path.join(projectsRoot, "paper-lab"),
      projectId: "paper-lab",
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "graph_build",
      projectId: "paper-lab",
      projectRoot: path.join(projectsRoot, "paper-lab"),
      commandText:
        '/graph-build --repair-import true --shared-corpus "GCD" -- __BACKGROUND_CONTINUATION__: true',
      summary: "Background graph build started for paper-lab.",
    },
  });

  assert.equal(result.started, true);
  assert.equal(runCalls.length, 1);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /repair mode|graph-sync repair/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /pn_batch_import\.py/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /shared corpus/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /GCD/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /set_paper_ingestion/i);
});

test("startBackgroundWorkflowRun for graph-build triggers queued workflow-owned ingestion before the stage continuation", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const projectRoot = path.join(projectsRoot, "paper-lab");
  const batchManifestPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "batch-import.json"
  );
  const fakeScriptDir = path.join(workspaceRoot, "fake-papernexus-scripts");
  const previousScriptDir = process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR;
  const stagedMarkdownPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "demo-paper.md"
  );
  const runCalls = [];

  t.after(async () => {
    if (previousScriptDir === undefined) {
      delete process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR;
    } else {
      process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR = previousScriptDir;
    }
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR = fakeScriptDir;
  await writeFakePapernexusBatchScript(fakeScriptDir);
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(path.dirname(batchManifestPath), { recursive: true });
  await fs.writeFile(
    stagedMarkdownPath,
    "# Demo Paper\n\nThis markdown fixture is long enough for staged validation. ".repeat(30),
    "utf8"
  );
  await fs.writeFile(
    batchManifestPath,
    `${JSON.stringify(
      {
        version: 1,
        papers: [
          {
            paperId: "demo-paper",
            source: stagedMarkdownPath,
            sourceKind: "markdown",
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "paper-lab",
        current_stage: "graph_build",
        owner_agent: "researcher",
        idle_research: { enabled: false },
        paper_ingestion: {
          queued_requests: [
            {
              request_id: "req-batch-1",
              status: "queued",
              wrapper: "pn_batch_import.py",
              command_text:
                `python3 scripts/pn_batch_import.py --api-base https://papernexus.example/api --corpus GCD --manifest ${batchManifestPath} submit`,
              manifest_path: batchManifestPath,
              shared_corpus: "GCD",
              paper_count: 1,
              summary: "Queued corpus upload",
              created_at: "2026-04-02T00:00:00.000Z",
              updated_at: "2026-04-02T00:00:00.000Z",
            },
          ],
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const result = await startBackgroundWorkflowRun({
    workflowRuntime: {
      async run(params) {
        runCalls.push(params);
        return { runId: `bg-run-${runCalls.length}` };
      },
    },
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:graph-room",
      sessionId: "session-bg-graph-build-trigger-1",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot,
      projectId: "paper-lab",
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "graph_build",
      projectId: "paper-lab",
      projectRoot,
      commandText: '/graph-build "paper-lab" -- __BACKGROUND_CONTINUATION__: true',
      summary: "Background graph build started for paper-lab.",
    },
  });

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );

  assert.equal(result.started, true);
  assert.equal(runCalls.length, 1);
  assert.match(runCalls[0].message, /^\/graph-build\b/);
  assert.equal(manifest.paper_ingestion.queued_requests[0].status, "completed");
  assert.equal(
    manifest.paper_ingestion.queued_requests[0].last_session_key,
    "local:papernexus:direct-batch-import"
  );
  assert.equal(manifest.paper_ingestion.completed_papers.length, 2);
});

test("maybeTriggerQueuedPaperIngestionRequest launches queued literature discovery requisitions", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectRoot = path.join(workspaceRoot, "projects", "paper-lab");
  const runCalls = [];

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "paper-lab",
        current_stage: "graph_build",
        owner_agent: "researcher",
        paper_ingestion: {
          queued_requests: [
            {
              request_id: "req-discovery-1",
              request_kind: "requisition",
              status: "queued",
              wrapper: "pn_batch_import.py",
              command_text: "LITERATURE DISCOVERY WORKFLOW-OWNED REQUISITION EXECUTION",
              manifest_path:
                "researcher/literature-discovery/requisition/demo/DISCOVERY_REQUISITION.json",
              trigger_kind: "literature_discovery",
              summary: "Discovery requisition waiting for staged papers.",
              created_at: "2026-04-23T03:00:00.000Z",
              updated_at: "2026-04-23T03:00:00.000Z",
              validation_status: "warning",
              validation_summary:
                "Literature discovery requisition is waiting for paper selection and staging.",
            },
          ],
          graph_presence_status: "missing_papers",
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const result = await maybeTriggerQueuedPaperIngestionRequest({
    workflowRuntime: {
      async run(params) {
        runCalls.push(params);
        return { runId: `lit-run-${runCalls.length}` };
      },
    },
    workflowPolicy: {
      projectsRoot: path.join(workspaceRoot, "projects"),
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:graph-room",
      sessionId: "session-ignore-requisition",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot,
      projectId: "paper-lab",
      currentStage: "graph_build",
      channelProjectBindingsEnabled: true,
    },
    triggerKind: "graph_build",
    projectRoot,
    projectId: "paper-lab",
  });

  assert.equal(result?.started, true);
  assert.equal(result?.runId, "lit-run-1");
  assert.equal(runCalls.length, 1);
  assert.match(
    runCalls[0].message,
    /LITERATURE DISCOVERY WORKFLOW-OWNED REQUISITION EXECUTION/
  );
  assert.match(runCalls[0].message, /__BACKGROUND_CONTINUATION__:\s*true/);
  assert.match(
    runCalls[0].extraSystemPrompt ?? "",
    /WORKFLOW_OWNED_LITERATURE_REQUISITION_REQUEST_ID=req-discovery-1/
  );

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.paper_ingestion.queued_requests[0].status, "running");
  assert.equal(manifest.paper_ingestion.queued_requests[0].request_kind, "requisition");
  assert.equal(manifest.paper_ingestion.queued_requests[0].last_run_id, "lit-run-1");
  assert.match(
    manifest.paper_ingestion.queued_requests[0].last_session_key,
    /:workflow-research-queue:paper-lab$/
  );
});

test("startBackgroundWorkflowRun for resume-pipeline requeues stale running ingestion requests before triggering upload", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const projectRoot = path.join(projectsRoot, "paper-lab");
  const batchManifestPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "batch-import.json"
  );
  const stagedMarkdownPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "demo-paper.md"
  );
  const fakeScriptDir = path.join(workspaceRoot, "fake-papernexus-scripts");
  const previousScriptDir = process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR;
  const runCalls = [];

  t.after(async () => {
    if (previousScriptDir === undefined) {
      delete process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR;
    } else {
      process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR = previousScriptDir;
    }
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PAPERNEXUS_SCRIPT_DIR = fakeScriptDir;
  await writeFakePapernexusBatchScript(fakeScriptDir);
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(path.dirname(batchManifestPath), { recursive: true });
  await fs.writeFile(
    stagedMarkdownPath,
    "# Demo Paper\n\nThis markdown fixture is long enough for staged validation. ".repeat(30),
    "utf8"
  );
  await fs.writeFile(
    batchManifestPath,
    `${JSON.stringify(
      {
        version: 1,
        papers: [
          {
            paperId: "demo-paper",
            source: stagedMarkdownPath,
            sourceKind: "markdown",
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "paper-lab",
        current_stage: "graph_build",
        owner_agent: "researcher",
        idle_research: { enabled: false },
        paper_ingestion: {
          runtime_status: "idle",
          queued_requests: [
            {
              request_id: "req-batch-stale",
              status: "running",
              wrapper: "pn_batch_import.py",
              command_text:
                `python3 scripts/pn_batch_import.py --api-base https://papernexus.example/api --corpus GCD --manifest ${batchManifestPath} submit`,
              manifest_path: batchManifestPath,
              shared_corpus: "GCD",
              paper_count: 1,
              summary: "Queued corpus upload",
              created_at: "2026-04-02T00:00:00.000Z",
              updated_at: "2026-04-02T00:00:00.000Z",
              started_at: "2026-04-02T00:00:10.000Z",
              last_run_id: "bg-run-old",
            },
          ],
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const result = await startBackgroundWorkflowRun({
    workflowRuntime: {
      async run(params) {
        runCalls.push(params);
        return { runId: `bg-run-${runCalls.length}` };
      },
    },
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:graph-room",
      sessionId: "session-bg-resume-trigger-1",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot,
      projectId: "paper-lab",
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "resume_pipeline",
      projectId: "paper-lab",
      projectRoot,
      commandText: "/resume-pipeline paper-lab -- __BACKGROUND_CONTINUATION__: true",
      summary: "Background resume pipeline started for paper-lab.",
    },
  });

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );

  assert.equal(result.started, true);
  assert.equal(runCalls.length, 1);
  assert.match(runCalls[0].message, /^\/resume-pipeline\b/);
  assert.equal(manifest.paper_ingestion.queued_requests[0].status, "completed");
  assert.equal(
    manifest.paper_ingestion.queued_requests[0].last_session_key,
    "local:papernexus:direct-batch-import"
  );
  assert.match(
    manifest.paper_ingestion.queued_requests[0].detail ?? "",
    /completed remotely|graph presence/i
  );
});

test("startBackgroundWorkflowRun launches a dedicated Discord continuation and records a notification target", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const runCalls = [];
  const sessionKey = "agent:researcher:discord:group:birds-room";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const result = await startBackgroundWorkflowRun({
    workflowRuntime: {
      async run(params) {
        runCalls.push(params);
        return { runId: "bg-run-1" };
      },
    },
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey,
      sessionId: "session-bg-1",
      messageChannel: "discord",
      channelKey: "binding:discord:default:group:birds-room",
    },
    snapshot: {
      role: "researcher",
      projectRoot: null,
      projectId: null,
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "research_pipeline",
      topic: "bird species discovery with semantic shift",
      summary: "Starting background pipeline",
    },
  });

  assert.equal(result.started, true);
  assert.equal(result.reason, "started");
  assert.equal(result.runId, "bg-run-1");
  assert.equal(result.reusedIdleSession, false);
  assert.equal(runCalls.length, 1);
  assert.notEqual(runCalls[0].sessionKey, sessionKey);
  assert.match(runCalls[0].sessionKey, /^agent:researcher:discord:group:birds-room:subagent:/);
  assert.equal(runCalls[0].deliver, false);
  assert.equal(runCalls[0].lane, "nested");
  assert.match(runCalls[0].message, /^\/research-pipeline\b/);
  assert.match(runCalls[0].message, /__BACKGROUND_CONTINUATION__:\s*true/i);
  assert.equal(result.sessionKey, runCalls[0].sessionKey);

  await fs.access(path.join(result.projectRoot, "PROJECT_MANIFEST.json"));
  await assert.rejects(
    () =>
      fs.access(
        path.join(result.projectRoot, ".openclaw-research", "channel-project-bindings.json")
      ),
    /ENOENT/
  );
  const notifications = await listWorkflowNotificationChannelsForProject(
    result.projectRoot
  );
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].messageChannel, "discord");
  assert.equal(notifications[0].channelKey, "binding:discord:default:group:birds-room");
  assert.equal(notifications[0].sessionKey, sessionKey);
  assert.equal(notifications[0].projectId, "bird-species-discovery-with-semantic-shi");
  const runtimeQueue = await readWorkflowRuntimeQueueStore(result.projectRoot);
  assert.equal(runtimeQueue.entries.length, 1);
  assert.equal(runtimeQueue.entries[0].status, "running");
  assert.equal(runtimeQueue.entries[0].entryType, "background_run");
  assert.equal(runtimeQueue.entries[0].queueKey, result.queueKey);
});

test("startBackgroundWorkflowRun rotates away from tainted persisted workflow session state", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const runCalls = [];
  const sessionKey = "agent:researcher:discord:group:birds-room";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const result = await startBackgroundWorkflowRun({
    workflowRuntime: {
      async inspectSession(params) {
        if (/workflow-research-pipeline/i.test(params.sessionKey)) {
          return {
            sessionKey: params.sessionKey,
            sessionId: "workflow.researcher.old123",
            sessionFile: "/tmp/old-session.jsonl",
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
        runCalls.push(params);
        return { runId: "bg-run-rotated" };
      },
    },
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey,
      sessionId: "session-bg-rotate-1",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: null,
      projectId: null,
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "research_pipeline",
      topic: "bird species discovery with semantic shift",
      summary: "Starting background pipeline with rotated session",
    },
  });

  assert.equal(result.started, true);
  assert.equal(runCalls.length, 1);
  assert.notEqual(
    runCalls[0].sessionKey,
    "agent:researcher:discord:group:birds-room:subagent:workflow-research-pipeline:bird-species-discovery-with-semantic-shift"
  );
  assert.match(runCalls[0].sessionKey, /:subagent:workflow-research-pipeline:/);
  assert.match(runCalls[0].sessionKey, /:run-[a-f0-9]{8}$/);
  assert.equal(result.sessionKey, runCalls[0].sessionKey);
});

test("startBackgroundWorkflowRun rotates away from persisted openai workflow session overrides", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const runCalls = [];

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const result = await startBackgroundWorkflowRun({
    workflowRuntime: {
      async inspectSession(params) {
        if (/workflow-research-pipeline/i.test(params.sessionKey)) {
          return {
            sessionKey: params.sessionKey,
            sessionId: "workflow.researcher.openai123",
            sessionFile: "/tmp/openai-session.jsonl",
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
        runCalls.push(params);
        return { runId: "bg-run-openai-rotated" };
      },
    },
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:birds-room",
      sessionId: "session-bg-openai-rotate-1",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: null,
      projectId: null,
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "research_pipeline",
      topic: "bird species discovery with semantic shift",
      summary: "Starting background pipeline with openai-tainted prior session",
    },
  });

  assert.equal(result.started, true);
  assert.equal(runCalls.length, 1);
  assert.match(runCalls[0].sessionKey, /:run-[a-f0-9]{8}$/);
  assert.equal(/openai/i.test(runCalls[0].sessionKey), false);
});

test("startBackgroundWorkflowRun can use embedded workflow runtime without gateway subagent access", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const workflowRuntime = createEmbeddedRuntimeHarness(workspaceRoot);

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const result = await startBackgroundWorkflowRun({
    workflowRuntime: workflowRuntime,
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:birds-room",
      sessionId: "session-bg-embedded-1",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: null,
      projectId: null,
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "research_pipeline",
      topic: "bird species discovery with semantic shift",
      summary: "Starting embedded background pipeline",
    },
  });

  assert.equal(result.started, true);
  assert.equal(result.reason, "started");
  assert.equal(result.queued, false);
  assert.ok(result.runId);
  assert.match(result.summary, /starting embedded background pipeline/i);

  const projectRoot = result.projectRoot;
  const runtimeQueue = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(runtimeQueue.entries.length, 1);
  assert.equal(runtimeQueue.entries[0].status, "running");
  assert.equal(runtimeQueue.entries[0].queueKey, result.queueKey);

  const waited = await workflowRuntime.waitForRun({
    runId: result.runId,
    timeoutMs: 500,
  });
  assert.equal(waited.status, "ok");
  const transcript = await workflowRuntime.getSessionMessages({
    sessionKey: result.sessionKey,
    limit: 5,
  });
  assert.match(JSON.stringify(transcript.messages), /Embedded workflow completed/);
});

test("startBackgroundWorkflowRun tolerates empty legacy background registry and queue files", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const registryPath = process.env.OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH;
  const queuePath = process.env.OPENCLAW_RESEARCH_BACKGROUND_QUEUE_PATH;

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  if (!registryPath || !queuePath) {
    throw new Error("Expected test background registry paths to be configured.");
  }
  await fs.writeFile(registryPath, "", "utf8");
  await fs.writeFile(queuePath, "", "utf8");

  const result = await startBackgroundWorkflowRun({
    workflowRuntime: {
      async run() {
        return { runId: "bg-run-empty-registry" };
      },
    },
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:gcd-room",
      sessionId: "session-bg-empty-1",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: null,
      projectId: null,
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "research_pipeline",
      topic: "generalized category discovery with short cut learning",
      summary: "Start despite empty legacy registry files",
    },
  });

  assert.equal(result.started, true);
  assert.equal(result.runId, "bg-run-empty-registry");
});

test("startBackgroundWorkflowRun queues the continuation when runtime subagent access is unavailable", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const result = await startBackgroundWorkflowRun({
    workflowRuntime: {
      async run() {
        throw new Error(
          "Plugin runtime subagent methods are only available during a gateway request."
        );
      },
    },
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:birds-room",
      sessionId: "session-bg-unavailable-1",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: null,
      projectId: null,
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "resume_pipeline",
      projectId: "bird-graph",
      topic: "bird species discovery",
      commandText: '/resume-pipeline "bird-graph" -- __BACKGROUND_CONTINUATION__: true',
    },
  });

  assert.equal(result.started, false);
  assert.equal(result.reason, "runtime_unavailable");
  assert.equal(result.queued, true);
  assert.match(result.summary, /queued background workflow/i);
  assert.match(result.summary, /gateway-bound subagent/i);
  assert.equal(typeof result.projectRoot, "string");
  assert.equal(result.projectId, "bird-graph");

  const runtimeQueue = await readWorkflowRuntimeQueueStore(result.projectRoot);
  assert.equal(runtimeQueue.entries.length, 1);
  assert.equal(runtimeQueue.entries[0].status, "degraded");
  assert.equal(runtimeQueue.entries[0].entryType, "background_run");
  assert.equal(runtimeQueue.entries[0].kind, "resume_pipeline");
  const drained = await drainQueuedBackgroundWorkflowRuns({
    projectsRoot,
  });
  assert.equal(drained.remaining.length, 1);
  assert.ok(["queued", "degraded"].includes(drained.remaining[0].status));
  assert.equal(drained.remaining[0].kind, "resume_pipeline");
});

test("startBackgroundWorkflowRun can bootstrap a research-queue continuation", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const runCalls = [];

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const result = await startBackgroundWorkflowRun({
    workflowRuntime: {
      async run(params) {
        runCalls.push(params);
        return { runId: "bg-run-queue-1" };
      },
    },
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:queue-room",
      sessionId: "session-bg-queue-1",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: null,
      projectId: null,
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "research_queue",
      topic: 'add "semantic shift queue topic"',
      summary: "Starting queue background task",
    },
  });

  assert.equal(result.started, true);
  assert.equal(result.runId, "bg-run-queue-1");
  assert.equal(runCalls.length, 1);
  assert.match(
    runCalls[0].sessionKey,
    /^agent:researcher:discord:group:queue-room:subagent:/
  );
  assert.equal(runCalls[0].deliver, false);
  assert.match(runCalls[0].message, /^\/research-queue\b/);
  assert.match(runCalls[0].message, /__BACKGROUND_CONTINUATION__:\s*true/i);
});

test("startBackgroundWorkflowRun caps researcher background subagents at two per channel", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const sharedProjectRoot = path.join(projectsRoot, "birds-room-project");
  const runCalls = [];
  const workflowRuntime = {
    async run(params) {
      runCalls.push(params);
      return { runId: `bg-run-${runCalls.length}` };
    },
  };

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(sharedProjectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "birds-room-project",
    current_stage: "graph_build",
    owner_agent: "researcher",
    idle_research: { enabled: false },
  });

  const baseParams = {
    workflowRuntime,
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:birds-room",
      sessionId: "session-bg-limit-1",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: sharedProjectRoot,
      projectId: "birds-room-project",
      channelProjectBindingsEnabled: true,
    },
  };

  const first = await startBackgroundWorkflowRun({
    ...baseParams,
    backgroundRun: {
      kind: "research_pipeline",
      topic: "bird species discovery",
      projectRoot: sharedProjectRoot,
      projectId: "birds-room-project",
    },
  });
  const second = await startBackgroundWorkflowRun({
    ...baseParams,
    backgroundRun: {
      kind: "research_pipeline",
      topic: "avian migration drift",
      projectRoot: sharedProjectRoot,
      projectId: "birds-room-project",
    },
  });
  const third = await startBackgroundWorkflowRun({
    ...baseParams,
    backgroundRun: {
      kind: "research_pipeline",
      topic: "wetland morphology signals",
      projectRoot: sharedProjectRoot,
      projectId: "birds-room-project",
    },
  });

  assert.equal(first.started, true);
  assert.equal(second.started, true);
  assert.equal(third.started, false);
  assert.equal(third.reason, "channel_capacity_reached");
  assert.equal(third.queued, true);
  assert.equal(third.runId, null);
  assert.equal(third.activeResearcherSessionsInChannel, 2);
  assert.match(third.summary, /queued/i);
  assert.equal(runCalls.length, 2);
});

test("queued researcher background runs persist and auto-replay when a pooled session becomes idle", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const sharedProjectRoot = path.join(projectsRoot, "birds-room-project");
  const runCalls = [];
  const completedRunIds = new Set();
  const workflowRuntime = {
    async run(params) {
      runCalls.push(params);
      return { runId: `bg-run-${runCalls.length}` };
    },
    async waitForRun(params) {
      return completedRunIds.has(params.runId)
        ? { status: "ok" }
        : { status: "timeout" };
    },
  };

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(sharedProjectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "birds-room-project",
    current_stage: "graph_build",
    owner_agent: "researcher",
    idle_research: { enabled: false },
  });

  const baseParams = {
    workflowRuntime,
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:birds-room",
      sessionId: "session-bg-limit-queued",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: sharedProjectRoot,
      projectId: "birds-room-project",
      channelProjectBindingsEnabled: true,
    },
  };

  const first = await startBackgroundWorkflowRun({
    ...baseParams,
    backgroundRun: {
      kind: "research_pipeline",
      topic: "bird species discovery",
      projectRoot: sharedProjectRoot,
      projectId: "birds-room-project",
    },
  });
  const second = await startBackgroundWorkflowRun({
    ...baseParams,
    backgroundRun: {
      kind: "research_pipeline",
      topic: "avian migration drift",
      projectRoot: sharedProjectRoot,
      projectId: "birds-room-project",
    },
  });
  const queued = await startBackgroundWorkflowRun({
    ...baseParams,
    backgroundRun: {
      kind: "research_pipeline",
      topic: "wetland morphology signals",
      projectRoot: sharedProjectRoot,
      projectId: "birds-room-project",
    },
  });

  assert.equal(first.started, true);
  assert.equal(second.started, true);
  assert.equal(queued.started, false);
  assert.equal(queued.queued, true);

  completedRunIds.add(first.runId);
  const drain = await drainQueuedBackgroundWorkflowRuns({
    workflowRuntime,
    projectsRoot,
  });

  assert.equal(drain.started.length, 1);
  assert.equal(drain.remaining.length, 0);
  assert.equal(drain.started[0].reason, "started");
  assert.equal(drain.started[0].queued, false);
  assert.equal(typeof drain.started[0].sessionKey, "string");
  assert.equal(runCalls.length, 3);

  const firstSessions = await readWorkflowRuntimeSessionsStore(first.projectRoot);
  const queuedQueue = await readWorkflowRuntimeQueueStore(queued.projectRoot);
  assert.equal(firstSessions.entries.length, 2);
  assert.equal(
    firstSessions.entries.some(
      (entry) => entry.sessionKey === first.sessionKey && entry.runId === "bg-run-3"
    ),
    true
  );
  assert.equal(
    firstSessions.entries.some(
      (entry) => entry.sessionKey === second.sessionKey && entry.status === "active"
    ),
    true
  );
  assert.equal(
    queuedQueue.entries.find((entry) => entry.queueKey === first.queueKey)?.status,
    "completed"
  );
  assert.equal(
    queuedQueue.entries.find((entry) => entry.queueKey === second.queueKey)?.status,
    "running"
  );
  assert.equal(
    queuedQueue.entries.find((entry) => entry.queueKey === queued.queueKey)?.status,
    "running"
  );
});

test("queued dispatch replay accepts already-active owner sessions without a fresh run id", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const projectRoot = path.join(projectsRoot, "already-active-project");
  const sessionKey = "agent:researcher:discord:group:already-active-room";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "already-active-project",
    current_stage: "idea",
    owner_agent: "researcher",
  });

  await enqueueQueuedBackgroundWorkflowRun({
    source: "workflow_auto_mitigation",
    ownerAgent: "researcher",
    requesterSessionKey: sessionKey,
    messageChannel: "discord",
    preferredSessionKey: sessionKey,
    family: "research",
    kind: "workflow_mitigation_dispatch",
    projectId: "already-active-project",
    projectRoot,
    projectsRoot,
    queueKey: "already-active-dispatch",
    summary: "Continue the already active idea-stage owner.",
    dispatchPayload: {
      requesterChannel: "discord",
      requesterAccountId: null,
      preferredSessionKeys: [sessionKey],
      fromRole: "researcher",
      toRole: "researcher",
      projectRoot,
      projectId: "already-active-project",
      stage: "idea",
      summary: "Continue the already active idea-stage owner.",
      command: "/idea-phase",
      mailboxMessageId: null,
      requireMailboxAcknowledgement: true,
      extraBody: null,
      waitTimeoutMs: 5000,
      retryOnTimeout: true,
      enableSpawnFallback: true,
      useWorkflowHandoff: true,
      autoModeActive: true,
    },
  });

  const drained = await drainQueuedBackgroundWorkflowRuns({
    workflowRuntime: {
      async run() {
        throw new Error("already-active dispatch should not start a fresh run");
      },
    },
    projectsRoot,
    handoffWorkflowTaskToAgent: async () => ({
      dispatched: true,
      sessionKey,
      runId: null,
      waitStatus: null,
      channel: "sessions_send",
      strategy: "already_active",
      attempts: [],
      fallbackSpawned: false,
      acknowledgedByMailbox: false,
      error: null,
      backend: "native",
      lobsterStatus: null,
      fallbackReason: null,
    }),
  });

  assert.equal(drained.started.length, 1);
  assert.equal(drained.remaining.length, 0);
  assert.match(drained.started[0].runId, /^already-active:/);
  assert.equal(drained.started[0].sessionKey, sessionKey);

  const sessions = await readWorkflowRuntimeSessionsStore(projectRoot);
  assert.equal(sessions.entries.length, 1);
  assert.equal(sessions.entries[0].sessionKey, sessionKey);
  assert.match(sessions.entries[0].runId, /^already-active:/);

  const queue = await readWorkflowRuntimeQueueStore(projectRoot);
  assert.equal(
    queue.entries.find((entry) => entry.queueKey === "already-active-dispatch")?.status,
    "running"
  );
});

test("queued background workflow lifecycle is recorded in workflow-events.jsonl", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const sharedProjectRoot = path.join(projectsRoot, "audit-room-project");
  const runCalls = [];
  const completedRunIds = new Set();
  const workflowRuntime = {
    async run(params) {
      runCalls.push(params);
      return { runId: `bg-run-${runCalls.length}` };
    },
    async waitForRun(params) {
      return completedRunIds.has(params.runId)
        ? { status: "ok" }
        : { status: "timeout" };
    },
  };

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(sharedProjectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "audit-room-project",
    current_stage: "graph_build",
    owner_agent: "researcher",
    idle_research: { enabled: false },
  });

  const baseParams = {
    workflowRuntime,
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:audit-room",
      sessionId: "session-bg-audit-1",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: sharedProjectRoot,
      projectId: "audit-room-project",
      channelProjectBindingsEnabled: true,
    },
  };

  const first = await startBackgroundWorkflowRun({
    ...baseParams,
    backgroundRun: {
      kind: "research_pipeline",
      topic: "bird species discovery",
      projectRoot: sharedProjectRoot,
      projectId: "audit-room-project",
    },
  });
  await startBackgroundWorkflowRun({
    ...baseParams,
    backgroundRun: {
      kind: "research_pipeline",
      topic: "avian migration drift",
      projectRoot: sharedProjectRoot,
      projectId: "audit-room-project",
    },
  });
  const queued = await startBackgroundWorkflowRun({
    ...baseParams,
    backgroundRun: {
      kind: "research_pipeline",
      topic: "wetland morphology signals",
      projectRoot: sharedProjectRoot,
      projectId: "audit-room-project",
    },
  });

  assert.equal(queued.started, false);
  const queuedEvents = await readWorkflowRuntimeEvents(queued.projectRoot);
  assert.ok(
    queuedEvents.some((event) => event.kind === "background_queue_enqueued"),
    "expected queue enqueue event in workflow-events.jsonl"
  );

  completedRunIds.add(first.runId);
  await drainQueuedBackgroundWorkflowRuns({
    workflowRuntime,
    projectsRoot,
  });

  const replayedEvents = await readWorkflowRuntimeEvents(queued.projectRoot);
  assert.ok(
    replayedEvents.some((event) => event.kind === "background_queue_replayed"),
    "expected queue replay event in workflow-events.jsonl"
  );
  assert.ok(
    replayedEvents.some((event) => event.kind === "background_session_recorded"),
    "expected background session record event in workflow-events.jsonl"
  );
});

test("drainQueuedBackgroundWorkflowRuns marks projectless workflow dispatch entries as needs_repair instead of legacy fallback", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const handoffCalls = [];

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await enqueueQueuedBackgroundWorkflowRun({
    source: "workflow_auto_stage",
    ownerAgent: "researcher",
    requesterSessionKey: "agent:researcher:discord:group:legacy-room",
    messageChannel: "discord",
    preferredSessionKey: "agent:researcher:discord:group:legacy-room:subagent:alpha",
    family: "research",
    kind: "workflow_stage_dispatch",
    projectId: "alpha",
    queueKey: "legacy-missing-project",
    summary: "Legacy queued workflow dispatch",
    dispatchPayload: {
      requesterChannel: "discord",
      requesterAccountId: null,
      preferredSessionKeys: ["agent:researcher:discord:group:legacy-room:subagent:alpha"],
      fromRole: "researcher",
      toRole: "researcher",
      projectRoot: "/tmp/projects/alpha",
      projectId: "alpha",
      stage: "experiment",
      summary: "Run one bounded experiment pass.",
      command: "/run-experiments",
      mailboxMessageId: null,
      requireMailboxAcknowledgement: true,
      extraBody: null,
      waitTimeoutMs: 5000,
      retryOnTimeout: true,
      enableSpawnFallback: true,
      useWorkflowHandoff: true,
      autoModeActive: true,
    },
  });

  const drained = await drainQueuedBackgroundWorkflowRuns({
    workflowRuntime: {
      async run() {
        return { runId: "should-not-run" };
      },
    },
    handoffWorkflowTaskToAgent: async (params) => {
      handoffCalls.push(params);
      return {
        dispatched: true,
        sessionKey: "agent:researcher:discord:group:legacy-room:subagent:alpha",
        runId: "legacy-handoff-run",
        waitStatus: "ok",
        channel: "sessions_send",
        strategy: "direct_session",
        attempts: [],
        fallbackSpawned: false,
        acknowledgedByMailbox: false,
        error: null,
        backend: "native",
        lobsterStatus: null,
        fallbackReason: null,
      };
    },
  });

  assert.equal(handoffCalls.length, 0);
  assert.equal(drained.started.length, 0);
  assert.equal(drained.remaining.length, 1);
  assert.equal(drained.remaining[0].queueKey, "legacy-missing-project");
  assert.equal(drained.remaining[0].status, "needs_repair");
});

test("startBackgroundWorkflowRun scopes the researcher subagent cap per project within the same channel", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const alphaProjectRoot = path.join(projectsRoot, "alpha");
  const betaProjectRoot = path.join(projectsRoot, "beta");
  const runCalls = [];
  const workflowRuntime = {
    async run(params) {
      runCalls.push(params);
      return { runId: `bg-run-${runCalls.length}` };
    },
  };

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(alphaProjectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "alpha",
    current_stage: "graph_build",
    owner_agent: "researcher",
    idle_research: { enabled: false },
  });
  await writeJson(path.join(betaProjectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "beta",
    current_stage: "graph_build",
    owner_agent: "researcher",
    idle_research: { enabled: false },
  });

  await startBackgroundWorkflowRun({
    workflowRuntime,
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:birds-room",
      sessionId: "session-bg-limit-a",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: alphaProjectRoot,
      projectId: "alpha",
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "research_pipeline",
      topic: "bird species discovery",
      projectRoot: alphaProjectRoot,
      projectId: "alpha",
    },
  });
  await startBackgroundWorkflowRun({
    workflowRuntime,
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:birds-room",
      sessionId: "session-bg-limit-b",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: alphaProjectRoot,
      projectId: "alpha",
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "research_pipeline",
      topic: "avian migration drift",
      projectRoot: alphaProjectRoot,
      projectId: "alpha",
    },
  });

  const otherProjectSameChannel = await startBackgroundWorkflowRun({
    workflowRuntime,
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:birds-room",
      sessionId: "session-bg-limit-c",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: betaProjectRoot,
      projectId: "beta",
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "research_pipeline",
      topic: "wetland morphology signals",
      projectRoot: betaProjectRoot,
      projectId: "beta",
    },
  });

  assert.equal(otherProjectSameChannel.started, true);
  assert.equal(runCalls.length, 3);
});

test("startBackgroundWorkflowRun reuses an idle researcher subagent session for the same channel, project, and workflow kind", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const runCalls = [];
  const completedRunIds = new Set();
  const workflowRuntime = {
    async run(params) {
      runCalls.push(params);
      return { runId: `bg-run-${runCalls.length}` };
    },
    async waitForRun(params) {
      return completedRunIds.has(params.runId)
        ? { status: "ok" }
        : { status: "timeout" };
    },
  };

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const baseParams = {
    workflowRuntime,
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:reuse-room",
      sessionId: "session-bg-reuse-1",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: null,
      projectId: null,
      channelProjectBindingsEnabled: true,
    },
  };

  const first = await startBackgroundWorkflowRun({
    ...baseParams,
    backgroundRun: {
      kind: "research_pipeline",
      projectId: "bird-graph",
      topic: "bird species discovery",
    },
  });
  completedRunIds.add(first.runId);

  const second = await startBackgroundWorkflowRun({
    ...baseParams,
    backgroundRun: {
      kind: "research_pipeline",
      projectId: "bird-graph",
      topic: "bird shortlist refresh",
    },
  });

  assert.equal(first.started, true);
  assert.equal(second.started, true);
  assert.equal(second.reusedIdleSession, true);
  assert.equal(runCalls.length, 2);
  assert.equal(second.sessionKey, first.sessionKey);
  assert.equal(runCalls[1].sessionKey, runCalls[0].sessionKey);
});

test("background workflow run inventory reports active then idle sessions and prune removes eligible idle entries", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const runCalls = [];
  const deletedSessions = [];
  const completedRunIds = new Set();
  const workflowRuntime = {
    async run(params) {
      runCalls.push(params);
      return { runId: `bg-run-${runCalls.length}` };
    },
    async waitForRun(params) {
      return completedRunIds.has(params.runId)
        ? { status: "ok" }
        : { status: "timeout" };
    },
    async deleteSession(params) {
      deletedSessions.push(params);
    },
  };

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const launch = await startBackgroundWorkflowRun({
    workflowRuntime,
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:inventory-room",
      sessionId: "session-bg-inventory-1",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: null,
      projectId: null,
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "research_pipeline",
      projectId: "inventory-project",
      topic: "inventory topic",
    },
  });

  const activeInventory = await listBackgroundWorkflowRuns({
    workflowRuntime,
    ownerAgent: "researcher",
    projectsRoot,
  });
  assert.equal(activeInventory.entries.length, 1);
  assert.equal(activeInventory.entries[0].status, "active");
  assert.equal(activeInventory.entries[0].deleteEligible, false);

  completedRunIds.add(launch.runId);

  const idleInventory = await listBackgroundWorkflowRuns({
    workflowRuntime,
    ownerAgent: "researcher",
    projectsRoot,
  });
  assert.equal(idleInventory.entries.length, 1);
  assert.equal(idleInventory.entries[0].status, "idle");
  assert.equal(idleInventory.entries[0].deleteEligible, true);

  const pruned = await pruneBackgroundWorkflowRuns({
    workflowRuntime,
    ownerAgent: "researcher",
    projectsRoot,
    idleOlderThanMs: 0,
    deleteSessions: true,
  });
  assert.equal(pruned.removed.length, 1);
  assert.equal(pruned.removed[0].status, "idle");
  assert.equal(deletedSessions.length, 1);

  const afterPrune = await listBackgroundWorkflowRuns({
    workflowRuntime,
    ownerAgent: "researcher",
    projectsRoot,
  });
  assert.equal(afterPrune.entries.length, 0);
});

test("retireBackgroundWorkflowRuns force-removes matching pooled sessions by status", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const deletedSessions = [];
  const workflowRuntime = {
    async run() {
      return { runId: "bg-run-retire-1" };
    },
    async waitForRun() {
      return { status: "timeout" };
    },
    async deleteSession(params) {
      deletedSessions.push(params);
    },
  };

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await startBackgroundWorkflowRun({
    workflowRuntime,
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:retire-room",
      sessionId: "session-bg-retire-1",
      messageChannel: "discord",
    },
    snapshot: {
      role: "researcher",
      projectRoot: null,
      projectId: null,
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "research_pipeline",
      projectId: "retire-project",
      topic: "retire topic",
    },
  });

  const retired = await retireBackgroundWorkflowRuns({
    workflowRuntime,
    ownerAgent: "researcher",
    projectId: "retire-project",
    projectsRoot,
    statuses: ["active"],
    deleteSessions: true,
  });
  assert.equal(retired.removed.length, 1);
  assert.equal(retired.removed[0].status, "active");
  assert.equal(deletedSessions.length, 1);

  const afterRetire = await listBackgroundWorkflowRuns({
    workflowRuntime,
    ownerAgent: "researcher",
    projectId: "retire-project",
    projectsRoot,
  });
  assert.equal(afterRetire.entries.length, 0);
});
