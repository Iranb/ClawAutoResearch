import { createHash } from "node:crypto";
import path from "node:path";
import {
  normalizeExperimentSearchSpec,
  type ExperimentSearchSpecLike,
} from "./workflow-guard-state/experiment-search-spec.js";
import {
  normalizeExperimentSearchState,
} from "./workflow-guard-state/execution-state";
import {
  normalizeExperimentLedger,
} from "./workflow-guard-experiment-history";
import type { ExperimentGpuMonitorState } from "./workflow-gpu-monitor";
import { readJsonIfExists, writeJsonEnsured } from "./workflow-guard-core/fs";
import {
  collectBaselineDatasetEnvelope,
  collectInnovationAnchorPoints,
  collectValidatedDatasetsFromLedger,
  deriveBaselineDatasetCoverage,
  deriveComparableTrialBudgetStatus,
  deriveInnovationDeviation,
  deriveMeasuredTrialDurationMinutes,
  normalizeExperimentInnerLoopContract,
  normalizeExperimentOuterLoopPolicy,
} from "./workflow-experiment-loop";

type FailureClass = "runtime" | "implementation" | "scientific" | "unknown";

export type ExperimentFailureCluster = {
  clusterId: string;
  failureClass: FailureClass;
  signature: string;
  experimentIds: string[];
  count: number;
};

export type ExperimentSearchDecision =
  | "launch_pending"
  | "repair_implementation"
  | "continue_tuning"
  | "narrow_search"
  | "require_multi_seed"
  | "require_ablation"
  | "innovation_fragile"
  | "innovation_supported"
  | "innovation_invalidated"
  | "rollback_to_plan"
  | "rollback_to_idea"
  | "reconcile_runtime";

export type ExperimentSearchDecisionSummary = {
  decision: ExperimentSearchDecision;
  rationale: string;
  decisionConfidence: "low" | "medium" | "high";
  implementationConfidence: string;
  baselineFairnessStatus: string;
  ablationStatus: string;
  innovationStatus: string;
  searchExhaustionStatus: string;
  evidenceCleanlinessStatus: string;
  recommendedNextAction: string;
  validationStage: string;
  failureClusters: ExperimentFailureCluster[];
  persistedPatch: Record<string, unknown>;
};

type ExperimentAnalysisGateVote = {
  agent: "execution_reviewer" | "novelty_reviewer" | "paper_readiness_reviewer";
  vote: "approve" | "continue_search" | "repair_required";
  basis: string[];
  blockers: string[];
};

type ExperimentAnalysisGate = {
  schema_version: 1;
  decision: "ready_for_analysis" | "continue_search" | "repair_required";
  rule: "karpathy_improvement_required_then_2_of_3";
  primary_gate: "execution_reviewer";
  hard_blockers: string[];
  votes: ExperimentAnalysisGateVote[];
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pickNumber(record: Record<string, unknown> | null, keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = readNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function compactReasons(values: string[]): string[] {
  return values.filter(Boolean).slice(0, 3);
}

function inferMetricDirection(record: Record<string, unknown>): "higher_is_better" | "lower_is_better" {
  const explicitDirection = normalizeStageLike(
    record.direction ?? record.optimization_direction ?? record.optimizationDirection
  );
  if (explicitDirection === "lower_is_better" || explicitDirection === "minimize") {
    return "lower_is_better";
  }
  if (explicitDirection === "higher_is_better" || explicitDirection === "maximize") {
    return "higher_is_better";
  }
  const metricName = normalizeStageLike(
    record.name ?? record.metric_name ?? record.metricName ?? record.primary_metric ?? record.primaryMetric
  );
  if (/(^|_)(eer|cer|wer|error|loss|mae|mse|rmse|latency|cost|perplexity)($|_)/.test(metricName)) {
    return "lower_is_better";
  }
  return "higher_is_better";
}

function isRetainedTrialDecision(value: unknown): boolean {
  return ["keep", "kept", "advance", "advanced", "promote", "promoted"].includes(
    normalizeStageLike(value)
  );
}

function countSpecificTextTokens(values: string[]): number {
  return values
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 4)
    .length;
}

function normalizeStageLike(value: unknown): string {
  return readString(value)?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_") ?? "unknown";
}

function isReadyLike(value: unknown): boolean {
  const normalized = normalizeStageLike(value);
  return (
    ["ready", "pass", "covered", "complete", "completed", "clean", "trusted", "supported"].includes(
      normalized
    ) || normalized.startsWith("completed_")
  );
}

function isFailureLike(value: unknown): boolean {
  return ["fail", "failed", "blocked", "invalid", "invalidated", "untrusted", "broken"].includes(
    normalizeStageLike(value)
  );
}

function readMetricDeltaFromEntry(entry: Record<string, unknown>): {
  delta: number | null;
  source: string | null;
} {
  const keyMetric = readRecord(entry.key_metric) ?? readRecord(entry.keyMetric);
  const metrics = readRecord(entry.metrics);
  const primaryResult = readRecord(entry.primary_result) ?? readRecord(entry.primaryResult);
  const metadata = readRecord(entry.metadata);
  const trialContract = readRecord(metadata?.trial_contract) ?? readRecord(metadata?.trialContract);
  const contractMetric =
    readRecord(trialContract?.primary_metric) ?? readRecord(trialContract?.primaryMetric);
  const karpathyLoop =
    readRecord(metadata?.karpathy_inner_loop) ?? readRecord(metadata?.karpathyInnerLoop);
  const karpathyMetric =
    readRecord(karpathyLoop?.primary_metric) ?? readRecord(karpathyLoop?.primaryMetric);
  const sources = [
    { label: "key_metric", record: keyMetric },
    { label: "metrics", record: metrics },
    { label: "primary_result", record: primaryResult },
    { label: "trial_contract.primary_metric", record: contractMetric },
    { label: "karpathy_inner_loop.primary_metric", record: karpathyMetric },
  ];
  for (const source of sources) {
    const delta = pickNumber(source.record, [
      "delta",
      "delta_h_score",
      "deltaHScore",
      "metric_delta",
      "metricDelta",
    ]);
    if (delta !== null) {
      return { delta, source: source.label };
    }
  }
  for (const source of sources) {
    if (!source.record) continue;
    const value = pickNumber(source.record, ["value", "candidate", "h_score", "hScore"]);
    const baseline = pickNumber(source.record, ["baseline", "baseline_h_score", "baselineHScore"]);
    if (value !== null && baseline !== null) {
      const direction = inferMetricDirection(source.record);
      return {
        delta: direction === "lower_is_better" ? baseline - value : value - baseline,
        source: source.label,
      };
    }
  }
  return { delta: null, source: null };
}

function selectKarpathyMetricEvidence(params: {
  ledgerExperiments: Record<string, unknown>[];
  preferredExperimentIds: string[];
}): {
  experimentId: string | null;
  delta: number | null;
  source: string | null;
  retained: boolean;
} {
  const candidates = params.ledgerExperiments.filter((entry) => {
    const experimentId =
      readString(entry.experiment_id) ?? readString(entry.experimentId);
    return (
      params.preferredExperimentIds.length === 0 ||
      (experimentId != null && params.preferredExperimentIds.includes(experimentId))
    );
  });
  for (const entry of candidates.slice().reverse()) {
    const metric = readMetricDeltaFromEntry(entry);
    if (metric.delta !== null) {
      return {
        experimentId:
          readString(entry.experiment_id) ?? readString(entry.experimentId),
        retained:
          isRetainedTrialDecision(entry.decision) ||
          isRetainedTrialDecision(entry.last_decision) ||
          isRetainedTrialDecision(entry.lastDecision),
        ...metric,
      };
    }
  }
  return { experimentId: null, delta: null, source: null, retained: false };
}

function buildExperimentAnalysisGate(params: {
  search: ReturnType<typeof normalizeExperimentSearchState>;
  hasRecordedRunEvidence: boolean;
  metricEvidence: {
    experimentId: string | null;
    delta: number | null;
    source: string | null;
    retained: boolean;
  };
  multiSeedReady: boolean;
  ablationReady: boolean;
  plotPackReady: boolean;
  cleanEvidence: boolean;
  baselineDatasetCoverageStatus: string;
  innovationDeviationStatus: string;
  innovationStatus: string;
  comparableTrialBudgetStatus: string;
  oneChangeValidationStatus: string;
  reviewBlockerCount: number;
}): ExperimentAnalysisGate {
  const hardBlockers = compactReasons([
    params.hasRecordedRunEvidence ? "" : "execution_evidence_missing",
    params.reviewBlockerCount > 0 ? "review_blockers_open" : "",
  ]);
  const positiveDelta =
    params.metricEvidence.delta !== null && params.metricEvidence.delta > 0;
  const executionBlockers = compactReasons([
    positiveDelta ? "" : "no_positive_primary_metric_delta",
    params.metricEvidence.retained ? "" : "trial_not_promoted_or_kept",
    params.multiSeedReady ? "" : "multi_seed_not_ready",
    params.ablationReady ? "" : "ablation_not_ready",
    params.comparableTrialBudgetStatus === "over_budget" ? "trial_over_budget" : "",
    params.oneChangeValidationStatus === "missing" ? "one_change_signature_missing" : "",
  ]);
  const noveltyBlockers = compactReasons([
    isReadyLike(params.innovationStatus) || params.innovationStatus === "supported"
      ? ""
      : "innovation_not_supported",
    params.innovationDeviationStatus === "broad_drift" ? "innovation_broad_drift" : "",
  ]);
  const paperBlockers = compactReasons([
    params.plotPackReady ? "" : "plot_pack_missing",
    params.cleanEvidence ? "" : "evidence_not_clean",
    params.baselineDatasetCoverageStatus === "missing" ||
    params.baselineDatasetCoverageStatus === "partial"
      ? "baseline_dataset_coverage_incomplete"
      : "",
  ]);
  const votes: ExperimentAnalysisGateVote[] = [
    {
      agent: "execution_reviewer",
      vote: hardBlockers.length > 0
        ? "repair_required"
        : executionBlockers.length === 0
          ? "approve"
          : "continue_search",
      basis: compactReasons([
        positiveDelta ? "positive_primary_metric_delta" : "",
        params.metricEvidence.retained ? "promoted_or_kept_trial" : "",
        params.multiSeedReady ? "multi_seed_ready" : "",
        params.ablationReady ? "ablation_ready" : "",
        params.metricEvidence.source ? `metric_source:${params.metricEvidence.source}` : "",
      ]),
      blockers: executionBlockers,
    },
    {
      agent: "novelty_reviewer",
      vote: noveltyBlockers.length === 0 ? "approve" : "continue_search",
      basis: compactReasons([
        isReadyLike(params.innovationStatus) || params.innovationStatus === "supported"
          ? "innovation_supported"
          : "",
        params.innovationDeviationStatus && params.innovationDeviationStatus !== "broad_drift"
          ? `innovation_deviation:${params.innovationDeviationStatus}`
          : "",
      ]),
      blockers: noveltyBlockers,
    },
    {
      agent: "paper_readiness_reviewer",
      vote: paperBlockers.length === 0 ? "approve" : "continue_search",
      basis: compactReasons([
        params.plotPackReady ? "plot_pack_ready" : "",
        params.cleanEvidence ? "clean_evidence" : "",
        params.search.evaluationSummaryPath ? "evaluation_summary_present" : "",
      ]),
      blockers: paperBlockers,
    },
  ];
  const approvalCount = votes.filter((vote) => vote.vote === "approve").length;
  const executionApproved = votes[0]?.vote === "approve";
  const decision =
    hardBlockers.length > 0
      ? "repair_required"
      : executionApproved && approvalCount >= 2
        ? "ready_for_analysis"
        : "continue_search";
  return {
    schema_version: 1,
    decision,
    rule: "karpathy_improvement_required_then_2_of_3",
    primary_gate: "execution_reviewer",
    hard_blockers: hardBlockers,
    votes,
  };
}

function classifyFailure(params: {
  status: string | null | undefined;
  failureSignature: string | null | undefined;
  notes: string[] | null | undefined;
  decision: string | null | undefined;
}): FailureClass {
  const text = [
    params.status,
    params.failureSignature,
    ...(params.notes ?? []),
    params.decision,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    /\boom\b|out of memory|cuda error|timeout|timed out|killed|ssh|connection|disk full|screen/i.test(
      text
    )
  ) {
    return "runtime";
  }
  if (
    /\bnan\b|traceback|assert|shape mismatch|syntax|compile|import error|implementation|protocol drift|baseline fairness/i.test(
      text
    )
  ) {
    return "implementation";
  }
  if (
    /under baseline|no improvement|regression|scientific|innovation weak|ablation failed|negative delta|invalid hypothesis|discard/i.test(
      text
    )
  ) {
    return "scientific";
  }
  return "unknown";
}

function clusterSignature(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 12);
}

function resolveRollbackDecision(spec: ExperimentSearchSpecLike): Extract<
  ExperimentSearchDecision,
  "rollback_to_plan" | "rollback_to_idea"
> {
  const target = normalizeStageLike(
    spec.innovationInvalidityCriteria?.rollbackTarget ??
      spec.innovationInvalidityCriteria?.rollback_target
  );
  return target === "idea" ? "rollback_to_idea" : "rollback_to_plan";
}

export function summarizeExperimentFailureClusters(ledgerLike: unknown): ExperimentFailureCluster[] {
  const ledger = normalizeExperimentLedger(
    (ledgerLike as Record<string, unknown>) ?? {},
    readString((ledgerLike as Record<string, unknown> | null)?.project_id) ?? null
  );
  const clusters = new Map<string, ExperimentFailureCluster>();
  for (const entry of ledger.experiments) {
    const failureSignature = entry.failureSignature ?? entry.summary ?? entry.status ?? "unknown";
    const failureClass = classifyFailure({
      status: entry.status,
      failureSignature,
      notes: entry.notes,
      decision: entry.decision,
    });
    if (failureClass === "unknown" && !["failed", "timeout", "stalled", "discard", "discarded"].includes(entry.status ?? "")) {
      continue;
    }
    const signature = `${failureClass}:${String(failureSignature).slice(0, 160)}`;
    const clusterId = clusterSignature(signature);
    const current = clusters.get(clusterId) ?? {
      clusterId,
      failureClass,
      signature,
      experimentIds: [],
      count: 0,
    };
    current.experimentIds.push(entry.experimentId);
    current.count += 1;
    clusters.set(clusterId, current);
  }
  return [...clusters.values()].sort((left, right) => right.count - left.count);
}

export function evaluateExperimentSearchDecision(params: {
  experimentSearch: unknown;
  experimentSearchSpec?: unknown;
  experimentLedger?: unknown;
  gpuMonitor?: ExperimentGpuMonitorState | Record<string, unknown> | null;
  experimentReviewState?: unknown;
  experimentMemory?: unknown;
  manifest?: unknown;
}): ExperimentSearchDecisionSummary {
  const search = normalizeExperimentSearchState(params.experimentSearch);
  const spec = normalizeExperimentSearchSpec(params.experimentSearchSpec);
  const innerLoop = normalizeExperimentInnerLoopContract(spec);
  const outerLoop = normalizeExperimentOuterLoopPolicy(spec);
  const manifestRecord =
    params.manifest && typeof params.manifest === "object" && !Array.isArray(params.manifest)
      ? (params.manifest as Record<string, unknown>)
      : null;
  const researchProgramTracks = Array.isArray(
    (manifestRecord?.research_program as Record<string, unknown> | undefined)?.tracks
  )
    ? (((manifestRecord?.research_program as Record<string, unknown>).tracks as unknown[]) ?? [])
        .map((entry) =>
          entry && typeof entry === "object" && !Array.isArray(entry)
            ? (entry as Record<string, unknown>)
            : null
        )
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        .filter((entry) => {
          const trackId = readString(entry.track_id) ?? readString(entry.trackId);
          return !search.trackId || trackId === search.trackId;
        })
    : [];
  const failureClusters = summarizeExperimentFailureClusters(params.experimentLedger ?? {});
  const gpuMonitor = (params.gpuMonitor ?? {}) as Record<string, unknown>;
  const experimentReview = ((params.experimentReviewState ?? {}) as Record<string, unknown>) ?? {};
  const experimentMemory = ((params.experimentMemory ?? {}) as Record<string, unknown>) ?? {};
  const gpuRecommendation = normalizeStageLike(gpuMonitor.recommendation);
  const likelyFinishedRunCount =
    typeof gpuMonitor.likelyFinishedRunCount === "number"
      ? gpuMonitor.likelyFinishedRunCount
      : typeof gpuMonitor.likely_finished_run_count === "number"
        ? gpuMonitor.likely_finished_run_count
        : 0;

  const baselineFairnessStatus = normalizeStageLike(search.baselineFairnessStatus);
  const implementationConfidence = normalizeStageLike(search.implementationConfidence);
  const ablationStatus = normalizeStageLike(search.ablationStatus);
  const innovationStatus = normalizeStageLike(search.innovationStatus);
  const searchExhaustionStatus = normalizeStageLike(search.searchExhaustionStatus);
  const evidenceCleanlinessStatus = normalizeStageLike(search.evidenceCleanlinessStatus);
  const searchStatus = normalizeStageLike(search.status);
  const reviewBlockerCount =
    typeof experimentReview.blockerCount === "number"
      ? experimentReview.blockerCount
      : typeof experimentReview.blocker_count === "number"
        ? experimentReview.blocker_count
        : 0;
  const reviewBlockers = Array.isArray(experimentReview.blockers)
    ? experimentReview.blockers.map((entry) => String(entry))
    : [];
  const experimentMemorySyncRequired =
    experimentMemory.papernexusSyncRequired === true ||
    experimentMemory.papernexus_sync_required === true;
  const experimentMemoryDecisionSummary =
    readString(experimentMemory.lastDecisionSummary) ??
    readString(experimentMemory.last_decision_summary);

  const runtimeFailureCount = failureClusters
    .filter((cluster) => cluster.failureClass === "runtime")
    .reduce((sum, cluster) => sum + cluster.count, 0);
  const implementationFailureCount = failureClusters
    .filter((cluster) => cluster.failureClass === "implementation")
    .reduce((sum, cluster) => sum + cluster.count, 0);
  const scientificFailureCount = failureClusters
    .filter((cluster) => cluster.failureClass === "scientific")
    .reduce((sum, cluster) => sum + cluster.count, 0);
  const preferredExperimentIds = [
    search.lastCandidateExperimentId,
    search.incumbentExperimentId,
  ].filter((entry): entry is string => Boolean(entry));
  const measuredTrialDurationMinutes = deriveMeasuredTrialDurationMinutes({
    ledgerLike: params.experimentLedger,
    preferredExperimentIds,
  });
  const comparableTrialBudgetStatus = deriveComparableTrialBudgetStatus({
    innerLoop,
    measuredDurationMinutes: measuredTrialDurationMinutes,
  });
  const oneChangeValidationStatus =
    search.requireOneChangeSignature || innerLoop.requireOneChangeSignature
      ? search.oneChangeSignature || readString(search.bestNodeId)
        ? search.oneChangeValidationStatus === "unknown"
          ? "ready"
          : search.oneChangeValidationStatus
        : "missing"
      : "not_required";
  const innovationAnchorPoints =
    search.innovationAnchorPoints.length > 0
      ? search.innovationAnchorPoints
      : collectInnovationAnchorPoints({
          manifest: manifestRecord,
          trackRecords: researchProgramTracks,
        });
  const validatedDatasets = collectValidatedDatasetsFromLedger({
    ledgerLike: params.experimentLedger,
    trackId: search.trackId,
    experimentIds: preferredExperimentIds,
  });
  const baselineDatasetCoverage = deriveBaselineDatasetCoverage({
    baselineDatasets:
      search.baselineDatasetEnvelope.length > 0
        ? search.baselineDatasetEnvelope
        : collectBaselineDatasetEnvelope({
            manifest: manifestRecord,
            trackRecords: researchProgramTracks,
          }),
    validatedDatasets:
      search.validatedDatasetEnvelope.length > 0
        ? search.validatedDatasetEnvelope
        : validatedDatasets,
    required:
      outerLoop.requireBaselineDatasetCoverageForEffectiveCandidates,
  });
  const ledgerExperiments = (
    Array.isArray((params.experimentLedger as Record<string, unknown> | null)?.experiments)
      ? (((params.experimentLedger as Record<string, unknown>).experiments as unknown[]) ?? [])
      : []
  )
    .map((entry) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : null
    )
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const ledgerCandidateTexts = ledgerExperiments
    .filter((entry) => {
      const experimentId =
        readString(entry.experiment_id) ?? readString(entry.experimentId);
      return (
        preferredExperimentIds.length === 0 ||
        (experimentId != null && preferredExperimentIds.includes(experimentId))
      );
    })
    .flatMap((entry) => [
      readString(entry.name),
      readString(entry.hypothesis),
      readString(entry.summary),
      ...(Array.isArray(entry.notes) ? entry.notes.map((value) => String(value)) : []),
    ])
    .filter((entry): entry is string => Boolean(entry));
  const candidateTexts = [
    ...(countSpecificTextTokens(ledgerCandidateTexts) < 6
      ? [search.oneChangeSignature]
      : []),
    ...ledgerCandidateTexts,
  ].filter((entry): entry is string => Boolean(entry));
  const innovationDeviation = deriveInnovationDeviation({
    anchorPoints: innovationAnchorPoints,
    candidateTexts,
    tolerance: outerLoop.innovationDeviationTolerance,
  });
  const candidateIdentityPresent =
    preferredExperimentIds.length > 0 ||
    Boolean(search.lastCandidateBranch) ||
    Boolean(search.lastCandidateCommit);
  const hasRecordedRunEvidence = ledgerExperiments.some((entry) => {
    const status = normalizeStageLike(entry.status);
    if (
      [
        "running",
        "done",
        "completed",
        "failed",
        "timeout",
        "timed_out",
        "stalled",
        "killed",
        "discard",
        "discarded",
        "merged",
      ].includes(status)
    ) {
      return true;
    }
    return Boolean(
      readString(entry.launched_at) ??
        readString(entry.launchedAt) ??
        readString(entry.completed_at) ??
        readString(entry.completedAt) ??
        readString(entry.remote_run_path) ??
        readString(entry.remoteRunPath) ??
        readString(entry.run_id) ??
        readString(entry.runId) ??
        readString(entry.screen_name) ??
        readString(entry.screenName)
    );
  });
  const effectiveCandidateClaimed =
    candidateIdentityPresent &&
    (
      search.lastDecision === "advance" ||
      innovationStatus === "supported" ||
      innovationStatus === "fragile" ||
      isReadyLike(search.innovationStatus)
    );

  const cleanEvidence =
    isReadyLike(baselineFairnessStatus) &&
    isReadyLike(implementationConfidence) &&
    isReadyLike(search.multiSeedStatus) &&
    isReadyLike(ablationStatus) &&
    isReadyLike(evidenceCleanlinessStatus);
  const multiSeedReady = isReadyLike(search.multiSeedStatus);
  const ablationReady = isReadyLike(ablationStatus);
  const plotPackReadyForGate =
    isReadyLike(search.plotPackStatus) || Boolean(search.plotPackPath);
  const metricEvidence = selectKarpathyMetricEvidence({
    ledgerExperiments,
    preferredExperimentIds,
  });
  const analysisGate = buildExperimentAnalysisGate({
    search,
    hasRecordedRunEvidence,
    metricEvidence,
    multiSeedReady,
    ablationReady,
    plotPackReady: plotPackReadyForGate,
    cleanEvidence,
    baselineDatasetCoverageStatus: baselineDatasetCoverage.status,
    innovationDeviationStatus: innovationDeviation.status,
    innovationStatus,
    comparableTrialBudgetStatus,
    oneChangeValidationStatus,
    reviewBlockerCount,
  });

  if (
    searchStatus === "ready_for_analysis" &&
    cleanEvidence &&
    searchExhaustionStatus !== "exhausted"
  ) {
    if (
      effectiveCandidateClaimed &&
      (
        comparableTrialBudgetStatus === "over_budget" ||
        oneChangeValidationStatus === "missing" ||
        baselineDatasetCoverage.status === "partial" ||
        baselineDatasetCoverage.status === "missing" ||
        innovationDeviation.status === "broad_drift"
      )
    ) {
      return {
        decision: "innovation_fragile",
        rationale:
          comparableTrialBudgetStatus === "over_budget"
            ? `The current candidate exceeded the fixed trial budget (${measuredTrialDurationMinutes}m > ${innerLoop.trialTimeBudgetMinutes}m), so the gain is not yet apples-to-apples comparable.`
            : oneChangeValidationStatus === "missing"
              ? "The current candidate lacks a stable one_change_signature, so the retained gain is not yet attributable to one bounded intervention."
              : baselineDatasetCoverage.status === "partial" ||
                  baselineDatasetCoverage.status === "missing"
                ? baselineDatasetCoverage.summary ??
                  "The current candidate still needs validation on the baseline dataset envelope before it can be treated as stably effective."
                : innovationDeviation.summary ??
                  "The current candidate appears to be drifting too far from the original innovation anchors.",
        decisionConfidence: "medium",
        implementationConfidence,
        baselineFairnessStatus,
        ablationStatus,
        innovationStatus: "fragile",
        searchExhaustionStatus,
        evidenceCleanlinessStatus,
        recommendedNextAction:
          baselineDatasetCoverage.status === "partial" ||
          baselineDatasetCoverage.status === "missing"
            ? "Extend validation to the datasets already named in the baseline envelope before analysis."
            : innovationDeviation.status === "broad_drift"
              ? "Realign the next candidate with the original innovation anchors instead of widening into a new idea."
              : comparableTrialBudgetStatus === "over_budget"
                ? "Rerun the candidate inside the fixed trial budget before keeping it."
                : "Tighten the candidate so one bounded change explains the gain before analysis.",
        validationStage:
          baselineDatasetCoverage.status === "partial" ||
          baselineDatasetCoverage.status === "missing"
            ? "dataset_coverage_validation"
            : innovationDeviation.status === "broad_drift"
              ? "innovation_alignment_review"
              : "inner_loop_validation",
        failureClusters,
        persistedPatch: {
          validation_stage:
            baselineDatasetCoverage.status === "partial" ||
            baselineDatasetCoverage.status === "missing"
              ? "dataset_coverage_validation"
              : innovationDeviation.status === "broad_drift"
                ? "innovation_alignment_review"
                : "inner_loop_validation",
          inner_loop_mode: innerLoop.mode,
          trial_time_budget_minutes: innerLoop.trialTimeBudgetMinutes,
          strict_comparable_budget: innerLoop.strictComparableBudget,
          require_one_change_signature: innerLoop.requireOneChangeSignature,
          one_change_signature: search.oneChangeSignature,
          one_change_validation_status: oneChangeValidationStatus,
          comparable_trial_budget_status: comparableTrialBudgetStatus,
          last_trial_outcome: "keep_candidate_pending_outer_review",
          keep_discard_rule: innerLoop.keepDiscardRule,
          baseline_dataset_envelope: baselineDatasetCoverage.baselineDatasets,
          validated_dataset_envelope: baselineDatasetCoverage.validatedDatasets,
          baseline_dataset_coverage_status: baselineDatasetCoverage.status,
          baseline_dataset_coverage_missing: baselineDatasetCoverage.missingDatasets,
          baseline_dataset_coverage_summary: baselineDatasetCoverage.summary,
          innovation_anchor_points: innovationAnchorPoints,
          innovation_deviation_status: innovationDeviation.status,
          innovation_deviation_score: innovationDeviation.score,
          innovation_deviation_summary: innovationDeviation.summary,
          baseline_fairness_status: baselineFairnessStatus,
          implementation_confidence: implementationConfidence,
          search_exhaustion_status: searchExhaustionStatus,
          ablation_status: ablationStatus,
          innovation_status: "fragile",
          decision_confidence: "medium",
          recommended_next_action:
            baselineDatasetCoverage.status === "partial" ||
            baselineDatasetCoverage.status === "missing"
              ? "Extend validation to the datasets already named in the baseline envelope before analysis."
              : innovationDeviation.status === "broad_drift"
                ? "Realign the next candidate with the original innovation anchors instead of widening into a new idea."
                : comparableTrialBudgetStatus === "over_budget"
                  ? "Rerun the candidate inside the fixed trial budget before keeping it."
                  : "Tighten the candidate so one bounded change explains the gain before analysis.",
          failure_cluster_ids: failureClusters.map((cluster) => cluster.clusterId),
          evidence_cleanliness_status: evidenceCleanlinessStatus,
          last_decision: "innovation_fragile",
          pending_reason: null,
        },
      };
    }
    return {
      decision: "innovation_supported",
      rationale:
        "Experiment search is already marked ready_for_analysis with clean baseline, multi-seed, ablation, and evidence signals.",
      decisionConfidence: "high",
      implementationConfidence,
      baselineFairnessStatus,
      ablationStatus,
      innovationStatus: isReadyLike(innovationStatus) ? innovationStatus : "supported",
      searchExhaustionStatus,
      evidenceCleanlinessStatus,
      recommendedNextAction: "Freeze the current incumbent and proceed toward analysis.",
      validationStage: "decision",
      failureClusters,
      persistedPatch: {
        validation_stage: "decision",
        baseline_fairness_status: baselineFairnessStatus,
        implementation_confidence: implementationConfidence,
        search_exhaustion_status: searchExhaustionStatus,
        ablation_status: ablationStatus,
        innovation_status: isReadyLike(innovationStatus) ? innovationStatus : "supported",
        decision_confidence: "high",
        recommended_next_action: "Freeze the current incumbent and proceed toward analysis.",
        failure_cluster_ids: failureClusters.map((cluster) => cluster.clusterId),
        evidence_cleanliness_status: evidenceCleanlinessStatus,
        last_decision: "innovation_supported",
        pending_reason: null,
      },
    };
  }

  let decision: ExperimentSearchDecision = "continue_tuning";
  let rationale = "Search envelope is still active and no stronger terminal signal is present.";
  let decisionConfidence: "low" | "medium" | "high" = "medium";
  let recommendedNextAction = "Continue bounded tuning inside the approved search envelope.";
  let analysisGatePatch: ExperimentAnalysisGate | null = null;
  let validationStage =
    search.validationStage ??
    spec.searchLadder[0] ??
    (isReadyLike(search.multiSeedStatus) ? "ablation_validation" : "local_hparam_search");

  if (
    !hasRecordedRunEvidence &&
    !candidateIdentityPresent &&
    ["not_started", "missing"].includes(searchStatus) &&
    reviewBlockerCount === 0
  ) {
    decision = "launch_pending";
    rationale =
      "No experiment launch has started yet, so the workflow should return to Researcher for launch orchestration rather than treating the stage as a coder-side repair.";
    decisionConfidence = "high";
    recommendedNextAction =
      "Run /experiment-phase to schedule the first baseline-faithful launch group, initialize EXPERIMENT_REGISTRY.md / EXPERIMENT_LEDGER.json, and delegate atomic bundle launches to Coder.";
    validationStage = "launch_planning";
  } else if (gpuRecommendation === "reconcile_finished" || likelyFinishedRunCount > 0) {
    decision = "reconcile_runtime";
    rationale =
      "Runtime monitor indicates one or more tracked runs are likely finished and need reconciliation.";
    decisionConfidence = "high";
    recommendedNextAction =
      "Run monitor/reconciliation and update ledger + experiment_search before making scientific judgments.";
    validationStage = "runtime_reconciliation";
  } else if (reviewBlockerCount > 0) {
    decision = "repair_implementation";
    rationale =
      `Experiment review still has blocker(s): ${reviewBlockers.join("; ") || `${reviewBlockerCount} unresolved blocker(s)`}.`;
    decisionConfidence = "high";
    recommendedNextAction =
      "Resolve the experiment review blockers before widening the search or treating current evidence as trustworthy.";
    validationStage = "review_blockers";
  } else if (experimentMemorySyncRequired) {
    decision = "reconcile_runtime";
    rationale =
      "Experiment memory still requires evidence synchronization, so the durable research record is not closed yet.";
    decisionConfidence = "medium";
    recommendedNextAction =
      "Synchronize experiment memory / PaperNexus evidence and reconcile the runtime record before continuing.";
    validationStage = "runtime_reconciliation";
  } else if (
    !isReadyLike(baselineFairnessStatus) &&
    searchExhaustionStatus === "exhausted"
  ) {
    decision = "rollback_to_plan";
    rationale =
      "Baseline fairness never stabilized before the search envelope was exhausted, so the workflow should rollback instead of continuing to tune blindly.";
    decisionConfidence = "high";
    recommendedNextAction =
      "Rollback to PLAN, repair the baseline contract, and only reopen search after fairness is explicitly re-established.";
    validationStage = "decision";
  } else if (
    (isFailureLike(implementationConfidence) ||
      implementationFailureCount >= 2 ||
      runtimeFailureCount >= 2) &&
    searchExhaustionStatus === "exhausted"
  ) {
    decision = "rollback_to_plan";
    rationale =
      "Implementation/runtime instability consumed the bounded search budget, so the workflow should rollback instead of treating the current envelope as trustworthy.";
    decisionConfidence = "high";
    recommendedNextAction =
      "Rollback to PLAN, reduce implementation complexity or repair the execution contract, and reopen search only after the implementation becomes trusted.";
    validationStage = "decision";
  } else if (!isReadyLike(baselineFairnessStatus)) {
    decision = "repair_implementation";
    rationale =
      "Baseline fairness is not yet clean, so search outcomes cannot be treated as reliable innovation evidence.";
    decisionConfidence = "high";
    recommendedNextAction =
      "Repair baseline parity, evaluation harness alignment, or protocol drift before widening the search.";
    validationStage = "baseline_parity";
  } else if (isFailureLike(implementationConfidence) || implementationFailureCount > 0 || runtimeFailureCount > 0) {
    decision = "repair_implementation";
    rationale =
      "Failure evidence is still dominated by runtime or implementation instability, so the innovation should not be invalidated yet.";
    decisionConfidence = implementationFailureCount + runtimeFailureCount >= 2 ? "high" : "medium";
    recommendedNextAction =
      "Stabilize implementation/runtime, then rerun comparable candidates before judging the innovation.";
    validationStage = "repair_implementation";
  } else if (
    effectiveCandidateClaimed &&
    searchExhaustionStatus !== "exhausted" &&
    innerLoop.requireOneChangeSignature &&
    oneChangeValidationStatus === "missing"
  ) {
    decision = "repair_implementation";
    rationale =
      "The candidate still lacks a stable one_change_signature, so the gain cannot be attributed to one bounded intervention.";
    decisionConfidence = "high";
    recommendedNextAction =
      "Restate the candidate as one bounded change, persist the one_change_signature, and rerun the trial before keeping it.";
    validationStage = "inner_loop_validation";
  } else if (
    effectiveCandidateClaimed &&
    searchExhaustionStatus !== "exhausted" &&
    innerLoop.strictComparableBudget &&
    comparableTrialBudgetStatus === "over_budget"
  ) {
    decision = "continue_tuning";
    rationale =
      `The latest candidate exceeded the fixed trial budget (${measuredTrialDurationMinutes}m > ${innerLoop.trialTimeBudgetMinutes}m), so the result is not yet strictly comparable to prior trials.`;
    decisionConfidence = "medium";
    recommendedNextAction =
      "Trim the candidate back under the fixed trial budget and rerun before treating it as a keep/discard win.";
    validationStage = "inner_loop_validation";
  } else if (!isReadyLike(search.multiSeedStatus)) {
    decision = search.lastDecision === "advance" ? "require_multi_seed" : "continue_tuning";
    rationale = isReadyLike(search.plotPackStatus)
      ? "A candidate looks promising, but multi-seed validation is still required before trusting the gain."
      : "Primary metric evidence is still too shallow; continue bounded tuning until a candidate justifies multi-seed validation.";
    decisionConfidence = "medium";
    recommendedNextAction =
      decision === "require_multi_seed"
        ? "Run multi-seed validation on the current incumbent candidate."
        : "Continue the bounded search loop until a stronger incumbent appears.";
    validationStage = decision === "require_multi_seed" ? "multi_seed_validation" : "local_hparam_search";
  } else if (!isReadyLike(ablationStatus)) {
    decision = "require_ablation";
    rationale =
      "Multi-seed evidence is available, but the innovation has not yet been isolated through ablation.";
    decisionConfidence = "high";
    recommendedNextAction =
      "Run the approved ablation set before deciding whether the innovation is genuinely responsible for the gain.";
    validationStage = "ablation_validation";
  } else if (
    multiSeedReady &&
    ablationReady &&
    searchExhaustionStatus !== "exhausted" &&
    searchStatus !== "ready_for_analysis" &&
    hasRecordedRunEvidence
  ) {
    analysisGatePatch = analysisGate;
    if (analysisGate.decision === "ready_for_analysis") {
      decision = "innovation_supported";
      rationale =
        "Karpathy-style analysis gate found a positive promoted trial and enough auxiliary novelty/readiness evidence to freeze the incumbent for analysis.";
      decisionConfidence = "high";
      recommendedNextAction =
        "Freeze the current incumbent and proceed toward analysis.";
      validationStage = "analysis_gate";
    } else if (analysisGate.decision === "repair_required") {
      decision = "repair_implementation";
      rationale =
        `Analysis gate found hard blocker(s): ${analysisGate.hard_blockers.join("; ")}.`;
      decisionConfidence = "high";
      recommendedNextAction =
        "Repair the hard analysis-gate blockers before continuing search or entering analysis.";
      validationStage = "analysis_gate_repair";
    } else {
      decision = "continue_tuning";
      rationale =
        "Karpathy-style analysis gate did not find a positive enough promoted trial with sufficient auxiliary support; continue the bounded search loop.";
      decisionConfidence = "medium";
      recommendedNextAction =
        "Continue the Karpathy-style bounded search loop from the current incumbent; do not enter analysis until a positive promoted trial passes the auxiliary gate.";
      validationStage = "analysis_gate_continue_search";
    }
  } else if (isReadyLike(innovationStatus)) {
    decision = innovationStatus === "fragile" ? "innovation_fragile" : "innovation_supported";
    rationale =
      decision === "innovation_supported"
        ? "Clean comparison, multi-seed, and ablation all support the current innovation."
        : "The innovation has some support, but robustness or attribution is still fragile.";
    decisionConfidence = decision === "innovation_supported" ? "high" : "medium";
    recommendedNextAction =
      decision === "innovation_supported"
        ? "Freeze the current incumbent and proceed toward analysis."
        : "Narrow search around the incumbent or gather one more robustness slice before final analysis.";
    validationStage = "decision";
    if (
      outerLoop.requireBaselineDatasetCoverageForEffectiveCandidates &&
      (baselineDatasetCoverage.status === "partial" ||
        baselineDatasetCoverage.status === "missing")
    ) {
      decision = "innovation_fragile";
      rationale =
        baselineDatasetCoverage.summary ??
        "The current candidate still needs validation on the baseline dataset envelope before it can be treated as stably effective.";
      decisionConfidence = "medium";
      recommendedNextAction =
        "Extend validation to the datasets already named in the baseline envelope before analysis.";
      validationStage = "dataset_coverage_validation";
    } else if (innovationDeviation.status === "broad_drift") {
      decision = "innovation_fragile";
      rationale =
        innovationDeviation.summary ??
        "The current candidate appears to be drifting too far from the original innovation anchors.";
      decisionConfidence = "medium";
      recommendedNextAction =
        "Realign the next candidate with the original innovation anchors instead of widening into a new idea.";
      validationStage = "innovation_alignment_review";
    }
  } else if (
    searchExhaustionStatus === "exhausted" &&
    cleanEvidence &&
    scientificFailureCount >= 2
  ) {
    decision = resolveRollbackDecision(spec);
    rationale =
      "The search envelope is exhausted and repeated clean failures remain attributable to the innovation itself.";
    decisionConfidence = "high";
    recommendedNextAction =
      decision === "rollback_to_idea"
        ? "Invalidate the current innovation hypothesis and rollback to IDEA for a new direction."
        : "Invalidate the current innovation hypothesis and rollback to PLAN for a new direction.";
    validationStage = "decision";
  } else if (searchExhaustionStatus === "exhausted") {
    decision = scientificFailureCount > 0 ? "narrow_search" : "continue_tuning";
    rationale =
      "The current envelope looks exhausted, but the evidence is not yet clean enough to invalidate the innovation.";
    decisionConfidence = "medium";
    recommendedNextAction =
      "Narrow the search neighborhood or repair evidence quality before declaring the innovation invalid.";
    validationStage = "search_refinement";
  }

  const persistedPatch = {
    ...(analysisGatePatch
      ? {
          analysis_gate: analysisGatePatch,
          current_main_stage:
            analysisGatePatch.decision === "ready_for_analysis"
              ? "analysis_decision"
              : "karpathy_inner_loop",
          current_substage:
            analysisGatePatch.decision === "ready_for_analysis"
              ? "karpathy_analysis_gate_passed"
              : analysisGatePatch.decision === "repair_required"
                ? "analysis_gate_repair_required"
                : "analysis_gate_continue_search",
          ...(analysisGatePatch.decision === "ready_for_analysis"
            ? { status: "ready_for_analysis" }
            : analysisGatePatch.decision === "continue_search"
              ? { status: "searching" }
              : {}),
        }
      : {}),
    inner_loop_mode: innerLoop.mode,
    trial_time_budget_minutes: innerLoop.trialTimeBudgetMinutes,
    strict_comparable_budget: innerLoop.strictComparableBudget,
    require_one_change_signature: innerLoop.requireOneChangeSignature,
    one_change_signature: search.oneChangeSignature,
    one_change_validation_status: oneChangeValidationStatus,
    comparable_trial_budget_status: comparableTrialBudgetStatus,
    keep_discard_rule: innerLoop.keepDiscardRule,
    last_trial_outcome:
      decision === "innovation_supported"
        ? "keep"
        : decision === "innovation_fragile"
          ? "keep_candidate_pending_outer_review"
          : decision === "rollback_to_plan" || decision === "rollback_to_idea"
            ? "discard"
            : search.lastTrialOutcome,
    baseline_dataset_envelope: baselineDatasetCoverage.baselineDatasets,
    validated_dataset_envelope: baselineDatasetCoverage.validatedDatasets,
    baseline_dataset_coverage_status: baselineDatasetCoverage.status,
    baseline_dataset_coverage_missing: baselineDatasetCoverage.missingDatasets,
    baseline_dataset_coverage_summary: baselineDatasetCoverage.summary,
    innovation_anchor_points: innovationAnchorPoints,
    innovation_deviation_status: innovationDeviation.status,
    innovation_deviation_score: innovationDeviation.score,
    innovation_deviation_summary: innovationDeviation.summary,
    validation_stage: validationStage,
    baseline_fairness_status: baselineFairnessStatus,
    implementation_confidence: implementationConfidence,
    search_exhaustion_status: searchExhaustionStatus,
    ablation_status: ablationStatus,
    innovation_status:
      decision === "rollback_to_plan" ||
      decision === "rollback_to_idea"
        ? "invalidated"
        : decision === "innovation_supported"
          ? "supported"
          : decision === "innovation_fragile"
            ? "fragile"
            : innovationStatus,
    decision_confidence: decisionConfidence,
    recommended_next_action: recommendedNextAction,
    failure_cluster_ids: failureClusters.map((cluster) => cluster.clusterId),
    evidence_cleanliness_status: evidenceCleanlinessStatus,
    last_decision: decision,
    pending_reason:
      experimentMemoryDecisionSummary && !rationale.includes(experimentMemoryDecisionSummary)
        ? `${rationale} Previous memory summary: ${experimentMemoryDecisionSummary}`
        : rationale,
  };

  return {
    decision,
    rationale,
    decisionConfidence,
    implementationConfidence,
    baselineFairnessStatus,
    ablationStatus,
    innovationStatus:
      typeof persistedPatch.innovation_status === "string"
        ? persistedPatch.innovation_status
        : innovationStatus,
    searchExhaustionStatus,
    evidenceCleanlinessStatus,
    recommendedNextAction,
    validationStage,
    failureClusters,
    persistedPatch,
  };
}

export async function evaluateExperimentSearchDecisionForProject(params: {
  projectRoot: string;
  persist?: boolean;
}) {
  const projectRoot = path.resolve(params.projectRoot);
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const experimentSearchRaw =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "researcher", "EXPERIMENT_SEARCH.json")
    )) ?? (manifest.experiment_search as Record<string, unknown> | undefined) ?? {};
  const specPath =
    readString((experimentSearchRaw as Record<string, unknown>).search_spec_path) ??
    "planner/EXPERIMENT_SEARCH_SPEC.json";
  const specRaw =
    (await readJsonIfExists<Record<string, unknown>>(
      path.isAbsolute(specPath) ? specPath : path.join(projectRoot, specPath)
    )) ?? {};
  const ledgerRaw =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json")
    )) ?? {};
  const gpuMonitorRaw =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "researcher", "EXPERIMENT_GPU_MONITOR.json")
    )) ?? null;

  const summary = evaluateExperimentSearchDecision({
    experimentSearch: experimentSearchRaw,
    experimentSearchSpec: specRaw,
    experimentLedger: ledgerRaw,
    gpuMonitor: gpuMonitorRaw,
    experimentReviewState: manifest.experiment_review_state,
    experimentMemory: manifest.experiment_memory,
    manifest,
  });

  if (params.persist !== false) {
    const nextSearch = {
      ...normalizeExperimentSearchState(experimentSearchRaw),
      ...summary.persistedPatch,
      last_updated_at: new Date().toISOString(),
    };
    const serialized = {
      ...experimentSearchRaw,
      ...summary.persistedPatch,
      last_updated_at: new Date().toISOString(),
    };
    await writeJsonEnsured(path.join(projectRoot, "researcher", "EXPERIMENT_SEARCH.json"), serialized);
    manifest.experiment_search = {
      ...(manifest.experiment_search as Record<string, unknown> | undefined),
      ...summary.persistedPatch,
      last_updated_at: serialized.last_updated_at,
    };
    await writeJsonEnsured(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);
    return {
      summary,
      state: nextSearch,
    };
  }

  return {
    summary,
    state: normalizeExperimentSearchState(experimentSearchRaw),
  };
}
