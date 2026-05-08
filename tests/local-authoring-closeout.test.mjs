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
    activation: {
      accepted_pseudo_labels: { 0: 12, 1: 12, 2: 12, 3: 0, 4: 0, 5: 0 },
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
  const auxiliaryGcdSources = Array.from({ length: 24 }, (_unused, index) => ({
    canonical_id: `doi:10.5555/openclaw.gcd.${index + 1}`,
    title: `GCD Reference ${index + 1} for Generalized Category Discovery`,
    year: 2020 + (index % 6),
    doi: `10.5555/openclaw.gcd.${index + 1}`,
    venue: index % 2 === 0 ? "CVPR" : "ICLR",
  }));
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      { canonical_id: "arxiv:2410.11206", title: "Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning", year: 2024, best_oa_url: "https://arxiv.org/abs/2410.11206" },
      { canonical_id: "arxiv:2001.07685", title: "FixMatch: Simplifying Semi-Supervised Learning with Consistency and Confidence", year: 2020, best_oa_url: "https://arxiv.org/abs/2001.07685" },
      { canonical_id: "doi:10.1109/cvpr52688.2022.00734", title: "Generalized Category Discovery", year: 2022, doi: "10.1109/cvpr52688.2022.00734", venue: "CVPR" },
      { canonical_id: "doi:10.1109/cvpr52729.2023.00732", title: "Dynamic Conceptional Contrastive Learning for Generalized Category Discovery", year: 2023, doi: "10.1109/cvpr52729.2023.00732", venue: "CVPR" },
      { canonical_id: "doi:10.1109/iccv51070.2023.01521", title: "Parametric Classification for Generalized Category Discovery: A Baseline Study", year: 2023, doi: "10.1109/iccv51070.2023.01521", venue: "ICCV" },
      { canonical_id: "doi:10.1109/iccv51070.2023.01753", title: "Incremental Generalized Category Discovery", year: 2023, doi: "10.1109/iccv51070.2023.01753", venue: "ICCV" },
      { canonical_id: "doi:10.24963/ijcai.2024/587", title: "Towards Debiased Generalized Category Discovery", year: 2024, doi: "10.24963/ijcai.2024/587", venue: "IJCAI" },
      { canonical_id: "doi:10.1016/j.neunet.2024.106908", title: "Prototypical classifier with distribution consistency regularization for generalized category discovery", year: 2024, doi: "10.1016/j.neunet.2024.106908", venue: "Neural Networks" },
      { canonical_id: "doi:10.1016/j.inffus.2024.102547", title: "Prediction consistency regularization for generalized category discovery", year: 2024, doi: "10.1016/j.inffus.2024.102547", venue: "Information Fusion" },
      { canonical_id: "doi:10.1007/978-981-99-8073-4_41", title: "Generalized Category Discovery with Clustering Assignment Consistency", year: 2024, doi: "10.1007/978-981-99-8073-4_41", venue: "PRCV" },
      { canonical_id: "doi:10.1007/s11263-026-02745-y", title: "Memory Consistency Guided Divide-and-Conquer Learning for Generalized Category Discovery", year: 2026, doi: "10.1007/s11263-026-02745-y", venue: "IJCV" },
      { canonical_id: "arxiv:2510.18740", title: "SEAL: Semantic-Aware Hierarchical Learning for Generalized Category Discovery", year: 2025, best_oa_url: "https://arxiv.org/abs/2510.18740" },
      ...auxiliaryGcdSources,
    ],
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
  assert.equal(closeout.citationIntegrity.minimumCitationCount, 30);
  assert.ok(closeout.citationIntegrity.bibliographyEntryCount >= 30);
  assert.ok(closeout.bibliographyCount >= 30);
  assert.ok(closeout.generatedFiles.includes("academic_writer/paper/main.tex"));
  assert.ok(closeout.generatedFiles.includes("academic_writer/KG_STORYLINE_PACKET.md"));

  const reviewPacket = JSON.parse(
    await fs.readFile(path.join(projectRoot, "reviewer", "REVIEW_PACKET.json"), "utf8")
  );
  assert.equal(reviewPacket.status, "completed");
  assert.equal(reviewPacket.verdict, "ready");
  assert.ok(reviewPacket.action_items.length > 0);
  assert.equal(reviewPacket.review_report_freshness, "fresh");
  assert.ok(closeout.generatedFiles.includes("reviewer/REVIEW_REPORT.md"));
  assert.ok(await fs.stat(path.join(projectRoot, "reviewer", "REVIEW_REPORT.md")));
  assert.ok(await fs.stat(path.join(projectRoot, "reviewer", "SURFACE_REVIEW.json")));

  const mainTex = await fs.readFile(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    "utf8"
  );
  assert.match(mainTex, /\\section\{Method\}/);
  assert.match(mainTex, /FixMatch-inspired consistency filter/);
  assert.match(mainTex, /source index for this project covers/i);
  assert.doesNotMatch(mainTex, /\\fbox/);
  const citationKeys = new Set([...mainTex.matchAll(/\\cite[ptba]?\*?(?:\[[^\]]*\])?\{([^}]*)\}/g)].flatMap((match) => match[1].split(",").map((key) => key.trim()).filter(Boolean)));
  assert.ok(citationKeys.size >= 10);
  const refsBib = await fs.readFile(
    path.join(projectRoot, "academic_writer", "paper", "refs.bib"),
    "utf8"
  );
  assert.ok((refsBib.match(/@\w+\s*\{/g) ?? []).length >= 30);
  const figurePack = JSON.parse(
    await fs.readFile(path.join(projectRoot, "academic_writer", "FIGURE_PACK.json"), "utf8")
  );
  const tablePack = JSON.parse(
    await fs.readFile(path.join(projectRoot, "academic_writer", "TABLE_PACK.json"), "utf8")
  );
  assert.ok(figurePack.entries.some((entry) => entry.metric_values?.accepted_pseudo_labels));
  assert.ok(tablePack.entries.some((entry) => entry.metric_values?.proposed?.h_score === 0.3404));

  const paragraphAudit = JSON.parse(
    await fs.readFile(path.join(projectRoot, "academic_writer", "PARAGRAPH_LOGIC_AUDIT.json"), "utf8")
  );
  assert.equal(paragraphAudit.status, "ready");
  assert.equal(paragraphAudit.blocking_issue_count, 0);

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

test("authoring closeout writes neutral result language when H-score delta is zero", async (t) => {
  const projectRoot = await seedWriteReadyProject();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const neutralResult = {
    baseline: { known_accuracy: 1, novel_accuracy: 0, h_score: 0 },
    proposed: { known_accuracy: 1, novel_accuracy: 0, h_score: 0 },
    ablations: {
      minus_class_balance_debiasing: { known_accuracy: 1, novel_accuracy: 0, h_score: 0 },
      minus_consistency_filtering: { known_accuracy: 1, novel_accuracy: 0, h_score: 0 },
    },
    metrics: {
      h_score: 0,
      known_accuracy: 1,
      novel_accuracy: 0,
      baseline_h_score: 0,
      delta_h_score: 0,
    },
    activation: {
      accepted_pseudo_labels: { 0: 12, 1: 12, 2: 12, 3: 0, 4: 0, 5: 0 },
    },
  };
  await writeJson(
    path.join(projectRoot, "researcher", "artifacts", "results", "exp-1", "RESULT_SUMMARY.json"),
    neutralResult
  );
  await writeJson(path.join(projectRoot, "researcher", "evaluation_summary.json"), neutralResult);

  await reconcileAuthoringCloseout({
    projectRoot,
    compilePdf: false,
    currentStageOverride: "write",
  });

  const mainTex = await fs.readFile(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    "utf8"
  );
  assert.match(mainTex, /does not support an empirical improvement claim/i);
  assert.match(mainTex, /not an improvement/i);
  assert.match(mainTex, /Minus class-balance debiasing & 0\.0000/);
  assert.doesNotMatch(mainTex, /This improvement is useful/i);
  assert.doesNotMatch(mainTex, /improves the local reference H-score/i);
  assert.doesNotMatch(mainTex, /H-score gain/i);
  assert.doesNotMatch(mainTex, /0\.2801/);
});

test("authoring closeout repairs paragraph audit blockers from the audit artifact", async (t) => {
  const projectRoot = await seedWriteReadyProject();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const repeat = (sentence, count) => Array.from({ length: count }, () => sentence).join(" ");
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\title{Consistency Filters for Generalized Category Discovery}",
      "\\maketitle",
      "\\begin{abstract}",
      repeat(
        "Generalized category discovery needs a bounded evidence contract for known and novel classes.",
        12
      ),
      "\\end{abstract}",
      "\\section{Introduction}",
      repeat(
        "Generalized category discovery remains hard because pseudo-label noise distorts class boundaries and motivates a FixMatch-style consistency filter for unlabeled candidates.",
        35
      ),
      "",
      repeat(
        "Rack temperature alarms and fan failures require maintenance coordination in large datacenters.",
        35
      ),
      "\\section{Related Work}",
      repeat(
        "Consistency regularization and generalized category discovery literature frame pseudo-label noise as an evidence-control problem for known and novel classes.",
        45
      ),
      "\\section{Method}",
      repeat(
        "The method applies weak and strong augmentation agreement before class-balance debiasing decides whether an unlabeled candidate enters the training pool.",
        45
      ),
      "\\section{Experiments}",
      repeat(
        "The experiment reports known accuracy, novel accuracy, H-score, and ablations for the local reference benchmark.",
        45
      ),
      "\\section{Results}",
      repeat(
        "The results keep the claim bounded to the local reference benchmark and avoid external leaderboard claims.",
        45
      ),
      "\\section{Discussion}",
      repeat(
        "The discussion interprets the consistency filter as a control layer rather than a complete generalized category discovery solution.",
        45
      ),
      "\\section{Limitations}",
      repeat(
        "The evidence remains local and external benchmark suites must replace this reference run before broad claims are made.",
        45
      ),
      "\\section{Conclusion}",
      repeat(
        "The paper closes with a bounded claim about FixMatch-style filtering for generalized category discovery.",
        45
      ),
      "\\bibliographystyle{plain}",
      "\\bibliography{refs}",
      "\\end{document}",
      "",
    ].join("\n")
  );

  const closeout = await reconcileAuthoringCloseout({
    projectRoot,
    compilePdf: false,
    currentStageOverride: "write",
  });

  const paragraphAudit = JSON.parse(
    await fs.readFile(path.join(projectRoot, "academic_writer", "PARAGRAPH_LOGIC_AUDIT.json"), "utf8")
  );
  assert.equal(paragraphAudit.status, "ready");
  assert.equal(paragraphAudit.blocking_issue_count, 0);
  assert.ok(closeout.generatedFiles.includes("academic_writer/PARAGRAPH_LOGIC_AUDIT.json"));

  const mainTex = await fs.readFile(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    "utf8"
  );
  assert.match(mainTex, /Against this background, the source index for this project covers/i);
  assert.doesNotMatch(mainTex, /Rack temperature alarms/);
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

test("authoring closeout refreshes stale local no-Discord review reports", async (t) => {
  const projectRoot = await seedWriteReadyProject();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const reviewReportPath = path.join(projectRoot, "reviewer", "REVIEW_REPORT.md");
  await writeText(
    reviewReportPath,
    [
      "# Review Report",
      "",
      "Review Mode: local_no_discord_closeout",
      "Score: 5/10",
      "Verdict: needs_revision",
      "",
      "## Action Items",
      "1. Repair blocking paragraph logic audit findings.",
      "",
    ].join("\n")
  );
  await fs.utimes(reviewReportPath, new Date("2026-04-27T00:00:00Z"), new Date("2026-04-27T00:00:00Z"));

  await reconcileAuthoringCloseout({
    projectRoot,
    compilePdf: true,
    currentStageOverride: "write",
  });

  const reviewPacket = JSON.parse(
    await fs.readFile(path.join(projectRoot, "reviewer", "REVIEW_PACKET.json"), "utf8")
  );
  assert.equal(reviewPacket.status, "completed");
  assert.equal(reviewPacket.verdict, "ready");
  assert.equal(reviewPacket.review_report_verdict, "ready");

  const refreshedReport = await fs.readFile(reviewReportPath, "utf8");
  assert.match(refreshedReport, /Verdict: ready/);
});

test("authoring closeout preserves stale negative reviewer actions as a writer revision", async (t) => {
  const projectRoot = await seedWriteReadyProject();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const reviewReportPath = path.join(projectRoot, "reviewer", "REVIEW_REPORT.md");
  await writeText(
    reviewReportPath,
    [
      "# Review Report",
      "",
      "## Review Summary",
      "",
      "- **Score**: 3/10",
      "- **Verdict**: not_ready",
      "",
      "## Action Items",
      "1. **Execute real experiments**: Report non-zero H-score values.",
      "2. **Write section prose**: Replace placeholder manuscript text.",
      "",
    ].join("\n")
  );
  await fs.utimes(reviewReportPath, new Date("2026-04-27T00:00:00Z"), new Date("2026-04-27T00:00:00Z"));

  const closeout = await reconcileAuthoringCloseout({
    projectRoot,
    compilePdf: false,
    currentStageOverride: "review",
  });

  assert.equal(closeout.nextStage, "write");
  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.current_stage, "write");
  assert.equal(manifest.owner_agent, "academic_writer");
  assert.equal(manifest.review_session.status, "needs_revision");
  assert.match(manifest.review_session.pending_reason, /reviewer-requested revisions/i);

  const reviewPacket = JSON.parse(
    await fs.readFile(path.join(projectRoot, "reviewer", "REVIEW_PACKET.json"), "utf8")
  );
  assert.equal(reviewPacket.review_report_freshness, "stale");
  assert.equal(reviewPacket.review_report_verdict, "needs_revision");
  assert.match(reviewPacket.action_items.join("\n"), /Execute real experiments/i);
  assert.ok(reviewPacket.blocking_artifacts.includes("reviewer/REVIEW_REPORT.md"));
  assert.ok(
    reviewPacket.issue_ids.includes("review-report-requests-revision")
  );
});
