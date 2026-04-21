import * as path from "node:path";
import * as fs from "node:fs/promises";
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
import {
  getSurveyReviewStateSummary,
  normalizeSurveyReviewState,
  serializeSurveyReviewState,
  type SurveyReviewState,
} from "../workflow-guard-state/survey-review";
import {
  summarizeSurveyQueryRegistry,
  summarizeSurveyScreening,
} from "../survey-review-artifacts";
import { materializeSurveyReviewDiagnostics } from "../survey-review-diagnostics.js";
import { materializeWorkflowPanelDiscussionState } from "../workflow-panel-discussion";

function hasNonWhitespaceContent(text: string | null | undefined): boolean {
  return Boolean(text && text.trim().length > 0);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

function collectMarkdownSignalLines(rawText: string | null | undefined, limit = 8): string[] {
  if (!rawText) {
    return [];
  }
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("#") &&
        !/^[-*_]{3,}$/.test(line)
    )
    .map((line) => line.replace(/^[-*]\s+/, ""))
    .filter((line) => line.length > 0);
  return uniqueStrings(lines).slice(0, limit);
}

function extractSectionListItems(text: string, headingKeywords: string[]): string[] {
  const lines = (text ?? "").split(/\r?\n/);
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

function normalizeHeadingLabel(rawHeading: string): string | null {
  const normalized = rawHeading
    .replace(/^\d+(?:\.\d+)*\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return null;
  }
  if (
    /^(introduction|scope|topic|review protocol|coverage summary|literature review|open problems?|conclusion)$/i.test(
      normalized
    )
  ) {
    return null;
  }
  return normalized;
}

function extractFamilyHeadingsFromLiteratureReview(rawText: string | null | undefined): string[] {
  if (!rawText) {
    return [];
  }
  const headings = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^#{2,6}\s+/.test(line))
    .map((line) => line.replace(/^#{2,6}\s+/, ""))
    .map((line) => normalizeHeadingLabel(line))
    .filter((line): line is string => Boolean(line))
    .filter(
      (line) =>
        /(approach|method|learning|model|prompt|prototype|contrastive|debias|context|fine-grained|representation|forgetting|taxonomy|family)/i.test(
          line
        )
    );
  return uniqueStrings(headings).slice(0, 6);
}

function extractFamiliesFromSotaMatrix(rawText: string | null | undefined): string[] {
  if (!rawText) {
    return [];
  }
  const tableLines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));
  if (tableLines.length < 3) {
    return [];
  }
  const rows = tableLines.map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim())
  );
  const header = rows[0] ?? [];
  const familyIndex = header.findIndex((cell) => /\bfamily\b/i.test(cell));
  if (familyIndex < 0) {
    return [];
  }
  const familyRows = rows
    .slice(2)
    .map((row) => row[familyIndex] ?? "")
    .map((cell) => cell.replace(/^\*\*|\*\*$/g, "").trim())
    .filter(Boolean)
    .map((cell) => normalizeHeadingLabel(cell))
    .filter((cell): cell is string => Boolean(cell));
  return uniqueStrings(familyRows).slice(0, 8);
}

function buildSurveyBriefMarkdown(params: {
  topic: string | null;
  candidatePaperCount: number;
  includedPaperCount: number;
  excludedPaperCount: number;
  queryRoundCount: number;
  families: string[];
  coverageLines: string[];
  benchmarkLines: string[];
  gapLines: string[];
}): string {
  const nextSweepLines: string[] = [];
  if (params.queryRoundCount < 4) {
    nextSweepLines.push(
      "Expand retrieval with at least one bounded citation-expansion round seeded from the strongest included papers."
    );
  }
  if (params.families.length < 2) {
    nextSweepLines.push(
      "Stabilize the taxonomy into at least two method families before handing off to WRITE."
    );
  }
  if (params.gapLines.length === 0) {
    nextSweepLines.push(
      "Record explicit open problems and limitations so the survey brief closes the loop from evidence to future work."
    );
  }
  const scopeLines = uniqueStrings([
    `Candidate papers: ${params.candidatePaperCount}`,
    `Included papers: ${params.includedPaperCount}`,
    `Excluded or background papers: ${params.excludedPaperCount}`,
    `Retrieval rounds completed: ${params.queryRoundCount}`,
    ...params.coverageLines,
  ]).slice(0, 8);
  const benchmarkLines =
    params.benchmarkLines.length > 0
      ? params.benchmarkLines
      : [
          "Benchmark / dataset / metric alignment must stay explicit and avoid collapsing incomparable settings.",
        ];
  const familyLines =
    params.families.length > 0
      ? params.families
      : [
          "Derive method families from the SoTA matrix and literature review before writing the taxonomy section.",
        ];
  const gapLines =
    params.gapLines.length > 0
      ? params.gapLines
      : ["Carry unresolved limitations from GAP_SYNTHESIS.md into the brief before write handoff."];
  return [
    "# Survey Brief",
    "",
    `Topic: ${params.topic ?? "unset"}`,
    "",
    "## Scope & Coverage",
    ...scopeLines.map((line) => `- ${line}`),
    "",
    "## Themes",
    ...familyLines.map((line) => `- ${line}`),
    "",
    "## Benchmark Landscape",
    ...benchmarkLines.map((line) => `- ${line}`),
    "",
    "## Open Problems",
    ...gapLines.map((line) => `- ${line}`),
    "",
    "## Recommended Next Sweep",
    ...uniqueStrings(nextSweepLines).map((line) => `- ${line}`),
    "",
  ].join("\n");
}

function upsertMarkdownSection(params: {
  source: string;
  heading: string;
  bodyLines: string[];
}): string {
  const sectionBlock = [
    `## ${params.heading}`,
    ...params.bodyLines.map((line) => `- ${line}`),
  ].join("\n");
  const pattern = new RegExp(
    `(^|\\n)##\\s+${params.heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n[\\s\\S]*?(?=\\n##\\s+|$)`,
    "i"
  );
  if (pattern.test(params.source)) {
    return params.source.replace(pattern, `${RegExp.$1}${sectionBlock}\n`);
  }
  return `${params.source.trim()}\n\n${sectionBlock}\n`;
}

function refineSurveyBriefMarkdown(params: {
  source: string;
  families: string[];
  benchmarkLines: string[];
  gapLines: string[];
  queryRoundCount: number;
}): string {
  let next = params.source.trim();
  const existingThemes = extractSectionListItems(next, [
    "theme",
    "taxonomy",
    "family",
    "cluster",
  ]);
  if (existingThemes.length < 2 && params.families.length > 0) {
    next = upsertMarkdownSection({
      source: next,
      heading: "Themes",
      bodyLines: params.families,
    });
  }
  const existingOpenProblems = extractSectionListItems(next, [
    "open problem",
    "limitation",
    "challenge",
    "future",
  ]);
  if (existingOpenProblems.length < 2 && params.gapLines.length > 0) {
    next = upsertMarkdownSection({
      source: next,
      heading: "Open Problems",
      bodyLines: params.gapLines,
    });
  }
  if (params.benchmarkLines.length > 0 && !/##\s+Benchmark Landscape/i.test(next)) {
    next = upsertMarkdownSection({
      source: next,
      heading: "Benchmark Landscape",
      bodyLines: params.benchmarkLines,
    });
  }
  if (!/##\s+Recommended Next Sweep/i.test(next)) {
    const nextSweepLines = [
      params.queryRoundCount < 4
        ? "Expand retrieval with at least one bounded citation-expansion round seeded from the strongest included papers."
        : "Keep any further retrieval bounded to concrete blind spots rather than another broad sweep.",
    ];
    next = upsertMarkdownSection({
      source: next,
      heading: "Recommended Next Sweep",
      bodyLines: nextSweepLines,
    });
  }
  return `${next.trim()}\n`;
}

function buildSurveyBriefRefinementDiscussionPolicy(params: {
  topic: string | null;
  diagnosticsPath: string;
  surveyBriefPath: string | null;
  literatureReviewPath: string | null;
  sotaMatrixPath: string | null;
  gapSynthesisPath: string | null;
  blockingIssues: string[];
}): Record<string, unknown> {
  return {
    discussionId: "survey-brief-refinement",
    topic: `Refine the survey brief for ${params.topic ?? "the current survey topic"}`,
    stage: "survey_review",
    participants: ["researcher", "analyzer", "planner", "reviewer"],
    maxRounds: 2,
    quorum: 2,
    resolvedDecisions: ["resolved", "pass", "approved"],
    blockedDecisions: ["blocked", "rollback", "rejected"],
    packetArtifacts: uniqueStrings([
      params.diagnosticsPath,
      "researcher/TOPIC_RELEVANCE_AUDIT.json",
      "researcher/TOPIC_RELEVANCE_AUDIT.md",
      params.surveyBriefPath,
      params.literatureReviewPath,
      params.sotaMatrixPath,
      params.gapSynthesisPath,
    ]),
    promptInstructions:
      "Review the auto-generated survey brief as a bounded synthesis artifact. Focus on whether the taxonomy is stable, whether the benchmark landscape is explicit, whether unresolved gaps/limitations are carried into the brief without overclaiming consensus, and whether the current include/background boundary still matches the body-aware topic relevance audit.",
    summary: uniqueStrings([
      `Topic: ${params.topic ?? "unset"}`,
      ...params.blockingIssues.slice(0, 5),
    ]),
    context: {
      artifact: params.surveyBriefPath,
      diagnostics: params.diagnosticsPath,
      blockingIssues: params.blockingIssues,
    },
  };
}

export async function materializeSurveyReviewStateImpl(params: {
  projectRoot: string;
  surveyReviewMaterialization?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<{
  state: SurveyReviewState;
  generatedFiles: string[];
}> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const current = normalizeSurveyReviewState(manifest.survey_review);
  const patch = asRecord(params.surveyReviewMaterialization) ?? {};
  const merged = normalizeSurveyReviewState({
    ...serializeSurveyReviewState(current),
    ...patch,
  });

  const [
    queryRegistry,
    candidateJson,
    screeningDecisionsJson,
    includedJson,
    excludedJson,
    literatureText,
    literatureReviewText,
    reviewProtocolText,
    sotaMatrixText,
    gapSynthesisText,
    coverageSummaryText,
    surveyBriefTextRaw,
  ] = await Promise.all([
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, merged.queryRegistryPath) ?? ""
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, merged.candidatePapersPath) ?? ""
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, merged.screeningDecisionsPath) ?? ""
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, merged.includedPapersPath) ?? ""
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, merged.excludedPapersPath) ?? ""
    ),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, merged.literaturePath)
    ),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, merged.literatureReviewPath)
    ),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, merged.reviewProtocolPath)
    ),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, merged.sotaMatrixPath)
    ),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, merged.gapSynthesisPath)
    ),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, merged.coverageSummaryPath)
    ),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, merged.surveyBriefPath)
    ),
  ]);
  const literatureExists = hasNonWhitespaceContent(literatureText);
  const literatureReviewExists = hasNonWhitespaceContent(literatureReviewText);
  const protocolExists = hasNonWhitespaceContent(reviewProtocolText);
  const sotaExists = hasNonWhitespaceContent(sotaMatrixText);
  const gapExists = hasNonWhitespaceContent(gapSynthesisText);
  const coverageExists = hasNonWhitespaceContent(coverageSummaryText);

  const querySummary = summarizeSurveyQueryRegistry(queryRegistry);
  const screeningSummary = summarizeSurveyScreening({
    candidatePapers: candidateJson,
    screeningDecisions: screeningDecisionsJson,
    includedPapers: includedJson,
    excludedPapers: excludedJson,
  });
  const queryRoundCount = querySummary.queryRoundCount;
  const pendingPlannedRounds = querySummary.pendingRoundCount;
  const includedPaperCount = screeningSummary.includedCount;
  const backgroundPaperCount = screeningSummary.backgroundCount;
  const excludedPaperCount =
    screeningSummary.excludedCount + screeningSummary.backgroundCount;
  const pendingScreeningCount = screeningSummary.pendingCount;
  const candidatePaperCount =
    typeof (queryRegistry as Record<string, unknown> | null)?.candidate_paper_count ===
      "number"
      ? Math.max(
          0,
          Number((queryRegistry as Record<string, unknown>).candidate_paper_count)
        )
      : typeof (queryRegistry as Record<string, unknown> | null)?.candidatePaperCount ===
            "number"
        ? Math.max(
            0,
            Number((queryRegistry as Record<string, unknown>).candidatePaperCount)
          )
        : typeof (queryRegistry as Record<string, unknown> | null)?.totalCount === "number"
          ? Math.max(
              0,
              Number((queryRegistry as Record<string, unknown>).totalCount)
            )
          : typeof (queryRegistry as Record<string, unknown> | null)?.total_count === "number"
            ? Math.max(
                0,
                Number((queryRegistry as Record<string, unknown>).total_count)
              )
            : Math.max(
                includedPaperCount + excludedPaperCount + pendingScreeningCount,
                merged.candidatePaperCount ?? 0
              );
  const synthesizedFamilies = uniqueStrings([
    ...extractSectionListItems(literatureReviewText ?? "", [
      "taxonomy",
      "theme",
      "family",
      "cluster",
    ]),
    ...extractFamiliesFromSotaMatrix(sotaMatrixText),
    ...extractFamilyHeadingsFromLiteratureReview(literatureReviewText),
  ]).slice(0, 6);
  const benchmarkLines = uniqueStrings([
    ...collectMarkdownSignalLines(reviewProtocolText, 4).filter((line) =>
      /\bdataset\b|\bbenchmark\b|\bmetric\b|\baccuracy\b|\bf1\b|\bh-score\b|\bauc\b|\bmap\b/i.test(
        line
      )
    ),
    ...collectMarkdownSignalLines(sotaMatrixText, 6).filter((line) =>
      /\bdataset\b|\bbenchmark\b|\bmetric\b|\baccuracy\b|\bf1\b|\bh-score\b|\bauc\b|\bmap\b/i.test(
        line
      )
    ),
  ]).slice(0, 6);
  const gapLines = collectMarkdownSignalLines(gapSynthesisText, 6);
  const coverageLines = collectMarkdownSignalLines(coverageSummaryText, 5);
  let surveyBriefText = surveyBriefTextRaw;
  const surveyBriefExists = hasNonWhitespaceContent(surveyBriefText);
  const surveyBriefResolvedPath = resolveProjectArtifactPath(
    projectRoot,
    merged.surveyBriefPath
  );
  if (
    !surveyBriefExists &&
    literatureReviewExists &&
    gapExists &&
    coverageExists &&
    (sotaExists || includedPaperCount > 0 || queryRoundCount > 0)
  ) {
    surveyBriefText = buildSurveyBriefMarkdown({
      topic: merged.topic,
      candidatePaperCount,
      includedPaperCount,
      excludedPaperCount,
      queryRoundCount,
      families: synthesizedFamilies,
      coverageLines,
      benchmarkLines,
      gapLines,
    });
    if (!surveyBriefResolvedPath) {
      throw new Error("Unable to resolve survey brief path.");
    }
    await writeTextEnsured(surveyBriefResolvedPath, surveyBriefText);
  } else if (surveyBriefExists && surveyBriefText) {
    const refinedBrief = refineSurveyBriefMarkdown({
      source: surveyBriefText,
      families: synthesizedFamilies,
      benchmarkLines,
      gapLines,
      queryRoundCount,
    });
    if (refinedBrief.trim() !== surveyBriefText.trim()) {
      if (!surveyBriefResolvedPath) {
        throw new Error("Unable to resolve survey brief path.");
      }
      surveyBriefText = refinedBrief;
      await writeTextEnsured(surveyBriefResolvedPath, surveyBriefText);
    }
  }
  const surveyBriefReady = hasNonWhitespaceContent(surveyBriefText);
  const diagnostics = await materializeSurveyReviewDiagnostics({
    projectRoot,
    state: {
      ...merged,
      candidatePaperCount,
      includedPaperCount,
      excludedPaperCount,
      backgroundPaperCount,
      queryRoundCount,
      pendingScreeningCount,
      pendingPlannedRoundCount: pendingPlannedRounds,
    },
  });

  let status = merged.status;
  let currentPhase = merged.currentPhase;
  let pendingReason = merged.pendingReason;

  if (surveyBriefReady && diagnostics.ready) {
    status = "completed";
    currentPhase = "complete";
    pendingReason = null;
  } else if (
    queryRoundCount > 0 &&
    pendingPlannedRounds > 0
  ) {
    status = "searching";
    currentPhase = "retrieval";
    pendingReason =
      `Continue retrieval before synthesis; ${pendingPlannedRounds} planned survey search rounds are still pending.`;
  } else if (pendingScreeningCount > 0) {
    status = "screening";
    currentPhase = "screening";
    pendingReason =
      `Resolve ${pendingScreeningCount} pending screening candidate(s) before treating the survey packet as complete.`;
  } else if (!surveyBriefReady && (literatureReviewExists || sotaExists || gapExists)) {
    status = "synthesizing";
    currentPhase = "brief_synthesis";
    pendingReason =
      diagnostics.blockingIssues[0] ??
      "Generate the survey brief from the current literature review, SoTA matrix, and gap synthesis packet.";
  } else if (
    surveyBriefReady &&
    diagnostics.taxonomyStability.status !== "stable"
  ) {
    status = "synthesizing";
    currentPhase = "taxonomy_refinement";
    pendingReason =
      diagnostics.taxonomyStability.blockers[0] ??
      diagnostics.taxonomyStability.summary ??
      "Refine the taxonomy until the survey brief expresses stable method families.";
  } else if (
    surveyBriefReady &&
    diagnostics.gapClosure.status !== "closed"
  ) {
    status = "synthesizing";
    currentPhase = "gap_closure";
    pendingReason =
      diagnostics.gapClosure.blockers[0] ??
      diagnostics.gapClosure.summary ??
      "Carry the main unresolved gaps and limitations into the survey brief.";
  } else if (
    surveyBriefReady &&
    diagnostics.topicRelevance.status !== "ready"
  ) {
    status = "synthesizing";
    currentPhase = "brief_synthesis";
    pendingReason =
      diagnostics.topicRelevance.blockers[0] ??
      diagnostics.topicRelevance.summary ??
      "Revisit the include/background boundary using the topic relevance audit before write handoff.";
  } else if (
    queryRoundCount > 0 &&
    diagnostics.coverage.status !== "ready"
  ) {
    status = "searching";
    currentPhase = "retrieval";
    pendingReason =
      diagnostics.coverage.blockers[0] ??
      diagnostics.coverage.summary ??
      "Continue retrieval until survey coverage is ready.";
  } else if (literatureReviewExists || sotaExists || gapExists) {
    status = "synthesizing";
    currentPhase = "synthesis";
    pendingReason =
      diagnostics.blockingIssues[0] ??
      (surveyBriefExists ? "Resolve the remaining survey-quality blockers." : "Finalize the survey brief.");
  } else if (protocolExists || includedPaperCount > 0 || excludedPaperCount > 0) {
    status = "screening";
    currentPhase = "screening";
    pendingReason = "Finish screening and synthesize the review packet.";
  } else if (queryRoundCount > 0 || literatureExists) {
    status = "searching";
    currentPhase = "retrieval";
    pendingReason =
      candidatePaperCount >= 40
        ? "Candidate pool is broad enough to begin stricter screening; keep citation expansion bounded and start separating include vs exclude decisions."
        : "Continue broad retrieval and citation expansion until the candidate pool reaches roughly 40-50 papers, or a smaller niche topic is explicitly saturated.";
  } else {
    status = "missing";
    currentPhase = "bootstrap";
    pendingReason = "Start the survey retrieval rounds.";
  }

  const next = normalizeSurveyReviewState({
    ...serializeSurveyReviewState(merged),
    status,
    current_phase: currentPhase,
    query_round_count: queryRoundCount,
    candidate_paper_count: candidatePaperCount,
    included_paper_count: includedPaperCount,
    excluded_paper_count: excludedPaperCount,
    background_paper_count: backgroundPaperCount,
    pending_screening_count: pendingScreeningCount,
    pending_planned_round_count: pendingPlannedRounds,
    graph_grounded_brief_ready:
      surveyBriefReady ||
      (coverageExists && literatureReviewExists && gapExists),
    diagnostics_path: diagnostics.diagnosticsPath,
    gate_ready: diagnostics.ready,
    gate_blocking_issues: diagnostics.blockingIssues,
    gate_warnings: diagnostics.warnings,
    coverage_status: diagnostics.coverage.status,
    coverage_summary: diagnostics.coverage.summary,
    taxonomy_stability_status: diagnostics.taxonomyStability.status,
    taxonomy_stability_summary: diagnostics.taxonomyStability.summary,
    representative_methods_status: diagnostics.representativeMethods.status,
    representative_methods_summary: diagnostics.representativeMethods.summary,
    benchmark_alignment_status: diagnostics.benchmarkAlignment.status,
    benchmark_alignment_summary: diagnostics.benchmarkAlignment.summary,
    topic_relevance_status: diagnostics.topicRelevance.status,
    topic_relevance_summary: diagnostics.topicRelevance.summary,
    gap_closure_status: diagnostics.gapClosure.status,
    gap_closure_summary: diagnostics.gapClosure.summary,
    pending_reason: pendingReason,
    last_updated_at: new Date().toISOString(),
  });

  manifest.survey_review = serializeSurveyReviewState(next);
  manifest.workflow_line = "survey";
  manifest.paper_type = "survey";
  manifest.writing_contract = {
    ...(asRecord(manifest.writing_contract) ?? {}),
    paper_mode: "survey",
  };
  manifest.current_stage = "survey_review";
  manifest.current_micro_stage = next.currentPhase ?? "survey_requested";
  manifest.owner_agent = "researcher";
  const outlinePath = path.join(projectRoot, "researcher", "SURVEY_OUTLINE.md");
  if (!hasNonWhitespaceContent(await readTextIfExists(outlinePath))) {
    await writeJsonEnsured(
      path.join(projectRoot, "researcher", "SURVEY_OUTLINE.packet.json"),
      {
        schema_version: 1,
        source: "survey_review_state",
        topic: next.topic,
        survey_brief_path: next.surveyBriefPath,
        coverage_summary_path: next.coverageSummaryPath,
        generated_at: new Date().toISOString(),
      }
    );
    await fs.mkdir(path.dirname(outlinePath), { recursive: true });
    await fs.writeFile(
      outlinePath,
      [
        "# Survey Outline",
        "",
        `Topic: ${next.topic ?? "unset"}`,
        "",
        "## Taxonomy Plan",
        "- Derive taxonomy from SURVEY_BRIEF.md, SOTA_MATRIX.md, and COVERAGE_SUMMARY.md.",
        "",
        "## Coverage Plan",
        "- Keep section coverage aligned with INCLUDED_PAPERS.json and GAP_SYNTHESIS.md.",
        "",
      ].join("\n"),
      "utf8"
    );
  }
  const generatedFiles = uniqueStrings([
    diagnostics.diagnosticsPath,
    "researcher/SURVEY_OUTLINE.md",
    !surveyBriefExists && surveyBriefReady ? merged.surveyBriefPath : null,
  ]);
  if (
    surveyBriefReady &&
    !diagnostics.ready &&
    diagnostics.blockingIssues.length > 0
  ) {
    const panel = await materializeWorkflowPanelDiscussionState({
      projectRoot,
      projectId: pickString(manifest, ["project_id", "projectId"]),
      policyLike: buildSurveyBriefRefinementDiscussionPolicy({
        topic: next.topic,
        diagnosticsPath: diagnostics.diagnosticsPath,
        surveyBriefPath: next.surveyBriefPath,
        literatureReviewPath: next.literatureReviewPath,
        sotaMatrixPath: next.sotaMatrixPath,
        gapSynthesisPath: next.gapSynthesisPath,
        blockingIssues: diagnostics.blockingIssues,
      }),
    });
    generatedFiles.push(
      path.relative(projectRoot, panel.packetPath),
      path.relative(projectRoot, panel.packetJsonPath)
    );
  }
  await writeJsonEnsured(manifestPath, manifest);

  return {
    state: getSurveyReviewStateSummary(manifest).state,
    generatedFiles,
  };
}
