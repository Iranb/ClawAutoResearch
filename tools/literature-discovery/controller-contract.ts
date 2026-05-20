import * as path from "node:path";
import * as fs from "node:fs/promises";
import {
  asRecord,
  asString,
  asStringArray,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import {
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import {
  auditLiteratureCoverage,
  planCitationExpansion,
  type CitationExpansionPacket,
  type LiteratureCoverageAudit,
} from "../paper-discovery-diagnostics";
import { normalizeTitle } from "../paper-source-contract";
import {
  readWorkflowPaperSourceIndex,
  type WorkflowPaperSourceEntry,
} from "../paper-source-index";
import { buildBroadPaperSearchPlan } from "../research30/query-planner";
import type {
  BroadPaperProviderName,
  BroadPaperProviderQueryResult,
  BroadPaperSearchDepth,
  BroadPaperSearchQuery,
} from "../research30/provider-contract";
import {
  DEFAULT_BROAD_PAPER_PROVIDERS,
  normalizeBroadPaperProviderName,
} from "../research30/provider-contract";
import {
  serializeMergedPaperCandidate,
  type MergedPaperCandidate,
} from "../research30/merge";
import { collectSurveyEntries } from "../survey-review-artifacts";
import { normalizeWorkflowControlContract } from "../workflow-control-contract.js";

export const DEFAULT_LITERATURE_RESEARCH_CONTROLLER_DIR =
  "researcher/literature-research-controller";

type LiteratureControllerDecision =
  | "blocked"
  | "continue_research"
  | "proceed_with_guardrails"
  | "stop_and_proceed";

type LiteratureNeedReason = {
  code: string;
  severity: "critical" | "high" | "medium" | "low";
  summary: string;
  source_artifacts: string[];
};

type KeywordBucket = {
  name:
    | "target_domain"
    | "method"
    | "dataset_metric"
    | "story_gap"
    | "reviewer_concern"
    | "citation_chasing_seed";
  terms: string[];
  source_artifacts: string[];
  rationale: string;
};

type LiteratureQueryPlanEntry = {
  id: string;
  query: string;
  intent: string;
  providers: string[];
  requires_papernexus_import: boolean;
  source_artifacts: string[];
  rationale: string;
};

type CandidateScreeningRecord = {
  canonical_id: string | null;
  title: string | null;
  year: number | null;
  venue: string | null;
  doi: string | null;
  arxiv_id: string | null;
  source_path: string | null;
  resolution_status: string | null;
  source_backed: boolean;
  included_paper: boolean;
  screening_status:
    | "accepted_existing_corpus"
    | "background_existing_corpus"
    | "included_metadata_only_needs_import"
    | "metadata_only_needs_import"
    | "included_not_in_source_index";
};

type ProviderCandidateDecision =
  | "selected_for_import"
  | "defer_needs_source"
  | "background_candidate"
  | "exclude_low_relevance";

type ProviderCandidateIndexRecord = {
  canonical_id: string | null;
  title: string | null;
  year: number | null;
  venue: string | null;
  doi: string | null;
  arxiv_id: string | null;
  source_path: string | null;
  pdf_url: string | null;
  best_oa_url: string | null;
  resolution_status: string | null;
  source_backed: boolean;
  provider_agreement_count: number;
  query_ids: string[];
  provider_scores: Record<string, number | null>;
  recall_score: number | null;
  selection_score: number | null;
  topic_relevance_score: number | null;
  matched_topic_tokens: string[];
  topic_relevance_evidence_source: string | null;
  execution_decision: ProviderCandidateDecision;
  risk_flags: string[];
};

type ProviderResultIndexArtifact = {
  schema_version: 1;
  generated_at: string;
  project_id: string | null;
  project_root: string;
  topic: string | null;
  trigger: string;
  status: "executed" | "skipped";
  skip_reason: string | null;
  provider_names: BroadPaperProviderName[];
  query_count: number;
  provider_query_count: number;
  provider_status_counts: Record<string, number>;
  total_hit_count: number;
  merged_candidate_count: number;
  resolved_source_count: number;
  metadata_only_count: number;
  selected_for_import_count: number;
  search_artifacts: Record<string, unknown> | null;
  provider_query_results: Array<{
    provider: BroadPaperProviderName;
    query_id: string;
    status: BroadPaperProviderQueryResult["status"];
    total_hits: number;
    hit_count: number;
    warning_count: number;
    error: string | null;
    availability: string | null;
  }>;
  candidates: ProviderCandidateIndexRecord[];
};

type PapernexusImportBatchManifestArtifact = {
  schema_version: 1;
  generated_at: string;
  project_id: string | null;
  project_root: string;
  trigger: string;
  status:
    | "queued"
    | "active_request_exists"
    | "not_queued"
    | "not_started"
    | "skipped";
  queued: boolean;
  reason: string | null;
  request_id: string | null;
  wrapper: string | null;
  command_text: string | null;
  manifest_path: string | null;
  source_index_path: string | null;
  shared_corpus: string | null;
  importable_paper_count: number | null;
  paper_count: number | null;
  raw_papernexus_import: Record<string, unknown> | null;
};

type PapernexusRefreshReportArtifact = {
  schema_version: 1;
  generated_at: string;
  project_id: string | null;
  project_root: string;
  trigger: string;
  status:
    | "queued_graph_build"
    | "waiting_for_active_import"
    | "pending_no_importable_sources"
    | "skipped"
    | "not_started"
    | "needs_rerun_failed_gate"
    | "none";
  graph_build_expected: boolean;
  next_route: LiteratureResearchControllerRunReceipt["next_route"];
  reason: string | null;
  import_request_id: string | null;
  import_manifest_path: string | null;
  source_index_path: string | null;
  next_action: string;
};

type CitationExpansionReportArtifact = {
  schema_version: 1;
  generated_at: string;
  project_id: string | null;
  project_root: string;
  trigger: string;
  status: "planned" | "not_required" | "skipped";
  bounded: boolean;
  max_seeds: number | null;
  seed_count: number;
  query_count: number;
  packet_path: string | null;
  markdown_path: string | null;
  query_types: Record<string, number>;
  recommendations: string[];
  auto_citation_verification: Record<string, unknown> | null;
  snowballing: CitationSnowballingReport;
};

type SnippetEvidenceKind =
  | "source_backed_quote"
  | "explicit_snippet"
  | "evidence_summary"
  | "abstract_fallback"
  | "unavailable";

type SnippetEvidenceRecord = {
  canonical_id: string | null;
  title: string | null;
  doi: string | null;
  arxiv_id: string | null;
  year: number | null;
  venue: string | null;
  source_path: string | null;
  source_resolved_path: string | null;
  source_path_exists: boolean;
  snippet_status: string | null;
  evidence_kind: SnippetEvidenceKind;
  evidence_text: string | null;
  evidence_source_field: string | null;
  source_backed: boolean;
  claim_proof_eligible: boolean;
  risk_flags: string[];
};

type SnippetEvidenceReportArtifact = {
  schema_version: 1;
  generated_at: string;
  project_id: string | null;
  project_root: string;
  trigger: string;
  status: "grounded" | "fallback_only" | "empty";
  source_index_path: string;
  evidence_policy: string;
  raw_record_count: number;
  evaluated_record_count: number;
  record_limit: number;
  records_truncated: boolean;
  source_backed_quote_count: number;
  explicit_snippet_count: number;
  evidence_summary_count: number;
  abstract_fallback_count: number;
  unavailable_count: number;
  snippet_grounded_count: number;
  claim_proof_eligible_count: number;
  records: SnippetEvidenceRecord[];
};

type CitationSnowballingMode =
  | "backward_references"
  | "forward_citations"
  | "co_citation"
  | "bibliographic_coupling";

type CitationSnowballingCandidate = {
  seed_canonical_id: string | null;
  seed_title: string | null;
  canonical_id: string | null;
  title: string | null;
  doi: string | null;
  arxiv_id: string | null;
  year: number | null;
  venue: string | null;
  source_field: string;
  source_status: "raw_relation" | "string_relation";
};

type CitationSnowballingModeReport = {
  mode: CitationSnowballingMode;
  status: "extracted" | "empty" | "missing_seed_metadata";
  seed_count: number;
  missing_seed_metadata_count: number;
  candidate_count: number;
  fallback_query_count: number;
  candidates: CitationSnowballingCandidate[];
};

type CitationSnowballingReport = {
  status: "extracted" | "empty" | "not_required" | "skipped";
  source_index_path: string;
  evidence_policy: string;
  seed_count: number;
  total_candidate_count: number;
  missing_seed_metadata_count: number;
  mode_counts: Record<string, number>;
  mode_reports: CitationSnowballingModeReport[];
};

export type LiteratureResearchControllerArtifacts = {
  schema_version: 1;
  generated_at: string;
  project_id: string | null;
  project_root: string;
  topic: string | null;
  status: "blocked" | "needs_research" | "guardrailed" | "ready";
  decision: LiteratureControllerDecision;
  artifact_paths: {
    base_dir: string;
    need_assessment_path: string;
    keyword_bank_path: string;
    query_plan_path: string;
    candidate_screening_report_path: string;
    coverage_report_path: string;
    status_markdown_path: string;
    run_receipt_path: string;
    trace_path: string;
    provider_result_index_path: string;
    papernexus_import_batch_manifest_path: string;
    papernexus_refresh_report_path: string;
    citation_expansion_report_path: string;
    snippet_evidence_report_path: string;
    repair_log_path: string;
    coverage_audit_path: string;
    citation_expansion_packet_path: string | null;
  };
  relative_artifact_paths: {
    base_dir: string;
    need_assessment_path: string;
    keyword_bank_path: string;
    query_plan_path: string;
    candidate_screening_report_path: string;
    coverage_report_path: string;
    status_markdown_path: string;
    run_receipt_path: string;
    trace_path: string;
    provider_result_index_path: string;
    papernexus_import_batch_manifest_path: string;
    papernexus_refresh_report_path: string;
    citation_expansion_report_path: string;
    snippet_evidence_report_path: string;
    repair_log_path: string;
  };
  need_assessment: Record<string, unknown>;
  keyword_bank: Record<string, unknown>;
  query_plan: Record<string, unknown>;
  candidate_screening_report: Record<string, unknown>;
  coverage_report: Record<string, unknown>;
  coverage_audit: LiteratureCoverageAudit;
  citation_expansion_packet: CitationExpansionPacket | null;
};

export type LiteratureResearchControllerRunReceipt = {
  schema_version: 1;
  generated_at: string;
  project_id: string | null;
  project_root: string;
  trigger: string;
  executed: boolean;
  skip_reason: string | null;
  controller_before: {
    status: LiteratureResearchControllerArtifacts["status"];
    decision: LiteratureResearchControllerArtifacts["decision"];
    coverage_score_100: number | null;
    blocking_gap_count: number | null;
  };
  search_execution: {
    topic: string | null;
    depth: BroadPaperSearchDepth;
    provider_names: BroadPaperProviderName[];
    query_count: number;
    queries: BroadPaperSearchQuery[];
    candidate_count: number | null;
    resolved_source_count: number | null;
    metadata_only_count: number | null;
    source_index_update: Record<string, unknown> | null;
    artifacts: Record<string, unknown> | null;
  } | null;
  provider_result_index: Record<string, unknown> | null;
  papernexus_import: Record<string, unknown> | null;
  papernexus_import_batch_manifest: Record<string, unknown> | null;
  papernexus_refresh_report: Record<string, unknown> | null;
  citation_expansion_report: Record<string, unknown> | null;
  snippet_evidence_report: Record<string, unknown> | null;
  controller_after: {
    status: LiteratureResearchControllerArtifacts["status"];
    decision: LiteratureResearchControllerArtifacts["decision"];
    coverage_score_100: number | null;
    blocking_gap_count: number | null;
    next_actions: string[];
  } | null;
  next_route: "graph_build" | "rerun_failed_gate" | "manual_repair" | "none";
  artifact_paths: {
    run_receipt_path: string;
    trace_path: string;
    provider_result_index_path: string;
    papernexus_import_batch_manifest_path: string;
    papernexus_refresh_report_path: string;
    citation_expansion_report_path: string;
    snippet_evidence_report_path: string;
    repair_log_path: string;
  };
};

const STOPWORDS = new Set([
  "about",
  "after",
  "against",
  "also",
  "among",
  "because",
  "before",
  "between",
  "could",
  "from",
  "have",
  "into",
  "more",
  "paper",
  "papers",
  "research",
  "result",
  "results",
  "should",
  "study",
  "than",
  "that",
  "their",
  "there",
  "these",
  "this",
  "those",
  "through",
  "using",
  "with",
  "without",
]);

const DEFAULT_PROVIDER_ROUTE = [
  "research30_openalex",
  "research30_semanticscholar",
  "research30_crossref",
  "research30_dblp",
  "papernexus_corpus_lookup",
];

function relativePathFromProject(projectRoot: string, targetPath: string): string {
  return path.relative(projectRoot, targetPath).split(path.sep).join("/");
}

function buildArtifactPaths(projectRoot: string) {
  const baseDir = path.join(projectRoot, DEFAULT_LITERATURE_RESEARCH_CONTROLLER_DIR);
  return {
    baseDir,
    needAssessmentPath: path.join(baseDir, "literature_need_assessment.json"),
    keywordBankPath: path.join(baseDir, "retrieval_keyword_bank.json"),
    queryPlanPath: path.join(baseDir, "literature_query_plan.json"),
    candidateScreeningReportPath: path.join(baseDir, "candidate_screening_report.json"),
    coverageReportPath: path.join(baseDir, "literature_coverage_report.json"),
    statusMarkdownPath: path.join(baseDir, "LITERATURE_RESEARCH_CONTROLLER_STATUS.md"),
    runReceiptPath: path.join(baseDir, "literature_controller_run_receipt.json"),
    tracePath: path.join(baseDir, "literature_controller_trace.jsonl"),
    providerResultIndexPath: path.join(baseDir, "provider_result_index.json"),
    papernexusImportBatchManifestPath: path.join(
      baseDir,
      "papernexus_import_batch_manifest.json"
    ),
    papernexusRefreshReportPath: path.join(baseDir, "papernexus_refresh_report.json"),
    citationExpansionReportPath: path.join(baseDir, "citation_expansion_report.json"),
    snippetEvidenceReportPath: path.join(baseDir, "snippet_evidence_report.json"),
    repairLogPath: path.join(baseDir, "literature_repair_log.jsonl"),
  };
}

function firstStringFromRecords(
  records: Array<Record<string, unknown> | null>,
  keys: string[]
): string | null {
  for (const record of records) {
    if (!record) {
      continue;
    }
    const value = pickString(record, keys);
    if (value) {
      return value;
    }
  }
  return null;
}

function pickProjectTopic(manifest: Record<string, unknown>): string | null {
  const researchProgram = asRecord(manifest.research_program ?? manifest.researchProgram);
  const writingContract = asRecord(manifest.writing_contract ?? manifest.writingContract);
  const surveyReview = asRecord(manifest.survey_review ?? manifest.surveyReview);
  return firstStringFromRecords(
    [manifest, researchProgram, writingContract, surveyReview],
    [
      "topic",
      "research_topic",
      "researchTopic",
      "goal",
      "title",
      "problem_statement",
      "problemStatement",
      "hypothesis",
      "prompt",
    ]
  );
}

function normalizeIdentity(value: string | null | undefined): string | null {
  const normalized = normalizeTitle(value);
  if (normalized) {
    return normalized;
  }
  const fallback = String(value ?? "").trim().toLowerCase();
  return fallback || null;
}

function identityKeysFromSourceEntry(entry: WorkflowPaperSourceEntry): string[] {
  return uniqueStrings(
    [entry.canonicalId, entry.doi, entry.arxivId, entry.title]
      .map((value) => normalizeIdentity(value))
      .filter((value): value is string => Boolean(value))
  );
}

function identityKeysFromRawPaper(entry: Record<string, unknown>): string[] {
  return uniqueStrings(
    [
      pickString(entry, ["canonical_id", "canonicalId", "id", "paper_id", "paperId"]),
      pickString(entry, ["doi"]),
      pickString(entry, ["arxiv_id", "arxivId", "arxiv"]),
      pickString(entry, ["title", "paper_title", "paperTitle", "name"]),
    ]
      .map((value) => normalizeIdentity(value))
      .filter((value): value is string => Boolean(value))
  );
}

function isSourceBacked(entry: WorkflowPaperSourceEntry): boolean {
  return Boolean(
    entry.sourcePath ||
      entry.resolutionStatus === "resolved_markdown" ||
      entry.resolutionStatus === "resolved_pdf"
  );
}

function extractReviewIssueSignals(raw: unknown): string[] {
  const record = asRecord(raw);
  const issues = Array.isArray(record?.issues)
    ? record.issues
    : Array.isArray(raw)
      ? raw
      : [];
  return issues
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .filter((entry) => {
      const status = String(entry.status ?? "").trim().toLowerCase();
      return status !== "closed" && status !== "resolved";
    })
    .map((entry) =>
      [
        pickString(entry, ["title", "name", "summary"]),
        pickString(entry, ["body", "description", "detail", "message"]),
        pickString(entry, ["severity"]),
      ]
        .filter(Boolean)
        .join(" ")
    )
    .filter(Boolean)
    .slice(0, 12);
}

function collectSignalLines(rawText: string | null, limit: number): string[] {
  return String(rawText ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => Boolean(line))
    .filter((line) => !/^```/.test(line))
    .filter((line) => !/^\|?\s*:?-{3,}/.test(line))
    .map((line) => line.replace(/^[-*#\d.\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function extractTerms(signals: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const signal of signals) {
    const normalized = normalizeTitle(signal);
    if (!normalized) {
      continue;
    }
    for (const token of normalized.split(" ")) {
      if (
        token.length < 3 ||
        STOPWORDS.has(token) ||
        /^\d+$/.test(token)
      ) {
        continue;
      }
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([term]) => term)
    .slice(0, limit);
}

function bucketFromSignals(params: {
  name: KeywordBucket["name"];
  signals: string[];
  sourceArtifacts: string[];
  rationale: string;
  limit?: number;
}): KeywordBucket {
  return {
    name: params.name,
    terms: extractTerms(params.signals, params.limit ?? 12),
    source_artifacts: params.sourceArtifacts,
    rationale: params.rationale,
  };
}

async function readSignalArtifacts(projectRoot: string): Promise<{
  signalsByArtifact: Record<string, string[]>;
  allSignals: string[];
}> {
  const artifactSpecs = [
    "academic_writer/story/STORY_SPINE.md",
    "academic_writer/story/CROSS_DOMAIN_STORY_BRIDGE.md",
    "researcher/GAP_SYNTHESIS.md",
    "researcher/COVERAGE_SUMMARY.md",
    "researcher/SOTA_MATRIX.md",
    "researcher/ideation/PROBLEM_DECOMPOSITION.md",
    "researcher/ideation/CROSS_DOMAIN_RECONTEXTUALIZATION.md",
  ];
  const signalsByArtifact: Record<string, string[]> = {};
  await Promise.all(
    artifactSpecs.map(async (artifactPath) => {
      const text = await readTextIfExists(
        resolveProjectArtifactPath(projectRoot, artifactPath)
      );
      const lines = collectSignalLines(text, 8);
      if (lines.length > 0) {
        signalsByArtifact[artifactPath] = lines;
      }
    })
  );
  return {
    signalsByArtifact,
    allSignals: Object.values(signalsByArtifact).flat(),
  };
}

function buildKeywordBank(params: {
  generatedAt: string;
  projectId: string | null;
  topic: string | null;
  manifest: Record<string, unknown>;
  signalsByArtifact: Record<string, string[]>;
  reviewIssueSignals: string[];
  citationExpansionPacket: CitationExpansionPacket | null;
}): Record<string, unknown> {
  const researchProgram = asRecord(
    params.manifest.research_program ?? params.manifest.researchProgram
  );
  const targetDomainSignals = uniqueStrings([
    params.topic,
    ...asStringArray(researchProgram?.target_domains ?? researchProgram?.targetDomains),
    ...asStringArray(researchProgram?.domains),
    pickString(researchProgram ?? {}, ["target_domain", "targetDomain"]),
  ].filter((entry): entry is string => Boolean(entry)));
  const metricSignals = uniqueStrings([
    pickString(researchProgram ?? {}, ["primary_metric", "primaryMetric"]),
    pickString(researchProgram ?? {}, ["baseline_reference", "baselineReference"]),
    ...asStringArray(researchProgram?.metrics),
    ...asStringArray(researchProgram?.benchmarks),
  ].filter((entry): entry is string => Boolean(entry)));
  const storySignals = [
    ...(params.signalsByArtifact["academic_writer/story/STORY_SPINE.md"] ?? []),
    ...(params.signalsByArtifact["academic_writer/story/CROSS_DOMAIN_STORY_BRIDGE.md"] ?? []),
    ...(params.signalsByArtifact["researcher/GAP_SYNTHESIS.md"] ?? []),
  ];
  const citationSeedSignals =
    params.citationExpansionPacket?.seeds
      .map((seed) => seed.title ?? seed.canonicalId)
      .filter((entry): entry is string => Boolean(entry)) ?? [];
  const buckets: KeywordBucket[] = [
    bucketFromSignals({
      name: "target_domain",
      signals: targetDomainSignals,
      sourceArtifacts: ["PROJECT_MANIFEST.json"],
      rationale: "Recover the project topic and target domain as the recall anchor.",
    }),
    bucketFromSignals({
      name: "method",
      signals: [
        params.topic ?? "",
        ...(params.signalsByArtifact["researcher/ideation/PROBLEM_DECOMPOSITION.md"] ?? []),
        ...(params.signalsByArtifact[
          "researcher/ideation/CROSS_DOMAIN_RECONTEXTUALIZATION.md"
        ] ?? []),
      ],
      sourceArtifacts: [
        "PROJECT_MANIFEST.json",
        "researcher/ideation/PROBLEM_DECOMPOSITION.md",
        "researcher/ideation/CROSS_DOMAIN_RECONTEXTUALIZATION.md",
      ],
      rationale: "Recover method and mechanism terms needed by research30 query planning.",
    }),
    bucketFromSignals({
      name: "dataset_metric",
      signals: metricSignals,
      sourceArtifacts: ["PROJECT_MANIFEST.json"],
      rationale: "Preserve benchmark, dataset, and metric terms so retrieval does not drift.",
    }),
    bucketFromSignals({
      name: "story_gap",
      signals: storySignals,
      sourceArtifacts: [
        "academic_writer/story/STORY_SPINE.md",
        "academic_writer/story/CROSS_DOMAIN_STORY_BRIDGE.md",
        "researcher/GAP_SYNTHESIS.md",
      ],
      rationale: "Turn storyline and synthesis gaps into explicit retrieval vocabulary.",
    }),
    bucketFromSignals({
      name: "reviewer_concern",
      signals: params.reviewIssueSignals,
      sourceArtifacts: ["reviewer/REVIEW_ISSUES.json"],
      rationale: "Keep reviewer-facing citation, baseline, and related-work concerns queryable.",
    }),
    bucketFromSignals({
      name: "citation_chasing_seed",
      signals: citationSeedSignals,
      sourceArtifacts: ["researcher/CITATION_EXPANSION_PACKET.json"],
      rationale: "Use existing in-corpus seed papers for bounded forward/backward expansion.",
    }),
  ];
  return {
    schema_version: 1,
    generated_at: params.generatedAt,
    project_id: params.projectId,
    topic: params.topic,
    buckets,
    empty_bucket_count: buckets.filter((bucket) => bucket.terms.length === 0).length,
  };
}

function addQueryPlanEntry(
  entries: LiteratureQueryPlanEntry[],
  seen: Set<string>,
  params: Omit<LiteratureQueryPlanEntry, "id">
) {
  const query = params.query.trim().replace(/\s+/g, " ");
  if (!query) {
    return;
  }
  const key = `${query.toLowerCase()}::${params.intent}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  entries.push({
    id: `lrq-${entries.length + 1}`,
    ...params,
    query,
  });
}

function buildLiteratureQueryPlan(params: {
  generatedAt: string;
  projectId: string | null;
  topic: string | null;
  keywordBank: Record<string, unknown>;
  citationExpansionPacket: CitationExpansionPacket | null;
}): Record<string, unknown> {
  const entries: LiteratureQueryPlanEntry[] = [];
  const seen = new Set<string>();
  const topic = params.topic ?? "current project related work evidence";
  const broadPlan = buildBroadPaperSearchPlan({
    topic,
    depth: "deep",
    maxQueries: 10,
  });
  for (const query of broadPlan.queries) {
    addQueryPlanEntry(entries, seen, {
      query: query.query,
      intent: `research30_${query.family}`,
      providers: DEFAULT_PROVIDER_ROUTE,
      requires_papernexus_import: true,
      source_artifacts: ["PROJECT_MANIFEST.json"],
      rationale: query.rationale,
    });
  }
  const buckets = Array.isArray(params.keywordBank.buckets)
    ? params.keywordBank.buckets
    : [];
  for (const bucket of buckets) {
    const record = asRecord(bucket);
    const terms = asStringArray(record?.terms);
    const name = asString(record?.name) ?? "gap";
    if (terms.length === 0 || name === "target_domain") {
      continue;
    }
    addQueryPlanEntry(entries, seen, {
      query: `${topic} ${terms.slice(0, 6).join(" ")}`,
      intent: `close_${name}`,
      providers: DEFAULT_PROVIDER_ROUTE,
      requires_papernexus_import: true,
      source_artifacts: asStringArray(record?.source_artifacts),
      rationale:
        asString(record?.rationale) ??
        `Close the ${name} literature gap with source-backed retrieval.`,
    });
  }
  for (const query of params.citationExpansionPacket?.queries ?? []) {
    addQueryPlanEntry(entries, seen, {
      query: query.query,
      intent: query.type,
      providers: ["papernexus_corpus_lookup", "research30_semanticscholar"],
      requires_papernexus_import: true,
      source_artifacts: ["researcher/CITATION_EXPANSION_PACKET.json"],
      rationale: query.rationale,
    });
  }
  return {
    schema_version: 1,
    generated_at: params.generatedAt,
    project_id: params.projectId,
    topic: params.topic,
    preferred_venue_packs: broadPlan.preferredVenuePacks,
    queries: entries,
    next_executor_contract: {
      workflow_tool: "research_workflow.run_broad_paper_search",
      paper_ingestion_followup:
        "stage selected source-backed candidates, import them through PaperNexus, then rerun graph_build",
    },
  };
}

const CONTROLLER_PROVIDER_MAP: Record<string, BroadPaperProviderName | null> = {
  research30_openalex: "openalex",
  research30_semanticscholar: "semanticscholar",
  research30_crossref: "crossref",
  research30_dblp: "dblp",
  research30_core: "core",
  research30_papers_cool: "papers_cool",
  research30_pasa: "pasa",
  papernexus_corpus_lookup: null,
  "papernexus-corpus": null,
  citation_expansion: null,
  "citation-expansion": null,
};

function normalizeControllerProviderName(value: string): BroadPaperProviderName | null {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  return CONTROLLER_PROVIDER_MAP[key] ?? normalizeBroadPaperProviderName(value);
}

function normalizeControllerQueryFamily(intent: string | null): BroadPaperSearchQuery["family"] {
  const normalized = String(intent ?? "").toLowerCase();
  if (normalized.includes("venue")) {
    return "venue_pack";
  }
  if (normalized.includes("baseline") || normalized.includes("benchmark")) {
    return "task_method";
  }
  if (normalized.includes("semantic") || normalized.includes("story")) {
    return "paragraph_semantic";
  }
  if (normalized.includes("synonym") || normalized.includes("citation")) {
    return "synonym";
  }
  return "keyword_refresh";
}

export function buildBroadPaperSearchQueriesFromControllerPlan(
  queryPlan: Record<string, unknown>,
  maxQueries?: number | null
): {
  queries: BroadPaperSearchQuery[];
  providerNames: BroadPaperProviderName[];
  preferredVenuePacks: string[];
} {
  const rawQueries = Array.isArray(queryPlan.queries) ? queryPlan.queries : [];
  const queryLimit =
    typeof maxQueries === "number" && Number.isFinite(maxQueries)
      ? Math.max(1, Math.min(24, Math.floor(maxQueries)))
      : 12;
  const seenQueries = new Set<string>();
  const seenProviders = new Set<BroadPaperProviderName>();
  const queries: BroadPaperSearchQuery[] = [];
  for (const rawQuery of rawQueries) {
    const record = asRecord(rawQuery);
    if (!record) {
      continue;
    }
    const query = asString(record.query)?.trim().replace(/\s+/g, " ");
    if (!query) {
      continue;
    }
    const key = query.toLowerCase();
    if (seenQueries.has(key)) {
      continue;
    }
    seenQueries.add(key);
    const providers = asStringArray(record.providers)
      .map((provider) => normalizeControllerProviderName(provider))
      .filter((provider): provider is BroadPaperProviderName => Boolean(provider));
    for (const provider of providers) {
      seenProviders.add(provider);
    }
    queries.push({
      id: asString(record.id) ?? `lrq-${queries.length + 1}`,
      query,
      family: normalizeControllerQueryFamily(asString(record.intent)),
      rationale:
        asString(record.rationale) ??
        "Execute a controller-derived literature query.",
      domain: asString(record.domain) ?? null,
      venuePack: asString(record.venue_pack ?? record.venuePack) ?? null,
    });
    if (queries.length >= queryLimit) {
      break;
    }
  }
  const preferredVenuePacks = asStringArray(queryPlan.preferred_venue_packs);
  return {
    queries,
    providerNames:
      seenProviders.size > 0
        ? [...seenProviders]
        : DEFAULT_BROAD_PAPER_PROVIDERS,
    preferredVenuePacks,
  };
}

async function readIncludedPapers(projectRoot: string): Promise<Record<string, unknown>[]> {
  const raw = await readJsonIfExists<unknown>(
    resolveProjectArtifactPath(projectRoot, "researcher/INCLUDED_PAPERS.json")
  );
  return collectSurveyEntries(raw, ["papers", "included", "includedPapers", "items"]);
}

function buildCandidateScreeningReport(params: {
  generatedAt: string;
  projectId: string | null;
  sourceEntries: WorkflowPaperSourceEntry[];
  includedPapers: Record<string, unknown>[];
  maxCandidateRecords: number;
}): Record<string, unknown> {
  const includedKeys = new Set(
    params.includedPapers.flatMap((entry) => identityKeysFromRawPaper(entry))
  );
  const sourceEntryKeys = new Set(
    params.sourceEntries.flatMap((entry) => identityKeysFromSourceEntry(entry))
  );
  const records: CandidateScreeningRecord[] = params.sourceEntries.map((entry) => {
    const included = identityKeysFromSourceEntry(entry).some((key) =>
      includedKeys.has(key)
    );
    const sourceBacked = isSourceBacked(entry);
    const screeningStatus: CandidateScreeningRecord["screening_status"] = included
      ? sourceBacked
        ? "accepted_existing_corpus"
        : "included_metadata_only_needs_import"
      : sourceBacked
        ? "background_existing_corpus"
        : "metadata_only_needs_import";
    return {
      canonical_id: entry.canonicalId,
      title: entry.title,
      year: entry.year,
      venue: entry.venue,
      doi: entry.doi,
      arxiv_id: entry.arxivId,
      source_path: entry.sourcePath,
      resolution_status: entry.resolutionStatus,
      source_backed: sourceBacked,
      included_paper: included,
      screening_status: screeningStatus,
    };
  });
  for (const included of params.includedPapers) {
    const keys = identityKeysFromRawPaper(included);
    if (keys.some((key) => sourceEntryKeys.has(key))) {
      continue;
    }
    records.push({
      canonical_id: pickString(included, [
        "canonical_id",
        "canonicalId",
        "id",
        "paper_id",
        "paperId",
      ]),
      title: pickString(included, ["title", "paper_title", "paperTitle", "name"]),
      year:
        typeof included.year === "number" && Number.isFinite(included.year)
          ? Math.floor(included.year)
          : null,
      venue: pickString(included, ["venue", "conference", "journal"]),
      doi: pickString(included, ["doi"]),
      arxiv_id: pickString(included, ["arxiv_id", "arxivId", "arxiv"]),
      source_path: null,
      resolution_status: null,
      source_backed: false,
      included_paper: true,
      screening_status: "included_not_in_source_index",
    });
  }
  const statusCounts = records.reduce<Record<string, number>>((counts, record) => {
    counts[record.screening_status] = (counts[record.screening_status] ?? 0) + 1;
    return counts;
  }, {});
  return {
    schema_version: 1,
    generated_at: params.generatedAt,
    project_id: params.projectId,
    summary: {
      source_index_paper_count: params.sourceEntries.length,
      included_paper_count: params.includedPapers.length,
      source_backed_count: records.filter((record) => record.source_backed).length,
      metadata_or_missing_source_count: records.filter(
        (record) => !record.source_backed
      ).length,
      included_missing_from_source_index_count:
        statusCounts.included_not_in_source_index ?? 0,
      status_counts: statusCounts,
      omitted_candidate_count: Math.max(
        0,
        records.length - params.maxCandidateRecords
      ),
    },
    candidates: records.slice(0, params.maxCandidateRecords),
  };
}

function readGraphCertification(raw: unknown): {
  status: string;
  sourceBackedGraphClaim: boolean;
  claimLevel: string | null;
  importTaskCount: number;
  completedImportTaskCount: number;
} {
  const record = asRecord(raw);
  const upload = asRecord(record?.upload);
  const importTasks = asRecord(upload?.import_tasks ?? upload?.importTasks);
  return {
    status: asString(record?.status) ?? "missing",
    sourceBackedGraphClaim: record?.source_backed_graph_claim === true,
    claimLevel: asString(record?.claim_level ?? record?.claimLevel),
    importTaskCount:
      typeof importTasks?.task_count === "number" && Number.isFinite(importTasks.task_count)
        ? Math.floor(importTasks.task_count)
        : 0,
    completedImportTaskCount:
      typeof importTasks?.completed_task_count === "number" &&
      Number.isFinite(importTasks.completed_task_count)
        ? Math.floor(importTasks.completed_task_count)
        : 0,
  };
}

function buildNeedReasons(params: {
  topic: string | null;
  coverageAudit: LiteratureCoverageAudit;
  candidateScreeningReport: Record<string, unknown>;
  graphCertification: ReturnType<typeof readGraphCertification>;
  reviewIssueSignals: string[];
  minCorePapers: number;
  minRecentPapers: number;
}): LiteratureNeedReason[] {
  const summary = asRecord(params.candidateScreeningReport.summary) ?? {};
  const reasons: LiteratureNeedReason[] = [];
  const sourceIndexPaperCount =
    typeof summary.source_index_paper_count === "number"
      ? summary.source_index_paper_count
      : 0;
  const metadataOrMissingSourceCount =
    typeof summary.metadata_or_missing_source_count === "number"
      ? summary.metadata_or_missing_source_count
      : 0;
  const includedMissingFromSourceIndexCount =
    typeof summary.included_missing_from_source_index_count === "number"
      ? summary.included_missing_from_source_index_count
      : 0;
  if (!params.topic) {
    reasons.push({
      code: "missing_project_topic",
      severity: sourceIndexPaperCount === 0 ? "critical" : "medium",
      summary:
        "Project topic is not explicit in PROJECT_MANIFEST.json; query planning must fall back to generic related-work wording.",
      source_artifacts: ["PROJECT_MANIFEST.json"],
    });
  }
  if (params.coverageAudit.totalPapers < params.minCorePapers) {
    reasons.push({
      code: "thin_core_literature",
      severity: "high",
      summary: `Core literature count is ${params.coverageAudit.totalPapers}; expected at least ${params.minCorePapers}.`,
      source_artifacts: [
        "researcher/PAPER_SOURCE_INDEX.json",
        "researcher/INCLUDED_PAPERS.json",
      ],
    });
  }
  if (params.coverageAudit.recentPaperCount < params.minRecentPapers) {
    reasons.push({
      code: "weak_recent_literature",
      severity: "medium",
      summary: `Recent-paper coverage is ${params.coverageAudit.recentPaperCount}; expected at least ${params.minRecentPapers}.`,
      source_artifacts: ["researcher/LITERATURE_COVERAGE_AUDIT.json"],
    });
  }
  if (
    params.coverageAudit.pendingRoundCount > 0 ||
    params.coverageAudit.pendingScreeningCount > 0
  ) {
    reasons.push({
      code: "pending_retrieval_or_screening",
      severity: "high",
      summary: `Retrieval/screening is still pending: rounds=${params.coverageAudit.pendingRoundCount}, papers=${params.coverageAudit.pendingScreeningCount}.`,
      source_artifacts: [
        "researcher/SURVEY_QUERY_REGISTRY.json",
        "researcher/CANDIDATE_SCREENING_DECISIONS.json",
      ],
    });
  }
  if (metadataOrMissingSourceCount > 0 || includedMissingFromSourceIndexCount > 0) {
    reasons.push({
      code: "metadata_only_or_unindexed_sources",
      severity: "high",
      summary: `Source-backed screening has gaps: metadata/missing=${metadataOrMissingSourceCount}, included_not_indexed=${includedMissingFromSourceIndexCount}.`,
      source_artifacts: [
        "researcher/PAPER_SOURCE_INDEX.json",
        "researcher/INCLUDED_PAPERS.json",
      ],
    });
  }
  if (!params.graphCertification.sourceBackedGraphClaim) {
    reasons.push({
      code: "graph_not_source_backed",
      severity: sourceIndexPaperCount > 0 ? "medium" : "high",
      summary:
        "PaperNexus graph certification is missing source-backed per-paper evidence; imported graph claims must stay guarded.",
      source_artifacts: ["graph/PAPERNEXUS_TASK_CERTIFICATION.json"],
    });
  }
  if (params.coverageAudit.missingBaselineHints.length > 0) {
    reasons.push({
      code: "missing_baseline_hints",
      severity: "high",
      summary: `Baseline hints are absent from the source index: ${params.coverageAudit.missingBaselineHints.join(", ")}.`,
      source_artifacts: ["PROJECT_MANIFEST.json", "researcher/PAPER_SOURCE_INDEX.json"],
    });
  }
  const reviewLiteratureConcerns = params.reviewIssueSignals.filter((signal) =>
    /literature|related work|citation|baseline|sota|prior work/i.test(signal)
  );
  if (reviewLiteratureConcerns.length > 0) {
    reasons.push({
      code: "open_reviewer_literature_concern",
      severity: "medium",
      summary: `${reviewLiteratureConcerns.length} open reviewer issue(s) mention literature, citation, baseline, or SOTA coverage.`,
      source_artifacts: ["reviewer/REVIEW_ISSUES.json"],
    });
  }
  return reasons;
}

function chooseDecision(params: {
  reasons: LiteratureNeedReason[];
  coverageAudit: LiteratureCoverageAudit;
}): LiteratureControllerDecision {
  if (params.reasons.some((reason) => reason.severity === "critical")) {
    return "blocked";
  }
  if (
    params.coverageAudit.verdict === "thin" ||
    params.reasons.some((reason) => reason.severity === "high")
  ) {
    return "continue_research";
  }
  if (
    params.coverageAudit.verdict === "adequate" ||
    params.reasons.some((reason) => reason.severity === "medium")
  ) {
    return "proceed_with_guardrails";
  }
  return "stop_and_proceed";
}

function statusFromDecision(
  decision: LiteratureControllerDecision
): LiteratureResearchControllerArtifacts["status"] {
  if (decision === "blocked") {
    return "blocked";
  }
  if (decision === "continue_research") {
    return "needs_research";
  }
  if (decision === "proceed_with_guardrails") {
    return "guardrailed";
  }
  return "ready";
}

function computeCoverageScore(params: {
  coverageAudit: LiteratureCoverageAudit;
  candidateScreeningReport: Record<string, unknown>;
  graphCertification: ReturnType<typeof readGraphCertification>;
  queryPlan: Record<string, unknown>;
  minCorePapers: number;
  minRecentPapers: number;
}): number {
  const summary = asRecord(params.candidateScreeningReport.summary) ?? {};
  const sourceBackedCount =
    typeof summary.source_backed_count === "number" ? summary.source_backed_count : 0;
  const sourceIndexPaperCount =
    typeof summary.source_index_paper_count === "number"
      ? summary.source_index_paper_count
      : 0;
  const metadataOrMissingSourceCount =
    typeof summary.metadata_or_missing_source_count === "number"
      ? summary.metadata_or_missing_source_count
      : 0;
  const sourceBackingRatio =
    sourceIndexPaperCount > 0 ? sourceBackedCount / sourceIndexPaperCount : 0;
  const queries = Array.isArray(params.queryPlan.queries)
    ? params.queryPlan.queries
    : [];
  const score =
    Math.min(35, (params.coverageAudit.totalPapers / params.minCorePapers) * 35) +
    Math.min(15, (params.coverageAudit.recentPaperCount / params.minRecentPapers) * 15) +
    (params.coverageAudit.pendingRoundCount === 0 &&
    params.coverageAudit.pendingScreeningCount === 0
      ? 10
      : 0) +
    (params.coverageAudit.missingBaselineHints.length === 0 ? 10 : 0) +
    (params.graphCertification.sourceBackedGraphClaim ? 15 : 0) +
    Math.max(0, 10 * sourceBackingRatio - Math.min(8, metadataOrMissingSourceCount)) +
    Math.min(5, queries.length);
  return Math.round(Math.max(0, Math.min(100, score)));
}

function buildNextActions(params: {
  decision: LiteratureControllerDecision;
  reasons: LiteratureNeedReason[];
  queryPlan: Record<string, unknown>;
  citationExpansionPacket: CitationExpansionPacket | null;
}): string[] {
  const actions: string[] = [];
  if (params.decision === "blocked") {
    actions.push("record an explicit project topic and seed PAPER_SOURCE_INDEX.json before continuing");
  }
  if (params.reasons.some((reason) => reason.code === "thin_core_literature")) {
    actions.push("run research_workflow.run_broad_paper_search with the generated literature_query_plan");
  }
  if (
    params.reasons.some(
      (reason) =>
        reason.code === "metadata_only_or_unindexed_sources" ||
        reason.code === "graph_not_source_backed"
    )
  ) {
    actions.push(
      "stage selected source-backed papers, import them through PaperNexus, and rerun graph_build"
    );
  }
  if (params.citationExpansionPacket) {
    actions.push("execute the generated citation expansion packet for bounded forward/backward paper discovery");
  }
  if (
    params.reasons.some((reason) => reason.code === "open_reviewer_literature_concern")
  ) {
    actions.push("resolve reviewer literature/citation issues after the refreshed source index is available");
  }
  const queries = Array.isArray(params.queryPlan.queries) ? params.queryPlan.queries : [];
  if (queries.length === 0) {
    actions.push("repair query planning inputs because no executable literature query was produced");
  }
  if (actions.length === 0) {
    actions.push("none");
  }
  return uniqueStrings(actions);
}

function buildMarkdownStatus(params: {
  generatedAt: string;
  projectId: string | null;
  topic: string | null;
  status: string;
  decision: LiteratureControllerDecision;
  coverageScore100: number;
  reasons: LiteratureNeedReason[];
  nextActions: string[];
  paths: ReturnType<typeof buildArtifactPaths>;
  projectRoot: string;
}): string {
  const bullet = (items: string[]) =>
    items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- none";
  return `# Literature Research Controller Status

- generated_at: ${params.generatedAt}
- project_id: ${params.projectId ?? "unknown"}
- topic: ${params.topic ?? "unknown"}
- status: ${params.status}
- decision: ${params.decision}
- coverage_score_100: ${params.coverageScore100}

## Need Reasons

${bullet(
  params.reasons.map(
    (reason) => `${reason.severity}/${reason.code}: ${reason.summary}`
  )
)}

## Next Actions

${bullet(params.nextActions)}

## Artifacts

- need_assessment: ${relativePathFromProject(params.projectRoot, params.paths.needAssessmentPath)}
- keyword_bank: ${relativePathFromProject(params.projectRoot, params.paths.keywordBankPath)}
- query_plan: ${relativePathFromProject(params.projectRoot, params.paths.queryPlanPath)}
- candidate_screening_report: ${relativePathFromProject(params.projectRoot, params.paths.candidateScreeningReportPath)}
- coverage_report: ${relativePathFromProject(params.projectRoot, params.paths.coverageReportPath)}
- run_receipt: ${relativePathFromProject(params.projectRoot, params.paths.runReceiptPath)}
- provider_result_index: ${relativePathFromProject(params.projectRoot, params.paths.providerResultIndexPath)}
- papernexus_import_batch_manifest: ${relativePathFromProject(params.projectRoot, params.paths.papernexusImportBatchManifestPath)}
- papernexus_refresh_report: ${relativePathFromProject(params.projectRoot, params.paths.papernexusRefreshReportPath)}
- citation_expansion_report: ${relativePathFromProject(params.projectRoot, params.paths.citationExpansionReportPath)}
- snippet_evidence_report: ${relativePathFromProject(params.projectRoot, params.paths.snippetEvidenceReportPath)}
- trace: ${relativePathFromProject(params.projectRoot, params.paths.tracePath)}
- repair_log: ${relativePathFromProject(params.projectRoot, params.paths.repairLogPath)}
`;
}

function coverageScoreFromController(
  controller: LiteratureResearchControllerArtifacts
): number | null {
  const score = asRecord(controller.coverage_report)?.coverage_score_100;
  return typeof score === "number" && Number.isFinite(score)
    ? Math.round(score)
    : null;
}

function blockingGapCountFromController(
  controller: LiteratureResearchControllerArtifacts
): number | null {
  const report = asRecord(controller.coverage_report);
  const reasons = Array.isArray(report?.need_reasons) ? report.need_reasons : [];
  return reasons.filter((entry) => {
    const record = asRecord(entry);
    return record?.severity === "critical" || record?.severity === "high";
  }).length;
}

function nextActionsFromController(
  controller: LiteratureResearchControllerArtifacts
): string[] {
  return asStringArray(asRecord(controller.coverage_report)?.next_actions);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pickFiniteNumber(record: Record<string, unknown> | null, keys: string[]): number | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = finiteNumber(record[key]);
    if (value != null) {
      return value;
    }
  }
  return null;
}

function countStrings(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function asNumberMap(raw: unknown): Record<string, number | null> {
  const record = asRecord(raw);
  if (!record) {
    return {};
  }
  const normalized: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(record)) {
    const numeric = finiteNumber(value);
    normalized[key] = numeric;
  }
  return normalized;
}

function isResolvedSourceStatus(value: string | null): boolean {
  return value === "resolved_markdown" || value === "resolved_pdf";
}

function buildProviderCandidateIndexRecord(
  candidate: MergedPaperCandidate
): ProviderCandidateIndexRecord {
  const serialized = serializeMergedPaperCandidate(candidate);
  const sourcePath = pickString(serialized, ["source_path", "sourcePath"]);
  const resolutionStatus = pickString(serialized, [
    "resolution_status",
    "resolutionStatus",
  ]);
  const sourceBacked = Boolean(sourcePath && isResolvedSourceStatus(resolutionStatus));
  const topicRelevanceScore = pickFiniteNumber(serialized, [
    "topic_relevance_score",
    "topicRelevanceScore",
  ]);
  const providerAgreementCount =
    pickFiniteNumber(serialized, [
      "provider_agreement_count",
      "providerAgreementCount",
    ]) ?? 0;
  const pdfUrl = pickString(serialized, ["pdf_url", "pdfUrl"]);
  const bestOaUrl = pickString(serialized, ["best_oa_url", "bestOaUrl"]);
  const riskFlags = uniqueStrings([
    resolutionStatus === "metadata_only_unresolved" ? "metadata_only" : null,
    !sourcePath ? "missing_local_source" : null,
    !pdfUrl && !bestOaUrl ? "missing_open_access_url" : null,
    topicRelevanceScore != null && topicRelevanceScore < 18
      ? "low_topic_relevance"
      : null,
    providerAgreementCount < 2 ? "single_provider_candidate" : null,
  ].filter((value): value is string => Boolean(value)));
  const executionDecision: ProviderCandidateDecision = sourceBacked &&
    (topicRelevanceScore == null || topicRelevanceScore >= 18)
    ? "selected_for_import"
    : resolutionStatus === "metadata_only_unresolved" &&
        (topicRelevanceScore == null || topicRelevanceScore >= 30)
      ? "defer_needs_source"
      : topicRelevanceScore != null && topicRelevanceScore < 18
        ? "exclude_low_relevance"
        : "background_candidate";
  return {
    canonical_id: pickString(serialized, ["canonical_id", "canonicalId"]),
    title: pickString(serialized, ["title"]),
    year: pickFiniteNumber(serialized, ["year"]),
    venue: pickString(serialized, ["venue"]),
    doi: pickString(serialized, ["doi"]),
    arxiv_id: pickString(serialized, ["arxiv_id", "arxivId"]),
    source_path: sourcePath,
    pdf_url: pdfUrl,
    best_oa_url: bestOaUrl,
    resolution_status: resolutionStatus,
    source_backed: sourceBacked,
    provider_agreement_count: providerAgreementCount,
    query_ids: asStringArray(serialized.query_ids ?? serialized.queryIds),
    provider_scores: asNumberMap(serialized.provider_scores ?? serialized.providerScores),
    recall_score: pickFiniteNumber(serialized, ["recall_score", "recallScore"]),
    selection_score: pickFiniteNumber(serialized, [
      "selection_score",
      "selectionScore",
    ]),
    topic_relevance_score: topicRelevanceScore,
    matched_topic_tokens: asStringArray(
      serialized.matched_topic_tokens ?? serialized.matchedTopicTokens
    ),
    topic_relevance_evidence_source:
      pickString(serialized, [
        "topic_relevance_evidence_source",
        "topicRelevanceEvidenceSource",
      ]),
    execution_decision: executionDecision,
    risk_flags: riskFlags,
  };
}

function buildProviderResultIndexArtifact(params: {
  projectRoot: string;
  generatedAt: string;
  trigger: string;
  controllerBefore: LiteratureResearchControllerArtifacts;
  executed: boolean;
  skipReason: string | null;
  searchExecution: LiteratureResearchControllerRunReceipt["search_execution"];
  providerQueryResults: BroadPaperProviderQueryResult[];
  mergedCandidates: MergedPaperCandidate[];
}): ProviderResultIndexArtifact {
  const providerQueryResults = params.providerQueryResults.map((result) => ({
    provider: result.provider,
    query_id: result.queryId,
    status: result.status,
    total_hits: result.totalHits,
    hit_count: result.hits.length,
    warning_count: result.warnings.length,
    error: result.error,
    availability: result.capabilities.availability,
  }));
  const candidates = params.mergedCandidates
    .map((candidate) => buildProviderCandidateIndexRecord(candidate))
    .slice(0, 300);
  const providerNames = params.searchExecution?.provider_names?.length
    ? params.searchExecution.provider_names
    : Array.from(new Set(params.providerQueryResults.map((result) => result.provider)));
  return {
    schema_version: 1,
    generated_at: params.generatedAt,
    project_id: params.controllerBefore.project_id,
    project_root: params.projectRoot,
    topic: params.searchExecution?.topic ?? params.controllerBefore.topic,
    trigger: params.trigger,
    status: params.executed ? "executed" : "skipped",
    skip_reason: params.skipReason,
    provider_names: providerNames,
    query_count: params.searchExecution?.query_count ?? 0,
    provider_query_count: providerQueryResults.length,
    provider_status_counts: countStrings(providerQueryResults.map((result) => result.status)),
    total_hit_count: providerQueryResults.reduce(
      (sum, result) => sum + result.total_hits,
      0
    ),
    merged_candidate_count:
      params.searchExecution?.candidate_count ?? params.mergedCandidates.length,
    resolved_source_count:
      params.searchExecution?.resolved_source_count ??
      candidates.filter((candidate) => candidate.source_backed).length,
    metadata_only_count:
      params.searchExecution?.metadata_only_count ??
      candidates.filter(
        (candidate) => candidate.resolution_status === "metadata_only_unresolved"
      ).length,
    selected_for_import_count: candidates.filter(
      (candidate) => candidate.execution_decision === "selected_for_import"
    ).length,
    search_artifacts: params.searchExecution?.artifacts ?? null,
    provider_query_results: providerQueryResults,
    candidates,
  };
}

function buildPapernexusImportBatchManifestArtifact(params: {
  projectRoot: string;
  generatedAt: string;
  trigger: string;
  projectId: string | null;
  papernexusImport: Record<string, unknown> | null;
}): PapernexusImportBatchManifestArtifact {
  const record = asRecord(params.papernexusImport);
  const request = asRecord(record?.request);
  const queued = record?.queued === true;
  const reason = pickString(record ?? {}, ["reason"]);
  const status: PapernexusImportBatchManifestArtifact["status"] = !record
    ? "not_started"
    : queued
      ? "queued"
      : reason === "active_papernexus_import_request_exists"
        ? "active_request_exists"
        : reason?.includes("disabled") || reason?.includes("skipped")
          ? "skipped"
          : "not_queued";
  return {
    schema_version: 1,
    generated_at: params.generatedAt,
    project_id: params.projectId,
    project_root: params.projectRoot,
    trigger: params.trigger,
    status,
    queued,
    reason,
    request_id:
      pickString(request ?? {}, ["requestId", "request_id"]) ??
      pickString(record ?? {}, ["request_id", "requestId"]),
    wrapper:
      pickString(request ?? {}, ["wrapper"]) ??
      pickString(record ?? {}, ["wrapper"]),
    command_text:
      pickString(request ?? {}, ["commandText", "command_text"]) ??
      pickString(record ?? {}, ["commandText", "command_text"]),
    manifest_path:
      pickString(request ?? {}, ["manifestPath", "manifest_path"]) ??
      pickString(record ?? {}, ["manifest_path", "manifestPath"]),
    source_index_path: pickString(record ?? {}, [
      "source_index_path",
      "sourceIndexPath",
    ]),
    shared_corpus:
      pickString(request ?? {}, ["sharedCorpus", "shared_corpus"]) ??
      pickString(record ?? {}, ["shared_corpus", "sharedCorpus"]),
    importable_paper_count: pickFiniteNumber(record, [
      "importable_paper_count",
      "importablePaperCount",
    ]),
    paper_count:
      pickFiniteNumber(request, ["paperCount", "paper_count"]) ??
      pickFiniteNumber(record, ["paper_count", "paperCount"]),
    raw_papernexus_import: record,
  };
}

function buildPapernexusRefreshReportArtifact(params: {
  projectRoot: string;
  generatedAt: string;
  trigger: string;
  projectId: string | null;
  executed: boolean;
  nextRoute: LiteratureResearchControllerRunReceipt["next_route"];
  importManifest: PapernexusImportBatchManifestArtifact;
}): PapernexusRefreshReportArtifact {
  const status: PapernexusRefreshReportArtifact["status"] = params.importManifest.queued
    ? "queued_graph_build"
    : params.importManifest.status === "active_request_exists"
      ? "waiting_for_active_import"
      : !params.executed || params.importManifest.status === "skipped"
        ? "skipped"
        : params.importManifest.reason === "no_importable_staged_sources"
          ? "pending_no_importable_sources"
          : params.nextRoute === "rerun_failed_gate"
            ? "needs_rerun_failed_gate"
            : params.nextRoute === "none"
              ? "none"
              : "not_started";
  const graphBuildExpected =
    status === "queued_graph_build" || status === "waiting_for_active_import";
  const nextAction = graphBuildExpected
    ? "wait for PaperNexus import completion, then run graph_build"
    : status === "pending_no_importable_sources"
      ? "rerun source resolution or widen provider discovery before graph_build"
      : status === "needs_rerun_failed_gate"
        ? "rerun the failed literature/review gate with current controller artifacts"
        : status === "skipped"
          ? "no graph refresh was scheduled in this controller run"
          : "none";
  return {
    schema_version: 1,
    generated_at: params.generatedAt,
    project_id: params.projectId,
    project_root: params.projectRoot,
    trigger: params.trigger,
    status,
    graph_build_expected: graphBuildExpected,
    next_route: params.nextRoute,
    reason: params.importManifest.reason,
    import_request_id: params.importManifest.request_id,
    import_manifest_path: params.importManifest.manifest_path,
    source_index_path: params.importManifest.source_index_path,
    next_action: nextAction,
  };
}

async function buildCitationExpansionReportArtifact(params: {
  projectRoot: string;
  generatedAt: string;
  trigger: string;
  projectId: string | null;
  citationExpansionPacket: CitationExpansionPacket | null;
  autoCitationVerification: Record<string, unknown> | null;
  executed: boolean;
}): Promise<CitationExpansionReportArtifact> {
  const packet = params.citationExpansionPacket;
  const snowballing = await buildCitationSnowballingReport({
    projectRoot: params.projectRoot,
    citationExpansionPacket: packet,
    executed: params.executed,
  });
  return {
    schema_version: 1,
    generated_at: params.generatedAt,
    project_id: params.projectId,
    project_root: params.projectRoot,
    trigger: params.trigger,
    status: packet ? "planned" : params.executed ? "not_required" : "skipped",
    bounded: packet?.bounded === true,
    max_seeds: packet?.maxSeeds ?? null,
    seed_count: packet?.seeds.length ?? 0,
    query_count: packet?.queries.length ?? 0,
    packet_path: packet?.packetPath ?? null,
    markdown_path: packet?.markdownPath ?? null,
    query_types: countStrings(packet?.queries.map((query) => query.type) ?? []),
    recommendations: packet?.recommendations ?? [],
    auto_citation_verification: params.autoCitationVerification,
    snowballing,
  };
}

function summarizeProviderResultIndex(
  artifact: ProviderResultIndexArtifact,
  artifactPath: string
): Record<string, unknown> {
  return {
    path: artifactPath,
    status: artifact.status,
    provider_query_count: artifact.provider_query_count,
    provider_status_counts: artifact.provider_status_counts,
    merged_candidate_count: artifact.merged_candidate_count,
    resolved_source_count: artifact.resolved_source_count,
    metadata_only_count: artifact.metadata_only_count,
    selected_for_import_count: artifact.selected_for_import_count,
  };
}

function summarizePapernexusImportBatchManifest(
  artifact: PapernexusImportBatchManifestArtifact,
  artifactPath: string
): Record<string, unknown> {
  return {
    path: artifactPath,
    status: artifact.status,
    queued: artifact.queued,
    reason: artifact.reason,
    request_id: artifact.request_id,
    manifest_path: artifact.manifest_path,
    importable_paper_count: artifact.importable_paper_count,
    paper_count: artifact.paper_count,
  };
}

function summarizePapernexusRefreshReport(
  artifact: PapernexusRefreshReportArtifact,
  artifactPath: string
): Record<string, unknown> {
  return {
    path: artifactPath,
    status: artifact.status,
    graph_build_expected: artifact.graph_build_expected,
    next_route: artifact.next_route,
    next_action: artifact.next_action,
  };
}

const SOURCE_INDEX_RECORD_KEYS = [
  "papers",
  "entries",
  "items",
  "sources",
  "canonical_papers",
  "canonicalPapers",
] as const;

const CITATION_RELATION_FIELDS: Record<CitationSnowballingMode, string[]> = {
  backward_references: [
    "references",
    "reference_papers",
    "referencePapers",
    "backward_references",
    "backwardReferences",
    "outbound_citations",
    "outboundCitations",
  ],
  forward_citations: [
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
  co_citation: [
    "co_citations",
    "coCitations",
    "co_cited_papers",
    "coCitedPapers",
    "related_papers",
    "relatedPapers",
  ],
  bibliographic_coupling: [
    "shared_references",
    "sharedReferences",
    "bibliographic_coupling",
    "bibliographicCoupling",
    "coupled_papers",
    "coupledPapers",
  ],
};

function collectRawSourceIndexRecords(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }
  const record = asRecord(raw);
  if (!record) {
    return [];
  }
  for (const key of SOURCE_INDEX_RECORD_KEYS) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry));
    }
    const nested = asRecord(value);
    if (nested) {
      const entries: Record<string, unknown>[] = [];
      for (const [nestedKey, entry] of Object.entries(nested)) {
        const entryRecord = asRecord(entry);
        if (!entryRecord) {
          continue;
        }
        entries.push({
          canonical_id:
            pickString(entryRecord, ["canonical_id", "canonicalId"]) ??
            nestedKey,
          ...entryRecord,
        });
      }
      return entries;
    }
  }
  const entries: Record<string, unknown>[] = [];
  for (const [key, entry] of Object.entries(record)) {
    const entryRecord = asRecord(entry);
    if (!entryRecord) {
      continue;
    }
    entries.push({
      canonical_id:
        pickString(entryRecord, ["canonical_id", "canonicalId"]) ?? key,
      ...entryRecord,
    });
  }
  return entries;
}

function candidateFromCitationRelation(params: {
  seed: CitationExpansionPacket["seeds"][number];
  sourceField: string;
  relation: unknown;
}): CitationSnowballingCandidate | null {
  if (typeof params.relation === "string") {
    const value = params.relation.trim();
    if (!value) {
      return null;
    }
    return {
      seed_canonical_id: params.seed.canonicalId,
      seed_title: params.seed.title,
      canonical_id: normalizeIdentity(value),
      title: value,
      doi: null,
      arxiv_id: null,
      year: null,
      venue: null,
      source_field: params.sourceField,
      source_status: "string_relation",
    };
  }
  const record = asRecord(params.relation);
  if (!record) {
    return null;
  }
  const title = pickString(record, ["title", "paper_title", "paperTitle", "name"]);
  const doi = pickString(record, ["doi"]);
  const arxivId = pickString(record, ["arxiv_id", "arxivId", "arxiv"]);
  const canonicalId =
    pickString(record, ["canonical_id", "canonicalId", "id", "paper_id", "paperId"]) ??
    (doi ? `doi:${doi}` : null) ??
    (arxivId ? `arxiv:${arxivId}` : null) ??
    (title ? `title:${normalizeIdentity(title)}` : null);
  if (!canonicalId && !title) {
    return null;
  }
  return {
    seed_canonical_id: params.seed.canonicalId,
    seed_title: params.seed.title,
    canonical_id: canonicalId,
    title,
    doi,
    arxiv_id: arxivId,
    year: pickFiniteNumber(record, ["year", "publication_year", "publicationYear"]),
    venue: pickString(record, ["venue", "conference", "journal", "container_title"]),
    source_field: params.sourceField,
    source_status: "raw_relation",
  };
}

function findRawRecordForCitationSeed(
  rawRecords: Record<string, unknown>[],
  seed: CitationExpansionPacket["seeds"][number]
): Record<string, unknown> | null {
  const seedKeys = uniqueStrings(
    [seed.canonicalId, seed.title]
      .map((value) => normalizeIdentity(value))
      .filter((value): value is string => Boolean(value))
  );
  if (seedKeys.length === 0) {
    return null;
  }
  return (
    rawRecords.find((record) => {
      const recordKeys = identityKeysFromRawPaper(record);
      return recordKeys.some((key) => seedKeys.includes(key));
    }) ?? null
  );
}

function buildCitationSnowballingModeReport(params: {
  mode: CitationSnowballingMode;
  packet: CitationExpansionPacket;
  rawRecords: Record<string, unknown>[];
}): CitationSnowballingModeReport {
  const candidatesByKey = new Map<string, CitationSnowballingCandidate>();
  let missingSeedMetadataCount = 0;
  for (const seed of params.packet.seeds) {
    const seedRecord = findRawRecordForCitationSeed(params.rawRecords, seed);
    if (!seedRecord) {
      missingSeedMetadataCount += 1;
      continue;
    }
    let seedHasRelations = false;
    for (const field of CITATION_RELATION_FIELDS[params.mode]) {
      const rawRelations = seedRecord[field];
      const relations = Array.isArray(rawRelations)
        ? rawRelations
        : rawRelations
          ? [rawRelations]
          : [];
      for (const relation of relations) {
        const candidate = candidateFromCitationRelation({
          seed,
          sourceField: field,
          relation,
        });
        if (!candidate) {
          continue;
        }
        seedHasRelations = true;
        const key =
          candidate.canonical_id ??
          normalizeIdentity(candidate.title) ??
          `${candidate.seed_canonical_id}:${candidate.source_field}:${candidatesByKey.size}`;
        candidatesByKey.set(key, candidate);
      }
    }
    if (!seedHasRelations) {
      missingSeedMetadataCount += 1;
    }
  }
  const fallbackQueryCount = params.packet.queries.filter((query) => {
    if (params.mode === "backward_references") {
      return query.type === "backward_references";
    }
    if (params.mode === "forward_citations") {
      return query.type === "forward_citations";
    }
    return query.type === "keyword_refresh";
  }).length;
  const candidates = [...candidatesByKey.values()].slice(0, 100);
  return {
    mode: params.mode,
    status:
      candidates.length > 0
        ? "extracted"
        : missingSeedMetadataCount >= params.packet.seeds.length
          ? "missing_seed_metadata"
          : "empty",
    seed_count: params.packet.seeds.length,
    missing_seed_metadata_count: missingSeedMetadataCount,
    candidate_count: candidates.length,
    fallback_query_count: fallbackQueryCount,
    candidates,
  };
}

async function buildCitationSnowballingReport(params: {
  projectRoot: string;
  citationExpansionPacket: CitationExpansionPacket | null;
  executed: boolean;
}): Promise<CitationSnowballingReport> {
  const sourceIndexPath = path.join(
    params.projectRoot,
    "researcher",
    "PAPER_SOURCE_INDEX.json"
  );
  if (!params.citationExpansionPacket) {
    return {
      status: params.executed ? "not_required" : "skipped",
      source_index_path: sourceIndexPath,
      evidence_policy:
        "Citation snowballing produces discovery candidates only; source-backed proof still requires PaperNexus source spans and evidence chains.",
      seed_count: 0,
      total_candidate_count: 0,
      missing_seed_metadata_count: 0,
      mode_counts: {},
      mode_reports: [],
    };
  }
  const rawSourceIndex = await readJsonIfExists<unknown>(sourceIndexPath);
  const rawRecords = collectRawSourceIndexRecords(rawSourceIndex);
  const modeReports = ([
    "backward_references",
    "forward_citations",
    "co_citation",
    "bibliographic_coupling",
  ] as CitationSnowballingMode[]).map((mode) =>
    buildCitationSnowballingModeReport({
      mode,
      packet: params.citationExpansionPacket as CitationExpansionPacket,
      rawRecords,
    })
  );
  const totalCandidateCount = modeReports.reduce(
    (sum, report) => sum + report.candidate_count,
    0
  );
  const missingSeedMetadataCount = modeReports.reduce(
    (sum, report) => sum + report.missing_seed_metadata_count,
    0
  );
  return {
    status: totalCandidateCount > 0 ? "extracted" : "empty",
    source_index_path: sourceIndexPath,
    evidence_policy:
      "Citation snowballing produces discovery candidates only; source-backed proof still requires PaperNexus source spans and evidence chains.",
    seed_count: params.citationExpansionPacket.seeds.length,
    total_candidate_count: totalCandidateCount,
    missing_seed_metadata_count: missingSeedMetadataCount,
    mode_counts: Object.fromEntries(
      modeReports.map((report) => [report.mode, report.candidate_count])
    ),
    mode_reports: modeReports,
  };
}

const SNIPPET_EVIDENCE_MAX_RECORDS = 300;
const SNIPPET_TEXT_LIMIT = 900;

const SOURCE_PATH_FIELDS = [
  "source_path",
  "sourcePath",
  "markdown_path",
  "markdownPath",
  "file_path",
  "filePath",
  "local_path",
  "localPath",
];

const SOURCE_BACKED_QUOTE_FIELDS = [
  "source_span_quote",
  "sourceSpanQuote",
  "source_quote",
  "sourceQuote",
  "evidence_quote",
  "evidenceQuote",
  "quote",
  "source_span",
  "sourceSpan",
  "source_spans",
  "sourceSpans",
  "evidence_span",
  "evidenceSpan",
  "evidence_spans",
  "evidenceSpans",
];

const SOURCE_ANCHOR_FIELDS = [
  "source_span",
  "sourceSpan",
  "source_spans",
  "sourceSpans",
  "source_span_id",
  "sourceSpanId",
  "evidence_span",
  "evidenceSpan",
  "evidence_spans",
  "evidenceSpans",
  "evidence_source_id",
  "evidenceSourceId",
  "page",
  "page_number",
  "pageNumber",
  "section",
];

const EXPLICIT_SNIPPET_FIELDS = [
  "snippet",
  "snippets",
  "snippet_text",
  "snippetText",
  "matched_snippet",
  "matchedSnippet",
  "semantic_scholar_snippet",
  "semanticScholarSnippet",
];

const EVIDENCE_SUMMARY_FIELDS = [
  "evidence_summary",
  "evidenceSummary",
  "summary",
  "tldr",
  "tl_dr",
  "tlDr",
  "takeaway",
];

const ABSTRACT_FALLBACK_FIELDS = [
  "abstract",
  "paper_abstract",
  "paperAbstract",
  "description",
];

function normalizeEvidenceText(value: string | null | undefined): string | null {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return null;
  }
  if (text.length <= SNIPPET_TEXT_LIMIT) {
    return text;
  }
  return `${text.slice(0, SNIPPET_TEXT_LIMIT - 3).trim()}...`;
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
  return (
    pickEvidenceFromFields(record, [
      "text",
      "quote",
      "snippet",
      "summary",
      "abstract",
      "content",
      "paragraph",
    ])?.text ?? null
  );
}

function pickEvidenceFromFields(
  record: Record<string, unknown>,
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

function isDegenerateSnippetStatus(status: string | null): boolean {
  const normalized = String(status ?? "").trim().toLowerCase();
  return [
    "unavailable",
    "missing",
    "none",
    "empty",
    "degenerate",
    "abstract_fallback",
    "abstract-fallback",
    "abstract_only",
    "abstract-only",
  ].includes(normalized);
}

function hasSourceSpanLikeEvidence(record: Record<string, unknown>): boolean {
  return SOURCE_ANCHOR_FIELDS.some((field) => record[field] !== undefined);
}

function quoteFieldImpliesSourceAnchor(field: string): boolean {
  const normalized = field.toLowerCase().replace(/[^a-z]/g, "");
  return normalized.includes("sourcespan") || normalized.includes("sourcequote");
}

function extractRepresentativeSourceQuote(text: string | null): string | null {
  if (!text) {
    return null;
  }
  let inCodeFence = false;
  const plainLines = text
    .split(/\r?\n/)
    .filter((line) => {
      if (/^\s*```/.test(line)) {
        inCodeFence = !inCodeFence;
        return false;
      }
      return !inCodeFence;
    })
    .map((line) => line.trimEnd());
  for (const block of plainLines.join("\n").split(/\n{2,}/)) {
    const cleaned = normalizeEvidenceText(
      block
        .split(/\r?\n/)
        .map((line) => line.replace(/^>\s*/, "").trim())
        .filter((line) => line && !/^#{1,6}\s+/.test(line) && !/^\|/.test(line))
        .join(" ")
    );
    if (cleaned && cleaned.length >= 80) {
      return cleaned;
    }
  }
  return null;
}

async function readSourcePathQuote(params: {
  projectRoot: string;
  sourcePath: string | null;
}): Promise<{ resolvedPath: string | null; exists: boolean; quote: string | null }> {
  if (!params.sourcePath) {
    return { resolvedPath: null, exists: false, quote: null };
  }
  const resolvedPath = resolveProjectArtifactPath(params.projectRoot, params.sourcePath);
  const exists = Boolean(
    resolvedPath &&
      (await fs
        .access(resolvedPath)
        .then(() => true)
        .catch(() => false))
  );
  const text = await readTextIfExists(resolvedPath);
  return {
    resolvedPath,
    exists,
    quote: extractRepresentativeSourceQuote(text),
  };
}

async function buildSnippetEvidenceRecord(params: {
  projectRoot: string;
  rawRecord: Record<string, unknown>;
}): Promise<SnippetEvidenceRecord> {
  const record = params.rawRecord;
  const sourcePath = pickString(record, SOURCE_PATH_FIELDS);
  const snippetStatus = pickString(record, [
    "snippet_status",
    "snippetStatus",
    "evidence_status",
    "evidenceStatus",
  ]);
  const {
    resolvedPath,
    exists: sourcePathExists,
    quote: sourcePathQuote,
  } = await readSourcePathQuote({
    projectRoot: params.projectRoot,
    sourcePath,
  });
  const rawQuote = pickEvidenceFromFields(record, SOURCE_BACKED_QUOTE_FIELDS);
  const anchoredQuote =
    rawQuote &&
    (sourcePathExists ||
      hasSourceSpanLikeEvidence(record) ||
      quoteFieldImpliesSourceAnchor(rawQuote.field))
      ? rawQuote
      : sourcePathQuote
        ? { field: "source_path", text: sourcePathQuote }
        : null;
  const explicitSnippet = pickEvidenceFromFields(record, EXPLICIT_SNIPPET_FIELDS);
  const evidenceSummary =
    (!anchoredQuote && rawQuote ? rawQuote : null) ??
    pickEvidenceFromFields(record, EVIDENCE_SUMMARY_FIELDS);
  const abstractFallback = pickEvidenceFromFields(record, ABSTRACT_FALLBACK_FIELDS);
  const riskFlags: string[] = [];

  let evidenceKind: SnippetEvidenceKind = "unavailable";
  let evidenceText: string | null = null;
  let evidenceSourceField: string | null = null;
  let sourceBacked = false;
  let claimProofEligible = false;

  if (anchoredQuote) {
    evidenceKind = "source_backed_quote";
    evidenceText = anchoredQuote.text;
    evidenceSourceField = anchoredQuote.field;
    sourceBacked = true;
    claimProofEligible = true;
  } else if (explicitSnippet && !isDegenerateSnippetStatus(snippetStatus)) {
    evidenceKind = "explicit_snippet";
    evidenceText = explicitSnippet.text;
    evidenceSourceField = explicitSnippet.field;
    riskFlags.push("provider_snippet_not_claim_proof");
  } else if (evidenceSummary) {
    evidenceKind = "evidence_summary";
    evidenceText = evidenceSummary.text;
    evidenceSourceField = evidenceSummary.field;
    riskFlags.push("summary_not_source_span");
  } else if (abstractFallback) {
    evidenceKind = "abstract_fallback";
    evidenceText = abstractFallback.text;
    evidenceSourceField = abstractFallback.field;
    riskFlags.push("abstract_fallback_not_source_backed");
  } else {
    riskFlags.push("missing_snippet_evidence");
  }

  if (explicitSnippet && isDegenerateSnippetStatus(snippetStatus)) {
    riskFlags.push("degenerate_snippet_status");
  }

  return {
    canonical_id:
      pickString(record, ["canonical_id", "canonicalId", "id", "paper_id", "paperId"]) ??
      null,
    title: pickString(record, ["title", "paper_title", "paperTitle", "name"]),
    doi: pickString(record, ["doi"]),
    arxiv_id: pickString(record, ["arxiv_id", "arxivId", "arxiv"]),
    year: pickFiniteNumber(record, ["year", "publication_year", "publicationYear"]),
    venue: pickString(record, ["venue", "conference", "journal", "container_title"]),
    source_path: sourcePath,
    source_resolved_path: resolvedPath,
    source_path_exists: sourcePathExists,
    snippet_status: snippetStatus,
    evidence_kind: evidenceKind,
    evidence_text: evidenceText,
    evidence_source_field: evidenceSourceField,
    source_backed: sourceBacked,
    claim_proof_eligible: claimProofEligible,
    risk_flags: uniqueStrings(riskFlags),
  };
}

async function buildSnippetEvidenceReportArtifact(params: {
  projectRoot: string;
  generatedAt: string;
  trigger: string;
  projectId: string | null;
}): Promise<SnippetEvidenceReportArtifact> {
  const sourceIndexPath = path.join(
    params.projectRoot,
    "researcher",
    "PAPER_SOURCE_INDEX.json"
  );
  const rawSourceIndex = await readJsonIfExists<unknown>(sourceIndexPath);
  const rawRecords = collectRawSourceIndexRecords(rawSourceIndex);
  const evaluatedRecords = rawRecords.slice(0, SNIPPET_EVIDENCE_MAX_RECORDS);
  const records = await Promise.all(
    evaluatedRecords.map((rawRecord) =>
      buildSnippetEvidenceRecord({
        projectRoot: params.projectRoot,
        rawRecord,
      })
    )
  );
  const countKind = (kind: SnippetEvidenceKind) =>
    records.filter((record) => record.evidence_kind === kind).length;
  const sourceBackedQuoteCount = countKind("source_backed_quote");
  const explicitSnippetCount = countKind("explicit_snippet");
  const evidenceSummaryCount = countKind("evidence_summary");
  const abstractFallbackCount = countKind("abstract_fallback");
  const unavailableCount = countKind("unavailable");
  const snippetGroundedCount = sourceBackedQuoteCount + explicitSnippetCount;
  const claimProofEligibleCount = records.filter(
    (record) => record.claim_proof_eligible
  ).length;
  return {
    schema_version: 1,
    generated_at: params.generatedAt,
    project_id: params.projectId,
    project_root: params.projectRoot,
    trigger: params.trigger,
    status:
      snippetGroundedCount > 0
        ? "grounded"
        : evidenceSummaryCount + abstractFallbackCount > 0
          ? "fallback_only"
          : "empty",
    source_index_path: sourceIndexPath,
    evidence_policy:
      "Explicit snippets and local source quotes can drive discovery/challenge prompts; only source-backed quotes are eligible as claim proof. Abstract fallbacks and summaries must not be cited as source-backed evidence.",
    raw_record_count: rawRecords.length,
    evaluated_record_count: records.length,
    record_limit: SNIPPET_EVIDENCE_MAX_RECORDS,
    records_truncated: rawRecords.length > records.length,
    source_backed_quote_count: sourceBackedQuoteCount,
    explicit_snippet_count: explicitSnippetCount,
    evidence_summary_count: evidenceSummaryCount,
    abstract_fallback_count: abstractFallbackCount,
    unavailable_count: unavailableCount,
    snippet_grounded_count: snippetGroundedCount,
    claim_proof_eligible_count: claimProofEligibleCount,
    records,
  };
}

function summarizeCitationExpansionReport(
  artifact: CitationExpansionReportArtifact,
  artifactPath: string
): Record<string, unknown> {
  return {
    path: artifactPath,
    status: artifact.status,
    bounded: artifact.bounded,
    seed_count: artifact.seed_count,
    query_count: artifact.query_count,
    packet_path: artifact.packet_path,
    snowballing_status: artifact.snowballing.status,
    snowballing_candidate_count: artifact.snowballing.total_candidate_count,
  };
}

function summarizeSnippetEvidenceReport(
  artifact: SnippetEvidenceReportArtifact,
  artifactPath: string
): Record<string, unknown> {
  return {
    path: artifactPath,
    status: artifact.status,
    raw_record_count: artifact.raw_record_count,
    evaluated_record_count: artifact.evaluated_record_count,
    snippet_grounded_count: artifact.snippet_grounded_count,
    claim_proof_eligible_count: artifact.claim_proof_eligible_count,
    source_backed_quote_count: artifact.source_backed_quote_count,
    explicit_snippet_count: artifact.explicit_snippet_count,
    abstract_fallback_count: artifact.abstract_fallback_count,
    unavailable_count: artifact.unavailable_count,
  };
}

export async function writeLiteratureResearchControllerRunReceipt(params: {
  projectRoot: string;
  generatedAt?: string | null;
  trigger?: string | null;
  controllerBefore: LiteratureResearchControllerArtifacts;
  controllerAfter?: LiteratureResearchControllerArtifacts | null;
  searchExecution?: LiteratureResearchControllerRunReceipt["search_execution"];
  providerQueryResults?: BroadPaperProviderQueryResult[] | null;
  mergedCandidates?: MergedPaperCandidate[] | null;
  papernexusImport?: Record<string, unknown> | null;
  citationExpansionPacket?: CitationExpansionPacket | null;
  autoCitationVerification?: Record<string, unknown> | null;
  executed: boolean;
  skipReason?: string | null;
  nextRoute?: LiteratureResearchControllerRunReceipt["next_route"] | null;
}): Promise<LiteratureResearchControllerRunReceipt> {
  const projectRoot = path.resolve(params.projectRoot);
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const paths = buildArtifactPaths(projectRoot);
  const trigger = params.trigger ?? "literature_research_controller_run";
  const nextRoute =
    params.nextRoute ??
    (params.papernexusImport?.queued === true
      ? "graph_build"
      : params.controllerAfter &&
          ["needs_research", "guardrailed"].includes(params.controllerAfter.status)
        ? "rerun_failed_gate"
        : "none");
  const providerResultIndex = buildProviderResultIndexArtifact({
    projectRoot,
    generatedAt,
    trigger,
    controllerBefore: params.controllerBefore,
    executed: params.executed,
    skipReason: params.skipReason ?? null,
    searchExecution: params.searchExecution ?? null,
    providerQueryResults: params.providerQueryResults ?? [],
    mergedCandidates: params.mergedCandidates ?? [],
  });
  const papernexusImportBatchManifest =
    buildPapernexusImportBatchManifestArtifact({
      projectRoot,
      generatedAt,
      trigger,
      projectId: params.controllerBefore.project_id,
      papernexusImport: params.papernexusImport ?? null,
    });
  const papernexusRefreshReport = buildPapernexusRefreshReportArtifact({
    projectRoot,
    generatedAt,
    trigger,
    projectId: params.controllerBefore.project_id,
    executed: params.executed,
    nextRoute,
    importManifest: papernexusImportBatchManifest,
  });
  const citationExpansionReport = await buildCitationExpansionReportArtifact({
    projectRoot,
    generatedAt,
    trigger,
    projectId: params.controllerBefore.project_id,
    citationExpansionPacket:
      params.citationExpansionPacket ??
      params.controllerAfter?.citation_expansion_packet ??
      params.controllerBefore.citation_expansion_packet ??
      null,
    autoCitationVerification: params.autoCitationVerification ?? null,
    executed: params.executed,
  });
  const snippetEvidenceReport = await buildSnippetEvidenceReportArtifact({
    projectRoot,
    generatedAt,
    trigger,
    projectId: params.controllerBefore.project_id,
  });
  const receipt: LiteratureResearchControllerRunReceipt = {
    schema_version: 1,
    generated_at: generatedAt,
    project_id: params.controllerBefore.project_id,
    project_root: projectRoot,
    trigger,
    executed: params.executed,
    skip_reason: params.skipReason ?? null,
    controller_before: {
      status: params.controllerBefore.status,
      decision: params.controllerBefore.decision,
      coverage_score_100: coverageScoreFromController(params.controllerBefore),
      blocking_gap_count: blockingGapCountFromController(params.controllerBefore),
    },
    search_execution: params.searchExecution ?? null,
    provider_result_index: summarizeProviderResultIndex(
      providerResultIndex,
      paths.providerResultIndexPath
    ),
    papernexus_import: params.papernexusImport ?? null,
    papernexus_import_batch_manifest: summarizePapernexusImportBatchManifest(
      papernexusImportBatchManifest,
      paths.papernexusImportBatchManifestPath
    ),
    papernexus_refresh_report: summarizePapernexusRefreshReport(
      papernexusRefreshReport,
      paths.papernexusRefreshReportPath
    ),
    citation_expansion_report: summarizeCitationExpansionReport(
      citationExpansionReport,
      paths.citationExpansionReportPath
    ),
    snippet_evidence_report: summarizeSnippetEvidenceReport(
      snippetEvidenceReport,
      paths.snippetEvidenceReportPath
    ),
    controller_after: params.controllerAfter
      ? {
          status: params.controllerAfter.status,
          decision: params.controllerAfter.decision,
          coverage_score_100: coverageScoreFromController(params.controllerAfter),
          blocking_gap_count: blockingGapCountFromController(params.controllerAfter),
          next_actions: nextActionsFromController(params.controllerAfter),
        }
      : null,
    next_route: nextRoute,
    artifact_paths: {
      run_receipt_path: paths.runReceiptPath,
      trace_path: paths.tracePath,
      provider_result_index_path: paths.providerResultIndexPath,
      papernexus_import_batch_manifest_path:
        paths.papernexusImportBatchManifestPath,
      papernexus_refresh_report_path: paths.papernexusRefreshReportPath,
      citation_expansion_report_path: paths.citationExpansionReportPath,
      snippet_evidence_report_path: paths.snippetEvidenceReportPath,
      repair_log_path: paths.repairLogPath,
    },
  };
  await Promise.all([
    writeJsonEnsured(paths.providerResultIndexPath, providerResultIndex),
    writeJsonEnsured(
      paths.papernexusImportBatchManifestPath,
      papernexusImportBatchManifest
    ),
    writeJsonEnsured(paths.papernexusRefreshReportPath, papernexusRefreshReport),
    writeJsonEnsured(paths.citationExpansionReportPath, citationExpansionReport),
    writeJsonEnsured(paths.snippetEvidenceReportPath, snippetEvidenceReport),
    writeJsonEnsured(paths.runReceiptPath, receipt),
  ]);
  await fs.mkdir(path.dirname(paths.tracePath), { recursive: true });
  await fs.appendFile(paths.tracePath, `${JSON.stringify(receipt)}\n`, "utf8");
  await fs.mkdir(path.dirname(paths.repairLogPath), { recursive: true });
  await fs.appendFile(
    paths.repairLogPath,
    `${JSON.stringify({
      schema_version: 1,
      generated_at: generatedAt,
      project_id: params.controllerBefore.project_id,
      trigger: receipt.trigger,
      executed: receipt.executed,
      skip_reason: receipt.skip_reason,
      next_route: receipt.next_route,
      provider_result_status: providerResultIndex.status,
      merged_candidate_count: providerResultIndex.merged_candidate_count,
      selected_for_import_count: providerResultIndex.selected_for_import_count,
      papernexus_import_status: papernexusImportBatchManifest.status,
      papernexus_refresh_status: papernexusRefreshReport.status,
      citation_expansion_status: citationExpansionReport.status,
      snippet_evidence_status: snippetEvidenceReport.status,
      snippet_grounded_count: snippetEvidenceReport.snippet_grounded_count,
      claim_proof_eligible_count: snippetEvidenceReport.claim_proof_eligible_count,
    })}\n`,
    "utf8"
  );
  return receipt;
}

export async function materializeLiteratureResearchControllerArtifacts(params: {
  projectRoot: string;
  generatedAt?: string | null;
  trigger?: string | null;
  minCorePapers?: number | null;
  minRecentPapers?: number | null;
  maxCandidateRecords?: number | null;
}): Promise<LiteratureResearchControllerArtifacts> {
  const projectRoot = path.resolve(params.projectRoot);
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const minCorePapers =
    typeof params.minCorePapers === "number" && Number.isFinite(params.minCorePapers)
      ? Math.max(1, Math.floor(params.minCorePapers))
      : 15;
  const minRecentPapers =
    typeof params.minRecentPapers === "number" && Number.isFinite(params.minRecentPapers)
      ? Math.max(0, Math.floor(params.minRecentPapers))
      : 5;
  const maxCandidateRecords =
    typeof params.maxCandidateRecords === "number" &&
    Number.isFinite(params.maxCandidateRecords)
      ? Math.max(10, Math.floor(params.maxCandidateRecords))
      : 200;
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const projectId =
    pickString(manifest, ["project_id", "projectId"]) ?? path.basename(projectRoot);
  const topic = pickProjectTopic(manifest);
  const paths = buildArtifactPaths(projectRoot);
  const [
    coverageAudit,
    sourceIndex,
    includedPapers,
    reviewIssues,
    graphCertificationRaw,
    signalArtifacts,
  ] = await Promise.all([
    auditLiteratureCoverage({ projectRoot }),
    readWorkflowPaperSourceIndex({ projectRoot }),
    readIncludedPapers(projectRoot),
    readJsonIfExists<unknown>(path.join(projectRoot, "reviewer", "REVIEW_ISSUES.json")),
    readJsonIfExists<unknown>(
      path.join(projectRoot, "graph", "PAPERNEXUS_TASK_CERTIFICATION.json")
    ),
    readSignalArtifacts(projectRoot),
  ]);
  const reviewIssueSignals = extractReviewIssueSignals(reviewIssues);
  const citationExpansionPacket =
    coverageAudit.verdict !== "strong" ||
    coverageAudit.pendingRoundCount > 0 ||
    coverageAudit.pendingScreeningCount > 0 ||
    coverageAudit.missingBaselineHints.length > 0
      ? await planCitationExpansion({ projectRoot })
      : null;
  const keywordBank = buildKeywordBank({
    generatedAt,
    projectId,
    topic,
    manifest,
    signalsByArtifact: signalArtifacts.signalsByArtifact,
    reviewIssueSignals,
    citationExpansionPacket,
  });
  const queryPlan = buildLiteratureQueryPlan({
    generatedAt,
    projectId,
    topic,
    keywordBank,
    citationExpansionPacket,
  });
  const candidateScreeningReport = buildCandidateScreeningReport({
    generatedAt,
    projectId,
    sourceEntries: sourceIndex.entries,
    includedPapers,
    maxCandidateRecords,
  });
  const graphCertification = readGraphCertification(graphCertificationRaw);
  const reasons = buildNeedReasons({
    topic,
    coverageAudit,
    candidateScreeningReport,
    graphCertification,
    reviewIssueSignals,
    minCorePapers,
    minRecentPapers,
  });
  const decision = chooseDecision({ reasons, coverageAudit });
  const status = statusFromDecision(decision);
  const coverageScore100 = computeCoverageScore({
    coverageAudit,
    candidateScreeningReport,
    graphCertification,
    queryPlan,
    minCorePapers,
    minRecentPapers,
  });
  const nextActions = buildNextActions({
    decision,
    reasons,
    queryPlan,
    citationExpansionPacket,
  });
  const workflowControl = normalizeWorkflowControlContract(manifest.workflow_control);
  const needAssessment = {
    schema_version: 1,
    generated_at: generatedAt,
    project_id: projectId,
    topic,
    trigger: params.trigger ?? null,
    decision,
    status,
    current_state: {
      stage:
        workflowControl?.stage ??
        asString(manifest.current_stage ?? manifest.currentStage),
      owner_agent:
        workflowControl?.owner ??
        asString(manifest.owner_agent ?? manifest.ownerAgent),
      coverage_verdict: coverageAudit.verdict,
      source_index_paper_count: sourceIndex.entries.length,
      included_paper_count: includedPapers.length,
      recent_paper_count: coverageAudit.recentPaperCount,
      source_backed_graph_claim: graphCertification.sourceBackedGraphClaim,
      graph_certification_status: graphCertification.status,
    },
    need_reasons: reasons,
    stop_condition: {
      met: decision === "stop_and_proceed",
      requirements: {
        min_core_papers: minCorePapers,
        min_recent_papers: minRecentPapers,
        no_pending_screening: true,
        source_backed_graph_claim: true,
      },
    },
  };
  const coverageReport = {
    schema_version: 1,
    generated_at: generatedAt,
    project_id: projectId,
    topic,
    decision,
    status,
    coverage_score_100: coverageScore100,
    coverage_audit: {
      verdict: coverageAudit.verdict,
      total_papers: coverageAudit.totalPapers,
      recent_paper_count: coverageAudit.recentPaperCount,
      pending_round_count: coverageAudit.pendingRoundCount,
      pending_screening_count: coverageAudit.pendingScreeningCount,
      missing_baseline_hints: coverageAudit.missingBaselineHints,
      audit_path: coverageAudit.auditPath,
      markdown_path: coverageAudit.markdownPath,
    },
    graph_certification: graphCertification,
    blocking_gaps: reasons.filter((reason) =>
      ["critical", "high"].includes(reason.severity)
    ),
    weak_gaps: reasons.filter((reason) =>
      ["medium", "low"].includes(reason.severity)
    ),
    next_actions: nextActions,
    closed_loop_contract: {
      need_assessment_path: relativePathFromProject(projectRoot, paths.needAssessmentPath),
      retrieval_keyword_bank_path: relativePathFromProject(projectRoot, paths.keywordBankPath),
      literature_query_plan_path: relativePathFromProject(projectRoot, paths.queryPlanPath),
      candidate_screening_report_path: relativePathFromProject(
        projectRoot,
        paths.candidateScreeningReportPath
      ),
      literature_coverage_report_path: relativePathFromProject(
        projectRoot,
        paths.coverageReportPath
      ),
      controller_run_receipt_path: relativePathFromProject(
        projectRoot,
        paths.runReceiptPath
      ),
      provider_result_index_path: relativePathFromProject(
        projectRoot,
        paths.providerResultIndexPath
      ),
      papernexus_import_batch_manifest_path: relativePathFromProject(
        projectRoot,
        paths.papernexusImportBatchManifestPath
      ),
      papernexus_refresh_report_path: relativePathFromProject(
        projectRoot,
        paths.papernexusRefreshReportPath
      ),
      citation_expansion_report_path: relativePathFromProject(
        projectRoot,
        paths.citationExpansionReportPath
      ),
      snippet_evidence_report_path: relativePathFromProject(
        projectRoot,
        paths.snippetEvidenceReportPath
      ),
      controller_trace_path: relativePathFromProject(projectRoot, paths.tracePath),
      literature_repair_log_path: relativePathFromProject(
        projectRoot,
        paths.repairLogPath
      ),
      paper_ingestion_required: reasons.some((reason) =>
        ["thin_core_literature", "metadata_only_or_unindexed_sources", "graph_not_source_backed"].includes(
          reason.code
        )
      ),
      e2e_claim_guardrail:
        decision === "stop_and_proceed"
          ? "literature_closed"
          : decision === "proceed_with_guardrails"
            ? "claim_with_literature_guardrails"
            : "do_not_claim_literature_complete",
    },
  };
  const relativeArtifactPaths = {
    base_dir: DEFAULT_LITERATURE_RESEARCH_CONTROLLER_DIR,
    need_assessment_path: relativePathFromProject(projectRoot, paths.needAssessmentPath),
    keyword_bank_path: relativePathFromProject(projectRoot, paths.keywordBankPath),
    query_plan_path: relativePathFromProject(projectRoot, paths.queryPlanPath),
    candidate_screening_report_path: relativePathFromProject(
      projectRoot,
      paths.candidateScreeningReportPath
    ),
    coverage_report_path: relativePathFromProject(projectRoot, paths.coverageReportPath),
    status_markdown_path: relativePathFromProject(projectRoot, paths.statusMarkdownPath),
    run_receipt_path: relativePathFromProject(projectRoot, paths.runReceiptPath),
    trace_path: relativePathFromProject(projectRoot, paths.tracePath),
    provider_result_index_path: relativePathFromProject(
      projectRoot,
      paths.providerResultIndexPath
    ),
    papernexus_import_batch_manifest_path: relativePathFromProject(
      projectRoot,
      paths.papernexusImportBatchManifestPath
    ),
    papernexus_refresh_report_path: relativePathFromProject(
      projectRoot,
      paths.papernexusRefreshReportPath
    ),
    citation_expansion_report_path: relativePathFromProject(
      projectRoot,
      paths.citationExpansionReportPath
    ),
    snippet_evidence_report_path: relativePathFromProject(
      projectRoot,
      paths.snippetEvidenceReportPath
    ),
    repair_log_path: relativePathFromProject(projectRoot, paths.repairLogPath),
  };
  const artifacts: LiteratureResearchControllerArtifacts = {
    schema_version: 1,
    generated_at: generatedAt,
    project_id: projectId,
    project_root: projectRoot,
    topic,
    status,
    decision,
    artifact_paths: {
      base_dir: paths.baseDir,
      need_assessment_path: paths.needAssessmentPath,
      keyword_bank_path: paths.keywordBankPath,
      query_plan_path: paths.queryPlanPath,
      candidate_screening_report_path: paths.candidateScreeningReportPath,
      coverage_report_path: paths.coverageReportPath,
      status_markdown_path: paths.statusMarkdownPath,
      run_receipt_path: paths.runReceiptPath,
      trace_path: paths.tracePath,
      provider_result_index_path: paths.providerResultIndexPath,
      papernexus_import_batch_manifest_path:
        paths.papernexusImportBatchManifestPath,
      papernexus_refresh_report_path: paths.papernexusRefreshReportPath,
      citation_expansion_report_path: paths.citationExpansionReportPath,
      snippet_evidence_report_path: paths.snippetEvidenceReportPath,
      repair_log_path: paths.repairLogPath,
      coverage_audit_path: coverageAudit.auditPath,
      citation_expansion_packet_path: citationExpansionPacket?.packetPath ?? null,
    },
    relative_artifact_paths: relativeArtifactPaths,
    need_assessment: needAssessment,
    keyword_bank: keywordBank,
    query_plan: queryPlan,
    candidate_screening_report: candidateScreeningReport,
    coverage_report: coverageReport,
    coverage_audit: coverageAudit,
    citation_expansion_packet: citationExpansionPacket,
  };

  await Promise.all([
    writeJsonEnsured(paths.needAssessmentPath, needAssessment),
    writeJsonEnsured(paths.keywordBankPath, keywordBank),
    writeJsonEnsured(paths.queryPlanPath, queryPlan),
    writeJsonEnsured(paths.candidateScreeningReportPath, candidateScreeningReport),
    writeJsonEnsured(paths.coverageReportPath, coverageReport),
    writeTextEnsured(
      paths.statusMarkdownPath,
      buildMarkdownStatus({
        generatedAt,
        projectId,
        topic,
        status,
        decision,
        coverageScore100,
        reasons,
        nextActions,
        paths,
        projectRoot,
      })
    ),
  ]);

  return artifacts;
}
