import { asString } from "../workflow-guard-core/coercion";
import type { PaperVenueType } from "../paper-source-contract";

export type BroadPaperSearchDepth = "quick" | "default" | "deep";
export type BroadPaperProviderName =
  | "openalex"
  | "semanticscholar"
  | "crossref"
  | "unpaywall"
  | "core"
  | "dblp";

export type BroadPaperProviderAvailability =
  | "available"
  | "missing_credentials"
  | "disabled"
  | "unsupported";

export type BroadPaperSearchQuery = {
  id: string;
  query: string;
  family:
    | "direct"
    | "synonym"
    | "task_method"
    | "paragraph_semantic"
    | "venue_pack"
    | "keyword_refresh";
  rationale: string;
  domain?: string | null;
  venuePack?: string | null;
};

export type BroadPaperProviderCapabilities = {
  provider: BroadPaperProviderName;
  availability: BroadPaperProviderAvailability;
  authMode: "anonymous" | "api_key_optional" | "api_key_required" | "email_required";
  supportsSearch: boolean;
  supportsOaResolution: boolean;
  supportsFullTextHints: boolean;
  supportsVenueExpansion: boolean;
  reason: string | null;
};

export type BroadPaperProviderHit = {
  provider: BroadPaperProviderName;
  providerId: string | null;
  title: string | null;
  authors: string[];
  abstract: string | null;
  url: string | null;
  doi: string | null;
  arxivId: string | null;
  pmid: string | null;
  pmcid: string | null;
  year: number | null;
  publishedDate: string | null;
  venue: string | null;
  venueType: PaperVenueType;
  citationCount: number | null;
  pdfUrl: string | null;
  bestOaUrl: string | null;
  providerScore: number | null;
  queryId: string;
  raw: Record<string, unknown> | null;
};

export type BroadPaperProviderQueryResult = {
  provider: BroadPaperProviderName;
  queryId: string;
  status: "ok" | "skipped" | "error";
  capabilities: BroadPaperProviderCapabilities;
  totalHits: number;
  hits: BroadPaperProviderHit[];
  warnings: string[];
  error: string | null;
};

export type BroadPaperProviderSearchParams = {
  query: BroadPaperSearchQuery;
  depth: BroadPaperSearchDepth;
  maxResults: number;
  fromYear: number | null;
  signal?: AbortSignal;
};

export type BroadPaperSearchExecutionParams = {
  topic: string;
  queryPlan: BroadPaperSearchQuery[];
  depth: BroadPaperSearchDepth;
  maxResultsPerQuery: number;
  fromYear: number | null;
  providers?: BroadPaperProviderName[] | null;
};

export type BroadPaperSearchHttpOptions = {
  url: URL;
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

export function parseYear(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.floor(value);
    return normalized >= 1900 && normalized <= 9999 ? normalized : null;
  }
  const text = asString(value);
  if (!text) {
    return null;
  }
  const match = text.match(/\b(19|20)\d{2}\b/);
  if (!match?.[0]) {
    return null;
  }
  const normalized = Number(match[0]);
  return Number.isFinite(normalized) ? normalized : null;
}

export function parseProviderScore(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const text = asString(value);
  if (!text) {
    return null;
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

export async function fetchJsonWithTimeout<T>(params: BroadPaperSearchHttpOptions): Promise<T> {
  const response = await fetch(params.url, {
    signal: params.signal,
    headers: {
      Accept: "application/json",
      "User-Agent": "ClawAutoResearch/1.0 (+https://github.com/Iranb/ClawAutoResearch)",
      ...(params.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} for ${params.url}`);
  }
  return (await response.json()) as T;
}
