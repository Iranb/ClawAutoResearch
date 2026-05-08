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
  getChannelProjectBindingForWorkflow,
} from "../tools/workflow-guard.ts";
import { createStageOwnerHandoffIntent } from "../tools/workflow-handoff/handoff-router.ts";
import { syncPreparedWorkflowHandoffToManifest } from "../tools/workflow-handoff/handoff-activation.ts";
import {
  clearBackgroundWorkflowRunRegistryForTests,
  recordBackgroundWorkflowRun,
} from "../tools/workflow-fast-paths.ts";
import { registerWorkflowTools } from "../tools/register-workflow-tools.ts";
import {
  getWorkflowRuntimeQueuePath,
  readWorkflowRuntimeQueueStore,
  readWorkflowRuntimeEvents,
  getWorkflowRuntimeSessionsPath,
  writeWorkflowRuntimeQueueStore,
  writeWorkflowRuntimeSessionsStore,
  appendWorkflowRuntimeEvent,
} from "../tools/workflow-runtime-state.ts";
import { getWorkflowTraceLogPath } from "../tools/workflow-trace.ts";
import { materializeWorkflowTaskGraph, readWorkflowTaskGraphStore } from "../tools/workflow-team/task-graph.ts";

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
    logger: params.logger ?? {},
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
          channelKey: params.channelKey,
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

function buildReadyReferencesBib(count = 30) {
  return Array.from({ length: count }, (_unused, index) => {
    const number = index + 1;
    return [
      `@article{ready_ref_${number},`,
      `  title={Ready Reference ${number}},`,
      "  author={Author, Test},",
      "  journal={Journal of Demo Research},",
      `  year={${2020 + (index % 6)}}`,
      "}",
    ].join("\n");
  }).join("\n\n") + "\n";
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

async function seedProjectWithPendingPlanHandoff(projectRoot) {
  await seedMinimalProject(projectRoot, {
    project_id: "demo-project",
    current_stage: "idea",
    current_micro_stage: "selection_ready",
    owner_agent: "researcher",
    orchestration_state: {
      status: "waiting",
      current_owner: "researcher",
      next_transition_candidate: "plan",
    },
  });
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), {
    tracks: [
      {
        trackId: "track-main",
        track_id: "track-main",
        status: "active",
        name: "Main track",
        hypothesis: "Graph-grounded plan should reach code cleanly.",
      },
    ],
    active_tracks: 1,
  });

  const handoff = await createStageOwnerHandoffIntent({
    projectRoot,
    projectId: "demo-project",
    workflowLine: "experiment",
    stageBefore: "idea",
    stageAfter: "plan",
    ownerBefore: "researcher",
    ownerAfter: "orchestrator",
    executionId: "exec-plan-1",
    nextAction: "Run /plan-research.",
    nextMicroStage: "planning_requested",
  });
  await syncPreparedWorkflowHandoffToManifest({
    projectRoot,
    intent: handoff.intent,
  });
  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    projectId: "demo-project",
    entries: [
      {
        transitionId: "queue-plan-1",
        queueId: "queue-plan-1",
        queueKey: `handoff:${handoff.intent.intentId}`,
        source: "workflow_auto_stage",
        entryType: "dispatch_task",
        ownerAgent: "orchestrator",
        channelKey: "discord:channel:paper-lab",
        requesterSessionKey: "agent:researcher:discord:channel:paper-lab",
        messageChannel: "discord",
        preferredSessionKey: "agent:orchestrator:discord:channel:paper-lab",
        family: "research",
        kind: "workflow_stage_dispatch",
        projectId: "demo-project",
        projectRoot,
        queuedAt: "2026-04-22T06:20:56.278Z",
        lastAttemptedAt: null,
        lastCheckedAt: null,
        attemptCount: 0,
        summary: "Queued plan handoff.",
        status: "queued",
        fallbackMode: null,
        lastError: null,
        parentSessionKey: null,
        threadBindingKey: null,
        depth: 0,
        runPayload: null,
        dispatchPayload: {
          requesterChannel: "discord",
          requesterAccountId: null,
          preferredSessionKeys: ["agent:orchestrator:discord:channel:paper-lab"],
          fromRole: "researcher",
          toRole: "orchestrator",
          projectRoot,
          projectId: "demo-project",
          stage: "plan",
          summary: "Run /plan-research.",
          command: "Run /plan-research.",
          mailboxMessageId: null,
          requireMailboxAcknowledgement: true,
          extraBody: "Continue only the assigned stage.",
          waitTimeoutMs: 5000,
          retryOnTimeout: false,
          enableSpawnFallback: true,
          useWorkflowHandoff: true,
          autoModeActive: true,
        },
      },
    ],
  });
  return handoff.intent.intentId;
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

async function writeExecutable(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
  await fs.chmod(targetPath, 0o755);
}

test("runtime stores use manifest project_id as the authoritative project identity", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeWorkflowRuntimeQueueStore({
    projectRoot,
    projectId: "stale-project",
    entries: [
      {
        transitionId: "queue-1",
        queueId: "queue-1",
        queueKey: "queue:1",
        source: "workflow_auto_stage",
        entryType: "dispatch_task",
        ownerAgent: "researcher",
        channelKey: "local:test",
        requesterSessionKey: "agent:researcher:local:test",
        messageChannel: "local",
        preferredSessionKey: "agent:researcher:local:test",
        family: "research",
        kind: "workflow_stage_dispatch",
        projectId: "stale-project",
        projectRoot,
        queuedAt: "2026-04-27T00:00:00.000Z",
        lastAttemptedAt: null,
        lastCheckedAt: null,
        attemptCount: 0,
        summary: "queued",
        status: "queued",
        fallbackMode: null,
        lastError: null,
        parentSessionKey: null,
        threadBindingKey: null,
        depth: 0,
        runPayload: null,
        dispatchPayload: {
          requesterChannel: "local",
          requesterAccountId: "default",
          preferredSessionKeys: [],
          fromRole: "researcher",
          toRole: "researcher",
          projectRoot,
          projectId: "stale-project",
          stage: "setup",
          summary: "queued",
          command: null,
          mailboxMessageId: null,
          requireMailboxAcknowledgement: false,
          extraBody: null,
          waitTimeoutMs: null,
          retryOnTimeout: false,
          enableSpawnFallback: true,
          useWorkflowHandoff: false,
          autoModeActive: true,
        },
      },
    ],
  });
  await writeWorkflowRuntimeSessionsStore({
    projectRoot,
    projectId: "stale-project",
    entries: [
      {
        sessionKey: "agent:researcher:local:test",
        sessionId: null,
        runtime: "subagent",
        role: "researcher",
        agentId: "researcher",
        ownerAgent: "researcher",
        family: "research",
        kind: "workflow_stage_dispatch",
        channelKey: "local:test",
        requesterSessionKey: "agent:researcher:local:test",
        projectId: "stale-project",
        projectRoot,
        parentSessionKey: null,
        threadBindingKey: null,
        depth: 0,
        status: "active",
        runId: "run-1",
        queueKey: "queue:1",
        startedAt: "2026-04-27T00:00:00.000Z",
        lastHeartbeatAt: null,
        lastAnnounceAt: null,
        lastCheckedAt: null,
        lastFinishedAt: null,
        lastError: null,
      },
    ],
  });
  const event = await appendWorkflowRuntimeEvent({
    projectRoot,
    projectId: "stale-project",
    kind: "identity_check",
    summary: "check",
  });

  const rawQueue = JSON.parse(
    await fs.readFile(getWorkflowRuntimeQueuePath(projectRoot), "utf8")
  );
  const rawSessions = JSON.parse(
    await fs.readFile(getWorkflowRuntimeSessionsPath(projectRoot), "utf8")
  );

  assert.equal(rawQueue.projectId, "demo-project");
  assert.equal(rawQueue.entries[0].projectId, "demo-project");
  assert.equal(rawQueue.entries[0].dispatchPayload.projectId, "demo-project");
  assert.equal(rawSessions.projectId, "demo-project");
  assert.equal(rawSessions.entries[0].projectId, "demo-project");
  assert.equal(event.projectId, "demo-project");
});

test("research_workflow plan-mutating actions auto-activate the pending owner handoff before writing state", async (t) => {
  const scenarios = [
    {
      name: "materialize_plan_state",
      params: {
        action: "materialize_plan_state",
        planMaterialization: {},
      },
    },
    {
      name: "set_research_program",
      params: {
        action: "set_research_program",
        researchProgram: {
          status: "approved",
          goal: "Route the plan through the formal handoff activation path.",
        },
      },
    },
    {
      name: "set_orchestration_state",
      params: {
        action: "set_orchestration_state",
        orchestrationState: {
          status: "running",
          current_owner: "orchestrator",
          next_transition_candidate: "code",
        },
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async (t) => {
      const projectRoot = await makeProjectRoot();
      t.after(async () => {
        await fs.rm(projectRoot, { recursive: true, force: true });
      });

      const intentId = await seedProjectWithPendingPlanHandoff(projectRoot);
      const tool = createResearchWorkflowTool({
        workspaceDir: projectRoot,
        agentId: "orchestrator",
        sessionKey: "agent:orchestrator:discord:channel:paper-lab",
        messageChannel: "discord",
      });

      await executeWorkflowTool(tool, scenario.params);

      const manifest = JSON.parse(
        await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
      );
      assert.equal(manifest.current_stage, "plan");
      assert.equal(manifest.owner_agent, "orchestrator");
      assert.equal(manifest.orchestration_state.current_owner, "orchestrator");
      assert.equal(manifest.orchestration_state.pending_handoff_id, null);
      assert.equal(manifest.orchestration_state.pending_owner_candidate, null);
      assert.equal(manifest.orchestration_state.pending_stage_candidate, null);
      assert.equal(manifest.orchestration_state.handoff_phase, "activated");

      const queue = await readWorkflowRuntimeQueueStore(projectRoot);
      const queueEntry = queue.entries.find((entry) => entry.queueKey === `handoff:${intentId}`);
      assert.ok(queueEntry);
      assert.equal(queueEntry.status, "completed");
      assert.equal(queueEntry.lastError, null);
    });
  }
});

async function writeFakeResearch30Script(targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(
    targetPath,
    `#!/usr/bin/env python3
import json
import os
from types import SimpleNamespace

RESPONSES = {}
payload_path = os.environ.get("OPENCLAW_RESEARCH30_FAKE_RESPONSES")
if payload_path:
    with open(payload_path, "r", encoding="utf-8") as handle:
        RESPONSES = json.load(handle)

class OpenAlexItem(dict):
    pass

class Report:
    def __init__(self, topic, from_date, to_date, mode):
        self.topic = topic
        self.range_from = from_date
        self.range_to = to_date
        self.generated_at = "2026-04-12T00:00:00Z"
        self.mode = mode
        self.openalex = []
        self.semanticscholar = []
        self.pubmed = []
        self.biorxiv = []
        self.medrxiv = []
        self.arxiv = []
        self.huggingface = []
        self.openalex_error = None
        self.semanticscholar_error = None
        self.pubmed_error = None
        self.biorxiv_error = None
        self.medrxiv_error = None
        self.arxiv_error = None
        self.huggingface_error = None

    def to_dict(self):
        return {
            "topic": self.topic,
            "range": {"from": self.range_from, "to": self.range_to},
            "generated_at": self.generated_at,
            "mode": self.mode,
            "openalex": [dict(item) for item in self.openalex],
            "semanticscholar": [dict(item) for item in self.semanticscholar],
            "pubmed": [dict(item) for item in self.pubmed],
            "biorxiv": [dict(item) for item in self.biorxiv],
            "medrxiv": [dict(item) for item in self.medrxiv],
            "arxiv": [dict(item) for item in self.arxiv],
            "huggingface": [dict(item) for item in self.huggingface],
        }

def create_report(topic, from_date, to_date, mode):
    return Report(topic, from_date, to_date, mode)

class Normalize:
    @staticmethod
    def normalize_openalex_items(items, *_args):
        return [OpenAlexItem(item) for item in items]
    @staticmethod
    def normalize_semanticscholar_items(items, *_args):
        return []
    @staticmethod
    def normalize_biorxiv_items(items, *_args):
        return []
    @staticmethod
    def normalize_arxiv_items(items, *_args):
        return []
    @staticmethod
    def normalize_pubmed_items(items, *_args):
        return []
    @staticmethod
    def normalize_huggingface_items(items, *_args):
        return []
    @staticmethod
    def filter_by_date_range(items, *_args):
        return items

class Score:
    @staticmethod
    def score_openalex_items(items):
        return items
    @staticmethod
    def score_semanticscholar_items(items):
        return items
    @staticmethod
    def score_biorxiv_items(items):
        return items
    @staticmethod
    def score_arxiv_items(items):
        return items
    @staticmethod
    def score_pubmed_items(items):
        return items
    @staticmethod
    def score_huggingface_items(items):
        return items
    @staticmethod
    def sort_items(items):
        return sorted(items, key=lambda item: -int(item.get("score", 0)))

class Dedupe:
    @staticmethod
    def dedupe_within_source(items):
        return items
    @staticmethod
    def dedupe_cross_source(items):
        return items

dates = SimpleNamespace(get_date_range=lambda days: ("2016-01-01", "2026-04-12"))
env = SimpleNamespace(get_config=lambda: {})
normalize = Normalize()
score = Score()
dedupe = Dedupe()
schema = SimpleNamespace(create_report=create_report)

def determine_sources(requested):
    return {requested}

def run_research(topic, sources_set, config, from_date, to_date, depth="default", mock=False, progress=None):
    return {
        "openalex": (RESPONSES.get(topic, []), None),
        "semanticscholar": ([], None),
        "pubmed": ([], None),
        "biorxiv": ([], None),
        "medrxiv": ([], None),
        "arxiv": ([], None),
        "huggingface": ([], None),
    }
`,
    "utf8"
  );
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
  const manifestPath = path.join(projectRoot, "researcher", "paper-staging", "batch-import.json");
  const stagedMarkdownPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "demo-paper.md"
  );

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeText(
    stagedMarkdownPath,
    "# Demo Paper\n\nThis is a sufficiently long markdown fixture for staged import validation. ".repeat(30)
  );
  await writeJson(manifestPath, {
    version: 1,
    papers: [
      {
        paperId: "demo-paper",
        source: stagedMarkdownPath,
        sourceKind: "markdown",
      },
    ],
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
        manifestPath,
        "submit",
      ],
      summary: "Queue shared-corpus batch import for graph-build.",
      manifest_path: manifestPath,
      shared_corpus: "GCD",
      paper_count: 1,
    },
  });

  assert.equal(result.request.status, "queued");
  assert.equal(result.request.wrapper, "pn_batch_import.py");
  assert.equal(result.request.sharedCorpus, "GCD");
  assert.equal(result.request.paperCount, 1);
  assert.match(result.request.commandText ?? "", /python3 skills\/researcher\/papernexus\/scripts\/pn_batch_import\.py/);
  assert.equal(result.state.queuedRequests.length, 1);

  const snapshot = await executeWorkflowTool(tool, {
    action: "get_snapshot",
  });
  assert.equal(snapshot.paperIngestionQueuedRequestCount, 1);
  assert.equal(snapshot.paperIngestionRunningRequestCount, 0);
});

test("research_workflow schedule_papernexus_import accepts installed skill-path wrapper commands", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const manifestPath = path.join(projectRoot, "researcher", "paper-staging", "skill-path-batch.json");
  const stagedMarkdownPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "skill-path-paper.md"
  );

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeText(
    stagedMarkdownPath,
    "# Skill Path Paper\n\nThis markdown fixture is long enough to pass staged import validation. ".repeat(30)
  );
  await writeJson(manifestPath, {
    version: 1,
    papers: [
      {
        paperId: "skill-path-paper",
        source: stagedMarkdownPath,
        sourceKind: "markdown",
      },
    ],
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  const result = await executeWorkflowTool(tool, {
    action: "schedule_papernexus_import",
    paperIngestionRequest: {
      command_text: `python3 skills/papernexus/scripts/pn_batch_import.py --manifest ${manifestPath} submit`,
      args: ["--manifest", manifestPath, "submit"],
      summary: "Schedule PaperNexus batch import using the installed skill wrapper path.",
      manifest_path: manifestPath,
      shared_corpus: "GCD",
      paper_count: 1,
    },
  });

  assert.equal(result.request.status, "queued");
  assert.equal(result.request.wrapper, "pn_batch_import.py");
  assert.deepEqual(result.request.args, ["--manifest", manifestPath, "submit"]);
  assert.match(result.commandText ?? "", /python3 skills\/researcher\/papernexus\/scripts\/pn_batch_import\.py/);
  assert.equal(result.state.queuedRequests.length, 1);
});

test("research_workflow queue_paper_ingestion maps legacy manifest payloads to pn_batch_import.py", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const manifestPath = path.join(projectRoot, "researcher", "paper-staging", "legacy-batch.json");
  const stagedMarkdownPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "legacy-paper.md"
  );

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeText(
    stagedMarkdownPath,
    "# Legacy Paper\n\nThis is a sufficiently long markdown fixture for legacy manifest import validation. ".repeat(30)
  );
  await writeJson(manifestPath, {
    version: 1,
    papers: [
      {
        paperId: "legacy-paper",
        source: stagedMarkdownPath,
        sourceKind: "markdown",
      },
    ],
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    pluginConfig: {
      papernexusApiBaseUrl: "https://papernexus.example/api",
      papernexusSharedCorpus: "GCD",
    },
  });

  const result = await executeWorkflowTool(tool, {
    action: "queue_paper_ingestion",
    paperIngestionRequest: {
      mode: "batch_import",
      request_id: "legacy-manifest-1",
      manifest_path: manifestPath,
      shared_corpus: "GCD",
      paper_count: 1,
      summary: "Queue legacy manifest-only PaperNexus import.",
    },
  });

  assert.equal(result.request.status, "queued");
  assert.equal(result.request.wrapper, "pn_batch_import.py");
  assert.deepEqual(result.request.args, [
    "--api-base",
    "https://papernexus.example/api",
    "--corpus",
    "GCD",
    "--manifest",
    manifestPath,
    "submit",
  ]);
  assert.match(result.commandText ?? "", /python3 skills\/researcher\/papernexus\/scripts\/pn_batch_import\.py/);
  assert.match(result.commandText ?? "", /--manifest/);
  assert.notEqual(result.request.validationStatus, "invalid");
});

test("research_workflow queue_paper_ingestion accepts PaperNexus queue_type manifest aliases", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const manifestPath = path.join(projectRoot, "researcher", "paper-staging", "queue-type-batch.json");
  const stagedMarkdownPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "queue-type-paper.md"
  );

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeText(
    stagedMarkdownPath,
    "# Queue Type Paper\n\nThis is a sufficiently long markdown fixture for queue type manifest validation. ".repeat(30)
  );
  await writeJson(manifestPath, {
    version: 1,
    papers: [
      {
        paperId: "queue-type-paper",
        source: stagedMarkdownPath,
        sourceKind: "markdown",
      },
    ],
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    pluginConfig: {
      papernexusMcpUrl: "http://127.0.0.1:8765/mcp",
      papernexusSharedCorpus: "GCD",
    },
  });

  const result = await executeWorkflowTool(tool, {
    action: "queue_paper_ingestion",
    paperIngestionRequest: {
      queue_type: "batch_import",
      request_id: "queue-type-manifest-1",
      batch_manifest_path: manifestPath,
      shared_corpus: "GCD",
      paper_count: 1,
      summary: "Queue PaperNexus import using latest skill queue_type fields.",
    },
  });

  assert.equal(result.request.status, "queued");
  assert.equal(result.request.wrapper, "pn_batch_import.py");
  assert.deepEqual(result.request.args, [
    "--mcp-url",
    "http://127.0.0.1:8765/mcp",
    "--corpus",
    "GCD",
    "--manifest",
    manifestPath,
    "submit",
  ]);
  assert.equal(result.request.manifestPath, manifestPath);
  assert.match(result.commandText ?? "", /python3 skills\/researcher\/papernexus\/scripts\/pn_batch_import\.py/);
});

test("research_workflow queue_paper_ingestion omits corpus for remote PaperNexus autodiscovery", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const manifestPath = path.join(projectRoot, "researcher", "paper-staging", "autodiscovery-batch.json");
  const stagedMarkdownPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "autodiscovery-paper.md"
  );

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeText(
    stagedMarkdownPath,
    "# Autodiscovery Paper\n\nThis is a sufficiently long markdown fixture for remote import validation. ".repeat(30)
  );
  await writeJson(manifestPath, {
    version: 1,
    papers: [
      {
        paperId: "autodiscovery-paper",
        source: stagedMarkdownPath,
        sourceKind: "markdown",
      },
    ],
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    pluginConfig: {
      papernexusMcpUrl: "http://127.0.0.1:8765/mcp",
    },
  });

  const result = await executeWorkflowTool(tool, {
    action: "queue_paper_ingestion",
    paperIngestionRequest: {
      queue_type: "batch_import",
      request_id: "remote-autodiscovery-manifest-1",
      batch_manifest_path: manifestPath,
      paper_count: 1,
      summary: "Queue PaperNexus import using remote corpus autodiscovery.",
    },
  });

  assert.equal(result.request.status, "queued");
  assert.equal(result.request.wrapper, "pn_batch_import.py");
  assert.deepEqual(result.request.args, [
    "--mcp-url",
    "http://127.0.0.1:8765/mcp",
    "--manifest",
    manifestPath,
    "submit",
  ]);
  assert.equal(result.request.sharedCorpus, null);
  assert.doesNotMatch(result.commandText ?? "", /--corpus/);
});

test("research_workflow queue_paper_ingestion initializes PAPERNEXUS_PROGRESS.json with staging progress", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const manifestPath = path.join(projectRoot, "researcher", "paper-staging", "batch-import.json");
  const stagedMarkdownPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "demo-paper.md"
  );

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeText(
    stagedMarkdownPath,
    "# Demo Paper\n\nThis is a sufficiently long markdown fixture for staged import validation. ".repeat(30)
  );
  await writeJson(manifestPath, {
    version: 1,
    papers: [
      {
        paperId: "demo-paper",
        source: stagedMarkdownPath,
        sourceKind: "markdown",
      },
    ],
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
        manifestPath,
        "submit",
      ],
      summary: "Queue shared-corpus batch import for graph-build.",
      manifest_path: manifestPath,
      shared_corpus: "GCD",
      paper_count: 1,
    },
  });

  const progress = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "graph", "PAPERNEXUS_PROGRESS.json"),
      "utf8"
    )
  );
  assert.equal(progress.phase, "staging");
  assert.equal(progress.batch.total_items, 1);
  assert.equal(progress.batch.pending_items, 1);
  assert.equal(progress.progress.completed_ratio, 0);
  assert.equal(progress.progress.percent, 0);
});

test("research_workflow queue_paper_ingestion materializes typed staged-paper requests into pn_batch_import.py", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const stagedDir = path.join(projectRoot, "researcher", "paper-staging", "md");
  const firstPaperPath = path.join(stagedDir, "2201.02609.md");
  const secondPaperPath = path.join(stagedDir, "2410.11206.md");

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeText(
    firstPaperPath,
    "# Generalized Category Discovery\n\nThis is a sufficiently long markdown fixture for staged import validation. ".repeat(30)
  );
  await writeText(
    secondPaperPath,
    "# Theoretical Analysis of FixMatch-like Semi-Supervised Learning\n\nThis is a sufficiently long markdown fixture for staged import validation. ".repeat(30)
  );
  await seedPaperSourceIndex(projectRoot, [
    {
      arxiv_id: "2201.02609",
      title: "Generalized Category Discovery",
      role: "baseline",
      local_md: "researcher/paper-staging/md/2201.02609.md",
    },
    {
      arxiv_id: "2410.11206",
      title: "Theoretical Analysis of FixMatch-like Semi-Supervised Learning",
      role: "inspiration",
      staging_path: "researcher/paper-staging/md/2410.11206.md",
    },
  ]);

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    channelKey: "discord:channel:paper-lab",
    pluginConfig: {
      papernexusSshTarget: "hyq@10.126.56.30",
      papernexusRemoteStagingRoot: "/tmp/papernexus-import-staging",
    },
  });

  const result = await executeWorkflowTool(tool, {
    action: "queue_paper_ingestion",
    paperIngestionRequest: {
      papers: [
        {
          arxiv_id: "2201.02609",
          role: "baseline",
          title: "Generalized Category Discovery",
        },
        {
          arxiv_id: "2410.11206",
          role: "inspiration",
          title: "Theoretical Analysis of FixMatch-like Semi-Supervised Learning",
        },
      ],
      source_index_path: "researcher/PAPER_SOURCE_INDEX.json",
      staging_dir: "researcher/paper-staging/md",
    },
  });

  assert.equal(result.request.status, "queued");
  assert.equal(result.request.wrapper, "pn_batch_import.py");
  assert.equal(result.request.paperCount, 2);
  assert.match(result.commandText ?? "", /python3 skills\/researcher\/papernexus\/scripts\/pn_batch_import\.py/);
  assert.match(result.commandText ?? "", /--manifest/);
  assert.match(result.commandText ?? "", /--ssh-target '?hyq@10\.126\.56\.30'?/);
  assert.match(result.commandText ?? "", /--remote-staging-root '?\/tmp\/papernexus-import-staging'?/);
  assert.deepEqual(result.request.args.slice(-4), [
    "--ssh-target",
    "hyq@10.126.56.30",
    "--remote-staging-root",
    "/tmp/papernexus-import-staging",
  ]);
  assert.ok(result.request.manifestPath);

  const batchManifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, result.request.manifestPath), "utf8")
  );
  assert.equal(batchManifest.defaults.corpus, "shared-global-graph");
  assert.equal(batchManifest.papers.length, 2);
  assert.deepEqual(
    batchManifest.papers.map((entry) => entry.source),
    [
      firstPaperPath,
      secondPaperPath,
    ]
  );
});

test("research_workflow run_broad_paper_search queues staged PDFs for PaperNexus import", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const originalFetch = globalThis.fetch;

  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.startsWith("https://api.openalex.org/works")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "https://openalex.org/W123",
              display_name: "Generalized Category Discovery",
              publication_year: 2022,
              publication_date: "2022-06-01",
              doi: "https://doi.org/10.1109/cvpr52688.2022.00734",
              primary_location: {
                landing_page_url: "https://example.org/gcd",
                pdf_url: "https://example.org/gcd.pdf",
                source: {
                  display_name: "Computer Vision and Pattern Recognition",
                  type: "conference",
                },
              },
              authorships: [{ author: { display_name: "Kai Vaze" } }],
              cited_by_count: 150,
              type_crossref: "proceedings-article",
              relevance_score: 100,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (target === "https://example.org/gcd.pdf") {
      return new Response(Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(2048, "G")]), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    }
    throw new Error(`Unhandled fetch URL in test: ${target}`);
  };

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    channelKey: "local:conversation:e2e",
    messageChannel: "local",
  });

  const result = await executeWorkflowTool(tool, {
    action: "run_broad_paper_search",
    broadPaperSearch: {
      topic: "Generalized Category Discovery",
      providers: ["openalex"],
      maxQueries: 1,
      maxResultsPerQuery: 5,
      maxResolutionAttempts: 1,
      maxIndexEntries: 5,
    },
  });

  assert.equal(result.autoPaperIngestion.queued, true);
  assert.equal(result.autoPaperIngestion.importable_paper_count, 1);
  assert.equal(result.autoPaperIngestion.request.wrapper, "pn_batch_import.py");
  assert.match(result.autoPaperIngestion.commandText, /pn_batch_import\.py/);

  const manifestPath = path.join(
    projectRoot,
    result.autoPaperIngestion.request.manifestPath
  );
  const batchManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(batchManifest.papers.length, 1);
  assert.match(batchManifest.papers[0].source, /paper-staging\/pdf\/doi-10\.1109-cvpr52688\.2022\.00734\.pdf$/);

  const projectManifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(projectManifest.paper_ingestion.queued_requests.length, 1);
  assert.equal(projectManifest.paper_ingestion.queued_requests[0].status, "queued");
});

test("research_workflow run_literature_research_controller executes controller query plan and writes a receipt", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const originalFetch = globalThis.fetch;

  t.after(async () => {
    globalThis.fetch = originalFetch;
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
        project_id: "literature-controller-run",
        current_stage: "review",
        owner_agent: "researcher",
        research_program: {
          topic: "Generalized Category Discovery with FixMatch consistency regularization",
          baseline_reference: "FixMatch",
          primary_metric: "H-score",
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.startsWith("https://api.openalex.org/works")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "https://openalex.org/WGCD",
              display_name: "Generalized Category Discovery with Semi-Supervised Consistency",
              publication_year: 2024,
              publication_date: "2024-02-01",
              doi: "https://doi.org/10.1234/gcd.fixmatch",
              primary_location: {
                landing_page_url: "https://example.org/gcd-fixmatch",
                pdf_url: "https://example.org/gcd-fixmatch.pdf",
                source: {
                  display_name: "International Conference on Learning Representations",
                  type: "conference",
                },
              },
              authorships: [{ author: { display_name: "Example Researcher" } }],
              cited_by_count: 44,
              type_crossref: "proceedings-article",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (target === "https://example.org/gcd-fixmatch.pdf") {
      return new Response(
        Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(2048, "L")]),
        { status: 200, headers: { "content-type": "application/pdf" } }
      );
    }
    throw new Error(`Unhandled fetch URL in test: ${target}`);
  };

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    channelKey: "local:conversation:e2e",
    messageChannel: "local",
  });

  const result = await executeWorkflowTool(tool, {
    action: "run_literature_research_controller",
    literatureController: {
      providers: ["openalex"],
      maxQueries: 1,
      maxResultsPerQuery: 5,
      maxResolutionAttempts: 1,
      maxIndexEntries: 5,
    },
  });

  assert.equal(result.receipt.executed, true);
  assert.equal(result.receipt.search_execution.query_count, 1);
  assert.equal(result.receipt.search_execution.provider_names[0], "openalex");
  assert.equal(result.autoPaperIngestion.queued, true);
  assert.equal(result.receipt.papernexus_import.queued, true);
  assert.equal(result.receipt.provider_result_index.merged_candidate_count, 1);
  assert.equal(
    result.receipt.provider_result_index.selected_for_import_count,
    1
  );
  assert.equal(result.receipt.papernexus_import_batch_manifest.status, "queued");
  assert.equal(
    result.receipt.papernexus_refresh_report.status,
    "queued_graph_build"
  );
  assert.equal(result.receipt.citation_expansion_report.status, "planned");
  assert.equal(result.receipt.next_route, "graph_build");
  assert.match(
    result.receipt.artifact_paths.run_receipt_path,
    /literature_controller_run_receipt\.json$/
  );
  assert.match(
    result.receipt.artifact_paths.provider_result_index_path,
    /provider_result_index\.json$/
  );

  const receipt = JSON.parse(
    await fs.readFile(
      path.join(
        projectRoot,
        "researcher",
        "literature-research-controller",
        "literature_controller_run_receipt.json"
      ),
      "utf8"
    )
  );
  assert.equal(receipt.executed, true);

  const controllerDir = path.join(
    projectRoot,
    "researcher",
    "literature-research-controller"
  );
  const providerIndex = JSON.parse(
    await fs.readFile(path.join(controllerDir, "provider_result_index.json"), "utf8")
  );
  assert.equal(providerIndex.provider_status_counts.ok, 1);
  assert.equal(providerIndex.merged_candidate_count, 1);
  assert.equal(providerIndex.candidates[0].execution_decision, "selected_for_import");

  const importManifest = JSON.parse(
    await fs.readFile(
      path.join(controllerDir, "papernexus_import_batch_manifest.json"),
      "utf8"
    )
  );
  assert.equal(importManifest.status, "queued");
  assert.equal(importManifest.importable_paper_count, 1);
  assert.equal(importManifest.wrapper, "pn_batch_import.py");

  const refreshReport = JSON.parse(
    await fs.readFile(
      path.join(controllerDir, "papernexus_refresh_report.json"),
      "utf8"
    )
  );
  assert.equal(refreshReport.status, "queued_graph_build");
  assert.equal(refreshReport.graph_build_expected, true);

  const citationExpansionReport = JSON.parse(
    await fs.readFile(
      path.join(controllerDir, "citation_expansion_report.json"),
      "utf8"
    )
  );
  assert.equal(citationExpansionReport.status, "planned");
  assert.equal(citationExpansionReport.bounded, true);

  const trace = await fs.readFile(
    path.join(controllerDir, "literature_controller_trace.jsonl"),
    "utf8"
  );
  assert.equal(trace.trim().split(/\r?\n/).length, 1);

  const repairLog = await fs.readFile(
    path.join(controllerDir, "literature_repair_log.jsonl"),
    "utf8"
  );
  assert.match(repairLog, /"papernexus_refresh_status":"queued_graph_build"/);
});

test("research_workflow queue_paper_ingestion discovers paper-staging source index by default", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const stagedDir = path.join(projectRoot, "researcher", "paper-staging", "md");
  const stagedPaperPath = path.join(stagedDir, "2410.11206.md");

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeText(
    stagedPaperPath,
    "# Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning\n\nThis staged markdown fixture is long enough for import validation. ".repeat(30)
  );
  await writeJson(path.join(projectRoot, "researcher", "paper-staging", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        arxiv_id: "2410.11206",
        title: "Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning",
        role: "inspiration",
        local_md_path: "md/2410.11206.md",
      },
    ],
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    channelKey: "local:conversation:e2e",
    messageChannel: "local",
  });

  const result = await executeWorkflowTool(tool, {
    action: "queue_paper_ingestion",
    paperIngestionRequest: {
      papers: [
        {
          arxiv_id: "2410.11206",
          role: "inspiration",
          title: "Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning",
        },
      ],
      staging_dir: "researcher/paper-staging/md",
    },
  });

  assert.equal(result.request.status, "queued");
  assert.equal(result.request.wrapper, "pn_batch_import.py");

  const batchManifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, result.request.manifestPath), "utf8")
  );
  assert.equal(
    batchManifest.queue_paper_ingestion.source_index_path,
    "researcher/paper-staging/PAPER_SOURCE_INDEX.json"
  );
  assert.deepEqual(batchManifest.papers.map((entry) => entry.source), [stagedPaperPath]);
});

test("research_workflow queue_paper_ingestion resolves researcher source-index md_path through paper-staging", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const stagedDir = path.join(projectRoot, "researcher", "paper-staging", "md");
  const stagedPaperPath = path.join(stagedDir, "2201.02609.md");

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeText(
    stagedPaperPath,
    "# Generalized Category Discovery\n\nThis staged markdown fixture is long enough for import validation. ".repeat(40)
  );
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        arxiv_id: "2201.02609",
        title: "Generalized Category Discovery",
        role: "baseline",
        md_path: "md/2201.02609.md",
      },
    ],
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    channelKey: "local:conversation:e2e",
    messageChannel: "local",
  });

  const result = await executeWorkflowTool(tool, {
    action: "queue_paper_ingestion",
    paperIngestionRequest: {
      source_index_path: "researcher/PAPER_SOURCE_INDEX.json",
      papers: [
        {
          arxiv_id: "2201.02609",
          title: "Generalized Category Discovery",
        },
      ],
      staging_dir: "researcher/paper-staging/md",
    },
  });

  assert.equal(result.request.status, "queued");
  const batchManifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, result.request.manifestPath), "utf8")
  );
  assert.deepEqual(batchManifest.papers.map((entry) => entry.source), [stagedPaperPath]);
});

test("research_workflow queue_paper_ingestion code-validates staged markdown and blocks invalid stubs", async (t) => {
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

  const manifestPath = path.join(projectRoot, "researcher", "paper-staging", "batch-import.json");
  const stagedMarkdownPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "bad-paper.md"
  );
  await writeText(
    stagedMarkdownPath,
    "<!doctype html><html><body>Access denied. Sign in to continue.</body></html>"
  );
  await writeJson(manifestPath, {
    version: 1,
    papers: [
      {
        paperId: "bad-paper",
        source: stagedMarkdownPath,
        sourceKind: "markdown",
      },
    ],
  });

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  const result = await executeWorkflowTool(tool, {
    action: "queue_paper_ingestion",
    paperIngestionRequest: {
      wrapper: "pn_batch_import.py",
      summary: "Queue invalid staged markdown to verify code-level validation.",
      manifest_path: manifestPath,
      shared_corpus: "GCD",
      paper_count: 1,
    },
  });

  assert.equal(result.request.status, "needs_repair");
  assert.equal(result.request.validationStatus, "invalid");
  assert.match(result.request.validationSummary ?? "", /1 invalid/i);
  assert.equal(result.request.attemptCount, 0);
  assert.equal(result.request.maxAttempts, 3);
  assert.ok(result.request.validationReportPath);

  const report = JSON.parse(
    await fs.readFile(result.request.validationReportPath, "utf8")
  );
  assert.equal(report.status, "invalid");
  assert.match(report.entries[0].issues[0].message ?? "", /HTML|stub|paper/i);
});

test("research_workflow stage_papernexus_remote_sources uploads staged papers and writes a remote manifest", async (t) => {
  const projectRoot = await makeProjectRoot();
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-stage-ssh-"));
  const remoteRoot = path.join(projectRoot, "fake-remote");
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const previousPath = process.env.PATH;
  const previousSshTarget = process.env.OPENCLAW_PAPERNEXUS_STAGE_SSH_TARGET;
  const previousStageBaseDir = process.env.OPENCLAW_PAPERNEXUS_STAGE_BASE_DIR;
  const previousFakeRemoteRoot = process.env.OPENCLAW_FAKE_REMOTE_ROOT;

  t.after(async () => {
    if (previousProjectRoot === undefined) delete process.env.OPENCLAW_PROJECT;
    else process.env.OPENCLAW_PROJECT = previousProjectRoot;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousSshTarget === undefined) delete process.env.OPENCLAW_PAPERNEXUS_STAGE_SSH_TARGET;
    else process.env.OPENCLAW_PAPERNEXUS_STAGE_SSH_TARGET = previousSshTarget;
    if (previousStageBaseDir === undefined) delete process.env.OPENCLAW_PAPERNEXUS_STAGE_BASE_DIR;
    else process.env.OPENCLAW_PAPERNEXUS_STAGE_BASE_DIR = previousStageBaseDir;
    if (previousFakeRemoteRoot === undefined) delete process.env.OPENCLAW_FAKE_REMOTE_ROOT;
    else process.env.OPENCLAW_FAKE_REMOTE_ROOT = previousFakeRemoteRoot;
    await fs.rm(binDir, { recursive: true, force: true });
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const sourcePath = path.join(projectRoot, "researcher", "paper-staging", "2603.12226.pdf");
  const manifestPath = path.join(projectRoot, "researcher", "paper-staging", "batch-import.json");
  await writeText(sourcePath, "%PDF-1.4\nfake lane c\n");
  await writeJson(manifestPath, {
    papers: [
      {
        paper_id: "arxiv:2603.12226",
        source_path: sourcePath,
      },
    ],
  });
  await writeExecutable(
    path.join(binDir, "ssh"),
    `#!/bin/sh
target="$1"
shift
cmd="$1"
root="$OPENCLAW_FAKE_REMOTE_ROOT"
clean="$(printf "%s" "$cmd" | tr -d "'\\"")"
case "$clean" in
  mkdir\\ -p\\ *)
    dir="\${clean#mkdir -p }"
    mkdir -p "$root$dir"
    exit 0
    ;;
  cat\\ \\>\\ *)
    file="\${clean#cat > }"
    mkdir -p "$(dirname "$root$file")"
    cat > "$root$file"
    exit 0
    ;;
esac
echo "unsupported ssh command: $cmd" >&2
exit 1
`
  );

  process.env.PATH = `${binDir}:${previousPath ?? ""}`;
  process.env.OPENCLAW_PROJECT = projectRoot;
  process.env.OPENCLAW_FAKE_REMOTE_ROOT = remoteRoot;
  process.env.OPENCLAW_PAPERNEXUS_STAGE_SSH_TARGET = "fake@remote";
  process.env.OPENCLAW_PAPERNEXUS_STAGE_BASE_DIR = "/srv/papernexus-stage";

  const result = await executeWorkflowTool(tool, {
    action: "stage_papernexus_remote_sources",
    papernexusRemoteStage: {
      manifest_path: "researcher/paper-staging/batch-import.json",
    },
  });

  assert.equal(result.available, true);
  assert.match(result.reportPath, /REMOTE_PAPERNEXUS_STAGE\.json$/);
  assert.equal(result.report.uploads[0].status, "uploaded");
  const rewrittenManifestPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "batch-import.remote.json"
  );
  const rewrittenManifest = JSON.parse(await fs.readFile(rewrittenManifestPath, "utf8"));
  assert.equal(
    rewrittenManifest.papers[0].server_file_path,
    "/srv/papernexus-stage/demo-project/pdf/2603.12226.pdf"
  );
});

test("research_workflow audit_literature_coverage writes a non-blocking coverage diagnostic", async (t) => {
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

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    research_program: {
      baseline_reference: "Baseline Router",
    },
  });
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "arxiv:2501.00031",
      arxiv_id: "2501.00031",
      title: "Baseline Router for Graph Alignment",
      year: 2026,
      venue: "ICLR",
      source_provider: "papers-cool",
      retrieval_providers: ["papers-cool"],
      source_path: path.join(projectRoot, "researcher", "paper-staging", "2501.00031.md"),
      citation_count: 42,
    },
    {
      canonical_id: "arxiv:2501.00032",
      arxiv_id: "2501.00032",
      title: "Follow-up Graph Alignment System",
      year: 2025,
      venue: "NeurIPS",
      source_provider: "pasa-paper-search",
      retrieval_providers: ["papers-cool", "pasa-paper-search"],
      source_path: path.join(projectRoot, "researcher", "paper-staging", "2501.00032.md"),
      citation_count: 15,
    },
  ]);

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  const result = await executeWorkflowTool(tool, {
    action: "audit_literature_coverage",
  });

  assert.equal(result.audit.projectId, "demo-project");
  assert.ok(["thin", "adequate", "strong"].includes(result.audit.verdict));
  assert.equal(result.audit.baselineMatches[0].canonicalIds[0], "arxiv:2501.00031");
  assert.ok(result.audit.auditPath);
  assert.ok(result.audit.markdownPath);
});

test("research_workflow plan_citation_expansion writes a bounded seed packet", async (t) => {
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

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
  });
  await seedPaperSourceIndex(projectRoot, [
    {
      canonical_id: "arxiv:2501.00041",
      arxiv_id: "2501.00041",
      title: "High Impact Baseline",
      year: 2024,
      citation_count: 120,
    },
    {
      canonical_id: "arxiv:2501.00042",
      arxiv_id: "2501.00042",
      title: "Recent Follow-up Method",
      year: 2026,
      citation_count: 30,
    },
  ]);

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  const result = await executeWorkflowTool(tool, {
    action: "plan_citation_expansion",
    citationExpansion: {
      max_seeds: 2,
    },
  });

  assert.equal(result.packet.bounded, true);
  assert.equal(result.packet.maxSeeds, 2);
  assert.equal(result.packet.seeds.length, 2);
  assert.equal(result.packet.queries.some((entry) => entry.type === "forward_citations"), true);
  assert.ok(result.packet.packetPath);
  assert.ok(result.packet.markdownPath);
});

test("research_workflow plan_citation_expansion defaults to a broader bounded seed set", async (t) => {
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

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
  });
  await seedPaperSourceIndex(
    projectRoot,
    Array.from({ length: 9 }, (_unused, index) => ({
      canonical_id: `arxiv:2501.100${index}`,
      arxiv_id: `2501.100${index}`,
      title: `Expansion Seed ${index}`,
      year: 2025,
      citation_count: 100 - index,
    }))
  );

  process.env.OPENCLAW_PROJECT = projectRoot;
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });

  const result = await executeWorkflowTool(tool, {
    action: "plan_citation_expansion",
  });

  assert.equal(result.packet.bounded, true);
  assert.equal(result.packet.maxSeeds, 6);
  assert.equal(result.packet.seeds.length, 6);
  assert.equal(result.packet.queries.length >= 25, true);
});

test("research_workflow refresh_gpu_monitor persists idle-vs-busy GPU state for tracked runs", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-fake-ssh-"));

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
    await fs.rm(binDir, { recursive: true, force: true });
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeExecutable(
    path.join(binDir, "ssh"),
    [
      "#!/bin/sh",
      "printf '0, NVIDIA RTX 4090, 200, 24576, 0\\n'",
      "printf '1, NVIDIA RTX 4090, 18000, 24576, 72\\n'",
      "printf '\\n---SCREENS---\\n'",
      "printf 'There is a screen on:\\n'",
      "printf '\\t5678.other-run\\t(Detached)\\n'",
      "printf '1 Socket in /run/screen.\\n'",
      "",
    ].join("\n")
  );
  process.env.OPENCLAW_PROJECT = projectRoot;
  process.env.PATH = `${binDir}:${previousPath ?? ""}`;
  await writeJson(path.join(projectRoot, "coder", "demo-exp", "REMOTE_RUN.json"), {
    experiment_id: "exp-1",
    experiment_name: "baseline",
    track_id: "track-main",
    server: "gpu-server",
    gpu_id: "0",
    screen_name: "baseline-run",
    status: "running",
  });

  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  const refreshed = await executeWorkflowTool(tool, {
    action: "refresh_gpu_monitor",
  });

  assert.equal(refreshed.state.status, "fresh");
  assert.equal(refreshed.state.serverCount, 1);
  assert.equal(refreshed.state.activeTrackedRunCount, 1);
  assert.equal(refreshed.state.likelyFinishedRunCount, 1);
  assert.equal(refreshed.state.recommendation, "reconcile_finished");
  assert.equal(refreshed.state.servers[0].assignments[0].conclusion, "likely_finished");
  assert.equal(refreshed.state.servers[0].assignments[0].gpuId, "0");

  const summary = await executeWorkflowTool(tool, {
    action: "get_gpu_monitor",
  });

  assert.equal(summary.state.status, "fresh");
  assert.equal(summary.state.monitorPath, "researcher/EXPERIMENT_GPU_MONITOR.json");
  assert.equal(summary.state.idleAssignedGpuCount, 1);

  const snapshot = await executeWorkflowTool(tool, {
    action: "get_snapshot",
  });

  assert.equal(snapshot.experimentGpuMonitorStatus, "fresh");
  assert.equal(snapshot.experimentGpuMonitorServerCount, 1);
  assert.equal(snapshot.experimentGpuMonitorLikelyFinishedRunCount, 1);
  assert.equal(
    snapshot.experimentGpuMonitorRecommendation,
    "reconcile_finished"
  );
});

test("research_workflow refresh_gpu_monitor trusts terminal watcher artifacts before screen heuristics", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-fake-ssh-"));

  t.after(async () => {
    if (previousProjectRoot === undefined) delete process.env.OPENCLAW_PROJECT;
    else process.env.OPENCLAW_PROJECT = previousProjectRoot;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await fs.rm(binDir, { recursive: true, force: true });
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeExecutable(
    path.join(binDir, "ssh"),
    [
      "#!/bin/sh",
      "printf '0, NVIDIA RTX 4090, 15000, 24576, 80\\n'",
      "printf '\\n---SCREENS---\\n'",
      "printf 'There is a screen on:\\n'",
      "printf '\\t9876.ghost-run\\t(Detached)\\n'",
      "printf '1 Socket in /run/screen.\\n'",
      "",
    ].join("\n")
  );
  process.env.OPENCLAW_PROJECT = projectRoot;
  process.env.PATH = `${binDir}:${previousPath ?? ""}`;
  const runDir = path.join(projectRoot, "coder", "demo-exp");
  await writeJson(path.join(runDir, "REMOTE_RUN.json"), {
    experiment_id: "exp-2",
    experiment_name: "candidate",
    track_id: "track-main",
    server: "gpu-server",
    gpu_id: "0",
    screen_name: "ghost-run",
    status: "running",
  });
  await writeJson(path.join(runDir, "RUN_TERMINAL.json"), {
    status: "completed",
    terminal_at: "2026-04-12T12:00:00.000Z",
  });

  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  const refreshed = await executeWorkflowTool(tool, {
    action: "refresh_gpu_monitor",
  });

  assert.equal(refreshed.state.recommendation, "reconcile_finished");
  assert.equal(refreshed.state.servers[0].assignments[0].conclusion, "likely_finished");
  assert.equal(
    refreshed.state.servers[0].assignments[0].watcherSignal,
    "terminal_artifact"
  );
});

test("research_workflow refresh_gpu_monitor treats stable result summaries as terminal before screen heuristics", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-fake-ssh-"));

  t.after(async () => {
    if (previousProjectRoot === undefined) delete process.env.OPENCLAW_PROJECT;
    else process.env.OPENCLAW_PROJECT = previousProjectRoot;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await fs.rm(binDir, { recursive: true, force: true });
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeExecutable(
    path.join(binDir, "ssh"),
    [
      "#!/bin/sh",
      "printf '0, NVIDIA RTX 4090, 15000, 24576, 80\\n'",
      "printf '\\n---SCREENS---\\n'",
      "printf 'There is a screen on:\\n'",
      "printf '\\t2222.stale-run\\t(Detached)\\n'",
      "printf '1 Socket in /run/screen.\\n'",
      "",
    ].join("\n")
  );
  process.env.OPENCLAW_PROJECT = projectRoot;
  process.env.PATH = `${binDir}:${previousPath ?? ""}`;
  const runDir = path.join(projectRoot, "coder", "demo-exp");
  await writeJson(path.join(runDir, "REMOTE_RUN.json"), {
    experiment_id: "exp-3",
    experiment_name: "candidate",
    track_id: "track-main",
    server: "gpu-server",
    gpu_id: "0",
    screen_name: "stale-run",
    status: "running",
  });
  const resultSummaryPath = path.join(runDir, "RESULT_SUMMARY.json");
  await writeJson(resultSummaryPath, {
    status: "completed",
    metrics: { h_score: 0.58 },
  });
  const staleAt = new Date(Date.now() - 5 * 60 * 1000);
  await fs.utimes(resultSummaryPath, staleAt, staleAt);

  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  const refreshed = await executeWorkflowTool(tool, {
    action: "refresh_gpu_monitor",
  });

  assert.equal(refreshed.state.recommendation, "reconcile_finished");
  assert.equal(refreshed.state.servers[0].assignments[0].conclusion, "likely_finished");
  assert.equal(
    refreshed.state.servers[0].assignments[0].watcherSignal,
    "result_summary"
  );
});

test("research_workflow refresh_gpu_monitor escalates stale heartbeats to timeout-style completion", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-fake-ssh-"));

  t.after(async () => {
    if (previousProjectRoot === undefined) delete process.env.OPENCLAW_PROJECT;
    else process.env.OPENCLAW_PROJECT = previousProjectRoot;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await fs.rm(binDir, { recursive: true, force: true });
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeExecutable(
    path.join(binDir, "ssh"),
    [
      "#!/bin/sh",
      "printf '\\n---SCREENS---\\n'",
      "printf 'No Sockets found in /run/screen.\\n'",
      "",
    ].join("\n")
  );
  process.env.OPENCLAW_PROJECT = projectRoot;
  process.env.PATH = `${binDir}:${previousPath ?? ""}`;
  const runDir = path.join(projectRoot, "coder", "demo-exp");
  await writeJson(path.join(runDir, "REMOTE_RUN.json"), {
    experiment_id: "exp-4",
    experiment_name: "candidate",
    track_id: "track-main",
    server: "gpu-server",
    gpu_id: "0",
    screen_name: "timed-run",
    status: "running",
  });
  const heartbeatPath = path.join(runDir, "RUN_HEARTBEAT.json");
  await writeJson(heartbeatPath, {
    status: "running",
    heartbeat_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  });

  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  const refreshed = await executeWorkflowTool(tool, {
    action: "refresh_gpu_monitor",
  });

  assert.equal(refreshed.state.recommendation, "reconcile_finished");
  assert.equal(refreshed.state.servers[0].assignments[0].conclusion, "likely_finished");
  assert.equal(refreshed.state.servers[0].assignments[0].watcherSignal, "timeout");
});

test("research_workflow record_experiment_runtime_signal writes watcher artifacts that monitor and decision logic can consume", async (t) => {
  const projectRoot = await makeProjectRoot();
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  const runDir = path.join(projectRoot, "coder", "demo-exp");

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "experiment",
    owner_agent: "researcher",
    experiment_search: {
      status: "running",
      search_spec_path: "planner/EXPERIMENT_SEARCH_SPEC.json",
      baseline_fairness_status: "ready",
      implementation_confidence: "trusted",
      multi_seed_status: "pending",
      ablation_status: "pending",
      search_exhaustion_status: "active",
      evidence_cleanliness_status: "clean",
    },
  });
  await writeJson(path.join(projectRoot, "planner", "EXPERIMENT_SEARCH_SPEC.json"), {
    search_session_id: "search-demo",
  });
  await writeJson(path.join(projectRoot, "coder", "demo-exp", "REMOTE_RUN.json"), {
    experiment_id: "exp-1",
    experiment_name: "baseline",
    track_id: "track-main",
    server: "gpu-server",
    gpu_id: "0",
    screen_name: "baseline-run",
    status: "running",
  });

  const runtimeSignal = await executeWorkflowTool(tool, {
    action: "record_experiment_runtime_signal",
    projectRoot,
    experimentRuntimeSignal: {
      experiment_id: "exp-1",
      run_id: "run-proof-1",
      stage_run_id: "stage-run-proof-1",
      git_commit: "abc123",
      remote_run_path: "coder/demo-exp/REMOTE_RUN.json",
      status: "completed",
      result_paths: ["researcher/artifacts/results/results.json"],
      key_metric: { name: "h_score", value: 0.55 },
      metrics: { h_score: 0.55 },
    },
  });

  assert.equal(runtimeSignal.status, "completed");
  await fs.access(path.join(runDir, "RUN_TERMINAL.json"));
  await fs.access(path.join(runDir, "RESULT_SUMMARY.json"));
  const remoteRun = JSON.parse(
    await fs.readFile(path.join(runDir, "REMOTE_RUN.json"), "utf8")
  );
  assert.equal(remoteRun.run_id, "run-proof-1");
  assert.equal(remoteRun.stage_run_id, "stage-run-proof-1");
  assert.equal(remoteRun.git_commit, "abc123");
  const resultSummary = JSON.parse(
    await fs.readFile(path.join(runDir, "RESULT_SUMMARY.json"), "utf8")
  );
  assert.equal(resultSummary.run_id, "run-proof-1");
  assert.equal(resultSummary.stage_run_id, "stage-run-proof-1");
  assert.equal(resultSummary.git_commit, "abc123");

  const decision = await executeWorkflowTool(tool, {
    action: "evaluate_experiment_search_decision",
    experimentSearchDecision: {
      project_root: projectRoot,
    },
  });
  assert.equal(typeof decision.summary.decision, "string");
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
  assert.equal(requests[0].url, "/api/corpus-sources");

  const graphPresence = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), "utf8")
  );
  assert.equal(graphPresence.status, "ready");
});

test("research_workflow dispatch_task claims the next matching team task for the target owner session", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await materializeWorkflowTaskGraph({
    projectRoot,
    projectId: "demo-project",
    stage: "plan",
    topTierVerdict: "worth_top_tier_bet",
    evidenceCloseout: {
      status: "blocked",
      topTierVerdict: "worth_top_tier_bet",
      blockers: ["benchmark protocol missing"],
      experimentAnalyzeReady: false,
      analyzeReviewReady: true,
      writeReady: false,
      submitReady: false,
      graphDependentBlockerCount: 0,
      localEvidenceBlockerCount: 1,
    },
    previewTasks: [
      {
        taskId: "plan.write_canonical_packets",
        title: "Write the canonical planning packets",
        owner: "orchestrator",
        status: "blocked",
        reason: "Plan packets are still missing.",
      },
    ],
  });

  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    pluginConfig: {
      agentContactCooldownSeconds: 0,
      enableChannelProjectBindings: false,
      projectsRoot: path.dirname(projectRoot),
    },
    logger: {
      warn(...args) {
        console.error("dispatch_task_warn", ...args);
      },
    },
    runtime: {
      subagent: {
        async run() {
          return { runId: "dispatch-run-1" };
        },
      },
    },
    agentId: "researcher",
    sessionKey: "agent:researcher:discord:group:paper-lab",
    messageChannel: "discord",
  });

  const result = await executeWorkflowTool(tool, {
    action: "dispatch_task",
    toAgent: "orchestrator",
    subject: "Workflow task dispatch",
    command: "/plan-research",
  });

  assert.equal(result.dispatched, true, JSON.stringify(result, null, 2));
  const store = await readWorkflowTaskGraphStore(projectRoot);
  assert.equal(
    store?.tasks[0].status,
    "claimed",
    JSON.stringify({ dispatch: result, store }, null, 2)
  );
  assert.equal(
    store?.tasks[0].lease?.sessionKey,
    "agent:orchestrator:discord:group:paper-lab"
  );
});

test("research_workflow complete_task verifies the current task and auto-claims the next task", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await materializeWorkflowTaskGraph({
    projectRoot,
    projectId: "demo-project",
    stage: "experiment",
    topTierVerdict: null,
    evidenceCloseout: {
      status: "not_applicable",
      topTierVerdict: null,
      blockers: [],
      experimentAnalyzeReady: true,
      analyzeReviewReady: true,
      writeReady: true,
      submitReady: true,
      graphDependentBlockerCount: 0,
      localEvidenceBlockerCount: 0,
    },
    previewTasks: [
      {
        taskId: "experiment.prepare_bundle",
        title: "Prepare the bundle",
        owner: "researcher",
        status: "blocked",
        reason: "Bundle still needs a first pass.",
        dependsOn: [],
        verificationRule: "none",
      },
      {
        taskId: "experiment.publish_bundle",
        title: "Publish the bundle",
        owner: "researcher",
        status: "blocked",
        reason: "Wait until the bundle is prepared.",
        dependsOn: ["experiment.prepare_bundle"],
        verificationRule: "none",
      },
    ],
  });

  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    pluginConfig: {
      agentContactCooldownSeconds: 0,
      enableChannelProjectBindings: false,
      projectsRoot: path.dirname(projectRoot),
    },
    agentId: "researcher",
    sessionKey: "agent:researcher:discord:group:paper-lab",
    messageChannel: "discord",
  });

  const claimed = await executeWorkflowTool(tool, {
    action: "claim_task",
    taskId: "experiment.prepare_bundle",
  });
  assert.equal(claimed.claimed, true);

  const completed = await executeWorkflowTool(tool, {
    action: "complete_task",
    taskId: "experiment.prepare_bundle",
    completionNote: "Prepared the bundle.",
  });
  assert.equal(completed.completed, true);
  assert.equal(completed.nextTask?.taskId, "experiment.publish_bundle");

  const store = await readWorkflowTaskGraphStore(projectRoot);
  assert.equal(
    store?.tasks.find((task) => task.taskId === "experiment.prepare_bundle")?.status,
    "satisfied"
  );
  assert.equal(
    store?.tasks.find((task) => task.taskId === "experiment.publish_bundle")?.status,
    "claimed"
  );
});

test("research_workflow queue_paper_ingestion_retry creates a sequential retry request for failed papers", async (t) => {
  const projectRoot = await makeProjectRoot();

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "graph_build",
    owner_agent: "researcher",
    idle_research: { enabled: false },
    paper_ingestion: {
      batch_items: [
        {
          paper_id: "paper:retry-1",
          title: "Retryable Paper",
          status: "failed",
          error: "Another PaperNexus run committed newer corpus state",
        },
        {
          paper_id: "paper:bad-1",
          title: "Invalid Paper",
          status: "failed",
          error: "invalid markdown",
        },
      ],
    },
  });

  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    pluginConfig: {
      enableChannelProjectBindings: false,
      projectsRoot: path.dirname(projectRoot),
    },
    agentId: "researcher",
    sessionKey: "agent:researcher:discord:group:paper-lab",
    messageChannel: "discord",
  });

  const queued = await executeWorkflowTool(tool, {
    action: "queue_paper_ingestion_retry",
    paperIngestionRequest: {
      intervalSeconds: 45,
      maxAttempts: 3,
    },
  });

  assert.equal(queued.retryableFailures.length, 1);
  assert.equal(queued.nonRetryableFailures.length, 1);
  assert.match(queued.commandText, /--sequential/);
  assert.equal(queued.queuedRequest.wrapper, "pn_batch_import.py");
  assert.equal(queued.queuedRequest.paperCount, 1);

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.paper_ingestion.retry_status, "queued");
  assert.equal(manifest.paper_ingestion.retryable_failed_papers.length, 1);
  assert.equal(manifest.paper_ingestion.non_retryable_failed_papers.length, 1);
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
  assert.equal(result.request.requestKind, "requisition");
  assert.match(result.request.requestId, /^literature-discovery-/);
  assert.equal(result.request.sharedCorpus, "GCD");
  assert.match(result.request.commandText ?? "", /LITERATURE_DISCOVERY_PACKET\.json/);
  assert.match(result.request.commandText ?? "", /graph-build/i);
  assert.match(result.request.manifestPath ?? "", /DISCOVERY_REQUISITION\.json$/);
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
  assert.ok(Array.isArray(result.writingSession.draftOrder));
  assert.ok(result.writingSession.draftOrder.length > 0);
  assert.equal(result.writingSession.currentSection, result.writingSession.draftOrder[0]);
  assert.match(result.writingSession.processStatus, /outline_ready|bootstrapping/);
  assert.ok(Array.isArray(result.generatedFiles));
  assert.ok(result.generatedFiles.some((entry) => /WRITING_REFERENCE_BUNDLE\.json$/.test(entry)));
  assert.ok(result.generatedFiles.includes("academic_writer/PARAGRAPH_LOGIC_AUDIT.json"));
  assert.ok(result.generatedFiles.includes("academic_writer/PARAGRAPH_LOGIC_AUDIT.md"));
  assert.ok(result.generatedFiles.includes("academic_writer/PARAGRAPH_LOGIC_REVERSE_OUTLINE.md"));
});

test("research_workflow materialize_writing_support_artifacts adds survey-specific comparison and self-review packets", async (t) => {
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
    project_id: "survey-demo",
    current_stage: "write",
    owner_agent: "academic_writer",
    writing_contract: {
      paper_mode: "survey",
      section_order: [
        "abstract",
        "introduction",
        "scope_and_protocol",
        "taxonomy",
        "evidence_synthesis",
        "benchmark_landscape",
        "open_problems",
        "conclusion",
      ],
    },
    survey_review: {
      status: "completed",
      topic: "Generalized Category Discovery",
      included_paper_count: 14,
    },
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
      unsupported_claim_count: 0,
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
    "# Claims\n## Theme 1\n"
  );
  await writeText(path.join(projectRoot, "academic_writer", "story", "FALLBACK_NARRATIVE.md"), "# Fallback\n");
  await writeText(path.join(projectRoot, "academic_writer", "story", "REJECTION_RISK_TABLE.md"), "# Risks\n");
  await writeText(path.join(projectRoot, "academic_writer", "story", "PIPELINE_FIGURE_SKETCH.md"), "# Figure\n");
  await writeText(path.join(projectRoot, "academic_writer", "story", "MODULE_MOTIVATION_MAP.md"), "# Modules\n");
  await writeJson(path.join(projectRoot, "academic_writer", "SURVEY_STORYLINE_PACKET.json"), {
    schema_version: 1,
    topic: "Generalized Category Discovery",
    selected_strategy_id: "evaluation_crisis_first",
    selected_strategy_label: "Evaluation-crisis-first",
    selected_strategy_rationale: [
      "Benchmark comparisons are only fair under matched open-set assumptions.",
      "The field story is misleading when protocol drift is hidden behind a single leaderboard.",
    ],
    thesis:
      "For generalized category discovery, the decisive organizing question is which benchmark and metric comparisons are actually fair.",
    intellectual_center_section: "benchmark_landscape",
    body_section_order: [
      "scope_and_protocol",
      "benchmark_landscape",
      "taxonomy",
      "evidence_synthesis",
      "open_problems",
    ],
    section_plans: [
      {
        section_id: "scope_and_protocol",
        prompt: "What scope and protocol boundaries define this survey?",
        objective: "Open with inclusion, exclusion, and comparability rules.",
        core_message: "Scope discipline comes before synthesis claims.",
        evidence_cluster_ids: ["scope_protocol"],
        anchor_ids: ["protocol:review"],
        tension_ids: [],
      },
      {
        section_id: "benchmark_landscape",
        prompt: "Which benchmark comparisons are actually fair?",
        objective: "Expose protocol drift before aggregating wins.",
        core_message: "Benchmark landscape is the intellectual center for this survey.",
        evidence_cluster_ids: ["benchmark_landscape"],
        anchor_ids: ["benchmark:cifar100", "benchmark:imagenet100"],
        tension_ids: ["tension-1"],
      },
      {
        section_id: "taxonomy",
        prompt: "Which families remain meaningful once benchmark constraints are explicit?",
        objective: "Rebuild taxonomy after the evaluation contract is visible.",
        core_message: "Taxonomy only becomes credible once evaluation drift is explicit.",
        evidence_cluster_ids: ["taxonomy"],
        anchor_ids: ["family:prototype", "family:prompt"],
        tension_ids: ["tension-1"],
      },
      {
        section_id: "evidence_synthesis",
        prompt: "What comparative evidence survives those constraints?",
        objective: "Compare strengths and weaknesses under matched settings.",
        core_message: "Evidence synthesis should keep non-comparable results visible.",
        evidence_cluster_ids: ["evidence_synthesis"],
        anchor_ids: ["paper:a", "paper:b"],
        tension_ids: ["tension-1"],
      },
      {
        section_id: "open_problems",
        prompt: "What problems remain unresolved after the benchmark contract is clarified?",
        objective: "End with open problems that fall out of the selected thesis.",
        core_message: "Open problems must inherit the benchmark comparability story.",
        evidence_cluster_ids: ["open_problems"],
        anchor_ids: ["gap:metric-drift"],
        tension_ids: ["tension-1"],
      },
    ],
  });
  await writeJson(path.join(projectRoot, "researcher", "idea-catalyst", "IDEA_TO_CLAIM_MAP.json"), {
    top_fragments: [],
  });
  await writeText(path.join(projectRoot, "reviewer", "story-pressure", "REJECT_FIRST_REVIEW.md"), "# Reject\n");
  await writeText(path.join(projectRoot, "reviewer", "story-pressure", "NOVELTY_ATTACK.md"), "# Novelty Attack\n");
  await writeText(path.join(projectRoot, "reviewer", "story-pressure", "UNSUPPORTED_CLAIM_AUDIT.md"), "# Unsupported\n");
  await writeText(path.join(projectRoot, "reviewer", "story-pressure", "REVERSE_OUTLINE.md"), "# Reverse Outline\n");
  await writeText(path.join(projectRoot, "reviewer", "story-pressure", "FIGURE_TABLE_QC.md"), "# Figure QC\n");
  await writeText(path.join(projectRoot, "reviewer", "story-pressure", "LIMITATION_AUDIT.md"), "# Limitation Audit\n");
  await writeText(path.join(projectRoot, "researcher", "SURVEY_BRIEF.md"), "# Survey Brief\n- six families\n- benchmark clusters\n");
  await writeText(path.join(projectRoot, "researcher", "LITERATURE_REVIEW.md"), "# Literature Review\n- family comparison\n- contradiction zone\n");
  await writeText(path.join(projectRoot, "researcher", "SOTA_MATRIX.md"), "# SOTA Matrix\n- dataset / metric comparison\n- tradeoff note\n");
  await writeText(path.join(projectRoot, "researcher", "GAP_SYNTHESIS.md"), "# Gap Synthesis\n- coverage blind spot\n- unresolved comparison\n");
  await writeText(path.join(projectRoot, "researcher", "COVERAGE_SUMMARY.md"), "# Coverage Summary\n- broad scope\n- blind spots documented\n");
  await writeText(path.join(projectRoot, "researcher", "REVIEW_PROTOCOL.md"), "# Review Protocol\n- inclusion / exclusion logic\n");
  await writeJson(path.join(projectRoot, "researcher", "EXCLUDED_PAPERS.json"), {
    backgroundPapers: [
      {
        title: "Open World Object Detection: A Survey",
        reason: "boundary survey for scope contrast",
      },
    ],
  });
  await writeJson(path.join(projectRoot, "researcher", "CANDIDATE_SCREENING_DECISIONS.json"), {
    decisions: [
      {
        title: "Open World Object Detection: A Survey",
        decision: "reference",
        reason: "boundary survey for scope contrast",
      },
    ],
  });

  const result = await executeWorkflowTool(tool, {
    action: "materialize_writing_support_artifacts",
    paperStoryMaterialization: {
      basis_stage: "write",
    },
  });

  assert.ok(result.generatedFiles.includes("academic_writer/SURVEY_COMPARATIVE_ANALYSIS.md"));
  assert.ok(result.generatedFiles.includes("academic_writer/SURVEY_SECTION_BRIEFS.md"));
  assert.ok(result.generatedFiles.includes("academic_writer/SURVEY_SELF_REVIEW.md"));
  assert.ok(result.generatedFiles.includes("academic_writer/SURVEY_VISUALIZATION_PLAN.md"));
  assert.ok(result.generatedFiles.includes("academic_writer/SURVEY_VISUAL_ASSET_INDEX.json"));
  assert.ok(result.generatedFiles.includes("researcher/SOURCE_TO_CLAIM_INDEX.json"));
  assert.ok(result.generatedFiles.includes("researcher/SURVEY_EVIDENCE_PACKET.json"));
  assert.ok(result.generatedFiles.includes("researcher/SURVEY_REFERENCE_ALIGNMENT.json"));
  assert.ok(result.generatedFiles.includes("researcher/SURVEY_TOP_TIER_BRIDGE.json"));
  assert.ok(result.generatedFiles.includes("researcher/SURVEY_TRACEABILITY_AUDIT.json"));
  assert.ok(result.generatedFiles.includes("analyzer/FAIR_COMPARE_MATRIX.json"));
  assert.ok(
    result.generatedFiles.includes(
      "academic_writer/paper/tables/survey_taxonomy_overview.tex"
    )
  );
  assert.ok(
    result.generatedFiles.includes(
      "academic_writer/paper/tables/survey_benchmark_landscape.tex"
    )
  );
  assert.ok(
    result.referenceBundle.sectionBundles.taxonomy.referencePaths.some((entry) =>
      /survey-writing\.md$/.test(entry)
    )
  );

  const comparative = await fs.readFile(
    path.join(projectRoot, "academic_writer", "SURVEY_COMPARATIVE_ANALYSIS.md"),
    "utf8"
  );
  const sectionBriefs = await fs.readFile(
    path.join(projectRoot, "academic_writer", "SURVEY_SECTION_BRIEFS.md"),
    "utf8"
  );
  assert.match(comparative, /Required Comparison Axes/i);
  assert.match(comparative, /tradeoff/i);
  assert.match(comparative, /Open World Object Detection: A Survey/i);
  assert.match(comparative, /Evaluation-crisis-first/i);
  assert.match(sectionBriefs, /Selected macro-story: Evaluation-crisis-first/i);
  assert.match(sectionBriefs, /Intellectual center: benchmark_landscape/i);
  assert.match(sectionBriefs, /Which benchmark comparisons are actually fair/i);
  assert.match(comparative, /Traceable synthesis claims/i);

  const visualizationPlan = await fs.readFile(
    path.join(projectRoot, "academic_writer", "SURVEY_VISUALIZATION_PLAN.md"),
    "utf8"
  );
  assert.match(visualizationPlan, /Table 1 — Family \/ Taxonomy Overview/i);
  assert.match(visualizationPlan, /Figure 2 — Benchmark \/ Comparison Landscape/i);

  const taxonomyTable = await fs.readFile(
    path.join(projectRoot, "academic_writer", "paper", "tables", "survey_taxonomy_overview.tex"),
    "utf8"
  );
  assert.match(taxonomyTable, /Representative methods/i);

  const assetIndex = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "academic_writer", "SURVEY_VISUAL_ASSET_INDEX.json"),
      "utf8"
    )
  );
  assert.equal(Array.isArray(assetIndex.tableDrafts), true);
  assert.equal(Array.isArray(assetIndex.figureSpecs), true);
  assert.ok(assetIndex.sourceArtifacts.includes("researcher/SOURCE_TO_CLAIM_INDEX.json"));
  assert.ok(assetIndex.sourceArtifacts.includes("researcher/SURVEY_EVIDENCE_PACKET.json"));
  assert.ok(assetIndex.sourceArtifacts.includes("researcher/SURVEY_TOP_TIER_BRIDGE.json"));

  const traceabilityAudit = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "SURVEY_TRACEABILITY_AUDIT.json"),
      "utf8"
    )
  );
  assert.equal(typeof traceabilityAudit.traceabilityReady, "boolean");

  const topTierBridge = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "SURVEY_TOP_TIER_BRIDGE.json"),
      "utf8"
    )
  );
  assert.equal(typeof topTierBridge.ready, "boolean");
});

test("research_workflow materialize_paragraph_logic_audit_state captures cross-paragraph breaks", async (t) => {
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
    project_id: "paragraph-logic-demo",
    current_stage: "write",
    owner_agent: "academic_writer",
    writing_contract: {
      paper_mode: "conference",
      section_order: ["introduction"],
    },
  });
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "sections", "introduction.tex"),
    [
      "Generalized category discovery remains hard because pseudo-label noise distorts class boundaries. This motivates a writing pipeline that keeps the argument focused on confirmation-bias control.",
      "",
      "ImageNet servers often need thermal maintenance logs during summer deployment windows. Engineers monitor fan failures and rack temperatures for infrastructure planning.",
    ].join("\n")
  );

  const result = await executeWorkflowTool(tool, {
    action: "materialize_paragraph_logic_audit_state",
  });

  assert.equal(result.state.status, "blocked");
  assert.equal(result.generatedFiles.includes("academic_writer/PARAGRAPH_LOGIC_AUDIT.json"), true);
  assert.equal(result.generatedFiles.includes("academic_writer/PARAGRAPH_LOGIC_AUDIT.md"), true);
  assert.equal(
    result.generatedFiles.includes("academic_writer/PARAGRAPH_LOGIC_REVERSE_OUTLINE.md"),
    true
  );
  assert.equal(result.blockingIssues.length > 0, true);

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.paragraph_logic_audit.status, "blocked");
  assert.equal(manifest.writing_contract.paragraph_logic_status, "red");
});

test("research_workflow get_snapshot restores mirrored authoring artifacts before writer recovery falls back to full rebuild", async (t) => {
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
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    agentId: "academic_writer",
    sessionKey: "agent:academic_writer:discord:group:paper-lab",
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "write",
    current_micro_stage: "drafting",
    owner_agent: "academic_writer",
    idle_research: { enabled: false },
    writing_contract: {
      paper_mode: "survey",
      required_sections: ["abstract", "introduction"],
      section_order: ["abstract", "introduction"],
    },
  });
  await writeText(path.join(projectRoot, "academic_writer", "PAPER_PLAN.md"), "# plan\n");
  await writeText(
    path.join(projectRoot, "academic_writer", "STORYLINE_SKETCH.md"),
    "# storyline\n"
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "WRITING_SIGNALS.md"),
    "# writing signals\n"
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    "\\input{sections/abstract}\n"
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "refs.bib"),
    "@article{demo,title={Demo}}\n"
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "sections", "abstract.tex"),
    "\\section*{Abstract}\nRecovered abstract.\n"
  );

  await executeWorkflowTool(tool, {
    action: "set_writing_session",
    writingSession: {
      status: "drafting",
      current_section: "abstract",
      draft_order: ["abstract", "introduction"],
      section_packets: {
        abstract: {
          section: "abstract",
          packet_path: "academic_writer/section-packets/abstract.json",
          draft_path: "academic_writer/paper/sections/abstract.tex",
          review_verdict: null,
          status: "drafted",
          forbidden_unsupported_claims: [],
          missing_citation_placeholders: [],
          required_graph_evidence_pointers: [],
        },
      },
      headline_claim_evidence_status: "pending",
      graph_evidence_coverage_status: "pending",
    },
  });

  await fs.rm(path.join(projectRoot, "academic_writer", "paper"), {
    recursive: true,
    force: true,
  });
  await fs.rm(path.join(projectRoot, "academic_writer", "PAPER_PLAN.md"), {
    force: true,
  });
  await fs.rm(path.join(projectRoot, "academic_writer", "STORYLINE_SKETCH.md"), {
    force: true,
  });
  await fs.rm(path.join(projectRoot, "academic_writer", "WRITING_SIGNALS.md"), {
    force: true,
  });

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  manifest.writing_session = {};
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);

  const snapshot = await executeWorkflowTool(tool, {
    action: "get_snapshot",
  });

  assert.equal(snapshot.currentStage, "write");
  assert.equal(snapshot.ownerAgent, "academic_writer");
  assert.equal(snapshot.writingRebuildNeeded, false);
  assert.equal(snapshot.writingProcessStatus, "drafting");
  await fs.access(path.join(projectRoot, "academic_writer", "paper", "main.tex"));
  await fs.access(
    path.join(projectRoot, "academic_writer", "paper", "sections", "abstract.tex")
  );
  await fs.access(path.join(projectRoot, "academic_writer", "PAPER_PLAN.md"));
});

test("research_workflow write_text_artifact writes long writer artifacts without raw exec", async (t) => {
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
    current_stage: "write",
    current_micro_stage: "drafting",
    owner_agent: "academic_writer",
    idle_research: { enabled: false },
  });

  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    agentId: "academic_writer",
    sessionKey: "agent:academic_writer:discord:channel:test",
  });

  const sectionText =
    "\\section{Taxonomy of GCD Methods}\n" +
    `${"This survey paragraph expands the taxonomy evidence with durable prose. ".repeat(120)}\n`;

  const result = await executeWorkflowTool(tool, {
    action: "write_text_artifact",
    artifactPath: "academic_writer/paper/sections/taxonomy.tex",
    content: sectionText,
    ensureTrailingNewline: true,
  });

  assert.equal(result.relativePath, "academic_writer/paper/sections/taxonomy.tex");
  assert.equal(result.syncedAuthoringRecovery, true);

  const liveText = await fs.readFile(
    path.join(projectRoot, "academic_writer", "paper", "sections", "taxonomy.tex"),
    "utf8"
  );
  assert.equal(liveText, sectionText);

  const recoveryStore = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, ".openclaw-research", "authoring-artifact-receipts.json"),
      "utf8"
    )
  );
  assert.ok(
    recoveryStore.artifacts.some(
      (entry) => entry.relativePath === "academic_writer/paper/sections/taxonomy.tex"
    )
  );
  await fs.access(
    path.join(
      projectRoot,
      ".openclaw-research",
      "authoring-recovery-mirror",
      "academic_writer",
      "paper",
      "sections",
      "taxonomy.tex"
    )
  );
});

test("research_workflow write_text_artifact rejects writes outside the owner scope", async (t) => {
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
    current_stage: "write",
    current_micro_stage: "drafting",
    owner_agent: "academic_writer",
    idle_research: { enabled: false },
  });

  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    agentId: "academic_writer",
    sessionKey: "agent:academic_writer:discord:channel:test",
  });

  await assert.rejects(
    () =>
      tool.execute("test-call", {
        action: "write_text_artifact",
        artifactPath: "researcher/SURVEY_BRIEF.md",
        content: "# not allowed\n",
      }),
    /academic_writer cannot write/i
  );
});

test("research_workflow recover_survey_route preserves an active survey write stage", async (t) => {
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
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    agentId: "academic_writer",
    sessionKey: "agent:academic_writer:discord:group:paper-lab",
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "survey-demo-project",
    workflow_line: "survey",
    paper_type: "survey",
    current_stage: "write",
    current_micro_stage: "drafting",
    owner_agent: "academic_writer",
    idle_research: { enabled: false },
    writing_contract: {
      paper_mode: "survey",
    },
    survey_review: {
      topic: "Survey demo",
      status: "completed",
      current_phase: "complete",
    },
  });

  const result = await executeWorkflowTool(tool, {
    action: "recover_survey_route",
  });
  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );

  assert.equal(result.stage, "write");
  assert.equal(manifest.current_stage, "write");
  assert.equal(manifest.owner_agent, "academic_writer");
  assert.equal(manifest.current_micro_stage, "drafting");
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

  const ideaReport = await fs.readFile(
    path.join(projectRoot, "researcher", "IDEA_REPORT.md"),
    "utf8"
  );
  assert.match(ideaReport, /Selected Direction/i);
  assert.match(ideaReport, /Graph-grounded support router/i);

  const ideaAudit = await fs.readFile(
    path.join(projectRoot, "researcher", "IDEA_AUDIT.md"),
    "utf8"
  );
  assert.match(ideaAudit, /ready_for_plan/i);

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

test("research_workflow materialize_ideation_contract seeds an active track from brainstorm output when TRACK_REGISTRY is empty", async (t) => {
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
    "# Anchor Index\n- anchor: fixmatch-consistency\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "graph", "LIMITATION_FRONTIER.md"),
    "# Limitation Frontier\n- supervised baselines overfit known-class confidence\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "graph", "TRANSFER_FRONTIER.md"),
    "# Transfer Frontier\n- transfer FixMatch consistency calibration into GCD pseudo-label filtering\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(projectRoot, "researcher", "FRONTIER_REPORT.md"),
    "# Frontier Report\n\n## Challenge clusters\n- known-class confidence can suppress novel clusters\n\n## Insight clusters\n- adaptive consistency can preserve unlabeled structure\n",
    "utf8"
  );

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "idea";
  manifest.owner_agent = "researcher";
  manifest.research_program = {
    status: "approved",
    goal: "Improve generalized category discovery using the FixMatch generalization mechanism.",
    problem_statement:
      "GCD needs semi-supervised consistency without collapsing novel-class structure.",
    baseline_reference: "supervised GCD baseline",
    primary_metric: "novel-class clustering accuracy",
    datasets: ["CIFAR-100", "ImageNet-100"],
    success_criteria: ["improve novel-class clustering accuracy over the supervised baseline"],
    zotero_project_path: "bot/demo-project",
    tracks: [],
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await executeWorkflowTool(tool, {
    action: "run_brainstorm_cycle",
    brainstormCycle: {
      topic: "FixMatch-inspired GCD",
      basis_stage: "frontier_mapping",
      provider: "workflow_core_brainstorm",
      provider_mode: "core",
      contract_version: 1,
      rounds: [
        {
          round_id: "round-1",
          label: "select",
          status: "completed",
          options: [
            {
              option_id: "dir-adaptive-fixmatch-gcd",
              title: "Adaptive FixMatch consistency for generalized category discovery",
              score: 0.89,
              summary:
                "Use FixMatch-style consistency only when pseudo-label confidence is compatible with preserving novel-cluster structure.",
              logic_chain:
                "# Logic Chain\nChallenge: novel clusters collapse under overconfident pseudo-labels.\nInsight: adaptive consistency can gate weak-to-strong augmentation pressure.\n",
              evidence_chain:
                "# Evidence Chain\n- frontier packets connect FixMatch consistency to GCD pseudo-label calibration\n",
              reasoning_trace: [
                {
                  step: "map-fixmatch-to-gcd",
                  conclusion: "consistency should be adaptive rather than uniform",
                },
              ],
              question_packet: "# Questions\n- when should consistency pressure be disabled for likely novel samples?\n",
              working_memory: {
                surviving_direction: "adaptive FixMatch consistency for GCD",
              },
              synthesis_packet:
                "# Synthesis\nAdaptive consistency is the smallest testable method delta for GCD.\n",
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
  assert.match(result.state.selectedTrackId, /^track-adaptive-fixmatch-consistency/);
  assert.equal(result.state.selectedDirectionId, "dir-adaptive-fixmatch-gcd");
  assert.equal(result.state.graphIdeationIndices.status, "ready");
  assert.ok(result.generatedFiles.includes("researcher/IDEA_REPORT.md"));
  assert.ok(result.generatedFiles.includes("researcher/IDEA_AUDIT.md"));

  const trackRegistry = JSON.parse(
    await fs.readFile(path.join(projectRoot, "TRACK_REGISTRY.json"), "utf8")
  );
  assert.equal(trackRegistry.active_tracks, 1);
  assert.equal(trackRegistry.tracks[0].status, "active");
  assert.equal(trackRegistry.tracks[0].track_id, result.state.selectedTrackId);
  assert.match(trackRegistry.tracks[0].hypothesis, /FixMatch-style consistency/i);
  assert.ok(
    trackRegistry.tracks[0].evidence_pointers.some((entry) =>
      /FRONTIER_REPORT\.md|ANCHOR_INDEX\.md/.test(entry)
    )
  );

  const ideaReport = await fs.readFile(
    path.join(projectRoot, "researcher", "IDEA_REPORT.md"),
    "utf8"
  );
  assert.match(ideaReport, /Adaptive FixMatch consistency/i);
  assert.match(ideaReport, /Testable Plan/i);
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

test("research_workflow capture_diagnostic_bundle materializes a bounded diagnostic bundle", async (t) => {
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
    current_stage: "graph_build",
    owner_agent: "researcher",
    blocking_reason: "Waiting for graph presence",
    revision_control_state: {
      status: "active",
      revision_round: 2,
      current_owner: "academic_writer",
      next_reviewer_role: "reviewer",
      active_revision_packet_path: "reviewer/REVISION_CONTROL_PACKET.json",
      open_sources: [{ source_type: "review_session", source_id: "round-2", severity: "medium", status: "open" }],
    },
    auto_dispatch_diagnostics: {
      status: "waiting",
      blocking_layer: "signals",
      blocking_reason: "graph_presence_missing",
    },
    survey_visual_compiler_state: {
      status: "ready",
      row_count: 4,
      insertion_map_path: "academic_writer/SURVEY_VISUAL_INSERTION_MAP.json",
    },
    survey_methodology_consistency: {
      status: "blocked",
      path: "researcher/SURVEY_METHODOLOGY_CONSISTENCY.json",
      blocking_issues: ["paper counts disagree"],
    },
  });
  await writeJson(path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json"), {
    status: "missing_sources",
  });
  await writeJson(path.join(projectRoot, ".openclaw-research", "workflow-runtime-queue.json"), {
    schemaVersion: 1,
    entries: [],
  });

  const result = await executeWorkflowTool(tool, {
    action: "capture_diagnostic_bundle",
    diagnosticBundle: {
      reason: "discord_native_failure",
      tailLines: 50,
    },
  });

  assert.equal(result.projectId, "demo-project");
  assert.match(result.bundleRelativeDir ?? "", /\.openclaw-research\/diagnostics\//);
  await fs.access(path.join(projectRoot, result.summaryRelativePath));
  await fs.access(path.join(projectRoot, result.indexRelativePath));
  await fs.access(
    path.join(projectRoot, result.bundleRelativeDir, "workflow-diagnostics.tail.json")
  );
  const index = JSON.parse(
    await fs.readFile(path.join(projectRoot, result.indexRelativePath), "utf8")
  );
  assert.equal(index.projectId, "demo-project");
  assert.equal(index.reason, "discord_native_failure");
  assert.equal(index.keyFiles.diagnosticsTail, "workflow-diagnostics.tail.json");
  const summaryText = await fs.readFile(
    path.join(projectRoot, result.summaryRelativePath),
    "utf8"
  );
  assert.match(summaryText, /Workflow Diagnostic Bundle/);
  assert.match(summaryText, /blocking_reason: Waiting for graph presence/);
  assert.match(summaryText, /revision_control: active/);
  assert.match(summaryText, /auto_dispatch_diagnostics: waiting/);
  assert.match(summaryText, /survey_visual_compiler: ready/);
  assert.match(summaryText, /survey_methodology_consistency: blocked/);
});

test("research_workflow auto_iterator_tick follows the bound channel project even when workspaceDir points at another project", async (t) => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-runtime-binding-priority-")
  );
  const projectsRoot = path.join(workspaceRoot, "projects");
  const boundProjectRoot = path.join(projectsRoot, "gcd-confirmation-bias-mitigation");
  const workspaceProjectRoot = path.join(workspaceRoot, "gcd-part-manifold-2026");
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const sessionKey = "agent:researcher:local:group:paper-lab";

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
    messageChannel: "local",
    projectRoot: boundProjectRoot,
    boundByAgent: "researcher",
  });

  const tool = createResearchWorkflowTool({
    workspaceDir: workspaceProjectRoot,
    sessionKey,
    messageChannel: "local",
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

test("research_workflow bind_channel_project resolves local non-Researcher context without rebinding", async (t) => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-local-context-bind-")
  );
  const projectsRoot = path.join(workspaceRoot, "projects");
  const projectRoot = path.join(projectsRoot, "gcd-local-context");
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const channelKey = "local:conversation:e2e-local-context";
  const researcherSessionKey = "agent:researcher:local:conversation:e2e-local-context";
  const orchestratorSessionKey =
    "agent:orchestrator:local:conversation:e2e-local-context";

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  delete process.env.OPENCLAW_PROJECT;
  await seedMinimalProject(projectRoot, {
    project_id: "gcd-local-context",
    current_stage: "plan",
    owner_agent: "orchestrator",
  });

  await bindChannelProjectForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey: researcherSessionKey,
    messageChannel: "local",
    channelKey,
    projectRoot,
    projectId: "gcd-local-context",
    boundByAgent: "researcher",
  });

  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    agentId: "orchestrator",
    sessionKey: orchestratorSessionKey,
    messageChannel: "local",
    channelKey,
    pluginConfig: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
  });

  const result = await executeWorkflowTool(tool, {
    action: "bind_channel_project",
    projectRoot,
    projectId: "gcd-local-context",
  });

  assert.equal(result.resolvedOnly, true);
  assert.equal(result.reason, "existing_local_workflow_context");
  assert.equal(result.projectRoot, projectRoot);
  assert.equal(result.binding.workflowRole, "researcher");
  assert.equal(result.binding.workflowSessionKey, researcherSessionKey);

  const lookup = getChannelProjectBindingForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey: orchestratorSessionKey,
    messageChannel: "local",
    channelKey,
  });
  assert.equal(lookup.binding?.workflowRole, "researcher");
  assert.equal(lookup.binding?.workflowSessionKey, researcherSessionKey);
  assert.equal(lookup.binding?.sessionKeySample, researcherSessionKey);
});

test("research_workflow bind_channel_project resolves non-Researcher snapshot context without Discord rebinding", async (t) => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-discord-bind-guard-")
  );
  const projectsRoot = path.join(workspaceRoot, "projects");
  const projectRoot = path.join(projectsRoot, "gcd-discord-bind-guard");
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  delete process.env.OPENCLAW_PROJECT;
  await seedMinimalProject(projectRoot, {
    project_id: "gcd-discord-bind-guard",
    current_stage: "plan",
    owner_agent: "orchestrator",
  });

  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    agentId: "orchestrator",
    sessionKey: "agent:orchestrator:discord:group:paper-lab",
    messageChannel: "discord",
    channelKey: "discord:group:paper-lab",
    pluginConfig: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
  });

  const result = await executeWorkflowTool(tool, {
    action: "bind_channel_project",
    projectRoot,
    projectId: "gcd-discord-bind-guard",
  });

  assert.equal(result.resolvedOnly, true);
  assert.ok(
    ["workspace_project_context", "explicit_project_context"].includes(result.reason)
  );
  assert.equal(result.projectRoot, projectRoot);
  assert.equal(result.projectId, "gcd-discord-bind-guard");
  assert.equal(result.binding.workflowRole, "orchestrator");

  const lookup = getChannelProjectBindingForWorkflow({
    policy: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
    workspaceDir: workspaceRoot,
    sessionKey: "agent:orchestrator:discord:group:paper-lab",
    messageChannel: "discord",
    channelKey: "discord:group:paper-lab",
  });
  assert.equal(lookup.binding, null);
});

test("research_workflow auto_iterator_tick follows an explicit dashboard channel binding even when the session key is generic", async (t) => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-runtime-dashboard-binding-")
  );
  const projectsRoot = path.join(workspaceRoot, "projects");
  const reviewProjectRoot = path.join(projectsRoot, "gcd-survey-tpami-2026");
  const workspaceProjectRoot = path.join(workspaceRoot, "gcd-part-manifold-2026");
  const previousProjectRoot = process.env.OPENCLAW_PROJECT;
  const sessionKey = "agent:researcher:dashboard:main";
  const reviewChannelKey = "binding:local:default:channel:1491811255814586530";

  t.after(async () => {
    if (previousProjectRoot === undefined) {
      delete process.env.OPENCLAW_PROJECT;
    } else {
      process.env.OPENCLAW_PROJECT = previousProjectRoot;
    }
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  delete process.env.OPENCLAW_PROJECT;
  await seedMinimalProject(reviewProjectRoot, {
    project_id: "gcd-survey-tpami-2026",
    current_stage: "survey_review",
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
    messageChannel: "local",
    channelKey: reviewChannelKey,
    projectRoot: reviewProjectRoot,
    boundByAgent: "researcher",
  });

  const tool = createResearchWorkflowTool({
    workspaceDir: workspaceProjectRoot,
    sessionKey,
    sessionId: "session-dashboard-main",
    messageChannel: "local",
    channelKey: reviewChannelKey,
    pluginConfig: {
      enableChannelProjectBindings: true,
      projectsRoot,
    },
  });

  const snapshot = await executeWorkflowTool(tool, {
    action: "get_snapshot",
  });
  assert.equal(snapshot.projectRoot, reviewProjectRoot);
  assert.equal(snapshot.projectId, "gcd-survey-tpami-2026");
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

  assert.equal(result.projectRoot, reviewProjectRoot);
  assert.equal(result.projectId, "gcd-survey-tpami-2026");
  assert.notEqual(result.projectRoot, workspaceProjectRoot);
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

test("research_workflow upsert_experiment enriches ledger metadata from EXPERIMENT_MANIFEST dataset_path", async (t) => {
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
    current_stage: "experiment",
    owner_agent: "researcher",
  });
  await writeText(
    path.join(
      projectRoot,
      "coder",
      "experiments",
      "track-main",
      "exp-7__coverage",
      "train.py"
    ),
    "print('train')\n"
  );
  await writeText(
    path.join(
      projectRoot,
      "coder",
      "experiments",
      "track-main",
      "exp-7__coverage",
      "README.md"
    ),
    "# bundle\n"
  );
  await writeJson(
    path.join(
      projectRoot,
      "coder",
      "experiments",
      "track-main",
      "exp-7__coverage",
      "EXPERIMENT_MANIFEST.json"
    ),
    {
      experiment_id: "exp-7",
      track_id: "track-main",
      dataset_path: "/data/datasets/CUB-200",
      baseline_reference: "ProtoGCD",
      innovation_points: ["graph grounded routing"],
      git: {
        base_commit: "base-123",
        last_candidate_branch: "candidate/track-main/exp-7",
        last_candidate_commit: "cand-789",
      },
    }
  );
  const runDir = path.join(
    projectRoot,
    "coder",
    "experiments",
    "track-main",
    "exp-7__coverage"
  );
  await writeJson(path.join(runDir, "REMOTE_RUN.json"), {
    experiment_id: "exp-7",
    run_id: "run-exp-7",
    git_commit: "cand-789",
    stage_run_id: "stage-run-exp-7",
    status: "completed",
  });
  await writeJson(path.join(runDir, "RESULT_SUMMARY.json"), {
    experiment_id: "exp-7",
    run_id: "run-exp-7",
    git_commit: "cand-789",
    stage_run_id: "stage-run-exp-7",
    metrics: { acc: 0.77 },
    result_paths: ["researcher/artifacts/results/exp-7.json"],
  });

  const result = await executeWorkflowTool(tool, {
    action: "upsert_experiment",
    experiment: {
      experiment_id: "exp-7",
      track_id: "track-main",
      status: "completed",
      decision: "advance",
      summary: "Completed run.",
    },
  });

  assert.equal(result.entry.metadata.datasets[0], "/data/datasets/CUB-200");
  assert.equal(result.entry.metadata.dataset_names[0], "CUB-200");
  assert.equal(result.entry.metadata.validation_datasets[0], "CUB-200");
  assert.equal(result.entry.metadata.baseline_reference, "ProtoGCD");
  assert.equal(result.entry.metadata.execution.base_commit, "base-123");
  assert.equal(result.entry.metadata.execution.candidate_branch, "candidate/track-main/exp-7");
  assert.equal(result.entry.metadata.execution.candidate_commit, "cand-789");
  assert.equal(result.entry.metadata.execution.run_id, "run-exp-7");
  assert.equal(result.entry.metadata.execution.stage_run_id, "stage-run-exp-7");
  assert.equal(result.entry.metadata.execution.git_commit, "cand-789");
  assert.equal(
    result.entry.metadata.execution.remote_run_path,
    "coder/experiments/track-main/exp-7__coverage/REMOTE_RUN.json"
  );

  const ledger = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"),
      "utf8"
    )
  );
  const entry = ledger.experiments.find((item) => item.experiment_id === "exp-7");
  assert.equal(entry.metadata.datasets[0], "/data/datasets/CUB-200");
  assert.equal(entry.metadata.execution.run_id, "run-exp-7");
});

test("research_workflow run_citation_calibration updates citation integrity from calibrated refs", async (t) => {
  const projectRoot = await makeProjectRoot();
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    agentId: "academic_writer",
    sessionKey: "agent:academic_writer:test",
    pluginConfig: {
      projectsRoot: path.dirname(projectRoot),
    },
  });
  const binDir = path.join(projectRoot, "bin");
  const fakeResearch30 = path.join(projectRoot, "research30", "scripts", "research30.py");
  const fakeResponses = path.join(projectRoot, "research30-responses.json");
  const previousPath = process.env.PATH;
  const previousResearch30Script = process.env.OPENCLAW_RESEARCH30_SCRIPT;
  const previousResearch30Responses = process.env.OPENCLAW_RESEARCH30_FAKE_RESPONSES;
  t.after(() => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousResearch30Script === undefined) delete process.env.OPENCLAW_RESEARCH30_SCRIPT;
    else process.env.OPENCLAW_RESEARCH30_SCRIPT = previousResearch30Script;
    if (previousResearch30Responses === undefined) delete process.env.OPENCLAW_RESEARCH30_FAKE_RESPONSES;
    else process.env.OPENCLAW_RESEARCH30_FAKE_RESPONSES = previousResearch30Responses;
  });
  await fs.mkdir(path.join(projectRoot, "academic_writer", "paper"), { recursive: true });
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "refs.bib"),
    `@inproceedings{demo2024,\n  title={Demo Paper},\n  author={Unknown},\n  booktitle={CVPR},\n  year={2024}\n}\n`
  );
  await writeFakeResearch30Script(fakeResearch30);
  await writeText(
    fakeResponses,
    `${JSON.stringify(
      {
        "Demo Paper doe": [
          {
            title: "Demo Paper",
            authors: "Doe, Jane and Smith, John",
            abstract: "Demo abstract",
            doi: "10.1000/demo2024",
            url: "https://openalex.org/W123",
            source_name: "CVPR",
            date: "2024-06-18",
            score: 97,
            why_relevant: "Exact title match",
          },
        ],
      },
      null,
      2
    )}\n`
  );
  await writeExecutable(
    path.join(binDir, "reffix"),
    `#!/bin/sh
in="$1"
shift
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    out="$2"
    shift 2
  else
    shift
  fi
done
cat "$in" | sed 's/author={[Uu]nknown}/author={Doe, Jane and Smith, John}/' > "$out"
`
  );
  process.env.PATH = `${binDir}:${previousPath ?? ""}`;
  process.env.OPENCLAW_RESEARCH30_SCRIPT = fakeResearch30;
  process.env.OPENCLAW_RESEARCH30_FAKE_RESPONSES = fakeResponses;

  const result = await executeWorkflowTool(tool, {
    action: "run_citation_calibration",
    citationCalibration: {
      bibliography_path: "academic_writer/paper/refs.bib",
    },
  });

  assert.equal(result.suspiciousCount, 0);
  assert.equal(result.hallucinatedCount, 0);
  assert.equal(result.verification.state.verificationStatus, "verified");
  const report = await fs.readFile(
    path.join(projectRoot, "reviewer", "CITATION_CALIBRATION.md"),
    "utf8"
  );
  assert.match(report, /Citation Calibration Report/);
});

test("research_workflow run_citation_calibration accepts top-level projectRoot override", async (t) => {
  const projectRoot = await makeProjectRoot();
  const unrelatedRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-unrelated-workspace-")
  );
  const tool = createResearchWorkflowTool({
    workspaceDir: unrelatedRoot,
    agentId: "academic_writer",
    sessionKey: "agent:academic_writer:test",
    pluginConfig: {
      projectsRoot: path.dirname(projectRoot),
    },
  });
  const binDir = path.join(projectRoot, "bin");
  const fakeResearch30 = path.join(projectRoot, "research30", "scripts", "research30.py");
  const fakeResponses = path.join(projectRoot, "research30-responses.json");
  const previousPath = process.env.PATH;
  const previousResearch30Script = process.env.OPENCLAW_RESEARCH30_SCRIPT;
  const previousResearch30Responses = process.env.OPENCLAW_RESEARCH30_FAKE_RESPONSES;
  t.after(async () => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousResearch30Script === undefined) delete process.env.OPENCLAW_RESEARCH30_SCRIPT;
    else process.env.OPENCLAW_RESEARCH30_SCRIPT = previousResearch30Script;
    if (previousResearch30Responses === undefined) delete process.env.OPENCLAW_RESEARCH30_FAKE_RESPONSES;
    else process.env.OPENCLAW_RESEARCH30_FAKE_RESPONSES = previousResearch30Responses;
    await fs.rm(unrelatedRoot, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(projectRoot, "academic_writer", "paper"), { recursive: true });
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "refs.bib"),
    `@inproceedings{demo2024,\n  title={Demo Paper},\n  author={Unknown},\n  booktitle={CVPR},\n  year={2024}\n}\n`
  );
  await writeFakeResearch30Script(fakeResearch30);
  await writeText(
    fakeResponses,
    `${JSON.stringify(
      {
        "Demo Paper doe": [
          {
            title: "Demo Paper",
            authors: "Doe, Jane and Smith, John",
            abstract: "Demo abstract",
            doi: "10.1000/demo2024",
            url: "https://openalex.org/W123",
            source_name: "CVPR",
            date: "2024-06-18",
            score: 97,
            why_relevant: "Exact title match",
          },
        ],
      },
      null,
      2
    )}\n`
  );
  await writeExecutable(
    path.join(binDir, "reffix"),
    `#!/bin/sh
in="$1"
shift
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    out="$2"
    shift 2
  else
    shift
  fi
done
cat "$in" | sed 's/author={[Uu]nknown}/author={Doe, Jane and Smith, John}/' > "$out"
`
  );
  process.env.PATH = `${binDir}:${previousPath ?? ""}`;
  process.env.OPENCLAW_RESEARCH30_SCRIPT = fakeResearch30;
  process.env.OPENCLAW_RESEARCH30_FAKE_RESPONSES = fakeResponses;

  const result = await executeWorkflowTool(tool, {
    action: "run_citation_calibration",
    projectRoot,
    citationCalibration: {
      bibliography_path: "academic_writer/paper/refs.bib",
    },
  });

  assert.equal(result.suspiciousCount, 0);
  assert.equal(result.hallucinatedCount, 0);
});

test("research_workflow run_citation_calibration returns structured repair evidence when citations remain suspicious", async (t) => {
  const projectRoot = await makeProjectRoot();
  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    agentId: "academic_writer",
    sessionKey: "agent:academic_writer:test",
    pluginConfig: {
      projectsRoot: path.dirname(projectRoot),
    },
  });
  const previousPath = process.env.PATH;
  const previousHome = process.env.HOME;
  const isolatedHome = path.join(projectRoot, "isolated-home");
  t.after(() => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  });
  await fs.mkdir(path.join(projectRoot, "academic_writer", "paper"), { recursive: true });
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "refs.bib"),
    `@inproceedings{demo2024,\n  title={Demo Paper},\n  author={Unknown},\n  booktitle={CVPR},\n  year={2024}\n}\n`
  );
  process.env.PATH = "/usr/bin:/bin";
  process.env.HOME = isolatedHome;

  const result = await executeWorkflowTool(tool, {
    action: "run_citation_calibration",
    citationCalibration: {
      bibliography_path: "academic_writer/paper/refs.bib",
    },
  });

  assert.equal(result.suspiciousCount, 1);
  assert.equal(result.hallucinatedCount, 0);
  assert.equal(result.verification.state.verificationStatus, "needs_revision");
  assert.match(result.report.tool_runs[0].stderr, /not found/i);
});

test("research_workflow reconcile_authoring_closeout self-heals setup-stage conference drafts into a citation-backed submit-ready state", async (t) => {
  const projectRoot = await makeProjectRoot();
  const tool = createResearchWorkflowTool({ workspaceDir: projectRoot });
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.current_stage = "setup";
  manifest.workflow_line = "experiment";
  await writeJson(manifestPath, manifest);

  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    `\\documentclass{article}
\\title{Stable Conference Draft}
\\begin{document}
\\maketitle
\\section{Introduction}
We study generalized category discovery.
\\section{Related Work}
Prior work studies related benchmarks.
\\section{Method}
We introduce a verification gate.
\\section{Experiments}
We evaluate on a synthetic benchmark.
\\section{Results}
The method remains stable.
\\section{Conclusion}
The pipeline can close the loop.
\\bibliographystyle{plain}
\\bibliography{refs}
\\end{document}
`
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "refs.bib"),
    buildReadyReferencesBib()
  );
  await writeText(path.join(projectRoot, "academic_writer", "story", "STORY_SPINE.md"), "# story\n");
  await writeText(
    path.join(projectRoot, "academic_writer", "story", "CROSS_DOMAIN_STORY_BRIDGE.md"),
    "# bridge\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "artifacts", "results", "results.json"),
    "{}\n"
  );

  const result = await executeWorkflowTool(tool, {
    action: "reconcile_authoring_closeout",
    projectRoot,
    authoringCloseout: {
      compile_pdf: true,
    },
  });

  assert.equal(result.paperMode, "conference");
  assert.equal(result.nextStage, "submit");

  const healedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(healedManifest.current_stage, "submit");
  assert.equal(healedManifest.writing_contract.paper_mode, "conference");

  const updatedDraft = await fs.readFile(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    "utf8"
  );
  assert.match(updatedDraft, /\\cite\{[^}]+\}/);
  await fs.access(path.join(projectRoot, "academic_writer", "WRITING_SIGNALS.md"));
  await fs.access(path.join(projectRoot, "reviewer", "REVIEW_ISSUES.json"));
  await fs.access(path.join(projectRoot, "reviewer", "REVIEW_PACKET.json"));
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

test("research_workflow set_paper_ingestion accepts saved requisition reports as validation evidence", async (t) => {
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
  const reportPath =
    "researcher/literature-discovery/requisition/gap/REQUISITION_SATISFACTION_REPORT.md";
  await fs.mkdir(path.join(projectRoot, path.dirname(reportPath)), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(projectRoot, reportPath),
    "# Requisition Satisfaction Report\n\nThe graph already contains the required evidence.\n",
    "utf8"
  );

  const tool = createResearchWorkflowTool({
    workspaceDir: projectRoot,
    sessionKey: "agent:researcher:local:conversation:gcd",
    messageChannel: "local",
  });

  const result = await executeWorkflowTool(tool, {
    action: "set_paper_ingestion",
    paperIngestion: {
      queued_requests: [
        {
          request_id: "gap",
          request_kind: "requisition",
          trigger_kind: "idea_literature_discovery",
          status: "completed",
          validation_report_path: reportPath,
          last_error:
            "workflow-owned literature requisition was marked completed without durable import or requisition-satisfaction evidence; keep graph_build blocked and rerun bounded literature discovery before frontier mapping",
        },
      ],
    },
  });

  const request = result.state.queuedRequests[0];
  assert.equal(request.validationStatus, "valid");
  assert.match(request.validationSummary, /saved requisition report/i);

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(
    manifest.paper_ingestion.queued_requests[0].validation_status,
    "valid"
  );
  assert.equal(manifest.paper_ingestion.queued_requests[0].last_error, null);
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
  assert.match(result.commandText, /^python3 skills\/researcher\/papernexus\/scripts\/pn_graph_query\.py\b/);
  assert.match(result.commandText, /query 'causal abstraction'/);
  assert.equal(result.statusBroadcast.broadcasted, true);
  assert.ok(
    runtimeCalls.some(
      (entry) =>
        entry.deliver === false &&
        /^python3 skills\/researcher\/papernexus\/scripts\/pn_graph_query\.py\b/.test(entry.message) &&
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
      bibliography_page_count: 1,
      all_citations_real: true,
      verified_citation_count: 12,
      suspicious_citation_count: 1,
      hallucinated_citation_count: 0,
      unresolved_placeholder_count: 0,
      last_verified_at: "2026-03-26T09:15:00.000Z",
    },
  });
  assert.equal(citationVerification.state.verificationStatus, "verified");
  assert.equal(citationVerification.state.bibliographyPageCount, 1);
  assert.equal(citationVerification.state.allCitationsReal, true);
  const citationVerificationReport = await fs.readFile(
    path.join(projectRoot, "reviewer", "CITATION_VERIFICATION.md"),
    "utf8"
  );
  assert.match(citationVerificationReport, /Verification Status:\s+verified/i);
  assert.match(citationVerificationReport, /Bibliography Pages:\s+1/i);

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

  const revisionControlSummary = await executeWorkflowTool(tool, {
    action: "get_revision_control_state",
  });
  assert.equal(revisionControlSummary.state.status, "active");
  assert.equal(revisionControlSummary.state.openSources.length >= 2, true);

  const materializedRevisionControl = await executeWorkflowTool(tool, {
    action: "materialize_revision_control_state",
    revisionControlMaterialization: {
      basis_stage: "review",
    },
  });
  assert.equal(materializedRevisionControl.state.status, "active");
  assert.equal(
    materializedRevisionControl.generatedFiles.includes("reviewer/REVISION_CONTROL_PACKET.json"),
    true
  );
  assert.equal(
    materializedRevisionControl.generatedFiles.includes("reviewer/REVISION_CONTROL_PACKET.md"),
    true
  );

  const panelDiscussion = await executeWorkflowTool(tool, {
    action: "materialize_panel_discussion_state",
    panelDiscussionMaterialization: {
      discussionId: "paper-logic-panel",
      topic: "Check whether the revise packet is sufficient for the next review pass",
      stage: "review",
      participants: ["reviewer", "cross-reviewer", "analyzer"],
      maxRounds: 3,
      quorum: 2,
      summary: [
        "focus on paragraph handoffs and argument coherence",
        "verify the revise packet is bounded",
      ],
      context: {
        artifact: "academic_writer/PARAGRAPH_LOGIC_AUDIT.md",
      },
    },
  });
  assert.equal(panelDiscussion.policy.discussionId, "paper-logic-panel");
  assert.equal(panelDiscussion.currentRound.participants.length, 3);
  assert.equal(panelDiscussion.currentRound.maxRounds, 3);
  assert.equal(panelDiscussion.createdRound, true);

  const panelDiscussionStore = await executeWorkflowTool(tool, {
    action: "get_panel_discussion_state",
    panelDiscussionQuery: {
      discussionId: "paper-logic-panel",
    },
  });
  assert.equal(panelDiscussionStore.currentRound.discussionId, "paper-logic-panel");

  const executionProof = await executeWorkflowTool(tool, {
    action: "materialize_execution_proof_state",
  });
  assert.ok(Array.isArray(executionProof.generatedFiles));
  assert.ok(executionProof.generatedFiles.includes("researcher/EXECUTION_PROOF.json"));

  const experimentSearchSummary = await executeWorkflowTool(tool, {
    action: "get_experiment_search",
  });
  assert.equal(experimentSearchSummary.state.bestNodeId, "node-3");
  assert.equal(experimentSearchSummary.stateFileExists, true);

  await writeJson(path.join(projectRoot, "planner", "EXPERIMENT_SEARCH_SPEC.json"), {
    search_session_id: "search-demo",
    comparison_policy: {
      promotion_rule: "beat_incumbent_or_equal_simpler",
      non_promotion_signals: ["gap_reduction", "smoother_curve"],
    },
    baseline_fairness_contract: {
      require_baseline_parity: true,
      locked_dataset_protocol: true,
      locked_metric_protocol: true,
      locked_evaluation_harness: true,
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    schemaVersion: 1,
    projectId: "demo-project",
    updatedAt: "2026-04-12T00:00:00.000Z",
    experiments: [
      {
        experiment_id: "exp-1",
        status: "done",
        decision: "advance",
      },
    ],
    summary: {
      activeExperimentIds: [],
      lastCompletedExperimentId: "exp-1",
      lastFailedExperimentId: null,
      bestKnownConfigRef: "configs/best.yaml",
      lastDecisionSummary: "advance",
      papernexusSyncRequired: false,
      papernexusLastSyncAt: "2026-04-12T00:00:00.000Z",
    },
  });
  await executeWorkflowTool(tool, {
    action: "set_experiment_search",
    experimentSearch: {
      status: "running",
      search_spec_path: "planner/EXPERIMENT_SEARCH_SPEC.json",
      baseline_fairness_status: "ready",
      implementation_confidence: "trusted",
      multi_seed_status: "pending",
      ablation_status: "pending",
      evidence_cleanliness_status: "clean",
      search_exhaustion_status: "active",
      last_decision: "advance",
    },
  });
  const experimentDecision = await executeWorkflowTool(tool, {
    action: "evaluate_experiment_search_decision",
    experimentSearchDecision: {},
  });
  assert.equal(experimentDecision.summary.decision, "require_multi_seed");
  assert.equal(
    experimentDecision.state.validation_stage ??
      experimentDecision.state.validationStage,
    "multi_seed_validation"
  );
  assert.match(
    experimentDecision.summary.recommendedNextAction,
    /multi-seed/i
  );

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
