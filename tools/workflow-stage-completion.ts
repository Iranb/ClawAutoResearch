import * as path from "node:path";

import {
  asRecord,
  asString,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickString,
  uniqueStrings,
} from "./workflow-guard-core/coercion";
import {
  pathExists,
  readJsonIfExists,
  readTextIfExists,
} from "./workflow-guard-core/fs";
import { evaluatePaperGuruGate } from "./autoresearch-loop-state";
import {
  DEFAULT_PACKET_ARTIFACTS,
  collectBundleChecks,
  collectLocalCodeReviewBlockers,
  type CodeReviewPacket,
} from "./workflow-code-review";
import { isIdeaCatalystReadyForPlan } from "./idea-catalyst/workflow-bridge";
import { normalizeSurveyReviewState } from "./workflow-guard-state/survey-review";
import { normalizeBrainstormCycleState } from "./workflow-guard-state/research-loop-state";
import {
  normalizeFigureQcState,
  normalizeWritePackageState,
} from "./workflow-guard-state/execution-state";
import { normalizeWritingContractState } from "./workflow-guard-state/writing-contract";
import { normalizePaperStoryState } from "./workflow-guard-state/paper-story";
import { normalizeTitleAbstractIntroWorkbenchState } from "./workflow-guard-state/title-abstract-intro-workbench";
import {
  INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON,
} from "./workflow-guard-state/paper-ingestion";
import { isBrainstormCycleReady } from "./workflow-kernel/readiness";
import { getWritePackageValidationErrors } from "./workflow-guard-writing/write-package-eval";
import { collectExecutionProofReceipts } from "./workflow-execution-proof";
import { evaluateExperimentSearchDecision } from "./workflow-experiment-decision";
import { readWorkflowHooksStateStore } from "./workflow-hooks/state";
import {
  readWorkflowRuntimeQueueStore,
  readWorkflowRuntimeSessionsStore,
  type WorkflowRuntimeQueueEntry,
  type WorkflowRuntimeSessionEntry,
} from "./workflow-runtime-state";

const IDEA_CATALYST_PACKET_BUNDLE_PATH =
  "researcher/papernexus/IDEA_CATALYST_PACKET_BUNDLE.json";
const LITERATURE_DISCOVERY_PACKET_PATH =
  "researcher/literature-discovery/LITERATURE_DISCOVERY_PACKET.json";

const DOWNSTREAM_GRAPH_SENSITIVE_STAGES = new Set([
  "frontier_mapping",
  "idea",
  "review",
  "write",
  "submit",
  "done",
]);

const LEGACY_REENTRY_STAGE_PRIORITY: Record<string, number> = {
  frontier_mapping: 10,
  idea: 20,
  plan: 30,
  code: 40,
  experiment: 50,
  analyze: 60,
  review: 70,
  write: 80,
  submit: 90,
};

export type StageCompletionStatus =
  | "complete"
  | "incomplete"
  | "blocked"
  | "failed";

export type StageRuntimeState = "idle" | "active" | "queued" | "degraded";

export type StageCompletion = {
  stage: string;
  completionStatus: StageCompletionStatus;
  owner: string | null;
  nextAction: string | null;
  blockingReason: string | null;
  contractSource: string;
  missingSignals?: string[];
  repairProjection?: boolean;
  runtimeState?: StageRuntimeState;
  queueKey?: string | null;
  sessionKey?: string | null;
};

const READY_VALUES = new Set([
  "ready",
  "complete",
  "completed",
  "pass",
  "passed",
  "clean",
  "verified",
]);

const FAILURE_VALUES = new Set([
  "failed",
  "failure",
  "terminal_failed",
  "failed_terminal",
  "blocked",
  "invalid",
  "broken",
]);

const DEFAULT_STAGE_OWNERS: Record<string, string> = {
  setup: "researcher",
  survey_review: "researcher",
  graph_build: "researcher",
  frontier_mapping: "researcher",
  idea: "researcher",
  plan: "orchestrator",
  code: "coder",
  experiment: "researcher",
  analyze: "analyzer",
  write: "academic_writer",
  review: "reviewer",
  submit: "reviewer",
  done: "orchestrator",
  topic_search: "researcher",
  literature_review: "researcher",
  ideation: "researcher",
  experiment_plan: "orchestrator",
  experiment_loop: "researcher",
  analysis: "analyzer",
  writing: "academic_writer",
  polish_review: "reviewer",
  submission_ready: "orchestrator",
};

const DEFAULT_STAGE_ACTIONS: Record<string, string> = {
  setup: "/project-init",
  survey_review: "/survey-pipeline",
  graph_build: "/graph-build",
  frontier_mapping: "/frontier-map",
  idea: "/idea-catalyst",
  plan: "/plan-phase",
  code: "/run-experiment",
  experiment: "/monitor-experiment",
  analyze: "/analyze-results",
  write: "/write-paper",
  review: "/review-paper",
  submit: "/submit-ready",
  topic_search: "/literature-discovery",
  literature_review: "/research-briefing",
  ideation: "/idea-catalyst",
  experiment_plan: "/plan-experiment",
  experiment_loop: "/monitor-experiment",
  analysis: "/analyze-results",
  writing: "/write-paper",
  polish_review: "/review-paper",
  submission_ready: "/submit-ready",
};

function readyLike(value: unknown): boolean {
  const normalized = normalizeStage(value);
  return normalized ? READY_VALUES.has(normalized) : false;
}

function failureLike(value: unknown): boolean {
  const normalized = normalizeStage(value);
  return normalized ? FAILURE_VALUES.has(normalized) : false;
}

function stageOwner(stage: string): string | null {
  return DEFAULT_STAGE_OWNERS[stage] ?? null;
}

function stageAction(stage: string): string | null {
  return DEFAULT_STAGE_ACTIONS[stage] ?? null;
}

async function nonEmptyText(relativePath: string, projectRoot: string): Promise<boolean> {
  const text = await readTextIfExists(path.join(projectRoot, relativePath));
  return Boolean(text?.trim());
}

function recordList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function hasRecordFields(value: unknown): boolean {
  const record = asRecord(value);
  return Boolean(record && Object.keys(record).length > 0);
}

function paperIngestionRequests(
  manifest: Record<string, unknown>
): Record<string, unknown>[] {
  const paperIngestion = asRecord(manifest.paper_ingestion) ?? {};
  return [
    ...recordList(paperIngestion.queued_requests),
    ...recordList(paperIngestion.queuedRequests),
  ];
}

function requestStatus(request: Record<string, unknown>): string | null {
  return normalizeStage(request.status);
}

function requestTrigger(request: Record<string, unknown>): string | null {
  return normalizeStage(
    request.trigger_kind ??
      request.triggerKind ??
      request.request_kind ??
      request.requestKind
  );
}

function isGraphReentryTrigger(value: string | null): boolean {
  return Boolean(
    value &&
      (value.includes("literature_discovery") ||
        value.includes("idea_catalyst"))
  );
}

function isActiveGraphReentryRequest(request: Record<string, unknown>): boolean {
  return (
    isGraphReentryTrigger(requestTrigger(request)) &&
    ["queued", "launching", "running", "needs_repair"].includes(
      requestStatus(request) ?? ""
    )
  );
}

function isFailedGraphReentryRequest(request: Record<string, unknown>): boolean {
  return (
    isGraphReentryTrigger(requestTrigger(request)) &&
    ["failed", "invalid", "dead_lettered", "deadlettered"].includes(
      requestStatus(request) ?? ""
    )
  );
}

function graphReentryRequestFailureSignal(request: Record<string, unknown>): string {
  return (
    pickString(request, [
      "validation_summary",
      "validationSummary",
      "last_error",
      "lastError",
      "dead_letter_reason",
      "deadLetterReason",
      "detail",
    ]) ?? "workflow-owned graph enrichment requisition failed"
  );
}

function normalizeStagePath(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizeStage(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function stageFromTrigger(trigger: string | null): string | null {
  if (!trigger) {
    return null;
  }
  if (trigger.includes("submit")) {
    return "submit";
  }
  if (trigger.includes("write")) {
    return "write";
  }
  if (trigger.includes("review")) {
    return "review";
  }
  if (trigger.includes("idea")) {
    return "idea";
  }
  return null;
}

function chooseLatestReentryStage(stages: Array<string | null>): string | null {
  return (
    stages
      .map((stage) => normalizeStage(stage))
      .filter((stage): stage is string => Boolean(stage))
      .filter((stage) => stage !== "graph_build")
      .sort(
        (left, right) =>
          (LEGACY_REENTRY_STAGE_PRIORITY[right] ?? 0) -
          (LEGACY_REENTRY_STAGE_PRIORITY[left] ?? 0)
      )[0] ?? null
  );
}

function chooseEarliestReentryStageAfterGraph(stages: Array<string | null>): string | null {
  return (
    stages
      .map((stage) => normalizeStage(stage))
      .filter((stage): stage is string => Boolean(stage))
      .filter((stage) => stage !== "graph_build")
      .sort(
        (left, right) =>
          (LEGACY_REENTRY_STAGE_PRIORITY[left] ?? 0) -
          (LEGACY_REENTRY_STAGE_PRIORITY[right] ?? 0)
      )[0] ?? null
  );
}

function hasListItems(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function hasAnyList(record: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => hasListItems(record[key]));
}

function unwrapPacketBundle(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return (
    asRecord(record.packet_bundle) ??
    asRecord(record.packetBundle) ??
    record
  );
}

function artifactStatus(record: Record<string, unknown> | null): string | null {
  return normalizeStage(record?.status ?? record?.state ?? record?.completion_status);
}

function hasLiteratureDiscoveryEvidence(packet: Record<string, unknown> | null): boolean {
  if (!packet) {
    return false;
  }
  return (
    Boolean(pickString(packet, ["discovery_id", "discoveryId", "topic", "research_topic"])) ||
    hasAnyList(packet, [
      "target_domains",
      "targetDomains",
      "candidate_queries",
      "candidateQueries",
      "queries",
      "candidate_papers",
      "candidatePapers",
      "selected_papers",
      "selectedPapers",
      "papers",
    ])
  );
}

function hasIdeaEvidence(record: Record<string, unknown>): boolean {
  if (
    hasAnyList(record, [
      "supporting_papers",
      "supportingPapers",
      "evidence_chain_refs",
      "evidenceChainRefs",
      "source_spans",
      "sourceSpans",
      "bridge_path_ids",
      "bridgePathIds",
      "source_takeaways",
      "sourceTakeaways",
    ])
  ) {
    return true;
  }
  const integrationMechanism = asRecord(record.integration_mechanism);
  return Boolean(
    integrationMechanism &&
      hasAnyList(integrationMechanism, ["selected_takeaways", "selectedTakeaways"])
  );
}

function hasIdeaCatalystEvidence(packet: Record<string, unknown> | null): boolean {
  const bundle = unwrapPacketBundle(packet);
  if (!bundle) {
    return false;
  }
  const fragments = [
    ...recordList(bundle.idea_fragments),
    ...recordList(bundle.ideaFragments),
    ...recordList(bundle.fragments),
  ];
  const analyses = [
    ...recordList(bundle.source_domain_analyses),
    ...recordList(bundle.sourceDomainAnalyses),
    ...recordList(bundle.cross_domain_analysis),
    ...recordList(bundle.crossDomainAnalysis),
    ...recordList(bundle.cross_domain_searches),
    ...recordList(bundle.crossDomainSearches),
  ];
  const hasUsableFragment = fragments.some((fragment) => {
    return Boolean(
      pickString(fragment, ["candidate_id", "candidateId", "id", "title"]) &&
        (pickString(fragment, ["source_domain", "sourceDomain", "target_challenge", "targetChallenge"]) ||
          hasIdeaEvidence(fragment))
    );
  });
  const hasSupportingEvidence =
    fragments.some(hasIdeaEvidence) ||
    analyses.some((analysis) => {
      return (
        hasIdeaEvidence(analysis) ||
        recordList(analysis.takeaways).some((takeaway) => {
          return Boolean(
            hasIdeaEvidence(takeaway) ||
              pickString(takeaway, [
                "concept",
                "mechanism_explanation",
                "mechanismExplanation",
              ])
          );
        })
      );
    });
  return hasUsableFragment && hasSupportingEvidence;
}

function hasExperimentLedgerEvidence(ledger: Record<string, unknown> | null): boolean {
  if (!ledger) {
    return false;
  }
  const trials = [
    ...recordList(ledger.experiments),
    ...recordList(ledger.trial_history),
    ...recordList(ledger.trialHistory),
    ...recordList(ledger.trials),
  ];
  return trials.some((trial) => {
    const metadata = asRecord(trial.metadata) ?? {};
    const trialContract =
      asRecord(metadata.trial_contract ?? metadata.trialContract) ?? {};
    const searchGit = asRecord(metadata.searchGit ?? metadata.search_git) ?? {};
    const execution = asRecord(metadata.execution) ?? {};
    const karpathy =
      asRecord(metadata.karpathy_inner_loop ?? metadata.karpathyInnerLoop) ?? {};
    const attempt = asRecord(metadata.attempt) ?? {};
    const branchOrWorktree =
      pickString(trial, ["branch", "git_branch", "gitBranch"]) ||
      pickString(trial, ["worktree", "worktree_path", "worktreePath"]) ||
      pickString(trialContract, ["branch", "git_branch", "gitBranch"]) ||
      pickString(trialContract, ["worktree", "worktree_path", "worktreePath"]) ||
      pickString(trialContract, ["git_branch", "gitBranch"]) ||
      pickString(searchGit, ["candidateBranch", "candidate_branch"]) ||
      pickString(searchGit, ["worktreePath", "worktree_path"]);
    const commit =
      pickString(trial, ["commit", "commit_hash", "commitHash"]) ||
      pickString(trial, ["head_sha", "headSha"]) ||
      pickString(trialContract, ["commit", "commit_hash", "commitHash"]) ||
      pickString(trialContract, ["head_sha", "headSha"]) ||
      pickString(searchGit, ["candidateCommit", "candidate_commit"]) ||
      pickString(execution, [
        "candidate_commit",
        "candidateCommit",
        "git_commit",
        "gitCommit",
      ]);
    const metric =
      pickString(trial, ["primary_metric", "primaryMetric", "metric"]) ||
      pickString(trialContract, ["primary_metric", "primaryMetric", "metric"]) ||
      Boolean(asRecord(trial.key_metric ?? trial.keyMetric)) ||
      Boolean(asRecord(trial.metrics)) ||
      Boolean(asRecord(trialContract.primary_metric ?? trialContract.primaryMetric)) ||
      Boolean(asRecord(trialContract.metrics));
    const budget =
      pickString(trial, ["fixed_budget", "fixedBudget", "budget"]) ||
      pickString(trialContract, ["fixed_budget", "fixedBudget", "budget"]) ||
      typeof trial.budget === "number" ||
      typeof trialContract.budget === "number" ||
      typeof trialContract.fixed_budget_minutes === "number" ||
      typeof trialContract.fixedBudgetMinutes === "number" ||
      typeof karpathy.trial_time_budget_minutes === "number" ||
      typeof karpathy.trialTimeBudgetMinutes === "number";
    const seed =
      pickString(trial, ["seed"]) ||
      typeof trial.seed === "number" ||
      hasListItems(trial.seeds) ||
      pickString(trialContract, ["seed"]) ||
      typeof trialContract.seed === "number" ||
      hasListItems(trialContract.seeds) ||
      pickString(execution, ["seed"]) ||
      typeof execution.seed === "number" ||
      pickString(attempt, ["seed"]) ||
      typeof attempt.seed === "number";
    const decision =
      pickString(trial, ["decision", "trial_decision", "trialDecision", "status"]) ||
      pickString(trialContract, [
        "decision",
        "trial_decision",
        "trialDecision",
        "status",
      ]);
    return Boolean(branchOrWorktree && commit && metric && budget && seed && decision);
  });
}

function paperQcBlocks(manifest: Record<string, unknown>): string | null {
  const paperQc = asRecord(manifest.paper_qc ?? manifest.paperQc) ?? {};
  const compileStatus = normalizeStage(
    paperQc.compile_status ?? paperQc.compileStatus
  );
  if (compileStatus === "fail" || compileStatus === "failed") {
    return "paper_qc_compile_failed";
  }
  const pageBudgetStatus = normalizeStage(
    paperQc.page_budget_status ?? paperQc.pageBudgetStatus
  );
  if (pageBudgetStatus === "fail" || pageBudgetStatus === "failed") {
    return "paper_qc_page_budget_failed";
  }
  const invalidFigureRefStatus = normalizeStage(
    paperQc.invalid_figure_ref_status ?? paperQc.invalidFigureRefStatus
  );
  if (invalidFigureRefStatus === "fail" || invalidFigureRefStatus === "failed") {
    return "paper_qc_invalid_figure_ref_failed";
  }
  return null;
}

function figureQcBlocks(manifest: Record<string, unknown>): string | null {
  const figureQc = normalizeFigureQcState(manifest.figure_qc ?? manifest.figureQc);
  if (normalizeStage(figureQc.status) === "missing") {
    return null;
  }
  for (const [field, value] of [
    ["duplicate_figure_status", figureQc.duplicateFigureStatus],
    ["caption_alignment_status", figureQc.captionAlignmentStatus],
    ["text_alignment_status", figureQc.textAlignmentStatus],
    ["selection_status", figureQc.selectionStatus],
  ] as const) {
    if (normalizeStage(value) === "fail") {
      return `figure_qc_${field}_failed`;
    }
  }
  return null;
}

function paperStoryBlocksWrite(manifest: Record<string, unknown>): string | null {
  const story = normalizePaperStoryState(
    manifest.paper_story_state ?? manifest.paperStoryState
  );
  if (normalizeStage(story.claimSupportStatus) === "unsupported") {
    return "paper_story_claim_support_unsupported";
  }
  return null;
}

async function proofAppendixBlocksWrite(
  projectRoot: string,
  manifest: Record<string, unknown>
): Promise<string | null> {
  const writingContract = normalizeWritingContractState(
    manifest.writing_contract ?? manifest.writingContract
  );
  if (!writingContract.proofAppendixRequired) {
    return null;
  }
  const appendixPath = resolveProjectArtifactPath(
    projectRoot,
    writingContract.proofAppendixPath
  );
  if (!appendixPath || !(await pathExists(appendixPath))) {
    return "proof_appendix_draft_missing";
  }
  return null;
}

function paperQcReady(manifest: Record<string, unknown>): boolean {
  const paperQc = asRecord(manifest.paper_qc ?? manifest.paperQc) ?? {};
  return (
    readyLike(paperQc.status) ||
    readyLike(paperQc.compile_status ?? paperQc.compileStatus)
  );
}

function topTierOpportunityEnabled(manifest: Record<string, unknown>): boolean {
  const opportunity = asRecord(
    manifest.opportunity_scorecard ?? manifest.opportunityScorecard
  ) ?? {};
  return normalizeStage(opportunity.verdict) === "worth_top_tier_bet";
}

function graphContextNotGrounded(value: unknown): boolean {
  const normalized = normalizeStage(value);
  return normalized === "unverified_graph_context" || normalized === "graph_unavailable";
}

function topTierExperimentMissingSignals(manifest: Record<string, unknown>): string[] {
  if (!topTierOpportunityEnabled(manifest)) {
    return [];
  }
  const benchmark = asRecord(manifest.benchmark_protocol ?? manifest.benchmarkProtocol) ?? {};
  const statistical = asRecord(
    manifest.statistical_evidence ?? manifest.statisticalEvidence
  ) ?? {};
  const ablation = asRecord(manifest.ablation_evidence ?? manifest.ablationEvidence) ?? {};
  const missing: string[] = [];
  const benchmarkStatus = normalizeStage(benchmark.status) ?? "missing";
  const driftStatus = normalizeStage(benchmark.drift_status ?? benchmark.driftStatus);
  const fairCompareStatus = normalizeStage(
    benchmark.fair_compare_status ?? benchmark.fairCompareStatus
  ) ?? "missing";
  const allowedDeviationStatus = normalizeStage(
    benchmark.allowed_deviation_status ?? benchmark.allowedDeviationStatus
  );
  const statisticalStatus = normalizeStage(statistical.status) ?? "missing";
  const claimStrengthStatus = normalizeStage(
    statistical.claim_strength_status ?? statistical.claimStrengthStatus
  );
  const ablationStatus = normalizeStage(ablation.status) ?? "missing";
  const sufficiencyStatus = normalizeStage(
    ablation.sufficiency_status ?? ablation.sufficiencyStatus
  );
  if (benchmarkStatus === "missing") {
    missing.push(
      "PROJECT_MANIFEST.json.benchmark_protocol.status must not be missing when opportunity_scorecard.verdict = worth_top_tier_bet"
    );
  }
  if (benchmark.locked !== true) {
    missing.push(
      "PROJECT_MANIFEST.json.benchmark_protocol.locked = true before top-tier ANALYZE handoff"
    );
  }
  if (driftStatus === "fail" || driftStatus === "failed") {
    missing.push(
      "PROJECT_MANIFEST.json.benchmark_protocol.drift_status must not be fail before top-tier ANALYZE handoff"
    );
  }
  if (fairCompareStatus === "missing") {
    missing.push(
      "PROJECT_MANIFEST.json.benchmark_protocol.fair_compare_status must not be missing before top-tier ANALYZE handoff"
    );
  }
  if (fairCompareStatus === "fail" || fairCompareStatus === "failed") {
    missing.push(
      "PROJECT_MANIFEST.json.benchmark_protocol.fair_compare_status must not be fail before top-tier ANALYZE handoff"
    );
  }
  if (allowedDeviationStatus === "blocked") {
    missing.push(
      "PROJECT_MANIFEST.json.benchmark_protocol.allowed_deviation_status must not be blocked before top-tier ANALYZE handoff"
    );
  }
  if (statisticalStatus === "missing") {
    missing.push(
      "PROJECT_MANIFEST.json.statistical_evidence.status must not be missing when opportunity_scorecard.verdict = worth_top_tier_bet"
    );
  }
  if (!claimStrengthStatus) {
    missing.push(
      "PROJECT_MANIFEST.json.statistical_evidence.claim_strength_status must be set before top-tier ANALYZE handoff"
    );
  }
  if (ablationStatus === "missing") {
    missing.push(
      "PROJECT_MANIFEST.json.ablation_evidence.status must not be missing when opportunity_scorecard.verdict = worth_top_tier_bet"
    );
  }
  if (!sufficiencyStatus) {
    missing.push(
      "PROJECT_MANIFEST.json.ablation_evidence.sufficiency_status must be set before top-tier ANALYZE handoff"
    );
  }
  return missing;
}

function topTierAnalyzeMissingSignals(manifest: Record<string, unknown>): string[] {
  if (!topTierOpportunityEnabled(manifest)) {
    return [];
  }
  const mechanism = asRecord(manifest.mechanism_evidence ?? manifest.mechanismEvidence) ?? {};
  const venue = asRecord(manifest.venue_competition ?? manifest.venueCompetition) ?? {};
  const missing: string[] = [];
  if ((normalizeStage(mechanism.status) ?? "missing") === "missing") {
    missing.push(
      "PROJECT_MANIFEST.json.mechanism_evidence.status must not be missing when opportunity_scorecard.verdict = worth_top_tier_bet"
    );
  }
  if (graphContextNotGrounded(mechanism.graph_context_status ?? mechanism.graphContextStatus)) {
    missing.push(
      `PROJECT_MANIFEST.json.mechanism_evidence.graph_context_status must be graph-grounded before top-tier REVIEW handoff (current: ${normalizeStage(mechanism.graph_context_status ?? mechanism.graphContextStatus) ?? "unset"})`
    );
  }
  if ((normalizeStage(venue.status) ?? "missing") === "missing") {
    missing.push(
      "PROJECT_MANIFEST.json.venue_competition.status must not be missing when opportunity_scorecard.verdict = worth_top_tier_bet"
    );
  }
  if (graphContextNotGrounded(venue.graph_context_status ?? venue.graphContextStatus)) {
    missing.push(
      `PROJECT_MANIFEST.json.venue_competition.graph_context_status must be graph-grounded before top-tier REVIEW handoff (current: ${normalizeStage(venue.graph_context_status ?? venue.graphContextStatus) ?? "unset"})`
    );
  }
  return missing;
}

function topTierWriteMissingSignals(manifest: Record<string, unknown>): string[] {
  if (!topTierOpportunityEnabled(manifest)) {
    return [];
  }
  const opportunity = asRecord(
    manifest.opportunity_scorecard ?? manifest.opportunityScorecard
  ) ?? {};
  const venue = asRecord(manifest.venue_competition ?? manifest.venueCompetition) ?? {};
  const reproducibility = asRecord(
    manifest.reproducibility_pack ?? manifest.reproducibilityPack
  ) ?? {};
  const missing: string[] = [];
  if ((normalizeStage(venue.status) ?? "missing") === "missing") {
    missing.push(
      "PROJECT_MANIFEST.json.venue_competition.status must not be missing when opportunity_scorecard.verdict = worth_top_tier_bet"
    );
  }
  if (graphContextNotGrounded(venue.graph_context_status ?? venue.graphContextStatus)) {
    missing.push(
      `PROJECT_MANIFEST.json.venue_competition.graph_context_status must be graph-grounded before top-tier WRITE/SUBMIT handoff (current: ${normalizeStage(venue.graph_context_status ?? venue.graphContextStatus) ?? "unset"})`
    );
  }
  if (graphContextNotGrounded(opportunity.graph_context_status ?? opportunity.graphContextStatus)) {
    missing.push(
      `PROJECT_MANIFEST.json.opportunity_scorecard.graph_context_status must be graph-grounded before top-tier WRITE/SUBMIT handoff (current: ${normalizeStage(opportunity.graph_context_status ?? opportunity.graphContextStatus) ?? "unset"})`
    );
  }
  if ((normalizeStage(reproducibility.status) ?? "missing") === "missing") {
    missing.push(
      "PROJECT_MANIFEST.json.reproducibility_pack.status must not be missing when opportunity_scorecard.verdict = worth_top_tier_bet"
    );
  }
  if (!normalizeStage(
    reproducibility.environment_capture_status ??
      reproducibility.environmentCaptureStatus
  )) {
    missing.push(
      "PROJECT_MANIFEST.json.reproducibility_pack.environment_capture_status must be set before top-tier WRITE handoff"
    );
  }
  return missing;
}

function topTierSubmitMissingSignals(manifest: Record<string, unknown>): string[] {
  if (!topTierOpportunityEnabled(manifest)) {
    return [];
  }
  const camera = asRecord(
    manifest.camera_ready_evidence ?? manifest.cameraReadyEvidence
  ) ?? {};
  const missing: string[] = [];
  if ((normalizeStage(camera.status) ?? "missing") === "missing") {
    missing.push(
      "PROJECT_MANIFEST.json.camera_ready_evidence.status must not be missing when opportunity_scorecard.verdict = worth_top_tier_bet"
    );
  }
  for (const [label, value] of [
    ["figures_status", camera.figures_status ?? camera.figuresStatus],
    ["tables_status", camera.tables_status ?? camera.tablesStatus],
    ["captions_status", camera.captions_status ?? camera.captionsStatus],
  ] as const) {
    if (!readyLike(value)) {
      missing.push(
        `PROJECT_MANIFEST.json.camera_ready_evidence.${label} must be ready before top-tier SUBMIT handoff (current: ${normalizeStage(value) ?? "unset"})`
      );
    }
  }
  return missing;
}

function resolveProjectArtifactPath(
  projectRoot: string,
  artifactPath: string | null | undefined
): string | null {
  if (!artifactPath) {
    return null;
  }
  return path.isAbsolute(artifactPath)
    ? artifactPath
    : path.join(projectRoot, artifactPath);
}

async function artifactExists(
  projectRoot: string,
  artifactPath: string | null | undefined
): Promise<boolean> {
  const resolved = resolveProjectArtifactPath(projectRoot, artifactPath);
  return Boolean(resolved && (await pathExists(resolved)));
}

async function reentryStageForRequest(
  projectRoot: string,
  request: Record<string, unknown>
): Promise<string | null> {
  return reentryStageForRequestWithStrategy(projectRoot, request, "latest");
}

async function reentryStageForRequestWithStrategy(
  projectRoot: string,
  request: Record<string, unknown>,
  strategy: "latest" | "earliest_after_graph"
): Promise<string | null> {
  const manifestPath = pickString(request, ["manifest_path", "manifestPath"]);
  const resolvedRequisitionPath = resolveProjectArtifactPath(projectRoot, manifestPath);
  const requisition = resolvedRequisitionPath
    ? await readJsonIfExists<Record<string, unknown>>(resolvedRequisitionPath)
    : null;
  const literatureDiscovery = asRecord(requisition?.literature_discovery);
  const catalystRequisition = asRecord(requisition?.catalyst_requisition);
  const stages = [
    ...normalizeStagePath(
      literatureDiscovery?.required_stage_reentry ??
        literatureDiscovery?.requiredStageReentry ??
        catalystRequisition?.required_stage_reentry ??
        catalystRequisition?.requiredStageReentry ??
        requisition?.required_stage_reentry ??
        requisition?.requiredStageReentry
    ),
    normalizeStage(
      literatureDiscovery?.origin_stage ??
        literatureDiscovery?.originStage ??
        catalystRequisition?.origin_stage ??
        catalystRequisition?.originStage ??
        requisition?.origin_stage ??
        requisition?.originStage
    ),
    stageFromTrigger(requestTrigger(request)),
  ];
  return strategy === "earliest_after_graph"
    ? chooseEarliestReentryStageAfterGraph(stages)
    : chooseLatestReentryStage(stages);
}

async function completedGraphReentryStage(
  projectRoot: string,
  manifest: Record<string, unknown>
): Promise<string | null> {
  const candidates: string[] = [];
  for (const request of paperIngestionRequests(manifest)) {
    if (
      !isGraphReentryTrigger(requestTrigger(request)) ||
      requestStatus(request) !== "completed"
    ) {
      continue;
    }
    const stage = await reentryStageForRequestWithStrategy(
      projectRoot,
      request,
      "earliest_after_graph"
    );
    if (stage) {
      candidates.push(stage);
    }
  }
  return chooseLatestReentryStage(candidates);
}

function hasDurableCompletedImportEvidenceForGraphReentry(
  manifest: Record<string, unknown>
): boolean {
  const paperIngestion = asRecord(manifest.paper_ingestion) ?? {};
  return (
    recordList(paperIngestion.completed_papers).length > 0 ||
    recordList(paperIngestion.completedPapers).length > 0 ||
    recordList(paperIngestion.batch_items).some(
      (entry) => normalizeStage(entry.status) === "completed"
    ) ||
    recordList(paperIngestion.batchItems).some(
      (entry) => normalizeStage(entry.status) === "completed"
    ) ||
    recordList(paperIngestion.paper_operations).some(
      (entry) => normalizeStage(entry.status) === "completed"
    ) ||
    recordList(paperIngestion.paperOperations).some(
      (entry) => normalizeStage(entry.status) === "completed"
    )
  );
}

function reportNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function isCurrentGraphSatisfactionStatus(value: unknown): boolean {
  const status = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  return (
    status === "degraded_satisfied_current_graph" ||
    status === "satisfied_bounded_with_import_blocker" ||
    status === "workflow_state_satisfied" ||
    status === "satisfied_by_verified_graph_import"
  );
}

function hasExplicitCurrentGraphSatisfactionEvidence(
  report: Record<string, unknown>
): boolean {
  const selectedPaperCount =
    reportNumber(report, ["selected_paper_count", "selectedPaperCount"]) ?? 0;
  const candidatePaperCount =
    reportNumber(report, ["candidate_paper_count", "candidatePaperCount"]) ?? 0;
  const remediation = asRecord(report.remediation_pass ?? report.remediationPass);
  return (
    report.evidence_gap_closed === true ||
    report.evidenceGapClosed === true ||
    selectedPaperCount > 0 ||
    candidatePaperCount > 0 ||
    (remediation?.graph_ready === true &&
      remediation?.can_proceed_with_existing_graph === true)
  );
}

function reportRequiresCurrentGraphEvidence(report: Record<string, unknown> | null): boolean {
  if (!report) {
    return false;
  }
  return (
    isCurrentGraphSatisfactionStatus(report.status) ||
    isCurrentGraphSatisfactionStatus(
      report.decision ?? report.satisfaction_decision ?? report.satisfactionDecision
    )
  );
}

async function hasRequisitionSatisfactionEvidence(params: {
  projectRoot: string;
  request: Record<string, unknown>;
}): Promise<boolean> {
  const request = params.request;
  const validationStatus = normalizeStage(
    request.validation_status ?? request.validationStatus
  );
  const validationReportPath = pickString(request, [
    "validation_report_path",
    "validationReportPath",
  ]);
  if (!validationReportPath) {
    return false;
  }
  const resolvedReportPath = path.isAbsolute(validationReportPath)
    ? validationReportPath
    : path.join(params.projectRoot, validationReportPath);
  const report =
    (await readJsonIfExists<Record<string, unknown>>(resolvedReportPath)) ?? null;
  if (
    reportRequiresCurrentGraphEvidence(report) &&
    (!report || !hasExplicitCurrentGraphSatisfactionEvidence(report))
  ) {
    return false;
  }
  if (validationStatus === "warning" && !report) {
    return false;
  }
  return validationStatus === "valid" || validationStatus === "warning";
}

async function completedGraphReentryRequestMissingTerminalEvidence(params: {
  projectRoot: string;
  manifest: Record<string, unknown>;
  request: Record<string, unknown>;
}): Promise<boolean> {
  return (
    isGraphReentryTrigger(requestTrigger(params.request)) &&
    requestStatus(params.request) === "completed" &&
    !hasDurableCompletedImportEvidenceForGraphReentry(params.manifest) &&
    !(await hasRequisitionSatisfactionEvidence({
      projectRoot: params.projectRoot,
      request: params.request,
    }))
  );
}

async function graphReentryCompletionForStage(params: {
  projectRoot: string;
  stage: string;
  manifest: Record<string, unknown>;
}): Promise<StageCompletion | null> {
  if (!DOWNSTREAM_GRAPH_SENSITIVE_STAGES.has(params.stage)) {
    return null;
  }
  if (paperIngestionRequests(params.manifest).some(isActiveGraphReentryRequest)) {
    return completion({
      stage: "graph_build",
      completionStatus: "incomplete",
      owner: "researcher",
      nextAction: "/graph-build",
      blockingReason: "graph_reentry_request_active",
      missingSignals: [
        "workflow-owned graph enrichment requisition is still active",
      ],
      contractSource: `${params.stage}_completion`,
    });
  }
  const failedGraphReentryRequest =
    paperIngestionRequests(params.manifest).find(isFailedGraphReentryRequest) ?? null;
  if (failedGraphReentryRequest) {
    return completion({
      stage: "graph_build",
      completionStatus: "blocked",
      owner: "researcher",
      nextAction: "/graph-build",
      blockingReason: "literature_requisition_failed",
      missingSignals: [
        graphReentryRequestFailureSignal(failedGraphReentryRequest),
      ],
      contractSource: `${params.stage}_completion`,
    });
  }

  const graphPresence =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(params.projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json")
    )) ?? {};
  const paperIngestion = asRecord(params.manifest.paper_ingestion) ?? {};
  const projectedGraphStatus = normalizeStage(paperIngestion.graph_presence_status);
  const checkedGraphStatus = normalizeStage(graphPresence.status);
  const graphStatus =
    projectedGraphStatus && projectedGraphStatus !== "ready"
      ? projectedGraphStatus
      : checkedGraphStatus ?? projectedGraphStatus;
  const graphBuildBlocked = graphStatus != null && graphStatus !== "ready";
  if (!graphBuildBlocked) {
    return null;
  }
  return completion({
    stage: "graph_build",
    completionStatus: "incomplete",
    owner: "researcher",
    nextAction: "/graph-build",
    blockingReason: `graph_presence_${graphStatus}`,
    missingSignals: [
      `PROJECT_MANIFEST.json.paper_ingestion.graph_presence_status = ready (current: ${graphStatus})`,
    ],
    contractSource: `${params.stage}_completion`,
  });
}

type HookGateCompletion = {
  completionStatus: StageCompletionStatus | null;
  blockingReason: string | null;
};

async function resolveHookAggregateGate(
  projectRoot: string,
  stage: string
): Promise<HookGateCompletion> {
  const store = await readWorkflowHooksStateStore(projectRoot);
  const aggregates = [
    "before_prepare_handoff",
    "before_stage_handoff",
    "before_handoff_delivery",
    "before_task_complete",
    "before_stage_complete",
    "before_handoff_activation",
  ].flatMap((hookPoint) => {
    const byStage = asRecord(store.hookPoints[hookPoint]) ?? {};
    return [asRecord(byStage[stage]), asRecord(byStage[normalizeStage(stage) ?? stage])]
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  });

  if (
    aggregates.some((entry) => {
      const verdict = normalizeStage(entry.aggregateVerdict ?? entry.aggregate_verdict);
      const status = normalizeStage(entry.aggregateStatus ?? entry.aggregate_status);
      return verdict === "block" || status === "failed" || status === "escalated";
    })
  ) {
    return {
      completionStatus: "blocked",
      blockingReason: "workflow_hooks_blocked",
    };
  }

  if (
    aggregates.some((entry) => {
      const verdict = normalizeStage(entry.aggregateVerdict ?? entry.aggregate_verdict);
      const status = normalizeStage(entry.aggregateStatus ?? entry.aggregate_status);
      return verdict === "revise" || status === "revise_requested";
    })
  ) {
    return {
      completionStatus: "incomplete",
      blockingReason: "workflow_hooks_revision_requested",
    };
  }

  if (
    aggregates.some((entry) => {
      const status = normalizeStage(entry.aggregateStatus ?? entry.aggregate_status);
      return status === "auditing";
    })
  ) {
    return {
      completionStatus: "incomplete",
      blockingReason: "workflow_hooks_auditing",
    };
  }

  return {
    completionStatus: null,
    blockingReason: null,
  };
}

function writePackageConfigured(state: ReturnType<typeof normalizeWritePackageState>): boolean {
  return Boolean(
    state.status !== "missing" ||
      state.winningTrackIds.length > 0 ||
      state.claimEvidenceMatrixPath ||
      state.narrativeReportPath ||
      state.trackVerdictsPath ||
      state.unsupportedClaimsPath ||
      state.packageManifestPath ||
      state.assemblyReportPath
  );
}

async function resolveWritePackageBlocker(
  projectRoot: string,
  manifest: Record<string, unknown>
): Promise<string | null> {
  const state = normalizeWritePackageState(manifest.write_package);
  if (!writePackageConfigured(state)) {
    return null;
  }
  if (getWritePackageValidationErrors(state).length > 0) {
    return state.pendingReason ? "write_package_pending" : "write_package_not_ready";
  }
  const requiredArtifacts = [
    state.claimEvidenceMatrixPath,
    state.narrativeReportPath,
    state.trackVerdictsPath,
    state.unsupportedClaimsPath,
    state.baselineSummaryPath,
    state.researchSummaryPath,
    state.ablationSummaryPath,
    state.evaluationSummaryPath,
    state.figurePackPath,
    state.tablePackPath,
    state.proofPacketDir,
    state.citationCandidatesPath,
  ];
  const artifactChecks = await Promise.all(
    requiredArtifacts.map((artifactPath) => artifactExists(projectRoot, artifactPath))
  );
  if (artifactChecks.some((exists) => !exists)) {
    return "write_package_artifacts_missing";
  }
  if (state.sourceArtifactCount === 0 && state.derivedArtifactCount === 0) {
    return "write_package_artifact_count_missing";
  }
  return null;
}

function resolveTitleAbstractIntroBlocker(
  manifest: Record<string, unknown>,
  params: { requireReady: boolean }
): string | null {
  const record = asRecord(manifest.title_abstract_intro_workbench);
  if (!record) {
    return null;
  }
  const state = normalizeTitleAbstractIntroWorkbenchState(record);
  if (failureLike(state.status) || failureLike(state.alignmentStatus)) {
    return "title_abstract_intro_workbench_failed";
  }
  if (params.requireReady && !readyLike(state.status)) {
    return "title_abstract_intro_workbench_not_ready";
  }
  return null;
}

function completion(params: {
  stage: string;
  completionStatus: StageCompletionStatus;
  owner?: string | null;
  nextAction?: string | null;
  blockingReason?: string | null;
  contractSource: string;
  missingSignals?: string[];
  repairProjection?: boolean;
  runtimeState?: StageRuntimeState;
  queueKey?: string | null;
  sessionKey?: string | null;
}): StageCompletion {
  return {
    stage: params.stage,
    completionStatus: params.completionStatus,
    owner: params.owner ?? stageOwner(params.stage),
    nextAction:
      "nextAction" in params ? params.nextAction ?? null : stageAction(params.stage),
    blockingReason: params.blockingReason ?? null,
    contractSource: params.contractSource,
    missingSignals: params.missingSignals,
    repairProjection: params.repairProjection,
    runtimeState: params.runtimeState,
    queueKey: params.queueKey ?? null,
    sessionKey: params.sessionKey ?? null,
  };
}

export async function resolveGraphCompletion(projectRoot: string): Promise<StageCompletion> {
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const graphPresence =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json")
    )) ?? {};
  const syncState =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "graph", "PAPERNEXUS_SYNC_STATE.json")
    )) ?? {};
  const paperIngestion = asRecord(manifest.paper_ingestion) ?? {};
  const workflowProjection = asRecord(syncState.workflow_projection) ?? {};
  const projectionGraphStatus = normalizeStage(paperIngestion.graph_presence_status);
  const graphPresenceCanContinue =
    graphPresence.graph_build_can_continue === true ||
    graphPresence.graphBuildCanContinue === true ||
    paperIngestion.graph_build_can_continue === true ||
    paperIngestion.graphBuildCanContinue === true;
  const graphStatus =
    projectionGraphStatus && projectionGraphStatus !== "ready" && !graphPresenceCanContinue
      ? projectionGraphStatus
      : normalizeStage(graphPresence.status) ?? projectionGraphStatus;
  let invalidCompletedReentryRequest: Record<string, unknown> | null = null;
  for (const request of paperIngestionRequests(manifest)) {
    if (
      await completedGraphReentryRequestMissingTerminalEvidence({
        projectRoot,
        manifest,
        request,
      })
    ) {
      invalidCompletedReentryRequest = request;
      break;
    }
  }
  if (invalidCompletedReentryRequest) {
    return completion({
      stage: "graph_build",
      completionStatus: "blocked",
      owner: "researcher",
      nextAction: "/graph-build",
      blockingReason: "literature_requisition_completed_without_evidence",
      missingSignals: [INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON],
      contractSource: "graph_completion",
    });
  }
  if (paperIngestionRequests(manifest).some(isActiveGraphReentryRequest)) {
    return completion({
      stage: "graph_build",
      completionStatus: "incomplete",
      owner: "researcher",
      nextAction: "/graph-build",
      blockingReason: "graph_reentry_request_active",
      missingSignals: [
        "workflow-owned graph enrichment requisition is still active",
      ],
      contractSource: "graph_completion",
    });
  }
  const failedGraphReentryRequest =
    paperIngestionRequests(manifest).find(isFailedGraphReentryRequest) ?? null;
  if (failedGraphReentryRequest) {
    return completion({
      stage: "graph_build",
      completionStatus: "blocked",
      owner: "researcher",
      nextAction: "/graph-build",
      blockingReason: "literature_requisition_failed",
      missingSignals: [
        graphReentryRequestFailureSignal(failedGraphReentryRequest),
      ],
      contractSource: "graph_completion",
    });
  }
  const explicitZeroPaperReadyReport =
    graphStatus === "ready" &&
    graphPresence.expected_paper_count === 0 &&
    graphPresence.present_paper_count === 0;
  const graphPresenceRepairRequired =
    graphPresence.repair_required === true ||
    graphPresence.repairRequired === true ||
    graphPresence.graph_build_requires_source_repair === true ||
    graphPresence.graphBuildRequiresSourceRepair === true ||
    paperIngestion.repair_required === true ||
    paperIngestion.repairRequired === true ||
    paperIngestion.graph_build_requires_source_repair === true ||
    paperIngestion.graphBuildRequiresSourceRepair === true;
  const syncCanContinue =
    (graphPresenceCanContinue && !graphPresenceRepairRequired) ||
    workflowProjection.can_continue === true ||
    readyLike(workflowProjection.runtime_status) ||
    readyLike(syncState.status) ||
    (Object.keys(syncState).length === 0 && !graphPresenceRepairRequired);

  if (graphStatus === "ready" && syncCanContinue && !explicitZeroPaperReadyReport) {
    const reentryStage = await completedGraphReentryStage(projectRoot, manifest);
    if (reentryStage) {
      return completion({
        stage: "graph_build",
        completionStatus: "complete",
        owner: "researcher",
        nextAction: stageAction(reentryStage),
        contractSource: "graph_completion",
        repairProjection: normalizeStage(paperIngestion.graph_presence_status) !== "ready",
      });
    }
    return completion({
      stage: "graph_build",
      completionStatus: "complete",
      owner: "researcher",
      nextAction: "/frontier-map",
      contractSource: "graph_completion",
      repairProjection: normalizeStage(paperIngestion.graph_presence_status) !== "ready",
    });
  }

  return completion({
    stage: "graph_build",
    completionStatus: failureLike(graphPresence.status) ? "failed" : "incomplete",
    owner: "researcher",
    nextAction: "/graph-build",
    blockingReason:
      explicitZeroPaperReadyReport
        ? `graph_presence_${projectionGraphStatus ?? "missing_sources"}`
        : graphStatus && graphStatus !== "ready"
        ? `graph_presence_${graphStatus}`
        : "graph_presence_not_ready",
    contractSource: "graph_completion",
  });
}

export async function resolvePlanCompletion(projectRoot: string): Promise<StageCompletion> {
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const researchProgram = asRecord(manifest.research_program) ?? {};
  const planReady =
    (await nonEmptyText("orchestrator/PLAN.md", projectRoot)) &&
    (await nonEmptyText("orchestrator/PLAN_AUDIT.md", projectRoot));

  if (planReady) {
    return completion({
      stage: "plan",
      completionStatus: "complete",
      owner: "orchestrator",
      nextAction: "/experiment-phase",
      contractSource: "plan_completion",
      repairProjection: !readyLike(researchProgram.status),
    });
  }

  return completion({
    stage: "plan",
    completionStatus: "incomplete",
    owner: "orchestrator",
    nextAction: "/plan-phase",
    blockingReason: "plan_artifacts_missing",
    contractSource: "plan_completion",
  });
}

export async function resolveFrontierMappingCompletion(
  projectRoot: string
): Promise<StageCompletion> {
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const brainstormCycle = normalizeBrainstormCycleState(manifest.brainstorm_cycle);
  const ready = isBrainstormCycleReady(brainstormCycle);
  return completion({
    stage: "frontier_mapping",
    completionStatus: ready ? "complete" : "incomplete",
    owner: "researcher",
    nextAction: ready ? "/idea-catalyst" : "/frontier-map",
    blockingReason: ready ? null : "brainstorm_cycle_not_ready",
    contractSource: "frontier_mapping_completion",
  });
}

function codeReviewActiveTracks(manifest: Record<string, unknown>): CodeReviewPacket["activeTracks"] {
  const researchProgram = asRecord(manifest.research_program) ?? {};
  const tracks = Array.isArray(researchProgram.tracks) ? researchProgram.tracks : [];
  return tracks
    .map((track) => asRecord(track))
    .filter((track): track is Record<string, unknown> => Boolean(track))
    .filter((track) => normalizeStage(track.status) === "active")
    .map((track) => ({
      trackId: asString(track.track_id ?? track.trackId) ?? "unknown-track",
      hypothesis: asString(track.hypothesis),
      noveltyBasis: asString(track.novelty_basis ?? track.noveltyBasis),
      mainMetric: asString(track.main_metric ?? track.mainMetric),
      requiredBaselines: asStringArray(
        track.required_baselines ?? track.requiredBaselines
      ),
      requiredAblations: asStringArray(
        track.required_ablations ?? track.requiredAblations
      ),
      requiredControls: asStringArray(
        track.required_controls ?? track.requiredControls
      ),
    }));
}

export async function resolveCodeCompletion(projectRoot: string): Promise<StageCompletion> {
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const artifactChecks = await Promise.all(
    DEFAULT_PACKET_ARTIFACTS.map(async (relativePath) => ({
      path: relativePath,
      exists: await pathExists(path.join(projectRoot, relativePath)),
    }))
  );
  const packet: CodeReviewPacket = {
    gateId: "CODE-REVIEW",
    projectId: asString(manifest.project_id ?? manifest.projectId),
    projectRoot,
    stage: "code",
    manifestUpdatedAt: asString(
      manifest.updated_at ?? manifest.updatedAt ?? manifest.last_heartbeat_at
    ),
    activeTracks: codeReviewActiveTracks(manifest),
    bundleChecks: await collectBundleChecks(projectRoot),
    artifactChecks,
    executionProof: null,
    summary: [],
  };
  const blockers = collectLocalCodeReviewBlockers(packet);
  return completion({
    stage: "code",
    completionStatus: blockers.length === 0 ? "complete" : "incomplete",
    owner: "coder",
    nextAction: blockers.length === 0 ? "/monitor-experiment" : "/run-experiment",
    blockingReason: blockers[0] ?? null,
    missingSignals: blockers,
    contractSource: "code_completion",
  });
}

export async function resolveExperimentCompletion(
  projectRoot: string
): Promise<StageCompletion> {
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const fileState =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "researcher", "EXPERIMENT_SEARCH.json")
    )) ?? {};
  const experimentSearch = {
    ...(asRecord(manifest.experiment_search) ?? {}),
    ...fileState,
  };
  const searchSpecPath =
    pickString(experimentSearch, ["search_spec_path", "searchSpecPath"]) ??
    "planner/EXPERIMENT_SEARCH_SPEC.json";
  const experimentSearchSpec =
    (await readJsonIfExists<Record<string, unknown>>(
      path.isAbsolute(searchSpecPath)
        ? searchSpecPath
        : path.join(projectRoot, searchSpecPath)
    )) ?? {};
  const experimentLedger =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json")
    )) ?? {};
  const gpuMonitor =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "researcher", "EXPERIMENT_GPU_MONITOR.json")
    )) ?? null;
  const decisionSummary = evaluateExperimentSearchDecision({
    experimentSearch,
    experimentSearchSpec,
    experimentLedger,
    gpuMonitor,
    experimentReviewState: manifest.experiment_review_state,
    experimentMemory: manifest.experiment_memory,
    manifest,
  });
  const status = normalizeStage(experimentSearch.status) ?? "not_started";
  const experimentSearchStarted = !["missing", "not_started", "pending"].includes(status);
  if (
    decisionSummary.decision === "repair_implementation" &&
    experimentSearchStarted &&
    status !== "ready_for_analysis"
  ) {
    return completion({
      stage: "experiment",
      completionStatus: "incomplete",
      owner: "coder",
      nextAction:
        "Wake Coder to repair the bounded runtime / implementation issue, refresh the experiment bundle proof, and rerun the comparable candidate before analysis.",
      blockingReason: "experiment_repair_implementation",
      contractSource: "experiment_completion",
    });
  }
  if (
    decisionSummary.decision === "rollback_to_plan" ||
    decisionSummary.decision === "rollback_to_idea"
  ) {
    const rollbackStage =
      decisionSummary.decision === "rollback_to_idea" ? "idea" : "plan";
    return completion({
      stage: rollbackStage,
      completionStatus: "blocked",
      owner: stageOwner(rollbackStage),
      nextAction: stageAction(rollbackStage),
      blockingReason: decisionSummary.decision,
      contractSource: "experiment_completion",
    });
  }
  const lastDecision = normalizeStage(
    experimentSearch.last_decision ?? experimentSearch.lastDecision
  );
  const multiSeedStatus =
    normalizeStage(
      experimentSearch.multi_seed_status ?? experimentSearch.multiSeedStatus
    ) ?? "pending";
  const plotPackStatus = normalizeStage(
    experimentSearch.plot_pack_status ?? experimentSearch.plotPackStatus
  );
  const plotPackPath = pickString(experimentSearch, [
    "plot_pack_path",
    "plotPackPath",
  ]);
  const plotPackReady =
    readyLike(plotPackStatus) ||
    Boolean(plotPackPath && (await artifactExists(projectRoot, plotPackPath)));
  const executionProof = await collectExecutionProofReceipts({
    projectRoot,
    experimentLedger,
    manifest,
  });

  if (failureLike(status)) {
    return completion({
      stage: "experiment",
      completionStatus: "failed",
      owner: "researcher",
      nextAction: "/monitor-experiment",
      blockingReason: "experiment_failed_terminal",
      contractSource: "experiment_completion",
    });
  }

  if (status === "ready_for_analysis" && readyLike(multiSeedStatus) && plotPackReady) {
    if (!executionProof.ready) {
      return completion({
        stage: "experiment",
        completionStatus: "incomplete",
        owner: "researcher",
        nextAction: "/monitor-experiment",
        blockingReason: "execution_proof_missing",
        missingSignals: [
          `Execution proof is missing before ANALYZE: ${executionProof.missingReasons.join(" ")}`,
        ],
        contractSource: "experiment_completion",
      });
    }
    const topTierMissingSignals = topTierExperimentMissingSignals(manifest);
    if (topTierMissingSignals.length > 0) {
      return completion({
        stage: "experiment",
        completionStatus: "incomplete",
        owner: "researcher",
        nextAction: "/monitor-experiment",
        blockingReason: "top_tier_experiment_evidence_missing",
        missingSignals: topTierMissingSignals,
        contractSource: "experiment_completion",
      });
    }
    return completion({
      stage: "experiment",
      completionStatus: "complete",
      owner: "analyzer",
      nextAction: "/analyze-results",
      contractSource: "experiment_completion",
    });
  }

  const needsMultiSeed =
    multiSeedStatus === "pending" ||
    multiSeedStatus === "running" ||
    lastDecision === "require_multi_seed" ||
    lastDecision === "continue_tuning";
  const needsPlotPack =
    status === "ready_for_analysis" && readyLike(multiSeedStatus) && !plotPackReady;

  return completion({
    stage: "experiment",
    completionStatus: "incomplete",
    owner: "researcher",
    nextAction: "/monitor-experiment",
    blockingReason: needsMultiSeed
      ? "multi_seed_validation_pending"
      : needsPlotPack
        ? "plot_pack_aggregation_pending"
      : "experiment_reconciliation_pending",
    contractSource: "experiment_completion",
  });
}

function queueEntryStage(entry: WorkflowRuntimeQueueEntry): string | null {
  return normalizeStage(entry.dispatchPayload?.stage ?? null);
}

function queueEntryOwner(entry: WorkflowRuntimeQueueEntry): string | null {
  return (
    normalizeStage(entry.ownerAgent) ??
    normalizeStage(entry.dispatchPayload?.toRole ?? null)
  );
}

function sessionEntryOwner(entry: WorkflowRuntimeSessionEntry): string | null {
  return (
    normalizeStage(entry.ownerAgent) ??
    normalizeStage(entry.role) ??
    normalizeStage(entry.agentId)
  );
}

function matchesProjectRoot(
  entryRoot: string | null | undefined,
  projectRoot: string
): boolean {
  if (!entryRoot) {
    return true;
  }
  return path.resolve(entryRoot) === path.resolve(projectRoot);
}

function matchesStageOwner(params: {
  candidateStage: string | null;
  candidateOwner: string | null;
  stage: string | null;
  owner: string | null;
}): boolean {
  const stageMatches = !params.stage || !params.candidateStage || params.candidateStage === params.stage;
  const ownerMatches = !params.owner || !params.candidateOwner || params.candidateOwner === params.owner;
  return stageMatches && ownerMatches;
}

export async function resolveRuntimeOwnership(
  projectRoot: string,
  params: {
    stage: string | null;
    owner: string | null;
    nextAction: string | null;
    staleRuntimeAgeMs?: number;
    now?: string;
  }
): Promise<Pick<
  StageCompletion,
  "runtimeState" | "queueKey" | "sessionKey" | "blockingReason"
>> {
  const stage = normalizeStage(params.stage);
  const owner = normalizeStage(params.owner);
  const [queueStore, sessionsStore] = await Promise.all([
    readWorkflowRuntimeQueueStore(projectRoot),
    readWorkflowRuntimeSessionsStore(projectRoot),
  ]);
  const activeSessions = sessionsStore.entries.filter((entry) => {
    if (!["active", "idle"].includes(entry.status)) {
      return false;
    }
    if (!matchesProjectRoot(entry.projectRoot, projectRoot)) {
      return false;
    }
    return matchesStageOwner({
      candidateStage: null,
      candidateOwner: sessionEntryOwner(entry),
      stage,
      owner,
    });
  });
  const activeQueueEntries = queueStore.entries.filter((entry) => {
    if (!["queued", "launching", "running"].includes(entry.status)) {
      return false;
    }
    if (!matchesProjectRoot(entry.projectRoot, projectRoot)) {
      return false;
    }
    return matchesStageOwner({
      candidateStage: queueEntryStage(entry),
      candidateOwner: queueEntryOwner(entry),
      stage,
      owner,
    });
  });

  const sessionForActiveQueue = activeQueueEntries
    .map((entry) =>
      activeSessions.find(
        (session) =>
          session.queueKey === entry.queueKey ||
          session.sessionKey === entry.preferredSessionKey
      )
    )
    .find(Boolean);

  const activeSession = sessionForActiveQueue ?? activeSessions[0] ?? null;
  if (activeSession) {
    return {
      runtimeState: "active",
      queueKey: activeSession.queueKey ?? null,
      sessionKey: activeSession.sessionKey,
      blockingReason: null,
    };
  }

  const runningQueue = activeQueueEntries.find((entry) =>
    ["running", "launching"].includes(entry.status)
  );
  if (runningQueue) {
    return {
      runtimeState: "degraded",
      queueKey: runningQueue.queueKey,
      sessionKey: null,
      blockingReason: "stale_runtime_queue_without_active_session",
    };
  }

  const queued = activeQueueEntries[0] ?? null;
  if (queued) {
    return {
      runtimeState: "queued",
      queueKey: queued.queueKey,
      sessionKey: null,
      blockingReason: null,
    };
  }

  return {
    runtimeState: "idle",
    queueKey: null,
    sessionKey: null,
    blockingReason: null,
  };
}

export async function resolveTopicSearchCompletion(
  projectRoot: string
): Promise<StageCompletion> {
  const packet = await readJsonIfExists<Record<string, unknown>>(
    path.join(projectRoot, LITERATURE_DISCOVERY_PACKET_PATH)
  );
  const runState = await readJsonIfExists<Record<string, unknown>>(
    path.join(projectRoot, "researcher", "LITERATURE_DISCOVERY_RUN.json")
  );
  const packetStatus = artifactStatus(packet);
  const runStatus = artifactStatus(runState);
  if (failureLike(packetStatus) || failureLike(runStatus)) {
    return completion({
      stage: "topic_search",
      completionStatus: "failed",
      owner: "researcher",
      nextAction: "/literature-discovery",
      blockingReason: "literature_discovery_failed",
      contractSource: "topic_search_completion",
    });
  }
  if (hasLiteratureDiscoveryEvidence(packet) || hasLiteratureDiscoveryEvidence(runState)) {
    return completion({
      stage: "topic_search",
      completionStatus: "complete",
      owner: "researcher",
      nextAction: "/research-briefing",
      contractSource: "topic_search_completion",
    });
  }
  return completion({
    stage: "topic_search",
    completionStatus: "incomplete",
    owner: "researcher",
    nextAction: "/literature-discovery",
    blockingReason: "literature_discovery_packet_missing_or_empty",
    contractSource: "topic_search_completion",
  });
}

export async function resolveLiteratureReviewCompletion(
  projectRoot: string
): Promise<StageCompletion> {
  const packet = await readJsonIfExists<Record<string, unknown>>(
    path.join(projectRoot, LITERATURE_DISCOVERY_PACKET_PATH)
  );
  const briefReady =
    (await nonEmptyText("researcher/LITERATURE_REVIEW_BRIEF.md", projectRoot)) ||
    (await nonEmptyText("researcher/LITERATURE_REVIEW.md", projectRoot)) ||
    (await nonEmptyText("researcher/brainstorm-cycle/RESEARCH_BRIEF.md", projectRoot)) ||
    Boolean(
      await readJsonIfExists<Record<string, unknown>>(
        path.join(projectRoot, "researcher", "brainstorm-cycle", "RESEARCH_BRIEF.json")
      )
    );
  if (briefReady && hasLiteratureDiscoveryEvidence(packet)) {
    return completion({
      stage: "literature_review",
      completionStatus: "complete",
      owner: "researcher",
      nextAction: "/idea-catalyst",
      contractSource: "literature_review_completion",
    });
  }
  return completion({
    stage: "literature_review",
    completionStatus: "incomplete",
    owner: "researcher",
    nextAction: "/research-briefing",
    blockingReason: briefReady
      ? "literature_discovery_packet_missing_or_empty"
      : "literature_review_brief_missing",
    contractSource: "literature_review_completion",
  });
}

export async function resolveIdeationCompletion(
  projectRoot: string
): Promise<StageCompletion> {
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const directPacket = await readJsonIfExists<Record<string, unknown>>(
    path.join(projectRoot, "researcher", "IDEA_CATALYST_PACKET.json")
  );
  const packetBundle = await readJsonIfExists<Record<string, unknown>>(
    path.join(projectRoot, IDEA_CATALYST_PACKET_BUNDLE_PATH)
  );
  const directStatus = artifactStatus(directPacket);
  const bundleStatus = artifactStatus(unwrapPacketBundle(packetBundle));
  if (failureLike(directStatus) || failureLike(bundleStatus)) {
    return completion({
      stage: "ideation",
      completionStatus: "failed",
      owner: "researcher",
      nextAction: "/idea-catalyst",
      blockingReason: "idea_catalyst_failed",
      contractSource: "ideation_completion",
    });
  }
  const directReady =
    directPacket &&
    readyLike(directStatus) &&
    hasIdeaCatalystEvidence(directPacket);
  const bundleReady = packetBundle && hasIdeaCatalystEvidence(packetBundle);
  const catalystStateReady = isIdeaCatalystReadyForPlan(
    manifest.idea_catalyst,
    manifest
  );
  if (directReady || bundleReady || catalystStateReady) {
    return completion({
      stage: "ideation",
      completionStatus: "complete",
      owner: "researcher",
      nextAction: "/plan-experiment",
      contractSource: "ideation_completion",
    });
  }
  return completion({
    stage: "ideation",
    completionStatus: "incomplete",
    owner: "researcher",
    nextAction: "/idea-catalyst",
    blockingReason:
      directPacket || packetBundle
        ? "idea_catalyst_packet_incomplete"
        : "idea_catalyst_packet_missing",
    contractSource: "ideation_completion",
  });
}

function hasActiveGraphReentryRequest(manifest: Record<string, unknown>): boolean {
  return paperIngestionRequests(manifest).some(isActiveGraphReentryRequest);
}

export async function resolveLegacyIdeaCompletion(
  projectRoot: string
): Promise<StageCompletion> {
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  if (hasActiveGraphReentryRequest(manifest)) {
    return completion({
      stage: "graph_build",
      completionStatus: "blocked",
      owner: "researcher",
      nextAction: "/graph-build",
      blockingReason: "idea_graph_reentry_required",
      contractSource: "idea_completion",
    });
  }
  const ideation = await resolveIdeationCompletion(projectRoot);
  return {
    ...ideation,
    stage: "idea",
    nextAction:
      ideation.completionStatus === "complete" ? "/plan-phase" : "/idea-catalyst",
    contractSource: "idea_completion",
  };
}

export async function resolveExperimentPlanCompletion(
  projectRoot: string
): Promise<StageCompletion> {
  const innovationPacket = await readJsonIfExists<Record<string, unknown>>(
    path.join(projectRoot, "orchestrator", "INNOVATION_PACKET.json")
  );
  const ideaIds = uniqueStrings([
    ...asStringArray(innovationPacket?.supporting_idea_fragment_ids),
    ...asStringArray(innovationPacket?.supportingIdeaFragmentIds),
    ...(asString(innovationPacket?.selected_idea_fragment_id)
      ? [asString(innovationPacket?.selected_idea_fragment_id) as string]
      : []),
  ]);
  const evidencePaths = uniqueStrings([
    ...asStringArray(innovationPacket?.evidence_paths),
    ...asStringArray(innovationPacket?.evidencePaths),
    ...asStringArray(innovationPacket?.supporting_papers),
    ...asStringArray(innovationPacket?.supportingPapers),
  ]);
  const required = [
    "selected_idea_fragment_id",
    "baseline",
    "primary_metric",
    "fixed_budget",
  ];
  if (
    innovationPacket &&
    required.every((key) => asString(innovationPacket[key])) &&
    ideaIds.length > 0 &&
    evidencePaths.length > 0
  ) {
    return completion({
      stage: "experiment_plan",
      completionStatus: "complete",
      owner: "coder",
      nextAction: "/run-experiment",
      contractSource: "experiment_plan_completion",
    });
  }
  return completion({
    stage: "experiment_plan",
    completionStatus: "incomplete",
    owner: "orchestrator",
    nextAction: "/plan-experiment",
    blockingReason: innovationPacket
      ? "innovation_packet_missing_traceable_evidence"
      : "innovation_packet_incomplete",
    contractSource: "experiment_plan_completion",
  });
}

export async function resolveExperimentLoopCompletion(
  projectRoot: string
): Promise<StageCompletion> {
  const experiment = await resolveExperimentCompletion(projectRoot);
  return { ...experiment, stage: "experiment_loop", contractSource: "experiment_loop_completion" };
}

export async function resolveSurveyReviewCompletion(
  projectRoot: string
): Promise<StageCompletion> {
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const state = normalizeSurveyReviewState(manifest.survey_review);
  const hookGate = await resolveHookAggregateGate(projectRoot, "survey_review");
  if (hookGate.completionStatus) {
    return completion({
      stage: "survey_review",
      completionStatus: hookGate.completionStatus,
      owner: "researcher",
      nextAction: "/survey-pipeline",
      blockingReason: hookGate.blockingReason,
      contractSource: "survey_review_completion",
    });
  }
  if (failureLike(state.status)) {
    return completion({
      stage: "survey_review",
      completionStatus: "failed",
      owner: "researcher",
      nextAction: "/survey-pipeline",
      blockingReason: "survey_review_failed",
      contractSource: "survey_review_completion",
    });
  }

  const surveyBriefReady = await artifactExists(projectRoot, state.surveyBriefPath);
  const pendingScreening = state.pendingScreeningCount ?? 0;
  const pendingRounds = state.pendingPlannedRoundCount ?? 0;
  const gateBlocked = state.gateBlockingIssues.length > 0;
  const ready =
    readyLike(state.status) &&
    state.graphGroundedBriefReady &&
    state.gateReady &&
    surveyBriefReady &&
    pendingScreening === 0 &&
    pendingRounds === 0 &&
    !gateBlocked;

  return completion({
    stage: "survey_review",
    completionStatus: ready ? "complete" : "incomplete",
    owner: "researcher",
    nextAction: ready ? "/write-paper" : "/survey-pipeline",
    blockingReason: ready
      ? null
      : gateBlocked
        ? "survey_review_gate_blocked"
        : pendingScreening > 0
          ? "survey_review_screening_pending"
          : pendingRounds > 0
            ? "survey_review_retrieval_pending"
            : !surveyBriefReady
              ? "survey_review_brief_missing"
              : !state.graphGroundedBriefReady
                ? "survey_review_graph_grounded_brief_not_ready"
                : !state.gateReady
                  ? "survey_review_gate_not_ready"
                  : "survey_review_not_ready",
    contractSource: "survey_review_completion",
  });
}

function resolveExperimentPromotionGateBlocker(
  manifest: Record<string, unknown>,
  phase: "analysis" | "writing"
): string | null {
  const experimentSearch = asRecord(
    manifest.experiment_search ?? manifest.experimentSearch
  );
  if (!experimentSearch) {
    return null;
  }
  const researchProgram = asRecord(
    manifest.research_program ?? manifest.researchProgram
  ) ?? {};
  const globalConstraints = asRecord(
    researchProgram.global_constraints ?? researchProgram.globalConstraints
  ) ?? {};
  const mustRunMultiSeed =
    pickBoolean(globalConstraints, [
      "mustRunMultiSeedBeforeAnalysis",
      "must_run_multi_seed_before_analysis",
    ]) ?? true;
  if (!mustRunMultiSeed) {
    return null;
  }
  const searchStatus = normalizeStage(experimentSearch.status);
  const multiSeedStatus = normalizeStage(
    experimentSearch.multi_seed_status ?? experimentSearch.multiSeedStatus
  );
  const multiSeedReady = searchStatus === "ready_for_analysis" && readyLike(multiSeedStatus);
  if (!multiSeedReady) {
    return phase === "writing"
      ? "experiment_multi_seed_validation_pending"
      : "multi_seed_validation_pending";
  }
  if (phase === "analysis") {
    return null;
  }
  const mustRunPlotAggregation =
    pickBoolean(globalConstraints, [
      "mustRunPlotAggregationBeforeWrite",
      "must_run_plot_aggregation_before_write",
    ]) ?? true;
  if (!mustRunPlotAggregation) {
    return null;
  }
  const plotPackStatus = normalizeStage(
    experimentSearch.plot_pack_status ?? experimentSearch.plotPackStatus
  );
  return readyLike(plotPackStatus) ? null : "experiment_plot_pack_pending";
}

export async function resolveAnalysisCompletion(projectRoot: string): Promise<StageCompletion> {
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const reportReady =
    (await nonEmptyText("analyzer/ANALYSIS_REPORT.md", projectRoot)) ||
    (await nonEmptyText("researcher/RESULTS_ANALYSIS.md", projectRoot)) ||
    ((await nonEmptyText("analyzer/CLAIM_EVIDENCE_MATRIX.md", projectRoot)) &&
      (await nonEmptyText("analyzer/TRACK_VERDICTS.md", projectRoot)));
  const ledger = await readJsonIfExists<Record<string, unknown>>(
    path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json")
  );
  const gitManagedLedgerReady = hasExperimentLedgerEvidence(ledger);
  const executionProof = await collectExecutionProofReceipts({
    projectRoot,
    experimentLedger: ledger,
    manifest,
  });
  const resultsFileReady = await pathExists(
    path.join(projectRoot, "researcher", "artifacts", "results", "results.json")
  );
  const resultsReady =
    gitManagedLedgerReady || resultsFileReady || executionProof.ready;
  const promotionGateBlocker = resolveExperimentPromotionGateBlocker(
    manifest,
    "analysis"
  );
  const topTierMissingSignals = topTierAnalyzeMissingSignals(manifest);
  const ready =
    reportReady &&
    resultsReady &&
    !promotionGateBlocker &&
    topTierMissingSignals.length === 0;
  return completion({
    stage: "analysis",
    completionStatus: ready ? "complete" : "incomplete",
    owner: "analyzer",
    nextAction: ready ? "/write-paper" : "/analyze-results",
    blockingReason: !reportReady
      ? "analysis_report_missing"
      : !resultsReady
        ? "experiment_results_missing"
        : promotionGateBlocker ?? (
            topTierMissingSignals.length > 0
              ? "top_tier_analysis_evidence_missing"
              : null
          ),
    missingSignals: topTierMissingSignals,
    contractSource: "analysis_completion",
  });
}

export async function resolveLegacyAnalyzeCompletion(
  projectRoot: string
): Promise<StageCompletion> {
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const ledger = await readJsonIfExists<Record<string, unknown>>(
    path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json")
  );
  const experimentSearch = asRecord(manifest.experiment_search) ?? {};
  const searchStatus = normalizeStage(experimentSearch.status);
  const implementationConfidence = normalizeStage(
    experimentSearch.implementation_confidence ??
      experimentSearch.implementationConfidence
  );
  if (
    searchStatus === "ready_for_analysis" ||
    ["ready", "trusted"].includes(implementationConfidence ?? "")
  ) {
    const executionProof = await collectExecutionProofReceipts({
      projectRoot,
      experimentLedger: ledger,
      manifest,
    });
    if (!executionProof.ready) {
      const reason = `Execution proof is missing before ANALYZE: ${executionProof.missingReasons.join(" ")}`;
      return completion({
        stage: "experiment",
        completionStatus: "incomplete",
        owner: "researcher",
        nextAction: "/monitor-experiment",
        blockingReason: "execution_proof_missing",
        missingSignals: [reason],
        contractSource: "analyze_completion",
      });
    }
  }

  const analysis = await resolveAnalysisCompletion(projectRoot);
  return {
    ...analysis,
    stage: "analyze",
    nextAction:
      analysis.completionStatus === "complete" ? "/review-paper" : "/analyze-results",
    contractSource: "analyze_completion",
  };
}

export async function resolveWritingCompletion(
  projectRoot: string,
  options?: {
    stage?: string;
    contractSource?: string;
  }
): Promise<StageCompletion> {
  const stage = options?.stage ?? "writing";
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const paperReady = await nonEmptyText("academic_writer/paper/main.tex", projectRoot);
  const qualityBlocker = paperQcBlocks(manifest);
  const promotionGateBlocker = resolveExperimentPromotionGateBlocker(
    manifest,
    "writing"
  );
  const writePackageBlocker = await resolveWritePackageBlocker(projectRoot, manifest);
  const frontMatterBlocker = resolveTitleAbstractIntroBlocker(manifest, {
    requireReady: false,
  });
  const citationBlocker = citationIntegrityBlocker(manifest);
  const hookGate = await resolveHookAggregateGate(projectRoot, stage);
  const topTierMissingSignals =
    stage === "write" ? topTierWriteMissingSignals(manifest) : [];
  const writingContract = asRecord(
    manifest.writing_contract ?? manifest.writingContract
  ) ?? {};
  const surveyWorkflow =
    normalizeStage(manifest.workflow_line ?? manifest.workflowLine) === "survey" ||
    normalizeStage(manifest.paper_type ?? manifest.paperType) === "survey" ||
    normalizeStage(writingContract.paper_mode ?? writingContract.paperMode) === "survey" ||
    hasRecordFields(manifest.survey_review ?? manifest.surveyReview);
  const paperStoryBlocker =
    stage === "write" && !surveyWorkflow ? paperStoryBlocksWrite(manifest) : null;
  const proofAppendixBlocker =
    stage === "write" && !surveyWorkflow
      ? await proofAppendixBlocksWrite(projectRoot, manifest)
      : null;
  const figureQcBlocker = stage === "write" ? figureQcBlocks(manifest) : null;
  const writeRepairBlocker =
    hookGate.blockingReason ??
    paperStoryBlocker ??
    writePackageBlocker ??
    citationBlocker ??
    proofAppendixBlocker ??
    figureQcBlocker ??
    topTierMissingSignals[0] ??
    frontMatterBlocker ??
    qualityBlocker;
  const deferExperimentGateForLegacyWriteRepair =
    stage === "write" && Boolean(paperReady) && Boolean(writeRepairBlocker);
  const effectivePromotionGateBlocker = deferExperimentGateForLegacyWriteRepair
    ? null
    : promotionGateBlocker;
  const canonicalBlocker =
    hookGate.blockingReason ??
    effectivePromotionGateBlocker ??
    paperStoryBlocker ??
    writePackageBlocker ??
    citationBlocker ??
    proofAppendixBlocker ??
    figureQcBlocker ??
    topTierMissingSignals[0] ??
    frontMatterBlocker ??
    qualityBlocker;
  const qualityReady =
    paperQcReady(manifest) ||
    (await pathExists(path.join(projectRoot, "academic_writer", "PAPER_QC.md"))) ||
    (await pathExists(path.join(projectRoot, "academic_writer", "paper", "main.pdf")));
  const writerSupportConfigured =
    hasRecordFields(manifest.paper_story_state ?? manifest.paperStoryState) ||
    hasRecordFields(manifest.review_pressure_packet ?? manifest.reviewPressurePacket) ||
    hasRecordFields(manifest.writing_session ?? manifest.writingSession);
  if (
    stage === "write" &&
    !surveyWorkflow &&
    !writerSupportConfigured &&
    normalizeStage(manifest.owner_agent ?? manifest.ownerAgent) !== "academic_writer" &&
    !asRecord(manifest.experiment_search ?? manifest.experimentSearch) &&
    !paperReady &&
    !writePackageConfigured(normalizeWritePackageState(manifest.write_package))
  ) {
    return completion({
      stage: "experiment",
      completionStatus: "incomplete",
      owner: "researcher",
      nextAction: "/monitor-experiment",
      blockingReason: "experiment_multi_seed_validation_pending",
      missingSignals: ["experiment_multi_seed_validation_pending"],
      contractSource: options?.contractSource ?? "writing_completion",
    });
  }
  if (effectivePromotionGateBlocker) {
    return completion({
      stage: "experiment",
      completionStatus: "incomplete",
      owner: "researcher",
      nextAction: "/monitor-experiment",
      blockingReason: effectivePromotionGateBlocker,
      missingSignals: [effectivePromotionGateBlocker],
      contractSource: options?.contractSource ?? "writing_completion",
    });
  }
  const ready = paperReady && !canonicalBlocker && qualityReady;
  return completion({
    stage,
    completionStatus:
      hookGate.completionStatus === "blocked"
        ? "blocked"
        : ready
          ? "complete"
          : "incomplete",
    owner: "academic_writer",
    nextAction: ready ? "/submit-ready" : "/write-paper",
    blockingReason: !paperReady
      ? "paper_draft_missing"
      : canonicalBlocker ?? (qualityReady ? null : "writing_quality_not_ready"),
    missingSignals: topTierMissingSignals,
    contractSource: options?.contractSource ?? "writing_completion",
  });
}

export async function resolvePolishReviewCompletion(
  projectRoot: string,
  options?: {
    stage?: string;
    owner?: string;
    completeNextAction?: string;
    incompleteNextAction?: string;
    contractSource?: string;
  }
): Promise<StageCompletion> {
  const stage = options?.stage ?? "polish_review";
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const reviewFindings = await readJsonIfExists<Record<string, unknown>>(
    path.join(projectRoot, "reviewer", "REVIEW_FINDINGS.json")
  );
  const status = normalizeStage(reviewFindings?.status);
  const legacyReviewReady =
    !reviewFindings &&
    reviewSessionReady(manifest) &&
    reviewIssueTrackerClear(manifest) &&
    (await nonEmptyText("reviewer/REVIEW_REPORT.md", projectRoot));
  const paperGuruGate = await evaluatePaperGuruGate({ projectRoot, manifest });
  const frontMatterBlocker = resolveTitleAbstractIntroBlocker(manifest, {
    requireReady: true,
  });
  const citationBlocker = citationIntegrityBlocker(manifest);
  const hookGate = await resolveHookAggregateGate(projectRoot, stage);
  if (hookGate.completionStatus) {
    return completion({
      stage,
      completionStatus: hookGate.completionStatus,
      owner: options?.owner ?? "reviewer",
      nextAction: options?.incompleteNextAction ?? "/review-paper",
      blockingReason: hookGate.blockingReason,
      contractSource: options?.contractSource ?? "polish_review_completion",
    });
  }
  if (paperGuruGate.status === "blocked") {
    return completion({
      stage,
      completionStatus: "blocked",
      owner: options?.owner ?? "reviewer",
      nextAction: options?.incompleteNextAction ?? "/review-paper",
      blockingReason: "paperguru_gate_blocked",
      contractSource: options?.contractSource ?? "polish_review_completion",
    });
  }
  if (frontMatterBlocker) {
    return completion({
      stage,
      completionStatus: "incomplete",
      owner: options?.owner ?? "reviewer",
      nextAction: options?.incompleteNextAction ?? "/review-paper",
      blockingReason: frontMatterBlocker,
      contractSource: options?.contractSource ?? "polish_review_completion",
    });
  }
  if (citationBlocker) {
    return completion({
      stage,
      completionStatus: "incomplete",
      owner: options?.owner ?? "reviewer",
      nextAction: options?.incompleteNextAction ?? "/review-paper",
      blockingReason: "citation_integrity_not_verified",
      missingSignals: [citationBlocker],
      contractSource: options?.contractSource ?? "polish_review_completion",
    });
  }
  return completion({
    stage,
    completionStatus: readyLike(status) || legacyReviewReady ? "complete" : "incomplete",
    owner: options?.owner ?? "reviewer",
    nextAction: readyLike(status) || legacyReviewReady
      ? options?.completeNextAction ?? "/submit-ready"
      : options?.incompleteNextAction ?? "/review-paper",
    blockingReason: readyLike(status) || legacyReviewReady ? null : "review_findings_not_closed",
    contractSource: options?.contractSource ?? "polish_review_completion",
  });
}

function citationIntegrityBlocker(manifest: Record<string, unknown>): string | null {
  const citationIntegrity = asRecord(
    manifest.citation_integrity ?? manifest.citationIntegrity
  ) ?? {};
  const verificationStatus = normalizeStage(
    citationIntegrity.verification_status ??
      citationIntegrity.verificationStatus
  );
  const hallucinatedCitationCount =
    typeof citationIntegrity.hallucinated_citation_count === "number"
      ? citationIntegrity.hallucinated_citation_count
      : typeof citationIntegrity.hallucinatedCitationCount === "number"
        ? citationIntegrity.hallucinatedCitationCount
        : 0;
  const allCitationsReal =
    citationIntegrity.all_citations_real ??
    citationIntegrity.allCitationsReal;
  if (
    verificationStatus &&
    verificationStatus !== "verified" &&
    verificationStatus !== "ready"
  ) {
    return `PROJECT_MANIFEST.json.citation_integrity.verification_status must be verified before SUBMIT (current: ${verificationStatus})`;
  }
  if (hallucinatedCitationCount > 0 || allCitationsReal === false) {
    return "PROJECT_MANIFEST.json.citation_integrity reports hallucinated or unverified citations before SUBMIT";
  }
  return null;
}

function reviewSessionReady(manifest: Record<string, unknown>): boolean {
  const reviewSession = asRecord(manifest.review_session ?? manifest.reviewSession) ?? {};
  const status = normalizeStage(reviewSession.status);
  const verdict = normalizeStage(reviewSession.verdict);
  return (
    ["ready", "completed", "complete", "pass", "passed"].includes(status ?? "") &&
    ["ready", "accepted", "approved", "pass", "passed"].includes(verdict ?? "")
  );
}

function reviewIssueTrackerClear(manifest: Record<string, unknown>): boolean {
  const tracker = asRecord(
    manifest.review_issue_tracker ?? manifest.reviewIssueTracker
  ) ?? {};
  const openCounts = asRecord(tracker.open_counts ?? tracker.openCounts) ?? {};
  const hasOpenCount = Object.values(openCounts).some(
    (value) => typeof value === "number" && value > 0
  );
  const hasOpenIssue = recordList(tracker.issues).some((issue) => {
    const status = normalizeStage(issue.status) ?? "open";
    return !["closed", "resolved", "done", "complete", "completed"].includes(status);
  });
  return (
    !hasOpenCount &&
    !hasOpenIssue &&
    (readyLike(tracker.status) || Object.keys(tracker).length > 0)
  );
}

export async function resolveSubmissionReadyCompletion(
  projectRoot: string,
  options?: {
    stage?: string;
    owner?: string;
    contractSource?: string;
  }
): Promise<StageCompletion> {
  const stage = options?.stage ?? "submission_ready";
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const submitState = asRecord(manifest.submission_ready) ?? {};
  const paperGuruGate = await evaluatePaperGuruGate({ projectRoot, manifest });
  const qualityBlocker = paperQcBlocks(manifest);
  const citationBlocker =
    (options?.stage ?? "submission_ready") === "submit"
      ? citationIntegrityBlocker(manifest)
      : null;
  if (citationBlocker) {
    return completion({
      stage: "review",
      completionStatus: "incomplete",
      owner: "reviewer",
      nextAction: "/review-paper",
      blockingReason: "citation_integrity_not_verified",
      missingSignals: [citationBlocker],
      contractSource: options?.contractSource ?? "submission_ready_completion",
    });
  }
  const frontMatterBlocker = resolveTitleAbstractIntroBlocker(manifest, {
    requireReady: true,
  });
  const hookGate = await resolveHookAggregateGate(projectRoot, stage);
  const topTierMissingSignals =
    stage === "submit" ? topTierSubmitMissingSignals(manifest) : [];
  const terminalArtifactsReady =
    (await pathExists(path.join(projectRoot, "academic_writer", "paper", "main.tex"))) &&
    (await pathExists(path.join(projectRoot, "academic_writer", "paper", "main.pdf"))) &&
    !qualityBlocker;
  const ready =
    readyLike(submitState.status) &&
    terminalArtifactsReady &&
    paperGuruGate.status !== "blocked" &&
    !frontMatterBlocker &&
    topTierMissingSignals.length === 0 &&
    !hookGate.blockingReason;
  return completion({
    stage,
    completionStatus:
      hookGate.completionStatus === "blocked" || paperGuruGate.status === "blocked"
        ? "blocked"
        : ready
          ? "complete"
          : "incomplete",
    owner: options?.owner ?? "orchestrator",
    nextAction: ready ? "/done" : "/submit-ready",
    blockingReason: ready
      ? null
      : hookGate.blockingReason
        ? hookGate.blockingReason
        : paperGuruGate.status === "blocked"
        ? "paperguru_gate_blocked"
        : frontMatterBlocker
          ? frontMatterBlocker
        : topTierMissingSignals.length > 0
          ? "top_tier_camera_ready_evidence_missing"
        : qualityBlocker
          ? qualityBlocker
        : terminalArtifactsReady
          ? "submission_package_not_ready"
          : "terminal_paper_artifacts_not_ready",
    missingSignals: topTierMissingSignals,
    contractSource: options?.contractSource ?? "submission_ready_completion",
  });
}

async function resolveDoneCompletion(projectRoot: string): Promise<StageCompletion> {
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const promotionGateBlocker = resolveExperimentPromotionGateBlocker(
    manifest,
    "analysis"
  );
  if (promotionGateBlocker) {
    return completion({
      stage: "experiment",
      completionStatus: "incomplete",
      owner: "researcher",
      nextAction: "/monitor-experiment",
      blockingReason: promotionGateBlocker,
      missingSignals: [promotionGateBlocker],
      contractSource: "done_completion",
    });
  }

  const analysis = await resolveAnalysisCompletion(projectRoot);
  if (analysis.completionStatus !== "complete") {
    return {
      ...analysis,
      stage: analysis.stage === "analyze" ? "analyze" : "analysis",
      contractSource: "done_completion",
    };
  }

  const writing = await resolveWritingCompletion(projectRoot);
  if (writing.completionStatus !== "complete") {
    return {
      ...writing,
      stage: writing.stage === "write" ? "write" : "writing",
      contractSource: "done_completion",
    };
  }

  const review = await resolvePolishReviewCompletion(projectRoot, {
    stage: "review",
    completeNextAction: "/submit-ready",
    incompleteNextAction: "/review-paper",
    contractSource: "done_completion",
  });
  if (review.completionStatus !== "complete") {
    return review;
  }

  const submit = await resolveSubmissionReadyCompletion(projectRoot, {
    stage: "submit",
    owner: "reviewer",
    contractSource: "done_completion",
  });
  if (submit.completionStatus !== "complete") {
    return submit;
  }

  return completion({
    stage: "done",
    completionStatus: "complete",
    owner: "orchestrator",
    nextAction: null,
    contractSource: "done_completion",
  });
}

export async function resolveWorkflowStageCompletion(params: {
  projectRoot: string;
  stage: string | null;
}): Promise<StageCompletion> {
  const stage = normalizeStage(params.stage) ?? "setup";
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(params.projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const graphReentry = await graphReentryCompletionForStage({
    projectRoot: params.projectRoot,
    stage,
    manifest,
  });
  if (graphReentry) {
    return graphReentry;
  }
  switch (stage) {
    case "survey_review":
      return resolveSurveyReviewCompletion(params.projectRoot);
    case "graph_build":
      return resolveGraphCompletion(params.projectRoot);
    case "frontier_mapping":
      return resolveFrontierMappingCompletion(params.projectRoot);
    case "plan":
      return resolvePlanCompletion(params.projectRoot);
    case "code":
      return resolveCodeCompletion(params.projectRoot);
    case "experiment":
      return resolveExperimentCompletion(params.projectRoot);
    case "analyze":
      return resolveLegacyAnalyzeCompletion(params.projectRoot);
    case "topic_search":
      return resolveTopicSearchCompletion(params.projectRoot);
    case "literature_review":
      return resolveLiteratureReviewCompletion(params.projectRoot);
    case "ideation":
      return resolveIdeationCompletion(params.projectRoot);
    case "idea":
      return resolveLegacyIdeaCompletion(params.projectRoot);
    case "experiment_plan":
      return resolveExperimentPlanCompletion(params.projectRoot);
    case "experiment_loop":
      return resolveExperimentLoopCompletion(params.projectRoot);
    case "analysis":
      return resolveAnalysisCompletion(params.projectRoot);
    case "write":
      return resolveWritingCompletion(params.projectRoot, {
        stage: "write",
        contractSource: "write_completion",
      });
    case "writing":
      return resolveWritingCompletion(params.projectRoot);
    case "review":
      return resolvePolishReviewCompletion(params.projectRoot, {
        stage: "review",
        completeNextAction: "/write-paper",
        incompleteNextAction: "/review-paper",
        contractSource: "review_completion",
      });
    case "polish_review":
      return resolvePolishReviewCompletion(params.projectRoot);
    case "submit":
      return resolveSubmissionReadyCompletion(params.projectRoot, {
        stage: "submit",
        owner: "reviewer",
        contractSource: "submit_completion",
      });
    case "submission_ready":
      return resolveSubmissionReadyCompletion(params.projectRoot);
    case "done":
      return resolveDoneCompletion(params.projectRoot);
    default:
      return completion({
        stage,
        completionStatus: "incomplete",
        owner: stageOwner(stage) ?? pickString({}, []),
        blockingReason: null,
        contractSource: `${stage}_completion`,
      });
  }
}
