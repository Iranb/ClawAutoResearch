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

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStageLike(value: unknown): string {
  return readString(value)?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_") ?? "unknown";
}

function isReadyLike(value: unknown): boolean {
  return ["ready", "pass", "covered", "complete", "completed", "clean", "trusted"].includes(
    normalizeStageLike(value)
  );
}

function isFailureLike(value: unknown): boolean {
  return ["fail", "failed", "blocked", "invalid", "invalidated", "untrusted", "broken"].includes(
    normalizeStageLike(value)
  );
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
  const ledgerExperiments = Array.isArray((params.experimentLedger as Record<string, unknown> | null)?.experiments)
    ? (((params.experimentLedger as Record<string, unknown>).experiments as unknown[]) ?? [])
    : [];
  const candidateTexts = ledgerExperiments
    .map((entry) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : null
    )
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .filter((entry) => {
      const experimentId =
        readString(entry.experiment_id) ?? readString(entry.experimentId);
      return preferredExperimentIds.length === 0 || (experimentId != null && preferredExperimentIds.includes(experimentId));
    })
    .flatMap((entry) => [
      readString(entry.name),
      readString(entry.hypothesis),
      readString(entry.summary),
      ...(Array.isArray(entry.notes) ? entry.notes.map((value) => String(value)) : []),
    ])
    .filter((entry): entry is string => Boolean(entry));
  const innovationDeviation = deriveInnovationDeviation({
    anchorPoints: innovationAnchorPoints,
    candidateTexts,
    tolerance: outerLoop.innovationDeviationTolerance,
  });
  const candidateIdentityPresent =
    preferredExperimentIds.length > 0 ||
    Boolean(search.lastCandidateBranch) ||
    Boolean(search.lastCandidateCommit);
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
  let validationStage =
    search.validationStage ??
    spec.searchLadder[0] ??
    (isReadyLike(search.multiSeedStatus) ? "ablation_validation" : "local_hparam_search");

  if (gpuRecommendation === "reconcile_finished" || likelyFinishedRunCount > 0) {
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
