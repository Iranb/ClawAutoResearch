import os from "node:os";
import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  inspectPapernexusRemoteAccess,
  type PapernexusRemoteAccessConfig,
} from "./papernexus-secret";
import { writePapernexusProgressFromManifest } from "./papernexus-progress";

export type GraphPresenceStatus =
  | "ready"
  | "missing_papers"
  | "missing_corpus"
  | "missing_sources";

type ManifestLike = Record<string, unknown>;

type ExpectedPaper = {
  canonicalId: string;
  title: string | null;
  normalizedTitle: string | null;
  arxivId: string | null;
  doi: string | null;
  sourceHints: string[];
  sourceKind: "markdown" | "pdf" | "unknown";
  sourceProvider: string | null;
  retrievalProviders: string[];
};

type CorpusPaper = {
  paperId: string | null;
  paperTitle: string | null;
  sourceKey: string | null;
  activeInGraph: boolean;
  arxivIds: Set<string>;
  dois: Set<string>;
  normalizedTitles: Set<string>;
  sourceHints: Set<string>;
  sourceBasenames: Set<string>;
};

export type GraphPresenceMatch = {
  canonicalId: string;
  title: string | null;
  sourceKind: "markdown" | "pdf" | "unknown";
  sourceProvider: string | null;
  retrievalProviders: string[];
  matchedBy: "arxiv" | "doi" | "source_path" | "title";
  corpusPaperId: string | null;
  corpusPaperTitle: string | null;
  corpusSourceKey: string | null;
};

export type GraphPresenceMissingPaper = {
  canonicalId: string;
  title: string | null;
  normalizedTitle: string | null;
  arxivId: string | null;
  doi: string | null;
  sourceKind: "markdown" | "pdf" | "unknown";
  sourceProvider: string | null;
  retrievalProviders: string[];
};

export type GraphPresenceCheckResult = {
  projectRoot: string;
  projectId: string | null;
  checkedAt: string;
  status: GraphPresenceStatus;
  blockingReason: string | null;
  reportPath: string;
  paperSourceIndexPath: string | null;
  usedPaperSourceIndex: boolean;
  expectedPaperCount: number;
  presentPaperCount: number;
  missingPaperCount: number;
  corpusRoot: string | null;
  corpusName: string | null;
  corpusManifestPath: string | null;
  corpusMetaPath: string | null;
  refreshRequired: boolean;
  refreshReason: string | null;
  repairRequired: boolean;
  repairReason: string | null;
  repairTargetCorpus: string | null;
  presentPapers: GraphPresenceMatch[];
  missingPapers: GraphPresenceMissingPaper[];
  manifestUpdated: boolean;
};

const PAPER_SOURCE_INDEX_CANDIDATE_KEYS = [
  "papers",
  "entries",
  "items",
  "sources",
  "canonical_papers",
  "canonicalPapers",
];

const ARXIV_ID_REGEX = /\b(?:[a-z-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?\b/gi;
const DOI_REGEX = /\b10\.\d{4,9}\/[-._;()/:a-z0-9]+\b/gi;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((item) => asString(item))
        .filter((item): item is string => Boolean(item))
    )
  );
}

function pickString(
  source: Record<string, unknown> | null,
  keys: string[]
): string | null {
  if (!source) {
    return null;
  }
  for (const key of keys) {
    const value = asString(source[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function pickCount(
  source: Record<string, unknown> | null,
  keys: string[]
): number | null {
  if (!source) {
    return null;
  }
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }
  }
  return null;
}

function collectTextContent(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectTextContent(entry));
  }
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  const texts: string[] = [];
  if (typeof record.text === "string" && record.text.trim()) {
    texts.push(record.text);
  }
  if (Array.isArray(record.content)) {
    texts.push(...record.content.flatMap((entry) => collectTextContent(entry)));
  }
  if ("result" in record) {
    texts.push(...collectTextContent(record.result));
  }
  if ("data" in record) {
    texts.push(...collectTextContent(record.data));
  }
  return texts;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  if (
    Array.isArray(record.sources) ||
    asRecord(record.meta) ||
    asRecord(record.manifest) ||
    typeof record.rootPath === "string"
  ) {
    return record;
  }
  if ("result" in record) {
    const parsed = parseJsonObject(record.result);
    if (parsed) {
      return parsed;
    }
  }
  for (const text of collectTextContent(record)) {
    const parsed = parseJsonObject(text);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function normalizeArxivId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(ARXIV_ID_REGEX);
  if (!match || match.length === 0) {
    return null;
  }
  return match[0].toLowerCase().replace(/v\d+$/, "");
}

function extractArxivIds(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  return Array.from(
    new Set(
      Array.from(value.matchAll(ARXIV_ID_REGEX))
        .map((match) => normalizeArxivId(match[0]))
        .filter((item): item is string => Boolean(item))
    )
  );
}

function normalizeDoi(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(DOI_REGEX);
  if (!match || match.length === 0) {
    return null;
  }
  return match[0].toLowerCase();
}

function extractDois(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  return Array.from(
    new Set(
      Array.from(value.matchAll(DOI_REGEX))
        .map((match) => normalizeDoi(match[0]))
        .filter((item): item is string => Boolean(item))
    )
  );
}

function normalizeCorpusRootCandidate(value: string): string {
  const absolute = path.resolve(value);
  const basename = path.basename(absolute);
  if (basename === ".papernexus") {
    return path.dirname(absolute);
  }
  if (basename === "sources.json" || basename === "meta.json") {
    const parent = path.dirname(absolute);
    if (path.basename(parent) === ".papernexus") {
      return path.dirname(parent);
    }
  }
  return absolute;
}

function normalizeTitle(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  let normalized = value.trim();
  if (!normalized) {
    return null;
  }
  normalized = normalized.replace(/\.(pdf|md)$/i, "");
  normalized = normalized.replace(/^[^/\\]*[\\/]/g, "");
  normalized = normalized.replace(/^paper[_-]/i, "");
  normalized = normalized.replace(ARXIV_ID_REGEX, " ");
  normalized = normalized.replace(DOI_REGEX, " ");
  normalized = normalized.replace(/--+/g, " ");
  normalized = normalized.replace(/[_./]+/g, " ");
  normalized = normalized.replace(/[^a-z0-9]+/gi, " ");
  normalized = normalized.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized || null;
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function normalizeProvider(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function collectRetrievalProviders(record: Record<string, unknown> | null): string[] {
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
      .map((item) => normalizeProvider(item))
      .filter((item): item is string => Boolean(item))
  );
}

function inferSourceProvider(
  record: Record<string, unknown> | null,
  sourceKind: "markdown" | "pdf" | "unknown",
  sourceHints: string[]
): string | null {
  const explicit = normalizeProvider(
    pickString(record, [
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
  if (sourceKind === "pdf") {
    return "pdf";
  }
  return null;
}

function sourceKindRank(kind: "markdown" | "pdf" | "unknown"): number {
  if (kind === "markdown") {
    return 0;
  }
  if (kind === "pdf") {
    return 1;
  }
  return 2;
}

function sourceProviderRank(provider: string | null): number {
  const normalized = normalizeProvider(provider);
  switch (normalized) {
    case "hf":
    case "huggingface":
    case "hugging-face-paper-pages":
      return 0;
    case "arxiv2md-api":
      return 1;
    case "arxiv2md":
      return 2;
    case "pdf":
      return 3;
    case "papers-cool":
      return 4;
    case "pasa":
    case "pasa-paper-search":
      return 5;
    default:
      return 5;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists<T>(targetPath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJsonEnsured(targetPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeTextEnsured(targetPath: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

async function readManifest(projectRoot: string): Promise<ManifestLike> {
  return (
    (await readJsonIfExists<ManifestLike>(path.join(projectRoot, "PROJECT_MANIFEST.json"))) ?? {}
  );
}

async function saveManifest(projectRoot: string, manifest: ManifestLike): Promise<void> {
  manifest.updated_at = new Date().toISOString();
  await writeJsonEnsured(path.join(projectRoot, "PROJECT_MANIFEST.json"), manifest);
}

function inferProjectId(projectRoot: string, manifest: ManifestLike): string | null {
  return asString(manifest.project_id) ?? path.basename(projectRoot);
}

function getGraphPresenceReportPath(projectRoot: string): string {
  return path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json");
}

function getGraphBuildReportPath(projectRoot: string): string {
  return path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md");
}

function buildStatusRecordFromPresenceResult(params: {
  result: GraphPresenceCheckResult;
  mode: string;
  existing?: Record<string, unknown> | null;
}): Record<string, unknown> {
  return {
    ...(params.existing ?? {}),
    mode: params.mode,
    checked_at: params.result.checkedAt,
    status: params.result.status,
    corpus_root: params.result.corpusRoot,
    corpus_name: params.result.corpusName,
    expected_paper_count: params.result.expectedPaperCount,
    present_paper_count: params.result.presentPaperCount,
    missing_paper_count: params.result.missingPaperCount,
    refresh_required: params.result.refreshRequired,
    refresh_reason: params.result.refreshReason,
    repair_required: params.result.repairRequired,
    repair_reason: params.result.repairReason,
    repair_target_corpus: params.result.repairTargetCorpus,
    missing_papers: serializeMissingPapers(params.result.missingPapers),
    present_papers: serializePresentPapers(params.result.presentPapers),
  };
}

function renderGraphBuildReport(result: GraphPresenceCheckResult): string {
  const lines = [
    "# Graph Build Report",
    "",
    `Checked At: ${result.checkedAt}`,
    `Project: ${result.projectId ?? path.basename(result.projectRoot)}`,
    `Graph Presence Status: ${result.status}`,
    `Corpus: ${result.corpusName ?? "unset"}`,
    `Corpus Root: ${result.corpusRoot ?? "unset"}`,
    `Expected Papers: ${result.expectedPaperCount}`,
    `Present Papers: ${result.presentPaperCount}`,
    `Missing Papers: ${result.missingPaperCount}`,
    `Refresh Required: ${result.refreshRequired ? "yes" : "no"}`,
    `Repair Required: ${result.repairRequired ? "yes" : "no"}`,
  ];
  if (result.blockingReason) {
    lines.push(`Blocking Reason: ${result.blockingReason}`);
  }
  if (result.refreshReason && result.refreshReason !== result.blockingReason) {
    lines.push(`Refresh Reason: ${result.refreshReason}`);
  }
  if (result.repairReason) {
    lines.push(`Repair Reason: ${result.repairReason}`);
  }
  if (result.missingPapers.length > 0) {
    lines.push("", "## Missing Papers");
    for (const paper of result.missingPapers) {
      lines.push(`- ${paper.title ?? paper.canonicalId ?? paper.normalizedTitle ?? "unknown"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function persistGraphPresenceArtifacts(params: {
  projectRoot: string;
  result: GraphPresenceCheckResult;
  mode: string;
  existingStatusRecord?: Record<string, unknown> | null;
}): Promise<void> {
  await writeJsonEnsured(
    path.join(params.projectRoot, "graph", "PAPERNEXUS_STATUS.json"),
    buildStatusRecordFromPresenceResult({
      result: params.result,
      mode: params.mode,
      existing: params.existingStatusRecord ?? null,
    })
  );
  await writeTextEnsured(
    getGraphBuildReportPath(params.projectRoot),
    renderGraphBuildReport(params.result)
  );
}

function getRegistryPath(): string {
  const papernexusHome = asString(process.env.PAPERNEXUS_HOME);
  if (papernexusHome) {
    return path.join(path.resolve(papernexusHome), "registry.json");
  }
  return path.join(os.homedir(), ".papernexus", "registry.json");
}

async function resolveCorpusRootFromRegistry(
  corpusName: string | null
): Promise<string | null> {
  if (!corpusName) {
    return null;
  }
  const registry = await readJsonIfExists<Record<string, unknown>>(getRegistryPath());
  const corpora = Array.isArray(registry?.corpora) ? registry.corpora : [];
  for (const entry of corpora) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const name = pickString(record, ["name"]);
    const rootPath = pickString(record, ["rootPath", "root_path"]);
    if ((name && name === corpusName) || (rootPath && rootPath === corpusName)) {
      return rootPath ? path.resolve(rootPath) : null;
    }
  }
  return null;
}

async function resolveDefaultCorpusFromRegistry(): Promise<{
  corpusRoot: string | null;
  corpusName: string | null;
}> {
  const registry = await readJsonIfExists<Record<string, unknown>>(getRegistryPath());
  const corpora = Array.isArray(registry?.corpora) ? registry.corpora : [];
  if (corpora.length !== 1) {
    return {
      corpusRoot: null,
      corpusName: null,
    };
  }
  const record = asRecord(corpora[0]);
  return {
    corpusRoot: pickString(record, ["rootPath", "root_path"]),
    corpusName: pickString(record, ["name"]),
  };
}

function collectSourceHints(record: Record<string, unknown> | null): string[] {
  if (!record) {
    return [];
  }
  return uniqueStrings([
    pickString(record, ["source_path", "sourcePath"]),
    pickString(record, ["canonical_source_path", "canonicalSourcePath"]),
    pickString(record, ["markdown_path", "markdownPath", "source_markdown_path", "sourceMarkdownPath"]),
    pickString(record, ["pdf_path", "pdfPath", "source_pdf_path", "sourcePdfPath"]),
    pickString(record, ["input_path", "inputPath"]),
    pickString(record, ["source_key", "sourceKey"]),
    pickString(record, ["path", "file", "filePath"]),
    ...asStringArray(record.source_variants),
    ...asStringArray(record.sourceVariants),
  ].filter((item): item is string => Boolean(item)));
}

function inferSourceKind(sourceHints: string[]): "markdown" | "pdf" | "unknown" {
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

function buildExpectedPaperFromRecord(
  raw: Record<string, unknown>,
  fallbackCanonicalId?: string
): ExpectedPaper | null {
  const sourceHints = collectSourceHints(raw);
  const title =
    pickString(raw, ["title", "paper_title", "paperTitle", "name"]) ??
    (sourceHints.length > 0
      ? path.basename(sourceHints[0], path.extname(sourceHints[0]))
      : null);
  const arxivId =
    pickString(raw, ["arxiv_id", "arxivId", "arxiv"]) ??
    sourceHints.find((hint) => Boolean(normalizeArxivId(hint))) ??
    fallbackCanonicalId ??
    null;
  const doi =
    pickString(raw, ["doi", "doi_url", "doiUrl"]) ??
    sourceHints.find((hint) => Boolean(normalizeDoi(hint))) ??
    fallbackCanonicalId ??
    null;
  const normalizedTitle =
    pickString(raw, ["normalized_title", "normalizedTitle"]) ??
    normalizeTitle(title) ??
    normalizeTitle(fallbackCanonicalId) ??
    (sourceHints.length > 0 ? normalizeTitle(sourceHints[0]) : null);
  const canonicalId =
    pickString(raw, ["canonical_id", "canonicalId", "id", "paper_id", "paperId"]) ??
    (normalizeArxivId(arxivId) ? `arxiv:${normalizeArxivId(arxivId)}` : null) ??
    (normalizeDoi(doi) ? `doi:${normalizeDoi(doi)}` : null) ??
    (normalizedTitle ? `title:${normalizedTitle}` : null) ??
    fallbackCanonicalId ??
    null;

  if (!canonicalId && !title && sourceHints.length === 0) {
    return null;
  }

  return {
    canonicalId: canonicalId ?? `title:${normalizedTitle ?? "unknown"}`,
    title,
    normalizedTitle,
    arxivId: normalizeArxivId(arxivId),
    doi: normalizeDoi(doi),
    sourceHints,
    sourceKind: inferSourceKind(sourceHints),
    sourceProvider: inferSourceProvider(raw, inferSourceKind(sourceHints), sourceHints),
    retrievalProviders: collectRetrievalProviders(raw),
  };
}

function mergeExpectedPaper(target: ExpectedPaper, incoming: ExpectedPaper): ExpectedPaper {
  const incomingPreferred =
    sourceKindRank(incoming.sourceKind) < sourceKindRank(target.sourceKind) ||
    (sourceKindRank(incoming.sourceKind) === sourceKindRank(target.sourceKind) &&
      sourceProviderRank(incoming.sourceProvider) < sourceProviderRank(target.sourceProvider));
  return {
    canonicalId: target.canonicalId,
    title: target.title ?? incoming.title,
    normalizedTitle: target.normalizedTitle ?? incoming.normalizedTitle,
    arxivId: target.arxivId ?? incoming.arxivId,
    doi: target.doi ?? incoming.doi,
    sourceHints: uniqueStrings([...target.sourceHints, ...incoming.sourceHints]),
    sourceKind: incomingPreferred ? incoming.sourceKind : target.sourceKind,
    sourceProvider: incomingPreferred
      ? incoming.sourceProvider ?? target.sourceProvider
      : target.sourceProvider ?? incoming.sourceProvider,
    retrievalProviders: uniqueStrings([
      ...target.retrievalProviders,
      ...incoming.retrievalProviders,
    ]),
  };
}

function parsePaperSourceIndex(raw: unknown): ExpectedPaper[] {
  if (!raw) {
    return [];
  }
  let entries: Array<{ key?: string; value: unknown }> = [];
  if (Array.isArray(raw)) {
    entries = raw.map((value) => ({ value }));
  } else {
    const record = asRecord(raw);
    if (record) {
      for (const key of PAPER_SOURCE_INDEX_CANDIDATE_KEYS) {
        if (Array.isArray(record[key])) {
          entries = (record[key] as unknown[]).map((value) => ({ value }));
          break;
        }
        const nestedRecord = asRecord(record[key]);
        if (nestedRecord) {
          entries = Object.entries(nestedRecord).map(([nestedKey, value]) => ({
            key: nestedKey,
            value,
          }));
          break;
        }
      }
      if (entries.length === 0) {
        entries = Object.entries(record).map(([key, value]) => ({ key, value }));
      }
    }
  }

  const byCanonicalId = new Map<string, ExpectedPaper>();
  for (const entry of entries) {
    const record = asRecord(entry.value);
    if (!record) {
      continue;
    }
    const paper = buildExpectedPaperFromRecord(record, entry.key);
    if (!paper) {
      continue;
    }
    const existing = byCanonicalId.get(paper.canonicalId);
    byCanonicalId.set(
      paper.canonicalId,
      existing ? mergeExpectedPaper(existing, paper) : paper
    );
  }
  return [...byCanonicalId.values()].sort((left, right) =>
    left.canonicalId.localeCompare(right.canonicalId)
  );
}

async function collectPaperFiles(rootDir: string): Promise<string[]> {
  const stack = [rootDir];
  const files: string[] = [];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (
        entry.name === ".papernexus" ||
        entry.name === ".git" ||
        entry.name === "node_modules"
      ) {
        continue;
      }
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (/\.(md|pdf)$/i.test(entry.name)) {
        files.push(absolute);
      }
    }
  }
  return files.sort();
}

function parseExpectedPapersFromFiles(files: string[]): ExpectedPaper[] {
  const byCanonicalId = new Map<string, ExpectedPaper>();
  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath, ext);
    const titlePart = basename.includes("--")
      ? basename.split("--").slice(1).join("--")
      : basename;
    const paper = buildExpectedPaperFromRecord(
      {
        title: titlePart,
        source_path: filePath,
        normalized_title: normalizeTitle(titlePart),
      },
      basename
    );
    if (!paper) {
      continue;
    }
    const existing = byCanonicalId.get(paper.canonicalId);
    if (!existing) {
      byCanonicalId.set(paper.canonicalId, {
        ...paper,
        sourceKind: ext === ".md" ? "markdown" : ext === ".pdf" ? "pdf" : "unknown",
        sourceProvider: ext === ".pdf" ? "pdf" : paper.sourceProvider,
      });
      continue;
    }
    const merged = mergeExpectedPaper(existing, {
      ...paper,
      sourceKind: ext === ".md" ? "markdown" : ext === ".pdf" ? "pdf" : "unknown",
      sourceProvider:
        ext === ".md" ? paper.sourceProvider : ext === ".pdf" ? "pdf" : paper.sourceProvider,
    });
    if (existing.sourceKind !== "markdown" && ext === ".md") {
      merged.sourceKind = "markdown";
    }
    byCanonicalId.set(paper.canonicalId, merged);
  }
  return [...byCanonicalId.values()].sort((left, right) =>
    left.canonicalId.localeCompare(right.canonicalId)
  );
}

async function resolveExpectedPapers(params: {
  projectRoot: string;
  manifest: ManifestLike;
  projectId: string | null;
}): Promise<{
  papers: ExpectedPaper[];
  paperSourceIndexPath: string | null;
  usedPaperSourceIndex: boolean;
}> {
  const paperSourceIndexPath = path.join(
    params.projectRoot,
    "researcher",
    "PAPER_SOURCE_INDEX.json"
  );
  const paperSourceIndex = await readJsonIfExists<unknown>(paperSourceIndexPath);
  const indexedPapers = parsePaperSourceIndex(paperSourceIndex);
  if (indexedPapers.length > 0) {
    return {
      papers: indexedPapers,
      paperSourceIndexPath,
      usedPaperSourceIndex: true,
    };
  }
  return {
    papers: [],
    paperSourceIndexPath: await pathExists(paperSourceIndexPath)
      ? paperSourceIndexPath
      : null,
    usedPaperSourceIndex: false,
  };
}

async function resolveCorpusRoot(params: {
  projectRoot: string;
  manifest: ManifestLike;
  projectId: string | null;
}): Promise<{ corpusRoot: string | null; corpusName: string | null }> {
  const statusPath = path.join(params.projectRoot, "graph", "PAPERNEXUS_STATUS.json");
  const status = await readJsonIfExists<Record<string, unknown>>(statusPath);
  const explicitCorpusName =
    pickString(status, ["corpus_name", "corpusName"]) ??
    pickString(params.manifest, ["papernexus_corpus"]);
  const registryRoot = await resolveCorpusRootFromRegistry(explicitCorpusName);
  const defaultRegistryCorpus = explicitCorpusName
    ? { corpusRoot: null, corpusName: null }
    : await resolveDefaultCorpusFromRegistry();
  const corpusName = explicitCorpusName ?? defaultRegistryCorpus.corpusName ?? null;
  const candidates = uniqueStrings([
    pickString(status, [
      "corpus_root",
      "corpusRoot",
      "root_path",
      "rootPath",
      "source_dir",
      "sourceDir",
    ]),
    registryRoot,
    defaultRegistryCorpus.corpusRoot,
  ].filter((item): item is string => Boolean(item)));

  for (const candidate of candidates) {
    const absolute = normalizeCorpusRootCandidate(candidate);
    if (await pathExists(absolute)) {
      return {
        corpusRoot: absolute,
        corpusName,
      };
    }
  }

  return {
    corpusRoot:
      candidates.length > 0 ? normalizeCorpusRootCandidate(candidates[0]) : null,
    corpusName,
  };
}

function buildCorpusPaper(entry: Record<string, unknown>): CorpusPaper {
  const sourceHints = uniqueStrings([
    pickString(entry, ["sourceKey", "source_key"]),
    pickString(entry, ["inputPath", "input_path"]),
    pickString(entry, ["sourcePath", "source_path"]),
    pickString(entry, ["sourceMarkdownPath", "source_markdown_path"]),
    pickString(entry, ["sourcePdfPath", "source_pdf_path"]),
    pickString(entry, ["canonicalSourceKey", "canonical_source_key"]),
    pickString(entry, ["duplicateOfSourceKey", "duplicate_of_source_key"]),
  ].filter((item): item is string => Boolean(item)));
  const paperTitle = pickString(entry, ["paperTitle", "paper_title", "title"]);
  const titleHints = uniqueStrings([
    paperTitle,
    ...sourceHints.map((hint) => path.basename(hint, path.extname(hint))),
  ].filter((item): item is string => Boolean(item)));
  return {
    paperId: pickString(entry, ["paperId", "paper_id"]),
    paperTitle,
    sourceKey: pickString(entry, ["sourceKey", "source_key"]),
    activeInGraph:
      typeof entry.activeInGraph === "boolean"
        ? entry.activeInGraph
        : typeof entry.active_in_graph === "boolean"
          ? Boolean(entry.active_in_graph)
          : true,
    arxivIds: new Set(sourceHints.flatMap((hint) => extractArxivIds(hint))),
    dois: new Set(sourceHints.flatMap((hint) => extractDois(hint))),
    normalizedTitles: new Set(
      titleHints
        .map((value) => normalizeTitle(value))
        .filter((value): value is string => Boolean(value))
    ),
    sourceHints: new Set(sourceHints.map((hint) => path.resolve(hint))),
    sourceBasenames: new Set(
      sourceHints.map((hint) => path.basename(hint, path.extname(hint)).toLowerCase())
    ),
  };
}

function matchExpectedPaper(
  expected: ExpectedPaper,
  corpus: CorpusPaper[]
): GraphPresenceMatch | null {
  const activeCorpus = corpus.filter((entry) => entry.activeInGraph);

  if (expected.arxivId) {
    const match = activeCorpus.find((entry) => entry.arxivIds.has(expected.arxivId as string));
    if (match) {
      return {
        canonicalId: expected.canonicalId,
        title: expected.title,
        sourceKind: expected.sourceKind,
        sourceProvider: expected.sourceProvider,
        retrievalProviders: expected.retrievalProviders,
        matchedBy: "arxiv",
        corpusPaperId: match.paperId,
        corpusPaperTitle: match.paperTitle,
        corpusSourceKey: match.sourceKey,
      };
    }
  }

  if (expected.doi) {
    const match = activeCorpus.find((entry) => entry.dois.has(expected.doi as string));
    if (match) {
      return {
        canonicalId: expected.canonicalId,
        title: expected.title,
        sourceKind: expected.sourceKind,
        sourceProvider: expected.sourceProvider,
        retrievalProviders: expected.retrievalProviders,
        matchedBy: "doi",
        corpusPaperId: match.paperId,
        corpusPaperTitle: match.paperTitle,
        corpusSourceKey: match.sourceKey,
      };
    }
  }

  const sourcePaths = expected.sourceHints.map((hint) => path.resolve(hint));
  const sourceBasenames = expected.sourceHints.map((hint) =>
    path.basename(hint, path.extname(hint)).toLowerCase()
  );
  const sourcePathMatch = activeCorpus.find((entry) =>
    sourcePaths.some((hint) => entry.sourceHints.has(hint)) ||
    sourceBasenames.some((basename) => entry.sourceBasenames.has(basename))
  );
  if (sourcePathMatch) {
    return {
      canonicalId: expected.canonicalId,
      title: expected.title,
      sourceKind: expected.sourceKind,
      sourceProvider: expected.sourceProvider,
      retrievalProviders: expected.retrievalProviders,
      matchedBy: "source_path",
      corpusPaperId: sourcePathMatch.paperId,
      corpusPaperTitle: sourcePathMatch.paperTitle,
      corpusSourceKey: sourcePathMatch.sourceKey,
    };
  }

  if (expected.normalizedTitle) {
    const match = activeCorpus.find((entry) =>
      entry.normalizedTitles.has(expected.normalizedTitle as string)
    );
    if (match) {
      return {
        canonicalId: expected.canonicalId,
        title: expected.title,
        sourceKind: expected.sourceKind,
        sourceProvider: expected.sourceProvider,
        retrievalProviders: expected.retrievalProviders,
        matchedBy: "title",
        corpusPaperId: match.paperId,
        corpusPaperTitle: match.paperTitle,
        corpusSourceKey: match.sourceKey,
      };
    }
  }

  return null;
}

function buildBlockingReason(
  status: GraphPresenceStatus,
  missingPapers: GraphPresenceMissingPaper[],
  expectedPaperCount: number,
  corpusRoot: string | null
): string | null {
  if (status === "ready") {
    return null;
  }
  if (status === "missing_sources") {
    return "No canonical papers are recorded yet in PAPER_SOURCE_INDEX.json, so graph-grounded work cannot proceed.";
  }
  if (status === "missing_corpus") {
    return `PaperNexus corpus is not ready at ${corpusRoot ?? "the expected corpus root"} for ${expectedPaperCount} expected paper(s). Rebuild or refresh the corpus before frontier mapping or ideation.`;
  }
  if (missingPapers.length === 0) {
    return "PaperNexus graph presence check failed; rebuild the corpus before novelty-sensitive work.";
  }
  const preview = missingPapers
    .slice(0, 3)
    .map((paper) => paper.arxivId ?? paper.title ?? paper.canonicalId)
    .join("; ");
  return `PaperNexus corpus is missing ${missingPapers.length}/${expectedPaperCount} expected paper(s): ${preview}${missingPapers.length > 3 ? "; ..." : ""}. Refresh the graph before frontier mapping or ideation.`;
}

function summarizePaperIngestionProgress(
  manifest: ManifestLike
): {
  runtimeStatus: string | null;
  importTaskCount: number;
  completedCount: number;
  activeOperationCount: number;
  timedOutCount: number;
  failedCount: number;
  activeBatchCount: number;
  pendingBatchItemCount: number;
  syncedBatchItemCount: number;
  failedBatchItemCount: number;
  waitingReason: string | null;
  inFlight: boolean;
} {
  const paperIngestion = asRecord(manifest.paper_ingestion);
  const runtimeStatus =
    pickString(paperIngestion, ["runtime_status", "runtimeStatus"])?.toLowerCase() ?? null;
  const waitingReason = pickString(paperIngestion, ["waiting_reason", "waitingReason"]);
  const importTaskIds = Array.isArray(paperIngestion?.import_task_ids)
    ? paperIngestion.import_task_ids
    : Array.isArray(paperIngestion?.importTaskIds)
      ? paperIngestion.importTaskIds
      : [];
  const completedPapers = Array.isArray(paperIngestion?.completed_papers)
    ? paperIngestion.completed_papers
    : Array.isArray(paperIngestion?.completedPapers)
      ? paperIngestion.completedPapers
      : [];
  const paperOperations = Array.isArray(paperIngestion?.paper_operations)
    ? paperIngestion.paper_operations
    : Array.isArray(paperIngestion?.paperOperations)
      ? paperIngestion.paperOperations
      : [];
  const activeBatches = Array.isArray(paperIngestion?.active_batches)
    ? paperIngestion.active_batches
    : Array.isArray(paperIngestion?.activeBatches)
      ? paperIngestion.activeBatches
      : [];
  const batchItems = Array.isArray(paperIngestion?.batch_items)
    ? paperIngestion.batch_items
    : Array.isArray(paperIngestion?.batchItems)
      ? paperIngestion.batchItems
      : [];
  let activeOperationCount = 0;
  let timedOutCount = 0;
  let failedCount = 0;
  let activeBatchCount = 0;
  let pendingBatchItemCount = 0;
  let syncedBatchItemCount = 0;
  let failedBatchItemCount = 0;
  for (const item of paperOperations) {
    const record = asRecord(item);
    const status = pickString(record, ["status"])?.toLowerCase() ?? null;
    if (status === "queued" || status === "running") {
      activeOperationCount += 1;
    } else if (status === "timed_out") {
      timedOutCount += 1;
    } else if (status === "failed") {
      failedCount += 1;
    }
  }
  for (const item of activeBatches) {
    const record = asRecord(item);
    const status = pickString(record, ["status"])?.toLowerCase() ?? null;
    if (status === "queued" || status === "running") {
      activeBatchCount += 1;
    }
  }
  for (const item of batchItems) {
    const record = asRecord(item);
    const status = pickString(record, ["status"])?.toLowerCase() ?? null;
    const synced = record?.synced === true;
    if (status === "pending" || status === "running") {
      pendingBatchItemCount += 1;
    }
    if (synced || status === "completed") {
      syncedBatchItemCount += 1;
    }
    if (status === "failed" || status === "submit_failed") {
      failedBatchItemCount += 1;
    }
  }
  const importTaskCount = importTaskIds
    .map((value) => asString(value))
    .filter((value): value is string => Boolean(value)).length;
  const completedCount = completedPapers
    .map((value) => asRecord(value))
    .filter((value): value is Record<string, unknown> => Boolean(value)).length;
  const inFlight =
    runtimeStatus === "waiting_import" ||
    runtimeStatus === "reconciling" ||
    activeBatchCount > 0 ||
    pendingBatchItemCount > 0 ||
    activeOperationCount > 0 ||
    (importTaskCount > 0 && completedCount === 0);
  return {
    runtimeStatus,
    importTaskCount,
    completedCount,
    activeOperationCount,
    timedOutCount,
    failedCount,
    activeBatchCount,
    pendingBatchItemCount,
    syncedBatchItemCount,
    failedBatchItemCount,
    waitingReason,
    inFlight,
  };
}

function buildInFlightRemoteRefreshReason(params: {
  remoteEndpoint: string | null;
  expectedPaperCount: number;
  presentPaperCount: number;
  paperIngestion: ReturnType<typeof summarizePaperIngestionProgress>;
}): string {
  const details = [
    `paper_ingestion reports status=${params.paperIngestion.runtimeStatus ?? "unknown"}`,
    `import_tasks=${params.paperIngestion.importTaskCount}`,
    `completed=${params.paperIngestion.completedCount}`,
    `active_operations=${params.paperIngestion.activeOperationCount}`,
    `timed_out=${params.paperIngestion.timedOutCount}`,
    `failed=${params.paperIngestion.failedCount}`,
    `active_batches=${params.paperIngestion.activeBatchCount}`,
    `batch_pending_items=${params.paperIngestion.pendingBatchItemCount}`,
    `batch_synced_items=${params.paperIngestion.syncedBatchItemCount}`,
    `batch_failed_items=${params.paperIngestion.failedBatchItemCount}`,
  ];
  return (
    `PaperNexus automatic graph catch-up is still running through the remote PaperNexus flow${params.remoteEndpoint ? ` at ${params.remoteEndpoint}` : ""}: ` +
    `remote status currently covers ${params.presentPaperCount}/${params.expectedPaperCount} expected paper(s), and ${details.join(", ")}.` +
    `${params.paperIngestion.waitingReason ? ` Waiting reason: ${params.paperIngestion.waitingReason}.` : ""} ` +
    "Continue /graph-build for a bounded status/brainstorm pass or wait for the next wrapper status update before frontier mapping or ideation."
  );
}

function resolveGraphRepairTargetCorpus(params: {
  manifest: ManifestLike;
  corpusName: string | null;
}): string | null {
  return (
    pickString(params.manifest, ["papernexus_corpus"]) ??
    params.corpusName ??
    "shared-global-graph"
  );
}

function shouldRequireGraphImportRepair(params: {
  status: GraphPresenceStatus;
  expectedPaperCount: number;
  presentPaperCount: number;
  paperIngestion: ReturnType<typeof summarizePaperIngestionProgress>;
  canRepair: boolean;
}): boolean {
  if (!params.canRepair) {
    return false;
  }
  if (params.paperIngestion.inFlight) {
    return false;
  }
  if (params.expectedPaperCount === 0) {
    return false;
  }
  if (params.presentPaperCount >= params.expectedPaperCount) {
    return false;
  }
  return params.status === "missing_papers" || params.status === "missing_corpus";
}

function buildGraphImportRepairReason(params: {
  corpusName: string | null;
  expectedPaperCount: number;
  presentPaperCount: number;
  refreshReason: string | null;
}): string {
  return (
    `PaperNexus graph sync repair is required for shared corpus ${params.corpusName ?? "shared-global-graph"}: ` +
    `${params.presentPaperCount}/${params.expectedPaperCount} expected paper(s) are currently visible and no import/graph catch-up activity is in flight. ` +
    `${params.refreshReason ?? "Regenerate a bounded batch import repair pass."}`
  );
}

function serializeMissingPapers(missingPapers: GraphPresenceMissingPaper[]) {
  return missingPapers.map((paper) => ({
    canonical_id: paper.canonicalId,
    title: paper.title,
    normalized_title: paper.normalizedTitle,
    arxiv_id: paper.arxivId,
    doi: paper.doi,
    source_kind: paper.sourceKind,
    source_provider: paper.sourceProvider,
    retrieval_providers: paper.retrievalProviders,
  }));
}

function serializePresentPapers(presentPapers: GraphPresenceMatch[]) {
  return presentPapers.map((paper) => ({
    canonical_id: paper.canonicalId,
    title: paper.title,
    source_kind: paper.sourceKind,
    source_provider: paper.sourceProvider,
    retrieval_providers: paper.retrievalProviders,
    matched_by: paper.matchedBy,
    corpus_paper_id: paper.corpusPaperId,
    corpus_paper_title: paper.corpusPaperTitle,
    corpus_source_key: paper.corpusSourceKey,
  }));
}

function toMissingPaper(expected: ExpectedPaper): GraphPresenceMissingPaper {
  return {
    canonicalId: expected.canonicalId,
    title: expected.title,
    normalizedTitle: expected.normalizedTitle,
    arxivId: expected.arxivId,
    doi: expected.doi,
    sourceKind: expected.sourceKind,
    sourceProvider: expected.sourceProvider,
    retrievalProviders: expected.retrievalProviders,
  };
}

function matchExpectedPaperDescriptor(
  expectedPapers: ExpectedPaper[],
  record: Record<string, unknown> | null
): ExpectedPaper | null {
  if (!record) {
    return null;
  }
  const canonicalId = pickString(record, ["canonical_id", "canonicalId", "id"]);
  if (canonicalId) {
    const direct = expectedPapers.find((paper) => paper.canonicalId === canonicalId);
    if (direct) {
      return direct;
    }
  }

  const arxivId = normalizeArxivId(
    pickString(record, ["arxiv_id", "arxivId", "arxiv", "paper_id", "paperId"])
  );
  if (arxivId) {
    const direct = expectedPapers.find((paper) => paper.arxivId === arxivId);
    if (direct) {
      return direct;
    }
  }

  const doi = normalizeDoi(pickString(record, ["doi", "doi_url", "doiUrl"]));
  if (doi) {
    const direct = expectedPapers.find((paper) => paper.doi === doi);
    if (direct) {
      return direct;
    }
  }

  const normalizedTitle = normalizeTitle(
    pickString(record, ["normalized_title", "normalizedTitle", "title", "paper_title", "paperTitle"])
  );
  if (normalizedTitle) {
    const direct = expectedPapers.find((paper) => paper.normalizedTitle === normalizedTitle);
    if (direct) {
      return direct;
    }
  }

  return null;
}

function mergeRemoteMissingPapers(params: {
  expectedPapers: ExpectedPaper[];
  statusRecord: Record<string, unknown> | null;
  expectedPaperCount: number;
  presentPaperCount: number;
}): GraphPresenceMissingPaper[] {
  const missingRaw = Array.isArray(params.statusRecord?.missing_papers)
    ? params.statusRecord?.missing_papers
    : Array.isArray(params.statusRecord?.missingPapers)
      ? params.statusRecord?.missingPapers
      : [];
  const collected: GraphPresenceMissingPaper[] = [];
  const seen = new Set<string>();
  for (const item of missingRaw) {
    const record = asRecord(item);
    const matchedExpected = matchExpectedPaperDescriptor(params.expectedPapers, record);
    const missingPaper = matchedExpected
      ? toMissingPaper(matchedExpected)
      : (() => {
          const parsed = buildExpectedPaperFromRecord(
            record ?? {},
            pickString(record, ["canonical_id", "canonicalId", "id"]) ?? undefined
          );
          return parsed ? toMissingPaper(parsed) : null;
        })();
    if (!missingPaper || seen.has(missingPaper.canonicalId)) {
      continue;
    }
    seen.add(missingPaper.canonicalId);
    collected.push(missingPaper);
  }

  if (collected.length > 0) {
    return collected;
  }

  const inferredMissingCount = Math.max(
    0,
    params.expectedPaperCount - params.presentPaperCount
  );
  if (inferredMissingCount === 0) {
    return [];
  }
  return params.expectedPapers.slice(0, inferredMissingCount).map((paper) => toMissingPaper(paper));
}

async function fetchRemoteApiCorpusSources(params: {
  apiBaseUrl: string;
  token: string;
  corpusName: string | null;
}): Promise<{ payload: Record<string, unknown> | null; error: string | null }> {
  try {
    const url = new URL(
      `${params.apiBaseUrl.replace(/\/+$/, "")}/api/corpus-sources`
    );
    if (params.corpusName) {
      url.searchParams.set("name", params.corpusName);
    }
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${params.token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        payload: null,
        error: `Remote API corpus-sources returned ${response.status}: ${response.statusText}${text ? ` (${text})` : ""}`,
      };
    }
    return {
      payload: parseJsonObject(text),
      error: null,
    };
  } catch (error) {
    return {
      payload: null,
      error: `Remote API corpus-sources failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function fetchRemoteMcpCorpusSources(params: {
  remoteInspection: Awaited<ReturnType<typeof inspectPapernexusRemoteAccess>>;
  corpusName: string | null;
}): Promise<{ payload: Record<string, unknown> | null; error: string | null }> {
  const mcpUrl = params.remoteInspection.summary.mcpUrl;
  const token = params.remoteInspection.token;
  if (!mcpUrl || !token) {
    return {
      payload: null,
      error: "Remote MCP URL or bearer token is unavailable.",
    };
  }

  try {
    const response = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "corpus_sources",
          arguments: params.corpusName ? { corpus: params.corpusName } : {},
        },
      }),
      signal: AbortSignal.timeout(params.remoteInspection.summary.mcpTimeoutMs),
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        payload: null,
        error: `Remote MCP corpus_sources returned ${response.status}: ${response.statusText}${text ? ` (${text})` : ""}`,
      };
    }
    let parsedEnvelope: unknown = null;
    try {
      parsedEnvelope = JSON.parse(text);
    } catch (error) {
      return {
        payload: null,
        error: `Remote MCP corpus_sources returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const parsed = parseJsonObject(asRecord(parsedEnvelope)?.result ?? parsedEnvelope);
    if (!parsed) {
      return {
        payload: null,
        error: "Remote MCP corpus_sources returned an unreadable JSON payload.",
      };
    }
    return {
      payload: parsed,
      error: null,
    };
  } catch (error) {
    return {
      payload: null,
      error: `Remote MCP corpus_sources failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function buildRemoteStatusRecordFromSources(params: {
  payload: Record<string, unknown>;
  mode: "remote_api" | "remote_mcp";
  checkedAt: string;
  expectedPapers: ExpectedPaper[];
  remoteEndpoint: string | null;
}): Record<string, unknown> {
  const meta = asRecord(params.payload.meta);
  const manifest = asRecord(params.payload.manifest);
  const sources = Array.isArray(params.payload.sources)
    ? params.payload.sources
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
  const corpusEntries = sources.map((entry) => buildCorpusPaper(entry));
  const presentPapers: GraphPresenceMatch[] = [];
  const missingPapers: GraphPresenceMissingPaper[] = [];

  for (const paper of params.expectedPapers) {
    const match = matchExpectedPaper(paper, corpusEntries);
    if (match) {
      presentPapers.push(match);
    } else {
      missingPapers.push(toMissingPaper(paper));
    }
  }

  const status: GraphPresenceStatus =
    params.expectedPapers.length === 0
      ? "missing_sources"
      : missingPapers.length > 0
        ? "missing_papers"
        : "ready";

  return {
    checked_at: params.checkedAt,
    status,
    mode: params.mode,
    corpus_name:
      pickString(manifest, ["corpusName", "corpus_name"]) ??
      pickString(meta, ["name", "corpusName", "corpus_name"]) ??
      null,
    corpus_root:
      pickString(params.payload, ["rootPath", "root_path"]) ??
      pickString(manifest, ["rootPath", "root_path"]) ??
      pickString(meta, ["rootPath", "root_path"]) ??
      params.remoteEndpoint,
    expected_paper_count: params.expectedPapers.length,
    present_paper_count: presentPapers.length,
    missing_paper_count: missingPapers.length,
    missing_papers: serializeMissingPapers(missingPapers),
    present_papers: serializePresentPapers(presentPapers),
    refresh_required: status !== "ready",
    refresh_reason:
      status === "ready"
        ? null
        : buildBlockingReason(
            "missing_papers",
            missingPapers,
            params.expectedPapers.length,
            pickString(params.payload, ["rootPath", "root_path"]) ?? params.remoteEndpoint
          ),
  };
}

async function refreshRemoteStatusRecord(params: {
  projectRoot: string;
  manifest: ManifestLike;
  checkedAt: string;
  expectedPapers: ExpectedPaper[];
  remoteAccess: PapernexusRemoteAccessConfig;
  remoteInspection: Awaited<ReturnType<typeof inspectPapernexusRemoteAccess>>;
  cachedStatusRecord: Record<string, unknown> | null;
}): Promise<{
  statusRecord: Record<string, unknown> | null;
  refreshError: string | null;
}> {
  const statusPath = path.join(params.projectRoot, "graph", "PAPERNEXUS_STATUS.json");
  const targetCorpus = resolveGraphRepairTargetCorpus({
    manifest: params.manifest,
    corpusName: pickString(params.cachedStatusRecord, ["corpus_name", "corpusName"]),
  });
  const remoteEndpoint =
    params.remoteInspection.summary.mcpUrl ?? params.remoteInspection.summary.apiBaseUrl ?? null;

  if (
    params.remoteInspection.summary.mcpUrl &&
    params.remoteInspection.summary.mcpTransport === "streamable-http"
  ) {
    const mcpResult = await fetchRemoteMcpCorpusSources({
      remoteInspection: params.remoteInspection,
      corpusName: targetCorpus,
    });
    if (mcpResult.payload) {
      const statusRecord = buildRemoteStatusRecordFromSources({
        payload: mcpResult.payload,
        mode: "remote_mcp",
        checkedAt: params.checkedAt,
        expectedPapers: params.expectedPapers,
        remoteEndpoint,
      });
      await writeJsonEnsured(statusPath, statusRecord);
      return { statusRecord, refreshError: null };
    }
    if (!params.remoteInspection.summary.apiBaseUrl) {
      return {
        statusRecord: params.cachedStatusRecord,
        refreshError: mcpResult.error,
      };
    }
  }

  if (params.remoteInspection.summary.apiBaseUrl && params.remoteInspection.token) {
    const apiResult = await fetchRemoteApiCorpusSources({
      apiBaseUrl: params.remoteInspection.summary.apiBaseUrl,
      token: params.remoteInspection.token,
      corpusName: targetCorpus,
    });
    if (apiResult.payload) {
      const statusRecord = buildRemoteStatusRecordFromSources({
        payload: apiResult.payload,
        mode: "remote_api",
        checkedAt: params.checkedAt,
        expectedPapers: params.expectedPapers,
        remoteEndpoint,
      });
      await writeJsonEnsured(statusPath, statusRecord);
      return { statusRecord, refreshError: null };
    }
    return {
      statusRecord: params.cachedStatusRecord,
      refreshError: apiResult.error,
    };
  }

  return {
    statusRecord: params.cachedStatusRecord,
    refreshError: null,
  };
}

async function checkGraphPresenceViaRemoteStatus(params: {
  projectRoot: string;
  manifest: ManifestLike;
  projectId: string | null;
  checkedAt: string;
  reportPath: string;
  expected: {
    papers: ExpectedPaper[];
    paperSourceIndexPath: string | null;
    usedPaperSourceIndex: boolean;
  };
  remoteAccess: PapernexusRemoteAccessConfig;
}): Promise<GraphPresenceCheckResult> {
  const remoteInspection = await inspectPapernexusRemoteAccess(params.remoteAccess);
  const statusPath = path.join(params.projectRoot, "graph", "PAPERNEXUS_STATUS.json");
  const cachedStatusRecord = await readJsonIfExists<Record<string, unknown>>(statusPath);
  const remoteEndpoint =
    remoteInspection.summary.apiBaseUrl ?? remoteInspection.summary.mcpUrl ?? null;
  const paperIngestionProgress = summarizePaperIngestionProgress(params.manifest);
  const refreshedStatus = remoteInspection.tokenAvailable
    ? await refreshRemoteStatusRecord({
        projectRoot: params.projectRoot,
        manifest: params.manifest,
        checkedAt: params.checkedAt,
        expectedPapers: params.expected.papers,
        remoteAccess: params.remoteAccess,
        remoteInspection,
        cachedStatusRecord,
      })
    : {
        statusRecord: cachedStatusRecord,
        refreshError: null,
      };
  const statusRecord = refreshedStatus.statusRecord;

  let status: GraphPresenceStatus = "ready";
  let refreshReason: string | null = null;
  let presentPaperCount = params.expected.papers.length;
  let missingPapers: GraphPresenceMissingPaper[] = [];

  if (params.expected.papers.length === 0) {
    status = "missing_sources";
  } else if (!remoteInspection.tokenAvailable) {
    status = "missing_corpus";
    refreshReason =
      `Configured remote PaperNexus access is unavailable${remoteEndpoint ? ` at ${remoteEndpoint}` : ""}` +
      `${remoteInspection.tokenError ? `: ${remoteInspection.tokenError}` : "."}` +
      " Fix the remote token/configuration and rerun /graph-build before frontier mapping or ideation.";
    presentPaperCount = 0;
  } else if (!statusRecord) {
    status = "missing_corpus";
    refreshReason = paperIngestionProgress.inFlight
      ? buildInFlightRemoteRefreshReason({
          remoteEndpoint,
          expectedPaperCount: params.expected.papers.length,
          presentPaperCount: 0,
          paperIngestion: paperIngestionProgress,
        })
      : refreshedStatus.refreshError
        ? `Failed to refresh remote PaperNexus graph status${remoteEndpoint ? ` from ${remoteEndpoint}` : ""}: ${refreshedStatus.refreshError}`
      : `No remote PaperNexus graph status is recorded yet for ${remoteEndpoint ?? "the configured endpoint"}. ` +
        "Run /graph-build with the configured remote PaperNexus endpoint to refresh graph readiness metadata and the brainstorm bundle before frontier mapping or ideation.";
    presentPaperCount = 0;
  } else {
    const statusExpectedCount =
      pickCount(statusRecord, ["expected_paper_count", "expectedPaperCount"]) ??
      params.expected.papers.length;
    presentPaperCount =
      pickCount(statusRecord, ["present_paper_count", "presentPaperCount"]) ?? 0;
    missingPapers = mergeRemoteMissingPapers({
      expectedPapers: params.expected.papers,
      statusRecord,
      expectedPaperCount: statusExpectedCount,
      presentPaperCount,
    });
    const normalizedStatus =
      pickString(statusRecord, ["status"])?.trim().toLowerCase() ?? null;
    const statusRefreshReason =
      pickString(statusRecord, ["refresh_reason", "refreshReason"]) ?? null;

    if (statusExpectedCount !== params.expected.papers.length) {
      status = "missing_corpus";
      refreshReason = paperIngestionProgress.inFlight
        ? buildInFlightRemoteRefreshReason({
            remoteEndpoint,
            expectedPaperCount: params.expected.papers.length,
            presentPaperCount,
            paperIngestion: paperIngestionProgress,
          })
        : `Remote PaperNexus graph status is stale for ${remoteEndpoint ?? "the configured endpoint"}: ` +
          `expected ${params.expected.papers.length} paper(s) from PAPER_SOURCE_INDEX.json but the latest remote status only covers ${statusExpectedCount}. ` +
          "Rerun /graph-build to refresh readiness metadata and brainstorm grounding before frontier mapping or ideation.";
      presentPaperCount = Math.min(presentPaperCount, params.expected.papers.length);
    } else if (normalizedStatus === "missing_corpus") {
      status = "missing_corpus";
      refreshReason =
        statusRefreshReason ??
        buildBlockingReason(
          "missing_corpus",
          [],
          params.expected.papers.length,
          remoteEndpoint
        );
    } else if (
      normalizedStatus === "missing_papers" ||
      missingPapers.length > 0 ||
      presentPaperCount < params.expected.papers.length
    ) {
      status = "missing_papers";
      refreshReason = paperIngestionProgress.inFlight
        ? buildInFlightRemoteRefreshReason({
            remoteEndpoint,
            expectedPaperCount: params.expected.papers.length,
            presentPaperCount,
            paperIngestion: paperIngestionProgress,
          })
        : statusRefreshReason ??
          buildBlockingReason(
            "missing_papers",
            missingPapers,
            params.expected.papers.length,
            remoteEndpoint
          );
    } else {
      status = "ready";
      presentPaperCount = params.expected.papers.length;
      refreshReason = null;
    }
  }

  const repairTargetCorpus = resolveGraphRepairTargetCorpus({
    manifest: params.manifest,
    corpusName: pickString(statusRecord, ["corpus_name", "corpusName"]),
  });
  const repairRequired = shouldRequireGraphImportRepair({
    status,
    expectedPaperCount: params.expected.papers.length,
    presentPaperCount,
    paperIngestion: paperIngestionProgress,
    canRepair: remoteInspection.tokenAvailable,
  });
  const repairReason = repairRequired
    ? buildGraphImportRepairReason({
        corpusName: repairTargetCorpus,
        expectedPaperCount: params.expected.papers.length,
        presentPaperCount,
        refreshReason,
      })
    : null;

  const result: GraphPresenceCheckResult = {
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    checkedAt: params.checkedAt,
    status,
    blockingReason: refreshReason,
    reportPath: params.reportPath,
    paperSourceIndexPath: params.expected.paperSourceIndexPath,
    usedPaperSourceIndex: params.expected.usedPaperSourceIndex,
    expectedPaperCount: params.expected.papers.length,
    presentPaperCount,
    missingPaperCount:
      status === "ready"
        ? 0
        : Math.max(
            0,
            missingPapers.length > 0
              ? missingPapers.length
              : params.expected.papers.length - presentPaperCount
          ),
    corpusRoot:
      pickString(statusRecord, ["corpus_root", "corpusRoot"]) ?? remoteEndpoint ?? null,
    corpusName: pickString(statusRecord, ["corpus_name", "corpusName"]),
    corpusManifestPath: null,
    corpusMetaPath: null,
    refreshRequired: status === "missing_corpus" || status === "missing_papers",
    refreshReason,
    repairRequired,
    repairReason,
    repairTargetCorpus: repairRequired ? repairTargetCorpus : null,
    presentPapers: [],
    missingPapers: status === "ready" ? [] : missingPapers,
    manifestUpdated: false,
  };

  await writeJsonEnsured(params.reportPath, {
    checked_at: params.checkedAt,
    project_id: params.projectId,
    status: result.status,
    blocking_reason: result.blockingReason,
    corpus_root: result.corpusRoot,
    corpus_name: result.corpusName,
    paper_source_index_path: result.paperSourceIndexPath,
    used_paper_source_index: result.usedPaperSourceIndex,
    expected_paper_count: result.expectedPaperCount,
    present_paper_count: result.presentPaperCount,
    missing_paper_count: result.missingPaperCount,
    refresh_required: result.refreshRequired,
    refresh_reason: result.refreshReason,
    repair_required: result.repairRequired,
    repair_reason: result.repairReason,
    repair_target_corpus: result.repairTargetCorpus,
    missing_papers: serializeMissingPapers(result.missingPapers),
    present_papers: serializePresentPapers(result.presentPapers),
  });
  await persistGraphPresenceArtifacts({
    projectRoot: params.projectRoot,
    result,
    mode:
      pickString(statusRecord, ["mode"]) ??
      (remoteInspection.summary.mcpUrl ? "remote_mcp" : "remote_api"),
    existingStatusRecord: statusRecord,
  });

  return result;
}

export async function checkGraphPresenceForWorkflow(params: {
  projectRoot: string;
  updateManifest?: boolean;
  remoteAccess?: PapernexusRemoteAccessConfig | null;
}): Promise<GraphPresenceCheckResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifest = await readManifest(projectRoot);
  const projectId = inferProjectId(projectRoot, manifest);
  const checkedAt = new Date().toISOString();
  const reportPath = getGraphPresenceReportPath(projectRoot);
  if (params.updateManifest !== false) {
    await writePapernexusProgressFromManifest({
      projectRoot,
      manifest,
      phaseOverride: "verifying_graph",
      nextActionOverride: "rerun graph check",
      blockingReasonOverride: "Graph presence verification is running.",
      updatedAt: checkedAt,
    });
  }

  const expected = await resolveExpectedPapers({
    projectRoot,
    manifest,
    projectId,
  });
  const remoteApiBaseUrl = asString(params.remoteAccess?.apiBaseUrl);
  const remoteMcpUrl = asString(params.remoteAccess?.mcpUrl);
  if (remoteApiBaseUrl || remoteMcpUrl) {
    const result = await checkGraphPresenceViaRemoteStatus({
      projectRoot,
      manifest,
      projectId,
      checkedAt,
      reportPath,
      expected,
      remoteAccess: params.remoteAccess ?? {},
    });

    if (params.updateManifest !== false) {
      const paperIngestion = asRecord(manifest.paper_ingestion) ?? {};
      manifest.paper_ingestion = {
        ...paperIngestion,
        graph_presence_checked_at: checkedAt,
        graph_presence_status: result.status,
        graph_presence_report_path: path.relative(projectRoot, reportPath),
        graph_presence_expected_papers: result.expectedPaperCount,
        graph_presence_present_papers: result.presentPaperCount,
        graph_presence_missing_papers: serializeMissingPapers(result.missingPapers),
        refresh_required: result.refreshRequired ? true : false,
        refresh_reason: result.refreshRequired ? result.refreshReason : null,
        repair_required: result.repairRequired ? true : false,
        repair_reason: result.repairRequired ? result.repairReason : null,
        repair_target_corpus: result.repairRequired ? result.repairTargetCorpus : null,
      };
      await saveManifest(projectRoot, manifest);
      await writePapernexusProgressFromManifest({
        projectRoot,
        manifest,
        updatedAt: checkedAt,
      });
      result.manifestUpdated = true;
    }

    return result;
  }

  const corpusResolution = await resolveCorpusRoot({
    projectRoot,
    manifest,
    projectId,
  });
  const corpusManifestPath = corpusResolution.corpusRoot
    ? path.join(corpusResolution.corpusRoot, ".papernexus", "sources.json")
    : null;
  const corpusMetaPath = corpusResolution.corpusRoot
    ? path.join(corpusResolution.corpusRoot, ".papernexus", "meta.json")
    : null;
  const sourceManifest = corpusManifestPath
    ? await readJsonIfExists<Record<string, unknown>>(corpusManifestPath)
    : null;
  const corpusMeta = corpusMetaPath
    ? await readJsonIfExists<Record<string, unknown>>(corpusMetaPath)
    : null;

  const corpusEntries = Array.isArray(sourceManifest?.sources)
    ? sourceManifest.sources
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        .map((entry) => buildCorpusPaper(entry))
    : [];

  const presentPapers: GraphPresenceMatch[] = [];
  const missingPapers: GraphPresenceMissingPaper[] = [];
  for (const paper of expected.papers) {
    const match = matchExpectedPaper(paper, corpusEntries);
    if (match) {
      presentPapers.push(match);
    } else {
      missingPapers.push({
        canonicalId: paper.canonicalId,
        title: paper.title,
        normalizedTitle: paper.normalizedTitle,
        arxivId: paper.arxivId,
        doi: paper.doi,
        sourceKind: paper.sourceKind,
        sourceProvider: paper.sourceProvider,
        retrievalProviders: paper.retrievalProviders,
      });
    }
  }

  let status: GraphPresenceStatus;
  if (expected.papers.length === 0) {
    status = "missing_sources";
  } else if (!sourceManifest || !corpusMeta) {
    status = "missing_corpus";
  } else if (missingPapers.length > 0) {
    status = "missing_papers";
  } else {
    status = "ready";
  }

  const refreshRequired = status === "missing_corpus" || status === "missing_papers";
  const refreshReason =
    status === "ready"
      ? null
      : buildBlockingReason(
          status,
          missingPapers,
          expected.papers.length,
          corpusResolution.corpusRoot
        );
  const paperIngestionProgress = summarizePaperIngestionProgress(manifest);
  const repairTargetCorpus = resolveGraphRepairTargetCorpus({
    manifest,
    corpusName:
      corpusResolution.corpusName ??
      pickString(corpusMeta, ["name", "corpusName", "corpus_name"]),
  });
  const repairRequired = shouldRequireGraphImportRepair({
    status,
    expectedPaperCount: expected.papers.length,
    presentPaperCount: presentPapers.length,
    paperIngestion: paperIngestionProgress,
    canRepair: true,
  });
  const repairReason = repairRequired
    ? buildGraphImportRepairReason({
        corpusName: repairTargetCorpus,
        expectedPaperCount: expected.papers.length,
        presentPaperCount: presentPapers.length,
        refreshReason,
      })
    : null;

  const result: GraphPresenceCheckResult = {
    projectRoot,
    projectId,
    checkedAt,
    status,
    blockingReason: refreshReason,
    reportPath,
    paperSourceIndexPath: expected.paperSourceIndexPath,
    usedPaperSourceIndex: expected.usedPaperSourceIndex,
    expectedPaperCount: expected.papers.length,
    presentPaperCount: presentPapers.length,
    missingPaperCount: missingPapers.length,
    corpusRoot: corpusResolution.corpusRoot,
    corpusName:
      corpusResolution.corpusName ??
      pickString(corpusMeta, ["name", "corpusName", "corpus_name"]),
    corpusManifestPath,
    corpusMetaPath,
    refreshRequired,
    refreshReason,
    repairRequired,
    repairReason,
    repairTargetCorpus: repairRequired ? repairTargetCorpus : null,
    presentPapers,
    missingPapers,
    manifestUpdated: false,
  };

  await writeJsonEnsured(reportPath, {
    checked_at: checkedAt,
    project_id: projectId,
    status,
    blocking_reason: result.blockingReason,
    corpus_root: result.corpusRoot,
    corpus_name: result.corpusName,
    paper_source_index_path: result.paperSourceIndexPath,
    used_paper_source_index: result.usedPaperSourceIndex,
    expected_paper_count: result.expectedPaperCount,
    present_paper_count: result.presentPaperCount,
    missing_paper_count: result.missingPaperCount,
    refresh_required: result.refreshRequired,
    refresh_reason: result.refreshReason,
    repair_required: result.repairRequired,
    repair_reason: result.repairReason,
    repair_target_corpus: result.repairTargetCorpus,
    missing_papers: serializeMissingPapers(result.missingPapers),
    present_papers: serializePresentPapers(result.presentPapers),
  });
  await persistGraphPresenceArtifacts({
    projectRoot,
    result,
    mode: "local_corpus",
    existingStatusRecord: {
      manifest: {
        version:
          typeof sourceManifest?.version === "number" && Number.isFinite(sourceManifest.version)
            ? sourceManifest.version
            : null,
        corpus_name:
          pickString(sourceManifest ?? {}, ["corpusName", "corpus_name"]) ??
          result.corpusName,
        indexed_at:
          pickString(sourceManifest ?? {}, ["indexedAt", "indexed_at"]) ??
          pickString(corpusMeta ?? {}, ["indexedAt", "indexed_at"]),
      },
      meta: corpusMeta ?? null,
    },
  });

  if (params.updateManifest !== false) {
    const paperIngestion = asRecord(manifest.paper_ingestion) ?? {};
    manifest.paper_ingestion = {
      ...paperIngestion,
      graph_presence_checked_at: checkedAt,
      graph_presence_status: status,
      graph_presence_report_path: path.relative(projectRoot, reportPath),
      graph_presence_expected_papers: result.expectedPaperCount,
      graph_presence_present_papers: result.presentPaperCount,
      graph_presence_missing_papers: serializeMissingPapers(result.missingPapers),
      refresh_required: refreshRequired ? true : false,
      refresh_reason: refreshRequired ? refreshReason : null,
      repair_required: result.repairRequired ? true : false,
      repair_reason: result.repairRequired ? result.repairReason : null,
      repair_target_corpus: result.repairRequired ? result.repairTargetCorpus : null,
    };
    await saveManifest(projectRoot, manifest);
    await writePapernexusProgressFromManifest({
      projectRoot,
      manifest,
      updatedAt: checkedAt,
    });
    result.manifestUpdated = true;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Automatic graph refresh trigger
// ---------------------------------------------------------------------------

export type GraphRefreshTriggerResult = {
  triggered: boolean;
  mode: "local_mcp" | "remote_api" | "skipped";
  error: string | null;
};

type McpClientLike = {
  callTool: (
    toolName: string,
    params?: Record<string, unknown>
  ) => Promise<{ ok: boolean; data: unknown; error: string | null }>;
};

export async function triggerGraphRefreshIfNeeded(params: {
  projectRoot: string;
  presenceResult: GraphPresenceCheckResult;
  mcpClient?: McpClientLike | null;
  remoteApiBaseUrl?: string | null;
  remoteApiToken?: string | null;
  manifest?: Record<string, unknown> | null;
  saveManifest?: (projectRoot: string, manifest: Record<string, unknown>) => Promise<void>;
}): Promise<GraphRefreshTriggerResult> {
  const {
    presenceResult,
    mcpClient,
    remoteApiBaseUrl,
    remoteApiToken,
    manifest,
    saveManifest: saveFn,
  } = params;

  if (!presenceResult.refreshRequired) {
    return { triggered: false, mode: "skipped", error: null };
  }

  const now = new Date().toISOString();

  // Try local MCP first
  if (mcpClient) {
    const statusResult = await mcpClient.callTool("refresh_corpus", {
      corpus: presenceResult.corpusName ?? undefined,
      incremental: true,
    });
    if (statusResult.ok) {
      if (manifest && saveFn) {
        const graphWatch = (manifest.graph_watch ?? {}) as Record<string, unknown>;
        graphWatch.refreshTriggered = true;
        graphWatch.refreshTriggeredAt = now;
        graphWatch.refreshMode = "local_mcp";
        manifest.graph_watch = graphWatch;
        await saveFn(params.projectRoot, manifest);
      }
      return { triggered: true, mode: "local_mcp", error: null };
    }
    return {
      triggered: false,
      mode: "local_mcp",
      error: statusResult.error ?? "MCP corpus_status call failed.",
    };
  }

  // Try remote API
  if (remoteApiBaseUrl && remoteApiToken) {
    try {
      const url = `${remoteApiBaseUrl.replace(/\/+$/, "")}/api/corpus/refresh`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${remoteApiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          corpus: presenceResult.corpusName ?? undefined,
          incremental: true,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) {
        if (manifest && saveFn) {
          const graphWatch = (manifest.graph_watch ?? {}) as Record<string, unknown>;
          graphWatch.refreshTriggered = true;
          graphWatch.refreshTriggeredAt = now;
          graphWatch.refreshMode = "remote_api";
          manifest.graph_watch = graphWatch;
          await saveFn(params.projectRoot, manifest);
        }
        return { triggered: true, mode: "remote_api", error: null };
      }
      return {
        triggered: false,
        mode: "remote_api",
        error: `Remote API refresh returned ${response.status}: ${response.statusText}`,
      };
    } catch (err) {
      return {
        triggered: false,
        mode: "remote_api",
        error: `Remote API refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return {
    triggered: false,
    mode: "skipped",
    error: "No MCP client or remote API credentials available for graph refresh.",
  };
}
