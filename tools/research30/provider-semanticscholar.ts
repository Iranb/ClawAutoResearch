import { normalizeArxivId, normalizeDoi, normalizePmcid, normalizePmid } from "../paper-source-contract";
import type {
  BroadPaperProviderCapabilities,
  BroadPaperProviderHit,
  BroadPaperProviderQueryResult,
  BroadPaperProviderSearchParams,
} from "./provider-contract";
import { fetchJsonWithTimeout, parseProviderScore, parseYear } from "./provider-contract";

type SemanticScholarResponse = {
  data?: Array<Record<string, unknown>>;
};

function buildCapabilities(): BroadPaperProviderCapabilities {
  return {
    provider: "semanticscholar",
    availability: "available",
    authMode: process.env.SEMANTIC_SCHOLAR_API_KEY ? "api_key_optional" : "anonymous",
    supportsSearch: true,
    supportsOaResolution: true,
    supportsFullTextHints: true,
    supportsVenueExpansion: false,
    reason: null,
  };
}

function parseHit(queryId: string, item: Record<string, unknown>): BroadPaperProviderHit {
  const externalIds =
    item.externalIds && typeof item.externalIds === "object"
      ? (item.externalIds as Record<string, unknown>)
      : null;
  const openAccessPdf =
    item.openAccessPdf && typeof item.openAccessPdf === "object"
      ? (item.openAccessPdf as Record<string, unknown>)
      : null;
  const authors = Array.isArray(item.authors)
    ? item.authors
        .map((entry) =>
          entry && typeof entry === "object"
            ? String((entry as Record<string, unknown>).name ?? "").trim()
            : ""
        )
        .filter(Boolean)
    : [];
  const publicationTypes = Array.isArray(item.publicationTypes)
    ? item.publicationTypes.map((entry) => String(entry).toLowerCase())
    : [];
  return {
    provider: "semanticscholar",
    providerId: typeof item.paperId === "string" ? item.paperId : null,
    title: typeof item.title === "string" ? item.title : null,
    authors,
    abstract: typeof item.abstract === "string" ? item.abstract : null,
    url: typeof item.url === "string" ? item.url : null,
    doi: normalizeDoi(typeof externalIds?.DOI === "string" ? externalIds.DOI : null),
    arxivId: normalizeArxivId(
      typeof externalIds?.ArXiv === "string" ? externalIds.ArXiv : null
    ),
    pmid: normalizePmid(typeof externalIds?.PubMed === "string" ? externalIds.PubMed : null),
    pmcid: normalizePmcid(typeof externalIds?.PubMedCentral === "string" ? externalIds.PubMedCentral : null),
    year: parseYear(item.year),
    publishedDate: typeof item.publicationDate === "string" ? item.publicationDate : null,
    venue: typeof item.venue === "string" ? item.venue : null,
    venueType: publicationTypes.some((value) => value.includes("journal"))
      ? "journal"
      : publicationTypes.some((value) => value.includes("conference"))
        ? "conference"
        : "unknown",
    citationCount:
      typeof item.citationCount === "number" && Number.isFinite(item.citationCount)
        ? Math.floor(item.citationCount)
        : null,
    pdfUrl: typeof openAccessPdf?.url === "string" ? openAccessPdf.url : null,
    bestOaUrl: typeof item.url === "string" ? item.url : null,
    providerScore: parseProviderScore(item.relevanceScore ?? item.citationCount),
    queryId,
    raw: item,
  };
}

export async function searchSemanticScholar(
  params: BroadPaperProviderSearchParams
): Promise<BroadPaperProviderQueryResult> {
  const capabilities = buildCapabilities();
  try {
    const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
    url.searchParams.set("query", params.query.query);
    url.searchParams.set("limit", String(Math.max(5, Math.min(50, params.maxResults))));
    url.searchParams.set(
      "fields",
      [
        "title",
        "abstract",
        "authors",
        "url",
        "venue",
        "year",
        "publicationDate",
        "citationCount",
        "publicationTypes",
        "externalIds",
        "openAccessPdf",
        "tldr",
      ].join(",")
    );
    const headers: Record<string, string> = {};
    if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
      headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;
    }
    const payload = await fetchJsonWithTimeout<SemanticScholarResponse>({
      url,
      signal: params.signal,
      headers,
    });
    const hits = (payload.data ?? []).map((item) => parseHit(params.query.id, item));
    return {
      provider: "semanticscholar",
      queryId: params.query.id,
      status: "ok",
      capabilities,
      totalHits: hits.length,
      hits,
      warnings: [],
      error: null,
    };
  } catch (error) {
    return {
      provider: "semanticscholar",
      queryId: params.query.id,
      status: "error",
      capabilities,
      totalHits: 0,
      hits: [],
      warnings: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
