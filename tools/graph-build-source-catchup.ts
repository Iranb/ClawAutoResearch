import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  asRecord,
  normalizeStage,
  pickString,
  uniqueStrings,
} from "./workflow-guard-core/coercion";
import {
  pathExists,
  readJsonIfExists,
  writeJsonAtomicEnsured,
  writeTextEnsured,
} from "./workflow-guard-core/fs";
import {
  buildCanonicalPaperRecordFromRecord,
  normalizeTitle,
  normalizeArxivId,
  PAPER_SOURCE_PATH_KEYS,
  resolvePaperSourcePathCandidates,
  type CanonicalPaperRecord,
} from "./paper-source-contract";
import {
  resolvePaperSourceIndexPath,
  upsertPaperSourceIndexEntries,
} from "./paper-source-index-writer";
import {
  normalizePaperIngestionState,
} from "./workflow-guard-state/paper-ingestion";
import { setPaperIngestionState } from "./workflow-guard-setters/ingestion-state-setters";
import {
  resolvePapernexusSharedCorpusFallback,
  resolveWorkflowSharedPapernexusCorpus,
  shouldAutodiscoverRemotePapernexusCorpus,
} from "./papernexus-shared-corpus";
import { buildPapernexusBatchImportCommandText } from "./papernexus-batch-executor.js";

type FetchResponseLike = {
  ok: boolean;
  status: number;
  statusText?: string;
  headers?: {
    get(name: string): string | null;
  };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

type FetchLike = (
  url: string,
  init?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
  }
) => Promise<FetchResponseLike>;

type PaperSourceKind = "markdown" | "pdf";

type SourceIndexRawEntry = {
  key: string | null;
  record: Record<string, unknown>;
  paper: CanonicalPaperRecord;
  plannedPath: string | null;
};

type MaterializedPaperSource = {
  canonicalId: string;
  title: string | null;
  arxivId: string;
  sourceKind: PaperSourceKind;
  sourceProvider: string;
  sourcePath: string;
  sourceRelativePath: string;
  sourceUrl: string | null;
  existing: boolean;
  attempts: PaperSourceFetchAttempt[];
};

export type PaperSourceFetchAttempt = {
  provider: string;
  status: "success" | "failed" | "skipped";
  detail: string | null;
  at: string;
  url: string | null;
};

export type GraphBuildSourceCatchupResult = {
  attempted: boolean;
  queued: boolean;
  skippedReason: string | null;
  sourceIndexPath: string | null;
  materializedPaperCount: number;
  requestId: string | null;
  batchManifestPath: string | null;
  errors: string[];
  attempts: PaperSourceFetchAttempt[];
};

const PAPER_SOURCE_INDEX_CANDIDATE_KEYS = [
  "papers",
  "entries",
  "items",
  "sources",
  "canonical_papers",
  "canonicalPapers",
] as const;

const IN_FLIGHT_PAPER_INGESTION_REQUEST_STATUSES = new Set([
  "queued",
  "launching",
  "running",
]);

const ACTIVE_PAPER_INGESTION_REQUEST_STATUSES = new Set([
  ...IN_FLIGHT_PAPER_INGESTION_REQUEST_STATUSES,
]);

const COMPLETED_PAPER_INGESTION_REQUEST_STATUSES = new Set([
  "completed",
  "succeeded",
  "success",
]);

const CATCHUP_TRIGGER_IMPORT_STATUSES = new Set([
  "pending",
  "queued",
  "unresolved",
  "metadata_only_unresolved",
  "resolution_failed",
]);

const DEFAULT_FETCH_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_PAPERS = 8;
const FAILURE_COOLDOWN_MS = 10 * 60 * 1000;
const DEFAULT_BOOTSTRAP_TITLE_RESOLVE_TIMEOUT_MS = 15_000;
const MAX_BOOTSTRAP_TITLE_RESOLUTION_ATTEMPTS = 4;

function hasExplicitMissingGraphPresence(manifest: Record<string, unknown>): boolean {
  const paperIngestion = asRecord(manifest.paper_ingestion);
  const graphPresenceStatus = normalizeStage(
    paperIngestion?.graph_presence_status ?? paperIngestion?.graphPresenceStatus
  );
  return Boolean(graphPresenceStatus && graphPresenceStatus !== "ready");
}

type BootstrapSourceSeed = {
  arxivId: string;
  title: string;
  sourceProvider: string;
  sourceUrl: string | null;
  detail: string;
};

function getCatchupReportPath(projectRoot: string): string {
  return path.join(projectRoot, "graph", "GRAPH_BUILD_SOURCE_CATCHUP.json");
}

function collectRawSourceIndexEntries(raw: unknown): Array<{
  key: string | null;
  value: unknown;
}> {
  if (Array.isArray(raw)) {
    return raw.map((value) => ({ key: null, value }));
  }
  const record = asRecord(raw);
  if (!record) {
    return [];
  }
  for (const key of PAPER_SOURCE_INDEX_CANDIDATE_KEYS) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.map((entry) => ({ key: null, value: entry }));
    }
    const nested = asRecord(value);
    if (nested) {
      return Object.entries(nested).map(([entryKey, entryValue]) => ({
        key: entryKey,
        value: entryValue,
      }));
    }
  }
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}

function collectSourceIndexEntries(raw: unknown): SourceIndexRawEntry[] {
  const entries: SourceIndexRawEntry[] = [];
  for (const entry of collectRawSourceIndexEntries(raw)) {
    const record = asRecord(entry.value);
    if (!record) {
      continue;
    }
    const paper = buildCanonicalPaperRecordFromRecord(record, entry.key ?? undefined);
    if (!paper) {
      continue;
    }
    entries.push({
      key: entry.key,
      record,
      paper,
      plannedPath: pickString(record, [...PAPER_SOURCE_PATH_KEYS]),
    });
  }
  return entries;
}

function inferSourceKindFromPath(value: string | null): PaperSourceKind | null {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.endsWith(".md")) {
    return "markdown";
  }
  if (normalized.endsWith(".pdf")) {
    return "pdf";
  }
  return null;
}

async function listStagedSourceFiles(params: {
  dirPath: string;
  extension: ".md" | ".pdf";
}): Promise<string[]> {
  try {
    const entries = await fs.readdir(params.dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(params.extension))
      .map((entry) => path.join(params.dirPath, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : null;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function extractMarkdownTitle(content: string, fallback: string): string {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = lines.find((line) => /^#{1,3}\s+\S/.test(line));
  if (heading) {
    return heading.replace(/^#{1,3}\s+/, "").trim() || fallback;
  }
  const abstractIndex = lines.findIndex((line) => /^abstract\b/i.test(line));
  const titleLines = (abstractIndex > 0 ? lines.slice(0, abstractIndex) : lines)
    .filter((line) => !/^(authors?|keywords?|arxiv|http|www\.|\{|\})\b/i.test(line))
    .slice(0, 2);
  return titleLines.join(" ").trim() || fallback;
}

async function buildRecoveredSourceIndexEntriesFromPaperStaging(params: {
  projectRoot: string;
  now: string;
}): Promise<Record<string, unknown>[]> {
  const stagingRoot = path.join(params.projectRoot, "researcher", "paper-staging");
  const markdownFiles = await listStagedSourceFiles({
    dirPath: path.join(stagingRoot, "md"),
    extension: ".md",
  });
  const pdfFiles = await listStagedSourceFiles({
    dirPath: path.join(stagingRoot, "pdf"),
    extension: ".pdf",
  });
  const recovered: Record<string, unknown>[] = [];
  for (const filePath of markdownFiles) {
    const arxivId =
      normalizeArxivId(path.basename(filePath, path.extname(filePath))) ??
      normalizeArxivId(filePath);
    if (!arxivId) {
      continue;
    }
    const content = await fs.readFile(filePath, "utf8");
    const invalidReason = buildMarkdownValidationFailure(content);
    if (invalidReason) {
      continue;
    }
    const sourceRelativePath = relativizeProjectPath(params.projectRoot, filePath);
    recovered.push({
      canonical_id: `arxiv:${arxivId}`,
      arxiv_id: arxivId,
      title: extractMarkdownTitle(content, arxivId),
      source_kind: "markdown",
      source_provider: "filesystem",
      source_path: sourceRelativePath,
      retrieval_providers: ["paper-staging", "graph-build-source-catchup"],
      resolution_status: "resolved_markdown",
      resolution_attempts: [
        buildFetchAttempt({
          provider: "filesystem",
          status: "success",
          detail:
            "Recovered a substantive project-local Markdown source from researcher/paper-staging because PAPER_SOURCE_INDEX.json was missing.",
          at: params.now,
          url: filePath,
        }),
      ],
    });
  }
  for (const filePath of pdfFiles) {
    const arxivId =
      normalizeArxivId(path.basename(filePath, path.extname(filePath))) ??
      normalizeArxivId(filePath);
    if (!arxivId) {
      continue;
    }
    const data = await fs.readFile(filePath);
    const invalidReason = buildPdfValidationFailure(null, data);
    if (invalidReason) {
      continue;
    }
    const sourceRelativePath = relativizeProjectPath(params.projectRoot, filePath);
    recovered.push({
      canonical_id: `arxiv:${arxivId}`,
      arxiv_id: arxivId,
      title: arxivId,
      source_kind: "pdf",
      source_provider: "filesystem",
      source_path: sourceRelativePath,
      retrieval_providers: ["paper-staging", "graph-build-source-catchup"],
      resolution_status: "resolved_pdf",
      resolution_attempts: [
        buildFetchAttempt({
          provider: "filesystem",
          status: "success",
          detail:
            "Recovered a substantive project-local PDF source from researcher/paper-staging because PAPER_SOURCE_INDEX.json was missing.",
          at: params.now,
          url: filePath,
        }),
      ],
    });
  }
  return recovered;
}

function collectManifestBootstrapTopicTexts(manifest: Record<string, unknown>): string[] {
  const researchProgram = asRecord(manifest.research_program) ?? {};
  const request = asRecord(manifest.request) ?? {};
  const input = asRecord(manifest.input) ?? {};
  const problem = asRecord(manifest.problem) ?? {};
  return uniqueStrings(
    [
      pickString(manifest, [
        "topic",
        "initial_topic",
        "initialTopic",
        "research_topic",
        "researchTopic",
        "goal",
        "problem_statement",
        "problemStatement",
        "title",
      ]),
      pickString(researchProgram, [
        "topic",
        "goal",
        "problem_statement",
        "problemStatement",
        "seed_topic",
        "seedTopic",
        "title",
      ]),
      pickString(request, ["topic", "goal", "prompt", "query", "title"]),
      pickString(input, ["topic", "goal", "prompt", "query", "title"]),
      pickString(problem, ["topic", "statement", "problem_statement", "problemStatement"]),
    ].filter((entry): entry is string => Boolean(entry && entry.trim()))
  );
}

function collectArxivIdsFromText(value: string): string[] {
  const matches =
    value.match(/\b(?:[a-z-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?\b/gi) ?? [];
  return uniqueStrings(
    matches
      .map((match) => normalizeArxivId(match))
      .filter((entry): entry is string => Boolean(entry))
  );
}

function cleanBootstrapTitleCandidate(value: string): string | null {
  const cleaned = value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\barxiv(?:\s*[:#]|\s+id)?\s*\d{4}\.\d{4,5}(?:v\d+)?\b/gi, " ")
    .replace(/[^\x20-\x7e]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s"'`()[\]{}:;,.<>-]+|[\s"'`()[\]{}:;,.<>-]+$/g, "")
    .replace(/^(?:use|using|based on|from|about|paper titled|titled|title)\s+/i, "")
    .trim();
  if (!cleaned || cleaned.length < 20 || cleaned.length > 260) {
    return null;
  }
  const tokens = cleaned.match(/[A-Za-z][A-Za-z0-9-]*/g) ?? [];
  if (tokens.length < 4) {
    return null;
  }
  const normalized = normalizeTitle(cleaned);
  if (!normalized || normalized.split(" ").length < 4) {
    return null;
  }
  return cleaned;
}

function collectBootstrapTitleCandidatesFromText(value: string): string[] {
  const candidates: string[] = [];
  for (const match of value.matchAll(/[“"《](.{12,260}?)[”"》]/g)) {
    if (match[1]) {
      candidates.push(match[1]);
    }
  }
  const paperReferenceIndex = value.search(
    /(?:这篇论文|这篇文章|这篇paper|this\s+paper|the\s+paper)/i
  );
  if (paperReferenceIndex > 0) {
    candidates.push(value.slice(0, paperReferenceIndex));
  }
  const leadingLatin = value.match(/^\s*([A-Za-z0-9][A-Za-z0-9\s:;,.'()[\]/-]{20,260})/);
  if (leadingLatin?.[1]) {
    candidates.push(leadingLatin[1]);
  }
  const uppercaseLead = value.match(/\b([A-Z][A-Z0-9][A-Z0-9\s:;,.'()[\]/-]{20,240}[A-Z0-9])\b/);
  if (uppercaseLead?.[1]) {
    candidates.push(uppercaseLead[1]);
  }
  return uniqueStrings(
    candidates
      .map((candidate) => cleanBootstrapTitleCandidate(candidate))
      .filter((candidate): candidate is string => Boolean(candidate))
  );
}

function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractXmlTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1] ? decodeXmlText(match[1]) : null;
}

function parseArxivApiEntries(xml: string): Array<{
  arxivId: string;
  title: string;
  sourceUrl: string;
}> {
  return (xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [])
    .map((block) => {
      const idText = extractXmlTag(block, "id");
      const arxivId = normalizeArxivId(idText ?? "");
      const title = extractXmlTag(block, "title");
      if (!arxivId || !title) {
        return null;
      }
      return {
        arxivId,
        title,
        sourceUrl: `https://arxiv.org/abs/${arxivId}`,
      };
    })
    .filter((entry): entry is { arxivId: string; title: string; sourceUrl: string } =>
      Boolean(entry)
    );
}

const TITLE_MATCH_STOPWORDS = new Set([
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
  "why",
  "than",
  "better",
]);

function titleMatchTokens(value: string): string[] {
  return uniqueStrings(
    (normalizeTitle(value)?.split(" ") ?? []).filter(
      (token) => token.length >= 3 && !TITLE_MATCH_STOPWORDS.has(token)
    )
  );
}

function isLikelyMatchingArxivTitle(queryTitle: string, resultTitle: string): boolean {
  const normalizedQuery = normalizeTitle(queryTitle);
  const normalizedResult = normalizeTitle(resultTitle);
  if (!normalizedQuery || !normalizedResult) {
    return false;
  }
  if (normalizedQuery === normalizedResult) {
    return true;
  }
  if (
    normalizedQuery.length >= 24 &&
    (normalizedResult.includes(normalizedQuery) || normalizedQuery.includes(normalizedResult))
  ) {
    return true;
  }
  const queryTokens = titleMatchTokens(normalizedQuery);
  const resultTokens = new Set(titleMatchTokens(normalizedResult));
  if (queryTokens.length < 4 || resultTokens.size < 4) {
    return false;
  }
  const matched = queryTokens.filter((token) => resultTokens.has(token)).length;
  return matched / queryTokens.length >= 0.75 && matched >= Math.min(5, queryTokens.length);
}

async function resolveArxivTitleSeed(params: {
  fetchImpl: FetchLike;
  title: string;
  timeoutMs: number;
  now: string;
}): Promise<{
  seed: BootstrapSourceSeed | null;
  attempt: PaperSourceFetchAttempt;
}> {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", `ti:"${params.title.replace(/"/g, " ")}"`);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", "5");
  try {
    const response = await params.fetchImpl(url.toString(), {
      headers: {
        "User-Agent": "ClawAutoResearch graph-build-source-catchup",
        Accept: "application/atom+xml,text/xml;q=0.9,*/*;q=0.5",
      },
      signal: AbortSignal.timeout(params.timeoutMs),
    });
    if (!response.ok) {
      return {
        seed: null,
        attempt: buildFetchAttempt({
          provider: "arxiv-api",
          status: "failed",
          detail: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
          at: params.now,
          url: url.toString(),
        }),
      };
    }
    const entries = parseArxivApiEntries(await response.text());
    const matched = entries.find((entry) =>
      isLikelyMatchingArxivTitle(params.title, entry.title)
    );
    if (!matched) {
      return {
        seed: null,
        attempt: buildFetchAttempt({
          provider: "arxiv-api",
          status: "skipped",
          detail: `No arXiv title result matched bootstrap title: ${params.title}`,
          at: params.now,
          url: url.toString(),
        }),
      };
    }
    return {
      seed: {
        arxivId: matched.arxivId,
        title: matched.title,
        sourceProvider: "arxiv-api",
        sourceUrl: matched.sourceUrl,
        detail: `Resolved bootstrap title to arXiv:${matched.arxivId}.`,
      },
      attempt: buildFetchAttempt({
        provider: "arxiv-api",
        status: "success",
        detail: `Resolved bootstrap title to arXiv:${matched.arxivId}.`,
        at: params.now,
        url: url.toString(),
      }),
    };
  } catch (error) {
    return {
      seed: null,
      attempt: buildFetchAttempt({
        provider: "arxiv-api",
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
        at: params.now,
        url: url.toString(),
      }),
    };
  }
}

function buildBootstrapSourceIndexEntry(params: {
  seed: BootstrapSourceSeed;
  now: string;
}): Record<string, unknown> {
  const sourceUrl = params.seed.sourceUrl ?? `https://arxiv.org/abs/${params.seed.arxivId}`;
  return {
    canonical_id: `arxiv:${params.seed.arxivId}`,
    arxiv_id: params.seed.arxivId,
    title: params.seed.title,
    source_provider: params.seed.sourceProvider,
    retrieval_providers: uniqueStrings([
      "bootstrap-topic",
      params.seed.sourceProvider,
      "graph-build-source-catchup",
    ]),
    staging_path: path.join(
      "researcher",
      "paper-staging",
      "md",
      `${sanitizeArxivFileStem(params.seed.arxivId)}.md`
    ),
    best_oa_url: sourceUrl,
    pdf_url: `https://arxiv.org/pdf/${params.seed.arxivId}`,
    resolution_status: "metadata_only_unresolved",
    resolution_attempts: [
      buildFetchAttempt({
        provider: params.seed.sourceProvider,
        status: "success",
        detail: params.seed.detail,
        at: params.now,
        url: sourceUrl,
      }),
    ],
  };
}

async function buildBootstrapSourceIndexEntriesFromManifest(params: {
  manifest: Record<string, unknown>;
  fetchImpl: FetchLike | null;
  timeoutMs: number;
  now: string;
}): Promise<{
  entries: Record<string, unknown>[];
  attempts: PaperSourceFetchAttempt[];
}> {
  const texts = collectManifestBootstrapTopicTexts(params.manifest);
  const seedsByArxivId = new Map<string, BootstrapSourceSeed>();
  const attempts: PaperSourceFetchAttempt[] = [];

  for (const text of texts) {
    const title = collectBootstrapTitleCandidatesFromText(text)[0] ?? null;
    for (const arxivId of collectArxivIdsFromText(text)) {
      seedsByArxivId.set(arxivId, {
        arxivId,
        title: title ?? arxivId,
        sourceProvider: "bootstrap-topic",
        sourceUrl: `https://arxiv.org/abs/${arxivId}`,
        detail: "Recovered an arXiv identifier directly from the project bootstrap topic.",
      });
    }
  }

  if (params.fetchImpl) {
    const titleCandidates = uniqueStrings(
      texts.flatMap((text) => collectBootstrapTitleCandidatesFromText(text))
    ).slice(0, MAX_BOOTSTRAP_TITLE_RESOLUTION_ATTEMPTS);
    for (const title of titleCandidates) {
      const resolved = await resolveArxivTitleSeed({
        fetchImpl: params.fetchImpl,
        title,
        timeoutMs: params.timeoutMs,
        now: params.now,
      });
      attempts.push(resolved.attempt);
      if (resolved.seed && !seedsByArxivId.has(resolved.seed.arxivId)) {
        seedsByArxivId.set(resolved.seed.arxivId, resolved.seed);
      }
    }
  }

  return {
    entries: [...seedsByArxivId.values()].map((seed) =>
      buildBootstrapSourceIndexEntry({
        seed,
        now: params.now,
      })
    ),
    attempts,
  };
}

function relativizeProjectPath(projectRoot: string, targetPath: string): string {
  const relative = path.relative(projectRoot, targetPath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative
    : targetPath;
}

function resolveProjectSourcePath(projectRoot: string, value: string | null): string | null {
  return (
    resolvePaperSourcePathCandidates({
      projectRoot,
      sourcePath: value,
    })[0] ?? null
  );
}

async function findExistingSource(params: {
  projectRoot: string;
  entry: SourceIndexRawEntry;
}): Promise<{
  sourcePath: string;
  sourceRelativePath: string;
  sourceKind: PaperSourceKind;
} | null> {
  const candidates = uniqueStrings([
    ...PAPER_SOURCE_PATH_KEYS.map((key) => pickString(params.entry.record, [key])),
    ...params.entry.paper.sourceHints,
  ].filter((item): item is string => Boolean(item)));
  for (const candidate of candidates) {
    for (const resolved of resolvePaperSourcePathCandidates({
      projectRoot: params.projectRoot,
      sourcePath: candidate,
    })) {
      const kind = inferSourceKindFromPath(resolved);
      if (!kind) {
        continue;
      }
      if (!(await pathExists(resolved))) {
        continue;
      }
      return {
        sourcePath: resolved,
        sourceRelativePath: relativizeProjectPath(params.projectRoot, resolved),
        sourceKind: kind,
      };
    }
  }
  return null;
}

function shouldCatchUpEntry(entry: SourceIndexRawEntry): boolean {
  const arxivId =
    entry.paper.arxivId ??
    normalizeArxivId(pickString(entry.record, ["canonical_id", "canonicalId"])) ??
    null;
  if (!arxivId) {
    return false;
  }
  const importStatus = normalizeStage(
    pickString(entry.record, ["import_status", "importStatus"]) ??
      pickString(entry.record, ["resolution_status", "resolutionStatus"])
  );
  return Boolean(
    entry.plannedPath ||
      (importStatus && CATCHUP_TRIGGER_IMPORT_STATUSES.has(importStatus))
  );
}

function sanitizeArxivFileStem(arxivId: string): string {
  return arxivId.replace(/[^a-z0-9.]+/gi, "-").replace(/^-+|-+$/g, "") || "paper";
}

function resolveMaterializedSourcePath(params: {
  projectRoot: string;
  plannedPath: string | null;
  arxivId: string;
  sourceKind: PaperSourceKind;
}): {
  sourcePath: string;
  sourceRelativePath: string;
} {
  const plannedKind = inferSourceKindFromPath(params.plannedPath);
  const plannedResolved =
    plannedKind === params.sourceKind
      ? resolveProjectSourcePath(params.projectRoot, params.plannedPath)
      : null;
  if (plannedResolved) {
    return {
      sourcePath: plannedResolved,
      sourceRelativePath: relativizeProjectPath(params.projectRoot, plannedResolved),
    };
  }
  const extension = params.sourceKind === "markdown" ? "md" : "pdf";
  const relative = path.join(
    "researcher",
    "paper-staging",
    params.sourceKind === "markdown" ? "md" : "pdf",
    `${sanitizeArxivFileStem(params.arxivId)}.${extension}`
  );
  return {
    sourcePath: path.join(params.projectRoot, relative),
    sourceRelativePath: relative,
  };
}

function buildMarkdownValidationFailure(content: string): string | null {
  const trimmed = content.trim();
  if (Buffer.byteLength(trimmed, "utf8") < 800) {
    return "fetched markdown is too small to be a substantive paper source";
  }
  const head = trimmed.slice(0, 1500).toLowerCase();
  if (
    head.includes("<!doctype html") ||
    head.includes("<html") ||
    head.includes("404 not found") ||
    head.includes("rate limit") ||
    head.includes("access denied") ||
    head.includes("service unavailable")
  ) {
    return "fetched markdown looks like an error or HTML page";
  }
  if (!/[#\n]abstract\b/i.test(trimmed) && !/^#{1,3}\s+/m.test(trimmed)) {
    return "fetched markdown lacks paper-like section structure";
  }
  return null;
}

function buildPdfValidationFailure(contentType: string | null, data: Buffer): string | null {
  if (data.byteLength < 4_096) {
    return "fetched PDF is too small to be a substantive paper source";
  }
  const header = data.subarray(0, 8).toString("utf8");
  if (header.startsWith("%PDF-")) {
    return null;
  }
  if (contentType?.toLowerCase().includes("pdf")) {
    return null;
  }
  return "fetched PDF response does not look like a PDF";
}

function buildFetchAttempt(params: {
  provider: string;
  status: "success" | "failed" | "skipped";
  detail: string | null;
  at: string;
  url: string | null;
}): PaperSourceFetchAttempt {
  return {
    provider: params.provider,
    status: params.status,
    detail: params.detail,
    at: params.at,
    url: params.url,
  };
}

async function fetchMarkdown(params: {
  fetchImpl: FetchLike;
  url: string;
  provider: string;
  timeoutMs: number;
  now: string;
}): Promise<{
  ok: true;
  content: string;
  attempt: PaperSourceFetchAttempt;
} | {
  ok: false;
  attempt: PaperSourceFetchAttempt;
}> {
  try {
    const response = await params.fetchImpl(params.url, {
      headers: {
        "User-Agent": "ClawAutoResearch graph-build-source-catchup",
        Accept: "text/markdown,text/plain;q=0.9,*/*;q=0.5",
      },
      signal: AbortSignal.timeout(params.timeoutMs),
    });
    if (!response.ok) {
      return {
        ok: false,
        attempt: buildFetchAttempt({
          provider: params.provider,
          status: "failed",
          detail: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
          at: params.now,
          url: params.url,
        }),
      };
    }
    const content = await response.text();
    const invalidReason = buildMarkdownValidationFailure(content);
    if (invalidReason) {
      return {
        ok: false,
        attempt: buildFetchAttempt({
          provider: params.provider,
          status: "failed",
          detail: invalidReason,
          at: params.now,
          url: params.url,
        }),
      };
    }
    return {
      ok: true,
      content,
      attempt: buildFetchAttempt({
        provider: params.provider,
        status: "success",
        detail: null,
        at: params.now,
        url: params.url,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      attempt: buildFetchAttempt({
        provider: params.provider,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
        at: params.now,
        url: params.url,
      }),
    };
  }
}

async function fetchPdf(params: {
  fetchImpl: FetchLike;
  url: string;
  provider: string;
  timeoutMs: number;
  now: string;
}): Promise<{
  ok: true;
  content: Buffer;
  attempt: PaperSourceFetchAttempt;
} | {
  ok: false;
  attempt: PaperSourceFetchAttempt;
}> {
  try {
    const response = await params.fetchImpl(params.url, {
      headers: {
        "User-Agent": "ClawAutoResearch graph-build-source-catchup",
        Accept: "application/pdf,*/*;q=0.5",
      },
      signal: AbortSignal.timeout(params.timeoutMs),
    });
    if (!response.ok) {
      return {
        ok: false,
        attempt: buildFetchAttempt({
          provider: params.provider,
          status: "failed",
          detail: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
          at: params.now,
          url: params.url,
        }),
      };
    }
    const content = Buffer.from(await response.arrayBuffer());
    const invalidReason = buildPdfValidationFailure(
      response.headers?.get("content-type") ?? null,
      content
    );
    if (invalidReason) {
      return {
        ok: false,
        attempt: buildFetchAttempt({
          provider: params.provider,
          status: "failed",
          detail: invalidReason,
          at: params.now,
          url: params.url,
        }),
      };
    }
    return {
      ok: true,
      content,
      attempt: buildFetchAttempt({
        provider: params.provider,
        status: "success",
        detail: null,
        at: params.now,
        url: params.url,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      attempt: buildFetchAttempt({
        provider: params.provider,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
        at: params.now,
        url: params.url,
      }),
    };
  }
}

async function fetchPaperSource(params: {
  fetchImpl: FetchLike;
  arxivId: string;
  timeoutMs: number;
  now: string;
}): Promise<{
  sourceKind: PaperSourceKind;
  sourceProvider: string;
  sourceUrl: string;
  markdown?: string;
  pdf?: Buffer;
  attempts: PaperSourceFetchAttempt[];
} | {
  sourceKind: null;
  attempts: PaperSourceFetchAttempt[];
}> {
  const attempts: PaperSourceFetchAttempt[] = [];
  const hfUrl = `https://huggingface.co/papers/${encodeURIComponent(params.arxivId)}.md`;
  const hf = await fetchMarkdown({
    fetchImpl: params.fetchImpl,
    url: hfUrl,
    provider: "hugging-face-paper-pages",
    timeoutMs: params.timeoutMs,
    now: params.now,
  });
  attempts.push(hf.attempt);
  if (hf.ok) {
    return {
      sourceKind: "markdown",
      sourceProvider: "hugging-face-paper-pages",
      sourceUrl: hfUrl,
      markdown: hf.content,
      attempts,
    };
  }

  const arxiv2mdUrl =
    `https://arxiv2md.org/api/markdown?${new URLSearchParams({
      url: `https://arxiv.org/abs/${params.arxivId}`,
      remove_refs: "true",
      remove_toc: "true",
      remove_citations: "true",
    }).toString()}`;
  const arxiv2md = await fetchMarkdown({
    fetchImpl: params.fetchImpl,
    url: arxiv2mdUrl,
    provider: "arxiv2md-api",
    timeoutMs: params.timeoutMs,
    now: params.now,
  });
  attempts.push(arxiv2md.attempt);
  if (arxiv2md.ok) {
    return {
      sourceKind: "markdown",
      sourceProvider: "arxiv2md-api",
      sourceUrl: arxiv2mdUrl,
      markdown: arxiv2md.content,
      attempts,
    };
  }

  const pdfUrl = `https://arxiv.org/pdf/${params.arxivId}`;
  const pdf = await fetchPdf({
    fetchImpl: params.fetchImpl,
    url: pdfUrl,
    provider: "arxiv-pdf",
    timeoutMs: params.timeoutMs,
    now: params.now,
  });
  attempts.push(pdf.attempt);
  if (pdf.ok) {
    return {
      sourceKind: "pdf",
      sourceProvider: "arxiv-pdf",
      sourceUrl: pdfUrl,
      pdf: pdf.content,
      attempts,
    };
  }

  return {
    sourceKind: null,
    attempts,
  };
}

function hasActivePaperIngestionRequest(manifest: Record<string, unknown>): boolean {
  const state = normalizePaperIngestionState(manifest.paper_ingestion);
  return state.queuedRequests.some(
    (request) =>
      request.wrapper === "pn_batch_import.py" &&
      IN_FLIGHT_PAPER_INGESTION_REQUEST_STATUSES.has(request.status)
  );
}

function shouldHonorFailureCooldown(params: {
  report: Record<string, unknown> | null;
  nowMs: number;
}): boolean {
  if (!params.report) {
    return false;
  }
  const status = normalizeStage(params.report.status);
  if (status !== "failed") {
    return false;
  }
  const updatedAt = pickString(params.report, ["updated_at", "updatedAt", "checked_at", "checkedAt"]);
  const updatedMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  return Number.isFinite(updatedMs) && params.nowMs - updatedMs < FAILURE_COOLDOWN_MS;
}

function buildBatchImportCommand(args: string[]): string {
  return buildPapernexusBatchImportCommandText(args);
}

function resolveSharedCorpus(params: {
  projectRoot: string;
  projectId: string | null;
  manifest: Record<string, unknown>;
  sharedCorpus?: string | null;
  mcpUrl?: string | null;
  apiBaseUrl?: string | null;
}): string | null {
  const paperIngestion = asRecord(params.manifest.paper_ingestion) ?? {};
  const fallback = resolvePapernexusSharedCorpusFallback({
    configuredSharedCorpus: params.sharedCorpus,
    mcpUrl: params.mcpUrl,
    apiBaseUrl: params.apiBaseUrl,
  });
  return resolveWorkflowSharedPapernexusCorpus({
    candidates: [
      params.sharedCorpus,
      pickString(paperIngestion ?? {}, [
        "shared_corpus",
        "sharedCorpus",
        "locked_shared_corpus",
        "lockedSharedCorpus",
        "repair_target_corpus",
        "repairTargetCorpus",
      ]),
      pickString(params.manifest, ["papernexus_corpus"]),
    ],
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    fallback,
    ignoreLegacyDefault: shouldAutodiscoverRemotePapernexusCorpus({
      configuredSharedCorpus: params.sharedCorpus,
      mcpUrl: params.mcpUrl,
      apiBaseUrl: params.apiBaseUrl,
    }),
  });
}

function buildWrapperArgs(params: {
  batchManifestPath: string;
  sharedCorpus: string | null;
  mcpUrl?: string | null;
  apiBaseUrl?: string | null;
  sshTarget?: string | null;
  remoteStagingRoot?: string | null;
}): string[] {
  const args: string[] = [];
  if (params.mcpUrl) {
    args.push("--mcp-url", params.mcpUrl);
  } else if (params.apiBaseUrl) {
    args.push("--api-base", params.apiBaseUrl);
  }
  if (params.sharedCorpus) {
    args.push("--corpus", params.sharedCorpus);
  }
  args.push("--manifest", params.batchManifestPath, "submit");
  if (params.sshTarget) {
    args.push("--ssh-target", params.sshTarget);
  }
  if (params.remoteStagingRoot) {
    args.push("--remote-staging-root", params.remoteStagingRoot);
  }
  return args;
}

function buildCatchupRequestId(params: {
  sharedCorpus: string | null;
  materialized: MaterializedPaperSource[];
}): string {
  const stablePayload = {
    trigger: "graph_build_source_catchup",
    sharedCorpus: params.sharedCorpus,
    papers: params.materialized
      .map((paper) => ({
        canonicalId: paper.canonicalId,
        arxivId: paper.arxivId,
        sourceKind: paper.sourceKind,
        sourcePath: paper.sourceRelativePath,
      }))
      .sort((left, right) =>
        `${left.canonicalId}:${left.sourcePath}`.localeCompare(
          `${right.canonicalId}:${right.sourcePath}`
        )
      ),
  };
  const digest = createHash("sha256")
    .update(JSON.stringify(stablePayload))
    .digest("hex")
    .slice(0, 16);
  return `graph-build-source-catchup-${digest || randomUUID().slice(0, 8)}`;
}

function findPaperIngestionRequest(
  manifest: Record<string, unknown>,
  requestId: string
): ReturnType<typeof normalizePaperIngestionState>["queuedRequests"][number] | null {
  const state = normalizePaperIngestionState(manifest.paper_ingestion);
  return state.queuedRequests.find((request) => request.requestId === requestId) ?? null;
}

async function writeMaterializedSource(params: {
  projectRoot: string;
  entry: SourceIndexRawEntry;
  fetched: Exclude<Awaited<ReturnType<typeof fetchPaperSource>>, { sourceKind: null }>;
}): Promise<MaterializedPaperSource> {
  const sourceLocation = resolveMaterializedSourcePath({
    projectRoot: params.projectRoot,
    plannedPath: params.entry.plannedPath,
    arxivId: params.entry.paper.arxivId ?? "",
    sourceKind: params.fetched.sourceKind,
  });
  if (params.fetched.sourceKind === "markdown") {
    await writeTextEnsured(sourceLocation.sourcePath, params.fetched.markdown ?? "");
  } else {
    await fs.mkdir(path.dirname(sourceLocation.sourcePath), { recursive: true });
    await fs.writeFile(sourceLocation.sourcePath, params.fetched.pdf ?? Buffer.alloc(0));
  }
  return {
    canonicalId: params.entry.paper.canonicalId,
    title: params.entry.paper.title,
    arxivId: params.entry.paper.arxivId ?? "",
    sourceKind: params.fetched.sourceKind,
    sourceProvider: params.fetched.sourceProvider,
    sourcePath: sourceLocation.sourcePath,
    sourceRelativePath: sourceLocation.sourceRelativePath,
    sourceUrl: params.fetched.sourceUrl,
    existing: false,
    attempts: params.fetched.attempts,
  };
}

async function queueMaterializedSources(params: {
  projectRoot: string;
  projectId: string | null;
  manifest: Record<string, unknown>;
  materialized: MaterializedPaperSource[];
  sourceIndexPath: string;
  now: string;
  sharedCorpus?: string | null;
  mcpUrl?: string | null;
  apiBaseUrl?: string | null;
  sshTarget?: string | null;
  remoteStagingRoot?: string | null;
}): Promise<{
  requestId: string;
  batchManifestPath: string;
  queued: boolean;
  skippedReason: string | null;
}> {
  const sharedCorpus = resolveSharedCorpus({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    manifest: params.manifest,
    sharedCorpus: params.sharedCorpus,
    mcpUrl: params.mcpUrl,
    apiBaseUrl: params.apiBaseUrl,
  });
  const requestId = buildCatchupRequestId({
    sharedCorpus,
    materialized: params.materialized,
  });
  const batchManifestPath = path.join(
    "researcher",
    "paper-staging",
    "queued-imports",
    requestId,
    "batch-import.json"
  );
  const resolvedBatchManifestPath = path.join(params.projectRoot, batchManifestPath);
  const latestManifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(params.projectRoot, "PROJECT_MANIFEST.json")
    )) ?? params.manifest;
  const existingRequest = findPaperIngestionRequest(latestManifest, requestId);
  if (
    existingRequest &&
    ACTIVE_PAPER_INGESTION_REQUEST_STATUSES.has(existingRequest.status)
  ) {
    return {
      requestId,
      batchManifestPath,
      queued: false,
      skippedReason: "source_catchup_already_queued",
    };
  }
  if (
    existingRequest &&
    COMPLETED_PAPER_INGESTION_REQUEST_STATUSES.has(existingRequest.status) &&
    !hasExplicitMissingGraphPresence(latestManifest)
  ) {
    return {
      requestId,
      batchManifestPath,
      queued: false,
      skippedReason: "source_catchup_already_completed",
    };
  }
  const papers = params.materialized.map((paper) => ({
    paperId: paper.canonicalId,
    canonical_id: paper.canonicalId,
    arxiv_id: paper.arxivId,
    title: paper.title,
    source: paper.sourcePath,
    sourceKind: paper.sourceKind,
    sourceProvider: paper.sourceProvider,
    identifiers: {
      arxivId: paper.arxivId,
    },
  }));
  await writeJsonAtomicEnsured(resolvedBatchManifestPath, {
    version: 1,
    defaults: sharedCorpus ? { corpus: sharedCorpus } : {},
    papers,
    queue_paper_ingestion: {
      request_id: requestId,
      source_index_path: relativizeProjectPath(params.projectRoot, params.sourceIndexPath),
      staging_dir: "researcher/paper-staging",
      created_at: params.now,
      trigger_kind: "graph_build_source_catchup",
    },
  });

  const args = buildWrapperArgs({
    batchManifestPath,
    sharedCorpus,
    mcpUrl: params.mcpUrl,
    apiBaseUrl: params.apiBaseUrl,
    sshTarget: params.sshTarget,
    remoteStagingRoot: params.remoteStagingRoot,
  });
  const queuedRequest = {
    request_id: requestId,
    status: "queued",
    wrapper: "pn_batch_import.py",
    args,
    command_text: buildBatchImportCommand(args),
    manifest_path: batchManifestPath,
    shared_corpus: sharedCorpus,
    paper_count: papers.length,
    summary: `Queue PaperNexus import for ${papers.length} graph-build source catch-up paper(s).`,
    detail: "Graph-build source catch-up materialized missing arXiv paper sources before graph presence verification.",
    trigger_kind: "graph_build_source_catchup",
    created_at: params.now,
    updated_at: params.now,
    max_attempts: 3,
  };
  await setPaperIngestionState({
    projectRoot: params.projectRoot,
    paperIngestion: {
      runtime_status: "waiting_import",
      waiting_reason: "Graph-build source catch-up queued PaperNexus import.",
      last_batch_manifest_path: batchManifestPath,
      repair_required: true,
      repair_reason: "Graph-build source catch-up queued missing paper sources for import.",
      repair_target_corpus: sharedCorpus,
      queued_requests: [queuedRequest],
      last_updated_at: params.now,
    },
  });
  return {
    requestId,
    batchManifestPath,
    queued: true,
    skippedReason: null,
  };
}

export async function maybeMaterializeGraphBuildPaperSources(params: {
  projectRoot: string;
  projectId?: string | null;
  workflowPolicy?: {
    papernexusSharedCorpus?: string | null;
    papernexusMcpUrl?: string | null;
    papernexusApiBaseUrl?: string | null;
    papernexusSshTarget?: string | null;
    papernexusRemoteStagingRoot?: string | null;
  } | null;
  now?: string;
  fetchImpl?: FetchLike;
  fetchTimeoutMs?: number;
  maxPapers?: number;
  force?: boolean;
}): Promise<GraphBuildSourceCatchupResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const now = params.now ?? new Date().toISOString();
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const sourceIndexPath = resolvePaperSourceIndexPath(projectRoot);
  let sourceIndexRaw = await readJsonIfExists<unknown>(sourceIndexPath);
  const attempts: PaperSourceFetchAttempt[] = [];
  const reportPath = getCatchupReportPath(projectRoot);
  const errors: string[] = [];
  let recoveredSourceIndexEntryCount = 0;
  let bootstrapSourceIndexEntryCount = 0;
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;

  const buildResult = (
    patch: Partial<GraphBuildSourceCatchupResult> & {
      skippedReason?: string | null;
    }
  ): GraphBuildSourceCatchupResult => ({
    attempted: patch.attempted ?? false,
    queued: patch.queued ?? false,
    skippedReason: patch.skippedReason ?? null,
    sourceIndexPath: patch.sourceIndexPath ?? (sourceIndexRaw ? sourceIndexPath : null),
    materializedPaperCount: patch.materializedPaperCount ?? 0,
    requestId: patch.requestId ?? null,
    batchManifestPath: patch.batchManifestPath ?? null,
    errors: patch.errors ?? errors,
    attempts: patch.attempts ?? attempts,
  });

  if (!sourceIndexRaw) {
    const recoveredEntries = await buildRecoveredSourceIndexEntriesFromPaperStaging({
      projectRoot,
      now,
    });
    if (recoveredEntries.length > 0) {
      const update = await upsertPaperSourceIndexEntries({
        projectRoot,
        entries: recoveredEntries,
      });
      recoveredSourceIndexEntryCount = update.updatedCanonicalIds.length;
      sourceIndexRaw = await readJsonIfExists<unknown>(sourceIndexPath);
    }
  }

  if (!sourceIndexRaw) {
    const bootstrapped = await buildBootstrapSourceIndexEntriesFromManifest({
      manifest,
      fetchImpl: fetchImpl ?? null,
      timeoutMs: Math.max(
        1_000,
        Math.min(
          DEFAULT_BOOTSTRAP_TITLE_RESOLVE_TIMEOUT_MS,
          Math.floor(params.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS)
        )
      ),
      now,
    });
    attempts.push(...bootstrapped.attempts);
    if (bootstrapped.entries.length > 0) {
      const update = await upsertPaperSourceIndexEntries({
        projectRoot,
        entries: bootstrapped.entries,
      });
      bootstrapSourceIndexEntryCount = update.updatedCanonicalIds.length;
      sourceIndexRaw = await readJsonIfExists<unknown>(sourceIndexPath);
    }
  }

  if (!sourceIndexRaw) {
    const result = buildResult({ skippedReason: "missing_paper_source_index" });
    await writeJsonAtomicEnsured(reportPath, {
      status: "skipped",
      updated_at: now,
      bootstrap_source_index_entry_count: bootstrapSourceIndexEntryCount,
      ...result,
    });
    return result;
  }

  if (hasActivePaperIngestionRequest(manifest)) {
    const result = buildResult({
      skippedReason: "active_paper_ingestion_request_exists",
      sourceIndexPath,
    });
    await writeJsonAtomicEnsured(reportPath, {
      status: "skipped",
      updated_at: now,
      ...result,
    });
    return result;
  }

  const previousReport = await readJsonIfExists<Record<string, unknown>>(reportPath);
  if (
    !params.force &&
    shouldHonorFailureCooldown({
      report: previousReport,
      nowMs: Date.parse(now),
    })
  ) {
    const result = buildResult({
      skippedReason: "recent_source_catchup_failure",
      sourceIndexPath,
    });
    await writeJsonAtomicEnsured(reportPath, {
      status: "skipped",
      updated_at: now,
      ...result,
    });
    return result;
  }

  const entries = collectSourceIndexEntries(sourceIndexRaw);
  const candidates = entries.filter(shouldCatchUpEntry);
  if (candidates.length === 0) {
    const result = buildResult({
      skippedReason: "no_planned_arxiv_source_catchup_entries",
      sourceIndexPath,
    });
    await writeJsonAtomicEnsured(reportPath, {
      status: "skipped",
      updated_at: now,
      ...result,
    });
    return result;
  }

  if (!fetchImpl) {
    const result = buildResult({
      attempted: true,
      skippedReason: "fetch_unavailable",
      sourceIndexPath,
      errors: ["global fetch is unavailable in this runtime"],
    });
    await writeJsonAtomicEnsured(reportPath, {
      status: "failed",
      updated_at: now,
      ...result,
    });
    return result;
  }

  const materialized: MaterializedPaperSource[] = [];
  const maxPapers = Math.max(1, Math.floor(params.maxPapers ?? DEFAULT_MAX_PAPERS));
  for (const entry of candidates.slice(0, maxPapers)) {
    const arxivId = entry.paper.arxivId ?? normalizeArxivId(entry.paper.canonicalId);
    if (!arxivId) {
      continue;
    }
    const existingSource = await findExistingSource({
      projectRoot,
      entry,
    });
    if (existingSource) {
      materialized.push({
        canonicalId: entry.paper.canonicalId,
        title: entry.paper.title,
        arxivId,
        sourceKind: existingSource.sourceKind,
        sourceProvider: entry.paper.sourceProvider ?? "filesystem",
        sourcePath: existingSource.sourcePath,
        sourceRelativePath: existingSource.sourceRelativePath,
        sourceUrl: null,
        existing: true,
        attempts: [
          buildFetchAttempt({
            provider: "filesystem",
            status: "success",
            detail: "Project-local staged source already exists.",
            at: now,
            url: existingSource.sourcePath,
          }),
        ],
      });
      continue;
    }

    const fetched = await fetchPaperSource({
      fetchImpl,
      arxivId,
      timeoutMs: Math.max(1_000, Math.floor(params.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS)),
      now,
    });
    attempts.push(...fetched.attempts);
    if (!fetched.sourceKind) {
      errors.push(
        `Failed to fetch source for ${entry.paper.canonicalId}: ${fetched.attempts
          .map((attempt) => `${attempt.provider}: ${attempt.detail ?? attempt.status}`)
          .join("; ")}`
      );
      continue;
    }
    materialized.push(
      await writeMaterializedSource({
        projectRoot,
        entry: {
          ...entry,
          paper: {
            ...entry.paper,
            arxivId,
          },
        },
        fetched,
      })
    );
  }

  if (materialized.length === 0) {
    const result = buildResult({
      attempted: true,
      skippedReason: "source_materialization_failed",
      sourceIndexPath,
      errors,
      attempts,
    });
    await writeJsonAtomicEnsured(reportPath, {
      status: "failed",
      updated_at: now,
      ...result,
    });
    return result;
  }

  await upsertPaperSourceIndexEntries({
    projectRoot,
    entries: materialized.map((paper) => ({
      canonical_id: paper.canonicalId,
      title: paper.title,
      arxiv_id: paper.arxivId,
      source_kind: paper.sourceKind,
      source_provider: paper.sourceProvider,
      source_path: paper.sourceRelativePath,
      retrieval_providers: uniqueStrings([paper.sourceProvider, "graph-build-source-catchup"]),
      resolution_status:
        paper.sourceKind === "markdown" ? "resolved_markdown" : "resolved_pdf",
      resolution_attempts: paper.attempts,
    })),
  });

  const queued = await queueMaterializedSources({
    projectRoot,
    projectId: params.projectId ?? pickString(manifest, ["project_id", "projectId"]),
    manifest,
    materialized,
    sourceIndexPath,
    now,
    sharedCorpus: params.workflowPolicy?.papernexusSharedCorpus,
    mcpUrl: params.workflowPolicy?.papernexusMcpUrl,
    apiBaseUrl: params.workflowPolicy?.papernexusApiBaseUrl,
    sshTarget: params.workflowPolicy?.papernexusSshTarget,
    remoteStagingRoot: params.workflowPolicy?.papernexusRemoteStagingRoot,
  });
  const result = buildResult({
    attempted: true,
    queued: queued.queued,
    skippedReason: queued.skippedReason,
    sourceIndexPath,
    materializedPaperCount: materialized.length,
    requestId: queued.requestId,
    batchManifestPath: queued.batchManifestPath,
    errors,
    attempts,
  });
  await writeJsonAtomicEnsured(reportPath, {
    status: queued.queued ? "queued" : "skipped",
    updated_at: now,
    recovered_source_index_entry_count: recoveredSourceIndexEntryCount,
    bootstrap_source_index_entry_count: bootstrapSourceIndexEntryCount,
    materialized_sources: materialized.map((paper) => ({
      canonical_id: paper.canonicalId,
      arxiv_id: paper.arxivId,
      title: paper.title,
      source_kind: paper.sourceKind,
      source_provider: paper.sourceProvider,
      source_path: paper.sourceRelativePath,
      existing: paper.existing,
    })),
    ...result,
  });
  return result;
}
