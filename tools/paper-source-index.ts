import * as path from "node:path";
import { readJsonIfExists } from "./workflow-guard-core/fs";
import { asString } from "./workflow-guard-core/coercion";

export type WorkflowPaperSourceEntry = {
  canonicalId: string | null;
  title: string | null;
  normalizedTitle: string | null;
  arxivId: string | null;
  doi: string | null;
  year: number | null;
  venue: string | null;
  sourceKind: "markdown" | "pdf" | "unknown";
  sourceProvider: string | null;
  retrievalProviders: string[];
  sourcePath: string | null;
  citationCount: number | null;
};

const PAPER_SOURCE_INDEX_CANDIDATE_KEYS = [
  "papers",
  "entries",
  "items",
  "sources",
  "canonical_papers",
  "canonicalPapers",
];

const ARXIV_ID_REGEX = /\b(?:[a-z-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?\b/i;
const DOI_REGEX = /\b10\.\d{4,9}\/[-._;()/:a-z0-9]+\b/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => asString(value)).filter(Boolean))] as string[];
}

function pickString(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function pickNumber(record: Record<string, unknown> | null, keys: string[]): number | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(value.map((entry) => asString(entry)));
}

function normalizeArxivId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(ARXIV_ID_REGEX);
  if (!match?.[0]) {
    return null;
  }
  return match[0].toLowerCase().replace(/v\d+$/i, "");
}

function normalizeDoi(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(DOI_REGEX);
  return match?.[0]?.toLowerCase() ?? null;
}

function normalizeTitle(value: string | null | undefined): string | null {
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

function normalizeSourceKind(value: string | null | undefined): WorkflowPaperSourceEntry["sourceKind"] {
  const normalized = asString(value)?.toLowerCase() ?? null;
  if (normalized === "markdown" || normalized === "md") {
    return "markdown";
  }
  if (normalized === "pdf") {
    return "pdf";
  }
  return "unknown";
}

function inferSourceKind(record: Record<string, unknown> | null, sourcePath: string | null) {
  const explicit = normalizeSourceKind(
    pickString(record, ["source_kind", "sourceKind", "kind"])
  );
  if (explicit !== "unknown") {
    return explicit;
  }
  if (sourcePath?.toLowerCase().endsWith(".md")) {
    return "markdown" as const;
  }
  if (sourcePath?.toLowerCase().endsWith(".pdf")) {
    return "pdf" as const;
  }
  return "unknown" as const;
}

export function normalizeWorkflowPaperSourceEntry(
  value: unknown
): WorkflowPaperSourceEntry {
  const record = asRecord(value);
  const sourcePath =
    pickString(record, [
      "source_path",
      "sourcePath",
      "canonical_source_path",
      "canonicalSourcePath",
      "markdown_path",
      "markdownPath",
      "pdf_path",
      "pdfPath",
      "path",
      "file",
      "filePath",
    ]) ?? null;
  const title =
    pickString(record, ["title", "paper_title", "paperTitle", "name"]) ??
    (sourcePath ? path.basename(sourcePath, path.extname(sourcePath)) : null);
  return {
    canonicalId:
      pickString(record, ["canonical_id", "canonicalId", "paper_id", "paperId", "id"]) ??
      null,
    title,
    normalizedTitle:
      pickString(record, ["normalized_title", "normalizedTitle"]) ?? normalizeTitle(title),
    arxivId: normalizeArxivId(
      pickString(record, ["arxiv_id", "arxivId", "arxiv", "paper_id", "paperId"])
    ),
    doi: normalizeDoi(pickString(record, ["doi", "doi_url", "doiUrl"])),
    year: (() => {
      const year = pickNumber(record, ["year", "publication_year", "publicationYear"]);
      return typeof year === "number" && year >= 1900 && year <= 9999 ? Math.floor(year) : null;
    })(),
    venue: pickString(record, ["venue", "conference", "journal"]),
    sourceKind: inferSourceKind(record, sourcePath),
    sourceProvider: pickString(record, ["source_provider", "sourceProvider", "provider"]),
    retrievalProviders: uniqueStrings([
      ...asStringArray(record?.retrieval_providers),
      ...asStringArray(record?.retrievalProviders),
      ...asStringArray(record?.search_providers),
      ...asStringArray(record?.searchProviders),
      pickString(record, ["retrieval_provider", "retrievalProvider"]),
      pickString(record, ["search_provider", "searchProvider"]),
      pickString(record, ["discovered_by", "discoveredBy"]),
    ]),
    sourcePath,
    citationCount: (() => {
      const count = pickNumber(record, ["citation_count", "citationCount"]);
      return typeof count === "number" && count >= 0 ? Math.floor(count) : null;
    })(),
  };
}

export function parseWorkflowPaperSourceIndex(raw: unknown): WorkflowPaperSourceEntry[] {
  if (Array.isArray(raw)) {
    return raw.map((entry) => normalizeWorkflowPaperSourceEntry(entry));
  }
  const record = asRecord(raw);
  if (!record) {
    return [];
  }
  for (const key of PAPER_SOURCE_INDEX_CANDIDATE_KEYS) {
    if (Array.isArray(record[key])) {
      return (record[key] as unknown[]).map((entry) =>
        normalizeWorkflowPaperSourceEntry(entry)
      );
    }
  }
  for (const key of PAPER_SOURCE_INDEX_CANDIDATE_KEYS) {
    const nested = asRecord(record[key]);
    if (!nested) {
      continue;
    }
    return Object.entries(nested)
      .filter(([, value]) => value && typeof value === "object" && !Array.isArray(value))
      .map(([candidateKey, value]) => {
        const normalized = normalizeWorkflowPaperSourceEntry(value);
        return {
          ...normalized,
          canonicalId: normalized.canonicalId ?? candidateKey,
        };
      });
  }
  return [];
}

export async function readWorkflowPaperSourceIndex(params: {
  projectRoot: string;
}): Promise<{
  entries: WorkflowPaperSourceEntry[];
  sourceIndexPath: string;
}> {
  const sourceIndexPath = path.join(params.projectRoot, "researcher", "PAPER_SOURCE_INDEX.json");
  const raw = await readJsonIfExists<unknown>(sourceIndexPath);
  return {
    entries: parseWorkflowPaperSourceIndex(raw),
    sourceIndexPath,
  };
}
