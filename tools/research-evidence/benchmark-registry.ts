import { normalizeExperimentSearchSpec } from "../workflow-guard-state/experiment-search-spec.ts";
import { normalizeResearchProgramState } from "../workflow-guard-state/research-program.ts";
import {
  normalizeBenchmarkProtocolState,
  serializeBenchmarkProtocolState,
} from "../research-contracts/evidence-contracts.ts";
import {
  nowIso,
  readProjectJson,
  readProjectManifest,
  writeProjectJson,
  writeProjectManifest,
} from "../research-contracts/core/project-io.ts";

type BenchmarkRegistryEntry = {
  benchmarkFamily: string | null;
  metricName: string | null;
  direction: string | null;
  baselineReference: string | null;
  evaluationHarnessLocked: boolean;
  datasetProtocolLocked: boolean;
  metricProtocolLocked: boolean;
  officialEvalRecipe: string | null;
  searchSpecPath: string;
};

function deriveBenchmarkEntry(params: {
  manifest: Record<string, unknown>;
  searchSpec: ReturnType<typeof normalizeExperimentSearchSpec>;
}): BenchmarkRegistryEntry {
  const researchProgram = normalizeResearchProgramState(params.manifest.research_program);
  return {
    benchmarkFamily:
      params.searchSpec.searchMode ??
      researchProgram.datasets[0] ??
      researchProgram.primaryMetric ??
      null,
    metricName:
      params.searchSpec.primaryMetricContract.metricName ??
      researchProgram.primaryMetric ??
      null,
    direction: params.searchSpec.primaryMetricContract.direction ?? null,
    baselineReference: researchProgram.baselineReference ?? null,
    evaluationHarnessLocked: params.searchSpec.baselineFairnessContract.lockedEvaluationHarness,
    datasetProtocolLocked: params.searchSpec.baselineFairnessContract.lockedDatasetProtocol,
    metricProtocolLocked: params.searchSpec.baselineFairnessContract.lockedMetricProtocol,
    officialEvalRecipe:
      params.searchSpec.primaryMetricContract.primaryEvidence[0] ??
      researchProgram.primaryMetric ??
      null,
    searchSpecPath: "planner/EXPERIMENT_SEARCH_SPEC.json",
  };
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
  const defaultRegistryPath = current.registryPath ?? "researcher/BENCHMARK_REGISTRY.json";
  const defaultProtocolLockPath = current.protocolLockPath ?? "researcher/PROTOCOL_LOCK.json";
  const registryPath =
    (typeof patch.registry_path === "string" && patch.registry_path) ||
    (typeof patch.registryPath === "string" && patch.registryPath) ||
    defaultRegistryPath;
  const protocolLockPath =
    (typeof patch.protocol_lock_path === "string" && patch.protocol_lock_path) ||
    (typeof patch.protocolLockPath === "string" && patch.protocolLockPath) ||
    defaultProtocolLockPath;

  const lock = {
    schemaVersion: 1,
    generatedAt: nowIso(),
    benchmarkFamily: entry.benchmarkFamily,
    primaryMetric: entry.metricName,
    metricDirection: entry.direction,
    officialEvalRecipe: entry.officialEvalRecipe,
    baselineReference: entry.baselineReference,
    fairnessContract: {
      datasetProtocolLocked: entry.datasetProtocolLocked,
      metricProtocolLocked: entry.metricProtocolLocked,
      evaluationHarnessLocked: entry.evaluationHarnessLocked,
    },
  };

  await writeProjectJson(params.projectRoot, registryPath, {
    schemaVersion: 1,
    generatedAt: nowIso(),
    benchmarks: [entry],
  });
  const previousLock = await readProjectJson<Record<string, unknown>>(params.projectRoot, protocolLockPath);
  let driftStatus: string | null = null;
  if (
    previousLock &&
    previousLock.primaryMetric &&
    previousLock.primaryMetric !== lock.primaryMetric
  ) {
    driftStatus = "fail";
  } else if (
    previousLock &&
    previousLock.benchmarkFamily &&
    previousLock.benchmarkFamily !== lock.benchmarkFamily
  ) {
    driftStatus = "fail";
  } else if (
    entry.datasetProtocolLocked &&
    entry.metricProtocolLocked &&
    entry.evaluationHarnessLocked
  ) {
    driftStatus = "pass";
  } else {
    driftStatus = "pending";
  }
  await writeProjectJson(params.projectRoot, protocolLockPath, {
    ...lock,
    driftStatus,
  });

  const next = normalizeBenchmarkProtocolState({
    ...serializeBenchmarkProtocolState(current),
    schema_version: 2,
    status:
      (typeof patch.status === "string" && patch.status) ||
      entry.metricName && entry.benchmarkFamily
        ? entry.datasetProtocolLocked && entry.metricProtocolLocked && entry.evaluationHarnessLocked
          ? "ready"
          : "partial"
        : "missing",
    benchmark_family:
      (typeof patch.benchmark_family === "string" && patch.benchmark_family) ||
      (typeof patch.benchmarkFamily === "string" && patch.benchmarkFamily) ||
      entry.benchmarkFamily,
    registry_path: registryPath,
    protocol_lock_path: protocolLockPath,
    official_eval_recipe:
      (typeof patch.official_eval_recipe === "string" && patch.official_eval_recipe) ||
      (typeof patch.officialEvalRecipe === "string" && patch.officialEvalRecipe) ||
      entry.officialEvalRecipe,
    locked:
      (typeof patch.locked === "boolean" && patch.locked) ||
      entry.datasetProtocolLocked &&
      entry.metricProtocolLocked &&
      entry.evaluationHarnessLocked,
    drift_status:
      (typeof patch.drift_status === "string" && patch.drift_status) ||
      (typeof patch.driftStatus === "string" && patch.driftStatus) ||
      driftStatus,
    pending_reason:
      (typeof patch.pending_reason === "string" && patch.pending_reason) ||
      (typeof patch.pendingReason === "string" && patch.pendingReason) ||
      entry.metricName && entry.benchmarkFamily
        ? driftStatus === "fail"
          ? "Protocol drift detected between the current experiment contract and the saved protocol lock."
          : current.pendingReason
        : "Benchmark family or primary metric is not yet locked in the experiment search spec.",
    last_materialized_at: nowIso(),
  });
  manifest.benchmark_protocol = serializeBenchmarkProtocolState(next);
  await writeProjectManifest(params.projectRoot, manifest);
  return next;
}
