export type IdeaCatalystPromptStageContract = {
  required_fields: string[];
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

export function getIdeaCatalystPromptContract(): IdeaCatalystPromptContract {
  return {
    initial_decomposition: {
      required_fields: [
        "coarse_grained_domain",
        "fine_grained_domain",
        "core_challenge",
        "domain_specific_question",
        "domain_agnostic_question",
        "rationale",
        "target_domain_queries",
      ],
    },
    target_domain_analysis: {
      required_fields: [
        "addressed_aspects",
        "remaining_challenges",
        "overall_assessment",
      ],
    },
    cross_domain_queries: {
      required_fields: ["cross_domain_searches", "domain_rationale", "queries"],
    },
    cross_domain_analysis: {
      required_fields: [
        "source_domain_formulation",
        "mechanism_explanation",
        "selection_rationale",
        "supporting_papers",
        "relevance_to_challenge",
      ],
    },
    integration: {
      required_fields: [
        "idea_fragment",
        "title",
        "core_insight",
        "integration_mechanism",
        "challenge_resolution",
        "concrete_realization",
      ],
    },
    ranking: {
      required_fields: ["pairwise_comparison", "winner", "reasoning", "ranking_criteria"],
    },
    ranking_criteria: [...RANKING_CRITERIA],
  };
}

export function getIdeaCatalystRankingCriteria(): string[] {
  return [...RANKING_CRITERIA];
}
