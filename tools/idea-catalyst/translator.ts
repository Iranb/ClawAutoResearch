type DecompositionQuestion = {
  question_id?: string | null;
  domain_specific_question?: string | null;
  coverage_status?: string | null;
  coverage_evidence?: {
    graph_signal_matches?: string[] | null;
    occupied_solution_matches?: string[] | null;
    transfer_bridge_matches?: string[] | null;
  } | null;
  remaining_non_incremental_challenges?: string[] | null;
};

type DecompositionPacketLike = {
  questions?: DecompositionQuestion[] | null;
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

function deriveMechanismHypothesis(question: DecompositionQuestion) {
  const domainSpecificQuestion =
    question.domain_specific_question ?? "the target challenge";
  const transferBridgeMatches = Array.isArray(
    question.coverage_evidence?.transfer_bridge_matches
  )
    ? question.coverage_evidence?.transfer_bridge_matches ?? []
    : [];
  if (transferBridgeMatches.length > 0) {
    return `Adapt the mechanism behind ${transferBridgeMatches[0]} to address ${domainSpecificQuestion.toLowerCase()}.`;
  }
  return `Abstract the control or adaptation mechanism underlying ${domainSpecificQuestion.toLowerCase()} so it can be transferred across domains.`;
}

export function buildIdeaCatalystAbstractionPacket(
  decompositionPacket: DecompositionPacketLike,
  targetDomain: string
) {
  const questions = Array.isArray(decompositionPacket.questions)
    ? decompositionPacket.questions
    : [];
  return {
    version: 2,
    target_domain: targetDomain,
    abstractions: questions.map((question, index) => ({
      question_id: question.question_id ?? `q${index + 1}`,
      domain_specific_question:
        question.domain_specific_question ?? `challenge ${index + 1}`,
      coverage_status: question.coverage_status ?? "partial",
      domain_agnostic_question: `How can a learning system address ${String(
        question.domain_specific_question ?? `challenge ${index + 1}`
      ).toLowerCase()} under changing collaborators, constraints, and environments?`,
      mechanism_hypothesis: deriveMechanismHypothesis(question),
      transfer_axes: uniqueStrings([
        ...(question.coverage_evidence?.graph_signal_matches ?? []),
        ...(question.coverage_evidence?.transfer_bridge_matches ?? []),
      ]),
      unresolved_constraints: Array.isArray(
        question.remaining_non_incremental_challenges
      )
        ? question.remaining_non_incremental_challenges
        : [],
    })),
  };
}
