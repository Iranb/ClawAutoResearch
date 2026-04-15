import { normalizeDoi } from "../paper-source-contract";
import type {
  BroadPaperProviderCapabilities,
  BroadPaperProviderHit,
  BroadPaperProviderQueryResult,
  BroadPaperProviderSearchParams,
} from "./provider-contract";
import { fetchJsonWithTimeout, parseYear } from "./provider-contract";

type CoreResponse = {
  results?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
};

function buildCapabilities(): BroadPaperProviderCapabilities {
  if (!process.env.CORE_API_KEY) {
    return {
      provider: "core",
      availability: "missing_credentials",
      authMode: "api_key_required",
      supportsSearch: true,
      supportsOaResolution: true,
      supportsFullTextHints: true,
      supportsVenueExpansion: false,
      reason: "CORE_API_KEY is not configured.",
    };
  }
  return {
    provider: "core",
    availability: "available",
    authMode: "api_key_required",
    supportsSearch: true,
    supportsOaResolution: true,
    supportsFullTextHints: true,
    supportsVenueExpansion: false,
    reason: null,
  };
}

function parseHit(queryId: string, item: Record<string, unknown>): BroadPaperProviderHit {
  const authors = Array.isArray(item.authors)
    ? item.authors.map((entry) => String(entry ?? "").trim()).filter(Boolean)
    : [];
  return {
    provider: "core",
    providerId: typeof item.id === "string" ? item.id : null,
    title: typeof item.title === "string" ? item.title : null,
    authors,
    abstract: typeof item.abstract === "string" ? item.abstract : null,
    url: typeof item.downloadUrl === "string"
      ? item.downloadUrl
      : typeof item.fullTextIdentifier === "string"
        ? item.fullTextIdentifier
        : typeof item.url === "string"
          ? item.url
          : null,
    doi: normalizeDoi(typeof item.doi === "string" ? item.doi : null),
    arxivId: null,
    pmid: null,
    pmcid: null,
    year: parseYear(item.yearPublished ?? item.year),
    publishedDate: typeof item.yearPublished === "number" ? `${item.yearPublished}-01-01` : null,
    venue:
      typeof item.publisher === "string"
        ? item.publisher
        : typeof item.journal === "string"
          ? item.journal
          : null,
    venueType: "journal",
    citationCount: null,
    pdfUrl: typeof item.downloadUrl === "string" ? item.downloadUrl : null,
    bestOaUrl:
      typeof item.downloadUrl === "string"
        ? item.downloadUrl
        : typeof item.fullTextIdentifier === "string"
          ? item.fullTextIdentifier
          : null,
    providerScore: typeof item.score === "number" ? item.score : null,
    queryId,
    raw: item,
  };
}

export async function searchCore(
  params: BroadPaperProviderSearchParams
): Promise<BroadPaperProviderQueryResult> {
  const capabilities = buildCapabilities();
  if (capabilities.availability !== "available" || !process.env.CORE_API_KEY) {
    return {
      provider: "core",
      queryId: params.query.id,
      status: "skipped",
      capabilities,
      totalHits: 0,
      hits: [],
      warnings: [],
      error: capabilities.reason,
    };
  }
  try {
    const url = new URL("https://api.core.ac.uk/v3/search/works");
    url.searchParams.set("q", params.query.query);
    url.searchParams.set("limit", String(Math.max(5, Math.min(50, params.maxResults))));
    const payload = await fetchJsonWithTimeout<CoreResponse>({
      url,
      signal: params.signal,
      headers: {
        Authorization: `Bearer ${process.env.CORE_API_KEY}`,
      },
    });
    const hits = (payload.results ?? payload.data ?? []).map((item) =>
      parseHit(params.query.id, item)
    );
    return {
      provider: "core",
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
      provider: "core",
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
