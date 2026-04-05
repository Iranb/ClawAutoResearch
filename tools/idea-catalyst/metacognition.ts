type DecompositionQuestionLike = {
  domain_specific_question?: string | null;
  domain_agnostic_question?: string | null;
  coverage_status?: string | null;
  remaining_non_incremental_challenges?:
    | Array<{
        challenge_specific?: string | null;
        challenge_agnostic?: string | null;
      }>
    | null;
};

type DecompositionPacketLike = {
  questions?: DecompositionQuestionLike[] | null;
};

type ScoutingReportLike = {
  selected_source_domains?: string[] | null;
  pruned_domains?: string[] | null;
  bridge_evidence_tier?: string | null;
};

type GateDecisionLike = {
  decision?: string | null;
  rationale?: string | null;
  evidence?: {
    coverage_summary?: {
      total_questions?: number | null;
      resolved_questions?: number | null;
      partial_questions?: number | null;
      unexplored_questions?: number | null;
      unresolved_questions?: number | null;
    } | null;
  } | null;
};

export type CatalystIterationStrategy =
  | "initial_scan"
  | "refine_questions"
  | "expand_domains"
  | "requisition"
  | "brainstorm";

export type CatalystIterationRecord = {
  iteration: number;
  strategy: CatalystIterationStrategy;
  coverage_summary: {
    total_questions: number;
    resolved_questions: number;
    partial_questions: number;
    unexplored_questions: number;
    unresolved_questions: number;
  };
  selected_domains: string[];
  pruned_domains: string[];
  bridge_evidence_tier: string | null;
  gate_decision: string;
  gate_rationale: string | null;
  timestamp: string;
};

function uniqueStrings(values: string[]) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const rawValue of values) {
    const value = String(rawValue || "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function summarizeCoverage(decompositionPacket: DecompositionPacketLike) {
  const questions = Array.isArray(decompositionPacket.questions)
    ? decompositionPacket.questions
    : [];
  return {
    total_questions: questions.length,
    resolved_questions: questions.filter(
      (entry) => String(entry?.coverage_status ?? "").trim() === "resolved"
    ).length,
    partial_questions: questions.filter(
      (entry) => String(entry?.coverage_status ?? "").trim() === "partial"
    ).length,
    unexplored_questions: questions.filter(
      (entry) => String(entry?.coverage_status ?? "").trim() === "unexplored"
    ).length,
    unresolved_questions: questions.filter(
      (entry) => String(entry?.coverage_status ?? "").trim() !== "resolved"
    ).length,
  };
}

export function assessIdeaCatalystProgress(params: {
  iteration: number;
  gateDecision: GateDecisionLike;
}) {
  if (String(params.gateDecision.decision ?? "").trim() === "brainstorm") {
    return {
      shouldContinue: false,
      nextStrategy: "brainstorm" as const,
    };
  }
  if (params.iteration === 0) {
    return {
      shouldContinue: true,
      nextStrategy: "refine_questions" as const,
    };
  }
  if (params.iteration === 1) {
    return {
      shouldContinue: true,
      nextStrategy: "expand_domains" as const,
    };
  }
  return {
    shouldContinue: false,
    nextStrategy: "requisition" as const,
  };
}

export function deriveRefinedChallengeClusters(params: {
  challengeClusters: string[];
  decompositionPacket: DecompositionPacketLike;
}) {
  const questions = Array.isArray(params.decompositionPacket.questions)
    ? params.decompositionPacket.questions
    : [];
  const refined = uniqueStrings([
    ...params.challengeClusters,
    ...questions
      .map((entry) => String(entry?.domain_agnostic_question ?? "").trim())
      .filter(Boolean),
    ...questions.flatMap((entry) =>
      Array.isArray(entry?.remaining_non_incremental_challenges)
        ? entry.remaining_non_incremental_challenges
            .map((challenge) => String(challenge?.challenge_agnostic ?? "").trim())
            .filter(Boolean)
        : []
    ),
  ]);
  return refined.slice(0, Math.max(6, params.challengeClusters.length + 2));
}

export function buildCatalystIterationRecord(params: {
  iteration: number;
  strategy: CatalystIterationStrategy;
  decompositionPacket: DecompositionPacketLike;
  scoutingReport: ScoutingReportLike;
  gateDecision: GateDecisionLike;
  timestamp?: string;
}): CatalystIterationRecord {
  const coverageSummaryRaw = params.gateDecision.evidence?.coverage_summary;
  const coverageSummary = coverageSummaryRaw
    ? {
        total_questions: Number(coverageSummaryRaw.total_questions ?? 0),
        resolved_questions: Number(coverageSummaryRaw.resolved_questions ?? 0),
        partial_questions: Number(coverageSummaryRaw.partial_questions ?? 0),
        unexplored_questions: Number(coverageSummaryRaw.unexplored_questions ?? 0),
        unresolved_questions: Number(coverageSummaryRaw.unresolved_questions ?? 0),
      }
    : summarizeCoverage(params.decompositionPacket);
  return {
    iteration: params.iteration,
    strategy: params.strategy,
    coverage_summary: coverageSummary,
    selected_domains: Array.isArray(params.scoutingReport.selected_source_domains)
      ? params.scoutingReport.selected_source_domains.map((entry) => String(entry))
      : [],
    pruned_domains: Array.isArray(params.scoutingReport.pruned_domains)
      ? params.scoutingReport.pruned_domains.map((entry) => String(entry))
      : [],
    bridge_evidence_tier:
      params.scoutingReport.bridge_evidence_tier != null
        ? String(params.scoutingReport.bridge_evidence_tier)
        : null,
    gate_decision: String(params.gateDecision.decision ?? "requisition"),
    gate_rationale:
      params.gateDecision.rationale != null
        ? String(params.gateDecision.rationale)
        : null,
    timestamp: params.timestamp ?? new Date().toISOString(),
  };
}
