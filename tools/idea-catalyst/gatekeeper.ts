import type { SufficiencyJudgment } from "./llm-sufficiency";

type ScoutingDomain = {
  domain?: string | null;
  pruned?: boolean | null;
  retrieved_nodes?: unknown[] | null;
  takeaways?: unknown[] | null;
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
  const bridgeCount = Array.isArray(scoutingReport.bridge_nodes)
    ? scoutingReport.bridge_nodes.filter(
        (node) => String(node?.domain ?? "").trim() === String(entry?.domain ?? "").trim()
      ).length
    : 0;
  return Math.max(retrievedCount, takeawayCount, bridgeCount);
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

function buildFallbackQueries(params: {
  missingDomains: string[];
  questionGaps: Array<{ question_id: string; question: string }>;
}) {
  const queries: Array<{ domain: string; query: string; rationale: string }> = [];
  for (const domain of params.missingDomains) {
    for (const gap of params.questionGaps.slice(0, 3)) {
      queries.push({
        domain,
        query: `${domain} ${gap.question} transferable principle`.trim(),
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
  const sufficientDomains = candidateDomains
    .filter((entry) => entry?.pruned !== true)
    .filter((entry) => {
      const evidenceCount = countEvidence(entry, scoutingReport);
      const relevanceRatio = Number(entry?.relevance_ratio ?? 0);
      const bridgeQuality = Number(entry?.bridge_quality ?? 0);
      return evidenceCount >= 1 && relevanceRatio >= 0.34 && bridgeQuality >= 0.5;
    })
    .map((entry) => String(entry?.domain ?? "").trim())
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
  const thresholdMet =
    (sufficientDomains.length >= 1 && totalRelevantNodes >= 1) ||
    (sufficientDomains.length >= 1 && bridgeNodeCount >= 1);
  const llmJudgment = options?.llmJudgment ?? null;
  const llmOverride =
    llmJudgment && llmJudgment.confidence >= 0.8 ? llmJudgment : null;
  const decision =
    llmOverride?.preferredDecision ?? (thresholdMet ? "brainstorm" : "requisition");

  const requisitionMissingDomains =
    llmOverride?.missingDomains?.length
      ? llmOverride.missingDomains
      : insufficientDomains;
  const requisitionSearchQueries = candidateDomains.flatMap((entry) =>
    Array.isArray(entry?.search_queries)
      ? entry.search_queries
          .map((query) => ({
            domain: String(query?.domain ?? entry?.domain ?? "").trim() || null,
            query: String(query?.query ?? "").trim(),
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
      llmOverride?.reasoning ??
      (thresholdMet
      ? "Sufficient cross-domain bridge evidence exists to continue IDEA-CATALYST integration."
      : actionable
        ? "Cross-domain bridge evidence is still insufficient for unresolved catalyst questions; request more ingestion before proceeding."
        : nonActionableReason),
    evidence: {
      sufficient_domains: sufficientDomains,
      insufficient_domains: insufficientDomains,
      total_relevant_nodes: totalRelevantNodes,
      threshold_met: thresholdMet,
      bridge_node_count: bridgeNodeCount,
      coverage_summary: coverageSummary,
      gating_mode: llmOverride
        ? "graph-bridge-sufficiency+llm"
        : "graph-bridge-sufficiency",
      llm_confidence: llmOverride?.confidence ?? null,
      llm_reasoning: llmOverride?.reasoning ?? null,
    },
    requisition: decision === "brainstorm"
      ? null
      : {
          actionable,
          requisition_id: requisitionId,
          target_domain: targetDomain,
          missing_domains: requisitionMissingDomains,
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
