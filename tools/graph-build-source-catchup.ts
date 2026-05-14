import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickString,
  uniqueStrings,
} from "./workflow-guard-core/coercion";
import {
  pathExists,
  readJsonIfExists,
  withAdvisoryLock,
  writeJsonAtomicEnsured,
  writeTextEnsured,
} from "./workflow-guard-core/fs";
import {
  buildCanonicalPaperRecordFromRecord,
  mergeCanonicalPaperRecords,
  normalizeTitle,
  normalizeArxivId,
  PAPER_SOURCE_PATH_KEYS,
  resolvePaperSourcePathCandidates,
  serializeCanonicalPaperRecord,
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
  callPapernexusMcpTool,
  type PapernexusMcpClientConfig,
} from "./papernexus-packets/mcp-client";
import {
  writeLiteratureRequisitionDecisionReport,
} from "./literature-discovery/requisition-decision";
import {
  inspectPapernexusRemoteAccess,
  summarizePapernexusRemoteAccessConfig,
  type PapernexusRemoteAccessConfig,
} from "./papernexus-secret";
import {
  resolvePapernexusSharedCorpusFallback,
  resolveWorkflowSharedPapernexusCorpus,
  shouldAutodiscoverRemotePapernexusCorpus,
} from "./papernexus-shared-corpus";
import { buildPapernexusBatchImportCommandText } from "./papernexus-batch-executor.js";
import {
  writePapernexusGraphBuildReceipt,
  type PapernexusGraphBuildReceiptStatus,
} from "./papernexus-graph-build-receipt";
import { writeGraphBuildDecision } from "./graph-build-decision";

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
const REMOTE_LITERATURE_DISCOVERY_PACKET_PATH = path.join(
  "researcher",
  "literature-discovery",
  "LITERATURE_DISCOVERY_PACKET.json"
);

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
const DEFAULT_REMOTE_DISCOVERY_MAX_CANDIDATES = 12;
const DEFAULT_REMOTE_DISCOVERY_MAX_DOWNLOADS = 6;
const DEFAULT_REMOTE_DISCOVERY_MAX_IMPORTED = 8;
const DEFAULT_REMOTE_DISCOVERY_MCP_TIMEOUT_MS = 300_000;
const MAX_REMOTE_DISCOVERY_SEED_PAPERS = 24;
const REMOTE_DISCOVERY_MAX_CANDIDATES_ENV =
  "PAPERNEXUS_DISCOVERY_MAX_CANDIDATES";
const REMOTE_DISCOVERY_MAX_DOWNLOADS_ENV =
  "PAPERNEXUS_DISCOVERY_MAX_DOWNLOADS";
const REMOTE_DISCOVERY_MAX_IMPORTED_ENV =
  "PAPERNEXUS_DISCOVERY_MAX_IMPORTED";
const REMOTE_DISCOVERY_MCP_TIMEOUT_ENV = "PAPERNEXUS_DISCOVERY_MCP_TIMEOUT_MS";
const REMOTE_LITERATURE_DISCOVERY_PROVIDER = "papernexus-literature-discovery";

type RemoteDiscoveryWorkflowPolicy = {
  papernexusAccessMode?: string | null;
  papernexusSharedCorpus?: string | null;
  papernexusMcpUrl?: string | null;
  papernexusApiBaseUrl?: string | null;
  papernexusMcpTransport?: string | null;
  papernexusMcpTimeoutMs?: number | null;
  papernexusApiTokenSource?: string | null;
  papernexusApiTokenEnv?: string | null;
  papernexusApiTokenService?: string | null;
  papernexusApiTokenAccount?: string | null;
  papernexusApiTokenLookupTimeoutMs?: number | null;
  papernexusAllowLocalMcp?: boolean | null;
  papernexusMineruHttpUrl?: string | null;
  papernexusSshTarget?: string | null;
  papernexusRemoteStagingRoot?: string | null;
  papernexusDiscoveryProviders?: string[] | string | null;
  papernexusDiscoveryMaxCandidates?: number | null;
  papernexusDiscoveryMaxDownloads?: number | null;
  papernexusDiscoveryMaxImported?: number | null;
  papernexusDiscoveryProcessImports?: boolean | null;
  papernexusDiscoveryImportMaxPasses?: number | null;
  papernexusDiscoveryMcpTimeoutMs?: number | null;
  papernexusDiscoveryRequestCache?: boolean | null;
  papernexusDiscoveryRequestCacheTtlMs?: number | null;
  papernexusProviderRequestSchedulerDelayMs?: number | null;
  papernexusProviderRequestMaxConcurrent?: number | null;
  papernexusOpenAlexRequestDelayMs?: number | null;
  papernexusOpenAlexMaxConcurrent?: number | null;
  papernexusSemanticScholarRequestDelayMs?: number | null;
  papernexusSemanticScholarMaxConcurrent?: number | null;
};

type NormalizedPaperIngestionState = ReturnType<typeof normalizePaperIngestionState>;
type NormalizedPaperIngestionQueuedRequest =
  NormalizedPaperIngestionState["queuedRequests"][number];

type RemoteImportQueueProgressResult = {
  payload: Record<string, unknown> | null;
  error: string | null;
};

type RemoteDiscoveryClientResolution = {
  clientConfig: PapernexusMcpClientConfig;
  sharedCorpus: string | null;
  tokenError: string | null;
};

function sanitizeIdFragment(value: string | null | undefined): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "unknown";
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function pickNumberValue(record: Record<string, unknown> | null, keys: string[]): number | null {
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

function normalizePositiveInteger(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.floor(numeric);
}

function resolveRemoteDiscoveryMcpTimeoutMs(params: {
  workflowPolicy?: RemoteDiscoveryWorkflowPolicy | null;
  baseTimeoutMs?: number | null;
}): number {
  const baseTimeoutMs =
    normalizePositiveInteger(params.baseTimeoutMs) ?? 30_000;
  const configuredTimeoutMs =
    normalizePositiveInteger(params.workflowPolicy?.papernexusDiscoveryMcpTimeoutMs) ??
    normalizePositiveInteger(process.env[REMOTE_DISCOVERY_MCP_TIMEOUT_ENV]);
  if (configuredTimeoutMs !== null) {
    return Math.max(baseTimeoutMs, configuredTimeoutMs);
  }
  return Math.max(baseTimeoutMs, DEFAULT_REMOTE_DISCOVERY_MCP_TIMEOUT_MS);
}

function isRemoteDiscoveryTimeoutError(message: string | null | undefined): boolean {
  return /\babort(?:ed)?\b|\btimeout\b|\btimed out\b/i.test(message ?? "");
}

function buildRemoteDiscoveryFailureMessage(params: {
  message: string;
  timeoutMs?: number | null;
  timeout: boolean;
}): string {
  if (!params.timeout) {
    return params.message;
  }
  const timeoutMs = normalizePositiveInteger(params.timeoutMs);
  const suffix = timeoutMs === null ? "" : ` after ${timeoutMs}ms`;
  return `PaperNexus literature_discovery launch timed out${suffix} before returning a run/import handle: ${params.message}`;
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return null;
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueStrings(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    );
  }
  if (typeof value !== "string") {
    return [];
  }
  return uniqueStrings(
    value
      .split(/[,\s]+/g)
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

function parseMcpToolJsonPayload(value: unknown): Record<string, unknown> | null {
  const envelope = asRecord(value);
  const content = Array.isArray(envelope?.content) ? envelope.content : [];
  const textBlock = content
    .map((entry) => asRecord(entry))
    .find((entry) => typeof entry?.text === "string");
  const raw = typeof textBlock?.text === "string" ? textBlock.text : value;
  if (typeof raw === "string") {
    try {
      return asRecord(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  return asRecord(raw);
}

function isLiteratureDiscoveryTriggerKind(value: string | null | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return (
    normalized === "idea_catalyst_requisition" ||
    normalized === "literature_discovery" ||
    normalized.endsWith("literature_discovery")
  );
}

function isActiveLiteratureDiscoveryRequest(
  request: NormalizedPaperIngestionQueuedRequest
): boolean {
  return (
    isLiteratureDiscoveryTriggerKind(request.triggerKind) &&
    ACTIVE_PAPER_INGESTION_REQUEST_STATUSES.has(request.status)
  );
}

function findActiveLiteratureDiscoveryRequest(
  manifest: Record<string, unknown>
): NormalizedPaperIngestionQueuedRequest | null {
  const state = normalizePaperIngestionState(manifest.paper_ingestion);
  return state.queuedRequests.find(isActiveLiteratureDiscoveryRequest) ?? null;
}

function isRefreshableLiteratureDiscoveryRequest(
  request: NormalizedPaperIngestionQueuedRequest
): boolean {
  return (
    isLiteratureDiscoveryTriggerKind(request.triggerKind) &&
    (request.manifestPath !== null || request.validationReportPath !== null) &&
    (ACTIVE_PAPER_INGESTION_REQUEST_STATUSES.has(request.status) ||
      COMPLETED_PAPER_INGESTION_REQUEST_STATUSES.has(request.status))
  );
}

function findRefreshableLiteratureDiscoveryRequest(
  manifest: Record<string, unknown>
): NormalizedPaperIngestionQueuedRequest | null {
  const state = normalizePaperIngestionState(manifest.paper_ingestion);
  return state.queuedRequests.find(isRefreshableLiteratureDiscoveryRequest) ?? null;
}

function hasActiveNonLiteraturePaperIngestionRequest(
  manifest: Record<string, unknown>
): boolean {
  const state = normalizePaperIngestionState(manifest.paper_ingestion);
  return state.queuedRequests.some(
    (request) =>
      request.wrapper === "pn_batch_import.py" &&
      ACTIVE_PAPER_INGESTION_REQUEST_STATUSES.has(request.status) &&
      !isLiteratureDiscoveryTriggerKind(request.triggerKind)
  );
}

function hasExplicitMissingGraphPresence(manifest: Record<string, unknown>): boolean {
  const paperIngestion = asRecord(manifest.paper_ingestion);
  const graphPresenceStatus = normalizeStage(
    paperIngestion?.graph_presence_status ?? paperIngestion?.graphPresenceStatus
  );
  return Boolean(graphPresenceStatus && graphPresenceStatus !== "ready");
}

function hasReadySourceBackedGraphCertification(
  manifest: Record<string, unknown> | null
): boolean {
  const paperIngestion = asRecord(manifest?.paper_ingestion);
  const graphPresenceStatus = normalizeStage(
    paperIngestion?.graph_presence_status ?? paperIngestion?.graphPresenceStatus
  );
  const certificationStatus = normalizeStage(
    paperIngestion?.papernexus_certification_status ??
      paperIngestion?.papernexusCertificationStatus
  );
  const claimLevel = normalizeStage(
    paperIngestion?.papernexus_claim_level ?? paperIngestion?.papernexusClaimLevel
  );
  return (
    graphPresenceStatus === "ready" &&
    certificationStatus === "ready" &&
    (paperIngestion?.papernexus_source_backed_graph_claim === true ||
      paperIngestion?.papernexusSourceBackedGraphClaim === true ||
      claimLevel === "source_backed_graph")
  );
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

function isRemoteLiteratureDiscoverySourceIndexEntry(
  entry: SourceIndexRawEntry
): boolean {
  return entry.paper.retrievalProviders.some(
    (provider) => provider.trim().toLowerCase() === REMOTE_LITERATURE_DISCOVERY_PROVIDER
  );
}

const REMOTE_DISCOVERY_PRESERVED_SOURCE_INDEX_KEYS = [
  "candidate_id",
  "candidateId",
  "source_kind_detail",
  "full_text_status",
  "fullTextStatus",
  "download_status",
  "downloadStatus",
  "metadata_graph_status",
  "metadataGraphStatus",
  "import_status",
  "importStatus",
  "import_task_id",
  "importTaskId",
  "supplementation",
  "candidate_markdown_url",
  "candidateMarkdownUrl",
  "candidate_pdf_url",
  "candidatePdfUrl",
  "markdown_url",
  "markdownUrl",
] as const;

function mergeRawSourceIndexRecord(params: {
  existing: Record<string, unknown> | null;
  incoming: Record<string, unknown>;
}): {
  canonicalId: string;
  record: Record<string, unknown>;
} | null {
  const normalized = buildCanonicalPaperRecordFromRecord(params.incoming);
  if (!normalized) {
    return null;
  }
  const existing = params.existing
    ? buildCanonicalPaperRecordFromRecord(params.existing)
    : null;
  const merged = existing
    ? mergeCanonicalPaperRecords(existing, normalized)
    : normalized;
  const serialized = serializeCanonicalPaperRecord(merged);
  const preserved: Record<string, unknown> = {};
  for (const key of REMOTE_DISCOVERY_PRESERVED_SOURCE_INDEX_KEYS) {
    if (Object.prototype.hasOwnProperty.call(params.incoming, key)) {
      preserved[key] = params.incoming[key];
    }
  }
  const incomingKind = pickString(params.incoming, ["source_kind", "sourceKind"]);
  if (
    incomingKind &&
    serialized.source_kind !== "markdown" &&
    serialized.source_kind !== "pdf"
  ) {
    preserved.source_kind = incomingKind;
  }
  return {
    canonicalId: merged.canonicalId,
    record: {
      ...(params.existing ?? {}),
      ...serialized,
      ...preserved,
    },
  };
}

async function replaceRemoteLiteratureDiscoverySourceIndexEntries(params: {
  projectRoot: string;
  entries: Record<string, unknown>[];
  dropMetadataOnlyEntries?: boolean;
}): Promise<{
  sourceIndexPath: string;
  entryCount: number;
  updatedCanonicalIds: string[];
}> {
  const sourceIndexPath = resolvePaperSourceIndexPath(params.projectRoot);
  const lockPath = `${sourceIndexPath}.lock`;
  return withAdvisoryLock({
    lockPath,
    task: async () => {
      const currentRaw = await readJsonIfExists<unknown>(sourceIndexPath);
      const byCanonicalId = new Map<string, Record<string, unknown>>();
      for (const entry of collectSourceIndexEntries(currentRaw)) {
        if (!isRemoteLiteratureDiscoverySourceIndexEntry(entry)) {
          if (
            params.dropMetadataOnlyEntries &&
            !hasImportableSourceIndexEvidence(entry)
          ) {
            continue;
          }
          byCanonicalId.set(entry.paper.canonicalId, entry.record);
        }
      }

      const updatedCanonicalIds: string[] = [];
      for (const rawEntry of params.entries) {
        const merged = mergeRawSourceIndexRecord({
          existing: byCanonicalId.get(
            pickString(rawEntry, ["canonical_id", "canonicalId", "id"]) ?? ""
          ) ?? null,
          incoming: rawEntry,
        });
        if (!merged) {
          continue;
        }
        const existing = byCanonicalId.get(merged.canonicalId);
        byCanonicalId.set(
          merged.canonicalId,
          existing
            ? mergeRawSourceIndexRecord({
                existing,
                incoming: merged.record,
              })?.record ?? merged.record
            : merged.record
        );
        updatedCanonicalIds.push(merged.canonicalId);
      }

      const records = [...byCanonicalId.entries()].sort((left, right) =>
        left[0].localeCompare(right[0])
      );
      await writeJsonAtomicEnsured(sourceIndexPath, {
        papers: records.map(([, record]) => record),
      });
      return {
        sourceIndexPath,
        entryCount: records.length,
        updatedCanonicalIds: [...new Set(updatedCanonicalIds)],
      };
    },
  });
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

function hasImportableSourceIndexEvidence(entry: SourceIndexRawEntry): boolean {
  const importStatus = normalizeStage(
    pickString(entry.record, ["import_status", "importStatus"]) ??
      pickString(entry.record, ["resolution_status", "resolutionStatus"])
  );
  const hasImportTask = Boolean(
    pickString(entry.record, ["import_task_id", "importTaskId", "task_id", "taskId"])
  );
  const importBackedStatuses = new Set([
    "submitted",
    "running",
    "completed",
    "deduped",
    "indexed",
    "graph_synced",
    "already_present",
    "resolved_markdown",
    "resolved_pdf",
  ]);
  return Boolean(
    entry.paper.sourcePath ||
      entry.plannedPath ||
      entry.paper.sourceKind === "markdown" ||
      entry.paper.sourceKind === "pdf" ||
      hasImportTask ||
      (importStatus && importBackedStatuses.has(importStatus))
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

function buildRemoteAccessConfigFromWorkflowPolicy(params: {
  workflowPolicy?: {
    papernexusMcpUrl?: string | null;
    papernexusMcpTransport?: string | null;
    papernexusMcpTimeoutMs?: number | null;
    papernexusApiTokenSource?: string | null;
    papernexusApiTokenEnv?: string | null;
    papernexusApiTokenService?: string | null;
    papernexusApiTokenAccount?: string | null;
    papernexusApiTokenLookupTimeoutMs?: number | null;
    papernexusAllowLocalMcp?: boolean | null;
    papernexusMineruHttpUrl?: string | null;
    papernexusSshTarget?: string | null;
    papernexusRemoteStagingRoot?: string | null;
  } | null;
}): PapernexusRemoteAccessConfig {
  return {
    mcpUrl: params.workflowPolicy?.papernexusMcpUrl ?? null,
    mcpTransport: params.workflowPolicy?.papernexusMcpTransport ?? null,
    mcpTimeoutMs: params.workflowPolicy?.papernexusMcpTimeoutMs ?? null,
    allowLocalMcp: params.workflowPolicy?.papernexusAllowLocalMcp ?? null,
    tokenSource: params.workflowPolicy?.papernexusApiTokenSource ?? null,
    tokenEnv: params.workflowPolicy?.papernexusApiTokenEnv ?? null,
    tokenService: params.workflowPolicy?.papernexusApiTokenService ?? null,
    tokenAccount: params.workflowPolicy?.papernexusApiTokenAccount ?? null,
    tokenLookupTimeoutMs: params.workflowPolicy?.papernexusApiTokenLookupTimeoutMs ?? null,
    mineruHttpUrl: params.workflowPolicy?.papernexusMineruHttpUrl ?? null,
    sshTarget: params.workflowPolicy?.papernexusSshTarget ?? null,
    remoteStagingRoot: params.workflowPolicy?.papernexusRemoteStagingRoot ?? null,
  };
}

async function resolveRemoteDiscoveryClient(params: {
  projectRoot: string;
  projectId: string | null;
  manifest: Record<string, unknown>;
  workflowPolicy?: {
    papernexusSharedCorpus?: string | null;
    papernexusMcpUrl?: string | null;
    papernexusApiBaseUrl?: string | null;
    papernexusMcpTransport?: string | null;
    papernexusMcpTimeoutMs?: number | null;
    papernexusApiTokenSource?: string | null;
    papernexusApiTokenEnv?: string | null;
    papernexusApiTokenService?: string | null;
    papernexusApiTokenAccount?: string | null;
    papernexusApiTokenLookupTimeoutMs?: number | null;
    papernexusAllowLocalMcp?: boolean | null;
    papernexusMineruHttpUrl?: string | null;
    papernexusSshTarget?: string | null;
    papernexusRemoteStagingRoot?: string | null;
  } | null;
}): Promise<RemoteDiscoveryClientResolution | null> {
  const accessConfig = buildRemoteAccessConfigFromWorkflowPolicy({
    workflowPolicy: params.workflowPolicy,
  });
  const summary = summarizePapernexusRemoteAccessConfig(accessConfig);
  if (!summary.mcpUrl || summary.mcpTransport !== "streamable-http") {
    return null;
  }
  const sharedCorpus = resolveSharedCorpus({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    manifest: params.manifest,
    sharedCorpus: params.workflowPolicy?.papernexusSharedCorpus,
    mcpUrl: summary.mcpUrl,
    apiBaseUrl: params.workflowPolicy?.papernexusApiBaseUrl,
  });
  const inspection = await inspectPapernexusRemoteAccess(accessConfig);
  const headers =
    inspection.token && inspection.token.trim()
      ? { Authorization: `Bearer ${inspection.token.trim()}` }
      : undefined;
  return {
    clientConfig: {
      transport: "streamable-http",
      url: summary.mcpUrl,
      headers,
      corpusRoot: sharedCorpus ?? "",
      timeoutMs: summary.mcpTimeoutMs,
    },
    sharedCorpus,
    tokenError: inspection.tokenError,
  };
}

function resolveManifestPapernexusPolicy(
  manifest: Record<string, unknown>
): Partial<RemoteDiscoveryWorkflowPolicy> {
  const paperIngestion = asRecord(manifest.paper_ingestion) ?? {};
  const state = normalizePaperIngestionState(paperIngestion);
  const hasRemoteQueuedRequest = state.queuedRequests.some((request) => {
    const wrapper = request.wrapper ?? "";
    const lastSessionKey = request.lastSessionKey ?? "";
    return (
      wrapper === "papernexus_remote_mcp" ||
      /papernexus:remote_mcp:/i.test(lastSessionKey)
    );
  });
  const explicitAccessMode =
    pickString(manifest, ["papernexusAccessMode", "papernexus_access_mode"]) ??
    pickString(paperIngestion, ["papernexusAccessMode", "papernexus_access_mode"]);
  return {
    papernexusAccessMode: explicitAccessMode ?? (hasRemoteQueuedRequest ? "remote_mcp" : null),
    papernexusSharedCorpus:
      pickString(manifest, ["papernexusSharedCorpus", "papernexus_shared_corpus"]) ??
      pickString(paperIngestion, ["papernexusSharedCorpus", "papernexus_shared_corpus"]),
    papernexusMcpUrl:
      pickString(manifest, ["papernexusMcpUrl", "papernexus_mcp_url"]) ??
      pickString(paperIngestion, ["papernexusMcpUrl", "papernexus_mcp_url"]),
    papernexusApiBaseUrl:
      pickString(manifest, ["papernexusApiBaseUrl", "papernexus_api_base_url"]) ??
      pickString(paperIngestion, ["papernexusApiBaseUrl", "papernexus_api_base_url"]),
  };
}

function resolveRemoteDiscoveryWorkflowPolicy(params: {
  workflowPolicy?: RemoteDiscoveryWorkflowPolicy | null;
  manifest: Record<string, unknown>;
}): RemoteDiscoveryWorkflowPolicy {
  const manifestPolicy = resolveManifestPapernexusPolicy(params.manifest);
  const policy = params.workflowPolicy ?? {};
  const policyAccessMode = normalizeStage(policy.papernexusAccessMode);
  const manifestAccessMode = normalizeStage(manifestPolicy.papernexusAccessMode);
  const papernexusAccessMode =
    policyAccessMode === "remote_mcp" || manifestAccessMode === "remote_mcp"
      ? "remote_mcp"
      : policyAccessMode ?? manifestAccessMode ?? policy.papernexusAccessMode ?? null;
  return {
    ...policy,
    papernexusAccessMode,
    papernexusSharedCorpus:
      policy.papernexusSharedCorpus ?? manifestPolicy.papernexusSharedCorpus ?? null,
    papernexusMcpUrl: policy.papernexusMcpUrl ?? manifestPolicy.papernexusMcpUrl ?? null,
    papernexusApiBaseUrl:
      policy.papernexusApiBaseUrl ?? manifestPolicy.papernexusApiBaseUrl ?? null,
  };
}

function isRemoteMcpDiscoveryConfigured(params: {
  workflowPolicy?: RemoteDiscoveryWorkflowPolicy | null;
}): boolean {
  const accessMode = normalizeStage(params.workflowPolicy?.papernexusAccessMode);
  if (accessMode === "local_mcp") {
    return false;
  }
  return accessMode === "remote_mcp";
}

function buildRemoteImportTaskSummary(params: {
  taskIds: string[];
  queueProgressPayload: Record<string, unknown> | null;
}): {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  remaining: number;
} {
  const total =
    getQueueProgressCount(params.queueProgressPayload, "total") || params.taskIds.length;
  const completed = getQueueProgressCount(params.queueProgressPayload, "completed");
  const failed = getQueueProgressCount(params.queueProgressPayload, "failed");
  const pending = getQueueProgressCount(params.queueProgressPayload, "pending");
  const running = getQueueProgressCount(params.queueProgressPayload, "running");
  const remaining =
    getQueueProgressRemaining(params.queueProgressPayload) ??
    Math.max(0, total - completed - failed);
  return {
    total,
    pending,
    running,
    completed,
    failed,
    remaining,
  };
}

function isRemoteSourceEntrySourceBacked(entry: Record<string, unknown>): boolean {
  const metadataGraphStatus = normalizeStage(
    pickString(entry, ["metadata_graph_status", "metadataGraphStatus"])
  );
  const sourceKind = normalizeStage(pickString(entry, ["source_kind", "sourceKind"]));
  const importStatus = normalizeStage(pickString(entry, ["import_status", "importStatus"]));
  return (
    metadataGraphStatus === "source_backed" ||
    sourceKind === "markdown" ||
    sourceKind === "pdf" ||
    Boolean(pickString(entry, ["source_path", "sourcePath"])) ||
    [
      "submitted",
      "running",
      "completed",
      "deduped",
      "indexed",
      "graph_synced",
      "already_present",
    ].includes(importStatus ?? "")
  );
}

function countRemoteSourceBackedEntries(entries: Record<string, unknown>[]): number {
  return entries.filter(isRemoteSourceEntrySourceBacked).length;
}

function buildLiteratureRequisitionDecisionFields(params: {
  requestStatus: "running" | "completed" | "needs_repair";
  queueProgressError?: string | null;
  firstError?: string | null;
  sourceBackedCount: number;
}): {
  status: "running" | "valid" | "failed";
  decision: string;
  reason: string;
  limitations: string[];
} {
  if (params.requestStatus === "running") {
    return {
      status: "running",
      decision: "waiting_remote_import_progress",
      reason: "PaperNexus remote import queue is still running.",
      limitations: [
        "Frontier, idea, and writing stages must wait until request-specific source/import-backed evidence is materialized.",
      ],
    };
  }
  if (params.requestStatus === "completed" && params.sourceBackedCount > 0) {
    return {
      status: "valid",
      decision: "satisfied_remote_import_evidence",
      reason:
        "Request-specific PaperNexus source/import-backed evidence was materialized into the local paper source index.",
      limitations: [
        "Graph visibility may still require a separate PaperNexus graph presence verification.",
      ],
    };
  }
  const reason =
    params.queueProgressError ??
    params.firstError ??
    "PaperNexus literature discovery did not produce request-specific source/import-backed evidence.";
  return {
    status: "failed",
    decision:
      params.sourceBackedCount > 0
        ? "needs_repair_remote_import_failed"
        : "needs_repair_missing_requisition_import_evidence",
    reason,
    limitations: [
      "Remote completion without source/import-backed local materialization is not enough to satisfy a workflow-owned literature requisition.",
    ],
  };
}

function buildRemoteDiscoveryPacketPaper(entry: Record<string, unknown>): Record<string, unknown> {
  return {
    canonical_id: pickString(entry, ["canonical_id", "canonicalId"]),
    title: pickString(entry, ["title"]),
    arxiv_id: pickString(entry, ["arxiv_id", "arxivId"]),
    doi: pickString(entry, ["doi"]),
    year: pickNumberValue(entry, ["year"]),
    venue: pickString(entry, ["venue"]),
    source_kind: pickString(entry, ["source_kind", "sourceKind"]),
    source_path: pickString(entry, ["source_path", "sourcePath"]),
    source_provider: pickString(entry, ["source_provider", "sourceProvider"]),
    resolution_status: pickString(entry, ["resolution_status", "resolutionStatus"]),
    import_status: pickString(entry, ["import_status", "importStatus"]),
    import_task_id: pickString(entry, ["import_task_id", "importTaskId"]),
    discovery_run_id: pickString(entry, ["discovery_run_id", "discoveryRunId"]),
    retrieval_providers: asStringArray(entry.retrieval_providers ?? entry.retrievalProviders),
    source_backed: isRemoteSourceEntrySourceBacked(entry),
    evidence_source: "papernexus_literature_discovery",
  };
}

async function writeRemoteLiteratureDiscoveryPacket(params: {
  projectRoot: string;
  requestId: string | null;
  triggerKind: string | null;
  run: Record<string, unknown>;
  sourceEntries: Record<string, unknown>[];
  artifactRelativePath: string;
  requestStatus: "running" | "completed" | "needs_repair";
  queueProgressPayload: Record<string, unknown> | null;
  now: string;
}): Promise<void> {
  const evidencePapers = params.sourceEntries
    .filter(isRemoteSourceEntrySourceBacked)
    .map(buildRemoteDiscoveryPacketPaper);
  const runId = pickString(params.run, ["runId", "run_id"]);
  await writeJsonAtomicEnsured(
    path.join(params.projectRoot, REMOTE_LITERATURE_DISCOVERY_PACKET_PATH),
    {
      schema_version: 1,
      discovery_id: params.requestId
        ? `${params.requestId}-papernexus-remote`
        : "papernexus-remote-literature-discovery",
      discovery_reason: "papernexus_remote_literature_discovery",
      trigger_kind: params.triggerKind ?? "papernexus_remote_literature_discovery",
      status:
        params.requestStatus === "completed"
          ? "completed"
          : params.requestStatus === "running"
            ? "running"
            : "needs_repair",
      target_question_ids: params.requestId ? [params.requestId] : [],
      target_domains: [],
      candidate_queries: [],
      candidate_papers: evidencePapers,
      selected_papers: evidencePapers,
      rejected_papers: [],
      remote_candidate_count: asRecordArray(params.run.candidates).length,
      source_backed_candidate_count: evidencePapers.length,
      metadata_only_candidate_count: Math.max(
        0,
        params.sourceEntries.length - evidencePapers.length
      ),
      evidence_gap_closed:
        params.requestStatus === "completed" && evidencePapers.length > 0,
      selection_rationale:
        evidencePapers.length > 0
          ? "PaperNexus literature_discovery returned request-specific source/import-backed candidates."
          : "PaperNexus literature_discovery did not return request-specific source/import-backed candidates.",
      next_action_suggestion:
        params.requestStatus === "running"
          ? "Wait for PaperNexus import_workflow queue_progress before crediting the requisition as terminal."
          : params.requestStatus === "completed"
            ? "Rerun graph_build/frontier/idea with the request-specific PaperNexus evidence."
            : "Repair PaperNexus literature discovery before downstream stages consume this requisition.",
      required_stage_reentry: ["graph_build", "frontier_mapping", "idea"],
      remote_literature_discovery: {
        request_id: params.requestId,
        run_id: runId,
        artifact_path: params.artifactRelativePath,
        queue_progress: params.queueProgressPayload,
      },
      source_contracts: {
        papernexus_remote_discovery: {
          artifact_path: params.artifactRelativePath,
          source_index_path: "researcher/PAPER_SOURCE_INDEX.json",
          selected_candidate_policy: "source_or_import_backed_only",
        },
      },
      trigger: "graph_build_source_catchup",
      last_updated_at: params.now,
      packet_id: `${sanitizeIdFragment(runId ?? params.requestId ?? "papernexus-remote")}-${createHash("sha256")
        .update(JSON.stringify(evidencePapers.map((paper) => paper.canonical_id)))
        .digest("hex")
        .slice(0, 12)}`,
    }
  );
}

async function writeRemoteDiscoveryGraphBuildReceipt(params: {
  projectRoot: string;
  requestId: string | null;
  runId?: string | null;
  sharedCorpus?: string | null;
  status: PapernexusGraphBuildReceiptStatus;
  graphVisibility?: "verified" | "unverified" | "unavailable";
  sourceEntries?: Record<string, unknown>[];
  taskIds?: string[];
  queueProgressPayload?: Record<string, unknown> | null;
  checkedAt: string;
  limitations?: string[];
  repairHints?: string[];
  requisitionSatisfactionReportPath?: string | null;
}): Promise<string> {
  const sourceEntries = params.sourceEntries ?? [];
  const sourceBackedEntries = sourceEntries.filter(isRemoteSourceEntrySourceBacked);
  const canonicalIds = uniqueStrings(
    sourceEntries
      .map((entry) => pickString(entry, ["canonical_id", "canonicalId"]))
      .filter((entry): entry is string => Boolean(entry))
  );
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(params.projectRoot, "PROJECT_MANIFEST.json")
    )) ?? null;
  const projectGraphReady =
    params.status !== "failed" &&
    params.status !== "source_blocked" &&
    sourceBackedEntries.length > 0 &&
    hasReadySourceBackedGraphCertification(manifest);
  const effectiveStatus: PapernexusGraphBuildReceiptStatus = projectGraphReady
    ? "graph_ready"
    : params.status;
  const effectiveGraphVisibility = projectGraphReady
    ? "verified"
    : params.graphVisibility ?? "unverified";
  const sourceBackedGraphClaim =
    projectGraphReady ||
    (effectiveStatus === "graph_ready" && effectiveGraphVisibility === "verified");
  const receiptPath = await writePapernexusGraphBuildReceipt({
    projectRoot: params.projectRoot,
    receipt: {
      schema_version: 1,
      request_id: params.requestId,
      run_id: params.runId ?? null,
      corpus: params.sharedCorpus ?? null,
      status: effectiveStatus,
      graph_visibility: effectiveGraphVisibility,
      graph_fingerprint: null,
      checked_at: params.checkedAt,
      canonical_ids_requested: canonicalIds,
      canonical_ids_in_graph: projectGraphReady ? canonicalIds : [],
      canonical_ids_missing: projectGraphReady ? [] : canonicalIds,
      source_backed_count: sourceBackedEntries.length,
      metadata_only_count: Math.max(0, sourceEntries.length - sourceBackedEntries.length),
      source_backed_graph_claim: sourceBackedGraphClaim,
      active_in_graph_sources: [],
      task_summary: buildRemoteImportTaskSummary({
        taskIds: params.taskIds ?? [],
        queueProgressPayload: params.queueProgressPayload ?? null,
      }),
      coverage: {
        min_required_satisfied: sourceBackedGraphClaim,
        min_source_backed_papers: Math.max(1, sourceEntries.length > 0 ? 1 : 0),
        notes: [
          projectGraphReady
            ? "Project graph presence certification is already source-backed; remote discovery evidence is request-specific and source-backed."
            : "Remote discovery/import receipt is not graph-ready until graph visibility is verified by PaperNexus.",
        ],
      },
      evidence_packet_path: null,
      limitations: params.limitations ?? [],
      repair_hints: params.repairHints ?? [],
    },
  });
  await writeGraphBuildDecision({
    projectRoot: params.projectRoot,
    decision:
      sourceBackedGraphClaim
        ? "complete"
        : effectiveStatus === "failed" || effectiveStatus === "source_blocked"
          ? "blocked"
          : "waiting",
    requestId: params.requestId ?? null,
    graphReceiptPath: receiptPath,
    sourceIndexPath:
      sourceEntries.length > 0 ? "researcher/PAPER_SOURCE_INDEX.json" : null,
    sourceBackedGraphClaim,
    requisitionSatisfactionReportPath:
      params.requisitionSatisfactionReportPath ?? null,
    reason:
      sourceBackedGraphClaim
        ? "PaperNexus graph visibility is verified for request-specific source-backed evidence."
        : effectiveStatus === "source_blocked"
          ? "PaperNexus remote discovery did not yet produce graph-visible source-backed evidence."
          : "PaperNexus remote discovery/import is not graph-ready yet.",
    limitations: params.limitations ?? [],
    now: params.checkedAt,
  });
  return receiptPath;
}

async function persistRemoteDiscoveryFailure(params: {
  projectRoot: string;
  reportPath: string;
  now: string;
  requestId: string;
  skippedReason: string;
  message: string;
  mcpUrl?: string | null;
  activeRequest?: NormalizedPaperIngestionQueuedRequest | null;
  topic?: string | null;
  seedPaperCount?: number | null;
  failureKind?: string | null;
  configuredTimeoutMs?: number | null;
}): Promise<GraphBuildSourceCatchupResult> {
  const result: GraphBuildSourceCatchupResult = {
    attempted: true,
    queued: false,
    skippedReason: params.skippedReason,
    sourceIndexPath: null,
    materializedPaperCount: 0,
    requestId: params.requestId,
    batchManifestPath: null,
    errors: [params.message],
    attempts: [
      buildFetchAttempt({
        provider: REMOTE_LITERATURE_DISCOVERY_PROVIDER,
        status: "failed",
        detail: params.message,
        at: params.now,
        url: params.mcpUrl ?? null,
      }),
    ],
  };
  await writeJsonAtomicEnsured(params.reportPath, {
    status: "failed",
    updated_at: params.now,
    remote_literature_discovery: {
      request_id: params.requestId,
      mcp_url: params.mcpUrl ?? null,
      topic: params.topic ?? null,
      seed_paper_count: params.seedPaperCount ?? null,
      failure_kind: params.failureKind ?? params.skippedReason,
      configured_timeout_ms: params.configuredTimeoutMs ?? null,
    },
    ...result,
  });
  const repairHints =
    params.failureKind === "remote_literature_discovery_launch_timeout"
      ? [
          `Increase ${REMOTE_DISCOVERY_MCP_TIMEOUT_ENV} or make PaperNexus literature_discovery return a resumable run/import handle before doing long provider/import work.`,
        ]
      : [
          "Repair the configured remote PaperNexus MCP access before rerunning graph-build.",
        ];
  await writeRemoteDiscoveryGraphBuildReceipt({
    projectRoot: params.projectRoot,
    requestId: params.requestId,
    status: "failed",
    graphVisibility: "unavailable",
    checkedAt: params.now,
    limitations: [params.message],
    repairHints,
    requisitionSatisfactionReportPath:
      params.activeRequest?.validationReportPath ?? null,
  });
  const requestPatch = params.activeRequest
    ? {
        queued_requests: [
          {
            request_id: params.activeRequest.requestId,
            status: "needs_repair",
            wrapper: params.activeRequest.wrapper ?? "papernexus_remote_mcp",
            args: params.activeRequest.args,
            command_text: params.activeRequest.commandText,
            manifest_path: params.activeRequest.manifestPath,
            summary: params.activeRequest.summary,
            detail: params.activeRequest.detail,
            trigger_kind: params.activeRequest.triggerKind,
            request_kind: params.activeRequest.requestKind,
            last_error: params.message,
            updated_at: params.now,
            last_attempt_at: params.now,
            attempt_count: params.activeRequest.attemptCount + 1,
            max_attempts: params.activeRequest.maxAttempts,
            validation_status: "invalid",
            validation_summary: params.message,
          },
        ],
      }
    : {};
  await setPaperIngestionState({
    projectRoot: params.projectRoot,
    paperIngestion: {
      runtime_status: "blocked",
      waiting_reason: "Remote PaperNexus literature discovery is unavailable.",
      repair_required: true,
      repair_reason: params.message,
      ...requestPatch,
      last_updated_at: params.now,
    },
  });
  return result;
}

async function readLiteratureDiscoveryRequisition(params: {
  projectRoot: string;
  request: NormalizedPaperIngestionQueuedRequest | null;
}): Promise<Record<string, unknown> | null> {
  if (!params.request?.manifestPath) {
    return null;
  }
  const resolved = path.isAbsolute(params.request.manifestPath)
    ? params.request.manifestPath
    : path.join(params.projectRoot, params.request.manifestPath);
  return (await readJsonIfExists<Record<string, unknown>>(resolved)) ?? null;
}

type RemoteLiteratureDiscoveryArtifact = {
  run: Record<string, unknown>;
  artifactPath: string;
  artifactRelativePath: string;
};

function readRemoteQueueProgressFromArtifact(
  artifact: Record<string, unknown>
): Record<string, unknown> | null {
  return (
    asRecord(artifact.remote_queue_progress) ??
    asRecord(asRecord(artifact.remote_literature_discovery)?.queue_progress) ??
    null
  );
}

function timestampScoreFromRemoteArtifact(artifact: Record<string, unknown>): number {
  const direct =
    pickString(artifact, [
      "last_polled_at",
      "updated_at",
      "updatedAt",
      "created_at",
      "createdAt",
    ]) ??
    pickString(asRecord(artifact.remote_literature_discovery) ?? {}, [
      "updated_at",
      "updatedAt",
    ]);
  const directMs = direct ? Date.parse(direct) : Number.NaN;
  if (Number.isFinite(directMs)) {
    return directMs;
  }
  const runId = pickString(artifact, ["runId", "run_id"]);
  const match = runId?.match(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{3})?Z/);
  if (!match) {
    return 0;
  }
  const normalized = match[0].replace(
    /T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z$/,
    (_whole, hour, minute, second, millis) =>
      `T${hour}:${minute}:${second}.${millis ?? "000"}Z`
  );
  const normalizedMs = Date.parse(normalized);
  return Number.isFinite(normalizedMs) ? normalizedMs : 0;
}

function scoreRemoteLiteratureDiscoveryArtifact(
  artifact: Record<string, unknown>
): number[] {
  const sourceEntries = buildSourceIndexEntriesFromRemoteDiscovery({
    run: artifact,
    now: "1970-01-01T00:00:00.000Z",
  });
  const sourceBackedCount = countRemoteSourceBackedEntries(sourceEntries);
  const queueProgress = readRemoteQueueProgressFromArtifact(artifact);
  const taskIds = collectRemoteImportTaskIds(artifact);
  const remaining = getGraphBlockingRemoteImportRemaining(queueProgress);
  const completed = getQueueProgressCount(queueProgress, "completed");
  const failed = getQueueProgressCount(queueProgress, "failed");
  const sequence =
    pickNumberValue(asRecord(queueProgress?.summary) ?? {}, ["sequence"]) ??
    pickNumberValue(queueProgress, ["sequence"]) ??
    0;
  const terminalRank =
    taskIds.length > 0 && remaining === 0
      ? sourceBackedCount > 0 || completed > 0
        ? 4
        : failed > 0
          ? 2
          : 3
      : remaining !== null && remaining > 0
        ? 1
        : 0;
  return [
    terminalRank,
    sourceBackedCount,
    completed,
    asRecordArray(artifact.candidates).length,
    sourceEntries.length,
    sequence,
    timestampScoreFromRemoteArtifact(artifact),
  ];
}

function compareRemoteLiteratureDiscoveryArtifactStrength(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): number {
  const leftScore = scoreRemoteLiteratureDiscoveryArtifact(left);
  const rightScore = scoreRemoteLiteratureDiscoveryArtifact(right);
  for (let index = 0; index < Math.max(leftScore.length, rightScore.length); index += 1) {
    const delta = (leftScore[index] ?? 0) - (rightScore[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

function resolveProjectArtifactReference(params: {
  projectRoot: string;
  artifactPath: string | null | undefined;
}): { artifactPath: string; artifactRelativePath: string } | null {
  const artifactPath = params.artifactPath?.trim();
  if (!artifactPath) {
    return null;
  }
  const resolvedPath = path.isAbsolute(artifactPath)
    ? artifactPath
    : path.join(params.projectRoot, artifactPath);
  return {
    artifactPath: resolvedPath,
    artifactRelativePath: path.isAbsolute(artifactPath)
      ? relativizeProjectPath(params.projectRoot, resolvedPath)
      : artifactPath,
  };
}

function remoteDiscoveryArtifactMatchesRequest(params: {
  artifact: Record<string, unknown>;
  request: NormalizedPaperIngestionQueuedRequest;
}): boolean {
  const nested = asRecord(params.artifact.remote_literature_discovery);
  const artifactRequestId =
    pickString(params.artifact, [
      "local_request_id",
      "localRequestId",
      "request_id",
      "requestId",
    ]) ??
    pickString(nested ?? {}, ["request_id", "requestId"]);
  return !artifactRequestId || artifactRequestId === params.request.requestId;
}

function collectRemoteDiscoveryArtifactReferences(params: {
  manifest: Record<string, unknown>;
  request: NormalizedPaperIngestionQueuedRequest;
}): string[] {
  const paperIngestion = asRecord(params.manifest.paper_ingestion);
  return uniqueStrings(
    [
      params.request.validationReportPath,
      params.request.manifestPath,
      pickString(paperIngestion ?? {}, [
        "last_batch_manifest_path",
        "lastBatchManifestPath",
      ]),
      pickString(paperIngestion ?? {}, [
        "validation_report_path",
        "validationReportPath",
      ]),
    ].filter((entry): entry is string => Boolean(entry && entry.trim()))
  );
}

function collectNestedRemoteDiscoveryArtifactReferences(
  artifact: Record<string, unknown>
): string[] {
  const nested = asRecord(artifact.remote_literature_discovery);
  return uniqueStrings(
    [
      pickString(nested ?? {}, ["artifact_path", "artifactPath"]),
      pickString(nested ?? {}, ["batch_manifest_path", "batchManifestPath"]),
      pickString(nested ?? {}, ["validation_report_path", "validationReportPath"]),
      pickString(artifact, ["artifact_path", "artifactPath"]),
      pickString(artifact, ["batch_manifest_path", "batchManifestPath"]),
    ].filter((entry): entry is string => Boolean(entry && entry.trim()))
  );
}

async function readRemoteLiteratureDiscoveryArtifact(params: {
  projectRoot: string;
  manifest: Record<string, unknown>;
  request: NormalizedPaperIngestionQueuedRequest | null;
}): Promise<RemoteLiteratureDiscoveryArtifact | null> {
  if (!params.request) {
    return null;
  }
  const pending = collectRemoteDiscoveryArtifactReferences({
    manifest: params.manifest,
    request: params.request,
  });
  const visited = new Set<string>();
  let bestArtifact: RemoteLiteratureDiscoveryArtifact | null = null;
  for (let index = 0; index < pending.length; index += 1) {
    const candidate = resolveProjectArtifactReference({
      projectRoot: params.projectRoot,
      artifactPath: pending[index],
    });
    if (!candidate || visited.has(candidate.artifactPath)) {
      continue;
    }
    visited.add(candidate.artifactPath);
    const artifact =
      (await readJsonIfExists<Record<string, unknown>>(candidate.artifactPath)) ?? null;
    if (!artifact) {
      continue;
    }
    for (const nestedPath of collectNestedRemoteDiscoveryArtifactReferences(artifact)) {
      if (!pending.includes(nestedPath)) {
        pending.push(nestedPath);
      }
    }
    if (
      !remoteDiscoveryArtifactMatchesRequest({
        artifact,
        request: params.request,
      })
    ) {
      continue;
    }
    if (collectRemoteImportTaskIds(artifact).length === 0) {
      continue;
    }
    const candidateArtifact = {
      run: artifact,
      artifactPath: candidate.artifactPath,
      artifactRelativePath: candidate.artifactRelativePath,
    };
    if (
      !bestArtifact ||
      compareRemoteLiteratureDiscoveryArtifactStrength(
        candidateArtifact.run,
        bestArtifact.run
      ) > 0
    ) {
      bestArtifact = candidateArtifact;
    }
  }
  return bestArtifact;
}

export async function needsRemoteLiteratureDiscoverySourceIndexRefresh(params: {
  projectRoot: string;
  manifest: Record<string, unknown>;
  request: NormalizedPaperIngestionQueuedRequest;
}): Promise<boolean> {
  const artifact = await readRemoteLiteratureDiscoveryArtifact({
    projectRoot: params.projectRoot,
    manifest: params.manifest,
    request: params.request,
  });
  if (!artifact) {
    return false;
  }
  const sourceEntries = buildSourceIndexEntriesFromRemoteDiscovery({
    run: artifact.run,
    now: "1970-01-01T00:00:00.000Z",
  });
  const expectedSourceBackedIds = new Set(
    sourceEntries
      .filter(isRemoteSourceEntrySourceBacked)
      .map((entry) => pickString(entry, ["canonical_id", "canonicalId"]))
      .filter((entry): entry is string => Boolean(entry))
  );
  if (expectedSourceBackedIds.size === 0) {
    return false;
  }
  const sourceIndexRaw = await readJsonIfExists<unknown>(
    resolvePaperSourceIndexPath(params.projectRoot)
  );
  const currentByCanonicalId = new Map<string, SourceIndexRawEntry>();
  for (const entry of collectSourceIndexEntries(sourceIndexRaw)) {
    currentByCanonicalId.set(entry.paper.canonicalId, entry);
  }
  for (const canonicalId of expectedSourceBackedIds) {
    const current = currentByCanonicalId.get(canonicalId);
    if (!current || !hasImportableSourceIndexEvidence(current)) {
      return true;
    }
  }
  return false;
}

function collectDiscoveryQueryTexts(packet: Record<string, unknown> | null): string[] {
  const discovery = asRecord(packet?.literature_discovery) ?? packet;
  const queries = Array.isArray(discovery?.candidate_queries)
    ? discovery?.candidate_queries
    : Array.isArray(discovery?.search_queries)
      ? discovery?.search_queries
      : [];
  return uniqueStrings(
    asRecordArray(queries)
      .map((entry) => {
        const domain = pickString(entry, ["domain", "target_domain", "targetDomain"]);
        const query = pickString(entry, ["query", "topic", "text"]);
        return query ? [domain, query].filter(Boolean).join(": ") : null;
      })
      .filter((entry): entry is string => Boolean(entry))
  );
}

function buildRemoteDiscoveryTopic(params: {
  manifest: Record<string, unknown>;
  requisition: Record<string, unknown> | null;
  sourceIndexRaw?: unknown;
}): string | null {
  const discovery = asRecord(params.requisition?.literature_discovery) ?? params.requisition;
  const queryTexts = collectDiscoveryQueryTexts(params.requisition);
  if (queryTexts.length > 0) {
    return queryTexts.join("\n");
  }
  const targetDomains = Array.isArray(discovery?.target_domains)
    ? discovery?.target_domains
    : Array.isArray(discovery?.missing_domains)
      ? discovery?.missing_domains
      : [];
  const requisitionParts = uniqueStrings(
    [
      pickString(discovery ?? {}, ["discovery_reason", "discoveryReason"]),
      pickString(discovery ?? {}, ["next_action_suggestion", "nextActionSuggestion"]),
      ...targetDomains.map((entry) => (typeof entry === "string" ? entry : "")),
    ].filter((entry): entry is string => Boolean(entry))
  );
  if (requisitionParts.length > 0) {
    return requisitionParts.join("\n");
  }
  const bootstrapTopic = collectManifestBootstrapTopicTexts(params.manifest)[0] ?? null;
  const sourceIndexTitles = collectSourceIndexEntries(params.sourceIndexRaw)
    .map((entry) => entry.paper.title)
    .filter((entry): entry is string => Boolean(entry && entry.trim()))
    .slice(0, 12);
  if (sourceIndexTitles.length > 0) {
    return [
      bootstrapTopic,
      "Use the supplied seed papers as graph-build context and resolve source-backed full-text papers remotely:",
      ...sourceIndexTitles.map((title) => `- ${title}`),
    ]
      .filter((entry): entry is string => Boolean(entry && entry.trim()))
      .join("\n");
  }
  return bootstrapTopic;
}

function isHttpUrl(value: string | null | undefined): boolean {
  return Boolean(value && /^https?:\/\//i.test(value.trim()));
}

function buildRemoteDiscoverySeedPapers(sourceIndexRaw: unknown): Record<string, unknown>[] {
  return collectSourceIndexEntries(sourceIndexRaw)
    .map((entry): Record<string, unknown> | null => {
      const markdownHints = uniqueStrings([
        pickString(entry.record, [
          "markdown_url",
          "markdownUrl",
          "best_markdown_url",
          "bestMarkdownUrl",
          "candidate_markdown_url",
          "candidateMarkdownUrl",
        ]),
        ...asStringArray(entry.record.markdown_urls ?? entry.record.markdownUrls),
        ...entry.paper.sourceHints.filter((hint) => /\.md(?:$|[?#])/i.test(hint)),
      ].filter((item): item is string => isHttpUrl(item)));
      const remoteHints = uniqueStrings([
        ...markdownHints,
        entry.paper.pdfUrl,
        entry.paper.bestOaUrl,
        pickString(entry.record, ["candidate_pdf_url", "candidatePdfUrl"]),
        ...entry.paper.sourceHints,
      ].filter((item): item is string => isHttpUrl(item)));
      const seed: Record<string, unknown> = {
        canonicalId: entry.paper.canonicalId,
        canonical_id: entry.paper.canonicalId,
        title: entry.paper.title,
        arxivId: entry.paper.arxivId,
        arxiv_id: entry.paper.arxivId,
        doi: entry.paper.doi,
        pmid: entry.paper.pmid,
        pmcid: entry.paper.pmcid,
        year: entry.paper.year,
        venue: entry.paper.venue,
        venueFamily: entry.paper.venueFamily,
        venue_family: entry.paper.venueFamily,
        citationCount: entry.paper.citationCount,
        citation_count: entry.paper.citationCount,
        pdfUrl: entry.paper.pdfUrl,
        pdf_url: entry.paper.pdfUrl,
        markdownUrl: markdownHints[0] ?? null,
        markdown_url: markdownHints[0] ?? null,
        markdownUrls: markdownHints,
        markdown_urls: markdownHints,
        bestOaUrl: entry.paper.bestOaUrl,
        best_oa_url: entry.paper.bestOaUrl,
        sourceHints: remoteHints,
        source_hints: remoteHints,
        retrievalProviders: entry.paper.retrievalProviders,
        retrieval_providers: entry.paper.retrievalProviders,
      };
      const compactSeed = Object.fromEntries(
        Object.entries(seed).filter(([, value]) => {
          if (Array.isArray(value)) {
            return value.length > 0;
          }
          return value !== null && value !== undefined && value !== "";
        })
      );
      return Object.keys(compactSeed).length > 0 ? compactSeed : null;
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .slice(0, MAX_REMOTE_DISCOVERY_SEED_PAPERS);
}

function buildRemoteDiscoveryArgs(params: {
  topic: string;
  sharedCorpus: string | null;
  seedPapers: Record<string, unknown>[];
  workflowPolicy?: {
    papernexusDiscoveryProviders?: string[] | string | null;
    papernexusDiscoveryMaxCandidates?: number | null;
    papernexusDiscoveryMaxDownloads?: number | null;
    papernexusDiscoveryMaxImported?: number | null;
    papernexusDiscoveryProcessImports?: boolean | null;
    papernexusDiscoveryImportMaxPasses?: number | null;
    papernexusDiscoveryMcpTimeoutMs?: number | null;
    papernexusDiscoveryRequestCache?: boolean | null;
    papernexusDiscoveryRequestCacheTtlMs?: number | null;
    papernexusProviderRequestSchedulerDelayMs?: number | null;
    papernexusProviderRequestMaxConcurrent?: number | null;
    papernexusOpenAlexRequestDelayMs?: number | null;
    papernexusOpenAlexMaxConcurrent?: number | null;
    papernexusSemanticScholarRequestDelayMs?: number | null;
    papernexusSemanticScholarMaxConcurrent?: number | null;
  } | null;
}): Record<string, unknown> {
  const mailto =
    process.env.PAPERNEXUS_DISCOVERY_MAILTO?.trim() ||
    process.env.UNPAYWALL_EMAIL?.trim() ||
    "";
  const providers = normalizeStringList(
    params.workflowPolicy?.papernexusDiscoveryProviders ??
      process.env.PAPERNEXUS_DISCOVERY_PROVIDERS
  );
  const processImports =
    normalizeBoolean(params.workflowPolicy?.papernexusDiscoveryProcessImports) ??
    normalizeBoolean(process.env.PAPERNEXUS_DISCOVERY_PROCESS_IMPORTS) ??
    true;
  const importMaxPasses =
    normalizePositiveInteger(params.workflowPolicy?.papernexusDiscoveryImportMaxPasses) ??
    normalizePositiveInteger(process.env.PAPERNEXUS_DISCOVERY_IMPORT_MAX_PASSES) ??
    DEFAULT_REMOTE_DISCOVERY_MAX_IMPORTED;
  const providerRequestSchedulerDelayMs =
    normalizePositiveInteger(params.workflowPolicy?.papernexusProviderRequestSchedulerDelayMs) ??
    normalizePositiveInteger(process.env.PAPERNEXUS_PROVIDER_REQUEST_SCHEDULER_DELAY_MS) ??
    250;
  const providerRequestMaxConcurrent =
    normalizePositiveInteger(params.workflowPolicy?.papernexusProviderRequestMaxConcurrent) ??
    normalizePositiveInteger(process.env.PAPERNEXUS_PROVIDER_REQUEST_MAX_CONCURRENT) ??
    2;
  const discoveryRequestCache =
    normalizeBoolean(params.workflowPolicy?.papernexusDiscoveryRequestCache) ??
    normalizeBoolean(process.env.PAPERNEXUS_DISCOVERY_REQUEST_CACHE) ??
    true;
  const discoveryRequestCacheTtlMs =
    normalizePositiveInteger(params.workflowPolicy?.papernexusDiscoveryRequestCacheTtlMs) ??
    normalizePositiveInteger(process.env.PAPERNEXUS_DISCOVERY_REQUEST_CACHE_TTL_MS) ??
    600_000;
  const seedCount = params.seedPapers.length;
  const maxSeedBound = Math.min(MAX_REMOTE_DISCOVERY_SEED_PAPERS, Math.max(0, seedCount));
  const maxCandidates = Math.max(
    normalizePositiveInteger(params.workflowPolicy?.papernexusDiscoveryMaxCandidates) ??
      normalizePositiveInteger(process.env[REMOTE_DISCOVERY_MAX_CANDIDATES_ENV]) ??
      DEFAULT_REMOTE_DISCOVERY_MAX_CANDIDATES,
    maxSeedBound
  );
  const maxDownloads = Math.max(
    normalizePositiveInteger(params.workflowPolicy?.papernexusDiscoveryMaxDownloads) ??
      normalizePositiveInteger(process.env[REMOTE_DISCOVERY_MAX_DOWNLOADS_ENV]) ??
      DEFAULT_REMOTE_DISCOVERY_MAX_DOWNLOADS,
    maxSeedBound
  );
  const maxImported = Math.max(
    normalizePositiveInteger(params.workflowPolicy?.papernexusDiscoveryMaxImported) ??
      normalizePositiveInteger(process.env[REMOTE_DISCOVERY_MAX_IMPORTED_ENV]) ??
      DEFAULT_REMOTE_DISCOVERY_MAX_IMPORTED,
    maxSeedBound
  );
  return {
    operation: processImports ? "ingest" : "import",
    topic: params.topic,
    corpus: params.sharedCorpus ?? "",
    depth: "default",
    maxCandidates,
    maxDownloads,
    resolveSources: true,
    preferMarkdown: true,
    generateArxivMarkdownSources: true,
    importResolved: true,
    processImports,
    importMaxPasses,
    maxImported,
    allowDownloads: true,
    persist: true,
    providerRequestSchedulerDelayMs,
    providerRequestMaxConcurrent,
    discoveryRequestCache,
    discoveryRequestCacheTtlMs,
    openAlexRequestDelayMs:
      normalizePositiveInteger(params.workflowPolicy?.papernexusOpenAlexRequestDelayMs) ??
      normalizePositiveInteger(process.env.PAPERNEXUS_OPENALEX_REQUEST_DELAY_MS) ??
      250,
    openAlexMaxConcurrent:
      normalizePositiveInteger(params.workflowPolicy?.papernexusOpenAlexMaxConcurrent) ??
      normalizePositiveInteger(process.env.PAPERNEXUS_OPENALEX_MAX_CONCURRENT) ??
      2,
    semanticScholarRequestDelayMs:
      normalizePositiveInteger(params.workflowPolicy?.papernexusSemanticScholarRequestDelayMs) ??
      normalizePositiveInteger(process.env.PAPERNEXUS_SEMANTIC_SCHOLAR_REQUEST_DELAY_MS) ??
      1000,
    semanticScholarMaxConcurrent:
      normalizePositiveInteger(params.workflowPolicy?.papernexusSemanticScholarMaxConcurrent) ??
      normalizePositiveInteger(process.env.PAPERNEXUS_SEMANTIC_SCHOLAR_MAX_CONCURRENT) ??
      1,
    ...(providers.length > 0 ? { providers } : {}),
    ...(params.seedPapers.length > 0 ? { seedPapers: params.seedPapers } : {}),
    ...(mailto ? { mailto } : {}),
  };
}

function buildSourceIndexEntriesFromRemoteDiscovery(params: {
  run: Record<string, unknown>;
  now: string;
}): Record<string, unknown>[] {
  return asRecordArray(params.run.candidates)
    .map((candidate): Record<string, unknown> | null => {
      const source = asRecord(candidate.source) ?? {};
      const importRecord = asRecord(candidate.import) ?? {};
      const identifiers = asRecord(candidate.identifiers) ?? {};
      const sourcePath =
        pickString(source, [
          "sourcePath",
          "source_path",
          "localMarkdownPath",
          "local_markdown_path",
          "localMdPath",
          "local_md_path",
          "localPdfPath",
          "local_pdf_path",
        ]) ??
        null;
      const markdownUrl =
        pickString(source, ["markdownUrl", "markdown_url"]) ??
        pickString(candidate, [
          "markdownUrl",
          "markdown_url",
          "bestMarkdownUrl",
          "best_markdown_url",
        ]);
      const pdfUrl =
        pickString(source, ["pdfUrl", "pdf_url"]) ??
        pickString(candidate, ["pdfUrl", "pdf_url", "bestOaUrl", "best_oa_url"]);
      const arxivId =
        normalizeArxivId(pickString(identifiers, ["arxivId", "arxiv_id", "arxiv"])) ??
        normalizeArxivId(pickString(candidate, ["canonicalId", "canonical_id", "id"]));
      const doi =
        pickString(identifiers, ["doi"]) ?? pickString(candidate, ["doi"]) ?? null;
      const canonicalId =
        pickString(candidate, ["canonicalId", "canonical_id", "id"]) ??
        (arxivId ? `arxiv:${arxivId}` : null) ??
        (doi ? `doi:${doi}` : null);
      const title = pickString(candidate, ["title", "paper_title", "paperTitle"]);
      if (!canonicalId && !title) {
        return null;
      }
      const providers = uniqueStrings([
        ...asStringArray(candidate.providers),
        pickString(source, ["sourceProvider", "source_provider"]),
        REMOTE_LITERATURE_DISCOVERY_PROVIDER,
      ].filter((entry): entry is string => Boolean(entry)));
      const rawSourceKind =
        pickString(source, ["sourceKind", "source_kind"])?.trim().toLowerCase() ??
        "";
      const normalizedSourceKind =
        rawSourceKind === "md" ? "markdown" : rawSourceKind;
      const importStatus = pickString(importRecord, ["status"]) ?? "discovered";
      const importTaskId = pickString(importRecord, ["taskId", "task_id"]);
      const normalizedImportStatus = importStatus.trim().toLowerCase();
      const hasSourceBackedPayload =
        Boolean(sourcePath) ||
        normalizedSourceKind === "markdown" ||
        normalizedSourceKind === "pdf";
      const hasSubmittedImport =
        Boolean(importTaskId) ||
        [
          "submitted",
          "running",
          "completed",
          "deduped",
          "indexed",
          "graph_synced",
          "already_present",
        ].includes(normalizedImportStatus);
      const sourceKind = hasSourceBackedPayload
        ? normalizedSourceKind === "markdown" || normalizedSourceKind === "pdf"
          ? normalizedSourceKind
          : inferSourceKindFromPath(sourcePath) ?? "unknown"
        : "metadata_only";
      const rawResolutionStatus =
        pickString(source, ["resolutionStatus", "resolution_status"]) ??
        pickString(source, ["fullTextStatus", "full_text_status"]);
      const resolutionStatus = hasSourceBackedPayload || hasSubmittedImport
        ? rawResolutionStatus ??
          (sourceKind === "markdown"
            ? "resolved_markdown"
            : sourceKind === "pdf"
              ? "resolved_pdf"
              : "unknown")
        : "metadata_only_unresolved";
      const supplementation =
        asRecord(source.supplementation) ??
        (hasSourceBackedPayload
          ? null
          : {
              status: "needed",
              tool: "literature_discovery",
              reservedOperation: "supplement",
              acceptedSourceKinds: ["markdown", "pdf"],
              preferredSourceKind: "markdown",
              matchFields: ["candidateId", "canonicalId", "title", "doi", "arxivId"],
              acceptedInputs: {
                sourcePath: null,
                markdownUrl: markdownUrl ?? null,
                pdfUrl: pdfUrl ?? null,
                paperMetadata: {
                  title,
                  doi,
                  arxivId,
                },
              },
            });
      const entry: Record<string, unknown> = {
        canonical_id: canonicalId,
        title,
        arxiv_id: arxivId,
        doi,
        year: pickNumberValue(candidate, ["year", "publication_year", "publicationYear"]),
        venue: pickString(candidate, ["venue"]),
        source_kind: sourceKind,
        source_kind_detail: rawSourceKind || sourceKind,
        source_provider:
          pickString(source, ["sourceProvider", "source_provider"]) ??
          providers[0] ??
          "papernexus-literature-discovery",
        source_path: sourcePath,
        ...(hasSourceBackedPayload || hasSubmittedImport
          ? {
              markdown_url: markdownUrl,
              pdf_url: pdfUrl,
              best_oa_url: pickString(candidate, ["bestOaUrl", "best_oa_url"]),
            }
          : {
              candidate_markdown_url: markdownUrl,
              candidate_pdf_url: pdfUrl,
            }),
        retrieval_providers: providers,
        resolution_status: resolutionStatus,
        full_text_status: pickString(source, ["fullTextStatus", "full_text_status"]),
        download_status: pickString(source, ["downloadStatus", "download_status"]),
        metadata_graph_status:
          hasSourceBackedPayload || hasSubmittedImport ? "source_backed" : "partial",
        supplementation,
        import_status: importStatus,
        import_task_id: importTaskId,
        discovered_at: params.now,
        discovery_run_id: pickString(params.run, ["runId", "run_id"]),
        resolution_attempts: [
          buildFetchAttempt({
            provider: REMOTE_LITERATURE_DISCOVERY_PROVIDER,
            status: hasSourceBackedPayload || hasSubmittedImport ? "success" : "skipped",
            detail:
              hasSourceBackedPayload || hasSubmittedImport
                ? "PaperNexus literature_discovery returned source-backed or import-backed evidence."
                : "PaperNexus literature_discovery preserved a metadata-only candidate; use operation=supplement when Markdown/PDF evidence becomes available.",
            at: params.now,
            url: markdownUrl ?? pdfUrl ?? null,
          }),
        ],
      };
      return entry;
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function collectRemoteImportTaskIds(run: Record<string, unknown>): string[] {
  const importSummary = asRecord(run.importSummary ?? run.import_summary);
  return uniqueStrings(
    [
      ...asStringArray(run.remote_task_ids ?? run.remoteTaskIds),
      ...asRecordArray(importSummary?.results)
        .map((entry) => pickString(entry, ["taskId", "task_id"])),
      ...asRecordArray(run.candidates)
        .map((candidate) =>
          pickString(asRecord(candidate.import) ?? {}, ["taskId", "task_id"])
        ),
    ]
      .filter((entry): entry is string => Boolean(entry))
  );
}

function summarizeRemoteImportResults(run: Record<string, unknown>): {
  submitted: number;
  deduped: number;
  failed: number;
} {
  const importSummary = asRecord(run.importSummary ?? run.import_summary);
  return {
    submitted: Math.max(0, Math.floor(pickNumberValue(importSummary, ["submitted"]) ?? 0)),
    deduped: Math.max(0, Math.floor(pickNumberValue(importSummary, ["deduped"]) ?? 0)),
    failed: Math.max(0, Math.floor(pickNumberValue(importSummary, ["failed"]) ?? 0)),
  };
}

function summarizeRemoteMetadataGraph(run: Record<string, unknown>): {
  partialPaperCount: number;
  nodeCount: number;
} {
  const metadataGraph = asRecord(run.metadataGraph ?? run.metadata_graph);
  return {
    partialPaperCount: Math.max(
      0,
      Math.floor(pickNumberValue(metadataGraph, ["partialPaperCount", "partial_paper_count"]) ?? 0)
    ),
    nodeCount: Array.isArray(metadataGraph?.nodes) ? metadataGraph.nodes.length : 0,
  };
}

async function fetchRemoteImportQueueProgress(params: {
  clientConfig: PapernexusMcpClientConfig;
  taskIds: string[];
}): Promise<RemoteImportQueueProgressResult> {
  if (params.taskIds.length === 0) {
    return { payload: null, error: null };
  }
  const result = await callPapernexusMcpTool(params.clientConfig, "import_workflow", {
    operation: "queue_progress",
    taskIds: params.taskIds,
  });
  if (!result.ok) {
    return {
      payload: null,
      error: result.error ?? "PaperNexus import_workflow queue_progress failed.",
    };
  }
  return { payload: parseMcpToolJsonPayload(result.data), error: null };
}

function getQueueProgressRemaining(queueProgressPayload: Record<string, unknown> | null): number | null {
  const summary = asRecord(queueProgressPayload?.summary);
  return pickNumberValue(summary, ["remaining"]);
}

function isRemoteImportTaskGraphBlocking(task: Record<string, unknown>): boolean {
  const status = normalizeStage(pickString(task, ["status"]));
  if (
    ![
      "pending",
      "queued",
      "running",
      "processing",
      "submitted",
    ].includes(status ?? "")
  ) {
    return false;
  }
  if (task.includeInGraph === false || task.include_in_graph === false) {
    return false;
  }
  return true;
}

function getGraphBlockingRemoteImportRemaining(
  queueProgressPayload: Record<string, unknown> | null
): number | null {
  const tasks = asRecordArray(queueProgressPayload?.tasks);
  if (tasks.length > 0) {
    return tasks.filter(isRemoteImportTaskGraphBlocking).length;
  }
  return getQueueProgressRemaining(queueProgressPayload);
}

function getQueueProgressCount(
  queueProgressPayload: Record<string, unknown> | null,
  key: string
): number {
  const summary = asRecord(queueProgressPayload?.summary);
  const explicit = pickNumberValue(summary, [key]);
  if (explicit !== null) {
    return Math.max(0, Math.floor(explicit));
  }
  const normalizedKey = normalizeStage(key);
  return asRecordArray(queueProgressPayload?.tasks).filter(
    (task) => normalizeStage(pickString(task, ["status"])) === normalizedKey
  ).length;
}

function normalizeRemoteQueueProgressForPaperIngestion(
  queueProgressPayload: Record<string, unknown> | null
): Record<string, unknown> | null {
  const summary = asRecord(queueProgressPayload?.summary);
  const tasks = asRecordArray(queueProgressPayload?.tasks);
  const total =
    pickNumberValue(summary, ["total"]) ??
    pickNumberValue(queueProgressPayload, ["total"]) ??
    (tasks.length > 0 ? tasks.length : null);
  const completed = getQueueProgressCount(queueProgressPayload, "completed");
  const failed = getQueueProgressCount(queueProgressPayload, "failed");
  const running = getQueueProgressCount(queueProgressPayload, "running");
  const pending = getQueueProgressCount(queueProgressPayload, "pending");
  const remaining = getQueueProgressRemaining(queueProgressPayload);
  const overallPercent =
    pickNumberValue(summary, ["overall_percent", "overallPercent", "percent"]) ??
    pickNumberValue(queueProgressPayload, [
      "overall_percent",
      "overallPercent",
      "percent",
    ]);
  const sequence =
    pickNumberValue(summary, ["sequence"]) ??
    pickNumberValue(queueProgressPayload, ["sequence"]);
  const lastEventAt =
    pickString(summary ?? {}, ["last_event_at", "lastEventAt", "updated_at", "updatedAt"]) ??
    pickString(queueProgressPayload ?? {}, [
      "last_event_at",
      "lastEventAt",
      "updated_at",
      "updatedAt",
    ]);
  if (
    total === null &&
    remaining === null &&
    overallPercent === null &&
    sequence === null &&
    !lastEventAt &&
    completed === 0 &&
    failed === 0 &&
    running === 0 &&
    pending === 0
  ) {
    return null;
  }
  return {
    sequence: sequence === null ? null : Math.max(0, Math.floor(sequence)),
    last_event_at: lastEventAt,
    total: total === null ? null : Math.max(0, Math.floor(total)),
    pending,
    running,
    completed,
    failed,
    remaining: remaining === null ? null : Math.max(0, Math.floor(remaining)),
    overall_percent:
      overallPercent === null
        ? null
        : Math.max(0, Math.min(100, Math.round(overallPercent))),
  };
}

function getQueueProgressFirstError(
  queueProgressPayload: Record<string, unknown> | null
): string | null {
  for (const task of asRecordArray(queueProgressPayload?.tasks)) {
    const error = task.error;
    if (typeof error === "string" && error.trim()) {
      return error.trim();
    }
    const errorRecord = asRecord(error);
    const message = pickString(errorRecord ?? {}, ["message", "detail", "error"]);
    if (message) {
      return message;
    }
  }
  return null;
}

function renderRemoteDiscoveryReport(params: {
  run: Record<string, unknown>;
  sourceEntryCount: number;
  taskIds: string[];
  requestStatus: string;
  queueProgressPayload: Record<string, unknown> | null;
}): string {
  const coverage = asRecord(params.run.coverage) ?? {};
  const metadataGraph = summarizeRemoteMetadataGraph(params.run);
  return [
    "# PaperNexus Literature Discovery",
    "",
    `Run ID: ${pickString(params.run, ["runId", "run_id"]) ?? "unknown"}`,
    `Topic: ${pickString(params.run, ["topic"]) ?? "unknown"}`,
    `Verdict: ${pickString(coverage, ["verdict"]) ?? "unknown"}`,
    `Request Status: ${params.requestStatus}`,
    `Candidates: ${pickNumberValue(coverage, ["mergedPaperCount", "merged_paper_count"]) ?? params.sourceEntryCount}`,
    `Resolved Full Text: ${pickNumberValue(coverage, ["resolvedFullTextCount", "resolved_full_text_count"]) ?? 0}`,
    `Metadata-only Candidates: ${pickNumberValue(coverage, ["metadataOnlyCount", "metadata_only_count"]) ?? metadataGraph.partialPaperCount}`,
    `Metadata Graph Nodes: ${metadataGraph.nodeCount}`,
    `Imported: ${pickNumberValue(coverage, ["importedCount", "imported_count"]) ?? 0}`,
    `Remote Task IDs: ${params.taskIds.length > 0 ? params.taskIds.join(", ") : "none"}`,
    `Queue Remaining: ${getQueueProgressRemaining(params.queueProgressPayload) ?? "unknown"}`,
    "",
    "Metadata-only candidates are coverage/search-direction records. They need literature_discovery operation=supplement with Markdown/PDF evidence before supporting manuscript claims or result figures.",
    "",
  ].join("\n");
}

async function refreshExistingRemoteLiteratureDiscovery(params: {
  projectRoot: string;
  manifest: Record<string, unknown>;
  workflowPolicy?: {
    papernexusMcpUrl?: string | null;
  } | null;
  request: NormalizedPaperIngestionQueuedRequest;
  run: Record<string, unknown>;
  artifactPath: string;
  artifactRelativePath: string;
  reportPath: string;
  clientConfig: PapernexusMcpClientConfig;
  sharedCorpus: string | null;
  dropMetadataOnlyEntries?: boolean;
  now: string;
}): Promise<GraphBuildSourceCatchupResult> {
  const taskIds = collectRemoteImportTaskIds(params.run);
  const queueProgressPayload = await fetchRemoteImportQueueProgress({
    clientConfig: params.clientConfig,
    taskIds,
  });
  const queueProgressError = queueProgressPayload.error;
  const remaining = getGraphBlockingRemoteImportRemaining(queueProgressPayload.payload);
  const completedCount = getQueueProgressCount(queueProgressPayload.payload, "completed");
  const failedCount = getQueueProgressCount(queueProgressPayload.payload, "failed");
  const hasRemoteImportWork = taskIds.length > 0;
  const sourceEntries = buildSourceIndexEntriesFromRemoteDiscovery({
    run: params.run,
    now: params.now,
  });
  const sourceBackedCount = countRemoteSourceBackedEntries(sourceEntries);
  const requestStatus =
    queueProgressError
      ? "needs_repair"
      : sourceBackedCount === 0
        ? "needs_repair"
      : hasRemoteImportWork && remaining !== null && remaining > 0
      ? "running"
      : failedCount > 0 && completedCount === 0
        ? "needs_repair"
        : "completed";
  const runtimeStatus =
    requestStatus === "running"
      ? "waiting_import"
      : requestStatus === "completed"
        ? "waiting_graph"
        : "blocked";
  const metadataGraphSummary = summarizeRemoteMetadataGraph(params.run);
  if (sourceEntries.length > 0) {
    await replaceRemoteLiteratureDiscoverySourceIndexEntries({
      projectRoot: params.projectRoot,
      entries: sourceEntries,
      dropMetadataOnlyEntries: params.dropMetadataOnlyEntries,
    });
  }
  const runId = pickString(params.run, ["runId", "run_id"]);
  const firstError =
    queueProgressError ?? getQueueProgressFirstError(queueProgressPayload.payload);
  const completedPapers =
    requestStatus === "completed"
      ? sourceEntries.map((entry) => ({
          canonical_id: pickString(entry, ["canonical_id", "canonicalId"]),
          title: pickString(entry, ["title"]),
          import_task_id: pickString(entry, ["import_task_id", "importTaskId"]),
        }))
      : [];

  await writeJsonAtomicEnsured(params.artifactPath, {
    ...params.run,
    remote_task_ids: taskIds,
    remote_queue_progress: queueProgressPayload.payload,
    remote_queue_progress_error: queueProgressError,
    local_metadata_graph_summary: metadataGraphSummary,
    local_request_id: params.request.requestId,
    last_polled_at: params.now,
  });
  await writeRemoteLiteratureDiscoveryPacket({
    projectRoot: params.projectRoot,
    requestId: params.request.requestId,
    triggerKind: params.request.triggerKind,
    run: params.run,
    sourceEntries,
    artifactRelativePath: params.artifactRelativePath,
    requestStatus,
    queueProgressPayload: queueProgressPayload.payload,
    now: params.now,
  });
  const decision = buildLiteratureRequisitionDecisionFields({
    requestStatus,
    queueProgressError,
    firstError,
    sourceBackedCount,
  });
  const satisfactionReportPath = await writeLiteratureRequisitionDecisionReport({
    projectRoot: params.projectRoot,
    requestId: params.request.requestId,
    manifestPath: params.request.manifestPath,
    triggerKind: params.request.triggerKind,
    status: decision.status,
    decision: decision.decision,
    reason: decision.reason,
    limitations: decision.limitations,
    now: params.now,
    generation: params.request.attemptCount,
    remoteRunId: runId,
    remoteArtifactPath: params.artifactRelativePath,
    sharedCorpus: params.sharedCorpus,
    mcpUrl: params.workflowPolicy?.papernexusMcpUrl ?? null,
    importTaskIds: taskIds,
    queueProgress: queueProgressPayload.payload,
    queueProgressError,
    candidatePaperCount: sourceEntries.length,
    selectedPaperCount: sourceBackedCount,
    sourceBackedCount,
    metadataOnlyCount: Math.max(0, sourceEntries.length - sourceBackedCount),
    evidenceGapClosed: requestStatus === "completed" && sourceBackedCount > 0,
    citedEvidence: {
      source_index_path:
        sourceEntries.length > 0
          ? relativizeProjectPath(
              params.projectRoot,
              resolvePaperSourceIndexPath(params.projectRoot)
            )
          : null,
      graph_build_source_catchup_report_path: relativizeProjectPath(
        params.projectRoot,
        params.reportPath
      ),
    },
  });

  await writeRemoteDiscoveryGraphBuildReceipt({
    projectRoot: params.projectRoot,
    requestId: params.request.requestId,
    runId,
    sharedCorpus: params.sharedCorpus,
    status:
      requestStatus === "running"
        ? "waiting_import"
        : requestStatus === "completed"
          ? "waiting_graph_commit"
          : queueProgressError
            ? "failed"
            : "source_blocked",
    graphVisibility: requestStatus === "needs_repair" ? "unavailable" : "unverified",
    sourceEntries,
    taskIds,
    queueProgressPayload: queueProgressPayload.payload,
    checkedAt: params.now,
    limitations:
      requestStatus === "completed"
        ? ["Import queue is terminal; graph visibility still requires PaperNexus graph presence verification."]
        : requestStatus === "running"
          ? ["Import queue is still running; frontier, idea, and writing stages must wait."]
          : [firstError ?? "PaperNexus import queue failed."],
    repairHints:
      requestStatus === "needs_repair"
        ? ["Inspect PaperNexus import_workflow queue_progress and repair failed imports."]
        : [],
    requisitionSatisfactionReportPath: satisfactionReportPath,
  });

  await setPaperIngestionState({
    projectRoot: params.projectRoot,
    paperIngestion: {
      runtime_status: runtimeStatus,
      waiting_reason:
        requestStatus === "running"
          ? "PaperNexus remote literature discovery imports are still running."
          : requestStatus === "completed"
            ? "PaperNexus remote literature discovery imports reached a terminal state; waiting for graph presence verification."
            : "PaperNexus remote literature discovery imports failed before graph materialization.",
      import_task_ids: taskIds,
      completed_papers: completedPapers,
      repair_required: requestStatus === "needs_repair",
      repair_reason:
        requestStatus === "needs_repair"
          ? firstError ?? "PaperNexus remote literature discovery imports failed."
          : null,
      repair_target_corpus:
        requestStatus === "needs_repair" ? params.sharedCorpus : null,
      queued_requests: [
        {
          request_id: params.request.requestId,
          status: requestStatus,
          wrapper: params.request.wrapper ?? "papernexus_remote_mcp",
          args: params.request.args,
          command_text: params.request.commandText,
          manifest_path: params.request.manifestPath,
          shared_corpus: params.sharedCorpus,
          paper_count: sourceEntries.length || params.request.paperCount,
          summary: params.request.summary,
          detail: params.request.detail,
          trigger_kind: params.request.triggerKind,
          request_kind: params.request.requestKind,
          created_at: params.request.createdAt,
          updated_at: params.now,
          started_at: params.request.startedAt,
          finished_at: requestStatus === "running" ? null : params.now,
          last_run_id: runId ?? params.request.lastRunId,
          last_session_key: "papernexus:remote_mcp:literature_discovery",
          last_error: requestStatus === "needs_repair" ? firstError : null,
          validation_status:
            requestStatus === "needs_repair" ? "invalid" : "valid",
          validation_summary:
            requestStatus === "needs_repair"
              ? decision.reason
              : "PaperNexus import queue progress was refreshed without resubmitting discovery.",
          validation_report_path: satisfactionReportPath,
          queue_progress: normalizeRemoteQueueProgressForPaperIngestion(
            queueProgressPayload.payload
          ),
          attempt_count: params.request.attemptCount,
          last_attempt_at: params.request.lastAttemptAt,
          max_attempts: params.request.maxAttempts,
        },
      ],
      last_batch_manifest_path: params.artifactRelativePath,
      last_updated_at: params.now,
    },
  });

  const result: GraphBuildSourceCatchupResult = {
    attempted: true,
    queued: requestStatus === "running",
    skippedReason:
      requestStatus === "running"
        ? null
        : requestStatus === "completed"
          ? "remote_literature_discovery_imports_terminal"
          : "remote_literature_discovery_imports_failed",
    sourceIndexPath: sourceEntries.length > 0
      ? resolvePaperSourceIndexPath(params.projectRoot)
      : null,
    materializedPaperCount: sourceEntries.length,
    requestId: params.request.requestId,
    batchManifestPath: params.artifactRelativePath,
    errors: requestStatus === "needs_repair" ? [firstError ?? "PaperNexus import queue failed."] : [],
    attempts: [
      buildFetchAttempt({
        provider: "papernexus-literature-discovery",
        status: requestStatus === "needs_repair" ? "failed" : "success",
        detail:
          requestStatus === "running"
          ? `Remote discovery run ${runId ?? params.request.requestId} still has ${remaining ?? "unknown"} graph-blocking import task(s) remaining.`
            : requestStatus === "completed"
              ? `Remote discovery run ${runId ?? params.request.requestId} has no graph-blocking import work remaining.`
              : firstError ?? "PaperNexus import queue failed.",
        at: params.now,
        url: params.workflowPolicy?.papernexusMcpUrl ?? null,
      }),
    ],
  };
  await writeJsonAtomicEnsured(params.reportPath, {
    status:
      requestStatus === "running"
        ? "queued"
        : requestStatus === "completed"
          ? "completed"
          : "failed",
    updated_at: params.now,
    remote_literature_discovery: {
      request_id: params.request.requestId,
      run_id: runId,
      mcp_url: params.workflowPolicy?.papernexusMcpUrl,
      shared_corpus: params.sharedCorpus,
      artifact_path: params.artifactRelativePath,
      import_task_ids: taskIds,
      metadata_graph: metadataGraphSummary,
      queue_progress: queueProgressPayload.payload,
      queue_progress_error: queueProgressError,
    },
    ...result,
  });
  return result;
}

async function maybeRunRemoteLiteratureDiscovery(params: {
  projectRoot: string;
  projectId: string | null;
  manifest: Record<string, unknown>;
  workflowPolicy?: {
    papernexusAccessMode?: string | null;
    papernexusSharedCorpus?: string | null;
    papernexusMcpUrl?: string | null;
    papernexusApiBaseUrl?: string | null;
    papernexusMcpTransport?: string | null;
    papernexusMcpTimeoutMs?: number | null;
    papernexusApiTokenSource?: string | null;
    papernexusApiTokenEnv?: string | null;
    papernexusApiTokenService?: string | null;
    papernexusApiTokenAccount?: string | null;
    papernexusApiTokenLookupTimeoutMs?: number | null;
    papernexusAllowLocalMcp?: boolean | null;
    papernexusMineruHttpUrl?: string | null;
    papernexusSshTarget?: string | null;
    papernexusRemoteStagingRoot?: string | null;
    papernexusDiscoveryProviders?: string[] | string | null;
    papernexusDiscoveryMaxCandidates?: number | null;
    papernexusDiscoveryMaxDownloads?: number | null;
    papernexusDiscoveryMaxImported?: number | null;
    papernexusDiscoveryProcessImports?: boolean | null;
    papernexusDiscoveryImportMaxPasses?: number | null;
    papernexusDiscoveryRequestCache?: boolean | null;
    papernexusDiscoveryRequestCacheTtlMs?: number | null;
    papernexusProviderRequestSchedulerDelayMs?: number | null;
    papernexusProviderRequestMaxConcurrent?: number | null;
    papernexusOpenAlexRequestDelayMs?: number | null;
    papernexusOpenAlexMaxConcurrent?: number | null;
    papernexusSemanticScholarRequestDelayMs?: number | null;
    papernexusSemanticScholarMaxConcurrent?: number | null;
  } | null;
  sourceIndexRaw: unknown;
  reportPath: string;
  now: string;
}): Promise<GraphBuildSourceCatchupResult | null> {
  const activeRequest = findActiveLiteratureDiscoveryRequest(params.manifest);
  const refreshableRequest =
    activeRequest ?? findRefreshableLiteratureDiscoveryRequest(params.manifest);
  const seedPapers = buildRemoteDiscoverySeedPapers(params.sourceIndexRaw);
  if (!isRemoteMcpDiscoveryConfigured({ workflowPolicy: params.workflowPolicy })) {
    return null;
  }
  if (!refreshableRequest && hasActiveNonLiteraturePaperIngestionRequest(params.manifest)) {
    return null;
  }

  const requestId =
    activeRequest?.requestId ??
    `remote-literature-discovery-${sanitizeIdFragment(params.projectId ?? path.basename(params.projectRoot))}`;
  if (!params.workflowPolicy?.papernexusMcpUrl) {
    return persistRemoteDiscoveryFailure({
      projectRoot: params.projectRoot,
      reportPath: params.reportPath,
      now: params.now,
      requestId,
      skippedReason: "remote_papernexus_mcp_unconfigured",
      message: "Remote PaperNexus MCP URL is not configured.",
      mcpUrl: null,
      activeRequest,
      seedPaperCount: seedPapers.length,
    });
  }

  const client = await resolveRemoteDiscoveryClient({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    manifest: params.manifest,
    workflowPolicy: params.workflowPolicy,
  });
  if (!client) {
    return persistRemoteDiscoveryFailure({
      projectRoot: params.projectRoot,
      reportPath: params.reportPath,
      now: params.now,
      requestId,
      skippedReason: "remote_papernexus_mcp_unavailable",
      message:
        "Remote PaperNexus MCP client could not be resolved. Check papernexusMcpUrl and mcp transport configuration.",
      mcpUrl: params.workflowPolicy.papernexusMcpUrl,
      activeRequest,
      seedPaperCount: seedPapers.length,
    });
  }
  const requisition = await readLiteratureDiscoveryRequisition({
    projectRoot: params.projectRoot,
    request: refreshableRequest,
  });
  const existingRemoteArtifact = await readRemoteLiteratureDiscoveryArtifact({
    projectRoot: params.projectRoot,
    manifest: params.manifest,
    request: refreshableRequest,
  });
  if (refreshableRequest && existingRemoteArtifact) {
    return refreshExistingRemoteLiteratureDiscovery({
      projectRoot: params.projectRoot,
      manifest: params.manifest,
      workflowPolicy: params.workflowPolicy,
      request: refreshableRequest,
      run: existingRemoteArtifact.run,
      artifactPath: existingRemoteArtifact.artifactPath,
      artifactRelativePath: existingRemoteArtifact.artifactRelativePath,
      reportPath: params.reportPath,
      clientConfig: client.clientConfig,
      sharedCorpus: client.sharedCorpus,
      dropMetadataOnlyEntries: false,
      now: params.now,
    });
  }
  if (refreshableRequest && !activeRequest) {
    return null;
  }
  const topic = buildRemoteDiscoveryTopic({
    manifest: params.manifest,
    requisition,
    sourceIndexRaw: params.sourceIndexRaw,
  });
  if (!topic && seedPapers.length === 0) {
    return persistRemoteDiscoveryFailure({
      projectRoot: params.projectRoot,
      reportPath: params.reportPath,
      now: params.now,
      requestId,
      skippedReason: "remote_literature_discovery_missing_topic",
      message:
        "Remote PaperNexus literature discovery requires a project topic or seed papers; local source bootstrap is disabled while remote_mcp is configured.",
      mcpUrl: params.workflowPolicy.papernexusMcpUrl,
      activeRequest,
      seedPaperCount: seedPapers.length,
    });
  }

  const startedAt = params.now;
  const args = buildRemoteDiscoveryArgs({
    topic: topic ?? "Resolve and import the supplied seed papers for graph construction.",
    sharedCorpus: client.sharedCorpus,
    seedPapers,
    workflowPolicy: params.workflowPolicy,
  });
  const discoveryTimeoutMs = resolveRemoteDiscoveryMcpTimeoutMs({
    workflowPolicy: params.workflowPolicy,
    baseTimeoutMs: client.clientConfig.timeoutMs,
  });
  const discoveryResult = await callPapernexusMcpTool(
    {
      ...client.clientConfig,
      timeoutMs: discoveryTimeoutMs,
    },
    "literature_discovery",
    args
  );
  if (!discoveryResult.ok) {
    const rawMessage =
      discoveryResult.error ??
      client.tokenError ??
      "PaperNexus literature_discovery failed.";
    const timedOut = isRemoteDiscoveryTimeoutError(rawMessage);
    return persistRemoteDiscoveryFailure({
      projectRoot: params.projectRoot,
      reportPath: params.reportPath,
      now: params.now,
      requestId,
      skippedReason: timedOut
        ? "remote_literature_discovery_launch_timeout"
        : "remote_literature_discovery_failed",
      message: buildRemoteDiscoveryFailureMessage({
        message: rawMessage,
        timeoutMs: discoveryTimeoutMs,
        timeout: timedOut,
      }),
      mcpUrl: params.workflowPolicy.papernexusMcpUrl,
      activeRequest,
      topic,
      seedPaperCount: seedPapers.length,
      failureKind: timedOut
        ? "remote_literature_discovery_launch_timeout"
        : "remote_literature_discovery_failed",
      configuredTimeoutMs: discoveryTimeoutMs,
    });
  }

  const run = parseMcpToolJsonPayload(discoveryResult.data);
  if (!run) {
    return persistRemoteDiscoveryFailure({
      projectRoot: params.projectRoot,
      reportPath: params.reportPath,
      now: params.now,
      requestId,
      skippedReason: "remote_literature_discovery_unreadable",
      message: "PaperNexus literature_discovery returned an unreadable payload.",
      mcpUrl: params.workflowPolicy.papernexusMcpUrl,
      activeRequest,
      topic,
      seedPaperCount: seedPapers.length,
    });
  }

  const sourceEntries = buildSourceIndexEntriesFromRemoteDiscovery({
    run,
    now: params.now,
  });
  const sourceBackedCount = countRemoteSourceBackedEntries(sourceEntries);
  const metadataGraphSummary = summarizeRemoteMetadataGraph(run);
  const sourceIndexPath = resolvePaperSourceIndexPath(params.projectRoot);
  if (sourceEntries.length > 0) {
    await replaceRemoteLiteratureDiscoverySourceIndexEntries({
      projectRoot: params.projectRoot,
      entries: sourceEntries,
      dropMetadataOnlyEntries: false,
    });
  }

  const taskIds = collectRemoteImportTaskIds(run);
  const queueProgressResult = await fetchRemoteImportQueueProgress({
    clientConfig: client.clientConfig,
    taskIds,
  });
  const queueProgressPayload = queueProgressResult.payload;
  const queueProgressError = queueProgressResult.error;
  const importSummary = summarizeRemoteImportResults(run);
  const remaining = getGraphBlockingRemoteImportRemaining(queueProgressPayload);
  const hasRemoteImportWork = taskIds.length > 0 || importSummary.submitted > 0;
  const importComplete =
    !queueProgressError &&
    (!hasRemoteImportWork ||
      (remaining !== null && remaining === 0 && importSummary.failed === 0));
  const requestStatus =
    queueProgressError
      ? "needs_repair"
      : sourceBackedCount === 0
      ? "needs_repair"
      : hasRemoteImportWork && !importComplete
        ? "running"
        : "completed";
  const runtimeStatus =
    requestStatus === "running"
      ? "waiting_import"
      : requestStatus === "completed"
        ? "waiting_graph"
        : "blocked";
  const runId = pickString(run, ["runId", "run_id"]);
  const artifactRelativePath = path.join(
    "researcher",
    "literature-discovery",
    "remote",
    sanitizeIdFragment(runId ?? requestId),
    "PAPERNEXUS_LITERATURE_DISCOVERY.json"
  );
  const artifactPath = path.join(params.projectRoot, artifactRelativePath);
  await writeJsonAtomicEnsured(artifactPath, {
    ...run,
    local_request_id: requestId,
    local_source_index_path: relativizeProjectPath(params.projectRoot, sourceIndexPath),
    local_metadata_graph_summary: metadataGraphSummary,
    remote_task_ids: taskIds,
    remote_queue_progress: queueProgressPayload,
    remote_queue_progress_error: queueProgressError,
  });
  await writeRemoteLiteratureDiscoveryPacket({
    projectRoot: params.projectRoot,
    requestId,
    triggerKind: activeRequest?.triggerKind ?? "graph_build_remote_literature_discovery",
    run,
    sourceEntries,
    artifactRelativePath,
    requestStatus,
    queueProgressPayload,
    now: params.now,
  });
  const reportRelativePath = path.join(
    "researcher",
    "literature-discovery",
    "remote",
    sanitizeIdFragment(runId ?? requestId),
    "PAPERNEXUS_LITERATURE_DISCOVERY.md"
  );
  await writeTextEnsured(
    path.join(params.projectRoot, reportRelativePath),
    renderRemoteDiscoveryReport({
      run,
      sourceEntryCount: sourceEntries.length,
      taskIds,
      requestStatus,
      queueProgressPayload,
    })
  );
  const decision = buildLiteratureRequisitionDecisionFields({
    requestStatus,
    queueProgressError,
    firstError:
      queueProgressError ??
      (sourceBackedCount === 0
        ? "PaperNexus literature_discovery returned no source/import-backed entries."
        : null),
    sourceBackedCount,
  });
  const satisfactionReportPath = await writeLiteratureRequisitionDecisionReport({
    projectRoot: params.projectRoot,
    requestId,
    manifestPath: activeRequest?.manifestPath ?? null,
    triggerKind: activeRequest?.triggerKind ?? "graph_build_remote_literature_discovery",
    status: decision.status,
    decision: decision.decision,
    reason: decision.reason,
    limitations: decision.limitations,
    now: params.now,
    generation: (activeRequest?.attemptCount ?? 0) + 1,
    remoteRunId: runId,
    remoteArtifactPath: artifactRelativePath,
    remoteReportPath: reportRelativePath,
    sharedCorpus: client.sharedCorpus,
    mcpUrl: params.workflowPolicy?.papernexusMcpUrl ?? null,
    importTaskIds: taskIds,
    queueProgress: queueProgressPayload,
    queueProgressError,
    candidatePaperCount: sourceEntries.length,
    selectedPaperCount: sourceBackedCount,
    sourceBackedCount,
    metadataOnlyCount: Math.max(0, sourceEntries.length - sourceBackedCount),
    evidenceGapClosed: requestStatus === "completed" && sourceBackedCount > 0,
    citedEvidence: {
      source_index_path: sourceEntries.length > 0
        ? relativizeProjectPath(params.projectRoot, sourceIndexPath)
        : null,
      graph_build_source_catchup_report_path: relativizeProjectPath(
        params.projectRoot,
        params.reportPath
      ),
    },
  });

  await writeRemoteDiscoveryGraphBuildReceipt({
    projectRoot: params.projectRoot,
    requestId,
    runId,
    sharedCorpus: client.sharedCorpus,
    status:
      requestStatus === "running"
        ? "waiting_import"
        : requestStatus === "completed"
          ? "waiting_graph_commit"
          : queueProgressError
            ? "failed"
            : "source_blocked",
    graphVisibility: requestStatus === "needs_repair" ? "unavailable" : "unverified",
    sourceEntries,
    taskIds,
    queueProgressPayload,
    checkedAt: params.now,
    limitations:
      requestStatus === "completed"
        ? ["PaperNexus discovery/import completed; graph visibility has not been verified yet."]
        : requestStatus === "running"
          ? ["PaperNexus import work remains in progress."]
          : [
              queueProgressError ??
                "PaperNexus discovery returned no importable source-backed entries.",
            ],
    repairHints:
      requestStatus === "needs_repair"
        ? [
            queueProgressError
              ? "Inspect PaperNexus import_workflow queue_progress and retry after the remote queue is healthy."
              : "Run PaperNexus literature_discovery supplement to resolve Markdown/PDF sources.",
          ]
        : [],
    requisitionSatisfactionReportPath: satisfactionReportPath,
  });

  const completedPapers =
    requestStatus === "completed"
      ? sourceEntries.map((entry) => ({
          canonical_id: pickString(entry, ["canonical_id", "canonicalId"]),
          title: pickString(entry, ["title"]),
          import_task_id: pickString(entry, ["import_task_id", "importTaskId"]),
        }))
      : [];
  await setPaperIngestionState({
    projectRoot: params.projectRoot,
    paperIngestion: {
      runtime_status: runtimeStatus,
      waiting_reason:
        requestStatus === "running"
          ? "PaperNexus remote literature discovery submitted imports; waiting for remote graph materialization."
          : requestStatus === "completed"
            ? "PaperNexus remote literature discovery completed; waiting for graph presence verification."
            : queueProgressError
              ? "PaperNexus remote import queue progress could not be refreshed."
              : "PaperNexus remote literature discovery did not resolve importable sources.",
      import_task_ids: taskIds,
      completed_papers: completedPapers,
      repair_required: requestStatus === "needs_repair",
      repair_reason:
        requestStatus === "needs_repair"
          ? queueProgressError ??
            "PaperNexus literature_discovery returned no source-index entries."
          : null,
      repair_target_corpus: requestStatus === "needs_repair" ? client.sharedCorpus : null,
      queued_requests: [
        {
          request_id: requestId,
          status: requestStatus,
          wrapper: activeRequest?.wrapper ?? "papernexus_remote_mcp",
          args: [],
          command_text:
            activeRequest?.commandText ??
            `PaperNexus MCP literature_discovery ingest for ${(topic ?? "seed papers").slice(0, 160)}`,
          manifest_path: activeRequest?.manifestPath ?? artifactRelativePath,
          shared_corpus: client.sharedCorpus,
          paper_count: sourceEntries.length,
          summary:
            activeRequest?.summary ??
            `Remote PaperNexus literature discovery for ${params.projectId ?? path.basename(params.projectRoot)}`,
          detail:
            activeRequest?.detail ??
            "Remote PaperNexus literature_discovery handled research lookup, source resolution, and import submission.",
          trigger_kind: activeRequest?.triggerKind ?? "graph_build_remote_literature_discovery",
          request_kind: activeRequest?.requestKind ?? "requisition",
          created_at: activeRequest?.createdAt ?? startedAt,
          updated_at: params.now,
          started_at: activeRequest?.startedAt ?? startedAt,
          finished_at: requestStatus === "running" ? null : params.now,
          last_run_id: runId,
          last_session_key: "papernexus:remote_mcp:literature_discovery",
          validation_status: requestStatus === "needs_repair" ? "warning" : "valid",
          validation_summary:
            requestStatus === "needs_repair"
              ? decision.reason
              : "PaperNexus discovery/import result was materialized into local graph-build artifacts.",
          validation_report_path: satisfactionReportPath,
          queue_progress: normalizeRemoteQueueProgressForPaperIngestion(
            queueProgressPayload
          ),
          attempt_count: (activeRequest?.attemptCount ?? 0) + 1,
          last_attempt_at: params.now,
          max_attempts: activeRequest?.maxAttempts ?? 3,
        },
      ],
      last_batch_manifest_path: artifactRelativePath,
      last_updated_at: params.now,
    },
  });

  const result: GraphBuildSourceCatchupResult = {
    attempted: true,
    queued: requestStatus === "running",
    skippedReason:
      requestStatus === "running"
        ? null
        : requestStatus === "completed"
          ? "remote_literature_discovery_completed"
          : "remote_literature_discovery_needs_repair",
    sourceIndexPath: sourceEntries.length > 0 ? sourceIndexPath : null,
    materializedPaperCount: sourceEntries.length,
    requestId,
    batchManifestPath: artifactRelativePath,
    errors:
      requestStatus === "needs_repair"
        ? [queueProgressError ?? "PaperNexus literature_discovery returned no source-index entries."]
        : [],
    attempts: [
      buildFetchAttempt({
        provider: "papernexus-literature-discovery",
        status:
          requestStatus === "needs_repair"
            ? queueProgressError
              ? "failed"
              : "skipped"
            : "success",
        detail:
          requestStatus === "needs_repair"
            ? queueProgressError ?? "Remote discovery returned no source-index entries."
            : `Remote discovery run ${runId ?? requestId} returned ${sourceEntries.length} candidate source entry(s).`,
        at: params.now,
        url: params.workflowPolicy?.papernexusMcpUrl ?? null,
      }),
    ],
  };
  await writeJsonAtomicEnsured(params.reportPath, {
    status:
      requestStatus === "running"
        ? "queued"
        : requestStatus === "completed"
          ? "completed"
          : "failed",
    updated_at: params.now,
    remote_literature_discovery: {
      request_id: requestId,
      run_id: runId,
      mcp_url: params.workflowPolicy?.papernexusMcpUrl,
      shared_corpus: client.sharedCorpus,
      seed_paper_count: seedPapers.length,
      configured_timeout_ms: discoveryTimeoutMs,
      artifact_path: artifactRelativePath,
      report_path: reportRelativePath,
      import_task_ids: taskIds,
      metadata_graph: metadataGraphSummary,
      import_summary: importSummary,
      queue_progress: queueProgressPayload,
      queue_progress_error: queueProgressError,
    },
    ...result,
  });
  return result;
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
    papernexusAccessMode?: string | null;
    papernexusSharedCorpus?: string | null;
    papernexusMcpUrl?: string | null;
    papernexusMcpTransport?: string | null;
    papernexusMcpTimeoutMs?: number | null;
    papernexusApiTokenSource?: string | null;
    papernexusApiTokenEnv?: string | null;
    papernexusApiTokenService?: string | null;
    papernexusApiTokenAccount?: string | null;
    papernexusApiTokenLookupTimeoutMs?: number | null;
    papernexusAllowLocalMcp?: boolean | null;
    papernexusMineruHttpUrl?: string | null;
    papernexusApiBaseUrl?: string | null;
    papernexusSshTarget?: string | null;
    papernexusRemoteStagingRoot?: string | null;
    papernexusDiscoveryProviders?: string[] | string | null;
    papernexusDiscoveryMaxCandidates?: number | null;
    papernexusDiscoveryMaxDownloads?: number | null;
    papernexusDiscoveryMaxImported?: number | null;
    papernexusDiscoveryProcessImports?: boolean | null;
    papernexusDiscoveryImportMaxPasses?: number | null;
    papernexusDiscoveryRequestCache?: boolean | null;
    papernexusDiscoveryRequestCacheTtlMs?: number | null;
    papernexusProviderRequestSchedulerDelayMs?: number | null;
    papernexusProviderRequestMaxConcurrent?: number | null;
    papernexusOpenAlexRequestDelayMs?: number | null;
    papernexusOpenAlexMaxConcurrent?: number | null;
    papernexusSemanticScholarRequestDelayMs?: number | null;
    papernexusSemanticScholarMaxConcurrent?: number | null;
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
  const workflowPolicy = resolveRemoteDiscoveryWorkflowPolicy({
    workflowPolicy: params.workflowPolicy,
    manifest,
  });
  const remoteMcpConfigured = isRemoteMcpDiscoveryConfigured({ workflowPolicy });
  const attempts: PaperSourceFetchAttempt[] = [];
  const reportPath = getCatchupReportPath(projectRoot);
  const errors: string[] = [];
  let recoveredSourceIndexEntryCount = 0;
  let bootstrapSourceIndexEntryCount = 0;
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;
  const previousReport = await readJsonIfExists<Record<string, unknown>>(reportPath);

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

  const remoteDiscoveryResult = await maybeRunRemoteLiteratureDiscovery({
    projectRoot,
    projectId: params.projectId ?? pickString(manifest, ["project_id", "projectId"]),
    manifest,
    workflowPolicy,
    sourceIndexRaw,
    reportPath,
    now,
  });
  if (remoteDiscoveryResult) {
    return remoteDiscoveryResult;
  }
  if (remoteMcpConfigured) {
    const result = buildResult({
      skippedReason: "remote_papernexus_discovery_deferred",
      sourceIndexPath: sourceIndexRaw ? sourceIndexPath : null,
    });
    await writeJsonAtomicEnsured(reportPath, {
      status: "skipped",
      updated_at: now,
      remote_literature_discovery: {
        mcp_url: workflowPolicy.papernexusMcpUrl ?? null,
        shared_corpus: workflowPolicy.papernexusSharedCorpus ?? null,
        reason:
          "Remote PaperNexus is configured, so local literature/source bootstrap is disabled.",
      },
      ...result,
    });
    return result;
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

  const hasBlockingActiveRequest = hasActivePaperIngestionRequest(manifest);
  if (hasBlockingActiveRequest) {
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
    sharedCorpus: workflowPolicy.papernexusSharedCorpus,
    mcpUrl: workflowPolicy.papernexusMcpUrl,
    apiBaseUrl: workflowPolicy.papernexusApiBaseUrl,
    sshTarget: workflowPolicy.papernexusSshTarget,
    remoteStagingRoot: workflowPolicy.papernexusRemoteStagingRoot,
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
