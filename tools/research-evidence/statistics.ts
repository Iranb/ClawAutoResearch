import path from "node:path";
import {
  normalizeStatisticalEvidenceState,
  serializeStatisticalEvidenceState,
} from "../research-contracts/evidence-contracts.ts";
import {
  nowIso,
  readProjectJson,
  readProjectManifest,
  writeProjectJson,
  writeProjectManifest,
  writeProjectText,
} from "../research-contracts/core/project-io.ts";
import { normalizeExperimentSearchSpec } from "../workflow-guard-state/experiment-search-spec.ts";
import { normalizeResearchProgramState } from "../workflow-guard-state/research-program.ts";

type LedgerExperiment = Record<string, unknown>;
type GroupStats = {
  group: string;
  count: number;
  mean: number | null;
  std: number | null;
  ci95: [number, number] | null;
  values: number[];
};

function numericValues(values: unknown[]): number[] {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function sampleStd(values: number[]): number | null {
  if (values.length < 2) {
    return null;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function ci95(values: number[]): [number, number] | null {
  if (values.length < 2) {
    return null;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const std = sampleStd(values);
  if (std == null) {
    return null;
  }
  const margin = 1.96 * (std / Math.sqrt(values.length));
  return [mean - margin, mean + margin];
}

function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function inferGroupName(exp: LedgerExperiment): string {
  const explicit =
    (typeof exp.comparisonGroup === "string" && exp.comparisonGroup) ||
    (typeof exp.comparison_group === "string" && exp.comparison_group) ||
    (typeof exp.variantRole === "string" && exp.variantRole) ||
    (typeof exp.variant_role === "string" && exp.variant_role);
  if (explicit) {
    return explicit.toLowerCase();
  }
  const name = [
    exp.name,
    exp.summary,
    exp.configRef,
    exp.config_ref,
    exp.hypothesis,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (/\bbaseline\b/.test(name)) {
    return "baseline";
  }
  if (/\bproposed\b|\bmethod\b|\bcandidate\b|\bvariant\b/.test(name)) {
    return "proposed";
  }
  return "all_completed";
}

async function extractMetricValue(
  projectRoot: string,
  exp: LedgerExperiment,
  metricName: string | null
): Promise<number | null> {
  if (metricName && exp.metrics && typeof exp.metrics === "object" && !Array.isArray(exp.metrics)) {
    const value = (exp.metrics as Record<string, unknown>)[metricName];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  if (exp.keyMetric && typeof exp.keyMetric === "object" && !Array.isArray(exp.keyMetric)) {
    const keyMetric = exp.keyMetric as Record<string, unknown>;
    if (
      (!metricName || keyMetric.name === metricName) &&
      typeof keyMetric.value === "number" &&
      Number.isFinite(keyMetric.value)
    ) {
      return keyMetric.value;
    }
  }
  const resultPaths = Array.isArray(exp.resultPaths)
    ? exp.resultPaths
    : Array.isArray(exp.result_paths)
      ? exp.result_paths
      : [];
  for (const resultPath of resultPaths) {
    if (typeof resultPath !== "string") {
      continue;
    }
    const result = await readProjectJson<Record<string, unknown>>(projectRoot, resultPath);
    if (!result) {
      continue;
    }
    if (metricName && typeof result[metricName] === "number") {
      return result[metricName] as number;
    }
    if (result.metrics && typeof result.metrics === "object" && !Array.isArray(result.metrics)) {
      const nested = (result.metrics as Record<string, unknown>)[metricName ?? ""];
      if (typeof nested === "number") {
        return nested;
      }
    }
  }
  return null;
}

function computeGroupStats(group: string, values: number[]): GroupStats {
  return {
    group,
    count: values.length,
    mean: mean(values),
    std: sampleStd(values),
    ci95: ci95(values),
    values,
  };
}

export async function materializeStatisticalEvidence(params: {
  projectRoot: string;
  patch?: Record<string, unknown>;
}) {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = normalizeStatisticalEvidenceState(manifest.statistical_evidence);
  const patch = params.patch ?? {};
  const searchSpec = normalizeExperimentSearchSpec(
    (await readProjectJson(params.projectRoot, "planner/EXPERIMENT_SEARCH_SPEC.json")) ?? {}
  );
  const researchProgram = normalizeResearchProgramState(manifest.research_program);
  const primaryMetric =
    searchSpec.primaryMetricContract.metricName ?? researchProgram.primaryMetric ?? null;
  const ledger = await readProjectJson<Record<string, unknown>>(
    params.projectRoot,
    "researcher/EXPERIMENT_LEDGER.json"
  );
  const experiments = Array.isArray(ledger?.experiments)
    ? (ledger?.experiments as LedgerExperiment[])
    : [];
  const completed = experiments.filter((exp) => exp.status === "completed");
  const byGroup = new Map<string, number[]>();
  for (const exp of completed) {
    const metricValue = await extractMetricValue(params.projectRoot, exp, primaryMetric);
    if (metricValue == null) {
      continue;
    }
    const group = inferGroupName(exp);
    const bucket = byGroup.get(group) ?? [];
    bucket.push(metricValue);
    byGroup.set(group, bucket);
    const allBucket = byGroup.get("all_completed") ?? [];
    allBucket.push(metricValue);
    byGroup.set("all_completed", allBucket);
  }
  const groups = Array.from(byGroup.entries()).map(([group, values]) =>
    computeGroupStats(group, numericValues(values))
  );
  const significantResultCount = groups.filter((group) => group.count >= 3).length;
  const insufficientSeedCount = groups.filter((group) => group.count > 0 && group.count < 3).length;
  const claimStrengthStatus =
    groups.some((group) => group.group === "proposed" && group.count >= 3)
      ? "strong"
      : groups.some((group) => group.count >= 3)
        ? "moderate"
        : groups.length > 0
          ? "weak"
          : "missing";

  const defaultAggregatePath = current.aggregatePath ?? "analyzer/STATISTICAL_EVIDENCE.json";
  const aggregatePath =
    (typeof patch.aggregate_path === "string" && patch.aggregate_path) ||
    (typeof patch.aggregatePath === "string" && patch.aggregatePath) ||
    defaultAggregatePath;
  const defaultSummaryPath =
    current.summaryPath ?? "analyzer/STATISTICAL_EVIDENCE_SUMMARY.md";
  const summaryPath =
    (typeof patch.summary_path === "string" && patch.summary_path) ||
    (typeof patch.summaryPath === "string" && patch.summaryPath) ||
    defaultSummaryPath;
  const defaultClaimConfidenceMapPath =
    current.claimConfidenceMapPath ?? "analyzer/CLAIM_CONFIDENCE_MAP.json";
  const claimConfidenceMapPath =
    (typeof patch.claim_confidence_map_path === "string" && patch.claim_confidence_map_path) ||
    (typeof patch.claimConfidenceMapPath === "string" && patch.claimConfidenceMapPath) ||
    defaultClaimConfidenceMapPath;
  await writeProjectJson(params.projectRoot, aggregatePath, {
    schemaVersion: 1,
    generatedAt: nowIso(),
    primaryMetric,
    groups,
  });
  await writeProjectJson(params.projectRoot, claimConfidenceMapPath, {
    schemaVersion: 1,
    generatedAt: nowIso(),
    claimStrengthStatus,
    primaryMetric,
    groups: groups.map((group) => ({
      group: group.group,
      count: group.count,
      mean: group.mean,
      ci95: group.ci95,
    })),
  });
  const summaryLines = [
    "# Statistical Evidence Summary",
    "",
    `- Primary metric: ${primaryMetric ?? "unknown"}`,
    `- Completed experiments with numeric metrics: ${groups.find((group) => group.group === "all_completed")?.count ?? 0}`,
    `- Significant-ready groups (n>=3): ${significantResultCount}`,
    `- Under-seeded groups (0<n<3): ${insufficientSeedCount}`,
    `- Claim strength status: ${claimStrengthStatus}`,
    "",
    "## Group Summary",
    ...groups.map((group) =>
      `- ${group.group}: n=${group.count}, mean=${group.mean?.toFixed(4) ?? "NA"}, std=${group.std?.toFixed(4) ?? "NA"}, ci95=${group.ci95 ? `[${group.ci95[0].toFixed(4)}, ${group.ci95[1].toFixed(4)}]` : "NA"}`
    ),
  ];
  await writeProjectText(params.projectRoot, summaryPath, `${summaryLines.join("\n")}\n`);

  const next = normalizeStatisticalEvidenceState({
    ...serializeStatisticalEvidenceState(current),
    schema_version: 2,
    status:
      (typeof patch.status === "string" && patch.status) ||
      (groups.length > 0 ? "ready" : "missing"),
    aggregate_path: aggregatePath,
    summary_path: summaryPath,
    claim_confidence_map_path: claimConfidenceMapPath,
    claim_strength_status:
      (typeof patch.claim_strength_status === "string" && patch.claim_strength_status) ||
      (typeof patch.claimStrengthStatus === "string" && patch.claimStrengthStatus) ||
      claimStrengthStatus,
    significant_result_count:
      (typeof patch.significant_result_count === "number" && patch.significant_result_count) ||
      (typeof patch.significantResultCount === "number" && patch.significantResultCount) ||
      significantResultCount,
    insufficient_seed_count:
      (typeof patch.insufficient_seed_count === "number" && patch.insufficient_seed_count) ||
      (typeof patch.insufficientSeedCount === "number" && patch.insufficientSeedCount) ||
      insufficientSeedCount,
    pending_reason:
      (typeof patch.pending_reason === "string" && patch.pending_reason) ||
      (typeof patch.pendingReason === "string" && patch.pendingReason) ||
      groups.length > 0
        ? insufficientSeedCount > 0
          ? "Some comparison groups still have fewer than three completed runs."
          : null
        : "No completed experiments with numeric metrics could be aggregated from EXPERIMENT_LEDGER.json.",
    last_materialized_at: nowIso(),
  });
  manifest.statistical_evidence = serializeStatisticalEvidenceState(next);
  await writeProjectManifest(params.projectRoot, manifest);
  return next;
}
