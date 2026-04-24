import os from "node:os";
import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  inspectPapernexusRemoteAccess,
  type PapernexusRemoteAccessConfig,
} from "./papernexus-secret";
import { normalizeGraphPresenceStatus } from "./workflow-guard-core/coercion";
import {
  buildCanonicalPaperRecordFromRecord,
  collectRetrievalProviders as collectRetrievalProvidersShared,
  inferPaperSourceProvider as inferSourceProviderShared,
  mergeCanonicalPaperRecords,
  sourceKindRank as sourceKindRankShared,
  sourceProviderRank as sourceProviderRankShared,
} from "./paper-source-contract";
import { writePapernexusProgressFromManifest } from "./papernexus-progress";
import {
  DEFAULT_SHARED_PAPERNEXUS_CORPUS,
  resolveWorkflowSharedPapernexusCorpus,
} from "./papernexus-shared-corpus";

export type GraphPresenceStatus =
  | "ready"
  | "missing_papers"
  | "missing_corpus"
  | "missing_sources";

export type GraphPresenceVerificationMode =
  | "canonical_paper_index"
  | "remote_corpus_summary"
  | "paper_source_index_override";

type ManifestLike = Record<string, unknown>;

type ExpectedPaper = {
  canonicalId: string;
  title: string | null;
  normalizedTitle: string | null;
  titleSignature: string | null;
  arxivId: string | null;
  doi: string | null;
  sourceHints: string[];
  sourceKind: "markdown" | "pdf" | "unknown";
  sourceProvider: string | null;
  retrievalProviders: string[];
  graphPaperId: string | null;
  graphPresence: string | null;
  importStatus: string | null;
  graphNodeIds: string[];
};

type CorpusPaper = {
  paperId: string | null;
  paperTitle: string | null;
  sourceKey: string | null;
  activeInGraph: boolean;
  arxivIds: Set<string>;
  dois: Set<string>;
  normalizedTitles: Set<string>;
  titleSignatures: Set<string>;
  sourceHints: Set<string>;
  sourceBasenames: Set<string>;
};

export type GraphPresenceMatch = {
  canonicalId: string;
  title: string | null;
  sourceKind: "markdown" | "pdf" | "unknown";
  sourceProvider: string | null;
  retrievalProviders: string[];
  matchedBy: "arxiv" | "doi" | "source_path" | "title" | "paper_source_index";
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
  verificationMode: GraphPresenceVerificationMode;
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

type ResolvedExpectedPapers = {
  papers: ExpectedPaper[];
  paperSourceIndexPath: string | null;
  usedPaperSourceIndex: boolean;
  expectedPaperCountHint: number | null;
  summaryOnly: boolean;
  graphPresenceOverride: {
    status: GraphPresenceStatus | null;
    reason: string | null;
    checkedAt: string | null;
  } | null;
  sourceIndexUpdatedAt: string | null;
};

const PAPER_SOURCE_INDEX_CANDIDATE_KEYS = [
  "papers",
  "entries",
  "items",
  "sources",
  "canonical_papers",
  "canonicalPapers",
];

const PAPER_SOURCE_INDEX_RELATIVE_PATHS = [
  path.join("researcher", "PAPER_SOURCE_INDEX.json"),
  path.join("researcher", "paper-staging", "PAPER_SOURCE_INDEX.json"),
  path.join("graph", "PAPER_SOURCE_INDEX.json"),
] as const;

const ARXIV_ID_REGEX = /\b(?:[a-z-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?\b/gi;
const DOI_REGEX = /\b10\.\d{4,9}\/[-._;()/:a-z0-9]+\b/gi;
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

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRemoteEndpointLike(value: string | null | undefined): boolean {
  return Boolean(value && /^[a-z]+:\/\//i.test(value));
}

function sanitizeCorpusRootValue(value: unknown): string | null {
  const raw = asString(value);
  if (!raw || isRemoteEndpointLike(raw)) {
    return null;
  }
  return raw;
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

function resolvePaperSourceIndexCountHint(raw: unknown): number | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  const sourceMode = pickString(record, ["source_mode", "sourceMode"])?.toLowerCase();
  const graphMode = pickString(record, ["graph_mode", "graphMode"])?.toLowerCase();
  const graphPresenceStatus = pickString(record, [
    "graph_presence_status",
    "graphPresenceStatus",
  ])?.toLowerCase();
  const candidateCount =
    pickCount(record, [
      "graph_presence_expected",
      "graphPresenceExpected",
      "paper_count",
      "paperCount",
      "graph_presence_present",
      "graphPresencePresent",
    ]) ?? null;
  if (!candidateCount || candidateCount <= 0) {
    return null;
  }
  if (
    sourceMode === "remote_corpus" ||
    graphMode === "remote_papernexus" ||
    graphPresenceStatus === "ready"
  ) {
    return candidateCount;
  }
  return null;
}

function maxPositiveCount(values: Array<number | null>): number | null {
  const counts = values.filter(
    (value): value is number => typeof value === "number" && value > 0
  );
  return counts.length > 0 ? Math.max(...counts) : null;
}

function resolveManifestGraphPresenceCountHint(manifest: ManifestLike): number | null {
  const paperIngestion = asRecord(manifest.paper_ingestion);
  return maxPositiveCount([
    pickCount(paperIngestion, [
      "graph_presence_expected_papers",
      "graphPresenceExpectedPapers",
      "graph_presence_expected",
      "graphPresenceExpected",
    ]),
    pickCount(paperIngestion, [
      "graph_presence_present_papers",
      "graphPresencePresentPapers",
      "graph_presence_present",
      "graphPresencePresent",
    ]),
    pickCount(paperIngestion, ["remote_paper_count", "remotePaperCount"]),
    pickCount(paperIngestion, ["synced_papers", "syncedPapers"]),
  ]);
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
  // Expand ~ to home directory (Node.js path.resolve does NOT do this)
  const expanded = value.startsWith('~') ? value.replace('~', os.homedir()) : value;
  const absolute = path.resolve(expanded);
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

function normalizeTitleToken(value: string): string {
  let normalized = value.trim().toLowerCase();
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

function buildTitleSignature(value: string | null | undefined): string | null {
  const normalized = normalizeTitle(value);
  if (!normalized) {
    return null;
  }
  const tokens = normalized
    .split(" ")
    .map((token) => normalizeTitleToken(token))
    .filter(
      (token) =>
        token.length >= 3 && !TITLE_SIGNATURE_STOPWORDS.has(token)
    );
  const signature = Array.from(new Set(tokens)).sort().join(" ");
  return signature || null;
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
  return collectRetrievalProvidersShared(record);
}

function inferSourceProvider(
  record: Record<string, unknown> | null,
  sourceKind: "markdown" | "pdf" | "unknown",
  sourceHints: string[]
): string | null {
  return inferSourceProviderShared(record, sourceKind, sourceHints);
}

function sourceKindRank(kind: "markdown" | "pdf" | "unknown"): number {
  return sourceKindRankShared(kind);
}

function sourceProviderRank(provider: string | null): number {
  return sourceProviderRankShared(provider);
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
    verification_mode: params.result.verificationMode,
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
    `Verification Mode: ${result.verificationMode}`,
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

function collectGraphNodeIds(record: Record<string, unknown> | null): string[] {
  if (!record) {
    return [];
  }
  return uniqueStrings([
    pickString(record, ["graph_paper_id", "graphPaperId"]),
    pickString(record, ["node_id", "nodeId"]),
    ...asStringArray(record.graph_node_ids),
    ...asStringArray(record.graphNodeIds),
    ...asStringArray(record.graph_nodes),
    ...asStringArray(record.graphNodes),
    ...asStringArray(record.node_refs),
    ...asStringArray(record.nodeRefs),
    ...asStringArray(record.linked_graph_nodes),
    ...asStringArray(record.linkedGraphNodes),
  ].filter((item): item is string => Boolean(item)));
}

function normalizeExpectedGraphPresence(value: string | null | undefined): string | null {
  return asString(value)?.trim().toLowerCase() ?? null;
}

function normalizeExpectedImportStatus(value: string | null | undefined): string | null {
  return asString(value)?.trim().toLowerCase() ?? null;
}

function isExplicitGraphPresenceConfirmed(value: string | null | undefined): boolean {
  const normalized = normalizeExpectedGraphPresence(value);
  return Boolean(
    normalized &&
      (normalized === "ready" ||
        normalized === "confirmed" ||
        normalized.startsWith("confirmed_") ||
        normalized === "present_in_graph" ||
        normalized === "already_present")
  );
}

function isExplicitImportStatusConfirmed(value: string | null | undefined): boolean {
  const normalized = normalizeExpectedImportStatus(value);
  return Boolean(
    normalized &&
      [
        "deduped",
        "completed",
        "indexed",
        "graph_synced",
        "already_present",
        "present_in_graph",
      ].includes(normalized)
  );
}

function isExpectedPaperExplicitlyConfirmed(paper: ExpectedPaper): boolean {
  return (
    Boolean(paper.graphPaperId) ||
    paper.graphNodeIds.length > 0 ||
    isExplicitGraphPresenceConfirmed(paper.graphPresence) ||
    isExplicitImportStatusConfirmed(paper.importStatus)
  );
}

function buildPaperSourceIndexMatch(expected: ExpectedPaper): GraphPresenceMatch {
  return {
    canonicalId: expected.canonicalId,
    title: expected.title,
    sourceKind: expected.sourceKind,
    sourceProvider: expected.sourceProvider,
    retrievalProviders: expected.retrievalProviders,
    matchedBy: "paper_source_index",
    corpusPaperId: expected.graphPaperId ?? expected.graphNodeIds[0] ?? null,
    corpusPaperTitle: expected.title,
    corpusSourceKey: expected.sourceHints[0] ?? null,
  };
}

function buildExpectedPaperFromRecord(
  raw: Record<string, unknown>,
  fallbackCanonicalId?: string
): ExpectedPaper | null {
  const paper = buildCanonicalPaperRecordFromRecord(raw, fallbackCanonicalId);
  if (!paper) {
    return null;
  }
  return {
    canonicalId: paper.canonicalId,
    title: paper.title,
    normalizedTitle: paper.normalizedTitle,
    titleSignature: paper.titleSignature,
    arxivId: paper.arxivId,
    doi: paper.doi,
    sourceHints: paper.sourceHints,
    sourceKind: paper.sourceKind,
    sourceProvider: paper.sourceProvider,
    retrievalProviders: paper.retrievalProviders,
    graphPaperId:
      pickString(raw, ["graph_paper_id", "graphPaperId"]) ??
      pickString(raw, ["paper_id", "paperId"]),
    graphPresence: pickString(raw, ["graph_presence", "graphPresence"]),
    importStatus: pickString(raw, ["import_status", "importStatus"]),
    graphNodeIds: collectGraphNodeIds(raw),
  };
}

function mergeExpectedPaper(target: ExpectedPaper, incoming: ExpectedPaper): ExpectedPaper {
  const merged = mergeCanonicalPaperRecords(
    {
      canonicalId: target.canonicalId,
      title: target.title,
      normalizedTitle: target.normalizedTitle,
      titleSignature: target.titleSignature,
      arxivId: target.arxivId,
      doi: target.doi,
      pmid: null,
      pmcid: null,
      year: null,
      venue: null,
      venueFamily: null,
      venueType: "unknown",
      venuePackHits: [],
      venueAliasesMatched: [],
      sourceHints: target.sourceHints,
      sourceKind: target.sourceKind,
      sourceProvider: target.sourceProvider,
      sourcePath: target.sourceHints[0] ?? null,
      retrievalProviders: target.retrievalProviders,
      citationCount: null,
      bestOaUrl: null,
      pdfUrl: null,
      resolutionStatus: "unknown",
      resolutionAttempts: [],
    },
    {
      canonicalId: incoming.canonicalId,
      title: incoming.title,
      normalizedTitle: incoming.normalizedTitle,
      titleSignature: incoming.titleSignature,
      arxivId: incoming.arxivId,
      doi: incoming.doi,
      pmid: null,
      pmcid: null,
      year: null,
      venue: null,
      venueFamily: null,
      venueType: "unknown",
      venuePackHits: [],
      venueAliasesMatched: [],
      sourceHints: incoming.sourceHints,
      sourceKind: incoming.sourceKind,
      sourceProvider: incoming.sourceProvider,
      sourcePath: incoming.sourceHints[0] ?? null,
      retrievalProviders: incoming.retrievalProviders,
      citationCount: null,
      bestOaUrl: null,
      pdfUrl: null,
      resolutionStatus: "unknown",
      resolutionAttempts: [],
    }
  );
  return {
    canonicalId: merged.canonicalId,
    title: merged.title,
    normalizedTitle: merged.normalizedTitle,
    titleSignature: merged.titleSignature,
    arxivId: merged.arxivId,
    doi: merged.doi,
    sourceHints: merged.sourceHints,
    sourceKind: merged.sourceKind,
    sourceProvider: merged.sourceProvider,
    retrievalProviders: merged.retrievalProviders,
    graphPaperId: target.graphPaperId ?? incoming.graphPaperId,
    graphPresence: target.graphPresence ?? incoming.graphPresence,
    importStatus: target.importStatus ?? incoming.importStatus,
    graphNodeIds: uniqueStrings([...target.graphNodeIds, ...incoming.graphNodeIds]),
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

function resolvePaperSourceIndexGraphPresenceOverride(raw: unknown): {
  status: GraphPresenceStatus | null;
  reason: string | null;
  checkedAt: string | null;
} | null {
  const record = asRecord(raw);
  const override = asRecord(record?.graph_presence_override ?? record?.graphPresenceOverride);
  const status = normalizeGraphPresenceStatus(override?.status ?? null);
  const reason = pickString(override, ["reason"]);
  const checkedAt = pickString(override, ["checked_at", "checkedAt"]);
  return status || reason || checkedAt
    ? {
        status,
        reason,
        checkedAt,
      }
    : null;
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
}): Promise<ResolvedExpectedPapers> {
  let fallbackPaperSourceIndexPath: string | null = null;
  let fallbackPaperSourceIndex: unknown = null;
  for (const relativePath of PAPER_SOURCE_INDEX_RELATIVE_PATHS) {
    const paperSourceIndexPath = path.join(params.projectRoot, relativePath);
    const paperSourceIndex = await readJsonIfExists<unknown>(paperSourceIndexPath);
    const exists = paperSourceIndex !== null || (await pathExists(paperSourceIndexPath));
    if (exists && !fallbackPaperSourceIndexPath) {
      fallbackPaperSourceIndexPath = paperSourceIndexPath;
      fallbackPaperSourceIndex = paperSourceIndex;
    }
    if (paperSourceIndex === null) {
      continue;
    }
    const indexedPapers = parsePaperSourceIndex(paperSourceIndex);
    if (indexedPapers.length > 0) {
      return {
        papers: indexedPapers,
        paperSourceIndexPath,
        usedPaperSourceIndex: true,
        expectedPaperCountHint: indexedPapers.length,
        summaryOnly: false,
        graphPresenceOverride: resolvePaperSourceIndexGraphPresenceOverride(paperSourceIndex),
        sourceIndexUpdatedAt:
          pickString(asRecord(paperSourceIndex), ["updated_at", "updatedAt"]) ??
          pickString(asRecord(paperSourceIndex), ["created_at", "createdAt"]),
      };
    }
  }
  const summaryCountHint = resolvePaperSourceIndexCountHint(fallbackPaperSourceIndex);
  const manifestCountHint = resolveManifestGraphPresenceCountHint(params.manifest);
  const expectedPaperCountHint = summaryCountHint ?? manifestCountHint;
  return {
    papers: [],
    paperSourceIndexPath: fallbackPaperSourceIndexPath,
    usedPaperSourceIndex: summaryCountHint !== null,
    expectedPaperCountHint,
    summaryOnly: expectedPaperCountHint !== null,
    graphPresenceOverride: resolvePaperSourceIndexGraphPresenceOverride(fallbackPaperSourceIndex),
    sourceIndexUpdatedAt:
      pickString(asRecord(fallbackPaperSourceIndex), ["updated_at", "updatedAt"]) ??
      pickString(asRecord(fallbackPaperSourceIndex), ["created_at", "createdAt"]),
  };
}

function resolveExpectedPaperCount(expected: ResolvedExpectedPapers): number {
  if (expected.papers.length > 0) {
    return expected.papers.length;
  }
  return Math.max(0, expected.expectedPaperCountHint ?? 0);
}

async function resolveCorpusRoot(params: {
  projectRoot: string;
  manifest: ManifestLike;
  projectId: string | null;
  sharedCorpus: string | null;
}): Promise<{ corpusRoot: string | null; corpusName: string | null }> {
  const statusPath = path.join(params.projectRoot, "graph", "PAPERNEXUS_STATUS.json");
  const status = await readJsonIfExists<Record<string, unknown>>(statusPath);
  const paperIngestion = asRecord(params.manifest.paper_ingestion);
  const explicitCorpusName = resolveWorkflowSharedPapernexusCorpus({
    candidates: [
      pickString(paperIngestion, [
        "corpus_name",
        "corpusName",
        "shared_corpus",
        "sharedCorpus",
      ]),
      pickString(params.manifest, ["papernexus_corpus"]),
      params.sharedCorpus,
      pickString(status, ["corpus_name", "corpusName"]),
    ],
    projectId: params.projectId,
    projectRoot: params.projectRoot,
  });
  const registryRoot = await resolveCorpusRootFromRegistry(explicitCorpusName);
  const defaultRegistryCorpus = explicitCorpusName
    ? { corpusRoot: null, corpusName: null }
    : await resolveDefaultCorpusFromRegistry();
  const corpusName = explicitCorpusName ?? defaultRegistryCorpus.corpusName ?? null;
  const candidates = uniqueStrings([
    sanitizeCorpusRootValue(
      pickString(paperIngestion, ["corpus_root", "corpusRoot"])
    ),
    sanitizeCorpusRootValue(pickString(params.manifest, ["papernexus_root"])),
    sanitizeCorpusRootValue(
      pickString(status, [
        "corpus_root",
        "corpusRoot",
        "root_path",
        "rootPath",
        "source_dir",
        "sourceDir",
      ])
    ),
    sanitizeCorpusRootValue(registryRoot),
    sanitizeCorpusRootValue(defaultRegistryCorpus.corpusRoot),
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

function resolvePreferredPapernexusCorpusName(params: {
  manifest: ManifestLike;
  statusRecord?: Record<string, unknown> | null;
  projectId: string | null;
  projectRoot: string;
  sharedCorpus: string | null;
}): string | null {
  const paperIngestion = asRecord(params.manifest.paper_ingestion);
  return resolveWorkflowSharedPapernexusCorpus({
    candidates: [
      pickString(paperIngestion, [
        "corpus_name",
        "corpusName",
        "shared_corpus",
        "sharedCorpus",
      ]),
      pickString(params.manifest, ["papernexus_corpus"]),
      params.sharedCorpus,
      pickString(params.statusRecord ?? null, ["corpus_name", "corpusName"]),
    ],
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    fallback: DEFAULT_SHARED_PAPERNEXUS_CORPUS,
  });
}

function resolvePreferredPapernexusCorpusRoot(params: {
  manifest: ManifestLike;
  statusRecord?: Record<string, unknown> | null;
}): string | null {
  const paperIngestion = asRecord(params.manifest.paper_ingestion);
  return (
    sanitizeCorpusRootValue(
      pickString(paperIngestion, ["corpus_root", "corpusRoot"])
    ) ??
    sanitizeCorpusRootValue(pickString(params.manifest, ["papernexus_root"])) ??
    sanitizeCorpusRootValue(
      pickString(params.statusRecord ?? null, [
        "corpus_root",
        "corpusRoot",
        "root_path",
        "rootPath",
      ])
    ) ??
    null
  );
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
    titleSignatures: new Set(
      titleHints
        .map((value) => buildTitleSignature(value))
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

  if (expected.titleSignature) {
    const match = activeCorpus.find((entry) =>
      entry.titleSignatures.has(expected.titleSignature as string)
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

  const expectedSignature =
    expected.titleSignature ??
    buildTitleSignature(expected.normalizedTitle) ??
    buildTitleSignature(expected.title) ??
    buildTitleSignature(expected.sourceHints[0] ?? null);
  if (expectedSignature) {
    const match = activeCorpus.find((entry) =>
      Array.from(entry.normalizedTitles).some(
        (title) => buildTitleSignature(title) === expectedSignature
      )
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

function isGraphPresenceOverrideFresh(params: {
  expected: ResolvedExpectedPapers;
}): boolean {
  if (params.expected.graphPresenceOverride?.status !== "ready") {
    return false;
  }
  const checkedAt = params.expected.graphPresenceOverride?.checkedAt;
  const updatedAt = params.expected.sourceIndexUpdatedAt;
  if (!checkedAt || !updatedAt) {
    return true;
  }
  const checkedMs = Date.parse(checkedAt);
  const updatedMs = Date.parse(updatedAt);
  if (!Number.isFinite(checkedMs) || !Number.isFinite(updatedMs)) {
    return true;
  }
  return checkedMs >= updatedMs;
}

function applyPaperSourceIndexGraphConfirmation(params: {
  expected: ResolvedExpectedPapers;
  presentPapers: GraphPresenceMatch[];
  missingPapers: GraphPresenceMissingPaper[];
  allowOverride: boolean;
}): {
  presentPapers: GraphPresenceMatch[];
  missingPapers: GraphPresenceMissingPaper[];
  verificationMode: GraphPresenceVerificationMode | null;
} {
  const expectedByCanonicalId = new Map(
    params.expected.papers.map((paper) => [paper.canonicalId, paper])
  );
  const presentByCanonicalId = new Set(
    params.presentPapers.map((paper) => paper.canonicalId)
  );
  const presentPapers = [...params.presentPapers];
  const unresolvedMissing: GraphPresenceMissingPaper[] = [];
  let usedExplicitConfirmation = false;

  for (const missingPaper of params.missingPapers) {
    const expectedPaper = expectedByCanonicalId.get(missingPaper.canonicalId);
    if (expectedPaper && isExpectedPaperExplicitlyConfirmed(expectedPaper)) {
      presentPapers.push(buildPaperSourceIndexMatch(expectedPaper));
      presentByCanonicalId.add(expectedPaper.canonicalId);
      usedExplicitConfirmation = true;
      continue;
    }
    unresolvedMissing.push(missingPaper);
  }

  const canForceReady =
    params.allowOverride && isGraphPresenceOverrideFresh({ expected: params.expected });
  if (canForceReady && unresolvedMissing.length > 0) {
    for (const expectedPaper of params.expected.papers) {
      if (presentByCanonicalId.has(expectedPaper.canonicalId)) {
        continue;
      }
      presentPapers.push(buildPaperSourceIndexMatch(expectedPaper));
      presentByCanonicalId.add(expectedPaper.canonicalId);
    }
    return {
      presentPapers,
      missingPapers: [],
      verificationMode: "paper_source_index_override",
    };
  }

  return {
    presentPapers,
    missingPapers: unresolvedMissing,
    verificationMode: usedExplicitConfirmation ? "paper_source_index_override" : null,
  };
}

function applyPaperSourceIndexGraphPresenceOverride(params: {
  result: GraphPresenceCheckResult;
  expected: ResolvedExpectedPapers;
  allowOverride: boolean;
}): GraphPresenceCheckResult {
  if (params.expected.papers.length === 0) {
    return params.result;
  }
  const confirmation = applyPaperSourceIndexGraphConfirmation({
    expected: params.expected,
    presentPapers: params.result.presentPapers,
    missingPapers: params.result.missingPapers,
    allowOverride: params.allowOverride,
  });
  const changed =
    confirmation.verificationMode !== null ||
    confirmation.presentPapers.length !== params.result.presentPapers.length ||
    confirmation.missingPapers.length !== params.result.missingPapers.length;
  if (!changed) {
    return params.result;
  }

  const status: GraphPresenceStatus =
    params.result.expectedPaperCount === 0
      ? params.result.status
      : confirmation.missingPapers.length > 0
        ? "missing_papers"
        : "ready";
  const refreshRequired = status === "missing_corpus" || status === "missing_papers";
  const refreshReason =
    status === "ready"
      ? null
      : buildBlockingReason(
          status,
          confirmation.missingPapers,
          params.result.expectedPaperCount,
          params.result.corpusRoot
        );
  return {
    ...params.result,
    status,
    verificationMode: confirmation.verificationMode ?? params.result.verificationMode,
    blockingReason: refreshReason,
    presentPaperCount: confirmation.presentPapers.length,
    missingPaperCount: confirmation.missingPapers.length,
    refreshRequired,
    refreshReason,
    repairRequired:
      refreshRequired && params.result.repairRequired ? params.result.repairRequired : false,
    repairReason:
      refreshRequired && params.result.repairRequired ? params.result.repairReason : null,
    repairTargetCorpus:
      refreshRequired && params.result.repairRequired
        ? params.result.repairTargetCorpus
        : null,
    presentPapers: confirmation.presentPapers,
    missingPapers: confirmation.missingPapers,
  };
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
  projectId: string | null;
  projectRoot: string;
  sharedCorpus: string | null;
}): string | null {
  return resolvePreferredPapernexusCorpusName({
    manifest: params.manifest,
    statusRecord: params.corpusName ? { corpus_name: params.corpusName } : null,
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    sharedCorpus: params.sharedCorpus,
  });
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
  const titleSignature = buildTitleSignature(
    pickString(record, [
      "title_signature",
      "titleSignature",
      "normalized_title",
      "normalizedTitle",
      "title",
      "paper_title",
      "paperTitle",
    ])
  );
  if (titleSignature) {
    const direct = expectedPapers.find((paper) => paper.titleSignature === titleSignature);
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
  expectedPaperCountHint?: number | null;
  remoteEndpoint: string | null;
  preferredCorpusName: string | null;
  preferredCorpusRoot: string | null;
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
  const summaryReportedPaperCount =
    pickCount(meta, ["paperCount", "paper_count", "activePaperCount", "active_paper_count"]) ??
    pickCount(manifest, [
      "paperCount",
      "paper_count",
      "activePaperCount",
      "active_paper_count",
      "activeSourceCount",
      "active_source_count",
      "sourceCount",
      "source_count",
    ]) ??
    sources.filter((entry) => entry.activeInGraph !== false).length;
  const configuredExpectedPaperCount =
    params.expectedPapers.length > 0
      ? params.expectedPapers.length
      : Math.max(0, params.expectedPaperCountHint ?? 0);
  const expectedPaperCount =
    configuredExpectedPaperCount > 0
      ? configuredExpectedPaperCount
      : Math.max(0, summaryReportedPaperCount);

  for (const paper of params.expectedPapers) {
    const match = matchExpectedPaper(paper, corpusEntries);
    if (match) {
      presentPapers.push(match);
    } else {
      missingPapers.push(toMissingPaper(paper));
    }
  }

  const summaryOnly = params.expectedPapers.length === 0 && expectedPaperCount > 0;
  const presentPaperCount = summaryOnly
    ? Math.min(summaryReportedPaperCount, expectedPaperCount)
    : presentPapers.length;
  const missingPaperCount = summaryOnly
    ? Math.max(0, expectedPaperCount - presentPaperCount)
    : missingPapers.length;
  const status: GraphPresenceStatus =
    expectedPaperCount === 0
      ? "missing_sources"
      : missingPaperCount > 0
        ? "missing_papers"
        : "ready";

  return {
    checked_at: params.checkedAt,
    status,
    mode: params.mode,
    verification_mode:
      params.expectedPapers.length === 0 && expectedPaperCount > 0
        ? "remote_corpus_summary"
        : "canonical_paper_index",
    corpus_name:
      params.preferredCorpusName ??
      pickString(manifest, ["corpusName", "corpus_name"]) ??
      pickString(meta, ["name", "corpusName", "corpus_name"]) ??
      null,
    corpus_root:
      sanitizeCorpusRootValue(pickString(params.payload, ["rootPath", "root_path"])) ??
      sanitizeCorpusRootValue(pickString(manifest, ["rootPath", "root_path"])) ??
      sanitizeCorpusRootValue(pickString(meta, ["rootPath", "root_path"])) ??
      params.preferredCorpusRoot,
    expected_paper_count: expectedPaperCount,
    present_paper_count: presentPaperCount,
    missing_paper_count: missingPaperCount,
    missing_papers: serializeMissingPapers(missingPapers),
    present_papers: serializePresentPapers(presentPapers),
    refresh_required: status !== "ready",
    refresh_reason:
      status === "ready"
        ? null
        : buildBlockingReason(
            "missing_papers",
            missingPapers,
            expectedPaperCount,
            sanitizeCorpusRootValue(
              pickString(params.payload, ["rootPath", "root_path"])
            ) ??
              params.preferredCorpusRoot ??
              params.remoteEndpoint
          ),
  };
}

async function refreshRemoteStatusRecord(params: {
  projectRoot: string;
  manifest: ManifestLike;
  checkedAt: string;
  expectedPapers: ExpectedPaper[];
  expectedPaperCountHint?: number | null;
  remoteAccess: PapernexusRemoteAccessConfig;
  remoteInspection: Awaited<ReturnType<typeof inspectPapernexusRemoteAccess>>;
  cachedStatusRecord: Record<string, unknown> | null;
  sharedCorpus: string | null;
}): Promise<{
  statusRecord: Record<string, unknown> | null;
  refreshError: string | null;
}> {
  const statusPath = path.join(params.projectRoot, "graph", "PAPERNEXUS_STATUS.json");
  const preferredCorpusName = resolvePreferredPapernexusCorpusName({
    manifest: params.manifest,
    statusRecord: params.cachedStatusRecord,
    projectId: pickString(params.manifest, ["project_id", "projectId"]),
    projectRoot: params.projectRoot,
    sharedCorpus: params.sharedCorpus,
  });
  const preferredCorpusRoot = resolvePreferredPapernexusCorpusRoot({
    manifest: params.manifest,
    statusRecord: params.cachedStatusRecord,
  });
  const targetCorpus = preferredCorpusName;
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
        expectedPaperCountHint: params.expectedPaperCountHint,
        remoteEndpoint,
        preferredCorpusName,
        preferredCorpusRoot,
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
        expectedPaperCountHint: params.expectedPaperCountHint,
        remoteEndpoint,
        preferredCorpusName,
        preferredCorpusRoot,
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
  expected: ResolvedExpectedPapers;
  remoteAccess: PapernexusRemoteAccessConfig;
  sharedCorpus: string | null;
}): Promise<GraphPresenceCheckResult> {
  const remoteInspection = await inspectPapernexusRemoteAccess(params.remoteAccess);
  const statusPath = path.join(params.projectRoot, "graph", "PAPERNEXUS_STATUS.json");
  const cachedStatusRecord = await readJsonIfExists<Record<string, unknown>>(statusPath);
  const preferredCorpusName = resolvePreferredPapernexusCorpusName({
    manifest: params.manifest,
    statusRecord: cachedStatusRecord,
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    sharedCorpus: params.sharedCorpus,
  });
  const preferredCorpusRoot = resolvePreferredPapernexusCorpusRoot({
    manifest: params.manifest,
    statusRecord: cachedStatusRecord,
  });
  const remoteEndpoint =
    remoteInspection.summary.apiBaseUrl ?? remoteInspection.summary.mcpUrl ?? null;
  const paperIngestionProgress = summarizePaperIngestionProgress(params.manifest);
  const paperIngestionRecord = asRecord(params.manifest.paper_ingestion);
  const manifestGraphPresenceStatus =
    pickString(paperIngestionRecord, [
      "graph_presence_status",
      "graphPresenceStatus",
    ])?.trim().toLowerCase() ?? null;
  const manifestPresentHint = maxPositiveCount([
    pickCount(paperIngestionRecord, [
      "graph_presence_present_papers",
      "graphPresencePresentPapers",
      "graph_presence_present",
      "graphPresencePresent",
    ]),
    pickCount(paperIngestionRecord, ["remote_paper_count", "remotePaperCount"]),
    pickCount(paperIngestionRecord, ["synced_papers", "syncedPapers"]),
  ]);
  const refreshedStatus = remoteInspection.tokenAvailable
    ? await refreshRemoteStatusRecord({
        projectRoot: params.projectRoot,
        manifest: params.manifest,
        checkedAt: params.checkedAt,
        expectedPapers: params.expected.papers,
        expectedPaperCountHint: params.expected.expectedPaperCountHint,
        remoteAccess: params.remoteAccess,
        remoteInspection,
        cachedStatusRecord,
        sharedCorpus: params.sharedCorpus,
      })
    : {
        statusRecord: cachedStatusRecord,
        refreshError: null,
      };
  const statusRecord = refreshedStatus.statusRecord;

  let status: GraphPresenceStatus = "ready";
  let refreshReason: string | null = null;
  let expectedPaperCount = resolveExpectedPaperCount(params.expected);
  let presentPaperCount = expectedPaperCount;
  let missingPapers: GraphPresenceMissingPaper[] = [];

  if (expectedPaperCount === 0) {
    const remoteExpectedCount =
      statusRecord
        ? maxPositiveCount([
            pickCount(statusRecord, ["expected_paper_count", "expectedPaperCount"]),
            pickCount(statusRecord, ["present_paper_count", "presentPaperCount"]),
          ])
        : null;
    if (remoteExpectedCount !== null) {
      expectedPaperCount = remoteExpectedCount;
      presentPaperCount = Math.min(
        pickCount(statusRecord, ["present_paper_count", "presentPaperCount"]) ??
          expectedPaperCount,
        expectedPaperCount
      );
      const normalizedStatus =
        pickString(statusRecord, ["status"])?.trim().toLowerCase() ?? null;
      if (normalizedStatus === "missing_corpus") {
        status = "missing_corpus";
        refreshReason =
          pickString(statusRecord, ["refresh_reason", "refreshReason"]) ??
          buildBlockingReason("missing_corpus", [], expectedPaperCount, remoteEndpoint);
      } else if (normalizedStatus === "missing_papers" || presentPaperCount < expectedPaperCount) {
        status = "missing_papers";
        refreshReason =
          pickString(statusRecord, ["refresh_reason", "refreshReason"]) ??
          buildBlockingReason("missing_papers", [], expectedPaperCount, remoteEndpoint);
      } else {
        status = "ready";
        presentPaperCount = expectedPaperCount;
        refreshReason = null;
      }
    } else {
      status = "missing_sources";
    }
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
          expectedPaperCount,
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
      expectedPaperCount;
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
    const remoteZeroCountAnomaly =
      params.expected.papers.length === 0 &&
      presentPaperCount === 0 &&
      expectedPaperCount > 0 &&
      (normalizedStatus === "missing_sources" || normalizedStatus === "missing_papers") &&
      manifestGraphPresenceStatus === "ready" &&
      (manifestPresentHint ?? 0) >= expectedPaperCount;

    if (remoteZeroCountAnomaly) {
      status = "ready";
      presentPaperCount = expectedPaperCount;
      missingPapers = [];
      refreshReason = null;
    } else if (statusExpectedCount !== expectedPaperCount) {
      status = "missing_corpus";
      refreshReason = paperIngestionProgress.inFlight
        ? buildInFlightRemoteRefreshReason({
            remoteEndpoint,
            expectedPaperCount,
            presentPaperCount,
            paperIngestion: paperIngestionProgress,
          })
        : `Remote PaperNexus graph status is stale for ${remoteEndpoint ?? "the configured endpoint"}: ` +
          `expected ${expectedPaperCount} paper(s) from PAPER_SOURCE_INDEX.json but the latest remote status only covers ${statusExpectedCount}. ` +
          "Rerun /graph-build to refresh readiness metadata and brainstorm grounding before frontier mapping or ideation.";
      presentPaperCount = Math.min(presentPaperCount, expectedPaperCount);
    } else if (normalizedStatus === "missing_corpus") {
      status = "missing_corpus";
      refreshReason =
        statusRefreshReason ??
        buildBlockingReason(
          "missing_corpus",
          [],
          expectedPaperCount,
          remoteEndpoint
        );
    } else if (
      normalizedStatus === "missing_papers" ||
      missingPapers.length > 0 ||
      presentPaperCount < expectedPaperCount
    ) {
      status = "missing_papers";
      refreshReason = paperIngestionProgress.inFlight
        ? buildInFlightRemoteRefreshReason({
            remoteEndpoint,
            expectedPaperCount,
            presentPaperCount,
            paperIngestion: paperIngestionProgress,
          })
        : statusRefreshReason ??
          buildBlockingReason(
            "missing_papers",
            missingPapers,
            expectedPaperCount,
            remoteEndpoint
          );
    } else {
      status = "ready";
      presentPaperCount = expectedPaperCount;
      refreshReason = null;
    }
  }

  const repairTargetCorpus = resolveGraphRepairTargetCorpus({
    manifest: params.manifest,
    corpusName: preferredCorpusName,
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    sharedCorpus: params.sharedCorpus,
  });
  const repairRequired = shouldRequireGraphImportRepair({
    status,
    expectedPaperCount,
    presentPaperCount,
    paperIngestion: paperIngestionProgress,
    canRepair: remoteInspection.tokenAvailable,
  });
  const repairReason = repairRequired
    ? buildGraphImportRepairReason({
        corpusName: repairTargetCorpus,
        expectedPaperCount,
        presentPaperCount,
        refreshReason,
      })
    : null;

  const result: GraphPresenceCheckResult = {
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    checkedAt: params.checkedAt,
    status,
    verificationMode:
      params.expected.papers.length === 0 && expectedPaperCount > 0
        ? "remote_corpus_summary"
        : statusRecord &&
            pickString(statusRecord, ["verification_mode", "verificationMode"]) ===
              "paper_source_index_override"
          ? "paper_source_index_override"
          : "canonical_paper_index",
    blockingReason: refreshReason,
    reportPath: params.reportPath,
    paperSourceIndexPath: params.expected.paperSourceIndexPath,
    usedPaperSourceIndex: params.expected.usedPaperSourceIndex,
    expectedPaperCount,
    presentPaperCount,
    missingPaperCount:
      status === "ready"
        ? 0
        : Math.max(
            0,
            missingPapers.length > 0
              ? missingPapers.length
              : expectedPaperCount - presentPaperCount
          ),
    corpusRoot:
      sanitizeCorpusRootValue(
        pickString(statusRecord, ["corpus_root", "corpusRoot"])
      ) ??
      preferredCorpusRoot,
    corpusName:
      preferredCorpusName ??
      pickString(statusRecord, ["corpus_name", "corpusName"]),
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

  const finalizedResult = applyPaperSourceIndexGraphPresenceOverride({
    result,
    expected: params.expected,
    allowOverride: !paperIngestionProgress.inFlight,
  });

  await writeJsonEnsured(params.reportPath, {
    checked_at: params.checkedAt,
    project_id: params.projectId,
    status: finalizedResult.status,
    verification_mode: finalizedResult.verificationMode,
    blocking_reason: finalizedResult.blockingReason,
    corpus_root: finalizedResult.corpusRoot,
    corpus_name: finalizedResult.corpusName,
    paper_source_index_path: finalizedResult.paperSourceIndexPath,
    used_paper_source_index: finalizedResult.usedPaperSourceIndex,
    expected_paper_count: finalizedResult.expectedPaperCount,
    present_paper_count: finalizedResult.presentPaperCount,
    missing_paper_count: finalizedResult.missingPaperCount,
    refresh_required: finalizedResult.refreshRequired,
    refresh_reason: finalizedResult.refreshReason,
    repair_required: finalizedResult.repairRequired,
    repair_reason: finalizedResult.repairReason,
    repair_target_corpus: finalizedResult.repairTargetCorpus,
    missing_papers: serializeMissingPapers(finalizedResult.missingPapers),
    present_papers: serializePresentPapers(finalizedResult.presentPapers),
  });
  await persistGraphPresenceArtifacts({
    projectRoot: params.projectRoot,
    result: finalizedResult,
    mode:
      pickString(statusRecord, ["mode"]) ??
      (remoteInspection.summary.mcpUrl ? "remote_mcp" : "remote_api"),
    existingStatusRecord: statusRecord,
  });

  return finalizedResult;
}

export async function checkGraphPresenceForWorkflow(params: {
  projectRoot: string;
  updateManifest?: boolean;
  sharedCorpus?: string | null;
  remoteAccess?: PapernexusRemoteAccessConfig | null;
}): Promise<GraphPresenceCheckResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifest = await readManifest(projectRoot);
  const projectId = inferProjectId(projectRoot, manifest);
  const sharedCorpus = asString(params.sharedCorpus);
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
      sharedCorpus,
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
    sharedCorpus,
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
    projectId,
    projectRoot,
    sharedCorpus,
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
    verificationMode: "canonical_paper_index",
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

  const finalizedResult = applyPaperSourceIndexGraphPresenceOverride({
    result,
    expected,
    allowOverride: !paperIngestionProgress.inFlight,
  });

  await writeJsonEnsured(reportPath, {
    checked_at: checkedAt,
    project_id: projectId,
    status: finalizedResult.status,
    verification_mode: finalizedResult.verificationMode,
    blocking_reason: finalizedResult.blockingReason,
    corpus_root: finalizedResult.corpusRoot,
    corpus_name: finalizedResult.corpusName,
    paper_source_index_path: finalizedResult.paperSourceIndexPath,
    used_paper_source_index: finalizedResult.usedPaperSourceIndex,
    expected_paper_count: finalizedResult.expectedPaperCount,
    present_paper_count: finalizedResult.presentPaperCount,
    missing_paper_count: finalizedResult.missingPaperCount,
    refresh_required: finalizedResult.refreshRequired,
    refresh_reason: finalizedResult.refreshReason,
    repair_required: finalizedResult.repairRequired,
    repair_reason: finalizedResult.repairReason,
    repair_target_corpus: finalizedResult.repairTargetCorpus,
    missing_papers: serializeMissingPapers(finalizedResult.missingPapers),
    present_papers: serializePresentPapers(finalizedResult.presentPapers),
  });
  await persistGraphPresenceArtifacts({
    projectRoot,
    result: finalizedResult,
    mode: "local_corpus",
    existingStatusRecord: {
      manifest: {
        version:
          typeof sourceManifest?.version === "number" && Number.isFinite(sourceManifest.version)
            ? sourceManifest.version
            : null,
        corpus_name:
          pickString(sourceManifest ?? {}, ["corpusName", "corpus_name"]) ??
          finalizedResult.corpusName,
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
      graph_presence_status: finalizedResult.status,
      graph_presence_report_path: path.relative(projectRoot, reportPath),
      graph_presence_expected_papers: finalizedResult.expectedPaperCount,
      graph_presence_present_papers: finalizedResult.presentPaperCount,
      graph_presence_missing_papers: serializeMissingPapers(finalizedResult.missingPapers),
      refresh_required: finalizedResult.refreshRequired ? true : false,
      refresh_reason: finalizedResult.refreshRequired ? finalizedResult.refreshReason : null,
      repair_required: finalizedResult.repairRequired ? true : false,
      repair_reason: finalizedResult.repairRequired ? finalizedResult.repairReason : null,
      repair_target_corpus: finalizedResult.repairRequired ? finalizedResult.repairTargetCorpus : null,
    };
    await saveManifest(projectRoot, manifest);
    await writePapernexusProgressFromManifest({
      projectRoot,
      manifest,
      updatedAt: checkedAt,
    });
    finalizedResult.manifestUpdated = true;
  }

  return finalizedResult;
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
