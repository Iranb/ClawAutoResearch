import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  loadTrackInnovationEvidence,
  resolveTrackInnovationEvidence,
} from "../tools/workflow-derived-state/track-evidence.ts";
import { resolveStageReadiness } from "../tools/workflow-derived-state/stage-readiness.ts";
import { resolveHandoffEligibility } from "../tools/workflow-derived-state/handoff-eligibility.ts";
import { buildDerivedStateDiagnostics } from "../tools/workflow-derived-state/diagnostics.ts";

async function makeTempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), "openclaw-derived-state-"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("resolveTrackInnovationEvidence keeps inline-only graph evidence story-facing", () => {
  const evidence = resolveTrackInnovationEvidence({
    evidence_pointers: ["graph/frontier.md#support"],
    linked_graph_nodes: ["paper:router"],
    relation_patterns: ["supports->claim:novelty"],
  });

  assert.equal(evidence.presence, "inline_only");
  assert.equal(evidence.importedFromGraphEvidence, false);
  assert.equal(evidence.hasGraphBackedInnovationEvidence, true);
  assert.equal(evidence.hasStoryFacingTrackGraphSupport, true);
  assert.equal(evidence.repairable.repairable, false);
  assert.ok(
    evidence.diagnostics.some((entry) => entry.code === "graph_evidence.inline_only")
  );
});

test("loadTrackInnovationEvidence imports file-backed evidence and accepts graph_innovation_evidence alias", async () => {
  const projectRoot = await makeTempProject();
  try {
    await writeJson(
      path.join(projectRoot, "researcher", "reasoning", "track-main", "GRAPH_EVIDENCE.json"),
      {
        graph_innovation_evidence: {
          evidence_pointers: [
            "researcher/reasoning/track-main/GRAPH_EVIDENCE.json#paper:router",
          ],
          linked_graph_nodes: ["paper:router"],
          relation_patterns: ["supports->claim:novelty"],
        },
      }
    );

    const evidence = await loadTrackInnovationEvidence({
      projectRoot,
      track: {
        reasoning_packet_dir: "researcher/reasoning/track-main",
      },
    });

    assert.equal(evidence.presence, "file_backed");
    assert.equal(evidence.importedFromGraphEvidence, true);
    assert.equal(evidence.graphEvidencePath, "researcher/reasoning/track-main/GRAPH_EVIDENCE.json");
    assert.deepEqual(evidence.linkedGraphNodes, ["paper:router"]);
    assert.deepEqual(evidence.relationPatterns, ["supports->claim:novelty"]);
    assert.ok(
      evidence.evidencePointers.includes(
        "researcher/reasoning/track-main/GRAPH_EVIDENCE.json#paper:router"
      )
    );
    assert.equal(evidence.repairable.repairable, true);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("loadTrackInnovationEvidence marks empty artifact payloads as repairable and diagnostic", async () => {
  const projectRoot = await makeTempProject();
  try {
    await writeJson(
      path.join(projectRoot, "researcher", "reasoning", "track-main", "GRAPH_EVIDENCE.json"),
      {}
    );

    const evidence = await loadTrackInnovationEvidence({
      projectRoot,
      track: {
        reasoning_packet_dir: "researcher/reasoning/track-main",
      },
    });

    assert.equal(evidence.presence, "invalid");
    assert.equal(evidence.hasGraphBackedInnovationEvidence, false);
    assert.equal(evidence.repairable.repairable, true);
    assert.ok(
      evidence.diagnostics.some((entry) => entry.code === "graph_evidence.empty_payload")
    );
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("resolveStageReadiness separates blocking and repairable signals", () => {
  const readiness = resolveStageReadiness({
    stage: "idea",
    trackEvidence: {
      presence: "invalid",
      evidencePointers: [],
      linkedGraphNodes: [],
      relationPatterns: [],
      hasGraphBackedInnovationEvidence: false,
      hasStructuralGraphEvidence: false,
      hasStoryFacingTrackGraphSupport: false,
      graphEvidencePath: "researcher/reasoning/track-main/GRAPH_EVIDENCE.json",
      importedFromGraphEvidence: false,
      diagnostics: [],
      repairable: {
        repairable: true,
        repairableSignals: ["graph_evidence.empty_payload"],
        suggestedOwner: "workflow",
        suggestedAction: "materialize_graph_evidence",
      },
    },
  });

  assert.equal(readiness.readyForOwnerWork, false);
  assert.deepEqual(readiness.repairableSignals, ["graph_evidence.empty_payload"]);
  assert.equal(readiness.blockingSignals.length, 0);
  assert.equal(readiness.handoffMode, "repair_artifact");
  assert.equal(readiness.suggestedOwner, "workflow");
});

test("resolveStageReadiness treats mixed inline-plus-file graph evidence as ready", () => {
  const readiness = resolveStageReadiness({
    stage: "idea",
    trackEvidence: {
      presence: "mixed",
      evidencePointers: ["researcher/reasoning/track-main/GRAPH_EVIDENCE.json#paper:router"],
      linkedGraphNodes: ["paper:router", "finding:support-gap"],
      relationPatterns: ["supports->claim:novelty"],
      hasGraphBackedInnovationEvidence: true,
      hasStructuralGraphEvidence: true,
      hasStoryFacingTrackGraphSupport: true,
      graphEvidencePath: "researcher/reasoning/track-main/GRAPH_EVIDENCE.json",
      importedFromGraphEvidence: true,
      diagnostics: [],
      repairable: {
        repairable: true,
        repairableSignals: ["graph_evidence.materialization_pending"],
        suggestedOwner: "workflow",
        suggestedAction: "materialize_graph_evidence",
      },
    },
  });

  assert.equal(readiness.readyForOwnerWork, true);
  assert.deepEqual(readiness.repairableSignals, []);
  assert.equal(readiness.handoffMode, "drive_stage");
  assert.equal(readiness.suggestedOwner, "owner");
});

test("resolveHandoffEligibility keeps drive_stage out when blocking signals remain", () => {
  const handoff = resolveHandoffEligibility({
    readyForOwnerWork: false,
    hardBlock: true,
    blockingSignals: [
      {
        code: "graph_evidence.invalid_payload",
        message: "Graph evidence artifact is not yet usable.",
        repairable: false,
      },
    ],
    repairableSignals: [],
    backgroundOpportunities: ["continue background research"],
    suggestedOwner: "workflow",
    handoffMode: "background",
    diagnostics: ["Graph evidence artifact is not yet usable."],
  });

  assert.equal(handoff.canHandoff, false);
  assert.equal(handoff.recommendedAction, "background");
  assert.equal(handoff.blockingSignals[0].code, "graph_evidence.invalid_payload");
});

test("buildDerivedStateDiagnostics surfaces repairable metadata", () => {
  const summary = buildDerivedStateDiagnostics({
    title: "Track graph evidence",
    diagnostics: [
      {
        code: "graph_evidence.empty_payload",
        severity: "warning",
        message: "Graph evidence is present but empty.",
        repairable: true,
      },
    ],
    blockingSignals: [],
    repairableSignals: ["graph_evidence.empty_payload"],
    backgroundOpportunities: [],
    repairable: true,
  });

  assert.equal(summary.repairable, true);
  assert.deepEqual(summary.repairableSignals, ["graph_evidence.empty_payload"]);
  assert.equal(summary.diagnostics[0].code, "graph_evidence.empty_payload");
});
