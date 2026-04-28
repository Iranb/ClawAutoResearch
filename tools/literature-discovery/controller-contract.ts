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
  BroadPaperSearchDepth,
  BroadPaperSearchQuery,
} from "../research30/provider-contract";
import { collectSurveyEntries } from "../survey-review-artifacts";

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
  papernexus_import: Record<string, unknown> | null;
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
  openalex: "openalex",
  research30_semanticscholar: "semanticscholar",
  semanticscholar: "semanticscholar",
  "semantic-scholar": "semanticscholar",
  research30_crossref: "crossref",
  crossref: "crossref",
  research30_dblp: "dblp",
  dblp: "dblp",
  research30_core: "core",
  core: "core",
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
  return CONTROLLER_PROVIDER_MAP[key] ?? null;
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
        : ["openalex", "semanticscholar", "crossref", "dblp", "core"],
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
- trace: ${relativePathFromProject(params.projectRoot, params.paths.tracePath)}
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

export async function writeLiteratureResearchControllerRunReceipt(params: {
  projectRoot: string;
  generatedAt?: string | null;
  trigger?: string | null;
  controllerBefore: LiteratureResearchControllerArtifacts;
  controllerAfter?: LiteratureResearchControllerArtifacts | null;
  searchExecution?: LiteratureResearchControllerRunReceipt["search_execution"];
  papernexusImport?: Record<string, unknown> | null;
  executed: boolean;
  skipReason?: string | null;
  nextRoute?: LiteratureResearchControllerRunReceipt["next_route"] | null;
}): Promise<LiteratureResearchControllerRunReceipt> {
  const projectRoot = path.resolve(params.projectRoot);
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const paths = buildArtifactPaths(projectRoot);
  const receipt: LiteratureResearchControllerRunReceipt = {
    schema_version: 1,
    generated_at: generatedAt,
    project_id: params.controllerBefore.project_id,
    project_root: projectRoot,
    trigger: params.trigger ?? "literature_research_controller_run",
    executed: params.executed,
    skip_reason: params.skipReason ?? null,
    controller_before: {
      status: params.controllerBefore.status,
      decision: params.controllerBefore.decision,
      coverage_score_100: coverageScoreFromController(params.controllerBefore),
      blocking_gap_count: blockingGapCountFromController(params.controllerBefore),
    },
    search_execution: params.searchExecution ?? null,
    papernexus_import: params.papernexusImport ?? null,
    controller_after: params.controllerAfter
      ? {
          status: params.controllerAfter.status,
          decision: params.controllerAfter.decision,
          coverage_score_100: coverageScoreFromController(params.controllerAfter),
          blocking_gap_count: blockingGapCountFromController(params.controllerAfter),
          next_actions: nextActionsFromController(params.controllerAfter),
        }
      : null,
    next_route:
      params.nextRoute ??
      (params.papernexusImport?.queued === true
        ? "graph_build"
        : params.controllerAfter &&
            ["needs_research", "guardrailed"].includes(params.controllerAfter.status)
          ? "rerun_failed_gate"
          : "none"),
    artifact_paths: {
      run_receipt_path: paths.runReceiptPath,
      trace_path: paths.tracePath,
    },
  };
  await writeJsonEnsured(paths.runReceiptPath, receipt);
  await fs.mkdir(path.dirname(paths.tracePath), { recursive: true });
  await fs.appendFile(paths.tracePath, `${JSON.stringify(receipt)}\n`, "utf8");
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
  const needAssessment = {
    schema_version: 1,
    generated_at: generatedAt,
    project_id: projectId,
    topic,
    trigger: params.trigger ?? null,
    decision,
    status,
    current_state: {
      stage: asString(manifest.current_stage ?? manifest.currentStage),
      owner_agent: asString(manifest.owner_agent ?? manifest.ownerAgent),
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
      controller_trace_path: relativePathFromProject(projectRoot, paths.tracePath),
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
