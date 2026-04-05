type IdeaCatalystCandidate = {
  direction_id?: string | null;
  track_id?: string | null;
  title?: string | null;
  summary?: string | null;
  novelty?: number | null;
  feasibility?: number | null;
  relevance?: number | null;
  clarity?: number | null;
  composite_score?: number | null;
};

type ScoutingTakeaway = {
  takeaway_id?: string | null;
  concept?: string | null;
  mechanism?: string | null;
  kg_node_id?: string | null;
  source_domain_formulation?: string | null;
  mechanism_explanation?: string | null;
  relevance_to_challenge?: string | null;
  selection_rationale?: string | null;
};

type ScoutingDomainEntry = {
  domain?: string | null;
  takeaways?: ScoutingTakeaway[] | null;
};

type ScoutingReportLike = {
  candidate_domains?: ScoutingDomainEntry[] | null;
};

type DecompositionQuestion = {
  question_id?: string | null;
  domain_specific_question?: string | null;
  domain_agnostic_question?: string | null;
  coverage_status?: string | null;
  coverage_evidence?: {
    graph_signal_matches?: string[] | null;
    transfer_bridge_matches?: string[] | null;
  } | null;
  remaining_non_incremental_challenges?:
    | Array<{
        challenge_specific?: string | null;
        challenge_agnostic?: string | null;
      }>
    | null;
};

type DecompositionPacketLike = {
  questions?: DecompositionQuestion[] | null;
};

type IntegratorParams = {
  candidates: IdeaCatalystCandidate[];
  sourceDomains: string[];
  targetDomain: string;
  selectedTrackId: string | null;
  problemStatement: string | null;
  scoutingReport?: ScoutingReportLike | null;
  decompositionPacket?: DecompositionPacketLike | null;
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

function tokenize(value: string) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 3);
}

function overlapScore(left: string, right: string) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function choosePrimaryQuestion(params: {
  candidate: IdeaCatalystCandidate;
  questions: DecompositionQuestion[];
}) {
  const summary = `${params.candidate.title ?? ""} ${params.candidate.summary ?? ""}`.trim();
  const ranked = params.questions
    .map((question) => ({
      question,
      score: Math.max(
        overlapScore(summary, question.domain_specific_question ?? ""),
        overlapScore(summary, question.domain_agnostic_question ?? ""),
        ...(Array.isArray(question.remaining_non_incremental_challenges)
          ? question.remaining_non_incremental_challenges.map((entry) =>
              Math.max(
                overlapScore(summary, entry.challenge_specific ?? ""),
                overlapScore(summary, entry.challenge_agnostic ?? "")
              )
            )
          : [0])
      ),
    }))
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.question ?? params.questions[0] ?? null;
}

function getTakeawaysForDomain(
  scoutingReport: ScoutingReportLike | null | undefined,
  domain: string
) {
  const candidateDomains = Array.isArray(scoutingReport?.candidate_domains)
    ? scoutingReport?.candidate_domains ?? []
    : [];
  const match = candidateDomains.find(
    (entry) => String(entry?.domain ?? "").trim().toLowerCase() === domain.toLowerCase()
  );
  return Array.isArray(match?.takeaways) ? match.takeaways : [];
}

function buildTargetDomainElements(params: {
  question: DecompositionQuestion | null;
  targetDomain: string;
}) {
  if (!params.question) {
    return [params.targetDomain];
  }
  return uniqueStrings([
    params.targetDomain,
    String(params.question.domain_specific_question ?? "").trim(),
    ...((params.question.coverage_evidence?.graph_signal_matches ?? []).map((entry) =>
      String(entry || "").trim()
    )),
    ...((params.question.coverage_evidence?.transfer_bridge_matches ?? []).map((entry) =>
      String(entry || "").trim()
    )),
  ]).slice(0, 4);
}

function buildConcreteApproach(params: {
  candidate: IdeaCatalystCandidate;
  selectedTakeaways: ScoutingTakeaway[];
  question: DecompositionQuestion | null;
  problemStatement: string | null;
}) {
  const firstTakeaway = params.selectedTakeaways[0];
  const proposedApproach =
    params.candidate.summary ??
    `Recontextualize ${firstTakeaway?.mechanism ?? "source-domain mechanisms"} into ${params.problemStatement ?? "the target problem"}.`;
  const keyInnovations = uniqueStrings([
    params.candidate.title ?? "",
    firstTakeaway?.mechanism
      ? `Transfer ${firstTakeaway.mechanism} into the target-domain method design`
      : "",
    firstTakeaway?.relevance_to_challenge
      ? `Directly address ${firstTakeaway.relevance_to_challenge}`
      : "",
    params.question?.domain_agnostic_question
      ? `Operationalize the domain-agnostic challenge "${params.question.domain_agnostic_question}"`
      : "",
  ]).slice(0, 4);
  return {
    proposed_approach: proposedApproach,
    key_innovations: keyInnovations.length
      ? keyInnovations
      : ["Graph-grounded interdisciplinary synthesis"],
  };
}

export function buildIdeaCatalystIdeaFragments(params: IntegratorParams) {
  const questions = Array.isArray(params.decompositionPacket?.questions)
    ? params.decompositionPacket?.questions ?? []
    : [];
  const fragments = params.candidates.slice(0, 6).flatMap((candidate, index) => {
    const chosenDomains = params.sourceDomains.length
      ? [params.sourceDomains[index % params.sourceDomains.length]]
      : [];
    return chosenDomains.map((domain, domainIndex) => {
      const question = choosePrimaryQuestion({ candidate, questions });
      const domainTakeaways = getTakeawaysForDomain(params.scoutingReport, domain);
      const selectedTakeaways = domainTakeaways.slice(0, 2).map((takeaway, takeawayIndex) => ({
        takeaway_id:
          takeaway.takeaway_id ??
          `${candidate.direction_id || `dir-${index + 1}`}-${domainIndex + 1}-takeaway-${takeawayIndex + 1}`,
        source_domain_formulation:
          takeaway.source_domain_formulation ??
          takeaway.concept ??
          `Transferable ${domain} formulation`,
        mechanism_explanation:
          takeaway.mechanism_explanation ??
          takeaway.mechanism ??
          "Bridge mechanism remains implicit in the current graph packet.",
        selection_rationale:
          takeaway.selection_rationale ??
          `Selected because ${domain} contains graph-supported takeaways relevant to the target challenge.`,
      }));
      const targetDomainElements = buildTargetDomainElements({
        question,
        targetDomain: params.targetDomain,
      });
      const concreteRealization = buildConcreteApproach({
        candidate,
        selectedTakeaways: domainTakeaways,
        question,
        problemStatement: params.problemStatement,
      });

      return {
        fragment_id: `${candidate.direction_id || `dir-${index + 1}`}-${domainIndex + 1}`,
        track_id: candidate.track_id ?? params.selectedTrackId ?? null,
        direction_id: candidate.direction_id ?? null,
        title: `${candidate.title || `Direction ${index + 1}`} via ${domain}`,
        source_domain: domain,
        target_domain: params.targetDomain,
        core_insight:
          candidate.summary ??
          domainTakeaways[0]?.mechanism_explanation ??
          domainTakeaways[0]?.source_domain_formulation ??
          "Graph-grounded interdisciplinary idea fragment.",
        integration_mechanism: {
          target_domain_elements: targetDomainElements,
          selected_takeaways: selectedTakeaways,
          synthesis_approach:
            candidate.summary ??
            `Use ${domain} takeaways to address ${question?.domain_specific_question ?? params.problemStatement ?? "the active research problem"} while preserving target-domain constraints.`,
        },
        challenge_resolution: {
          addresses_target_challenge:
            question?.domain_specific_question ??
            candidate.summary ??
            "Addresses the selected cross-domain target challenge.",
          addresses_source_limitations:
            domainTakeaways[0]?.selection_rationale ??
            "Mitigates source-domain assumptions through graph-grounded adaptation.",
          addresses_research_problem:
            params.problemStatement ??
            question?.domain_agnostic_question ??
            "Addresses the active research problem through interdisciplinary synthesis.",
        },
        concrete_realization: concreteRealization,
        novelty: Number(candidate.novelty ?? 0.8),
        feasibility: Number(candidate.feasibility ?? 0.72),
        relevance: Number(candidate.relevance ?? 0.8),
        clarity: Number(candidate.clarity ?? 0.78),
        interdisciplinary_potential: Number(candidate.composite_score ?? 0.78),
      };
    });
  });
  return { fragments };
}
