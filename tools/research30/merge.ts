import {
  buildCanonicalPaperRecordFromRecord,
  mergeCanonicalPaperRecords,
  serializeCanonicalPaperRecord,
  type CanonicalPaperRecord,
} from "../paper-source-contract";
import type {
  BroadPaperProviderHit,
  BroadPaperProviderQueryResult,
} from "./provider-contract";
import { matchVenueRegistry } from "./venue-registry";
import { scorePaperTopicRelevance } from "./topic-relevance";

export type MergedPaperCandidate = CanonicalPaperRecord & {
  providerAgreementCount: number;
  queryIds: string[];
  providerScores: Record<string, number | null>;
  recallScore: number;
  selectionScore: number;
  metadataOnly: boolean;
  topicRelevanceScore: number;
  matchedTopicTokens: string[];
  topicRelevanceEvidenceSource: "missing" | "title" | "title_abstract" | "full_text";
};

function scoreCandidate(params: {
  candidate: CanonicalPaperRecord;
  providerAgreementCount: number;
  providerScores: Record<string, number | null>;
  preferredVenuePacks: string[];
  topicRelevanceScore: number;
}): { recallScore: number; selectionScore: number } {
  const providerAgreementScore = params.providerAgreementCount * 25;
  const citationScore = Math.min(30, Math.max(0, Math.floor((params.candidate.citationCount ?? 0) / 10)));
  const venueScore =
    params.candidate.venuePackHits.filter((pack) => params.preferredVenuePacks.includes(pack)).length *
    20;
  const oaScore = params.candidate.bestOaUrl || params.candidate.pdfUrl ? 10 : 0;
  const metadataPenalty =
    params.candidate.resolutionStatus === "metadata_only_unresolved" ? -5 : 0;
  const providerScore = Object.values(params.providerScores)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((left, right) => right - left)[0] ?? 0;
  const infrastructureScore =
    providerAgreementScore + citationScore + venueScore + providerScore / 10;
  const gatedFactor =
    params.topicRelevanceScore >= 60
      ? 1
      : params.topicRelevanceScore >= 30
        ? 0.6
        : params.topicRelevanceScore >= 15
          ? 0.35
          : 0.15;
  const recallScore =
    params.topicRelevanceScore + infrastructureScore * gatedFactor;
  return {
    recallScore,
    selectionScore: recallScore + oaScore + metadataPenalty,
  };
}

function buildCandidateFromHit(params: {
  hit: BroadPaperProviderHit;
  preferredVenuePacks: string[];
}): CanonicalPaperRecord | null {
  const venueMatch = matchVenueRegistry({
    venue: params.hit.venue,
    preferredPacks: params.preferredVenuePacks,
  });
  return buildCanonicalPaperRecordFromRecord({
    title: params.hit.title,
    arxiv_id: params.hit.arxivId,
    doi: params.hit.doi,
    pmid: params.hit.pmid,
    pmcid: params.hit.pmcid,
    year: params.hit.year,
    venue: params.hit.venue,
    venue_family: venueMatch.venueFamily,
    venue_type: params.hit.venueType !== "unknown" ? params.hit.venueType : venueMatch.venueType,
    venue_pack_hits: venueMatch.venuePackHits,
    venue_aliases_matched: venueMatch.venueAliasesMatched,
    source_provider: params.hit.provider,
    source_path: params.hit.pdfUrl,
    retrieval_providers: [params.hit.provider],
    citation_count: params.hit.citationCount,
    best_oa_url: params.hit.bestOaUrl,
    pdf_url: params.hit.pdfUrl,
    resolution_status:
      params.hit.pdfUrl || params.hit.bestOaUrl
        ? params.hit.pdfUrl?.toLowerCase().endsWith(".pdf")
          ? "resolved_pdf"
          : "unknown"
        : "metadata_only_unresolved",
  });
}

export function mergeProviderQueryResults(params: {
  topic: string;
  queryResults: BroadPaperProviderQueryResult[];
  preferredVenuePacks: string[];
}): MergedPaperCandidate[] {
  const byCanonicalId = new Map<string, MergedPaperCandidate>();
  for (const result of params.queryResults) {
    if (result.status !== "ok") {
      continue;
    }
    for (const hit of result.hits) {
      const normalized = buildCandidateFromHit({
        hit,
        preferredVenuePacks: params.preferredVenuePacks,
      });
      if (!normalized) {
        continue;
      }
      const existing = byCanonicalId.get(normalized.canonicalId);
      if (!existing) {
        const topicRelevance = scorePaperTopicRelevance({
          topic: params.topic,
          title: normalized.title,
          abstract: hit.abstract,
        });
        byCanonicalId.set(normalized.canonicalId, {
          ...normalized,
          providerAgreementCount: 1,
          queryIds: [hit.queryId],
          providerScores: { [hit.provider]: hit.providerScore },
          recallScore: 0,
          selectionScore: 0,
          metadataOnly: normalized.resolutionStatus === "metadata_only_unresolved",
          topicRelevanceScore: topicRelevance.score,
          matchedTopicTokens: topicRelevance.matchedTokens,
          topicRelevanceEvidenceSource: topicRelevance.evidenceSource,
        });
        continue;
      }
      const providerScores = {
        ...existing.providerScores,
        [hit.provider]:
          typeof hit.providerScore === "number"
            ? Math.max(existing.providerScores[hit.provider] ?? -Infinity, hit.providerScore)
            : existing.providerScores[hit.provider] ?? null,
      };
      const merged = mergeCanonicalPaperRecords(existing, normalized);
      byCanonicalId.set(normalized.canonicalId, {
        ...merged,
        providerAgreementCount: new Set([
          ...Object.keys(existing.providerScores),
          hit.provider,
        ]).size,
        queryIds: Array.from(new Set([...existing.queryIds, hit.queryId])),
        providerScores,
        recallScore: 0,
        selectionScore: 0,
        metadataOnly:
          merged.resolutionStatus === "metadata_only_unresolved" ||
          existing.metadataOnly,
        topicRelevanceScore: existing.topicRelevanceScore,
        matchedTopicTokens: existing.matchedTopicTokens,
        topicRelevanceEvidenceSource: existing.topicRelevanceEvidenceSource,
      });
    }
  }

  return [...byCanonicalId.values()]
    .map((candidate) => {
      const scores = scoreCandidate({
        candidate,
        providerAgreementCount: candidate.providerAgreementCount,
        providerScores: candidate.providerScores,
        preferredVenuePacks: params.preferredVenuePacks,
        topicRelevanceScore: candidate.topicRelevanceScore,
      });
      return {
        ...candidate,
        recallScore: scores.recallScore,
        selectionScore: scores.selectionScore,
      };
    })
    .sort(
      (left, right) =>
        right.selectionScore - left.selectionScore ||
        right.recallScore - left.recallScore ||
        (right.year ?? -1) - (left.year ?? -1) ||
        left.canonicalId.localeCompare(right.canonicalId)
    );
}

export function serializeMergedPaperCandidate(
  candidate: MergedPaperCandidate
): Record<string, unknown> {
  return {
    ...serializeCanonicalPaperRecord(candidate),
    provider_agreement_count: candidate.providerAgreementCount,
    query_ids: candidate.queryIds,
    provider_scores: candidate.providerScores,
    recall_score: candidate.recallScore,
    selection_score: candidate.selectionScore,
    metadata_only: candidate.metadataOnly,
    topic_relevance_score: candidate.topicRelevanceScore,
    matched_topic_tokens: candidate.matchedTopicTokens,
    topic_relevance_evidence_source: candidate.topicRelevanceEvidenceSource,
  };
}
