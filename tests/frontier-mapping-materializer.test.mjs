import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { maybePrepareWorkflowStageContracts } from "../tools/workflow-guard-runtime/stage-preflight.ts";
import { auditFrontierReportText } from "../tools/workflow-intermediate-artifact-audit.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
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

async function seedFrontierProject(projectRoot) {
  await Promise.all([
    writeText(
      path.join(projectRoot, "graph", "LIMITATION_FRONTIER.md"),
      "# Limitation Frontier\n- GCD pseudo-labels for novel categories are noisier than known-category labels.\n- FixMatch consistency can regularize unlabeled examples, but threshold quality is the limiting assumption.\n"
    ),
    writeText(
      path.join(projectRoot, "graph", "CONTRADICTION_FRONTIER.md"),
      "# Contradiction Frontier\n- Consistency improves generalization, but over-smoothing may hurt fine-grained novel category separation.\n- Adaptive confidence gating is the proposed resolution path.\n"
    ),
    writeText(
      path.join(projectRoot, "graph", "TRANSFER_FRONTIER.md"),
      "# Transfer Frontier\n- FixMatch weak/strong augmentation consistency transfers directly to GCD unlabeled data.\n- OwMatch-style hierarchical thresholding is a compatible open-world adaptation.\n"
    ),
    writeText(
      path.join(projectRoot, "graph", "COMPOSITION_FRONTIER.md"),
      "# Composition Frontier\n- Combine supervised, consistency, and clustering losses with explicit loss-weight sweeps.\n- Couple pseudo-label filtering with cluster-level confidence calibration.\n"
    ),
    writeText(
      path.join(projectRoot, "graph", "ANCHOR_INDEX.md"),
      "# Anchor Index\n- paper:fixmatch-analysis anchors the consistency generalization mechanism.\n- method:owmatch-thresholding anchors open-world pseudo-label filtering.\n"
    ),
    writeJson(path.join(projectRoot, "researcher", "brainstorm-cycle", "TOPIC_SUMMARY.json"), {
      topic: "Use FixMatch-style consistency regularization to improve GCD",
      summary: "FixMatch consistency and pseudo-labeling are plausible GCD upgrades.",
    }),
    writeJson(path.join(projectRoot, "researcher", "brainstorm-cycle", "RESEARCH_BRIEF.json"), {
      proposed_direction: "Add FixMatch consistency to SimGCD with adaptive novel-class thresholds.",
    }),
    writeJson(path.join(projectRoot, "researcher", "brainstorm-cycle", "BRAINSTORM_BRIEF.json"), {
      ideas: ["Domain-shift-aware consistency", "Hierarchical thresholding"],
    }),
    writeJson(path.join(projectRoot, "researcher", "brainstorm-cycle", "WORKING_MEMORY.json"), {
      next_steps: ["Write FRONTIER_REPORT.md", "Package frontiers"],
    }),
    writeText(
      path.join(projectRoot, "researcher", "brainstorm-cycle", "LOGIC_CHAIN.md"),
      "# Logic Chain\n- FixMatch improves limited-label generalization through consistency.\n- GCD has the same limited-label pressure plus novel-class pseudo-label noise.\n"
    ),
    writeText(
      path.join(projectRoot, "researcher", "brainstorm-cycle", "EVIDENCE_CHAIN.md"),
      "# Evidence Chain\n- FixMatch analysis anchors generalization.\n- OwMatch anchors open-world hierarchical thresholding.\n"
    ),
    writeText(
      path.join(projectRoot, "researcher", "brainstorm-cycle", "REASONING_TRACE.jsonl"),
      "{\"step\":1,\"action\":\"synthesis\",\"verdict\":\"frontier pack ready\"}\n"
    ),
    writeText(
      path.join(projectRoot, "researcher", "brainstorm-cycle", "QUESTION_PACKET.md"),
      "# Question Packet\n- Does consistency improve novel-class accuracy without hurting known-class accuracy?\n"
    ),
    writeText(
      path.join(projectRoot, "researcher", "brainstorm-cycle", "SYNTHESIS_PACKET.md"),
      "# Synthesis Packet\n## Recommended Pilot\nImplement FixMatch consistency on top of SimGCD and ablate threshold strategies.\n"
    ),
  ]);

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "frontier-materializer-demo",
    title: "FixMatch methods for improving GCD",
    current_stage: "frontier_mapping",
    current_micro_stage: "frontier_mapping_requested",
    owner_agent: "researcher",
    brainstorm_cycle: {
      status: "pending",
      topic: "Use FixMatch-style consistency regularization to improve GCD",
      basis_stage: "frontier_mapping",
      provider: "workflow_core_brainstorm",
      provider_mode: "core",
      provider_status: "pending",
      contract_version: 1,
      topic_summary_path: "researcher/brainstorm-cycle/TOPIC_SUMMARY.json",
      research_brief_path: "researcher/brainstorm-cycle/RESEARCH_BRIEF.json",
      brainstorm_brief_path: "researcher/brainstorm-cycle/BRAINSTORM_BRIEF.json",
      working_memory_path: "researcher/brainstorm-cycle/WORKING_MEMORY.json",
      logic_chain_path: "researcher/brainstorm-cycle/LOGIC_CHAIN.md",
      evidence_chain_path: "researcher/brainstorm-cycle/EVIDENCE_CHAIN.md",
      reasoning_trace_path: "researcher/brainstorm-cycle/REASONING_TRACE.jsonl",
      question_packet_path: "researcher/brainstorm-cycle/QUESTION_PACKET.md",
      synthesis_packet_path: "researcher/brainstorm-cycle/SYNTHESIS_PACKET.md",
      rounds: [],
    },
  });
}

test("stage preflight materializes a frontier report and reconciles ready state from durable artifacts", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-frontier-materializer-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await seedFrontierProject(projectRoot);

  const result = await maybePrepareWorkflowStageContracts({
    projectRoot,
    stage: "frontier_mapping",
    deps: makeNoopPreflightDeps(),
  });

  assert.equal(result.materializedContracts.includes("frontier_mapping_state"), true);
  assert.equal(
    result.errors.some((entry) => entry.contract === "frontier_mapping_state"),
    false
  );

  const report = await fs.readFile(
    path.join(projectRoot, "researcher", "FRONTIER_REPORT.md"),
    "utf8"
  );
  assert.equal(auditFrontierReportText(report).ok, true);
  assert.match(report, /FixMatch/i);
  assert.match(report, /GCD/i);
  assert.match(report, /Handoff Implications/i);

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.current_micro_stage, "frontiers_packaged");
  assert.equal(manifest.frontier_report, "researcher/FRONTIER_REPORT.md");
  assert.equal(manifest.brainstorm_cycle.status, "ready");
  assert.equal(manifest.brainstorm_cycle.provider_status, "ready");
  assert.equal(manifest.brainstorm_cycle.rounds.length, 1);
  assert.equal(Boolean(manifest.brainstorm_cycle.selected_round_id), true);
  assert.equal(Boolean(manifest.brainstorm_cycle.selected_option_id), true);
  assert.equal(manifest.graph_reasoning.stop_status, "ready");
});

test("stage preflight repairs a partial frontier pack before reporting ready", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-frontier-materializer-partial-")
  );
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await Promise.all([
    writeText(
      path.join(projectRoot, "graph", "LIMITATION_FRONTIER.md"),
      "# Limitation Frontier\n- Novel-class pseudo-labels are noisy under GCD.\n"
    ),
    writeText(
      path.join(projectRoot, "graph", "CONTRADICTION_FRONTIER.md"),
      "# Contradiction Frontier\n- Strong augmentation can improve robustness but may fragment novel clusters.\n"
    ),
    writeText(
      path.join(projectRoot, "graph", "TRANSFER_FRONTIER.md"),
      "# Transfer Frontier\n- Weak-to-strong FixMatch consistency can be applied to the GCD unlabeled branch.\n"
    ),
    writeJson(path.join(projectRoot, "researcher", "brainstorm-cycle", "TOPIC_SUMMARY.json"), {
      topic: "Improve GCD with FixMatch",
      summary: "Transfer FixMatch consistency into a known/novel discovery setting.",
      anchor_papers: [
        {
          id: "paper:fixmatch",
          title: "FixMatch",
          relevance: "Consistency and thresholded pseudo-labeling source.",
        },
      ],
    }),
    writeJson(path.join(projectRoot, "researcher", "brainstorm-cycle", "RESEARCH_BRIEF.json"), {
      summary: "FixMatch consistency should reduce confirmation bias.",
      key_findings: ["OwMatch supports open-world consistency."],
    }),
    writeJson(path.join(projectRoot, "researcher", "brainstorm-cycle", "BRAINSTORM_BRIEF.json"), {
      directions: [
        {
          title: "Adaptive FixMatch consistency for GCD",
          summary: "Use known/novel threshold calibration.",
        },
      ],
    }),
    writeJson(path.join(projectRoot, "researcher", "brainstorm-cycle", "WORKING_MEMORY.json"), {
      key_facts: ["GCD optimizes known and novel classes jointly."],
      active_hypotheses: ["Known/novel threshold separation improves pseudo-label quality."],
    }),
  ]);

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "partial-frontier-materializer-demo",
    title: "Improve GCD with FixMatch",
    current_stage: "frontier_mapping",
    current_micro_stage: "frontier_mapping_requested",
    owner_agent: "researcher",
    brainstorm_cycle: {
      status: "running",
      topic: "Improve GCD with FixMatch",
      basis_stage: "graph_build",
      provider: "workflow_core_brainstorm",
      provider_mode: "core",
      provider_status: "pending",
      contract_version: 1,
      topic_summary_path: "researcher/brainstorm-cycle/TOPIC_SUMMARY.json",
      research_brief_path: "researcher/brainstorm-cycle/RESEARCH_BRIEF.json",
      brainstorm_brief_path: "researcher/brainstorm-cycle/BRAINSTORM_BRIEF.json",
      working_memory_path: "researcher/brainstorm-cycle/WORKING_MEMORY.json",
      logic_chain_path: "researcher/brainstorm-cycle/LOGIC_CHAIN.md",
      evidence_chain_path: "researcher/brainstorm-cycle/EVIDENCE_CHAIN.md",
      reasoning_trace_path: "researcher/brainstorm-cycle/REASONING_TRACE.jsonl",
      question_packet_path: "researcher/brainstorm-cycle/QUESTION_PACKET.md",
      synthesis_packet_path: "researcher/brainstorm-cycle/SYNTHESIS_PACKET.md",
      rounds: [],
    },
  });

  const result = await maybePrepareWorkflowStageContracts({
    projectRoot,
    stage: "frontier_mapping",
    deps: makeNoopPreflightDeps(),
  });

  assert.equal(result.materializedContracts.includes("frontier_mapping_state"), true);
  for (const rel of [
    "graph/COMPOSITION_FRONTIER.md",
    "graph/ANCHOR_INDEX.md",
    "researcher/brainstorm-cycle/LOGIC_CHAIN.md",
    "researcher/brainstorm-cycle/EVIDENCE_CHAIN.md",
    "researcher/brainstorm-cycle/REASONING_TRACE.jsonl",
    "researcher/brainstorm-cycle/QUESTION_PACKET.md",
    "researcher/brainstorm-cycle/SYNTHESIS_PACKET.md",
    "researcher/FRONTIER_REPORT.md",
  ]) {
    const text = await fs.readFile(path.join(projectRoot, rel), "utf8");
    assert.equal(text.trim().length > 0, true, rel);
  }

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.current_micro_stage, "frontiers_packaged");
  assert.equal(manifest.brainstorm_cycle.status, "ready");
  assert.equal(manifest.graph_reasoning.stop_status, "ready");
});
