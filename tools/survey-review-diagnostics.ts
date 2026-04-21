import * as path from "node:path";
import {
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
} from "./workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "./workflow-guard-core/paths";
import {
  summarizeSurveyQueryRegistry,
  summarizeSurveyScreening,
} from "./survey-review-artifacts";
import type { SurveyReviewState } from "./workflow-guard-state/survey-review";

export type SurveyQualityGateDiagnostic = {
  status: string;
  summary: string;
  evidencePaths: string[];
  blockers: string[];
  warnings: string[];
};

export type SurveyReviewDiagnostics = {
  generatedAt: string;
  diagnosticsPath: string;
  ready: boolean;
  blockingIssues: string[];
  warnings: string[];
  counts: {
    queryRounds: number;
    candidatePapers: number;
    includedPapers: number;
    excludedPapers: number;
    backgroundPapers: number;
    pendingScreeningCandidates: number;
    pendingPlannedRounds: number;
    sotaMatrixRows: number;
    taxonomyItems: number;
    gapItems: number;
  };
  coverage: SurveyQualityGateDiagnostic;
  taxonomyStability: SurveyQualityGateDiagnostic;
  representativeMethods: SurveyQualityGateDiagnostic;
  benchmarkAlignment: SurveyQualityGateDiagnostic;
  topicRelevance: SurveyQualityGateDiagnostic;
  gapClosure: SurveyQualityGateDiagnostic;
};

type TopicRelevanceAuditLike = {
  screenedIncludedCount?: number | null;
  topicRelevance?: {
    relevantCount?: number | null;
    boundaryCount?: number | null;
    offTopicCount?: number | null;
    insufficientEvidenceCount?: number | null;
    fullTextReviewedCount?: number | null;
    titleOnlyCount?: number | null;
    screenedIncludedOffTopicCount?: number | null;
  } | null;
};

const DEFAULT_TOPIC_RELEVANCE_AUDIT_PATH = "researcher/TOPIC_RELEVANCE_AUDIT.json";
const DEFAULT_LITERATURE_COVERAGE_AUDIT_PATH = "researcher/LITERATURE_COVERAGE_AUDIT.json";

function getCandidatePaperCount(
  queryRegistry: Record<string, unknown> | null,
  fallbackCount: number
): number {
  const candidateRaw = queryRegistry?.candidate_paper_count;
  if (typeof candidateRaw === "number" && Number.isFinite(candidateRaw)) {
    return Math.max(0, Math.floor(candidateRaw));
  }
  const camelRaw = queryRegistry?.candidatePaperCount;
  if (typeof camelRaw === "number" && Number.isFinite(camelRaw)) {
    return Math.max(0, Math.floor(camelRaw));
  }
  const totalRaw = queryRegistry?.totalCount ?? queryRegistry?.total_count;
  if (typeof totalRaw === "number" && Number.isFinite(totalRaw)) {
    return Math.max(0, Math.floor(totalRaw));
  }
  return fallbackCount;
}

function normalizeText(text: string | null | undefined): string {
  return (text ?? "").trim();
}

function countKeywordHits(text: string, patterns: RegExp[]): number {
  const normalized = text.toLowerCase();
  return patterns.reduce((count, pattern) => count + (pattern.test(normalized) ? 1 : 0), 0);
}

function extractSectionListItems(text: string, headingKeywords: string[]): string[] {
  const lines = normalizeText(text).split(/\r?\n/);
  const items: string[] = [];
  let capture = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,6}\s+/.test(trimmed)) {
      const heading = trimmed.replace(/^#{1,6}\s+/, "").toLowerCase();
      capture = headingKeywords.some((keyword) => heading.includes(keyword));
      continue;
    }
    if (!capture) {
      continue;
    }
    if (/^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      items.push(trimmed.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "").trim());
      continue;
    }
    if (trimmed === "") {
      continue;
    }
    if (items.length === 0) {
      items.push(trimmed);
    }
  }
  return items.filter(Boolean);
}

type MarkdownTable = {
  header: string[];
  rows: number;
};

function collectMarkdownTables(text: string): MarkdownTable[] {
  const lines = normalizeText(text).split(/\r?\n/);
  const tables: MarkdownTable[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const headerLine = lines[index]?.trim() ?? "";
    const dividerLine = lines[index + 1]?.trim() ?? "";
    if (!headerLine.includes("|") || !dividerLine.includes("|")) {
      continue;
    }
    if (!/^[:|\-\s]+$/.test(dividerLine.replace(/\|/g, ""))) {
      continue;
    }
    const header = headerLine
      .split("|")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    let rows = 0;
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const row = lines[rowIndex]?.trim() ?? "";
      if (!row.includes("|")) {
        break;
      }
      if (row.replace(/\|/g, "").trim() === "") {
        break;
      }
      rows += 1;
    }
    tables.push({ header, rows });
    index += rows + 1;
  }
  return tables;
}

function countMarkdownTableRows(text: string): { header: string[]; rows: number } {
  return collectMarkdownTables(text)[0] ?? { header: [], rows: 0 };
}

function buildDiagnostic(params: {
  status: string;
  summary: string;
  evidencePaths: string[];
  blockers?: string[];
  warnings?: string[];
}): SurveyQualityGateDiagnostic {
  return {
    status: params.status,
    summary: params.summary,
    evidencePaths: params.evidencePaths,
    blockers: params.blockers ?? [],
    warnings: params.warnings ?? [],
  };
}

function hasAnyKeyword(text: string, patterns: RegExp[]): boolean {
  const normalized = text.toLowerCase();
  return patterns.some((pattern) => pattern.test(normalized));
}

export async function materializeSurveyReviewDiagnostics(params: {
  projectRoot: string;
  state: SurveyReviewState;
}): Promise<SurveyReviewDiagnostics> {
  const projectRoot = path.resolve(params.projectRoot);
  const diagnosticsPath =
    resolveProjectArtifactPath(projectRoot, params.state.diagnosticsPath) ??
    path.join(projectRoot, "researcher", "SURVEY_GATE_DIAGNOSTICS.json");
  const [
    queryRegistry,
    candidateJson,
    screeningDecisionsJson,
    includedJson,
    excludedJson,
    topicRelevanceAudit,
    coverageAudit,
    reviewProtocolText,
    literatureReviewText,
    sotaMatrixText,
    gapSynthesisText,
    coverageSummaryText,
    surveyBriefText,
  ] = await Promise.all([
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, params.state.queryRegistryPath) ?? ""
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, params.state.candidatePapersPath) ?? ""
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, params.state.screeningDecisionsPath) ?? ""
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, params.state.includedPapersPath) ?? ""
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, params.state.excludedPapersPath) ?? ""
    ),
    readJsonIfExists<TopicRelevanceAuditLike>(
      resolveProjectArtifactPath(projectRoot, DEFAULT_TOPIC_RELEVANCE_AUDIT_PATH) ?? ""
    ),
    readJsonIfExists<TopicRelevanceAuditLike>(
      resolveProjectArtifactPath(projectRoot, DEFAULT_LITERATURE_COVERAGE_AUDIT_PATH) ?? ""
    ),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, params.state.reviewProtocolPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, params.state.literatureReviewPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, params.state.sotaMatrixPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, params.state.gapSynthesisPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, params.state.coverageSummaryPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, params.state.surveyBriefPath)),
  ]);

  const querySummary = summarizeSurveyQueryRegistry(queryRegistry);
  const screeningSummary = summarizeSurveyScreening({
    candidatePapers: candidateJson,
    screeningDecisions: screeningDecisionsJson,
    includedPapers: includedJson,
    excludedPapers: excludedJson,
  });
  const queryRounds = querySummary.queryRoundCount;
  const includedPapers = screeningSummary.includedCount;
  const excludedPapers = screeningSummary.excludedCount + screeningSummary.backgroundCount;
  const backgroundPapers = screeningSummary.backgroundCount;
  const pendingScreeningCandidates = screeningSummary.pendingCount;
  const pendingPlannedRounds = querySummary.pendingRoundCount;
  const candidatePapers = getCandidatePaperCount(
    queryRegistry,
    includedPapers + excludedPapers + pendingScreeningCandidates
  );
  const coverageSummaryNormalized = normalizeText(coverageSummaryText);
  const literatureReviewNormalized = normalizeText(literatureReviewText);
  const surveyBriefNormalized = normalizeText(surveyBriefText);
  const gapSynthesisNormalized = normalizeText(gapSynthesisText);
  const reviewProtocolNormalized = normalizeText(reviewProtocolText);
  const sotaMatrixNormalized = normalizeText(sotaMatrixText);

  const taxonomyItems = [
    ...extractSectionListItems(literatureReviewNormalized, [
      "taxonomy",
      "theme",
      "cluster",
      "family",
    ]),
    ...extractSectionListItems(surveyBriefNormalized, [
      "taxonomy",
      "theme",
      "cluster",
      "family",
    ]),
  ];
  const uniqueTaxonomyItems = Array.from(new Set(taxonomyItems.map((entry) => entry.toLowerCase())));
  const gapItems = Array.from(
    new Set(
      [
        ...extractSectionListItems(gapSynthesisNormalized, [
          "gap",
          "open problem",
          "limitation",
          "challenge",
          "future",
        ]),
        ...extractSectionListItems(surveyBriefNormalized, [
          "open problem",
          "limitation",
          "challenge",
          "future",
        ]),
      ]
        .map((entry) => entry.toLowerCase())
        .filter(Boolean)
    )
  );
  const sotaTables = collectMarkdownTables(sotaMatrixNormalized);
  const representativeSotaTables = sotaTables.filter((table) => {
    const joined = table.header.join(" | ");
    return /\bmethod\b/.test(joined) && /\bnotes\b/.test(joined);
  });
  const representativeSotaTable =
    representativeSotaTables[0] ??
    sotaTables.find((table) =>
      table.header.some((entry) => /\bmethod\b/.test(entry))
    ) ??
    { header: [], rows: 0 };
  const representativeRowCount =
    representativeSotaTables.length > 0
      ? representativeSotaTables.reduce((sum, table) => sum + table.rows, 0)
      : representativeSotaTable.rows;
  const familyHeadingCount = (
    sotaMatrixNormalized.match(/^###\s+/gm) ?? []
  ).length;
  const benchmarkTable =
    sotaTables.find((table) => {
      const joined = table.header.join(" | ");
      return /\bbenchmark\b/.test(joined) && /\bdataset\b/.test(joined);
    }) ??
    sotaTables.find((table) => {
      const joined = table.header.join(" | ");
      return /\bdataset\b/.test(joined) && /\bmetric\b/.test(joined);
    }) ??
    { header: [], rows: 0 };
  const sotaTable = representativeSotaTable;

  const coverageKeywords = countKeywordHits(coverageSummaryNormalized, [
    /\bcoverage\b/,
    /\bsearch\b/,
    /\bscope\b/,
    /\bblind\s*spot\b/,
    /\blimitation\b/,
    /\brecent\b/,
  ]);
  const surveyBriefTaxonomySignals =
    uniqueTaxonomyItems.length > 0 ||
    hasAnyKeyword(surveyBriefNormalized, [/\btaxonomy\b/, /\btheme\b/, /\bfamily\b/]);
  const gapLoopSignals =
    hasAnyKeyword(surveyBriefNormalized, [
      /\bgaps?\b/,
      /\bopen problems?\b/,
      /\blimitations?\b/,
      /\bchallenges?\b/,
      /\bfuture work\b/,
    ]) ||
      hasAnyKeyword(coverageSummaryNormalized, [/\bopen problems?\b/, /\bblind\s*spots?\b/]);
  const topicAuditCounts = {
    ...(coverageAudit?.topicRelevance ?? {}),
    ...(topicRelevanceAudit?.topicRelevance ?? {}),
  };
  const screenedIncludedOffTopicCountRaw =
    typeof topicAuditCounts.screenedIncludedOffTopicCount === "number"
      ? topicAuditCounts.screenedIncludedOffTopicCount
      : null;
  const screenedIncludedOffTopicCount =
    screenedIncludedOffTopicCountRaw != null
      ? Math.max(0, Math.floor(screenedIncludedOffTopicCountRaw))
      : null;
  const fullTextReviewedCount =
    typeof topicAuditCounts.fullTextReviewedCount === "number"
      ? Math.max(0, Math.floor(topicAuditCounts.fullTextReviewedCount))
      : 0;
  const fullTextCoverageExpectation = Math.min(Math.max(includedPapers, 0), 5);

  let coverage = buildDiagnostic({
    status: "missing",
    summary: "Search coverage has not been summarized yet.",
    evidencePaths: [params.state.queryRegistryPath ?? "", params.state.coverageSummaryPath ?? ""].filter(Boolean),
    blockers: ["Add retrieval rounds, included papers, and a durable coverage summary before synthesis."],
  });
  if (queryRounds > 0 && includedPapers > 0) {
    const broadCoverageReady =
      queryRounds >= 4 &&
      candidatePapers >= 20 &&
      includedPapers >= 10 &&
      coverageKeywords >= 2;
    const screenedBreadthReady =
      queryRounds >= 3 &&
      candidatePapers >= 50 &&
      includedPapers >= 20 &&
      excludedPapers >= 20 &&
      coverageKeywords >= 2;
    const nicheCoverageReady =
      queryRounds >= 2 &&
      candidatePapers > 0 &&
      candidatePapers <= 15 &&
      includedPapers >= 6 &&
      excludedPapers >= 1 &&
      coverageKeywords >= 2;
    const explicitSaturationReady =
      querySummary.hasExplicitSaturation &&
      includedPapers >= 6 &&
      excludedPapers >= 1 &&
      coverageKeywords >= 2;
    const breadthReady =
      (broadCoverageReady ||
        screenedBreadthReady ||
        nicheCoverageReady ||
        explicitSaturationReady) &&
      pendingPlannedRounds === 0 &&
      pendingScreeningCandidates === 0;
    coverage = buildDiagnostic({
      status: breadthReady ? "ready" : "partial",
      summary: breadthReady
        ? `Coverage looks reusable for synthesis: query_rounds=${queryRounds}, included=${includedPapers}, excluded=${excludedPapers}, background=${backgroundPapers}, candidate=${candidatePapers}.`
        : `Coverage is still thin or under-explained: query_rounds=${queryRounds}, included=${includedPapers}, excluded=${excludedPapers}, background=${backgroundPapers}, pending_rounds=${pendingPlannedRounds}, pending_screening=${pendingScreeningCandidates}, candidate=${candidatePapers}.`,
      evidencePaths: [params.state.queryRegistryPath ?? "", params.state.coverageSummaryPath ?? ""].filter(Boolean),
      blockers: breadthReady
        ? []
        : [
            ...(pendingPlannedRounds > 0
              ? [
                  `Finish the ${pendingPlannedRounds} pending retrieval round(s) recorded in the survey query registry before finalizing synthesis.`,
                ]
              : []),
            ...(pendingScreeningCandidates > 0
              ? [
                  `Resolve ${pendingScreeningCandidates} pending screening candidate(s) before treating the survey packet as complete.`,
                ]
              : []),
            "Expand search breadth with more retrieval rounds and seed-based citation expansion before finalizing the survey synthesis.",
            "For broad topics, aim for roughly 40-50 candidates and a screened included/excluded split before WRITE handoff.",
          ],
      warnings:
        coverageKeywords >= 2
          ? []
          : ["COVERAGE_SUMMARY.md should explicitly describe search coverage, blind spots, and scope boundaries."],
    });
  }

  let taxonomyStability = buildDiagnostic({
    status: "missing",
    summary: "A durable taxonomy has not been established yet.",
    evidencePaths: [params.state.literatureReviewPath ?? "", params.state.surveyBriefPath ?? ""].filter(Boolean),
    blockers: ["Add a taxonomy/theme section with at least two stable method families before write handoff."],
  });
  if (literatureReviewNormalized || surveyBriefNormalized) {
    const stable = uniqueTaxonomyItems.length >= 2 && surveyBriefTaxonomySignals;
    taxonomyStability = buildDiagnostic({
      status: stable ? "stable" : "unstable",
      summary: stable
        ? `Taxonomy is stable enough to write against (${uniqueTaxonomyItems.length} extracted themes).`
        : `Taxonomy is still weak or implicit (${uniqueTaxonomyItems.length} extracted themes).`,
      evidencePaths: [params.state.literatureReviewPath ?? "", params.state.surveyBriefPath ?? ""].filter(Boolean),
      blockers: stable
        ? []
        : ["Strengthen the taxonomy/theme sections so the survey is organized by method families instead of a flat bibliography."],
    });
  }

  const requiredRepresentativeSignals =
    includedPapers >= 12
      ? 4
      : includedPapers >= 8
        ? 3
        : includedPapers >= 4
          ? 2
          : includedPapers >= 2
            ? 1
            : includedPapers >= 1
              ? 1
              : 0;
  let representativeMethods = buildDiagnostic({
    status: "missing",
    summary: "Representative methods have not been mapped into the SoTA matrix yet.",
    evidencePaths: [params.state.includedPapersPath ?? "", params.state.sotaMatrixPath ?? ""].filter(Boolean),
    blockers: ["Populate SOTA_MATRIX.md with representative methods from the included set before write handoff."],
  });
  if (includedPapers > 0 || sotaMatrixNormalized) {
    const representativeSignalCount = Math.max(
      representativeRowCount,
      familyHeadingCount,
      uniqueTaxonomyItems.length
    );
    const ready =
      requiredRepresentativeSignals > 0 &&
      representativeSignalCount >= requiredRepresentativeSignals;
    representativeMethods = buildDiagnostic({
      status: ready ? "ready" : representativeRowCount > 0 ? "partial" : "missing",
      summary: ready
        ? `Representative methods are covered in the survey packet (matrix_rows=${representativeRowCount}, family_headings=${familyHeadingCount}, taxonomy_signals=${uniqueTaxonomyItems.length}, included=${includedPapers}).`
        : `Representative method coverage is still incomplete (matrix_rows=${representativeRowCount}, family_headings=${familyHeadingCount}, taxonomy_signals=${uniqueTaxonomyItems.length}, included=${includedPapers}).`,
      evidencePaths: [params.state.includedPapersPath ?? "", params.state.sotaMatrixPath ?? ""].filter(Boolean),
      blockers: ready
        ? []
        : ["Expand SOTA_MATRIX.md so each major method family has representative entries before the survey is marked complete."],
    });
  }

  const hasBenchmarkHeader = benchmarkTable.header.some((entry) =>
    /\bdataset\b|\bbenchmark\b|\bsetting\b/.test(entry)
  );
  const hasMetricHeader = benchmarkTable.header.some((entry) =>
    /\bmetric\b|\bscore\b|\bacc\b|\baccuracy\b|\bf1\b|\bmap\b|\bauc\b/.test(entry)
  );
  const benchmarkDocumentSignalCount = [
    hasAnyKeyword(reviewProtocolNormalized, [/\bdataset\b/, /\bbenchmark\b/, /\bmetric\b/]),
    hasAnyKeyword(sotaMatrixNormalized, [/\bdataset\b/, /\bbenchmark\b/, /\bmetric\b/]),
    hasAnyKeyword(coverageSummaryNormalized, [/\bdataset\b/, /\bbenchmark\b/, /\bmetric\b/]),
  ].filter(Boolean).length;
  const benchmarkKeywordSupport =
    hasAnyKeyword(sotaMatrixNormalized, [/\bdataset\b/, /\bbenchmark\b/, /\bmetric\b/]) ||
    hasAnyKeyword(coverageSummaryNormalized, [/\bdataset\b/, /\bbenchmark\b/, /\bmetric\b/]) ||
    hasAnyKeyword(reviewProtocolNormalized, [/\bdataset\b/, /\bbenchmark\b/, /\bmetric\b/]);
  const benchmarkAligned =
    (hasBenchmarkHeader && hasMetricHeader) ||
    benchmarkDocumentSignalCount >= 2;
  const benchmarkAlignment = buildDiagnostic({
    status: benchmarkAligned ? "aligned" : benchmarkKeywordSupport ? "partial" : "missing",
    summary: benchmarkAligned
      ? "Benchmark / dataset / metric comparison axes are explicit in the survey packet."
      : benchmarkKeywordSupport
        ? "Benchmark comparison exists, but the survey packet still lacks a crisp dataset/metric alignment table."
        : "Benchmark / dataset / metric alignment has not been made explicit yet.",
    evidencePaths: [params.state.reviewProtocolPath ?? "", params.state.sotaMatrixPath ?? "", params.state.coverageSummaryPath ?? ""].filter(Boolean),
    blockers: benchmarkAligned
      ? []
      : ["Make benchmark / dataset / metric alignment explicit in REVIEW_PROTOCOL.md and SOTA_MATRIX.md before write handoff."],
  });

  const topicRelevanceReady =
    screenedIncludedOffTopicCount == null || screenedIncludedOffTopicCount === 0;
  const topicRelevance = buildDiagnostic({
    status: topicRelevanceReady ? "ready" : "needs_revision",
    summary:
      screenedIncludedOffTopicCount == null
        ? "Body-aware topic relevance audit is not available yet; current gate assumes no explicit off-topic findings."
        : screenedIncludedOffTopicCount === 0
          ? `Body-aware topic relevance is acceptable for the screened included set (full_text_reviewed=${fullTextReviewedCount}).`
          : `Body-aware topic relevance found ${screenedIncludedOffTopicCount} off-topic paper(s) inside the screened included set.`,
    evidencePaths: [
      DEFAULT_TOPIC_RELEVANCE_AUDIT_PATH,
      DEFAULT_LITERATURE_COVERAGE_AUDIT_PATH,
      params.state.includedPapersPath ?? "",
    ].filter(Boolean),
    blockers:
      screenedIncludedOffTopicCount != null && screenedIncludedOffTopicCount > 0
        ? [
            "Revisit the include/background boundary for papers flagged as off-topic by the body-aware relevance audit before write handoff.",
          ]
        : [],
    warnings:
      screenedIncludedOffTopicCount == null
        ? ["Generate a fresh topic relevance audit once fuller paper text is available for stronger boundary checking."]
        : fullTextCoverageExpectation > 0 && fullTextReviewedCount < fullTextCoverageExpectation
          ? [
              `Full-text topic relevance review is still shallow (${fullTextReviewedCount}/${fullTextCoverageExpectation} expected for the current included set).`,
            ]
          : [],
  });

  const gapClosed = gapItems.length >= 2 && gapLoopSignals;
  const gapClosure = buildDiagnostic({
    status: gapClosed ? "closed" : gapItems.length > 0 ? "partial" : "missing",
    summary: gapClosed
      ? `Gap synthesis closes the loop into the survey brief (${gapItems.length} explicit unresolved items).`
      : gapItems.length > 0
        ? "Gap synthesis exists, but the survey brief does not yet carry those limitations forward clearly."
        : "Gap synthesis is missing or too thin to anchor the survey's open-problems section.",
    evidencePaths: [params.state.gapSynthesisPath ?? "", params.state.surveyBriefPath ?? ""].filter(Boolean),
    blockers: gapClosed
      ? []
      : ["Carry the main unresolved gaps and limitations from GAP_SYNTHESIS.md into SURVEY_BRIEF.md before write handoff."],
  });

  const blockingIssues = [
    ...coverage.blockers,
    ...taxonomyStability.blockers,
    ...representativeMethods.blockers,
    ...benchmarkAlignment.blockers,
    ...topicRelevance.blockers,
    ...gapClosure.blockers,
  ];
  const warnings = [
    ...coverage.warnings,
    ...taxonomyStability.warnings,
    ...representativeMethods.warnings,
    ...benchmarkAlignment.warnings,
    ...topicRelevance.warnings,
    ...gapClosure.warnings,
  ];
  const ready =
    coverage.status === "ready" &&
    taxonomyStability.status === "stable" &&
    representativeMethods.status === "ready" &&
    benchmarkAlignment.status === "aligned" &&
    topicRelevance.status === "ready" &&
    gapClosure.status === "closed";

  const diagnostics: SurveyReviewDiagnostics = {
    generatedAt: new Date().toISOString(),
    diagnosticsPath: path.relative(projectRoot, diagnosticsPath),
    ready,
    blockingIssues,
    warnings,
    counts: {
      queryRounds,
      candidatePapers,
      includedPapers,
      excludedPapers,
      backgroundPapers,
      pendingScreeningCandidates,
      pendingPlannedRounds,
      sotaMatrixRows: sotaTable.rows,
      taxonomyItems: uniqueTaxonomyItems.length,
      gapItems: gapItems.length,
    },
    coverage,
    taxonomyStability,
    representativeMethods,
    benchmarkAlignment,
    topicRelevance,
    gapClosure,
  };

  await writeJsonEnsured(diagnosticsPath, diagnostics);
  return diagnostics;
}
