import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

process.env.OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH = path.join(
  os.tmpdir(),
  "openclaw-research-background-runs-workflow-runtime-tools.json"
);

import { createPluginRegistrationContext } from "../tools/plugin-registration-shared.ts";
import {
  bindChannelProjectForWorkflow,
} from "../tools/workflow-guard.ts";
import {
  clearBackgroundWorkflowRunRegistryForTests,
  recordBackgroundWorkflowRun,
} from "../tools/workflow-fast-paths.ts";
import { registerWorkflowTools } from "../tools/register-workflow-tools.ts";
import {
  getWorkflowRuntimeQueuePath,
  readWorkflowRuntimeEvents,
  getWorkflowRuntimeSessionsPath,
} from "../tools/workflow-runtime-state.ts";
import { getWorkflowTraceLogPath } from "../tools/workflow-trace.ts";

async function makeProjectRoot() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-workflow-tool-runtime-")
  );
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "demo-project",
        current_stage: "write",
        owner_agent: "academic_writer",
        idle_research: { enabled: false },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return projectRoot;
}

function createResearchWorkflowTool(params = {}) {
  let registeredTool = null;
  const api = {
    runtime: params.runtime ?? {},
    logger: {},
    pluginConfig: params.pluginConfig,
    registerTool(spec) {
      registeredTool = spec;
    },
  };
  const plugin = createPluginRegistrationContext(api);
  registerWorkflowTools(plugin);
  assert.ok(registeredTool);
  const tool =
    typeof registeredTool === "function"
      ? registeredTool({
          workspaceDir: params.workspaceDir,
          agentId: params.agentId ?? "researcher",
          sessionKey: params.sessionKey ?? "agent:researcher:test",
          sessionId: params.sessionId ?? "session-test",
          messageChannel: params.messageChannel ?? "discord",
        })
      : registeredTool;
  assert.equal(tool?.name, "research_workflow");
  return tool;
}

async function executeWorkflowTool(tool, params) {
  const response = await tool.execute("test-call", params);
  assert.equal(response.content[0]?.type, "text");
  return JSON.parse(response.content[0].text);
}

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function seedMinimalProject(projectRoot, manifest) {
  await fs.mkdir(path.join(projectRoot, "researcher"), { recursive: true });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    idle_research: { enabled: false },
    ...manifest,
  });
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), {
    tracks: [],
  });
}

async function seedPaperSourceIndex(projectRoot, papers) {
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers,
  });
}

async function writeText(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

async function seedSparseIdeationRepairScenario(projectRoot, tool) {
  await fs.mkdir(path.join(projectRoot, "graph"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "researcher"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "researcher", "brainstorm-cycle"), {
    recursive: true,
  });

  await fs.writeFile(
    path.join(projectRoot, "graph", "ANCHOR_INDEX.md"),
    "# Anchor Index\n- anchor: bias-router\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "graph", "LIMITATION_FRONTIER.md"),
    "# Limitation Frontier\n- baseline calibration still leaks confirmation bias\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "graph", "TRANSFER_FRONTIER.md"),
    "# Transfer Frontier\n- import consistent alignment into GCD debiasing\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "FRONTIER_REPORT.md"),
    "# Frontier Report\n\n## Challenge clusters\n- confirmation bias persists in pseudo-labeling\n\n## Insight clusters\n- alignment-aware debiasing\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "INNOVATION_REFLECTION.md"),
    "# Innovation Reflection\nKeep the frequency-debiased track and a TALON-inspired fallback.\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "LOGIC_CHAIN.md"),
    "# Logic Chain\n1. Challenge: pseudo-label bias\n2. Insight: graph-grounded debiasing\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "EVIDENCE_CHAIN.md"),
    "# Evidence Chain\n- frontier packets show calibration failures\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "QUESTION_PACKET.md"),
    "# Questions\n- how to stabilize debiasing across seeds?\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "SYNTHESIS_PACKET.md"),
    "# Synthesis\n- favor frequency-debiased routing\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "WORKING_MEMORY.json"),
    `${JSON.stringify({ selected_track_id: "fd-gcd-freq-debiased" }, null, 2)}\n`,
    "utf8"
  );
  await writeJson(
    path.join(
      projectRoot,
      "researcher",
      "reasoning",
      "fd-gcd-freq-debiased",
      "GRAPH_EVIDENCE.json"
    ),
    {
      source: "papernexus_remote_mcp",
      graph_nodes: ["paper:fd-1", "finding:fd-gap"],
      evidence_pointers: [
        "researcher/reasoning/fd-gcd-freq-debiased/GRAPH_EVIDENCE.json#paper:fd-1",
      ],
      relation_patterns: ["supports->track:fd-gcd-freq-debiased"],
    }
  );
  await writeJson(
    path.join(
      projectRoot,
      "researcher",
      "reasoning",
      "talon-gcd-bias",
      "GRAPH_EVIDENCE.json"
    ),
    {
      source: "papernexus_remote_mcp",
      graph_nodes: ["paper:talon-1", "finding:talon-gap"],
      evidence_pointers: [
        "researcher/reasoning/talon-gcd-bias/GRAPH_EVIDENCE.json#paper:talon-1",
      ],
      relation_patterns: ["supports->track:talon-gcd-bias"],
    }
  );

  await fs.writeFile(
    path.join(projectRoot, "TRACK_REGISTRY.json"),
    `${JSON.stringify(
      {
        tracks: [
          {
            track_id: "fd-gcd-freq-debiased",
            status: "active",
            name: "Frequency-Debiased GCD",
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.owner_agent = "researcher";
  manifest.active_track_ids = ["talon-gcd-bias", "part-level-gcd"];
  manifest.primary_track_id = "talon-gcd-bias";
  manifest.research_program = {
    status: "approved",
    goal: "Reduce confirmation bias in GCD with graph-grounded debiasing.",
    problem_statement: "Known-class bias dominates the pseudo-label loop in GCD.",
    baseline_reference: "SimGCD",
    primary_metric: "All Accuracy (ACC)",
    datasets: ["CUB-200"],
    success_criteria: ["All ACC > 53.4% on C-GCD"],
    zotero_project_path: "bot/demo-project",
    tracks: [
      {
        track_id: "fd-gcd-freq-debiased",
        status: "active",
        hypothesis:
          "Frequency-domain debiasing plus alignment reduces confirmation bias in pseudo-labeling.",
        novelty_basis: "Compose DEBGCD, FREE, and consistent alignment into a graph-backed track.",
        required_baselines: ["SimGCD"],
      },
      {
        track_id: "talon-gcd-bias",
        status: "active",
        hypothesis:
          "Margin-aware TALON-style calibration reduces confirmation bias in the novel-class tail.",
        novelty_basis: "Compose TALON-style calibration with GCD pseudo-label control.",
        required_baselines: ["SimGCD"],
      },
    ],
  };
  manifest.innovation_reflection = {
    status: "fresh",
    last_reflection_path: "researcher/INNOVATION_REFLECTION.md",
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await executeWorkflowTool(tool, {
    action: "run_brainstorm_cycle",
    brainstormCycle: {
      topic: "Frequency-debiased GCD",
      basis_stage: "experiment_analysis",
      track_id: "fd-gcd-freq-debiased",
      provider: "workflow_core_brainstorm",
      provider_mode: "core",
      graph_version_seen: "GCD-2026-04-06",
      contract_version: 1,
      rounds: [
        {
          round_id: "round-1",
          label: "converge",
          status: "completed",
          options: [
            {
              option_id: "dir-main",
              title: "Frequency-debiased pseudo-label routing",
              score: 0.93,
              summary: "Use graph-backed debiasing signals to stabilize GCD pseudo-labels.",
              logic_chain: "# Logic Main\nChallenge -> debiasing -> evidence\n",
              evidence_chain: "# Evidence Main\nCalibration failures + transfer evidence\n",
              reasoning_trace: [
                {
                  step: "inspect-calibration-gap",
                  conclusion: "need a graph-backed debiasing route",
                },
              ],
              question_packet: "# Questions Main\n",
              working_memory: {
                surviving_direction: "frequency-debiased pseudo-label routing",
              },
              synthesis_packet: "# Synthesis Main\n",
              reflection_chain: {
                keep: ["frequency-debiased pseudo-label routing"],
              },
              storyline_brief: {
                thesis: "Challenge -> debiasing -> evidence-backed stability",
              },
            },
          ],
        },
      ],
    },
  });

  return { manifestPath };
}

test("research_workflow get_papernexus_remote_access returns a redacted token status", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const previousToken = process.env.PAPERNEXUS_API_TOKEN;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_API_TOKEN;
    } else {
      process.env.PAPERNEXUS_API_TOKEN = previousToken;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  process.env.PAPERNEXUS_API_TOKEN = "super-secret-token";
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    pluginConfig: {
      papernexusApiBaseUrl: "https://papernexus.example/api",
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "PAPERNEXUS_API_TOKEN",
      papernexusApiTokenService: "papernexus-api-token",
      papernexusApiTokenAccount: "default",
    },
  });

  const result = await executeWorkflowTool(tool, {
    action: "get_papernexus_remote_access",
  });
  assert.equal(result.tokenAvailable, true);
  assert.equal(result.tokenSourceResolved, "env");
  assert.equal(result.token, "[REDACTED]");
  assert.equal(result.summary.tokenSourceConfigured, "env");
  assert.equal(result.summary.tokenEnv, "PAPERNEXUS_API_TOKEN");
});

test("research_workflow survey-review actions persist and read durable survey state", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  const setResult = await executeWorkflowTool(tool, {
    action: "set_survey_review",
    surveyReview: {
      topic: "Graph reasoning survey",
      mode: "deep",
      status: "searching",
      current_phase: "retrieval",
      candidate_paper_count: 72,
      query_round_count: 10,
    },
  });
  assert.equal(setResult.state.topic, "Graph reasoning survey");
  assert.equal(setResult.state.status, "searching");
  assert.equal(setResult.state.queryRoundCount, 10);

  const summary = await executeWorkflowTool(tool, {
    action: "get_survey_review",
  });
  assert.equal(summary.state.topic, "Graph reasoning survey");
  assert.equal(summary.state.mode, "deep");
  assert.equal(summary.state.candidatePaperCount, 72);
  assert.equal(summary.state.queryRoundCount, 10);
});

test("research_workflow gate-state actions persist timed-default confirmation metadata", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  const setResult = await executeWorkflowTool(tool, {
    action: "set_gate_state",
    gateState: {
      current_stage: "review",
      last_gate: "CONFIRM-RESUME-1",
      gate_status: "waiting",
      gate_type: "timed_default",
      auto_proceed: false,
      confirmation_requested_at: "2026-03-28T09:00:00.000Z",
      confirmation_deadline_at: "2026-03-28T10:00:00.000Z",
      default_action: "resume_recommended_stage",
      default_action_reason:
        "No user reply within 1h; continue with the workflow-safe default branch.",
    },
  });
  assert.equal(setResult.state.gateType, "timed_default");
  assert.equal(setResult.timedDefaultEligible, true);

  const summary = await executeWorkflowTool(tool, {
    action: "get_gate_state",
  });
  assert.equal(summary.state.lastGate, "CONFIRM-RESUME-1");
  assert.equal(summary.state.confirmationDeadlineAt, "2026-03-28T10:00:00.000Z");
  assert.equal(summary.timedDefaultEligible, true);
});

test("research_workflow paper-ingestion actions persist formal waiting and reconcile states", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  const setImportWaiting = await executeWorkflowTool(tool, {
    action: "set_paper_ingestion",
    paperIngestion: {
      runtime_status: "waiting_import",
      waiting_reason: "Queued PaperNexus import imp-42 is still parsing the uploaded PDF.",
      import_task_ids: ["imp-42"],
      last_import_task_id: "imp-42",
      last_import_status: "running",
      graph_version_seen: "shared-global-v41",
      reconcile_required: false,
    },
  });
  assert.equal(setImportWaiting.state.runtimeStatus, "waiting_import");
  assert.equal(setImportWaiting.state.importTaskIds.length, 1);

  const setReconcile = await executeWorkflowTool(tool, {
    action: "set_paper_ingestion",
    paperIngestion: {
      runtime_status: "reconciling",
      waiting_reason: "A newer shared graph version is available and the current topic packets must reconcile.",
      import_task_ids: ["imp-42"],
      last_import_task_id: "imp-42",
      last_import_status: "completed",
      graph_version_seen: "shared-global-v42",
      reconcile_required: true,
    },
  });
  assert.equal(setReconcile.state.runtimeStatus, "reconciling");
  assert.equal(setReconcile.state.reconcileRequired, true);

  const summary = await executeWorkflowTool(tool, {
    action: "get_paper_ingestion",
  });
  assert.equal(summary.state.runtimeStatus, "reconciling");
  assert.equal(summary.state.lastImportStatus, "completed");
  assert.equal(summary.state.graphVersionSeen, "shared-global-v42");
  assert.equal(summary.state.reconcileRequired, true);

  const snapshot = await executeWorkflowTool(tool, {
    action: "get_snapshot",
  });
  assert.equal(snapshot.paperIngestionRuntimeStatus, "reconciling");
  assert.equal(snapshot.paperIngestionReconcileRequired, true);
  assert.equal(snapshot.paperIngestionImportTaskCount, 1);
});

test("research_workflow queue_paper_ingestion persists a durable workflow-owned upload request", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  const result = await executeWorkflowTool(tool, {
    action: "queue_paper_ingestion",
    paperIngestionRequest: {
      wrapper: "pn_batch_import.py",
      args: [
        "--api-base",
        "https://papernexus.example/api",
        "--corpus",
        "GCD",
        "--manifest",
        "/tmp/demo/batch-import.json",
        "submit",
      ],
      summary: "Queue shared-corpus batch import for graph-build.",
      manifest_path: "/tmp/demo/batch-import.json",
      shared_corpus: "GCD",
      paper_count: 4,
    },
  });

  assert.equal(result.request.status, "queued");
  assert.equal(result.request.wrapper, "pn_batch_import.py");
  assert.equal(result.request.sharedCorpus, "GCD");
  assert.equal(result.request.paperCount, 4);
  assert.match(result.request.commandText ?? "", /python3 scripts\/pn_batch_import\.py/);
  assert.equal(result.state.queuedRequests.length, 1);

  const snapshot = await executeWorkflowTool(tool, {
    action: "get_snapshot",
  });
  assert.equal(snapshot.paperIngestionQueuedRequestCount, 1);
  assert.equal(snapshot.paperIngestionRunningRequestCount, 0);
});

test("research_workflow queue_paper_ingestion initializes PAPERNEXUS_PROGRESS.json with staging progress", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  await executeWorkflowTool(tool, {
    action: "queue_paper_ingestion",
    paperIngestionRequest: {
      wrapper: "pn_batch_import.py",
      args: [
        "--mcp-url",
        "https://papernexus.example/mcp",
        "--corpus",
        "GCD",
        "--manifest",
        "/tmp/demo/batch-import.json",
        "submit",
      ],
      summary: "Queue shared-corpus batch import for graph-build.",
      manifest_path: "/tmp/demo/batch-import.json",
      shared_corpus: "GCD",
      paper_count: 4,
    },
  });

  const progress = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "graph", "PAPERNEXUS_PROGRESS.json"),
      "utf8"
    )
  );
  assert.equal(progress.phase, "staging");
  assert.equal(progress.batch.total_items, 4);
  assert.equal(progress.batch.pending_items, 4);
  assert.equal(progress.progress.completed_ratio, 0);
  assert.equal(progress.progress.percent, 0);
});

test("research_workflow get_snapshot reconciles finished uploads and refreshes graph presence during graph_build", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const previousToken = process.env.PAPERNEXUS_API_TOKEN;
  const requests = [];
  const completedRunIds = new Set(["bg-run-snapshot-1"]);
  const server = http.createServer(async (request, response) => {
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization ?? null,
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        rootPath: "/remote/corpora/shared-global-graph",
        meta: {
          name: "shared-global-graph",
          rootPath: "/remote/corpora/shared-global-graph",
        },
        manifest: {
          corpusName: "shared-global-graph",
          rootPath: "/remote/corpora/shared-global-graph",
        },
        sources: [
          {
            sourceKey: "/remote/corpora/shared-global-graph/md/2603.08075--demo-paper.md",
            inputPath: "/remote/corpora/shared-global-graph/md/2603.08075--demo-paper.md",
            paperId: "paper:2603.08075",
            paperTitle: "Demo Paper",
            activeInGraph: true,
          },
        ],
      })
    );
  });

  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_API_TOKEN;
    } else {
      process.env.PAPERNEXUS_API_TOKEN = previousToken;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  process.env.OPENCLAW_PROJECT = projectRoot;
  process.env.PAPERNEXUS_API_TOKEN = "test-token";
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "2603.08075",
      title: "Demo Paper",
      arxiv_id: "2603.08075",
      source_path: path.join(projectRoot, "researcher", "paper-staging", "2603.08075.md"),
    },
  ]);
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "graph_build",
    current_micro_stage: "verifying",
    owner_agent: "researcher",
    idle_research: { enabled: false },
    paper_ingestion: {
      runtime_status: "waiting_import",
      waiting_reason: "Background upload still appears to be active.",
      graph_presence_status: "missing_papers",
      graph_presence_checked_at: "2026-04-08T00:00:00.000Z",
      refresh_required: true,
      refresh_reason: "Graph presence is stale.",
      queued_requests: [
        {
          request_id: "req-graph-refresh-1",
          wrapper: "pn_batch_import.py",
          command_text:
            "python3 scripts/pn_batch_import.py --api-base https://papernexus.example/api --corpus GCD --manifest /tmp/demo/batch-import.json submit",
          status: "running",
          last_run_id: "bg-run-snapshot-1",
          last_session_key:
            "agent:researcher:discord:group:paper-lab:subagent:papernexus-skill:corpus:demo-project",
          updated_at: "2026-04-08T00:00:00.000Z",
        },
      ],
    },
  });
  await recordBackgroundWorkflowRun({
    ownerAgent: "researcher",
    channelKey: "discord:group:paper-lab",
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    backgroundSessionKey:
      "agent:researcher:discord:group:paper-lab:subagent:papernexus-skill:corpus:demo-project",
    runId: "bg-run-snapshot-1",
    queueKey: "background:papernexus:demo-project:upload",
    kind: "papernexus_wrapper",
    family: "papernexus",
    projectId: "demo-project",
    projectRoot,
  });

  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    runtime: {
      subagent: {
        async waitForRun(params) {
          return completedRunIds.has(params.runId)
            ? { status: "ok" }
            : { status: "timeout" };
        },
      },
    },
    pluginConfig: {
      papernexusApiBaseUrl: `http://127.0.0.1:${address.port}`,
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "PAPERNEXUS_API_TOKEN",
    },
  });

  const snapshot = await executeWorkflowTool(tool, {
    action: "get_snapshot",
  });

  assert.equal(snapshot.paperIngestionRunningRequestCount, 0);
  assert.equal(snapshot.paperIngestionRuntimeStatus, "ready");
  assert.equal(snapshot.graphPresenceStatus, "ready");
  assert.equal(snapshot.graphRefreshRequired, false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "GET");
  assert.match(requests[0].url ?? "", /\/api\/corpus-sources\?name=shared-global-graph$/);

  const graphPresence = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), "utf8")
  );
  assert.equal(graphPresence.status, "ready");
});

test("research_workflow get_snapshot honors the plugin-configured shared corpus for remote graph refresh", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const previousToken = process.env.PAPERNEXUS_API_TOKEN;
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const corpusName = url.searchParams.get("name");
    requests.push({
      method: request.method,
      url: request.url,
      corpus: corpusName,
      authorization: request.headers.authorization ?? null,
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    if (corpusName === "GCD") {
      response.end(
        JSON.stringify({
          rootPath: "/remote/corpora/GCD",
          meta: {
            name: "GCD",
            rootPath: "/remote/corpora/GCD",
          },
          manifest: {
            corpusName: "GCD",
            rootPath: "/remote/corpora/GCD",
          },
          sources: [
            {
              sourceKey: "/remote/corpora/GCD/md/2603.08076--plugin-config-paper.md",
              inputPath: "/remote/corpora/GCD/md/2603.08076--plugin-config-paper.md",
              paperId: "paper:2603.08076",
              paperTitle: "Plugin Config Paper",
              activeInGraph: true,
            },
          ],
        })
      );
      return;
    }
    response.end(
      JSON.stringify({
        rootPath: `/remote/corpora/${corpusName ?? "unknown"}`,
        meta: {
          name: corpusName,
          rootPath: `/remote/corpora/${corpusName ?? "unknown"}`,
        },
        manifest: {
          corpusName,
          rootPath: `/remote/corpora/${corpusName ?? "unknown"}`,
        },
        sources: [],
      })
    );
  });

  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_API_TOKEN;
    } else {
      process.env.PAPERNEXUS_API_TOKEN = previousToken;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  process.env.OPENCLAW_PROJECT = projectRoot;
  process.env.PAPERNEXUS_API_TOKEN = "test-token";
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "2603.08076",
      title: "Plugin Config Paper",
      arxiv_id: "2603.08076",
      source_path: "/remote/corpora/GCD/md/2603.08076--plugin-config-paper.md",
    },
  ]);
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "gcd-confirmation-bias-mitigation",
    current_stage: "graph_build",
    current_micro_stage: "verifying",
    owner_agent: "researcher",
    idle_research: { enabled: false },
    paper_ingestion: {
      corpus_name: "gcd-confirmation-bias-mitigation",
      graph_presence_status: "missing_papers",
      graph_presence_checked_at: "2026-04-08T00:00:00.000Z",
      refresh_required: true,
      refresh_reason: "Graph presence is stale.",
    },
  });
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    checked_at: "2026-04-08T00:00:00.000Z",
    status: "missing_papers",
    mode: "remote_api",
    corpus_name: "gcd-confirmation-bias-mitigation",
    corpus_root: `http://127.0.0.1:${address.port}`,
    expected_paper_count: 1,
    present_paper_count: 0,
    missing_paper_count: 1,
    missing_papers: [{ canonical_id: "2603.08076", title: "Plugin Config Paper" }],
    refresh_required: true,
    refresh_reason: "Remote graph is not ready.",
  });

  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    pluginConfig: {
      papernexusApiBaseUrl: `http://127.0.0.1:${address.port}`,
      papernexusSharedCorpus: "GCD",
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "PAPERNEXUS_API_TOKEN",
    },
  });

  const snapshot = await executeWorkflowTool(tool, {
    action: "get_snapshot",
  });

  assert.equal(snapshot.graphPresenceStatus, "ready");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].corpus, "GCD");

  const graphPresence = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), "utf8")
  );
  assert.equal(graphPresence.corpus_name, "GCD");
});

test("research_workflow get_papernexus_progress returns raw progress JSON and a compact summary", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "graph_build",
    owner_agent: "researcher",
    next_action: "Wait for the batch import to finish, then rerun graph verification.",
    blocking_reason: "Batch import is still running.",
    idle_research: { enabled: false },
    paper_ingestion: {
      runtime_status: "waiting_import",
      waiting_reason: "Batch import is still running.",
      graph_presence_status: "missing_papers",
      graph_presence_checked_at: "2026-04-08T09:00:00.000Z",
      graph_presence_expected_papers: 4,
      graph_presence_present_papers: 2,
      graph_presence_missing_papers: [
        { canonical_id: "paper-3", title: "Paper 3" },
        { canonical_id: "paper-4", title: "Paper 4" },
      ],
      active_batches: [
        {
          manifest_path: "graph/batch-import.json",
          status: "running",
          total: 4,
          running: 1,
          pending: 1,
          completed: 2,
          failed: 0,
          submit_failed: 0,
        },
      ],
      batch_items: [
        { manifest_path: "graph/batch-import.json", canonical_id: "paper-1", status: "completed", synced: true },
        { manifest_path: "graph/batch-import.json", canonical_id: "paper-2", status: "completed", synced: true },
        { manifest_path: "graph/batch-import.json", canonical_id: "paper-3", status: "running", synced: false },
        { manifest_path: "graph/batch-import.json", canonical_id: "paper-4", status: "pending", synced: false },
      ],
      queued_requests: [
        {
          request_id: "req-progress-1",
          wrapper: "pn_batch_import.py",
          command_text: "python3 scripts/pn_batch_import.py --manifest graph/batch-import.json submit",
          status: "running",
          updated_at: "2026-04-08T09:00:00.000Z",
        },
      ],
    },
  });
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  const progress = await executeWorkflowTool(tool, {
    action: "get_papernexus_progress",
  });

  assert.equal(progress.progress.phase, "waiting_import");
  assert.equal(progress.progress.batch.total_items, 4);
  assert.equal(progress.progress.batch.synced_items, 2);
  assert.equal(progress.progress.graph_check.expected_papers, 4);
  assert.equal(progress.progress.graph_check.present_papers, 2);
  assert.equal(progress.progress.progress.completed_ratio, 0.5);
  assert.equal(progress.progress.progress.percent, 50);
  assert.match(progress.summary, /phase=waiting_import/i);
  assert.match(progress.summary, /progress=2\/4 synced/i);
  assert.match(progress.summary, /graph=2\/4 present/i);
});

test("research_workflow get_papernexus_progress prefers remote queue snapshots over guessed local timing", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "graph_build",
    owner_agent: "researcher",
    next_action: "Poll the remote import queue until the batch completes.",
    blocking_reason: "Batch import is still materializing markdown.",
    idle_research: { enabled: false },
    paper_ingestion: {
      runtime_status: "waiting_import",
      waiting_reason: "Remote queue is still materializing markdown.",
      graph_presence_status: "missing_papers",
      graph_presence_checked_at: "2026-04-08T09:00:00.000Z",
      graph_presence_expected_papers: 4,
      graph_presence_present_papers: 1,
      graph_presence_missing_papers: [
        { canonical_id: "paper-2", title: "Paper 2" },
        { canonical_id: "paper-3", title: "Paper 3" },
        { canonical_id: "paper-4", title: "Paper 4" },
      ],
      active_batches: [
        {
          manifest_path: "graph/batch-import.json",
          status: "running",
          total: 4,
          running: 1,
          pending: 2,
          completed: 1,
          failed: 0,
          submit_failed: 0,
        },
      ],
      queued_requests: [
        {
          request_id: "req-progress-remote-1",
          wrapper: "pn_batch_import.py",
          command_text: "python3 scripts/pn_batch_import.py --manifest graph/batch-import.json status",
          status: "running",
          updated_at: "2026-04-08T09:05:00.000Z",
          progress: {
            percent: 68,
            stage_percent: 35,
            queue_position: 2,
            current_step: "llm-optimize",
            processed_units: 17,
            total_units: 25,
          },
          queue_progress: {
            total: 4,
            pending: 2,
            running: 1,
            completed: 1,
            failed: 0,
            remaining: 3,
            overall_percent: 68,
          },
        },
      ],
    },
  });
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  const progress = await executeWorkflowTool(tool, {
    action: "get_papernexus_progress",
  });

  assert.equal(progress.progress.phase, "waiting_import");
  assert.equal(progress.progress.queue_progress.overall_percent, 68);
  assert.equal(progress.progress.queue_progress.remaining, 3);
  assert.equal(progress.progress.remote_task.percent, 68);
  assert.equal(progress.progress.remote_task.stage_percent, 35);
  assert.equal(progress.progress.remote_task.queue_position, 2);
  assert.equal(progress.progress.remote_task.current_step, "llm-optimize");
  assert.equal(progress.progress.remote_task.processed_units, 17);
  assert.equal(progress.progress.remote_task.total_units, 25);
  assert.equal(progress.progress.progress.percent, 68);
  assert.match(progress.summary, /68%/i);
  assert.match(progress.summary, /llm-optimize/i);
  assert.match(progress.summary, /queue=2/i);
});

test("research_workflow queue_literature_discovery_requisition bridges a structured discovery packet into durable paper_ingestion queued requests", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  await writeJson(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), {
    corpus_name: "GCD",
  });
  await writeJson(
    path.join(projectRoot, "researcher", "literature-discovery", "LITERATURE_DISCOVERY_PACKET.json"),
    {
      discovery_id: "disc-gap-memory-001",
      discovery_reason: "Bridge evidence is weak for memory-preservation under domain shift.",
      target_question_ids: ["q-memory-1"],
      target_domains: ["Psychology", "Control Theory"],
      candidate_queries: [
        {
          domain: "Psychology",
          query: "metacontrol adaptive memory under shifting collaborators",
        },
        {
          domain: "Control Theory",
          query: "adaptive regulation preserving prior state under drift",
        },
      ],
      next_action_suggestion: "Import selected papers and rerun graph-build before revisiting the story.",
      required_stage_reentry: ["graph_build", "frontier_mapping", "idea"],
    }
  );

  const result = await executeWorkflowTool(tool, {
    action: "queue_literature_discovery_requisition",
    literatureDiscovery: {
      packet_path: "researcher/literature-discovery/LITERATURE_DISCOVERY_PACKET.json",
      trigger_kind: "literature_discovery",
      origin_stage: "review",
      summary: "Queue graph-backed literature discovery for missing bridge evidence.",
    },
  });

  assert.equal(result.created ?? false, true);
  assert.equal(result.request.triggerKind, "literature_discovery");
  assert.match(result.request.requestId, /^literature-discovery-/);
  assert.equal(result.request.sharedCorpus, "GCD");
  assert.match(result.request.commandText ?? "", /LITERATURE_DISCOVERY_PACKET\.json/);
  assert.match(result.request.commandText ?? "", /graph-build/i);
  assert.match(result.request.detail ?? "", /review/i);
  assert.equal(result.state.queuedRequests.length >= 1, true);

  const snapshot = await executeWorkflowTool(tool, {
    action: "get_snapshot",
  });
  assert.equal(snapshot.paperIngestionQueuedRequestCount, 1);
  assert.equal(snapshot.paperIngestionRunningRequestCount, 0);
  assert.equal(snapshot.paperIngestionRuntimeStatus, "idle");
});

test("research_workflow materialize_writing_support_artifacts scaffolds durable writer support packets", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "write",
    owner_agent: "academic_writer",
    paper_story_state: {
      status: "ready",
      story_spine_path: "academic_writer/story/STORY_SPINE.md",
      claim_to_experiment_map_path: "academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md",
      fallback_narrative_path: "academic_writer/story/FALLBACK_NARRATIVE.md",
      rejection_risk_table_path: "academic_writer/story/REJECTION_RISK_TABLE.md",
      pipeline_figure_sketch_path: "academic_writer/story/PIPELINE_FIGURE_SKETCH.md",
      module_motivation_map_path: "academic_writer/story/MODULE_MOTIVATION_MAP.md",
      idea_to_claim_map_path: "researcher/idea-catalyst/IDEA_TO_CLAIM_MAP.json",
      claim_support_status: "partial",
      supported_claim_count: 1,
      partial_claim_count: 1,
      unsupported_claim_count: 1,
    },
    review_pressure_packet: {
      status: "ready",
      reject_first_review_path: "reviewer/story-pressure/REJECT_FIRST_REVIEW.md",
      novelty_attack_path: "reviewer/story-pressure/NOVELTY_ATTACK.md",
      unsupported_claim_audit_path: "reviewer/story-pressure/UNSUPPORTED_CLAIM_AUDIT.md",
      reverse_outline_path: "reviewer/story-pressure/REVERSE_OUTLINE.md",
      figure_table_qc_path: "reviewer/story-pressure/FIGURE_TABLE_QC.md",
      limitation_audit_path: "reviewer/story-pressure/LIMITATION_AUDIT.md",
    },
  });

  await writeText(path.join(projectRoot, "academic_writer", "story", "STORY_SPINE.md"), "# Story\n");
  await writeText(
    path.join(projectRoot, "academic_writer", "story", "CLAIM_TO_EXPERIMENT_MAP.md"),
    "# Claims\n## Claim 1 (claim-1)\n"
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "story", "FALLBACK_NARRATIVE.md"),
    "# Fallback\n"
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "story", "REJECTION_RISK_TABLE.md"),
    "# Risks\n"
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "story", "PIPELINE_FIGURE_SKETCH.md"),
    "# Figure\n"
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "story", "MODULE_MOTIVATION_MAP.md"),
    "# Modules\n"
  );
  await writeJson(path.join(projectRoot, "researcher", "idea-catalyst", "IDEA_TO_CLAIM_MAP.json"), {
    top_fragments: [
      {
        fragment_id: "frag-1",
        mapped_claims: [{ claim_id: "claim-1", claim: "Support precision gain." }],
      },
    ],
    top3_directions: [{ direction_id: "dir-1", title: "Support router" }],
  });
  await writeText(
    path.join(projectRoot, "reviewer", "story-pressure", "REJECT_FIRST_REVIEW.md"),
    "# Reject\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "story-pressure", "NOVELTY_ATTACK.md"),
    "# Novelty Attack\n- claim-2\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "story-pressure", "UNSUPPORTED_CLAIM_AUDIT.md"),
    "# Unsupported\n- claim-2: unsupported\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "story-pressure", "REVERSE_OUTLINE.md"),
    "# Reverse Outline\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "story-pressure", "FIGURE_TABLE_QC.md"),
    "# Figure QC\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "story-pressure", "LIMITATION_AUDIT.md"),
    "# Limitation Audit\n"
  );

  const result = await executeWorkflowTool(tool, {
    action: "materialize_writing_support_artifacts",
    paperStoryMaterialization: {
      basis_stage: "write",
    },
  });

  assert.equal(result.referenceBundle.status, "ready");
  assert.equal(result.fallbackActivation.activeNarrativeMode, "fallback");
  assert.equal(result.revisionCycle.stage, "write");
  assert.ok(Array.isArray(result.generatedFiles));
  assert.ok(result.generatedFiles.some((entry) => /WRITING_REFERENCE_BUNDLE\.json$/.test(entry)));
});

test("research_workflow ideation, story, and review-pressure contracts persist through runtime tools", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  for (const [filePath, content] of [
    ["researcher/ideation/IDEA_TREE.md", "# Idea Tree\n"],
    ["researcher/ideation/NOVELTY_TREE.md", "# Novelty\n"],
    ["researcher/ideation/CHALLENGE_INSIGHT_TREE.md", "# Challenge Insight\n"],
    [
      "researcher/ideation/WELL_ESTABLISHED_SOLUTION_CHECK.md",
      "# Solution Check\n",
    ],
    ["researcher/ideation/CROSS_DOMAIN_TRANSFER.md", "# Transfer\n"],
    ["researcher/ideation/PROBLEM_DECOMPOSITION.md", "# Decomposition\n"],
    ["researcher/ideation/TOP3_DIRECTION_SUMMARY.md", "# Top 3\n"],
    ["researcher/ideation/RESEARCH_PROPOSAL.md", "# Proposal\n"],
    ["academic_writer/story/TASK_SUMMARY.md", "# Task Summary\n"],
    ["academic_writer/story/CHALLENGE_STATEMENT.md", "# Challenge Statement\n"],
    ["academic_writer/story/INSIGHT_SUMMARY.md", "# Insight Summary\n"],
    ["academic_writer/story/CONTRIBUTION_MAP.md", "# Contribution Map\n"],
    ["academic_writer/story/ADVANTAGE_MAP.md", "# Advantage Map\n"],
    ["academic_writer/story/STORY_SPINE.md", "# Story Spine\n"],
    [
      "academic_writer/story/PIPELINE_FIGURE_SKETCH.md",
      "# Pipeline Figure Sketch\n",
    ],
    [
      "academic_writer/story/MODULE_MOTIVATION_MAP.md",
      "# Module Motivation Map\n",
    ],
    [
      "academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md",
      "# Claim Map\n",
    ],
    ["academic_writer/story/FALLBACK_NARRATIVE.md", "# Fallback\n"],
    [
      "academic_writer/story/REJECTION_RISK_TABLE.md",
      "# Rejection Risk Table\n",
    ],
    ["analyzer/CLAIM_EVIDENCE_MATRIX.md", "# Claim Evidence Matrix\n"],
    ["analyzer/TRACK_VERDICTS.md", "# Track Verdicts\n"],
    ["analyzer/UNSUPPORTED_CLAIMS.md", "# Unsupported Claims\n"],
    ["reviewer/story-pressure/REJECT_FIRST_REVIEW.md", "# Reject First\n"],
    ["reviewer/story-pressure/NOVELTY_ATTACK.md", "# Novelty Attack\n"],
    [
      "reviewer/story-pressure/UNSUPPORTED_CLAIM_AUDIT.md",
      "# Claim Audit\n",
    ],
    ["reviewer/story-pressure/REVERSE_OUTLINE.md", "# Reverse Outline\n"],
    ["reviewer/story-pressure/FIGURE_TABLE_QC.md", "# Figure Table QC\n"],
    ["reviewer/story-pressure/LIMITATION_AUDIT.md", "# Limitation Audit\n"],
  ]) {
    const resolved = path.join(projectRoot, filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, "utf8");
  }

  for (const [filePath, value] of [
    [
      "researcher/ideation/CANDIDATE_POOL.json",
      { candidates: [{ id: "dir-1", status: "surviving" }] },
    ],
    [
      "researcher/ideation/TOURNAMENT_SCOREBOARD.json",
      { status: "completed", selected_direction_id: "dir-1" },
    ],
    [
      "researcher/ideation/GRAPH_IDEATION_PACKET.json",
      { novelty_zones: ["zone:1"], challenge_clusters: ["challenge:1"] },
    ],
    [
      "researcher/ideation/RANKING_HISTORY.json",
      { status: "completed", rounds: [] },
    ],
  ]) {
    const resolved = path.join(projectRoot, filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), {
    active_tracks: 1,
    tracks: [
      {
        track_id: "track-main",
        status: "active",
        reasoning_packet_dir: "researcher/reasoning/track-main",
        working_memory_path: "researcher/reasoning/track-main/WORKING_MEMORY.json",
        synthesis_packet_path: "researcher/reasoning/track-main/SYNTHESIS_PACKET.md",
        evidence_pointers: ["graph/LIMITATION_FRONTIER.md#track-main"],
        linked_graph_nodes: ["paper:track-main"],
        relation_patterns: ["supports->track:track-main"],
      },
    ],
  });
  await writeJson(
    path.join(projectRoot, "researcher", "reasoning", "track-main", "WORKING_MEMORY.json"),
    {
      surviving_direction: "graph-grounded story direction",
    }
  );
  await writeText(
    path.join(projectRoot, "researcher", "reasoning", "track-main", "SYNTHESIS_PACKET.md"),
    "# Synthesis\n"
  );
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "write",
    current_micro_stage: "drafting",
    owner_agent: "academic_writer",
    idle_research: { enabled: false },
    innovation_reflection: {
      status: "fresh",
      last_reflection_path: "researcher/INNOVATION_REFLECTION.md",
    },
    research_program: {
      status: "approved",
      goal: "Keep workflow contracts readable through runtime tools.",
      problem_statement: "Read-side checks should see the same active track context as writers.",
      baseline_reference: "baseline-router",
      primary_metric: "support_precision",
      datasets: ["demo-dataset"],
      success_criteria: ["runtime snapshots remain aligned with durable contracts"],
      tracks: [
        {
          track_id: "track-main",
          status: "active",
        },
      ],
    },
  });

  const ideationResult = await executeWorkflowTool(tool, {
    action: "set_ideation_contract",
    ideationContract: {
      status: "ready",
      contract_version: 1,
      long_term_goal: "Find a robust, graph-grounded story direction.",
      problem_scope: "Scientific storytelling",
      basis_stage: "frontier_mapping",
      graph_ideation_indices: {
        status: "ready",
        novelty_candidate_clusters: ["zone:1"],
        challenge_clusters: ["challenge:1"],
        insight_clusters: ["insight:1"],
        occupied_solution_zones: [],
        transfer_bridges: ["bridge:1"],
      },
      idea_tree_path: "researcher/ideation/IDEA_TREE.md",
      novelty_tree_path: "researcher/ideation/NOVELTY_TREE.md",
      challenge_insight_tree_path:
        "researcher/ideation/CHALLENGE_INSIGHT_TREE.md",
      solution_check_path:
        "researcher/ideation/WELL_ESTABLISHED_SOLUTION_CHECK.md",
      cross_domain_transfer_path:
        "researcher/ideation/CROSS_DOMAIN_TRANSFER.md",
      problem_decomposition_path:
        "researcher/ideation/PROBLEM_DECOMPOSITION.md",
      candidate_pool_path: "researcher/ideation/CANDIDATE_POOL.json",
      ranking_history_path: "researcher/ideation/RANKING_HISTORY.json",
      tournament_scoreboard_path:
        "researcher/ideation/TOURNAMENT_SCOREBOARD.json",
      top3_summary_path: "researcher/ideation/TOP3_DIRECTION_SUMMARY.md",
      research_proposal_path: "researcher/ideation/RESEARCH_PROPOSAL.md",
      graph_ideation_packet_path:
        "researcher/ideation/GRAPH_IDEATION_PACKET.json",
      selected_direction_id: "dir-1",
      selected_track_id: "track-main",
    },
  });
  assert.equal(ideationResult.state.status, "ready");
  assert.equal(ideationResult.graphIdeationPacketExists, true);
  assert.equal(ideationResult.researchProposalExists, true);

  const paperStoryResult = await executeWorkflowTool(tool, {
    action: "set_paper_story_state",
    paperStoryState: {
      status: "ready",
      story_spine_path: "academic_writer/story/STORY_SPINE.md",
      claim_to_experiment_map_path:
        "academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md",
      fallback_narrative_path: "academic_writer/story/FALLBACK_NARRATIVE.md",
    },
  });
  assert.equal(paperStoryResult.state.status, "ready");
  assert.equal(paperStoryResult.storySpineExists, true);
  assert.equal(paperStoryResult.claimToExperimentMapExists, true);

  const reviewPressureResult = await executeWorkflowTool(tool, {
    action: "set_review_pressure_packet",
    reviewPressurePacket: {
      status: "ready",
      reject_first_review_path:
        "reviewer/story-pressure/REJECT_FIRST_REVIEW.md",
      unsupported_claim_audit_path:
        "reviewer/story-pressure/UNSUPPORTED_CLAIM_AUDIT.md",
    },
  });
  assert.equal(reviewPressureResult.state.status, "ready");
  assert.equal(reviewPressureResult.rejectFirstReviewExists, true);
  assert.equal(reviewPressureResult.unsupportedClaimAuditExists, true);

  const snapshot = await executeWorkflowTool(tool, {
    action: "get_snapshot",
  });
  assert.equal(snapshot.ideationContractStatus, "ready");
  assert.equal(snapshot.ideationContractSelectedTrackId, "track-main");
  assert.equal(
    snapshot.ideationContractResearchProposalPath,
    "researcher/ideation/RESEARCH_PROPOSAL.md"
  );
  assert.equal(snapshot.paperStoryStatus, "ready");
  assert.equal(
    snapshot.paperStoryClaimToExperimentMapPath,
    "academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md"
  );
  assert.equal(snapshot.reviewPressureStatus, "ready");
  assert.equal(
    snapshot.reviewPressureUnsupportedClaimAuditPath,
    "reviewer/story-pressure/UNSUPPORTED_CLAIM_AUDIT.md"
  );
});

test("research_workflow materialize_ideation_contract scaffolds graph-first ideation artifacts from brainstorm and track memory", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  await fs.mkdir(path.join(projectRoot, "graph"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "researcher"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "researcher", "brainstorm-cycle"), {
    recursive: true,
  });

  await fs.writeFile(
    path.join(projectRoot, "graph", "ANCHOR_INDEX.md"),
    "# Anchor Index\n- anchor: compositional-router\n- anchor: support-gap\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "graph", "LIMITATION_FRONTIER.md"),
    "# Limitation Frontier\n- baseline methods do not preserve compositional support links\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "graph", "TRANSFER_FRONTIER.md"),
    "# Transfer Frontier\n- reuse retrieval planning from theorem proving\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "FRONTIER_REPORT.md"),
    "# Frontier Report\n\n## Challenge clusters\n- support attribution drift\n\n## Insight clusters\n- graph-grounded routing\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "INNOVATION_REFLECTION.md"),
    "# Innovation Reflection\nKeep graph-backed support routing as a surviving direction.\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "LOGIC_CHAIN.md"),
    "# Logic Chain\n1. Challenge: attribution drift\n2. Insight: graph-grounded routing\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "EVIDENCE_CHAIN.md"),
    "# Evidence Chain\n- frontier packets show missing support links\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "QUESTION_PACKET.md"),
    "# Questions\n- how to preserve support precision?\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "TRACK_REGISTRY.json"),
    `${JSON.stringify(
      {
        tracks: [
          {
            track_id: "track-main",
            status: "active",
            question: "How do we preserve support precision in scientific storytelling?",
            hypothesis: "Graph-grounded routing improves support precision without weakening clarity.",
            novelty_basis:
              "It turns graph evidence into a routing signal for claim construction.",
            linked_graph_nodes: ["paper:router", "concept:support-precision"],
            relation_patterns: ["extends->paper:router", "bridges->concept:support-precision"],
            evidence_pointers: ["graph/LIMITATION_FRONTIER.md#support-gap"],
            reasoning_packet_dir: "researcher/reasoning/track-main",
            working_memory_path: "researcher/brainstorm-cycle/WORKING_MEMORY.json",
            synthesis_packet_path: "researcher/brainstorm-cycle/SYNTHESIS_PACKET.md",
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.owner_agent = "researcher";
  manifest.research_program = {
    status: "approved",
    goal: "Produce graph-grounded scientific narratives with stronger support precision.",
    problem_statement: "Current drafts lose fine-grained claim support when the story widens.",
    baseline_reference: "baseline-router",
    primary_metric: "support_precision",
    datasets: ["demo-dataset"],
    success_criteria: ["support_precision improves over baseline-router"],
    zotero_project_path: "bot/demo-project",
    tracks: [
      {
        track_id: "track-main",
        status: "active",
        hypothesis:
          "Graph-grounded routing improves support precision without weakening clarity.",
        novelty_basis:
          "It turns graph evidence into a routing signal for claim construction.",
        required_baselines: ["baseline-router"],
      },
    ],
  };
  manifest.innovation_reflection = {
    status: "fresh",
    last_reflection_path: "researcher/INNOVATION_REFLECTION.md",
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await executeWorkflowTool(tool, {
    action: "run_brainstorm_cycle",
    brainstormCycle: {
      topic: "Graph-grounded support routing",
      basis_stage: "frontier_mapping",
      track_id: "track-main",
      provider: "workflow_core_brainstorm",
      provider_mode: "core",
      graph_version_seen: "global-v1",
      contract_version: 1,
      rounds: [
        {
          round_id: "round-1",
          label: "diverge",
          status: "completed",
          options: [
            {
              option_id: "dir-main",
              title: "Graph-grounded support router",
              score: 0.91,
              summary: "Use graph evidence to route claims to supporting packets.",
              logic_chain: "# Logic Main\nChallenge -> router -> evidence\n",
              evidence_chain: "# Evidence Main\nSupport gaps from frontier packets\n",
              reasoning_trace: [
                {
                  step: "inspect-support-gap",
                  conclusion: "routing should use graph evidence",
                },
              ],
              question_packet: "# Questions Main\n",
              working_memory: {
                surviving_direction: "graph-grounded support router",
              },
              synthesis_packet: "# Synthesis Main\n",
              reflection_chain: {
                keep: ["graph-grounded support router"],
              },
              theory_brief: {
                theorem_seed: "support_precision_monotonicity",
              },
              storyline_brief: {
                thesis: "Challenge -> graph router -> evidence-backed clarity",
              },
            },
          ],
        },
      ],
    },
  });

  const result = await executeWorkflowTool(tool, {
    action: "materialize_ideation_contract",
    ideationMaterialization: {
      basis_stage: "frontier_mapping",
    },
  });

  assert.equal(result.state.status, "ready");
  assert.equal(result.state.selectedDirectionId, "dir-main");
  assert.equal(result.state.selectedTrackId, "track-main");
  assert.equal(result.state.graphIdeationIndices.status, "ready");
  assert.equal(result.state.ideaTreePath, "researcher/ideation/IDEA_TREE.md");
  assert.equal(
    result.state.rankingHistoryPath,
    "researcher/ideation/RANKING_HISTORY.json"
  );
  assert.ok(
    result.state.graphIdeationIndices.challengeClusters.includes(
      "support attribution drift"
    )
  );
  assert.equal(result.graphIdeationPacketExists, true);
  assert.equal(result.researchProposalExists, true);

  const packet = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "ideation", "GRAPH_IDEATION_PACKET.json"),
      "utf8"
    )
  );
  assert.equal(packet.selected_direction_id, "dir-main");
  assert.equal(packet.selected_track_id, "track-main");
  assert.ok(Array.isArray(packet.transfer_bridges));
  assert.ok(packet.transfer_bridges.length >= 1);

  const proposal = await fs.readFile(
    path.join(projectRoot, "researcher", "ideation", "RESEARCH_PROPOSAL.md"),
    "utf8"
  );
  assert.match(proposal, /route claims to supporting packets/i);
  assert.match(proposal, /Expected Results/i);

  const ideaTree = await fs.readFile(
    path.join(projectRoot, "researcher", "ideation", "IDEA_TREE.md"),
    "utf8"
  );
  assert.match(ideaTree, /Technique Variants/i);
  assert.match(ideaTree, /Domain Adaptations/i);
  assert.match(ideaTree, /Formulation Variants/i);

  const rankingHistory = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "ideation", "RANKING_HISTORY.json"),
      "utf8"
    )
  );
  assert.equal(rankingHistory.status, "completed");
  assert.match(rankingHistory.method ?? "", /elo|equivalent/i);
  assert.ok(Array.isArray(rankingHistory.rounds));
  assert.ok(rankingHistory.rounds.length >= 1);

  const candidatePool = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "ideation", "CANDIDATE_POOL.json"),
      "utf8"
    )
  );
  assert.equal(candidatePool.status, "ready");
  assert.equal(candidatePool.tree_expansion?.max_candidates, 21);
  assert.ok(Array.isArray(candidatePool.tree_expansion?.technique_candidates));
  assert.ok(Array.isArray(candidatePool.tree_expansion?.domain_candidates));
  assert.ok(Array.isArray(candidatePool.tree_expansion?.formulation_candidates));
  assert.ok((candidatePool.tree_expansion?.technique_candidates?.length ?? 0) >= 1);
  assert.ok((candidatePool.tree_expansion?.formulation_candidates?.length ?? 1) >= 1);
  assert.ok(Array.isArray(candidatePool.candidates));
  assert.ok(candidatePool.candidates.length >= 1);
  assert.ok(candidatePool.candidates[0].phase_trace?.propose);
  assert.ok(candidatePool.candidates[0].phase_trace?.review);
  assert.ok(candidatePool.candidates[0].phase_trace?.refine);
  assert.ok(candidatePool.candidates[0].baseline_relation);

  const top3Summary = await fs.readFile(
    path.join(projectRoot, "researcher", "ideation", "TOP3_DIRECTION_SUMMARY.md"),
    "utf8"
  );
  assert.match(top3Summary, /Action:\s+advance/i);
  assert.match(top3Summary, /Primary risk:/i);

  const refreshedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const workingMemoryRelativePath =
    refreshedManifest.brainstorm_cycle?.working_memory_path ??
    "researcher/brainstorm-cycle/WORKING_MEMORY.json";
  const workingMemory = JSON.parse(
    await fs.readFile(path.join(projectRoot, workingMemoryRelativePath), "utf8")
  );
  assert.equal(workingMemory.ideation_contract?.selected_direction_id, "dir-main");

  const updatedTrackRegistry = JSON.parse(
    await fs.readFile(path.join(projectRoot, "TRACK_REGISTRY.json"), "utf8")
  );
  assert.equal(updatedTrackRegistry.tracks[0].research_proposal_path, "researcher/ideation/RESEARCH_PROPOSAL.md");
});

test("research_workflow materialize_ideation_contract imports per-track GRAPH_EVIDENCE.json into canonical track evidence fields", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  await fs.mkdir(path.join(projectRoot, "graph"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "researcher", "brainstorm-cycle"), {
    recursive: true,
  });

  await fs.writeFile(
    path.join(projectRoot, "graph", "ANCHOR_INDEX.md"),
    "# Anchor Index\n- anchor: graph-evidence-import\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "graph", "LIMITATION_FRONTIER.md"),
    "# Limitation Frontier\n- baseline support links remain brittle\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "graph", "TRANSFER_FRONTIER.md"),
    "# Transfer Frontier\n- import explicit graph evidence bindings into ideation\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "FRONTIER_REPORT.md"),
    "# Frontier Report\n\n## Challenge clusters\n- missing per-track evidence canonicalization\n\n## Insight clusters\n- import explicit graph evidence packets\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "INNOVATION_REFLECTION.md"),
    "# Innovation Reflection\nKeep the graph-evidence import path for track storytelling.\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "LOGIC_CHAIN.md"),
    "# Logic Chain\n1. Challenge: track evidence is uncaptured\n2. Insight: import the packet canonically\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "EVIDENCE_CHAIN.md"),
    "# Evidence Chain\n- track-local graph evidence already exists\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "QUESTION_PACKET.md"),
    "# Questions\n- how should the workflow import track-local graph evidence?\n",
    "utf8"
  );

  await fs.writeFile(
    path.join(projectRoot, "TRACK_REGISTRY.json"),
    `${JSON.stringify(
      {
        tracks: [
          {
            track_id: "track-main",
            status: "active",
            question: "How should the workflow import track-local graph evidence?",
            hypothesis:
              "Canonicalizing the packet preserves graph-backed story support without forcing coder alignment.",
            novelty_basis:
              "The workflow should reconcile packet-backed evidence instead of relying on ad hoc fields.",
            linked_graph_nodes: [],
            relation_patterns: [],
            evidence_pointers: [],
            reasoning_packet_dir: "researcher/reasoning/track-main",
            working_memory_path: "researcher/brainstorm-cycle/WORKING_MEMORY.json",
            synthesis_packet_path: "researcher/brainstorm-cycle/SYNTHESIS_PACKET.md",
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeJson(
    path.join(projectRoot, "researcher", "reasoning", "track-main", "GRAPH_EVIDENCE.json"),
    {
      evidence_pointers: [
        "researcher/reasoning/track-main/GRAPH_EVIDENCE.json#paper:router",
        "graph/LIMITATION_FRONTIER.md#support-gap",
      ],
      linked_graph_nodes: ["paper:router", "finding:support-gap"],
      relation_patterns: [
        "supports->claim:support-precision",
        "bridges->concept:graph-evidence-import",
      ],
    }
  );

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.owner_agent = "researcher";
  manifest.research_program = {
    status: "approved",
    goal: "Repair track-local graph-backed innovation evidence.",
    problem_statement:
      "Per-track graph evidence packets exist, but the canonical workflow state misses them.",
    baseline_reference: "baseline-router",
    primary_metric: "support_precision",
    datasets: ["demo-dataset"],
    success_criteria: ["import packet-backed graph evidence canonically"],
    zotero_project_path: "bot/demo-project",
    tracks: [
      {
        track_id: "track-main",
        status: "active",
        hypothesis:
          "Canonicalizing the packet preserves graph-backed story support without forcing coder alignment.",
        novelty_basis:
          "The workflow should reconcile packet-backed evidence instead of relying on ad hoc fields.",
        required_baselines: ["baseline-router"],
      },
    ],
  };
  manifest.innovation_reflection = {
    status: "fresh",
    last_reflection_path: "researcher/INNOVATION_REFLECTION.md",
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const snapshotBeforeRepair = await executeWorkflowTool(tool, {
    action: "get_snapshot",
  });
  assert.equal(
    snapshotBeforeRepair.missingStageSignals.some((signal) =>
      /active track .*missing graph-backed innovation evidence/i.test(signal)
    ),
    false
  );

  await executeWorkflowTool(tool, {
    action: "run_brainstorm_cycle",
    brainstormCycle: {
      topic: "Track-local graph evidence import",
      basis_stage: "frontier_mapping",
      track_id: "track-main",
      provider: "workflow_core_brainstorm",
      provider_mode: "core",
      graph_version_seen: "global-v2",
      contract_version: 1,
      rounds: [
        {
          round_id: "round-1",
          label: "converge",
          status: "completed",
          options: [
            {
              option_id: "dir-main",
              title: "Canonical track graph evidence import",
              score: 0.94,
              summary:
                "Import track-local graph evidence packets into the canonical workflow contract.",
              logic_chain: "# Logic Main\nPacket -> canonical evidence -> story closure\n",
              evidence_chain: "# Evidence Main\nTrack-local packet already contains graph nodes\n",
              reasoning_trace: [
                {
                  step: "inspect-track-packet",
                  conclusion: "the packet already contains usable graph evidence",
                },
              ],
              question_packet: "# Questions Main\n",
              working_memory: {
                surviving_direction: "canonical track graph evidence import",
              },
              synthesis_packet: "# Synthesis Main\n",
              reflection_chain: {
                keep: ["canonical track graph evidence import"],
              },
              storyline_brief: {
                thesis: "Packet-backed graph evidence closes the track-level logic loop.",
              },
            },
          ],
        },
      ],
    },
  });

  await executeWorkflowTool(tool, {
    action: "materialize_ideation_contract",
    ideationMaterialization: {
      basis_stage: "frontier_mapping",
    },
  });

  const updatedTrackRegistry = JSON.parse(
    await fs.readFile(path.join(projectRoot, "TRACK_REGISTRY.json"), "utf8")
  );
  assert.deepEqual(updatedTrackRegistry.tracks[0].linked_graph_nodes, [
    "paper:router",
    "finding:support-gap",
  ]);
  assert.deepEqual(updatedTrackRegistry.tracks[0].relation_patterns, [
    "supports->claim:support-precision",
    "bridges->concept:graph-evidence-import",
  ]);
  assert.equal(
    updatedTrackRegistry.tracks[0].evidence_pointers.includes(
      "researcher/reasoning/track-main/GRAPH_EVIDENCE.json#paper:router"
    ),
    true
  );
});

test("research_workflow get_snapshot stays read-only for sparse idea tracks", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  const { manifestPath } = await seedSparseIdeationRepairScenario(projectRoot, tool);
  const trackRegistryPath = path.join(projectRoot, "TRACK_REGISTRY.json");
  const initialManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const initialTrackRegistry = await fs.readFile(trackRegistryPath, "utf8");

  const snapshot = await executeWorkflowTool(tool, {
    action: "get_snapshot",
  });

  assert.equal(snapshot.currentStage, "idea");
  assert.equal(Array.isArray(snapshot.missingStageSignals), true);
  assert.equal(await fs.readFile(trackRegistryPath, "utf8"), initialTrackRegistry);
  const refreshedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.deepEqual(refreshedManifest.active_track_ids, initialManifest.active_track_ids);
  assert.equal(refreshedManifest.primary_track_id, initialManifest.primary_track_id);
  await assert.rejects(
    fs.stat(path.join(projectRoot, "researcher", "ideation", "GRAPH_IDEATION_PACKET.json"))
  );
});

test("research_workflow get_runtime_health reports stale auto-iterator audit without regressing live snapshot truth", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  await seedSparseIdeationRepairScenario(projectRoot, tool);
  await writeJson(path.join(projectRoot, ".openclaw-research", "auto-iterator-state.json"), {
    schemaVersion: 1,
    updatedAt: "2026-04-09T08:59:36.572Z",
    result: {
      projectRoot,
      projectId: "demo-project",
      stageBefore: "idea",
      stageAfter: "idea",
      ownerAfter: "researcher",
      blockingReason:
        "active track fd-gcd-freq-debiased missing graph-backed innovation evidence",
      missingStageSignals: [
        "active track fd-gcd-freq-debiased missing graph-backed innovation evidence",
        "active track talon-gcd-bias missing graph-backed innovation evidence",
      ],
    },
  });

  const health = await executeWorkflowTool(tool, {
    action: "get_runtime_health",
  });

  assert.equal(health.projectResolution.resolvedProjectRoot, projectRoot);
  assert.equal(health.snapshot.currentStage, "idea");
  assert.equal(["ready", "repairable"].includes(health.snapshot.workflowEvidenceStatus), true);
  assert.equal(health.autoIteratorAudit.status, "completed");
  assert.equal(health.autoIteratorAudit.freshness, "stale");
  assert.equal(health.autoIteratorAudit.matchesLiveState, false);
  assert.match(health.autoIteratorAudit.summary ?? "", /stale auto-iterator audit/i);
  assert.equal(Array.isArray(health.guidance), true);
  assert.equal(health.guidance.some((line) => /trust the live snapshot/i.test(line)), true);
});

test("research_workflow get_runtime_health treats stale started audits as timed out", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  await seedMinimalProject(projectRoot, {
    project_id: "demo-project",
    current_stage: "plan",
    owner_agent: "orchestrator",
    updated_at: "2026-04-10T08:00:00.000Z",
  });
  await writeJson(path.join(projectRoot, ".openclaw-research", "auto-iterator-state.json"), {
    schemaVersion: 2,
    runId: "audit-started",
    status: "started",
    startedAt: "2026-04-09T08:59:36.572Z",
    updatedAt: "2026-04-09T08:59:36.572Z",
    summary: "Auto iterator started for default mode.",
  });

  const health = await executeWorkflowTool(tool, {
    action: "get_runtime_health",
  });

  assert.equal(health.autoIteratorAudit.status, "timed_out");
  assert.equal(health.autoIteratorAudit.freshness, "stale");
  assert.match(health.autoIteratorAudit.summary ?? "", /timed out/i);
});

test("research_workflow auto_iterator_tick follows the bound channel project even when workspaceDir points at another project", async (t) => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-runtime-binding-priority-")
  );
  const projectsRoot = path.join(workspaceRoot, "projects");
  const boundProjectRoot = path.join(projectsRoot, "gcd-confirmation-bias-mitigation");
  const workspaceProjectRoot = path.join(workspaceRoot, "gcd-part-manifold-2026");
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const sessionKey = "agent:researcher:discord:group:paper-lab";

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  delete process.env.OPENCLAW_PROJECT;
  await seedMinimalProject(boundProjectRoot, {
    project_id: "gcd-confirmation-bias-mitigation",
    current_stage: "idea",
    owner_agent: "researcher",
  });
  await seedMinimalProject(workspaceProjectRoot, {
    project_id: "gcd-part-manifold-2026",
    current_stage: "graph_build",
    owner_agent: "researcher",
  });

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

  const tool = createResearchWorkflowTool({
    workspaceDir: workspaceProjectRoot,
    sessionKey,
    messageChannel: "discord",
    pluginConfig: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
  });

  const snapshot = await executeWorkflowTool(tool, {
    action: "get_snapshot",
  });
  assert.equal(snapshot.projectRoot, boundProjectRoot);
  assert.equal(snapshot.projectId, "gcd-confirmation-bias-mitigation");
  assert.equal(snapshot.currentStage, "idea");
  assert.equal(snapshot.projectResolutionSource, "channel_binding");

  const result = await executeWorkflowTool(tool, {
    action: "auto_iterator_tick",
    iterator: {
      mode: "test",
      queueMailbox: false,
      dispatchTasks: false,
      broadcastStageChange: false,
    },
  });

  assert.equal(result.projectRoot, boundProjectRoot);
  assert.equal(result.projectId, "gcd-confirmation-bias-mitigation");
  assert.equal(result.stageBefore, "idea");
  assert.notEqual(result.projectRoot, workspaceProjectRoot);
  assert.notEqual(result.stageBefore, "graph_build");
});

test("research_workflow diagnose_track_evidence reports canonical graph evidence resolution", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "idea",
    current_micro_stage: "judging",
    owner_agent: "researcher",
    idle_research: { enabled: false },
    innovation_reflection: {
      status: "fresh",
      last_reflection_path: "researcher/INNOVATION_REFLECTION.md",
    },
    research_program: {
      status: "approved",
      goal: "Diagnose track graph evidence resolution.",
      problem_statement: "Need a readable report for canonical graph evidence paths.",
      baseline_reference: "baseline-router",
      primary_metric: "support_precision",
      datasets: ["demo-dataset"],
      success_criteria: ["diagnostics report the resolved artifact path"],
      tracks: [
        {
          track_id: "track-main",
          status: "active",
        },
      ],
    },
  });
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), {
    active_tracks: 1,
    tracks: [
      {
        track_id: "track-main",
        status: "active",
        reasoning_packet_dir: "researcher/reasoning/track-main",
        working_memory_path: "researcher/reasoning/track-main/WORKING_MEMORY.json",
        synthesis_packet_path: "researcher/reasoning/track-main/SYNTHESIS_PACKET.md",
      },
    ],
  });
  await writeJson(
    path.join(projectRoot, "researcher", "reasoning", "track-main", "GRAPH_EVIDENCE.json"),
    {
      source: "papernexus_remote_mcp",
      graph_nodes: ["paper:router", "finding:support-gap"],
      evidence_pointers: [
        "researcher/reasoning/track-main/GRAPH_EVIDENCE.json#paper:router",
      ],
      relation_patterns: ["supports->claim:support-precision"],
    }
  );

  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  const diagnosis = await executeWorkflowTool(tool, {
    action: "diagnose_track_evidence",
  });

  assert.equal(diagnosis.currentStage, "idea");
  assert.deepEqual(diagnosis.missingGraphBackedInnovationEvidenceTrackIds, []);
  assert.equal(diagnosis.registryDeclaredActiveTracks, 1);
  assert.equal(diagnosis.researchProgramActiveTrackCount, 1);
  assert.equal(diagnosis.tracks.length, 1);
  assert.equal(diagnosis.tracks[0].trackId, "track-main");
  assert.equal(diagnosis.tracks[0].graphEvidenceFileExists, true);
  assert.equal(
    diagnosis.tracks[0].graphEvidencePath,
    "researcher/reasoning/track-main/GRAPH_EVIDENCE.json"
  );
  assert.match(diagnosis.tracks[0].graphEvidenceResolvedPath ?? "", /GRAPH_EVIDENCE\.json$/);
  assert.equal(["file_backed", "mixed"].includes(diagnosis.tracks[0].presence), true);
  assert.equal(diagnosis.tracks[0].linkedGraphNodeCount, 2);
  assert.equal(diagnosis.tracks[0].evidencePointerCount >= 1, true);
});

test("research_workflow materialize_ideation_contract reconciles sparse root track registry with active research program tracks", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  await fs.mkdir(path.join(projectRoot, "graph"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "researcher"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "researcher", "brainstorm-cycle"), {
    recursive: true,
  });

  await fs.writeFile(
    path.join(projectRoot, "graph", "ANCHOR_INDEX.md"),
    "# Anchor Index\n- anchor: bias-router\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "graph", "LIMITATION_FRONTIER.md"),
    "# Limitation Frontier\n- baseline calibration still leaks confirmation bias\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "graph", "TRANSFER_FRONTIER.md"),
    "# Transfer Frontier\n- import consistent alignment into GCD debiasing\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "FRONTIER_REPORT.md"),
    "# Frontier Report\n\n## Challenge clusters\n- confirmation bias persists in pseudo-labeling\n\n## Insight clusters\n- alignment-aware debiasing\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "INNOVATION_REFLECTION.md"),
    "# Innovation Reflection\nKeep the frequency-debiased track and a TALON-inspired fallback.\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "LOGIC_CHAIN.md"),
    "# Logic Chain\n1. Challenge: pseudo-label bias\n2. Insight: graph-grounded debiasing\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "EVIDENCE_CHAIN.md"),
    "# Evidence Chain\n- frontier packets show calibration failures\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "QUESTION_PACKET.md"),
    "# Questions\n- how to stabilize debiasing across seeds?\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "SYNTHESIS_PACKET.md"),
    "# Synthesis\n- favor frequency-debiased routing\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "WORKING_MEMORY.json"),
    `${JSON.stringify({ selected_track_id: "fd-gcd-freq-debiased" }, null, 2)}\n`,
    "utf8"
  );

  await fs.writeFile(
    path.join(projectRoot, "TRACK_REGISTRY.json"),
    `${JSON.stringify(
      {
        tracks: [
          {
            track_id: "fd-gcd-freq-debiased",
            status: "active",
            name: "Frequency-Debiased GCD",
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.owner_agent = "researcher";
  manifest.active_track_ids = ["talon-gcd-bias", "part-level-gcd"];
  manifest.primary_track_id = "talon-gcd-bias";
  manifest.research_program = {
    status: "approved",
    goal: "Reduce confirmation bias in GCD with graph-grounded debiasing.",
    problem_statement: "Known-class bias dominates the pseudo-label loop in GCD.",
    baseline_reference: "SimGCD",
    primary_metric: "All Accuracy (ACC)",
    datasets: ["CUB-200"],
    success_criteria: ["All ACC > 53.4% on C-GCD"],
    zotero_project_path: "bot/demo-project",
    tracks: [
      {
        track_id: "fd-gcd-freq-debiased",
        status: "active",
        hypothesis:
          "Frequency-domain debiasing plus alignment reduces confirmation bias in pseudo-labeling.",
        novelty_basis: "Compose DEBGCD, FREE, and consistent alignment into a graph-backed track.",
        required_baselines: ["SimGCD"],
      },
      {
        track_id: "talon-gcd-bias",
        status: "active",
        hypothesis:
          "Margin-aware TALON-style calibration reduces confirmation bias in the novel-class tail.",
        novelty_basis: "Compose TALON-style calibration with GCD pseudo-label control.",
        required_baselines: ["SimGCD"],
      },
    ],
  };
  manifest.innovation_reflection = {
    status: "fresh",
    last_reflection_path: "researcher/INNOVATION_REFLECTION.md",
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await executeWorkflowTool(tool, {
    action: "run_brainstorm_cycle",
    brainstormCycle: {
      topic: "Frequency-debiased GCD",
      basis_stage: "experiment_analysis",
      track_id: "fd-gcd-freq-debiased",
      provider: "workflow_core_brainstorm",
      provider_mode: "core",
      graph_version_seen: "GCD-2026-04-06",
      contract_version: 1,
      rounds: [
        {
          round_id: "round-1",
          label: "converge",
          status: "completed",
          options: [
            {
              option_id: "dir-main",
              title: "Frequency-debiased pseudo-label routing",
              score: 0.93,
              summary: "Use graph-backed debiasing signals to stabilize GCD pseudo-labels.",
              logic_chain: "# Logic Main\nChallenge -> debiasing -> evidence\n",
              evidence_chain: "# Evidence Main\nCalibration failures + transfer evidence\n",
              reasoning_trace: [
                {
                  step: "inspect-calibration-gap",
                  conclusion: "need a graph-backed debiasing route",
                },
              ],
              question_packet: "# Questions Main\n",
              working_memory: {
                surviving_direction: "frequency-debiased pseudo-label routing",
              },
              synthesis_packet: "# Synthesis Main\n",
              reflection_chain: {
                keep: ["frequency-debiased pseudo-label routing"],
              },
              storyline_brief: {
                thesis: "Challenge -> debiasing -> evidence-backed stability",
              },
            },
          ],
        },
      ],
    },
  });

  await executeWorkflowTool(tool, {
    action: "materialize_ideation_contract",
    ideationMaterialization: {
      basis_stage: "experiment_analysis",
    },
  });

  const updatedTrackRegistry = JSON.parse(
    await fs.readFile(path.join(projectRoot, "TRACK_REGISTRY.json"), "utf8")
  );
  const trackIds = updatedTrackRegistry.tracks.map((track) => track.track_id).sort();
  assert.deepEqual(trackIds, ["fd-gcd-freq-debiased", "talon-gcd-bias"]);
  assert.equal(updatedTrackRegistry.active_tracks, 2);
  for (const track of updatedTrackRegistry.tracks) {
    assert.equal(track.status, "active");
    assert.ok(Array.isArray(track.evidence_pointers));
    assert.ok(track.evidence_pointers.length >= 1);
    assert.ok(typeof track.reasoning_packet_dir === "string" && track.reasoning_packet_dir.length > 0);
    assert.ok(typeof track.working_memory_path === "string" && track.working_memory_path.length > 0);
    assert.ok(typeof track.synthesis_packet_path === "string" && track.synthesis_packet_path.length > 0);
    await fs.access(path.join(projectRoot, track.working_memory_path));
    await fs.access(path.join(projectRoot, track.synthesis_packet_path));
  }

  const refreshedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.deepEqual(refreshedManifest.active_track_ids, [
    "fd-gcd-freq-debiased",
    "talon-gcd-bias",
  ]);
  assert.equal(refreshedManifest.primary_track_id, "fd-gcd-freq-debiased");
  assert.equal(refreshedManifest.track_registry?.active_tracks, 2);
});

test("research_workflow materializes paper story and review pressure contracts from ideation outputs", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  await fs.mkdir(path.join(projectRoot, "researcher", "ideation"), {
    recursive: true,
  });
  await fs.mkdir(path.join(projectRoot, "researcher", "brainstorm-cycle"), {
    recursive: true,
  });

  await fs.writeFile(
    path.join(projectRoot, "researcher", "ideation", "RESEARCH_PROPOSAL.md"),
    "# Research Proposal\n\n## Background\nClaim support drifts as drafts widen.\n\n## Method\nUse graph-grounded routing to keep each claim aligned with support packets.\n\n## Experiment Plan\n- Reproduce baseline-router.\n- Enable graph-grounded routing.\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "ideation", "PROBLEM_DECOMPOSITION.md"),
    "# Problem Decomposition\n\n## Sub-problems\n- preserve support precision\n- avoid clarity collapse\n\n## Validation Ladder\n- reproduce baseline\n- enable routing delta\n- add writing integration\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "brainstorm-cycle", "STORYLINE_BRIEF.json"),
    `${JSON.stringify(
      {
        thesis: "Challenge -> graph router -> evidence-backed clarity",
        arc: "Task -> challenge -> insight -> contribution -> advantage",
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.mkdir(path.join(projectRoot, "analyzer"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "analyzer", "CLAIM_EVIDENCE_MATRIX.md"),
    `# Claim Evidence Matrix

| Claim ID | Claim | Support |
| --- | --- | --- |
| claim-1 | Graph-grounded routing improves support precision over baseline-router. | SUPPORTED |
| claim-2 | The router is the causal source of the gain. | PARTIAL |
| claim-3 | The method preserves clarity while improving support precision. | UNSUPPORTED |
`,
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "analyzer", "UNSUPPORTED_CLAIMS.md"),
    `# Unsupported Claims

- Primary claim unsupported in write scope: claim-3
`,
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "analyzer", "TRACK_VERDICTS.md"),
    `# Track Verdicts

- track-main: foreground
`,
    "utf8"
  );

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "write";
  manifest.research_program = {
    status: "approved",
    goal: "Improve support precision in scientific storytelling.",
    problem_statement: "Drafts lose fine-grained support when the narrative expands.",
    baseline_reference: "baseline-router",
    primary_metric: "support_precision",
    datasets: ["demo-set"],
    success_criteria: ["support_precision improves over baseline-router"],
    zotero_project_path: "bot/demo-project",
    tracks: [
      {
        track_id: "track-main",
        status: "active",
        hypothesis:
          "Graph-grounded routing improves support precision without weakening clarity.",
        novelty_basis:
          "Use graph evidence as a routing signal for claim construction.",
        required_baselines: ["baseline-router"],
      },
    ],
  };
  manifest.ideation_contract = {
    status: "ready",
    contract_version: 1,
    basis_stage: "frontier_mapping",
    long_term_goal: "Produce reviewer-defensible, graph-grounded research narratives.",
    problem_scope: "Support precision under widening narrative scope.",
    research_proposal_path: "researcher/ideation/RESEARCH_PROPOSAL.md",
    problem_decomposition_path: "researcher/ideation/PROBLEM_DECOMPOSITION.md",
    graph_ideation_indices: {
      status: "ready",
      candidate_source_domains: ["scientific-visualization", "human-computer-interaction"],
      selected_source_domains: ["scientific-visualization"],
      pruned_source_domains: ["human-computer-interaction"],
      bridge_evidence_tier: "moderate",
    },
    selected_direction_id: "dir-main",
    selected_track_id: "track-main",
  };
  manifest.brainstorm_cycle = {
    status: "ready",
    provider: "workflow_core_brainstorm",
    selected_option_id: "dir-main",
    selected_option_title: "Graph-grounded support router",
    selected_option_score: 0.91,
    track_id: "track-main",
    storyline_brief_path: "researcher/brainstorm-cycle/STORYLINE_BRIEF.json",
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const storyResult = await executeWorkflowTool(tool, {
    action: "materialize_paper_story_state",
    paperStoryMaterialization: {
      basis_stage: "plan",
    },
  });

  assert.equal(storyResult.state.status, "ready");
  assert.equal(storyResult.state.storylineSourceTrackId, "track-main");
  assert.equal(storyResult.state.claimSupportStatus, "unsupported");
  assert.equal(storyResult.state.supportedClaimCount, 1);
  assert.equal(storyResult.state.partialClaimCount, 1);
  assert.equal(storyResult.state.unsupportedClaimCount, 1);
  assert.equal(storyResult.storySpineExists, true);
  assert.equal(storyResult.claimToExperimentMapExists, true);
  assert.equal(
    storyResult.state.ideaToClaimMapPath,
    "researcher/idea-catalyst/IDEA_TO_CLAIM_MAP.json"
  );

  const storySpine = await fs.readFile(
    path.join(projectRoot, "academic_writer", "story", "STORY_SPINE.md"),
    "utf8"
  );
  assert.match(storySpine, /Task -> challenge -> insight -> contribution -> advantage/i);
  assert.match(storySpine, /support precision/i);
  assert.match(storySpine, /track-main/i);
  assert.match(storySpine, /claim-3/i);

  const claimMap = await fs.readFile(
    path.join(projectRoot, "academic_writer", "story", "CLAIM_TO_EXPERIMENT_MAP.md"),
    "utf8"
  );
  assert.match(claimMap, /baseline-router/i);
  assert.match(claimMap, /support_precision/i);

  const ideaToClaimMap = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "idea-catalyst", "IDEA_TO_CLAIM_MAP.json"),
      "utf8"
    )
  );
  assert.equal(Array.isArray(ideaToClaimMap.mappings), true);
  assert.equal(ideaToClaimMap.mappings.length >= 1, true);
  assert.equal(
    ["challenge", "insight", "contribution", "advantage"].includes(
      ideaToClaimMap.mappings[0].story_arc_position
    ),
    true
  );
  assert.equal(Array.isArray(ideaToClaimMap.mappings[0].expected_claims), true);
  assert.equal(ideaToClaimMap.mappings[0].expected_claims.length >= 1, true);

  const fallbackNarrative = await fs.readFile(
    path.join(projectRoot, "academic_writer", "story", "FALLBACK_NARRATIVE.md"),
    "utf8"
  );
  assert.match(fallbackNarrative, /claim-3/i);

  const reviewResult = await executeWorkflowTool(tool, {
    action: "materialize_review_pressure_packet",
    reviewPressureMaterialization: {
      basis_stage: "review",
    },
  });

  assert.equal(reviewResult.state.status, "ready");
  assert.equal(reviewResult.rejectFirstReviewExists, true);
  assert.equal(reviewResult.unsupportedClaimAuditExists, true);

  const rejectFirst = await fs.readFile(
    path.join(projectRoot, "reviewer", "story-pressure", "REJECT_FIRST_REVIEW.md"),
    "utf8"
  );
  assert.match(rejectFirst, /baseline-router/i);
  assert.match(rejectFirst, /support precision/i);

  const unsupportedClaims = await fs.readFile(
    path.join(projectRoot, "reviewer", "story-pressure", "UNSUPPORTED_CLAIM_AUDIT.md"),
    "utf8"
  );
  assert.match(unsupportedClaims, /claim-1/i);
  assert.match(unsupportedClaims, /graph-grounded routing/i);

  const discoveryResult = await executeWorkflowTool(tool, {
    action: "materialize_literature_discovery_packet",
    literatureDiscoveryMaterialization: {
      origin_stage: "review",
    },
  });

  assert.equal(discoveryResult.required, true);
  assert.equal(
    discoveryResult.packetPath,
    "researcher/literature-discovery/LITERATURE_DISCOVERY_PACKET.json"
  );
  assert.equal(discoveryResult.packet.discovery_reason, "review_story_support_gap");
  assert.deepEqual(discoveryResult.packet.required_stage_reentry, [
    "graph_build",
    "review",
  ]);
  assert.ok(discoveryResult.packet.candidate_queries.length >= 2);
  assert.deepEqual(discoveryResult.packet.target_domains, [
    "scientific-visualization",
  ]);

  const discoveryPacket = JSON.parse(
    await fs.readFile(
      path.join(
        projectRoot,
        "researcher",
        "literature-discovery",
        "LITERATURE_DISCOVERY_PACKET.json"
      ),
      "utf8"
    )
  );
  assert.equal(discoveryPacket.discovery_reason, "review_story_support_gap");
  assert.match(discoveryPacket.selection_rationale ?? "", /unsupported|limitation/i);
  assert.match(discoveryPacket.next_action_suggestion ?? "", /graph_build/i);
});

test("research_workflow set_paper_ingestion broadcasts each newly completed PaperNexus import once", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const runtimeCalls = [];

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    sessionKey: "agent:researcher:discord:group:paper-lab",
    messageChannel: "discord",
    runtime: {
      subagent: {
        async run(params) {
          runtimeCalls.push(params);
          return { runId: `runtime-run-${runtimeCalls.length}` };
        },
      },
    },
  });

  const firstResult = await executeWorkflowTool(tool, {
    action: "set_paper_ingestion",
    paperIngestion: {
      runtime_status: "reconciling",
      waiting_reason: "Shared graph is reconciling after a completed import.",
      last_import_status: "completed",
      completed_papers: [
        {
          canonical_id: "arxiv:2502.00032",
          title: "Retrieval-Augmented Experiment Planning",
          import_task_id: "imp-42",
        },
      ],
    },
  });
  assert.equal(firstResult.state.completedPapers.length, 1);
  assert.equal(firstResult.state.completedPapers[0].canonicalId, "arxiv:2502.00032");
  assert.equal(firstResult.completedPaperBroadcasts.length, 1);
  assert.ok(
    runtimeCalls.some(
      (entry) =>
        entry.deliver === true &&
        /\[Workflow Status\]/.test(entry.message) &&
        /Status: completed/i.test(entry.message) &&
        /Retrieval-Augmented Experiment Planning/.test(entry.message) &&
        /imp-42/.test(entry.message)
    )
  );

  const completedBroadcastCountAfterFirst = runtimeCalls.filter(
    (entry) =>
      entry.deliver === true &&
      /\[Workflow Status\]/.test(entry.message) &&
      /Status: completed/i.test(entry.message)
  ).length;

  const repeatedResult = await executeWorkflowTool(tool, {
    action: "set_paper_ingestion",
    paperIngestion: {
      runtime_status: "reconciling",
      last_import_status: "completed",
      completed_papers: [
        {
          canonical_id: "arxiv:2502.00032",
          title: "Retrieval-Augmented Experiment Planning",
          import_task_id: "imp-42",
        },
      ],
    },
  });
  assert.equal(repeatedResult.state.completedPapers.length, 1);
  assert.equal(repeatedResult.completedPaperBroadcasts.length, 0);

  const completedBroadcastCountAfterRepeat = runtimeCalls.filter(
    (entry) =>
      entry.deliver === true &&
      /\[Workflow Status\]/.test(entry.message) &&
      /Status: completed/i.test(entry.message)
  ).length;
  assert.equal(completedBroadcastCountAfterRepeat, completedBroadcastCountAfterFirst);

  const secondResult = await executeWorkflowTool(tool, {
    action: "set_paper_ingestion",
    paperIngestion: {
      runtime_status: "reconciling",
      last_import_status: "completed",
      completed_papers: [
        {
          canonical_id: "doi:10.1000/demo-paper",
          title: "Graph Refresh Timing for Shared Research Corpora",
          import_task_id: "imp-77",
        },
      ],
    },
  });
  assert.equal(secondResult.state.completedPapers.length, 2);
  assert.equal(secondResult.completedPaperBroadcasts.length, 1);

  const completedBroadcastCountAfterSecond = runtimeCalls.filter(
    (entry) =>
      entry.deliver === true &&
      /\[Workflow Status\]/.test(entry.message) &&
      /Status: completed/i.test(entry.message)
  ).length;
  assert.equal(completedBroadcastCountAfterSecond, completedBroadcastCountAfterFirst + 1);
  assert.ok(
    runtimeCalls.some(
      (entry) =>
        entry.deliver === true &&
        /Graph Refresh Timing for Shared Research Corpora/.test(entry.message) &&
        /imp-77/.test(entry.message)
    )
  );
});

test("research_workflow set_paper_ingestion persists batch manifest progress and batch status broadcasts", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const runtimeCalls = [];

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    sessionKey: "agent:researcher:discord:group:paper-lab",
    messageChannel: "discord",
    runtime: {
      subagent: {
        async run(params) {
          runtimeCalls.push(params);
          return { runId: `runtime-run-${runtimeCalls.length}` };
        },
      },
    },
  });

  const firstResult = await executeWorkflowTool(tool, {
    action: "set_paper_ingestion",
    paperIngestion: {
      runtime_status: "waiting_import",
      waiting_reason: "Batch import is still syncing remote tasks.",
      last_batch_manifest_path: "/tmp/demo/batch-import.json",
      active_batches: [
        {
          manifest_path: "/tmp/demo/batch-import.json",
          status: "running",
          total: 4,
          submitted: 4,
          completed: 1,
          running: 2,
          pending: 1,
          failed: 0,
          submit_failed: 0,
          updated_at: "2026-04-01T00:00:00Z",
        },
      ],
      batch_items: [
        {
          manifest_path: "/tmp/demo/batch-import.json",
          paper_id: "paper-1",
          canonical_id: "arxiv:2501.00031",
          title: "First Batch Paper",
          import_task_id: "imp-1",
          status: "completed",
          synced: true,
          submitted: true,
          updated_at: "2026-04-01T00:00:00Z",
        },
        {
          manifest_path: "/tmp/demo/batch-import.json",
          paper_id: "paper-2",
          canonical_id: "arxiv:2501.00032",
          title: "Second Batch Paper",
          import_task_id: "imp-2",
          status: "running",
          synced: false,
          submitted: true,
          updated_at: "2026-04-01T00:00:00Z",
        },
      ],
    },
  });

  assert.equal(firstResult.state.activeBatches.length, 1);
  assert.equal(firstResult.state.batchItems.length, 2);
  assert.equal(firstResult.state.lastBatchManifestPath, "/tmp/demo/batch-import.json");

  const secondResult = await executeWorkflowTool(tool, {
    action: "set_paper_ingestion",
    paperIngestion: {
      runtime_status: "reconciling",
      active_batches: [
        {
          manifest_path: "/tmp/demo/batch-import.json",
          status: "completed",
          total: 4,
          submitted: 4,
          completed: 4,
          running: 0,
          pending: 0,
          failed: 0,
          submit_failed: 0,
          updated_at: "2026-04-01T00:01:00Z",
          finished_at: "2026-04-01T00:01:00Z",
        },
      ],
    },
  });

  assert.equal(secondResult.state.activeBatches[0].status, "completed");
  assert.equal(secondResult.batchStatusBroadcasts.length, 1);
  assert.ok(
    runtimeCalls.some(
      (entry) =>
        entry.deliver === true &&
        /\[Workflow Status\]/.test(entry.message) &&
        /Batch import completed/i.test(entry.message) &&
        /batch-import\.json/.test(entry.message)
    )
  );
});

test("research_workflow set_paper_ingestion merges enriched completion metadata without rebroadcasting", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const runtimeCalls = [];

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    sessionKey: "agent:researcher:discord:group:paper-lab",
    messageChannel: "discord",
    runtime: {
      subagent: {
        async run(params) {
          runtimeCalls.push(params);
          return { runId: `runtime-run-${runtimeCalls.length}` };
        },
      },
    },
  });

  const initialResult = await executeWorkflowTool(tool, {
    action: "set_paper_ingestion",
    paperIngestion: {
      runtime_status: "reconciling",
      last_import_status: "completed",
      completed_papers: [
        {
          title: "Queued Corpus Merge For Planning Agents",
          import_task_id: "imp-108",
        },
      ],
    },
  });
  assert.equal(initialResult.state.completedPapers.length, 1);
  assert.equal(initialResult.completedPaperBroadcasts.length, 1);

  const enrichedResult = await executeWorkflowTool(tool, {
    action: "set_paper_ingestion",
    paperIngestion: {
      runtime_status: "reconciling",
      last_import_status: "completed",
      completed_papers: [
        {
          canonical_id: "arxiv:2601.00108",
          title: "Queued Corpus Merge For Planning Agents",
          import_task_id: "imp-108",
        },
      ],
    },
  });
  assert.equal(enrichedResult.state.completedPapers.length, 1);
  assert.equal(
    enrichedResult.state.completedPapers[0].canonicalId,
    "arxiv:2601.00108"
  );
  assert.equal(enrichedResult.completedPaperBroadcasts.length, 0);

  const completedBroadcastCount = runtimeCalls.filter(
    (entry) =>
      entry.deliver === true &&
      /\[Workflow Status\]/.test(entry.message) &&
      /Status: completed/i.test(entry.message)
  ).length;
  assert.equal(completedBroadcastCount, 1);
});

test("research_workflow set_paper_ingestion tracks per-paper timeout state and broadcasts it once", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const runtimeCalls = [];

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    sessionKey: "agent:researcher:discord:group:paper-lab",
    messageChannel: "discord",
    runtime: {
      subagent: {
        async run(params) {
          runtimeCalls.push(params);
          return { runId: `runtime-run-${runtimeCalls.length}` };
        },
      },
    },
  });

  const firstResult = await executeWorkflowTool(tool, {
    action: "set_paper_ingestion",
    paperIngestion: {
      runtime_status: "waiting_import",
      waiting_reason: "Queued PaperNexus import imp-71 timed out after 60 seconds; moved on to the next paper.",
      last_import_task_id: "imp-71",
      last_import_status: "timeout",
      paper_operations: [
        {
          canonical_id: "arxiv:2603.19918",
          title: "Learning Like Humans: Analogical Concept Learning for Generalized Category Discovery",
          import_task_id: "imp-71",
          phase: "import",
          status: "timed_out",
          timeout_seconds: 60,
          started_at: "2026-03-30T03:10:00.000Z",
          deadline_at: "2026-03-30T03:11:00.000Z",
          finished_at: "2026-03-30T03:11:00.000Z",
          detail: "Timed out after 60 seconds while waiting for the remote import task to finish.",
        },
      ],
    },
  });
  assert.equal(firstResult.state.paperOperations.length, 1);
  assert.equal(firstResult.state.paperOperations[0].status, "timed_out");
  assert.equal(firstResult.state.paperOperations[0].timeoutSeconds, 60);
  assert.equal(firstResult.paperOperationBroadcasts.length, 1);
  assert.ok(
    runtimeCalls.some(
      (entry) =>
        entry.deliver === true &&
        /\[Workflow Status\]/.test(entry.message) &&
        /Status: waiting/i.test(entry.message) &&
        /timed out after 60s/i.test(entry.message) &&
        /Learning Like Humans/.test(entry.message) &&
        /imp-71/.test(entry.message)
    )
  );

  const timeoutBroadcastCountAfterFirst = runtimeCalls.filter(
    (entry) =>
      entry.deliver === true &&
      /\[Workflow Status\]/.test(entry.message) &&
      /Status: waiting/i.test(entry.message) &&
      /timed out after 60s/i.test(entry.message)
  ).length;

  const repeatedResult = await executeWorkflowTool(tool, {
    action: "set_paper_ingestion",
    paperIngestion: {
      runtime_status: "waiting_import",
      last_import_task_id: "imp-71",
      last_import_status: "timeout",
      paper_operations: [
        {
          canonical_id: "arxiv:2603.19918",
          title: "Learning Like Humans: Analogical Concept Learning for Generalized Category Discovery",
          import_task_id: "imp-71",
          phase: "import",
          status: "timed_out",
          timeout_seconds: 60,
          started_at: "2026-03-30T03:10:00.000Z",
          deadline_at: "2026-03-30T03:11:00.000Z",
          finished_at: "2026-03-30T03:11:00.000Z",
        },
      ],
    },
  });
  assert.equal(repeatedResult.state.paperOperations.length, 1);
  assert.equal(repeatedResult.paperOperationBroadcasts.length, 0);

  const timeoutBroadcastCountAfterRepeat = runtimeCalls.filter(
    (entry) =>
      entry.deliver === true &&
      /\[Workflow Status\]/.test(entry.message) &&
      /Status: waiting/i.test(entry.message) &&
      /timed out after 60s/i.test(entry.message)
  ).length;
  assert.equal(timeoutBroadcastCountAfterRepeat, timeoutBroadcastCountAfterFirst);
});

test("research_workflow auto_iterator_tick broadcasts a continued status when timed-default proceeds", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const runtimeCalls = [];

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "demo-project",
        current_stage: "code",
        owner_agent: "coder",
        idle_research: { enabled: false },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    runtime: {
      subagent: {
        async run(params) {
          runtimeCalls.push(params);
          return { runId: `runtime-run-${runtimeCalls.length}` };
        },
      },
    },
  });

  await executeWorkflowTool(tool, {
    action: "set_gate_state",
    gateState: {
      current_stage: "code",
      last_gate: "CONFIRM-RESUME-1",
      gate_status: "waiting",
      gate_type: "timed_default",
      auto_proceed: false,
      confirmation_requested_at: "1999-12-31T23:00:00.000Z",
      confirmation_deadline_at: "2000-01-01T00:00:00.000Z",
      default_action: "resume_recommended_stage",
      default_action_reason:
        "No user reply within 1h; continue with the workflow-safe default branch.",
    },
  });

  const result = await executeWorkflowTool(tool, {
    action: "auto_iterator_tick",
    iterator: {
      mode: "test",
      queueMailbox: false,
      dispatchTasks: false,
      broadcastStageChange: false,
    },
  });

  assert.equal(result.timedDefaultTriggered, true);
  assert.equal(result.statusBroadcast.broadcasted, true);
  assert.ok(
    runtimeCalls.some(
      (entry) =>
        entry.deliver === true &&
        /\[Workflow Status\]/.test(entry.message) &&
        /Status: continued/i.test(entry.message)
    )
  );
});

test("research_workflow start_background_run broadcasts queued status when the researcher pool is full", async (t) => {
  const projectRoot = await makeProjectRoot();
  const registryPath = path.join(
    os.tmpdir(),
    `openclaw-research-background-runs-workflow-runtime-tools-${Date.now()}-queued.json`
  );
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const previousRegistryPath = process.env.OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH;
  const runtimeCalls = [];

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    if (previousRegistryPath === undefined) {
      delete process.env.OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH;
    } else {
      process.env.OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH = previousRegistryPath;
    }
    await clearBackgroundWorkflowRunRegistryForTests();
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(registryPath, { force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  process.env.OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH = registryPath;
  await clearBackgroundWorkflowRunRegistryForTests();

  await recordBackgroundWorkflowRun({
    ownerAgent: "researcher",
    channelKey: "discord:group:paper-lab",
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    backgroundSessionKey: "agent:researcher:discord:group:paper-lab:bg-1",
    runId: "run-active-1",
    kind: "research_pipeline",
    family: "research",
    projectId: "demo-project",
    projectRoot,
  });
  await recordBackgroundWorkflowRun({
    ownerAgent: "researcher",
    channelKey: "discord:group:paper-lab",
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    backgroundSessionKey: "agent:researcher:discord:group:paper-lab:bg-2",
    runId: "run-active-2",
    kind: "research_pipeline",
    family: "research",
    projectId: "demo-project",
    projectRoot,
  });

  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    sessionKey: "agent:researcher:discord:group:paper-lab",
    messageChannel: "discord",
    runtime: {
      subagent: {
        async run(params) {
          runtimeCalls.push(params);
          return { runId: `runtime-run-${runtimeCalls.length}` };
        },
        async waitForRun() {
          return { status: "timeout" };
        },
      },
    },
  });

  const result = await executeWorkflowTool(tool, {
    action: "start_background_run",
    backgroundRun: {
      kind: "research_pipeline",
      topic: "queued topic",
      ensureProjectBinding: false,
    },
  });

  assert.equal(result.started, false);
  assert.equal(result.reason, "channel_capacity_reached");
  assert.equal(result.statusBroadcast.broadcasted, true);
  assert.ok(
    runtimeCalls.some(
      (entry) =>
        entry.deliver === true &&
        /\[Workflow Status\]/.test(entry.message) &&
        /Status: queued/i.test(entry.message) &&
        /already has 2 active Researcher background subagents/i.test(entry.message)
    )
  );
});

test("research_workflow start_background_run broadcasts reused status context when an idle researcher session is reused", async (t) => {
  const projectRoot = await makeProjectRoot();
  const registryPath = path.join(
    os.tmpdir(),
    `openclaw-research-background-runs-workflow-runtime-tools-${Date.now()}-reused.json`
  );
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const previousRegistryPath = process.env.OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH;
  const runtimeCalls = [];
  const reusedSessionKey = "agent:researcher:discord:group:paper-lab:workflow-research-pipeline";

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    if (previousRegistryPath === undefined) {
      delete process.env.OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH;
    } else {
      process.env.OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH = previousRegistryPath;
    }
    await clearBackgroundWorkflowRunRegistryForTests();
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(registryPath, { force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  process.env.OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH = registryPath;
  await clearBackgroundWorkflowRunRegistryForTests();

  await recordBackgroundWorkflowRun({
    ownerAgent: "researcher",
    channelKey: "discord:group:paper-lab",
    requesterSessionKey: "agent:researcher:discord:group:paper-lab",
    backgroundSessionKey: reusedSessionKey,
    runId: "run-finished-1",
    kind: "research_pipeline",
    family: "research",
    projectId: "demo-project",
    projectRoot,
  });

  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    sessionKey: "agent:researcher:discord:group:paper-lab",
    messageChannel: "discord",
    runtime: {
      subagent: {
        async run(params) {
          runtimeCalls.push(params);
          return { runId: `runtime-run-${runtimeCalls.length}` };
        },
        async waitForRun() {
          return { status: "ok" };
        },
      },
    },
  });

  const result = await executeWorkflowTool(tool, {
    action: "start_background_run",
    backgroundRun: {
      kind: "research_pipeline",
      topic: "reused topic",
      ensureProjectBinding: false,
    },
  });

  assert.equal(result.started, true);
  assert.equal(result.reusedIdleSession, true);
  assert.equal(result.sessionKey, reusedSessionKey);
  assert.equal(result.statusBroadcast.broadcasted, true);
  assert.ok(
    runtimeCalls.some(
      (entry) =>
        entry.deliver === false && entry.sessionKey === reusedSessionKey
    )
  );
  assert.ok(
    runtimeCalls.some(
      (entry) =>
        entry.deliver === true &&
        /\[Workflow Status\]/.test(entry.message) &&
        /Status: started/i.test(entry.message) &&
        /Reused an idle Researcher subagent and started/i.test(entry.message)
    )
  );
});

test("research_workflow run_papernexus_wrapper starts a dedicated wrapper-first graph run", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const runtimeCalls = [];

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await clearBackgroundWorkflowRunRegistryForTests();
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    sessionKey: "agent:researcher:discord:group:paper-lab",
    messageChannel: "discord",
    runtime: {
      subagent: {
        async run(params) {
          runtimeCalls.push(params);
          return { runId: `runtime-run-${runtimeCalls.length}` };
        },
        async waitForRun() {
          return { status: "ok" };
        },
      },
    },
  });

  const result = await executeWorkflowTool(tool, {
    action: "run_papernexus_wrapper",
    papernexusWrapper: {
      wrapper: "pn_graph_query",
      args: [
        "--api-base",
        "https://papernexus.example/api",
        "--corpus",
        "demo",
        "query",
        "causal abstraction",
        "--limit",
        "8",
      ],
      summary: "Queued a typed PaperNexus graph query in a dedicated subagent.",
      ensureProjectBinding: false,
    },
  });

  assert.equal(result.started, true);
  assert.equal(result.reason, "started");
  assert.equal(result.wrapper, "pn_graph_query.py");
  assert.match(result.commandText, /^python3 scripts\/pn_graph_query\.py\b/);
  assert.match(result.commandText, /query 'causal abstraction'/);
  assert.equal(result.statusBroadcast.broadcasted, true);
  assert.ok(
    runtimeCalls.some(
      (entry) =>
        entry.deliver === false &&
        /^python3 scripts\/pn_graph_query\.py\b/.test(entry.message) &&
        /__BACKGROUND_CONTINUATION__:\s*true/i.test(entry.message)
    )
  );
  assert.ok(
    runtimeCalls.some(
      (entry) =>
        entry.deliver === true &&
        /\[Workflow Status\]/.test(entry.message) &&
        /typed PaperNexus graph query/i.test(entry.message)
    )
  );
});

test("research_workflow run_papernexus_wrapper records owner_run progress for import wrappers", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await clearBackgroundWorkflowRunRegistryForTests();
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    sessionKey: "agent:researcher:discord:group:paper-lab",
    messageChannel: "discord",
    runtime: {
      subagent: {
        async run() {
          return { runId: "runtime-run-import-1" };
        },
        async waitForRun() {
          return { status: "timeout" };
        },
      },
    },
  });

  const result = await executeWorkflowTool(tool, {
    action: "run_papernexus_wrapper",
    papernexusWrapper: {
      wrapper: "pn_batch_import.py",
      args: [
        "--mcp-url",
        "https://papernexus.example/mcp",
        "--corpus",
        "demo",
        "--manifest",
        "/tmp/demo/batch-import.json",
        "submit",
      ],
      summary: "Queued a workflow-owned batch import.",
      ensureProjectBinding: false,
    },
  });

  assert.equal(result.started, true);
  const progress = await executeWorkflowTool(tool, {
    action: "get_papernexus_progress",
  });
  assert.equal(progress.progress.phase, "submitting");
  assert.equal(progress.progress.owner_run.run_id, "runtime-run-import-1");
  assert.equal(progress.progress.owner_run.wrapper, "pn_batch_import.py");
  assert.match(
    progress.progress.owner_run.session_key ?? "",
    /papernexus-(skill|wrapper)/i
  );
});

test("research_workflow runtime-state actions persist manifest state and append temp traces", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const tracePath = getWorkflowTraceLogPath({
    projectRoot,
    projectId: "demo-project",
  });

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(tracePath, { force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  const writingSession = await executeWorkflowTool(tool, {
    action: "set_writing_session",
    writingSession: {
      status: "ready_for_submit",
      current_section: "abstract",
      section_packets: {
        abstract: {
          section: "abstract",
          packet_path: "academic_writer/section_packets/abstract.md",
          status: "finalized",
          review_verdict: "publication_ready",
        },
      },
      graph_evidence_coverage_status: "covered",
    },
  });
  assert.equal(writingSession.state.status, "ready_for_submit");
  assert.equal(writingSession.readyForSubmit, true);

  const reviewSession = await executeWorkflowTool(tool, {
    action: "set_review_session",
    reviewSession: {
      status: "completed",
      stage_scope: "review",
      round: 2,
      verdict: "ready",
      reviewer_summary: "Ready to hand off to writing.",
      action_items: ["Polish the abstract."],
    },
  });
  assert.equal(reviewSession.state.status, "completed");
  assert.equal(reviewSession.state.stageScope, "review");
  const reviewStateFile = JSON.parse(
    await fs.readFile(path.join(projectRoot, "researcher", "REVIEW_STATE.json"), "utf8")
  );
  assert.equal(reviewStateFile.round, 2);
  assert.equal(reviewStateFile.status, "completed");
  assert.equal(reviewStateFile.lastVerdict, "ready");
  assert.deepEqual(reviewStateFile.pendingActions, ["Polish the abstract."]);
  const reviewPacketFile = JSON.parse(
    await fs.readFile(path.join(projectRoot, "reviewer", "REVIEW_PACKET.json"), "utf8")
  );
  assert.equal(reviewPacketFile.status, "completed");
  assert.equal(reviewPacketFile.verdict, "ready");
  const graphEvidenceSummary = await fs.readFile(
    path.join(projectRoot, "reviewer", "GRAPH_EVIDENCE_SUMMARY.md"),
    "utf8"
  );
  assert.match(graphEvidenceSummary, /Verdict:\s+ready/i);
  const submissionSimulationReview = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "reviewer", "SUBMISSION_SIMULATION_REVIEW.json"),
      "utf8"
    )
  );
  assert.equal(submissionSimulationReview.status, "completed");
  assert.equal(submissionSimulationReview.verdict, "ready");

  const graphGuidedWriting = await executeWorkflowTool(tool, {
    action: "set_graph_guided_writing",
    graphGuidedWriting: {
      status: "ready",
      evidence_coverage_status: "covered",
      missing_evidence_claims: [],
      covered_headline_claim_count: 2,
      total_headline_claim_count: 2,
    },
  });
  assert.equal(graphGuidedWriting.state.status, "ready");
  assert.equal(graphGuidedWriting.readyForSubmit, true);

  const externalReview = await executeWorkflowTool(tool, {
    action: "set_external_review_state",
    externalReview: {
      status: "received",
      provider: "paperreview.ai",
      review_skill: "paperreview-submit",
      source_label: "Stanford Agentic Reviewer",
      submitted_pdf_path: "academic_writer/paper/main.pdf",
      external_review_path: "reviewer/external_review_2026-03-26.md",
      review_response_path: "reviewer/rebuttal_2026-03-26.md",
      overall_recommendation: "minor_revision",
      required_action: "rollback_write",
    },
  });
  assert.equal(externalReview.state.status, "received");
  assert.equal(externalReview.state.reviewSkill, "paperreview-submit");
  const externalReviewFile = await fs.readFile(
    path.join(projectRoot, "reviewer", "external_review_2026-03-26.md"),
    "utf8"
  );
  assert.match(externalReviewFile, /Overall Recommendation:\s+minor_revision/i);
  const rebuttalFile = await fs.readFile(
    path.join(projectRoot, "reviewer", "rebuttal_2026-03-26.md"),
    "utf8"
  );
  assert.match(rebuttalFile, /Required Action:\s+rollback_write/i);

  const paperQc = await executeWorkflowTool(tool, {
    action: "set_paper_qc",
    paperQc: {
      status: "running",
      compile_status: "pass",
      compile_round_count: 2,
      chktex_status: "pending",
      page_budget_status: "pending",
      latest_report_path: "academic_writer/PAPER_QC.md",
    },
  });
  assert.equal(paperQc.state.status, "running");
  assert.equal(paperQc.state.compileStatus, "pass");

  const figureQc = await executeWorkflowTool(tool, {
    action: "set_figure_qc",
    figureQc: {
      status: "ready",
      figure_review_path: "reviewer/SURFACE_REVIEW.json",
      figure_selection_path: "academic_writer/FIGURE_SELECTION.json",
      duplicate_figure_status: "pass",
      caption_alignment_status: "pass",
      text_alignment_status: "pass",
      selection_status: "pass",
    },
  });
  assert.equal(figureQc.state.status, "ready");
  assert.equal(figureQc.state.selectionStatus, "pass");
  const figureReviewFile = JSON.parse(
    await fs.readFile(path.join(projectRoot, "reviewer", "SURFACE_REVIEW.json"), "utf8")
  );
  assert.equal(figureReviewFile.caption_alignment_status, "pass");
  const figureSelectionFile = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "academic_writer", "FIGURE_SELECTION.json"),
      "utf8"
    )
  );
  assert.equal(figureSelectionFile.selection_status, "pass");

  const citationVerification = await executeWorkflowTool(tool, {
    action: "record_citation_verification",
    citationVerification: {
      verification_status: "verified",
      bibliography_path: "academic_writer/paper/refs.bib",
      verification_report_path: "reviewer/CITATION_VERIFICATION.md",
      verified_citation_count: 12,
      suspicious_citation_count: 1,
      hallucinated_citation_count: 0,
      unresolved_placeholder_count: 0,
      last_verified_at: "2026-03-26T09:15:00.000Z",
    },
  });
  assert.equal(citationVerification.state.verificationStatus, "verified");
  const citationVerificationReport = await fs.readFile(
    path.join(projectRoot, "reviewer", "CITATION_VERIFICATION.md"),
    "utf8"
  );
  assert.match(citationVerificationReport, /Verification Status:\s+verified/i);

  const citationCollection = await executeWorkflowTool(tool, {
    action: "set_citation_collection",
    citationCollection: {
      status: "running",
      progress_path: "academic_writer/citations_progress.json",
      cache_bib_path: "academic_writer/cached_citations.bib",
      candidate_count: 24,
      verified_count: 8,
      suspicious_count: 1,
      hallucinated_count: 0,
    },
  });
  assert.equal(citationCollection.state.status, "running");
  assert.equal(citationCollection.state.candidateCount, 24);

  const reviewIssueTracker = await executeWorkflowTool(tool, {
    action: "set_review_issue_tracker",
    reviewIssueTracker: {
      status: "open",
      issue_manifest_path: "reviewer/REVIEW_ISSUES.json",
      last_review_round: 3,
      open_counts: {
        critical: 0,
        high: 1,
        medium: 2,
        low: 1,
      },
      pending_reason: "One high-severity surface issue is still open.",
    },
  });
  assert.equal(reviewIssueTracker.state.status, "open");
  assert.equal(reviewIssueTracker.state.openCounts.high, 1);
  const reviewIssuesFile = JSON.parse(
    await fs.readFile(path.join(projectRoot, "reviewer", "REVIEW_ISSUES.json"), "utf8")
  );
  assert.equal(reviewIssuesFile.status, "open");
  assert.equal(reviewIssuesFile.open_counts.high, 1);

  const experimentSearch = await executeWorkflowTool(tool, {
    action: "set_experiment_search",
    experimentSearch: {
      status: "running",
      current_main_stage: "creative_research",
      current_substage: "branch_expansion",
      frontier_node_ids: ["node-3", "node-4"],
      best_node_id: "node-3",
      completed_node_ids: ["node-1", "node-2"],
      failed_node_ids: ["node-0"],
      tried_hyperparams: ["lr=1e-4|wd=0.01"],
      completed_ablations: ["remove_graph_adapter"],
      multi_seed_status: "running",
      evaluation_summary_path: "researcher/evaluation_summary.json",
      plot_pack_status: "pending",
      plot_pack_path: "researcher/plot_pack.json",
      stage_progress_path: "researcher/stage_progress.json",
      checkpoint_path: "researcher/checkpoints/experiment-manager.json",
    },
  });
  assert.equal(experimentSearch.state.status, "running");
  assert.equal(experimentSearch.state.currentMainStage, "creative_research");
  assert.equal(experimentSearch.stateFileExists, true);

  const brainstormCycle = await executeWorkflowTool(tool, {
    action: "run_brainstorm_cycle",
    brainstormCycle: {
      mode: "aggressive",
      topic: "Graph-grounded novelty synthesis for section planning",
      basis_stage: "frontier_mapping",
      track_id: "track-main",
      provider: "workflow_core_brainstorm",
      provider_mode: "core",
      provider_status: "ready",
      contract_version: 1,
      graph_version_seen: "global-v42",
      import_task_ids_seen: ["imp-1", "imp-2"],
      topic_summary: {
        objective: "Produce a reconciled novelty bundle before ideation.",
        constraints: ["stay within shared graph evidence"],
      },
      research_brief: {
        anchors: ["anchor-a", "anchor-b"],
        frontier_focus: "limitations and transfer gaps",
      },
      brainstorm_brief: {
        mode: "diverge",
        requested_rounds: 2,
      },
      rounds: [
        {
          round_id: "round-1",
          label: "diverge",
          status: "completed",
          options: [
            {
              option_id: "opt-a",
              title: "Baseline router",
              score: 0.62,
              summary: "A conservative graph-router extension.",
              logic_chain: "# Logic A\n",
              evidence_chain: "# Evidence A\n",
              reasoning_trace: [{ step: "inspect-anchor-a", conclusion: "partial gap" }],
              question_packet: "# Questions A\n",
              working_memory: { hypothesis: "A" },
              synthesis_packet: "# Synthesis A\n",
            },
            {
              option_id: "opt-b",
              title: "Compositional novelty router",
              score: 0.93,
              summary: "A stronger graph-grounded novelty direction.",
              logic_chain: "# Logic B\n",
              evidence_chain: "# Evidence B\n",
              reasoning_trace: [{ step: "inspect-anchor-b", conclusion: "composable gap" }],
              question_packet: "# Questions B\n",
              working_memory: { hypothesis: "B" },
              synthesis_packet: "# Synthesis B\n",
              reflection_chain: { stance: "keep" },
              theory_brief: { theorem_seed: "lemma-demo" },
              storyline_brief: { arc: "gap -> method -> evidence" },
            },
          ],
        },
        {
          round_id: "round-2",
          label: "converge",
          status: "completed",
          options: [
            {
              option_id: "opt-c",
              title: "Converged shortlist",
              score: 0.81,
              summary: "A merged shortlist with lower score than opt-b.",
              logic_chain: "# Logic C\n",
              evidence_chain: "# Evidence C\n",
              reasoning_trace: [{ step: "compare-a-b", conclusion: "opt-b wins" }],
              question_packet: "# Questions C\n",
              working_memory: { hypothesis: "C" },
              synthesis_packet: "# Synthesis C\n",
            },
          ],
        },
      ],
    },
  });
  assert.equal(brainstormCycle.state.status, "reconciled");
  assert.equal(brainstormCycle.state.selectedOptionId, "opt-b");
  assert.equal(brainstormCycle.state.selectedRoundId, "round-1");
  assert.equal(brainstormCycle.state.provider, "workflow_core_brainstorm");
  assert.equal(brainstormCycle.state.providerMode, "core");
  assert.equal(brainstormCycle.state.providerStatus, "ready");
  assert.equal(brainstormCycle.state.contractVersion, 1);
  assert.equal(brainstormCycle.chainBundleReady, true);

  const brainstormCycleSummary = await executeWorkflowTool(tool, {
    action: "get_brainstorm_cycle",
  });
  assert.equal(brainstormCycleSummary.state.selectedOptionId, "opt-b");
  assert.equal(brainstormCycleSummary.state.rounds.length, 2);
  assert.equal(brainstormCycleSummary.state.provider, "workflow_core_brainstorm");
  assert.equal(brainstormCycleSummary.logicChainExists, true);
  assert.equal(brainstormCycleSummary.reasoningTraceExists, true);

  const writingSummary = await executeWorkflowTool(tool, {
    action: "get_writing_session",
  });
  assert.equal(writingSummary.state.currentSection, "abstract");
  assert.equal(writingSummary.readyForSubmit, true);

  const externalReviewSummary = await executeWorkflowTool(tool, {
    action: "get_external_review_state",
  });
  assert.equal(externalReviewSummary.state.status, "received");

  const paperQcSummary = await executeWorkflowTool(tool, {
    action: "get_paper_qc",
  });
  assert.equal(paperQcSummary.state.compileStatus, "pass");

  const figureQcSummary = await executeWorkflowTool(tool, {
    action: "get_figure_qc",
  });
  assert.equal(figureQcSummary.state.captionAlignmentStatus, "pass");

  const citationCollectionSummary = await executeWorkflowTool(tool, {
    action: "get_citation_collection",
  });
  assert.equal(citationCollectionSummary.state.verifiedCount, 8);

  const reviewIssueTrackerSummary = await executeWorkflowTool(tool, {
    action: "get_review_issue_tracker",
  });
  assert.equal(reviewIssueTrackerSummary.state.openCounts.medium, 2);

  const experimentSearchSummary = await executeWorkflowTool(tool, {
    action: "get_experiment_search",
  });
  assert.equal(experimentSearchSummary.state.bestNodeId, "node-3");
  assert.equal(experimentSearchSummary.stateFileExists, true);

  await executeWorkflowTool(tool, {
    action: "auto_iterator_tick",
    iterator: {
      mode: "test",
      queueMailbox: false,
      dispatchTasks: false,
      broadcastStageChange: false,
    },
  });

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.writing_session.status, "ready_for_submit");
  assert.equal(manifest.review_session.status, "completed");
  assert.equal(manifest.graph_guided_writing.status, "ready");
  assert.equal(manifest.external_review_state.status, "received");
  assert.equal(manifest.paper_qc.status, "running");
  assert.equal(manifest.figure_qc.status, "ready");
  assert.equal(manifest.citation_collection.status, "running");
  assert.equal(manifest.review_issue_tracker.status, "open");
  assert.equal(manifest.experiment_search.status, "running");
  assert.equal(manifest.brainstorm_cycle.status, "reconciled");
  assert.equal(manifest.brainstorm_cycle.selected_option_id, "opt-b");
  assert.equal(manifest.brainstorm_cycle.provider, "workflow_core_brainstorm");
  assert.equal(manifest.brainstorm_cycle.provider_mode, "core");
  assert.equal(manifest.brainstorm_cycle.provider_status, "ready");
  assert.equal(manifest.brainstorm_cycle.contract_version, 1);

  const experimentSearchFile = JSON.parse(
    await fs.readFile(path.join(projectRoot, "researcher", "EXPERIMENT_SEARCH.json"), "utf8")
  );
  assert.equal(experimentSearchFile.status, "running");
  assert.equal(experimentSearchFile.best_node_id, "node-3");

  const brainstormLogic = await fs.readFile(
    path.join(projectRoot, "researcher", "reasoning", "track-main", "LOGIC_CHAIN.md"),
    "utf8"
  );
  assert.match(brainstormLogic, /Logic B/);

  const rawTrace = await fs.readFile(tracePath, "utf8");
  const traceEvents = rawTrace
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.ok(
    traceEvents.some(
      (event) =>
        event.kind === "tool_action" &&
        event.action === "set_writing_session" &&
        event.functionName === "setWritingSessionState" &&
        event.stage === "write"
    )
  );
  assert.ok(
    traceEvents.some(
      (event) =>
        event.kind === "tool_action" &&
        event.action === "set_review_session" &&
        event.functionName === "setReviewSessionState"
    )
  );
  assert.ok(
    traceEvents.some(
      (event) =>
        event.kind === "tool_action" &&
        event.action === "set_graph_guided_writing" &&
        event.functionName === "setGraphGuidedWritingState"
    )
  );
  assert.ok(
    traceEvents.some(
      (event) =>
        event.kind === "tool_action" &&
        event.action === "set_external_review_state" &&
        event.functionName === "setExternalReviewState"
    )
  );
  assert.ok(
    traceEvents.some(
      (event) =>
        event.kind === "tool_action" &&
        event.action === "set_paper_qc" &&
        event.functionName === "setPaperQcState"
    )
  );
  assert.ok(
    traceEvents.some(
      (event) =>
        event.kind === "tool_action" &&
        event.action === "set_figure_qc" &&
        event.functionName === "setFigureQcState"
    )
  );
  assert.ok(
    traceEvents.some(
      (event) =>
        event.kind === "tool_action" &&
        event.action === "set_citation_collection" &&
        event.functionName === "setCitationCollectionState"
    )
  );
  assert.ok(
    traceEvents.some(
      (event) =>
        event.kind === "tool_action" &&
        event.action === "set_review_issue_tracker" &&
        event.functionName === "setReviewIssueTrackerState"
    )
  );
  assert.ok(
    traceEvents.some(
      (event) =>
        event.kind === "tool_action" &&
        event.action === "set_experiment_search" &&
        event.functionName === "setExperimentSearchState"
    )
  );
  assert.ok(
    traceEvents.some(
      (event) =>
        event.kind === "tool_action" &&
        event.action === "run_brainstorm_cycle" &&
        event.functionName === "runBrainstormCycle"
    )
  );
  assert.ok(
    traceEvents.some(
      (event) =>
        event.kind === "auto_iterator" &&
        event.functionName === "runWorkflowAutoIterator" &&
        event.details?.stageBefore
    )
  );
  const runtimeEvents = await readWorkflowRuntimeEvents(projectRoot);
  assert.ok(
    runtimeEvents.some(
      (event) =>
        event.kind === "trace_tool_action" &&
        event.details?.functionName === "setWritingSessionState" &&
        event.details?.action === "set_writing_session"
    )
  );
});

test("research_workflow migrate_runtime_state initializes project-local runtime files and manifest audit metadata", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  const migrated = await executeWorkflowTool(tool, {
    action: "migrate_runtime_state",
    runtimeState: {
      compatibilityMode: "sessions_spawn_runtime",
      reason: "tool-test",
      notes: ["initialize runtime outboxes"],
    },
  });

  assert.equal(migrated.compatibilityMode, "sessions_spawn_runtime");
  await fs.access(getWorkflowRuntimeQueuePath(projectRoot));
  await fs.access(getWorkflowRuntimeSessionsPath(projectRoot));

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.audit.runtime_framework, "sessions_spawn_v1");
  assert.equal(
    manifest.audit.runtime_migration.compatibility_mode,
    "sessions_spawn_runtime"
  );
});
