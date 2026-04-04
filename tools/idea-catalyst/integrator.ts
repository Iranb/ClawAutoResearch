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

type IntegratorParams = {
  candidates: IdeaCatalystCandidate[];
  sourceDomains: string[];
  targetDomain: string;
  selectedTrackId: string | null;
  problemStatement: string | null;
};

export function buildIdeaCatalystIdeaFragments(params: IntegratorParams) {
  const fragments = params.candidates.slice(0, 6).flatMap((candidate, index) => {
    const chosenDomains = params.sourceDomains.length
      ? [params.sourceDomains[index % params.sourceDomains.length]]
      : [];
    return chosenDomains.map((domain, domainIndex) => ({
      fragment_id: `${candidate.direction_id || `dir-${index + 1}`}-${domainIndex + 1}`,
      track_id: candidate.track_id ?? params.selectedTrackId ?? null,
      direction_id: candidate.direction_id ?? null,
      title: `${candidate.title || `Direction ${index + 1}`} via ${domain}`,
      source_domain: domain,
      target_domain: params.targetDomain,
      core_insight:
        candidate.summary ??
        candidate.title ??
        "Graph-grounded interdisciplinary idea fragment.",
      integration_mechanism: {
        target_domain_elements: [params.targetDomain],
        selected_takeaways: [domain],
        synthesis_approach: `Integrate ${domain} concepts into ${params.problemStatement ?? "the target problem"}.`,
      },
      challenge_resolution: {
        addresses_target_challenge:
          candidate.summary ??
          "Addresses the selected cross-domain target challenge.",
        addresses_source_limitations:
          "Mitigates source-domain assumptions through graph-grounded adaptation.",
        addresses_research_problem:
          params.problemStatement ??
          "Addresses the active research problem through interdisciplinary synthesis.",
      },
      concrete_realization: {
        proposed_approach: `Integrate ${domain} concepts into ${params.problemStatement ?? "the target problem"}.`,
        key_innovations: [
          `Cross-domain transfer from ${domain}`,
          "Graph-grounded mechanism bridge",
        ],
      },
      novelty: Number(candidate.novelty ?? 0.8),
      feasibility: Number(candidate.feasibility ?? 0.72),
      relevance: Number(candidate.relevance ?? 0.8),
      clarity: Number(candidate.clarity ?? 0.78),
      interdisciplinary_potential: Number(candidate.composite_score ?? 0.78),
    }));
  });
  return { fragments };
}
