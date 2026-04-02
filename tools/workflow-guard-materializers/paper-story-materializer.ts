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
import { normalizeResearchProgramState } from "../workflow-guard-state/research-program";
import {
  normalizePaperStoryState,
  serializePaperStoryState,
} from "../workflow-guard-state/paper-story";
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
  const patch = asRecord(params.paperStoryMaterialization) ?? {};
  const researchProgram = normalizeResearchProgramState(manifest.research_program);
  const ideationSummary = await deps.getIdeationContractStateSummary({ projectRoot });
  const ideationState = ideationSummary.state;
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
    pickString(activeTracks[0], ["track_id", "trackId"]);
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
    claimEvidenceMatrixText,
    trackVerdictsText,
    unsupportedClaimsText,
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
    readTextIfExists(resolveProjectArtifactPath(projectRoot, current.claimEvidenceMatrixPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, current.trackVerdictsPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, current.unsupportedClaimsPath)),
  ]);

  const storylineBrief = asRecord(storylineBriefRecord);
  const graphPacket = asRecord(graphIdeationPacketRecord);
  const claimSupport = deps.summarizeClaimSupport({
    claimEvidenceMatrixRaw: claimEvidenceMatrixText,
    unsupportedClaimsRaw: unsupportedClaimsText,
  });
  const trackVerdictSignals = deps.collectTrackVerdictSignals(trackVerdictsText).slice(0, 4);
  const unsupportedClaimSignals = deps
    .collectUnsupportedClaimSignals(unsupportedClaimsText)
    .slice(0, 4);

  const taskSummary =
    researchProgram.goal ??
    ideationState.longTermGoal ??
    "Deliver a research narrative that stays grounded in explicit graph evidence.";
  const challengeStatement =
    researchProgram.problemStatement ??
    ideationState.problemScope ??
    "Current drafts lose fine-grained support as the narrative widens.";
  const insightSummary =
    (selectedTrack ? pickString(selectedTrack, ["hypothesis"]) : null) ??
    (selectedProgramTrack ? pickString(selectedProgramTrack, ["hypothesis"]) : null) ??
    (selectedTrack ? pickString(selectedTrack, ["novelty_basis"]) : null) ??
    (selectedProgramTrack ? pickString(selectedProgramTrack, ["novelty_basis"]) : null) ??
    (storylineBrief ? pickString(storylineBrief, ["thesis"]) : null) ??
    "Use graph-grounded routing to keep claims aligned with explicit support packets.";
  const contributionBullets = uniqueStrings([
    "Graph-grounded routing turns evidence links into a controllable story-planning signal.",
    "The method preserves support precision without abandoning clarity-oriented structure.",
    "The workflow keeps claim, experiment, and reviewer pressure aligned around one direction.",
    ...deps.collectMarkdownSignalLines(proposalText, {
      includeSectionsContaining: ["method", "contribution"],
    }),
    ...deps.collectMarkdownSignalLines(decompositionText, {
      includeSectionsContaining: ["sub-problems", "validation"],
    }),
  ]).slice(0, 4);
  const advantageBullets = uniqueStrings([
    `Improves the primary metric: ${researchProgram.primaryMetric ?? "primary_metric"}.`,
    `Stays comparable to the baseline: ${researchProgram.baselineReference ?? "named baseline"}.`,
    "Makes each claim easier to defend with explicit graph-backed support packets.",
    ...trackVerdictSignals,
    ...deps.collectMarkdownSignalLines(proposalText, {
      includeSectionsContaining: ["expected", "advantage"],
    }),
  ]).slice(0, 4);

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
`;

  const pipelineFigureSketch = `# Pipeline Figure Sketch

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
`;

  const moduleMotivationMap = `# Module Motivation Map

## Module 1: Graph-grounded support router
- Design: route each claim through graph evidence packets before surface drafting
- Motivation: reduce support attribution drift as the story widens
- Advantage: preserve support precision while keeping a readable narrative

## Module 2: Claim-to-experiment alignment layer
- Design: bind each research claim to a concrete validation step
- Motivation: prevent unsupported or over-broad claims from entering the draft
- Advantage: makes reviewer pressure explicit before writing
`;

  const claimToExperimentMap = `# Claim To Experiment Map

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

- If the main novelty claim feels too broad, narrow the story to "graph-grounded support routing" instead of a general writing overhaul.
- If empirical gains are modest, emphasize bounded support precision wins under unchanged baseline protocol.
- If reviewer pressure focuses on overlap with existing pipelines, pivot to the stricter claim-evidence alignment layer as the core contribution.
${deps.renderMarkdownBulletList(
  unsupportedClaimSignals.length > 0
    ? unsupportedClaimSignals.map(
        (line) => `If unresolved evidence persists, downgrade around: ${line}`
      )
    : ["If unresolved evidence persists, tighten scope before escalating any headline claim."]
)}
`;

  const rejectionRiskTable = `# Rejection Risk Table

| Risk | Why it could trigger rejection | Mitigation |
| --- | --- | --- |
| Novelty overlap | The direction may look like a baseline refinement. | Keep the story focused on graph-grounded routing and claim binding rather than a generic rewrite pipeline. |
| Weak empirical gain | The method could sound cleaner than it measures. | Tie each headline claim to the baseline-aware validation ladder in the claim map. |
| Unsupported narrative scope | The story may promise stronger reasoning than the evidence supports. | Use the fallback narrative and keep unsupported claims out of the draft. |
`;

  const nextState = normalizePaperStoryState({
    ...serializePaperStoryState(current),
    ...patch,
    status:
      deps.isIdeationContractReady(ideationState) && Boolean(storylineSourceTrackId)
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
    pending_reason:
      !deps.isIdeationContractReady(ideationState)
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

  for (const [targetPath, payload] of fileSpecs) {
    const resolved = resolveProjectArtifactPath(projectRoot, targetPath);
    if (!resolved) {
      continue;
    }
    await writeTextEnsured(resolved, payload);
    generatedFiles.push(path.relative(projectRoot, resolved));
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
