type DecompositionPacketParams = {
  targetDomain: string;
  longTermGoal: string | null;
  problemStatement: string | null;
  selectedTrackId: string | null;
  challengeClusters: string[];
  graphChallengeClusters?: string[];
  occupiedSolutionZones?: string[];
  transferBridges?: string[];
};

type GeneratedCatalystQuestion = {
  domain_specific_question: string;
  domain_agnostic_question?: string | null;
  rationale?: string | null;
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

function tokenOverlapScore(left: string, right: string) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
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

function matchingEntries(target: string, candidates: string[], threshold = 0.34) {
  return uniqueStrings(candidates).filter((candidate) => {
    const normalizedTarget = target.toLowerCase();
    const normalizedCandidate = candidate.toLowerCase();
    return (
      normalizedTarget.includes(normalizedCandidate) ||
      normalizedCandidate.includes(normalizedTarget) ||
      tokenOverlapScore(target, candidate) >= threshold
    );
  });
}

function stripDomainJargon(value: string, targetDomain: string) {
  return String(value || "")
    .replace(new RegExp(targetDomain, "ig"), "the target domain")
    .replace(/\b(gcd|generalized category discovery)\b/gi, "a learning system")
    .replace(/\bprototype(s)?\b/gi, "state representation$1")
    .replace(/\bdomain shift\b/gi, "distribution change")
    .replace(/\bcategory\b/gi, "concept")
    .replace(/\bcomputer science\b/gi, "the target domain")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDomainAgnosticQuestion(challenge: string, targetDomain: string) {
  const normalized = stripDomainJargon(challenge, targetDomain);
  const question = normalized.replace(/[.?!]+$/, "");
  if (!question) {
    return "How can a system resolve the underlying challenge under changing constraints and evidence?";
  }
  if (/^how\b/i.test(question)) {
    return question.endsWith("?") ? question : `${question}?`;
  }
  if (/preserv|retain|memory/i.test(question)) {
    return `How can a system preserve prior state while still adapting under changing evidence and collaborators?`;
  }
  if (/adapt|shift|chang/i.test(question)) {
    return `How can a system adapt behavior under changing collaborators, goals, or environments without losing prior competence?`;
  }
  return `How can a system address ${question.toLowerCase()} across changing collaborators, constraints, and environments?`;
}

function describeRemainingChallenges(challenge: string, targetDomain: string) {
  const domainAgnostic = buildDomainAgnosticQuestion(challenge, targetDomain).replace(
    /\?$/,
    ""
  );
  return [
    {
      challenge_specific: `Find a non-incremental mechanism that addresses "${challenge}" in ${targetDomain}.`,
      challenge_agnostic: `${domainAgnostic} without relying on target-domain-specific assumptions.`,
    },
    {
      challenge_specific: `Collect cross-domain evidence that explains why "${challenge}" remains unresolved under current ${targetDomain} assumptions.`,
      challenge_agnostic: `Explain why this challenge persists despite prior progress, and which external mechanisms may close the remaining gap.`,
    },
  ];
}

export function buildIdeaCatalystDecompositionPacket(
  params: DecompositionPacketParams,
  options?: {
    llmGeneratedQuestions?: GeneratedCatalystQuestion[];
  }
) {
  const graphChallengeClusters = uniqueStrings(params.graphChallengeClusters ?? []);
  const occupiedSolutionZones = uniqueStrings(params.occupiedSolutionZones ?? []);
  const transferBridgeMechanisms = uniqueStrings(
    (params.transferBridges ?? []).map((entry) => {
      const [, ...rest] = String(entry || "").split(":");
      return rest.join(":").trim() || String(entry || "").trim();
    })
  );

  const seededQuestions = uniqueStrings(params.challengeClusters).map((challenge) => ({
    domainSpecificQuestion: challenge,
    domainAgnosticQuestion: null,
    rationale: null,
    source: "graph_seed" as const,
  }));
  const llmGeneratedQuestions = Array.isArray(options?.llmGeneratedQuestions)
    ? options.llmGeneratedQuestions
        .map((entry) => ({
          domainSpecificQuestion: String(entry?.domain_specific_question ?? "").trim(),
          domainAgnosticQuestion:
            entry?.domain_agnostic_question == null
              ? null
              : String(entry.domain_agnostic_question).trim() || null,
          rationale:
            entry?.rationale == null ? null : String(entry.rationale).trim() || null,
          source: "llm_generated" as const,
        }))
        .filter((entry) => entry.domainSpecificQuestion.length > 0)
    : [];
  const seenQuestions = new Set<string>();
  const questionInputs = [...seededQuestions, ...llmGeneratedQuestions].filter((entry) => {
    const key = entry.domainSpecificQuestion.toLowerCase();
    if (seenQuestions.has(key)) {
      return false;
    }
    seenQuestions.add(key);
    return true;
  });

  return {
    version: 2,
    target_domain: params.targetDomain,
    long_term_goal: params.longTermGoal,
    problem_statement: params.problemStatement,
    selected_track_id: params.selectedTrackId,
    questions: questionInputs.map((questionInput, index) => {
      const challenge = questionInput.domainSpecificQuestion;
      const graphSignalMatches = matchingEntries(challenge, graphChallengeClusters);
      const occupiedMatches = matchingEntries(challenge, occupiedSolutionZones, 0.25);
      const transferBridgeMatches = matchingEntries(challenge, transferBridgeMechanisms);
      const coverageStatus = occupiedMatches.length
        ? "resolved"
        : graphSignalMatches.length || transferBridgeMatches.length
          ? "partial"
          : "unexplored";

      return {
        question_id: `q${index + 1}`,
        priority: index + 1,
        domain_specific_question: challenge,
        domain_agnostic_question:
          questionInput.domainAgnosticQuestion ??
          buildDomainAgnosticQuestion(challenge, params.targetDomain),
        source: questionInput.source,
        generation_rationale:
          questionInput.source === "llm_generated" ? questionInput.rationale : null,
        coverage_status: coverageStatus,
        coverage_evidence: {
          graph_signal_matches: graphSignalMatches,
          occupied_solution_matches: occupiedMatches,
          transfer_bridge_matches: transferBridgeMatches,
        },
        remaining_non_incremental_challenges:
          coverageStatus === "resolved"
            ? []
            : describeRemainingChallenges(challenge, params.targetDomain),
      };
    }),
  };
}
