import * as path from "node:path";
import {
  asRecord,
  pickNumber,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import {
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import { buildIdeaToClaimMap } from "../idea-catalyst/claim-mapper";
import {
  evaluateCrossDomainInspirationGate,
  normalizeCrossDomainInspirationState,
} from "../idea-catalyst/cross-domain-contract";
import { normalizeIdeaCatalystState } from "../idea-catalyst/state";
import { normalizeResearchProgramState } from "../workflow-guard-state/research-program";
import { normalizeSurveyReviewState } from "../workflow-guard-state/survey-review";
import {
  normalizePaperStoryState,
  serializePaperStoryState,
} from "../workflow-guard-state/paper-story";
import {
  normalizeWritingContractState,
  serializeWritingContractState,
} from "../workflow-guard-state/writing-contract";
import type { PaperStoryState } from "../workflow-guard.js";

type ClaimSupportSummary = {
  status: string;
  supportedCount: number;
  partialCount: number;
  unsupportedCount: number;
};

type IdeationSummary = {
  state: {
    selectedTrackId: string | null;
    longTermGoal: string | null;
    problemScope: string | null;
    researchProposalPath: string | null;
    problemDecompositionPath: string | null;
    graphIdeationPacketPath: string | null;
  };
  validationErrors: string[];
};

type BrainstormSummary = {
  state: {
    trackId: string | null;
    storylineBriefPath: string | null;
  };
};

function slugSurveyTopic(value: string | null | undefined): string {
  const cleaned = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "survey";
}

type PaperStorySummary = {
  validationErrors: string[];
  storySpineResolvedPath: string | null;
  storySpineExists: boolean;
  claimToExperimentMapResolvedPath: string | null;
  claimToExperimentMapExists: boolean;
  fallbackNarrativeResolvedPath: string | null;
  fallbackNarrativeExists: boolean;
};

type MaterializePaperStoryDeps = {
  readManifestEnsured: (projectRoot: string) => Promise<Record<string, unknown>>;
  saveManifest: (
    projectRoot: string,
    manifest: Record<string, unknown>
  ) => Promise<void>;
  getIdeationContractStateSummary: (params: {
    projectRoot: string;
  }) => Promise<IdeationSummary>;
  getBrainstormCycleStateSummary: (params: {
    projectRoot: string;
  }) => Promise<BrainstormSummary>;
  getPaperStoryStateSummary: (params: {
    projectRoot: string;
  }) => Promise<PaperStorySummary>;
  getActiveTracks: (
    trackRegistry: Record<string, unknown> | null
  ) => Array<Record<string, unknown>>;
  resolveResearchProgramTrack: (
    manifest: Record<string, unknown> | null,
    trackId: string | null
  ) => Record<string, unknown> | null;
  summarizeClaimSupport: (params: {
    claimEvidenceMatrixRaw: string | null;
    unsupportedClaimsRaw: string | null;
  }) => ClaimSupportSummary;
  collectTrackVerdictSignals: (rawText: string | null) => string[];
  collectUnsupportedClaimSignals: (rawText: string | null) => string[];
  collectMarkdownSignalLines: (
    rawText: string | null,
    options?: { includeSectionsContaining?: string[] }
  ) => string[];
  quoteMarkdownText: (value: string | null | undefined) => string;
  renderMarkdownBulletList: (items: string[]) => string;
  isIdeationContractReady: (state: unknown) => boolean;
};

export async function materializePaperStoryStateImpl(
  params: {
    projectRoot: string;
    paperStoryMaterialization?: Record<string, unknown>;
    trigger?: string | null;
    agentId?: string | null;
  },
  deps: MaterializePaperStoryDeps
): Promise<{
  state: PaperStoryState;
  validationErrors: string[];
  storySpineResolvedPath: string | null;
  storySpineExists: boolean;
  claimToExperimentMapResolvedPath: string | null;
  claimToExperimentMapExists: boolean;
  fallbackNarrativeResolvedPath: string | null;
  fallbackNarrativeExists: boolean;
  generatedFiles: string[];
}> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifest = await deps.readManifestEnsured(projectRoot);
  const current = normalizePaperStoryState(manifest.paper_story_state);
  const currentWritingContract = normalizeWritingContractState(manifest.writing_contract);
  const patch = asRecord(params.paperStoryMaterialization) ?? {};
  const researchProgram = normalizeResearchProgramState(manifest.research_program);
  const surveyReviewState = normalizeSurveyReviewState(manifest.survey_review);
  const surveyWritingBridgeReady = surveyReviewState.status === "completed";
  const ideationSummary = await deps.getIdeationContractStateSummary({ projectRoot });
  const ideationState = ideationSummary.state;
  const ideaCatalystState = normalizeIdeaCatalystState(manifest.idea_catalyst);
  const crossDomainState = normalizeCrossDomainInspirationState(
    manifest.cross_domain_inspiration
  );
  const crossDomainGate = manifest.cross_domain_inspiration
    ? evaluateCrossDomainInspirationGate({
        state: crossDomainState,
        workflowLine: surveyWritingBridgeReady ? "survey" : "experiment",
        headlineClaim:
          (manifest.writing_contract as Record<string, unknown> | undefined)
            ?.cross_domain_headline_claim === true,
      })
    : null;
  const brainstormSummary = await deps.getBrainstormCycleStateSummary({ projectRoot });
  const brainstormState = brainstormSummary.state;
  const trackRegistry =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "TRACK_REGISTRY.json")
    )) ?? null;
  const activeTracks = deps.getActiveTracks(trackRegistry);
  const storylineSourceTrackId =
    pickString(patch, [
      "storylineSourceTrackId",
      "storyline_source_track_id",
      "trackId",
      "track_id",
    ]) ??
    current.storylineSourceTrackId ??
    ideationState.selectedTrackId ??
    brainstormState.trackId ??
    (surveyWritingBridgeReady ? `survey-${slugSurveyTopic(surveyReviewState.topic)}` : null) ??
    (activeTracks[0]
      ? pickString(activeTracks[0], ["track_id", "trackId"])
      : null);
  const selectedTrack =
    activeTracks.find(
      (track) => pickString(track, ["track_id", "trackId"]) === storylineSourceTrackId
    ) ?? null;
  const selectedProgramTrack = deps.resolveResearchProgramTrack(
    manifest,
    storylineSourceTrackId
  );

  const [
    proposalText,
    decompositionText,
    storylineBriefRecord,
    graphIdeationPacketRecord,
    graphStorylinePacketRecord,
    ideaFragmentsRecord,
    rankedFragmentsRecord,
    claimEvidenceMatrixText,
    trackVerdictsText,
    unsupportedClaimsText,
    surveyBriefText,
    surveyLiteratureReviewText,
    surveyGapSynthesisText,
    surveyCoverageSummaryText,
  ] = await Promise.all([
    readTextIfExists(resolveProjectArtifactPath(projectRoot, ideationState.researchProposalPath)),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, ideationState.problemDecompositionPath)
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, brainstormState.storylineBriefPath) ?? ""
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, ideationState.graphIdeationPacketPath) ?? ""
    ),
    readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "researcher", "papernexus", "GRAPH_STORYLINE_PACKET.json")
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, ideaCatalystState.ideaFragmentsPath) ?? ""
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, ideaCatalystState.rankedFragmentsPath) ?? ""
    ),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, current.claimEvidenceMatrixPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, current.trackVerdictsPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, current.unsupportedClaimsPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, surveyReviewState.surveyBriefPath)),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, surveyReviewState.literatureReviewPath)
    ),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, surveyReviewState.gapSynthesisPath)),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, surveyReviewState.coverageSummaryPath)
    ),
  ]);

  const storylineBrief = asRecord(storylineBriefRecord) ?? {};
  const graphPacket = asRecord(graphIdeationPacketRecord) ?? {};
  const graphStorylinePacket = asRecord(graphStorylinePacketRecord) ?? {};
  const ideaFragmentsPacket = asRecord(ideaFragmentsRecord) ?? {};
  const rankedFragmentsPacket = asRecord(rankedFragmentsRecord) ?? {};
  const claimSupport = deps.summarizeClaimSupport({
    claimEvidenceMatrixRaw: claimEvidenceMatrixText,
    unsupportedClaimsRaw: unsupportedClaimsText,
  });
  const trackVerdictSignals = deps.collectTrackVerdictSignals(trackVerdictsText).slice(0, 4);
  const unsupportedClaimSignals = deps
    .collectUnsupportedClaimSignals(unsupportedClaimsText)
    .slice(0, 4);

  const taskSummary =
    pickString(graphStorylinePacket, ["task_summary", "taskSummary"]) ??
    (surveyWritingBridgeReady
      ? `Write a graph-grounded survey paper on ${surveyReviewState.topic ?? "the selected survey topic"}.`
      : null) ??
    researchProgram.goal ??
    ideationState.longTermGoal ??
    "Deliver a research narrative that stays grounded in explicit graph evidence.";
  const challengeStatement =
    pickString(graphStorylinePacket, ["challenge_statement", "challengeStatement"]) ??
    (surveyWritingBridgeReady
      ? deps.collectMarkdownSignalLines(surveyGapSynthesisText).slice(0, 1)[0] ??
        deps.collectMarkdownSignalLines(surveyCoverageSummaryText).slice(0, 1)[0] ??
        "The survey must synthesize broad coverage without flattening important method differences and open problems."
      : null) ??
    researchProgram.problemStatement ??
    ideationState.problemScope ??
    "Current drafts lose fine-grained support as the narrative widens.";
  const insightSummary =
    pickString(graphStorylinePacket, ["insight_summary", "insightSummary"]) ??
    (surveyWritingBridgeReady
      ? deps.collectMarkdownSignalLines(surveyBriefText).slice(0, 1)[0] ??
        deps.collectMarkdownSignalLines(surveyLiteratureReviewText, {
          includeSectionsContaining: ["taxonomy", "theme", "cluster"],
        }).slice(0, 1)[0] ??
        `The survey story should organize ${surveyReviewState.topic ?? "the topic"} by method families, benchmark clusters, and unresolved gaps.`
      : null) ??
    (selectedTrack ? pickString(selectedTrack, ["hypothesis"]) : null) ??
    (selectedProgramTrack ? pickString(selectedProgramTrack, ["hypothesis"]) : null) ??
    (selectedTrack ? pickString(selectedTrack, ["novelty_basis"]) : null) ??
    (selectedProgramTrack ? pickString(selectedProgramTrack, ["novelty_basis"]) : null) ??
    (storylineBrief ? pickString(storylineBrief, ["thesis"]) : null) ??
    "Use graph-grounded routing to keep claims aligned with explicit support packets.";
  const contributionBullets = uniqueStrings([
    ...((Array.isArray(
      graphStorylinePacket?.contribution_bullets ?? graphStorylinePacket?.contributionBullets
    )
      ? (graphStorylinePacket?.contribution_bullets ?? graphStorylinePacket?.contributionBullets)
      : []) as unknown[])
      .map((entry) => pickString({ value: entry }, ["value"]))
      .filter((entry): entry is string => Boolean(entry)),
    ...(surveyWritingBridgeReady
      ? [
          `Synthesize ${surveyReviewState.includedPaperCount ?? "the included"} papers into a reviewer-readable thematic structure.`,
          "Turn durable survey coverage into a theme-to-evidence writing packet instead of a flat paper list.",
          "Make contradiction areas and open gaps explicit before prose-level synthesis.",
        ]
      : [
          "Graph-grounded routing turns evidence links into a controllable story-planning signal.",
          "The method preserves support precision without abandoning clarity-oriented structure.",
          "The workflow keeps claim, experiment, and reviewer pressure aligned around one direction.",
        ]),
    ...deps.collectMarkdownSignalLines(proposalText, {
      includeSectionsContaining: ["method", "contribution"],
    }),
    ...deps.collectMarkdownSignalLines(decompositionText, {
      includeSectionsContaining: ["sub-problems", "validation"],
    }),
    ...deps.collectMarkdownSignalLines(surveyCoverageSummaryText, {
      includeSectionsContaining: ["coverage", "scope", "included"],
    }),
    ...deps.collectMarkdownSignalLines(surveyGapSynthesisText, {
      includeSectionsContaining: ["gap", "open", "future"],
    }),
  ]).slice(0, 4);
  const advantageBullets = uniqueStrings([
    ...((Array.isArray(
      graphStorylinePacket?.advantage_bullets ?? graphStorylinePacket?.advantageBullets
    )
      ? (graphStorylinePacket?.advantage_bullets ?? graphStorylinePacket?.advantageBullets)
      : []) as unknown[])
      .map((entry) => pickString({ value: entry }, ["value"]))
      .filter((entry): entry is string => Boolean(entry)),
    ...(surveyWritingBridgeReady
      ? [
          "Keeps coverage decisions explicit through included/excluded packets and the review protocol.",
          "Lets the draft cite benchmark clusters, method families, and disagreement areas from durable survey artifacts.",
          "Preserves graph-grounded traceability from survey brief to prose-level themes.",
        ]
      : [
          `Improves the primary metric: ${researchProgram.primaryMetric ?? "primary_metric"}.`,
          `Stays comparable to the baseline: ${researchProgram.baselineReference ?? "named baseline"}.`,
          "Makes each claim easier to defend with explicit graph-backed support packets.",
        ]),
    ...trackVerdictSignals,
    ...deps.collectMarkdownSignalLines(proposalText, {
      includeSectionsContaining: ["expected", "advantage"],
    }),
    ...deps.collectMarkdownSignalLines(surveyBriefText, {
      includeSectionsContaining: ["baseline", "benchmark", "gap"],
    }),
  ]).slice(0, 4);
  const packetLimitationFallbackSignals = ((Array.isArray(
    graphStorylinePacket?.limitation_boundaries ?? graphStorylinePacket?.limitationBoundaries
  )
    ? (graphStorylinePacket?.limitation_boundaries ??
        graphStorylinePacket?.limitationBoundaries)
    : []) as unknown[])
    .map((entry) => pickString({ value: entry }, ["value"]))
    .filter((entry): entry is string => Boolean(entry))
    .map((line) => `If unresolved evidence persists, downgrade around: ${line}`)
    .slice(0, 3);

  const crossDomainStorySection = manifest.cross_domain_inspiration
    ? `## Cross-Domain Story Bridge
- status: ${crossDomainState.status}
- preferred source domains: ${crossDomainState.preferredSourceDomains.join(", ")}
- priority concepts: ${crossDomainState.priorityConcepts.slice(0, 6).join(", ")}
- target problem: ${crossDomainState.targetProblem ?? "unset"}
- evidence gate: ${crossDomainGate?.ready ? "ready" : "not ready"}
- usage: ${
        crossDomainState.status === "partial"
          ? "motivation / limitation / taxonomy only; no headline claim"
          : surveyWritingBridgeReady
            ? "taxonomy lens and future directions"
            : "story mechanism bridge"
      }`
    : "";

  const storySpine = `# Story Spine

## Task
${deps.quoteMarkdownText(taskSummary)}

## Challenge
${deps.quoteMarkdownText(challengeStatement)}

## Insight
${deps.quoteMarkdownText(insightSummary)}

## Contribution
${deps.renderMarkdownBulletList(contributionBullets)}

## Advantage
${deps.renderMarkdownBulletList(advantageBullets)}

## Claim Support Snapshot
- status: ${claimSupport.status}
- supported: ${claimSupport.supportedCount}
- partial: ${claimSupport.partialCount}
- unsupported: ${claimSupport.unsupportedCount}

## Track Verdict Snapshot
${deps.renderMarkdownBulletList(
  trackVerdictSignals.length > 0
    ? trackVerdictSignals
    : ["Track verdicts will be filled after analyzer verdict consolidation."]
)}

## Boundary / Limitation Hooks
${deps.renderMarkdownBulletList(
  unsupportedClaimSignals.length > 0
    ? unsupportedClaimSignals
    : ["Boundary-case and unsupported-claim hooks will be filled after analyzer review."]
)}

## Narrative Arc
${deps.quoteMarkdownText(
  (storylineBrief ? pickString(storylineBrief, ["arc"]) : null) ??
    "Task -> challenge -> insight -> contribution -> advantage"
)}

${crossDomainStorySection}
`;

  const pipelineFigureSketch = surveyWritingBridgeReady
    ? `# Pipeline Figure Sketch

1. Inputs
   - Topic: ${deps.quoteMarkdownText(surveyReviewState.topic)}
   - Included papers: ${surveyReviewState.includedPaperCount ?? "unset"}
   - Coverage packet(s): ${deps.renderMarkdownBulletList(
       uniqueStrings([
         surveyReviewState.reviewProtocolPath ?? "researcher/REVIEW_PROTOCOL.md",
         surveyReviewState.includedPapersPath ?? "researcher/INCLUDED_PAPERS.json",
         surveyReviewState.excludedPapersPath ?? "researcher/EXCLUDED_PAPERS.json",
         surveyReviewState.surveyBriefPath ?? "researcher/SURVEY_BRIEF.md",
       ]).slice(0, 4)
     )}
2. Core synthesis layer
   - Theme/taxonomy organizer grounded in the survey packet
   - Evidence bundling for benchmark clusters, disagreements, and open gaps
3. Outputs
   - Theme-to-evidence map for writing
   - Survey narrative bundle with explicit scope and limitation hooks
4. Evaluation overlay
   - Coverage summary: ${deps.quoteMarkdownText(
       deps.collectMarkdownSignalLines(surveyCoverageSummaryText).slice(0, 1)[0] ??
         "keep included/excluded logic and gap coverage explicit"
     )}

## Survey Storyline Hooks
${deps.renderMarkdownBulletList(
  uniqueStrings([
    ...deps.collectMarkdownSignalLines(surveyLiteratureReviewText, {
      includeSectionsContaining: ["theme", "taxonomy", "cluster"],
    }),
    ...deps.collectMarkdownSignalLines(surveyGapSynthesisText, {
      includeSectionsContaining: ["gap", "open", "future"],
    }),
  ]).slice(0, 3)
)}
`
    : `# Pipeline Figure Sketch

1. Inputs
   - Baseline system: ${deps.quoteMarkdownText(researchProgram.baselineReference)}
   - Graph evidence packet(s): ${deps.renderMarkdownBulletList(
     uniqueStrings(
       Array.isArray(graphPacket?.evidence_pointers)
         ? graphPacket.evidence_pointers.filter((entry): entry is string => typeof entry === "string")
         : []
     ).slice(0, 4)
   )}
2. Core module
   - Graph-grounded support router
3. Outputs
   - Claim plan with explicit support anchors
   - Evidence-backed narrative bundle
4. Evaluation overlay
   - Primary metric: ${deps.quoteMarkdownText(researchProgram.primaryMetric)}

## Graph Storyline Hooks
${deps.renderMarkdownBulletList(
  uniqueStrings(
    ((Array.isArray(
      graphStorylinePacket?.related_work_tension ?? graphStorylinePacket?.relatedWorkTension
    )
      ? (graphStorylinePacket?.related_work_tension ?? graphStorylinePacket?.relatedWorkTension)
      : []) as unknown[])
      .map((entry) => pickString({ value: entry }, ["value"]))
      .filter((entry): entry is string => Boolean(entry))
  ).slice(0, 3)
)}
`;

  const packetModuleMotivations: Array<Record<string, unknown>> = Array.isArray(
    graphStorylinePacket.module_motivations ?? graphStorylinePacket.moduleMotivations
  )
    ? ((graphStorylinePacket.module_motivations ?? graphStorylinePacket.moduleMotivations) as unknown[])
        .map((entry: unknown) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
  const moduleMotivationMap = `# Module Motivation Map

${packetModuleMotivations.length > 0
    ? packetModuleMotivations
        .map((entry: Record<string, unknown>, index: number) => {
          const moduleName = pickString(entry, ["module"]) ?? `module-${index + 1}`;
          return `## Module ${index + 1}: ${moduleName}
- Design: ${pickString(entry, ["design"]) ?? "pending"}
- Motivation: ${pickString(entry, ["motivation"]) ?? "pending"}
- Advantage: ${pickString(entry, ["advantage"]) ?? "pending"}`;
        })
        .join("\n\n")
    : surveyWritingBridgeReady
      ? `## Module 1: Survey coverage organizer
- Design: cluster included papers into stable method/theme groups before drafting
- Motivation: keep the survey from collapsing into a bibliography dump
- Advantage: produces sections with explicit coverage boundaries and comparison axes

## Module 2: Theme-to-evidence map
- Design: bind each survey theme to representative papers, benchmark clusters, and contradiction notes
- Motivation: prevent unsupported synthesis claims from entering the manuscript
- Advantage: makes reviewer pressure explicit before writing`
      : `## Module 1: Graph-grounded support router
- Design: route each claim through graph evidence packets before surface drafting
- Motivation: reduce support attribution drift as the story widens
- Advantage: preserve support precision while keeping a readable narrative

## Module 2: Claim-to-experiment alignment layer
- Design: bind each research claim to a concrete validation step
- Motivation: prevent unsupported or over-broad claims from entering the draft
- Advantage: makes reviewer pressure explicit before writing`}
`;

  const claimToExperimentMap = surveyWritingBridgeReady
    ? `# Claim To Experiment Map

Survey mode note: this file acts as a theme-to-evidence map rather than an experiment-launch contract.

## Theme 1 (theme-1)
- Theme: Core method families in ${deps.quoteMarkdownText(surveyReviewState.topic)}
- Evidence target: representative included papers + taxonomy notes
- Validation step: cite canonical papers for each family and keep their boundaries explicit

## Theme 2 (theme-2)
- Theme: Benchmark and evaluation clusters
- Evidence target: SOTA matrix + coverage summary
- Validation step: tie comparisons to explicit datasets/metrics instead of generic performance prose

## Theme 3 (theme-3)
- Theme: Open problems, disagreement zones, and unresolved gaps
- Evidence target: gap synthesis + survey brief
- Validation step: frame these as synthesis claims backed by included papers, not speculative future-work filler
`
    : `# Claim To Experiment Map

## Claim 1 (claim-1)
- Claim: Graph-grounded routing improves ${deps.quoteMarkdownText(
    researchProgram.primaryMetric ?? "the primary metric"
  )} over ${deps.quoteMarkdownText(researchProgram.baselineReference)}.
- Evidence target: baseline reproduction + routing-only delta
- Validation step: keep the training/eval protocol unchanged, then enable the routing delta only

## Claim 2 (claim-2)
- Claim: The core router is responsible for the gain, not an unrelated implementation drift.
- Evidence target: module ablation and bounded controls
- Validation step: remove the router while keeping the rest of the stack fixed

## Claim 3 (claim-3)
- Claim: The method improves support precision without collapsing clarity.
- Evidence target: boundary / failure analysis with narrative quality checks
- Validation step: compare support precision gains against clarity regressions
`;

  const ideaToClaimMap = buildIdeaToClaimMap({
    rankedFragments: Array.isArray(rankedFragmentsPacket?.ranking)
      ? rankedFragmentsPacket?.ranking
      : [],
    ideaFragments: Array.isArray(ideaFragmentsPacket?.fragments)
      ? ideaFragmentsPacket?.fragments
      : [],
    selectedTrackId: storylineSourceTrackId,
    baselineReference: researchProgram.baselineReference,
    primaryMetric: researchProgram.primaryMetric,
    problemStatement: researchProgram.problemStatement,
    trackHypothesis:
      (selectedTrack ? pickString(selectedTrack, ["hypothesis"]) : null) ??
      (selectedProgramTrack ? pickString(selectedProgramTrack, ["hypothesis"]) : null),
    noveltyBasis:
      (selectedTrack ? pickString(selectedTrack, ["novelty_basis"]) : null) ??
      (selectedProgramTrack ? pickString(selectedProgramTrack, ["novelty_basis"]) : null),
  });

  const taskSummaryDoc = `# Task Summary

${deps.quoteMarkdownText(taskSummary)}
`;

  const challengeDoc = `# Challenge Statement

${deps.quoteMarkdownText(challengeStatement)}
`;

  const insightDoc = `# Insight Summary

${deps.quoteMarkdownText(insightSummary)}
`;

  const contributionMap = `# Contribution Map

${deps.renderMarkdownBulletList(contributionBullets)}
`;

  const advantageMap = `# Advantage Map

${deps.renderMarkdownBulletList(advantageBullets)}
`;

  const fallbackNarrative = `# Fallback Narrative

- If the main ${surveyWritingBridgeReady ? "survey thesis" : "novelty claim"} feels too broad, narrow the story to "${surveyWritingBridgeReady ? "a bounded synthesis over explicit method families and gaps" : "graph-grounded support routing"}" instead of a general ${
    surveyWritingBridgeReady ? "field-wide conclusion" : "writing overhaul"
  }.
- If ${surveyWritingBridgeReady ? "coverage confidence is uneven" : "empirical gains are modest"}, emphasize ${
    surveyWritingBridgeReady
      ? "explicit inclusion/exclusion logic and benchmark clusters under the stated scope"
      : "bounded support precision wins under unchanged baseline protocol"
  }.
- If reviewer pressure focuses on ${surveyWritingBridgeReady ? "taxonomy instability or missing coverage" : "overlap with existing pipelines"}, pivot to the stricter ${
    surveyWritingBridgeReady ? "theme-to-evidence map" : "claim-evidence alignment layer"
  } as the core contribution.
${deps.renderMarkdownBulletList(
  unsupportedClaimSignals.length > 0
    ? unsupportedClaimSignals.map(
        (line) => `If unresolved evidence persists, downgrade around: ${line}`
      )
    : packetLimitationFallbackSignals.length > 0
      ? packetLimitationFallbackSignals
      : ["If unresolved evidence persists, tighten scope before escalating any headline claim."]
)}
`;

  const rejectionRiskTable = `# Rejection Risk Table

| Risk | Why it could trigger rejection | Mitigation |
| --- | --- | --- |
| ${surveyWritingBridgeReady ? "Coverage blind spot" : "Novelty overlap"} | ${surveyWritingBridgeReady ? "The survey may look broad while still omitting an important cluster or benchmark family." : "The direction may look like a baseline refinement."} | ${surveyWritingBridgeReady ? "Keep the review protocol, included/excluded lists, and coverage summary visible in the story contract." : "Keep the story focused on graph-grounded routing and claim binding rather than a generic rewrite pipeline."} |
| ${surveyWritingBridgeReady ? "Weak synthesis" : "Weak empirical gain"} | ${surveyWritingBridgeReady ? "The manuscript may read like a bibliography dump instead of a real thematic synthesis." : "The method could sound cleaner than it measures."} | ${surveyWritingBridgeReady ? "Tie each major section to the theme-to-evidence map and explicit contrast axes." : "Tie each headline claim to the baseline-aware validation ladder in the claim map."} |
| Unsupported narrative scope | The story may promise stronger reasoning than the evidence supports. | Use the fallback narrative and keep unsupported claims out of the draft. |
`;

  const nextState = normalizePaperStoryState({
    ...serializePaperStoryState(current),
    ...patch,
    status:
      ((deps.isIdeationContractReady(ideationState) && Boolean(storylineSourceTrackId)) ||
        surveyWritingBridgeReady)
        ? "ready"
        : "pending",
    contract_version:
      pickNumber(patch, ["contractVersion", "contract_version"]) ??
      current.contractVersion ??
      1,
    claim_evidence_matrix_path:
      pickString(patch, ["claimEvidenceMatrixPath", "claim_evidence_matrix_path"]) ??
      current.claimEvidenceMatrixPath,
    track_verdicts_path:
      pickString(patch, ["trackVerdictsPath", "track_verdicts_path"]) ??
      current.trackVerdictsPath,
    unsupported_claims_path:
      pickString(patch, ["unsupportedClaimsPath", "unsupported_claims_path"]) ??
      current.unsupportedClaimsPath,
    claim_support_status: claimSupport.status,
    supported_claim_count: claimSupport.supportedCount,
    partial_claim_count: claimSupport.partialCount,
    unsupported_claim_count: claimSupport.unsupportedCount,
    storyline_source_track_id: storylineSourceTrackId,
    idea_to_claim_map_path:
      pickString(patch, ["ideaToClaimMapPath", "idea_to_claim_map_path"]) ??
      current.ideaToClaimMapPath,
    pending_reason:
      surveyWritingBridgeReady
        ? null
        : !deps.isIdeationContractReady(ideationState)
        ? "ideation_contract is not ready yet."
        : !storylineSourceTrackId
          ? "No active track is available for the paper story contract."
          : null,
    last_updated_at: new Date().toISOString(),
  });

  const generatedFiles: string[] = [];
  const fileSpecs: Array<[string | null, string]> = [
    [nextState.taskSummaryPath, taskSummaryDoc],
    [nextState.challengeStatementPath, challengeDoc],
    [nextState.insightSummaryPath, insightDoc],
    [nextState.contributionMapPath, contributionMap],
    [nextState.advantageMapPath, advantageMap],
    [nextState.storySpinePath, storySpine],
    [nextState.pipelineFigureSketchPath, pipelineFigureSketch],
    [nextState.moduleMotivationMapPath, moduleMotivationMap],
    [nextState.claimToExperimentMapPath, claimToExperimentMap],
    [nextState.fallbackNarrativePath, fallbackNarrative],
    [nextState.rejectionRiskTablePath, rejectionRiskTable],
  ];
  if (manifest.cross_domain_inspiration) {
    fileSpecs.push([
      crossDomainState.storylineBridgePath,
      `# Cross-Domain Story Bridge

${crossDomainStorySection || "- No cross-domain bridge configured."}

## Evidence Debt
- path: ${crossDomainState.evidenceDebtPath}
- missing domains: ${crossDomainState.missingDomains.join(", ") || "none"}
- satisfied domains: ${crossDomainState.satisfiedDomains.join(", ") || "none"}
`,
    ]);
  }

  for (const [targetPath, payload] of fileSpecs) {
    const resolved = resolveProjectArtifactPath(projectRoot, targetPath);
    if (!resolved) {
      continue;
    }
    await writeTextEnsured(resolved, payload);
    generatedFiles.push(path.relative(projectRoot, resolved));
  }
  const ideaToClaimMapResolvedPath = resolveProjectArtifactPath(
    projectRoot,
    nextState.ideaToClaimMapPath
  );
  if (ideaToClaimMapResolvedPath) {
    await writeJsonEnsured(ideaToClaimMapResolvedPath, ideaToClaimMap);
    generatedFiles.push(path.relative(projectRoot, ideaToClaimMapResolvedPath));
  }

  if (trackRegistry && Array.isArray(trackRegistry.tracks)) {
    let changed = false;
    for (const entry of trackRegistry.tracks) {
      const track = asRecord(entry);
      if (!track) {
        continue;
      }
      const trackId = pickString(track, ["track_id", "trackId"]);
      if (!trackId || trackId !== storylineSourceTrackId) {
        continue;
      }
      track.story_spine_path = nextState.storySpinePath;
      track.claim_to_experiment_map_path = nextState.claimToExperimentMapPath;
      track.fallback_narrative_path = nextState.fallbackNarrativePath;
      changed = true;
    }
    if (changed) {
      await writeJsonEnsured(path.join(projectRoot, "TRACK_REGISTRY.json"), trackRegistry);
    }
  }

  if (
    surveyWritingBridgeReady &&
    (currentWritingContract.paperMode !== "survey" ||
      !currentWritingContract.requiredSections.includes("scope_and_protocol"))
  ) {
    manifest.writing_contract = serializeWritingContractState(
      normalizeWritingContractState({
        ...serializeWritingContractState(currentWritingContract),
        paper_mode: "survey",
        template_required: false,
        template_status: "optional",
        template_copy_status: "pending",
        body_page_budget: 12,
        reference_page_budget: 4,
        body_word_target_min: 7000,
        body_word_target_max: 10000,
        max_core_ideas: 4,
        max_headline_claims: 6,
        kg_storyline_required: false,
        kg_storyline_status: "optional",
        proof_appendix_required: false,
        proof_appendix_status: "optional",
        required_sections: [
          "abstract",
          "introduction",
          "scope_and_protocol",
          "taxonomy",
          "evidence_synthesis",
          "benchmark_landscape",
          "open_problems",
          "conclusion",
        ],
        section_order: [
          "abstract",
          "introduction",
          "scope_and_protocol",
          "taxonomy",
          "evidence_synthesis",
          "benchmark_landscape",
          "open_problems",
          "conclusion",
        ],
        storyline_source: "survey_packet",
        pending_reason: null,
      })
    );
  }

  manifest.paper_story_state = serializePaperStoryState(nextState);
  await deps.saveManifest(projectRoot, manifest);
  const summary = await deps.getPaperStoryStateSummary({ projectRoot });
  return {
    state: nextState,
    validationErrors: summary.validationErrors,
    storySpineResolvedPath: summary.storySpineResolvedPath,
    storySpineExists: summary.storySpineExists,
    claimToExperimentMapResolvedPath: summary.claimToExperimentMapResolvedPath,
    claimToExperimentMapExists: summary.claimToExperimentMapExists,
    fallbackNarrativeResolvedPath: summary.fallbackNarrativeResolvedPath,
    fallbackNarrativeExists: summary.fallbackNarrativeExists,
    generatedFiles,
  };
}
