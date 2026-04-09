import * as path from "node:path";
import {
  asRecord,
  normalizeStage,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import { readJsonIfExists, writeJsonEnsured } from "../workflow-guard-core/fs";
import {
  normalizeResearchProgramState,
  normalizeResearchProgramTask,
  normalizeResearchProgramTrack,
  serializeResearchProgramState,
} from "../workflow-guard-state/research-program";

type ResearchProgramState = ReturnType<typeof normalizeResearchProgramState>;
type ResearchProgramTask = ReturnType<typeof normalizeResearchProgramTask>;
type ResearchProgramTrack = ReturnType<typeof normalizeResearchProgramTrack>;

const REQUIRED_PLAN_EXPERIMENT_STAGES = [
  "baseline_implementation",
  "baseline_tuning",
  "creative_research",
  "ablation_studies",
];

function getTrackId(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return pickString(record, ["trackId", "track_id"]);
}

function readActiveTrackEntries(value: unknown): Array<Record<string, unknown>> {
  const record = asRecord(value);
  const tracks = Array.isArray(record?.tracks) ? record.tracks : [];
  return tracks
    .map((entry) => asRecord(entry))
    .filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry && normalizeStage(entry.status) === "active" && getTrackId(entry))
    );
}

function buildDefaultPlanTask(trackId: string, owner: string | null): ResearchProgramTask {
  return normalizeResearchProgramTask({
    task_id: `plan-${trackId}`,
    stage: "plan",
    track_id: trackId,
    owner: owner ?? "orchestrator",
    dependencies: [],
    entry_criteria: [`track ${trackId} active`, "PLAN.md, TODOS.md, and PLAN_AUDIT.md drafted"],
    expected_outputs: [`implementation-ready plan packet for ${trackId}`],
    retry_budget: 1,
    exit_criteria: [`${trackId} ready for code-stage handoff`],
  });
}

function collectEvidencePaths(params: {
  selectedTrackId: string | null;
  current: ResearchProgramState;
  patchState: ResearchProgramState;
  manifest: Record<string, unknown>;
}): string[] {
  const selectedOptionId =
    params.patchState.planSelection.selectedOptionId ??
    params.current.planSelection.selectedOptionId;
  const selectedOption =
    params.patchState.planAlternatives.find((entry) => entry.optionId === selectedOptionId) ??
    params.current.planAlternatives.find((entry) => entry.optionId === selectedOptionId) ??
    null;
  const ideationContract = asRecord(params.manifest.ideation_contract) ?? {};
  const graphIdeationPacketPath = pickString(ideationContract, [
    "graphIdeationPacketPath",
    "graph_ideation_packet_path",
  ]);
  const proposalPath = pickString(ideationContract, [
    "researchProposalPath",
    "research_proposal_path",
  ]);
  const reasoningGraphEvidencePath = params.selectedTrackId
    ? `researcher/reasoning/${params.selectedTrackId}/GRAPH_EVIDENCE.json`
    : null;
  return uniqueStrings([
    ...params.patchState.planSelection.decisiveGraphEvidencePaths,
    ...params.current.planSelection.decisiveGraphEvidencePaths,
    ...(selectedOption?.graphEvidencePaths ?? []),
    graphIdeationPacketPath ?? "",
    proposalPath ?? "",
    reasoningGraphEvidencePath ?? "",
    "graph/LIMITATION_FRONTIER.md",
  ]).filter(Boolean);
}

export async function materializePlanStateImpl(params: {
  projectRoot: string;
  planMaterialization?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<{
  state: ResearchProgramState;
  generatedDefaults: string[];
}> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const trackRegistryPath = path.join(projectRoot, "TRACK_REGISTRY.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const trackRegistry =
    (await readJsonIfExists<Record<string, unknown>>(trackRegistryPath)) ?? {};
  const patch = asRecord(params.planMaterialization) ?? {};
  const patchSource =
    asRecord(patch.researchProgram ?? patch.research_program) ?? patch;
  const current = normalizeResearchProgramState(manifest.research_program);
  const patchState = normalizeResearchProgramState(patchSource);
  const generatedDefaults: string[] = [];

  const activeRegistryTracks = readActiveTrackEntries(trackRegistry);
  const activeTrackIds = uniqueStrings([
    ...activeRegistryTracks.map((entry) => getTrackId(entry) ?? ""),
    ...current.tracks
      .filter((track) => track.status === "active")
      .map((track) => track.trackId),
    ...patchState.tracks
      .filter((track) => track.status === "active")
      .map((track) => track.trackId),
  ]).filter(Boolean);

  const ideationContract = asRecord(manifest.ideation_contract) ?? {};
  const selectedTrackId =
    pickString(patch, ["selectedTrackId", "selected_track_id"]) ??
    patchState.planSelection.selectedTrackId ??
    current.planSelection.selectedTrackId ??
    pickString(ideationContract, ["selectedTrackId", "selected_track_id"]) ??
    activeTrackIds[0] ??
    null;
  const relevantTrackIds = uniqueStrings([
    ...activeTrackIds,
    selectedTrackId ?? "",
  ]).filter(Boolean);

  const nextTracks: ResearchProgramTrack[] = relevantTrackIds.map((trackId) => {
    const currentTrack = current.tracks.find((entry) => entry.trackId === trackId) ?? null;
    const patchTrack = patchState.tracks.find((entry) => entry.trackId === trackId) ?? null;
    const registryTrack =
      activeRegistryTracks.find((entry) => getTrackId(entry) === trackId) ?? null;
    const mergedStageMatrix = uniqueStrings([
      ...(currentTrack?.experimentStageMatrix ?? []),
      ...(patchTrack?.experimentStageMatrix ?? []),
      ...REQUIRED_PLAN_EXPERIMENT_STAGES,
    ]);
    if (
      (currentTrack?.experimentStageMatrix.length ?? 0) < REQUIRED_PLAN_EXPERIMENT_STAGES.length &&
      (patchTrack?.experimentStageMatrix.length ?? 0) < REQUIRED_PLAN_EXPERIMENT_STAGES.length
    ) {
      generatedDefaults.push(`tracks.${trackId}.experiment_stage_matrix`);
    }
    return normalizeResearchProgramTrack({
      ...(registryTrack ?? {}),
      ...(currentTrack ?? {}),
      ...(patchTrack ?? {}),
      track_id: trackId,
      status:
        patchTrack?.status ??
        currentTrack?.status ??
        normalizeStage(registryTrack?.status) ??
        "active",
      hypothesis:
        patchTrack?.hypothesis ??
        currentTrack?.hypothesis ??
        pickString(registryTrack ?? {}, ["hypothesis", "title", "name"]),
      novelty_basis:
        patchTrack?.noveltyBasis ??
        currentTrack?.noveltyBasis ??
        pickString(registryTrack ?? {}, ["noveltyBasis", "novelty_basis", "summary"]),
      experiment_stage_matrix: mergedStageMatrix,
    });
  });

  const mergedTasks = new Map<string, ResearchProgramTask>();
  for (const task of current.taskGraph) {
    mergedTasks.set(task.taskId, task);
  }
  for (const task of patchState.taskGraph) {
    mergedTasks.set(task.taskId, task);
  }
  for (const trackId of relevantTrackIds) {
    const existingTasks = Array.from(mergedTasks.values()).filter(
      (task) => task.trackId === trackId
    );
    const validTask = existingTasks.find(
      (task) =>
        task.entryCriteria.length > 0 &&
        task.expectedOutputs.length > 0 &&
        task.exitCriteria.length > 0
    );
    if (validTask) {
      continue;
    }
    const seedTask = existingTasks[0] ?? null;
    const defaultTask = buildDefaultPlanTask(
      trackId,
      seedTask?.owner ?? pickString(patch, ["defaultTaskOwner", "default_task_owner"])
    );
    const nextTask = normalizeResearchProgramTask({
      ...(seedTask ?? {}),
      task_id: seedTask?.taskId ?? defaultTask.taskId,
      stage: seedTask?.stage ?? defaultTask.stage,
      track_id: trackId,
      owner: seedTask?.owner ?? defaultTask.owner,
      dependencies: seedTask?.dependencies ?? defaultTask.dependencies,
      entry_criteria:
        seedTask?.entryCriteria.length ? seedTask.entryCriteria : defaultTask.entryCriteria,
      expected_outputs:
        seedTask?.expectedOutputs.length
          ? seedTask.expectedOutputs
          : defaultTask.expectedOutputs,
      retry_budget: seedTask?.retryBudget ?? defaultTask.retryBudget,
      exit_criteria:
        seedTask?.exitCriteria.length ? seedTask.exitCriteria : defaultTask.exitCriteria,
    });
    mergedTasks.set(nextTask.taskId, nextTask);
    generatedDefaults.push(`task_graph.${trackId}`);
  }

  const selectedOptionId =
    pickString(patch, ["selectedOptionId", "selected_option_id"]) ??
    patchState.planSelection.selectedOptionId ??
    current.planSelection.selectedOptionId ??
    (selectedTrackId ? `plan-${selectedTrackId}` : "plan-main");
  const fallbackOptionId =
    pickString(patch, ["fallbackOptionId", "fallback_option_id"]) ??
    patchState.planSelection.fallbackOptionIds[0] ??
    current.planSelection.fallbackOptionIds[0] ??
    `${selectedOptionId}-fallback`;
  const decisiveGraphEvidencePaths = collectEvidencePaths({
    selectedTrackId,
    current,
    patchState,
    manifest,
  });

  const optionMap = new Map(
    current.planAlternatives.map((option) => [option.optionId, option] as const)
  );
  for (const option of patchState.planAlternatives) {
    optionMap.set(option.optionId, option);
  }
  optionMap.set(
    selectedOptionId,
    normalizeResearchProgramState({
      plan_alternatives: [
        {
          ...(optionMap.get(selectedOptionId) ?? {}),
          optionId: selectedOptionId,
          linkedTrackId: selectedTrackId,
          title:
            optionMap.get(selectedOptionId)?.title ??
            `Main execution plan for ${selectedTrackId ?? "selected track"}`,
          status: "selected",
          summary:
            optionMap.get(selectedOptionId)?.summary ??
            `Advance ${selectedTrackId ?? "the selected track"} with graph-grounded execution and baseline-preserving validation.`,
          graphEvidencePaths:
            optionMap.get(selectedOptionId)?.graphEvidencePaths.length
              ? optionMap.get(selectedOptionId)?.graphEvidencePaths
              : decisiveGraphEvidencePaths,
          keyRisks:
            optionMap.get(selectedOptionId)?.keyRisks.length
              ? optionMap.get(selectedOptionId)?.keyRisks
              : ["Implementation scope may require a narrower fallback if the first code pass stalls."],
        },
      ],
    }).planAlternatives[0]
  );
  if (!optionMap.has(fallbackOptionId) || optionMap.size < 2) {
    optionMap.set(
      fallbackOptionId,
      normalizeResearchProgramState({
        plan_alternatives: [
          {
            optionId: fallbackOptionId,
            linkedTrackId: null,
            title: `Fallback plan for ${selectedTrackId ?? "selected track"}`,
            status: "rejected",
            summary:
              "Keep a lower-scope fallback that preserves graph evidence while reducing implementation and debugging risk.",
            graphEvidencePaths: decisiveGraphEvidencePaths,
            keyRisks: [
              "The fallback path may preserve less novelty than the selected main plan.",
            ],
          },
        ],
      }).planAlternatives[0]
    );
    generatedDefaults.push("plan_alternatives");
  }
  const nextPlanAlternatives = Array.from(optionMap.values());
  const comparedOptionIds = uniqueStrings([
    ...current.planSelection.comparedOptionIds,
    ...patchState.planSelection.comparedOptionIds,
    selectedOptionId,
    fallbackOptionId,
    ...nextPlanAlternatives.slice(0, 2).map((option) => option.optionId),
  ]).slice(0, Math.max(2, nextPlanAlternatives.length));

  const next = normalizeResearchProgramState({
    ...serializeResearchProgramState(current),
    ...patchSource,
    tracks: nextTracks,
    task_graph: Array.from(mergedTasks.values()),
    plan_alternatives: nextPlanAlternatives,
    plan_selection: {
      ...current.planSelection,
      ...patchState.planSelection,
      selectedOptionId,
      selectedTrackId,
      comparedOptionIds,
      rationale:
        patchState.planSelection.rationale ??
        current.planSelection.rationale ??
        "The selected plan best preserves graph-grounded novelty while keeping a bounded fallback path.",
      decisiveGraphEvidencePaths,
      fallbackOptionIds: uniqueStrings([
        ...current.planSelection.fallbackOptionIds,
        ...patchState.planSelection.fallbackOptionIds,
        fallbackOptionId,
      ]),
      lastComparedAt: new Date().toISOString(),
    },
    last_updated_at: new Date().toISOString(),
  });

  manifest.research_program = serializeResearchProgramState(next);
  await writeJsonEnsured(manifestPath, manifest);
  return {
    state: next,
    generatedDefaults: uniqueStrings(generatedDefaults),
  };
}
