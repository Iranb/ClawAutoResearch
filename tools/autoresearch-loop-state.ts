import * as path from "node:path";

import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickNumber,
  pickString,
  uniqueStrings,
} from "./workflow-guard-core/coercion";
import {
  pathExists,
  readJsonIfExists,
  writeJsonEnsured,
} from "./workflow-guard-core/fs";

export const AUTORESEARCH_LOOP_STATE_PATH =
  "researcher/AUTORESEARCH_LOOP_STATE.json";

export const PAPERGURU_SIX_PASS_IDS = [
  "pass_1_structure",
  "pass_2_argumentation",
  "pass_3_sentence_precision",
  "pass_4_grammar_terminology",
  "pass_5_typography_latex",
  "pass_6_integrity_audit",
] as const;

export type AutoResearchAdvanceTarget =
  | "plan"
  | "experiment"
  | "analyze"
  | "write"
  | "review"
  | "submit";

export type AutoResearchTrialDecisionOutcome =
  | "promote"
  | "discard"
  | "continue_tuning"
  | "unknown";

export type AutoResearchTrialRecord = {
  trial_id: string;
  experiment_id: string | null;
  track_id: string | null;
  claim_ids: string[];
  status: string;
  metric_name: string | null;
  metric_value: number | null;
  metric_delta: number | null;
  branch: string | null;
  commit: string | null;
  artifacts: string[];
  attempt: Record<string, unknown> | null;
  decision: {
    outcome: AutoResearchTrialDecisionOutcome;
    reason: string | null;
  };
  updated_at: string | null;
};

export type ArticleEvidenceContract = {
  papers: unknown[];
  paragraphs: unknown[];
  claims: unknown[];
  usages: unknown[];
  gaps: unknown[];
  writing_quality: Record<string, unknown>;
};

export type AutoResearchLoopState = {
  schema_version: 1;
  state_revision: number;
  project_id: string | null;
  track_id: string | null;
  status: string;
  phase: string | null;
  owner: string | null;
  next_action: string | null;
  blocking_reason: string | null;
  updated_at: string;
  last_writer: {
    agent: string | null;
    session_id: string | null;
    operation_id: string | null;
  };
  papernexus: Record<string, unknown>;
  planner_plan: Record<string, unknown>;
  reference_context: {
    article_evidence_contract: ArticleEvidenceContract;
  };
  git_state: Record<string, unknown>;
  trial_queue: unknown[];
  trial_history: AutoResearchTrialRecord[];
  decision_rules: Record<string, unknown>;
  advance: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
};

export type AutoResearchAdvanceDecision = {
  targetStage: AutoResearchAdvanceTarget;
  allowed: boolean;
  decision: "advance" | "blocked";
  reasons: string[];
  nextAction: string | null;
  diagnostics: Record<string, unknown>;
};

export type PaperGuruGateResult = {
  status: "ready" | "blocked" | "optional";
  missingSignals: string[];
  paperGuruState: Record<string, unknown>;
};

type HydrateParams = {
  projectRoot: string;
  manifest?: Record<string, unknown> | null;
  operationId?: string | null;
  agentId?: string | null;
  now?: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeObjectArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === "object") : [];
}

function normalizeArticleEvidenceContract(value: unknown): ArticleEvidenceContract {
  const record = asRecord(value) ?? {};
  return {
    papers: normalizeObjectArray(record.papers),
    paragraphs: normalizeObjectArray(record.paragraphs),
    claims: normalizeObjectArray(record.claims),
    usages: normalizeObjectArray(record.usages),
    gaps: normalizeObjectArray(record.gaps),
    writing_quality: asRecord(record.writing_quality ?? record.writingQuality) ?? {},
  };
}

function resolveProjectArtifactPath(projectRoot: string, artifactPath: string | null): string | null {
  if (!artifactPath) {
    return null;
  }
  return path.isAbsolute(artifactPath) ? artifactPath : path.join(projectRoot, artifactPath);
}

function readMetricDelta(entry: Record<string, unknown>): number | null {
  const keyMetric = asRecord(entry.key_metric ?? entry.keyMetric) ?? {};
  const metrics = asRecord(entry.metrics) ?? {};
  const primaryResult = asRecord(entry.primary_result ?? entry.primaryResult) ?? {};
  return (
    pickNumber(keyMetric, ["delta"]) ??
    pickNumber(metrics, ["delta_h_score", "deltaHScore", "metric_delta", "metricDelta"]) ??
    pickNumber(primaryResult, ["delta_h_score", "deltaHScore", "metric_delta", "metricDelta"]) ??
    null
  );
}

function readMetricValue(entry: Record<string, unknown>): number | null {
  const keyMetric = asRecord(entry.key_metric ?? entry.keyMetric) ?? {};
  const metrics = asRecord(entry.metrics) ?? {};
  return (
    pickNumber(keyMetric, ["value"]) ??
    pickNumber(metrics, ["h_score", "hScore", "all_acc", "allAcc", "accuracy"]) ??
    null
  );
}

function readMinimumImprovement(entry: Record<string, unknown>): number | null {
  const keyMetric = asRecord(entry.key_metric ?? entry.keyMetric) ?? {};
  const metadata = asRecord(entry.metadata) ?? {};
  const trialContract =
    asRecord(metadata.trial_contract ?? metadata.trialContract) ?? {};
  const primaryMetric =
    asRecord(trialContract.primary_metric ?? trialContract.primaryMetric) ?? {};
  const contract =
    asRecord(trialContract.primary_metric_contract ?? trialContract.primaryMetricContract) ??
    asRecord(metadata.primary_metric_contract ?? metadata.primaryMetricContract) ??
    asRecord(keyMetric.primary_metric_contract ?? keyMetric.primaryMetricContract) ??
    {};
  return (
    pickNumber(primaryMetric, ["minimum_improvement", "minimumImprovement"]) ??
    pickNumber(contract, ["minimum_improvement", "minimumImprovement"]) ??
    null
  );
}

function hasPromotableMetricGain(entry: Record<string, unknown>): boolean {
  const delta = readMetricDelta(entry);
  const minimumImprovement = readMinimumImprovement(entry);
  return (
    delta !== null &&
    delta > 0 &&
    (minimumImprovement === null ||
      minimumImprovement <= 0 ||
      delta >= minimumImprovement)
  );
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function deriveTrialOutcome(entry: Record<string, unknown>): AutoResearchTrialDecisionOutcome {
  const promotableGain = hasPromotableMetricGain(entry);
  const decision = normalizeStage(
    entry.decision ??
      entry.last_decision ??
      entry.lastDecision ??
      entry.outcome
  );
  if (decision === "promote" || decision === "promoted" || decision === "advance") {
    return promotableGain ? "promote" : "discard";
  }
  if (decision === "keep" || decision === "innovation_supported") {
    return promotableGain ? "promote" : "continue_tuning";
  }
  if (
    decision === "discard" ||
    decision === "discarded" ||
    decision === "needs_repair" ||
    decision === "failed"
  ) {
    return "discard";
  }
  const delta = readMetricDelta(entry);
  if (delta !== null) {
    return promotableGain ? "promote" : "discard";
  }
  return "unknown";
}

function normalizeTrialRecord(entry: unknown, index: number): AutoResearchTrialRecord | null {
  const record = asRecord(entry);
  if (!record) {
    return null;
  }
  const experimentId = pickString(record, ["experiment_id", "experimentId", "id"]);
  const metadata = asRecord(record.metadata) ?? {};
  const execution = asRecord(metadata.execution) ?? {};
  const attempt =
    asRecord(record.attempt) ??
    asRecord(metadata.attempt) ??
    asRecord(execution.attempt) ??
    null;
  const keyMetric = asRecord(record.key_metric ?? record.keyMetric) ?? {};
  const decision = deriveTrialOutcome(record);
  return {
    trial_id: experimentId ?? `trial_${index + 1}`,
    experiment_id: experimentId,
    track_id: pickString(record, ["track_id", "trackId"]),
    claim_ids: uniqueStrings([
      ...asStringArray(record.claim_ids ?? record.claimIds),
      ...asStringArray(metadata.claim_ids ?? metadata.claimIds),
    ]),
    status: normalizeStage(record.status) ?? "unknown",
    metric_name: pickString(keyMetric, ["name"]) ?? null,
    metric_value: readMetricValue(record),
    metric_delta: readMetricDelta(record),
    branch:
      pickString(record, ["branch", "git_branch", "gitBranch"]) ??
      pickString(execution, ["branch", "git_branch", "gitBranch"]),
    commit:
      pickString(record, ["commit", "git_commit", "gitCommit"]) ??
      pickString(execution, ["git_commit", "gitCommit", "candidate_commit", "candidateCommit"]),
    artifacts: uniqueStrings([
      ...asStringArray(record.result_paths ?? record.resultPaths),
      ...asStringArray(record.evidence_pointers ?? record.evidencePointers),
    ]),
    attempt,
    decision: {
      outcome: decision,
      reason:
        pickString(record, ["last_decision_summary", "lastDecisionSummary", "summary"]) ??
        (decision === "discard" ? "Primary metric did not improve over baseline." : null),
    },
    updated_at:
      pickString(record, ["updated_at", "updatedAt", "completed_at", "completedAt"]) ?? null,
  };
}

function mergeObjects(
  left: Record<string, unknown> | null | undefined,
  right: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  return {
    ...(left ?? {}),
    ...(right ?? {}),
  };
}

function mergeRecordListsById(
  left: unknown[],
  right: unknown[],
  idKeys: string[]
): unknown[] {
  const merged: Record<string, unknown>[] = [];
  const seen = new Map<string, number>();
  for (const entry of [...left, ...right]) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const id = pickString(record, idKeys);
    if (!id) {
      merged.push(record);
      continue;
    }
    const existingIndex = seen.get(id);
    if (existingIndex === undefined) {
      seen.set(id, merged.length);
      merged.push(record);
      continue;
    }
    merged[existingIndex] = {
      ...merged[existingIndex],
      ...record,
    };
  }
  return merged;
}

async function readManifest(projectRoot: string, supplied?: Record<string, unknown> | null) {
  return supplied ?? (await readJsonIfExists<Record<string, unknown>>(
    path.join(projectRoot, "PROJECT_MANIFEST.json")
  )) ?? {};
}

async function readExperimentSearch(projectRoot: string, manifest: Record<string, unknown>) {
  return (
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "researcher", "EXPERIMENT_SEARCH.json")
    )) ??
    asRecord(manifest.experiment_search) ??
    {}
  );
}

async function readExperimentLedger(projectRoot: string) {
  return (
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json")
    )) ?? {}
  );
}

function derivePaperNexusEvidenceLevel(params: {
  graphPresenceStatus: string | null;
  readyProofLevel: string | null;
  claimLevel: string | null;
  sourceBackedGraphClaim: boolean | null;
}): string {
  const graphStatus = normalizeStage(params.graphPresenceStatus);
  const readyProofLevel = normalizeStage(params.readyProofLevel);
  const claimLevel = normalizeStage(params.claimLevel);
  if (
    params.sourceBackedGraphClaim === true ||
    readyProofLevel === "source_span" ||
    claimLevel === "source_backed_graph" ||
    claimLevel === "per_paper_source_backed"
  ) {
    return "remote_source_backed";
  }
  if (
    readyProofLevel === "remote_summary" ||
    readyProofLevel === "paper_index" ||
    claimLevel === "remote_corpus_summary" ||
    claimLevel === "paper_index_confirmed"
  ) {
    return "remote_metadata";
  }
  if (graphStatus === "ready") {
    return "local_fallback";
  }
  return "unavailable";
}

function buildPaperNexusProjection(manifest: Record<string, unknown>): Record<string, unknown> {
  const paperIngestion = asRecord(manifest.paper_ingestion) ?? {};
  const ideaCatalyst = asRecord(manifest.idea_catalyst) ?? {};
  const capabilities =
    asRecord(manifest.papernexus_capabilities) ??
    asRecord(paperIngestion.papernexus_capabilities) ??
    asRecord(paperIngestion.capabilities) ??
    {};
  const mcpUrl =
    pickString(manifest, ["papernexus_mcp_url", "papernexusMcpUrl"]) ??
    pickString(paperIngestion, ["papernexus_mcp_url", "papernexusMcpUrl"]) ??
    null;
  const apiBaseUrl =
    pickString(manifest, ["papernexus_api_base_url", "papernexusApiBaseUrl"]) ??
    pickString(paperIngestion, ["papernexus_api_base_url", "papernexusApiBaseUrl"]) ??
    null;
  const accessMode =
    pickString(manifest, ["papernexus_access_mode", "papernexusAccessMode"]) ??
    pickString(paperIngestion, ["papernexus_access_mode", "papernexusAccessMode"]) ??
    null;
  const tokenSource =
    pickString(manifest, ["papernexus_api_token_source", "papernexusApiTokenSource"]) ??
    "auto";
  const tokenService =
    pickString(manifest, ["papernexus_api_token_service", "papernexusApiTokenService"]) ??
    "papernexus-api-token";
  const tokenAccount =
    pickString(manifest, ["papernexus_api_token_account", "papernexusApiTokenAccount"]) ??
    "default";
  const graphPresenceStatus =
    pickString(paperIngestion, ["graph_presence_status", "graphPresenceStatus"]) ?? null;
  const readyProofLevel =
    pickString(paperIngestion, [
      "ready_proof_level",
      "readyProofLevel",
      "graph_presence_ready_proof_level",
      "graphPresenceReadyProofLevel",
    ]) ??
    pickString(manifest, [
      "graph_presence_ready_proof_level",
      "graphPresenceReadyProofLevel",
    ]) ??
    null;
  const claimLevel =
    pickString(paperIngestion, [
      "papernexus_claim_level",
      "papernexusClaimLevel",
      "claim_level",
      "claimLevel",
    ]) ??
    pickString(manifest, [
      "papernexus_claim_level",
      "papernexusClaimLevel",
      "claim_level",
      "claimLevel",
    ]) ??
    null;
  const sourceBackedGraphClaim =
    readBoolean(
      paperIngestion.papernexus_source_backed_graph_claim ??
        paperIngestion.source_backed_graph_claim ??
        paperIngestion.sourceBackedGraphClaim ??
        manifest.papernexus_source_backed_graph_claim ??
        manifest.source_backed_graph_claim
    );
  const evidenceLevel = derivePaperNexusEvidenceLevel({
    graphPresenceStatus,
    readyProofLevel,
    claimLevel,
    sourceBackedGraphClaim,
  });
  return {
    server: mcpUrl ?? apiBaseUrl,
    mcp_url: mcpUrl,
    api_base_url: apiBaseUrl,
    access_mode: accessMode,
    auth_source: tokenSource === "os_keychain" ? "macos_keychain" : tokenSource,
    token_service: tokenService,
    token_account: tokenAccount,
    corpus_id:
      pickString(manifest, ["papernexus_shared_corpus", "papernexusSharedCorpus"]) ??
      pickString(paperIngestion, ["corpus_id", "corpusId", "corpus"]) ??
      null,
    graph_presence_status: graphPresenceStatus,
    graph_presence_checked_at:
      pickString(paperIngestion, ["graph_presence_checked_at", "graphPresenceCheckedAt"]) ?? null,
    graph_ready_proof_level: readyProofLevel,
    claim_level: claimLevel,
    source_backed_graph_claim: sourceBackedGraphClaim ?? false,
    evidence_level: evidenceLevel,
    degraded_graph_context: evidenceLevel !== "remote_source_backed",
    capabilities: {
      research_lookup:
        pickString(capabilities, ["research_lookup", "researchLookup"]) ??
        (normalizeStage(paperIngestion.graph_presence_status) === "ready" ? "available" : "unknown"),
      idea_catalyst:
        pickString(capabilities, ["idea_catalyst", "ideaCatalyst"]) ??
        (normalizeStage(ideaCatalyst.status) === "ready" ? "available" : "unknown"),
      paragraph_context:
        pickString(capabilities, ["paragraph_context", "paragraphContext"]) ?? "unknown",
      claim_paragraph_search:
        pickString(capabilities, ["claim_paragraph_search", "claimParagraphSearch"]) ?? "unknown",
    },
    idea_catalyst_status: pickString(ideaCatalyst, ["status"]) ?? null,
    idea_fragments_path:
      pickString(ideaCatalyst, ["idea_fragments_path", "ideaFragmentsPath"]) ?? null,
    ranked_fragments_path:
      pickString(ideaCatalyst, ["ranked_fragments_path", "rankedFragmentsPath"]) ?? null,
    selected_ideas_path:
      pickString(ideaCatalyst, ["selected_ideas_path", "selectedIdeasPath"]) ?? null,
  };
}

function buildPlannerProjection(manifest: Record<string, unknown>): Record<string, unknown> {
  const researchProgram = asRecord(manifest.research_program) ?? {};
  const planSelection = asRecord(researchProgram.plan_selection ?? researchProgram.planSelection) ?? {};
  const existingPlannerPlan =
    asRecord(manifest.planner_plan) ??
    asRecord(researchProgram.planner_plan ?? researchProgram.plannerPlan) ??
    {};
  return {
    ...existingPlannerPlan,
    selected_track_id:
      pickString(planSelection, ["selected_track_id", "selectedTrackId"]) ??
      pickString(researchProgram, ["selected_track_id", "selectedTrackId"]) ??
      null,
    primary_metric:
      pickString(researchProgram, ["primary_metric", "primaryMetric"]) ?? null,
    baseline_reference:
      pickString(researchProgram, ["baseline_reference", "baselineReference"]) ?? null,
  };
}

function buildGitProjection(search: Record<string, unknown>): Record<string, unknown> {
  return {
    incumbent_branch: pickString(search, ["incumbent_branch", "incumbentBranch"]) ?? null,
    incumbent_commit: pickString(search, ["incumbent_commit", "incumbentCommit"]) ?? null,
    candidate_branch:
      pickString(search, ["last_candidate_branch", "lastCandidateBranch", "candidate_branch"]) ??
      null,
    candidate_commit:
      pickString(search, [
        "last_candidate_commit",
        "lastCandidateCommit",
        "candidate_head_commit",
        "candidateHeadCommit",
      ]) ?? null,
  };
}

export async function hydrateAutoResearchLoopState(
  params: HydrateParams
): Promise<AutoResearchLoopState> {
  const projectRoot = path.resolve(params.projectRoot);
  const now = params.now ?? nowIso();
  const existing =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, AUTORESEARCH_LOOP_STATE_PATH)
    )) ?? {};
  const manifest = await readManifest(projectRoot, params.manifest);
  const experimentSearch = await readExperimentSearch(projectRoot, manifest);
  const experimentLedger = await readExperimentLedger(projectRoot);
  const ledgerExperiments = Array.isArray(experimentLedger.experiments)
    ? experimentLedger.experiments
    : [];
  const trialHistory = ledgerExperiments
    .map((entry, index) => normalizeTrialRecord(entry, index))
    .filter((entry): entry is AutoResearchTrialRecord => Boolean(entry));
  const existingReference = asRecord(existing.reference_context) ?? {};
  const existingContract = normalizeArticleEvidenceContract(
    existingReference.article_evidence_contract
  );
  const manifestReference = asRecord(manifest.reference_context) ?? {};
  const manifestContract = normalizeArticleEvidenceContract(
    manifestReference.article_evidence_contract
  );
  const articleEvidenceContract: ArticleEvidenceContract = {
    papers:
      manifestContract.papers.length > 0 ? manifestContract.papers : existingContract.papers,
    paragraphs:
      manifestContract.paragraphs.length > 0
        ? manifestContract.paragraphs
        : existingContract.paragraphs,
    claims:
      manifestContract.claims.length > 0 ? manifestContract.claims : existingContract.claims,
    usages:
      manifestContract.usages.length > 0 ? manifestContract.usages : existingContract.usages,
    gaps: mergeRecordListsById(existingContract.gaps, manifestContract.gaps, [
      "gap_id",
      "gapId",
      "id",
    ]),
    writing_quality: mergeObjects(
      existingContract.writing_quality,
      manifestContract.writing_quality
    ),
  };
  const phase =
    normalizeStage(manifest.current_stage) ??
    normalizeStage(experimentSearch.status) ??
    normalizeStage(existing.phase) ??
    null;
  const existingLastWriter = asRecord(existing.last_writer ?? existing.lastWriter) ?? {};
  const promotedTrials = trialHistory.filter(
    (entry) => entry.decision.outcome === "promote"
  );
  const discardedTrials = trialHistory.filter(
    (entry) => entry.decision.outcome === "discard"
  );
  return {
    schema_version: 1,
    state_revision:
      typeof existing.state_revision === "number" && Number.isFinite(existing.state_revision)
        ? Math.max(1, Math.floor(existing.state_revision))
        : 1,
    project_id:
      pickString(manifest, ["project_id", "projectId"]) ??
      pickString(existing, ["project_id", "projectId"]) ??
      null,
    track_id:
      pickString(experimentSearch, ["track_id", "trackId"]) ??
      pickString(buildPlannerProjection(manifest), ["selected_track_id", "selectedTrackId"]) ??
      pickString(existing, ["track_id", "trackId"]) ??
      null,
    status: normalizeStage(existing.status) ?? "running",
    phase,
    owner:
      pickString(manifest, ["owner_agent", "ownerAgent"]) ??
      pickString(existing, ["owner"]) ??
      null,
    next_action:
      pickString(experimentSearch, ["recommended_next_action", "recommendedNextAction"]) ??
      pickString(existing, ["next_action", "nextAction"]) ??
      null,
    blocking_reason:
      pickString(experimentSearch, ["pending_reason", "pendingReason"]) ??
      pickString(existing, ["blocking_reason", "blockingReason"]) ??
      null,
    updated_at: now,
    last_writer: {
      agent: params.agentId ?? pickString(existingLastWriter, ["agent"]) ?? null,
      session_id: pickString(existingLastWriter, ["session_id", "sessionId"]) ?? null,
      operation_id:
        params.operationId ??
        pickString(existingLastWriter, ["operation_id", "operationId"]) ??
        null,
    },
    papernexus: mergeObjects(asRecord(existing.papernexus), buildPaperNexusProjection(manifest)),
    planner_plan: mergeObjects(asRecord(existing.planner_plan), buildPlannerProjection(manifest)),
    reference_context: {
      article_evidence_contract: articleEvidenceContract,
    },
    git_state: mergeObjects(asRecord(existing.git_state), buildGitProjection(experimentSearch)),
    trial_queue: Array.isArray(existing.trial_queue) ? existing.trial_queue : [],
    trial_history: trialHistory,
    decision_rules: asRecord(existing.decision_rules) ?? {},
    advance: {
      ...(asRecord(existing.advance) ?? {}),
      promoted_trial_count: promotedTrials.length,
      discarded_trial_count: discardedTrials.length,
      completed_trial_count: trialHistory.filter((entry) => entry.status === "completed").length,
    },
    diagnostics: {
      ...(asRecord(existing.diagnostics) ?? {}),
      hydrated_from: [
        "PROJECT_MANIFEST.json",
        "researcher/EXPERIMENT_SEARCH.json",
        "researcher/EXPERIMENT_LEDGER.json",
      ],
      last_hydrated_at: now,
    },
  };
}

export async function saveAutoResearchLoopState(
  projectRoot: string,
  state: AutoResearchLoopState,
  params: { operationId?: string | null; agentId?: string | null; now?: string | null } = {}
): Promise<AutoResearchLoopState> {
  const root = path.resolve(projectRoot);
  const existing =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(root, AUTORESEARCH_LOOP_STATE_PATH)
    )) ?? {};
  const now = params.now ?? nowIso();
  const next: AutoResearchLoopState = {
    ...state,
    state_revision:
      (typeof existing.state_revision === "number" && Number.isFinite(existing.state_revision)
        ? Math.floor(existing.state_revision)
        : state.state_revision) + 1,
    updated_at: now,
    last_writer: {
      agent: params.agentId ?? state.last_writer.agent ?? null,
      session_id: state.last_writer.session_id ?? null,
      operation_id: params.operationId ?? state.last_writer.operation_id ?? null,
    },
  };
  await writeJsonEnsured(path.join(root, AUTORESEARCH_LOOP_STATE_PATH), next);
  return next;
}

export async function loadOrHydrateAutoResearchLoopState(
  params: HydrateParams & { persist?: boolean }
): Promise<AutoResearchLoopState> {
  const state = await hydrateAutoResearchLoopState(params);
  if (params.persist === false) {
    return state;
  }
  return await saveAutoResearchLoopState(params.projectRoot, state, {
    operationId: params.operationId,
    agentId: params.agentId,
    now: params.now,
  });
}

function trialGate(state: AutoResearchLoopState): string[] {
  const promoted = state.trial_history.filter((entry) => entry.decision.outcome === "promote");
  if (promoted.length === 0) {
    return ["No promoted trial exists; continue the Karpathy search loop."];
  }
  const latestPromoted = promoted[promoted.length - 1];
  if ((latestPromoted.metric_delta ?? 0) <= 0) {
    return ["Promoted trial must have a positive primary-metric delta."];
  }
  const attempt = asRecord(latestPromoted.attempt) ?? {};
  const terminalStatus = pickString(attempt, ["terminal_status", "terminalStatus"]);
  if (
    terminalStatus &&
    terminalStatus !== "improved_promoted_candidate"
  ) {
    return [
      `Promoted trial attempt must be improved_promoted_candidate (current: ${terminalStatus}).`,
    ];
  }
  if (readBoolean(attempt.local_control_flow_fallback) === true) {
    return ["Promoted trial cannot rely on local control-flow fallback evidence."];
  }
  return [];
}

function recordId(record: Record<string, unknown>, fallback: string): string {
  return pickString(record, ["claim_id", "claimId", "id"]) ?? fallback;
}

function isStrongClaim(record: Record<string, unknown>): boolean {
  const strength = normalizeStage(
    record.strength ??
      record.claim_strength ??
      record.claimStrength ??
      record.evidence_requirement ??
      record.evidenceRequirement
  );
  return (
    strength === "strong" ||
    strength === "paper_facing" ||
    strength === "paragraph_required" ||
    readBoolean(record.strong_claim ?? record.strongClaim) === true ||
    readBoolean(record.paper_facing ?? record.paperFacing) === true ||
    readBoolean(record.requires_paragraph_evidence ?? record.requiresParagraphEvidence) === true
  );
}

function claimIdsForUsage(record: Record<string, unknown>): string[] {
  const scalarClaimId = pickString(record, ["claim_id", "claimId"]);
  return uniqueStrings([
    ...asStringArray(record.claim_ids ?? record.claimIds),
    ...(scalarClaimId ? [scalarClaimId] : []),
  ]);
}

function hasPaperAnchor(record: Record<string, unknown>): boolean {
  return (
    asStringArray(record.paper_ids ?? record.paperIds).length > 0 ||
    Boolean(pickString(record, ["paper_id", "paperId"]))
  );
}

function hasParagraphAnchor(record: Record<string, unknown>): boolean {
  return (
    asStringArray(
      record.paper_paragraph_ids ??
        record.paperParagraphIds ??
        record.paragraph_ids ??
        record.paragraphIds
    ).length > 0 ||
    Boolean(pickString(record, ["paper_paragraph_id", "paperParagraphId", "paragraph_id", "paragraphId"]))
  );
}

function articleEvidenceCoverageGate(
  contract: ArticleEvidenceContract,
  targetStage: AutoResearchAdvanceTarget
): string[] {
  const claims = normalizeObjectArray(contract.claims)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const strongClaims = claims.filter(isStrongClaim);
  if (strongClaims.length === 0) {
    return [];
  }
  const usages = normalizeObjectArray(contract.usages)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const blockers: string[] = [];
  for (const [index, claim] of strongClaims.entries()) {
    const claimId = recordId(claim, `claim_${index + 1}`);
    const claimUsages = usages.filter((usage) => claimIdsForUsage(usage).includes(claimId));
    const hasPaper = hasPaperAnchor(claim) || claimUsages.some(hasPaperAnchor);
    const hasParagraph =
      hasParagraphAnchor(claim) || claimUsages.some((usage) => hasPaperAnchor(usage) && hasParagraphAnchor(usage));
    const waived = claimUsages.some((usage) =>
      Boolean(pickString(usage, ["waived_reason", "waivedReason", "waiver_reason", "waiverReason"]))
    );
    if ((targetStage === "write" || targetStage === "review") && !hasPaper) {
      blockers.push(`Strong claim ${claimId} lacks a paper anchor.`);
    }
    if (targetStage === "submit" && (!hasPaper || !hasParagraph) && !waived) {
      blockers.push(
        `Strong claim ${claimId} lacks submit-ready claim-paper-paragraph usage coverage.`
      );
    }
  }
  return blockers;
}

function articleEvidenceGate(state: AutoResearchLoopState, targetStage: AutoResearchAdvanceTarget): string[] {
  const contract = state.reference_context.article_evidence_contract;
  if (targetStage === "plan") {
    const plannerBridge = asRecord(state.planner_plan.idea_catalyst_bridge);
    const ideaCatalystReady =
      normalizeStage(state.papernexus.idea_catalyst_status) === "ready" ||
      normalizeStage(plannerBridge?.status) === "ready";
    const evidenceLevel = normalizeStage(state.papernexus.evidence_level);
    const remoteGraphRequested =
      Boolean(pickString(state.papernexus, ["server", "mcp_url", "api_base_url"])) ||
      normalizeStage(state.papernexus.access_mode)?.includes("remote") === true;
    if (!ideaCatalystReady) {
      return ["Graph-guided plan requires ready Idea-Catalyst evidence."];
    }
    if (!plannerBridge || normalizeObjectArray(plannerBridge.fragments).length === 0) {
      return ["Graph-guided plan requires planner_plan.idea_catalyst_bridge fragments."];
    }
    if (
      remoteGraphRequested &&
      evidenceLevel !== "remote_source_backed" &&
      evidenceLevel !== "remote_metadata"
    ) {
      return [
        `Graph-guided plan requires remote PaperNexus evidence (current: ${evidenceLevel ?? "unavailable"}).`,
      ];
    }
    const claimMappings = normalizeObjectArray(plannerBridge.claim_mappings)
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
    const claimMappedFragmentIds = new Set(
      claimMappings
        .map((entry) => pickString(entry, ["fragment_id", "fragmentId"]))
        .filter((entry): entry is string => Boolean(entry))
    );
    const incompleteFragments = normalizeObjectArray(plannerBridge.fragments)
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .filter((entry, index) => {
        const fragmentId = pickString(entry, ["fragment_id", "fragmentId"]) ?? `fragment_${index + 1}`;
        const claimIds = asStringArray(entry.claim_ids ?? entry.claimIds);
        return (
          asStringArray(entry.paper_ids ?? entry.paperIds).length === 0 ||
          (claimIds.length === 0 && !claimMappedFragmentIds.has(fragmentId))
        );
      });
    if (incompleteFragments.length > 0) {
      return [
        "Graph-guided plan requires selected fragments to have both paper anchors and claim mappings.",
      ];
    }
  }
  if ((targetStage === "write" || targetStage === "review" || targetStage === "submit") && contract.usages.length === 0) {
    return ["Article evidence contract has no manuscript usages."];
  }
  const coverageBlockers = articleEvidenceCoverageGate(contract, targetStage);
  if (coverageBlockers.length > 0) {
    return coverageBlockers;
  }
  if (targetStage === "submit") {
    const paperGuru = asRecord(contract.writing_quality.paper_guru);
    const paperGuruStatus = normalizeStage(paperGuru?.status);
    if (paperGuruStatus && paperGuruStatus !== "ready" && paperGuruStatus !== "optional") {
      return [
        `PaperGuru writing-quality gate is not ready (current: ${paperGuruStatus}).`,
      ];
    }
    const missingPassIds = asStringArray(
      paperGuru?.missing_pass_ids ?? paperGuru?.missingPassIds
    );
    if (missingPassIds.length > 0) {
      return [
        `PaperGuru six-pass gate is missing completed passes: ${missingPassIds.join(", ")}.`,
      ];
    }
    const requiredReceiptGroups = [
      {
        label: "compile",
        receipts: asStringArray(paperGuru?.compile_receipts ?? paperGuru?.compileReceipts),
      },
      {
        label: "citation/reference verification",
        receipts: asStringArray(
          paperGuru?.reference_verification_receipts ??
            paperGuru?.referenceVerificationReceipts
        ),
      },
      {
        label: "number consistency",
        receipts: asStringArray(
          paperGuru?.number_consistency_receipts ?? paperGuru?.numberConsistencyReceipts
        ),
      },
      {
        label: "claim-evidence consistency",
        receipts: asStringArray(
          paperGuru?.claim_evidence_consistency_receipts ??
            paperGuru?.claimEvidenceConsistencyReceipts
        ),
      },
    ];
    const missingReceiptGroups = requiredReceiptGroups
      .filter((entry) => paperGuruStatus === "ready" && entry.receipts.length === 0)
      .map((entry) => entry.label);
    if (missingReceiptGroups.length > 0) {
      return [
        `PaperGuru submit gate is missing required receipts: ${missingReceiptGroups.join(", ")}.`,
      ];
    }
  }
  return [];
}

export function canAdvance(
  state: AutoResearchLoopState,
  targetStage: AutoResearchAdvanceTarget
): AutoResearchAdvanceDecision {
  const reasons = [
    ...(targetStage === "analyze" ? trialGate(state) : []),
    ...articleEvidenceGate(state, targetStage),
  ];
  const allowed = reasons.length === 0;
  return {
    targetStage,
    allowed,
    decision: allowed ? "advance" : "blocked",
    reasons,
    nextAction: allowed
      ? null
      : targetStage === "analyze"
        ? "continue_tuning"
        : targetStage === "plan"
          ? "materialize_idea_catalyst_bridge"
          : "repair_article_evidence_contract",
    diagnostics: {
      promoted_trial_count: state.trial_history.filter(
        (entry) => entry.decision.outcome === "promote"
      ).length,
      target_stage: targetStage,
    },
  };
}

export async function recordAutoResearchAdvanceDecision(params: {
  projectRoot: string;
  targetStage: AutoResearchAdvanceTarget;
  manifest?: Record<string, unknown> | null;
  operationId?: string | null;
  agentId?: string | null;
}): Promise<AutoResearchAdvanceDecision> {
  const state = await hydrateAutoResearchLoopState(params);
  const decision = canAdvance(state, params.targetStage);
  await saveAutoResearchLoopState(
    params.projectRoot,
    {
      ...state,
      advance: {
        ...state.advance,
        [params.targetStage]: decision,
      },
      blocking_reason: decision.allowed ? null : decision.reasons.join("; "),
      next_action: decision.nextAction,
    },
    {
      operationId: params.operationId,
      agentId: params.agentId,
    }
  );
  return decision;
}

function normalizePassResultIds(value: unknown): Set<string> {
  const ids = new Set<string>();
  for (const entry of Array.isArray(value) ? value : []) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const status = normalizeStage(record.status) ?? normalizeStage(record.result);
    const passId = pickString(record, ["pass_id", "passId", "id"]);
    if (passId && (status === "completed" || status === "ready" || status === "pass")) {
      ids.add(passId);
    }
  }
  return ids;
}

export async function evaluatePaperGuruGate(params: {
  projectRoot: string;
  manifest?: Record<string, unknown> | null;
}): Promise<PaperGuruGateResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifest = await readManifest(projectRoot, params.manifest);
  const writingContract = asRecord(manifest.writing_contract) ?? {};
  const required =
    writingContract.scientific_editing_required === true ||
    writingContract.scientificEditingRequired === true;
  if (!required) {
    return {
      status: "optional",
      missingSignals: [],
      paperGuruState: { status: "optional" },
    };
  }
  const status = normalizeStage(
    writingContract.scientific_editing_status ?? writingContract.scientificEditingStatus
  );
  const passIds = uniqueStrings([
    ...asStringArray(
      writingContract.scientific_editing_passes ?? writingContract.scientificEditingPasses
    ),
    ...PAPERGURU_SIX_PASS_IDS,
  ]);
  const ledgerPath =
    pickString(writingContract, [
      "scientific_editing_ledger_path",
      "scientificEditingLedgerPath",
    ]) ?? "academic_writer/SCIENTIFIC_EDIT_LEDGER.json";
  const reportPath =
    pickString(writingContract, [
      "scientific_editing_report_path",
      "scientificEditingReportPath",
    ]) ?? "academic_writer/SCIENTIFIC_EDIT_REPORT.md";
  const ledgerResolvedPath = resolveProjectArtifactPath(projectRoot, ledgerPath);
  const reportResolvedPath = resolveProjectArtifactPath(projectRoot, reportPath);
  const ledger = await readJsonIfExists<Record<string, unknown>>(ledgerResolvedPath);
  const completedPassIds = normalizePassResultIds(ledger?.pass_results);
  const missingPassIds = passIds.filter((passId) => !completedPassIds.has(passId));
  const missingSignals: string[] = [];
  if (status !== "ready") {
    missingSignals.push(
      `PaperGuru scientific editing status must be ready before SUBMIT (current: ${status ?? "unset"})`
    );
  }
  if (!ledgerResolvedPath || !(await pathExists(ledgerResolvedPath))) {
    missingSignals.push(`{PROJ}/${ledgerPath}`);
  }
  if (!reportResolvedPath || !(await pathExists(reportResolvedPath))) {
    missingSignals.push(`{PROJ}/${reportPath}`);
  }
  if (status === "ready" && ledger && missingPassIds.length > 0) {
    missingSignals.push(
      `PaperGuru six-pass ledger must contain completed pass_results for: ${missingPassIds.join(", ")}`
    );
  }
  const compileReceipts = asStringArray(
    ledger?.compile_receipts ?? ledger?.compileReceipts
  );
  const refVerifyReceipts = asStringArray(
    ledger?.reference_verification_receipts ?? ledger?.referenceVerificationReceipts
  );
  const numberCheckReceipts = asStringArray(
    ledger?.number_consistency_receipts ?? ledger?.numberConsistencyReceipts
  );
  const claimEvidenceConsistencyReceipts = asStringArray(
    ledger?.claim_evidence_consistency_receipts ??
      ledger?.claimEvidenceConsistencyReceipts
  );
  const shouldReportReceiptGaps =
    Boolean(ledger) && (status === "ready" || completedPassIds.size === passIds.length);
  if (shouldReportReceiptGaps && compileReceipts.length === 0) {
    missingSignals.push("PaperGuru gate requires at least one compile receipt.");
  }
  if (shouldReportReceiptGaps && refVerifyReceipts.length === 0) {
    missingSignals.push("PaperGuru gate requires citation/reference verification receipt.");
  }
  if (shouldReportReceiptGaps && numberCheckReceipts.length === 0) {
    missingSignals.push("PaperGuru gate requires number-consistency receipt.");
  }
  if (shouldReportReceiptGaps && claimEvidenceConsistencyReceipts.length === 0) {
    missingSignals.push("PaperGuru gate requires claim-evidence consistency receipt.");
  }
  return {
    status: missingSignals.length === 0 ? "ready" : "blocked",
    missingSignals,
    paperGuruState: {
      schema_version: 1,
      status: missingSignals.length === 0 ? "ready" : "blocked",
      ledger_path: ledgerPath,
      report_path: reportPath,
      required_pass_ids: passIds,
      completed_pass_ids: Array.from(completedPassIds),
      missing_pass_ids: missingPassIds,
      compile_receipts: compileReceipts,
      reference_verification_receipts: refVerifyReceipts,
      number_consistency_receipts: numberCheckReceipts,
      claim_evidence_consistency_receipts: claimEvidenceConsistencyReceipts,
    },
  };
}

export async function hydratePaperGuruWritingQuality(params: {
  projectRoot: string;
  manifest?: Record<string, unknown> | null;
  operationId?: string | null;
  agentId?: string | null;
}): Promise<AutoResearchLoopState> {
  const state = await hydrateAutoResearchLoopState(params);
  const gate = await evaluatePaperGuruGate(params);
  const contract = state.reference_context.article_evidence_contract;
  const next: AutoResearchLoopState = {
    ...state,
    reference_context: {
      article_evidence_contract: {
        ...contract,
        writing_quality: {
          ...contract.writing_quality,
          paper_guru: gate.paperGuruState,
        },
      },
    },
  };
  return await saveAutoResearchLoopState(params.projectRoot, next, {
    operationId: params.operationId,
    agentId: params.agentId,
  });
}
