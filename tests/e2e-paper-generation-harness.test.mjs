import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function write(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

test("E2E paper generation harness materializes report, scorecard, checklist, and timeline", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-e2e-harness-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await write(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "e2e-demo",
        current_stage: "submit",
        owner_agent: "academic_writer",
        writing_contract: { paper_mode: "survey" },
      },
      null,
      2
    )}\n`
  );
  for (const artifact of [
    "researcher/SURVEY_QUERY_REGISTRY.json",
    "researcher/INCLUDED_PAPERS.json",
    "researcher/EXCLUDED_PAPERS.json",
    "researcher/LITERATURE_REVIEW.md",
    "researcher/SOTA_MATRIX.md",
    "researcher/GAP_SYNTHESIS.md",
    "researcher/COVERAGE_SUMMARY.md",
    "researcher/SURVEY_BRIEF.md",
    "researcher/ideation/CROSS_DOMAIN_BRIDGE_EVIDENCE.json",
    "researcher/ideation/NEURO_COGNITIVE_CONCEPT_MAP.md",
    "researcher/ideation/CROSS_DOMAIN_RECONTEXTUALIZATION.md",
    "academic_writer/PAPER_PLAN.md",
    "academic_writer/story/STORY_SPINE.md",
    "academic_writer/story/CROSS_DOMAIN_STORY_BRIDGE.md",
    "academic_writer/WRITING_SIGNALS.md",
    "academic_writer/PAPER_QC.md",
    "academic_writer/paper/main.tex",
    "academic_writer/paper/main.pdf",
    "academic_writer/paper/refs.bib",
    "reviewer/CITATION_VERIFICATION.md",
    "reviewer/REVIEW_PACKET.json",
    "reviewer/REVIEW_ISSUES.json",
  ]) {
    const targetPath = path.join(projectRoot, artifact);
    if (artifact.endsWith("main.tex")) {
      await write(
        targetPath,
        "\\documentclass{article}\n\\begin{document}\n\\section{Introduction}\nSee prior work \\cite{demo}.\n\\bibliographystyle{plain}\n\\bibliography{refs}\n\\end{document}\n"
      );
    } else if (artifact.endsWith("refs.bib")) {
      await write(
        targetPath,
        "@article{demo,\n  title={Demo},\n  author={Tester, T.},\n  journal={Test Journal},\n  year={2026}\n}\n"
      );
    } else if (artifact.endsWith("CITATION_VERIFICATION.md")) {
      await write(
        targetPath,
        "# Citation Verification\n\n- suspicious: 0\n- hallucinated: 0\n"
      );
    } else if (artifact.endsWith("REVIEW_ISSUES.json")) {
      await write(
        targetPath,
        JSON.stringify({ issues: [], open_counts: { critical: 0, high: 0, medium: 0, low: 0 } }, null, 2) + "\n"
      );
    } else if (artifact.endsWith(".json")) {
      await write(targetPath, "{}\n");
    } else {
      await write(targetPath, "# ok\n");
    }
  }
  await write(
    path.join(projectRoot, ".openclaw-research", "workflow-runtime-incidents.json"),
    `${JSON.stringify(
      {
        entries: [
          {
            kind: "lobster_fallback",
            severity: "warning",
            status: "open",
            summary: "Optional runtime backend fell back to native dispatch.",
          },
        ],
      },
      null,
      2
    )}\n`
  );
  await write(
    path.join(projectRoot, "graph", "PAPERNEXUS_TASK_CERTIFICATION.json"),
    `${JSON.stringify(
      {
        schema_version: 1,
        status: "partial",
        claim_level: "remote_corpus_summary",
        source_backed_graph_claim: false,
        graph: {
          status: "ready",
          verification_mode: "remote_corpus_summary",
        },
        mcp_contract: {
          evidence_mode: "remote_api",
        },
        limitations: ["remote_corpus_summary_without_per_paper_source_spans"],
      },
      null,
      2
    )}\n`
  );
  await write(
    path.join(projectRoot, "researcher", "BENCHMARK_ADAPTER_FIXTURE.json"),
    `${JSON.stringify(
      {
        adapter: "mle-bench-fixture",
        benchmark_id: "gcd-local-fixture",
        metric: "h_score",
        baseline_score: 0.42,
        candidate_score: 0.51,
        holdout_score: 0.48,
        iterations: 3,
        wall_time_seconds: 12.5,
        cost_usd: 0,
        evidence_paths: ["researcher/artifacts/results/results.json"],
      },
      null,
      2
    )}\n`
  );

  const { stdout } = await execFileAsync(process.execPath, [
    "scripts/run-e2e-paper-generation.mjs",
    "--project-root",
    projectRoot,
    "--lane",
    "survey",
  ]);
  const result = JSON.parse(stdout);
  assert.equal(result.finalVerdict, "pass");
  assert.equal(result.runtimeSafety.openIncidents, 1);
  assert.equal(result.runtimeSafety.blockingOpenIncidents, 0);
  assert.match(result.scorecardPath, /E2E_RUN_SCORECARD\.json$/);
  assert.match(result.progressNarrativePath, /E2E_PROGRESS_NARRATIVE\.md$/);
  assert.match(result.progressChartPath, /progress_chart\.json$/);
  assert.match(result.progressChartHtmlPath, /progress_chart\.html$/);
  assert.match(result.runLedgerPath, /E2E_RUN_LEDGER\.jsonl$/);
  assert.match(result.dashboardPath, /E2E_DASHBOARD\.html$/);
  assert.match(result.benchmarkAdapterScorecardPath, /E2E_BENCHMARK_ADAPTER_SCORECARD\.json$/);
  assert.match(result.domainEvaluatorContractPath, /E2E_DOMAIN_EVALUATOR_CONTRACT\.json$/);
  assert.match(result.platformProfilePath, /PLATFORM_PROFILE\.json$/);
  assert.equal(
    await fs.readFile(path.join(projectRoot, ".openclaw-research", "E2E_RUN_REPORT.md"), "utf8").then((text) => /final_verdict: pass/.test(text)),
    true
  );
  const scorecard = JSON.parse(
    await fs.readFile(path.join(projectRoot, ".openclaw-research", "E2E_RUN_SCORECARD.json"), "utf8")
  );
  assert.equal(scorecard.verdict.final_verdict, "pass");
  assert.equal(scorecard.verdict.claim_strength_cap, "artifact_complete_content_unscored");
  assert.equal(typeof scorecard.quality_score.score_100, "number");
  assert.equal(scorecard.minimal_scorecard.reproducibility_pass, true);
  assert.equal(scorecard.minimal_scorecard.baseline_score, 0.42);
  assert.equal(scorecard.minimal_scorecard.holdout_score, 0.48);
  assert.equal(scorecard.papernexus_certification.status, "partial");
  assert.equal(scorecard.papernexus_certification.claim_level, "remote_corpus_summary");
  assert.equal(
    scorecard.papernexus_certification.source_backed_graph_claim,
    false
  );
  assert.equal(scorecard.benchmark_adapter.status, "pass");
  assert.equal(scorecard.benchmark_adapter.adapter, "mle-bench-fixture");
  assert.equal(scorecard.benchmark_adapter.guardrail.raw_benchmark_score_can_bypass_claim_gate, false);
  assert.equal(scorecard.domain_evaluator.pack, "systematic_review");
  assert.equal(typeof scorecard.platform_profile.runtime.platform, "string");
  assert.match(
    await fs.readFile(path.join(projectRoot, ".openclaw-research", "E2E_PROGRESS_NARRATIVE.md"), "utf8"),
    /quality_score_100:/
  );
  const progressChart = JSON.parse(
    await fs.readFile(path.join(projectRoot, ".openclaw-research", "progress_chart.json"), "utf8")
  );
  assert.equal(progressChart.verdict.final_verdict, "pass");
  assert.equal(progressChart.quality_components.some((entry) => entry.name === "artifact_coverage"), true);
  assert.equal(progressChart.summary.papernexus_certification_status, "partial");
  assert.equal(progressChart.summary.benchmark_adapter_status, "pass");
  assert.equal(progressChart.summary.domain_evaluator_pack, "systematic_review");
  assert.match(progressChart.linked_artifacts.run_ledger_path, /E2E_RUN_LEDGER\.jsonl$/);
  assert.match(progressChart.linked_artifacts.dashboard_path, /E2E_DASHBOARD\.html$/);
  assert.equal(
    progressChart.annotations.some(
      (entry) => entry.kind === "papernexus_certification"
    ),
    true
  );
  assert.equal(
    progressChart.annotations.some((entry) => entry.kind === "benchmark_adapter"),
    true
  );
  assert.equal(progressChart.timeline_points.at(-1).kind, "final_verdict");
  assert.match(
    await fs.readFile(path.join(projectRoot, ".openclaw-research", "progress_chart.html"), "utf8"),
    /<title>E2E Progress Chart<\/title>/
  );
  assert.match(
    await fs.readFile(path.join(projectRoot, ".openclaw-research", "E2E_DASHBOARD.html"), "utf8"),
    /<title>OpenClaw No-Discord E2E Dashboard<\/title>/
  );
  const runLedgerLines = (
    await fs.readFile(path.join(projectRoot, ".openclaw-research", "E2E_RUN_LEDGER.jsonl"), "utf8")
  )
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  assert.equal(runLedgerLines.length, 1);
  assert.equal(JSON.parse(runLedgerLines[0]).verdict.final_verdict, "pass");
  const checklist = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, ".openclaw-research", "E2E_ARTIFACT_CHECKLIST.json"),
      "utf8"
    )
  );
  assert.equal(checklist.final_verdict, "pass");
  assert.equal(checklist.claim_strength_cap, "artifact_complete_content_unscored");
  const benchmarkAdapter = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, ".openclaw-research", "E2E_BENCHMARK_ADAPTER_SCORECARD.json"),
      "utf8"
    )
  );
  const domainEvaluator = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, ".openclaw-research", "E2E_DOMAIN_EVALUATOR_CONTRACT.json"),
      "utf8"
    )
  );
  const platformProfile = JSON.parse(
    await fs.readFile(path.join(projectRoot, ".openclaw-research", "PLATFORM_PROFILE.json"), "utf8")
  );
  assert.equal(benchmarkAdapter.benchmark_id, "gcd-local-fixture");
  assert.equal(domainEvaluator.pack, "systematic_review");
  assert.equal(platformProfile.capability_matrix.cpu.status, "available");
});
