type RankedFragmentEntry = {
  fragment_id?: string | null;
  title?: string | null;
  source_domain?: string | null;
  rank?: number | null;
};

type IdeaFragmentEntry = {
  fragment_id?: string | null;
  title?: string | null;
  source_domain?: string | null;
  target_domain?: string | null;
  challenge_resolution?: {
    addresses_target_challenge?: string | null;
    addresses_research_problem?: string | null;
  } | null;
  concrete_realization?: {
    proposed_approach?: string | null;
    key_innovations?: string[] | null;
  } | null;
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

export function buildIdeaToClaimMap(params: {
  rankedFragments?: RankedFragmentEntry[] | null;
  ideaFragments?: IdeaFragmentEntry[] | null;
  selectedTrackId?: string | null;
  baselineReference?: string | null;
  primaryMetric?: string | null;
  problemStatement?: string | null;
  trackHypothesis?: string | null;
  noveltyBasis?: string | null;
}) {
  const ranked = Array.isArray(params.rankedFragments) ? params.rankedFragments : [];
  const fragments = Array.isArray(params.ideaFragments) ? params.ideaFragments : [];
  const fragmentsById = new Map(
    fragments.map((entry, index) => [
      String(entry.fragment_id ?? `fragment-${index + 1}`),
      entry,
    ])
  );
  const arcOrder = ["challenge", "insight", "contribution", "advantage"] as const;
  const preferredEntries =
    ranked.length > 0
      ? ranked
      : fragments.map((entry, index) => ({
          fragment_id: entry.fragment_id ?? `fragment-${index + 1}`,
          title: entry.title ?? `Idea Fragment ${index + 1}`,
          source_domain: entry.source_domain ?? "unknown",
          rank: index + 1,
        }));

  const mappings = preferredEntries.slice(0, 4).map((entry, index) => {
    const fragmentId = String(entry.fragment_id ?? `fragment-${index + 1}`);
    const fragment = fragmentsById.get(fragmentId);
    const storyArcPosition = arcOrder[index] ?? "contribution";
    const expectedClaims = uniqueStrings([
      fragment?.challenge_resolution?.addresses_target_challenge ?? "",
      fragment?.challenge_resolution?.addresses_research_problem ?? "",
      fragment?.concrete_realization?.proposed_approach ?? "",
      ...(Array.isArray(fragment?.concrete_realization?.key_innovations)
        ? fragment?.concrete_realization?.key_innovations ?? []
        : []),
      params.trackHypothesis ?? "",
      params.noveltyBasis ?? "",
      params.problemStatement
        ? `${params.problemStatement} with explicit evidence support`
        : "",
      params.primaryMetric
        ? `Improves ${params.primaryMetric} against ${params.baselineReference ?? "the baseline"}`
        : "",
    ]).slice(0, 4);

    return {
      fragment_id: fragmentId,
      title: String(entry.title ?? fragment?.title ?? `Idea Fragment ${index + 1}`),
      source_domain: String(
        entry.source_domain ?? fragment?.source_domain ?? "unknown"
      ),
      story_arc_position: storyArcPosition,
      selected_track_id: params.selectedTrackId ?? null,
      expected_claims:
        expectedClaims.length > 0
          ? expectedClaims
          : ["Carry the selected idea into a reviewer-defensible claim bundle."],
    };
  });

  if (mappings.length === 0) {
    const fallbackClaims = uniqueStrings([
      params.trackHypothesis ?? "",
      params.noveltyBasis ?? "",
      params.primaryMetric
        ? `Improves ${params.primaryMetric} against ${params.baselineReference ?? "the baseline"}`
        : "",
    ]).slice(0, 3);
    mappings.push({
      fragment_id: params.selectedTrackId ?? "track-main",
      title: params.trackHypothesis ?? "Selected research direction",
      source_domain: "target-domain",
      story_arc_position: "insight",
      selected_track_id: params.selectedTrackId ?? null,
      expected_claims:
        fallbackClaims.length > 0
          ? fallbackClaims
          : ["Carry the selected research direction into an evidence-backed claim plan."],
    });
  }

  return {
    version: 1,
    mappings,
  };
}
