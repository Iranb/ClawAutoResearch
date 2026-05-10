export type IdeaCatalystPromptStageContract = {
  stage_goal: string;
  required_fields: string[];
  guidance: string[];
  quality_checks: string[];
};

export type IdeaCatalystPromptContract = {
  initial_decomposition: IdeaCatalystPromptStageContract;
  target_domain_analysis: IdeaCatalystPromptStageContract;
  cross_domain_queries: IdeaCatalystPromptStageContract;
  cross_domain_analysis: IdeaCatalystPromptStageContract;
  integration: IdeaCatalystPromptStageContract;
  ranking: IdeaCatalystPromptStageContract;
  ranking_criteria: string[];
};

const RANKING_CRITERIA = [
  "DEPTH OF INTEGRATION",
  "MULTI-STAGE DISCIPLINARY ENGAGEMENT",
  "INNOVATION PAYOFF",
  "NOVELTY + FEASIBILITY",
];

const RANKING_CRITERIA_DEFINITIONS = [
  "DEPTH OF INTEGRATION: the source-domain mechanism is explicitly mapped to a target-domain challenge, not merely mentioned as inspiration.",
  "MULTI-STAGE DISCIPLINARY ENGAGEMENT: the fragment uses target-domain analysis, source-domain takeaways, and recontextualization rather than a one-hop analogy.",
  "INNOVATION PAYOFF: the fragment could resolve a high-impact unresolved conceptual challenge or open a meaningfully new research path.",
  "NOVELTY + FEASIBILITY: the fragment is non-obvious to target-domain experts while remaining credible enough for a bounded pilot or investigation.",
];

export function getIdeaCatalystPromptContract(): IdeaCatalystPromptContract {
  return {
    initial_decomposition: {
      stage_goal:
        "Decompose an abstract research problem into target-domain research questions with paired domain-specific and domain-agnostic formulations.",
      required_fields: [
        "coarse_grained_domain",
        "fine_grained_domain",
        "core_challenge",
        "domain_specific_question",
        "domain_agnostic_question",
        "rationale",
        "target_domain_queries",
      ],
      guidance: [
        "Prefer questions that expose partially addressed or unexplored conceptual gaps instead of incremental solution variants.",
        "Keep the domain-specific question in the target domain's technical language.",
        "Rewrite the domain-agnostic question as a mechanism-level abstraction with target-domain jargon removed.",
        "Generate target-domain search queries that support literature-grounded progress assessment.",
      ],
      quality_checks: [
        "No source-domain suggestions are introduced during decomposition.",
        "Each proposed question can support later target-domain analysis and cross-domain retrieval.",
        "The rationale explains why the question is missing from the current decomposition.",
      ],
    },
    target_domain_analysis: {
      stage_goal:
        "Assess what the target domain has addressed and surface remaining non-incremental challenges.",
      required_fields: [
        "addressed_aspects",
        "remaining_challenges",
        "overall_assessment",
      ],
      guidance: [
        "Classify progress as largely unaddressed, partially addressed, or substantially addressed.",
        "Separate target-domain implementation limits from deeper conceptual challenges.",
        "Preserve evidence anchors that explain why a challenge remains open.",
      ],
      quality_checks: [
        "Remaining challenges include both domain-specific and domain-agnostic versions.",
        "The assessment does not treat sparse evidence as closure.",
      ],
    },
    cross_domain_queries: {
      stage_goal:
        "Select and query external source domains by analogy, shared mechanism, or transferable principle.",
      required_fields: ["cross_domain_searches", "domain_rationale", "queries"],
      guidance: [
        "Use the domain-agnostic challenge to choose source domains.",
        "Prefer meaningfully distant domains when they offer conceptual leverage.",
        "Translate the challenge into source-domain vocabulary before search.",
      ],
      quality_checks: [
        "Overly proximal target-domain neighbors are not selected only because they are familiar.",
        "Each query is specific enough to retrieve source-domain mechanisms or frameworks.",
      ],
    },
    cross_domain_analysis: {
      stage_goal:
        "Extract literature-grounded source-domain concepts that address the abstracted challenge.",
      required_fields: [
        "source_domain_formulation",
        "mechanism_explanation",
        "selection_rationale",
        "supporting_papers",
        "relevance_to_challenge",
      ],
      guidance: [
        "Extract takeaways only when retrieved papers provide meaningful conceptual support.",
        "Explain how the source-domain mechanism works before mapping it back to the target domain.",
        "Prefer specific constructs, frameworks, or empirical patterns over generic analogies.",
      ],
      quality_checks: [
        "Supporting papers or evidence refs are present for each substantive takeaway.",
        "The selection rationale states why this source-domain idea is relevant to the target challenge.",
      ],
    },
    integration: {
      stage_goal:
        "Recontextualize source-domain takeaways into incomplete but actionable interdisciplinary idea fragments.",
      required_fields: [
        "idea_fragment",
        "title",
        "core_insight",
        "integration_mechanism",
        "challenge_resolution",
        "concrete_realization",
      ],
      guidance: [
        "Link one target-domain challenge, source-domain takeaways, and a synthesis rationale.",
        "Keep the fragment exploratory; do not turn it into a fully committed solution too early.",
        "State a concrete realization only as a bounded way to test or elaborate the fragment.",
      ],
      quality_checks: [
        "The fragment explains what changes in the target-domain formulation.",
        "The integration mechanism is more specific than 'borrow X from domain Y'.",
      ],
    },
    ranking: {
      stage_goal:
        "Rank idea fragments through pairwise interdisciplinary-potential judgments.",
      required_fields: ["pairwise_comparison", "winner", "reasoning", "ranking_criteria"],
      guidance: [
        "Use relative pairwise comparison rather than absolute self-scores.",
        "Prioritize interdisciplinary novelty, usefulness, and depth of integration over polish or length.",
        "Do not punish a distant source domain only because immediate implementation is harder.",
      ],
      quality_checks: [
        "The winner is justified against the named criteria.",
        "Relevance alone is not enough if the fragment lacks novel cross-domain synthesis.",
      ],
    },
    ranking_criteria: [...RANKING_CRITERIA],
  };
}

export function getIdeaCatalystRankingCriteria(): string[] {
  return [...RANKING_CRITERIA];
}

export function getIdeaCatalystRankingCriteriaDefinitions(): string[] {
  return [...RANKING_CRITERIA_DEFINITIONS];
}
