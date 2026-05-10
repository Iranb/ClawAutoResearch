import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPluginRegistrationContext } from "../../../tools/plugin-registration-shared.ts";
import { registerWorkflowTools } from "../../../tools/register-workflow-tools.ts";
import { materializeInnovationSynthesis } from "../../../tools/research-writing/innovation-synthesis.ts";
import { maybePrepareWorkflowStageContracts } from "../../../tools/workflow-guard-runtime/stage-preflight.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(targetPath, value = "# stub\n") {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

async function readManifest(projectRoot) {
  return JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
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

function makeNoopPreflightDeps() {
  return {
    materializeIdeationContract: async () => ({}),
    materializePaperStoryState: async () => ({}),
    materializeReviewPressurePacket: async () => ({}),
    materializeExperimentReviewState: async () => ({}),
    materializeSurveyReviewState: async () => ({}),
    materializeIdeaCatalystState: async () => ({}),
    materializeLiteratureDiscoveryPacket: async () => ({}),
    materializePapernexusPacketContracts: async () => ({}),
    queueIdeaCatalystRequisition: async () => ({}),
    queueLiteratureDiscoveryRequisition: async () => ({}),
  };
}

async function makeInnovationProjectRoot() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-innovation-synthesis-")
  );
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "demo-project",
    current_stage: "review",
    owner_agent: "academic_writer",
    workflow_line: "experiment",
    research_program: {
      status: "approved",
      goal: "Improve graph-grounded narrative support precision.",
      problem_statement: "Validated innovations still read like disconnected deltas.",
      plan_selection: {
        selected_track_id: "track-main",
      },
      tracks: [
        {
          track_id: "track-main",
          status: "active",
          hypothesis:
            "Graph-grounded routing keeps support precision stable under broader manuscript scope.",
          novelty_basis:
            "Innovation A: route evidence with graph-grounded support signals.",
          required_baselines: ["baseline-router"],
        },
      ],
    },
    write_package: {
      status: "ready",
      winning_track_ids: ["track-main"],
      evaluation_summary_path: "analyzer/EVALUATION_SUMMARY.md",
      ablation_summary_path: "analyzer/ABLATION_SUMMARY.md",
    },
    paper_story_state: {
      status: "ready",
      story_spine_path: "academic_writer/story/STORY_SPINE.md",
      challenge_statement_path: "academic_writer/story/CHALLENGE_STATEMENT.md",
      contribution_map_path: "academic_writer/story/CONTRIBUTION_MAP.md",
      claim_to_experiment_map_path: "academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md",
      contribution_to_story_bridge_path: "academic_writer/CONTRIBUTION_TO_STORY_BRIDGE.md",
      claim_evidence_matrix_path: "analyzer/CLAIM_EVIDENCE_MATRIX.md",
      unsupported_claims_path: "analyzer/UNSUPPORTED_CLAIMS.md",
    },
  });

  await Promise.all([
    writeText(
      path.join(projectRoot, "academic_writer", "story", "STORY_SPINE.md"),
      "# Story Spine\nGraph-grounded support precision remains fragile when the manuscript expands.\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "story", "CHALLENGE_STATEMENT.md"),
      "# Challenge\nValidated gains are still narrated as disconnected wins.\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "story", "CONTRIBUTION_MAP.md"),
      "# Contribution Map\nInnovation A\nInnovation B\nInnovation C\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "story", "CLAIM_TO_EXPERIMENT_MAP.md"),
      "# Claim Map\nclaim-1 -> exp-a\nclaim-2 -> exp-a\n"
    ),
    writeText(
      path.join(projectRoot, "analyzer", "CLAIM_EVIDENCE_MATRIX.md"),
      "# Claim Evidence Matrix\nclaim-1 backed by exp-a\n"
    ),
    writeText(
      path.join(projectRoot, "analyzer", "UNSUPPORTED_CLAIMS.md"),
      "# Unsupported Claims\nInnovation C still lacks bridge evidence.\n"
    ),
    writeText(
      path.join(projectRoot, "analyzer", "EVALUATION_SUMMARY.md"),
      "# Evaluation Summary\nBaseline and main results recorded.\n"
    ),
    writeText(
      path.join(projectRoot, "analyzer", "ABLATION_SUMMARY.md"),
      "# Ablation Summary\nAblation gaps remain under integration stress.\n"
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "paper", "main.tex"),
      "\\input{sections/introduction}\n\\input{sections/results}\n"
    ),
    writeJson(
      path.join(
        projectRoot,
        "coder",
        "experiments",
        "track-main",
        "exp-a",
        "EXPERIMENT_MANIFEST.json"
      ),
      {
        experiment_id: "exp-a",
        innovation_points: [
          "Innovation B: preserve support precision under narrative expansion.",
          "Innovation C: bound unsupported drift during manuscript integration.",
        ],
      }
    ),
  ]);

  return projectRoot;
}

test("materializeInnovationSynthesis maps unresolved story gaps onto workflow-owned literature discovery", async (t) => {
  const projectRoot = await makeInnovationProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await materializeInnovationSynthesis({
    projectRoot,
    stage: "review",
  });

  assert.equal(result.state.status, "needs_search");
  assert.equal(result.storyGapSearch?.status, "queued");
  assert.ok(result.generatedFiles.includes("academic_writer/INNOVATION_SYNTHESIS_MEMO.md"));
  assert.ok(
    result.generatedFiles.includes(
      "researcher/story-gap-search/STORY_GAP_SEARCH_REQUISITION.json"
    )
  );

  const packet = JSON.parse(
    await fs.readFile(
      path.join(
        projectRoot,
        "researcher",
        "story-gap-search",
        "STORY_GAP_SEARCH_REQUISITION.json"
      ),
      "utf8"
    )
  );
  assert.equal(packet.discovery_reason, "innovation_synthesis_gap");
  assert.equal(packet.trigger_kind, "story_gap_literature_discovery");
  assert.deepEqual(packet.target_domains, ["Psychology", "Biology"]);
  assert.ok(packet.target_questions.every((entry) => entry.minimum_sources >= 2));
  assert.ok(
    packet.target_questions.every((entry) =>
      entry.candidate_source_domains.includes("Psychology")
    )
  );
  assert.ok(
    packet.target_questions.every((entry) =>
      entry.candidate_source_domains.includes("Computer Science")
    )
  );

  const manifest = await readManifest(projectRoot);
  assert.equal(manifest.story_gap_search_requisition.status, "queued");
  assert.equal(
    manifest.story_gap_search_requisition.maps_to_literature_discovery_request_id.startsWith(
      "story-gap-"
    ),
    true
  );
  assert.equal(
    manifest.story_gap_search_requisition.required_stage_reentry.includes("graph_build"),
    true
  );
  assert.equal(manifest.paper_ingestion.queued_requests.length, 1);
  assert.equal(
    manifest.paper_ingestion.queued_requests[0].trigger_kind,
    "story_gap_literature_discovery"
  );
});

test("materializeInnovationSynthesis saturates repeated unresolved gaps instead of requeueing forever", async (t) => {
  const projectRoot = await makeInnovationProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const first = await materializeInnovationSynthesis({
    projectRoot,
    stage: "review",
  });
  assert.equal(first.storyGapSearch?.status, "queued");

  const manifest = await readManifest(projectRoot);
  manifest.story_gap_search_requisition.status = "completed";
  manifest.story_gap_search_requisition.same_gap_cycles_used = 1;
  manifest.paper_ingestion.queued_requests[0].status = "completed";
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);

  const second = await materializeInnovationSynthesis({
    projectRoot,
    stage: "review",
  });

  assert.equal(second.storyGapSearch?.status, "saturated");
  assert.equal(second.storyGapSearch?.sameGapCyclesUsed, 2);
  assert.equal(second.state.status, "needs_revision");

  const saturatedManifest = await readManifest(projectRoot);
  assert.equal(saturatedManifest.story_gap_search_requisition.status, "saturated");
  assert.equal(saturatedManifest.story_gap_search_requisition.same_gap_cycles_used, 2);
  assert.equal(saturatedManifest.paper_ingestion.queued_requests.length, 1);
});

test("maybePrepareWorkflowStageContracts materializes innovation synthesis during late writing stages", async (t) => {
  const projectRoot = await makeInnovationProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const manifest = await readManifest(projectRoot);
  const result = await maybePrepareWorkflowStageContracts({
    projectRoot,
    manifest,
    stage: "review",
    deps: makeNoopPreflightDeps(),
  });

  assert.equal(result.materializedContracts.includes("innovation_synthesis_state"), true);

  const updatedManifest = await readManifest(projectRoot);
  assert.notEqual(updatedManifest.innovation_synthesis_state.status, "missing");
  assert.equal(
    typeof updatedManifest.innovation_synthesis_state.synthesis_fingerprint,
    "string"
  );
});

test("research_workflow exposes innovation synthesis and story-gap search summaries", async (t) => {
  const projectRoot = await makeInnovationProjectRoot();
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
  });
  const materialized = await executeWorkflowTool(tool, {
    action: "materialize_innovation_synthesis_state",
    innovationSynthesisMaterialization: {
      basis_stage: "review",
    },
  });
  assert.equal(materialized.state.status, "needs_search");

  const synthesisSummary = await executeWorkflowTool(tool, {
    action: "get_innovation_synthesis_state",
  });
  assert.equal(synthesisSummary.state.status, "needs_search");
  assert.equal(synthesisSummary.synthesisMemoExists, true);
  assert.equal(synthesisSummary.graphExists, true);
  assert.equal(synthesisSummary.statementExists, true);

  const searchSummary = await executeWorkflowTool(tool, {
    action: "get_story_gap_search_requisition",
  });
  assert.equal(searchSummary.state.status, "queued");
  assert.equal(searchSummary.packetExists, true);
});
