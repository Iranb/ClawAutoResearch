import * as path from "node:path";
import {
  asRecord,
  asString,
  asStringArray,
  normalizeStage,
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
  normalizeIdeationContractState,
  normalizeIdeationGraphBasisPaths,
  normalizeIdeationGraphIndicesState,
  serializeIdeationContractState,
  serializeIdeationGraphBasisPaths,
  serializeIdeationGraphIndicesState,
} from "../workflow-guard-state/ideation-contract";
import type { IdeationContractState } from "../workflow-guard.js";

type BrainstormOption = {
  optionId: string;
  title?: string | null;
  summary?: string | null;
  score?: number | null;
  status?: string | null;
};

type BrainstormRound = {
  options: BrainstormOption[];
};

type BrainstormSummary = {
  state: {
    trackId: string | null;
    questionPacketPath: string | null;
    selectedOptionTitle: string | null;
    selectedOptionId: string | null;
    basisStage: string | null;
    workingMemoryPath: string | null;
    reflectionChainPath: string | null;
    rounds: BrainstormRound[];
  };
  chainBundleReady: boolean;
};

type IdeationSummary = {
  validationErrors: string[];
  graphIdeationPacketResolvedPath: string | null;
  graphIdeationPacketExists: boolean;
  researchProposalResolvedPath: string | null;
  researchProposalExists: boolean;
};

type IdeationMaterializerDeps = {
  readManifestEnsured: (projectRoot: string) => Promise<Record<string, unknown>>;
  saveManifest: (
    projectRoot: string,
    manifest: Record<string, unknown>
  ) => Promise<void>;
  inferProjectId: (
    projectRoot: string | null,
    manifest: Record<string, unknown> | null
  ) => string | null;
  getBrainstormCycleStateSummary: (params: {
    projectRoot: string;
  }) => Promise<BrainstormSummary>;
  getIdeationContractStateSummary: (params: {
    projectRoot: string;
  }) => Promise<IdeationSummary>;
  getActiveTracks: (
    trackRegistry: Record<string, unknown> | null
  ) => Array<Record<string, unknown>>;
  resolveResearchProgramTrack: (
    manifest: Record<string, unknown> | null,
    trackId: string | null
  ) => Record<string, unknown> | null;
  collectMarkdownSignalLines: (
    rawText: string | null,
    options?: { includeSectionsContaining?: string[] }
  ) => string[];
  quoteMarkdownText: (value: string | null | undefined) => string;
  renderMarkdownBulletList: (items: string[]) => string;
  slugifyIdeationLabel: (value: string | null | undefined) => string;
  averageScores: (values: number[]) => number;
  trackHasGraphBackedInnovationEvidence: (track: Record<string, unknown>) => boolean;
  mergeJsonArtifact: (
    resolvedPath: string | null,
    merge: (current: Record<string, unknown>) => Record<string, unknown>
  ) => Promise<void>;
  normalizeInnovationReflectionState: (value: unknown) => Record<string, unknown>;
  serializeInnovationReflectionState: (
    value: Record<string, unknown>
  ) => Record<string, unknown>;
};

function clampUnitScore(value: number | null | undefined, fallback: number): number {
  const candidate = Number.isFinite(value ?? NaN) ? Number(value) : fallback;
  return Math.max(0, Math.min(1, candidate));
}

export async function materializeIdeationContractImpl(
  params: {
    projectRoot: string;
    ideationMaterialization?: Record<string, unknown>;
    trigger?: string | null;
    agentId?: string | null;
  },
  deps: IdeationMaterializerDeps
): Promise<{
  state: IdeationContractState;
  validationErrors: string[];
  graphIdeationPacketResolvedPath: string | null;
  graphIdeationPacketExists: boolean;
  researchProposalResolvedPath: string | null;
  researchProposalExists: boolean;
  generatedFiles: string[];
}> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifest = await deps.readManifestEnsured(projectRoot);
  const current = normalizeIdeationContractState(manifest.ideation_contract);
  const patch = asRecord(params.ideationMaterialization) ?? {};
  const projectId = deps.inferProjectId(projectRoot, manifest);
  const brainstormSummary = await deps.getBrainstormCycleStateSummary({ projectRoot });
  const brainstormState = brainstormSummary.state;
  const trackRegistry =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "TRACK_REGISTRY.json")
    )) ?? null;
  const activeTracks = deps.getActiveTracks(trackRegistry);
  const selectedTrackId =
    pickString(patch, ["selectedTrackId", "selected_track_id", "trackId", "track_id"]) ??
    current.selectedTrackId ??
    brainstormState.trackId ??
    pickString(activeTracks[0], ["track_id", "trackId"]);
  const selectedTrack =
    activeTracks.find(
      (track) => pickString(track, ["track_id", "trackId"]) === selectedTrackId
    ) ?? null;
  const selectedProgramTrack = deps.resolveResearchProgramTrack(manifest, selectedTrackId);
  const graphBasisPaths = normalizeIdeationGraphBasisPaths(
    asRecord(patch.graphBasisPaths ?? patch.graph_basis_paths) ??
      serializeIdeationGraphBasisPaths(current.graphBasisPaths)
  );

  const [
    frontierReportText,
    anchorIndexText,
    limitationFrontierText,
    transferFrontierText,
    logicChainText,
    evidenceChainText,
    questionPacketText,
    storylineBriefRecord,
    topicSummaryRecord,
  ] = await Promise.all([
    readTextIfExists(resolveProjectArtifactPath(projectRoot, graphBasisPaths.frontierReportPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, graphBasisPaths.anchorIndexPath)),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, graphBasisPaths.limitationFrontierPath)
    ),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, graphBasisPaths.transferFrontierPath)
    ),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, graphBasisPaths.logicChainPath)),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, graphBasisPaths.evidenceChainPath)),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, brainstormState.questionPacketPath)
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, graphBasisPaths.storylineBriefPath) ?? ""
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, graphBasisPaths.topicSummaryPath) ?? ""
    ),
  ]);

  const challengeClusters = uniqueStrings([
    ...deps.collectMarkdownSignalLines(frontierReportText, {
      includeSectionsContaining: ["challenge"],
    }),
    ...deps.collectMarkdownSignalLines(limitationFrontierText),
  ]).slice(0, 6);

  const insightClusters = uniqueStrings([
    ...deps.collectMarkdownSignalLines(frontierReportText, {
      includeSectionsContaining: ["insight"],
    }),
    ...(brainstormState.selectedOptionTitle ? [brainstormState.selectedOptionTitle] : []),
    ...(asString((storylineBriefRecord as Record<string, unknown> | null)?.thesis)
      ? [asString((storylineBriefRecord as Record<string, unknown>).thesis)!]
      : []),
  ]).slice(0, 6);

  const transferBridges = uniqueStrings([
    ...deps.collectMarkdownSignalLines(transferFrontierText),
    ...(asString((storylineBriefRecord as Record<string, unknown> | null)?.arc)
      ? [asString((storylineBriefRecord as Record<string, unknown>).arc)!]
      : []),
  ]).slice(0, 6);

  const occupiedSolutionZones = uniqueStrings([
    ...(selectedProgramTrack
      ? asStringArray(
          (selectedProgramTrack.required_baselines ?? selectedProgramTrack.requiredBaselines) as
            | unknown[]
            | string[]
        ).map((entry) => `occupied:${entry}`)
      : []),
  ]);

  const optionCandidates = brainstormState.rounds.flatMap((round) =>
    round.options.map((option) => {
      const novelty = clampUnitScore(option.score, 0.72);
      const feasibility = clampUnitScore(option.score, 0.68);
      const relevance = clampUnitScore(
        selectedTrack && deps.trackHasGraphBackedInnovationEvidence(selectedTrack) ? 0.86 : 0.72,
        0.72
      );
      const clarity = clampUnitScore(
        asString((storylineBriefRecord as Record<string, unknown> | null)?.thesis) ? 0.84 : 0.7,
        0.7
      );
      return {
        direction_id: option.optionId,
        track_id: selectedTrackId,
        title: option.title ?? `Direction ${option.optionId}`,
        summary:
          option.summary ??
          (selectedTrack ? pickString(selectedTrack, ["novelty_basis"]) : null) ??
          (selectedProgramTrack ? pickString(selectedProgramTrack, ["novelty_basis"]) : null) ??
          "Graph-grounded direction derived from brainstorm evidence.",
        novelty,
        feasibility,
        relevance,
        clarity,
        composite_score: deps.averageScores([novelty, feasibility, relevance, clarity]),
        source: "brainstorm_cycle",
        status: option.status ?? "surviving",
      };
    })
  );

  const fallbackTrackCandidates =
    optionCandidates.length > 0
      ? []
      : activeTracks.map((track, index) => {
          const trackId = pickString(track, ["track_id", "trackId"]) ?? `track-${index + 1}`;
          const novelty = deps.trackHasGraphBackedInnovationEvidence(track) ? 0.82 : 0.7;
          const feasibility = 0.74;
          const relevance = 0.8;
          const clarity = 0.76;
          return {
            direction_id: `dir-${deps.slugifyIdeationLabel(trackId)}`,
            track_id: trackId,
            title:
              pickString(track, ["title", "question"]) ?? `Direction for ${trackId}`,
            summary:
              pickString(track, ["novelty_basis"]) ??
              pickString(track, ["hypothesis"]) ??
              "Track-derived direction.",
            novelty,
            feasibility,
            relevance,
            clarity,
            composite_score: deps.averageScores([novelty, feasibility, relevance, clarity]),
            source: "track_registry",
            status: "surviving",
          };
        });

  const seedCandidates = [...optionCandidates, ...fallbackTrackCandidates].sort(
    (left, right) => right.composite_score - left.composite_score
  );

  const resolvedSelectedDirectionId =
    pickString(patch, ["selectedDirectionId", "selected_direction_id"]) ??
    current.selectedDirectionId ??
    brainstormState.selectedOptionId ??
    seedCandidates[0]?.direction_id ??
    null;

  const selectedDirection =
    seedCandidates.find((candidate) => candidate.direction_id === resolvedSelectedDirectionId) ??
    seedCandidates[0] ??
    null;

  const longTermGoal =
    pickString(patch, ["longTermGoal", "long_term_goal"]) ??
    current.longTermGoal ??
    normalizeResearchProgramState(manifest.research_program).goal ??
    "Produce a graph-grounded research direction with auditable novelty and evidence chains.";
  const problemScope =
    pickString(patch, ["problemScope", "problem_scope"]) ??
    current.problemScope ??
    normalizeResearchProgramState(manifest.research_program).problemStatement ??
    (selectedTrack ? pickString(selectedTrack, ["question"]) : null) ??
    "Identify a graph-grounded research direction with explicit challenge, insight, and evidence support.";
  const basisStage =
    normalizeStage(patch.basisStage ?? patch.basis_stage) ??
    current.basisStage ??
    brainstormState.basisStage ??
    "frontier_mapping";

  const noveltyCandidateClusters = uniqueStrings([
    ...(selectedDirection?.title ? [selectedDirection.title] : []),
    ...asStringArray(selectedTrack?.relation_patterns ?? selectedTrack?.relationPatterns).map(
      (entry) => `pattern:${entry}`
    ),
    ...asStringArray(selectedTrack?.linked_graph_nodes ?? selectedTrack?.linkedGraphNodes),
  ]).slice(0, 8);

  const persistedGraphIndices = current.graphIdeationIndices;
  const persistedPatchGraphIndices = normalizeIdeationGraphIndicesState(
    patch.graphIdeationIndices ?? patch.graph_ideation_indices
  );

  const graphIndices = normalizeIdeationGraphIndicesState({
    ...serializeIdeationGraphIndicesState(persistedGraphIndices),
    ...serializeIdeationGraphIndicesState(persistedPatchGraphIndices),
    status:
      seedCandidates.length > 0 && (challengeClusters.length > 0 || insightClusters.length > 0)
        ? "ready"
        : "pending",
    novelty_candidate_clusters: noveltyCandidateClusters,
    challenge_clusters: challengeClusters,
    insight_clusters: insightClusters,
    occupied_solution_zones: occupiedSolutionZones,
    transfer_bridges: uniqueStrings([
      ...transferBridges,
      ...persistedGraphIndices.transferBridges,
      ...persistedPatchGraphIndices.transferBridges,
    ]).slice(0, 12),
    candidate_source_domains: uniqueStrings([
      ...persistedGraphIndices.candidateSourceDomains,
      ...persistedPatchGraphIndices.candidateSourceDomains,
    ]).slice(0, 12),
    selected_source_domains: uniqueStrings([
      ...persistedGraphIndices.selectedSourceDomains,
      ...persistedPatchGraphIndices.selectedSourceDomains,
    ]).slice(0, 12),
    pruned_source_domains: uniqueStrings([
      ...persistedGraphIndices.prunedSourceDomains,
      ...persistedPatchGraphIndices.prunedSourceDomains,
    ]).slice(0, 12),
    bridge_evidence_tier:
      persistedPatchGraphIndices.bridgeEvidenceTier ??
      persistedGraphIndices.bridgeEvidenceTier ??
      null,
    last_refresh_at: new Date().toISOString(),
  });
  const topicSummaryData = asRecord(topicSummaryRecord);
  const hasMinimumBrainstormGrounding =
    brainstormSummary.chainBundleReady ||
    Boolean(
      (logicChainText && logicChainText.trim().length > 0) ||
        (evidenceChainText && evidenceChainText.trim().length > 0) ||
        (brainstormState.selectedOptionId && brainstormState.selectedOptionTitle)
    );

  const baselineReference =
    normalizeResearchProgramState(manifest.research_program).baselineReference ??
    (selectedProgramTrack
      ? pickString(selectedProgramTrack, ["baseline_reference", "baselineReference"])
      : null) ??
    "baseline contract pending";

  const techniqueCandidates = seedCandidates.slice(0, 7).map((candidate, index) => {
    const noveltyZone =
      graphIndices.noveltyCandidateClusters[
        index % Math.max(graphIndices.noveltyCandidateClusters.length, 1)
      ] ?? "graph-derived novelty zone";
    const challengeTag =
      graphIndices.challengeClusters[
        index % Math.max(graphIndices.challengeClusters.length, 1)
      ] ?? "challenge cluster pending";
    const insightTag =
      graphIndices.insightClusters[
        index % Math.max(graphIndices.insightClusters.length, 1)
      ] ?? "insight cluster pending";
    const transferBridge =
      graphIndices.transferBridges[
        index % Math.max(graphIndices.transferBridges.length, 1)
      ] ?? "transfer bridge pending";
    const anchorNode =
      asStringArray(selectedTrack?.linked_graph_nodes ?? selectedTrack?.linkedGraphNodes)[
        index %
          Math.max(
            asStringArray(selectedTrack?.linked_graph_nodes ?? selectedTrack?.linkedGraphNodes)
              .length,
            1
          )
      ] ?? "anchor node pending";
    return {
      ...candidate,
      id: candidate.direction_id,
      parent_id: null,
      tree_level: "technique",
      formulation: candidate.title,
      novelty_hypothesis: candidate.summary,
      feasibility_risk: challengeTag,
      baseline_relation: baselineReference,
      graph_basis: {
        novelty_zone: noveltyZone,
        challenge_tag: challengeTag,
        insight_tag: insightTag,
        transfer_bridge: transferBridge,
        anchor_node: anchorNode,
      },
      phase_trace: {
        propose: {
          basis: candidate.source,
          hypothesis: candidate.summary,
          graph_basis: [noveltyZone, challengeTag, anchorNode],
        },
        review: {
          novelty: Number(candidate.novelty.toFixed(3)),
          feasibility: Number(candidate.feasibility.toFixed(3)),
          relevance: Number(candidate.relevance.toFixed(3)),
          clarity: Number(candidate.clarity.toFixed(3)),
          composite_score: Number(candidate.composite_score.toFixed(3)),
        },
        refine: {
          decision:
            index === 0
              ? "advance"
              : index === 1
                ? "park"
                : candidate.composite_score >= 0.78
                  ? "merge"
                  : "kill",
          next_step:
            index === 0
              ? "extend to proposal and preserve as active direction"
              : index === 1
                ? "retain as top-3 fallback for future cycles"
                : "keep only as memory unless later evidence revives it",
        },
      },
    };
  });

  const domainCandidates = techniqueCandidates
    .flatMap((candidate, index) => {
      const challengeTag =
        graphIndices.challengeClusters[
          index % Math.max(graphIndices.challengeClusters.length, 1)
        ] ?? "challenge cluster pending";
      const transferBridge =
        graphIndices.transferBridges[
          index % Math.max(graphIndices.transferBridges.length, 1)
        ] ?? "transfer bridge pending";
      return [
        {
          id: `${candidate.direction_id}::domain-${index + 1}`,
          parent_id: candidate.direction_id,
          tree_level: "domain",
          title: `${candidate.title} / domain-${index + 1}`,
          formulation: `Stress ${candidate.title} under ${challengeTag}`,
          challenge_tag: challengeTag,
          transfer_bridge: transferBridge,
          baseline_relation: baselineReference,
        },
      ];
    })
    .slice(0, 14);

  const formulationCandidates = domainCandidates
    .flatMap((candidate, index) => {
      const insightTag =
        graphIndices.insightClusters[
          index % Math.max(graphIndices.insightClusters.length, 1)
        ] ?? "bounded formulation pending";
      const evidencePointer =
        asStringArray(selectedTrack?.evidence_pointers ?? selectedTrack?.evidencePointers)[
          index %
            Math.max(
              asStringArray(selectedTrack?.evidence_pointers ?? selectedTrack?.evidencePointers)
                .length,
              1
            )
        ] ?? "graph evidence pointer pending";
      return [
        {
          id: `${candidate.id}::formulation-${index + 1}`,
          parent_id: candidate.id,
          tree_level: "formulation",
          title: `${candidate.title} / formulation-${index + 1}`,
          formulation: `${candidate.formulation}; mechanism=${insightTag}`,
          insight_tag: insightTag,
          evidence_pointer: evidencePointer,
          baseline_relation: baselineReference,
        },
      ];
    })
    .slice(0, 21);

  const candidatePool = techniqueCandidates;

  const graphPacket = {
    project_id: projectId,
    selected_direction_id: resolvedSelectedDirectionId,
    selected_track_id: selectedTrackId,
    basis_stage: basisStage,
    long_term_goal: longTermGoal,
    problem_scope: problemScope,
    graph_basis_paths: serializeIdeationGraphBasisPaths(graphBasisPaths),
    novelty_zones: graphIndices.noveltyCandidateClusters,
    challenge_clusters: graphIndices.challengeClusters,
    insight_clusters: graphIndices.insightClusters,
    occupied_solution_zones: graphIndices.occupiedSolutionZones,
    transfer_bridges: graphIndices.transferBridges,
    anchor_nodes: asStringArray(selectedTrack?.linked_graph_nodes ?? selectedTrack?.linkedGraphNodes),
    relation_patterns: asStringArray(
      selectedTrack?.relation_patterns ?? selectedTrack?.relationPatterns
    ),
    evidence_pointers: asStringArray(
      selectedTrack?.evidence_pointers ?? selectedTrack?.evidencePointers
    ),
    source_signals: {
      anchor_index_excerpt: deps.collectMarkdownSignalLines(anchorIndexText).slice(0, 6),
      frontier_report_excerpt: deps.collectMarkdownSignalLines(frontierReportText).slice(0, 6),
      logic_chain_excerpt: deps.collectMarkdownSignalLines(logicChainText).slice(0, 6),
      evidence_chain_excerpt: deps.collectMarkdownSignalLines(evidenceChainText).slice(0, 6),
      topic_summary_objective:
        (topicSummaryData ? pickString(topicSummaryData, ["objective"]) : null) ??
        (topicSummaryData ? pickString(topicSummaryData, ["summary"]) : null),
    },
    candidate_directions: candidatePool.slice(0, 7),
  };

  const ideaTree = `# Idea Tree

## Level 0 · Seed Direction
- Goal: ${deps.quoteMarkdownText(longTermGoal)}
- Problem scope: ${deps.quoteMarkdownText(problemScope)}
- Selected direction: ${deps.quoteMarkdownText(selectedDirection?.title ?? null)}

## Graph Basis
${deps.renderMarkdownBulletList(
  uniqueStrings([
    ...graphIndices.noveltyCandidateClusters.slice(0, 4).map((entry: string) => `novelty-zone: ${entry}`),
    ...graphIndices.challengeClusters.slice(0, 4).map((entry: string) => `challenge-cluster: ${entry}`),
    ...graphIndices.insightClusters.slice(0, 4).map((entry: string) => `insight-cluster: ${entry}`),
    ...asStringArray(selectedTrack?.linked_graph_nodes ?? selectedTrack?.linkedGraphNodes)
      .slice(0, 4)
      .map((entry) => `anchor-node: ${entry}`),
  ])
)}

## Level 1 · Technique Variants
${deps.renderMarkdownBulletList(
  candidatePool.map((candidate) => {
    const sourceLabel =
      candidate.source === "brainstorm_cycle" ? "graph-grounded brainstorm" : candidate.source;
    const noveltySignal =
      graphIndices.noveltyCandidateClusters[
        candidatePool.indexOf(candidate) % Math.max(graphIndices.noveltyCandidateClusters.length, 1)
      ] ?? "graph-derived novelty zone";
    return `${candidate.title} — source=${sourceLabel}; novelty-basis=${noveltySignal}; summary=${candidate.summary}`;
  })
)}

## Level 2 · Domain Adaptations
${deps.renderMarkdownBulletList(
  domainCandidates.map(
    (candidate) =>
      `${candidate.parent_id} -> ${candidate.id}: ${candidate.formulation}; transfer bridge: ${candidate.transfer_bridge}`
  )
)}

## Level 3 · Formulation Variants
${deps.renderMarkdownBulletList(
  formulationCandidates.map(
    (candidate) =>
      `${candidate.parent_id} -> ${candidate.id}: ${candidate.formulation}; evidence pointer: ${candidate.evidence_pointer}`
  )
)}

## Propose -> Review -> Refine Trace
${deps.renderMarkdownBulletList(
  candidatePool.map(
    (candidate) =>
      `${candidate.title}: propose (${candidate.summary}) -> review (novelty=${candidate.novelty.toFixed(2)}, feasibility=${candidate.feasibility.toFixed(2)}, relevance=${candidate.relevance.toFixed(2)}, clarity=${candidate.clarity.toFixed(2)}) -> refine (composite=${candidate.composite_score.toFixed(3)})`
  )
)}
`;

  const rankingHistory = {
    status: candidatePool.length > 0 ? "completed" : "pending",
    method: "equivalent_elo_v1",
    dimensions: ["novelty", "feasibility", "relevance", "clarity"],
    graph_basis: {
      novelty_zones: graphIndices.noveltyCandidateClusters,
      challenge_clusters: graphIndices.challengeClusters,
      insight_clusters: graphIndices.insightClusters,
      transfer_bridges: graphIndices.transferBridges,
      anchor_nodes: asStringArray(selectedTrack?.linked_graph_nodes ?? selectedTrack?.linkedGraphNodes),
    },
    rounds:
      candidatePool.length > 1
        ? candidatePool.slice(1).map((candidate, index) => {
            const leader = candidatePool[index] ?? candidatePool[0];
            const leaderScore = deps.averageScores([
              leader.novelty,
              leader.feasibility,
              leader.relevance,
              leader.clarity,
            ]);
            const candidateScore = deps.averageScores([
              candidate.novelty,
              candidate.feasibility,
              candidate.relevance,
              candidate.clarity,
            ]);
            return {
              round_id: `round-${index + 1}`,
              pairing: [leader.direction_id, candidate.direction_id],
              dimensions: {
                novelty: {
                  [leader.direction_id]: Number(leader.novelty.toFixed(3)),
                  [candidate.direction_id]: Number(candidate.novelty.toFixed(3)),
                },
                feasibility: {
                  [leader.direction_id]: Number(leader.feasibility.toFixed(3)),
                  [candidate.direction_id]: Number(candidate.feasibility.toFixed(3)),
                },
                relevance: {
                  [leader.direction_id]: Number(leader.relevance.toFixed(3)),
                  [candidate.direction_id]: Number(candidate.relevance.toFixed(3)),
                },
                clarity: {
                  [leader.direction_id]: Number(leader.clarity.toFixed(3)),
                  [candidate.direction_id]: Number(candidate.clarity.toFixed(3)),
                },
              },
              winner_direction_id:
                leaderScore >= candidateScore ? leader.direction_id : candidate.direction_id,
            };
          })
        : candidatePool.length === 1
          ? [
              {
                round_id: "round-1",
                pairing: [candidatePool[0].direction_id],
                dimensions: {
                  novelty: Number(candidatePool[0].novelty.toFixed(3)),
                  feasibility: Number(candidatePool[0].feasibility.toFixed(3)),
                  relevance: Number(candidatePool[0].relevance.toFixed(3)),
                  clarity: Number(candidatePool[0].clarity.toFixed(3)),
                },
                winner_direction_id: candidatePool[0].direction_id,
              },
            ]
          : [],
  };

  const candidateTargetCount = 15;
  const hardFloorCandidateCount = 9;
  const top3 = candidatePool.slice(0, 3);
  const candidatePoolStatus =
    candidatePool.length >= candidateTargetCount
      ? "healthy"
      : candidatePool.length >= hardFloorCandidateCount
        ? "scarce"
        : "below_floor";
  const candidateScarcityReason =
    candidatePool.length >= candidateTargetCount
      ? null
      : uniqueStrings(
          [
            graphIndices.transferBridges.length < candidateTargetCount
              ? "Graph bridge evidence is still sparse, so the tournament could not safely expand to the target breadth."
              : null,
            graphIndices.challengeClusters.length < 3
              ? "Challenge coverage is still narrow, so broad candidate expansion would mostly generate padded variants."
              : null,
            candidatePool.length < hardFloorCandidateCount
              ? "Only a small set of candidates survived propose-review-refine without becoming obviously weak or redundant."
              : "The candidate pool is below the target breadth and should be treated as evidence-scarce rather than fully explored.",
          ].filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        ).join(" ");
  const contributionHints = uniqueStrings(
    [
      selectedDirection?.summary ?? null,
      selectedTrack ? pickString(selectedTrack, ["hypothesis"]) : null,
      selectedTrack ? pickString(selectedTrack, ["novelty_basis"]) : null,
      selectedProgramTrack ? pickString(selectedProgramTrack, ["hypothesis"]) : null,
    ].filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
  ).slice(0, 4);
  const scoreboard = {
    status: candidatePool.length > 0 ? "completed" : "pending",
    selected_direction_id: resolvedSelectedDirectionId,
    selected_track_id: selectedTrackId,
    candidate_target_count: candidateTargetCount,
    hard_floor_candidate_count: hardFloorCandidateCount,
    candidate_pool_status: candidatePoolStatus,
    candidate_scarcity_reason: candidateScarcityReason,
    selected_direction_contribution_hints: contributionHints,
    top_direction_titles: top3.map((candidate) => candidate.title),
    rankings: candidatePool.map((candidate, index) => ({
      rank: index + 1,
      direction_id: candidate.direction_id,
      track_id: candidate.track_id,
      title: candidate.title,
      summary: candidate.summary,
      novelty: Number(candidate.novelty.toFixed(3)),
      feasibility: Number(candidate.feasibility.toFixed(3)),
      relevance: Number(candidate.relevance.toFixed(3)),
      clarity: Number(candidate.clarity.toFixed(3)),
      composite_score: Number(candidate.composite_score.toFixed(3)),
      source: candidate.source,
      status: candidate.status,
      phase_trace: candidate.phase_trace,
      baseline_relation: candidate.baseline_relation,
    })),
  };
  const noveltyTree = `# Novelty Tree

## Long-term Goal
${deps.quoteMarkdownText(longTermGoal)}

## Novelty Zones
${deps.renderMarkdownBulletList(graphIndices.noveltyCandidateClusters)}

## Candidate Directions
${deps.renderMarkdownBulletList(
  candidatePool.map((candidate) => `${candidate.title}: ${candidate.summary}`)
)}
`;

  const challengeInsightTree = `# Challenge Insight Tree

## Challenge Clusters
${deps.renderMarkdownBulletList(graphIndices.challengeClusters)}

## Insight Clusters
${deps.renderMarkdownBulletList(graphIndices.insightClusters)}

## Evidence Bridge
${deps.renderMarkdownBulletList(
  uniqueStrings([
    ...deps.collectMarkdownSignalLines(evidenceChainText),
    ...deps.collectMarkdownSignalLines(logicChainText),
  ]).slice(0, 6)
)}
`;

  const solutionCheck = `# Well Established Solution Check

| Direction | Status | Why |
| --- | --- | --- |
${candidatePool
  .map((candidate) => {
    const occupied = graphIndices.occupiedSolutionZones.some((zone: string) =>
      zone.includes(deps.slugifyIdeationLabel(candidate.title))
    );
    const status = occupied
      ? "occupied"
      : candidate.direction_id === resolvedSelectedDirectionId
        ? "open_with_constraints"
        : "open";
    const why = occupied
      ? "A baseline or mature solution zone already covers much of this space."
      : candidate.direction_id === resolvedSelectedDirectionId
        ? "The direction remains promising, but baseline pressure and support-evidence constraints still need to be honored."
        : "The graph still shows room for exploration.";
    return `| ${candidate.title} | ${status} | ${why} |`;
  })
  .join("\n")}
`;

  const crossDomainTransfer = `# Cross Domain Transfer

## Transfer Bridges
${deps.renderMarkdownBulletList(graphIndices.transferBridges)}

## Imported Mechanisms
${deps.renderMarkdownBulletList(
  uniqueStrings([
    ...(selectedDirection?.summary ? [selectedDirection.summary] : []),
    ...deps.collectMarkdownSignalLines(questionPacketText),
  ]).slice(0, 6)
)}
`;

  const problemDecomposition = `# Problem Decomposition

## Problem Scope
${deps.quoteMarkdownText(problemScope)}

## Sub-problems
${deps.renderMarkdownBulletList([
  "Preserve fine-grained support precision for each claim.",
  "Map graph evidence packets to narrative decisions without breaking clarity.",
  "Demonstrate incremental gains over the baseline with bounded ablations.",
])}

## Validation Ladder
${deps.renderMarkdownBulletList([
  "Reproduce the baseline with unchanged training and evaluation protocol.",
  "Enable the selected graph-grounded routing delta only.",
  "Add the story-facing integration layer and re-check support precision plus clarity.",
])}
`;

  const top3Summary = `# Top 3 Directions

${top3
  .map((candidate, index) => {
    const action =
      index === 0 ? "advance" : index === 1 ? "park" : candidate.composite_score >= 0.78 ? "merge" : "kill";
    const primaryRisk =
      candidate.feasibility_risk ?? "bounded feasibility risk still needs explicit validation";
    return `## ${index + 1}. ${candidate.title}

- Track: ${candidate.track_id ?? "unassigned"}
- Composite score: ${candidate.composite_score.toFixed(3)}
- Summary: ${candidate.summary}
 - Action: ${action}
 - Primary risk: ${primaryRisk}
 - Contribution hints: ${contributionHints.join("; ") || "derive the smallest defense-ready contribution from the selected direction."}
`;
  })
  .join("\n")}
`;

  const researchProposal = `# Research Proposal

## Background
${deps.quoteMarkdownText(
  (topicSummaryData ? pickString(topicSummaryData, ["objective"]) : null) ?? problemScope
)}

## Related Work Pressure
${deps.renderMarkdownBulletList(graphIndices.occupiedSolutionZones)}

## Method
${deps.quoteMarkdownText(
  selectedDirection?.summary ??
    (selectedTrack ? pickString(selectedTrack, ["hypothesis"]) : null) ??
    (selectedProgramTrack ? pickString(selectedProgramTrack, ["hypothesis"]) : null)
)}

## Experiment Plan
${deps.renderMarkdownBulletList([
  `Baseline: ${deps.quoteMarkdownText(normalizeResearchProgramState(manifest.research_program).baselineReference)}`,
  `Primary metric: ${deps.quoteMarkdownText(normalizeResearchProgramState(manifest.research_program).primaryMetric)}`,
  "Stage 1: baseline reproduction with unchanged protocol.",
  "Stage 2: selected graph-grounded innovation delta only.",
  "Stage 3: ablation and boundary checks tied to the claim map.",
])}

## Expected Results
${deps.renderMarkdownBulletList([
  "Improved support precision against the named baseline.",
  "A cleaner claim-to-evidence routing path in the writing stack.",
  "A bounded novelty delta that remains reviewer-defensible.",
])}

## Risks and Mitigations
${deps.renderMarkdownBulletList([
  "Risk: the direction overlaps too much with occupied baseline zones. Mitigation: constrain the innovation to the graph-grounded routing delta only.",
  "Risk: the narrative claim is cleaner than the empirical gain. Mitigation: keep the claim-to-experiment map explicit and conservative.",
])}
`;

  const nextState = normalizeIdeationContractState({
    ...serializeIdeationContractState(current),
    ...patch,
    status:
      candidatePool.length > 0 &&
      hasMinimumBrainstormGrounding &&
      Boolean(selectedTrackId) &&
      graphIndices.status === "ready"
        ? "ready"
        : "pending",
    contract_version:
      pickNumber(patch, ["contractVersion", "contract_version"]) ??
      current.contractVersion ??
      1,
    long_term_goal: longTermGoal,
    problem_scope: problemScope,
    basis_stage: basisStage,
    graph_basis_paths: serializeIdeationGraphBasisPaths(graphBasisPaths),
    graph_ideation_indices: serializeIdeationGraphIndicesState(graphIndices),
    idea_tree_path:
      pickString(patch, ["ideaTreePath", "idea_tree_path"]) ?? current.ideaTreePath,
    ranking_history_path:
      pickString(patch, ["rankingHistoryPath", "ranking_history_path"]) ??
      current.rankingHistoryPath,
    selected_direction_id: resolvedSelectedDirectionId,
    selected_track_id: selectedTrackId,
    pending_reason:
      candidatePool.length === 0
        ? "No surviving candidate directions could be inferred from brainstorm_cycle or the active tracks."
        : !hasMinimumBrainstormGrounding
          ? "brainstorm_cycle does not yet expose enough graph-grounded evidence to scaffold ideation."
          : !selectedTrackId
            ? "No active track is available for ideation materialization."
            : null,
    last_updated_at: new Date().toISOString(),
  });

  const generatedFiles: string[] = [];
  const fileSpecs: Array<[string | null, unknown, "json" | "text"]> = [
    [nextState.graphIdeationPacketPath, graphPacket, "json"],
    [nextState.ideaTreePath, ideaTree, "text"],
    [
      nextState.candidatePoolPath,
      {
        status: "ready",
        candidate_target_count: candidateTargetCount,
        hard_floor_candidate_count: hardFloorCandidateCount,
        candidate_pool_status: candidatePoolStatus,
        candidate_scarcity_reason: candidateScarcityReason,
        selected_direction_contribution_hints: contributionHints,
        tree_expansion: {
          max_candidates: 21,
          roots: candidatePool.map((candidate) => candidate.direction_id),
          technique_candidates: candidatePool,
          domain_candidates: domainCandidates,
          formulation_candidates: formulationCandidates,
        },
        candidates: candidatePool,
      },
      "json",
    ],
    [nextState.rankingHistoryPath, rankingHistory, "json"],
    [nextState.tournamentScoreboardPath, scoreboard, "json"],
    [nextState.noveltyTreePath, noveltyTree, "text"],
    [nextState.challengeInsightTreePath, challengeInsightTree, "text"],
    [nextState.solutionCheckPath, solutionCheck, "text"],
    [nextState.crossDomainTransferPath, crossDomainTransfer, "text"],
    [nextState.problemDecompositionPath, problemDecomposition, "text"],
    [nextState.top3SummaryPath, top3Summary, "text"],
    [nextState.researchProposalPath, researchProposal, "text"],
  ];

  for (const [targetPath, payload, writer] of fileSpecs) {
    const resolved = resolveProjectArtifactPath(projectRoot, targetPath);
    if (!resolved) {
      continue;
    }
    if (writer === "json") {
      await writeJsonEnsured(resolved, payload);
    } else {
      await writeTextEnsured(resolved, String(payload));
    }
    generatedFiles.push(path.relative(projectRoot, resolved));
  }

  await deps.mergeJsonArtifact(
    resolveProjectArtifactPath(projectRoot, brainstormState.workingMemoryPath),
    (currentMemory) => ({
      ...currentMemory,
      ideation_contract: {
        selected_direction_id: resolvedSelectedDirectionId,
        selected_track_id: selectedTrackId,
        top_direction_titles: top3.map((candidate) => candidate.title),
        idea_tree_path: nextState.ideaTreePath,
        ranking_history_path: nextState.rankingHistoryPath,
        tournament_scoreboard_path: nextState.tournamentScoreboardPath,
        research_proposal_path: nextState.researchProposalPath,
      },
    })
  );

  await deps.mergeJsonArtifact(
    resolveProjectArtifactPath(projectRoot, brainstormState.reflectionChainPath),
    (currentReflection) => ({
      ...currentReflection,
      latest_ideation_refresh: {
        refreshed_at: new Date().toISOString(),
        selected_direction_id: resolvedSelectedDirectionId,
        top_direction_titles: top3.map((candidate) => candidate.title),
        ranking_history_path: nextState.rankingHistoryPath,
      },
    })
  );

  if (trackRegistry && Array.isArray(trackRegistry.tracks)) {
    let changed = false;
    for (const entry of trackRegistry.tracks) {
      const track = asRecord(entry);
      if (!track) {
        continue;
      }
      const trackId = pickString(track, ["track_id", "trackId"]);
      if (!trackId || trackId !== selectedTrackId) {
        continue;
      }
      track.selected_direction_id = resolvedSelectedDirectionId;
      track.graph_ideation_packet_path = nextState.graphIdeationPacketPath;
      track.idea_tree_path = nextState.ideaTreePath;
      track.ranking_history_path = nextState.rankingHistoryPath;
      track.research_proposal_path = nextState.researchProposalPath;
      track.top3_summary_path = nextState.top3SummaryPath;
      changed = true;
    }
    if (changed) {
      await writeJsonEnsured(path.join(projectRoot, "TRACK_REGISTRY.json"), trackRegistry);
    }
  }

  const currentInnovationReflection = deps.normalizeInnovationReflectionState(
    manifest.innovation_reflection
  );
  const innovationReflectionUpdate: Record<string, unknown> = {
    ...deps.serializeInnovationReflectionState(currentInnovationReflection),
    latest_ideation_top3: {
      refreshed_at: new Date().toISOString(),
      selected_direction_id: resolvedSelectedDirectionId,
      selected_track_id: selectedTrackId,
      top_direction_titles: top3.map((candidate) => candidate.title),
      top3_summary_path: nextState.top3SummaryPath,
      ranking_history_path: nextState.rankingHistoryPath,
      research_proposal_path: nextState.researchProposalPath,
    },
  };
  manifest.innovation_reflection = innovationReflectionUpdate;

  manifest.ideation_contract = serializeIdeationContractState(nextState);
  await deps.saveManifest(projectRoot, manifest);
  const summary = await deps.getIdeationContractStateSummary({ projectRoot });
  return {
    state: nextState,
    validationErrors: summary.validationErrors,
    graphIdeationPacketResolvedPath: summary.graphIdeationPacketResolvedPath,
    graphIdeationPacketExists: summary.graphIdeationPacketExists,
    researchProposalResolvedPath: summary.researchProposalResolvedPath,
    researchProposalExists: summary.researchProposalExists,
    generatedFiles,
  };
}
