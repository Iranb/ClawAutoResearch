import { normalizeArxivId, normalizeDoi } from "../paper-source-contract";
import type {
  BroadPaperProviderCapabilities,
  BroadPaperProviderQueryResult,
  BroadPaperProviderSearchParams,
  BroadPaperProviderHit,
} from "./provider-contract";
import { fetchJsonWithTimeout, parseProviderScore, parseYear } from "./provider-contract";

type OpenAlexResponse = {
  results?: Array<Record<string, unknown>>;
};

function buildCapabilities(): BroadPaperProviderCapabilities {
  return {
    provider: "openalex",
    availability: "available",
    authMode: "anonymous",
    supportsSearch: true,
    supportsOaResolution: true,
    supportsFullTextHints: true,
    supportsVenueExpansion: false,
    reason: null,
  };
}

function abstractFromInvertedIndex(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const positioned: Array<{ word: string; index: number }> = [];
  for (const [word, positions] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(positions)) {
      continue;
    }
    for (const position of positions) {
      if (typeof position === "number" && Number.isFinite(position)) {
        positioned.push({ word, index: Math.floor(position) });
      }
    }
  }
  if (positioned.length === 0) {
    return null;
  }
  return positioned
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.word)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHit(queryId: string, item: Record<string, unknown>): BroadPaperProviderHit {
  const authorships = Array.isArray(item.authorships) ? item.authorships : [];
  const authors = authorships
    .map((entry) => {
      const author = entry && typeof entry === "object" ? (entry as Record<string, unknown>).author : null;
      return author && typeof author === "object"
        ? String((author as Record<string, unknown>).display_name ?? "").trim()
        : "";
    })
    .filter(Boolean);
  const primaryLocation =
    item.primary_location && typeof item.primary_location === "object"
      ? (item.primary_location as Record<string, unknown>)
      : null;
  const primarySource =
    primaryLocation?.source && typeof primaryLocation.source === "object"
      ? (primaryLocation.source as Record<string, unknown>)
      : null;
  const bestOaLocation =
    item.best_oa_location && typeof item.best_oa_location === "object"
      ? (item.best_oa_location as Record<string, unknown>)
      : null;
  const openAccess =
    item.open_access && typeof item.open_access === "object"
      ? (item.open_access as Record<string, unknown>)
      : null;
  const ids = item.ids && typeof item.ids === "object" ? (item.ids as Record<string, unknown>) : null;
  const doi =
    normalizeDoi(String(item.doi ?? ids?.doi ?? bestOaLocation?.doi ?? "").trim()) ?? null;
  const primaryPdfUrl =
    typeof primaryLocation?.pdf_url === "string"
      ? primaryLocation.pdf_url
      : typeof bestOaLocation?.pdf_url === "string"
        ? bestOaLocation.pdf_url
        : typeof openAccess?.oa_url === "string"
          ? openAccess.oa_url
          : null;
  const venue =
    primarySource && typeof primarySource.display_name === "string"
      ? String(primarySource.display_name).trim()
      : "";
  return {
    provider: "openalex",
    providerId: typeof item.id === "string" ? item.id : null,
    title: typeof item.display_name === "string" ? item.display_name : null,
    authors,
    abstract:
      typeof item.abstract === "string"
        ? item.abstract
        : abstractFromInvertedIndex(item.abstract_inverted_index),
    url:
      typeof item.id === "string"
        ? item.id
        : typeof primaryLocation?.landing_page_url === "string"
          ? primaryLocation.landing_page_url
          : null,
    doi,
    arxivId:
      normalizeArxivId(
        typeof ids?.arxiv === "string"
          ? ids.arxiv
          : typeof item.primary_location === "object"
            ? String((primaryLocation?.landing_page_url ?? ""))
            : ""
      ) ?? null,
    pmid: null,
    pmcid: null,
    year: parseYear(item.publication_year),
    publishedDate:
      typeof item.publication_date === "string" ? item.publication_date : null,
    venue: venue || null,
    venueType:
      String(primarySource?.type ?? "").toLowerCase() === "journal"
        ? "journal"
        : String(item.type_crossref ?? "").toLowerCase().includes("proceedings")
          ? "conference"
          : typeof item.type === "string" && item.type === "preprint"
            ? "preprint"
            : "unknown",
    citationCount:
      typeof item.cited_by_count === "number" && Number.isFinite(item.cited_by_count)
        ? Math.floor(item.cited_by_count)
        : null,
    pdfUrl: primaryPdfUrl,
    bestOaUrl:
      typeof primaryLocation?.landing_page_url === "string"
        ? primaryLocation.landing_page_url
        : typeof openAccess?.oa_url === "string"
          ? openAccess.oa_url
          : null,
    providerScore: parseProviderScore(item.relevance_score),
    queryId,
    raw: item,
  };
}

export async function searchOpenAlex(
  params: BroadPaperProviderSearchParams
): Promise<BroadPaperProviderQueryResult> {
  const capabilities = buildCapabilities();
  try {
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set("search", params.query.query);
    url.searchParams.set("per-page", String(Math.max(5, Math.min(50, params.maxResults))));
    url.searchParams.set(
      "select",
      [
        "id",
        "display_name",
        "publication_year",
        "publication_date",
        "doi",
        "ids",
        "primary_location",
        "best_oa_location",
        "open_access",
        "type",
        "type_crossref",
        "authorships",
        "cited_by_count",
        "abstract_inverted_index",
        "referenced_works",
      ].join(",")
    );
    if (params.fromYear) {
      url.searchParams.set("filter", `from_publication_date:${params.fromYear}-01-01`);
    }
    const email = process.env.OPENALEX_EMAIL ?? process.env.UNPAYWALL_EMAIL;
    if (email) {
      url.searchParams.set("mailto", email);
    }
    const payload = await fetchJsonWithTimeout<OpenAlexResponse>({
      url,
      signal: params.signal,
    });
    const hits = (payload.results ?? []).map((item) => parseHit(params.query.id, item));
    return {
      provider: "openalex",
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
      provider: "openalex",
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
