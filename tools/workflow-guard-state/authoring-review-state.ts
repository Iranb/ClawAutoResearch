import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";

const DEFAULT_CITATION_SOURCE_OF_TRUTH = [
  "paper_main_tex",
  "paper_refs_bib",
  "zotero_packet",
  "citation_candidates",
];
const DEFAULT_CITATION_BIB_PATH = "academic_writer/paper/refs.bib";
const DEFAULT_CITATION_REPORT_PATH = "reviewer/CITATION_VERIFICATION.md";
const DEFAULT_REVIEW_PACKET_PATH = "reviewer/REVIEW_PACKET.json";
const DEFAULT_GRAPH_EVIDENCE_SUMMARY_PATH = "reviewer/GRAPH_EVIDENCE_SUMMARY.md";
const DEFAULT_FUTURE_SCHOLAR_VERIFICATION_SKILL =
  "future/literature-dehallucination";

type CitationIntegrityStateLike = {
  enabled: boolean;
  verificationRequired: boolean;
  sourceOfTruth: string[];
  bibliographyPath: string | null;
  verificationReportPath: string | null;
  verificationStatus: string;
  allowedPlaceholderCount: number;
  unresolvedPlaceholderCount: number;
  verifiedCitationCount: number;
  suspiciousCitationCount: number;
  hallucinatedCitationCount: number;
  lastVerifiedAt: string | null;
  pendingReason: string | null;
};

type WritingSectionPacketStateLike = {
  section: string;
  sectionClass: string | null;
  goal: string | null;
  allowedClaims: string[];
  requiredGraphEvidencePointers: string[];
  forbiddenUnsupportedClaims: string[];
  missingCitationPlaceholders: string[];
  requiredCitationCount: number;
  requiredFigureIds: string[];
  dependentSections: string[];
  stale: boolean;
  packetPath: string | null;
  draftPath: string | null;
  reviewPath: string | null;
  reviewVerdict: string | null;
  status: string;
  updatedAt: string | null;
};

type WritingSessionStateLike = {
  status: string;
  processStatus: string;
  outlineReady: boolean;
  currentSection: string | null;
  draftOrder: string[];
  draftedSections: string[];
  reviewedSections: string[];
  finalizedSections: string[];
  manuscriptComplete: boolean;
  compileSafeSections: string[];
  compileReady: boolean;
  sectionPackets: Record<string, WritingSectionPacketStateLike>;
  nextSuggestedSection: string | null;
  rebuildNeeded: boolean;
  rebuildReason: string | null;
  headlineClaimEvidenceStatus: string;
  graphEvidenceCoverageStatus: string;
  graphEvidenceCoverageSummary: string | null;
  citationPlanMode: string;
  externalScholarQueryMode: string;
  futureScholarVerificationSkill: string | null;
  lastUpdatedAt: string | null;
  pendingReason: string | null;
};

type ReviewSessionRubricLike = {
  originality: number | null;
  quality: number | null;
  clarity: number | null;
  significance: number | null;
  soundness: number | null;
  citationIntegrity: number | null;
  graphGroundedEvidenceSufficiency: number | null;
};

type ReviewSessionStateLike = {
  status: string;
  stageScope: string | null;
  round: number;
  reviewPacketPath: string | null;
  graphEvidenceSummaryPath: string | null;
  latestReviewPath: string | null;
  verdict: string | null;
  rubric: ReviewSessionRubricLike;
  reviewerSummary: string | null;
  actionItems: string[];
  blockingArtifacts: string[];
  lastUpdatedAt: string | null;
  pendingReason: string | null;
};

// ---------------------------------------------------------------------------
// Structured review score records for auto-gate evaluation
// ---------------------------------------------------------------------------

export type ReviewScoreRecord = {
  reviewerId: string;
  stage: string;
  scores: {
    novelty: number;
    technical_soundness: number;
    clarity: number;
    significance: number;
    reproducibility: number;
  };
  average: number;
  minSingle: number;
  recommendation: "advance" | "revise" | "reject";
  timestamp: string;
};

export function normalizeReviewScoreRecord(value: unknown): ReviewScoreRecord | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const reviewerId = typeof rec.reviewerId === "string" ? rec.reviewerId :
    typeof rec.reviewer_id === "string" ? rec.reviewer_id : null;
  const stage = typeof rec.stage === "string" ? rec.stage : null;
  if (!reviewerId || !stage) return null;

  const scoresRaw = (rec.scores ?? rec.dimension_scores ?? {}) as Record<string, unknown>;
  const scores = {
    novelty: typeof scoresRaw.novelty === "number" ? scoresRaw.novelty : 0,
    technical_soundness: typeof scoresRaw.technical_soundness === "number" ? scoresRaw.technical_soundness :
      typeof scoresRaw.technicalSoundness === "number" ? scoresRaw.technicalSoundness : 0,
    clarity: typeof scoresRaw.clarity === "number" ? scoresRaw.clarity : 0,
    significance: typeof scoresRaw.significance === "number" ? scoresRaw.significance : 0,
    reproducibility: typeof scoresRaw.reproducibility === "number" ? scoresRaw.reproducibility : 0,
  };

  const scoreValues = Object.values(scores);
  const average = typeof rec.average === "number" ? rec.average :
    scoreValues.length > 0 ? scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length : 0;
  const minSingle = typeof rec.minSingle === "number" ? rec.minSingle :
    typeof rec.min_single === "number" ? rec.min_single :
    scoreValues.length > 0 ? Math.min(...scoreValues) : 0;

  const recStr = typeof rec.recommendation === "string" ? rec.recommendation.toLowerCase() : "";
  const recommendation: "advance" | "revise" | "reject" =
    recStr === "advance" ? "advance" : recStr === "reject" ? "reject" : "revise";

  return {
    reviewerId,
    stage,
    scores,
    average: Math.round(average * 100) / 100,
    minSingle: Math.round(minSingle * 100) / 100,
    recommendation,
    timestamp: typeof rec.timestamp === "string" ? rec.timestamp : new Date().toISOString(),
  };
}

export function normalizeReviewScoreRecords(value: unknown): ReviewScoreRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeReviewScoreRecord)
    .filter((r): r is ReviewScoreRecord => r !== null);
}

type GraphGuidedWritingStateLike = {
  enabled: boolean;
  status: string;
  anchorIndexPath: string | null;
  frontierFiles: string[];
  literaturePath: string | null;
  claimEvidencePacketPaths: string[];
  requiredEvidencePointerCount: number;
  coveredHeadlineClaimCount: number;
  totalHeadlineClaimCount: number;
  evidenceCoverageStatus: string;
  missingEvidenceClaims: string[];
  citationSourceMode: string;
  scholarQueryReserved: boolean;
  scholarQuerySkillSlot: string | null;
  lastUpdatedAt: string | null;
  pendingReason: string | null;
};

type ExternalReviewStateLike = {
  status: string;
  provider: string | null;
  reviewSkill: string | null;
  sourceLabel: string | null;
  submissionId: string | null;
  submittedPdfPath: string | null;
  externalReviewPath: string | null;
  reviewResponsePath: string | null;
  overallRecommendation: string | null;
  requiredAction: string | null;
  lastPolledAt: string | null;
  lastUpdatedAt: string | null;
  pendingReason: string | null;
};

export function normalizeCitationIntegrityState(
  value: unknown
): CitationIntegrityStateLike {
  const record = asRecord(value) ?? {};
  return {
    enabled: pickBoolean(record, ["enabled"]) ?? true,
    verificationRequired:
      pickBoolean(record, ["verificationRequired", "verification_required"]) ?? true,
    sourceOfTruth:
      asStringArray(record.sourceOfTruth ?? record.source_of_truth).length > 0
        ? asStringArray(record.sourceOfTruth ?? record.source_of_truth)
        : [...DEFAULT_CITATION_SOURCE_OF_TRUTH],
    bibliographyPath:
      pickString(record, ["bibliographyPath", "bibliography_path"]) ??
      DEFAULT_CITATION_BIB_PATH,
    verificationReportPath:
      pickString(record, ["verificationReportPath", "verification_report_path"]) ??
      DEFAULT_CITATION_REPORT_PATH,
    verificationStatus:
      normalizeStage(record.verificationStatus ?? record.verification_status) ?? "pending",
    allowedPlaceholderCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "allowedPlaceholderCount",
          "allowed_placeholder_count",
        ]) ?? 0
      )
    ),
    unresolvedPlaceholderCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "unresolvedPlaceholderCount",
          "unresolved_placeholder_count",
        ]) ?? 0
      )
    ),
    verifiedCitationCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["verifiedCitationCount", "verified_citation_count"]) ?? 0
      )
    ),
    suspiciousCitationCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "suspiciousCitationCount",
          "suspicious_citation_count",
        ]) ?? 0
      )
    ),
    hallucinatedCitationCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "hallucinatedCitationCount",
          "hallucinated_citation_count",
        ]) ?? 0
      )
    ),
    lastVerifiedAt: pickString(record, ["lastVerifiedAt", "last_verified_at"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

export function serializeCitationIntegrityState(
  state: CitationIntegrityStateLike
): Record<string, unknown> {
  return {
    enabled: state.enabled,
    verification_required: state.verificationRequired,
    source_of_truth: state.sourceOfTruth,
    bibliography_path: state.bibliographyPath,
    verification_report_path: state.verificationReportPath,
    verification_status: state.verificationStatus,
    allowed_placeholder_count: state.allowedPlaceholderCount,
    unresolved_placeholder_count: state.unresolvedPlaceholderCount,
    verified_citation_count: state.verifiedCitationCount,
    suspicious_citation_count: state.suspiciousCitationCount,
    hallucinated_citation_count: state.hallucinatedCitationCount,
    last_verified_at: state.lastVerifiedAt,
    pending_reason: state.pendingReason,
  };
}

export function normalizeWritingSectionPacketState(
  key: string,
  value: unknown
): WritingSectionPacketStateLike {
  const record = asRecord(value) ?? {};
  return {
    section: normalizeStage(record.section) ?? normalizeStage(key) ?? key,
    sectionClass:
      normalizeStage(record.sectionClass ?? record.section_class) ?? null,
    goal: pickString(record, ["goal"]),
    allowedClaims: asStringArray(record.allowedClaims ?? record.allowed_claims),
    requiredGraphEvidencePointers: asStringArray(
      record.requiredGraphEvidencePointers ?? record.required_graph_evidence_pointers
    ),
    forbiddenUnsupportedClaims: asStringArray(
      record.forbiddenUnsupportedClaims ?? record.forbidden_unsupported_claims
    ),
    missingCitationPlaceholders: asStringArray(
      record.missingCitationPlaceholders ?? record.missing_citation_placeholders
    ),
    requiredCitationCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, ["requiredCitationCount", "required_citation_count"]) ?? 0
      )
    ),
    requiredFigureIds: asStringArray(
      record.requiredFigureIds ?? record.required_figure_ids
    ),
    dependentSections: asStringArray(
      record.dependentSections ?? record.dependent_sections
    ).map((entry) => normalizeStage(entry) ?? entry),
    stale:
      pickBoolean(record, ["stale"]) ??
      normalizeStage(record.status) === "stale",
    packetPath: pickString(record, ["packetPath", "packet_path"]),
    draftPath: pickString(record, ["draftPath", "draft_path"]),
    reviewPath: pickString(record, ["reviewPath", "review_path"]),
    reviewVerdict:
      pickString(record, ["reviewVerdict", "review_verdict"]) ?? null,
    status: normalizeStage(record.status) ?? "pending",
    updatedAt: pickString(record, ["updatedAt", "updated_at"]),
  };
}

export function serializeWritingSectionPacketState(
  state: WritingSectionPacketStateLike
): Record<string, unknown> {
  return {
    section: state.section,
    section_class: state.sectionClass,
    goal: state.goal,
    allowed_claims: state.allowedClaims,
    required_graph_evidence_pointers: state.requiredGraphEvidencePointers,
    forbidden_unsupported_claims: state.forbiddenUnsupportedClaims,
    missing_citation_placeholders: state.missingCitationPlaceholders,
    required_citation_count: state.requiredCitationCount,
    required_figure_ids: state.requiredFigureIds,
    dependent_sections: state.dependentSections,
    stale: state.stale,
    packet_path: state.packetPath,
    draft_path: state.draftPath,
    review_path: state.reviewPath,
    review_verdict: state.reviewVerdict,
    status: state.status,
    updated_at: state.updatedAt,
  };
}

export function normalizeWritingSessionState(
  value: unknown
): WritingSessionStateLike {
  const record = asRecord(value) ?? {};
  const sectionPacketsRecord =
    asRecord(record.sectionPackets ?? record.section_packets) ?? {};
  const sectionPackets = Object.fromEntries(
    Object.entries(sectionPacketsRecord).map(([key, packet]) => [
      normalizeStage(key) ?? key,
      normalizeWritingSectionPacketState(key, packet),
    ])
  );
  return {
    status: normalizeStage(record.status) ?? "missing",
    processStatus:
      normalizeStage(record.processStatus ?? record.process_status) ?? "missing",
    outlineReady:
      pickBoolean(record, ["outlineReady", "outline_ready"]) ?? false,
    currentSection: normalizeStage(record.currentSection ?? record.current_section),
    draftOrder:
      asStringArray(record.draftOrder ?? record.draft_order)
        .map((entry) => normalizeStage(entry) ?? entry)
        .filter(Boolean),
    draftedSections:
      asStringArray(record.draftedSections ?? record.drafted_sections)
        .map((entry) => normalizeStage(entry) ?? entry)
        .filter(Boolean),
    reviewedSections:
      asStringArray(record.reviewedSections ?? record.reviewed_sections)
        .map((entry) => normalizeStage(entry) ?? entry)
        .filter(Boolean),
    finalizedSections:
      asStringArray(record.finalizedSections ?? record.finalized_sections)
        .map((entry) => normalizeStage(entry) ?? entry)
        .filter(Boolean),
    manuscriptComplete:
      pickBoolean(record, ["manuscriptComplete", "manuscript_complete"]) ?? false,
    compileSafeSections:
      asStringArray(record.compileSafeSections ?? record.compile_safe_sections)
        .map((entry) => normalizeStage(entry) ?? entry)
        .filter(Boolean),
    compileReady:
      pickBoolean(record, ["compileReady", "compile_ready"]) ?? false,
    sectionPackets,
    nextSuggestedSection:
      normalizeStage(
        record.nextSuggestedSection ?? record.next_suggested_section
      ) ?? null,
    rebuildNeeded:
      pickBoolean(record, ["rebuildNeeded", "rebuild_needed"]) ?? false,
    rebuildReason:
      pickString(record, ["rebuildReason", "rebuild_reason"]) ?? null,
    headlineClaimEvidenceStatus:
      normalizeStage(
        record.headlineClaimEvidenceStatus ?? record.headline_claim_evidence_status
      ) ?? "pending",
    graphEvidenceCoverageStatus:
      normalizeStage(
        record.graphEvidenceCoverageStatus ?? record.graph_evidence_coverage_status
      ) ?? "pending",
    graphEvidenceCoverageSummary:
      pickString(record, [
        "graphEvidenceCoverageSummary",
        "graph_evidence_coverage_summary",
      ]) ?? null,
    citationPlanMode:
      normalizeStage(record.citationPlanMode ?? record.citation_plan_mode) ??
      "graph_only",
    externalScholarQueryMode:
      normalizeStage(
        record.externalScholarQueryMode ?? record.external_scholar_query_mode
      ) ?? "reserved",
    futureScholarVerificationSkill:
      pickString(record, [
        "futureScholarVerificationSkill",
        "future_scholar_verification_skill",
      ]) ?? DEFAULT_FUTURE_SCHOLAR_VERIFICATION_SKILL,
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

export function serializeWritingSessionState(
  state: WritingSessionStateLike
): Record<string, unknown> {
  return {
    status: state.status,
    process_status: state.processStatus,
    outline_ready: state.outlineReady,
    current_section: state.currentSection,
    draft_order: state.draftOrder,
    drafted_sections: state.draftedSections,
    reviewed_sections: state.reviewedSections,
    finalized_sections: state.finalizedSections,
    manuscript_complete: state.manuscriptComplete,
    compile_safe_sections: state.compileSafeSections,
    compile_ready: state.compileReady,
    section_packets: Object.fromEntries(
      Object.entries(state.sectionPackets).map(([key, packet]) => [
        key,
        serializeWritingSectionPacketState(packet),
      ])
    ),
    next_suggested_section: state.nextSuggestedSection,
    rebuild_needed: state.rebuildNeeded,
    rebuild_reason: state.rebuildReason,
    headline_claim_evidence_status: state.headlineClaimEvidenceStatus,
    graph_evidence_coverage_status: state.graphEvidenceCoverageStatus,
    graph_evidence_coverage_summary: state.graphEvidenceCoverageSummary,
    citation_plan_mode: state.citationPlanMode,
    external_scholar_query_mode: state.externalScholarQueryMode,
    future_scholar_verification_skill: state.futureScholarVerificationSkill,
    last_updated_at: state.lastUpdatedAt,
    pending_reason: state.pendingReason,
  };
}

export function normalizeReviewSessionRubric(
  value: unknown
): ReviewSessionRubricLike {
  const record = asRecord(value) ?? {};
  return {
    originality: pickNumber(record, ["originality"]),
    quality: pickNumber(record, ["quality"]),
    clarity: pickNumber(record, ["clarity"]),
    significance: pickNumber(record, ["significance"]),
    soundness: pickNumber(record, ["soundness"]),
    citationIntegrity: pickNumber(record, [
      "citationIntegrity",
      "citation_integrity",
    ]),
    graphGroundedEvidenceSufficiency: pickNumber(record, [
      "graphGroundedEvidenceSufficiency",
      "graph_grounded_evidence_sufficiency",
    ]),
  };
}

export function serializeReviewSessionRubric(
  rubric: ReviewSessionRubricLike
): Record<string, unknown> {
  return {
    originality: rubric.originality,
    quality: rubric.quality,
    clarity: rubric.clarity,
    significance: rubric.significance,
    soundness: rubric.soundness,
    citation_integrity: rubric.citationIntegrity,
    graph_grounded_evidence_sufficiency:
      rubric.graphGroundedEvidenceSufficiency,
  };
}

export function normalizeReviewSessionState(
  value: unknown
): ReviewSessionStateLike {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    stageScope: normalizeStage(record.stageScope ?? record.stage_scope),
    round: Math.max(0, Math.floor(pickNumber(record, ["round"]) ?? 0)),
    reviewPacketPath:
      pickString(record, ["reviewPacketPath", "review_packet_path"]) ??
      DEFAULT_REVIEW_PACKET_PATH,
    graphEvidenceSummaryPath:
      pickString(record, [
        "graphEvidenceSummaryPath",
        "graph_evidence_summary_path",
      ]) ?? DEFAULT_GRAPH_EVIDENCE_SUMMARY_PATH,
    latestReviewPath:
      pickString(record, ["latestReviewPath", "latest_review_path"]) ??
      "reviewer/REVIEW_REPORT.md",
    verdict: pickString(record, ["verdict"]) ?? null,
    rubric: normalizeReviewSessionRubric(record.rubric),
    reviewerSummary:
      pickString(record, ["reviewerSummary", "reviewer_summary"]) ?? null,
    actionItems: asStringArray(record.actionItems ?? record.action_items),
    blockingArtifacts: asStringArray(
      record.blockingArtifacts ?? record.blocking_artifacts
    ),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

export function serializeReviewSessionState(
  state: ReviewSessionStateLike
): Record<string, unknown> {
  return {
    status: state.status,
    stage_scope: state.stageScope,
    round: state.round,
    review_packet_path: state.reviewPacketPath,
    graph_evidence_summary_path: state.graphEvidenceSummaryPath,
    latest_review_path: state.latestReviewPath,
    verdict: state.verdict,
    rubric: serializeReviewSessionRubric(state.rubric),
    reviewer_summary: state.reviewerSummary,
    action_items: state.actionItems,
    blocking_artifacts: state.blockingArtifacts,
    last_updated_at: state.lastUpdatedAt,
    pending_reason: state.pendingReason,
  };
}

export function normalizeGraphGuidedWritingState(
  value: unknown
): GraphGuidedWritingStateLike {
  const record = asRecord(value) ?? {};
  const hasConfig = Object.keys(record).length > 0;
  return {
    enabled: pickBoolean(record, ["enabled"]) ?? hasConfig,
    status: normalizeStage(record.status) ?? "missing",
    anchorIndexPath:
      pickString(record, ["anchorIndexPath", "anchor_index_path"]) ??
      "graph/ANCHOR_INDEX.md",
    frontierFiles: asStringArray(record.frontierFiles ?? record.frontier_files),
    literaturePath:
      pickString(record, ["literaturePath", "literature_path"]) ??
      "researcher/LITERATURE.md",
    claimEvidencePacketPaths: asStringArray(
      record.claimEvidencePacketPaths ?? record.claim_evidence_packet_paths
    ),
    requiredEvidencePointerCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "requiredEvidencePointerCount",
          "required_evidence_pointer_count",
        ]) ?? 0
      )
    ),
    coveredHeadlineClaimCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "coveredHeadlineClaimCount",
          "covered_headline_claim_count",
        ]) ?? 0
      )
    ),
    totalHeadlineClaimCount: Math.max(
      0,
      Math.floor(
        pickNumber(record, [
          "totalHeadlineClaimCount",
          "total_headline_claim_count",
        ]) ?? 0
      )
    ),
    evidenceCoverageStatus:
      normalizeStage(
        record.evidenceCoverageStatus ?? record.evidence_coverage_status
      ) ?? "pending",
    missingEvidenceClaims: asStringArray(
      record.missingEvidenceClaims ?? record.missing_evidence_claims
    ),
    citationSourceMode:
      normalizeStage(record.citationSourceMode ?? record.citation_source_mode) ??
      "graph_only",
    scholarQueryReserved:
      pickBoolean(record, ["scholarQueryReserved", "scholar_query_reserved"]) ??
      true,
    scholarQuerySkillSlot:
      pickString(record, ["scholarQuerySkillSlot", "scholar_query_skill_slot"]) ??
      DEFAULT_FUTURE_SCHOLAR_VERIFICATION_SKILL,
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

export function serializeGraphGuidedWritingState(
  state: GraphGuidedWritingStateLike
): Record<string, unknown> {
  return {
    enabled: state.enabled,
    status: state.status,
    anchor_index_path: state.anchorIndexPath,
    frontier_files: state.frontierFiles,
    literature_path: state.literaturePath,
    claim_evidence_packet_paths: state.claimEvidencePacketPaths,
    required_evidence_pointer_count: state.requiredEvidencePointerCount,
    covered_headline_claim_count: state.coveredHeadlineClaimCount,
    total_headline_claim_count: state.totalHeadlineClaimCount,
    evidence_coverage_status: state.evidenceCoverageStatus,
    missing_evidence_claims: state.missingEvidenceClaims,
    citation_source_mode: state.citationSourceMode,
    scholar_query_reserved: state.scholarQueryReserved,
    scholar_query_skill_slot: state.scholarQuerySkillSlot,
    last_updated_at: state.lastUpdatedAt,
    pending_reason: state.pendingReason,
  };
}

export function normalizeExternalReviewState(
  value: unknown
): ExternalReviewStateLike {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    provider: pickString(record, ["provider"]),
    reviewSkill:
      pickString(record, ["reviewSkill", "review_skill"]) ??
      "paperreview-submit",
    sourceLabel:
      pickString(record, ["sourceLabel", "source_label"]) ??
      "Stanford Agentic Reviewer",
    submissionId: pickString(record, ["submissionId", "submission_id"]),
    submittedPdfPath: pickString(record, [
      "submittedPdfPath",
      "submitted_pdf_path",
    ]),
    externalReviewPath: pickString(record, [
      "externalReviewPath",
      "external_review_path",
    ]),
    reviewResponsePath: pickString(record, [
      "reviewResponsePath",
      "review_response_path",
    ]),
    overallRecommendation: pickString(record, [
      "overallRecommendation",
      "overall_recommendation",
    ]),
    requiredAction: pickString(record, ["requiredAction", "required_action"]),
    lastPolledAt: pickString(record, ["lastPolledAt", "last_polled_at"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

export function serializeExternalReviewState(
  state: ExternalReviewStateLike
): Record<string, unknown> {
  return {
    status: state.status,
    provider: state.provider,
    review_skill: state.reviewSkill,
    source_label: state.sourceLabel,
    submission_id: state.submissionId,
    submitted_pdf_path: state.submittedPdfPath,
    external_review_path: state.externalReviewPath,
    review_response_path: state.reviewResponsePath,
    overall_recommendation: state.overallRecommendation,
    required_action: state.requiredAction,
    last_polled_at: state.lastPolledAt,
    last_updated_at: state.lastUpdatedAt,
    pending_reason: state.pendingReason,
  };
}
