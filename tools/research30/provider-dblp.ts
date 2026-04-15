import { normalizeDoi } from "../paper-source-contract";
import type {
  BroadPaperProviderCapabilities,
  BroadPaperProviderHit,
  BroadPaperProviderQueryResult,
  BroadPaperProviderSearchParams,
} from "./provider-contract";
import { fetchJsonWithTimeout, parseYear } from "./provider-contract";

type DblpResponse = {
  result?: {
    hits?: {
      hit?: Array<{
        info?: Record<string, unknown>;
      }>;
    };
  };
};

function buildCapabilities(): BroadPaperProviderCapabilities {
  return {
    provider: "dblp",
    availability: "available",
    authMode: "anonymous",
    supportsSearch: true,
    supportsOaResolution: false,
    supportsFullTextHints: false,
    supportsVenueExpansion: true,
    reason: null,
  };
}

function parseHit(queryId: string, info: Record<string, unknown>): BroadPaperProviderHit {
  const authorsRaw =
    info.authors && typeof info.authors === "object"
      ? (info.authors as Record<string, unknown>).author
      : [];
  const authors = Array.isArray(authorsRaw)
    ? authorsRaw.map((entry) => String(entry ?? "").trim()).filter(Boolean)
    : typeof authorsRaw === "string"
      ? [authorsRaw]
      : [];
  const venue = typeof info.venue === "string" ? info.venue : null;
  return {
    provider: "dblp",
    providerId: typeof info.key === "string" ? info.key : null,
    title: typeof info.title === "string" ? info.title : null,
    authors,
    abstract: null,
    url: typeof info.url === "string" ? info.url : null,
    doi: normalizeDoi(typeof info.doi === "string" ? info.doi : null),
    arxivId: null,
    pmid: null,
    pmcid: null,
    year: parseYear(info.year),
    publishedDate: typeof info.year === "string" ? `${info.year}-01-01` : null,
    venue,
    venueType:
      venue && /\btransactions|journal|letters|review\b/i.test(venue)
        ? "journal"
        : "conference",
    citationCount: null,
    pdfUrl: null,
    bestOaUrl: typeof info.ee === "string" ? info.ee : null,
    providerScore: null,
    queryId,
    raw: info,
  };
}

export async function searchDblp(
  params: BroadPaperProviderSearchParams
): Promise<BroadPaperProviderQueryResult> {
  const capabilities = buildCapabilities();
  try {
    const url = new URL("https://dblp.org/search/publ/api");
    url.searchParams.set("q", params.query.query);
    url.searchParams.set("h", String(Math.max(5, Math.min(50, params.maxResults))));
    url.searchParams.set("format", "json");
    const payload = await fetchJsonWithTimeout<DblpResponse>({
      url,
      signal: params.signal,
    });
    const hits = (payload.result?.hits?.hit ?? []).map((entry) =>
      parseHit(params.query.id, entry.info ?? {})
    );
    return {
      provider: "dblp",
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
      provider: "dblp",
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
