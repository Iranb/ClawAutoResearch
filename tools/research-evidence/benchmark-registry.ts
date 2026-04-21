import { normalizeExperimentSearchSpec } from "../workflow-guard-state/experiment-search-spec";
import { normalizeResearchProgramState } from "../workflow-guard-state/research-program";
import {
  normalizeBenchmarkProtocolState,
  serializeBenchmarkProtocolState,
} from "../research-contracts/evidence-contracts";
import {
  nowIso,
  readProjectJson,
  readProjectManifest,
  writeProjectJson,
  writeProjectManifest,
} from "../research-contracts/core/project-io";

type FairnessCheckStatus = "pass" | "warning" | "fail" | "unknown";

type AllowedDeviationEntry = {
  deviationId: string | null;
  scope: string | null;
  rationale: string | null;
  allowedInMainResults: boolean;
  label: string | null;
};

type ProtocolFairnessChecks = {
  sameBackbone: FairnessCheckStatus;
  samePretraining: FairnessCheckStatus;
  sameSplit: FairnessCheckStatus;
  sameEvaluationHarness: FairnessCheckStatus;
  baselineReferenceMode: string | null;
};

type BenchmarkRegistryEntry = {
  benchmarkFamily: string | null;
  canonicalDataset: string | null;
  splitDescriptor: string | null;
  splitSource: string | null;
  splitChecksum: string | null;
  metricName: string | null;
  metricDirection: string | null;
  baselineReference: string | null;
  evaluationHarness: string | null;
  evaluationHarnessLocked: boolean;
  datasetProtocolLocked: boolean;
  metricProtocolLocked: boolean;
  officialEvalRecipe: string | null;
  allowedDeviations: AllowedDeviationEntry[];
  fairCompareNotes: string[];
  fairnessChecks: ProtocolFairnessChecks;
  searchSpecPath: string;
};

type ProtocolLockFile = {
  schemaVersion: number;
  generatedAt: string;
  benchmarkFamily: string | null;
  canonicalDataset: string | null;
  splitDescriptor: string | null;
  splitSource: string | null;
  splitChecksum: string | null;
  primaryMetric: string | null;
  metricDirection: string | null;
  officialEvalRecipe: string | null;
  evaluationHarness: string | null;
  baselineReference: string | null;
  fairnessContract: {
    datasetProtocolLocked: boolean;
    metricProtocolLocked: boolean;
    evaluationHarnessLocked: boolean;
  };
  fairCompareNotes: string[];
  fairnessChecks: ProtocolFairnessChecks;
  allowedDeviations: AllowedDeviationEntry[];
};

function pickEnvelopeString(
  envelope: Record<string, unknown> | null | undefined,
  keys: string[]
): string | null {
  if (!envelope) {
    return null;
  }
  for (const key of keys) {
    const value = envelope[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeFairnessCheckStatus(value: unknown): FairnessCheckStatus {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "pass" || normalized === "warning" || normalized === "fail") {
    return normalized;
  }
  if (normalized === "ready" || normalized === "locked" || normalized === "same") {
    return "pass";
  }
  if (normalized === "partial" || normalized === "shaky") {
    return "warning";
  }
  if (normalized === "blocked" || normalized === "not_comparable") {
    return "fail";
  }
  if (typeof value === "boolean") {
    return value ? "pass" : "fail";
  }
  return "unknown";
}

function deriveFairnessChecks(params: {
  searchSpec: ReturnType<typeof normalizeExperimentSearchSpec>;
}): ProtocolFairnessChecks {
  const protocolLock = params.searchSpec.protocolLockContract;
  return {
    sameBackbone: normalizeFairnessCheckStatus(
      protocolLock.fairnessChecks.sameBackbone
    ),
    samePretraining: normalizeFairnessCheckStatus(
      protocolLock.fairnessChecks.samePretraining
    ),
    sameSplit:
      protocolLock.fairnessChecks.sameSplit != null
        ? normalizeFairnessCheckStatus(protocolLock.fairnessChecks.sameSplit)
        : params.searchSpec.baselineFairnessContract.lockedDatasetProtocol
          ? "pass"
          : "warning",
    sameEvaluationHarness:
      protocolLock.fairnessChecks.sameEvaluationHarness != null
        ? normalizeFairnessCheckStatus(
            protocolLock.fairnessChecks.sameEvaluationHarness
          )
        : params.searchSpec.baselineFairnessContract.lockedEvaluationHarness
          ? "pass"
          : "warning",
    baselineReferenceMode:
      protocolLock.fairnessChecks.baselineReferenceMode ?? "unknown",
  };
}

function summarizeFairCompare(entry: BenchmarkRegistryEntry): {
  status: "missing" | "pass" | "warning" | "fail";
  summary: string;
  label: "fair_compare" | "shaky_compare" | "not_comparable" | "missing";
} {
  const checks = entry.fairnessChecks;
  const explicitSignals =
    entry.fairCompareNotes.length > 0 ||
    checks.sameBackbone !== "unknown" ||
    checks.samePretraining !== "unknown" ||
    checks.sameSplit !== "unknown" ||
    checks.sameEvaluationHarness !== "unknown" ||
    (checks.baselineReferenceMode != null &&
      checks.baselineReferenceMode !== "" &&
      checks.baselineReferenceMode !== "unknown");

  if (!explicitSignals) {
    return {
      status: "missing",
      summary:
        "Fair-compare notes are missing, so the workflow cannot tell whether the comparison is fair, shaky, or not comparable.",
      label: "missing",
    };
  }

  const hardFailures: string[] = [];
  if (checks.sameBackbone === "fail") {
    hardFailures.push("backbone differs from the baseline");
  }
  if (checks.samePretraining === "fail") {
    hardFailures.push("pretraining differs from the baseline");
  }
  if (checks.sameSplit === "fail") {
    hardFailures.push("data split differs from the baseline");
  }
  if (checks.sameEvaluationHarness === "fail") {
    hardFailures.push("evaluation harness differs from the baseline");
  }

  if (hardFailures.length > 0) {
    return {
      status: "fail",
      summary: `Comparison is not comparable for headline claims: ${hardFailures.join("; ")}.`,
      label: "not_comparable",
    };
  }

  const warnings: string[] = [];
  if (checks.sameBackbone === "unknown" || checks.sameBackbone === "warning") {
    warnings.push("same-backbone parity is not fully verified");
  }
  if (
    checks.samePretraining === "unknown" ||
    checks.samePretraining === "warning"
  ) {
    warnings.push("same-pretraining parity is not fully verified");
  }
  if (checks.sameSplit === "warning") {
    warnings.push("same-split parity is weaker than ideal");
  }
  if (checks.sameEvaluationHarness === "warning") {
    warnings.push("evaluation harness parity is weaker than ideal");
  }
  if (["reported", "mixed"].includes(String(checks.baselineReferenceMode ?? ""))) {
    warnings.push(
      `baseline reference mode is ${checks.baselineReferenceMode}, so the comparison should stay explicitly labeled`
    );
  }

  if (warnings.length > 0) {
    return {
      status: "warning",
      summary: `Comparison is usable but should be labeled as shaky compare: ${warnings.join("; ")}.`,
      label: "shaky_compare",
    };
  }

  return {
    status: "pass",
    summary:
      "Comparison satisfies the current same-backbone, same-split, and same-evaluation fairness checks.",
    label: "fair_compare",
  };
}

function summarizeAllowedDeviationStatus(
  deviations: AllowedDeviationEntry[]
): {
  count: number;
  status: "none" | "ready" | "blocked";
  summary: string | null;
} {
  if (deviations.length === 0) {
    return {
      count: 0,
      status: "none",
      summary: null,
    };
  }
  const disallowed = deviations.filter((entry) => entry.allowedInMainResults !== true);
  if (disallowed.length > 0) {
    return {
      count: deviations.length,
      status: "blocked",
      summary: `Protocol lock includes deviation(s) that are not allowed in main results: ${disallowed
        .map((entry) => entry.deviationId ?? entry.scope ?? "unnamed deviation")
        .join(", ")}.`,
    };
  }
  return {
    count: deviations.length,
    status: "ready",
    summary: `Protocol lock records ${deviations.length} explicit allowed deviation(s).`,
  };
}

function deriveBenchmarkEntry(params: {
  manifest: Record<string, unknown>;
  searchSpec: ReturnType<typeof normalizeExperimentSearchSpec>;
}): BenchmarkRegistryEntry {
  const researchProgram = normalizeResearchProgramState(params.manifest.research_program);
  const protocolLock = params.searchSpec.protocolLockContract;
  const searchEnvelope = params.searchSpec.searchEnvelope;
  return {
    benchmarkFamily:
      protocolLock.benchmarkFamily ??
      pickEnvelopeString(searchEnvelope, ["benchmarkFamily", "benchmark_family"]) ??
      params.searchSpec.searchMode ??
      researchProgram.datasets[0] ??
      researchProgram.primaryMetric ??
      null,
    canonicalDataset:
      protocolLock.canonicalDataset ??
      pickEnvelopeString(searchEnvelope, ["dataset", "canonicalDataset", "canonical_dataset"]) ??
      researchProgram.datasets[0] ??
      null,
    splitDescriptor:
      protocolLock.splitDescriptor ??
      pickEnvelopeString(searchEnvelope, ["split", "splitDescriptor", "split_descriptor"]) ??
      null,
    splitSource:
      protocolLock.splitSource ??
      pickEnvelopeString(searchEnvelope, ["splitSource", "split_source"]) ??
      null,
    splitChecksum:
      protocolLock.splitChecksum ??
      pickEnvelopeString(searchEnvelope, ["splitChecksum", "split_checksum"]) ??
      null,
    metricName:
      params.searchSpec.primaryMetricContract.metricName ??
      researchProgram.primaryMetric ??
      null,
    metricDirection: params.searchSpec.primaryMetricContract.direction ?? null,
    baselineReference: researchProgram.baselineReference ?? null,
    evaluationHarness:
      protocolLock.evaluationHarness ??
      pickEnvelopeString(searchEnvelope, [
        "evaluationHarness",
        "evaluation_harness",
        "evalHarness",
        "eval_harness",
      ]) ??
      null,
    evaluationHarnessLocked: params.searchSpec.baselineFairnessContract.lockedEvaluationHarness,
    datasetProtocolLocked: params.searchSpec.baselineFairnessContract.lockedDatasetProtocol,
    metricProtocolLocked: params.searchSpec.baselineFairnessContract.lockedMetricProtocol,
    officialEvalRecipe:
      protocolLock.officialEvalRecipe ??
      params.searchSpec.primaryMetricContract.primaryEvidence[0] ??
      researchProgram.primaryMetric ??
      null,
    allowedDeviations: protocolLock.allowedDeviations,
    fairCompareNotes: protocolLock.fairCompareNotes,
    fairnessChecks: deriveFairnessChecks({ searchSpec: params.searchSpec }),
    searchSpecPath: "planner/EXPERIMENT_SEARCH_SPEC.json",
  };
}

function buildProtocolLock(entry: BenchmarkRegistryEntry): ProtocolLockFile {
  return {
    schemaVersion: 2,
    generatedAt: nowIso(),
    benchmarkFamily: entry.benchmarkFamily,
    canonicalDataset: entry.canonicalDataset,
    splitDescriptor: entry.splitDescriptor,
    splitSource: entry.splitSource,
    splitChecksum: entry.splitChecksum,
    primaryMetric: entry.metricName,
    metricDirection: entry.metricDirection,
    officialEvalRecipe: entry.officialEvalRecipe,
    evaluationHarness: entry.evaluationHarness,
    baselineReference: entry.baselineReference,
    fairnessContract: {
      datasetProtocolLocked: entry.datasetProtocolLocked,
      metricProtocolLocked: entry.metricProtocolLocked,
      evaluationHarnessLocked: entry.evaluationHarnessLocked,
    },
    fairCompareNotes: entry.fairCompareNotes,
    fairnessChecks: entry.fairnessChecks,
    allowedDeviations: entry.allowedDeviations,
  };
}

function hasProtocolDrift(
  previousLock: Record<string, unknown> | null,
  nextLock: ProtocolLockFile
): boolean {
  if (!previousLock) {
    return false;
  }
  const scalarPairs: Array<[string, string | null]> = [
    ["benchmarkFamily", nextLock.benchmarkFamily],
    ["canonicalDataset", nextLock.canonicalDataset],
    ["splitDescriptor", nextLock.splitDescriptor],
    ["splitSource", nextLock.splitSource],
    ["splitChecksum", nextLock.splitChecksum],
    ["primaryMetric", nextLock.primaryMetric],
    ["metricDirection", nextLock.metricDirection],
    ["officialEvalRecipe", nextLock.officialEvalRecipe],
    ["evaluationHarness", nextLock.evaluationHarness],
  ];
  for (const [key, nextValue] of scalarPairs) {
    const previousValue = previousLock[key];
    if (typeof previousValue === "string" && previousValue.trim()) {
      if ((nextValue ?? null) !== previousValue) {
        return true;
      }
    }
  }
  const previousFairnessContract =
    typeof previousLock.fairnessContract === "object" && previousLock.fairnessContract != null
      ? (previousLock.fairnessContract as Record<string, unknown>)
      : null;
  if (previousFairnessContract) {
    for (const [key, nextValue] of Object.entries(nextLock.fairnessContract)) {
      if (typeof previousFairnessContract[key] === "boolean") {
        if (previousFairnessContract[key] !== nextValue) {
          return true;
        }
      }
    }
  }
  return false;
}

function coercePatchNumber(
  patch: Record<string, unknown>,
  camelKey: string,
  snakeKey: string
): number | null {
  const value = patch[camelKey] ?? patch[snakeKey];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function materializeBenchmarkRegistry(params: {
  projectRoot: string;
  patch?: Record<string, unknown>;
}) {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = normalizeBenchmarkProtocolState(manifest.benchmark_protocol);
  const patch = params.patch ?? {};
  const searchSpecRaw =
    (await readProjectJson<unknown>(params.projectRoot, "planner/EXPERIMENT_SEARCH_SPEC.json")) ??
    {};
  const searchSpec = normalizeExperimentSearchSpec(searchSpecRaw);
  const entry = deriveBenchmarkEntry({ manifest, searchSpec });
  const fairCompare = summarizeFairCompare(entry);
  const allowedDeviation = summarizeAllowedDeviationStatus(entry.allowedDeviations);
  const defaultRegistryPath = current.registryPath ?? "researcher/BENCHMARK_REGISTRY.json";
  const defaultProtocolLockPath = current.protocolLockPath ?? "researcher/PROTOCOL_LOCK.json";
  const defaultFairnessReportPath =
    current.fairnessReportPath ?? "researcher/BASELINE_FAIRNESS_REPORT.json";
  const registryPath =
    (typeof patch.registry_path === "string" && patch.registry_path) ||
    (typeof patch.registryPath === "string" && patch.registryPath) ||
    defaultRegistryPath;
  const protocolLockPath =
    (typeof patch.protocol_lock_path === "string" && patch.protocol_lock_path) ||
    (typeof patch.protocolLockPath === "string" && patch.protocolLockPath) ||
    defaultProtocolLockPath;
  const fairnessReportPath =
    (typeof patch.fairness_report_path === "string" && patch.fairness_report_path) ||
    (typeof patch.fairnessReportPath === "string" && patch.fairnessReportPath) ||
    defaultFairnessReportPath;

  const lock = buildProtocolLock(entry);

  await writeProjectJson(params.projectRoot, registryPath, {
    schemaVersion: 2,
    generatedAt: nowIso(),
    benchmarks: [entry],
  });
  const previousLock = await readProjectJson<Record<string, unknown>>(
    params.projectRoot,
    protocolLockPath
  );
  let driftStatus: string | null = null;
  if (hasProtocolDrift(previousLock, lock)) {
    driftStatus = "fail";
  } else if (
    entry.datasetProtocolLocked &&
    entry.metricProtocolLocked &&
    entry.evaluationHarnessLocked &&
    entry.benchmarkFamily &&
    entry.metricName &&
    entry.splitDescriptor
  ) {
    driftStatus = "pass";
  } else {
    driftStatus = "pending";
  }
  await writeProjectJson(params.projectRoot, protocolLockPath, {
    ...lock,
    driftStatus,
  });
  await writeProjectJson(params.projectRoot, fairnessReportPath, {
    schemaVersion: 2,
    generatedAt: nowIso(),
    benchmarkFamily: entry.benchmarkFamily,
    splitDescriptor: entry.splitDescriptor,
    baselineReference: entry.baselineReference,
    requiredLocks: {
      datasetProtocolLocked: entry.datasetProtocolLocked,
      metricProtocolLocked: entry.metricProtocolLocked,
      evaluationHarnessLocked: entry.evaluationHarnessLocked,
    },
    fairnessChecks: entry.fairnessChecks,
    fairCompareNotes: entry.fairCompareNotes,
    fairCompareStatus: fairCompare.status,
    fairCompareLabel: fairCompare.label,
    fairCompareSummary: fairCompare.summary,
    allowedDeviations: entry.allowedDeviations,
    allowedDeviationStatus: allowedDeviation.status,
    allowedDeviationSummary: allowedDeviation.summary,
  });

  const derivedLocked =
    Boolean(entry.benchmarkFamily) &&
    Boolean(entry.metricName) &&
    Boolean(entry.splitDescriptor) &&
    Boolean(entry.officialEvalRecipe) &&
    entry.datasetProtocolLocked &&
    entry.metricProtocolLocked &&
    entry.evaluationHarnessLocked;

  const next = normalizeBenchmarkProtocolState({
    ...serializeBenchmarkProtocolState(current),
    schema_version: 3,
    status:
      (typeof patch.status === "string" && patch.status) ||
      entry.metricName && entry.benchmarkFamily
        ? derivedLocked
          ? "ready"
          : "partial"
        : "missing",
    benchmark_family:
      (typeof patch.benchmark_family === "string" && patch.benchmark_family) ||
      (typeof patch.benchmarkFamily === "string" && patch.benchmarkFamily) ||
      entry.benchmarkFamily,
    primary_metric:
      (typeof patch.primary_metric === "string" && patch.primary_metric) ||
      (typeof patch.primaryMetric === "string" && patch.primaryMetric) ||
      entry.metricName,
    metric_direction:
      (typeof patch.metric_direction === "string" && patch.metric_direction) ||
      (typeof patch.metricDirection === "string" && patch.metricDirection) ||
      entry.metricDirection,
    split_descriptor:
      (typeof patch.split_descriptor === "string" && patch.split_descriptor) ||
      (typeof patch.splitDescriptor === "string" && patch.splitDescriptor) ||
      entry.splitDescriptor,
    evaluation_harness:
      (typeof patch.evaluation_harness === "string" && patch.evaluation_harness) ||
      (typeof patch.evaluationHarness === "string" && patch.evaluationHarness) ||
      entry.evaluationHarness,
    registry_path: registryPath,
    protocol_lock_path: protocolLockPath,
    fairness_report_path: fairnessReportPath,
    official_eval_recipe:
      (typeof patch.official_eval_recipe === "string" && patch.official_eval_recipe) ||
      (typeof patch.officialEvalRecipe === "string" && patch.officialEvalRecipe) ||
      entry.officialEvalRecipe,
    locked:
      (typeof patch.locked === "boolean" ? patch.locked : undefined) ?? derivedLocked,
    drift_status:
      (typeof patch.drift_status === "string" && patch.drift_status) ||
      (typeof patch.driftStatus === "string" && patch.driftStatus) ||
      driftStatus,
    fair_compare_status:
      (typeof patch.fair_compare_status === "string" && patch.fair_compare_status) ||
      (typeof patch.fairCompareStatus === "string" && patch.fairCompareStatus) ||
      fairCompare.status,
    fair_compare_summary:
      (typeof patch.fair_compare_summary === "string" && patch.fair_compare_summary) ||
      (typeof patch.fairCompareSummary === "string" && patch.fairCompareSummary) ||
      fairCompare.summary,
    allowed_deviation_count:
      coercePatchNumber(patch, "allowedDeviationCount", "allowed_deviation_count") ??
      allowedDeviation.count,
    allowed_deviation_status:
      (typeof patch.allowed_deviation_status === "string" &&
        patch.allowed_deviation_status) ||
      (typeof patch.allowedDeviationStatus === "string" &&
        patch.allowedDeviationStatus) ||
      allowedDeviation.status,
    pending_reason:
      (typeof patch.pending_reason === "string" && patch.pending_reason) ||
      (typeof patch.pendingReason === "string" && patch.pendingReason) ||
      (entry.metricName && entry.benchmarkFamily
        ? driftStatus === "fail"
          ? "Protocol drift detected between the current experiment contract and the saved protocol lock."
          : fairCompare.status === "missing"
            ? fairCompare.summary
            : fairCompare.status === "fail"
              ? fairCompare.summary
              : allowedDeviation.status === "blocked"
                ? allowedDeviation.summary
                : !derivedLocked
                  ? "Benchmark protocol is still missing a split descriptor, official evaluation recipe, or one of the fairness locks."
                  : current.pendingReason
        : "Benchmark family or primary metric is not yet locked in the experiment search spec."),
    last_materialized_at: nowIso(),
  });
  manifest.benchmark_protocol = serializeBenchmarkProtocolState(next);
  await writeProjectManifest(params.projectRoot, manifest);
  return next;
}
