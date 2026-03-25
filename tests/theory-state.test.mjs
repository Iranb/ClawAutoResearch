import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  getTheoryStateSummary,
  materializeTheoryAppendix,
  recordTheoryState,
  upsertTheoryProofPacket,
} from "../tools/workflow-guard.ts";

async function makeTempProject() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-theory-state-")
  );
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify({ project_id: "demo-project" }, null, 2)}\n`,
    "utf8"
  );
  await fs.mkdir(path.join(projectRoot, "analyzer"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "analyzer", "THEORY_SUPPORT_NOTE.md"),
    "# Theory Support Note\n\nOverall signal: GREEN\n",
    "utf8"
  );
  return projectRoot;
}

test("recordTheoryState writes THEORY_STATE.json and upsertTheoryProofPacket maintains packet registry", async (t) => {
  const projectRoot = await makeTempProject();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const theoryRecord = await recordTheoryState({
    projectRoot,
    theoryState: {
      status: "draft",
      overall_signal: "green",
      body_ready: true,
      theory_state_path: "analyzer/THEORY_STATE.json",
      proof_packet_dir: "analyzer/proof-packets",
      appendix_packet_path: "academic_writer/THEORY_APPENDIX_PLAN.md",
      theoryStateFile: {
        status: "draft",
        overall_signal: "green",
        thesis: "Margin-aware pseudo-labeling admits a monotonic error reduction mechanism.",
        body_guidance: "empirical_mechanistic",
        theorem_candidates: [
          {
            packet_id: "theorem_margin_reduction",
            role: "theorem",
            statement: "Under stable margin estimates, confirmation-bias reduction improves clustering accuracy.",
          },
        ],
        lemma_packets: [],
        appendix_sections: [],
      },
    },
  });

  assert.equal(theoryRecord.state.status, "draft");
  assert.equal(theoryRecord.state.theoremCount, 1);
  assert.ok(theoryRecord.theoryStateResolvedPath);

  const packetResult = await upsertTheoryProofPacket({
    projectRoot,
    proofPacket: {
      packet_id: "lemma_margin_monotonicity",
      role: "lemma",
      title: "Margin monotonicity",
      statement:
        "If confidence sharpening increases inter-class margin, the assignment error upper bound decreases monotonically.",
      body_safe: true,
      confidence: "green",
      appendix_required: true,
      appendix_path: "academic_writer/paper/sections/appendix_theory.tex",
      evidence_pointers: ["Table 1", "CLAIM C1"],
      derivation_outline: [
        "define the sharpened margin quantity",
        "bound assignment error by inverse margin",
        "show monotonic decrease under sharpening",
      ],
      source_claim_ids: ["C1"],
    },
  });

  assert.equal(packetResult.state.proofPacketCount, 2);
  await fs.access(packetResult.packetResolvedPath);

  const summary = await getTheoryStateSummary({ projectRoot });
  assert.equal(summary.state.status, "draft");
  assert.equal(summary.state.overallSignal, "green");
  assert.equal(summary.proofPacketCount, 1);
  assert.equal(summary.theoryFile?.theorem_candidates.length, 1);
  assert.equal(summary.theoryFile?.lemma_packets.length, 1);

  const materialized = await materializeTheoryAppendix({ projectRoot });
  assert.equal(materialized.theoremCount, 1);
  assert.equal(materialized.lemmaCount, 1);
  assert.equal(materialized.appendixSectionCount, 2);

  const appendixPlan = await fs.readFile(materialized.appendixPlanResolvedPath, "utf8");
  assert.match(appendixPlan, /Theory Appendix Plan/);
  assert.match(appendixPlan, /lemma_margin_monotonicity/);

  const appendixDraft = await fs.readFile(
    materialized.appendixSectionResolvedPath,
    "utf8"
  );
  assert.match(appendixDraft, /Additional Theory and Derivation Details/);
  assert.match(appendixDraft, /Margin monotonicity/);
});
