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
  PAPER_SOURCE_PATH_KEYS,
  resolvePaperSourcePathCandidates,
  sourceKindRank as sourceKindRankShared,
  sourceProviderRank as sourceProviderRankShared,
} from "./paper-source-contract";
import { writePapernexusProgressFromManifest } from "./papernexus-progress";
import {
  certifyPapernexusTaskForProject,
  type PapernexusTaskCertification,
} from "./papernexus-task-certification";
import {
  writePapernexusGraphBuildReceipt,
  type PapernexusGraphBuildReceipt,
} from "./papernexus-graph-build-receipt";
import {
  buildPapernexusSyncStateFromGraphPresence,
  writePapernexusSyncState,
} from "./papernexus-sync-state";
import {
  DEFAULT_SHARED_PAPERNEXUS_CORPUS,
  resolvePapernexusSharedCorpusFallback,
  resolveWorkflowSharedPapernexusCorpus,
  shouldAutodiscoverRemotePapernexusCorpus,
} from "./papernexus-shared-corpus";
import {
  evaluateGraphBuildStatusContract,
  type GraphBuildWorkflowStatus,
} from "./graph-build-status-contract";

export type GraphPresenceStatus =
  | "ready"
  | "missing_papers"
  | "missing_corpus"
  | "missing_sources";

export type GraphPresenceVerificationMode =
  | "canonical_paper_index"
  | "remote_corpus_summary"
  | "paper_source_index_override";

export type GraphPresenceReadyProofLevel =
  | "source_span"
  | "paper_index"
  | "remote_summary"
  | "none";

type ManifestLike = Record<string, unknown>;

type ExpectedPaper = {
  canonicalId: string;
  title: string | null;
  normalizedTitle: string | null;
  titleSignature: string | null;
  arxivId: string | null;
  doi: string | null;
  sourceHints: string[];
  plannedStagingPath: string | null;
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
  graphIndexEvidence: Record<string, unknown> | null;
  sourceSpanEvidence: Record<string, unknown> | null;
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
  graphIndexEvidence: Record<string, unknown> | null;
  sourceSpanEvidence: Record<string, unknown> | null;
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
  readyProofLevel: GraphPresenceReadyProofLevel;
  sourceBackedPresentCount: number;
  paperIndexPresentCount: number;
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
  graphBuildWorkflowStatus: GraphBuildWorkflowStatus;
  graphBuildCanContinue: boolean;
  graphBuildRequiresImport: boolean;
  graphBuildRequiresSourceRepair: boolean;
  graphBuildStatusReason: string | null;
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

function attachGraphBuildStatusContract(params: {
  result: GraphPresenceCheckResult;
  ingestionInFlight: boolean;
}): GraphPresenceCheckResult {
  const contract = evaluateGraphBuildStatusContract({
    graphPresenceStatus: params.result.status,
    expectedPaperCount: params.result.expectedPaperCount,
    presentPaperCount: params.result.presentPaperCount,
    missingPaperCount: params.result.missingPaperCount,
    repairRequired: params.result.repairRequired,
    refreshRequired: params.result.refreshRequired,
    ingestionInFlight: params.ingestionInFlight,
    blockingReason: params.result.blockingReason,
  });
  return {
    ...params.result,
    graphBuildWorkflowStatus: contract.workflowStatus,
    graphBuildCanContinue: contract.canContinue,
    graphBuildRequiresImport: contract.requiresImport,
    graphBuildRequiresSourceRepair: contract.requiresSourceRepair,
    graphBuildStatusReason: contract.reason,
  };
}

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
  path.join("researcher", "paper_source", "PAPER_SOURCE_INDEX.json"),
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
  const raw = value.trim();
  if (!raw) {
    return null;
  }
  const containsDoi = new RegExp(DOI_REGEX.source, "i").test(raw);
  const containsArxivContext = /\barxiv\b|arxiv\.org/i.test(raw);
  if (containsDoi && !containsArxivContext) {
    return null;
  }
  for (const match of raw.matchAll(ARXIV_ID_REGEX)) {
    const candidate = normalizeArxivCandidate(match[0]);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function normalizeArxivCandidate(value: string): string | null {
  const normalized = value.toLowerCase().replace(/v\d+$/, "");
  const modern = normalized.match(/^(\d{4})\.\d{4,5}$/);
  if (modern) {
    const month = Number(modern[1].slice(2));
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return null;
    }
  }
  return normalized;
}

function extractArxivIds(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  const raw = value.trim();
  const containsDoi = new RegExp(DOI_REGEX.source, "i").test(raw);
  const containsArxivContext = /\barxiv\b|arxiv\.org/i.test(raw);
  if (containsDoi && !containsArxivContext) {
    return [];
  }
  return Array.from(
    new Set(
      Array.from(raw.matchAll(ARXIV_ID_REGEX))
        .map((match) => normalizeArxivCandidate(match[0]))
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

const METADATA_ONLY_SOURCE_PROVIDERS = new Set([
  "crossref",
  "openalex",
  "semantic-scholar",
  "semanticscholar",
  "pubmed",
  "pubmedcentral",
  "pasa",
  "pasa-paper-search",
]);

const IMPORTABLE_SOURCE_PROVIDERS = new Set([
  "arxiv2md",
  "arxiv2md-api",
  "markxiv",
  "papers-cool",
  "pdf",
  "unpaywall",
  "core",
  "hf",
  "huggingface",
  "hugging-face-paper-pages",
]);

function isImportableSourceHint(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return Boolean(
    normalized &&
      (
        /\.(?:md|pdf)(?:$|[?#])/i.test(normalized) ||
        /(?:^|\/)arxiv\.org\/pdf\//i.test(normalized) ||
        /papers\.cool/i.test(normalized) ||
        /huggingface\.co\/papers/i.test(normalized)
      )
  );
}

function hasImportableSourceSignal(paper: ExpectedPaper): boolean {
  if (isExpectedPaperExplicitlyConfirmed(paper)) {
    return true;
  }
  if (paper.sourceHints.some((hint) => isImportableSourceHint(hint))) {
    return true;
  }
  const provider = normalizeProvider(paper.sourceProvider);
  if (provider && IMPORTABLE_SOURCE_PROVIDERS.has(provider)) {
    return true;
  }
  if (
    provider &&
    !METADATA_ONLY_SOURCE_PROVIDERS.has(provider) &&
    paper.sourceHints.length > 0
  ) {
    return true;
  }
  return paper.sourceKind !== "unknown";
}

function expectedPaperSourceEvidenceScore(paper: ExpectedPaper): number {
  let score = 0;
  if (paper.sourceKind === "markdown" || paper.sourceKind === "pdf") {
    score += 3;
  }
  if (paper.sourceHints.some((hint) => isImportableSourceHint(hint))) {
    score += 2;
  }
  if (isExpectedPaperExplicitlyConfirmed(paper)) {
    score += 1;
  }
  return score;
}

function expectedPapersAreMetadataOnly(papers: ExpectedPaper[]): boolean {
  return papers.length > 0 && papers.every((paper) => !hasImportableSourceSignal(paper));
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

function uniqueGraphPresenceStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort();
}

function hasGraphPresenceEvidenceRecord(value: Record<string, unknown> | null): boolean {
  return Boolean(value && Object.keys(value).length > 0);
}

function countGraphPresencePaperIndexEvidence(papers: GraphPresenceMatch[]): number {
  return papers.filter(
    (paper) =>
      hasGraphPresenceEvidenceRecord(paper.graphIndexEvidence) ||
      paper.matchedBy === "paper_source_index"
  ).length;
}

function countGraphPresenceSourceSpanEvidence(papers: GraphPresenceMatch[]): number {
  return papers.filter((paper) => hasGraphPresenceEvidenceRecord(paper.sourceSpanEvidence)).length;
}

function deriveGraphPresenceReadyProofLevel(params: {
  status: GraphPresenceStatus;
  verificationMode: GraphPresenceVerificationMode;
  expectedPaperCount: number;
  presentPapers: GraphPresenceMatch[];
  paperIndexPresentCount: number;
  sourceBackedPresentCount: number;
}): GraphPresenceReadyProofLevel {
  if (params.status !== "ready" || params.expectedPaperCount <= 0) {
    return "none";
  }
  if (params.sourceBackedPresentCount >= params.expectedPaperCount) {
    return "source_span";
  }
  if (params.paperIndexPresentCount >= params.expectedPaperCount) {
    return "paper_index";
  }
  if (
    params.verificationMode === "remote_corpus_summary" ||
    params.presentPapers.length === 0
  ) {
    return "remote_summary";
  }
  return "none";
}

function normalizeGraphPresenceReadyProofLevel(
  value: unknown
): GraphPresenceReadyProofLevel | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : null;
  return normalized === "source_span" ||
    normalized === "paper_index" ||
    normalized === "remote_summary" ||
    normalized === "none"
    ? normalized
    : null;
}

async function writeGraphPresenceBuildReceipt(params: {
  projectRoot: string;
  result: GraphPresenceCheckResult;
  certification: PapernexusTaskCertification;
  corpus: string | null;
}): Promise<{
  path: string;
  receipt: PapernexusGraphBuildReceipt;
}> {
  const canonicalIdsInGraph = uniqueGraphPresenceStrings(
    params.result.presentPapers.map((paper) => paper.canonicalId)
  );
  const canonicalIdsMissing = uniqueGraphPresenceStrings(
    params.result.missingPapers.map((paper) => paper.canonicalId)
  );
  const canonicalIdsRequested = uniqueGraphPresenceStrings([
    ...canonicalIdsInGraph,
    ...canonicalIdsMissing,
  ]);
  const sourceBackedGraphClaim = params.certification.source_backed_graph_claim === true;
  const receipt: PapernexusGraphBuildReceipt = {
    schema_version: 1,
    request_id: null,
    run_id: null,
    corpus: params.result.corpusName ?? params.corpus,
    status:
      params.result.status === "ready" && sourceBackedGraphClaim
        ? "graph_ready"
        : params.result.status === "ready"
          ? "waiting_graph_commit"
          : params.result.status === "missing_sources"
            ? "source_blocked"
            : "waiting_graph_commit",
    graph_visibility:
      params.result.status === "ready" ? "verified" : "unverified",
    graph_fingerprint: [
      params.result.corpusName ?? params.corpus ?? "corpus",
      params.result.checkedAt,
      canonicalIdsInGraph.join(","),
    ].join(":"),
    checked_at: params.result.checkedAt,
    canonical_ids_requested: canonicalIdsRequested,
    canonical_ids_in_graph: canonicalIdsInGraph,
    canonical_ids_missing: canonicalIdsMissing,
    source_backed_count:
      params.certification.graph.source_backed_present_count,
    metadata_only_count:
      params.certification.source_index.metadata_only_paper_count,
    source_backed_graph_claim: sourceBackedGraphClaim,
    active_in_graph_sources: uniqueGraphPresenceStrings(
      params.result.presentPapers.map((paper) => paper.corpusSourceKey)
    ),
    task_summary: {
      total: params.certification.upload.import_tasks.task_count,
      pending: Math.max(
        0,
        params.certification.upload.import_tasks.task_count -
          params.certification.upload.import_tasks.completed_task_count -
          params.certification.upload.import_tasks.failed_task_count
      ),
      running: 0,
      completed: params.certification.upload.import_tasks.completed_task_count,
      failed: params.certification.upload.import_tasks.failed_task_count,
      remaining: Math.max(
        0,
        params.certification.upload.queue_remaining ?? 0
      ),
    },
    coverage: {
      min_required_satisfied:
        params.result.status === "ready" &&
        sourceBackedGraphClaim &&
        params.certification.upload.import_tasks.failed_task_count === 0,
      min_source_backed_papers: Math.max(1, params.result.expectedPaperCount),
      notes: params.certification.limitations,
    },
    evidence_packet_path: null,
    limitations: params.certification.limitations,
    repair_hints:
      params.result.status === "ready" && sourceBackedGraphClaim
        ? []
        : [
            "Use PaperNexus discovery/import/graph sync until the receipt is source-backed and graph-visible.",
          ],
  };
  const receiptPath = await writePapernexusGraphBuildReceipt({
    projectRoot: params.projectRoot,
    receipt,
  });
  return { path: receiptPath, receipt };
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
    ready_proof_level: params.result.readyProofLevel,
    source_backed_present_count: params.result.sourceBackedPresentCount,
    paper_index_present_count: params.result.paperIndexPresentCount,
    refresh_required: params.result.refreshRequired,
    refresh_reason: params.result.refreshReason,
    repair_required: params.result.repairRequired,
    repair_reason: params.result.repairReason,
    repair_target_corpus: params.result.repairTargetCorpus,
    graph_build_workflow_status: params.result.graphBuildWorkflowStatus,
    graph_build_can_continue: params.result.graphBuildCanContinue,
    graph_build_requires_import: params.result.graphBuildRequiresImport,
    graph_build_requires_source_repair: params.result.graphBuildRequiresSourceRepair,
    graph_build_status_reason: params.result.graphBuildStatusReason,
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
    `Ready Proof Level: ${result.readyProofLevel}`,
    `Corpus: ${result.corpusName ?? "unset"}`,
    `Corpus Root: ${result.corpusRoot ?? "unset"}`,
    `Expected Papers: ${result.expectedPaperCount}`,
    `Present Papers: ${result.presentPaperCount}`,
    `Missing Papers: ${result.missingPaperCount}`,
    `Source-backed Present Papers: ${result.sourceBackedPresentCount}`,
    `Paper-index Present Papers: ${result.paperIndexPresentCount}`,
    `Graph Build Workflow Status: ${result.graphBuildWorkflowStatus}`,
    `Graph Build Can Continue: ${result.graphBuildCanContinue ? "yes" : "no"}`,
    `Refresh Required: ${result.refreshRequired ? "yes" : "no"}`,
    `Repair Required: ${result.repairRequired ? "yes" : "no"}`,
  ];
  if (result.graphBuildStatusReason) {
    lines.push(`Graph Build Status Reason: ${result.graphBuildStatusReason}`);
  }
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
    ...PAPER_SOURCE_PATH_KEYS.map((key) => pickString(record, [key])),
    pickString(record, ["url", "best_oa_url", "bestOaUrl", "pdf_url", "pdfUrl"]),
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
    graphIndexEvidence: null,
    sourceSpanEvidence: null,
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
    plannedStagingPath: pickString(raw, [
      "staging_path",
      "stagingPath",
      "staged_path",
      "stagedPath",
      "source_staging_path",
      "sourceStagingPath",
      "markdown_path",
      "markdownPath",
      "source_markdown_path",
      "sourceMarkdownPath",
      "md_path",
      "mdPath",
      "source_md_path",
      "sourceMdPath",
      "local_md_path",
      "localMdPath",
      "local_md",
      "localMd",
      "pdf_path",
      "pdfPath",
      "source_pdf_path",
      "sourcePdfPath",
      "local_pdf_path",
      "localPdfPath",
      "local_pdf",
      "localPdf",
    ]),
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
    plannedStagingPath: target.plannedStagingPath ?? incoming.plannedStagingPath,
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

function isRemoteSourceHint(value: string): boolean {
  return /^[a-z]+:\/\//i.test(value.trim());
}

function isLocalPaperSourceHint(value: string): boolean {
  return !isRemoteSourceHint(value) && /\.(?:md|pdf)(?:$|[?#])/i.test(value.trim());
}

function resolveLocalPaperSourceHintCandidates(params: {
  projectRoot: string;
  value: string;
  sourceIndexPath?: string | null;
}): string[] {
  const candidates = resolvePaperSourcePathCandidates({
    projectRoot: params.projectRoot,
    sourcePath: params.value,
    sourceIndexPath: params.sourceIndexPath,
  });
  if (candidates.length > 0) {
    return candidates;
  }
  return [
    path.normalize(
      path.join(params.projectRoot, params.value.trim().replace(/[?#].*$/, ""))
    ),
  ];
}

async function normalizeExpectedPaperAvailableSources(params: {
  projectRoot: string;
  paper: ExpectedPaper;
  sourceIndexPath?: string | null;
}): Promise<ExpectedPaper> {
  const plannedPath = params.paper.plannedStagingPath;
  if (!plannedPath || !isLocalPaperSourceHint(plannedPath)) {
    return params.paper;
  }
  const resolvedCandidates = resolveLocalPaperSourceHintCandidates({
    projectRoot: params.projectRoot,
    value: plannedPath,
    sourceIndexPath: params.sourceIndexPath,
  });
  for (const resolved of resolvedCandidates) {
    if (await pathExists(resolved)) {
      return params.paper;
    }
  }
  const sourceHints = uniqueStrings(
    params.paper.sourceHints.filter((hint) => hint !== plannedPath)
  );
  const inferredKind = inferSourceKind(sourceHints);
  return {
    ...params.paper,
    sourceHints,
    sourceKind: inferredKind !== "unknown" ? inferredKind : "unknown",
  };
}

async function normalizeExpectedPapersAvailableSources(params: {
  projectRoot: string;
  papers: ExpectedPaper[];
  sourceIndexPath?: string | null;
}): Promise<ExpectedPaper[]> {
  return Promise.all(
    params.papers.map((paper) =>
      normalizeExpectedPaperAvailableSources({
        projectRoot: params.projectRoot,
        paper,
        sourceIndexPath: params.sourceIndexPath,
      })
    )
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
  const indexedCandidates: Array<{
    papers: ExpectedPaper[];
    importablePapers: ExpectedPaper[];
    paperSourceIndexPath: string;
    paperSourceIndex: unknown;
  }> = [];
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
    const indexedPapers = await normalizeExpectedPapersAvailableSources({
      projectRoot: params.projectRoot,
      papers: parsePaperSourceIndex(paperSourceIndex),
      sourceIndexPath: paperSourceIndexPath,
    });
    if (indexedPapers.length > 0) {
      const importablePapers = indexedPapers.filter((paper) =>
        hasImportableSourceSignal(paper)
      );
      indexedCandidates.push({
        papers: indexedPapers,
        importablePapers,
        paperSourceIndexPath,
        paperSourceIndex,
      });
    }
  }
  const selectedCandidate =
    indexedCandidates
      .map((candidate) => ({
        candidate,
        score: candidate.papers.reduce(
          (total, paper) => total + expectedPaperSourceEvidenceScore(paper),
          0
        ),
      }))
      .sort((left, right) => right.score - left.score)
      .find((entry) => entry.score > 0)?.candidate ??
    indexedCandidates.find((candidate) => candidate.importablePapers.length > 0) ??
    indexedCandidates[0] ??
    null;
  if (selectedCandidate) {
    const selectedPapers =
      selectedCandidate.importablePapers.length > 0
        ? selectedCandidate.importablePapers
        : selectedCandidate.papers;
    return {
      papers: selectedPapers,
      paperSourceIndexPath: selectedCandidate.paperSourceIndexPath,
      usedPaperSourceIndex: true,
      expectedPaperCountHint: selectedPapers.length,
      summaryOnly: false,
      graphPresenceOverride: resolvePaperSourceIndexGraphPresenceOverride(
        selectedCandidate.paperSourceIndex
      ),
      sourceIndexUpdatedAt:
        pickString(asRecord(selectedCandidate.paperSourceIndex), [
          "updated_at",
          "updatedAt",
        ]) ??
        pickString(asRecord(selectedCandidate.paperSourceIndex), [
          "created_at",
          "createdAt",
        ]),
    };
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
  remoteMcpUrl?: string | null;
  remoteApiBaseUrl?: string | null;
}): string | null {
  const paperIngestion = asRecord(params.manifest.paper_ingestion);
  const shouldAutodiscover = shouldAutodiscoverRemotePapernexusCorpus({
    configuredSharedCorpus: params.sharedCorpus,
    mcpUrl: params.remoteMcpUrl,
    apiBaseUrl: params.remoteApiBaseUrl,
  });
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
      shouldAutodiscover
        ? null
        : pickString(params.statusRecord ?? null, ["corpus_name", "corpusName"]),
    ],
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    fallback: shouldAutodiscover
      ? null
      : resolvePapernexusSharedCorpusFallback({
          configuredSharedCorpus: params.sharedCorpus,
          mcpUrl: params.remoteMcpUrl,
          apiBaseUrl: params.remoteApiBaseUrl,
          fallback: DEFAULT_SHARED_PAPERNEXUS_CORPUS,
        }),
    ignoreLegacyDefault: shouldAutodiscover,
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

function pickEvidenceRecord(
  source: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> | null {
  for (const key of keys) {
    const record = asRecord(source[key]);
    if (record) {
      return record;
    }
  }
  return null;
}

function pickEvidenceArrayRecord(
  source: Record<string, unknown>,
  keys: string[],
  targetKey: string
): Record<string, unknown> | null {
  for (const key of keys) {
    const values = Array.isArray(source[key]) ? source[key] : [];
    if (values.length > 0) {
      return { [targetKey]: values, count: values.length };
    }
  }
  return null;
}

function buildImplicitGraphIndexEvidence(
  source: Record<string, unknown>
): Record<string, unknown> | null {
  const activeInGraph =
    typeof source.activeInGraph === "boolean"
      ? source.activeInGraph
      : typeof source.active_in_graph === "boolean"
        ? source.active_in_graph
        : true;
  if (!activeInGraph) {
    return null;
  }
  const paperId = pickString(source, ["paperId", "paper_id"]);
  const sourceKey = pickString(source, ["sourceKey", "source_key"]);
  const inputPath = pickString(source, ["inputPath", "input_path"]);
  if (!paperId && !sourceKey && !inputPath) {
    return null;
  }
  return {
    paper_id: paperId,
    source_key: sourceKey ?? inputPath,
    active_in_graph: true,
    evidence_source: "remote_corpus_source",
  };
}

function buildCorpusPaper(entry: Record<string, unknown>): CorpusPaper {
  const identifiers = asRecord(entry.identifiers);
  const sourceHints = uniqueStrings([
    pickString(entry, ["sourceKey", "source_key"]),
    pickString(entry, ["inputPath", "input_path"]),
    pickString(entry, ["sourcePath", "source_path"]),
    pickString(entry, ["sourceMarkdownPath", "source_markdown_path"]),
    pickString(entry, ["sourcePdfPath", "source_pdf_path"]),
    pickString(entry, ["canonicalSourceKey", "canonical_source_key"]),
    pickString(entry, ["duplicateOfSourceKey", "duplicate_of_source_key"]),
  ].filter((item): item is string => Boolean(item)));
  const arxivIdHints = uniqueStrings([
    pickString(entry, ["arxivId", "arxiv_id", "arxiv"]),
    pickString(identifiers, ["arxivId", "arxiv_id", "arxiv"]),
  ].filter((item): item is string => Boolean(item)));
  const doiHints = uniqueStrings([
    pickString(entry, ["doi"]),
    pickString(identifiers, ["doi"]),
  ].filter((item): item is string => Boolean(item)));
  const paperTitle = pickString(entry, ["paperTitle", "paper_title", "title"]);
  const titleHints = uniqueStrings([
    paperTitle,
    ...sourceHints.map((hint) => path.basename(hint, path.extname(hint))),
  ].filter((item): item is string => Boolean(item)));
  const arxivIds = uniqueStrings([
    ...sourceHints.flatMap((hint) => extractArxivIds(hint)),
    ...arxivIdHints
      .map((hint) => normalizeArxivId(hint))
      .filter((item): item is string => Boolean(item)),
  ]);
  const dois = uniqueStrings([
    ...sourceHints.flatMap((hint) => extractDois(hint)),
    ...doiHints
      .map((hint) => normalizeDoi(hint))
      .filter((item): item is string => Boolean(item)),
  ]);
  return {
    paperId: pickString(entry, ["paperId", "paper_id"]),
    paperTitle,
    sourceKey: pickString(entry, ["sourceKey", "source_key"]),
    graphIndexEvidence:
      pickEvidenceRecord(entry, [
        "graphIndexEvidence",
        "graph_index_evidence",
        "graphIndex",
        "graph_index",
      ]) ?? buildImplicitGraphIndexEvidence(entry),
    sourceSpanEvidence:
      pickEvidenceRecord(entry, [
        "sourceSpanEvidence",
        "source_span_evidence",
      ]) ??
      pickEvidenceArrayRecord(entry, ["sourceSpans", "source_spans"], "spans"),
    activeInGraph:
      typeof entry.activeInGraph === "boolean"
        ? entry.activeInGraph
        : typeof entry.active_in_graph === "boolean"
          ? Boolean(entry.active_in_graph)
          : true,
    arxivIds: new Set(arxivIds),
    dois: new Set(dois),
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

function buildGraphPresenceMatch(
  expected: ExpectedPaper,
  match: CorpusPaper,
  matchedBy: GraphPresenceMatch["matchedBy"]
): GraphPresenceMatch {
  return {
    canonicalId: expected.canonicalId,
    title: expected.title,
    sourceKind: expected.sourceKind,
    sourceProvider: expected.sourceProvider,
    retrievalProviders: expected.retrievalProviders,
    matchedBy,
    corpusPaperId: match.paperId,
    corpusPaperTitle: match.paperTitle,
    corpusSourceKey: match.sourceKey,
    graphIndexEvidence: match.graphIndexEvidence,
    sourceSpanEvidence: match.sourceSpanEvidence,
  };
}

function buildRemoteCorpusSummaryMatch(params: {
  entry: Record<string, unknown>;
  paper: CorpusPaper;
  index: number;
}): GraphPresenceMatch {
  const sourceHints = [...params.paper.sourceHints];
  const sourceKind = inferSourceKind(sourceHints);
  const arxivId = [...params.paper.arxivIds][0] ?? null;
  const doi = [...params.paper.dois][0] ?? null;
  const canonicalId =
    pickString(params.entry, ["canonicalId", "canonical_id"]) ??
    (arxivId ? `arxiv:${arxivId}` : null) ??
    (doi ? `doi:${doi}` : null) ??
    params.paper.paperId ??
    params.paper.sourceKey ??
    `remote-corpus-paper-${params.index + 1}`;
  return {
    canonicalId,
    title: params.paper.paperTitle,
    sourceKind,
    sourceProvider:
      pickString(params.entry, ["sourceProvider", "source_provider"]) ??
      inferSourceProvider(params.entry, sourceKind, sourceHints),
    retrievalProviders: collectRetrievalProviders(params.entry),
    matchedBy: "source_path",
    corpusPaperId: params.paper.paperId,
    corpusPaperTitle: params.paper.paperTitle,
    corpusSourceKey: params.paper.sourceKey,
    graphIndexEvidence: params.paper.graphIndexEvidence,
    sourceSpanEvidence: params.paper.sourceSpanEvidence,
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
      return buildGraphPresenceMatch(expected, match, "arxiv");
    }
  }

  if (expected.doi) {
    const match = activeCorpus.find((entry) => entry.dois.has(expected.doi as string));
    if (match) {
      return buildGraphPresenceMatch(expected, match, "doi");
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
    return buildGraphPresenceMatch(expected, sourcePathMatch, "source_path");
  }

  if (expected.normalizedTitle) {
    const match = activeCorpus.find((entry) =>
      entry.normalizedTitles.has(expected.normalizedTitle as string)
    );
    if (match) {
      return buildGraphPresenceMatch(expected, match, "title");
    }
  }

  if (expected.titleSignature) {
    const match = activeCorpus.find((entry) =>
      entry.titleSignatures.has(expected.titleSignature as string)
    );
    if (match) {
      return buildGraphPresenceMatch(expected, match, "title");
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
      return buildGraphPresenceMatch(expected, match, "title");
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

function buildMetadataOnlyMissingSourcesReason(params: {
  expectedPaperCount: number;
  paperSourceIndexPath: string | null;
}): string {
  return (
    `${params.paperSourceIndexPath ?? "PAPER_SOURCE_INDEX.json"} records ${params.expectedPaperCount} canonical paper(s), ` +
    "but none has a project-local PDF/Markdown source or an importable source reference. " +
    "Materialize paper sources and generate a PaperNexus batch manifest before graph import/repair."
  );
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
  const verificationMode =
    confirmation.verificationMode ?? params.result.verificationMode;
  const paperIndexPresentCount =
    countGraphPresencePaperIndexEvidence(confirmation.presentPapers);
  const sourceBackedPresentCount =
    countGraphPresenceSourceSpanEvidence(confirmation.presentPapers);
  return {
    ...params.result,
    status,
    verificationMode,
    blockingReason: refreshReason,
    presentPaperCount: confirmation.presentPapers.length,
    missingPaperCount: confirmation.missingPapers.length,
    readyProofLevel: deriveGraphPresenceReadyProofLevel({
      status,
      verificationMode,
      expectedPaperCount: params.result.expectedPaperCount,
      presentPapers: confirmation.presentPapers,
      paperIndexPresentCount,
      sourceBackedPresentCount,
    }),
    sourceBackedPresentCount,
    paperIndexPresentCount,
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
  remoteMcpUrl?: string | null;
  remoteApiBaseUrl?: string | null;
}): string | null {
  return resolvePreferredPapernexusCorpusName({
    manifest: params.manifest,
    statusRecord: params.corpusName ? { corpus_name: params.corpusName } : null,
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    sharedCorpus: params.sharedCorpus,
    remoteMcpUrl: params.remoteMcpUrl,
    remoteApiBaseUrl: params.remoteApiBaseUrl,
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
    graph_index_evidence: paper.graphIndexEvidence,
    source_span_evidence: paper.sourceSpanEvidence,
  }));
}

function normalizeGraphPresenceMatchMethod(
  value: string | null
): GraphPresenceMatch["matchedBy"] {
  return value === "arxiv" ||
    value === "doi" ||
    value === "source_path" ||
    value === "paper_source_index" ||
    value === "title"
    ? value
    : "title";
}

function normalizeGraphPresenceSourceKind(
  value: string | null
): GraphPresenceMatch["sourceKind"] {
  return value === "markdown" || value === "pdf" ? value : "unknown";
}

function deserializePresentPapers(value: unknown): GraphPresenceMatch[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({
      canonicalId: pickString(entry, ["canonical_id", "canonicalId"]) ?? "unknown",
      title: pickString(entry, ["title"]),
      sourceKind: normalizeGraphPresenceSourceKind(
        pickString(entry, ["source_kind", "sourceKind"])
      ),
      sourceProvider: pickString(entry, ["source_provider", "sourceProvider"]),
      retrievalProviders: asStringArray(entry.retrieval_providers ?? entry.retrievalProviders),
      matchedBy: normalizeGraphPresenceMatchMethod(
        pickString(entry, ["matched_by", "matchedBy"])
      ),
      corpusPaperId: pickString(entry, ["corpus_paper_id", "corpusPaperId"]),
      corpusPaperTitle: pickString(entry, [
        "corpus_paper_title",
        "corpusPaperTitle",
      ]),
      corpusSourceKey: pickString(entry, [
        "corpus_source_key",
        "corpusSourceKey",
      ]),
      graphIndexEvidence: pickEvidenceRecord(entry, [
        "graph_index_evidence",
        "graphIndexEvidence",
        "graph_index",
        "graphIndex",
      ]),
      sourceSpanEvidence: pickEvidenceRecord(entry, [
        "source_span_evidence",
        "sourceSpanEvidence",
        "source_spans",
        "sourceSpans",
      ]),
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
  const summaryPresentPapers = summaryOnly
    ? corpusEntries
        .map((paper, index) => ({ entry: sources[index] ?? {}, paper, index }))
        .filter(({ paper }) => paper.activeInGraph)
        .slice(0, expectedPaperCount)
        .map(buildRemoteCorpusSummaryMatch)
    : [];
  const effectivePresentPapers = summaryOnly ? summaryPresentPapers : presentPapers;
  const presentPaperCount = summaryOnly
    ? Math.min(summaryPresentPapers.length, expectedPaperCount)
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
  const verificationMode: GraphPresenceVerificationMode =
    params.expectedPapers.length === 0 && expectedPaperCount > 0
      ? "remote_corpus_summary"
      : "canonical_paper_index";
  const paperIndexPresentCount =
    countGraphPresencePaperIndexEvidence(effectivePresentPapers);
  const sourceBackedPresentCount =
    countGraphPresenceSourceSpanEvidence(effectivePresentPapers);
  const readyProofLevel = deriveGraphPresenceReadyProofLevel({
    status,
    verificationMode,
    expectedPaperCount,
    presentPapers: effectivePresentPapers,
    paperIndexPresentCount,
    sourceBackedPresentCount,
  });

  return {
    checked_at: params.checkedAt,
    status,
    mode: params.mode,
    verification_mode: verificationMode,
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
    ready_proof_level: readyProofLevel,
    source_backed_present_count: sourceBackedPresentCount,
    paper_index_present_count: paperIndexPresentCount,
    missing_papers: serializeMissingPapers(missingPapers),
    present_papers: serializePresentPapers(effectivePresentPapers),
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

function shouldPreserveCachedReadyRemoteSummary(params: {
  candidate: Record<string, unknown>;
  cached: Record<string, unknown> | null;
}): boolean {
  if (!params.cached) {
    return false;
  }
  const cachedStatus = pickString(params.cached, ["status"])?.trim().toLowerCase() ?? null;
  const cachedVerificationMode =
    pickString(params.cached, ["verification_mode", "verificationMode"])
      ?.trim()
      .toLowerCase() ?? null;
  if (cachedStatus !== "ready" || cachedVerificationMode !== "remote_corpus_summary") {
    return false;
  }
  const cachedPresent =
    pickCount(params.cached, ["present_paper_count", "presentPaperCount"]) ?? 0;
  const cachedExpected =
    pickCount(params.cached, ["expected_paper_count", "expectedPaperCount"]) ?? 0;
  const cachedPresentPapers = deserializePresentPapers(
    params.cached.present_papers ?? params.cached.presentPapers
  );
  const candidatePresent =
    pickCount(params.candidate, ["present_paper_count", "presentPaperCount"]) ?? 0;
  const candidateMissing =
    pickCount(params.candidate, ["missing_paper_count", "missingPaperCount"]) ?? 0;
  if (
    cachedPresent <= 0 ||
    cachedExpected <= 0 ||
    cachedPresentPapers.length === 0 ||
    candidatePresent > 0 ||
    candidateMissing <= 0
  ) {
    return false;
  }
  const cachedCorpus = pickString(params.cached, ["corpus_name", "corpusName"]);
  const candidateCorpus = pickString(params.candidate, ["corpus_name", "corpusName"]);
  if (cachedCorpus && candidateCorpus && cachedCorpus !== candidateCorpus) {
    return false;
  }
  return true;
}

function buildManifestReadyRemoteSummaryStatusRecord(
  manifest: ManifestLike
): Record<string, unknown> | null {
  const paperIngestion = asRecord(manifest.paper_ingestion);
  const status =
    pickString(paperIngestion, ["graph_presence_status", "graphPresenceStatus"])
      ?.trim()
      .toLowerCase() ?? null;
  const expectedPaperCount =
    pickCount(paperIngestion, [
      "graph_presence_expected_papers",
      "graphPresenceExpectedPapers",
      "graph_presence_expected",
      "graphPresenceExpected",
    ]) ?? 0;
  const presentPaperCount =
    pickCount(paperIngestion, [
      "graph_presence_present_papers",
      "graphPresencePresentPapers",
      "graph_presence_present",
      "graphPresencePresent",
      "remote_paper_count",
      "remotePaperCount",
      "synced_papers",
      "syncedPapers",
    ]) ?? 0;
  if (status !== "ready" || expectedPaperCount <= 0 || presentPaperCount <= 0) {
    return null;
  }
  return null;
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
    remoteMcpUrl: params.remoteInspection.summary.mcpUrl,
    remoteApiBaseUrl: params.remoteInspection.summary.apiBaseUrl,
  });
  const preferredCorpusRoot = resolvePreferredPapernexusCorpusRoot({
    manifest: params.manifest,
    statusRecord: params.cachedStatusRecord,
  });
  const targetCorpus = preferredCorpusName;
  const remoteEndpoint =
    params.remoteInspection.summary.mcpUrl ?? params.remoteInspection.summary.apiBaseUrl ?? null;
  const cachedReadySummaryRecord =
    params.cachedStatusRecord ??
    buildManifestReadyRemoteSummaryStatusRecord(params.manifest);

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
      if (
        shouldPreserveCachedReadyRemoteSummary({
          candidate: statusRecord,
          cached: cachedReadySummaryRecord,
        })
      ) {
        return { statusRecord: cachedReadySummaryRecord, refreshError: null };
      }
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
      if (
        shouldPreserveCachedReadyRemoteSummary({
          candidate: statusRecord,
          cached: cachedReadySummaryRecord,
        })
      ) {
        return { statusRecord: cachedReadySummaryRecord, refreshError: null };
      }
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
    remoteMcpUrl: remoteInspection.summary.mcpUrl,
    remoteApiBaseUrl: remoteInspection.summary.apiBaseUrl,
  });
  const preferredCorpusRoot = resolvePreferredPapernexusCorpusRoot({
    manifest: params.manifest,
    statusRecord: cachedStatusRecord,
  });
  const remoteEndpoint =
    remoteInspection.summary.apiBaseUrl ?? remoteInspection.summary.mcpUrl ?? null;
  const paperIngestionProgress = summarizePaperIngestionProgress(params.manifest);
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
  const statusPresentPapers = deserializePresentPapers(
    statusRecord?.present_papers ?? statusRecord?.presentPapers
  );
  const statusVerificationMode =
    pickString(statusRecord, ["verification_mode", "verificationMode"])?.trim().toLowerCase() ??
    null;
  const remoteSummaryWithoutPerPaperProof =
    params.expected.papers.length > 0 &&
    statusVerificationMode === "remote_corpus_summary" &&
    statusPresentPapers.length === 0;

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
      } else if (
        normalizedStatus === "missing_papers" ||
        presentPaperCount < expectedPaperCount ||
        remoteSummaryWithoutPerPaperProof
      ) {
        status = "missing_papers";
        if (remoteSummaryWithoutPerPaperProof) {
          presentPaperCount = Math.min(presentPaperCount, statusPresentPapers.length);
        }
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
    if (statusExpectedCount !== expectedPaperCount) {
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
      remoteSummaryWithoutPerPaperProof ||
      missingPapers.length > 0 ||
      presentPaperCount < expectedPaperCount
    ) {
      status = "missing_papers";
      if (remoteSummaryWithoutPerPaperProof) {
        presentPaperCount = Math.min(presentPaperCount, statusPresentPapers.length);
      }
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

  if (
    remoteInspection.tokenAvailable &&
    status !== "ready" &&
    params.expected.papers.length > 0 &&
    expectedPapersAreMetadataOnly(params.expected.papers) &&
    !paperIngestionProgress.inFlight
  ) {
    status = "missing_sources";
    refreshReason = buildMetadataOnlyMissingSourcesReason({
      expectedPaperCount,
      paperSourceIndexPath: params.expected.paperSourceIndexPath,
    });
    presentPaperCount = Math.min(presentPaperCount, expectedPaperCount);
    missingPapers = params.expected.papers.map((paper) => toMissingPaper(paper));
  }

  const repairTargetCorpus = resolveGraphRepairTargetCorpus({
    manifest: params.manifest,
    corpusName: preferredCorpusName,
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    sharedCorpus: params.sharedCorpus,
    remoteMcpUrl: remoteInspection.summary.mcpUrl,
    remoteApiBaseUrl: remoteInspection.summary.apiBaseUrl,
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
  const presentPapers = statusPresentPapers;
  const paperIndexPresentCount =
    pickCount(statusRecord, ["paper_index_present_count", "paperIndexPresentCount"]) ??
    countGraphPresencePaperIndexEvidence(presentPapers);
  const sourceBackedPresentCount =
    pickCount(statusRecord, [
      "source_backed_present_count",
      "sourceBackedPresentCount",
    ]) ?? countGraphPresenceSourceSpanEvidence(presentPapers);
  const verificationMode: GraphPresenceVerificationMode =
    params.expected.papers.length === 0 && expectedPaperCount > 0
      ? "remote_corpus_summary"
      : statusRecord &&
          pickString(statusRecord, ["verification_mode", "verificationMode"]) ===
            "paper_source_index_override"
        ? "paper_source_index_override"
        : "canonical_paper_index";
  const readyProofLevel =
    normalizeGraphPresenceReadyProofLevel(
      statusRecord?.ready_proof_level ?? statusRecord?.readyProofLevel
    ) ??
    deriveGraphPresenceReadyProofLevel({
      status,
      verificationMode,
      expectedPaperCount,
      presentPapers,
      paperIndexPresentCount,
      sourceBackedPresentCount,
    });

  const result: GraphPresenceCheckResult = {
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    checkedAt: params.checkedAt,
    status,
    verificationMode,
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
    readyProofLevel,
    sourceBackedPresentCount,
    paperIndexPresentCount,
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
    presentPapers,
    missingPapers: status === "ready" ? [] : missingPapers,
    graphBuildWorkflowStatus: "blocked",
    graphBuildCanContinue: false,
    graphBuildRequiresImport: false,
    graphBuildRequiresSourceRepair: false,
    graphBuildStatusReason: null,
    manifestUpdated: false,
  };

  const finalizedResult = attachGraphBuildStatusContract({
    result: applyPaperSourceIndexGraphPresenceOverride({
      result,
      expected: params.expected,
      allowOverride: !paperIngestionProgress.inFlight,
    }),
    ingestionInFlight: paperIngestionProgress.inFlight,
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
    ready_proof_level: finalizedResult.readyProofLevel,
    source_backed_present_count: finalizedResult.sourceBackedPresentCount,
    paper_index_present_count: finalizedResult.paperIndexPresentCount,
    refresh_required: finalizedResult.refreshRequired,
    refresh_reason: finalizedResult.refreshReason,
    repair_required: finalizedResult.repairRequired,
    repair_reason: finalizedResult.repairReason,
    repair_target_corpus: finalizedResult.repairTargetCorpus,
    graph_build_workflow_status: finalizedResult.graphBuildWorkflowStatus,
    graph_build_can_continue: finalizedResult.graphBuildCanContinue,
    graph_build_requires_import: finalizedResult.graphBuildRequiresImport,
    graph_build_requires_source_repair: finalizedResult.graphBuildRequiresSourceRepair,
    graph_build_status_reason: finalizedResult.graphBuildStatusReason,
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
    const certification = await certifyPapernexusTaskForProject({
      projectRoot,
      checkedAt,
      graphPresenceResult: result,
    });
    const graphBuildReceipt = await writeGraphPresenceBuildReceipt({
      projectRoot,
      result,
      certification,
      corpus: sharedCorpus,
    });
    const papernexusSyncState = buildPapernexusSyncStateFromGraphPresence({
      projectId,
      authorityMode: remoteMcpUrl ? "remote_mcp" : "remote_api",
      corpus: sharedCorpus,
      graphPresence: {
        projectId,
        checkedAt,
        status: result.status,
        verificationMode: result.verificationMode,
        reportPath: path.relative(projectRoot, reportPath),
        paperSourceIndexPath: result.paperSourceIndexPath,
        expectedPaperCount: result.expectedPaperCount,
        presentPaperCount: result.presentPaperCount,
        missingPaperCount: result.missingPaperCount,
        readyProofLevel: result.readyProofLevel,
        sourceBackedPresentCount: result.sourceBackedPresentCount,
        paperIndexPresentCount: result.paperIndexPresentCount,
        corpusName: result.corpusName,
        refreshRequired: result.refreshRequired,
        refreshReason: result.refreshReason,
        repairRequired: result.repairRequired,
        repairReason: result.repairReason,
        presentPapers: result.presentPapers,
        missingPapers: result.missingPapers,
        graphBuildWorkflowStatus: result.graphBuildWorkflowStatus,
        graphBuildCanContinue: result.graphBuildCanContinue,
        graphBuildRequiresImport: result.graphBuildRequiresImport,
        graphBuildStatusReason: result.graphBuildStatusReason,
      },
      certification,
      receiptPath: graphBuildReceipt.path,
      receipt: graphBuildReceipt.receipt,
    });
    const papernexusSyncStatePath = await writePapernexusSyncState({
      projectRoot,
      state: papernexusSyncState,
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
        graph_presence_ready_proof_level: result.readyProofLevel,
        graph_presence_source_backed_present_count: result.sourceBackedPresentCount,
        graph_presence_paper_index_present_count: result.paperIndexPresentCount,
        refresh_required: result.refreshRequired ? true : false,
        refresh_reason: result.status === "ready" ? null : result.refreshReason,
        repair_required: result.repairRequired ? true : false,
        repair_reason: result.repairRequired ? result.repairReason : null,
        repair_target_corpus: result.repairRequired ? result.repairTargetCorpus : null,
        graph_build_workflow_status: result.graphBuildWorkflowStatus,
        graph_build_can_continue: result.graphBuildCanContinue,
        graph_build_requires_import: result.graphBuildRequiresImport,
        graph_build_requires_source_repair: result.graphBuildRequiresSourceRepair,
        graph_build_status_reason: result.graphBuildStatusReason,
        papernexus_certification_status: certification.status,
        papernexus_claim_level: certification.claim_level,
        papernexus_source_backed_graph_claim:
          certification.source_backed_graph_claim,
        papernexus_certification_path: certification.report_path,
        papernexus_certification_limitations: certification.limitations,
        papernexus_graph_build_receipt_path: graphBuildReceipt.path,
        papernexus_sync_state_path: papernexusSyncStatePath,
        papernexus_sync_state_checked_at: papernexusSyncState.generated_at,
        papernexus_sync_runtime_status:
          papernexusSyncState.workflow_projection.runtime_status,
        papernexus_sync_can_continue:
          papernexusSyncState.workflow_projection.can_continue,
        papernexus_sync_next_action:
          papernexusSyncState.workflow_projection.next_action,
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

  if (
    status !== "ready" &&
    expected.papers.length > 0 &&
    expectedPapersAreMetadataOnly(expected.papers) &&
    !summarizePaperIngestionProgress(manifest).inFlight
  ) {
    status = "missing_sources";
    missingPapers.splice(
      0,
      missingPapers.length,
      ...expected.papers.map((paper) => toMissingPaper(paper))
    );
  }

  const refreshRequired = status === "missing_corpus" || status === "missing_papers";
  const refreshReason =
    status === "ready"
      ? null
      : status === "missing_sources" && expected.papers.length > 0
        ? buildMetadataOnlyMissingSourcesReason({
            expectedPaperCount: expected.papers.length,
            paperSourceIndexPath: expected.paperSourceIndexPath,
          })
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
  const paperIndexPresentCount = countGraphPresencePaperIndexEvidence(presentPapers);
  const sourceBackedPresentCount = countGraphPresenceSourceSpanEvidence(presentPapers);
  const readyProofLevel = deriveGraphPresenceReadyProofLevel({
    status,
    verificationMode: "canonical_paper_index",
    expectedPaperCount: expected.papers.length,
    presentPapers,
    paperIndexPresentCount,
    sourceBackedPresentCount,
  });

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
    readyProofLevel,
    sourceBackedPresentCount,
    paperIndexPresentCount,
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
    graphBuildWorkflowStatus: "blocked",
    graphBuildCanContinue: false,
    graphBuildRequiresImport: false,
    graphBuildRequiresSourceRepair: false,
    graphBuildStatusReason: null,
    manifestUpdated: false,
  };

  const finalizedResult = attachGraphBuildStatusContract({
    result: applyPaperSourceIndexGraphPresenceOverride({
      result,
      expected,
      allowOverride: !paperIngestionProgress.inFlight,
    }),
    ingestionInFlight: paperIngestionProgress.inFlight,
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
    ready_proof_level: finalizedResult.readyProofLevel,
    source_backed_present_count: finalizedResult.sourceBackedPresentCount,
    paper_index_present_count: finalizedResult.paperIndexPresentCount,
    refresh_required: finalizedResult.refreshRequired,
    refresh_reason: finalizedResult.refreshReason,
    repair_required: finalizedResult.repairRequired,
    repair_reason: finalizedResult.repairReason,
    repair_target_corpus: finalizedResult.repairTargetCorpus,
    graph_build_workflow_status: finalizedResult.graphBuildWorkflowStatus,
    graph_build_can_continue: finalizedResult.graphBuildCanContinue,
    graph_build_requires_import: finalizedResult.graphBuildRequiresImport,
    graph_build_requires_source_repair: finalizedResult.graphBuildRequiresSourceRepair,
    graph_build_status_reason: finalizedResult.graphBuildStatusReason,
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
  const certification = await certifyPapernexusTaskForProject({
    projectRoot,
    checkedAt,
    graphPresenceResult: finalizedResult,
  });
  const graphBuildReceipt = await writeGraphPresenceBuildReceipt({
    projectRoot,
    result: finalizedResult,
    certification,
    corpus: finalizedResult.corpusName ?? sharedCorpus,
  });
  const papernexusSyncState = buildPapernexusSyncStateFromGraphPresence({
    projectId,
    authorityMode: "local_corpus",
    corpus: finalizedResult.corpusName ?? sharedCorpus,
    graphPresence: {
      projectId,
      checkedAt,
      status: finalizedResult.status,
      verificationMode: finalizedResult.verificationMode,
      reportPath: path.relative(projectRoot, reportPath),
      paperSourceIndexPath: finalizedResult.paperSourceIndexPath,
      expectedPaperCount: finalizedResult.expectedPaperCount,
      presentPaperCount: finalizedResult.presentPaperCount,
      missingPaperCount: finalizedResult.missingPaperCount,
      readyProofLevel: finalizedResult.readyProofLevel,
      sourceBackedPresentCount: finalizedResult.sourceBackedPresentCount,
      paperIndexPresentCount: finalizedResult.paperIndexPresentCount,
      corpusName: finalizedResult.corpusName,
      refreshRequired: finalizedResult.refreshRequired,
      refreshReason: finalizedResult.refreshReason,
      repairRequired: finalizedResult.repairRequired,
      repairReason: finalizedResult.repairReason,
      presentPapers: finalizedResult.presentPapers,
      missingPapers: finalizedResult.missingPapers,
      graphBuildWorkflowStatus: finalizedResult.graphBuildWorkflowStatus,
      graphBuildCanContinue: finalizedResult.graphBuildCanContinue,
      graphBuildRequiresImport: finalizedResult.graphBuildRequiresImport,
      graphBuildStatusReason: finalizedResult.graphBuildStatusReason,
    },
    certification,
    receiptPath: graphBuildReceipt.path,
    receipt: graphBuildReceipt.receipt,
  });
  const papernexusSyncStatePath = await writePapernexusSyncState({
    projectRoot,
    state: papernexusSyncState,
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
      graph_presence_ready_proof_level: finalizedResult.readyProofLevel,
      graph_presence_source_backed_present_count: finalizedResult.sourceBackedPresentCount,
      graph_presence_paper_index_present_count: finalizedResult.paperIndexPresentCount,
      refresh_required: finalizedResult.refreshRequired ? true : false,
      refresh_reason: finalizedResult.status === "ready" ? null : finalizedResult.refreshReason,
      repair_required: finalizedResult.repairRequired ? true : false,
      repair_reason: finalizedResult.repairRequired ? finalizedResult.repairReason : null,
      repair_target_corpus: finalizedResult.repairRequired ? finalizedResult.repairTargetCorpus : null,
      graph_build_workflow_status: finalizedResult.graphBuildWorkflowStatus,
      graph_build_can_continue: finalizedResult.graphBuildCanContinue,
      graph_build_requires_import: finalizedResult.graphBuildRequiresImport,
      graph_build_requires_source_repair: finalizedResult.graphBuildRequiresSourceRepair,
      graph_build_status_reason: finalizedResult.graphBuildStatusReason,
      papernexus_certification_status: certification.status,
      papernexus_claim_level: certification.claim_level,
      papernexus_source_backed_graph_claim:
        certification.source_backed_graph_claim,
      papernexus_certification_path: certification.report_path,
      papernexus_certification_limitations: certification.limitations,
      papernexus_graph_build_receipt_path: graphBuildReceipt.path,
      papernexus_sync_state_path: papernexusSyncStatePath,
      papernexus_sync_state_checked_at: papernexusSyncState.generated_at,
      papernexus_sync_runtime_status:
        papernexusSyncState.workflow_projection.runtime_status,
      papernexus_sync_can_continue:
        papernexusSyncState.workflow_projection.can_continue,
      papernexus_sync_next_action:
        papernexusSyncState.workflow_projection.next_action,
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
