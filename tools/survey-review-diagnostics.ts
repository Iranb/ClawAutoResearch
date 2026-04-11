import * as path from "node:path";
import { asRecord } from "./workflow-guard-core/coercion";
import {
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
} from "./workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "./workflow-guard-core/paths";
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
    sotaMatrixRows: number;
    taxonomyItems: number;
    gapItems: number;
  };
  coverage: SurveyQualityGateDiagnostic;
  taxonomyStability: SurveyQualityGateDiagnostic;
  representativeMethods: SurveyQualityGateDiagnostic;
  benchmarkAlignment: SurveyQualityGateDiagnostic;
  gapClosure: SurveyQualityGateDiagnostic;
};

function countPaperEntries(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  const record = asRecord(value);
  if (!record) {
    return 0;
  }
  if (Array.isArray(record.papers)) {
    return record.papers.length;
  }
  if (Array.isArray(record.included)) {
    return record.included.length;
  }
  if (Array.isArray(record.excluded)) {
    return record.excluded.length;
  }
  return 0;
}

function countQueryRounds(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  const record = asRecord(value);
  if (!record) {
    return 0;
  }
  if (Array.isArray(record.rounds)) {
    return record.rounds.length;
  }
  if (Array.isArray(record.queries)) {
    return record.queries.length;
  }
  return 0;
}

function getCandidatePaperCount(
  queryRegistry: Record<string, unknown> | null,
  fallbackCount: number
): number {
  const candidateRaw = queryRegistry?.candidate_paper_count;
  if (typeof candidateRaw === "number" && Number.isFinite(candidateRaw)) {
    return Math.max(fallbackCount, Math.floor(candidateRaw));
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

function countMarkdownTableRows(text: string): { header: string[]; rows: number } {
  const lines = normalizeText(text).split(/\r?\n/);
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
    return { header, rows };
  }
  return { header: [], rows: 0 };
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
    includedJson,
    excludedJson,
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
      resolveProjectArtifactPath(projectRoot, params.state.includedPapersPath) ?? ""
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, params.state.excludedPapersPath) ?? ""
    ),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, params.state.reviewProtocolPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, params.state.literatureReviewPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, params.state.sotaMatrixPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, params.state.gapSynthesisPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, params.state.coverageSummaryPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, params.state.surveyBriefPath)),
  ]);

  const queryRounds = countQueryRounds(queryRegistry);
  const includedPapers = countPaperEntries(includedJson);
  const excludedPapers = countPaperEntries(excludedJson);
  const candidatePapers = getCandidatePaperCount(
    queryRegistry,
    includedPapers + excludedPapers
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
  const sotaTable = countMarkdownTableRows(sotaMatrixNormalized);

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

  let coverage = buildDiagnostic({
    status: "missing",
    summary: "Search coverage has not been summarized yet.",
    evidencePaths: [params.state.queryRegistryPath ?? "", params.state.coverageSummaryPath ?? ""].filter(Boolean),
    blockers: ["Add retrieval rounds, included papers, and a durable coverage summary before synthesis."],
  });
  if (queryRounds > 0 && includedPapers > 0) {
    const breadthReady =
      queryRounds >= 2 &&
      (includedPapers >= 6 ||
        (candidatePapers > 0 && candidatePapers <= 10 && includedPapers >= 3)) &&
      coverageKeywords >= 2;
    coverage = buildDiagnostic({
      status: breadthReady ? "ready" : "partial",
      summary: breadthReady
        ? `Coverage looks reusable for synthesis: query_rounds=${queryRounds}, included=${includedPapers}, candidate=${candidatePapers}.`
        : `Coverage is still thin or under-explained: query_rounds=${queryRounds}, included=${includedPapers}, candidate=${candidatePapers}.`,
      evidencePaths: [params.state.queryRegistryPath ?? "", params.state.coverageSummaryPath ?? ""].filter(Boolean),
      blockers: breadthReady
        ? []
        : ["Expand search breadth or strengthen COVERAGE_SUMMARY.md before finalizing the survey synthesis."],
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

  const requiredRepresentativeRows =
    includedPapers >= 12 ? 5 : includedPapers >= 8 ? 4 : includedPapers >= 4 ? 3 : includedPapers >= 2 ? 2 : includedPapers >= 1 ? 1 : 0;
  let representativeMethods = buildDiagnostic({
    status: "missing",
    summary: "Representative methods have not been mapped into the SoTA matrix yet.",
    evidencePaths: [params.state.includedPapersPath ?? "", params.state.sotaMatrixPath ?? ""].filter(Boolean),
    blockers: ["Populate SOTA_MATRIX.md with representative methods from the included set before write handoff."],
  });
  if (includedPapers > 0 || sotaMatrixNormalized) {
    const ready = requiredRepresentativeRows > 0 && sotaTable.rows >= requiredRepresentativeRows;
    representativeMethods = buildDiagnostic({
      status: ready ? "ready" : sotaTable.rows > 0 ? "partial" : "missing",
      summary: ready
        ? `Representative methods are covered in the SoTA matrix (${sotaTable.rows} rows for ${includedPapers} included papers).`
        : `Representative method coverage is still incomplete (${sotaTable.rows} matrix rows for ${includedPapers} included papers).`,
      evidencePaths: [params.state.includedPapersPath ?? "", params.state.sotaMatrixPath ?? ""].filter(Boolean),
      blockers: ready
        ? []
        : ["Expand SOTA_MATRIX.md so each major method family has representative entries before the survey is marked complete."],
    });
  }

  const hasBenchmarkHeader = sotaTable.header.some((entry) =>
    /\bdataset\b|\bbenchmark\b|\bsetting\b/.test(entry)
  );
  const hasMetricHeader = sotaTable.header.some((entry) =>
    /\bmetric\b|\bscore\b|\bacc\b|\baccuracy\b|\bf1\b|\bmap\b|\bauc\b/.test(entry)
  );
  const benchmarkKeywordSupport =
    hasAnyKeyword(sotaMatrixNormalized, [/\bdataset\b/, /\bbenchmark\b/, /\bmetric\b/]) ||
    hasAnyKeyword(coverageSummaryNormalized, [/\bdataset\b/, /\bbenchmark\b/, /\bmetric\b/]) ||
    hasAnyKeyword(reviewProtocolNormalized, [/\bdataset\b/, /\bbenchmark\b/, /\bmetric\b/]);
  const benchmarkAligned = hasBenchmarkHeader && hasMetricHeader;
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
    ...gapClosure.blockers,
  ];
  const warnings = [
    ...coverage.warnings,
    ...taxonomyStability.warnings,
    ...representativeMethods.warnings,
    ...benchmarkAlignment.warnings,
    ...gapClosure.warnings,
  ];
  const ready =
    coverage.status === "ready" &&
    taxonomyStability.status === "stable" &&
    representativeMethods.status === "ready" &&
    benchmarkAlignment.status === "aligned" &&
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
      sotaMatrixRows: sotaTable.rows,
      taxonomyItems: uniqueTaxonomyItems.length,
      gapItems: gapItems.length,
    },
    coverage,
    taxonomyStability,
    representativeMethods,
    benchmarkAlignment,
    gapClosure,
  };

  await writeJsonEnsured(diagnosticsPath, diagnostics);
  return diagnostics;
}
