import {
  asRecord,
  asStringArray,
  pickNumber,
  pickString,
} from "./workflow-guard-core/coercion";
import type { ExperimentSearchSpecLike } from "./workflow-guard-state/experiment-search-spec";

export type ExperimentMetricDirection = "higher_is_better" | "lower_is_better";
export type ExperimentMetricContractSource = "search_spec" | "manifest" | "fallback";

export type ExperimentPrimaryMetricContract = {
  metricName: string | null;
  metricNameSource: ExperimentMetricContractSource | null;
  direction: ExperimentMetricDirection | null;
  directionSource: ExperimentMetricContractSource | null;
  minimumImprovement: number | null;
  minimumImprovementSource: ExperimentMetricContractSource | null;
  primaryEvidence: string[];
  paperContributionMetric: string | null;
  paperContributionMetricSource: ExperimentMetricContractSource | null;
};

function normalizeMetricDirection(value: unknown): ExperimentMetricDirection | null {
  const normalized =
    typeof value === "string"
      ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")
      : "";
  if (
    [
      "lower_is_better",
      "minimize",
      "minimise",
      "lower",
      "decrease",
      "decrease_is_better",
      "smaller_is_better",
    ].includes(normalized)
  ) {
    return "lower_is_better";
  }
  if (
    [
      "higher_is_better",
      "maximize",
      "maximise",
      "higher",
      "increase",
      "increase_is_better",
      "larger_is_better",
    ].includes(normalized)
  ) {
    return "higher_is_better";
  }
  return null;
}

function firstValueWithSource<T>(entries: Array<{
  value: T | null | undefined;
  source: ExperimentMetricContractSource;
}>): { value: T | null; source: ExperimentMetricContractSource | null } {
  for (const entry of entries) {
    if (entry.value !== null && entry.value !== undefined) {
      return { value: entry.value, source: entry.source };
    }
  }
  return { value: null, source: null };
}

export function resolveExperimentPrimaryMetricContract(params: {
  spec: ExperimentSearchSpecLike;
  manifestRecord?: Record<string, unknown> | null;
  fallbackMetricName?: string | null;
  fallbackDirection?: ExperimentMetricDirection | string | null;
}): ExperimentPrimaryMetricContract {
  const manifestRecord = asRecord(params.manifestRecord) ?? {};
  const researchProgram = asRecord(manifestRecord.research_program);
  const benchmarkProtocol =
    asRecord(manifestRecord.benchmark_protocol) ??
    asRecord(manifestRecord.benchmarkProtocol);
  const specContract = params.spec.primaryMetricContract;
  const metricName = firstValueWithSource<string>([
    { value: specContract.metricName, source: "search_spec" },
    {
      value:
        pickString(benchmarkProtocol ?? {}, ["primary_metric", "primaryMetric"]) ??
        pickString(researchProgram ?? {}, ["primary_metric", "primaryMetric"]) ??
        pickString(manifestRecord, ["primary_metric", "primaryMetric"]),
      source: "manifest",
    },
    { value: params.fallbackMetricName ?? null, source: "fallback" },
  ]);
  const direction = firstValueWithSource<ExperimentMetricDirection>([
    {
      value: normalizeMetricDirection(specContract.direction),
      source: "search_spec",
    },
    {
      value:
        normalizeMetricDirection(benchmarkProtocol?.metric_direction) ??
        normalizeMetricDirection(benchmarkProtocol?.metricDirection) ??
        normalizeMetricDirection(benchmarkProtocol?.primary_metric_direction) ??
        normalizeMetricDirection(benchmarkProtocol?.primaryMetricDirection) ??
        normalizeMetricDirection(manifestRecord.primary_metric_direction) ??
        normalizeMetricDirection(manifestRecord.primaryMetricDirection) ??
        normalizeMetricDirection(researchProgram?.primary_metric_direction) ??
        normalizeMetricDirection(researchProgram?.primaryMetricDirection),
      source: "manifest",
    },
    {
      value: normalizeMetricDirection(params.fallbackDirection),
      source: "fallback",
    },
  ]);
  const minimumImprovement = firstValueWithSource<number>([
    { value: specContract.minimumImprovement, source: "search_spec" },
    {
      value:
        pickNumber(benchmarkProtocol ?? {}, [
          "minimum_improvement",
          "minimumImprovement",
        ]) ??
        pickNumber(manifestRecord, ["minimum_improvement", "minimumImprovement"]),
      source: "manifest",
    },
  ]);
  const paperContributionMetric = firstValueWithSource<string>([
    {
      value:
        pickString(benchmarkProtocol ?? {}, [
          "paper_contribution_metric",
          "paperContributionMetric",
        ]) ??
        pickString(researchProgram ?? {}, [
          "paper_contribution_metric",
          "paperContributionMetric",
        ]) ??
        pickString(manifestRecord, [
          "paper_contribution_metric",
          "paperContributionMetric",
        ]),
      source: "manifest",
    },
    { value: metricName.value, source: metricName.source ?? "fallback" },
  ]);

  return {
    metricName: metricName.value,
    metricNameSource: metricName.source,
    direction: direction.value,
    directionSource: direction.source,
    minimumImprovement: minimumImprovement.value,
    minimumImprovementSource: minimumImprovement.source,
    primaryEvidence: asStringArray(specContract.primaryEvidence),
    paperContributionMetric: paperContributionMetric.value,
    paperContributionMetricSource: paperContributionMetric.source,
  };
}

export function serializeExperimentPrimaryMetricContract(
  contract: ExperimentPrimaryMetricContract
): Record<string, unknown> {
  return {
    contract_version: 1,
    metric_name: contract.metricName,
    metric_name_source: contract.metricNameSource,
    direction: contract.direction,
    direction_source: contract.directionSource,
    minimum_improvement: contract.minimumImprovement,
    minimum_improvement_source: contract.minimumImprovementSource,
    primary_evidence: contract.primaryEvidence,
    paper_contribution_metric: contract.paperContributionMetric,
    paper_contribution_metric_source: contract.paperContributionMetricSource,
  };
}
