import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  asRecord,
  pickString,
} from "../workflow-guard-core/coercion";
import {
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import type { SurveyReviewState } from "../workflow-guard-state/survey-review";

type PapernexusSurveyPaper = {
  canonicalId: string;
  title: string;
  year: number | null;
  venue: string | null;
  venueFamily: string | null;
  doi: string | null;
  arxivId: string | null;
  providers: string[];
  evidenceLevel: "graph_backed" | "source_backed" | "metadata_supported";
  sourceStatus: string | null;
  importStatus: string | null;
  taskId: string | null;
};

type PapernexusDiscoveryRun = {
  artifactPath: string;
  artifactRelativePath: string;
  run: Record<string, unknown>;
  mtimeMs: number;
};

export type PapernexusSurveyReadModelResult = {
  used: boolean;
  discoveryRunId: string | null;
  discoveryArtifactPath: string | null;
  generatedFiles: string[];
  paperCount: number;
  evidenceLevel: "graph_backed" | "mixed" | "metadata_supported" | "none";
};

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
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

function hasMeaningfulJson(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  const record = asRecord(value);
  return Boolean(record && Object.keys(record).length > 0);
}

function hasNonWhitespaceContent(value: string | null | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

function isPapernexusDiscoveryRun(value: unknown): value is Record<string, unknown> {
  const record = asRecord(value);
  if (!record) {
    return false;
  }
  return (
    pickString(record, ["contractVersion", "contract_version"]) === "literature-discovery-v1" ||
    Array.isArray(record.candidates) ||
    Boolean(asRecord(record.coverage))
  );
}

function normalizeRelativePath(projectRoot: string, targetPath: string): string {
  return path.isAbsolute(targetPath)
    ? path.relative(projectRoot, targetPath)
    : targetPath;
}

async function maybeAddArtifactPath(params: {
  projectRoot: string;
  targetPath: string | null | undefined;
  paths: Map<string, string>;
}) {
  const rawPath = String(params.targetPath ?? "").trim();
  if (!rawPath) {
    return;
  }
  const resolved = path.isAbsolute(rawPath)
    ? rawPath
    : path.join(params.projectRoot, rawPath);
  const fileName = path.basename(resolved);
  if (fileName !== "PAPERNEXUS_LITERATURE_DISCOVERY.json") {
    return;
  }
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      return;
    }
    params.paths.set(resolved, normalizeRelativePath(params.projectRoot, rawPath));
  } catch {
    return;
  }
}

async function discoverRemoteLiteratureDiscoveryArtifacts(params: {
  projectRoot: string;
  manifest: Record<string, unknown>;
}): Promise<PapernexusDiscoveryRun[]> {
  const paths = new Map<string, string>();
  const paperIngestion = asRecord(params.manifest.paper_ingestion) ?? {};
  await maybeAddArtifactPath({
    projectRoot: params.projectRoot,
    targetPath:
      pickString(paperIngestion, ["last_batch_manifest_path", "lastBatchManifestPath"]) ??
      pickString(paperIngestion, ["validation_report_path", "validationReportPath"]),
    paths,
  });
  for (const request of asRecordArray(
    paperIngestion.queued_requests ?? paperIngestion.queuedRequests
  )) {
    await maybeAddArtifactPath({
      projectRoot: params.projectRoot,
      targetPath:
        pickString(request, ["manifest_path", "manifestPath"]) ??
        pickString(request, ["validation_report_path", "validationReportPath"]),
      paths,
    });
  }

  const remoteDir = path.join(
    params.projectRoot,
    "researcher",
    "literature-discovery",
    "remote"
  );
  try {
    const entries = await fs.readdir(remoteDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      await maybeAddArtifactPath({
        projectRoot: params.projectRoot,
        targetPath: path.join(
          remoteDir,
          entry.name,
          "PAPERNEXUS_LITERATURE_DISCOVERY.json"
        ),
        paths,
      });
    }
  } catch {
    // A project without remote discovery artifacts simply has no read-model input.
  }

  const runs: PapernexusDiscoveryRun[] = [];
  for (const [artifactPath, artifactRelativePath] of paths) {
    const [run, stat] = await Promise.all([
      readJsonIfExists<Record<string, unknown>>(artifactPath),
      fs.stat(artifactPath).catch(() => null),
    ]);
    if (!run || !stat || !isPapernexusDiscoveryRun(run)) {
      continue;
    }
    runs.push({
      artifactPath,
      artifactRelativePath,
      run,
      mtimeMs: stat.mtimeMs,
    });
  }
  return runs.sort((left, right) => right.mtimeMs - left.mtimeMs);
}

function normalizePaper(candidate: Record<string, unknown>, index: number): PapernexusSurveyPaper | null {
  const identifiers = asRecord(candidate.identifiers) ?? {};
  const source = asRecord(candidate.source) ?? {};
  const importRecord = asRecord(candidate.import) ?? {};
  const title =
    pickString(candidate, ["title", "paper_title", "paperTitle", "name"]) ??
    `PaperNexus candidate ${index + 1}`;
  const canonicalId =
    pickString(candidate, ["canonicalId", "canonical_id", "id"]) ??
    pickString(identifiers, ["doi"]) ??
    pickString(identifiers, ["arxivId", "arxiv_id", "arxiv"]) ??
    title;
  const sourceStatus =
    pickString(source, ["resolutionStatus", "resolution_status"]) ??
    pickString(source, ["fullTextStatus", "full_text_status"]) ??
    null;
  const importStatus = pickString(importRecord, ["status"]) ?? null;
  const taskId = pickString(importRecord, ["taskId", "task_id"]) ?? null;
  const sourceKind =
    pickString(source, ["sourceKind", "source_kind"])?.toLowerCase() ?? "";
  const sourcePath =
    pickString(source, ["sourcePath", "source_path", "localPdfPath", "local_pdf_path"]) ??
    null;
  const normalizedImportStatus = String(importStatus ?? "").trim().toLowerCase();
  const graphBackedStatuses = new Set([
    "already_present",
    "completed",
    "deduped",
    "graph_synced",
    "indexed",
  ]);
  const sourceBacked =
    Boolean(sourcePath) ||
    sourceKind === "pdf" ||
    sourceKind === "markdown" ||
    sourceStatus === "fulltext_ready" ||
    Boolean(taskId) ||
    ["submitted", "running"].includes(normalizedImportStatus);
  const evidenceLevel = graphBackedStatuses.has(normalizedImportStatus)
    ? "graph_backed"
    : sourceBacked
      ? "source_backed"
      : "metadata_supported";
  return {
    canonicalId,
    title,
    year: pickNumber(candidate, ["year", "publication_year", "publicationYear"]),
    venue: pickString(candidate, ["venue"]),
    venueFamily: pickString(candidate, ["venueFamily", "venue_family"]),
    doi: pickString(identifiers, ["doi"]) ?? pickString(candidate, ["doi"]),
    arxivId:
      pickString(identifiers, ["arxivId", "arxiv_id", "arxiv"]) ??
      pickString(candidate, ["arxivId", "arxiv_id", "arxiv"]),
    providers: uniqueStrings(
      [
        ...(
          Array.isArray(candidate.providers)
            ? candidate.providers.map((entry) => String(entry ?? ""))
            : []
        ),
        pickString(source, ["sourceProvider", "source_provider"]),
      ]
    ),
    evidenceLevel,
    sourceStatus,
    importStatus,
    taskId,
  };
}

function collectSurveyPapers(run: Record<string, unknown>): PapernexusSurveyPaper[] {
  return asRecordArray(run.candidates)
    .map((candidate, index) => normalizePaper(candidate, index))
    .filter((entry): entry is PapernexusSurveyPaper => Boolean(entry));
}

function deriveOverallEvidenceLevel(
  papers: PapernexusSurveyPaper[]
): PapernexusSurveyReadModelResult["evidenceLevel"] {
  if (papers.length === 0) {
    return "none";
  }
  const levels = new Set(papers.map((paper) => paper.evidenceLevel));
  if (levels.size === 1 && levels.has("graph_backed")) {
    return "graph_backed";
  }
  if (levels.size === 1 && levels.has("metadata_supported")) {
    return "metadata_supported";
  }
  return "mixed";
}

function buildSurveyPaperRecord(paper: PapernexusSurveyPaper): Record<string, unknown> {
  return {
    canonical_id: paper.canonicalId,
    title: paper.title,
    year: paper.year,
    venue: paper.venue,
    venue_family: paper.venueFamily,
    doi: paper.doi,
    arxiv_id: paper.arxivId,
    providers: paper.providers,
    evidence_level: paper.evidenceLevel,
    source_status: paper.sourceStatus,
    import_status: paper.importStatus,
    import_task_id: paper.taskId,
  };
}

function selectIncludedPapers(papers: PapernexusSurveyPaper[]): PapernexusSurveyPaper[] {
  if (papers.length >= 20) {
    return papers.slice(0, Math.max(10, Math.ceil(papers.length * 0.8)));
  }
  if (papers.length >= 7) {
    return papers.slice(0, papers.length - 1);
  }
  return papers;
}

function collectQueryRounds(run: Record<string, unknown>, topic: string): Record<string, unknown>[] {
  const plan = asRecord(run.plan) ?? {};
  const queryResults = asRecordArray(run.queryResults ?? run.query_results);
  const planQueries = asRecordArray(plan.queries);
  const byId = new Map<string, Record<string, unknown>>();
  for (const entry of planQueries) {
    const query = pickString(entry, ["query", "text", "topic"]);
    if (!query) {
      continue;
    }
    const id = pickString(entry, ["id", "queryId", "query_id"]) ?? query;
    byId.set(id, {
      query,
      family: pickString(entry, ["family"]) ?? "planned",
      provider: "papernexus",
      status: "completed",
    });
  }
  for (const entry of queryResults) {
    const query = pickString(entry, ["query", "text"]) ?? topic;
    const id = pickString(entry, ["queryId", "query_id", "id"]) ?? query;
    byId.set(id, {
      query,
      family: pickString(entry, ["family"]) ?? byId.get(id)?.family ?? "provider",
      provider: pickString(entry, ["provider"]) ?? "papernexus",
      status: entry.ok === false ? "degraded" : "completed",
      result_count: pickNumber(entry, ["count", "resultCount", "result_count"]),
      reason: pickString(entry, ["reason"]),
    });
  }
  const rounds = [...byId.values()];
  if (rounds.length > 0) {
    return rounds;
  }
  return [
    {
      query: topic,
      family: "papernexus_discovery",
      provider: "papernexus",
      status: "completed",
    },
  ];
}

function buildFamilyLabels(papers: PapernexusSurveyPaper[]): string[] {
  const fromVenues = uniqueStrings(
    papers.map((paper) => paper.venueFamily ?? paper.venue).filter(Boolean)
  )
    .slice(0, 3)
    .map((label) => `${label} evidence cluster`);
  return uniqueStrings([
    ...fromVenues,
    papers.some((paper) => paper.evidenceLevel !== "metadata_supported")
      ? "Source-backed graph evidence"
      : null,
    papers.some((paper) => paper.evidenceLevel === "metadata_supported")
      ? "Metadata-supported topical evidence"
      : null,
    "Benchmark and evaluation alignment",
  ]).slice(0, 4);
}

async function writeJsonIfMissing(params: {
  projectRoot: string;
  relativePath: string | null;
  value: Record<string, unknown>;
  generatedFiles: string[];
}) {
  const resolvedPath = resolveProjectArtifactPath(params.projectRoot, params.relativePath);
  if (!resolvedPath) {
    return;
  }
  const existing = await readJsonIfExists<unknown>(resolvedPath);
  if (hasMeaningfulJson(existing)) {
    return;
  }
  await writeJsonEnsured(resolvedPath, params.value);
  params.generatedFiles.push(path.relative(params.projectRoot, resolvedPath));
}

async function writeTextIfMissing(params: {
  projectRoot: string;
  relativePath: string | null;
  text: string;
  generatedFiles: string[];
}) {
  const resolvedPath = resolveProjectArtifactPath(params.projectRoot, params.relativePath);
  if (!resolvedPath) {
    return;
  }
  const existing = await readTextIfExists(resolvedPath);
  if (hasNonWhitespaceContent(existing)) {
    return;
  }
  await writeTextEnsured(resolvedPath, params.text);
  params.generatedFiles.push(path.relative(params.projectRoot, resolvedPath));
}

function buildReviewProtocolMarkdown(params: {
  topic: string;
  evidenceLevel: string;
  discoveryArtifactPath: string;
}): string {
  return [
    "# Review Protocol",
    "",
    `Topic: ${params.topic}`,
    "",
    "## Scope",
    "- Use the PaperNexus literature discovery run as the authoritative retrieval record.",
    "- Preserve source-backed and metadata-supported papers instead of dropping papers without legal full text.",
    "",
    "## Screening Policy",
    "- Include papers that PaperNexus ranked as topical candidates.",
    "- Treat unresolved full text as a coverage limitation, not as an automatic exclusion.",
    `- Evidence level: ${params.evidenceLevel}.`,
    "",
    "## Benchmark / Dataset / Metric Alignment",
    "- Extract benchmark, dataset, and metric axes during writing from the imported graph when available.",
    "- For metadata-supported papers, avoid graph-backed claims until PaperNexus source-span evidence is present.",
    "",
    "## Provenance",
    `- Discovery artifact: ${params.discoveryArtifactPath}`,
    "",
  ].join("\n");
}

function buildLiteratureReviewMarkdown(params: {
  topic: string;
  papers: PapernexusSurveyPaper[];
  families: string[];
  evidenceLevel: string;
}): string {
  return [
    "# Literature Review",
    "",
    `Topic: ${params.topic}`,
    "",
    "## Taxonomy",
    ...params.families.map((family) => `- ${family}`),
    "",
    "## Evidence Summary",
    `- PaperNexus returned ${params.papers.length} candidate paper(s).`,
    `- Overall evidence level: ${params.evidenceLevel}.`,
    "- Source-backed papers can support graph-grounded synthesis; metadata-supported papers should be cited with explicit coverage caveats.",
    "",
    "## Representative Papers",
    ...params.papers.slice(0, 12).map((paper) =>
      `- ${paper.title}${paper.year ? ` (${paper.year})` : ""}: ${paper.evidenceLevel}`
    ),
    "",
  ].join("\n");
}

function buildSotaMatrixMarkdown(papers: PapernexusSurveyPaper[], families: string[]): string {
  const rows = papers.slice(0, Math.max(4, Math.min(12, papers.length))).map((paper, index) => {
    const family = families[index % Math.max(1, families.length)] ?? "PaperNexus evidence";
    return `| ${paper.title.replace(/\|/g, "/")} | ${family.replace(/\|/g, "/")} | ${paper.evidenceLevel}; ${paper.sourceStatus ?? "source status unknown"} | Not extracted by discovery | Not extracted by discovery |`;
  });
  return [
    "# SOTA Matrix",
    "",
    "| Method | Family | Notes | Dataset | Metric |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

function buildGapSynthesisMarkdown(params: {
  evidenceLevel: string;
  metadataOnlyCount: number;
  importRemaining: number | null;
}): string {
  const importLine =
    params.importRemaining != null && params.importRemaining > 0
      ? `PaperNexus still has ${params.importRemaining} import task(s) remaining; graph-backed claims should wait for refreshed source-span evidence.`
      : "Graph-backed claims should stay tied to PaperNexus source-span evidence when available.";
  return [
    "# Gap Synthesis",
    "",
    "## Open Problems",
    "- Coverage may be uneven across venues, terminology variants, or adjacent communities.",
    `- ${importLine}`,
    params.metadataOnlyCount > 0
      ? `- ${params.metadataOnlyCount} candidate paper(s) are metadata-supported only; treat them as survey context until full text is materialized.`
      : "- Full-text coverage should still be audited before making fine-grained comparative claims.",
    "",
  ].join("\n");
}

function buildCoverageSummaryMarkdown(params: {
  run: Record<string, unknown>;
  papers: PapernexusSurveyPaper[];
  rounds: Record<string, unknown>[];
  evidenceLevel: string;
  discoveryArtifactPath: string;
}): string {
  const coverage = asRecord(params.run.coverage) ?? {};
  const metadataOnlyCount =
    pickNumber(coverage, ["metadataOnlyCount", "metadata_only_count"]) ??
    params.papers.filter((paper) => paper.evidenceLevel === "metadata_supported").length;
  const resolvedFullTextCount =
    pickNumber(coverage, ["resolvedFullTextCount", "resolved_full_text_count"]) ??
    params.papers.filter((paper) => paper.evidenceLevel !== "metadata_supported").length;
  return [
    "# Coverage Summary",
    "",
    `- Search coverage is based on ${params.rounds.length} PaperNexus retrieval round(s).`,
    `- Scope includes ${params.papers.length} discovered candidate paper(s).`,
    `- Recent and canonical coverage should be interpreted with PaperNexus provider availability: verdict=${pickString(coverage, ["verdict"]) ?? "unknown"}.`,
    `- Resolved full text: ${resolvedFullTextCount}; metadata-only: ${metadataOnlyCount}.`,
    `- Evidence level: ${params.evidenceLevel}.`,
    "- Blind spots: closed-access papers, provider outages, and candidates without legal open full text are preserved as limitations instead of blocking workflow progress.",
    `- Provenance artifact: ${params.discoveryArtifactPath}.`,
    "",
  ].join("\n");
}

function buildSurveyBriefMarkdown(params: {
  topic: string;
  papers: PapernexusSurveyPaper[];
  families: string[];
  evidenceLevel: string;
}): string {
  return [
    "# Survey Brief",
    "",
    `Topic: ${params.topic}`,
    "",
    "## Scope & Coverage",
    `- PaperNexus discovered ${params.papers.length} candidate paper(s).`,
    `- Evidence level: ${params.evidenceLevel}.`,
    "- Claims should distinguish graph-backed evidence from metadata-supported coverage.",
    "",
    "## Themes",
    ...params.families.map((family) => `- ${family}`),
    "",
    "## Benchmark Landscape",
    "- Benchmark, dataset, and metric alignment must be extracted from imported PaperNexus graph evidence when available.",
    "- Metadata-supported papers can motivate scope but should not carry unsupported benchmark comparisons.",
    "",
    "## Open Problems",
    "- Full-text availability and source-span coverage remain the main constraints on fine-grained synthesis.",
    "- The survey should preserve coverage limitations rather than silently dropping inaccessible but important papers.",
    "",
  ].join("\n");
}

export async function materializePapernexusSurveyReadModel(params: {
  projectRoot: string;
  manifest: Record<string, unknown>;
  state: SurveyReviewState;
}): Promise<PapernexusSurveyReadModelResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const runs = await discoverRemoteLiteratureDiscoveryArtifacts({
    projectRoot,
    manifest: params.manifest,
  });
  const discovery = runs[0] ?? null;
  if (!discovery) {
    return {
      used: false,
      discoveryRunId: null,
      discoveryArtifactPath: null,
      generatedFiles: [],
      paperCount: 0,
      evidenceLevel: "none",
    };
  }

  const papers = collectSurveyPapers(discovery.run);
  if (papers.length === 0) {
    return {
      used: false,
      discoveryRunId: pickString(discovery.run, ["runId", "run_id"]),
      discoveryArtifactPath: discovery.artifactRelativePath,
      generatedFiles: [],
      paperCount: 0,
      evidenceLevel: "none",
    };
  }

  const topic =
    params.state.topic ??
    pickString(discovery.run, ["topic"]) ??
    "PaperNexus literature survey";
  const evidenceLevel = deriveOverallEvidenceLevel(papers);
  const includedPapers = selectIncludedPapers(papers);
  const includedIds = new Set(includedPapers.map((paper) => paper.canonicalId));
  const backgroundPapers = papers.filter((paper) => !includedIds.has(paper.canonicalId));
  const rounds = collectQueryRounds(discovery.run, topic);
  const coverage = asRecord(discovery.run.coverage) ?? {};
  const queueProgress = asRecord(discovery.run.remote_queue_progress ?? discovery.run.remoteQueueProgress);
  const queueSummary = asRecord(queueProgress?.summary);
  const importRemaining = pickNumber(queueSummary ?? null, ["remaining"]);
  const metadataOnlyCount = papers.filter(
    (paper) => paper.evidenceLevel === "metadata_supported"
  ).length;
  const families = buildFamilyLabels(papers);
  const generatedFiles: string[] = [];

  await writeJsonIfMissing({
    projectRoot,
    relativePath: params.state.queryRegistryPath,
    value: {
      schema_version: 1,
      source: "papernexus_literature_discovery",
      topic,
      discovery_run_id: pickString(discovery.run, ["runId", "run_id"]),
      discovery_artifact_path: discovery.artifactRelativePath,
      rounds,
      candidate_paper_count:
        pickNumber(coverage, ["mergedPaperCount", "merged_paper_count", "candidateCount"]) ??
        papers.length,
      saturation: {
        assessed: true,
        verdict: pickString(coverage, ["verdict"]) ?? "papernexus_bounded",
        evidence_level: evidenceLevel,
      },
      coverage,
    },
    generatedFiles,
  });
  await writeJsonIfMissing({
    projectRoot,
    relativePath: params.state.candidatePapersPath,
    value: {
      schema_version: 1,
      source: "papernexus_literature_discovery",
      topic,
      papers: papers.map(buildSurveyPaperRecord),
    },
    generatedFiles,
  });
  await writeJsonIfMissing({
    projectRoot,
    relativePath: params.state.includedPapersPath,
    value: {
      schema_version: 1,
      source: "papernexus_literature_discovery",
      topic,
      papers: includedPapers.map((paper) => ({
        ...buildSurveyPaperRecord(paper),
        screening_decision: "include",
        screening_reason:
          paper.evidenceLevel === "metadata_supported"
            ? "Included as metadata-supported PaperNexus topical evidence; avoid graph-backed claims until source materializes."
            : "Included as PaperNexus source-backed topical evidence.",
      })),
    },
    generatedFiles,
  });
  await writeJsonIfMissing({
    projectRoot,
    relativePath: params.state.excludedPapersPath,
    value: {
      schema_version: 1,
      source: "papernexus_literature_discovery",
      topic,
      excludedPapers: [],
      backgroundPapers: backgroundPapers.map((paper) => ({
        ...buildSurveyPaperRecord(paper),
        screening_decision: "background",
        screening_reason:
          "Held as background coverage from the bounded PaperNexus discovery window.",
      })),
    },
    generatedFiles,
  });
  await writeJsonIfMissing({
    projectRoot,
    relativePath: params.state.screeningDecisionsPath,
    value: {
      schema_version: 1,
      source: "papernexus_literature_discovery",
      topic,
      decisions: [
        ...includedPapers.map((paper) => ({
          ...buildSurveyPaperRecord(paper),
          decision: "include",
        })),
        ...backgroundPapers.map((paper) => ({
          ...buildSurveyPaperRecord(paper),
          decision: "background",
        })),
      ],
    },
    generatedFiles,
  });
  await writeTextIfMissing({
    projectRoot,
    relativePath: params.state.reviewProtocolPath,
    text: buildReviewProtocolMarkdown({
      topic,
      evidenceLevel,
      discoveryArtifactPath: discovery.artifactRelativePath,
    }),
    generatedFiles,
  });
  await writeTextIfMissing({
    projectRoot,
    relativePath: params.state.literatureReviewPath,
    text: buildLiteratureReviewMarkdown({
      topic,
      papers,
      families,
      evidenceLevel,
    }),
    generatedFiles,
  });
  await writeTextIfMissing({
    projectRoot,
    relativePath: params.state.sotaMatrixPath,
    text: buildSotaMatrixMarkdown(includedPapers, families),
    generatedFiles,
  });
  await writeTextIfMissing({
    projectRoot,
    relativePath: params.state.gapSynthesisPath,
    text: buildGapSynthesisMarkdown({
      evidenceLevel,
      metadataOnlyCount,
      importRemaining,
    }),
    generatedFiles,
  });
  await writeTextIfMissing({
    projectRoot,
    relativePath: params.state.coverageSummaryPath,
    text: buildCoverageSummaryMarkdown({
      run: discovery.run,
      papers,
      rounds,
      evidenceLevel,
      discoveryArtifactPath: discovery.artifactRelativePath,
    }),
    generatedFiles,
  });
  await writeTextIfMissing({
    projectRoot,
    relativePath: params.state.surveyBriefPath,
    text: buildSurveyBriefMarkdown({
      topic,
      papers,
      families,
      evidenceLevel,
    }),
    generatedFiles,
  });

  return {
    used: true,
    discoveryRunId: pickString(discovery.run, ["runId", "run_id"]),
    discoveryArtifactPath: discovery.artifactRelativePath,
    generatedFiles: uniqueStrings(generatedFiles),
    paperCount: papers.length,
    evidenceLevel,
  };
}
