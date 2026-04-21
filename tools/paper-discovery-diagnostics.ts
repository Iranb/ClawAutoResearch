import * as path from "node:path";
import { readJsonIfExists, writeJsonEnsured, writeTextEnsured } from "./workflow-guard-core/fs";
import { asString } from "./workflow-guard-core/coercion";
import {
  readWorkflowPaperSourceIndex,
  type WorkflowPaperSourceEntry,
} from "./paper-source-index";
import { resolveProjectArtifactPath } from "./workflow-guard-core/paths";
import { normalizeSurveyReviewState } from "./workflow-guard-state/survey-review";
import {
  collectSurveyEntries,
  summarizeSurveyQueryRegistry,
  summarizeSurveyScreening,
} from "./survey-review-artifacts";
import { scorePaperTopicRelevance } from "./research30/topic-relevance";
import { readPaperBodyText } from "./research30/paper-body-text";

export type LiteratureCoverageVerdict = "thin" | "adequate" | "strong";

export type LiteratureCoverageAudit = {
  projectId: string | null;
  generatedAt: string;
  auditPath: string;
  markdownPath: string;
  verdict: LiteratureCoverageVerdict;
  focusTopic: string | null;
  focusSource: "screened_included" | "topic_relevant" | "full_source_index";
  totalPapers: number;
  recentPaperCount: number;
  screenedIncludedCount: number;
  backgroundPaperCount: number;
  pendingScreeningCount: number;
  pendingRoundCount: number;
  metadataGaps: {
    missingCanonicalId: number;
    missingYear: number;
    missingVenue: number;
    missingSourcePath: number;
    metadataOnlyUnresolved: number;
  };
  providerCoverage: Record<string, number>;
  venueCoverage: Record<string, number>;
  yearCoverage: Record<string, number>;
  baselineHints: string[];
  baselineMatches: Array<{
    hint: string;
    canonicalIds: string[];
    titles: string[];
  }>;
  missingBaselineHints: string[];
  recommendations: string[];
  topicRelevance: {
    auditPath: string;
    markdownPath: string;
    relevantCount: number;
    boundaryCount: number;
    offTopicCount: number;
    screenedIncludedOffTopicCount: number;
    insufficientEvidenceCount: number;
    fullTextReviewedCount: number;
    titleOnlyCount: number;
  };
};

export type TopicRelevanceAuditEntry = {
  canonicalId: string | null;
  title: string | null;
  score: number;
  status: "relevant" | "boundary" | "off_topic" | "insufficient_evidence";
  evidenceSource: "missing" | "title" | "title_abstract" | "full_text";
  matchedTokens: string[];
  matchedPhrases: string[];
  bodySourcePath: string | null;
};

export type TopicRelevanceAudit = {
  projectId: string | null;
  generatedAt: string;
  topic: string | null;
  auditPath: string;
  markdownPath: string;
  relevantCount: number;
  boundaryCount: number;
  offTopicCount: number;
  insufficientEvidenceCount: number;
  fullTextReviewedCount: number;
  titleOnlyCount: number;
  entries: TopicRelevanceAuditEntry[];
};

export type CitationExpansionPacket = {
  projectId: string | null;
  generatedAt: string;
  packetPath: string;
  markdownPath: string;
  bounded: true;
  maxSeeds: number;
  seeds: Array<{
    canonicalId: string | null;
    title: string | null;
    reason: string;
  }>;
  queries: Array<{
    type: "forward_citations" | "backward_references" | "keyword_refresh";
    seedCanonicalId: string | null;
    seedTitle: string | null;
    query: string;
    rationale: string;
  }>;
  recommendations: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => asString(value)).filter(Boolean))] as string[];
}

function normalizeTitle(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return normalized || null;
}

function readBaselineHints(manifest: Record<string, unknown>): string[] {
  const researchProgram = asRecord(manifest.research_program) ?? {};
  return uniqueStrings([
    asString(researchProgram.baseline_reference ?? researchProgram.baselineReference),
    ...((Array.isArray(researchProgram.required_baselines)
      ? researchProgram.required_baselines
      : Array.isArray(researchProgram.requiredBaselines)
        ? researchProgram.requiredBaselines
        : []) as unknown[]).map((entry) => asString(entry)),
  ]);
}

function countBy<T extends string>(values: Array<T | null | undefined>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = asString(value);
    if (!key) {
      continue;
    }
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function selectCitationSeeds(entries: WorkflowPaperSourceEntry[], maxSeeds: number) {
  const sorted = [...entries].sort((left, right) => {
    const rightCitation = right.citationCount ?? -1;
    const leftCitation = left.citationCount ?? -1;
    if (rightCitation !== leftCitation) {
      return rightCitation - leftCitation;
    }
    const rightYear = right.year ?? -1;
    const leftYear = left.year ?? -1;
    return rightYear - leftYear;
  });
  return sorted
    .filter((entry) => entry.title || entry.canonicalId)
    .slice(0, Math.max(1, maxSeeds));
}

function buildEntryIdentityKeys(entry: {
  canonicalId?: string | null;
  doi?: string | null;
  arxivId?: string | null;
  title?: string | null;
}): string[] {
  return uniqueStrings(
    [entry.canonicalId, entry.doi, entry.arxivId]
      .map((value) => asString(value)?.toLowerCase() ?? null)
      .concat(normalizeTitle(entry.title))
  );
}

function buildIncludedIdentityKeySet(entries: Record<string, unknown>[]): Set<string> {
  return new Set(
    entries.flatMap((entry) =>
      uniqueStrings([
        asString(entry.canonical_id ?? entry.canonicalId)?.toLowerCase() ?? null,
        asString(entry.doi)?.toLowerCase() ?? null,
        asString(entry.arxiv ?? entry.arxiv_id ?? entry.arxivId)?.toLowerCase() ?? null,
        normalizeTitle(asString(entry.title ?? entry.paper_title ?? entry.paperTitle ?? entry.name)),
      ])
    )
  );
}

async function evaluateTopicRelevanceForEntries(params: {
  projectId: string | null;
  projectRoot: string;
  entries: WorkflowPaperSourceEntry[];
  topic: string | null;
}): Promise<TopicRelevanceAudit> {
  const generatedAt = new Date().toISOString();
  const auditPath = path.join(params.projectRoot, "researcher", "TOPIC_RELEVANCE_AUDIT.json");
  const markdownPath = path.join(params.projectRoot, "researcher", "TOPIC_RELEVANCE_AUDIT.md");
  const topic = params.topic;
  if (!topic) {
    const emptyAudit: TopicRelevanceAudit = {
      projectId: params.projectId,
      generatedAt,
      topic: null,
      auditPath,
      markdownPath,
      relevantCount: 0,
      boundaryCount: 0,
      offTopicCount: 0,
      insufficientEvidenceCount: 0,
      fullTextReviewedCount: 0,
      titleOnlyCount: 0,
      entries: [],
    };
    await writeJsonEnsured(auditPath, emptyAudit);
    await writeTextEnsured(
      markdownPath,
      "# Topic Relevance Audit\n\n- Topic: none\n- Status: skipped because the project topic is missing.\n"
    );
    return emptyAudit;
  }
  const results = await Promise.all(
    params.entries.map(async (entry) => {
      const body = await readPaperBodyText({ entry });
      const relevance = scorePaperTopicRelevance({
        topic,
        title: entry.title,
        bodyText: body.text,
      });
      const status: TopicRelevanceAuditEntry["status"] =
        relevance.score >= 45
          ? "relevant"
          : relevance.score >= 24
            ? "boundary"
            : body.text || entry.sourcePath
              ? "off_topic"
              : "insufficient_evidence";
      return {
        canonicalId: entry.canonicalId,
        title: entry.title,
        score: relevance.score,
        status,
        evidenceSource: relevance.evidenceSource,
        matchedTokens: relevance.matchedTokens,
        matchedPhrases: relevance.matchedPhrases,
        bodySourcePath: body.sourcePath,
      } satisfies TopicRelevanceAuditEntry;
    })
  );
  const sortedEntries = [...results].sort(
    (left, right) =>
      right.score - left.score ||
      (left.title ?? left.canonicalId ?? "").localeCompare(right.title ?? right.canonicalId ?? "")
  );
  const audit: TopicRelevanceAudit = {
      projectId: params.projectId,
      generatedAt,
      topic,
      auditPath,
    markdownPath,
    relevantCount: sortedEntries.filter((entry) => entry.status === "relevant").length,
    boundaryCount: sortedEntries.filter((entry) => entry.status === "boundary").length,
    offTopicCount: sortedEntries.filter((entry) => entry.status === "off_topic").length,
    insufficientEvidenceCount: sortedEntries.filter(
      (entry) => entry.status === "insufficient_evidence"
    ).length,
    fullTextReviewedCount: sortedEntries.filter((entry) => entry.evidenceSource === "full_text").length,
    titleOnlyCount: sortedEntries.filter((entry) => entry.evidenceSource !== "full_text").length,
    entries: sortedEntries,
  };
  const markdown = [
    "# Topic Relevance Audit",
    "",
    `- Generated at: ${audit.generatedAt}`,
    `- Topic: ${audit.topic ?? "unset"}`,
    `- Relevant: ${audit.relevantCount}`,
    `- Boundary: ${audit.boundaryCount}`,
    `- Off-topic: ${audit.offTopicCount}`,
    `- Insufficient evidence: ${audit.insufficientEvidenceCount}`,
    `- Full-text reviewed: ${audit.fullTextReviewedCount}`,
    `- Title/metadata only: ${audit.titleOnlyCount}`,
    "",
    "## Top Entries",
    ...audit.entries.slice(0, 20).map(
      (entry) =>
        `- ${entry.title ?? entry.canonicalId ?? "unknown"} | status=${entry.status} | score=${entry.score} | evidence=${entry.evidenceSource} | matched=${entry.matchedTokens.join(", ") || "none"}`
    ),
    "",
  ].join("\n");
  await writeJsonEnsured(auditPath, audit);
  await writeTextEnsured(markdownPath, `${markdown}\n`);
  return audit;
}

function buildCoverageMarkdown(audit: LiteratureCoverageAudit): string {
  const lines = [
    "# Literature Coverage Audit",
    "",
    `- Generated at: ${audit.generatedAt}`,
    `- Verdict: ${audit.verdict}`,
    `- Focus topic: ${audit.focusTopic ?? "none"}`,
    `- Focus source: ${audit.focusSource}`,
    `- Total papers: ${audit.totalPapers}`,
    `- Recent papers (last 2 years): ${audit.recentPaperCount}`,
    `- Screened included papers: ${audit.screenedIncludedCount}`,
    `- Background-related papers: ${audit.backgroundPaperCount}`,
    `- Pending retrieval rounds: ${audit.pendingRoundCount}`,
    `- Pending screening candidates: ${audit.pendingScreeningCount}`,
    `- Topic-relevant papers: ${audit.topicRelevance.relevantCount}`,
    `- Boundary papers: ${audit.topicRelevance.boundaryCount}`,
    `- Off-topic papers: ${audit.topicRelevance.offTopicCount}`,
    `- Screened included off-topic papers: ${audit.topicRelevance.screenedIncludedOffTopicCount}`,
    `- Full-text reviewed: ${audit.topicRelevance.fullTextReviewedCount}`,
    `- Metadata-only unresolved: ${audit.metadataGaps.metadataOnlyUnresolved}`,
    `- Missing baseline hints: ${audit.missingBaselineHints.join(", ") || "none"}`,
    "",
    "## Recommendations",
    ...audit.recommendations.map((entry) => `- ${entry}`),
  ];
  return `${lines.join("\n")}\n`;
}

function buildCitationExpansionMarkdown(packet: CitationExpansionPacket): string {
  const lines = [
    "# Citation Expansion Packet",
    "",
    `- Generated at: ${packet.generatedAt}`,
    `- Max seeds: ${packet.maxSeeds}`,
    "",
    "## Seeds",
    ...packet.seeds.map((seed) => `- ${seed.title ?? seed.canonicalId ?? "unknown"}: ${seed.reason}`),
    "",
    "## Queries",
    ...packet.queries.map(
      (query) => `- [${query.type}] ${query.seedTitle ?? query.seedCanonicalId ?? "unknown"} -> ${query.query}`
    ),
    "",
    "## Recommendations",
    ...packet.recommendations.map((entry) => `- ${entry}`),
  ];
  return `${lines.join("\n")}\n`;
}

export async function auditLiteratureCoverage(params: {
  projectRoot: string;
}): Promise<LiteratureCoverageAudit> {
  const generatedAt = new Date().toISOString();
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(params.projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const projectId = asString(manifest.project_id ?? manifest.projectId) ?? null;
  const { entries } = await readWorkflowPaperSourceIndex({
    projectRoot: params.projectRoot,
  });
  const surveyState = normalizeSurveyReviewState(manifest.survey_review);
  const surveyTopic =
    asString(surveyState.topic) ??
    asString((manifest.research_program as Record<string, unknown> | undefined)?.goal) ??
    null;
  const [includedJson, excludedJson, candidateJson, screeningDecisionsJson, queryRegistry] =
    await Promise.all([
      readJsonIfExists<Record<string, unknown>>(
        resolveProjectArtifactPath(params.projectRoot, surveyState.includedPapersPath) ?? ""
      ),
      readJsonIfExists<Record<string, unknown>>(
        resolveProjectArtifactPath(params.projectRoot, surveyState.excludedPapersPath) ?? ""
      ),
      readJsonIfExists<Record<string, unknown>>(
        resolveProjectArtifactPath(params.projectRoot, surveyState.candidatePapersPath) ?? ""
      ),
      readJsonIfExists<Record<string, unknown>>(
        resolveProjectArtifactPath(params.projectRoot, surveyState.screeningDecisionsPath) ?? ""
      ),
      readJsonIfExists<Record<string, unknown>>(
        resolveProjectArtifactPath(params.projectRoot, surveyState.queryRegistryPath) ?? ""
      ),
    ]);
  const querySummary = summarizeSurveyQueryRegistry(queryRegistry);
  const screeningSummary = summarizeSurveyScreening({
    candidatePapers: candidateJson,
    screeningDecisions: screeningDecisionsJson,
    includedPapers: includedJson,
    excludedPapers: excludedJson,
  });
  const includedEntries = collectSurveyEntries(includedJson, [
    "papers",
    "included",
    "includedPapers",
    "items",
  ]);
  const includedKeys = buildIncludedIdentityKeySet(includedEntries);
  const screenedEntries = entries.filter((entry) => {
    const candidates = buildEntryIdentityKeys({
      canonicalId: entry.canonicalId,
      doi: entry.doi,
      arxivId: entry.arxivId,
      title: entry.title,
    });
    return candidates.some((value) => includedKeys.has(value));
  });
  const topicRelevanceAudit = await evaluateTopicRelevanceForEntries({
    projectId,
    projectRoot: params.projectRoot,
    entries,
    topic: surveyTopic,
  });
  const relevantKeySet = new Set(
    topicRelevanceAudit.entries
      .filter((entry) => entry.status === "relevant" || entry.status === "boundary")
      .flatMap((entry) =>
        buildEntryIdentityKeys({
          canonicalId: entry.canonicalId,
          title: entry.title,
        })
      )
  );
  const offTopicScreenedCount = topicRelevanceAudit.entries.filter((entry) => {
    if (entry.status !== "off_topic") {
      return false;
    }
    const keys = buildEntryIdentityKeys({
      canonicalId: entry.canonicalId,
      title: entry.title,
    });
    return keys.some((value) => includedKeys.has(value));
  }).length;
  const topicRelevantEntries =
    surveyTopic != null
      ? entries.filter((entry) =>
          buildEntryIdentityKeys({
            canonicalId: entry.canonicalId,
            doi: entry.doi,
            arxivId: entry.arxivId,
            title: entry.title,
          }).some((value) => relevantKeySet.has(value))
        )
      : entries;
  const focusEntries =
    screenedEntries.length > 0
      ? screenedEntries
      : topicRelevantEntries.length > 0
        ? topicRelevantEntries
        : entries;
  const focusSource: LiteratureCoverageAudit["focusSource"] =
    screenedEntries.length > 0
      ? "screened_included"
      : topicRelevantEntries.length > 0
        ? "topic_relevant"
        : "full_source_index";
  const currentYear = new Date(generatedAt).getUTCFullYear();
  const recentPaperCount =
    includedEntries.length > 0
      ? includedEntries.filter((entry) => {
          const year = entry.year;
          return typeof year === "number" && Number.isFinite(year) && year >= currentYear - 1;
        }).length
      : focusEntries.filter(
          (entry) => typeof entry.year === "number" && entry.year >= currentYear - 1
        ).length;
  const baselineHints = readBaselineHints(manifest);
  const baselineMatches = baselineHints.map((hint) => {
    const normalizedHint = normalizeTitle(hint);
    const matches = focusEntries.filter((entry) => {
      const normalizedTitle = normalizeTitle(entry.title);
      return Boolean(normalizedHint && normalizedTitle && normalizedTitle.includes(normalizedHint));
    });
    return {
      hint,
      canonicalIds: uniqueStrings(matches.map((entry) => entry.canonicalId)),
      titles: uniqueStrings(matches.map((entry) => entry.title)),
    };
  });
  const missingBaselineHints = baselineMatches
    .filter((entry) => entry.canonicalIds.length === 0 && entry.titles.length === 0)
    .map((entry) => entry.hint);
  const effectivePaperCount =
    screeningSummary.includedCount > 0 ? screeningSummary.includedCount : focusEntries.length;
  const explicitSaturationReady =
    querySummary.hasExplicitSaturation &&
    querySummary.pendingRoundCount === 0 &&
    screeningSummary.pendingCount === 0;
  const recommendations: string[] = [];
  if (offTopicScreenedCount > 0) {
    recommendations.push(
      `${offTopicScreenedCount} screened included paper(s) look weakly related after body-aware topic relevance review; revisit the include/background boundary.`
    );
  }
  if (
    screeningSummary.includedCount > 0 &&
    topicRelevanceAudit.fullTextReviewedCount <
      Math.min(screeningSummary.includedCount, 5)
  ) {
    recommendations.push(
      "Full-text topic relevance coverage is still shallow; fetch markdown-first paper content for more included papers before trusting the boundary decisions."
    );
  }
  if (querySummary.pendingRoundCount > 0) {
    recommendations.push(
      `Survey retrieval still has ${querySummary.pendingRoundCount} pending round(s); do not treat coverage as final yet.`
    );
  }
  if (screeningSummary.pendingCount > 0) {
    recommendations.push(
      `Survey screening still has ${screeningSummary.pendingCount} pending candidate(s); finalize those decisions before trusting the packet.`
    );
  }
  if (effectivePaperCount < 15) {
    recommendations.push(
      "Paper set is still thin; expand discovery before trusting frontier or survey synthesis."
    );
  }
  if (recentPaperCount < 5) {
    recommendations.push(
      "Recent-paper coverage is weak; add a bounded refresh focused on the last two years."
    );
  }
  if (missingBaselineHints.length > 0) {
    recommendations.push(
      `Baseline hints still missing from PAPER_SOURCE_INDEX.json: ${missingBaselineHints.join(", ")}.`
    );
  }
  if (Object.keys(countBy(focusEntries.map((entry) => entry.sourceProvider))).length < 2) {
    recommendations.push(
      "Discovery sources are concentrated; consider mixing papers.cool with PASA or manual venue sweeps."
    );
  }
  if (
    surveyState.topic &&
    effectivePaperCount < 40 &&
    !explicitSaturationReady
  ) {
    recommendations.push(
      "Survey coverage is below the usual 40-paper comfort zone and saturation is not durably justified yet; keep bounded citation expansion running."
    );
  } else if (effectivePaperCount < 25) {
    recommendations.push(
      "Keep citation expansion running until the project reaches a healthier paper pool (roughly 25+ for experimental work, 40+ for survey work) or until saturation is explicitly justified."
    );
  }
  if (recommendations.length === 0) {
    recommendations.push(
      "Coverage looks stable enough for graph refresh; keep diagnostics non-blocking and refresh only if the topic shifts."
    );
  }
  const verdict: LiteratureCoverageVerdict =
    effectivePaperCount < 15 || missingBaselineHints.length > 0
      ? "thin"
      : offTopicScreenedCount > 0
        ? "adequate"
      : querySummary.pendingRoundCount > 0 || screeningSummary.pendingCount > 0
        ? "adequate"
        : surveyState.topic && effectivePaperCount < 40 && !explicitSaturationReady
          ? "adequate"
          : recentPaperCount < 5
        ? "adequate"
        : "strong";
  const auditPath = path.join(params.projectRoot, "researcher", "LITERATURE_COVERAGE_AUDIT.json");
  const markdownPath = path.join(
    params.projectRoot,
    "researcher",
    "LITERATURE_COVERAGE_AUDIT.md"
  );
  const audit: LiteratureCoverageAudit = {
    projectId,
    generatedAt,
    auditPath,
    markdownPath,
    verdict,
    focusTopic: surveyTopic,
    focusSource,
    totalPapers: effectivePaperCount,
    recentPaperCount,
    screenedIncludedCount: screeningSummary.includedCount,
    backgroundPaperCount: screeningSummary.backgroundCount,
    pendingScreeningCount: screeningSummary.pendingCount,
    pendingRoundCount: querySummary.pendingRoundCount,
    metadataGaps: {
      missingCanonicalId: focusEntries.filter((entry) => !entry.canonicalId).length,
      missingYear: focusEntries.filter((entry) => entry.year == null).length,
      missingVenue: focusEntries.filter((entry) => !entry.venue).length,
      missingSourcePath: focusEntries.filter((entry) => !entry.sourcePath).length,
      metadataOnlyUnresolved: focusEntries.filter(
        (entry) => entry.resolutionStatus === "metadata_only_unresolved"
      ).length,
    },
    providerCoverage: countBy(focusEntries.map((entry) => entry.sourceProvider)),
    venueCoverage: countBy(focusEntries.map((entry) => entry.venue)),
    yearCoverage: countBy(
      focusEntries.map((entry) => (entry.year != null ? String(entry.year) : null))
    ),
    baselineHints,
    baselineMatches,
    missingBaselineHints,
    recommendations,
    topicRelevance: {
      auditPath: topicRelevanceAudit.auditPath,
      markdownPath: topicRelevanceAudit.markdownPath,
      relevantCount: topicRelevanceAudit.relevantCount,
      boundaryCount: topicRelevanceAudit.boundaryCount,
      offTopicCount: topicRelevanceAudit.offTopicCount,
      screenedIncludedOffTopicCount: offTopicScreenedCount,
      insufficientEvidenceCount: topicRelevanceAudit.insufficientEvidenceCount,
      fullTextReviewedCount: topicRelevanceAudit.fullTextReviewedCount,
      titleOnlyCount: topicRelevanceAudit.titleOnlyCount,
    },
  };
  await writeJsonEnsured(auditPath, audit);
  await writeTextEnsured(markdownPath, buildCoverageMarkdown(audit));
  return audit;
}

export async function planCitationExpansion(params: {
  projectRoot: string;
  maxSeeds?: number | null;
}): Promise<CitationExpansionPacket> {
  const generatedAt = new Date().toISOString();
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(params.projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const projectId = asString(manifest.project_id ?? manifest.projectId) ?? null;
  const { entries } = await readWorkflowPaperSourceIndex({
    projectRoot: params.projectRoot,
  });
  const surveyState = normalizeSurveyReviewState(manifest.survey_review);
  const surveyTopic =
    asString(surveyState.topic) ??
    asString((manifest.research_program as Record<string, unknown> | undefined)?.goal) ??
    null;
  const [includedJson] = await Promise.all([
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(params.projectRoot, surveyState.includedPapersPath) ?? ""
    ),
  ]);
  const includedEntries = collectSurveyEntries(includedJson, [
    "papers",
    "included",
    "includedPapers",
    "items",
  ]);
  const includedKeys = buildIncludedIdentityKeySet(includedEntries);
  const screenedEntries = entries.filter((entry) => {
    const candidates = buildEntryIdentityKeys({
      canonicalId: entry.canonicalId,
      doi: entry.doi,
      arxivId: entry.arxivId,
      title: entry.title,
    });
    return candidates.some((value) => includedKeys.has(value));
  });
  const topicRelevanceAudit = await evaluateTopicRelevanceForEntries({
    projectId,
    projectRoot: params.projectRoot,
    entries,
    topic: surveyTopic,
  });
  const relevantKeySet = new Set(
    topicRelevanceAudit.entries
      .filter((entry) => entry.status === "relevant" || entry.status === "boundary")
      .flatMap((entry) =>
        buildEntryIdentityKeys({
          canonicalId: entry.canonicalId,
          title: entry.title,
        })
      )
  );
  const topicRelevantEntries =
    surveyTopic != null
      ? entries.filter((entry) =>
          buildEntryIdentityKeys({
            canonicalId: entry.canonicalId,
            doi: entry.doi,
            arxivId: entry.arxivId,
            title: entry.title,
          }).some((value) => relevantKeySet.has(value))
        )
      : entries;
  const seedEntries =
    screenedEntries.length > 0
      ? screenedEntries
      : topicRelevantEntries.length > 0
        ? topicRelevantEntries
        : entries;
  const maxSeeds = Math.max(1, Math.min(12, Math.floor(params.maxSeeds ?? 6)));
  const seeds = selectCitationSeeds(seedEntries, maxSeeds);
  const packetPath = path.join(params.projectRoot, "researcher", "CITATION_EXPANSION_PACKET.json");
  const markdownPath = path.join(params.projectRoot, "researcher", "CITATION_EXPANSION_PACKET.md");
  const queries = seeds.flatMap((seed) => {
    const label = seed.title ?? seed.canonicalId ?? "unknown paper";
    return [
      {
        type: "backward_references" as const,
        seedCanonicalId: seed.canonicalId,
        seedTitle: seed.title,
        query: `Find core references and baseline ancestors for "${label}"`,
        rationale: "Backfill foundational baselines and direct predecessors.",
      },
      {
        type: "forward_citations" as const,
        seedCanonicalId: seed.canonicalId,
        seedTitle: seed.title,
        query: `Find recent follow-up papers that cite "${label}"`,
        rationale: "Refresh recent SOTA and successor work without broad uncontrolled search.",
      },
      {
        type: "keyword_refresh" as const,
        seedCanonicalId: seed.canonicalId,
        seedTitle: seed.title,
        query: `Expand benchmark settings, variants, and closely related methods around "${label}"`,
        rationale: "Increase comparison breadth around each high-value seed rather than citing only one canonical paper.",
      },
      {
        type: "keyword_refresh" as const,
        seedCanonicalId: seed.canonicalId,
        seedTitle: seed.title,
        query: `Find limitations, failure cases, contradictions, or rebuttal papers related to "${label}"`,
        rationale: "Increase critical coverage and avoid optimistic one-sided literature packets.",
      },
    ];
  });
  const packet: CitationExpansionPacket = {
    projectId,
    generatedAt,
    packetPath,
    markdownPath,
    bounded: true,
    maxSeeds,
    seeds: seeds.map((seed) => ({
      canonicalId: seed.canonicalId,
      title: seed.title,
      reason:
        seed.citationCount != null
          ? `High-value seed with citation_count=${seed.citationCount}.`
          : "Representative in-corpus seed for bounded expansion.",
    })),
    queries: [
      ...queries,
      {
        type: "keyword_refresh",
        seedCanonicalId: null,
        seedTitle: null,
        query: `Refresh missing recent papers for ${projectId ?? "this project"} using the strongest baseline and seed titles as keyword anchors`,
        rationale: "One bounded keyword refresh round after seed-based expansion.",
      },
    ],
    recommendations: [
      "Keep citation expansion bounded to these seeds before widening to free-form queries.",
      "If coverage still looks thin, run another bounded citation-expansion round with refreshed seeds instead of stopping after a single packet.",
      "Merge newly accepted papers into PAPER_SOURCE_INDEX.json by canonical identity before re-running graph-build.",
      "Use this packet as a research aid, not as a stage blocker.",
    ],
  };
  await writeJsonEnsured(packetPath, packet);
  await writeTextEnsured(markdownPath, buildCitationExpansionMarkdown(packet));
  return packet;
}
