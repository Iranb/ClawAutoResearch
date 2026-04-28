import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import { buildE2EProjectsDashboard } from "../scripts/build-e2e-project-dashboard.mjs";

const execFile = promisify(execFileCb);

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeProjectScorecard(projectsRoot, projectId, scorecard, trend = null) {
  const projectRoot = path.join(projectsRoot, projectId);
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: projectId,
    current_stage: scorecard.project.current_stage,
    owner_agent: scorecard.project.owner_agent,
  });
  await writeJson(
    path.join(projectRoot, ".openclaw-research", "E2E_RUN_SCORECARD.json"),
    scorecard
  );
  await fs.writeFile(
    path.join(projectRoot, ".openclaw-research", "E2E_DASHBOARD.html"),
    "<!doctype html><title>project dashboard</title>",
    "utf8"
  );
  if (trend) {
    await writeJson(path.join(projectRoot, ".openclaw-research", "E2E_RUN_TRENDS.json"), trend);
  }
  return projectRoot;
}

function scorecardFixture(overrides) {
  const project = overrides.project ?? {};
  const verdict = overrides.verdict ?? {};
  return {
    schema_version: 1,
    generated_at: overrides.generated_at ?? "2026-04-28T00:00:00.000Z",
    project: {
      project_id: project.project_id,
      project_root: project.project_root,
      lane: project.lane ?? "experiment",
      current_stage: project.current_stage ?? "write",
      owner_agent: project.owner_agent ?? "academic_writer",
    },
    verdict: {
      final_verdict: verdict.final_verdict ?? "pass",
      claim_strength_cap: verdict.claim_strength_cap ?? "artifact_complete_content_scored",
    },
    quality_score: {
      score_100: overrides.quality_score_100 ?? 82,
    },
    papernexus_certification: {
      status: overrides.papernexus_status ?? "source_backed_graph",
      claim_level: overrides.papernexus_claim_level ?? "source_backed_graph",
      source_backed_graph_claim: overrides.source_backed_graph_claim ?? true,
    },
    benchmark_adapter: {
      status: overrides.benchmark_adapter_status ?? "pass",
    },
    domain_evaluator: {
      status: overrides.domain_evaluator_status ?? "pass",
      pack: overrides.domain_evaluator_pack ?? "gcd_ml_experiment",
    },
    reviewer_calibration: {
      status: overrides.reviewer_calibration_status ?? "pass",
    },
    copyedit_style_audit: {
      status: overrides.copyedit_style_status ?? "pass",
    },
    experiment_lease_contract: {
      status: overrides.experiment_lease_status ?? "pass",
    },
    failed_required_checks: overrides.failed_required_checks ?? [],
    diagnostic_failed_checks: overrides.diagnostic_failed_checks ?? [],
  };
}

test("builds a no-Discord cross-project E2E dashboard from project scorecards", async (t) => {
  const projectsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-e2e-projects-"));
  t.after(() => fs.rm(projectsRoot, { recursive: true, force: true }));

  await writeProjectScorecard(
    projectsRoot,
    "research-pass",
    scorecardFixture({
      project: { project_id: "research-pass", project_root: path.join(projectsRoot, "research-pass") },
      quality_score_100: 88,
    }),
    {
      schema_version: 1,
      generated_at: "2026-04-28T00:05:00.000Z",
      status: "improved",
      score_delta_100: 8,
      failed_required_check_delta: -2,
      pass_streak: 2,
      regression_detected: false,
    }
  );

  await writeProjectScorecard(
    projectsRoot,
    "research-regression",
    scorecardFixture({
      project: {
        project_id: "research-regression",
        project_root: path.join(projectsRoot, "research-regression"),
        current_stage: "experiment",
        owner_agent: "coder",
      },
      verdict: { final_verdict: "fail", claim_strength_cap: "blocked" },
      quality_score_100: 41,
      papernexus_status: "fail",
      failed_required_checks: [{ path: "academic_writer/paper/main.tex" }],
      diagnostic_failed_checks: [{ name: "figure_result_mismatch" }],
    }),
    {
      schema_version: 1,
      generated_at: "2026-04-28T00:06:00.000Z",
      status: "regressed",
      score_delta_100: -24,
      failed_required_check_delta: 2,
      pass_streak: 0,
      regression_detected: true,
    }
  );

  const result = await buildE2EProjectsDashboard({ projectsRoot });

  await fs.access(result.projectsDashboardPath);
  await fs.access(result.projectsDashboardHtmlPath);
  assert.equal(result.dashboard.project_count, 2);
  assert.equal(result.dashboard.counts.attention_project_count, 1);
  assert.equal(result.dashboard.counts.regression_detected_count, 1);
  assert.deepEqual(result.dashboard.counts.final_verdict, { fail: 1, pass: 1 });
  assert.equal(result.dashboard.counts.quality_score_100.average, 64.5);
  assert.equal(result.dashboard.projects[0].project_id, "research-regression");
  assert.deepEqual(result.dashboard.projects[0].attention_reasons, [
    "regression_detected",
    "verdict_fail",
    "failed_required_checks",
    "diagnostic_failed_checks",
    "papernexus_certification_failed",
  ]);
  assert.equal(result.dashboard.projects[1].artifact_paths.dashboard.exists, true);
  assert.match(
    await fs.readFile(result.projectsDashboardHtmlPath, "utf8"),
    /OpenClaw AutoResearch E2E Projects Dashboard/
  );
});

test("project dashboard CLI prints durable output paths", async (t) => {
  const projectsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-e2e-projects-cli-"));
  t.after(() => fs.rm(projectsRoot, { recursive: true, force: true }));

  await writeProjectScorecard(
    projectsRoot,
    "survey-pass",
    scorecardFixture({
      project: {
        project_id: "survey-pass",
        project_root: path.join(projectsRoot, "survey-pass"),
        lane: "survey",
      },
      domain_evaluator_pack: "systematic_review",
    })
  );

  const { stdout } = await execFile(process.execPath, [
    path.join(process.cwd(), "scripts", "build-e2e-project-dashboard.mjs"),
    "--projects-root",
    projectsRoot,
  ]);
  const payload = JSON.parse(stdout);

  assert.match(payload.projectsDashboardPath, /E2E_PROJECTS_DASHBOARD\.json$/);
  assert.match(payload.projectsDashboardHtmlPath, /E2E_PROJECTS_DASHBOARD\.html$/);
  assert.equal(payload.summary.project_count, 1);
  assert.equal(payload.dashboard.counts.lane.survey, 1);
});
