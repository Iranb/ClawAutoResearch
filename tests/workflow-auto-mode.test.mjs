import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkflowAutoModeRiskFingerprint,
  evaluateWorkflowAutoModeRisk,
} from "../tools/workflow-auto-mode.ts";

test("auto-mode risk fingerprint stays stable while idea outputs are materialized", () => {
  const first = evaluateWorkflowAutoModeRisk({
    configuredMode: "aggressive",
    stage: "idea",
    manifest: {
      innovation_reflection: {
        status: "missing",
      },
    },
    missingStageSignals: [
      "{PROJ}/researcher/IDEA_REPORT.md",
      "{PROJ}/researcher/IDEA_AUDIT.md",
      "PROJECT_MANIFEST.json.ideation_contract.status = ready|reconciled|approved (current: missing)",
      "PROJECT_MANIFEST.json.ideation_contract.long_term_goal is required",
      "{PROJ}/researcher/ideation/NOVELTY_TREE.md",
      "{PROJ}/researcher/ideation/CANDIDATE_POOL.json",
      "{PROJ}/researcher/idea-catalyst/GATE_DECISION.json",
      "TRACK_REGISTRY.json with 1-2 active tracks",
    ],
  });
  const second = evaluateWorkflowAutoModeRisk({
    configuredMode: "aggressive",
    stage: "idea",
    manifest: {
      innovation_reflection: {
        status: "missing",
      },
    },
    missingStageSignals: [
      "{PROJ}/researcher/IDEA_AUDIT.md",
      "PROJECT_MANIFEST.json.ideation_contract.status = ready|reconciled|approved (current: missing)",
      "{PROJ}/researcher/idea-catalyst/GATE_DECISION.json",
      "TRACK_REGISTRY.json with 1-2 active tracks",
    ],
  });

  assert.equal(first.riskLevel, "caution");
  assert.equal(second.riskLevel, "caution");
  assert.equal(first.reasons.includes("Innovation reflection is missing."), true);
  assert.equal(first.riskFingerprint, second.riskFingerprint);
});

test("auto-mode risk fingerprint keeps distinct hard-risk categories", () => {
  const graphFingerprint = buildWorkflowAutoModeRiskFingerprint({
    stage: "graph_build",
    riskLevel: "severe",
    reasons: ["Graph-related stage signals are missing."],
    missingStageSignals: [
      "PROJECT_MANIFEST.json.paper_ingestion.graph_presence_status = ready (current: missing)",
    ],
  });
  const citationFingerprint = buildWorkflowAutoModeRiskFingerprint({
    stage: "write",
    riskLevel: "severe",
    reasons: ["Citation integrity stage signals are missing."],
    missingStageSignals: ["PROJECT_MANIFEST.json.citation_integrity.verification_status = verified"],
  });

  assert.ok(graphFingerprint);
  assert.ok(citationFingerprint);
  assert.notEqual(graphFingerprint, citationFingerprint);
});
