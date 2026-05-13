import type { SufficiencyJudgment } from "./llm-sufficiency";

type ScoutingDomain = {
  domain?: string | null;
  pruned?: boolean | null;
  retrieved_nodes?: unknown[] | null;
  takeaways?: unknown[] | null;
  bridge_path_ids?: string[] | null;
  source_spans?: unknown[] | null;
  source_span_count?: number | null;
  evidence_chain_refs?: unknown[] | null;
  evidenceChainRefs?: unknown[] | null;
  evidence_refs?: unknown[] | null;
  evidenceRefs?: unknown[] | null;
  supporting_evidence_refs?: unknown[] | null;
  supportingEvidenceRefs?: unknown[] | null;
  evidence_pointers?: unknown[] | null;
  evidencePointers?: unknown[] | null;
  graph_evidence_pointers?: unknown[] | null;
  graphEvidencePointers?: unknown[] | null;
  linked_graph_nodes?: unknown[] | null;
  linkedGraphNodes?: unknown[] | null;
  path_trace?: unknown[] | null;
  pathTrace?: unknown[] | null;
  path_completeness?: number | null;
  evidence_density?: number | null;
  mechanism_support_density?: number | null;
  evidence_tier?: string | null;
  claim_cap?: string | null;
  relevance_ratio?: number | null;
  bridge_quality?: number | null;
  search_queries?: Array<{
    domain?: string | null;
    query?: string | null;
    rationale?: string | null;
  }> | null;
};

type ScoutingReportLike = {
  target_domain?: string | null;
  challenge_clusters?: string[] | null;
  candidate_domains?: ScoutingDomain[] | null;
  bridge_nodes?: Array<{ domain?: string | null }> | null;
  evidence_summary?: {
    source_span_count?: number | null;
    bridge_path_count?: number | null;
    evidence_chain_ref_count?: number | null;
    evidence_ref_count?: number | null;
    graph_evidence_pointer_count?: number | null;
    max_path_completeness?: number | null;
    max_evidence_density?: number | null;
    max_mechanism_support_density?: number | null;
  } | null;
};

type DecompositionQuestion = {
  question_id?: string | null;
  domain_specific_question?: string | null;
  coverage_status?: string | null;
};

type DecompositionPacketLike = {
  questions?: DecompositionQuestion[] | null;
};

function countEvidence(entry: ScoutingDomain, scoutingReport: ScoutingReportLike): number {
  const retrievedCount = Array.isArray(entry?.retrieved_nodes)
    ? entry.retrieved_nodes.length
    : 0;
  const takeawayCount = Array.isArray(entry?.takeaways) ? entry.takeaways.length : 0;
  const bridgePathCount = Array.isArray(entry?.bridge_path_ids)
    ? entry.bridge_path_ids.length
    : 0;
  const sourceSpanCount = countSourceSpans(entry);
  const bridgeCount = Array.isArray(scoutingReport.bridge_nodes)
    ? scoutingReport.bridge_nodes.filter(
        (node) => String(node?.domain ?? "").trim() === String(entry?.domain ?? "").trim()
      ).length
    : 0;
  return Math.max(retrievedCount, takeawayCount, bridgePathCount, sourceSpanCount, bridgeCount);
}

function normalizeScore(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Number(Math.max(0, Math.min(1, numeric)).toFixed(4));
}

function objectCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function countTakeawayField(entry: ScoutingDomain, field: string): number {
  if (!Array.isArray(entry.takeaways)) {
    return 0;
  }
  return entry.takeaways.reduce<number>((sum, takeaway) => {
    const record = takeaway && typeof takeaway === "object"
      ? (takeaway as Record<string, unknown>)
      : {};
    return sum + objectCount(record[field]);
  }, 0);
}

function countTakeawayFields(entry: ScoutingDomain, fields: string[]): number {
  if (!Array.isArray(entry.takeaways)) {
    return 0;
  }
  return entry.takeaways.reduce<number>((sum, takeaway) => {
    const record = takeaway && typeof takeaway === "object"
      ? (takeaway as Record<string, unknown>)
      : {};
    return sum + Math.max(...fields.map((field) => objectCount(record[field])), 0);
  }, 0);
}

function countSourceSpans(entry: ScoutingDomain): number {
  return Math.max(
    Math.floor(Number(entry.source_span_count ?? 0)),
    objectCount(entry.source_spans),
    countTakeawayField(entry, "source_spans")
  );
}

const EVIDENCE_REF_FIELDS = [
  "evidence_chain_refs",
  "evidenceChainRefs",
  "evidence_refs",
  "evidenceRefs",
  "supporting_evidence_refs",
  "supportingEvidenceRefs",
];

const GRAPH_EVIDENCE_POINTER_FIELDS = [
  "evidence_pointers",
  "evidencePointers",
  "graph_evidence_pointers",
  "graphEvidencePointers",
  "linked_graph_nodes",
  "linkedGraphNodes",
  "path_trace",
  "pathTrace",
];

const SOURCE_SPAN_POINTER_FIELDS = [
  "span_id",
  "spanId",
  "snippet_node_id",
  "snippetNodeId",
  "source_node_id",
  "sourceNodeId",
  "evidence_node_id",
  "evidenceNodeId",
  "paper_id",
  "paperId",
  "node_id",
  "nodeId",
];

function countRecordArrayFields(
  record: Record<string, unknown>,
  fields: string[]
): number {
  return fields.reduce((sum, field) => sum + objectCount(record[field]), 0);
}

function countSourceSpanPointers(value: unknown): number {
  if (!Array.isArray(value)) {
    return 0;
  }
  return value.filter((span) => {
    if (!span || typeof span !== "object") {
      return false;
    }
    const record = span as Record<string, unknown>;
    return SOURCE_SPAN_POINTER_FIELDS.some((field) =>
      String(record[field] ?? "").trim()
    );
  }).length;
}

function countTakeawaySourceSpanPointers(entry: ScoutingDomain): number {
  if (!Array.isArray(entry.takeaways)) {
    return 0;
  }
  return entry.takeaways.reduce<number>((sum, takeaway) => {
    const record = takeaway && typeof takeaway === "object"
      ? (takeaway as Record<string, unknown>)
      : {};
    return sum + countSourceSpanPointers(record.source_spans ?? record.sourceSpans);
  }, 0);
}

function countEvidenceRefs(entry: ScoutingDomain): number {
  const record = entry as Record<string, unknown>;
  return (
    countRecordArrayFields(record, EVIDENCE_REF_FIELDS) +
    countTakeawayFields(entry, EVIDENCE_REF_FIELDS)
  );
}

function countGraphEvidencePointers(entry: ScoutingDomain): number {
  const record = entry as Record<string, unknown>;
  return (
    countRecordArrayFields(record, GRAPH_EVIDENCE_POINTER_FIELDS) +
    countTakeawayFields(entry, GRAPH_EVIDENCE_POINTER_FIELDS) +
    countSourceSpanPointers(entry.source_spans) +
    countTakeawaySourceSpanPointers(entry)
  );
}

function domainEvidenceMetrics(entry: ScoutingDomain, scoutingReport: ScoutingReportLike) {
  const bridgePathCount = Math.max(
    objectCount(entry.bridge_path_ids),
    countTakeawayField(entry, "bridge_path_ids")
  );
  const sourceSpanCount = countSourceSpans(entry);
  const evidenceRefCount = countEvidenceRefs(entry);
  const graphEvidencePointerCount = countGraphEvidencePointers(entry);
  const evidenceGroundingCount = evidenceRefCount + graphEvidencePointerCount;
  const pathCompleteness = Math.max(
    normalizeScore(entry.path_completeness),
    bridgePathCount > 0 ? 0.5 : 0
  );
  const evidenceDensity = Math.max(
    normalizeScore(entry.evidence_density),
    sourceSpanCount > 0 ? 0.5 : 0
  );
  const mechanismSupportDensity = Math.max(
    normalizeScore(entry.mechanism_support_density),
    objectCount(entry.takeaways) > 0 ? 0.5 : 0
  );
  const evidenceTier =
    String(entry.evidence_tier ?? "").trim() ||
    (bridgePathCount > 0 && sourceSpanCount > 0 && pathCompleteness >= 0.75
      ? "strong"
      : bridgePathCount > 0 && sourceSpanCount > 0
        ? "moderate"
        : "weak");
  const claimCap =
    String(entry.claim_cap ?? "").trim() ||
    (evidenceTier === "strong" ? "confirmatory" : evidenceTier === "moderate" ? "exploratory" : "hypothesis");
  return {
    evidenceCount: countEvidence(entry, scoutingReport),
    bridgePathCount,
    sourceSpanCount,
    evidenceRefCount,
    graphEvidencePointerCount,
    evidenceGroundingCount,
    pathCompleteness,
    evidenceDensity,
    mechanismSupportDensity,
    evidenceTier,
    claimCap,
    evidenceChainSufficient:
      bridgePathCount > 0 &&
      sourceSpanCount > 0 &&
      evidenceGroundingCount > 0 &&
      pathCompleteness >= 0.5 &&
      evidenceDensity > 0 &&
      evidenceTier !== "weak",
  };
}

function collectMissingEvidenceTypes(params: {
  candidateDomains: ScoutingDomain[];
  totalSourceSpanCount: number;
  totalBridgePathCount: number;
  totalEvidenceGroundingCount: number;
  bridgeNodeCount: number;
  maxPathCompleteness: number;
  maxEvidenceDensity: number;
  maxMechanismSupportDensity: number;
}) {
  const missing = new Set<string>();
  if (params.candidateDomains.length === 0) {
    missing.add("domain_coverage");
  }
  if (params.totalBridgePathCount === 0) {
    missing.add("bridge_path");
  }
  if (params.totalSourceSpanCount === 0) {
    missing.add("source_span");
  }
  if (params.totalEvidenceGroundingCount === 0) {
    missing.add("evidence_chain_ref_or_graph_pointer");
  }
  if (params.maxPathCompleteness < 0.5) {
    missing.add("path_completeness");
  }
  if (params.maxEvidenceDensity <= 0) {
    missing.add("evidence_density");
  }
  if (params.maxMechanismSupportDensity <= 0) {
    missing.add("mechanism_support");
  }
  return [...missing].sort();
}

function sanitizeQuestionGaps(decompositionPacket: DecompositionPacketLike) {
  const questions = Array.isArray(decompositionPacket.questions)
    ? decompositionPacket.questions
    : [];
  return questions
    .map((entry, index) => ({
      question_id: String(entry?.question_id ?? `q${index + 1}`),
      question: String(entry?.domain_specific_question ?? "").trim(),
      coverage_status: String(entry?.coverage_status ?? "partial").trim() || "partial",
    }))
    .filter((entry) => entry.question)
    .filter((entry) => entry.coverage_status !== "resolved");
}

function normalizeTopicContext(value: string | string[] | null | undefined): string | null {
  const pieces = Array.isArray(value) ? value : [value];
  const normalized = pieces
    .map((entry) => String(entry ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (normalized.length === 0) {
    return null;
  }
  return normalized.join("; ").slice(0, 260);
}

function addTopicContextToQuery(query: string, topicContext: string | null): string {
  const normalizedQuery = String(query ?? "").replace(/\s+/g, " ").trim();
  if (!topicContext) {
    return normalizedQuery;
  }
  const contextTokens = topicContext
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4)
    .slice(0, 5);
  const lowerQuery = normalizedQuery.toLowerCase();
  if (contextTokens.length > 0 && contextTokens.every((token) => lowerQuery.includes(token))) {
    return normalizedQuery;
  }
  return `${topicContext} ${normalizedQuery}`.trim().slice(0, 420);
}

function buildFallbackQueries(params: {
  missingDomains: string[];
  questionGaps: Array<{ question_id: string; question: string }>;
  topicContext?: string | null;
}) {
  const queries: Array<{ domain: string; query: string; rationale: string }> = [];
  for (const domain of params.missingDomains) {
    for (const gap of params.questionGaps.slice(0, 3)) {
      const query = `${domain} ${gap.question} transferable principle`.trim();
      queries.push({
        domain,
        query: addTopicContextToQuery(query, params.topicContext ?? null),
        rationale: `Acquire domain evidence for ${gap.question_id}.`,
      });
    }
  }
  return queries;
}

export function buildIdeaCatalystGateDecision(
  scoutingReport: ScoutingReportLike,
  decompositionPacket: DecompositionPacketLike = {},
  options?: {
    llmJudgment?: SufficiencyJudgment | null;
    topicContext?: string | string[] | null;
  }
) {
  const candidateDomains = Array.isArray(scoutingReport.candidate_domains)
    ? scoutingReport.candidate_domains
    : [];
  const targetDomain = String(scoutingReport.target_domain ?? "").trim() || null;
  const challengeClusters = Array.isArray(scoutingReport.challenge_clusters)
    ? scoutingReport.challenge_clusters
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean)
    : [];
  const questionGaps = sanitizeQuestionGaps(decompositionPacket);
  const coverageSummary = {
    total_questions: Array.isArray(decompositionPacket.questions)
      ? decompositionPacket.questions.length
      : 0,
    resolved_questions: Array.isArray(decompositionPacket.questions)
      ? decompositionPacket.questions.filter(
          (entry) => String(entry?.coverage_status ?? "").trim() === "resolved"
        ).length
      : 0,
    partial_questions: questionGaps.filter(
      (entry) => entry.coverage_status === "partial"
    ).length,
    unexplored_questions: questionGaps.filter(
      (entry) => entry.coverage_status === "unexplored"
    ).length,
    unresolved_questions: questionGaps.length,
  };
  const domainAssessments = candidateDomains.map((entry) => {
    const evidenceCount = countEvidence(entry, scoutingReport);
    const relevanceRatio = Number(entry?.relevance_ratio ?? 0);
    const bridgeQuality = Number(entry?.bridge_quality ?? 0);
    const metrics = domainEvidenceMetrics(entry, scoutingReport);
    return {
      entry,
      domain: String(entry?.domain ?? "").trim(),
      metrics,
      evidenceCount,
      legacyHypothesisReady:
        evidenceCount >= 1 && relevanceRatio >= 0.34 && bridgeQuality >= 0.5,
    };
  });
  const sufficientDomains = domainAssessments
    .filter((assessment) => assessment.entry?.pruned !== true)
    .filter((assessment) => assessment.metrics.evidenceChainSufficient)
    .map((assessment) => assessment.domain)
    .filter(Boolean);
  const legacyHypothesisDomains = domainAssessments
    .filter((assessment) => assessment.entry?.pruned !== true)
    .filter(
      (assessment) =>
        assessment.legacyHypothesisReady &&
        !assessment.metrics.evidenceChainSufficient
    )
    .map((assessment) => assessment.domain)
    .filter(Boolean);
  const insufficientDomains = candidateDomains
    .map((entry) => String(entry?.domain ?? "").trim())
    .filter(Boolean)
    .filter((domain) => !sufficientDomains.includes(domain));
  const totalRelevantNodes = candidateDomains.reduce((sum, entry) => {
    return sum + countEvidence(entry, scoutingReport);
  }, 0);
  const bridgeNodeCount = Array.isArray(scoutingReport.bridge_nodes)
    ? scoutingReport.bridge_nodes.length
    : 0;
  const domainMetrics = domainAssessments.map((assessment) => assessment.metrics);
  const totalSourceSpanCount = domainMetrics.reduce(
    (sum, entry) => sum + entry.sourceSpanCount,
    Number(scoutingReport.evidence_summary?.source_span_count ?? 0)
  );
  const totalBridgePathCount = domainMetrics.reduce(
    (sum, entry) => sum + entry.bridgePathCount,
    Number(scoutingReport.evidence_summary?.bridge_path_count ?? 0)
  );
  const totalEvidenceRefCount = domainMetrics.reduce(
    (sum, entry) => sum + entry.evidenceRefCount,
    Math.max(
      Number(scoutingReport.evidence_summary?.evidence_chain_ref_count ?? 0),
      Number(scoutingReport.evidence_summary?.evidence_ref_count ?? 0)
    )
  );
  const totalGraphEvidencePointerCount = domainMetrics.reduce(
    (sum, entry) => sum + entry.graphEvidencePointerCount,
    Number(scoutingReport.evidence_summary?.graph_evidence_pointer_count ?? 0)
  );
  const totalEvidenceGroundingCount =
    totalEvidenceRefCount + totalGraphEvidencePointerCount;
  const maxPathCompleteness = Math.max(
    Number(scoutingReport.evidence_summary?.max_path_completeness ?? 0),
    ...domainMetrics.map((entry) => entry.pathCompleteness),
    0
  );
  const maxEvidenceDensity = Math.max(
    Number(scoutingReport.evidence_summary?.max_evidence_density ?? 0),
    ...domainMetrics.map((entry) => entry.evidenceDensity),
    0
  );
  const maxMechanismSupportDensity = Math.max(
    Number(scoutingReport.evidence_summary?.max_mechanism_support_density ?? 0),
    ...domainMetrics.map((entry) => entry.mechanismSupportDensity),
    0
  );
  const missingEvidenceTypes = collectMissingEvidenceTypes({
    candidateDomains,
    totalSourceSpanCount,
    totalBridgePathCount,
    totalEvidenceGroundingCount,
    bridgeNodeCount,
    maxPathCompleteness,
    maxEvidenceDensity,
    maxMechanismSupportDensity,
  });
  const rawClaimCap =
    domainMetrics.some((entry) => entry.claimCap === "confirmatory")
      ? "confirmatory"
      : domainMetrics.some((entry) => entry.claimCap === "exploratory")
        ? "exploratory"
        : "hypothesis";
  const thresholdMet =
    sufficientDomains.length >= 1 &&
    totalRelevantNodes >= 1 &&
    totalBridgePathCount > 0 &&
    totalSourceSpanCount > 0 &&
    totalEvidenceGroundingCount > 0 &&
    maxPathCompleteness >= 0.5 &&
    maxEvidenceDensity > 0;
  const llmJudgment = options?.llmJudgment ?? null;
  const llmOverride =
    llmJudgment && llmJudgment.confidence >= 0.8
      ? llmJudgment
      : null;
  const llmBrainstormBlockedByGrounding =
    llmOverride?.preferredDecision === "brainstorm" && !thresholdMet;
  const llmOverrideUsed =
    Boolean(llmOverride) &&
    (llmOverride?.preferredDecision === "requisition" ||
      (llmOverride?.preferredDecision === "brainstorm" && thresholdMet));
  const decision =
    llmOverride?.preferredDecision === "requisition"
      ? "requisition"
      : thresholdMet
        ? "brainstorm"
        : "requisition";
  const decisionMode =
    decision === "brainstorm"
      ? "full_graph_backed_brainstorm"
      : legacyHypothesisDomains.length > 0
        ? "hypothesis_only"
        : "requisition";
  const claimCap = decision === "brainstorm" ? rawClaimCap : "hypothesis";
  const gatePassReason = thresholdMet
    ? "At least one non-pruned source domain has bridge path evidence, source span evidence, evidence-chain refs or equivalent graph pointers, nonzero evidence density, and meaningful path completeness."
    : null;
  const gateFailureReason = thresholdMet
    ? null
    : legacyHypothesisDomains.length > 0
      ? "Legacy bridge relevance and quality signals are present, but graph-backed source-span and evidence-chain grounding is incomplete; only hypothesis-only handling is allowed until requisition evidence is satisfied."
      : "Normal brainstorm requires bridge path evidence, source spans, evidence-chain refs or graph pointers, nonzero evidence density, and path completeness of at least 0.5.";

  const requisitionMissingDomains =
    llmOverride?.missingDomains?.length
      ? llmOverride.missingDomains
      : insufficientDomains;
  const requisitionSearchQueries = candidateDomains.flatMap((entry) =>
    Array.isArray(entry?.search_queries)
      ? entry.search_queries
          .map((query) => ({
            domain: String(query?.domain ?? entry?.domain ?? "").trim() || null,
            query: addTopicContextToQuery(
              String(query?.query ?? "").trim(),
              normalizeTopicContext(options?.topicContext)
            ),
            rationale:
              String(query?.rationale ?? "").trim() ||
              "Acquire more cross-domain bridge evidence for IDEA-CATALYST.",
          }))
          .filter((query) => query.domain && query.query)
      : []
  );
  const actionable =
    requisitionMissingDomains.length > 0 || requisitionSearchQueries.length > 0;
  const fallbackQueries =
    requisitionSearchQueries.length > 0
      ? requisitionSearchQueries
      : actionable
        ? buildFallbackQueries({
            missingDomains: requisitionMissingDomains,
            questionGaps,
            topicContext: normalizeTopicContext(options?.topicContext),
          })
        : [];
  const nonActionableReason = actionable
    ? null
    : "No concrete source domains or structured PaperNexus bridge evidence are available to build an actionable IDEA-CATALYST requisition yet.";
  const requisitionId = `req-${(targetDomain ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}-${questionGaps.length}-${requisitionMissingDomains.length}`;

  return {
    decision,
    rationale:
      (llmOverrideUsed ? llmOverride?.reasoning : null) ??
      (thresholdMet
        ? "Sufficient graph-backed cross-domain evidence exists to continue IDEA-CATALYST integration."
        : actionable
          ? gateFailureReason
          : nonActionableReason),
    evidence: {
      sufficient_domains: sufficientDomains,
      insufficient_domains: insufficientDomains,
      graph_backed_domains: sufficientDomains,
      legacy_hypothesis_domains: legacyHypothesisDomains,
      total_relevant_nodes: totalRelevantNodes,
      threshold_met: thresholdMet,
      decision_mode: decisionMode,
      gate_pass_reason: gatePassReason,
      gate_failure_reason: gateFailureReason,
      full_graph_backed_brainstorm: decisionMode === "full_graph_backed_brainstorm",
      hypothesis_only: decisionMode === "hypothesis_only",
      bridge_node_count: bridgeNodeCount,
      bridge_path_count: totalBridgePathCount,
      source_span_count: totalSourceSpanCount,
      evidence_chain_ref_count: totalEvidenceRefCount,
      graph_evidence_pointer_count: totalGraphEvidencePointerCount,
      evidence_grounding_count: totalEvidenceGroundingCount,
      path_completeness: maxPathCompleteness,
      evidence_density: maxEvidenceDensity,
      mechanism_support_density: maxMechanismSupportDensity,
      missing_evidence_types: missingEvidenceTypes,
      claim_cap: claimCap,
      max_claim_cap_from_inputs: rawClaimCap,
      coverage_summary: coverageSummary,
      gating_mode: llmOverrideUsed
        ? `${decisionMode}+llm`
        : decisionMode,
      llm_brainstorm_blocked_by_grounding: llmBrainstormBlockedByGrounding,
      llm_confidence: llmOverride?.confidence ?? null,
      llm_reasoning: llmOverride?.reasoning ?? null,
    },
    requisition: decision === "brainstorm"
      ? null
      : {
          actionable,
          requisition_id: requisitionId,
          target_domain: targetDomain,
          topic_context: normalizeTopicContext(options?.topicContext),
          missing_domains: requisitionMissingDomains,
          missing_evidence_types: missingEvidenceTypes,
          challenge_clusters: challengeClusters,
          coverage_gap_questions: questionGaps.map((entry) => ({
            question_id: entry.question_id,
            question: entry.question,
            coverage_status: entry.coverage_status,
            required_domain_evidence: requisitionMissingDomains,
          })),
          search_queries: fallbackQueries,
          non_actionable_reason: nonActionableReason,
          minimum_sources_per_domain: 2,
          minimum_bridge_nodes: Math.max(2, Math.min(4, questionGaps.length || 1)),
          retry_budget: llmOverride?.recommendedRetryBudget ?? 2,
          saturation_signal: `idea-catalyst-requisition:${targetDomain ?? "unknown"}:${questionGaps
            .map((entry) => entry.question_id)
            .join(",")}`,
          required_stage_reentry: ["graph_build", "frontier_mapping", "idea"],
          ingestion_mode: "paper_search_then_queue_import",
        },
  };
}
