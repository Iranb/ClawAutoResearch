import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import { queueLiteratureDiscoveryRequisition } from "../literature-discovery/workflow-bridge";
import { readJsonIfExists, readTextIfExists, writeJsonEnsured, writeTextEnsured } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import { normalizePaperStoryState } from "../workflow-guard-state/paper-story";
import { normalizeResearchProgramState } from "../workflow-guard-state/research-program";
import { normalizeWritePackageState } from "../workflow-guard-state/execution-state";
import {
  DEFAULT_STORY_GAP_SEARCH_BATCH_MANIFEST_PATH,
  DEFAULT_STORY_GAP_SEARCH_PACKET_PATH,
  DEFAULT_INNOVATION_SYNTHESIS_GRAPH_PATH,
  DEFAULT_INNOVATION_SYNTHESIS_MEMO_PATH,
  DEFAULT_INTEGRATED_CONTRIBUTION_STATEMENT_PATH,
  normalizeInnovationSynthesisState,
  normalizeStoryGapSearchRequisitionState,
  serializeInnovationSynthesisState,
  serializeStoryGapSearchRequisitionState,
  type InnovationSynthesisPointState,
  type InnovationSynthesisState,
  type StoryGapSearchQuestionState,
  type StoryGapSearchRequisitionState,
} from "../workflow-guard-state/innovation-synthesis";
import { normalizeResultsStorylineState } from "../workflow-guard-state/results-storyline";
import { normalizeTitleAbstractIntroWorkbenchState } from "../workflow-guard-state/title-abstract-intro-workbench";
import { loadTrackInnovationEvidence } from "../workflow-guard-track-evidence.js";
import { normalizeWorkflowControlContract } from "../workflow-control-contract.js";

const STORY_GAP_SOURCE_DOMAIN_POOL = [
  "Computer Science",
  "Medicine",
  "Chemistry",
  "Biology",
  "Materials Science",
  "Physics",
  "Geology",
  "Psychology",
  "Art",
  "History",
  "Geography",
  "Sociology",
  "Business",
  "Political Science",
  "Economics",
  "Philosophy",
  "Mathematics",
  "Engineering",
  "Environmental Science",
  "Agricultural and Food Sciences",
  "Education",
  "Law",
  "Linguistics",
] as const;

const STORY_GAP_PRIORITY_DOMAINS = [
  "Psychology",
  "Biology",
  "Sociology",
  "Linguistics",
  "Physics",
  "Engineering",
  "Mathematics",
] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeStage(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")
    : null;
}

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

function slugify(value: string | null | undefined): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "unknown";
}

function buildFingerprint(value: unknown): string {
  return `sha1:${createHash("sha1").update(JSON.stringify(value)).digest("hex")}`;
}

function collectSignalLines(rawText: string | null | undefined, limit = 8): string[] {
  return String(rawText ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .map((line) => line.replace(/^[-*+]\s+/, ""))
    .slice(0, limit);
}

function firstMeaningfulLine(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const line = collectSignalLines(value, 1)[0]?.trim() ?? null;
    if (line) {
      return line;
    }
  }
  return null;
}

function hasAnyIntegrationLanguage(text: string): boolean {
  return /\b(enable|enables|because|therefore|together|jointly|compose|composes|stack|pipeline|stabilize|generalize|decompose|connect|bridge)\b/i.test(
    text
  );
}

function inferIntegrationPattern(text: string, innovationCount: number): string {
  const normalized = text.toLowerCase();
  if (/\b(stack|pipeline|layer|architecture)\b/.test(normalized)) {
    return "mechanism_stack";
  }
  if (/\b(enable|because|therefore|causal|then)\b/.test(normalized)) {
    return "causal_chain";
  }
  if (/\b(subproblem|decompose|break down|split)\b/.test(normalized)) {
    return "problem_decomposition";
  }
  if (/\b(system|module|component|together|jointly|combine|complement)\b/.test(normalized)) {
    return "complementary_modules";
  }
  if (innovationCount >= 3) {
    return "complementary_modules";
  }
  if (innovationCount >= 2) {
    return "evidence_triangle";
  }
  return "unknown";
}

function deriveRoleInStory(params: {
  integrationPattern: string;
  innovation: string;
  index: number;
}): string {
  const ordinal = params.index + 1;
  switch (params.integrationPattern) {
    case "causal_chain":
      return ordinal === 1
        ? `Innovation ${ordinal} establishes the prerequisite mechanism for the central thesis.`
        : ordinal === 2
          ? `Innovation ${ordinal} enables the main effect once the prerequisite is in place.`
          : `Innovation ${ordinal} stabilizes or generalizes the integrated mechanism.`;
    case "problem_decomposition":
      return `Innovation ${ordinal} solves one necessary subproblem in the central thesis decomposition.`;
    case "mechanism_stack":
      return ordinal === 1
        ? `Innovation ${ordinal} provides the base mechanism layer.`
        : ordinal === 2
          ? `Innovation ${ordinal} composes the middle mechanism layer.`
          : `Innovation ${ordinal} provides the top-level behavior or robustness layer.`;
    case "evidence_triangle":
      return ordinal === 1
        ? `Innovation ${ordinal} supports effectiveness.`
        : ordinal === 2
          ? `Innovation ${ordinal} supports mechanism.`
          : `Innovation ${ordinal} supports robustness or boundary conditions.`;
    default:
      return `Innovation ${ordinal} contributes one necessary part of the unified story.`;
  }
}

function inferFailureIfRemoved(index: number): string {
  return index === 0
    ? "The manuscript loses the central enabling mechanism and the thesis collapses into a weaker baseline-relative delta."
    : index === 1
      ? "The manuscript loses the main effect path and the contribution becomes an incomplete partial mechanism."
      : "The manuscript loses the stabilizing/generalizing evidence and the thesis becomes brittle or overclaimed.";
}

async function listTrackExperimentManifests(params: {
  projectRoot: string;
  trackId: string | null;
}): Promise<Array<Record<string, unknown>>> {
  if (!params.trackId) {
    return [];
  }
  const trackRoot = path.join(
    params.projectRoot,
    "coder",
    "experiments",
    params.trackId
  );
  let bundleEntries: Dirent[] = [];
  try {
    bundleEntries = await fs.readdir(trackRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const manifests: Array<Record<string, unknown>> = [];
  for (const entry of bundleEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const manifestPath = path.join(trackRoot, entry.name, "EXPERIMENT_MANIFEST.json");
    const record = await readJsonIfExists<Record<string, unknown>>(manifestPath);
    if (record) {
      manifests.push(record);
    }
  }
  return manifests;
}

function collectInnovationLabels(params: {
  researchTrack: Record<string, unknown> | null;
  experimentManifests: Array<Record<string, unknown>>;
}): string[] {
  const labels: string[] = [];
  const noveltyBasis =
    params.researchTrack?.novelty_basis ??
    params.researchTrack?.noveltyBasis ??
    params.researchTrack?.hypothesis;
  if (typeof noveltyBasis === "string" && noveltyBasis.trim()) {
    labels.push(noveltyBasis.trim());
  }
  for (const manifest of params.experimentManifests) {
    const points = Array.isArray(manifest.innovation_points)
      ? manifest.innovation_points
      : Array.isArray(manifest.innovationPoints)
        ? manifest.innovationPoints
        : [];
    for (const point of points) {
      if (typeof point === "string" && point.trim()) {
        labels.push(point.trim());
      }
    }
  }
  return uniqueStrings(labels);
}

function inferFallbackInnovationLabels(params: {
  centralThesis: string | null;
  integrationText: string;
  researchGoal: string | null;
  problemStatement: string | null;
  experimentManifests: Array<Record<string, unknown>>;
}): string[] {
  const corpus = [
    params.centralThesis,
    params.integrationText,
    params.researchGoal,
    params.problemStatement,
    ...params.experimentManifests.map((manifest) => JSON.stringify(manifest)),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  if (/\bgcd\b|generalized category discovery/.test(corpus)) {
    if (/fixmatch|weak.?strong|consistency|pseudo.?label/.test(corpus)) {
      return [
        "FixMatch-style consistency filtering with bounded class-balance debiasing for generalized category discovery",
      ];
    }
    return [
      "Bounded generalized category discovery evidence contract connecting known and novel class behavior",
    ];
  }
  if (params.centralThesis) {
    return [params.centralThesis];
  }
  return [];
}

function inferSupportStatus(params: {
  label: string;
  claimEvidenceMatrixText: string | null;
  unsupportedClaimsText: string | null;
  trackEvidenceSupported: boolean;
}): string {
  const labelPattern = new RegExp(
    params.label
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+"),
    "i"
  );
  if (labelPattern.test(params.unsupportedClaimsText ?? "")) {
    return "contradicted";
  }
  if (labelPattern.test(params.claimEvidenceMatrixText ?? "")) {
    return "supported";
  }
  return params.trackEvidenceSupported ? "partial" : "missing";
}

function selectTrackId(manifest: Record<string, unknown>): string | null {
  const writePackage = normalizeWritePackageState(manifest.write_package);
  const researchProgram = normalizeResearchProgramState(manifest.research_program);
  return (
    writePackage.winningTrackIds[0] ??
    researchProgram.planSelection.selectedTrackId ??
    researchProgram.tracks.find((track) => track.status === "active")?.trackId ??
    null
  );
}

function buildIntegratedContributionStatement(params: {
  centralThesis: string | null;
  innovationPoints: InnovationSynthesisPointState[];
  integrationPattern: string;
}): string {
  const pointLabels = params.innovationPoints
    .map((entry) => entry.claim ?? entry.id)
    .filter(Boolean)
    .join("; ");
  return [
    params.centralThesis ?? "The central thesis still needs to be crystallized.",
    pointLabels
      ? `This thesis is carried by a ${params.integrationPattern ?? "multi-part"} integration of: ${pointLabels}.`
      : "The integrated contribution statement still lacks concrete innovation roles.",
  ].join(" ");
}

function buildSearchQuestion(params: {
  index: number;
  centralThesis: string | null;
  point: InnovationSynthesisPointState;
  workflowLine: "experiment" | "survey";
}): StoryGapSearchQuestionState {
  const domainSpecificQuestion =
    params.point.claim ??
    params.centralThesis ??
    "How should the unresolved innovation integration gap be closed?";
  const domainAgnosticQuestion =
    params.workflowLine === "survey"
      ? `How can multiple evidence-backed themes be unified into one coherent comparative story without overclaiming consensus?`
      : `How can multiple validated mechanisms be integrated into one coherent story when the bridge evidence between them is still thin?`;
  return {
    questionId: `story-gap-${params.index + 1}`,
    domainSpecificQuestion,
    domainAgnosticQuestion,
    coverageStatus: "unexplored",
    preferredSourceDomains: ["Psychology", "Biology"],
    candidateSourceDomains: [...STORY_GAP_SOURCE_DOMAIN_POOL],
    excludedAdjacentDomains:
      params.workflowLine === "experiment"
        ? ["Computer Science"]
        : [],
    validationSampleSizeDefault: 20,
    pruneIfIrrelevantRatioExceedsDefault: 0.5,
    minimumRelevantHits: 5,
    nicheTopicOverrideAllowed: true,
    minimumSources: 2,
  };
}

function buildStoryGapSearchPacket(params: {
  centralThesis: string | null;
  synthesisFingerprint: string;
  targetQuestions: StoryGapSearchQuestionState[];
  originStage: string | null;
  executionMode: string;
  triggerReason: string;
}): Record<string, unknown> {
  return {
    schema_version: 1,
    discovery_id: `innovation-synthesis-${slugify(params.synthesisFingerprint)}`,
    discovery_reason: "innovation_synthesis_gap",
    trigger_kind: "story_gap_literature_discovery",
    trigger_reason: params.triggerReason,
    central_thesis: params.centralThesis,
    linked_synthesis_fingerprint: params.synthesisFingerprint,
    execution_mode: params.executionMode,
    target_question_ids: params.targetQuestions.map((entry) => entry.questionId),
    target_questions: params.targetQuestions.map((entry) => ({
      question_id: entry.questionId,
      domain_specific_question: entry.domainSpecificQuestion,
      domain_agnostic_question: entry.domainAgnosticQuestion,
      coverage_status: entry.coverageStatus,
      preferred_source_domains: entry.preferredSourceDomains,
      candidate_source_domains: entry.candidateSourceDomains,
      excluded_adjacent_domains: entry.excludedAdjacentDomains,
      validation_sample_size_default: entry.validationSampleSizeDefault,
      prune_if_irrelevant_ratio_exceeds_default:
        entry.pruneIfIrrelevantRatioExceedsDefault,
      minimum_relevant_hits: entry.minimumRelevantHits,
      niche_topic_override_allowed: entry.nicheTopicOverrideAllowed,
      minimum_sources: entry.minimumSources,
    })),
    target_domains: uniqueStrings(
      params.targetQuestions.flatMap((entry) => entry.preferredSourceDomains)
    ),
    candidate_queries: params.targetQuestions.flatMap((entry) =>
      entry.preferredSourceDomains.slice(0, 2).map((domain) => ({
        domain,
        rationale:
          `Search ${domain} for bridge evidence that can unify the manuscript's validated innovation points into one coherent story.`,
        query: `${entry.domainAgnosticQuestion ?? entry.domainSpecificQuestion ?? params.centralThesis ?? "innovation integration"} ${domain} transferable mechanism`,
      }))
    ),
    required_stage_reentry:
      params.executionMode === "reuse_literature_discovery"
        ? ["graph_build", "analyze", "write"]
        : ["analyze", "write"],
    next_action_suggestion:
      params.executionMode === "reuse_literature_discovery"
        ? "Queue bounded literature discovery, refresh graph coverage, update claim/evidence matrix, and rerun innovation synthesis."
        : "Collect bounded supplemental source evidence outside graph import, update claim/evidence matrix, and rerun innovation synthesis.",
    origin_stage: params.originStage,
  };
}

function buildMemoMarkdown(params: {
  state: InnovationSynthesisState;
}): string {
  const pointRows =
    params.state.innovationPoints.length > 0
      ? params.state.innovationPoints
          .map(
            (entry) =>
              `| ${entry.id} | ${entry.claim ?? "unset"} | ${entry.roleInStory ?? "unset"} | ${entry.evidenceIds.join(", ") || "unset"} | ${entry.failureIfRemoved ?? "unset"} | ${entry.supportStatus} |`
          )
          .join("\n")
      : "| none | unset | unset | unset | unset | missing |";
  return [
    "# Innovation Synthesis Memo",
    "",
    "## One Central Thesis",
    params.state.centralThesis ?? "Thesis still needs to be crystallized.",
    "",
    "## Integration Pattern",
    params.state.integrationPattern ?? "unknown",
    "",
    "## Unified Mechanism",
    params.state.unifiedMechanism ?? "Unified mechanism still needs to be articulated.",
    "",
    "## Figure 1 Story",
    params.state.figure1StoryRole ?? "Figure 1 story still needs to be articulated.",
    "",
    "## Results Order Rationale",
    params.state.resultsOrderRationale ?? "Results ordering rationale still needs to be articulated.",
    "",
    "## Innovation Roles",
    "| Innovation | Claim | Story role | Evidence | What breaks without it | Support |",
    "| --- | --- | --- | --- | --- | --- |",
    pointRows,
    "",
    "## Search Gaps",
    params.state.searchGapCount > 0
      ? `Open integration/search gaps: ${params.state.searchGapCount}`
      : "No additional search gaps detected.",
  ].join("\n");
}

function buildContributionStatementMarkdown(statement: string): string {
  return `# Integrated Contribution Statement\n\n${statement.trim()}\n`;
}

function buildGraphJson(params: {
  state: InnovationSynthesisState;
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    centralThesis: params.state.centralThesis,
    integrationPattern: params.state.integrationPattern,
    unifiedMechanism: params.state.unifiedMechanism,
    figure1StoryRole: params.state.figure1StoryRole,
    resultsOrderRationale: params.state.resultsOrderRationale,
    nodes: params.state.innovationPoints.map((entry) => ({
      id: entry.id,
      label: entry.claim ?? entry.id,
      roleInStory: entry.roleInStory,
      supportStatus: entry.supportStatus,
      evidenceIds: entry.evidenceIds,
      requiredForThesis: entry.requiredForThesis,
      failureIfRemoved: entry.failureIfRemoved,
    })),
  };
}

export async function materializeInnovationSynthesis(params: {
  projectRoot: string;
  stage?: string | null;
}): Promise<{
  state: InnovationSynthesisState;
  storyGapSearch: StoryGapSearchRequisitionState | null;
  generatedFiles: string[];
}> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const current = normalizeInnovationSynthesisState(manifest.innovation_synthesis_state);
  const currentSearch = normalizeStoryGapSearchRequisitionState(
    manifest.story_gap_search_requisition
  );
  const workflowControl = normalizeWorkflowControlContract(manifest.workflow_control);
  const stage =
    normalizeStage(
      params.stage ?? workflowControl?.stage ?? manifest.current_stage ?? manifest.currentStage
    ) ?? null;
  const paperStory = normalizePaperStoryState(manifest.paper_story_state);
  const researchProgram = normalizeResearchProgramState(manifest.research_program);
  const writePackage = normalizeWritePackageState(manifest.write_package);
  const resultsStoryline = normalizeResultsStorylineState(manifest.results_storyline);
  const titleWorkbench = normalizeTitleAbstractIntroWorkbenchState(
    manifest.title_abstract_intro_workbench
  );
  const trackId = selectTrackId(manifest);
  const researchTrack = researchProgram.tracks.find((entry) => entry.trackId === trackId)
    ? {
        track_id: researchProgram.tracks.find((entry) => entry.trackId === trackId)!.trackId,
        hypothesis: researchProgram.tracks.find((entry) => entry.trackId === trackId)!.hypothesis,
        novelty_basis:
          researchProgram.tracks.find((entry) => entry.trackId === trackId)!.noveltyBasis,
      }
    : null;

  const [
    experimentManifests,
    storySpineText,
    challengeText,
    contributionBridgeText,
    contributionMapText,
    claimMapText,
    claimEvidenceMatrixText,
    unsupportedClaimsText,
    figureTableAlignmentText,
    resultsOrderText,
  ] = await Promise.all([
    listTrackExperimentManifests({
      projectRoot,
      trackId,
    }),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, paperStory.storySpinePath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, paperStory.challengeStatementPath)),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, paperStory.contributionToStoryBridgePath)
    ),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, paperStory.contributionMapPath)),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, paperStory.claimToExperimentMapPath)
    ),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, paperStory.claimEvidenceMatrixPath)
    ),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, paperStory.unsupportedClaimsPath)
    ),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, "academic_writer/FIGURE_TABLE_ALIGNMENT.md")
    ),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, "academic_writer/RESULTS_QUESTION_ORDER.md")
    ),
  ]);

  const trackEvidence = trackId
    ? await loadTrackInnovationEvidence({
        projectRoot,
        track: {
          track_id: trackId,
          reasoning_packet_dir:
            researchProgram.tracks.find((entry) => entry.trackId === trackId)?.trackId != null
              ? `researcher/reasoning/${trackId}`
              : null,
        },
      }).catch(() => null)
    : null;

  const baseInnovationLabels = collectInnovationLabels({
    researchTrack,
    experimentManifests,
  });
  const centralThesis =
    firstMeaningfulLine(
      storySpineText,
      contributionBridgeText,
      contributionMapText,
      challengeText,
      researchProgram.goal,
      researchProgram.problemStatement,
      researchTrack?.hypothesis,
      researchTrack?.novelty_basis
    ) ?? current.centralThesis;

  const integrationText = [
    storySpineText,
    contributionBridgeText,
    contributionMapText,
    claimMapText,
    figureTableAlignmentText,
    resultsOrderText,
  ]
    .filter(Boolean)
    .join("\n");
  const innovationLabels = uniqueStrings([
    ...baseInnovationLabels,
    ...(baseInnovationLabels.length > 0
      ? []
      : inferFallbackInnovationLabels({
          centralThesis,
          integrationText,
          researchGoal: researchProgram.goal,
          problemStatement: researchProgram.problemStatement,
          experimentManifests,
        })),
  ]);
  const integrationPattern = inferIntegrationPattern(
    integrationText,
    innovationLabels.length
  );
  const pointStates: InnovationSynthesisPointState[] = innovationLabels.map((label, index) => ({
    id: slugify(label),
    claim: label,
    roleInStory: deriveRoleInStory({
      integrationPattern,
      innovation: label,
      index,
    }),
    evidenceIds: uniqueStrings([
      ...((claimMapText ?? "").match(/claim-[a-z0-9-]+/gi) ?? []),
      `innovation:${slugify(label)}`,
    ]),
    requiredForThesis: true,
    failureIfRemoved: inferFailureIfRemoved(index),
    supportStatus: inferSupportStatus({
      label,
      claimEvidenceMatrixText,
      unsupportedClaimsText,
      trackEvidenceSupported:
        trackEvidence?.hasStoryFacingTrackGraphSupport === true,
    }),
  }));

  const multiplePoints = pointStates.length >= 2;
  const hasExperimentBackedFallback =
    baseInnovationLabels.length === 0 &&
    innovationLabels.length > 0 &&
    experimentManifests.length > 0;
  const weakIntegration =
    !hasAnyIntegrationLanguage(integrationText) && !hasExperimentBackedFallback;
  const bridgeArtifactsThin =
    !figureTableAlignmentText ||
    !contributionBridgeText ||
    trackEvidence?.hasStoryFacingTrackGraphSupport === false;
  const gapReason =
    multiplePoints && weakIntegration && bridgeArtifactsThin
      ? "missing_bridge_evidence"
      : resultsStoryline.status !== "missing" && resultsStoryline.status !== "ready"
        ? "results_order_unjustified"
        : titleWorkbench.status !== "missing" && titleWorkbench.status !== "ready"
          ? "title_abstract_intro_drift"
          : weakIntegration
            ? "weak_integration"
            : null;
  const needsSearch =
    gapReason === "missing_bridge_evidence" || gapReason === "weak_integration";
  const synthesisFingerprint = buildFingerprint({
    trackId,
    centralThesis,
    integrationPattern,
    innovationPoints: pointStates.map((entry) => ({
      id: entry.id,
      supportStatus: entry.supportStatus,
      evidenceIds: entry.evidenceIds,
    })),
  });
  const sameFingerprint =
    currentSearch.requisitionFingerprint === synthesisFingerprint;
  let sameGapCyclesUsed = sameFingerprint ? currentSearch.sameGapCyclesUsed : 0;
  const sameGapCycleBudget = Math.max(currentSearch.sameGapCycleBudget, 2);
  let storyGapSearch: StoryGapSearchRequisitionState | null = null;
  const generatedFiles: string[] = [];

  if (needsSearch) {
    const targetQuestions = pointStates
      .filter((entry) => entry.supportStatus !== "supported")
      .map((entry, index) =>
        buildSearchQuestion({
          index,
          centralThesis,
          point: entry,
          workflowLine:
            manifest.workflow_line === "survey" || manifest.paper_type === "survey"
              ? "survey"
              : "experiment",
        })
      );
    if (targetQuestions.length === 0 && pointStates.length > 0) {
      targetQuestions.push(
        buildSearchQuestion({
          index: 0,
          centralThesis,
          point: pointStates[0],
          workflowLine:
            manifest.workflow_line === "survey" || manifest.paper_type === "survey"
              ? "survey"
              : "experiment",
        })
      );
    }
    const packetPath =
      currentSearch.packetPath ?? DEFAULT_STORY_GAP_SEARCH_PACKET_PATH;
    const packetResolvedPath = resolveProjectArtifactPath(projectRoot, packetPath);
    const packet = buildStoryGapSearchPacket({
      centralThesis,
      synthesisFingerprint,
      targetQuestions,
      originStage: stage,
      executionMode: "reuse_literature_discovery",
      triggerReason: gapReason ?? "innovation_synthesis_gap",
    });
    const requiredStageReentry = Array.isArray(packet.required_stage_reentry)
      ? uniqueStrings(packet.required_stage_reentry as Array<string | null | undefined>)
      : [];
    if (packetResolvedPath) {
      await writeJsonEnsured(packetResolvedPath, packet);
      generatedFiles.push(packetPath);
    }
    const sameGapAlreadySearched =
      sameFingerprint &&
      ["completed", "failed", "saturated"].includes(currentSearch.status);
    if (sameGapAlreadySearched) {
      sameGapCyclesUsed += 1;
    }
    if (sameFingerprint && sameGapCyclesUsed >= sameGapCycleBudget) {
      storyGapSearch = normalizeStoryGapSearchRequisitionState({
        ...serializeStoryGapSearchRequisitionState(currentSearch),
        status: "saturated",
        origin_stage: stage,
        trigger_reason: gapReason ?? "innovation_synthesis_gap",
        execution_mode: "reuse_literature_discovery",
        requisition_fingerprint: synthesisFingerprint,
        linked_synthesis_fingerprint: synthesisFingerprint,
        target_questions: targetQuestions,
        required_stage_reentry: requiredStageReentry,
        packet_path: packetPath,
        saturation_reason:
          "The same innovation synthesis gap has already exhausted its search cycle budget.",
        same_gap_cycle_budget: sameGapCycleBudget,
        same_gap_cycles_used: sameGapCyclesUsed,
        last_updated_at: nowIso(),
      });
    } else if (sameGapAlreadySearched) {
      storyGapSearch = normalizeStoryGapSearchRequisitionState({
        ...serializeStoryGapSearchRequisitionState(currentSearch),
        status: currentSearch.status === "failed" ? "failed" : "completed",
        origin_stage: stage,
        trigger_reason: gapReason ?? "innovation_synthesis_gap",
        execution_mode: "reuse_literature_discovery",
        requisition_fingerprint: synthesisFingerprint,
        linked_synthesis_fingerprint: synthesisFingerprint,
        target_questions: targetQuestions,
        required_stage_reentry: requiredStageReentry,
        packet_path: packetPath,
        same_gap_cycle_budget: sameGapCycleBudget,
        same_gap_cycles_used: sameGapCyclesUsed,
        last_updated_at: nowIso(),
      });
    } else {
      const queued = await queueLiteratureDiscoveryRequisition({
        projectRoot,
        packetPath,
        triggerKind: "story_gap_literature_discovery",
        originStage: stage,
        summary:
          "Supplemental literature discovery for post-draft innovation synthesis gaps.",
        requestIdPrefix: `story-gap-${slugify(centralThesis ?? trackId ?? "integration")}`,
      });
      if (queued.created || queued.request) {
        sameGapCyclesUsed = sameFingerprint
          ? Math.max(sameGapCyclesUsed, 1)
          : 1;
      }
      storyGapSearch = normalizeStoryGapSearchRequisitionState({
        ...serializeStoryGapSearchRequisitionState(currentSearch),
        status:
          queued.created === true
            ? "queued"
            : queued.request?.status === "running"
              ? "running"
              : queued.request?.status === "completed"
                ? "completed"
                : queued.request?.status === "failed"
                  ? "failed"
                  : "queued",
        origin_stage: stage,
        trigger_reason: gapReason ?? "innovation_synthesis_gap",
        execution_mode: "reuse_literature_discovery",
        maps_to_literature_discovery_request_id:
          queued.request?.requestId ?? currentSearch.mapsToLiteratureDiscoveryRequestId,
        requisition_fingerprint: synthesisFingerprint,
        linked_synthesis_fingerprint: synthesisFingerprint,
        same_gap_cycle_budget: sameGapCycleBudget,
        same_gap_cycles_used: sameGapCyclesUsed,
        target_questions: targetQuestions,
        required_stage_reentry: requiredStageReentry,
        packet_path: packetPath,
        batch_manifest_path:
          queued.batchManifestPath ?? currentSearch.batchManifestPath,
        saturation_reason: null,
        last_updated_at: nowIso(),
      });
    }
  } else if (currentSearch.status !== "missing") {
    storyGapSearch = normalizeStoryGapSearchRequisitionState({
      ...serializeStoryGapSearchRequisitionState(currentSearch),
      status: "completed",
      linked_synthesis_fingerprint: synthesisFingerprint,
      last_updated_at: nowIso(),
    });
  }

  const status = needsSearch
    ? storyGapSearch?.status === "saturated"
      ? "needs_revision"
      : "needs_search"
    : gapReason === "results_order_unjustified" ||
        gapReason === "title_abstract_intro_drift"
      ? "needs_revision"
      : centralThesis && pointStates.length > 0
        ? "ready"
        : pointStates.length > 0
          ? "draft"
          : "needs_revision";

  const state: InnovationSynthesisState = normalizeInnovationSynthesisState({
    ...serializeInnovationSynthesisState(current),
    status,
    central_thesis: centralThesis,
    integration_pattern: integrationPattern,
    innovation_points: pointStates,
    unified_mechanism:
      buildIntegratedContributionStatement({
        centralThesis,
        innovationPoints: pointStates,
        integrationPattern,
      }),
    figure_1_story_role:
      firstMeaningfulLine(figureTableAlignmentText, "Figure 1 should teach the integrated mechanism.") ??
      "Figure 1 should teach the integrated mechanism.",
    results_order_rationale:
      firstMeaningfulLine(resultsOrderText, "Results should prove the integrated mechanism in reviewer-question order.") ??
      "Results should prove the integrated mechanism in reviewer-question order.",
    search_gap_count: needsSearch ? Math.max(1, pointStates.filter((entry) => entry.supportStatus !== "supported").length) : 0,
    search_requisition_path: storyGapSearch?.packetPath ?? current.searchRequisitionPath,
    synthesis_fingerprint: synthesisFingerprint,
    pending_reason:
      needsSearch
        ? "Graph / literature evidence is still too thin to integrate the validated innovation points into one unified story."
        : gapReason === "results_order_unjustified"
          ? "The manuscript still needs a reviewer-question Results storyline before the innovation points can read as one argument."
          : gapReason === "title_abstract_intro_drift"
            ? "The title / abstract / introduction alignment layer still drifts from the integrated contribution wording."
        : status === "ready"
          ? null
          : "The manuscript still needs a clearer integrated contribution statement.",
    last_updated_at: nowIso(),
  });

  const memoPath = resolveProjectArtifactPath(projectRoot, state.synthesisMemoPath);
  const graphPath = resolveProjectArtifactPath(projectRoot, state.storyDependencyGraphPath);
  const statementPath = resolveProjectArtifactPath(
    projectRoot,
    state.integratedContributionStatementPath
  );
  if (memoPath) {
    await writeTextEnsured(memoPath, `${buildMemoMarkdown({ state })}\n`);
    generatedFiles.push(state.synthesisMemoPath ?? DEFAULT_INNOVATION_SYNTHESIS_MEMO_PATH);
  }
  if (graphPath) {
    await writeJsonEnsured(graphPath, buildGraphJson({ state }));
    generatedFiles.push(
      state.storyDependencyGraphPath ?? DEFAULT_INNOVATION_SYNTHESIS_GRAPH_PATH
    );
  }
  if (statementPath) {
    await writeTextEnsured(
      statementPath,
      buildContributionStatementMarkdown(state.unifiedMechanism ?? "")
    );
    generatedFiles.push(
      state.integratedContributionStatementPath ??
        DEFAULT_INTEGRATED_CONTRIBUTION_STATEMENT_PATH
    );
  }

  const nextManifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? manifest;
  nextManifest.innovation_synthesis_state = serializeInnovationSynthesisState(state);
  if (storyGapSearch) {
    nextManifest.story_gap_search_requisition =
      serializeStoryGapSearchRequisitionState(storyGapSearch);
  }
  await writeJsonEnsured(manifestPath, nextManifest);

  return {
    state,
    storyGapSearch,
    generatedFiles: uniqueStrings(generatedFiles),
  };
}
