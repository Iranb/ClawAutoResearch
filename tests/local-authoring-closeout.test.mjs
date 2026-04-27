import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import { reconcileAuthoringCloseout } from "../tools/authoring-closeout-reconcile.ts";
import { runWorkflowAutoIterator } from "../tools/workflow-guard.ts";

const execFile = promisify(execFileCb);
process.env.OPENCLAW_CITATION_TOOL_TIMEOUT_SECONDS = "2";

async function writeText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function seedWriteReadyProject() {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-local-authoring-"));
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "local-authoring",
    current_stage: "write",
    owner_agent: "academic_writer",
    workflow_line: "experiment",
    topic: "Use FixMatch generalization ideas to improve generalized category discovery",
    writing_contract: {
      paper_mode: "conference",
      kg_storyline_required: true,
      kg_storyline_status: "pending",
      kg_storyline_packet_path: "academic_writer/KG_STORYLINE_PACKET.md",
      proof_appendix_required: true,
      proof_appendix_path: "academic_writer/paper/sections/appendix_theory.tex",
      required_sections: [
        "abstract",
        "introduction",
        "related_work",
        "method",
        "experiments",
        "results",
        "discussion",
        "limitations",
        "conclusion",
      ],
      section_order: [
        "abstract",
        "introduction",
        "related_work",
        "method",
        "experiments",
        "results",
        "discussion",
        "limitations",
        "conclusion",
      ],
    },
    paper_story_state: {
      status: "ready",
      claim_support_status: "supported",
      supported_claim_count: 3,
      partial_claim_count: 0,
      unsupported_claim_count: 0,
      claim_evidence_matrix_path: "analyzer/CLAIM_EVIDENCE_MATRIX.md",
      narrative_report_path: "analyzer/NARRATIVE_REPORT.md",
      track_verdicts_path: "analyzer/TRACK_VERDICTS.md",
      unsupported_claims_path: "analyzer/UNSUPPORTED_CLAIMS.md",
      story_spine_path: "academic_writer/story/STORY_SPINE.md",
    },
    write_package: {
      status: "ready",
      assembly_status: "ready",
      winning_track_ids: ["track-main"],
      claim_evidence_matrix_path: "analyzer/CLAIM_EVIDENCE_MATRIX.md",
      narrative_report_path: "analyzer/NARRATIVE_REPORT.md",
      track_verdicts_path: "analyzer/TRACK_VERDICTS.md",
      unsupported_claims_path: "analyzer/UNSUPPORTED_CLAIMS.md",
      baseline_summary_path: "researcher/baseline_summary.json",
      research_summary_path: "researcher/research_summary.json",
      ablation_summary_path: "researcher/ablation_summary.json",
      evaluation_summary_path: "researcher/evaluation_summary.json",
      figure_pack_path: "academic_writer/FIGURE_PACK.json",
      table_pack_path: "academic_writer/TABLE_PACK.json",
      proof_packet_dir: "analyzer/proof-packets",
      citation_candidates_path: "academic_writer/CITATION_CANDIDATES.json",
    },
    results_storyline: { status: "ready", last_updated_at: "2026-04-27T00:00:00.000Z" },
    innovation_synthesis_state: { status: "ready", last_updated_at: "2026-04-27T00:00:00.000Z" },
    title_abstract_intro_workbench: {
      status: "ready",
      last_updated_at: "2026-04-27T00:00:00.000Z",
    },
    paragraph_logic_audit: { status: "ready" },
  });
  await writeText(
    path.join(projectRoot, "analyzer", "CLAIM_EVIDENCE_MATRIX.md"),
    "# Claim Evidence Matrix\n\n| Claim | Verdict | Evidence |\n| --- | --- | --- |\n| C1 | supported | researcher/evaluation_summary.json |\n"
  );
  await writeText(path.join(projectRoot, "analyzer", "NARRATIVE_REPORT.md"), "# Narrative\n");
  await writeText(path.join(projectRoot, "analyzer", "TRACK_VERDICTS.md"), "# Verdicts\n");
  await writeText(path.join(projectRoot, "analyzer", "UNSUPPORTED_CLAIMS.md"), "# Unsupported Claims\n\nStatus: clear.\n");
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "sections", "appendix_theory.tex"),
    "\\section{Theory Appendix}\nThe appendix records the scoped consistency-filtering mechanism.\n"
  );
  await writeJson(path.join(projectRoot, "researcher", "artifacts", "results", "exp-1", "RESULT_SUMMARY.json"), {
    baseline: { known_accuracy: 1, novel_accuracy: 0, h_score: 0 },
    proposed: { known_accuracy: 0.8778, novel_accuracy: 0.2111, h_score: 0.3404 },
    ablations: {
      minus_class_balance_debiasing: { h_score: 0.2801 },
      minus_consistency_filtering: { h_score: 0.3404 },
    },
    metrics: {
      h_score: 0.3404,
      known_accuracy: 0.8778,
      novel_accuracy: 0.2111,
      baseline_h_score: 0,
      delta_h_score: 0.3404,
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "evaluation_summary.json"), {
    metrics: {
      h_score: 0.3404,
      known_accuracy: 0.8778,
      novel_accuracy: 0.2111,
      baseline_h_score: 0,
      delta_h_score: 0.3404,
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "ablation_summary.json"), {
    status: "ready",
  });
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    experiments: [{ experiment_id: "exp-1", status: "completed" }],
  });
  for (const artifact of [
    "researcher/IDEA_REPORT.md",
    "researcher/IDEA_AUDIT.md",
    "orchestrator/PLAN.md",
    "orchestrator/TODOS.md",
    "orchestrator/PLAN_AUDIT.md",
    "coder/EXPERIMENT_INDEX.md",
  ]) {
    await writeText(path.join(projectRoot, artifact), "# ready\n");
  }
  return projectRoot;
}

test("authoring closeout synthesizes a substantive no-Discord conference draft", async (t) => {
  const projectRoot = await seedWriteReadyProject();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const closeout = await reconcileAuthoringCloseout({
    projectRoot,
    compilePdf: true,
    currentStageOverride: "write",
  });

  assert.equal(closeout.nextStage, "submit");
  assert.equal(closeout.citationIntegrity.verificationStatus, "verified");
  assert.ok(closeout.generatedFiles.includes("academic_writer/paper/main.tex"));
  assert.ok(closeout.generatedFiles.includes("academic_writer/KG_STORYLINE_PACKET.md"));

  const mainTex = await fs.readFile(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    "utf8"
  );
  assert.match(mainTex, /\\section\{Method\}/);
  assert.match(mainTex, /FixMatch-inspired consistency filter/);

  const { stdout } = await execFile(process.execPath, [
    "scripts/run-e2e-paper-generation.mjs",
    "--project-root",
    projectRoot,
    "--lane",
    "experiment",
    "--strict-content",
  ]);
  const harness = JSON.parse(stdout);
  assert.equal(harness.contentQuality.status, "pass");
});

test("auto iterator runs authoring closeout during write preflight", async (t) => {
  const projectRoot = await seedWriteReadyProject();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const result = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
    policy: {
      autoMode: "aggressive",
      autoGate: { enabled: false },
    },
  });

  assert.equal(result.stageBefore, "write");
  assert.ok(
    result.materializedArtifacts.some((artifact) => artifact.contract === "authoring_closeout")
  );
  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.writing_session.status, "ready_for_submit");
  assert.equal(manifest.citation_integrity.verification_status, "verified");
  assert.equal(manifest.writing_contract.kg_storyline_status, "ready");
});

test("authoring closeout prepares local submit review artifacts without Discord", async (t) => {
  const projectRoot = await seedWriteReadyProject();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await reconcileAuthoringCloseout({
    projectRoot,
    compilePdf: true,
    currentStageOverride: "submit",
  });

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.external_review_state.status, "received");
  assert.equal(manifest.external_review_state.required_action, "human_decision");
  assert.ok(
    await fs.stat(path.join(projectRoot, "reviewer", "SIMULATED_EXTERNAL_REVIEW.md"))
  );
  assert.ok(
    await fs.stat(path.join(projectRoot, manifest.external_review_state.review_response_path))
  );
  assert.ok(await fs.stat(path.join(projectRoot, "cross-reviewer", "LOCAL_SUBMIT_REVIEW.md")));
});
