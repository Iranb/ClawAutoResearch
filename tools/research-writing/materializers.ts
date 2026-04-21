import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readJsonIfExists, readTextIfExists, writeTextEnsured } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import { writeProjectJson } from "../research-contracts/core/project-io";
import type {
  PaperStoryState,
  ReviewPressurePacketState,
} from "../workflow-guard.js";
import { normalizeSurveyReviewState } from "../workflow-guard-state/survey-review";
import { normalizeWritingContractState } from "../workflow-guard-state/writing-contract";
import { collectSurveyBackgroundReferenceLines } from "../survey-review-artifacts";
import { setWritingSessionState } from "../workflow-guard-setters/writing-state-setters";
import { syncAuthoringArtifactRecovery } from "./authoring-artifact-recovery";
import {
  materializeFallbackActivation,
} from "./fallback-activation";
import { materializeFigureAnchorPlan } from "./figure-anchor";
import { materializePrewriteRejectionSimulation } from "./prewrite-rejection";
import { materializeWritingReferenceBundle } from "./reference-bundles";
import { materializeRebuttalResponse } from "./rebuttal-materializer";
import { materializeRevisionCycle } from "./revision-cycle";
import { materializeParagraphLogicAudit } from "./paragraph-logic-audit";
import { materializeSurveyVisualCompiler } from "./survey-visual-compiler";
import { normalizeSurveyStorylinePacket } from "./survey-storyline";
import { materializeContributionToStoryBridge } from "./story-bridge";
import { materializeVenueRoutingPlan } from "./venue-routing";
import { materializeFigureTableRegistry } from "../research-authoring/figure-table-registry";
import {
  DEFAULT_SURVEY_COMPARABILITY_REPORT_PATH,
  DEFAULT_SURVEY_SOURCE_TO_CLAIM_INDEX_PATH,
  DEFAULT_SURVEY_TOP_TIER_BRIDGE_PATH,
  DEFAULT_SURVEY_TRACEABILITY_AUDIT_PATH,
  materializeSurveyAnalysis,
} from "../research-authoring/survey-analysis";
import { materializeSurveyMethodologyConsistency } from "../research-authoring/survey-methodology-consistency";

const FALLBACK_RELEVANT_STAGES = new Set(["write", "review", "submit"]);

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
  }
  return results;
}

function collectMarkdownSignalLines(
  rawText: string | null | undefined,
  limit = 6
): string[] {
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

function normalizeSectionId(value: string | null | undefined): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return normalized || null;
}

function extractMarkdownSectionItems(
  rawText: string | null | undefined
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (!rawText) {
    return result;
  }
  const lines = rawText.split(/\r?\n/);
  let currentSection: string | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    const headingMatch = trimmed.match(/^##\s+(.+)$/);
    if (headingMatch) {
      currentSection = normalizeSectionId(headingMatch[1]);
      if (currentSection && !result[currentSection]) {
        result[currentSection] = [];
      }
      continue;
    }
    if (!currentSection) {
      continue;
    }
    if (/^[-*+]\s+/.test(trimmed)) {
      const item = trimmed.replace(/^[-*+]\s+/, "").trim();
      if (item) {
        result[currentSection].push(item);
      }
    }
  }
  return Object.fromEntries(
    Object.entries(result).map(([key, values]) => [key, uniqueStrings(values)])
  );
}

function sentenceFromSignal(
  value: string | null | undefined,
  fallback: string
): string {
  const normalized = String(value ?? "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.endsWith(".") ? normalized : `${normalized}.`;
}

function sectionDisplayTitle(sectionId: string): string {
  switch (sectionId) {
    case "scope_and_protocol":
      return "Scope and Protocol";
    case "evidence_synthesis":
      return "Evidence Synthesis";
    case "benchmark_landscape":
      return "Benchmark Landscape";
    case "open_problems":
      return "Open Problems";
    default:
      return sectionId
        .split("_")
        .filter(Boolean)
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(" ");
  }
}

function sectionLabel(sectionId: string): string {
  return `sec:${sectionId}`;
}

function renderSurveySectionDraft(params: {
  sectionId: string;
  title: string;
  bullets: string[];
  briefLines: string[];
  comparativeLines: string[];
  gapLines: string[];
  coverageLines: string[];
  abstractWorkbenchLines: string[];
  introWorkbenchLines: string[];
}): string {
  const bullets = params.bullets;
  const lead =
    bullets[0] ??
    params.briefLines[0] ??
    params.comparativeLines[0] ??
    params.gapLines[0] ??
    params.coverageLines[0] ??
    `Draft the ${params.title.toLowerCase()} section from the current survey packet.`;
  const support =
    bullets[1] ??
    params.briefLines[1] ??
    params.comparativeLines[1] ??
    params.gapLines[1] ??
    params.coverageLines[1] ??
    `Keep the section aligned with the current survey brief and included papers.`;
  if (params.sectionId === "abstract") {
    const abstractLines =
      params.abstractWorkbenchLines.length > 0
        ? params.abstractWorkbenchLines.slice(0, 5)
        : [lead, support];
    return [
      "\\begin{abstract}",
      abstractLines.map((line) => sentenceFromSignal(line, lead)).join(" "),
      "\\end{abstract}",
      "",
    ].join("\n");
  }
  const heading = `\\section{${params.title}}\n\\label{${sectionLabel(params.sectionId)}}`;
  const paragraphOne = sentenceFromSignal(lead, `Introduce ${params.title.toLowerCase()}.`);
  const paragraphTwo = sentenceFromSignal(
    support,
    `Keep ${params.title.toLowerCase()} grounded in the survey packet evidence.`
  );
  const checklistSource =
    bullets.slice(2, 5).length > 0
      ? bullets.slice(2, 5)
      : params.sectionId === "introduction"
        ? params.introWorkbenchLines.slice(0, 3)
        : params.sectionId === "benchmark_landscape"
          ? params.comparativeLines.slice(0, 3)
          : params.sectionId === "open_problems"
            ? params.gapLines.slice(0, 3)
            : params.coverageLines.slice(0, 3);
  const checklist =
    checklistSource.length > 0
      ? [
          "\\begin{itemize}",
          ...checklistSource.map((line) => `\\item ${sentenceFromSignal(line, line)}`),
          "\\end{itemize}",
        ].join("\n")
      : "";
  return [heading, "", paragraphOne, "", paragraphTwo, checklist ? `\n${checklist}` : "", ""]
    .filter(Boolean)
    .join("\n");
}

function renderSurveySectionPacket(params: {
  sectionId: string;
  title: string;
  draftPath: string;
  bullets: string[];
  briefLines: string[];
  evidencePointers: string[];
}): string {
  const goal =
    params.bullets[0] ??
    params.briefLines[0] ??
    `Draft the ${params.title.toLowerCase()} section so it stays aligned with the survey brief.`;
  const checklist = uniqueStrings([
    ...params.bullets.slice(1),
    ...params.briefLines.slice(1, 4),
  ]).slice(0, 6);
  const evidencePointers =
    params.evidencePointers.length > 0
      ? params.evidencePointers
      : ["researcher/SURVEY_BRIEF.md"];
  return [
    `# Section Packet: ${params.title}`,
    "",
    `- Section: ${params.sectionId}`,
    `- Goal: ${goal}`,
    `- Draft path: ${params.draftPath}`,
    "",
    "## Evidence Pointers",
    ...evidencePointers.map((line) => `- ${line}`),
    "",
    "## Drafting Checklist",
    ...(checklist.length > 0
      ? checklist.map((line) => `- ${line}`)
      : ["- Keep claims grounded in the active survey packet."]),
    "",
  ].join("\n");
}

async function materializeSurveySectionDraftScaffolds(params: {
  projectRoot: string;
  requiredSections: string[];
  currentSectionPackets: Record<string, unknown>;
}) {
  const [
    sectionBriefsText,
    comparativeAnalysisText,
    selfReviewText,
    surveyBriefText,
    gapText,
    coverageText,
    abstractWorkbenchText,
    introWorkbenchText,
  ] = await Promise.all([
    readTextIfExists(path.join(params.projectRoot, "academic_writer", "SURVEY_SECTION_BRIEFS.md")),
    readTextIfExists(
      path.join(params.projectRoot, "academic_writer", "SURVEY_COMPARATIVE_ANALYSIS.md")
    ),
    readTextIfExists(path.join(params.projectRoot, "academic_writer", "SURVEY_SELF_REVIEW.md")),
    readTextIfExists(path.join(params.projectRoot, "researcher", "SURVEY_BRIEF.md")),
    readTextIfExists(path.join(params.projectRoot, "researcher", "GAP_SYNTHESIS.md")),
    readTextIfExists(path.join(params.projectRoot, "researcher", "COVERAGE_SUMMARY.md")),
    readTextIfExists(
      path.join(params.projectRoot, "academic_writer", "ABSTRACT_5_SENTENCE_WORKBENCH.md")
    ),
    readTextIfExists(
      path.join(params.projectRoot, "academic_writer", "INTRO_5_PARAGRAPH_WORKBENCH.md")
    ),
  ]);

  const briefLines = collectMarkdownSignalLines(surveyBriefText, 8);
  const comparativeLines = collectMarkdownSignalLines(comparativeAnalysisText, 10);
  const selfReviewLines = collectMarkdownSignalLines(selfReviewText, 10);
  const gapLines = collectMarkdownSignalLines(gapText, 8);
  const coverageLines = collectMarkdownSignalLines(coverageText, 8);
  const abstractWorkbenchLines = collectMarkdownSignalLines(abstractWorkbenchText, 8);
  const introWorkbenchLines = collectMarkdownSignalLines(introWorkbenchText, 8);
  const sectionItems = extractMarkdownSectionItems(sectionBriefsText);

  const sectionPacketsPatch: Record<string, Record<string, unknown>> = {};
  const generatedFiles: string[] = [];

  for (const rawSectionId of params.requiredSections) {
    const sectionId = normalizeSectionId(rawSectionId);
    if (!sectionId) {
      continue;
    }
    const title = sectionDisplayTitle(sectionId);
    const packetPath = `academic_writer/section_packets/${sectionId}.md`;
    const draftPath = `academic_writer/paper/sections/${sectionId}.tex`;
    const packetResolvedPath = path.join(params.projectRoot, packetPath);
    const draftResolvedPath = path.join(params.projectRoot, draftPath);
    const existingPacket = params.currentSectionPackets[sectionId];
    const bullets = sectionItems[sectionId] ?? [];
    const evidencePointers = uniqueStrings([
      "researcher/SURVEY_BRIEF.md",
      "academic_writer/SURVEY_STORYLINE_PACKET.json",
      sectionId === "scope_and_protocol" ? "researcher/REVIEW_PROTOCOL.md" : null,
      sectionId === "scope_and_protocol" ? "researcher/CANDIDATE_SCREENING_DECISIONS.json" : null,
      sectionId === "scope_and_protocol" ? "researcher/EXCLUDED_PAPERS.json" : null,
      sectionId === "scope_and_protocol" ? "researcher/TOPIC_RELEVANCE_AUDIT.json" : null,
      sectionId === "taxonomy" ? "researcher/SOTA_MATRIX.md" : null,
      sectionId === "taxonomy" ? "researcher/INCLUDED_PAPERS.json" : null,
      sectionId === "evidence_synthesis" ? "academic_writer/SURVEY_COMPARATIVE_ANALYSIS.md" : null,
      sectionId === "evidence_synthesis" ? "researcher/TOPIC_RELEVANCE_AUDIT.json" : null,
      sectionId === "benchmark_landscape" ? "academic_writer/SURVEY_VISUAL_INSERTION_MAP.json" : null,
      sectionId === "open_problems" ? "researcher/GAP_SYNTHESIS.md" : null,
      sectionId === "conclusion" ? "academic_writer/SURVEY_SELF_REVIEW.md" : null,
    ]);

    const existingPacketText = await readTextIfExists(packetResolvedPath);
    if (!existingPacketText || !existingPacketText.trim()) {
      await writeTextEnsured(
        packetResolvedPath,
        `${renderSurveySectionPacket({
          sectionId,
          title,
          draftPath,
          bullets,
          briefLines,
          evidencePointers,
        })}\n`
      );
      generatedFiles.push(packetPath);
    }

    const existingDraftText = await readTextIfExists(draftResolvedPath);
    if (!existingDraftText || !existingDraftText.trim()) {
      await writeTextEnsured(
        draftResolvedPath,
        `${renderSurveySectionDraft({
          sectionId,
          title,
          bullets,
          briefLines,
          comparativeLines,
          gapLines,
          coverageLines,
          abstractWorkbenchLines,
          introWorkbenchLines,
        })}\n`
      );
      generatedFiles.push(draftPath);
    }

    sectionPacketsPatch[sectionId] = {
      ...(existingPacket && typeof existingPacket === "object" ? existingPacket : {}),
      section: sectionId,
      goal:
        bullets[0] ??
        briefLines[0] ??
        `Draft ${title.toLowerCase()} from the active survey packet.`,
      packet_path: packetPath,
      draft_path: draftPath,
      required_graph_evidence_pointers: evidencePointers,
      forbidden_unsupported_claims: [],
      missing_citation_placeholders: [],
      required_citation_count:
        sectionId === "abstract" || sectionId === "conclusion"
          ? 0
          : sectionId === "scope_and_protocol" || sectionId === "benchmark_landscape"
            ? 4
            : 3,
      dependent_sections:
        sectionId === "conclusion"
          ? ["taxonomy", "evidence_synthesis", "benchmark_landscape", "open_problems"]
          : sectionId === "benchmark_landscape"
            ? ["taxonomy", "evidence_synthesis"]
            : [],
      status: "drafting",
      stale: false,
      updated_at: new Date().toISOString(),
      review_verdict: null,
    };
  }

  return {
    sectionPacketsPatch,
    generatedFiles: uniqueStrings(generatedFiles),
  };
}

async function materializeSurveyWritingCompanionArtifacts(params: {
  projectRoot: string;
  paperStoryState: PaperStoryState;
}) {
  const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
  const surveyState = normalizeSurveyReviewState(manifest.survey_review);
  const surveyReview =
    manifest.survey_review && typeof manifest.survey_review === "object"
      ? (manifest.survey_review as Record<string, unknown>)
      : {};
  const topic =
    (typeof surveyReview.topic === "string" && surveyReview.topic.trim()) ||
    "the survey topic";
  const includedCount =
    typeof surveyReview.included_paper_count === "number"
      ? surveyReview.included_paper_count
      : typeof surveyReview.includedPaperCount === "number"
        ? surveyReview.includedPaperCount
        : null;
  const [
    surveyBrief,
    literatureReview,
    sotaMatrix,
    gapSynthesis,
    coverageSummary,
    reviewProtocol,
    excludedJson,
    screeningDecisionsJson,
    surveyStorylinePacketRaw,
  ] = await Promise.all([
    readTextIfExists(path.join(params.projectRoot, "researcher", "SURVEY_BRIEF.md")),
    readTextIfExists(path.join(params.projectRoot, "researcher", "LITERATURE_REVIEW.md")),
    readTextIfExists(path.join(params.projectRoot, "researcher", "SOTA_MATRIX.md")),
    readTextIfExists(path.join(params.projectRoot, "researcher", "GAP_SYNTHESIS.md")),
    readTextIfExists(path.join(params.projectRoot, "researcher", "COVERAGE_SUMMARY.md")),
    readTextIfExists(path.join(params.projectRoot, "researcher", "REVIEW_PROTOCOL.md")),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(
        params.projectRoot,
        surveyState.excludedPapersPath ?? "researcher/EXCLUDED_PAPERS.json"
      ) ?? ""
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(
        params.projectRoot,
        surveyState.screeningDecisionsPath ?? "researcher/CANDIDATE_SCREENING_DECISIONS.json"
      ) ?? ""
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(
        params.projectRoot,
        params.paperStoryState.surveyStorylinePacketPath
      ) ?? ""
    ),
  ]);

  const comparativeLines = uniqueStrings([
    ...collectMarkdownSignalLines(sotaMatrix, 8),
    ...collectMarkdownSignalLines(literatureReview, 8),
  ]).slice(0, 8);
  const coverageLines = collectMarkdownSignalLines(coverageSummary, 5);
  const gapLines = collectMarkdownSignalLines(gapSynthesis, 6);
  const briefLines = collectMarkdownSignalLines(surveyBrief, 6);
  const protocolLines = collectMarkdownSignalLines(reviewProtocol, 5);
  const backgroundLines = collectSurveyBackgroundReferenceLines({
    excludedPapers: excludedJson,
    screeningDecisions: screeningDecisionsJson,
    limit: 6,
  });
  const surveyStorylinePacket = normalizeSurveyStorylinePacket(surveyStorylinePacketRaw);
  const surveyStorylinePlans = surveyStorylinePacket?.sectionPlans ?? [];
  const surveyPlanBySection = new Map(
    surveyStorylinePlans.map((plan) => [plan.sectionId, plan] as const)
  );
  const surveyBodyOrder =
    surveyStorylinePacket?.bodySectionOrder ?? [
      "scope_and_protocol",
      "taxonomy",
      "evidence_synthesis",
      "benchmark_landscape",
      "open_problems",
    ];
  const surveyAnalysis = await materializeSurveyAnalysis({
    projectRoot: params.projectRoot,
  });
  const analysisSummaryLines = [
    `Traceable synthesis claims: ${surveyAnalysis.traceableClaimCount}/${surveyAnalysis.claimCount}.`,
    `Fair-compare rows available: ${surveyAnalysis.fairCompareRowCount}.`,
    `Benchmark contract status: ${surveyAnalysis.benchmarkProtocolStatus}.`,
    `Competitor contract status: ${surveyAnalysis.venueCompetitionStatus}.`,
    ...(surveyAnalysis.blockingIssues.length > 0
      ? surveyAnalysis.blockingIssues.slice(0, 3)
      : []),
    ...(surveyAnalysis.warnings.length > 0
      ? surveyAnalysis.warnings.slice(0, 2)
      : []),
  ];

  const comparativeAnalysisPath = path.join(
    params.projectRoot,
    "academic_writer",
    "SURVEY_COMPARATIVE_ANALYSIS.md"
  );
  const comparativeAnalysis = `# Survey Comparative Analysis

## Topic
- ${topic}
- Included papers: ${includedCount ?? "unset"}
- Selected storyline strategy: ${surveyStorylinePacket?.selectedStrategyLabel ?? "taxonomy-first"}
- Story thesis: ${surveyStorylinePacket?.thesis ?? "stabilize one survey thesis before drafting"}

## Required Comparison Axes
- method family and organizing assumption
- supervision / modality / backbone dependence
- benchmark and metric coverage
- strongest win vs strongest failure mode
- contradiction or non-comparable result warning

## Comparison Evidence To Reuse
${comparativeLines.length > 0 ? comparativeLines.map((line) => `- ${line}`).join("\n") : "- Expand SOTA matrix and literature review evidence before claiming strong comparative synthesis."}

## Boundary / Related Anchors
${backgroundLines.length > 0 ? backgroundLines.map((line) => `- ${line}`).join("\n") : "- Keep adjacent-task references visible when they explain scope boundaries or contrastive baselines."}

## Body-Aware Topic Relevance
- Use researcher/TOPIC_RELEVANCE_AUDIT.json when deciding whether a borderline paper belongs in the core synthesis, only in boundary-setting prose, or should stay excluded.
- Prefer full-text topic evidence over title-only guesswork when a title is generic or transfer-oriented.

## Coverage / Boundary Reminders
${coverageLines.length > 0 ? coverageLines.map((line) => `- ${line}`).join("\n") : "- Keep scope boundaries, blind spots, and excluded directions explicit."}

## Comparability / Traceability Status
${analysisSummaryLines.map((line) => `- ${line}`).join("\n")}

## Gap / Tradeoff Reminders
${gapLines.length > 0 ? gapLines.map((line) => `- ${line}`).join("\n") : "- Tie every open problem back to a concrete evidence gap rather than generic future work."}
`;

  const sectionBriefsPath = path.join(
    params.projectRoot,
    "academic_writer",
    "SURVEY_SECTION_BRIEFS.md"
  );
  const dynamicSectionBriefs = surveyBodyOrder
    .map((sectionId) => {
      const plan = surveyPlanBySection.get(sectionId);
      const defaultBullets =
        sectionId === "scope_and_protocol"
          ? [
              "Explain inclusion / exclusion logic and search boundary.",
              "Surface blind spots, recency limits, and incomparable settings.",
              `Reuse protocol evidence from ${protocolLines.length > 0 ? "REVIEW_PROTOCOL.md" : "the review protocol once refreshed"}.`,
              `Keep boundary references visible: ${backgroundLines.length > 0 ? backgroundLines.slice(0, 2).join("; ") : "related NCD / OWR / OSR / GZSL anchors when they explain exclusions"}.`,
              "If a paper's title is generic, rely on TOPIC_RELEVANCE_AUDIT.json before calling it core evidence.",
            ]
          : sectionId === "taxonomy"
            ? [
                "Define stable method families and the principle that separates them.",
                "Mention where family boundaries blur or overlap.",
                "Compare families, do not just list them.",
              ]
            : sectionId === "evidence_synthesis"
              ? [
                  "Use representative papers to compare strengths, weaknesses, and tradeoffs.",
                  "Include at least one contradiction / non-comparable warning paragraph.",
                  `Reuse: ${briefLines.length > 0 ? briefLines.slice(0, 3).map((line) => `"${line}"`).join(", ") : "SURVEY_BRIEF.md synthesis bullets"}.`,
                ]
              : sectionId === "benchmark_landscape"
                ? [
                    "State which benchmark comparisons are fair and which are shaky.",
                    "Compare datasets, metrics, and backbone/modality assumptions.",
                    "Do not collapse incompatible results into one ranking.",
                  ]
                : [
                    "Rank the main unresolved problems by evidence gap importance.",
                    "Tie each open problem to missing comparisons, weak coverage, or contradiction zones.",
                  ];
      return [
        `## ${sectionDisplayTitle(sectionId)}`,
        `- ${plan?.prompt ?? `Keep ${sectionDisplayTitle(sectionId).toLowerCase()} aligned with the selected survey thesis.`}`,
        `- ${plan?.objective ?? defaultBullets[0]}`,
        `- ${plan?.coreMessage ?? defaultBullets[1] ?? defaultBullets[0]}`,
        ...defaultBullets.slice(1).map((line) => `- ${line}`),
      ].join("\n");
    })
    .join("\n\n");
  const sectionBriefs = `# Survey Section Briefs

## Storyline Thesis
- ${surveyStorylinePacket?.thesis ?? `Explain why ${topic} needs a survey now.`}
- Selected macro-story: ${surveyStorylinePacket?.selectedStrategyLabel ?? "taxonomy-first"}.
- Intellectual center: ${surveyStorylinePacket?.intellectualCenterSection ?? "taxonomy"}.

## Introduction
- Explain why ${topic} needs a survey now.
- State what this survey contributes beyond a paper list.
- Preview the selected field structure and the strongest comparison pressure.

${dynamicSectionBriefs}

## Conclusion
- Summarize what the field now understands with confidence.
- Keep unresolved boundaries explicit.
- End on the same thesis used by the storyline packet, not a new claim.
`;

  const selfReviewPath = path.join(
    params.projectRoot,
    "academic_writer",
    "SURVEY_SELF_REVIEW.md"
  );
  const selfReview = `# Survey Self Review

Use this before calling the survey draft mature.

## Thesis Sharpness
- Can a reviewer restate the survey's one-sentence thesis after reading the introduction?
- Does the chosen body order actually serve the selected macro-story (${surveyStorylinePacket?.selectedStrategyLabel ?? "taxonomy-first"})?
- Is the intellectual center section (${surveyStorylinePacket?.intellectualCenterSection ?? "taxonomy"}) visibly carrying the manuscript's deepest insight?

## Coverage Breadth
- Does the manuscript teach the field structure rather than only listing papers?
- Are blind spots and exclusions explicit?

## Comparative Depth
- Does each core section compare families, assumptions, and tradeoffs?
- Is there at least one explicit contradiction or non-comparable result warning?

## Evidence Support
- Can each synthesis claim be traced back to included papers, SOTA matrix evidence, or coverage artifacts?
- Did any unsupported synthesis slip in?
- Re-check ${DEFAULT_SURVEY_SOURCE_TO_CLAIM_INDEX_PATH} and ${DEFAULT_SURVEY_TRACEABILITY_AUDIT_PATH} before calling the packet clean.

## Boundary Honesty
- Did the draft admit where the packet is thin?
- Did it avoid overclaiming field-wide consensus?

## Final Skeptical Questions
${surveyAnalysis.blockingIssues.length > 0 ? surveyAnalysis.blockingIssues.map((line) => `- ${line}`).join("\n") : gapLines.length > 0 ? gapLines.map((line) => `- ${line}`).join("\n") : "- What would a skeptical reviewer say is still thin, unsupported, or unfairly compared?"}
`;

  const visualizationPlanPath = path.join(
    params.projectRoot,
    "academic_writer",
    "SURVEY_VISUALIZATION_PLAN.md"
  );
  const visualizationPlan = `# Survey Visualization Plan

## Goal
Turn the survey from a bibliography dump into a comparison-driven manuscript with explicit tables and figures.

## Minimum Comparison Tables

### Table 1 — Family / Taxonomy Overview
- Purpose: compare the main method families or organizing themes in one place.
- Suggested columns: family, core assumption, representative methods, strengths, weaknesses, blind spots.
- Reuse signals:
${briefLines.length > 0 ? briefLines.map((line) => `  - ${line}`).join("\n") : "  - Derive family labels from SURVEY_BRIEF.md and LITERATURE_REVIEW.md."}

### Table 2 — Benchmark / Metric Landscape
- Purpose: compare datasets, metrics, and evaluation settings without collapsing incomparable results.
- Suggested columns: method, dataset, metric, backbone or modality, best result, caveat / fairness warning.
- Reuse signals:
${comparativeLines.length > 0 ? comparativeLines.map((line) => `  - ${line}`).join("\n") : "  - Pull comparison rows from SOTA_MATRIX.md and REVIEW_PROTOCOL.md."}

### Optional Table 3 — Tradeoffs / Failure Modes
- Use when one table cannot honestly carry robustness, efficiency, calibration, or failure-mode comparisons.
- Suggested columns: method, best-case win, known weakness, robustness note, efficiency note, contradiction / non-comparable warning.
- Trigger:
${gapLines.length > 0 ? gapLines.map((line) => `  - ${line}`).join("\n") : "  - Add this table when the evidence synthesis still feels like prose-only comparison."}

## Minimum Figures

### Figure 1 — Survey Taxonomy / Field Map
- Purpose: show how the field is partitioned and where boundaries blur.
- Candidate formats: hierarchy, flow chart, 2-axis matrix, or concept map.
- Backing artifacts:
  - academic_writer/story/PIPELINE_FIGURE_SKETCH.md
  - academic_writer/SURVEY_SECTION_BRIEFS.md

### Figure 2 — Benchmark / Comparison Landscape
- Purpose: show comparison coverage at a glance.
- Candidate formats: dataset-metric heatmap, benchmark matrix, timeline, or tradeoff map.
- Backing artifacts:
  - academic_writer/SURVEY_COMPARATIVE_ANALYSIS.md
  - researcher/SOTA_MATRIX.md
  - researcher/COVERAGE_SUMMARY.md

## Section-to-Visual Mapping
- taxonomy -> Table 1 + Figure 1
- evidence_synthesis -> Table 1 or Table 3, depending on tradeoff depth
- benchmark_landscape -> Table 2 + Figure 2
- open_problems -> add a small synthesis table if prose alone cannot keep the contrast honest

## Writer Rule
- Multiple tables are allowed and encouraged when different metrics, datasets, or evaluation assumptions cannot be represented honestly in a single leaderboard.
- Prefer explicit strengths / weaknesses / caveats columns over raw score dumps.
- If a comparison is not fair, label it as non-comparable instead of forcing it into the same table.
`;

  const tableDraftDir = path.join(
    params.projectRoot,
    "academic_writer",
    "paper",
    "tables"
  );
  const figureDraftDir = path.join(
    params.projectRoot,
    "academic_writer",
    "paper",
    "figures"
  );
  const taxonomyTablePath = path.join(tableDraftDir, "survey_taxonomy_overview.tex");
  const benchmarkTablePath = path.join(tableDraftDir, "survey_benchmark_landscape.tex");
  const taxonomyFigureSpecPath = path.join(
    figureDraftDir,
    "survey_taxonomy_map.md"
  );
  const benchmarkFigureSpecPath = path.join(
    figureDraftDir,
    "survey_benchmark_comparison_map.md"
  );
  const visualAssetIndexPath = path.join(
    params.projectRoot,
    "academic_writer",
    "SURVEY_VISUAL_ASSET_INDEX.json"
  );

  const taxonomyRows = briefLines
    .slice(0, 4)
    .map((line, index) => `Family ${index + 1} & ${line} & representative papers here & strengths here & weaknesses here \\\\`);
  const benchmarkRows = comparativeLines
    .slice(0, 4)
    .map(
      (line, index) =>
        `Method ${index + 1} & dataset here & metric here & best result here & ${line} \\\\`
    );
  const taxonomyTable = `%% Survey taxonomy comparison draft
%% Fill the placeholders from SURVEY_BRIEF.md / LITERATURE_REVIEW.md before including in main.tex.
\\begin{table*}[t]
\\centering
\\caption{Taxonomy / family overview for the survey topic. Replace placeholders with concrete family names, representative methods, and evidence-backed strengths / weaknesses.}
\\begin{tabular}{p{0.14\\textwidth} p{0.18\\textwidth} p{0.22\\textwidth} p{0.2\\textwidth} p{0.2\\textwidth}}
\\hline
Family & Core assumption & Representative methods & Strengths & Weaknesses \\\\
\\hline
${taxonomyRows.length > 0 ? taxonomyRows.join("\n") : "Family A & assumption here & representative methods here & strengths here & weaknesses here \\\\"}
\\hline
\\end{tabular}
\\end{table*}
`;
  const benchmarkTable = `%% Survey benchmark / metric landscape draft
%% Separate incompatible settings into additional tables if one table becomes misleading.
\\begin{table*}[t]
\\centering
\\caption{Benchmark and metric landscape. Replace placeholders with evidence-backed numbers and mark non-comparable settings explicitly.}
\\begin{tabular}{p{0.16\\textwidth} p{0.16\\textwidth} p{0.14\\textwidth} p{0.16\\textwidth} p{0.28\\textwidth}}
\\hline
Method & Dataset & Metric & Best result & Caveat / fairness warning \\\\
\\hline
${benchmarkRows.length > 0 ? benchmarkRows.join("\n") : "Method A & dataset here & metric here & result here & caveat / fairness warning here \\\\"}
\\hline
\\end{tabular}
\\end{table*}
`;
  const taxonomyFigureSpec = `# Survey Taxonomy Figure Spec

## Purpose
- Show the field partition and where boundaries blur.

## Candidate encodings
- hierarchy
- 2-axis matrix
- concept map

## Inputs to reuse
${briefLines.length > 0 ? briefLines.map((line) => `- ${line}`).join("\n") : "- Derive family labels from SURVEY_BRIEF.md and LITERATURE_REVIEW.md."}

## Annotation reminders
- label overlap zones explicitly
- do not imply a rigid taxonomy if boundaries are fuzzy
- keep the figure aligned with the taxonomy section headings
`;
  const benchmarkFigureSpec = `# Survey Benchmark Comparison Figure Spec

## Purpose
- Show benchmark and comparison coverage at a glance.

## Candidate encodings
- dataset-metric heatmap
- tradeoff matrix
- benchmark timeline

## Inputs to reuse
${comparativeLines.length > 0 ? comparativeLines.map((line) => `- ${line}`).join("\n") : "- Reuse rows from SOTA_MATRIX.md and REVIEW_PROTOCOL.md."}

## Annotation reminders
- highlight incomparable settings instead of collapsing them
- emphasize strengths / weaknesses / tradeoffs, not only the top score
- use additional tables when one figure cannot honestly summarize the evidence
`;

  await Promise.all([
    fs.mkdir(tableDraftDir, { recursive: true }),
    fs.mkdir(figureDraftDir, { recursive: true }),
    writeTextEnsured(comparativeAnalysisPath, comparativeAnalysis),
    writeTextEnsured(sectionBriefsPath, sectionBriefs),
    writeTextEnsured(selfReviewPath, selfReview),
    writeTextEnsured(visualizationPlanPath, visualizationPlan),
    writeTextEnsured(taxonomyTablePath, taxonomyTable),
    writeTextEnsured(benchmarkTablePath, benchmarkTable),
    writeTextEnsured(taxonomyFigureSpecPath, taxonomyFigureSpec),
    writeTextEnsured(benchmarkFigureSpecPath, benchmarkFigureSpec),
    writeProjectJson(params.projectRoot, "academic_writer/SURVEY_VISUAL_ASSET_INDEX.json", {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      topic,
      tableDrafts: [
        "academic_writer/paper/tables/survey_taxonomy_overview.tex",
        "academic_writer/paper/tables/survey_benchmark_landscape.tex",
      ],
      figureSpecs: [
        "academic_writer/paper/figures/survey_taxonomy_map.md",
        "academic_writer/paper/figures/survey_benchmark_comparison_map.md",
      ],
      sourceArtifacts: [
        "academic_writer/SURVEY_COMPARATIVE_ANALYSIS.md",
        "academic_writer/SURVEY_SECTION_BRIEFS.md",
        "academic_writer/SURVEY_SELF_REVIEW.md",
        "researcher/SOTA_MATRIX.md",
        "researcher/COVERAGE_SUMMARY.md",
        "researcher/GAP_SYNTHESIS.md",
        "researcher/REVIEW_PROTOCOL.md",
        DEFAULT_SURVEY_COMPARABILITY_REPORT_PATH,
        DEFAULT_SURVEY_SOURCE_TO_CLAIM_INDEX_PATH,
        DEFAULT_SURVEY_TOP_TIER_BRIDGE_PATH,
        DEFAULT_SURVEY_TRACEABILITY_AUDIT_PATH,
        "analyzer/FAIR_COMPARE_MATRIX.json",
      ],
    }),
  ]);
  const visualCompiler = await materializeSurveyVisualCompiler({
    projectRoot: params.projectRoot,
  });
  const methodologyConsistency = await materializeSurveyMethodologyConsistency({
    projectRoot: params.projectRoot,
  });

  return {
    generatedFiles: [
      "academic_writer/SURVEY_COMPARATIVE_ANALYSIS.md",
      DEFAULT_SURVEY_COMPARABILITY_REPORT_PATH,
      "academic_writer/SURVEY_SECTION_BRIEFS.md",
      "academic_writer/SURVEY_SELF_REVIEW.md",
      "academic_writer/SURVEY_VISUALIZATION_PLAN.md",
      "academic_writer/SURVEY_VISUAL_ASSET_INDEX.json",
      "academic_writer/paper/tables/survey_taxonomy_overview.tex",
      "academic_writer/paper/tables/survey_benchmark_landscape.tex",
      "academic_writer/paper/figures/survey_taxonomy_map.md",
      "academic_writer/paper/figures/survey_benchmark_comparison_map.md",
      "analyzer/FAIR_COMPARE_MATRIX.json",
      ...visualCompiler.generatedFiles,
      methodologyConsistency.path,
      DEFAULT_SURVEY_SOURCE_TO_CLAIM_INDEX_PATH,
      DEFAULT_SURVEY_TOP_TIER_BRIDGE_PATH,
      DEFAULT_SURVEY_TRACEABILITY_AUDIT_PATH,
    ],
  };
}

async function bootstrapWritingSession(params: { projectRoot: string }) {
  const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
  const writingContract = normalizeWritingContractState(manifest.writing_contract);
  const existing = (manifest.writing_session &&
    typeof manifest.writing_session === "object" &&
    !Array.isArray(manifest.writing_session)
      ? (manifest.writing_session as Record<string, unknown>)
      : {}) as Record<string, unknown>;
  const existingOrder = Array.isArray(existing.draft_order)
    ? (existing.draft_order as string[])
    : Array.isArray(existing.draftOrder)
      ? (existing.draftOrder as string[])
      : [];
  const draftOrder =
    existingOrder.length > 0
      ? existingOrder
      : writingContract.sectionOrder.length > 0
        ? writingContract.sectionOrder
        : writingContract.requiredSections;
  const currentSection =
    (typeof existing.current_section === "string" && existing.current_section.trim()) ||
    (typeof existing.currentSection === "string" && existing.currentSection.trim()) ||
    draftOrder[0] ||
    null;
  const sectionPackets =
    (existing.section_packets &&
      typeof existing.section_packets === "object" &&
      !Array.isArray(existing.section_packets)
      ? (existing.section_packets as Record<string, unknown>)
      : existing.sectionPackets &&
          typeof existing.sectionPackets === "object" &&
          !Array.isArray(existing.sectionPackets)
        ? (existing.sectionPackets as Record<string, unknown>)
        : {}) ?? {};

  const result = await setWritingSessionState({
    projectRoot: params.projectRoot,
    writingSession: {
      status:
        (typeof existing.status === "string" && existing.status.trim()) ||
        (draftOrder.length > 0 ? "outline_ready" : "bootstrapping"),
      current_section: currentSection,
      draft_order: draftOrder,
      section_packets: sectionPackets,
      pending_reason:
        (typeof existing.pending_reason === "string" && existing.pending_reason.trim()) ||
        (typeof existing.pendingReason === "string" && existing.pendingReason.trim()) ||
        (currentSection
          ? `Continue drafting from ${currentSection}.`
          : "Initialize the writing session from the active section order."),
    },
  });
  return result.state;
}

export async function materializeWritingSupportArtifacts(params: {
  projectRoot: string;
  stage: string | null;
  paperStoryState: PaperStoryState;
  reviewPressureState: ReviewPressurePacketState | null;
}) {
  const referenceBundle = await materializeWritingReferenceBundle({
    projectRoot: params.projectRoot,
    paperStoryState: params.paperStoryState,
    reviewPressureState: params.reviewPressureState,
  });
  const prewriteRejection = await materializePrewriteRejectionSimulation({
    projectRoot: params.projectRoot,
    paperStoryState: params.paperStoryState,
    reviewPressureState: params.reviewPressureState,
  });
  const storyBridge = await materializeContributionToStoryBridge({
    projectRoot: params.projectRoot,
    paperStoryState: params.paperStoryState,
  });
  const figureAnchor = await materializeFigureAnchorPlan({
    projectRoot: params.projectRoot,
    paperStoryState: params.paperStoryState,
  });
  const venueRouting = await materializeVenueRoutingPlan({
    projectRoot: params.projectRoot,
    paperStoryState: params.paperStoryState,
    reviewPressureState: params.reviewPressureState,
  });
  const figureTableRegistry = await materializeFigureTableRegistry({
    projectRoot: params.projectRoot,
  });
  const paragraphLogicAudit = await materializeParagraphLogicAudit({
    projectRoot: params.projectRoot,
  });

  let fallbackActivation = null;
  let revisionCycle = null;
  let rebuttalResponse = null;
  if (FALLBACK_RELEVANT_STAGES.has(params.stage ?? "")) {
    fallbackActivation = await materializeFallbackActivation({
      projectRoot: params.projectRoot,
      paperStoryState: params.paperStoryState,
      reviewPressureState: params.reviewPressureState,
    });
    revisionCycle = await materializeRevisionCycle({
      projectRoot: params.projectRoot,
      stage: params.stage,
      paperStoryState: params.paperStoryState,
      fallbackActivation: fallbackActivation.activation,
    });
    rebuttalResponse = await materializeRebuttalResponse({
      projectRoot: params.projectRoot,
      reviewPressureState: params.reviewPressureState,
    });
  }

  const generatedFiles = [
    referenceBundle.path,
    prewriteRejection.path,
    storyBridge.path,
    figureAnchor.path,
    venueRouting.path,
    figureTableRegistry.figureRegistryPath,
    figureTableRegistry.tableRegistryPath,
    figureTableRegistry.alignmentPath,
    paragraphLogicAudit.auditJsonPath,
    paragraphLogicAudit.auditReportPath,
    paragraphLogicAudit.reverseOutlinePath,
    fallbackActivation?.path,
    revisionCycle?.path,
    rebuttalResponse?.path,
  ].filter((value): value is string => typeof value === "string");

  const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
  const writingContract = normalizeWritingContractState(manifest.writing_contract);
  if (writingContract.paperMode === "survey") {
    const surveySupport = await materializeSurveyWritingCompanionArtifacts({
      projectRoot: params.projectRoot,
      paperStoryState: params.paperStoryState,
    });
    generatedFiles.push(...surveySupport.generatedFiles);
  }

  let writingSession = await bootstrapWritingSession({
    projectRoot: params.projectRoot,
  });
  if (writingContract.paperMode === "survey") {
    const surveySectionScaffolds = await materializeSurveySectionDraftScaffolds({
      projectRoot: params.projectRoot,
      requiredSections: writingContract.requiredSections,
      currentSectionPackets: writingSession.sectionPackets,
    });
    generatedFiles.push(...surveySectionScaffolds.generatedFiles);
    const currentSection =
      writingSession.nextSuggestedSection ??
      writingSession.currentSection ??
      writingSession.draftOrder[0] ??
      writingContract.requiredSections[0] ??
      null;
    const sessionResult = await setWritingSessionState({
      projectRoot: params.projectRoot,
      writingSession: {
        current_section: currentSection,
        section_packets: surveySectionScaffolds.sectionPacketsPatch,
      },
    });
    writingSession = sessionResult.state;
  }
  await syncAuthoringArtifactRecovery({
    projectRoot: params.projectRoot,
    writingSession,
  }).catch(() => null);

  return {
    stage: params.stage,
    referenceBundle: referenceBundle.bundle,
    prewriteRejection: { path: prewriteRejection.path },
    contributionToStoryBridge: { path: storyBridge.path },
    figureAnchorPlan: { path: figureAnchor.path },
    figureTableRegistry,
    paragraphLogicAudit: paragraphLogicAudit.state,
    venueRoutingPlan: { path: venueRouting.path, recommendedVenue: venueRouting.recommendedVenue },
    fallbackActivation: fallbackActivation?.activation ?? null,
    revisionCycle: revisionCycle?.state ?? null,
    rebuttalResponse: rebuttalResponse ?? null,
    writingSession,
    generatedFiles,
  };
}
