import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";

export type InnovationSynthesisPointState = {
  id: string;
  claim: string | null;
  roleInStory: string | null;
  evidenceIds: string[];
  requiredForThesis: boolean;
  failureIfRemoved: string | null;
  supportStatus: string;
};

export type InnovationSynthesisState = {
  status: string;
  centralThesis: string | null;
  integrationPattern: string | null;
  innovationPoints: InnovationSynthesisPointState[];
  unifiedMechanism: string | null;
  storyDependencyGraphPath: string | null;
  synthesisMemoPath: string | null;
  integratedContributionStatementPath: string | null;
  figure1StoryRole: string | null;
  resultsOrderRationale: string | null;
  searchGapCount: number;
  searchRequisitionPath: string | null;
  synthesisFingerprint: string | null;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

export type StoryGapSearchQuestionState = {
  questionId: string;
  domainSpecificQuestion: string | null;
  domainAgnosticQuestion: string | null;
  coverageStatus: string;
  preferredSourceDomains: string[];
  candidateSourceDomains: string[];
  excludedAdjacentDomains: string[];
  validationSampleSizeDefault: number;
  pruneIfIrrelevantRatioExceedsDefault: number;
  minimumRelevantHits: number;
  nicheTopicOverrideAllowed: boolean;
  minimumSources: number;
};

export type StoryGapSearchRequisitionState = {
  status: string;
  originStage: string | null;
  triggerReason: string | null;
  executionMode: string | null;
  mapsToLiteratureDiscoveryRequestId: string | null;
  requisitionFingerprint: string | null;
  linkedSynthesisFingerprint: string | null;
  sameGapCycleBudget: number;
  sameGapCyclesUsed: number;
  targetQuestions: StoryGapSearchQuestionState[];
  requiredStageReentry: string[];
  packetPath: string | null;
  batchManifestPath: string | null;
  saturationReason: string | null;
  lastUpdatedAt: string | null;
};

export const DEFAULT_INNOVATION_SYNTHESIS_MEMO_PATH =
  "academic_writer/INNOVATION_SYNTHESIS_MEMO.md";
export const DEFAULT_INNOVATION_SYNTHESIS_GRAPH_PATH =
  "academic_writer/INNOVATION_SYNTHESIS_GRAPH.json";
export const DEFAULT_INTEGRATED_CONTRIBUTION_STATEMENT_PATH =
  "academic_writer/INTEGRATED_CONTRIBUTION_STATEMENT.md";
export const DEFAULT_STORY_GAP_SEARCH_PACKET_PATH =
  "researcher/story-gap-search/STORY_GAP_SEARCH_REQUISITION.json";
export const DEFAULT_STORY_GAP_SEARCH_BATCH_MANIFEST_PATH =
  "researcher/story-gap-search/batch-import.json";

function normalizeInnovationPoint(
  value: unknown,
  fallbackIndex: number
): InnovationSynthesisPointState | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const id =
    pickString(record, ["id", "pointId", "point_id"]) ??
    `innovation-${fallbackIndex + 1}`;
  return {
    id,
    claim: pickString(record, ["claim"]),
    roleInStory: pickString(record, ["roleInStory", "role_in_story"]),
    evidenceIds: asStringArray(record.evidenceIds ?? record.evidence_ids),
    requiredForThesis:
      pickBoolean(record, ["requiredForThesis", "required_for_thesis"]) ?? true,
    failureIfRemoved: pickString(record, ["failureIfRemoved", "failure_if_removed"]),
    supportStatus: normalizeStage(record.supportStatus ?? record.support_status) ?? "missing",
  };
}

function serializeInnovationPoint(value: InnovationSynthesisPointState): Record<string, unknown> {
  return {
    id: value.id,
    claim: value.claim,
    role_in_story: value.roleInStory,
    evidence_ids: value.evidenceIds,
    required_for_thesis: value.requiredForThesis,
    failure_if_removed: value.failureIfRemoved,
    support_status: value.supportStatus,
  };
}

function normalizeSearchQuestion(
  value: unknown,
  fallbackIndex: number
): StoryGapSearchQuestionState | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return {
    questionId:
      pickString(record, ["questionId", "question_id"]) ?? `q${fallbackIndex + 1}`,
    domainSpecificQuestion: pickString(record, [
      "domainSpecificQuestion",
      "domain_specific_question",
    ]),
    domainAgnosticQuestion: pickString(record, [
      "domainAgnosticQuestion",
      "domain_agnostic_question",
    ]),
    coverageStatus:
      normalizeStage(record.coverageStatus ?? record.coverage_status) ?? "unexplored",
    preferredSourceDomains: asStringArray(
      record.preferredSourceDomains ?? record.preferred_source_domains
    ),
    candidateSourceDomains: asStringArray(
      record.candidateSourceDomains ?? record.candidate_source_domains
    ),
    excludedAdjacentDomains: asStringArray(
      record.excludedAdjacentDomains ?? record.excluded_adjacent_domains
    ),
    validationSampleSizeDefault: Math.max(
      1,
      Math.floor(
        pickNumber(record, [
          "validationSampleSizeDefault",
          "validation_sample_size_default",
        ]) ?? 20
      )
    ),
    pruneIfIrrelevantRatioExceedsDefault: Math.max(
      0,
      Math.min(
        1,
        pickNumber(record, [
          "pruneIfIrrelevantRatioExceedsDefault",
          "prune_if_irrelevant_ratio_exceeds_default",
        ]) ?? 0.5
      )
    ),
    minimumRelevantHits: Math.max(
      1,
      Math.floor(
        pickNumber(record, ["minimumRelevantHits", "minimum_relevant_hits"]) ?? 5
      )
    ),
    nicheTopicOverrideAllowed:
      pickBoolean(record, ["nicheTopicOverrideAllowed", "niche_topic_override_allowed"]) ??
      true,
    minimumSources: Math.max(
      1,
      Math.floor(pickNumber(record, ["minimumSources", "minimum_sources"]) ?? 2)
    ),
  };
}

function serializeSearchQuestion(value: StoryGapSearchQuestionState): Record<string, unknown> {
  return {
    question_id: value.questionId,
    domain_specific_question: value.domainSpecificQuestion,
    domain_agnostic_question: value.domainAgnosticQuestion,
    coverage_status: value.coverageStatus,
    preferred_source_domains: value.preferredSourceDomains,
    candidate_source_domains: value.candidateSourceDomains,
    excluded_adjacent_domains: value.excludedAdjacentDomains,
    validation_sample_size_default: value.validationSampleSizeDefault,
    prune_if_irrelevant_ratio_exceeds_default:
      value.pruneIfIrrelevantRatioExceedsDefault,
    minimum_relevant_hits: value.minimumRelevantHits,
    niche_topic_override_allowed: value.nicheTopicOverrideAllowed,
    minimum_sources: value.minimumSources,
  };
}

export function normalizeInnovationSynthesisState(value: unknown): InnovationSynthesisState {
  const record = asRecord(value) ?? {};
  const innovationPointsRaw = Array.isArray(record.innovationPoints ?? record.innovation_points)
    ? ((record.innovationPoints ?? record.innovation_points) as unknown[])
    : [];
  return {
    status: normalizeStage(record.status) ?? "missing",
    centralThesis: pickString(record, ["centralThesis", "central_thesis"]),
    integrationPattern:
      normalizeStage(record.integrationPattern ?? record.integration_pattern) ?? null,
    innovationPoints: innovationPointsRaw
      .map((entry, index) => normalizeInnovationPoint(entry, index))
      .filter((entry): entry is InnovationSynthesisPointState => Boolean(entry)),
    unifiedMechanism: pickString(record, ["unifiedMechanism", "unified_mechanism"]),
    storyDependencyGraphPath: pickString(record, [
      "storyDependencyGraphPath",
      "story_dependency_graph_path",
    ]) ?? DEFAULT_INNOVATION_SYNTHESIS_GRAPH_PATH,
    synthesisMemoPath: pickString(record, [
      "synthesisMemoPath",
      "synthesis_memo_path",
    ]) ?? DEFAULT_INNOVATION_SYNTHESIS_MEMO_PATH,
    integratedContributionStatementPath: pickString(record, [
      "integratedContributionStatementPath",
      "integrated_contribution_statement_path",
    ]) ?? DEFAULT_INTEGRATED_CONTRIBUTION_STATEMENT_PATH,
    figure1StoryRole: pickString(record, ["figure1StoryRole", "figure_1_story_role"]),
    resultsOrderRationale: pickString(record, [
      "resultsOrderRationale",
      "results_order_rationale",
    ]),
    searchGapCount: Math.max(
      0,
      Math.floor(pickNumber(record, ["searchGapCount", "search_gap_count"]) ?? 0)
    ),
    searchRequisitionPath: pickString(record, [
      "searchRequisitionPath",
      "search_requisition_path",
    ]) ?? DEFAULT_STORY_GAP_SEARCH_PACKET_PATH,
    synthesisFingerprint: pickString(record, [
      "synthesisFingerprint",
      "synthesis_fingerprint",
    ]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

export function serializeInnovationSynthesisState(
  value: InnovationSynthesisState
): Record<string, unknown> {
  return {
    status: value.status,
    central_thesis: value.centralThesis,
    integration_pattern: value.integrationPattern,
    innovation_points: value.innovationPoints.map((entry) =>
      serializeInnovationPoint(entry)
    ),
    unified_mechanism: value.unifiedMechanism,
    story_dependency_graph_path: value.storyDependencyGraphPath,
    synthesis_memo_path: value.synthesisMemoPath,
    integrated_contribution_statement_path: value.integratedContributionStatementPath,
    figure_1_story_role: value.figure1StoryRole,
    results_order_rationale: value.resultsOrderRationale,
    search_gap_count: value.searchGapCount,
    search_requisition_path: value.searchRequisitionPath,
    synthesis_fingerprint: value.synthesisFingerprint,
    pending_reason: value.pendingReason,
    last_updated_at: value.lastUpdatedAt,
  };
}

export function normalizeStoryGapSearchRequisitionState(
  value: unknown
): StoryGapSearchRequisitionState {
  const record = asRecord(value) ?? {};
  const targetQuestionsRaw = Array.isArray(record.targetQuestions ?? record.target_questions)
    ? ((record.targetQuestions ?? record.target_questions) as unknown[])
    : [];
  return {
    status: normalizeStage(record.status) ?? "missing",
    originStage: normalizeStage(record.originStage ?? record.origin_stage),
    triggerReason: pickString(record, ["triggerReason", "trigger_reason"]),
    executionMode:
      normalizeStage(record.executionMode ?? record.execution_mode) ?? null,
    mapsToLiteratureDiscoveryRequestId: pickString(record, [
      "mapsToLiteratureDiscoveryRequestId",
      "maps_to_literature_discovery_request_id",
    ]),
    requisitionFingerprint: pickString(record, [
      "requisitionFingerprint",
      "requisition_fingerprint",
    ]),
    linkedSynthesisFingerprint: pickString(record, [
      "linkedSynthesisFingerprint",
      "linked_synthesis_fingerprint",
    ]),
    sameGapCycleBudget: Math.max(
      0,
      Math.floor(pickNumber(record, ["sameGapCycleBudget", "same_gap_cycle_budget"]) ?? 2)
    ),
    sameGapCyclesUsed: Math.max(
      0,
      Math.floor(pickNumber(record, ["sameGapCyclesUsed", "same_gap_cycles_used"]) ?? 0)
    ),
    targetQuestions: targetQuestionsRaw
      .map((entry, index) => normalizeSearchQuestion(entry, index))
      .filter((entry): entry is StoryGapSearchQuestionState => Boolean(entry)),
    requiredStageReentry: asStringArray(
      record.requiredStageReentry ?? record.required_stage_reentry
    ),
    packetPath: pickString(record, ["packetPath", "packet_path"]) ??
      DEFAULT_STORY_GAP_SEARCH_PACKET_PATH,
    batchManifestPath: pickString(record, [
      "batchManifestPath",
      "batch_manifest_path",
    ]) ?? DEFAULT_STORY_GAP_SEARCH_BATCH_MANIFEST_PATH,
    saturationReason: pickString(record, ["saturationReason", "saturation_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

export function serializeStoryGapSearchRequisitionState(
  value: StoryGapSearchRequisitionState
): Record<string, unknown> {
  return {
    status: value.status,
    origin_stage: value.originStage,
    trigger_reason: value.triggerReason,
    execution_mode: value.executionMode,
    maps_to_literature_discovery_request_id: value.mapsToLiteratureDiscoveryRequestId,
    requisition_fingerprint: value.requisitionFingerprint,
    linked_synthesis_fingerprint: value.linkedSynthesisFingerprint,
    same_gap_cycle_budget: value.sameGapCycleBudget,
    same_gap_cycles_used: value.sameGapCyclesUsed,
    target_questions: value.targetQuestions.map((entry) => serializeSearchQuestion(entry)),
    required_stage_reentry: value.requiredStageReentry,
    packet_path: value.packetPath,
    batch_manifest_path: value.batchManifestPath,
    saturation_reason: value.saturationReason,
    last_updated_at: value.lastUpdatedAt,
  };
}
