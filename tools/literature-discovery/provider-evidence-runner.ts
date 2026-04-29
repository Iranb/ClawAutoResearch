import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  asRecord,
  asString,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import {
  pathExists,
  readJsonIfExists,
  writeJsonEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";

type UnknownRecord = Record<string, unknown>;

export type ProviderEvidenceRunStatus =
  | "completed"
  | "partial"
  | "empty"
  | "deferred"
  | "blocked_auth"
  | "error";

export type ProviderEvidenceArtifactPaths = {
  manifest_path: string;
  candidates_path: string;
  error_report_path: string;
  trace_path: string;
};

export type ProviderEvidenceErrorClass =
  | "auth"
  | "rate_limit"
  | "transient"
  | "skipped"
  | "unknown";

export type ProviderEvidenceErrorRecord = {
  provider: string | null;
  query_id: string | null;
  status: string | null;
  error: string | null;
  class: ProviderEvidenceErrorClass;
  deferred_until: string | null;
};

export type ProviderSnippetEvidenceCandidate = {
  canonical_id: string | null;
  title: string | null;
  doi: string | null;
  arxiv_id: string | null;
  provider: string | null;
  provider_id: string | null;
  query_id: string | null;
  evidence_kind: "provider_snippet" | "abstract_fallback" | "summary";
  evidence_text: string;
  evidence_source_field: string;
  claim_proof_eligible: false;
  risk_flags: string[];
};

export type ProviderCitationEvidenceCandidate = {
  seed_canonical_id: string | null;
  seed_title: string | null;
  provider: string | null;
  provider_id: string | null;
  query_id: string | null;
  mode:
    | "backward_references"
    | "forward_citations"
    | "co_citation"
    | "bibliographic_coupling";
  source_field: string;
  canonical_id: string | null;
  title: string | null;
  doi: string | null;
  arxiv_id: string | null;
  year: number | null;
  venue: string | null;
  source_status: "provider_relation" | "provider_relation_id";
};

export type ProviderEvidenceCandidatesArtifact = {
  schema_version: 1;
  generated_at: string;
  project_id: string | null;
  project_root: string;
  trigger: string;
  status: ProviderEvidenceRunStatus;
  evidence_policy: string;
  raw_record_count: number;
  snippet_candidate_count: number;
  citation_candidate_count: number;
  claim_proof_eligible_count: 0;
  snippets: ProviderSnippetEvidenceCandidate[];
  citations: ProviderCitationEvidenceCandidate[];
};

export type ProviderEvidenceErrorReportArtifact = {
  schema_version: 1;
  generated_at: string;
  project_id: string | null;
  project_root: string;
  trigger: string;
  status: ProviderEvidenceRunStatus;
  error_count: number;
  auth_error_count: number;
  rate_limit_count: number;
  transient_error_count: number;
  deferred_until: string | null;
  errors: ProviderEvidenceErrorRecord[];
};

export type ProviderEvidenceRunManifestArtifact = {
  schema_version: 1;
  generated_at: string;
  project_id: string | null;
  project_root: string;
  trigger: string;
  status: ProviderEvidenceRunStatus;
  source_index_path: string;
  provider_result_index_path: string;
  provider_results_paths: string[];
  evidence_policy: string;
  input_record_count: number;
  provider_raw_record_count: number;
  snippet_candidate_count: number;
  citation_candidate_count: number;
  claim_proof_eligible_count: 0;
  error_count: number;
  auth_error_count: number;
  rate_limit_count: number;
  transient_error_count: number;
  deferred_until: string | null;
  next_action: string;
  artifact_paths: ProviderEvidenceArtifactPaths;
};

export type ProviderEvidenceRunResult = {
  manifest: ProviderEvidenceRunManifestArtifact;
  candidates: ProviderEvidenceCandidatesArtifact;
  error_report: ProviderEvidenceErrorReportArtifact;
  artifact_paths: ProviderEvidenceArtifactPaths;
};

const DEFAULT_CONTROLLER_DIR = path.join(
  "researcher",
  "literature-research-controller"
);
const EVIDENCE_TEXT_LIMIT = 700;
const MAX_SNIPPET_CANDIDATES = 300;
const MAX_CITATION_CANDIDATES = 600;

const EVIDENCE_POLICY =
  "Provider snippets, abstracts, TLDRs, and citation relations are discovery evidence only. They can seed literature repair and challenge prompts, but claim-level proof still requires local source spans or PaperNexus evidence-chain artifacts.";

const SNIPPET_FIELDS = [
  "snippet",
  "snippets",
  "snippet_text",
  "snippetText",
  "matched_snippet",
  "matchedSnippet",
  "semantic_scholar_snippet",
  "semanticScholarSnippet",
];

const SUMMARY_FIELDS = ["tldr", "tl_dr", "summary", "takeaway"];
const ABSTRACT_FIELDS = ["abstract", "paper_abstract", "paperAbstract", "description"];

const CITATION_RELATION_FIELDS: Array<{
  mode: ProviderCitationEvidenceCandidate["mode"];
  fields: string[];
}> = [
  {
    mode: "backward_references",
    fields: [
      "references",
      "reference_papers",
      "referencePapers",
      "backward_references",
      "backwardReferences",
      "referenced_works",
      "referencedWorks",
    ],
  },
  {
    mode: "forward_citations",
    fields: [
      "citations",
      "citing_papers",
      "citingPapers",
      "cited_by",
      "citedBy",
      "cited_by_papers",
      "citedByPapers",
      "forward_citations",
      "forwardCitations",
    ],
  },
  {
    mode: "co_citation",
    fields: ["related_papers", "relatedPapers", "co_citations", "coCitations"],
  },
  {
    mode: "bibliographic_coupling",
    fields: [
      "shared_references",
      "sharedReferences",
      "bibliographic_coupling",
      "bibliographicCoupling",
    ],
  },
];

function buildArtifactPaths(projectRoot: string): ProviderEvidenceArtifactPaths {
  const baseDir = path.join(projectRoot, DEFAULT_CONTROLLER_DIR);
  return {
    manifest_path: path.join(baseDir, "provider_evidence_run_manifest.json"),
    candidates_path: path.join(baseDir, "provider_evidence_candidates.json"),
    error_report_path: path.join(baseDir, "provider_evidence_error_report.json"),
    trace_path: path.join(baseDir, "provider_evidence_trace.jsonl"),
  };
}

function normalizeEvidenceText(value: string | null | undefined): string | null {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return null;
  }
  return text.length <= EVIDENCE_TEXT_LIMIT
    ? text
    : `${text.slice(0, EVIDENCE_TEXT_LIMIT - 3).trim()}...`;
}

function evidenceTextFromUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    return normalizeEvidenceText(value);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = evidenceTextFromUnknown(entry);
      if (text) {
        return text;
      }
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const field of ["text", "snippet", "summary", "abstract", "content"]) {
    const text = evidenceTextFromUnknown(record[field]);
    if (text) {
      return text;
    }
  }
  return null;
}

function pickEvidenceFromFields(
  record: UnknownRecord,
  fields: string[]
): { field: string; text: string } | null {
  for (const field of fields) {
    const text = evidenceTextFromUnknown(record[field]);
    if (text) {
      return { field, text };
    }
  }
  return null;
}

function abstractFromOpenAlexInvertedIndex(value: unknown): string | null {
  const index = asRecord(value);
  if (!index) {
    return null;
  }
  const positioned: Array<{ word: string; index: number }> = [];
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) {
      continue;
    }
    for (const position of positions) {
      if (typeof position === "number" && Number.isFinite(position)) {
        positioned.push({ word, index: Math.floor(position) });
      }
    }
  }
  if (positioned.length === 0) {
    return null;
  }
  return normalizeEvidenceText(
    positioned
      .sort((left, right) => left.index - right.index)
      .map((entry) => entry.word)
      .join(" ")
  );
}

function readFiniteYear(record: UnknownRecord): number | null {
  for (const key of ["year", "publication_year", "publicationYear"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      const year = Math.floor(value);
      return year >= 1900 && year <= 9999 ? year : null;
    }
    if (typeof value === "string") {
      const match = value.match(/\b(19|20)\d{2}\b/);
      if (match?.[0]) {
        return Number(match[0]);
      }
    }
  }
  return null;
}

function normalizeDoiLike(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase();
}

function normalizeIdentity(value: string | null | undefined): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/https?:\/\/(dx\.)?doi\.org\//g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
  return normalized || null;
}

function canonicalIdFromRecord(record: UnknownRecord): string | null {
  const explicit = pickString(record, [
    "canonical_id",
    "canonicalId",
    "id",
    "paperId",
    "paper_id",
    "providerId",
    "provider_id",
  ]);
  if (explicit) {
    return explicit;
  }
  const doi = normalizeDoiLike(pickString(record, ["doi", "DOI"]));
  if (doi) {
    return `doi:${doi}`;
  }
  const arxiv = pickString(record, ["arxiv_id", "arxivId", "arxiv", "ArXiv"]);
  if (arxiv) {
    return `arxiv:${arxiv}`;
  }
  const title = pickString(record, ["title", "paper_title", "paperTitle", "name", "display_name"]);
  const normalizedTitle = normalizeIdentity(title);
  return normalizedTitle ? `title:${normalizedTitle}` : null;
}

function titleFromRecord(record: UnknownRecord): string | null {
  return pickString(record, [
    "title",
    "paper_title",
    "paperTitle",
    "name",
    "display_name",
    "displayName",
  ]);
}

function providerIdFromRecord(record: UnknownRecord, wrapper: UnknownRecord): string | null {
  return (
    pickString(wrapper, ["providerId", "provider_id", "paperId", "paper_id", "id"]) ??
    pickString(record, ["providerId", "provider_id", "paperId", "paper_id", "id"])
  );
}

function queryIdFromRecord(record: UnknownRecord, wrapper: UnknownRecord): string | null {
  return (
    pickString(wrapper, ["queryId", "query_id"]) ??
    pickString(record, ["queryId", "query_id"])
  );
}

function providerFromRecord(record: UnknownRecord, wrapper: UnknownRecord): string | null {
  return pickString(wrapper, ["provider"]) ?? pickString(record, ["provider"]);
}

function rawRecordFromHit(hit: UnknownRecord): UnknownRecord {
  const raw = asRecord(hit.raw);
  if (raw) {
    return raw;
  }
  return hit;
}

function sourceWrapperFromHit(hit: UnknownRecord): UnknownRecord {
  return {
    provider: hit.provider,
    providerId: hit.providerId ?? hit.provider_id ?? hit.paperId ?? hit.paper_id,
    queryId: hit.queryId ?? hit.query_id,
    title: hit.title,
    doi: hit.doi,
    arxivId: hit.arxivId ?? hit.arxiv_id,
  };
}

function extractSnippetCandidate(
  record: UnknownRecord,
  wrapper: UnknownRecord
): ProviderSnippetEvidenceCandidate | null {
  const explicit = pickEvidenceFromFields(record, SNIPPET_FIELDS);
  const summary = !explicit ? pickEvidenceFromFields(record, SUMMARY_FIELDS) : null;
  const abstractFallback =
    !explicit && !summary
      ? pickEvidenceFromFields(record, ABSTRACT_FIELDS) ??
        (() => {
          const text = abstractFromOpenAlexInvertedIndex(record.abstract_inverted_index);
          return text ? { field: "abstract_inverted_index", text } : null;
        })()
      : null;
  const selected = explicit ?? summary ?? abstractFallback;
  if (!selected) {
    return null;
  }
  const evidenceKind: ProviderSnippetEvidenceCandidate["evidence_kind"] = explicit
    ? "provider_snippet"
    : summary
      ? "summary"
      : "abstract_fallback";
  return {
    canonical_id: canonicalIdFromRecord({ ...record, ...wrapper }),
    title: titleFromRecord({ ...record, ...wrapper }),
    doi: normalizeDoiLike(pickString({ ...record, ...wrapper }, ["doi", "DOI"])),
    arxiv_id: pickString({ ...record, ...wrapper }, ["arxiv_id", "arxivId", "arxiv", "ArXiv"]),
    provider: providerFromRecord(record, wrapper),
    provider_id: providerIdFromRecord(record, wrapper),
    query_id: queryIdFromRecord(record, wrapper),
    evidence_kind: evidenceKind,
    evidence_text: selected.text,
    evidence_source_field: selected.field,
    claim_proof_eligible: false,
    risk_flags: uniqueStrings([
      "provider_snippet_not_claim_proof",
      evidenceKind === "abstract_fallback" ? "abstract_fallback_not_source_backed" : "",
      evidenceKind === "summary" ? "summary_not_source_span" : "",
    ]),
  };
}

function normalizeRelationRecords(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
}

function extractCitationCandidate(params: {
  seed: UnknownRecord;
  wrapper: UnknownRecord;
  mode: ProviderCitationEvidenceCandidate["mode"];
  field: string;
  relation: unknown;
}): ProviderCitationEvidenceCandidate | null {
  const provider = providerFromRecord(params.seed, params.wrapper);
  const providerId = providerIdFromRecord(params.seed, params.wrapper);
  const queryId = queryIdFromRecord(params.seed, params.wrapper);
  const seedTitle = titleFromRecord({ ...params.seed, ...params.wrapper });
  const seedCanonicalId = canonicalIdFromRecord({ ...params.seed, ...params.wrapper });
  if (typeof params.relation === "string") {
    const relationId = params.relation.trim();
    if (!relationId) {
      return null;
    }
    return {
      seed_canonical_id: seedCanonicalId,
      seed_title: seedTitle,
      provider,
      provider_id: providerId,
      query_id: queryId,
      mode: params.mode,
      source_field: params.field,
      canonical_id: relationId,
      title: null,
      doi: relationId.includes("doi.org/")
        ? normalizeDoiLike(relationId)
        : null,
      arxiv_id: null,
      year: null,
      venue: null,
      source_status: "provider_relation_id",
    };
  }
  const relationRecord = asRecord(params.relation);
  if (!relationRecord) {
    return null;
  }
  const title = titleFromRecord(relationRecord);
  const doi = normalizeDoiLike(pickString(relationRecord, ["doi", "DOI"]));
  const canonicalId =
    canonicalIdFromRecord(relationRecord) ??
    (doi ? `doi:${doi}` : null) ??
    (title ? `title:${normalizeIdentity(title)}` : null);
  if (!canonicalId && !title) {
    return null;
  }
  return {
    seed_canonical_id: seedCanonicalId,
    seed_title: seedTitle,
    provider,
    provider_id: providerId,
    query_id: queryId,
    mode: params.mode,
    source_field: params.field,
    canonical_id: canonicalId,
    title,
    doi,
    arxiv_id: pickString(relationRecord, ["arxiv_id", "arxivId", "arxiv", "ArXiv"]),
    year: readFiniteYear(relationRecord),
    venue: pickString(relationRecord, ["venue", "journal", "conference", "container_title"]),
    source_status: "provider_relation",
  };
}

function extractCitationCandidates(
  record: UnknownRecord,
  wrapper: UnknownRecord
): ProviderCitationEvidenceCandidate[] {
  const candidates: ProviderCitationEvidenceCandidate[] = [];
  for (const relationGroup of CITATION_RELATION_FIELDS) {
    for (const field of relationGroup.fields) {
      for (const relation of normalizeRelationRecords(record[field])) {
        const candidate = extractCitationCandidate({
          seed: record,
          wrapper,
          mode: relationGroup.mode,
          field,
          relation,
        });
        if (candidate) {
          candidates.push(candidate);
        }
      }
    }
  }
  return candidates;
}

function classifyProviderError(error: string | null, status: string | null): ProviderEvidenceErrorClass {
  const text = `${status ?? ""}\n${error ?? ""}`.toLowerCase();
  if (!text.trim()) {
    return "unknown";
  }
  if (/401|403|unauthorized|forbidden|api key|apikey|auth|credential/.test(text)) {
    return "auth";
  }
  if (/429|rate limit|too many requests|quota/.test(text)) {
    return "rate_limit";
  }
  if (/timeout|timed out|econnreset|etimedout|503|502|504|network/.test(text)) {
    return "transient";
  }
  if (/skipped|disabled|unsupported|missing_credentials/.test(text)) {
    return "skipped";
  }
  return "unknown";
}

function deferredUntil(generatedAt: string, seconds: number): string {
  return new Date(Date.parse(generatedAt) + seconds * 1000).toISOString();
}

function extractErrorRecords(params: {
  providerResultIndex: UnknownRecord | null;
  rawProviderResults: UnknownRecord[];
  generatedAt: string;
  provider429WaitSeconds: number;
}): ProviderEvidenceErrorRecord[] {
  const entries: ProviderEvidenceErrorRecord[] = [];
  const append = (record: UnknownRecord) => {
    const error = asString(record.error);
    const status = asString(record.status);
    if (!error && status !== "error" && status !== "skipped") {
      return;
    }
    const errorClass = classifyProviderError(error, status);
    entries.push({
      provider: pickString(record, ["provider"]),
      query_id: pickString(record, ["query_id", "queryId"]),
      status,
      error,
      class: errorClass,
      deferred_until:
        errorClass === "rate_limit"
          ? deferredUntil(params.generatedAt, params.provider429WaitSeconds)
          : null,
    });
  };
  for (const entry of Array.isArray(params.providerResultIndex?.provider_query_results)
    ? params.providerResultIndex.provider_query_results
    : []) {
    const record = asRecord(entry);
    if (record) {
      append(record);
    }
  }
  for (const rawFile of params.rawProviderResults) {
    const queryResults = Array.isArray(rawFile.query_results)
      ? rawFile.query_results
      : Array.isArray(rawFile.provider_query_results)
        ? rawFile.provider_query_results
        : [];
    for (const entry of queryResults) {
      const record = asRecord(entry);
      if (record) {
        append(record);
      }
    }
  }
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = JSON.stringify(entry);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function statusFromCounts(params: {
  snippetCount: number;
  citationCount: number;
  errorRecords: ProviderEvidenceErrorRecord[];
}): ProviderEvidenceRunStatus {
  const evidenceCount = params.snippetCount + params.citationCount;
  const authCount = params.errorRecords.filter((entry) => entry.class === "auth").length;
  const rateLimitCount = params.errorRecords.filter(
    (entry) => entry.class === "rate_limit"
  ).length;
  if (evidenceCount > 0 && params.errorRecords.length > 0) {
    return "partial";
  }
  if (evidenceCount > 0) {
    return "completed";
  }
  if (authCount > 0) {
    return "blocked_auth";
  }
  if (rateLimitCount > 0) {
    return "deferred";
  }
  if (params.errorRecords.some((entry) => ["transient", "unknown"].includes(entry.class))) {
    return "error";
  }
  return "empty";
}

function countByClass(
  errors: ProviderEvidenceErrorRecord[],
  errorClass: ProviderEvidenceErrorClass
): number {
  return errors.filter((entry) => entry.class === errorClass).length;
}

function collectSourceIndexRecords(raw: unknown): UnknownRecord[] {
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => asRecord(entry))
      .filter((entry): entry is UnknownRecord => Boolean(entry));
  }
  const record = asRecord(raw);
  if (!record) {
    return [];
  }
  const withEntryKey = (entryKey: string, entry: unknown): UnknownRecord | null => {
    const entryRecord = asRecord(entry);
    return entryRecord ? ({ canonical_id: entryKey, ...entryRecord } as UnknownRecord) : null;
  };
  for (const key of [
    "papers",
    "entries",
    "items",
    "sources",
    "canonical_papers",
    "canonicalPapers",
  ]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value
        .map((entry) => asRecord(entry))
        .filter((entry): entry is UnknownRecord => Boolean(entry));
    }
    const nested = asRecord(value);
    if (nested) {
      return Object.entries(nested)
        .map(([entryKey, entry]) => withEntryKey(entryKey, entry))
        .filter((entry): entry is UnknownRecord => Boolean(entry));
    }
  }
  return Object.entries(record)
    .map(([entryKey, entry]) => withEntryKey(entryKey, entry))
    .filter((entry): entry is UnknownRecord => Boolean(entry));
}

async function latestProviderResultPaths(projectRoot: string): Promise<string[]> {
  const searchRawDir = path.join(projectRoot, "researcher", "search_raw");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(searchRawDir);
  } catch {
    return [];
  }
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.endsWith("_provider_results.json"))
      .map(async (entry) => {
        const filePath = path.join(searchRawDir, entry);
        const stat = await fs.stat(filePath).catch(() => null);
        return stat ? { filePath, mtimeMs: stat.mtimeMs } : null;
      })
  );
  return candidates
    .filter((entry): entry is { filePath: string; mtimeMs: number } => Boolean(entry))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, 3)
    .map((entry) => entry.filePath);
}

function providerResultPathsFromIndex(
  projectRoot: string,
  providerResultIndex: UnknownRecord | null
): string[] {
  const searchArtifacts = asRecord(providerResultIndex?.search_artifacts);
  const candidates = [
    pickString(searchArtifacts ?? {}, ["providerResultsPath", "provider_results_path"]),
    pickString(providerResultIndex ?? {}, ["provider_results_path", "providerResultsPath"]),
  ];
  return uniqueStrings(
    candidates
      .map((candidate) => resolveProjectArtifactPath(projectRoot, candidate))
      .filter((candidate): candidate is string => Boolean(candidate))
  );
}

async function readProviderResultFiles(paths: string[]): Promise<UnknownRecord[]> {
  const records: UnknownRecord[] = [];
  for (const filePath of paths) {
    const raw = await readJsonIfExists<unknown>(filePath);
    const record = asRecord(raw);
    if (record) {
      records.push(record);
    }
  }
  return records;
}

function rawHitsFromProviderResultFiles(rawProviderResults: UnknownRecord[]): Array<{
  record: UnknownRecord;
  wrapper: UnknownRecord;
}> {
  const hits: Array<{ record: UnknownRecord; wrapper: UnknownRecord }> = [];
  for (const rawFile of rawProviderResults) {
    const queryResults = Array.isArray(rawFile.query_results)
      ? rawFile.query_results
      : Array.isArray(rawFile.provider_query_results)
        ? rawFile.provider_query_results
        : [];
    for (const queryResult of queryResults) {
      const queryRecord = asRecord(queryResult);
      if (!queryRecord || !Array.isArray(queryRecord.hits)) {
        continue;
      }
      for (const hit of queryRecord.hits) {
        const hitRecord = asRecord(hit);
        if (!hitRecord) {
          continue;
        }
        const wrapper = {
          provider: queryRecord.provider ?? hitRecord.provider,
          queryId: queryRecord.queryId ?? queryRecord.query_id ?? hitRecord.queryId,
          ...sourceWrapperFromHit(hitRecord),
        };
        hits.push({
          record: rawRecordFromHit(hitRecord),
          wrapper,
        });
      }
    }
  }
  return hits;
}

function rawHitsFromSourceIndex(rawSourceIndex: unknown): Array<{
  record: UnknownRecord;
  wrapper: UnknownRecord;
}> {
  return collectSourceIndexRecords(rawSourceIndex).map((record) => ({
    record,
    wrapper: {
      provider: record.source_provider,
      providerId: record.provider_id ?? record.providerId,
      queryId: Array.isArray(record.query_ids) ? record.query_ids[0] : record.queryId,
      title: record.title,
      doi: record.doi,
      arxivId: record.arxiv_id ?? record.arxivId,
    },
  }));
}

function dedupeSnippets(
  candidates: ProviderSnippetEvidenceCandidate[]
): ProviderSnippetEvidenceCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = [
      candidate.canonical_id,
      candidate.provider,
      candidate.evidence_source_field,
      candidate.evidence_text.slice(0, 120),
    ].join("::");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function dedupeCitations(
  candidates: ProviderCitationEvidenceCandidate[]
): ProviderCitationEvidenceCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = [
      candidate.seed_canonical_id,
      candidate.mode,
      candidate.source_field,
      candidate.canonical_id ?? candidate.title,
    ].join("::");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export async function runLiteratureProviderEvidence(params: {
  projectRoot: string;
  generatedAt?: string | null;
  trigger?: string | null;
  provider429WaitSeconds?: number | null;
  providerResultsPaths?: string[] | null;
}): Promise<ProviderEvidenceRunResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const trigger = params.trigger ?? "literature_provider_evidence_run";
  const provider429WaitSeconds =
    typeof params.provider429WaitSeconds === "number" &&
    Number.isFinite(params.provider429WaitSeconds)
      ? Math.max(60, Math.floor(params.provider429WaitSeconds))
      : 3600;
  const sourceIndexPath = path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json");
  const providerResultIndexPath = path.join(
    projectRoot,
    DEFAULT_CONTROLLER_DIR,
    "provider_result_index.json"
  );
  const artifactPaths = buildArtifactPaths(projectRoot);
  const [manifestRaw, sourceIndexRaw] = await Promise.all([
    readJsonIfExists<UnknownRecord>(path.join(projectRoot, "PROJECT_MANIFEST.json")),
    readJsonIfExists<unknown>(sourceIndexPath),
  ]);
  const providerResultIndex = await readJsonIfExists<UnknownRecord>(providerResultIndexPath);
  const explicitProviderResultPaths = (params.providerResultsPaths ?? [])
    .map((candidate) => resolveProjectArtifactPath(projectRoot, candidate))
    .filter((candidate): candidate is string => Boolean(candidate));
  const providerResultPaths = uniqueStrings([
    ...explicitProviderResultPaths,
    ...providerResultPathsFromIndex(projectRoot, providerResultIndex),
    ...(await latestProviderResultPaths(projectRoot)),
  ]).filter((candidate) => path.isAbsolute(candidate));
  const existingProviderResultPaths: string[] = [];
  for (const filePath of providerResultPaths) {
    if (await pathExists(filePath)) {
      existingProviderResultPaths.push(filePath);
    }
  }
  const rawProviderResults = await readProviderResultFiles(existingProviderResultPaths);
  const rawInputs = [
    ...rawHitsFromProviderResultFiles(rawProviderResults),
    ...rawHitsFromSourceIndex(sourceIndexRaw),
  ];
  const snippets = dedupeSnippets(
    rawInputs
      .map(({ record, wrapper }) => extractSnippetCandidate(record, wrapper))
      .filter((candidate): candidate is ProviderSnippetEvidenceCandidate => Boolean(candidate))
  ).slice(0, MAX_SNIPPET_CANDIDATES);
  const citations = dedupeCitations(
    rawInputs.flatMap(({ record, wrapper }) => extractCitationCandidates(record, wrapper))
  ).slice(0, MAX_CITATION_CANDIDATES);
  const errors = extractErrorRecords({
    providerResultIndex,
    rawProviderResults,
    generatedAt,
    provider429WaitSeconds,
  });
  const status = statusFromCounts({
    snippetCount: snippets.length,
    citationCount: citations.length,
    errorRecords: errors,
  });
  const authErrorCount = countByClass(errors, "auth");
  const rateLimitCount = countByClass(errors, "rate_limit");
  const transientErrorCount = countByClass(errors, "transient");
  const firstDeferredUntil =
    errors.find((entry) => entry.deferred_until)?.deferred_until ?? null;
  const projectId =
    pickString(manifestRaw ?? {}, ["project_id", "projectId"]) ?? path.basename(projectRoot);
  const candidates: ProviderEvidenceCandidatesArtifact = {
    schema_version: 1,
    generated_at: generatedAt,
    project_id: projectId,
    project_root: projectRoot,
    trigger,
    status,
    evidence_policy: EVIDENCE_POLICY,
    raw_record_count: rawInputs.length,
    snippet_candidate_count: snippets.length,
    citation_candidate_count: citations.length,
    claim_proof_eligible_count: 0,
    snippets,
    citations,
  };
  const errorReport: ProviderEvidenceErrorReportArtifact = {
    schema_version: 1,
    generated_at: generatedAt,
    project_id: projectId,
    project_root: projectRoot,
    trigger,
    status,
    error_count: errors.length,
    auth_error_count: authErrorCount,
    rate_limit_count: rateLimitCount,
    transient_error_count: transientErrorCount,
    deferred_until: firstDeferredUntil,
    errors,
  };
  const nextAction =
    status === "blocked_auth"
      ? "configure provider credentials or disable authenticated providers"
      : status === "deferred"
        ? "rerun after deferred_until or use cached/local source artifacts"
        : status === "empty"
          ? "run literature provider discovery or import source-backed PaperNexus spans"
          : "feed provider evidence candidates into literature repair and PaperNexus import";
  const manifest: ProviderEvidenceRunManifestArtifact = {
    schema_version: 1,
    generated_at: generatedAt,
    project_id: projectId,
    project_root: projectRoot,
    trigger,
    status,
    source_index_path: sourceIndexPath,
    provider_result_index_path: providerResultIndexPath,
    provider_results_paths: existingProviderResultPaths,
    evidence_policy: EVIDENCE_POLICY,
    input_record_count: rawInputs.length,
    provider_raw_record_count: rawHitsFromProviderResultFiles(rawProviderResults).length,
    snippet_candidate_count: snippets.length,
    citation_candidate_count: citations.length,
    claim_proof_eligible_count: 0,
    error_count: errors.length,
    auth_error_count: authErrorCount,
    rate_limit_count: rateLimitCount,
    transient_error_count: transientErrorCount,
    deferred_until: firstDeferredUntil,
    next_action: nextAction,
    artifact_paths: artifactPaths,
  };
  await Promise.all([
    writeJsonEnsured(artifactPaths.manifest_path, manifest),
    writeJsonEnsured(artifactPaths.candidates_path, candidates),
    writeJsonEnsured(artifactPaths.error_report_path, errorReport),
  ]);
  await fs.mkdir(path.dirname(artifactPaths.trace_path), { recursive: true });
  await fs.appendFile(
    artifactPaths.trace_path,
    `${JSON.stringify({
      schema_version: 1,
      generated_at: generatedAt,
      project_id: projectId,
      trigger,
      status,
      input_record_count: manifest.input_record_count,
      provider_raw_record_count: manifest.provider_raw_record_count,
      snippet_candidate_count: snippets.length,
      citation_candidate_count: citations.length,
      error_count: errors.length,
      deferred_until: firstDeferredUntil,
    })}\n`,
    "utf8"
  );
  return {
    manifest,
    candidates,
    error_report: errorReport,
    artifact_paths: artifactPaths,
  };
}
