import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  collectIdeaStageMissingSignals,
} from "../../tools/workflow-guard-stages/ideation-stage-signals.ts";
import { collectFrontierMappingStageMissingSignals } from "../../tools/workflow-guard-stages/foundation-stage-signals.ts";
import { maybePrepareWorkflowStageContracts } from "../../tools/workflow-guard-runtime/stage-preflight.ts";
import {
  isNonEmptyDirectory,
  pathExists,
} from "../../tools/workflow-guard-core/fs.ts";
import {
  resolveProjectArtifactPath,
  resolveTrackArtifactPath,
} from "../../tools/workflow-guard-core/paths.ts";
import { asString } from "../../tools/workflow-guard-core/coercion.ts";
import {
  loadTrackInnovationEvidence,
  trackHasGraphBackedInnovationEvidence,
} from "../../tools/workflow-guard-track-evidence.ts";

async function makeTempProject() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-idea-track-evidence-")
  );
  await fs.mkdir(path.join(projectRoot, "researcher"), { recursive: true });
  return projectRoot;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath, text = "ok\n") {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
}

async function fileHasNonWhitespaceContent(targetPath) {
  if (!targetPath) {
    return false;
  }
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    return raw.trim().length > 0;
  } catch {
    return false;
  }
}

async function fileHasMeaningfulJsonContent(targetPath) {
  if (!targetPath) {
    return false;
  }
  try {
    const raw = JSON.parse(await fs.readFile(targetPath, "utf8"));
    return raw && typeof raw === "object" && Object.keys(raw).length > 0;
  } catch {
    return false;
  }
}

async function seedIdeaTrackWithFileBackedEvidence(projectRoot) {
  const trackId = "track-file-backed";
  const reasoningPacketDir = `researcher/reasoning/${trackId}`;
  const workingMemoryPath = `${reasoningPacketDir}/working-memory.md`;
  const synthesisPacketPath = `${reasoningPacketDir}/synthesis.md`;

  await writeText(path.join(projectRoot, "researcher", "IDEA_REPORT.md"));
  await writeText(path.join(projectRoot, "researcher", "IDEA_AUDIT.md"));
  await writeText(path.join(projectRoot, workingMemoryPath), "# working memory\n");
  await writeText(path.join(projectRoot, synthesisPacketPath), "# synthesis\n");
  await writeText(path.join(projectRoot, reasoningPacketDir, "packet.md"), "# packet\n");
  await writeJson(
    path.join(projectRoot, reasoningPacketDir, "GRAPH_EVIDENCE.json"),
    {
      evidence_pointers: [
        `${reasoningPacketDir}/GRAPH_EVIDENCE.json#paper:file-backed`,
      ],
      linked_graph_nodes: ["paper:file-backed", "finding:track-story-support"],
      relation_patterns: ["supports->claim:track-story-support"],
    }
  );
  await writeJson(path.join(projectRoot, "TRACK_REGISTRY.json"), {
    tracks: [
      {
        track_id: trackId,
        status: "active",
        evidence_pointers: [],
        linked_graph_nodes: [],
        relation_patterns: [],
        reasoning_packet_dir: reasoningPacketDir,
        working_memory_path: workingMemoryPath,
        synthesis_packet_path: synthesisPacketPath,
      },
    ],
  });

  return {
    trackId,
    reasoningPacketDir,
    workingMemoryPath,
    synthesisPacketPath,
  };
}

function makeIdeaStageDeps() {
  return {
    pathExists,
    fileHasNonWhitespaceContent,
    fileHasMeaningfulJsonContent,
    isNonEmptyDirectory,
    resolveProjectArtifactPath,
    resolveTrackArtifactPath,
    normalizeIdeaCatalystState: () => ({}),
    getIdeaCatalystValidationErrors: () => [],
    normalizeIdeationContractState: () => ({}),
    getIdeationContractValidationErrors: () => [],
    normalizeInnovationReflectionState: () => ({}),
    isInnovationReflectionDue: () => false,
    getActiveTracks: (trackRegistry) =>
      Array.isArray(trackRegistry?.tracks) ? trackRegistry.tracks : [],
    asString,
    trackHasGraphBackedInnovationEvidence,
    loadTrackInnovationEvidence,
    getBrainstormCycleMissingSignals: async () => [],
    normalizeResearchProgramState: () => ({}),
    getResearchProgramValidationErrors: () => [],
    getResearchProgramPlanValidationErrors: () => [],
    normalizeOrchestrationState: () => ({}),
    getOrchestrationStateValidationErrors: () => [],
    getCodeStageBundleMissingSignals: async () => [],
  };
}

async function seedReadyIdeationArtifacts(projectRoot) {
  const ideationArtifacts = {
    graph_ideation_packet_path: "researcher/ideation/GRAPH_IDEATION_PACKET.json",
    idea_tree_path: "researcher/ideation/IDEA_TREE.md",
    novelty_tree_path: "researcher/ideation/NOVELTY_TREE.md",
    challenge_insight_tree_path: "researcher/ideation/CHALLENGE_INSIGHT_TREE.md",
    solution_check_path: "researcher/ideation/SOLUTION_CHECK.md",
    cross_domain_transfer_path: "researcher/ideation/CROSS_DOMAIN_TRANSFER.md",
    problem_decomposition_path: "researcher/ideation/PROBLEM_DECOMPOSITION.md",
    candidate_pool_path: "researcher/ideation/CANDIDATE_POOL.json",
    ranking_history_path: "researcher/ideation/RANKING_HISTORY.json",
    tournament_scoreboard_path: "researcher/ideation/TOURNAMENT_SCOREBOARD.json",
    top3_summary_path: "researcher/ideation/TOP3_DIRECTION_SUMMARY.md",
    research_proposal_path: "researcher/ideation/RESEARCH_PROPOSAL.md",
  };

  await writeJson(
    path.join(projectRoot, ideationArtifacts.graph_ideation_packet_path),
    { status: "ready" }
  );
  await writeText(path.join(projectRoot, ideationArtifacts.idea_tree_path));
  await writeText(path.join(projectRoot, ideationArtifacts.novelty_tree_path));
  await writeText(path.join(projectRoot, ideationArtifacts.challenge_insight_tree_path));
  await writeText(path.join(projectRoot, ideationArtifacts.solution_check_path));
  await writeText(path.join(projectRoot, ideationArtifacts.cross_domain_transfer_path));
  await writeText(path.join(projectRoot, ideationArtifacts.problem_decomposition_path));
  await writeJson(path.join(projectRoot, ideationArtifacts.candidate_pool_path), {
    candidates: [{ id: "dir-1" }],
  });
  await writeJson(path.join(projectRoot, ideationArtifacts.ranking_history_path), {
    rounds: [],
  });
  await writeJson(
    path.join(projectRoot, ideationArtifacts.tournament_scoreboard_path),
    { status: "completed", selected_direction_id: "dir-1" }
  );
  await writeText(path.join(projectRoot, ideationArtifacts.top3_summary_path));
  await writeText(path.join(projectRoot, ideationArtifacts.research_proposal_path));

  return ideationArtifacts;
}

test("collectIdeaStageMissingSignals accepts file-backed GRAPH_EVIDENCE.json for active tracks", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const seeded = await seedIdeaTrackWithFileBackedEvidence(projectRoot);
  const trackRegistry = JSON.parse(
    await fs.readFile(path.join(projectRoot, "TRACK_REGISTRY.json"), "utf8")
  );

  const missing = await collectIdeaStageMissingSignals(
    {
      projectRoot,
      manifest: {
        current_stage: "idea",
        ideation_contract: {},
        innovation_reflection: { status: "fresh" },
      },
      trackRegistry,
      experimentLedger: null,
    },
    makeIdeaStageDeps()
  );

  assert.doesNotMatch(
    missing.join("\n"),
    new RegExp(`${seeded.trackId} missing graph-backed innovation evidence`, "i")
  );
});

test("stage signals reject hollow frontier and idea markdown stubs", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeText(path.join(projectRoot, "researcher", "FRONTIER_REPORT.md"), "# Frontier\n");
  await writeText(path.join(projectRoot, "researcher", "IDEA_REPORT.md"), "# Idea Report\n");
  await writeText(path.join(projectRoot, "researcher", "IDEA_AUDIT.md"), "# Idea Audit\n");
  await fs.mkdir(path.join(projectRoot, "graph"), { recursive: true });
  for (const file of [
    "LIMITATION_FRONTIER.md",
    "CONTRADICTION_FRONTIER.md",
    "TRANSFER_FRONTIER.md",
    "COMPOSITION_FRONTIER.md",
    "ANCHOR_INDEX.md",
  ]) {
    await writeText(path.join(projectRoot, "graph", file), "# graph\n");
  }

  const frontierMissing = await collectFrontierMappingStageMissingSignals(
    {
      projectRoot,
      manifest: {
        current_stage: "frontier_mapping",
        current_micro_stage: "frontiers_packaged",
      },
      trackRegistry: null,
      experimentLedger: null,
    },
    {
      pathExists,
      isNonEmptyDirectory,
      fileHasMeaningfulJsonContent,
      manifestFieldExists: () => true,
      getExperimentLedgerPath: () => path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"),
      pickString: () => null,
      normalizeResearchProgramState: () => ({}),
      getResearchProgramOnboardingGaps: () => [],
      asRecord: (value) => (value && typeof value === "object" ? value : null),
      normalizeGraphPresenceStatus: () => "ready",
      normalizePaperIngestionState: () => ({}),
      hasActiveWorkflowOwnedPaperUpload: () => false,
      summarizeGraphPresenceMissing: () => null,
      getBrainstormCycleMissingSignals: async () => [],
      normalizeStage: (value) => (typeof value === "string" ? value : null),
    }
  );
  assert.ok(frontierMissing.some((signal) => /FRONTIER_REPORT\.md/i.test(signal)));

  const missing = await collectIdeaStageMissingSignals(
    {
      projectRoot,
      manifest: {
        current_stage: "idea",
        ideation_contract: {},
        innovation_reflection: { status: "fresh" },
      },
      trackRegistry: { tracks: [] },
      experimentLedger: null,
    },
    makeIdeaStageDeps()
  );

  assert.ok(missing.some((signal) => /IDEA_REPORT\.md/i.test(signal)));
  assert.ok(missing.some((signal) => /IDEA_AUDIT\.md/i.test(signal)));
});

test("maybePrepareWorkflowStageContracts rematerializes ideation when file-backed track evidence still needs canonicalization", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const { trackId } = await seedIdeaTrackWithFileBackedEvidence(projectRoot);
  const ideationArtifacts = await seedReadyIdeationArtifacts(projectRoot);
  const materializeCalls = [];

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    current_stage: "idea",
    research_program: {
      status: "approved",
      tracks: [
        {
          track_id: trackId,
          status: "active",
        },
      ],
    },
    ideation_contract: {
      status: "ready",
      ...ideationArtifacts,
    },
  });

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  const result = await maybePrepareWorkflowStageContracts({
    projectRoot,
    manifest,
    stage: "idea",
    deps: {
      materializeIdeationContract: async (params) => {
        materializeCalls.push(params);
      },
      materializePaperStoryState: async () => {},
      materializeReviewPressurePacket: async () => {},
      materializeExperimentReviewState: async () => {},
      materializeIdeaCatalystState: async () => {},
      materializeLiteratureDiscoveryPacket: async () => {},
      queueIdeaCatalystRequisition: async () => {},
      queueLiteratureDiscoveryRequisition: async () => {},
    },
  });

  assert.equal(materializeCalls.length, 1);
  assert.equal(result.materializedContracts.includes("ideation_contract"), true);
});
