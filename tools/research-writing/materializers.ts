import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readTextIfExists, writeTextEnsured } from "../workflow-guard-core/fs";
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
import { materializeContributionToStoryBridge } from "./story-bridge";
import { materializeVenueRoutingPlan } from "./venue-routing";
import { materializeFigureTableRegistry } from "../research-authoring/figure-table-registry";
import { materializeSurveyAnalysis } from "../research-authoring/survey-analysis";

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

  await Promise.all([
    writeTextEnsured(comparativeAnalysisPath, comparativeAnalysis),
    writeTextEnsured(sectionBriefsPath, sectionBriefs),
    writeTextEnsured(selfReviewPath, selfReview),
  ]);

  await materializeSurveyAnalysis({
    projectRoot: params.projectRoot,
  });

  return {
    generatedFiles: [
      "academic_writer/SURVEY_COMPARATIVE_ANALYSIS.md",
      "academic_writer/SURVEY_COMPARABILITY_REPORT.md",
      "academic_writer/SURVEY_SECTION_BRIEFS.md",
      "academic_writer/SURVEY_SELF_REVIEW.md",
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
