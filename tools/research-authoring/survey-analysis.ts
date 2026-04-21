import {
  materializeSurveyReviewDiagnostics,
} from "../survey-review-diagnostics";
import { readJsonIfExists } from "../workflow-guard-core/fs";
import {
  nowIso,
  readProjectManifest,
  readProjectText,
  writeProjectJson,
  writeProjectText,
} from "../research-contracts/core/project-io";
import {
  collectSurveyBackgroundReferenceLines,
  collectSurveyEntries,
} from "../survey-review-artifacts";
import { normalizeSurveyReviewState } from "../workflow-guard-state/survey-review";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import { materializeFairCompareMatrix } from "../research-evidence/fair-compare";

export const DEFAULT_SURVEY_COMPARABILITY_REPORT_PATH =
  "academic_writer/SURVEY_COMPARABILITY_REPORT.md";
export const DEFAULT_SURVEY_SOURCE_TO_CLAIM_INDEX_PATH =
  "researcher/SOURCE_TO_CLAIM_INDEX.json";
export const DEFAULT_SURVEY_TRACEABILITY_AUDIT_PATH =
  "researcher/SURVEY_TRACEABILITY_AUDIT.json";

function extractMatrixMethods(matrixText: string): string[] {
  const methods = new Set<string>();
  for (const line of matrixText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      continue;
    }
    const cells = trimmed
      .split("|")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (cells.length >= 2 && !/^---+$/.test(cells[0].replace(/:/g, "")) && cells[0].toLowerCase() !== "method") {
      methods.add(cells[0]);
    }
  }
  return [...methods];
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string | null | undefined): string[] {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }
  return Array.from(
    new Set(
      normalized
        .split(" ")
        .map((token) => token.trim())
        .filter((token) => token.length >= 3)
    )
  );
}

function buildIncludedSourceEntries(value: unknown): Array<{
  canonicalId: string | null;
  title: string | null;
  normalizedTitle: string;
}> {
  return collectSurveyEntries(value, ["papers", "included", "includedPapers", "items"]).map((entry) => ({
    canonicalId:
      (typeof entry.canonical_id === "string" && entry.canonical_id.trim()) ||
      (typeof entry.canonicalId === "string" && entry.canonicalId.trim()) ||
      null,
    title:
      (typeof entry.title === "string" && entry.title.trim()) ||
      (typeof entry.paper_title === "string" && entry.paper_title.trim()) ||
      (typeof entry.paperTitle === "string" && entry.paperTitle.trim()) ||
      (typeof entry.name === "string" && entry.name.trim()) ||
      null,
    normalizedTitle: normalizeText(
      (typeof entry.title === "string" && entry.title) ||
        (typeof entry.paper_title === "string" && entry.paper_title) ||
        (typeof entry.paperTitle === "string" && entry.paperTitle) ||
        (typeof entry.name === "string" && entry.name) ||
        ""
    ),
  }));
}

function claimUsesBenchmarkLanguage(text: string): boolean {
  return /\bbenchmark|dataset|metric|accuracy|f1|auc|map|protocol|setting|leaderboard\b/i.test(text);
}

function claimUsesGapLanguage(text: string): boolean {
  return /\bgap|open problem|limitation|challenge|future|blind spot|contradiction\b/i.test(text);
}

export async function materializeSurveyAnalysis(params: {
  projectRoot: string;
  outputReportPath?: string;
  outputIndexPath?: string;
  traceabilityAuditPath?: string;
}) {
  const manifest = await readProjectManifest(params.projectRoot);
  const surveyState = normalizeSurveyReviewState(manifest.survey_review);
  const diagnostics = await materializeSurveyReviewDiagnostics({
    projectRoot: params.projectRoot,
    state: surveyState,
  });
  const [
    briefText,
    reviewText,
    matrixText,
    includedJsonValue,
    excludedJsonValue,
    screeningDecisionsValue,
  ] = await Promise.all([
    readProjectText(params.projectRoot, surveyState.surveyBriefPath),
    readProjectText(params.projectRoot, surveyState.literatureReviewPath),
    readProjectText(params.projectRoot, surveyState.sotaMatrixPath),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(params.projectRoot, surveyState.includedPapersPath) ?? ""
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(params.projectRoot, surveyState.excludedPapersPath) ?? ""
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(params.projectRoot, surveyState.screeningDecisionsPath) ?? ""
    ),
  ]);
  const methods = extractMatrixMethods(matrixText ?? "");
  const fairCompareRows = await materializeFairCompareMatrix({
    projectRoot: params.projectRoot,
    matrixText: matrixText ?? "",
  }).catch(() => []);
  const includedSources = buildIncludedSourceEntries(includedJsonValue);
  const backgroundAnchors = collectSurveyBackgroundReferenceLines({
    excludedPapers: excludedJsonValue,
    screeningDecisions: screeningDecisionsValue,
    limit: 8,
  });
  const claims = `${briefText ?? ""}\n${reviewText ?? ""}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") || line.startsWith("1)") || line.startsWith("1."))
    .map((line, index) => ({
      claimId: `survey-claim-${index + 1}`,
      text: line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, ""),
      supportingMethods: methods.filter((method) =>
        normalizeText(line).includes(normalizeText(method))
      ),
    }));
  const enrichedClaims = claims.map((claim) => {
    const normalizedClaim = normalizeText(claim.text);
    const claimTokens = tokenize(claim.text);
    const supportingCanonicalIds = includedSources
      .filter((entry) => {
        if (entry.normalizedTitle && normalizedClaim.includes(entry.normalizedTitle)) {
          return true;
        }
        if (entry.title && claim.supportingMethods.some((method) => normalizeText(entry.title).includes(normalizeText(method)))) {
          return true;
        }
        const overlap = claimTokens.filter((token) => entry.normalizedTitle.includes(token));
        return overlap.length >= 3;
      })
      .map((entry) => entry.canonicalId)
      .filter((value): value is string => Boolean(value));
    const supportingFairCompareRows = fairCompareRows
      .filter((row) => {
        const normalizedMethod = normalizeText(row.method);
        const normalizedBenchmark = normalizeText(row.benchmark);
        const normalizedMetric = normalizeText(row.metric);
        return (
          (normalizedMethod && normalizedClaim.includes(normalizedMethod)) ||
          (normalizedBenchmark && normalizedClaim.includes(normalizedBenchmark)) ||
          (normalizedMetric && normalizedClaim.includes(normalizedMetric))
        );
      })
      .map((row) => ({
        method: row.method,
        benchmark: row.benchmark,
        metric: row.metric,
        fairness: row.fairness,
      }));
    const sourceArtifacts = [
      "researcher/SURVEY_BRIEF.md",
      "researcher/LITERATURE_REVIEW.md",
      ...(claimUsesBenchmarkLanguage(claim.text)
        ? ["researcher/SOTA_MATRIX.md", "researcher/REVIEW_PROTOCOL.md", "analyzer/FAIR_COMPARE_MATRIX.json"]
        : []),
      ...(claimUsesGapLanguage(claim.text)
        ? ["researcher/GAP_SYNTHESIS.md", "researcher/COVERAGE_SUMMARY.md"]
        : []),
      ...(supportingCanonicalIds.length > 0 ? ["researcher/INCLUDED_PAPERS.json"] : []),
    ];
    const traceabilityStatus =
      supportingCanonicalIds.length > 0 ||
      claim.supportingMethods.length > 0 ||
      supportingFairCompareRows.length > 0 ||
      claimUsesGapLanguage(claim.text)
        ? "ready"
        : "needs_review";
    return {
      ...claim,
      sourceArtifacts: Array.from(new Set(sourceArtifacts)),
      supportingCanonicalIds,
      supportingFairCompareRows,
      traceabilityStatus,
    };
  });
  const unsupportedClaims = enrichedClaims.filter((claim) => claim.traceabilityStatus !== "ready");
  const fairnessCounts = fairCompareRows.reduce<Record<string, number>>((counts, row) => {
    counts[row.fairness] = (counts[row.fairness] ?? 0) + 1;
    return counts;
  }, {});
  const comparabilityReady =
    diagnostics.benchmarkAlignment.status === "aligned" &&
    fairCompareRows.length > 0;
  const traceabilityReady =
    enrichedClaims.length > 0 &&
    unsupportedClaims.length === 0;
  const blockingIssues = [
    ...(comparabilityReady
      ? []
      : [
          fairCompareRows.length === 0
            ? "SOTA matrix still lacks a usable fair-compare table for survey-level benchmark comparison."
            : "Survey benchmark alignment is not yet ready enough to trust the fair-compare matrix.",
        ]),
    ...(traceabilityReady
      ? []
      : [
          unsupportedClaims.length > 0
            ? `${unsupportedClaims.length} survey synthesis claim(s) still need clearer source traceability.`
            : "No survey synthesis claims were indexed for traceability.",
        ]),
  ];
  const warnings = [
    ...(fairnessCounts.unclear ? [`${fairnessCounts.unclear} fair-compare row(s) still have unclear fairness assumptions.`] : []),
    ...(backgroundAnchors.length > 0
      ? [`Boundary references remain important for scope honesty: ${backgroundAnchors.slice(0, 2).join("; ")}.`]
      : []),
  ];
  const reportLines = [
    "# Survey Comparability Report",
    "",
    `- Ready: ${diagnostics.ready && comparabilityReady && traceabilityReady ? "yes" : "no"}`,
    `- Coverage: ${diagnostics.coverage.status}`,
    `- Taxonomy: ${diagnostics.taxonomyStability.status}`,
    `- Benchmark alignment: ${diagnostics.benchmarkAlignment.status}`,
    `- Fair compare rows: ${fairCompareRows.length}`,
    `- Traceable claims: ${enrichedClaims.length - unsupportedClaims.length}/${enrichedClaims.length}`,
    `- Background anchors: ${backgroundAnchors.length}`,
    "",
    "## Warnings",
    ...diagnostics.warnings.map((warning) => `- ${warning}`),
    ...warnings.map((warning) => `- ${warning}`),
    "",
    "## Blocking issues",
    ...diagnostics.blockingIssues.map((issue) => `- ${issue}`),
    ...blockingIssues.map((issue) => `- ${issue}`),
    "",
    "## Fair Compare Summary",
    ...Object.entries(fairnessCounts).map(([fairness, count]) => `- ${fairness}: ${count}`),
    ...(Object.keys(fairnessCounts).length === 0 ? ["- none"] : []),
    "",
    "## Traceability Warnings",
    ...(unsupportedClaims.length > 0
      ? unsupportedClaims.map((claim) => `- ${claim.claimId}: ${claim.text}`)
      : ["- none"]),
  ];
  await writeProjectText(
    params.projectRoot,
    params.outputReportPath ?? DEFAULT_SURVEY_COMPARABILITY_REPORT_PATH,
    `${reportLines.join("\n")}\n`
  );
  await writeProjectJson(
    params.projectRoot,
    params.outputIndexPath ?? DEFAULT_SURVEY_SOURCE_TO_CLAIM_INDEX_PATH,
    {
      schemaVersion: 1,
      generatedAt: nowIso(),
      methods,
      fairCompareRows,
      fairnessCounts,
      backgroundAnchors,
      claims: enrichedClaims,
    }
  );
  await writeProjectJson(
    params.projectRoot,
    params.traceabilityAuditPath ?? DEFAULT_SURVEY_TRACEABILITY_AUDIT_PATH,
    {
      schemaVersion: 1,
      generatedAt: nowIso(),
      ready: traceabilityReady && comparabilityReady,
      comparabilityReady,
      traceabilityReady,
      claimCount: enrichedClaims.length,
      traceableClaimCount: enrichedClaims.length - unsupportedClaims.length,
      unsupportedClaimCount: unsupportedClaims.length,
      fairCompareRowCount: fairCompareRows.length,
      backgroundAnchorCount: backgroundAnchors.length,
      blockingIssues,
      warnings,
    }
  );
  return {
    diagnostics,
    methodCount: methods.length,
    claimCount: enrichedClaims.length,
    fairCompareRowCount: fairCompareRows.length,
    traceableClaimCount: enrichedClaims.length - unsupportedClaims.length,
    unsupportedClaimCount: unsupportedClaims.length,
    comparabilityReady,
    traceabilityReady,
    reportPath: params.outputReportPath ?? DEFAULT_SURVEY_COMPARABILITY_REPORT_PATH,
    sourceToClaimIndexPath: params.outputIndexPath ?? DEFAULT_SURVEY_SOURCE_TO_CLAIM_INDEX_PATH,
    traceabilityAuditPath:
      params.traceabilityAuditPath ?? DEFAULT_SURVEY_TRACEABILITY_AUDIT_PATH,
    backgroundAnchorCount: backgroundAnchors.length,
    blockingIssues,
    warnings,
  };
}
