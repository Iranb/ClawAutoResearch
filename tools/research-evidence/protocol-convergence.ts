import {
  nowIso,
  readProjectJson,
  readProjectManifest,
  writeProjectJson,
  writeProjectManifest,
} from "../research-contracts/core/project-io";
import {
  normalizeBenchmarkProtocolState,
  serializeBenchmarkProtocolState,
} from "../research-contracts/evidence-contracts";
import { normalizeExperimentSearchSpec } from "../workflow-guard-state/experiment-search-spec";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sameString(left: string | null, right: string | null): boolean {
  return (left ?? null) === (right ?? null);
}

export async function materializeBenchmarkProtocolConvergence(params: {
  projectRoot: string;
}) {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = normalizeBenchmarkProtocolState(manifest.benchmark_protocol);
  const bridge =
    (await readProjectJson<Record<string, unknown>>(
      params.projectRoot,
      "researcher/SURVEY_TOP_TIER_BRIDGE.json"
    )) ?? {};
  const searchSpecRaw =
    (await readProjectJson<Record<string, unknown>>(
      params.projectRoot,
      "planner/EXPERIMENT_SEARCH_SPEC.json"
    )) ?? {};
  const searchSpec = normalizeExperimentSearchSpec(searchSpecRaw);
  const bridgeBenchmarkHints =
    bridge.benchmarkHints && typeof bridge.benchmarkHints === "object"
      ? (bridge.benchmarkHints as Record<string, unknown>)
      : {};
  const selectedBenchmarkFamily =
    asString(bridgeBenchmarkHints.selectedBenchmarkFamily) ?? current.benchmarkFamily;
  const selectedPrimaryMetric =
    asString(bridgeBenchmarkHints.selectedPrimaryMetric) ?? current.primaryMetric;
  const protocolHints = Array.isArray(bridgeBenchmarkHints.protocolHints)
    ? bridgeBenchmarkHints.protocolHints.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0
      )
    : [];
  const selectedProtocolHint =
    current.splitDescriptor ?? protocolHints[0] ?? null;
  const fairCompareStatus = current.fairCompareStatus ?? "missing";
  const candidateReady =
    Boolean(selectedBenchmarkFamily) &&
    Boolean(selectedPrimaryMetric) &&
    Boolean(selectedProtocolHint) &&
    (fairCompareStatus === "pass" || fairCompareStatus === "warning");

  const searchBenchmarkFamily =
    asString(searchSpec.protocolLockContract.benchmarkFamily) ??
    asString(searchSpec.searchEnvelope?.benchmarkFamily) ??
    null;
  const searchMetric =
    asString(searchSpec.primaryMetricContract.metricName) ?? null;
  const searchProtocolHint =
    asString(searchSpec.protocolLockContract.splitDescriptor) ??
    asString(searchSpec.protocolLockContract.evaluationHarness) ??
    null;
  const converged =
    candidateReady &&
    sameString(selectedBenchmarkFamily, searchBenchmarkFamily) &&
    sameString(selectedPrimaryMetric, searchMetric) &&
    (sameString(selectedProtocolHint, searchProtocolHint) ||
      sameString(
        current.evaluationHarness,
        asString(searchSpec.protocolLockContract.evaluationHarness) ?? null
      ));

  const convergenceStatus = converged
    ? "converged"
    : candidateReady
      ? "candidate_ready"
      : "missing";
  const candidatePath = current.candidatePath ?? "researcher/EXPERIMENT_PROTOCOL_CANDIDATE.json";
  const convergenceReportPath =
    current.convergenceReportPath ?? "researcher/PROTOCOL_CONVERGENCE_REPORT.json";

  await writeProjectJson(params.projectRoot, candidatePath, {
    schemaVersion: 1,
    generatedAt: nowIso(),
    benchmarkFamily: selectedBenchmarkFamily,
    primaryMetric: selectedPrimaryMetric,
    protocolHint: selectedProtocolHint,
    fairCompareStatus,
    source: "survey_bridge",
  });
  await writeProjectJson(params.projectRoot, convergenceReportPath, {
    schemaVersion: 1,
    generatedAt: nowIso(),
    convergenceStatus,
    candidateReady,
    converged,
    selectedBenchmarkFamily,
    selectedPrimaryMetric,
    selectedProtocolHint,
    searchBenchmarkFamily,
    searchMetric,
    searchProtocolHint,
    pendingReason:
      converged
        ? null
        : candidateReady
          ? "Survey-derived protocol candidate is ready, but experiment search spec has not fully converged to it yet."
          : "Survey-derived evidence is still insufficient to auto-converge the experiment protocol.",
  });

  const next = normalizeBenchmarkProtocolState({
    ...serializeBenchmarkProtocolState(current),
    convergence_status: convergenceStatus,
    convergence_report_path: convergenceReportPath,
    candidate_path: candidatePath,
    pending_reason:
      convergenceStatus === "converged"
        ? current.pendingReason
        : candidateReady
          ? "Protocol candidate is ready for experiment alignment."
          : current.pendingReason,
    last_materialized_at: nowIso(),
  });
  manifest.benchmark_protocol = serializeBenchmarkProtocolState(next);
  await writeProjectManifest(params.projectRoot, manifest);
  return next;
}
