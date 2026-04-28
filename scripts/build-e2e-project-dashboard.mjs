#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OPENCLAW_DIR = ".openclaw-research";
const SCORECARD_FILE = "E2E_RUN_SCORECARD.json";
const RUN_TRENDS_FILE = "E2E_RUN_TRENDS.json";
const PROJECTS_DASHBOARD_JSON = "E2E_PROJECTS_DASHBOARD.json";
const PROJECTS_DASHBOARD_HTML = "E2E_PROJECTS_DASHBOARD.html";

function argValue(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--")) {
    return argv[index + 1];
  }
  return fallback;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeStatus(value, fallback = "unknown") {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw || fallback;
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function countArray(value) {
  return Array.isArray(value) ? value.length : 0;
}

function countBy(records, selector) {
  const counts = {};
  for (const record of records) {
    const key = normalizeStatus(selector(record));
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function average(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return null;
  }
  return Math.round((finite.reduce((sum, value) => sum + value, 0) / finite.length) * 10) / 10;
}

function minMax(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return { min: null, max: null };
  }
  return {
    min: Math.min(...finite),
    max: Math.max(...finite),
  };
}

function projectSeverity(record) {
  if (record.missing_scorecard) {
    return 0;
  }
  if (record.regression_detected) {
    return 1;
  }
  if (record.final_verdict === "fail") {
    return 2;
  }
  if (record.final_verdict === "partial") {
    return 3;
  }
  if (record.failed_required_check_count > 0) {
    return 4;
  }
  if (record.diagnostic_failed_check_count > 0) {
    return 5;
  }
  return 6;
}

function attentionReasons(record) {
  const reasons = [];
  if (record.missing_scorecard) {
    reasons.push("missing_scorecard");
  }
  if (record.regression_detected) {
    reasons.push("regression_detected");
  }
  if (["fail", "partial", "missing", "unknown"].includes(record.final_verdict)) {
    reasons.push(`verdict_${record.final_verdict}`);
  }
  if (record.failed_required_check_count > 0) {
    reasons.push("failed_required_checks");
  }
  if (record.diagnostic_failed_check_count > 0) {
    reasons.push("diagnostic_failed_checks");
  }
  if (record.papernexus_certification_status === "fail") {
    reasons.push("papernexus_certification_failed");
  }
  if (record.experiment_lease_status === "fail") {
    reasons.push("experiment_lease_failed");
  }
  return reasons;
}

function relativeArtifactPath(projectsRoot, filePath) {
  if (!filePath) {
    return null;
  }
  const relative = path.relative(projectsRoot, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return filePath;
  }
  return relative;
}

function hrefFor(relativeOrAbsolutePath) {
  if (!relativeOrAbsolutePath) {
    return null;
  }
  return String(relativeOrAbsolutePath)
    .split(path.sep)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function artifactPathsForProject(projectRoot, projectsRoot) {
  const openclawDir = path.join(projectRoot, OPENCLAW_DIR);
  const paths = {
    scorecard: path.join(openclawDir, SCORECARD_FILE),
    dashboard: path.join(openclawDir, "E2E_DASHBOARD.html"),
    progress_chart: path.join(openclawDir, "progress_chart.html"),
    progress_chart_json: path.join(openclawDir, "progress_chart.json"),
    report: path.join(openclawDir, "E2E_RUN_REPORT.md"),
    narrative: path.join(openclawDir, "E2E_PROGRESS_NARRATIVE.md"),
    run_ledger: path.join(openclawDir, "E2E_RUN_LEDGER.jsonl"),
    run_trend: path.join(openclawDir, RUN_TRENDS_FILE),
    papernexus_certification: path.join(projectRoot, "graph", "PAPERNEXUS_TASK_CERTIFICATION.json"),
    benchmark_adapter: path.join(openclawDir, "E2E_BENCHMARK_ADAPTER_SCORECARD.json"),
    domain_evaluator: path.join(openclawDir, "E2E_DOMAIN_EVALUATOR_CONTRACT.json"),
    reviewer_calibration: path.join(openclawDir, "E2E_REVIEWER_CALIBRATION.json"),
    copyedit_style_audit: path.join(openclawDir, "E2E_COPYEDIT_STYLE_AUDIT.json"),
    experiment_lease: path.join(openclawDir, "E2E_EXPERIMENT_LEASE_CONTRACT.json"),
    platform_profile: path.join(openclawDir, "PLATFORM_PROFILE.json"),
  };
  const entries = await Promise.all(
    Object.entries(paths).map(async ([name, filePath]) => {
      const relativePath = relativeArtifactPath(projectsRoot, filePath);
      const present = await exists(filePath);
      return [
        name,
        {
          path: relativePath,
          href: present ? hrefFor(relativePath) : null,
          exists: present,
        },
      ];
    })
  );
  return Object.fromEntries(entries);
}

async function discoverProjectRoots(projectsRoot) {
  const entries = await fs.readdir(projectsRoot, { withFileTypes: true }).catch(() => []);
  const roots = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === OPENCLAW_DIR) {
      continue;
    }
    const projectRoot = path.join(projectsRoot, entry.name);
    const hasManifest = await exists(path.join(projectRoot, "PROJECT_MANIFEST.json"));
    const hasScorecard = await exists(path.join(projectRoot, OPENCLAW_DIR, SCORECARD_FILE));
    if (hasManifest || hasScorecard) {
      roots.push(projectRoot);
    }
  }
  return roots.sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
}

async function buildProjectRecord(projectRoot, projectsRoot) {
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const openclawDir = path.join(projectRoot, OPENCLAW_DIR);
  const scorecardPath = path.join(openclawDir, SCORECARD_FILE);
  const trendPath = path.join(openclawDir, RUN_TRENDS_FILE);
  const manifest = await readJson(manifestPath, null);
  const scorecard = await readJson(scorecardPath, null);
  const trend = (await readJson(trendPath, null)) ?? scorecard?.run_trends ?? null;
  const project = scorecard?.project ?? {};
  const verdict = scorecard?.verdict ?? {};
  const qualityScore = finiteNumber(scorecard?.quality_score?.score_100);
  const failedRequired = countArray(scorecard?.failed_required_checks);
  const diagnosticFailed = countArray(scorecard?.diagnostic_failed_checks);
  const artifacts = await artifactPathsForProject(projectRoot, projectsRoot);
  const record = {
    project_id:
      project.project_id ??
      manifest?.project_id ??
      manifest?.projectId ??
      path.basename(projectRoot),
    project_root: projectRoot,
    project_path: relativeArtifactPath(projectsRoot, projectRoot),
    lane: normalizeStatus(project.lane ?? manifest?.lane ?? manifest?.task_type, "unknown"),
    current_stage: project.current_stage ?? manifest?.current_stage ?? "unknown",
    owner_agent: project.owner_agent ?? manifest?.owner_agent ?? "unknown",
    generated_at: scorecard?.generated_at ?? trend?.generated_at ?? null,
    missing_scorecard: !scorecard,
    final_verdict: normalizeStatus(verdict.final_verdict, scorecard ? "unknown" : "missing"),
    claim_strength_cap: normalizeStatus(verdict.claim_strength_cap, scorecard ? "unknown" : "missing"),
    quality_score_100: qualityScore,
    failed_required_check_count: failedRequired,
    diagnostic_failed_check_count: diagnosticFailed,
    run_trend_status: normalizeStatus(trend?.status, "missing"),
    score_delta_100: finiteNumber(trend?.score_delta_100),
    failed_required_check_delta: finiteNumber(trend?.failed_required_check_delta),
    pass_streak: finiteNumber(trend?.pass_streak),
    regression_detected: Boolean(trend?.regression_detected),
    papernexus_certification_status: normalizeStatus(scorecard?.papernexus_certification?.status, "missing"),
    papernexus_claim_level: normalizeStatus(scorecard?.papernexus_certification?.claim_level, "missing"),
    source_backed_graph_claim: Boolean(
      scorecard?.papernexus_certification?.source_backed_graph_claim
    ),
    benchmark_adapter_status: normalizeStatus(scorecard?.benchmark_adapter?.status, "missing"),
    domain_evaluator_status: normalizeStatus(scorecard?.domain_evaluator?.status, "missing"),
    domain_evaluator_pack: normalizeStatus(scorecard?.domain_evaluator?.pack, "missing"),
    reviewer_calibration_status: normalizeStatus(scorecard?.reviewer_calibration?.status, "missing"),
    copyedit_style_status: normalizeStatus(scorecard?.copyedit_style_audit?.status, "missing"),
    experiment_lease_status: normalizeStatus(scorecard?.experiment_lease_contract?.status, "missing"),
    artifact_paths: artifacts,
  };
  record.attention_reasons = attentionReasons(record);
  record.needs_attention = record.attention_reasons.length > 0;
  return record;
}

function summarizeProjects(records) {
  const scores = records.map((record) => record.quality_score_100).filter(Number.isFinite);
  const { min, max } = minMax(scores);
  return {
    project_count: records.length,
    attention_project_count: records.filter((record) => record.needs_attention).length,
    missing_scorecard_count: records.filter((record) => record.missing_scorecard).length,
    regression_detected_count: records.filter((record) => record.regression_detected).length,
    final_verdict: countBy(records, (record) => record.final_verdict),
    claim_strength_cap: countBy(records, (record) => record.claim_strength_cap),
    lane: countBy(records, (record) => record.lane),
    run_trend_status: countBy(records, (record) => record.run_trend_status),
    domain_evaluator_pack: countBy(records, (record) => record.domain_evaluator_pack),
    quality_score_100: {
      average: average(scores),
      min,
      max,
    },
  };
}

function sortedProjects(records) {
  return [...records].sort((left, right) => {
    const severityDelta = projectSeverity(left) - projectSeverity(right);
    if (severityDelta !== 0) {
      return severityDelta;
    }
    const scoreDelta =
      (left.quality_score_100 ?? Number.POSITIVE_INFINITY) -
      (right.quality_score_100 ?? Number.POSITIVE_INFINITY);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return String(left.project_id).localeCompare(String(right.project_id));
  });
}

function linkCell(record, artifactName, label) {
  const artifact = record.artifact_paths?.[artifactName];
  if (!artifact?.href) {
    return "";
  }
  return `<a href="${escapeHtml(artifact.href)}">${escapeHtml(label)}</a>`;
}

function buildProjectsDashboardHtml(dashboard) {
  const rows = dashboard.projects
    .map((record) => {
      const score = record.quality_score_100 ?? "n/a";
      const delta =
        record.score_delta_100 === null || record.score_delta_100 === undefined
          ? "n/a"
          : record.score_delta_100 > 0
            ? `+${record.score_delta_100}`
            : String(record.score_delta_100);
      const attention = record.attention_reasons.length
        ? record.attention_reasons.join(", ")
        : "ok";
      return `<tr>
  <td><strong>${escapeHtml(record.project_id)}</strong><br><span>${escapeHtml(record.project_path)}</span></td>
  <td>${escapeHtml(record.lane)}</td>
  <td>${escapeHtml(record.final_verdict)}</td>
  <td>${escapeHtml(record.claim_strength_cap)}</td>
  <td>${escapeHtml(score)}</td>
  <td>${escapeHtml(record.run_trend_status)}<br><span>${escapeHtml(delta)}</span></td>
  <td>${escapeHtml(record.current_stage)}<br><span>${escapeHtml(record.owner_agent)}</span></td>
  <td>${escapeHtml(record.papernexus_certification_status)}<br><span>${escapeHtml(record.domain_evaluator_pack)}</span></td>
  <td>${escapeHtml(record.failed_required_check_count)} / ${escapeHtml(record.diagnostic_failed_check_count)}</td>
  <td>${escapeHtml(attention)}</td>
  <td>${[
    linkCell(record, "dashboard", "dashboard"),
    linkCell(record, "scorecard", "scorecard"),
    linkCell(record, "run_trend", "trend"),
    linkCell(record, "progress_chart", "progress"),
  ].filter(Boolean).join(" ")}</td>
</tr>`;
    })
    .join("\n");
  const attentionRows = dashboard.attention
    .map(
      (record) =>
        `<li><strong>${escapeHtml(record.project_id)}</strong>: ${escapeHtml(record.attention_reasons.join(", "))}</li>`
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenClaw AutoResearch E2E Projects Dashboard</title>
  <style>
    :root { color-scheme: light; --border: #d0d7de; --muted: #57606a; --bg: #ffffff; --soft: #f6f8fa; --text: #24292f; --accent: #0969da; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: var(--bg); }
    main { max-width: 1280px; margin: 0 auto; padding: 28px 20px 40px; }
    h1 { margin: 0 0 6px; font-size: 24px; line-height: 1.2; }
    h2 { margin: 28px 0 10px; font-size: 17px; }
    p { margin: 0; color: var(--muted); }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 20px 0; }
    .metric { border: 1px solid var(--border); border-radius: 8px; padding: 12px; background: var(--soft); }
    .metric span { display: block; color: var(--muted); font-size: 12px; }
    .metric strong { display: block; margin-top: 5px; font-size: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-top: 1px solid var(--border); padding: 10px 8px; text-align: left; vertical-align: top; }
    th { position: sticky; top: 0; background: var(--soft); z-index: 1; }
    td span { color: var(--muted); font-size: 12px; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    ul { margin: 8px 0 0; padding-left: 20px; }
    code { background: var(--soft); border-radius: 4px; padding: 1px 4px; }
  </style>
</head>
<body>
<main>
  <h1>OpenClaw AutoResearch E2E Projects Dashboard</h1>
  <p>generated: ${escapeHtml(dashboard.generated_at)} | projects root: <code>${escapeHtml(dashboard.projects_root)}</code></p>
  <section class="metrics">
    <div class="metric"><span>projects</span><strong>${escapeHtml(dashboard.project_count)}</strong></div>
    <div class="metric"><span>needs attention</span><strong>${escapeHtml(dashboard.counts.attention_project_count)}</strong></div>
    <div class="metric"><span>regressions</span><strong>${escapeHtml(dashboard.counts.regression_detected_count)}</strong></div>
    <div class="metric"><span>average score</span><strong>${escapeHtml(dashboard.counts.quality_score_100.average ?? "n/a")}</strong></div>
  </section>
  <h2>Attention</h2>
  ${attentionRows ? `<ul>${attentionRows}</ul>` : "<p>No project currently needs attention.</p>"}
  <h2>Projects</h2>
  <table>
    <thead>
      <tr>
        <th>Project</th>
        <th>Lane</th>
        <th>Verdict</th>
        <th>Claim Cap</th>
        <th>Score</th>
        <th>Trend</th>
        <th>Stage / Owner</th>
        <th>Evidence</th>
        <th>Failed Checks</th>
        <th>Attention</th>
        <th>Artifacts</th>
      </tr>
    </thead>
    <tbody>
      ${rows || "<tr><td colspan=\"11\">No E2E projects found.</td></tr>"}
    </tbody>
  </table>
</main>
</body>
</html>
`;
}

export async function buildE2EProjectsDashboard(params = {}) {
  const projectsRoot = path.resolve(params.projectsRoot ?? process.cwd());
  const outputDir = path.resolve(params.outputDir ?? path.join(projectsRoot, OPENCLAW_DIR));
  const projectRoots = await discoverProjectRoots(projectsRoot);
  const records = sortedProjects(
    await Promise.all(projectRoots.map((projectRoot) => buildProjectRecord(projectRoot, projectsRoot)))
  );
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const dashboard = {
    schema_version: 1,
    generated_at: generatedAt,
    projects_root: projectsRoot,
    project_count: records.length,
    counts: summarizeProjects(records),
    projects: records,
    attention: records.filter((record) => record.needs_attention),
  };
  const projectsDashboardPath = path.join(outputDir, PROJECTS_DASHBOARD_JSON);
  const projectsDashboardHtmlPath = path.join(outputDir, PROJECTS_DASHBOARD_HTML);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(projectsDashboardPath, `${JSON.stringify(dashboard, null, 2)}\n`, "utf8");
  await fs.writeFile(projectsDashboardHtmlPath, buildProjectsDashboardHtml(dashboard), "utf8");
  return {
    projectsDashboardPath,
    projectsDashboardHtmlPath,
    dashboard,
    summary: {
      project_count: dashboard.project_count,
      attention_project_count: dashboard.counts.attention_project_count,
      regression_detected_count: dashboard.counts.regression_detected_count,
      final_verdict: dashboard.counts.final_verdict,
      run_trend_status: dashboard.counts.run_trend_status,
    },
  };
}

async function main(argv = process.argv) {
  const projectsRoot = path.resolve(argValue(argv, "--projects-root", process.cwd()));
  const outputDirArg = argValue(argv, "--output-dir", null);
  const result = await buildE2EProjectsDashboard({
    projectsRoot,
    outputDir: outputDirArg ? path.resolve(outputDirArg) : undefined,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
