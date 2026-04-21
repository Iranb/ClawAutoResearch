import {
  materializeSurveyReviewDiagnostics,
} from "../survey-review-diagnostics";
import { readJsonIfExists } from "../workflow-guard-core/fs";
import {
  nowIso,
  readProjectManifest,
  readProjectText,
  writeProjectJson,
  writeProjectManifest,
  writeProjectText,
} from "../research-contracts/core/project-io";
import {
  collectSurveyBackgroundReferenceLines,
  collectSurveyEntries,
  summarizeSurveyRoleCoverage,
} from "../survey-review-artifacts";
import { normalizeSurveyReviewState } from "../workflow-guard-state/survey-review";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import { materializeFairCompareMatrix } from "../research-evidence/fair-compare";
import {
  normalizeBenchmarkProtocolState,
  normalizeVenueCompetitionState,
  serializeBenchmarkProtocolState,
} from "../research-contracts/evidence-contracts";
import { materializeVenueCompetitionIntel } from "../research-intel/venue-competition";

export const DEFAULT_SURVEY_COMPARABILITY_REPORT_PATH =
  "academic_writer/SURVEY_COMPARABILITY_REPORT.md";
export const DEFAULT_SURVEY_SOURCE_TO_CLAIM_INDEX_PATH =
  "researcher/SOURCE_TO_CLAIM_INDEX.json";
export const DEFAULT_SURVEY_TRACEABILITY_AUDIT_PATH =
  "researcher/SURVEY_TRACEABILITY_AUDIT.json";
export const DEFAULT_SURVEY_TOP_TIER_BRIDGE_PATH =
  "researcher/SURVEY_TOP_TIER_BRIDGE.json";

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

function sortedCountKeys(counts: Record<string, number>): string[] {
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key]) => key);
}

export async function materializeSurveyAnalysis(params: {
  projectRoot: string;
  outputReportPath?: string;
  outputIndexPath?: string;
  traceabilityAuditPath?: string;
  topTierBridgePath?: string;
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
  const roleCoverage = summarizeSurveyRoleCoverage({
    screeningDecisions: screeningDecisionsValue,
    includedPapers: includedJsonValue,
    excludedPapers: excludedJsonValue,
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
    ...(Object.keys(roleCoverage.paperRoleCounts).length === 0
      ? [
          "Screening packet still lacks paper_role annotations for closest prior work / strongest baseline style routing.",
        ]
      : []),
  ];
  const benchmarkFamilies = [
    ...fairCompareRows
      .map((row) => row.benchmark)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
    ...sortedCountKeys(roleCoverage.benchmarkFamilyCounts),
  ].filter((value, index, values) => values.indexOf(value) === index);
  const primaryMetrics = fairCompareRows
    .map((row) => row.metric)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .filter((value, index, values) => values.indexOf(value) === index);
  const protocolHints = fairCompareRows
    .map((row) => row.protocol)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .filter((value, index, values) => values.indexOf(value) === index);
  const currentBenchmarkProtocol = normalizeBenchmarkProtocolState(
    manifest.benchmark_protocol
  );
  const benchmarkHintsPath = "researcher/SURVEY_BENCHMARK_HINTS.json";
  const protocolHintsPath = "researcher/SURVEY_PROTOCOL_HINTS.json";
  const fairnessHintsPath = "researcher/SURVEY_BASELINE_FAIRNESS.json";
  await writeProjectJson(params.projectRoot, benchmarkHintsPath, {
    schemaVersion: 1,
    generatedAt: nowIso(),
    benchmarkFamilies,
    primaryMetrics,
    protocolHints,
    roleCoverage,
  });
  await writeProjectJson(params.projectRoot, protocolHintsPath, {
    schemaVersion: 1,
    generatedAt: nowIso(),
    selectedBenchmarkFamily:
      currentBenchmarkProtocol.benchmarkFamily ?? benchmarkFamilies[0] ?? null,
    selectedPrimaryMetric:
      currentBenchmarkProtocol.primaryMetric ?? primaryMetrics[0] ?? null,
    selectedProtocolHint:
      currentBenchmarkProtocol.splitDescriptor ?? protocolHints[0] ?? null,
    locked: false,
    source: "survey_analysis",
  });
  await writeProjectJson(params.projectRoot, fairnessHintsPath, {
    schemaVersion: 1,
    generatedAt: nowIso(),
    fairCompareRowCount: fairCompareRows.length,
    fairnessCounts,
    summary:
      comparabilityReady
        ? "Survey packet already exposes benchmark-level fair compare rows."
        : blockingIssues[0] ?? "Fair-compare support is still incomplete.",
  });
  let nextBenchmarkProtocol = currentBenchmarkProtocol;
  if (
    currentBenchmarkProtocol.status === "missing" &&
    (benchmarkFamilies.length > 0 || primaryMetrics.length > 0 || fairCompareRows.length > 0)
  ) {
    nextBenchmarkProtocol = normalizeBenchmarkProtocolState({
      ...serializeBenchmarkProtocolState(currentBenchmarkProtocol),
      status: "partial",
      benchmark_family: benchmarkFamilies[0] ?? null,
      primary_metric: primaryMetrics[0] ?? null,
      split_descriptor: protocolHints[0] ?? null,
      evaluation_harness: protocolHints[0] ?? null,
      registry_path: benchmarkHintsPath,
      protocol_lock_path: protocolHintsPath,
      fairness_report_path: fairnessHintsPath,
      official_eval_recipe: protocolHints[0] ?? primaryMetrics[0] ?? null,
      locked: false,
      drift_status: "pending",
      fair_compare_status:
        comparabilityReady ? "pass" : fairCompareRows.length > 0 ? "warning" : "missing",
      fair_compare_summary:
        comparabilityReady
          ? "Survey-derived benchmark hints expose at least one fair-compare row."
          : blockingIssues[0] ??
            "Survey-derived benchmark hints still need stronger comparability support.",
      allowed_deviation_count:
        (fairnessCounts.backbone_confounded ?? 0) +
        (fairnessCounts.protocol_confounded ?? 0),
      allowed_deviation_status:
        (fairnessCounts.backbone_confounded ?? 0) +
          (fairnessCounts.protocol_confounded ?? 0) >
        0
          ? "blocked"
          : "none",
      pending_reason:
        "Survey-derived benchmark hints are available, but experiment-grade protocol lock still requires planner/experiment confirmation.",
      last_materialized_at: nowIso(),
    });
    manifest.benchmark_protocol = serializeBenchmarkProtocolState(nextBenchmarkProtocol);
    await writeProjectManifest(params.projectRoot, manifest);
  }
  const venueCompetition =
    benchmarkFamilies.length > 0 || includedSources.length > 0
      ? await materializeVenueCompetitionIntel({
          projectRoot: params.projectRoot,
        }).catch(() => normalizeVenueCompetitionState(manifest.venue_competition))
      : normalizeVenueCompetitionState(manifest.venue_competition);
  const topTierBridgePath =
    params.topTierBridgePath ?? DEFAULT_SURVEY_TOP_TIER_BRIDGE_PATH;
  const topTierBridgeReady =
    benchmarkFamilies.length > 0 && (comparabilityReady || fairCompareRows.length > 0);
  await writeProjectJson(params.projectRoot, topTierBridgePath, {
    schemaVersion: 1,
    generatedAt: nowIso(),
    ready: topTierBridgeReady,
    roleCoverage,
    benchmarkHints: {
      benchmarkFamilies,
      primaryMetrics,
      protocolHints,
      selectedBenchmarkFamily:
        nextBenchmarkProtocol.benchmarkFamily ?? benchmarkFamilies[0] ?? null,
      selectedPrimaryMetric:
        nextBenchmarkProtocol.primaryMetric ?? primaryMetrics[0] ?? null,
    },
    contracts: {
      benchmarkProtocol: {
        status: nextBenchmarkProtocol.status,
        benchmarkFamily: nextBenchmarkProtocol.benchmarkFamily,
        fairCompareStatus: nextBenchmarkProtocol.fairCompareStatus,
        pendingReason: nextBenchmarkProtocol.pendingReason,
      },
      venueCompetition: {
        status: venueCompetition.status,
        competitorSlatePath: venueCompetition.competitorSlatePath,
        acceptanceRiskStatus: venueCompetition.acceptanceRiskStatus,
        pendingReason: venueCompetition.pendingReason,
      },
    },
    blockingIssues: [
      ...(topTierBridgeReady
        ? []
        : [
            benchmarkFamilies.length === 0
              ? "Survey packet still lacks benchmark-family hints strong enough to seed top-tier evidence contracts."
              : "Survey packet still needs stronger fair-compare support before the top-tier bridge is trustworthy.",
          ]),
    ],
    warnings: [
      ...(venueCompetition.status === "ready"
        ? []
        : [
            "Venue competition contract is still partial or missing; competitor slate should be refreshed before top-tier positioning claims.",
          ]),
      ...warnings,
    ],
  });
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
      roleCoverage,
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
    topTierBridgePath,
    roleCoverage,
    benchmarkProtocolStatus: nextBenchmarkProtocol.status,
    venueCompetitionStatus: venueCompetition.status,
    backgroundAnchorCount: backgroundAnchors.length,
    blockingIssues,
    warnings,
  };
}
