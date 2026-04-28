#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function listJsonl(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { raw: line };
        }
      });
  } catch {
    return [];
  }
}

function countBy(entries, key) {
  const counts = {};
  for (const entry of entries ?? []) {
    const value = String(entry?.[key] ?? "unknown");
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function isBlockingRuntimeIncident(entry) {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  if (entry.status === "resolved") {
    return false;
  }
  const severity = String(entry.severity ?? "").toLowerCase();
  return !["debug", "info", "notice", "warning"].includes(severity);
}

function statusFromChecks(checks) {
  const required = checks.filter((entry) => entry.required);
  if (required.every((entry) => entry.exists)) {
    return "pass";
  }
  if (required.some((entry) => entry.exists)) {
    return "partial";
  }
  return "fail";
}

function passRatio(checks) {
  const entries = Array.isArray(checks) ? checks : [];
  if (entries.length === 0) {
    return 1;
  }
  return entries.filter((entry) => entry.ok).length / entries.length;
}

function boundedRatio(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(1, value));
}

function score100(value) {
  const ratio = boundedRatio(value);
  return ratio === null ? null : Number((ratio * 100).toFixed(1));
}

function weightedScore100(components) {
  const scored = components.filter(
    (component) =>
      typeof component.score === "number" &&
      Number.isFinite(component.score) &&
      typeof component.weight === "number" &&
      component.weight > 0
  );
  const totalWeight = scored.reduce((sum, component) => sum + component.weight, 0);
  if (totalWeight <= 0) {
    return null;
  }
  const weighted = scored.reduce((sum, component) => sum + boundedRatio(component.score) * component.weight, 0);
  return score100(weighted / totalWeight);
}

function readNestedNumber(source, paths) {
  for (const fields of paths) {
    let cursor = source;
    for (const field of fields) {
      cursor = cursor && typeof cursor === "object" ? cursor[field] : null;
    }
    if (typeof cursor === "number" && Number.isFinite(cursor)) {
      return cursor;
    }
  }
  return null;
}

function readFirstNumber(source, paths, fallback = null) {
  const direct = readNestedNumber(source, paths);
  return direct !== null ? direct : fallback;
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry ?? "").trim()).filter(Boolean)
    : [];
}

function inferDomainEvaluatorPack({ lane, manifest, mainTex }) {
  const text = `${lane} ${JSON.stringify(manifest ?? {})} ${mainTex ?? ""}`.toLowerCase();
  if (lane === "survey" || /systematic review|survey|literature review/.test(text)) {
    return "systematic_review";
  }
  if (/\b(kernel|cuda|triton|gpu kernel|webgpu|metal)\b/.test(text)) {
    return "kernel_optimization";
  }
  if (/\b(proof|theorem|lemma|lean|coq|isabelle)\b/.test(text)) {
    return "proof_checker";
  }
  return "gcd_ml_experiment";
}

function buildPlatformProfile({ generatedAt }) {
  const cpuCount = os.cpus()?.length ?? null;
  const totalMemoryGb = Number((os.totalmem() / 1024 ** 3).toFixed(2));
  const cudaVisibleDevices = process.env.CUDA_VISIBLE_DEVICES ?? null;
  const webgpuFlag = process.env.OPENCLAW_WEBGPU ?? null;
  const mlxFlag = process.env.OPENCLAW_MLX ?? null;
  const matrix = {
    cpu: {
      status: "available",
      threads: cpuCount,
    },
    macos: {
      status: process.platform === "darwin" ? "available" : "unavailable",
    },
    mlx: {
      status:
        mlxFlag === "1"
          ? "declared_available"
          : process.platform === "darwin"
            ? "unknown_not_probed"
            : "unavailable",
    },
    cuda: {
      status:
        cudaVisibleDevices && cudaVisibleDevices !== "-1"
          ? "declared_available"
          : "unknown_not_probed",
      cuda_visible_devices: cudaVisibleDevices,
    },
    webgpu: {
      status: webgpuFlag === "1" ? "declared_available" : "unknown_not_probed",
    },
  };
  return {
    schema_version: 1,
    generated_at: generatedAt,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
      cpu_threads: cpuCount,
      total_memory_gb: totalMemoryGb,
    },
    capability_matrix: matrix,
    reproducibility_boundaries: [
      "CPU is always available but may not reproduce GPU timing.",
      "MLX/CUDA/WebGPU are treated as declared or unknown unless a dedicated doctor probes them.",
      "Benchmark claims should cite this profile when runtime hardware affects results.",
    ],
  };
}

function buildBenchmarkAdapterScorecard({
  generatedAt,
  rawFixture,
  fixturePath,
  lane,
  canonicalExperimentResults,
  baselineScore,
  proposedScore,
  holdoutScore,
  bestScore,
  experimentLedgerCount,
}) {
  const raw = rawFixture && typeof rawFixture === "object" ? rawFixture : null;
  const source = raw ? "fixture_adapter" : canonicalExperimentResults ? "experiment_results" : "missing";
  const adapterName =
    raw?.adapter ??
    raw?.adapter_name ??
    raw?.adapterName ??
    (raw ? "mle-bench-fixture" : "openclaw-local-results");
  const baseline = readFirstNumber(
    raw,
    [["baseline_score"], ["baselineScore"], ["baseline", "score"], ["scores", "baseline"]],
    baselineScore
  );
  const candidate = readFirstNumber(
    raw,
    [["candidate_score"], ["candidateScore"], ["proposed_score"], ["proposedScore"], ["candidate", "score"], ["scores", "candidate"]],
    proposedScore
  );
  const holdout = readFirstNumber(
    raw,
    [["holdout_score"], ["holdoutScore"], ["holdout", "score"], ["scores", "holdout"]],
    holdoutScore
  );
  const best =
    readFirstNumber(raw, [["best_score"], ["bestScore"], ["scores", "best"]], bestScore) ??
    [baseline, candidate, holdout]
      .filter((value) => typeof value === "number" && Number.isFinite(value))
      .sort((left, right) => right - left)[0] ??
    null;
  const metric =
    raw?.metric ??
    raw?.primary_metric ??
    raw?.primaryMetric ??
    (lane === "survey" ? "coverage_score" : "h_score");
  const status =
    source === "missing"
      ? "missing"
      : typeof candidate === "number" && Number.isFinite(candidate)
        ? "pass"
        : "partial";
  return {
    schema_version: 1,
    generated_at: generatedAt,
    status,
    source,
    adapter: adapterName,
    fixture_path: raw ? fixturePath : null,
    benchmark_id:
      raw?.benchmark_id ?? raw?.benchmarkId ?? raw?.task_id ?? raw?.taskId ?? null,
    task_type: raw?.task_type ?? raw?.taskType ?? lane,
    metric,
    baseline_score: baseline,
    candidate_score: candidate,
    holdout_score: holdout,
    best_score: best,
    improvement:
      typeof baseline === "number" && typeof candidate === "number"
        ? Number((candidate - baseline).toFixed(6))
        : null,
    iterations:
      readFirstNumber(raw, [["iterations"], ["num_iterations"], ["numIterations"]], experimentLedgerCount || null),
    wall_time_seconds: readFirstNumber(raw, [["wall_time_seconds"], ["wallTimeSeconds"]]),
    cost_usd: readFirstNumber(raw, [["cost_usd"], ["costUsd"]]),
    evidence_paths: asStringArray(raw?.evidence_paths ?? raw?.evidencePaths),
    guardrail: {
      unified_scorecard_required: true,
      raw_benchmark_score_can_bypass_claim_gate: false,
    },
  };
}

function buildDomainEvaluatorContract({
  generatedAt,
  lane,
  manifest,
  mainTex,
  artifactChecklist,
  extraArtifactPresence = {},
  bibliographyCount,
  includedPaperCount,
  sotaMatrixRows,
  experimentLedgerCount,
  experimentResultsHasMetrics,
  resultBackedFigureTablePass,
  baselineScore,
  proposedScore,
  holdoutScore,
}) {
  const pack = inferDomainEvaluatorPack({ lane, manifest, mainTex });
  const artifactMap = new Map(
    artifactChecklist.map((entry) => [entry.path, Boolean(entry.exists)])
  );
  for (const [artifactPath, present] of Object.entries(extraArtifactPresence)) {
    artifactMap.set(artifactPath, Boolean(present));
  }
  const packDefinitions = {
    gcd_ml_experiment: {
      metrics: ["h_score", "known_accuracy", "novel_accuracy", "delta_h_score"],
      holdout: "holdout_h_score",
      artifact_expectations: [
        "researcher/EXPERIMENT_LEDGER.json",
        "researcher/artifacts/results",
        "academic_writer/FIGURE_PACK.json",
        "academic_writer/TABLE_PACK.json",
      ],
      failure_semantics:
        "Missing metrics or holdout evidence caps claims to local-reference or exploratory language.",
    },
    systematic_review: {
      metrics: ["bibliography_count", "included_paper_count", "sota_matrix_rows"],
      holdout: "screened representative papers and excluded-paper boundary",
      artifact_expectations: [
        "researcher/INCLUDED_PAPERS.json",
        "researcher/EXCLUDED_PAPERS.json",
        "researcher/SOTA_MATRIX.md",
        "researcher/COVERAGE_SUMMARY.md",
      ],
      failure_semantics:
        "Coverage or taxonomy gaps block broad survey-completeness claims.",
    },
    proof_checker: {
      metrics: ["proof_obligation_count", "checked_obligation_count"],
      holdout: "independent proof checker output",
      artifact_expectations: [
        "researcher/PROOF_OBLIGATIONS.json",
        "reviewer/PROOF_CHECK_REPORT.json",
      ],
      failure_semantics:
        "Unchecked proof obligations block theorem or correctness claims.",
    },
    kernel_optimization: {
      metrics: ["speedup", "latency_ms", "throughput", "correctness_pass"],
      holdout: "hardware-specific validation profile",
      artifact_expectations: [
        "researcher/artifacts/results",
        "researcher/EXPERIMENT_LEDGER.json",
        "reviewer/CITATION_VERIFICATION.md",
      ],
      failure_semantics:
        "Missing correctness or platform profile blocks performance-generalization claims.",
    },
  };
  const definition = packDefinitions[pack];
  const artifactChecks = definition.artifact_expectations.map((artifactPath) => ({
    path: artifactPath,
    ok: artifactMap.get(artifactPath) === true,
  }));
  const metricChecks =
    pack === "systematic_review"
      ? [
          { name: "bibliography_count", ok: bibliographyCount >= 12, observed: bibliographyCount, expected: ">=12" },
          { name: "included_paper_count", ok: includedPaperCount >= 12, observed: includedPaperCount, expected: ">=12" },
          { name: "sota_matrix_rows", ok: sotaMatrixRows >= 8, observed: sotaMatrixRows, expected: ">=8" },
        ]
      : pack === "gcd_ml_experiment"
        ? [
            { name: "baseline_score", ok: typeof baselineScore === "number", observed: baselineScore, expected: "number" },
            { name: "candidate_score", ok: typeof proposedScore === "number", observed: proposedScore, expected: "number" },
            { name: "holdout_score", ok: typeof holdoutScore === "number", observed: holdoutScore, expected: "number" },
            { name: "experiment_ledger", ok: experimentLedgerCount > 0, observed: experimentLedgerCount, expected: ">0" },
            { name: "result_metrics", ok: experimentResultsHasMetrics, observed: experimentResultsHasMetrics, expected: true },
            { name: "result_backed_figures_tables", ok: resultBackedFigureTablePass, observed: resultBackedFigureTablePass, expected: true },
          ]
        : [
            { name: "domain_specific_metrics", ok: experimentResultsHasMetrics, observed: experimentResultsHasMetrics, expected: true },
            { name: "domain_artifacts", ok: artifactChecks.every((entry) => entry.ok), observed: artifactChecks, expected: "all artifacts present" },
          ];
  const failed = [...artifactChecks, ...metricChecks].filter((entry) => !entry.ok);
  const status =
    failed.length === 0
      ? "pass"
      : failed.length < artifactChecks.length + metricChecks.length
        ? "partial"
        : "fail";
  return {
    schema_version: 1,
    generated_at: generatedAt,
    status,
    pack,
    metrics: definition.metrics,
    holdout: definition.holdout,
    artifact_expectations: artifactChecks,
    metric_checks: metricChecks,
    failure_semantics: definition.failure_semantics,
    claim_guardrail:
      status === "pass"
        ? "domain_evaluator_backed"
        : status === "partial"
          ? "domain_evaluator_partial"
          : "domain_evaluator_blocked",
  };
}

function failedCheckRecords(groups) {
  const records = [];
  for (const group of groups) {
    for (const check of group.checks ?? []) {
      if (check.ok) {
        continue;
      }
      records.push({
        group: group.name,
        name: check.name,
        observed: check.observed ?? null,
        expected: check.expected ?? true,
      });
    }
  }
  return records;
}

function markdownBullets(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- none";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeIsoTime(value) {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function buildProgressPoints(timelineEntries, finalSnapshot) {
  let runtimeEvents = 0;
  let handoffEvents = 0;
  const points = [];
  for (const entry of timelineEntries) {
    if (entry.source === "handoff") {
      handoffEvents += 1;
    } else {
      runtimeEvents += 1;
    }
    points.push({
      index: points.length + 1,
      at: normalizeIsoTime(entry.at),
      source: entry.source ?? "unknown",
      kind: entry.kind ?? null,
      stage: entry.stage ?? null,
      status: entry.status ?? null,
      summary: entry.summary ?? null,
      cumulative_runtime_events: runtimeEvents,
      cumulative_handoff_events: handoffEvents,
    });
  }
  points.push({
    index: points.length + 1,
    at: finalSnapshot.generatedAt,
    source: "harness",
    kind: "final_verdict",
    stage: finalSnapshot.currentStage,
    status: finalSnapshot.finalVerdict,
    summary: `final_verdict=${finalSnapshot.finalVerdict}; claim_strength_cap=${finalSnapshot.claimStrengthCap}`,
    cumulative_runtime_events: runtimeEvents,
    cumulative_handoff_events: handoffEvents,
  });
  return points;
}

function buildProgressAnnotations(scorecard, timelinePoints) {
  const annotations = [];
  if (scorecard.paper_quality.source_index_paper_count > 0) {
    annotations.push({
      kind: "literature_coverage",
      label: "source index coverage",
      summary: `${scorecard.paper_quality.source_index_paper_count} source-index papers, ${scorecard.paper_quality.bibliography_count} bibliography entries`,
    });
  }
  if (scorecard.evidence_coverage.experiment_ledger_count > 0) {
    annotations.push({
      kind: "experiment_progress",
      label: "experiment ledger",
      summary: `${scorecard.evidence_coverage.experiment_ledger_count} experiment ledger entries available`,
    });
  }
  if (scorecard.paper_quality.result_backed_figure_table_pass) {
    annotations.push({
      kind: "result_backed_paper",
      label: "result-backed figures/tables",
      summary: "Figure and table packs are tied to experiment result artifacts.",
    });
  }
  if (scorecard.papernexus_certification.status !== "missing") {
    annotations.push({
      kind: "papernexus_certification",
      label: "PaperNexus task certification",
      summary: `status=${scorecard.papernexus_certification.status}; claim_level=${scorecard.papernexus_certification.claim_level}; source_backed_graph=${scorecard.papernexus_certification.source_backed_graph_claim}`,
    });
  }
  if (scorecard.benchmark_adapter.status !== "missing") {
    annotations.push({
      kind: "benchmark_adapter",
      label: "benchmark adapter",
      summary: `adapter=${scorecard.benchmark_adapter.adapter}; metric=${scorecard.benchmark_adapter.metric}; candidate=${scorecard.benchmark_adapter.candidate_score ?? "n/a"}`,
    });
  }
  annotations.push({
    kind: "domain_evaluator",
    label: "domain evaluator",
    summary: `pack=${scorecard.domain_evaluator.pack}; status=${scorecard.domain_evaluator.status}; guardrail=${scorecard.domain_evaluator.claim_guardrail}`,
  });
  if (scorecard.failed_required_checks.length > 0) {
    annotations.push({
      kind: "blocking_checks",
      label: "failed required checks",
      summary: `${scorecard.failed_required_checks.length} required checks failed`,
    });
  }
  if (timelinePoints.length > 1) {
    annotations.push({
      kind: "run_trace",
      label: "timeline trace",
      summary: `${timelinePoints.length} timeline points captured including final verdict`,
    });
  }
  return annotations;
}

function buildProgressChartHtml(progressChart) {
  const components = progressChart.quality_components
    .map((component) => {
      const width = Math.max(0, Math.min(100, component.score_100 ?? 0));
      return `<tr><td>${escapeHtml(component.name)}</td><td>${escapeHtml(component.status)}</td><td>${escapeHtml(component.weight)}</td><td><div class="bar"><span style="width:${width}%"></span></div></td><td>${escapeHtml(component.score_100 ?? "n/a")}</td></tr>`;
    })
    .join("\n");
  const points = progressChart.timeline_points
    .map(
      (point) =>
        `<li><strong>${escapeHtml(point.index)}.</strong> ${escapeHtml(point.at ?? "unknown time")} <span>${escapeHtml(point.source)}</span> ${escapeHtml(point.kind ?? "event")} ${point.stage ? `stage=${escapeHtml(point.stage)}` : ""} ${point.status ? `status=${escapeHtml(point.status)}` : ""}<br><small>${escapeHtml(point.summary ?? "")}</small></li>`
    )
    .join("\n");
  const annotations = progressChart.annotations
    .map(
      (annotation) =>
        `<li><strong>${escapeHtml(annotation.label)}</strong><br><small>${escapeHtml(annotation.summary)}</small></li>`
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>E2E Progress Chart</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:32px;color:#172026;background:#f7f8fa}
main{max-width:1080px;margin:0 auto}
h1,h2{margin:0 0 12px}
section{background:#fff;border:1px solid #d9dee7;border-radius:8px;padding:20px;margin:16px 0}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.metric{border:1px solid #e3e7ee;border-radius:8px;padding:12px}
.metric b{display:block;font-size:24px;margin-top:4px}
table{width:100%;border-collapse:collapse}
td,th{border-bottom:1px solid #e3e7ee;text-align:left;padding:8px}
.bar{height:10px;background:#edf0f4;border-radius:999px;overflow:hidden}
.bar span{display:block;height:100%;background:#1f6feb}
li{margin:0 0 12px}
small{color:#5d6875}
</style>
</head>
<body>
<main>
<h1>E2E Progress Chart</h1>
<section class="summary">
<div class="metric">Verdict<b>${escapeHtml(progressChart.verdict.final_verdict)}</b></div>
<div class="metric">Claim Cap<b>${escapeHtml(progressChart.verdict.claim_strength_cap)}</b></div>
<div class="metric">Quality Score<b>${escapeHtml(progressChart.summary.quality_score_100 ?? "n/a")}</b></div>
<div class="metric">Timeline Points<b>${escapeHtml(progressChart.timeline_points.length)}</b></div>
</section>
<section>
<h2>Quality Components</h2>
<table><thead><tr><th>Name</th><th>Status</th><th>Weight</th><th>Score</th><th>Score 100</th></tr></thead><tbody>
${components}
</tbody></table>
</section>
<section>
<h2>Annotations</h2>
<ul>${annotations || "<li>none</li>"}</ul>
</section>
<section>
<h2>Timeline</h2>
<ol>${points}</ol>
</section>
</main>
</body>
</html>
`;
}

function artifactHref(openclawDir, filePath) {
  if (!filePath) {
    return null;
  }
  return path.relative(openclawDir, filePath).split(path.sep).join("/");
}

function buildRunLedgerEntry({ runId, scorecard, progressChart, linkedArtifacts }) {
  return {
    schema_version: 1,
    run_id: runId,
    generated_at: scorecard.generated_at,
    project: scorecard.project,
    verdict: scorecard.verdict,
    quality_score_100: scorecard.quality_score.score_100,
    artifact_count: scorecard.minimal_scorecard.artifact_count,
    failed_required_check_count: scorecard.failed_required_checks.length,
    diagnostic_failed_check_count: scorecard.diagnostic_failed_checks.length,
    timeline_point_count: progressChart.timeline_points.length,
    papernexus_certification_status: scorecard.papernexus_certification.status,
    benchmark_adapter_status: scorecard.benchmark_adapter.status,
    domain_evaluator_status: scorecard.domain_evaluator.status,
    domain_evaluator_pack: scorecard.domain_evaluator.pack,
    platform: scorecard.platform_profile.runtime.platform,
    linked_artifacts: linkedArtifacts,
  };
}

function buildE2EDashboardHtml({ openclawDir, scorecard, progressChart, runLedgerEntries }) {
  const latest = scorecard;
  const artifactRows = Object.entries(progressChart.linked_artifacts)
    .map(([name, filePath]) => {
      const href = artifactHref(openclawDir, filePath);
      return `<tr><td>${escapeHtml(name)}</td><td>${href ? `<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>` : "missing"}</td></tr>`;
    })
    .join("\n");
  const checks = latest.failed_required_checks
    .slice(0, 20)
    .map(
      (entry) =>
        `<li><strong>${escapeHtml(entry.group)}.${escapeHtml(entry.name)}</strong><br><small>observed=${escapeHtml(JSON.stringify(entry.observed))} expected=${escapeHtml(JSON.stringify(entry.expected))}</small></li>`
    )
    .join("\n");
  const actions = latest.next_actions
    .map((entry) => `<li>${escapeHtml(entry)}</li>`)
    .join("\n");
  const historyRows = runLedgerEntries
    .filter((entry) => entry && typeof entry === "object" && !entry.raw)
    .slice(-25)
    .reverse()
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.generated_at ?? "unknown")}</td><td>${escapeHtml(entry.project?.lane ?? "unknown")}</td><td>${escapeHtml(entry.verdict?.final_verdict ?? "unknown")}</td><td>${escapeHtml(entry.verdict?.claim_strength_cap ?? "unknown")}</td><td>${escapeHtml(entry.quality_score_100 ?? "n/a")}</td><td>${escapeHtml(entry.domain_evaluator_pack ?? "unknown")}</td><td>${escapeHtml(entry.failed_required_check_count ?? "n/a")}</td></tr>`
    )
    .join("\n");
  const componentRows = latest.quality_score.components
    .map(
      (component) =>
        `<tr><td>${escapeHtml(component.name)}</td><td>${escapeHtml(component.status)}</td><td>${escapeHtml(component.weight)}</td><td>${escapeHtml(component.score_100 ?? "n/a")}</td></tr>`
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>OpenClaw No-Discord E2E Dashboard</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:32px;color:#172026;background:#f7f8fa}
main{max-width:1180px;margin:0 auto}
h1,h2{margin:0 0 12px}
section{background:#fff;border:1px solid #d9dee7;border-radius:8px;padding:20px;margin:16px 0}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.metric{border:1px solid #e3e7ee;border-radius:8px;padding:12px}
.metric b{display:block;font-size:24px;margin-top:4px}
table{width:100%;border-collapse:collapse}
td,th{border-bottom:1px solid #e3e7ee;text-align:left;padding:8px;vertical-align:top}
li{margin:0 0 10px}
small{color:#5d6875}
a{color:#1f6feb;text-decoration:none}
</style>
</head>
<body>
<main>
<h1>OpenClaw No-Discord E2E Dashboard</h1>
<section class="summary">
<div class="metric">Verdict<b>${escapeHtml(latest.verdict.final_verdict)}</b></div>
<div class="metric">Claim Cap<b>${escapeHtml(latest.verdict.claim_strength_cap)}</b></div>
<div class="metric">Quality Score<b>${escapeHtml(latest.quality_score.score_100 ?? "n/a")}</b></div>
<div class="metric">Failed Checks<b>${escapeHtml(latest.failed_required_checks.length)}</b></div>
<div class="metric">PaperNexus<b>${escapeHtml(latest.papernexus_certification.status)}</b></div>
<div class="metric">Domain Pack<b>${escapeHtml(latest.domain_evaluator.pack)}</b></div>
</section>
<section>
<h2>Quality Components</h2>
<table><thead><tr><th>Name</th><th>Status</th><th>Weight</th><th>Score 100</th></tr></thead><tbody>${componentRows}</tbody></table>
</section>
<section>
<h2>Run Ledger</h2>
<table><thead><tr><th>Generated</th><th>Lane</th><th>Verdict</th><th>Claim Cap</th><th>Score</th><th>Domain</th><th>Failed</th></tr></thead><tbody>${historyRows || "<tr><td colspan=\"7\">none</td></tr>"}</tbody></table>
</section>
<section>
<h2>Artifacts</h2>
<table><tbody>${artifactRows}</tbody></table>
</section>
<section>
<h2>Failed Required Checks</h2>
<ul>${checks || "<li>none</li>"}</ul>
</section>
<section>
<h2>Next Actions</h2>
<ul>${actions || "<li>none</li>"}</ul>
</section>
</main>
</body>
</html>
`;
}

function parseCountsFromText(rawText, labels) {
  for (const label of labels) {
    const match = rawText.match(new RegExp(`${label}\\s*[:：]\\s*(\\d+)`, "i"));
    if (match) {
      return Number(match[1]);
    }
  }
  return 0;
}

function stripLatexForWordCount(rawText) {
  return String(rawText ?? "")
    .replace(/%.*$/gm, " ")
    .replace(/\\(?:cite|ref|label|url|href|input|includegraphics|bibliography|bibliographystyle)(?:\[[^\]]*\])?\{[^}]*\}/g, " ")
    .replace(/\\[a-zA-Z*]+(?:\[[^\]]*\])?/g, " ")
    .replace(/[{}$^_&~#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(rawText) {
  const stripped = stripLatexForWordCount(rawText);
  return stripped ? stripped.split(/\s+/).filter(Boolean).length : 0;
}

function extractLatexSectionBodies(rawText) {
  const source = String(rawText ?? "");
  const matches = [...source.matchAll(/\\section\*?\{([^}]*)\}/g)];
  if (matches.length === 0) {
    return [];
  }
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? source.length;
    return {
      title: match[1]?.trim() || `section_${index + 1}`,
      body: source.slice(start, end),
    };
  });
}

function extractCitationKeys(rawText) {
  const keys = new Set();
  for (const match of String(rawText ?? "").matchAll(/\\cite[ptba]?\*?(?:\[[^\]]*\])?\{([^}]*)\}/g)) {
    for (const key of String(match[1] ?? "").split(",")) {
      const normalized = key.trim();
      if (normalized) {
        keys.add(normalized);
      }
    }
  }
  return [...keys];
}

function extractBibKeys(rawText) {
  return new Set(
    [...String(rawText ?? "").matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,/g)]
      .map((match) => match[1]?.trim())
      .filter(Boolean)
  );
}

function resultCompletenessScore(source) {
  if (!source || typeof source !== "object") {
    return 0;
  }
  const readNumberAt = (fields) => {
    let cursor = source;
    for (const field of fields) {
      cursor = cursor && typeof cursor === "object" ? cursor[field] : null;
    }
    return typeof cursor === "number" && Number.isFinite(cursor) ? cursor : null;
  };
  return [
    ["baseline", "h_score"],
    ["baseline", "known_accuracy"],
    ["baseline", "novel_accuracy"],
    ["proposed", "h_score"],
    ["proposed", "known_accuracy"],
    ["proposed", "novel_accuracy"],
    ["ablations", "minus_class_balance_debiasing", "h_score"],
    ["ablations", "minus_consistency_filtering", "h_score"],
    ["metrics", "h_score"],
    ["metrics", "known_accuracy"],
    ["metrics", "novel_accuracy"],
  ].filter((fields) => readNumberAt(fields) !== null).length;
}

function countMarkdownTableRows(rawText) {
  return String(rawText ?? "")
    .split(/\r?\n/)
    .filter((line) => /^\s*\|/.test(line) && !/^\s*\|\s*:?-{3,}/.test(line)).length;
}

const projectRoot = path.resolve(argValue("--project-root", process.env.OPENCLAW_PROJECT ?? ""));
const lane = argValue("--lane", "survey");
const strictContent = hasFlag("--strict-content");
if (!projectRoot || projectRoot === process.cwd()) {
  console.error("Usage: node scripts/run-e2e-paper-generation.mjs --project-root <path> --lane <survey|experiment|full>");
  process.exit(2);
}

const openclawDir = path.join(projectRoot, ".openclaw-research");
await fs.mkdir(openclawDir, { recursive: true });

const manifest = (await readJson(path.join(projectRoot, "PROJECT_MANIFEST.json"))) ?? {};
const handoffStore =
  (await readJson(path.join(openclawDir, "workflow-handoff-intents.json"))) ?? { intents: [] };
const repairStore =
  (await readJson(path.join(openclawDir, "workflow-repair-queue.json"))) ?? { items: [] };
const capabilityStore =
  (await readJson(path.join(openclawDir, "workflow-agent-capabilities.json"))) ?? { records: [] };
const writeScopeStore =
  (await readJson(path.join(openclawDir, "workflow-write-scopes.json"))) ?? { claims: [] };
const incidentsStore =
  (await readJson(path.join(openclawDir, "workflow-runtime-incidents.json"))) ?? { entries: [] };
const events = await listJsonl(path.join(openclawDir, "workflow-events.jsonl"));
const handoffEvents = await listJsonl(path.join(openclawDir, "workflow-handoff-events.jsonl"));
const mainTexPath = path.join(projectRoot, "academic_writer", "paper", "main.tex");
const refsBibPath = path.join(projectRoot, "academic_writer", "paper", "refs.bib");
const citationVerificationPath = path.join(projectRoot, "reviewer", "CITATION_VERIFICATION.md");
const reviewIssuesPath = path.join(projectRoot, "reviewer", "REVIEW_ISSUES.json");
const mainPdfPath = path.join(projectRoot, "academic_writer", "paper", "main.pdf");
const writingSignalsPath = path.join(projectRoot, "academic_writer", "WRITING_SIGNALS.md");
const reviewPacketPath = path.join(projectRoot, "reviewer", "REVIEW_PACKET.json");
const includedPapersPath = path.join(projectRoot, "researcher", "INCLUDED_PAPERS.json");
const paperSourceIndexPath = path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json");
const sotaMatrixPath = path.join(projectRoot, "researcher", "SOTA_MATRIX.md");
const experimentLedgerPath = path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json");
const resultsPath = path.join(projectRoot, "researcher", "artifacts", "results", "results.json");
const expOneResultPath = path.join(projectRoot, "researcher", "artifacts", "results", "exp-1", "RESULT_SUMMARY.json");
const figurePackPath = path.join(projectRoot, "academic_writer", "FIGURE_PACK.json");
const tablePackPath = path.join(projectRoot, "academic_writer", "TABLE_PACK.json");
const papernexusTaskCertificationPath = path.join(
  projectRoot,
  "graph",
  "PAPERNEXUS_TASK_CERTIFICATION.json"
);
const benchmarkAdapterFixturePaths = [
  path.join(projectRoot, "researcher", "BENCHMARK_ADAPTER_FIXTURE.json"),
  path.join(projectRoot, "researcher", "MLAGENTBENCH_FIXTURE.json"),
  path.join(projectRoot, "researcher", "MLE_BENCH_FIXTURE.json"),
];

const [
  mainTex,
  refsBib,
  citationVerificationText,
  reviewIssues,
  includedPapers,
  paperSourceIndex,
  sotaMatrix,
  experimentLedger,
  experimentResults,
  expOneResult,
  figurePack,
  tablePack,
  papernexusTaskCertification,
  ...benchmarkAdapterFixtureCandidates
] = await Promise.all([
  readTextIfExists(mainTexPath),
  readTextIfExists(refsBibPath),
  readTextIfExists(citationVerificationPath),
  readJson(reviewIssuesPath),
  readJson(includedPapersPath),
  readJson(paperSourceIndexPath),
  readTextIfExists(sotaMatrixPath),
  readJson(experimentLedgerPath),
  readJson(resultsPath),
  readJson(expOneResultPath),
  readJson(figurePackPath),
  readJson(tablePackPath),
  readJson(papernexusTaskCertificationPath),
  ...benchmarkAdapterFixturePaths.map((fixturePath) => readJson(fixturePath)),
]);
const benchmarkAdapterFixtureIndex = benchmarkAdapterFixtureCandidates.findIndex(Boolean);
const benchmarkAdapterFixture =
  benchmarkAdapterFixtureIndex >= 0
    ? benchmarkAdapterFixtureCandidates[benchmarkAdapterFixtureIndex]
    : null;
const benchmarkAdapterFixturePath =
  benchmarkAdapterFixtureIndex >= 0
    ? benchmarkAdapterFixturePaths[benchmarkAdapterFixtureIndex]
    : null;

const citeCount = (mainTex?.match(/\\cite[ptba]?\*?\{/g) ?? []).length;
const sectionCount = (mainTex?.match(/\\section\*?\{/g) ?? []).length;
const bibliographyCount = (refsBib?.match(/@\w+\s*\{/g) ?? []).length;
const citationSuspicious = parseCountsFromText(citationVerificationText ?? "", ["suspicious"]);
const citationHallucinated = parseCountsFromText(citationVerificationText ?? "", ["hallucinated"]);
const mainPdfExists = await exists(mainPdfPath);
const reviewIssuesRaw = Array.isArray(reviewIssues?.issues) ? reviewIssues.issues : [];
const openMediumOrHigherIssues = reviewIssuesRaw.filter((issue) => {
  const status = String(issue?.status ?? "").toLowerCase();
  const severity = String(issue?.severity ?? "").toLowerCase();
  return status === "open" && ["critical", "high", "medium"].includes(severity);
}).length;
const currentStage = manifest.current_stage ?? "unknown";
const paperMode =
  manifest.writing_contract?.paper_mode ??
  manifest.writing_contract?.paperMode ??
  "unknown";
const reviewCloseoutChecks = [
  { name: "stage_not_setup", ok: currentStage !== "setup" },
  {
    name: "paper_mode_matches_lane",
    ok:
      (lane === "survey" && paperMode === "survey") ||
      (lane === "experiment" && paperMode === "conference") ||
      lane === "full",
  },
  { name: "main_tex_has_citations", ok: citeCount > 0 },
  { name: "bibliography_nonempty", ok: bibliographyCount > 0 },
  { name: "writing_signals_present", ok: await exists(writingSignalsPath) },
  { name: "review_packet_present", ok: await exists(reviewPacketPath) },
  { name: "review_issues_present", ok: await exists(reviewIssuesPath) },
  { name: "main_pdf_present", ok: mainPdfExists },
  { name: "citation_suspicious_zero", ok: citationSuspicious === 0 },
  { name: "citation_hallucinated_zero", ok: citationHallucinated === 0 },
  { name: "no_open_medium_or_higher_review_issues", ok: openMediumOrHigherIssues === 0 },
];

const paperWordCount = countWords(mainTex);
const sectionBodies = extractLatexSectionBodies(mainTex);
const sectionWordCounts = sectionBodies.map((section) => ({
  title: section.title,
  wordCount: countWords(section.body),
}));
const minPaperWords = lane === "survey" ? 3500 : 2500;
const minSectionWords = lane === "survey" ? 180 : 150;
const placeholderMatches = [
  ...String(mainTex ?? "").matchAll(/\b(TODO|placeholder|dummy|smoke|test-only|lorem ipsum)\b/gi),
].map((match) => match[0].toLowerCase());
const citationKeys = extractCitationKeys(mainTex);
const bibKeys = extractBibKeys(refsBib);
const missingCitationKeys = citationKeys.filter((key) => !bibKeys.has(key));
const paperSourceIndexCount = Array.isArray(paperSourceIndex?.papers)
  ? paperSourceIndex.papers.length
  : Array.isArray(paperSourceIndex?.items)
    ? paperSourceIndex.items.length
    : Array.isArray(paperSourceIndex)
      ? paperSourceIndex.length
      : 0;
const minExperimentCitationKeys = paperSourceIndexCount >= 10 ? 10 : 6;
const minExperimentBibliographyEntries = paperSourceIndexCount >= 10 ? 10 : 6;
const minCitationKeys = lane === "survey" ? 12 : minExperimentCitationKeys;
const minBibliographyEntries = lane === "survey" ? 12 : minExperimentBibliographyEntries;
const fboxFigureCount = (String(mainTex ?? "").match(/\\begin\{figure\}[\s\S]*?\\fbox/g) ?? []).length;
const includedPaperCount = Array.isArray(includedPapers)
  ? includedPapers.length
  : Array.isArray(includedPapers?.papers)
    ? includedPapers.papers.length
    : Array.isArray(includedPapers?.items)
      ? includedPapers.items.length
      : 0;
const sotaMatrixRows = countMarkdownTableRows(sotaMatrix) > 0
  ? Math.max(0, countMarkdownTableRows(sotaMatrix) - 1)
  : 0;
const experimentLedgerCount = Array.isArray(experimentLedger)
  ? experimentLedger.length
  : Array.isArray(experimentLedger?.experiments)
    ? experimentLedger.experiments.length
    : Array.isArray(experimentLedger?.runs)
      ? experimentLedger.runs.length
      : Array.isArray(experimentLedger?.entries)
        ? experimentLedger.entries.length
        : 0;
const experimentResultsText = JSON.stringify(experimentResults ?? {});
const experimentResultsHasMetrics =
  Boolean(experimentResults) && /[-+]?\d+(?:\.\d+)?/.test(experimentResultsText);
const paperMentionsResultEvidence =
  /h[_\s-]?score|accuracy|f1|delta|ablation|baseline|improvement|result/i.test(mainTex ?? "");
const canonicalExperimentResults = [experimentResults, expOneResult]
  .filter(Boolean)
  .sort((left, right) => resultCompletenessScore(right) - resultCompletenessScore(left))[0];
const fixed4 = (value) => (typeof value === "number" && Number.isFinite(value) ? value.toFixed(4) : null);
const resultTableValues = {
  baselineHScore: fixed4(canonicalExperimentResults?.baseline?.h_score),
  baselineKnown: fixed4(canonicalExperimentResults?.baseline?.known_accuracy),
  baselineNovel: fixed4(canonicalExperimentResults?.baseline?.novel_accuracy),
  proposedHScore: fixed4(canonicalExperimentResults?.proposed?.h_score),
  proposedKnown:
    fixed4(canonicalExperimentResults?.proposed?.known_accuracy) ??
    fixed4(canonicalExperimentResults?.metrics?.known_accuracy),
  proposedNovel:
    fixed4(canonicalExperimentResults?.proposed?.novel_accuracy) ??
    fixed4(canonicalExperimentResults?.metrics?.novel_accuracy),
  deltaH:
    fixed4(canonicalExperimentResults?.delta_h) ??
    fixed4(canonicalExperimentResults?.metrics?.delta_h_score),
  minusBalance: fixed4(canonicalExperimentResults?.ablations?.minus_class_balance_debiasing?.h_score),
  minusConsistency: fixed4(canonicalExperimentResults?.ablations?.minus_consistency_filtering?.h_score),
};
const headlineTableMatchesResultSummary =
  !canonicalExperimentResults ||
  [
    resultTableValues.baselineHScore,
    resultTableValues.baselineKnown,
    resultTableValues.baselineNovel,
    resultTableValues.proposedHScore,
    resultTableValues.proposedKnown,
    resultTableValues.proposedNovel,
    resultTableValues.deltaH,
  ].every((value) => value && String(mainTex ?? "").includes(value));
const ablationTableMatchesResultSummary =
  !canonicalExperimentResults ||
  [resultTableValues.minusBalance, resultTableValues.minusConsistency].every((value) =>
    value ? String(mainTex ?? "").includes(value) : true
  );
const figurePackEntries = Array.isArray(figurePack?.entries) ? figurePack.entries : [];
const tablePackEntries = Array.isArray(tablePack?.entries) ? tablePack.entries : [];
const figurePackHasResultProvenance = figurePackEntries.some((entry) =>
  /researcher\/artifacts\/results\/results\.json/.test(String(entry?.data_provenance ?? entry?.source_path ?? ""))
);
const tablePackHasMetricValues = tablePackEntries.some((entry) => entry?.metric_values && typeof entry.metric_values === "object");
const contentQualityChecks = [
  {
    name: "paper_word_count_min",
    ok: paperWordCount >= minPaperWords,
    observed: paperWordCount,
    expected: `>=${minPaperWords}`,
  },
  {
    name: "section_count_min",
    ok: sectionBodies.length >= (lane === "survey" ? 7 : 6),
    observed: sectionBodies.length,
    expected: lane === "survey" ? ">=7" : ">=6",
  },
  {
    name: "sections_have_substance",
    ok:
      sectionWordCounts.length > 0 &&
      sectionWordCounts.every((section) => section.wordCount >= minSectionWords),
    observed: sectionWordCounts,
    expected: `each section >=${minSectionWords} words`,
  },
  {
    name: "no_placeholder_language",
    ok: placeholderMatches.length === 0,
    observed: [...new Set(placeholderMatches)],
    expected: "no TODO/placeholder/dummy/smoke/test-only/lorem ipsum",
  },
  {
    name: "citation_keys_resolve",
    ok: missingCitationKeys.length === 0,
    observed: missingCitationKeys,
    expected: "all citation keys exist in refs.bib",
  },
  {
    name: "citation_density_min",
    ok: citationKeys.length >= minCitationKeys,
    observed: citationKeys.length,
    expected: `>=${minCitationKeys}`,
  },
  {
    name: "bibliography_depth_min",
    ok: bibliographyCount >= minBibliographyEntries,
    observed: bibliographyCount,
    expected: `>=${minBibliographyEntries}`,
  },
  {
    name: "no_fbox_figure_placeholders",
    ok: fboxFigureCount === 0,
    observed: fboxFigureCount,
    expected: 0,
  },
  {
    name: "source_index_bibliography_coverage_min",
    ok: paperSourceIndexCount < 10 || bibliographyCount >= 10,
    observed: { source_index_papers: paperSourceIndexCount, bibliography_entries: bibliographyCount },
    expected: paperSourceIndexCount >= 10 ? "bibliography >=10" : "not required for small or missing source index",
  },
  ...(lane === "survey"
    ? [
        {
          name: "included_paper_count_min",
          ok: includedPaperCount >= 12,
          observed: includedPaperCount,
          expected: ">=12",
        },
        {
          name: "sota_matrix_rows_min",
          ok: sotaMatrixRows >= 8,
          observed: sotaMatrixRows,
          expected: ">=8",
        },
      ]
    : [
        {
          name: "experiment_ledger_nonempty",
          ok: experimentLedgerCount > 0,
          observed: experimentLedgerCount,
          expected: ">0",
        },
        {
          name: "experiment_results_have_metrics",
          ok: experimentResultsHasMetrics,
          observed: experimentResultsHasMetrics,
          expected: true,
        },
        {
          name: "paper_mentions_result_evidence",
          ok: paperMentionsResultEvidence,
          observed: paperMentionsResultEvidence,
          expected: true,
        },
        {
          name: "figure_pack_result_provenance",
          ok: figurePackEntries.length > 0 && figurePackHasResultProvenance,
          observed: { entries: figurePackEntries.length, result_provenance: figurePackHasResultProvenance },
          expected: "FIGURE_PACK entries backed by researcher/artifacts/results/results.json",
        },
        {
          name: "table_pack_metric_values",
          ok: tablePackEntries.length > 0 && tablePackHasMetricValues,
          observed: { entries: tablePackEntries.length, has_metric_values: tablePackHasMetricValues },
          expected: "TABLE_PACK entries include metric_values",
        },
        {
          name: "headline_table_matches_result_summary",
          ok: headlineTableMatchesResultSummary,
          observed: resultTableValues,
          expected: "headline table contains RESULT_SUMMARY values",
        },
        {
          name: "ablation_table_matches_result_summary",
          ok: ablationTableMatchesResultSummary,
          observed: {
            minus_class_balance_debiasing: resultTableValues.minusBalance,
            minus_consistency_filtering: resultTableValues.minusConsistency,
          },
          expected: "ablation table contains RESULT_SUMMARY values",
        },
      ]),
];
const contentQualityStatus = !strictContent
  ? "not_run"
  : contentQualityChecks.every((entry) => entry.ok)
    ? "pass"
    : "fail";

const surveyChecks = [
  "researcher/SURVEY_QUERY_REGISTRY.json",
  "researcher/INCLUDED_PAPERS.json",
  "researcher/EXCLUDED_PAPERS.json",
  "researcher/LITERATURE_REVIEW.md",
  "researcher/SOTA_MATRIX.md",
  "researcher/GAP_SYNTHESIS.md",
  "researcher/COVERAGE_SUMMARY.md",
  "researcher/SURVEY_BRIEF.md",
];
const experimentChecks = [
  "researcher/IDEA_REPORT.md",
  "researcher/IDEA_AUDIT.md",
  "orchestrator/PLAN.md",
  "orchestrator/TODOS.md",
  "orchestrator/PLAN_AUDIT.md",
  "coder/EXPERIMENT_INDEX.md",
  "researcher/EXPERIMENT_LEDGER.json",
  "researcher/artifacts/results",
];
const writingChecks = [
  "academic_writer/PAPER_PLAN.md",
  "academic_writer/story/STORY_SPINE.md",
  "academic_writer/story/CROSS_DOMAIN_STORY_BRIDGE.md",
  "academic_writer/paper/main.tex",
  "academic_writer/paper/refs.bib",
  "reviewer/CITATION_VERIFICATION.md",
];
const crossDomainChecks = [
  "researcher/ideation/CROSS_DOMAIN_BRIDGE_EVIDENCE.json",
  "researcher/ideation/NEURO_COGNITIVE_CONCEPT_MAP.md",
  "researcher/ideation/CROSS_DOMAIN_RECONTEXTUALIZATION.md",
];

const requiredPaths =
  lane === "survey"
    ? [...surveyChecks, ...writingChecks, ...crossDomainChecks]
    : lane === "experiment"
      ? [...experimentChecks, ...writingChecks, ...crossDomainChecks]
      : [...surveyChecks, ...experimentChecks, ...writingChecks, ...crossDomainChecks];

const artifactChecklist = [];
for (const relativePath of requiredPaths) {
  artifactChecklist.push({
    path: relativePath,
    required: true,
    exists: await exists(path.join(projectRoot, relativePath)),
  });
}

const now = new Date().toISOString();
const runId = `${now.replace(/[:.]/g, "")}-${lane}`;
const reportPath = path.join(openclawDir, "E2E_RUN_REPORT.md");
const scorecardPath = path.join(openclawDir, "E2E_RUN_SCORECARD.json");
const progressNarrativePath = path.join(openclawDir, "E2E_PROGRESS_NARRATIVE.md");
const progressChartPath = path.join(openclawDir, "progress_chart.json");
const progressChartHtmlPath = path.join(openclawDir, "progress_chart.html");
const runLedgerPath = path.join(openclawDir, "E2E_RUN_LEDGER.jsonl");
const dashboardPath = path.join(openclawDir, "E2E_DASHBOARD.html");
const benchmarkAdapterScorecardPath = path.join(
  openclawDir,
  "E2E_BENCHMARK_ADAPTER_SCORECARD.json"
);
const domainEvaluatorContractPath = path.join(
  openclawDir,
  "E2E_DOMAIN_EVALUATOR_CONTRACT.json"
);
const platformProfilePath = path.join(openclawDir, "PLATFORM_PROFILE.json");
const checklistPath = path.join(openclawDir, "E2E_ARTIFACT_CHECKLIST.json");
const timelinePath = path.join(openclawDir, "E2E_STATE_TIMELINE.jsonl");
const openIncidents = (incidentsStore.entries ?? []).filter((entry) => entry.status !== "resolved");
const activeHandoffs = (handoffStore.intents ?? []).filter((entry) =>
  ["pending", "queued", "dispatching", "delivered", "acknowledged", "claimed", "activated", "stale_claim"].includes(
    entry.status
  )
);
const failedHandoffs = (handoffStore.intents ?? []).filter((entry) => entry.status === "failed");
const activeRepairs = (repairStore.items ?? []).filter((entry) =>
  ["queued", "claimed", "failed"].includes(entry.status)
);
const activeWriteScopes = (writeScopeStore.claims ?? []).filter(
  (entry) => !entry.releasedAt && Date.parse(entry.leaseExpiresAt ?? 0) > Date.now()
);
const blockingOpenIncidents = openIncidents.filter(isBlockingRuntimeIncident);

const artifactStatus = statusFromChecks(artifactChecklist);
const reviewCloseoutStatus = reviewCloseoutChecks.every((entry) => entry.ok)
  ? "pass"
  : reviewCloseoutChecks.some((entry) => entry.ok)
    ? "partial"
    : "fail";
const finalVerdict =
  artifactStatus === "pass" &&
  reviewCloseoutStatus === "pass" &&
  contentQualityStatus !== "fail" &&
  blockingOpenIncidents.length === 0 &&
  activeRepairs.length === 0
    ? "pass"
    : artifactStatus === "fail" || contentQualityStatus === "fail"
    ? "fail"
    : "partial";

const runtimeSafetyChecks = [
  {
    name: "no_blocking_open_incidents",
    ok: blockingOpenIncidents.length === 0,
    observed: blockingOpenIncidents.length,
    expected: 0,
  },
  {
    name: "no_active_repairs",
    ok: activeRepairs.length === 0,
    observed: activeRepairs.length,
    expected: 0,
  },
  {
    name: "no_failed_handoffs",
    ok: failedHandoffs.length === 0,
    observed: failedHandoffs.length,
    expected: 0,
  },
  {
    name: "no_active_write_scope_leaks",
    ok: activeWriteScopes.length === 0,
    observed: activeWriteScopes.length,
    expected: 0,
  },
];
const artifactCoverageRatio =
  artifactChecklist.length === 0
    ? 1
    : artifactChecklist.filter((entry) => entry.exists).length / artifactChecklist.length;
const reviewCloseoutRatio = passRatio(reviewCloseoutChecks);
const contentSubstanceRatio = passRatio(contentQualityChecks);
const runtimeSafetyRatio = passRatio(runtimeSafetyChecks);
const scoreComponents = [
  {
    name: "artifact_coverage",
    weight: 0.2,
    score: artifactCoverageRatio,
    score_100: score100(artifactCoverageRatio),
    status: artifactStatus,
  },
  {
    name: "review_closeout",
    weight: 0.2,
    score: reviewCloseoutRatio,
    score_100: score100(reviewCloseoutRatio),
    status: reviewCloseoutStatus,
  },
  {
    name: "content_substance",
    weight: 0.4,
    score: contentSubstanceRatio,
    score_100: score100(contentSubstanceRatio),
    status: contentQualityStatus,
    enforced: strictContent,
  },
  {
    name: "runtime_safety",
    weight: 0.2,
    score: runtimeSafetyRatio,
    score_100: score100(runtimeSafetyRatio),
    status: runtimeSafetyChecks.every((entry) => entry.ok) ? "pass" : "partial",
  },
];
const baselineScore = readNestedNumber(canonicalExperimentResults, [
  ["baseline", "h_score"],
  ["baseline", "score"],
  ["metrics", "baseline_h_score"],
  ["metrics", "baseline_score"],
]);
const proposedScore = readNestedNumber(canonicalExperimentResults, [
  ["proposed", "h_score"],
  ["proposed", "score"],
  ["metrics", "h_score"],
  ["metrics", "score"],
]);
const holdoutScore = readNestedNumber(canonicalExperimentResults, [
  ["holdout", "h_score"],
  ["holdout", "score"],
  ["metrics", "holdout_h_score"],
  ["metrics", "holdout_score"],
]);
const bestScore = [baselineScore, proposedScore, holdoutScore]
  .filter((value) => typeof value === "number" && Number.isFinite(value))
  .sort((left, right) => right - left)[0] ?? null;
const reproducibilityPass =
  artifactStatus === "pass" &&
  mainPdfExists &&
  (lane === "survey" || (experimentLedgerCount > 0 && experimentResultsHasMetrics));
const resultBackedFigureTablePass =
  lane === "survey" ||
  (figurePackEntries.length > 0 &&
    figurePackHasResultProvenance &&
    tablePackEntries.length > 0 &&
    tablePackHasMetricValues &&
    headlineTableMatchesResultSummary &&
    ablationTableMatchesResultSummary);
const benchmarkAdapter = buildBenchmarkAdapterScorecard({
  generatedAt: now,
  rawFixture: benchmarkAdapterFixture,
  fixturePath: benchmarkAdapterFixturePath,
  lane,
  canonicalExperimentResults,
  baselineScore,
  proposedScore,
  holdoutScore,
  bestScore,
  experimentLedgerCount,
});
const domainEvaluator = buildDomainEvaluatorContract({
  generatedAt: now,
  lane,
  manifest,
  mainTex,
  artifactChecklist,
  extraArtifactPresence: {
    "academic_writer/FIGURE_PACK.json": figurePackEntries.length > 0,
    "academic_writer/TABLE_PACK.json": tablePackEntries.length > 0,
  },
  bibliographyCount,
  includedPaperCount,
  sotaMatrixRows,
  experimentLedgerCount,
  experimentResultsHasMetrics,
  resultBackedFigureTablePass,
  baselineScore: benchmarkAdapter.baseline_score ?? baselineScore,
  proposedScore: benchmarkAdapter.candidate_score ?? proposedScore,
  holdoutScore: benchmarkAdapter.holdout_score ?? holdoutScore,
});
benchmarkAdapter.guardrail.domain_evaluator_status = domainEvaluator.status;
benchmarkAdapter.guardrail.score_claim_usable =
  benchmarkAdapter.status === "pass" && domainEvaluator.status === "pass";
const platformProfile = buildPlatformProfile({ generatedAt: now });
const papernexusCertification =
  papernexusTaskCertification && typeof papernexusTaskCertification === "object"
    ? {
        path: papernexusTaskCertificationPath,
        status: papernexusTaskCertification.status ?? "unknown",
        claim_level: papernexusTaskCertification.claim_level ?? "none",
        source_backed_graph_claim:
          papernexusTaskCertification.source_backed_graph_claim === true,
        graph_status: papernexusTaskCertification.graph?.status ?? null,
        verification_mode:
          papernexusTaskCertification.graph?.verification_mode ?? null,
        evidence_mode:
          papernexusTaskCertification.mcp_contract?.evidence_mode ?? null,
        limitations: Array.isArray(papernexusTaskCertification.limitations)
          ? papernexusTaskCertification.limitations
          : [],
      }
    : {
        path: papernexusTaskCertificationPath,
        status: "missing",
        claim_level: "none",
        source_backed_graph_claim: false,
        graph_status: null,
        verification_mode: null,
        evidence_mode: null,
        limitations: [],
      };
const claimStrengthCap =
  finalVerdict === "fail"
    ? "blocked"
    : strictContent && contentQualityStatus !== "pass"
      ? "exploratory_only"
      : !strictContent
        ? "artifact_complete_content_unscored"
        : !resultBackedFigureTablePass
          ? "artifact_complete_result_links_weak"
          : finalVerdict === "pass"
            ? "evidence_backed"
            : "partial";
const failedRequiredChecks = failedCheckRecords([
  {
    name: "artifacts",
    checks: artifactChecklist.map((entry) => ({
      name: entry.path,
      ok: entry.exists,
      observed: entry.exists,
      expected: "exists",
    })),
  },
  {
    name: "review_closeout",
    checks: reviewCloseoutChecks.map((entry) => ({
      ...entry,
      observed: entry.ok,
      expected: true,
    })),
  },
  {
    name: "content_substance",
    checks: strictContent ? contentQualityChecks : [],
  },
  {
    name: "runtime_safety",
    checks: runtimeSafetyChecks,
  },
]);
const diagnosticContentFailures = strictContent
  ? []
  : failedCheckRecords([{ name: "content_substance_diagnostic", checks: contentQualityChecks }]);
const nextActions = [];
if (artifactStatus !== "pass") {
  nextActions.push("materialize missing required artifacts before claiming workflow completion");
}
if (reviewCloseoutStatus !== "pass") {
  nextActions.push("rerun reviewer closeout and resolve citation/review issues");
}
if (strictContent && contentQualityStatus !== "pass") {
  nextActions.push("expand paper substance, citation depth, and result-grounded figure/table evidence");
}
if (!strictContent && diagnosticContentFailures.length > 0) {
  nextActions.push("rerun the harness with --strict-content before treating the paper as publication-ready");
}
if (
  papernexusCertification.status !== "missing" &&
  papernexusCertification.status !== "ready"
) {
  nextActions.push("complete PaperNexus task certification with per-paper source-backed graph evidence");
}
if (benchmarkAdapter.status === "missing") {
  nextActions.push("attach a benchmark adapter fixture or experiment result metrics to the E2E scorecard");
}
if (domainEvaluator.status !== "pass") {
  nextActions.push(`complete ${domainEvaluator.pack} evaluator requirements before strengthening claims`);
}
if (lane !== "survey" && !resultBackedFigureTablePass) {
  nextActions.push("refresh figure/table packs from researcher/artifacts/results before final paper closeout");
}
if (blockingOpenIncidents.length > 0 || activeRepairs.length > 0) {
  nextActions.push("clear blocking runtime incidents and repair queue entries");
}
if (nextActions.length === 0) {
  nextActions.push("none");
}
const scorecard = {
  schema_version: 1,
  generated_at: now,
  project: {
    project_id: manifest.project_id ?? path.basename(projectRoot),
    project_root: projectRoot,
    lane,
    task_type: lane,
    current_stage: manifest.current_stage ?? "unknown",
    owner_agent: manifest.owner_agent ?? "unknown",
    paper_mode: paperMode,
  },
  verdict: {
    final_verdict: finalVerdict,
    artifact_status: artifactStatus,
    review_closeout_status: reviewCloseoutStatus,
    content_quality_status: contentQualityStatus,
    claim_strength_cap: claimStrengthCap,
  },
  quality_score: {
    score_100: weightedScore100(scoreComponents),
    components: scoreComponents,
  },
  minimal_scorecard: {
    task_type: lane,
    baseline_score: benchmarkAdapter.baseline_score ?? baselineScore,
    best_score: benchmarkAdapter.best_score ?? bestScore,
    holdout_score: benchmarkAdapter.holdout_score ?? holdoutScore,
    iterations: benchmarkAdapter.iterations ?? (experimentLedgerCount || null),
    wall_time_seconds: benchmarkAdapter.wall_time_seconds,
    cost_usd: benchmarkAdapter.cost_usd,
    artifact_count: artifactChecklist.filter((entry) => entry.exists).length,
    reviewer_score: score100(reviewCloseoutRatio),
    reproducibility_pass: reproducibilityPass,
    safety_incidents: blockingOpenIncidents.length,
  },
  paper_quality: {
    strict_content: strictContent,
    word_count: paperWordCount,
    section_count: sectionBodies.length,
    citation_key_count: citationKeys.length,
    bibliography_count: bibliographyCount,
    source_index_paper_count: paperSourceIndexCount,
    figure_pack_entries: figurePackEntries.length,
    table_pack_entries: tablePackEntries.length,
    result_backed_figure_table_pass: resultBackedFigureTablePass,
    checks: contentQualityChecks,
  },
  evidence_coverage: {
    included_paper_count: includedPaperCount,
    sota_matrix_rows: sotaMatrixRows,
    experiment_ledger_count: experimentLedgerCount,
    experiment_results_have_metrics: experimentResultsHasMetrics,
    paper_mentions_result_evidence: paperMentionsResultEvidence,
    headline_table_matches_result_summary: headlineTableMatchesResultSummary,
    ablation_table_matches_result_summary: ablationTableMatchesResultSummary,
    figure_pack_result_provenance: figurePackHasResultProvenance,
    table_pack_metric_values: tablePackHasMetricValues,
  },
  runtime_safety: {
    open_incidents: openIncidents.length,
    blocking_open_incidents: blockingOpenIncidents.length,
    active_handoffs: activeHandoffs.length,
    failed_handoffs: failedHandoffs.length,
    active_repairs: activeRepairs.length,
    active_write_scopes: activeWriteScopes.length,
    checks: runtimeSafetyChecks,
  },
  papernexus_certification: papernexusCertification,
  benchmark_adapter: benchmarkAdapter,
  domain_evaluator: domainEvaluator,
  platform_profile: {
    path: platformProfilePath,
    runtime: platformProfile.runtime,
    capability_matrix: platformProfile.capability_matrix,
  },
  failed_required_checks: failedRequiredChecks,
  diagnostic_failed_checks: diagnosticContentFailures,
  next_actions: nextActions,
};

const timeline = [
  ...events.map((entry) => ({
    source: "runtime",
    at: entry.recordedAt ?? entry.createdAt ?? null,
    kind: entry.kind ?? null,
    summary: entry.summary ?? null,
    stage: entry.stage ?? null,
  })),
  ...handoffEvents.map((entry) => ({
    source: "handoff",
    at: entry.recordedAt ?? null,
    kind: entry.kind ?? null,
    summary: entry.summary ?? null,
    status: entry.toStatus ?? null,
  })),
].sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")));

const progressTimelinePoints = buildProgressPoints(timeline, {
  generatedAt: now,
  currentStage,
  finalVerdict,
  claimStrengthCap,
});
const progressChart = {
  schema_version: 1,
  generated_at: now,
  project: scorecard.project,
  verdict: scorecard.verdict,
  summary: {
    quality_score_100: scorecard.quality_score.score_100,
    artifact_status: artifactStatus,
    review_closeout_status: reviewCloseoutStatus,
    content_quality_status: contentQualityStatus,
    runtime_safety_status: runtimeSafetyChecks.every((entry) => entry.ok) ? "pass" : "partial",
    papernexus_certification_status: papernexusCertification.status,
    papernexus_claim_level: papernexusCertification.claim_level,
    papernexus_source_backed_graph_claim:
      papernexusCertification.source_backed_graph_claim,
    benchmark_adapter_status: benchmarkAdapter.status,
    domain_evaluator_status: domainEvaluator.status,
    domain_evaluator_pack: domainEvaluator.pack,
    platform_profile_os: platformProfile.runtime.platform,
    artifact_count: artifactChecklist.filter((entry) => entry.exists).length,
    missing_artifact_count: artifactChecklist.filter((entry) => entry.required && !entry.exists).length,
    failed_required_check_count: failedRequiredChecks.length,
    diagnostic_failed_check_count: diagnosticContentFailures.length,
  },
  quality_components: scoreComponents.map((component) => ({
    name: component.name,
    weight: component.weight,
    score_100: component.score_100,
    status: component.status,
  })),
  timeline_points: progressTimelinePoints,
  annotations: buildProgressAnnotations(scorecard, progressTimelinePoints),
  linked_artifacts: {
    report_path: reportPath,
    scorecard_path: scorecardPath,
    narrative_path: progressNarrativePath,
    timeline_path: timelinePath,
    papernexus_task_certification_path: papernexusCertification.path,
    benchmark_adapter_scorecard_path: benchmarkAdapterScorecardPath,
    domain_evaluator_contract_path: domainEvaluatorContractPath,
    platform_profile_path: platformProfilePath,
    run_ledger_path: runLedgerPath,
    dashboard_path: dashboardPath,
  },
};
const progressChartHtml = buildProgressChartHtml(progressChart);
const runLedgerEntry = buildRunLedgerEntry({
  runId,
  scorecard,
  progressChart,
  linkedArtifacts: progressChart.linked_artifacts,
});
const runLedgerEntries = [...(await listJsonl(runLedgerPath)), runLedgerEntry];
const dashboardHtml = buildE2EDashboardHtml({
  openclawDir,
  scorecard,
  progressChart,
  runLedgerEntries,
});

const report = `# E2E Run Report

- lane: ${lane}
- project_id: ${manifest.project_id ?? path.basename(projectRoot)}
- project_root: ${projectRoot}
- generated_at: ${now}
- current_stage: ${manifest.current_stage ?? "unknown"}
- owner_agent: ${manifest.owner_agent ?? "unknown"}
- paper_mode: ${manifest.writing_contract?.paper_mode ?? manifest.writing_contract?.paperMode ?? "unknown"}
- PaperNexus mode: ${manifest.papernexus_access?.mode ?? manifest.paper_ingestion?.papernexus_access_mode ?? "unknown"}
- cite_count: ${citeCount}
- section_count: ${sectionCount}
- bibliography_count: ${bibliographyCount}
- strict_content: ${strictContent}
- paper_word_count: ${paperWordCount}
- final_verdict: ${finalVerdict}
- quality_score_100: ${scorecard.quality_score.score_100 ?? "unknown"}
- claim_strength_cap: ${claimStrengthCap}
- progress_chart: ${progressChartHtmlPath}
- dashboard: ${dashboardPath}
- run_ledger: ${runLedgerPath}

## PaperNexus Task Certification

- status: ${papernexusCertification.status}
- claim_level: ${papernexusCertification.claim_level}
- source_backed_graph_claim: ${papernexusCertification.source_backed_graph_claim}
- graph_status: ${papernexusCertification.graph_status ?? "unknown"}
- verification_mode: ${papernexusCertification.verification_mode ?? "unknown"}
- evidence_mode: ${papernexusCertification.evidence_mode ?? "unknown"}
- limitations: ${papernexusCertification.limitations.length > 0 ? papernexusCertification.limitations.join(", ") : "none"}
- path: ${papernexusCertification.path}

## Benchmark Adapter

- status: ${benchmarkAdapter.status}
- source: ${benchmarkAdapter.source}
- adapter: ${benchmarkAdapter.adapter}
- benchmark_id: ${benchmarkAdapter.benchmark_id ?? "unknown"}
- metric: ${benchmarkAdapter.metric}
- baseline_score: ${benchmarkAdapter.baseline_score ?? "unknown"}
- candidate_score: ${benchmarkAdapter.candidate_score ?? "unknown"}
- holdout_score: ${benchmarkAdapter.holdout_score ?? "unknown"}
- score_claim_usable: ${benchmarkAdapter.guardrail.score_claim_usable}

## Domain Evaluator

- status: ${domainEvaluator.status}
- pack: ${domainEvaluator.pack}
- metrics: ${domainEvaluator.metrics.join(", ")}
- holdout: ${domainEvaluator.holdout}
- claim_guardrail: ${domainEvaluator.claim_guardrail}

## Platform Profile

- os: ${platformProfile.runtime.platform}
- arch: ${platformProfile.runtime.arch}
- node: ${platformProfile.runtime.node}
- cpu_threads: ${platformProfile.runtime.cpu_threads ?? "unknown"}
- memory_gb: ${platformProfile.runtime.total_memory_gb}
- cuda: ${platformProfile.capability_matrix.cuda.status}
- mlx: ${platformProfile.capability_matrix.mlx.status}
- webgpu: ${platformProfile.capability_matrix.webgpu.status}

## Artifact Coverage

- required: ${artifactChecklist.filter((entry) => entry.required).length}
- present: ${artifactChecklist.filter((entry) => entry.exists).length}
- status: ${artifactStatus}

## Review Closeout

- status: ${reviewCloseoutStatus}
- open_medium_or_higher_review_issues: ${openMediumOrHigherIssues}
- citation_suspicious: ${citationSuspicious}
- citation_hallucinated: ${citationHallucinated}

${reviewCloseoutChecks.map((entry) => `- [${entry.ok ? "x" : " "}] ${entry.name}`).join("\n")}

## Content Substance

- status: ${contentQualityStatus}
- minimum_paper_words: ${strictContent ? minPaperWords : "not enforced"}
- minimum_section_words: ${strictContent ? minSectionWords : "not enforced"}

${contentQualityChecks
  .map((entry) => `- [${entry.ok ? "x" : " "}] ${entry.name}: observed=${JSON.stringify(entry.observed)} expected=${JSON.stringify(entry.expected)}`)
  .join("\n")}

## Handoff Summary

\`\`\`json
${JSON.stringify(countBy(handoffStore.intents ?? [], "status"), null, 2)}
\`\`\`

## Repair Queue Summary

\`\`\`json
${JSON.stringify(countBy(repairStore.items ?? [], "status"), null, 2)}
\`\`\`

## Runtime Safety

- open incidents: ${openIncidents.length}
- blocking open incidents: ${blockingOpenIncidents.length}
- active handoffs: ${activeHandoffs.length}
- failed handoffs: ${failedHandoffs.length}
- active repairs: ${activeRepairs.length}
- capability warnings: ${(capabilityStore.records ?? []).filter((entry) => entry.confidence === "low" || Date.parse(entry.expiresAt ?? 0) <= Date.now()).length}
- active write scopes: ${activeWriteScopes.length}

## Generated Paper Files

${artifactChecklist
  .filter((entry) => /academic_writer\/paper|academic_writer\/story|PAPER_PLAN/.test(entry.path))
  .map((entry) => `- [${entry.exists ? "x" : " "}] ${entry.path}`)
  .join("\n")}

## Missing Required Artifacts

${artifactChecklist
  .filter((entry) => entry.required && !entry.exists)
  .map((entry) => `- ${entry.path}`)
  .join("\n") || "- none"}
`;

const progressNarrative = `# E2E Progress Narrative

- generated_at: ${now}
- lane: ${lane}
- project_id: ${manifest.project_id ?? path.basename(projectRoot)}
- final_verdict: ${finalVerdict}
- claim_strength_cap: ${claimStrengthCap}
- quality_score_100: ${scorecard.quality_score.score_100 ?? "unknown"}
- dashboard: ${dashboardPath}
- run_ledger: ${runLedgerPath}

## Current State

- current_stage: ${manifest.current_stage ?? "unknown"}
- owner_agent: ${manifest.owner_agent ?? "unknown"}
- paper_mode: ${paperMode}
- artifact_status: ${artifactStatus}
- review_closeout_status: ${reviewCloseoutStatus}
- content_quality_status: ${contentQualityStatus}

## Evidence Snapshot

- bibliography_entries: ${bibliographyCount}
- citation_keys: ${citationKeys.length}
- paper_source_index_papers: ${paperSourceIndexCount}
- included_papers: ${includedPaperCount}
- experiment_ledger_entries: ${experimentLedgerCount}
- figure_pack_entries: ${figurePackEntries.length}
- table_pack_entries: ${tablePackEntries.length}
- result_backed_figure_table_pass: ${resultBackedFigureTablePass}
- papernexus_certification_status: ${papernexusCertification.status}
- papernexus_claim_level: ${papernexusCertification.claim_level}
- papernexus_source_backed_graph_claim: ${papernexusCertification.source_backed_graph_claim}
- benchmark_adapter_status: ${benchmarkAdapter.status}
- benchmark_adapter_metric: ${benchmarkAdapter.metric}
- benchmark_candidate_score: ${benchmarkAdapter.candidate_score ?? "unknown"}
- domain_evaluator_pack: ${domainEvaluator.pack}
- domain_evaluator_status: ${domainEvaluator.status}
- platform_profile_os: ${platformProfile.runtime.platform}

## Runtime Safety

- open_incidents: ${openIncidents.length}
- blocking_open_incidents: ${blockingOpenIncidents.length}
- active_handoffs: ${activeHandoffs.length}
- failed_handoffs: ${failedHandoffs.length}
- active_repairs: ${activeRepairs.length}

## Failed Required Checks

${markdownBullets(failedRequiredChecks.map((entry) => `${entry.group}.${entry.name}: observed=${JSON.stringify(entry.observed)} expected=${JSON.stringify(entry.expected)}`))}

## Diagnostic Content Gaps

${markdownBullets(diagnosticContentFailures.map((entry) => `${entry.group}.${entry.name}: observed=${JSON.stringify(entry.observed)} expected=${JSON.stringify(entry.expected)}`))}

## Next Actions

${markdownBullets(nextActions)}
`;

await fs.writeFile(reportPath, report, "utf8");
await fs.writeFile(
  scorecardPath,
  `${JSON.stringify(scorecard, null, 2)}\n`,
  "utf8"
);
await fs.writeFile(progressNarrativePath, progressNarrative, "utf8");
await fs.writeFile(
  progressChartPath,
  `${JSON.stringify(progressChart, null, 2)}\n`,
  "utf8"
);
await fs.writeFile(progressChartHtmlPath, progressChartHtml, "utf8");
await fs.appendFile(runLedgerPath, `${JSON.stringify(runLedgerEntry)}\n`, "utf8");
await fs.writeFile(dashboardPath, dashboardHtml, "utf8");
await fs.writeFile(
  benchmarkAdapterScorecardPath,
  `${JSON.stringify(benchmarkAdapter, null, 2)}\n`,
  "utf8"
);
await fs.writeFile(
  domainEvaluatorContractPath,
  `${JSON.stringify(domainEvaluator, null, 2)}\n`,
  "utf8"
);
await fs.writeFile(
  platformProfilePath,
  `${JSON.stringify(platformProfile, null, 2)}\n`,
  "utf8"
);
await fs.writeFile(
  checklistPath,
  `${JSON.stringify(
    {
      generated_at: now,
      lane,
      final_verdict: finalVerdict,
      quality_score_100: scorecard.quality_score.score_100,
      claim_strength_cap: claimStrengthCap,
      strict_content: strictContent,
      content_quality: {
        status: contentQualityStatus,
        paper_word_count: paperWordCount,
        section_word_counts: sectionWordCounts,
        checks: contentQualityChecks,
      },
      runtime_safety: {
        open_incidents: openIncidents.length,
        blocking_open_incidents: blockingOpenIncidents.length,
        active_handoffs: activeHandoffs.length,
        failed_handoffs: failedHandoffs.length,
        active_repairs: activeRepairs.length,
        active_write_scopes: activeWriteScopes.length,
      },
      artifacts: artifactChecklist,
    },
    null,
    2
  )}\n`,
  "utf8"
);
await fs.writeFile(
  timelinePath,
  `${timeline.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      projectRoot,
      lane,
      finalVerdict,
      strictContent,
      contentQuality: {
        status: contentQualityStatus,
        paperWordCount,
        sectionWordCounts,
        checks: contentQualityChecks,
      },
      runtimeSafety: {
        openIncidents: openIncidents.length,
        blockingOpenIncidents: blockingOpenIncidents.length,
        activeHandoffs: activeHandoffs.length,
        failedHandoffs: failedHandoffs.length,
        activeRepairs: activeRepairs.length,
        activeWriteScopes: activeWriteScopes.length,
      },
      reportPath,
      scorecardPath,
      progressNarrativePath,
      progressChartPath,
      progressChartHtmlPath,
      runLedgerPath,
      dashboardPath,
      benchmarkAdapterScorecardPath,
      domainEvaluatorContractPath,
      platformProfilePath,
      checklistPath,
      timelinePath,
      qualityScore100: scorecard.quality_score.score_100,
      claimStrengthCap,
      scorecard,
      progressChart,
      runLedgerEntry,
      benchmarkAdapter,
      domainEvaluator,
      platformProfile,
    },
    null,
    2
  )
);
