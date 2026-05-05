import { execFile } from "node:child_process";
import fsSync from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  type BroadPaperProviderHit,
  type BroadPaperProviderName,
  type BroadPaperProviderQueryResult,
  type BroadPaperProviderSearchParams,
  parseProviderScore,
  parseYear,
} from "./provider-contract";

const execFileAsync = promisify(execFile);

function findRepoRootFromModule(moduleUrl: string): string {
  const filePath = fileURLToPath(moduleUrl);
  const candidates = [
    path.resolve(path.dirname(filePath), "..", ".."),
    path.resolve(path.dirname(filePath), "..", "..", ".."),
    path.resolve(path.dirname(filePath), "..", "..", "..", ".."),
  ];
  for (const candidate of candidates) {
    const hasPapersCool = fsSync.existsSync(
      path.join(candidate, "skills", "researcher", "papers-cool", "scripts", "search_papers.py")
    );
    const hasPasa = fsSync.existsSync(
      path.join(candidate, "skills", "researcher", "pasa-paper-search", "scripts", "pasa_search.py")
    );
    if (hasPapersCool || hasPasa) {
      return candidate;
    }
  }
  return candidates[0] ?? path.resolve(path.dirname(filePath), "..", "..");
}

const REPO_ROOT = findRepoRootFromModule(import.meta.url);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function normalizeArxivId(value: unknown): string | null {
  const text = asString(value);
  if (!text) {
    return null;
  }
  const match = text.match(/\b(?:[a-z-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?\b/i);
  return match?.[0] ?? null;
}

function buildUnavailableResult(params: {
  provider: BroadPaperProviderName;
  queryId: string;
  status: "skipped" | "error" | "degraded";
  reason: string;
  error?: string | null;
  warnings?: string[];
}): BroadPaperProviderQueryResult {
  return {
    provider: params.provider,
    queryId: params.queryId,
    status: params.status,
    capabilities: {
      provider: params.provider,
      availability: params.status === "skipped" ? "disabled" : "available",
      authMode: "anonymous",
      supportsSearch: true,
      supportsOaResolution: false,
      supportsFullTextHints: true,
      supportsVenueExpansion: params.provider === "papers_cool",
      reason: params.reason,
    },
    totalHits: 0,
    hits: [],
    warnings: params.warnings ?? [params.reason],
    error: params.error ?? params.reason,
    nonFatal: true,
  };
}

async function runJsonScript(params: {
  scriptPath: string;
  args: string[];
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const result = await execFileAsync("python3", [params.scriptPath, ...params.args], {
    timeout: params.timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function mapPapersCoolHit(params: {
  raw: Record<string, unknown>;
  queryId: string;
}): BroadPaperProviderHit | null {
  const arxivId = normalizeArxivId(params.raw.arxiv_id ?? params.raw.arxivId);
  const title = asString(params.raw.title);
  if (!title && !arxivId) {
    return null;
  }
  return {
    provider: "papers_cool",
    providerId: arxivId,
    title,
    authors: [],
    abstract: asString(params.raw.abstract) ?? asString(params.raw.abstract_snippet),
    url: asString(params.raw.url) ?? (arxivId ? `https://papers.cool/arxiv/${arxivId}` : null),
    doi: null,
    arxivId,
    pmid: null,
    pmcid: null,
    year: parseYear(arxivId),
    publishedDate: null,
    venue: null,
    venueType: "unknown",
    citationCount: null,
    pdfUrl: arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : null,
    bestOaUrl: arxivId ? `https://arxiv.org/abs/${arxivId}` : null,
    providerScore: parseProviderScore(params.raw.index),
    queryId: params.queryId,
    raw: params.raw,
  };
}

function mapPasaHit(params: {
  raw: Record<string, unknown>;
  queryId: string;
}): BroadPaperProviderHit | null {
  const arxivId = normalizeArxivId(params.raw.paper_id ?? params.raw.link);
  const title = asString(params.raw.title);
  if (!title && !arxivId) {
    return null;
  }
  return {
    provider: "pasa",
    providerId: asString(params.raw.paper_id) ?? arxivId,
    title,
    authors: asStringArray(params.raw.authors),
    abstract: asString(params.raw.abstract),
    url: asString(params.raw.link) ?? (arxivId ? `https://arxiv.org/abs/${arxivId}` : null),
    doi: null,
    arxivId,
    pmid: null,
    pmcid: null,
    year: parseYear(params.raw.year ?? params.raw.publish_time),
    publishedDate: asString(params.raw.publish_time),
    venue: null,
    venueType: "unknown",
    citationCount: null,
    pdfUrl: arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : null,
    bestOaUrl: arxivId ? `https://arxiv.org/abs/${arxivId}` : null,
    providerScore: parseProviderScore(params.raw.score),
    queryId: params.queryId,
    raw: params.raw,
  };
}

export async function searchPapersCool(
  params: BroadPaperProviderSearchParams
): Promise<BroadPaperProviderQueryResult> {
  const scriptPath = path.join(
    REPO_ROOT,
    "skills",
    "researcher",
    "papers-cool",
    "scripts",
    "search_papers.py"
  );
  try {
    const payload = await runJsonScript({
      scriptPath,
      args: [
        "--json",
        "--max",
        String(params.maxResults),
        params.query.query,
      ],
      timeoutMs: 20_000,
    });
    const papers = Array.isArray(payload.papers) ? payload.papers : [];
    const hits = papers
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => mapPapersCoolHit({ raw: entry, queryId: params.query.id }))
      .filter((entry): entry is BroadPaperProviderHit => Boolean(entry));
    const error = asString(payload.error);
    return {
      provider: "papers_cool",
      queryId: params.query.id,
      status: error ? "degraded" : "ok",
      capabilities: {
        provider: "papers_cool",
        availability: "available",
        authMode: "anonymous",
        supportsSearch: true,
        supportsOaResolution: true,
        supportsFullTextHints: true,
        supportsVenueExpansion: true,
        reason: null,
      },
      totalHits: hits.length,
      hits,
      warnings: error ? [error] : [],
      error,
      nonFatal: Boolean(error),
    };
  } catch (error) {
    return buildUnavailableResult({
      provider: "papers_cool",
      queryId: params.query.id,
      status: "degraded",
      reason: "papers.cool local script failed; continuing with other providers.",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function searchPasa(
  params: BroadPaperProviderSearchParams
): Promise<BroadPaperProviderQueryResult> {
  const scriptPath = path.join(
    REPO_ROOT,
    "skills",
    "researcher",
    "pasa-paper-search",
    "scripts",
    "pasa_search.py"
  );
  try {
    const args = [
      "--format",
      "json",
      "--limit",
      String(params.maxResults),
      "--timeout",
      params.depth === "deep" ? "20" : "8",
    ];
    if (params.fromYear) {
      args.push("--min-year", String(params.fromYear));
    }
    args.push(params.query.query);
    const payload = await runJsonScript({
      scriptPath,
      args,
      timeoutMs: params.depth === "deep" ? 25_000 : 12_000,
    });
    const results = Array.isArray(payload.results) ? payload.results : [];
    const hits = results
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => mapPasaHit({ raw: entry, queryId: params.query.id }))
      .filter((entry): entry is BroadPaperProviderHit => Boolean(entry));
    const timedOut = payload.timed_out === true || payload.finished === false;
    return {
      provider: "pasa",
      queryId: params.query.id,
      status: timedOut ? "degraded" : "ok",
      capabilities: {
        provider: "pasa",
        availability: "available",
        authMode: "anonymous",
        supportsSearch: true,
        supportsOaResolution: false,
        supportsFullTextHints: true,
        supportsVenueExpansion: false,
        reason: timedOut ? "PASA did not finish before timeout; partial hits are retained." : null,
      },
      totalHits: hits.length,
      hits,
      warnings: timedOut ? ["PASA did not finish before timeout; partial hits are retained."] : [],
      error: timedOut ? "PASA timed out before completion." : null,
      nonFatal: timedOut,
    };
  } catch (error) {
    return buildUnavailableResult({
      provider: "pasa",
      queryId: params.query.id,
      status: "degraded",
      reason: "PASA local script failed; continuing with other providers.",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
