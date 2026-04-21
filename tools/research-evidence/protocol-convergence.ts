import {
  nowIso,
  readProjectJson,
  readProjectManifest,
  writeProjectText,
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

function ensureObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function slugify(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return normalized || null;
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
  const candidatePath = current.candidatePath ?? "researcher/EXPERIMENT_PROTOCOL_CANDIDATE.json";
  const convergenceReportPath =
    current.convergenceReportPath ?? "researcher/PROTOCOL_CONVERGENCE_REPORT.json";
  const writebackReportPath =
    current.writebackReportPath ?? "researcher/EXPERIMENT_SEARCH_SPEC_WRITEBACK.json";

  const nextSpec = { ...searchSpecRaw };
  nextSpec.search_envelope = ensureObject(nextSpec.search_envelope);
  nextSpec.primary_metric_contract = ensureObject(nextSpec.primary_metric_contract);
  nextSpec.protocol_lock_contract = ensureObject(nextSpec.protocol_lock_contract);
  const searchEnvelope = nextSpec.search_envelope as Record<string, unknown>;
  const primaryMetricContract =
    nextSpec.primary_metric_contract as Record<string, unknown>;
  const protocolLockContract =
    nextSpec.protocol_lock_contract as Record<string, unknown>;
  const writeActions: string[] = [];
  const conflicts: string[] = [];
  const maybeWrite = (
    container: Record<string, unknown>,
    key: string,
    candidate: string | null
  ) => {
    if (!candidate) {
      return;
    }
    const currentValue = asString(container[key]);
    if (!currentValue) {
      container[key] = candidate;
      writeActions.push(key);
      return;
    }
    if (currentValue !== candidate) {
      conflicts.push(key);
    }
  };
  maybeWrite(searchEnvelope, "benchmarkFamily", selectedBenchmarkFamily);
  maybeWrite(searchEnvelope, "primaryMetric", selectedPrimaryMetric);
  maybeWrite(primaryMetricContract, "metric_name", selectedPrimaryMetric);
  maybeWrite(protocolLockContract, "benchmark_family", selectedBenchmarkFamily);
  maybeWrite(protocolLockContract, "split_descriptor", selectedProtocolHint);
  if (!asString(nextSpec.search_mode) && selectedBenchmarkFamily) {
    nextSpec.search_mode = slugify(selectedBenchmarkFamily);
    writeActions.push("search_mode");
  }
  let writebackStatus = "not_applicable";
  if (candidateReady) {
    if (conflicts.length > 0) {
      writebackStatus = "conflict_blocked";
    } else if (writeActions.length > 0) {
      await writeProjectJson(params.projectRoot, "planner/EXPERIMENT_SEARCH_SPEC.json", nextSpec);
      writebackStatus = "written";
    } else {
      writebackStatus = "already_aligned";
    }
  }

  const effectiveSearchBenchmarkFamily =
    writebackStatus === "written" ? selectedBenchmarkFamily : searchBenchmarkFamily;
  const effectiveSearchMetric =
    writebackStatus === "written" ? selectedPrimaryMetric : searchMetric;
  const effectiveSearchProtocolHint =
    writebackStatus === "written" ? selectedProtocolHint : searchProtocolHint;
  const converged =
    candidateReady &&
    sameString(selectedBenchmarkFamily, effectiveSearchBenchmarkFamily) &&
    sameString(selectedPrimaryMetric, effectiveSearchMetric) &&
    (sameString(selectedProtocolHint, effectiveSearchProtocolHint) ||
      sameString(
        current.evaluationHarness,
        asString(searchSpec.protocolLockContract.evaluationHarness) ?? null
      ));
  const convergenceStatus = converged
    ? "converged"
    : candidateReady
      ? "candidate_ready"
      : "missing";

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
    writebackStatus,
    writeActions,
    conflicts,
    selectedBenchmarkFamily,
    selectedPrimaryMetric,
    selectedProtocolHint,
    searchBenchmarkFamily: effectiveSearchBenchmarkFamily,
    searchMetric: effectiveSearchMetric,
    searchProtocolHint: effectiveSearchProtocolHint,
    pendingReason:
      converged
        ? null
        : candidateReady
          ? "Survey-derived protocol candidate is ready, but experiment search spec has not fully converged to it yet."
          : "Survey-derived evidence is still insufficient to auto-converge the experiment protocol.",
  });
  await writeProjectJson(params.projectRoot, writebackReportPath, {
    schemaVersion: 1,
    generatedAt: nowIso(),
    status: writebackStatus,
    candidateReady,
    actions: writeActions,
    conflicts,
  });
  await writeProjectText(
    params.projectRoot,
    writebackReportPath.replace(/\.json$/i, ".md"),
    [
      "# Experiment Search Spec Writeback",
      "",
      `- Status: ${writebackStatus}`,
      `- Candidate ready: ${candidateReady ? "yes" : "no"}`,
      `- Actions: ${writeActions.join(", ") || "none"}`,
      `- Conflicts: ${conflicts.join(", ") || "none"}`,
      "",
    ].join("\n")
  );

  const next = normalizeBenchmarkProtocolState({
    ...serializeBenchmarkProtocolState(current),
    convergence_status: convergenceStatus,
    convergence_report_path: convergenceReportPath,
    candidate_path: candidatePath,
    writeback_status: writebackStatus,
    writeback_report_path: writebackReportPath,
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
