import { normalizeDoi } from "../paper-source-contract";
import type {
  BroadPaperProviderCapabilities,
  BroadPaperProviderHit,
  BroadPaperProviderQueryResult,
  BroadPaperProviderSearchParams,
} from "./provider-contract";
import { fetchJsonWithTimeout, parseProviderScore, parseYear } from "./provider-contract";

type CrossrefResponse = {
  message?: {
    items?: Array<Record<string, unknown>>;
  };
};

function buildCapabilities(): BroadPaperProviderCapabilities {
  return {
    provider: "crossref",
    availability: "available",
    authMode: "anonymous",
    supportsSearch: true,
    supportsOaResolution: false,
    supportsFullTextHints: false,
    supportsVenueExpansion: false,
    reason: null,
  };
}

function pickCrossrefTitle(item: Record<string, unknown>): string | null {
  const title = Array.isArray(item.title) ? item.title[0] : item.title;
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

function pickCrossrefVenue(item: Record<string, unknown>): string | null {
  const container = Array.isArray(item["container-title"])
    ? item["container-title"][0]
    : item["container-title"];
  return typeof container === "string" && container.trim() ? container.trim() : null;
}

function pickCrossrefPublishedDate(item: Record<string, unknown>): string | null {
  const issued = item.issued && typeof item.issued === "object"
    ? (item.issued as Record<string, unknown>)
    : null;
  const dateParts = Array.isArray(issued?.["date-parts"])
    ? (issued?.["date-parts"] as unknown[])
    : [];
  const first = Array.isArray(dateParts[0]) ? (dateParts[0] as unknown[]) : [];
  const [year, month, day] = first;
  if (typeof year === "number" && Number.isFinite(year)) {
    const parts = [String(year), typeof month === "number" ? String(month).padStart(2, "0") : "01"];
    parts.push(typeof day === "number" ? String(day).padStart(2, "0") : "01");
    return parts.join("-");
  }
  return null;
}

function parseHit(queryId: string, item: Record<string, unknown>): BroadPaperProviderHit {
  const authors = Array.isArray(item.author)
    ? item.author
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return "";
          }
          const record = entry as Record<string, unknown>;
          const given = typeof record.given === "string" ? record.given.trim() : "";
          const family = typeof record.family === "string" ? record.family.trim() : "";
          return [given, family].filter(Boolean).join(" ").trim();
        })
        .filter(Boolean)
    : [];
  const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
  const doi = normalizeDoi(typeof item.DOI === "string" ? item.DOI : null);
  return {
    provider: "crossref",
    providerId: doi,
    title: pickCrossrefTitle(item),
    authors,
    abstract: typeof item.abstract === "string" ? item.abstract : null,
    url: Array.isArray(item.URL) ? null : typeof item.URL === "string" ? item.URL : null,
    doi,
    arxivId: null,
    pmid: null,
    pmcid: null,
    year: parseYear(item.created),
    publishedDate: pickCrossrefPublishedDate(item),
    venue: pickCrossrefVenue(item),
    venueType:
      type.includes("journal") || type === "journal-article"
        ? "journal"
        : type.includes("proceedings")
          ? "conference"
          : "unknown",
    citationCount:
      typeof item["is-referenced-by-count"] === "number" &&
      Number.isFinite(item["is-referenced-by-count"])
        ? Math.floor(item["is-referenced-by-count"] as number)
        : null,
    pdfUrl: null,
    bestOaUrl: typeof item.URL === "string" ? item.URL : null,
    providerScore: parseProviderScore(item.score),
    queryId,
    raw: item,
  };
}

export async function searchCrossref(
  params: BroadPaperProviderSearchParams
): Promise<BroadPaperProviderQueryResult> {
  const capabilities = buildCapabilities();
  try {
    const url = new URL("https://api.crossref.org/works");
    url.searchParams.set("query.bibliographic", params.query.query);
    url.searchParams.set("rows", String(Math.max(5, Math.min(50, params.maxResults))));
    const filters: string[] = [];
    if (params.fromYear) {
      filters.push(`from-pub-date:${params.fromYear}-01-01`);
    }
    url.searchParams.set("filter", filters.join(","));
    const payload = await fetchJsonWithTimeout<CrossrefResponse>({
      url,
      signal: params.signal,
      headers: {
        "User-Agent":
          "ClawAutoResearch/1.0 (mailto:openalex@example.invalid) crossref-client",
      },
    });
    const hits = (payload.message?.items ?? []).map((item) => parseHit(params.query.id, item));
    return {
      provider: "crossref",
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
      provider: "crossref",
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
