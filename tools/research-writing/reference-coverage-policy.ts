export const DEFAULT_REFERENCE_COVERAGE_POLICY =
  "minimum_relevance_no_upper_limit";

export type ReferenceCoverageDecision = {
  ready: boolean;
  policy: string;
  acceptedTopicRelevanceStatuses: string[];
  minimumRelevantCitationCount: number;
  relevantCitationCount: number;
  peripheralCitationCount: number;
  unrelatedCitationCount: number;
  reason: string | null;
};

function normalizeStageLike(value: unknown): string | null {
  const normalized =
    typeof value === "string"
      ? value.trim().toLowerCase().replace(/[\s-]+/g, "_")
      : "";
  return normalized || null;
}

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function readCount(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const count = normalizeCount(record[key]);
    if (count > 0) {
      return count;
    }
  }
  return 0;
}

export function evaluateReferenceCoveragePolicy(params: {
  citationIntegrity: Record<string, unknown> | null | undefined;
  minimumCitationCount: number;
}): ReferenceCoverageDecision {
  const citationIntegrity = params.citationIntegrity ?? {};
  const policy =
    normalizeStageLike(
      citationIntegrity.referenceCoveragePolicy ??
        citationIntegrity.reference_coverage_policy
    ) ?? DEFAULT_REFERENCE_COVERAGE_POLICY;
  const topicRelevanceStatus =
    normalizeStageLike(
      citationIntegrity.topicRelevanceStatus ??
        citationIntegrity.topic_relevance_status
    ) ?? "unknown";
  const acceptedTopicRelevanceStatuses =
    policy === DEFAULT_REFERENCE_COVERAGE_POLICY
      ? ["ready", "mixed"]
      : ["ready"];
  const relevantCitationCount = readCount(citationIntegrity, [
    "relevantCitationCount",
    "relevant_citation_count",
  ]);
  const peripheralCitationCount = readCount(citationIntegrity, [
    "peripheralCitationCount",
    "peripheral_citation_count",
  ]);
  const unrelatedCitationCount =
    readCount(citationIntegrity, [
      "unrelatedCitationCount",
      "unrelated_citation_count",
    ]) ||
    readCount(citationIntegrity, [
      "offTopicCitationCount",
      "off_topic_citation_count",
    ]);
  const configuredMinimumRelevantCitationCount = readCount(citationIntegrity, [
    "minimumRelevantCitationCount",
    "minimum_relevant_citation_count",
  ]);
  const minimumRelevantCitationCount =
    configuredMinimumRelevantCitationCount > 0
      ? configuredMinimumRelevantCitationCount
      : 0;

  if (unrelatedCitationCount > 0) {
    return {
      ready: false,
      policy,
      acceptedTopicRelevanceStatuses,
      minimumRelevantCitationCount,
      relevantCitationCount,
      peripheralCitationCount,
      unrelatedCitationCount,
      reason: `citation unrelated count must be 0 (current: ${unrelatedCitationCount})`,
    };
  }
  if (
    minimumRelevantCitationCount > 0 &&
    relevantCitationCount < minimumRelevantCitationCount
  ) {
    return {
      ready: false,
      policy,
      acceptedTopicRelevanceStatuses,
      minimumRelevantCitationCount,
      relevantCitationCount,
      peripheralCitationCount,
      unrelatedCitationCount,
      reason: `relevant citation count >= ${minimumRelevantCitationCount} (current: ${relevantCitationCount})`,
    };
  }
  if (
    params.minimumCitationCount > 0 &&
    !acceptedTopicRelevanceStatuses.includes(topicRelevanceStatus)
  ) {
    return {
      ready: false,
      policy,
      acceptedTopicRelevanceStatuses,
      minimumRelevantCitationCount,
      relevantCitationCount,
      peripheralCitationCount,
      unrelatedCitationCount,
      reason: `PROJECT_MANIFEST.json.citation_integrity.topic_relevance_status in ${acceptedTopicRelevanceStatuses.join("/")} (current: ${topicRelevanceStatus})`,
    };
  }
  return {
    ready: true,
    policy,
    acceptedTopicRelevanceStatuses,
    minimumRelevantCitationCount,
    relevantCitationCount,
    peripheralCitationCount,
    unrelatedCitationCount,
    reason: null,
  };
}
