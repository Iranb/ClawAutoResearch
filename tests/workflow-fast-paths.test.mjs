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
} from "../tools/workflow-guard.ts";
import {
  readWorkflowRuntimeEvents,
  readWorkflowRuntimeQueueStore,
  readWorkflowRuntimeSessionsStore,
} from "../tools/workflow-runtime-state.ts";
import {
  buildPapernexusWrapperCommand,
  buildPapernexusSkillBackgroundCommand,
  buildGraphBuildBackgroundCommand,
  buildResearchPipelineBackgroundCommand,
  buildResearchQueueBackgroundCommand,
  clearBackgroundWorkflowQueueForTests,
  drainQueuedBackgroundWorkflowRuns,
  clearBackgroundWorkflowRunRegistryForTests,
  enqueueQueuedBackgroundWorkflowRun,
  listBackgroundWorkflowRuns,
  pruneBackgroundWorkflowRuns,
  retireBackgroundWorkflowRuns,
  startBackgroundWorkflowRun,
} from "../tools/workflow-fast-paths.ts";

async function makeTempWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-fast-paths-"));
}

test.beforeEach(async () => {
  await clearBackgroundWorkflowRunRegistryForTests();
  await clearBackgroundWorkflowQueueForTests();
});

test.afterEach(async () => {
  await clearBackgroundWorkflowRunRegistryForTests();
  await clearBackgroundWorkflowQueueForTests();
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

test("buildPapernexusSkillBackgroundCommand appends the continuation marker once", () => {
  const command = buildPapernexusSkillBackgroundCommand(
    'python3 scripts/pn_graph_query.py --api-base "https://papernexus.example/api" --corpus "demo" query "topic" --limit 8'
  );
  assert.match(command, /__BACKGROUND_CONTINUATION__:\s*true/i);
  assert.equal(buildPapernexusSkillBackgroundCommand(command), command);
});

test("buildPapernexusWrapperCommand renders a wrapper-first python command", () => {
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

  assert.match(command, /^python3 scripts\/pn_graph_query\.py\b/);
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

  assert.match(command, /^python3 scripts\/pn_batch_import\.py\b/);
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
        runtimeSubagent: {
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
    runtimeSubagent: {
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
    runtimeSubagent: {
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

test("startBackgroundWorkflowRun gives graph-build continuations explicit Zotero bot sync instructions", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const runCalls = [];

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const result = await startBackgroundWorkflowRun({
    runtimeSubagent: {
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
  assert.match(runCalls[0].extraSystemPrompt ?? "", /bot\/<project-id>|bot\/paper-lab/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /ZOTERO_PACKET\.md/i);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /graph readiness|brainstorm bundle/i);
});

test("startBackgroundWorkflowRun gives graph-build repair continuations explicit import repair instructions", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const runCalls = [];

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const result = await startBackgroundWorkflowRun({
    runtimeSubagent: {
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
        idle_research: { enabled: false },
        paper_ingestion: {
          queued_requests: [
            {
              request_id: "req-batch-1",
              status: "queued",
              wrapper: "pn_batch_import.py",
              command_text:
                "python3 scripts/pn_batch_import.py --api-base https://papernexus.example/api --corpus GCD --manifest /tmp/demo/batch-import.json submit",
              manifest_path: "/tmp/demo/batch-import.json",
              shared_corpus: "GCD",
              paper_count: 4,
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
    runtimeSubagent: {
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
  assert.equal(runCalls.length, 2);
  assert.match(runCalls[0].message, /^python3 scripts\/pn_batch_import\.py\b/);
  assert.match(runCalls[1].message, /^\/graph-build\b/);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /req-batch-1/);
  assert.match(runCalls[0].extraSystemPrompt ?? "", /queue_paper_ingestion|queued_requests/i);
  assert.equal(manifest.paper_ingestion.queued_requests[0].status, "running");
  assert.equal(manifest.paper_ingestion.queued_requests[0].last_run_id, "bg-run-1");
});

test("startBackgroundWorkflowRun for resume-pipeline requeues stale running ingestion requests before triggering upload", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const projectRoot = path.join(projectsRoot, "paper-lab");
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
        idle_research: { enabled: false },
        paper_ingestion: {
          runtime_status: "idle",
          queued_requests: [
            {
              request_id: "req-batch-stale",
              status: "running",
              wrapper: "pn_batch_import.py",
              command_text:
                "python3 scripts/pn_batch_import.py --api-base https://papernexus.example/api --corpus GCD --manifest /tmp/demo/batch-import.json submit",
              manifest_path: "/tmp/demo/batch-import.json",
              shared_corpus: "GCD",
              paper_count: 4,
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
    runtimeSubagent: {
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
  assert.equal(runCalls.length, 2);
  assert.match(runCalls[0].message, /^python3 scripts\/pn_batch_import\.py\b/);
  assert.match(runCalls[1].message, /^\/resume-pipeline\b/);
  assert.equal(manifest.paper_ingestion.queued_requests[0].status, "running");
  assert.equal(manifest.paper_ingestion.queued_requests[0].last_run_id, "bg-run-1");
  assert.match(
    manifest.paper_ingestion.queued_requests[0].detail ?? "",
    /resumed|workflow-triggered|repair/i
  );
});

test("startBackgroundWorkflowRun launches a dedicated subagent continuation and binds the project", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const runCalls = [];
  const sessionKey = "agent:researcher:discord:group:birds-room";

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const result = await startBackgroundWorkflowRun({
    runtimeSubagent: {
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
  await fs.access(
    path.join(result.projectRoot, ".openclaw-research", "channel-project-bindings.json")
  );
  const runtimeQueue = await readWorkflowRuntimeQueueStore(result.projectRoot);
  assert.equal(runtimeQueue.entries.length, 1);
  assert.equal(runtimeQueue.entries[0].status, "running");
  assert.equal(runtimeQueue.entries[0].entryType, "background_run");
  assert.equal(runtimeQueue.entries[0].queueKey, result.queueKey);
});

test("startBackgroundWorkflowRun queues the continuation when runtime subagent access is unavailable", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const result = await startBackgroundWorkflowRun({
    runtimeSubagent: {
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
    runtimeSubagent: {
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
  const runCalls = [];
  const runtimeSubagent = {
    async run(params) {
      runCalls.push(params);
      return { runId: `bg-run-${runCalls.length}` };
    },
  };

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const baseParams = {
    runtimeSubagent,
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
      projectRoot: null,
      projectId: null,
      channelProjectBindingsEnabled: true,
    },
  };

  const first = await startBackgroundWorkflowRun({
    ...baseParams,
    backgroundRun: {
      kind: "research_pipeline",
      topic: "bird species discovery",
    },
  });
  const second = await startBackgroundWorkflowRun({
    ...baseParams,
    backgroundRun: {
      kind: "research_pipeline",
      topic: "avian migration drift",
    },
  });
  const third = await startBackgroundWorkflowRun({
    ...baseParams,
    backgroundRun: {
      kind: "research_pipeline",
      topic: "wetland morphology signals",
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
  const runCalls = [];
  const completedRunIds = new Set();
  const runtimeSubagent = {
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
    runtimeSubagent,
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
      projectRoot: null,
      projectId: null,
      channelProjectBindingsEnabled: true,
    },
  };

  const first = await startBackgroundWorkflowRun({
    ...baseParams,
    backgroundRun: {
      kind: "research_pipeline",
      topic: "bird species discovery",
    },
  });
  const second = await startBackgroundWorkflowRun({
    ...baseParams,
    backgroundRun: {
      kind: "research_pipeline",
      topic: "avian migration drift",
    },
  });
  const queued = await startBackgroundWorkflowRun({
    ...baseParams,
    backgroundRun: {
      kind: "research_pipeline",
      topic: "wetland morphology signals",
    },
  });

  assert.equal(first.started, true);
  assert.equal(second.started, true);
  assert.equal(queued.started, false);
  assert.equal(queued.queued, true);

  completedRunIds.add(first.runId);
  const drain = await drainQueuedBackgroundWorkflowRuns({
    runtimeSubagent,
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
  assert.equal(firstSessions.entries.length, 1);
  assert.equal(firstSessions.entries[0].status, "idle");
  assert.equal(queuedQueue.entries.length, 1);
  assert.equal(queuedQueue.entries[0].status, "running");
});

test("queued background workflow lifecycle is recorded in workflow-events.jsonl", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const runCalls = [];
  const completedRunIds = new Set();
  const runtimeSubagent = {
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
    runtimeSubagent,
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
      projectRoot: null,
      projectId: null,
      channelProjectBindingsEnabled: true,
    },
  };

  const first = await startBackgroundWorkflowRun({
    ...baseParams,
    backgroundRun: {
      kind: "research_pipeline",
      topic: "bird species discovery",
    },
  });
  await startBackgroundWorkflowRun({
    ...baseParams,
    backgroundRun: {
      kind: "research_pipeline",
      topic: "avian migration drift",
    },
  });
  const queued = await startBackgroundWorkflowRun({
    ...baseParams,
    backgroundRun: {
      kind: "research_pipeline",
      topic: "wetland morphology signals",
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
    runtimeSubagent,
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
      extraBody: null,
      waitTimeoutMs: 5000,
      retryOnTimeout: true,
      enableSpawnFallback: true,
      useWorkflowHandoff: true,
      autoModeActive: true,
    },
  });

  const drained = await drainQueuedBackgroundWorkflowRuns({
    runtimeSubagent: {
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

test("startBackgroundWorkflowRun scopes the researcher subagent cap per channel", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const runCalls = [];
  const runtimeSubagent = {
    async run(params) {
      runCalls.push(params);
      return { runId: `bg-run-${runCalls.length}` };
    },
  };

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await startBackgroundWorkflowRun({
    runtimeSubagent,
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
      projectRoot: null,
      projectId: null,
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "research_pipeline",
      topic: "bird species discovery",
    },
  });
  await startBackgroundWorkflowRun({
    runtimeSubagent,
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
      projectRoot: null,
      projectId: null,
      channelProjectBindingsEnabled: true,
    },
    backgroundRun: {
      kind: "research_pipeline",
      topic: "avian migration drift",
    },
  });

  const otherChannel = await startBackgroundWorkflowRun({
    runtimeSubagent,
    workflowPolicy: {
      projectsRoot,
      enableChannelProjectBindings: true,
    },
    agentCtx: {
      agentId: "researcher",
      workspaceDir: workspaceRoot,
      sessionKey: "agent:researcher:discord:group:wetland-room",
      sessionId: "session-bg-limit-c",
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
      topic: "wetland morphology signals",
    },
  });

  assert.equal(otherChannel.started, true);
  assert.equal(runCalls.length, 3);
});

test("startBackgroundWorkflowRun reuses an idle researcher subagent session for the same channel and project family", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const runCalls = [];
  const completedRunIds = new Set();
  const runtimeSubagent = {
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
    runtimeSubagent,
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
      kind: "research_queue",
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
  const runtimeSubagent = {
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
    runtimeSubagent,
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
    runtimeSubagent,
    ownerAgent: "researcher",
    projectsRoot,
  });
  assert.equal(activeInventory.entries.length, 1);
  assert.equal(activeInventory.entries[0].status, "active");
  assert.equal(activeInventory.entries[0].deleteEligible, false);

  completedRunIds.add(launch.runId);

  const idleInventory = await listBackgroundWorkflowRuns({
    runtimeSubagent,
    ownerAgent: "researcher",
    projectsRoot,
  });
  assert.equal(idleInventory.entries.length, 1);
  assert.equal(idleInventory.entries[0].status, "idle");
  assert.equal(idleInventory.entries[0].deleteEligible, true);

  const pruned = await pruneBackgroundWorkflowRuns({
    runtimeSubagent,
    ownerAgent: "researcher",
    projectsRoot,
    idleOlderThanMs: 0,
    deleteSessions: true,
  });
  assert.equal(pruned.removed.length, 1);
  assert.equal(pruned.removed[0].status, "idle");
  assert.equal(deletedSessions.length, 1);

  const afterPrune = await listBackgroundWorkflowRuns({
    runtimeSubagent,
    ownerAgent: "researcher",
    projectsRoot,
  });
  assert.equal(afterPrune.entries.length, 0);
});

test("retireBackgroundWorkflowRuns force-removes matching pooled sessions by status", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const projectsRoot = path.join(workspaceRoot, "projects");
  const deletedSessions = [];
  const runtimeSubagent = {
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
    runtimeSubagent,
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
    runtimeSubagent,
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
    runtimeSubagent,
    ownerAgent: "researcher",
    projectId: "retire-project",
    projectsRoot,
  });
  assert.equal(afterRetire.entries.length, 0);
});
