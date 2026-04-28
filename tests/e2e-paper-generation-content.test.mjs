import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

async function writeText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test("strict E2E paper gate rejects shallow placeholder content", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-e2e-content-"));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "content-gate",
    current_stage: "review",
    owner_agent: "reviewer",
    writing_contract: {
      paper_mode: "conference",
    },
  });
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\section{Introduction}",
      "TODO placeholder smoke paper \\cite{demo}.",
      "\\section{Results}",
      "A short result mentions baseline accuracy.",
      "\\bibliographystyle{plain}",
      "\\bibliography{refs}",
      "\\end{document}",
      "",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "refs.bib"),
    "@article{demo,title={Demo},author={A},year={2026}}\n"
  );

  const { stdout } = await execFile(process.execPath, [
    path.join(process.cwd(), "scripts", "run-e2e-paper-generation.mjs"),
    "--project-root",
    projectRoot,
    "--lane",
    "experiment",
    "--strict-content",
  ]);
  const payload = JSON.parse(stdout);

  assert.equal(payload.strictContent, true);
  assert.equal(payload.finalVerdict, "fail");
  assert.equal(payload.contentQuality.status, "fail");
  assert.equal(payload.claimStrengthCap, "blocked");
  assert.match(payload.progressChartPath, /progress_chart\.json$/);
  assert.match(payload.copyeditStyleAuditPath, /E2E_COPYEDIT_STYLE_AUDIT\.json$/);
  const scorecard = JSON.parse(await fs.readFile(payload.scorecardPath, "utf8"));
  const progressChart = JSON.parse(await fs.readFile(payload.progressChartPath, "utf8"));
  const copyeditStyleAudit = JSON.parse(await fs.readFile(payload.copyeditStyleAuditPath, "utf8"));
  assert.equal(scorecard.verdict.final_verdict, "fail");
  assert.equal(scorecard.verdict.claim_strength_cap, "blocked");
  assert.equal(scorecard.copyedit_style_audit.status, "partial");
  assert.equal(copyeditStyleAudit.checks.some((entry) => entry.name === "no_placeholder_language" && entry.ok === false), true);
  assert.equal(progressChart.summary.failed_required_check_count > 0, true);
  assert.equal(
    scorecard.failed_required_checks.some((entry) => entry.group === "content_substance"),
    true
  );
  assert.equal(
    payload.contentQuality.checks.some(
      (entry) => entry.name === "no_placeholder_language" && entry.ok === false
    ),
    true
  );
  assert.equal(
    payload.contentQuality.checks.some(
      (entry) => entry.name === "paper_word_count_min" && entry.ok === false
    ),
    true
  );
});

test("strict E2E paper gate rejects shallow source coverage and figure placeholders", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-e2e-paper-quality-"));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "paper-quality-gate",
    current_stage: "review",
    owner_agent: "reviewer",
    writing_contract: { paper_mode: "conference" },
  });
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: Array.from({ length: 12 }, (_, index) => ({
      canonical_id: `doi:10.0000/example.${index}`,
      title: `Generalized Category Discovery Source ${index}`,
      year: 2024,
      doi: `10.0000/example.${index}`,
    })),
  });
  await writeJson(path.join(projectRoot, "researcher", "artifacts", "results", "results.json"), {
    baseline: { known_accuracy: 1, novel_accuracy: 0, h_score: 0 },
    proposed: { known_accuracy: 1, novel_accuracy: 0, h_score: 0 },
    ablations: {
      minus_class_balance_debiasing: { h_score: 0 },
      minus_consistency_filtering: { h_score: 0 },
    },
    metrics: { h_score: 0, known_accuracy: 1, novel_accuracy: 0, delta_h_score: 0 },
  });
  await writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
    experiments: [{ experiment_id: "exp-1", status: "completed" }],
  });
  const longParagraph = Array.from(
    { length: 460 },
    () => "This substantive sentence describes generalized category discovery evidence and result boundaries."
  ).join(" ");
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    [
      "\\documentclass{article}",
      "\\usepackage{booktabs}",
      "\\begin{document}",
      "\\section{Introduction}",
      `${longParagraph} \\cite{k1,k2,k3,k4,k5,k6}.`,
      "\\section{Related Work}",
      longParagraph,
      "\\section{Method}",
      longParagraph,
      "\\section{Experiments}",
      longParagraph,
      "\\section{Results}",
      "\\begin{figure}[t]\\centering\\fbox{placeholder figure}\\caption{Placeholder}\\label{fig:placeholder}\\end{figure}",
      "Baseline & 0.0000 & 1.0000 & 0.0000 & 0.0000 \\\\",
      longParagraph,
      "\\section{Discussion}",
      longParagraph,
      "\\bibliographystyle{plain}",
      "\\bibliography{refs}",
      "\\end{document}",
      "",
    ].join("\n")
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "refs.bib"),
    Array.from(
      { length: 6 },
      (_, index) => `@article{k${index + 1},title={Paper ${index + 1}},author={A},year={2024}}\n`
    ).join("\n")
  );

  const { stdout } = await execFile(process.execPath, [
    path.join(process.cwd(), "scripts", "run-e2e-paper-generation.mjs"),
    "--project-root",
    projectRoot,
    "--lane",
    "experiment",
    "--strict-content",
  ]);
  const payload = JSON.parse(stdout);

  assert.equal(payload.contentQuality.status, "fail");
  assert.equal(payload.scorecard.verdict.claim_strength_cap, "blocked");
  assert.equal(
    payload.contentQuality.checks.some(
      (entry) => entry.name === "source_index_bibliography_coverage_min" && entry.ok === false
    ),
    true
  );
  assert.equal(
    payload.contentQuality.checks.some(
      (entry) => entry.name === "no_fbox_figure_placeholders" && entry.ok === false
    ),
    true
  );
});
