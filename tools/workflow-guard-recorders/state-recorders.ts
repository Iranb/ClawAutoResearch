import * as path from "node:path";
import {
  asRecord,
  asString,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";

type CitationIntegrityStateLike = {
  enabled: boolean;
  verificationRequired: boolean;
  sourceOfTruth: string[];
  bibliographyPath: string | null;
  verificationReportPath: string | null;
  verificationStatus: string | null;
  bibliographyEntryCount: number;
  bibliographyPageCount: number;
  minimumCitationCount: number;
  allCitationsReal: boolean;
  allowedPlaceholderCount: number;
  unresolvedPlaceholderCount: number;
  verifiedCitationCount: number;
  suspiciousCitationCount: number;
  hallucinatedCitationCount: number;
  topicRelevanceTopic: string | null;
  topicRelevanceStatus: string;
  relevantCitationCount: number;
  offTopicCitationCount: number;
  topicRelevanceSummary: string | null;
  lastVerifiedAt: string | null;
  pendingReason: string | null;
};

type IdleResearchStateLike = {
  enabled: boolean;
  topic: string | null;
  objective: string | null;
  querySeeds: string[];
  preferredVenues: string[];
  maxPapersPerCycle: number;
  cooldownMinutes: number;
  lastRunAt: string | null;
  lastDigestPath: string | null;
  lastSourceUpdateAt: string | null;
  status: string;
  pendingReason: string | null;
  nextQueryHint: string | null;
  refreshGraphOnNewCorePapers: boolean;
  lastRoundNewCanonicalPapers: number;
  lastRoundNewCorePapers: number;
};

type InnovationReflectionStateLike = {
  requiredAfterExperiments: boolean;
  status: string;
  lastReflectionAt: string | null;
  lastReflectionPath: string | null;
  reflectedThroughExperimentUpdateAt: string | null;
  reflectedExperimentIds: string[];
  pendingReason: string | null;
};

type ExperimentLedgerEntryLike = {
  experimentId: string;
  updatedAt: string;
  lastUpdatedBy: string | null;
  [key: string]: unknown;
};

type ExperimentLedgerSummaryLike = {
  activeExperimentIds: string[];
  lastCompletedExperimentId: string | null;
  lastFailedExperimentId: string | null;
  bestKnownConfigRef: string | null;
  lastDecisionSummary: string | null;
  papernexusSyncRequired: boolean;
  papernexusLastSyncAt: string | null;
};

type ExperimentLedgerLike = {
  projectId: string | null;
  updatedAt: string;
  summary: ExperimentLedgerSummaryLike;
  experiments: ExperimentLedgerEntryLike[];
};

type ExperimentMemoryDigestLike = Record<string, unknown>;

type InnovationReflectionBasisLike = {
  latestExperimentUpdateAt: string | null;
  experimentIds: string[];
};

type RecorderDeps = {
  readManifestEnsured: (projectRoot: string) => Promise<Record<string, unknown>>;
  saveManifest: (
    projectRoot: string,
    manifest: Record<string, unknown>
  ) => Promise<void>;
  normalizeCitationIntegrityState: (value: unknown) => CitationIntegrityStateLike;
  serializeCitationIntegrityState: (value: unknown) => Record<string, unknown>;
  normalizeIdleResearchState: (value: unknown) => IdleResearchStateLike;
  serializeIdleResearchState: (value: unknown) => Record<string, unknown>;
  normalizeGraphPresenceStatus: (value: unknown) => string | null;
  isIdleResearchDue: (value: unknown) => boolean;
  computeIdleResearchNextDueAt: (value: unknown) => string | null;
  normalizeInnovationReflectionState: (
    value: unknown
  ) => InnovationReflectionStateLike;
  serializeInnovationReflectionState: (value: unknown) => Record<string, unknown>;
  readExperimentLedgerEnsured: (projectRoot: string) => Promise<ExperimentLedgerLike>;
  getInnovationReflectionBasis: (ledger: unknown) => InnovationReflectionBasisLike;
  isInnovationReflectionDue: (params: {
    state: unknown;
    ledger: unknown;
  }) => boolean;
  buildExperimentMemoryDigest: (
    ledger: unknown,
    limit: number
  ) => ExperimentMemoryDigestLike[];
  getExperimentLedgerPath: (projectRoot: string) => string;
  mergeExperimentEntries: (
    existing: unknown,
    experiment: Record<string, unknown>,
    metadata: { updatedAt: string; lastUpdatedBy: string | null }
  ) => ExperimentLedgerEntryLike;
  buildExperimentLedgerSummary: (
    experiments: unknown[]
  ) => ExperimentLedgerSummaryLike;
  saveExperimentLedger: (
    projectRoot: string,
    ledger: unknown
  ) => Promise<void>;
  syncManifestExperimentMemory: (params: {
    projectRoot: string;
    ledger: unknown;
  }) => Promise<unknown>;
  normalizeRole: (value: unknown) => string | null;
};

export async function recordCitationVerificationImpl(
  params: {
    projectRoot: string;
    citationVerification: Record<string, unknown>;
  },
  deps: RecorderDeps
): Promise<{
  state: CitationIntegrityStateLike;
  bibliographyResolvedPath: string | null;
  verificationReportResolvedPath: string | null;
}> {
  const manifest = await deps.readManifestEnsured(params.projectRoot);
  const current = deps.normalizeCitationIntegrityState(manifest.citation_integrity);
  const patch = asRecord(params.citationVerification) ?? {};
  const next: CitationIntegrityStateLike = {
    ...current,
    enabled: pickBoolean(patch, ["enabled"]) ?? current.enabled,
    verificationRequired:
      pickBoolean(patch, ["verificationRequired", "verification_required"]) ??
      current.verificationRequired,
    sourceOfTruth:
      patch.sourceOfTruth || patch.source_of_truth
        ? asStringArray(patch.sourceOfTruth ?? patch.source_of_truth)
        : current.sourceOfTruth,
    bibliographyPath:
      pickString(patch, ["bibliographyPath", "bibliography_path"]) ??
      current.bibliographyPath,
    verificationReportPath:
      pickString(patch, ["verificationReportPath", "verification_report_path"]) ??
      current.verificationReportPath,
    verificationStatus:
      normalizeStage(patch.verificationStatus ?? patch.verification_status) ??
      current.verificationStatus,
    bibliographyEntryCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["bibliographyEntryCount", "bibliography_entry_count"]) ??
          current.bibliographyEntryCount
      )
    ),
    bibliographyPageCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["bibliographyPageCount", "bibliography_page_count"]) ??
          current.bibliographyPageCount
      )
    ),
    minimumCitationCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["minimumCitationCount", "minimum_citation_count"]) ??
          current.minimumCitationCount
      )
    ),
    allCitationsReal:
      pickBoolean(patch, ["allCitationsReal", "all_citations_real"]) ??
      current.allCitationsReal,
    allowedPlaceholderCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, [
          "allowedPlaceholderCount",
          "allowed_placeholder_count",
        ]) ?? current.allowedPlaceholderCount
      )
    ),
    unresolvedPlaceholderCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, [
          "unresolvedPlaceholderCount",
          "unresolved_placeholder_count",
        ]) ?? current.unresolvedPlaceholderCount
      )
    ),
    verifiedCitationCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["verifiedCitationCount", "verified_citation_count"]) ??
          current.verifiedCitationCount
      )
    ),
    suspiciousCitationCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, [
          "suspiciousCitationCount",
          "suspicious_citation_count",
        ]) ?? current.suspiciousCitationCount
      )
    ),
    hallucinatedCitationCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, [
          "hallucinatedCitationCount",
          "hallucinated_citation_count",
        ]) ?? current.hallucinatedCitationCount
      )
    ),
    topicRelevanceTopic:
      pickString(patch, ["topicRelevanceTopic", "topic_relevance_topic"]) ??
      current.topicRelevanceTopic,
    topicRelevanceStatus:
      normalizeStage(patch.topicRelevanceStatus ?? patch.topic_relevance_status) ??
      current.topicRelevanceStatus,
    relevantCitationCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["relevantCitationCount", "relevant_citation_count"]) ??
          current.relevantCitationCount
      )
    ),
    offTopicCitationCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, ["offTopicCitationCount", "off_topic_citation_count"]) ??
          current.offTopicCitationCount
      )
    ),
    topicRelevanceSummary:
      pickString(patch, ["topicRelevanceSummary", "topic_relevance_summary"]) ??
      current.topicRelevanceSummary,
    lastVerifiedAt:
      pickString(patch, ["lastVerifiedAt", "last_verified_at"]) ??
      current.lastVerifiedAt,
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
  };

  if (!next.enabled) {
    next.pendingReason = null;
  } else if (next.verificationRequired && next.verificationStatus !== "verified") {
    next.pendingReason =
      next.pendingReason ??
      "Citation verification is still pending. Run the citation integrity gate before submission.";
  } else if (
    next.verificationStatus === "verified" &&
    next.bibliographyEntryCount >= next.minimumCitationCount &&
    next.allCitationsReal &&
    next.bibliographyPageCount >= 1 &&
    next.unresolvedPlaceholderCount <= next.allowedPlaceholderCount &&
    next.hallucinatedCitationCount === 0 &&
    next.topicRelevanceStatus === "ready"
  ) {
    next.pendingReason = null;
  } else if (next.verificationStatus === "verified" && next.bibliographyPageCount < 1) {
    next.pendingReason =
      next.pendingReason ??
      "Reviewer must confirm that the bibliography spans at least one full page before submission.";
  } else if (
    next.verificationStatus === "verified" &&
    next.minimumCitationCount > 0 &&
    next.bibliographyEntryCount < next.minimumCitationCount
  ) {
    next.pendingReason =
      next.pendingReason ??
      `Bibliography does not meet the minimum citation count for this paper mode (${next.bibliographyEntryCount}/${next.minimumCitationCount}).`;
  } else if (next.verificationStatus === "verified" && !next.allCitationsReal) {
    next.pendingReason =
      next.pendingReason ??
      "Reviewer has not yet confirmed that all cited references are real.";
  } else if (
    next.verificationStatus === "verified" &&
    next.topicRelevanceStatus !== "ready"
  ) {
    next.pendingReason =
      next.pendingReason ??
      "Reviewer has not yet confirmed that the bibliography is topically relevant to the manuscript.";
  }

  manifest.citation_integrity = deps.serializeCitationIntegrityState(next);
  await deps.saveManifest(params.projectRoot, manifest);

  return {
    state: next,
    bibliographyResolvedPath: resolveProjectArtifactPath(
      params.projectRoot,
      next.bibliographyPath
    ),
    verificationReportResolvedPath: resolveProjectArtifactPath(
      params.projectRoot,
      next.verificationReportPath
    ),
  };
}

export async function recordIdleResearchRunImpl(
  params: {
    projectRoot: string;
    idleResearchRun: Record<string, unknown>;
  },
  deps: RecorderDeps
): Promise<{
  state: IdleResearchStateLike;
  due: boolean;
  nextDueAt: string | null;
}> {
  const manifest = await deps.readManifestEnsured(params.projectRoot);
  const current = deps.normalizeIdleResearchState(manifest.idle_research);
  const run = asRecord(params.idleResearchRun) ?? {};
  const now = new Date().toISOString();
  const refreshRequired = pickBoolean(run, ["refreshRequired", "refresh_required"]);
  const refreshReason = pickString(run, ["refreshReason", "refresh_reason"]);
  const next: IdleResearchStateLike = {
    ...current,
    status: normalizeStage(run.status) ?? "completed",
    pendingReason:
      pickString(run, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
    nextQueryHint:
      pickString(run, ["nextQueryHint", "next_query_hint"]) ??
      current.nextQueryHint,
    lastRunAt: pickString(run, ["lastRunAt", "last_run_at"]) ?? now,
    lastDigestPath:
      pickString(run, ["lastDigestPath", "last_digest_path"]) ??
      current.lastDigestPath,
    lastSourceUpdateAt:
      pickString(run, ["lastSourceUpdateAt", "last_source_update_at"]) ?? now,
    lastRoundNewCanonicalPapers: Math.max(
      0,
      Math.floor(
        pickNumber(run, [
          "newCanonicalPapers",
          "new_canonical_papers",
          "lastRoundNewCanonicalPapers",
          "last_round_new_canonical_papers",
        ]) ?? current.lastRoundNewCanonicalPapers
      )
    ),
    lastRoundNewCorePapers: Math.max(
      0,
      Math.floor(
        pickNumber(run, [
          "newCorePapers",
          "new_core_papers",
          "lastRoundNewCorePapers",
          "last_round_new_core_papers",
        ]) ?? current.lastRoundNewCorePapers
      )
    ),
  };

  manifest.idle_research = deps.serializeIdleResearchState(next);

  const paperIngestion = asRecord(manifest.paper_ingestion) ?? {};
  const invalidateGraphPresence =
    refreshRequired === true ||
    next.lastRoundNewCanonicalPapers > 0 ||
    next.lastRoundNewCorePapers > 0;
  manifest.paper_ingestion = {
    ...paperIngestion,
    last_ingested_at:
      next.lastSourceUpdateAt ??
      asString(paperIngestion.last_ingested_at) ??
      asString(paperIngestion.lastIngestedAt),
    refresh_required:
      refreshRequired ??
      (next.refreshGraphOnNewCorePapers && next.lastRoundNewCorePapers > 0),
    refresh_reason:
      refreshReason ??
      ((next.refreshGraphOnNewCorePapers && next.lastRoundNewCorePapers > 0)
        ? `idle_research found ${next.lastRoundNewCorePapers} core paper(s) for ${next.topic ?? "the configured topic"}`
        : asString(paperIngestion.refresh_reason) ?? null),
    graph_presence_checked_at: invalidateGraphPresence
      ? null
      : asString(paperIngestion.graph_presence_checked_at) ??
        asString(paperIngestion.graphPresenceCheckedAt),
    graph_presence_status: invalidateGraphPresence
      ? null
      : deps.normalizeGraphPresenceStatus(
          paperIngestion.graph_presence_status ?? paperIngestion.graphPresenceStatus
        ),
    graph_presence_report_path: invalidateGraphPresence
      ? null
      : asString(
          paperIngestion.graph_presence_report_path ?? paperIngestion.graphPresenceReportPath
        ),
    graph_presence_expected_papers: invalidateGraphPresence
      ? null
      : pickNumber(paperIngestion, [
          "graph_presence_expected_papers",
          "graphPresenceExpectedPapers",
        ]),
    graph_presence_present_papers: invalidateGraphPresence
      ? null
      : pickNumber(paperIngestion, [
          "graph_presence_present_papers",
          "graphPresencePresentPapers",
        ]),
    graph_presence_missing_papers: invalidateGraphPresence
      ? []
      : Array.isArray(paperIngestion.graph_presence_missing_papers)
        ? paperIngestion.graph_presence_missing_papers
        : [],
  };

  await deps.saveManifest(params.projectRoot, manifest);

  return {
    state: next,
    due: deps.isIdleResearchDue(next),
    nextDueAt: deps.computeIdleResearchNextDueAt(next),
  };
}

export async function recordInnovationReflectionImpl(
  params: {
    projectRoot: string;
    innovationReflection: Record<string, unknown>;
  },
  deps: RecorderDeps
): Promise<{
  state: InnovationReflectionStateLike;
  due: boolean;
  latestExperimentUpdateAt: string | null;
  experimentIds: string[];
}> {
  const manifest = await deps.readManifestEnsured(params.projectRoot);
  const current = deps.normalizeInnovationReflectionState(manifest.innovation_reflection);
  const ledger = await deps.readExperimentLedgerEnsured(params.projectRoot);
  const basis = deps.getInnovationReflectionBasis(ledger);
  const input = params.innovationReflection;
  const now = new Date().toISOString();

  const reflectedExperimentIds =
    asStringArray(input.reflectedExperimentIds ?? input.reflected_experiment_ids);
  const next: InnovationReflectionStateLike = {
    ...current,
    requiredAfterExperiments:
      pickBoolean(input, ["requiredAfterExperiments", "required_after_experiments"]) ??
      current.requiredAfterExperiments,
    status: normalizeStage(input.status) ?? "fresh",
    lastReflectionAt:
      pickString(input, ["lastReflectionAt", "last_reflection_at"]) ?? now,
    lastReflectionPath:
      pickString(input, [
        "lastReflectionPath",
        "last_reflection_path",
        "reflectionPath",
        "reflection_path",
        "path",
      ]) ?? current.lastReflectionPath,
    reflectedThroughExperimentUpdateAt:
      pickString(input, [
        "reflectedThroughExperimentUpdateAt",
        "reflected_through_experiment_update_at",
      ]) ?? basis.latestExperimentUpdateAt,
    reflectedExperimentIds:
      reflectedExperimentIds.length > 0 ? reflectedExperimentIds : basis.experimentIds,
    pendingReason: pickString(input, ["pendingReason", "pending_reason"]) ?? null,
  };

  manifest.innovation_reflection = deps.serializeInnovationReflectionState(next);
  await deps.saveManifest(params.projectRoot, manifest);

  return {
    state: next,
    due: deps.isInnovationReflectionDue({ state: next, ledger }),
    latestExperimentUpdateAt: basis.latestExperimentUpdateAt,
    experimentIds: basis.experimentIds,
  };
}

export async function getExperimentMemorySummaryImpl(
  params: {
    projectRoot: string;
    limit?: number;
  },
  deps: RecorderDeps
): Promise<{
  ledgerPath: string;
  updatedAt: string;
  summary: ExperimentLedgerSummaryLike;
  recentExperiments: ExperimentMemoryDigestLike[];
}> {
  const ledger = await deps.readExperimentLedgerEnsured(params.projectRoot);
  const recentExperiments = deps.buildExperimentMemoryDigest(
    ledger,
    typeof params.limit === "number" && Number.isFinite(params.limit)
      ? Math.max(1, Math.floor(params.limit))
      : 6
  );
  return {
    ledgerPath: deps.getExperimentLedgerPath(params.projectRoot),
    updatedAt: ledger.updatedAt,
    summary: ledger.summary,
    recentExperiments,
  };
}

export async function upsertExperimentLedgerEntryImpl(
  params: {
    projectRoot: string;
    projectId?: string | null;
    agentId?: string;
    experiment: Record<string, unknown>;
  },
  deps: RecorderDeps
): Promise<{
  entry: ExperimentLedgerEntryLike;
  summary: ExperimentLedgerSummaryLike;
  recentExperiments: ExperimentMemoryDigestLike[];
}> {
  const ledger = await deps.readExperimentLedgerEnsured(params.projectRoot);
  const experimentId =
    pickString(params.experiment, ["experimentId", "experiment_id", "id"]) ?? null;
  if (!experimentId) {
    throw new Error("experiment.experimentId is required for upsert_experiment.");
  }
  const now = new Date().toISOString();
  const existingIndex = ledger.experiments.findIndex(
    (entry) => entry.experimentId === experimentId
  );
  const existing = existingIndex >= 0 ? ledger.experiments[existingIndex] : null;
  const next = deps.mergeExperimentEntries(existing, params.experiment, {
    updatedAt: now,
    lastUpdatedBy: deps.normalizeRole(params.agentId) ?? asString(params.agentId) ?? null,
  });

  if (existingIndex >= 0) {
    ledger.experiments[existingIndex] = next;
  } else {
    ledger.experiments.push(next);
  }

  ledger.projectId = params.projectId ?? ledger.projectId ?? path.basename(params.projectRoot);
  ledger.updatedAt = now;
  ledger.summary = deps.buildExperimentLedgerSummary(ledger.experiments);

  await deps.saveExperimentLedger(params.projectRoot, ledger);
  await deps.syncManifestExperimentMemory({
    projectRoot: params.projectRoot,
    ledger,
  });

  return {
    entry: next,
    summary: ledger.summary,
    recentExperiments: deps.buildExperimentMemoryDigest(ledger, 6),
  };
}
