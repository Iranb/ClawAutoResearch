import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readTextIfExists, writeTextEnsured } from "../workflow-guard-core/fs";
import { writeProjectJson } from "../research-contracts/core/project-io";
import type {
  PaperStoryState,
  ReviewPressurePacketState,
} from "../workflow-guard.js";
import { normalizeWritingContractState } from "../workflow-guard-state/writing-contract";
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
import { materializeSurveyVisualCompiler } from "./survey-visual-compiler";
import { materializeContributionToStoryBridge } from "./story-bridge";
import { materializeVenueRoutingPlan } from "./venue-routing";
import { materializeFigureTableRegistry } from "../research-authoring/figure-table-registry";
import { materializeSurveyAnalysis } from "../research-authoring/survey-analysis";
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

async function materializeSurveyWritingCompanionArtifacts(params: {
  projectRoot: string;
  paperStoryState: PaperStoryState;
}) {
  const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
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
  ] = await Promise.all([
    readTextIfExists(path.join(params.projectRoot, "researcher", "SURVEY_BRIEF.md")),
    readTextIfExists(path.join(params.projectRoot, "researcher", "LITERATURE_REVIEW.md")),
    readTextIfExists(path.join(params.projectRoot, "researcher", "SOTA_MATRIX.md")),
    readTextIfExists(path.join(params.projectRoot, "researcher", "GAP_SYNTHESIS.md")),
    readTextIfExists(path.join(params.projectRoot, "researcher", "COVERAGE_SUMMARY.md")),
    readTextIfExists(path.join(params.projectRoot, "researcher", "REVIEW_PROTOCOL.md")),
  ]);

  const comparativeLines = uniqueStrings([
    ...collectMarkdownSignalLines(sotaMatrix, 8),
    ...collectMarkdownSignalLines(literatureReview, 8),
  ]).slice(0, 8);
  const coverageLines = collectMarkdownSignalLines(coverageSummary, 5);
  const gapLines = collectMarkdownSignalLines(gapSynthesis, 6);
  const briefLines = collectMarkdownSignalLines(surveyBrief, 6);
  const protocolLines = collectMarkdownSignalLines(reviewProtocol, 5);

  const comparativeAnalysisPath = path.join(
    params.projectRoot,
    "academic_writer",
    "SURVEY_COMPARATIVE_ANALYSIS.md"
  );
  const comparativeAnalysis = `# Survey Comparative Analysis

## Topic
- ${topic}
- Included papers: ${includedCount ?? "unset"}

## Required Comparison Axes
- method family and organizing assumption
- supervision / modality / backbone dependence
- benchmark and metric coverage
- strongest win vs strongest failure mode
- contradiction or non-comparable result warning

## Comparison Evidence To Reuse
${comparativeLines.length > 0 ? comparativeLines.map((line) => `- ${line}`).join("\n") : "- Expand SOTA matrix and literature review evidence before claiming strong comparative synthesis."}

## Coverage / Boundary Reminders
${coverageLines.length > 0 ? coverageLines.map((line) => `- ${line}`).join("\n") : "- Keep scope boundaries, blind spots, and excluded directions explicit."}

## Gap / Tradeoff Reminders
${gapLines.length > 0 ? gapLines.map((line) => `- ${line}`).join("\n") : "- Tie every open problem back to a concrete evidence gap rather than generic future work."}
`;

  const sectionBriefsPath = path.join(
    params.projectRoot,
    "academic_writer",
    "SURVEY_SECTION_BRIEFS.md"
  );
  const sectionBriefs = `# Survey Section Briefs

## Introduction
- Explain why ${topic} needs a survey now.
- State what this survey contributes beyond a paper list.
- Preview the comparison axes and the field structure.

## Scope and Protocol
- Explain inclusion / exclusion logic and search boundary.
- Surface blind spots, recency limits, and incomparable settings.
- Reuse protocol evidence from ${protocolLines.length > 0 ? "REVIEW_PROTOCOL.md" : "the review protocol once refreshed"}.

## Taxonomy
- Define stable method families and the principle that separates them.
- Mention where family boundaries blur or overlap.
- Compare families, do not just list them.

## Evidence Synthesis
- Use representative papers to compare strengths, weaknesses, and tradeoffs.
- Include at least one contradiction / non-comparable warning paragraph.
- Reuse: ${briefLines.length > 0 ? briefLines.slice(0, 3).map((line) => `"${line}"`).join(", ") : "SURVEY_BRIEF.md synthesis bullets"}.

## Benchmark Landscape
- State which benchmark comparisons are fair and which are shaky.
- Compare datasets, metrics, and backbone/modality assumptions.
- Do not collapse incompatible results into one ranking.

## Open Problems
- Rank the main unresolved problems by evidence gap importance.
- Tie each open problem to missing comparisons, weak coverage, or contradiction zones.

## Conclusion
- Summarize what the field now understands with confidence.
- Keep unresolved boundaries explicit.
`;

  const selfReviewPath = path.join(
    params.projectRoot,
    "academic_writer",
    "SURVEY_SELF_REVIEW.md"
  );
  const selfReview = `# Survey Self Review

Use this before calling the survey draft mature.

## Coverage Breadth
- Does the manuscript teach the field structure rather than only listing papers?
- Are blind spots and exclusions explicit?

## Comparative Depth
- Does each core section compare families, assumptions, and tradeoffs?
- Is there at least one explicit contradiction or non-comparable result warning?

## Evidence Support
- Can each synthesis claim be traced back to included papers, SOTA matrix evidence, or coverage artifacts?
- Did any unsupported synthesis slip in?

## Boundary Honesty
- Did the draft admit where the packet is thin?
- Did it avoid overclaiming field-wide consensus?

## Final Skeptical Questions
${gapLines.length > 0 ? gapLines.map((line) => `- ${line}`).join("\n") : "- What would a skeptical reviewer say is still thin, unsupported, or unfairly compared?"}
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
      ],
    }),
  ]);

  await materializeSurveyAnalysis({
    projectRoot: params.projectRoot,
  });
  const visualCompiler = await materializeSurveyVisualCompiler({
    projectRoot: params.projectRoot,
  });
  const methodologyConsistency = await materializeSurveyMethodologyConsistency({
    projectRoot: params.projectRoot,
  });

  return {
    generatedFiles: [
      "academic_writer/SURVEY_COMPARATIVE_ANALYSIS.md",
      "academic_writer/SURVEY_COMPARABILITY_REPORT.md",
      "academic_writer/SURVEY_SECTION_BRIEFS.md",
      "academic_writer/SURVEY_SELF_REVIEW.md",
      "academic_writer/SURVEY_VISUALIZATION_PLAN.md",
      "academic_writer/SURVEY_VISUAL_ASSET_INDEX.json",
      "academic_writer/paper/tables/survey_taxonomy_overview.tex",
      "academic_writer/paper/tables/survey_benchmark_landscape.tex",
      "academic_writer/paper/figures/survey_taxonomy_map.md",
      "academic_writer/paper/figures/survey_benchmark_comparison_map.md",
      ...visualCompiler.generatedFiles,
      methodologyConsistency.path,
      "researcher/SOURCE_TO_CLAIM_INDEX.json",
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

  const writingSession = await bootstrapWritingSession({
    projectRoot: params.projectRoot,
  });
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
    venueRoutingPlan: { path: venueRouting.path, recommendedVenue: venueRouting.recommendedVenue },
    fallbackActivation: fallbackActivation?.activation ?? null,
    revisionCycle: revisionCycle?.state ?? null,
    rebuttalResponse: rebuttalResponse ?? null,
    writingSession,
    generatedFiles,
  };
}
