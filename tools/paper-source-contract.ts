import * as path from "node:path";
import {
  asRecord,
  asString,
  asStringArray,
  pickNumber,
  pickString,
  uniqueStrings,
} from "./workflow-guard-core/coercion";

export type PaperSourceKind = "markdown" | "pdf" | "unknown";
export type PaperVenueType =
  | "conference"
  | "journal"
  | "preprint"
  | "repository"
  | "unknown";
export type PaperResolutionStatus =
  | "resolved_markdown"
  | "resolved_pdf"
  | "metadata_only_unresolved"
  | "resolution_failed"
  | "unknown";

export type PaperResolutionAttempt = {
  provider: string | null;
  status: "success" | "failed" | "skipped";
  detail: string | null;
  at: string | null;
  url: string | null;
};

export type CanonicalPaperRecord = {
  canonicalId: string;
  title: string | null;
  normalizedTitle: string | null;
  titleSignature: string | null;
  arxivId: string | null;
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
  year: number | null;
  venue: string | null;
  venueFamily: string | null;
  venueType: PaperVenueType;
  venuePackHits: string[];
  venueAliasesMatched: string[];
  sourceHints: string[];
  sourceKind: PaperSourceKind;
  sourceProvider: string | null;
  sourcePath: string | null;
  retrievalProviders: string[];
  citationCount: number | null;
  bestOaUrl: string | null;
  pdfUrl: string | null;
  resolutionStatus: PaperResolutionStatus;
  resolutionAttempts: PaperResolutionAttempt[];
};

const ARXIV_ID_REGEX = /\b(?:[a-z-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?\b/i;
const ARXIV_ID_EXTRACT_REGEX = /\b(?:[a-z-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?\b/gi;
const DOI_REGEX = /\b10\.\d{4,9}\/[-._;()/:a-z0-9]+\b/i;
const PMID_REGEX = /\bpmid[:\s]*([0-9]{5,})\b/i;
const PMCID_REGEX = /\bpmc[:\s]*([0-9]{5,})\b/i;

const TITLE_SIGNATURE_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "for",
  "to",
  "in",
  "on",
  "with",
  "via",
  "from",
  "by",
  "using",
  "use",
  "toward",
  "towards",
  "based",
]);

function normalizeTitleToken(value: string): string {
  let normalized = value.replace(/[^a-z0-9]+/g, "").trim().toLowerCase();
  if (normalized.endsWith("ies") && normalized.length > 4) {
    normalized = `${normalized.slice(0, -3)}y`;
  } else if (normalized.endsWith("es") && normalized.length > 4) {
    normalized = normalized.slice(0, -2);
  } else if (
    normalized.endsWith("s") &&
    normalized.length > 3 &&
    !normalized.endsWith("ss")
  ) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function isRemoteEndpointLike(value: string | null | undefined): boolean {
  return Boolean(value && /^[a-z]+:\/\//i.test(value));
}

export function normalizeProviderName(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

export function normalizeArxivId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const raw = value.trim();
  if (!raw) {
    return null;
  }
  const containsDoi = DOI_REGEX.test(raw);
  const containsArxivContext = /\barxiv\b|arxiv\.org/i.test(raw);
  if (containsDoi && !containsArxivContext) {
    return null;
  }
  for (const match of raw.matchAll(ARXIV_ID_EXTRACT_REGEX)) {
    const candidate = normalizeArxivCandidate(match[0]);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function normalizeArxivCandidate(value: string): string | null {
  const normalized = value.toLowerCase().replace(/v\d+$/i, "");
  const modern = normalized.match(/^(\d{4})\.\d{4,5}$/);
  if (modern) {
    const month = Number(modern[1].slice(2));
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return null;
    }
  }
  return normalized;
}

export function normalizeDoi(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(DOI_REGEX);
  return match?.[0]?.toLowerCase() ?? null;
}

export function normalizePmid(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(PMID_REGEX);
  return match?.[1] ?? null;
}

export function normalizePmcid(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(PMCID_REGEX);
  return match?.[1] ? `PMC${match[1]}` : null;
}

export function normalizeTitle(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value
    .trim()
    .replace(/\.(pdf|md)$/i, "")
    .replace(/--+/g, " ")
    .replace(/[_./]+/g, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return normalized || null;
}

export function buildTitleSignature(value: string | null | undefined): string | null {
  const normalized = normalizeTitle(value);
  if (!normalized) {
    return null;
  }
  const tokens = normalized
    .split(" ")
    .map((token) => normalizeTitleToken(token))
    .filter((token) => token.length >= 3 && !TITLE_SIGNATURE_STOPWORDS.has(token));
  const signature = Array.from(new Set(tokens)).sort().join(" ");
  return signature || null;
}

export function collectSourceHints(record: Record<string, unknown> | null): string[] {
  if (!record) {
    return [];
  }
  return uniqueStrings([
    pickString(record, ["source_path", "sourcePath"]),
    pickString(record, ["canonical_source_path", "canonicalSourcePath"]),
    pickString(record, ["markdown_path", "markdownPath", "source_markdown_path", "sourceMarkdownPath"]),
    pickString(record, ["local_md_path", "localMdPath", "local_md", "localMd"]),
    pickString(record, ["pdf_path", "pdfPath", "source_pdf_path", "sourcePdfPath"]),
    pickString(record, ["local_pdf_path", "localPdfPath", "local_pdf", "localPdf"]),
    pickString(record, ["input_path", "inputPath"]),
    pickString(record, ["source_key", "sourceKey"]),
    pickString(record, ["path", "file", "filePath"]),
    pickString(record, ["url", "best_oa_url", "bestOaUrl", "pdf_url", "pdfUrl"]),
    ...asStringArray(record.source_variants),
    ...asStringArray(record.sourceVariants),
  ].filter((item): item is string => Boolean(item)));
}

export function inferPaperSourceKind(sourceHints: string[]): PaperSourceKind {
  for (const hint of sourceHints) {
    if (hint.toLowerCase().endsWith(".md")) {
      return "markdown";
    }
    if (hint.toLowerCase().endsWith(".pdf")) {
      return "pdf";
    }
  }
  return "unknown";
}

function inferPaperSourceKindFromPath(sourcePath: string | null): PaperSourceKind {
  if (!sourcePath) {
    return "unknown";
  }
  if (sourcePath.toLowerCase().endsWith(".md")) {
    return "markdown";
  }
  if (sourcePath.toLowerCase().endsWith(".pdf")) {
    return "pdf";
  }
  return "unknown";
}

export function collectRetrievalProviders(record: Record<string, unknown> | null): string[] {
  if (!record) {
    return [];
  }
  return uniqueStrings(
    [
      pickString(record, ["retrieval_provider", "retrievalProvider"]),
      pickString(record, ["search_provider", "searchProvider"]),
      pickString(record, ["discovered_by", "discoveredBy"]),
      ...asStringArray(record.retrieval_providers),
      ...asStringArray(record.retrievalProviders),
      ...asStringArray(record.search_providers),
      ...asStringArray(record.searchProviders),
      ...asStringArray(record.discovered_by),
      ...asStringArray(record.discoveredBy),
    ]
      .map((item) => normalizeProviderName(item))
      .filter((item): item is string => Boolean(item))
  );
}

export function inferPaperSourceProvider(
  record: Record<string, unknown> | null,
  sourceKind: PaperSourceKind,
  sourceHints: string[]
): string | null {
  const explicit = normalizeProviderName(
    pickString(record ?? {}, [
      "source_provider",
      "sourceProvider",
      "content_provider",
      "contentProvider",
      "provider",
    ])
  );
  if (explicit) {
    return explicit;
  }
  const joinedHints = sourceHints.join(" ").toLowerCase();
  if (joinedHints.includes("huggingface") || joinedHints.includes("/hf/")) {
    return "hf";
  }
  if (joinedHints.includes("arxiv2md")) {
    if (joinedHints.includes("api/markdown") || joinedHints.includes("arxiv2md-api")) {
      return "arxiv2md-api";
    }
    return "arxiv2md";
  }
  if (joinedHints.includes("markxiv")) {
    return "markxiv";
  }
  if (joinedHints.includes("papers.cool")) {
    return sourceKind === "pdf" ? "papers-cool" : "papers-cool";
  }
  if (joinedHints.includes("semanticscholar")) {
    return "semanticscholar";
  }
  if (joinedHints.includes("openalex")) {
    return "openalex";
  }
  if (joinedHints.includes("core.ac.uk")) {
    return "core";
  }
  if (joinedHints.includes("unpaywall")) {
    return "unpaywall";
  }
  if (sourceKind === "pdf") {
    return "pdf";
  }
  return null;
}

export function sourceKindRank(kind: PaperSourceKind): number {
  if (kind === "markdown") return 0;
  if (kind === "pdf") return 1;
  return 2;
}

export function sourceProviderRank(provider: string | null): number {
  const normalized = normalizeProviderName(provider);
  switch (normalized) {
    case "hf":
    case "huggingface":
    case "hugging-face-paper-pages":
      return 0;
    case "arxiv2md-api":
      return 1;
    case "markxiv":
      return 2;
    case "arxiv2md":
      return 3;
    case "openalex":
    case "semanticscholar":
    case "unpaywall":
    case "core":
      return 4;
    case "pdf":
      return 5;
    case "papers-cool":
      return 6;
    case "pasa":
    case "pasa-paper-search":
      return 7;
    default:
      return 10;
  }
}

function normalizePaperVenueType(value: string | null | undefined): PaperVenueType {
  const normalized = normalizeProviderName(value);
  switch (normalized) {
    case "conference":
    case "journal":
    case "preprint":
    case "repository":
      return normalized;
    default:
      return "unknown";
  }
}

function normalizePaperResolutionStatus(value: string | null | undefined): PaperResolutionStatus {
  const normalized = normalizeProviderName(value);
  switch (normalized) {
    case "resolved_markdown":
    case "resolved_pdf":
    case "metadata_only_unresolved":
    case "resolution_failed":
      return normalized;
    default:
      return "unknown";
  }
}

function resolutionStatusRank(value: PaperResolutionStatus): number {
  switch (value) {
    case "resolved_markdown":
      return 0;
    case "resolved_pdf":
      return 1;
    case "metadata_only_unresolved":
      return 2;
    case "resolution_failed":
      return 3;
    default:
      return 4;
  }
}

function normalizeResolutionAttempts(value: unknown): PaperResolutionAttempt[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => {
      const status = normalizeProviderName(pickString(entry, ["status"])) ?? "failed";
      return {
        provider: normalizeProviderName(
          pickString(entry, ["provider", "source_provider", "sourceProvider"])
        ),
        status:
          status === "success" || status === "skipped" ? status : "failed",
        detail: pickString(entry, ["detail", "reason", "message"]),
        at: pickString(entry, ["at", "timestamp", "created_at", "createdAt"]),
        url: pickString(entry, ["url"]),
      };
    });
}

function inferPaperResolutionStatus(params: {
  record: Record<string, unknown> | null;
  sourceKind: PaperSourceKind;
  sourcePath: string | null;
}): PaperResolutionStatus {
  const explicit = normalizePaperResolutionStatus(
    pickString(params.record ?? {}, ["resolution_status", "resolutionStatus"])
  );
  if (explicit !== "unknown") {
    return explicit;
  }
  if (params.sourceKind === "markdown" || params.sourcePath?.toLowerCase().endsWith(".md")) {
    return "resolved_markdown";
  }
  if (params.sourceKind === "pdf" || params.sourcePath?.toLowerCase().endsWith(".pdf")) {
    return "resolved_pdf";
  }
  return "unknown";
}

export function buildCanonicalPaperRecordFromRecord(
  rawValue: unknown,
  fallbackCanonicalId?: string
): CanonicalPaperRecord | null {
  const raw = asRecord(rawValue);
  if (!raw) {
    return null;
  }
  const sourceHints = collectSourceHints(raw);
  const sourcePath =
    pickString(raw, [
      "source_path",
      "sourcePath",
      "canonical_source_path",
      "canonicalSourcePath",
      "markdown_path",
      "markdownPath",
      "local_md_path",
      "localMdPath",
      "local_md",
      "localMd",
      "pdf_path",
      "pdfPath",
      "local_pdf_path",
      "localPdfPath",
      "local_pdf",
      "localPdf",
      "path",
      "file",
      "filePath",
    ]) ?? null;
  const resolvedLocalSourcePath = sourcePath && !isRemoteEndpointLike(sourcePath) ? sourcePath : null;
  const title =
    pickString(raw, ["title", "paper_title", "paperTitle", "name"]) ??
    (sourcePath ? path.basename(sourcePath, path.extname(sourcePath)) : null) ??
    (sourceHints.length > 0 ? path.basename(sourceHints[0], path.extname(sourceHints[0])) : null);
  const arxivId =
    normalizeArxivId(pickString(raw, ["arxiv_id", "arxivId", "arxiv"])) ??
    normalizeArxivId(sourceHints.find((hint) => Boolean(normalizeArxivId(hint))) ?? null) ??
    normalizeArxivId(fallbackCanonicalId) ??
    null;
  const doi =
    normalizeDoi(pickString(raw, ["doi", "doi_url", "doiUrl"])) ??
    normalizeDoi(sourceHints.find((hint) => Boolean(normalizeDoi(hint))) ?? null) ??
    normalizeDoi(fallbackCanonicalId) ??
    null;
  const pmid =
    normalizePmid(pickString(raw, ["pmid", "pubmed_id", "pubmedId"])) ??
    normalizePmid(fallbackCanonicalId) ??
    null;
  const pmcid =
    normalizePmcid(pickString(raw, ["pmcid", "pmc_id", "pmcId"])) ??
    normalizePmcid(fallbackCanonicalId) ??
    null;
  const normalizedTitle =
    pickString(raw, ["normalized_title", "normalizedTitle"]) ??
    normalizeTitle(title) ??
    normalizeTitle(fallbackCanonicalId) ??
    (sourceHints.length > 0 ? normalizeTitle(sourceHints[0]) : null);
  const canonicalId =
    pickString(raw, ["canonical_id", "canonicalId", "id", "paper_id", "paperId"]) ??
    (arxivId ? `arxiv:${arxivId}` : null) ??
    (doi ? `doi:${doi}` : null) ??
    (pmid ? `pmid:${pmid}` : null) ??
    (pmcid ? `pmcid:${pmcid}` : null) ??
    (normalizedTitle ? `title:${normalizedTitle}` : null) ??
    fallbackCanonicalId ??
    null;
  if (!canonicalId && !title && sourceHints.length === 0) {
    return null;
  }
  const sourceKind = inferPaperSourceKindFromPath(resolvedLocalSourcePath);
  const sourceProvider = inferPaperSourceProvider(raw, sourceKind, sourceHints);
  const sourcePathResolved = resolvedLocalSourcePath;
  const resolutionStatus = inferPaperResolutionStatus({
    record: raw,
    sourceKind,
    sourcePath: sourcePathResolved,
  });
  return {
    canonicalId: canonicalId ?? `title:${normalizedTitle ?? "unknown"}`,
    title,
    normalizedTitle,
    titleSignature:
      pickString(raw, ["title_signature", "titleSignature"]) ??
      buildTitleSignature(title) ??
      buildTitleSignature(sourceHints[0]) ??
      null,
    arxivId,
    doi,
    pmid,
    pmcid,
    year: (() => {
      const year = pickNumber(raw, ["year", "publication_year", "publicationYear"]);
      return typeof year === "number" && year >= 1900 && year <= 9999 ? Math.floor(year) : null;
    })(),
    venue:
      pickString(raw, ["venue", "conference", "journal", "container_title", "containerTitle"]) ??
      null,
    venueFamily: pickString(raw, ["venue_family", "venueFamily"]),
    venueType: normalizePaperVenueType(
      pickString(raw, ["venue_type", "venueType", "source_type", "sourceType"])
    ),
    venuePackHits: asStringArray(raw.venue_pack_hits ?? raw.venuePackHits),
    venueAliasesMatched: asStringArray(
      raw.venue_aliases_matched ?? raw.venueAliasesMatched
    ),
    sourceHints,
    sourceKind,
    sourceProvider,
    sourcePath: sourcePathResolved,
    retrievalProviders: collectRetrievalProviders(raw),
    citationCount: (() => {
      const count = pickNumber(raw, ["citation_count", "citationCount", "cited_by_count", "citedByCount"]);
      return typeof count === "number" && count >= 0 ? Math.floor(count) : null;
    })(),
    bestOaUrl: pickString(raw, ["best_oa_url", "bestOaUrl", "oa_url", "oaUrl", "open_access_url"]),
    pdfUrl: pickString(raw, ["pdf_url", "pdfUrl", "url_for_pdf"]),
    resolutionStatus,
    resolutionAttempts: normalizeResolutionAttempts(
      raw.resolution_attempts ?? raw.resolutionAttempts
    ),
  };
}

export function mergeCanonicalPaperRecords(
  target: CanonicalPaperRecord,
  incoming: CanonicalPaperRecord
): CanonicalPaperRecord {
  const incomingPreferred =
    sourceKindRank(incoming.sourceKind) < sourceKindRank(target.sourceKind) ||
    (sourceKindRank(incoming.sourceKind) === sourceKindRank(target.sourceKind) &&
      sourceProviderRank(incoming.sourceProvider) < sourceProviderRank(target.sourceProvider));
  return {
    canonicalId: target.canonicalId,
    title: target.title ?? incoming.title,
    normalizedTitle: target.normalizedTitle ?? incoming.normalizedTitle,
    titleSignature: target.titleSignature ?? incoming.titleSignature,
    arxivId: target.arxivId ?? incoming.arxivId,
    doi: target.doi ?? incoming.doi,
    pmid: target.pmid ?? incoming.pmid,
    pmcid: target.pmcid ?? incoming.pmcid,
    year: target.year ?? incoming.year,
    venue: target.venue ?? incoming.venue,
    venueFamily: target.venueFamily ?? incoming.venueFamily,
    venueType:
      target.venueType !== "unknown" ? target.venueType : incoming.venueType,
    venuePackHits: uniqueStrings([...target.venuePackHits, ...incoming.venuePackHits]),
    venueAliasesMatched: uniqueStrings([
      ...target.venueAliasesMatched,
      ...incoming.venueAliasesMatched,
    ]),
    sourceHints: uniqueStrings([...target.sourceHints, ...incoming.sourceHints]),
    sourceKind: incomingPreferred ? incoming.sourceKind : target.sourceKind,
    sourceProvider: incomingPreferred
      ? incoming.sourceProvider ?? target.sourceProvider
      : target.sourceProvider ?? incoming.sourceProvider,
    sourcePath: incomingPreferred
      ? incoming.sourcePath ?? target.sourcePath
      : target.sourcePath ?? incoming.sourcePath,
    retrievalProviders: uniqueStrings([
      ...target.retrievalProviders,
      ...incoming.retrievalProviders,
    ]),
    citationCount:
      target.citationCount != null && incoming.citationCount != null
        ? Math.max(target.citationCount, incoming.citationCount)
        : target.citationCount ?? incoming.citationCount,
    bestOaUrl: target.bestOaUrl ?? incoming.bestOaUrl,
    pdfUrl: target.pdfUrl ?? incoming.pdfUrl,
    resolutionStatus:
      resolutionStatusRank(incoming.resolutionStatus) <
      resolutionStatusRank(target.resolutionStatus)
        ? incoming.resolutionStatus
        : target.resolutionStatus,
    resolutionAttempts: [
      ...target.resolutionAttempts,
      ...incoming.resolutionAttempts,
    ],
  };
}

export function serializeCanonicalPaperRecord(
  record: CanonicalPaperRecord
): Record<string, unknown> {
  return {
    canonical_id: record.canonicalId,
    title: record.title,
    normalized_title: record.normalizedTitle,
    title_signature: record.titleSignature,
    arxiv_id: record.arxivId,
    doi: record.doi,
    pmid: record.pmid,
    pmcid: record.pmcid,
    year: record.year,
    venue: record.venue,
    venue_family: record.venueFamily,
    venue_type: record.venueType,
    venue_pack_hits: record.venuePackHits,
    venue_aliases_matched: record.venueAliasesMatched,
    source_kind: record.sourceKind,
    source_provider: record.sourceProvider,
    source_path: record.sourcePath,
    retrieval_providers: record.retrievalProviders,
    citation_count: record.citationCount,
    best_oa_url: record.bestOaUrl,
    pdf_url: record.pdfUrl,
    resolution_status: record.resolutionStatus,
    resolution_attempts: record.resolutionAttempts.map((entry) => ({
      provider: entry.provider,
      status: entry.status,
      detail: entry.detail,
      at: entry.at,
      url: entry.url,
    })),
  };
}
