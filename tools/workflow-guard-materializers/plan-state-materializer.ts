import * as path from "node:path";
import {
  asStringArray,
  asRecord,
  normalizeStage,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import {
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import {
  normalizeOrchestrationState,
  serializeOrchestrationState,
} from "../workflow-guard-state/execution-state";
import {
  normalizeResearchProgramState,
  normalizeResearchProgramTask,
  normalizeResearchProgramTrack,
  serializeResearchProgramState,
} from "../workflow-guard-state/research-program";

type ResearchProgramState = ReturnType<typeof normalizeResearchProgramState>;
type ResearchProgramTask = ReturnType<typeof normalizeResearchProgramTask>;
type ResearchProgramTrack = ReturnType<typeof normalizeResearchProgramTrack>;

const PLAN_ARTIFACTS = {
  plan: "orchestrator/PLAN.md",
  todos: "orchestrator/TODOS.md",
  audit: "orchestrator/PLAN_AUDIT.md",
} as const;

const REQUIRED_PLAN_EXPERIMENT_STAGES = [
  "baseline_implementation",
  "baseline_tuning",
  "creative_research",
  "ablation_studies",
];

function nonMissingStage(value: string | null | undefined): string | null {
  const normalized = normalizeStage(value);
  return normalized && normalized !== "missing" ? normalized : null;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  return (
    values.find((value) => typeof value === "string" && value.trim().length > 0) ?? null
  );
}

function collectLooseStrings(...values: unknown[]): string[] {
  const direct: string[] = [];
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      direct.push(value);
      continue;
    }
    if (Array.isArray(value)) {
      direct.push(...asStringArray(value));
      continue;
    }
    const record = asRecord(value);
    if (!record) {
      continue;
    }
    for (const key of ["items", "entries", "values", "list", "paths"]) {
      direct.push(...collectLooseStrings(record[key]));
    }
    direct.push(
      ...Object.values(record).filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
      )
    );
  }
  return uniqueStrings(direct);
}

function isSubstantiveMarkdown(value: string | null): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim();
  if (normalized.length < 80) {
    return false;
  }
  return !/^#\s*artifact\s*$/iu.test(normalized);
}

async function writeMarkdownIfWeak(params: {
  projectRoot: string;
  relativePath: string;
  content: string;
  generatedFiles: string[];
}): Promise<void> {
  const targetPath = path.join(params.projectRoot, params.relativePath);
  const current = await readTextIfExists(targetPath);
  if (isSubstantiveMarkdown(current)) {
    return;
  }
  await writeTextEnsured(
    targetPath,
    params.content.endsWith("\n") ? params.content : `${params.content}\n`
  );
  params.generatedFiles.push(params.relativePath);
}

function inferTopic(manifest: Record<string, unknown>): string {
  const brainstormCycle = asRecord(manifest.brainstorm_cycle) ?? {};
  const researchProgram = normalizeResearchProgramState(manifest.research_program);
  return (
    firstNonEmpty(
      researchProgram.goal,
      pickString(manifest, ["title", "topic", "research_topic", "researchTopic"]),
      pickString(brainstormCycle, ["topic", "selectedOptionTitle", "selected_option_title"])
    ) ?? "the selected research direction"
  );
}

function inferPrimaryMetric(params: {
  current: ResearchProgramState;
  patchState: ResearchProgramState;
  manifest: Record<string, unknown>;
  topic: string;
}): string {
  const topic = params.topic.toLowerCase();
  return (
    firstNonEmpty(
      params.patchState.primaryMetric,
      params.current.primaryMetric,
      pickString(params.manifest, ["primary_metric", "primaryMetric"])
    ) ??
    (/\bgcd\b|generalized category discovery|novel-class|novel class/u.test(topic)
      ? "H-score with known and novel accuracy"
      : "primary task quality metric")
  );
}

function inferBaselineReference(params: {
  current: ResearchProgramState;
  patchState: ResearchProgramState;
  manifest: Record<string, unknown>;
  topic: string;
}): string {
  const topic = params.topic.toLowerCase();
  return (
    firstNonEmpty(
      params.patchState.baselineReference,
      params.current.baselineReference,
      pickString(params.manifest, ["baseline_reference", "baselineReference"])
    ) ??
    (/\bgcd\b|generalized category discovery/u.test(topic)
      ? "SimGCD-style supervised and semi-supervised GCD baselines"
      : "strongest available supervised baseline")
  );
}

function inferDatasets(params: {
  current: ResearchProgramState;
  patchState: ResearchProgramState;
  topic: string;
}): string[] {
  const existing = uniqueStrings([
    ...params.patchState.datasets,
    ...params.current.datasets,
  ]);
  if (existing.length > 0) {
    return existing;
  }
  return /\bgcd\b|generalized category discovery/u.test(params.topic.toLowerCase())
    ? ["CIFAR-100", "ImageNet-100", "CUB-200"]
    : ["primary benchmark suite"];
}

function renderBulletList(items: string[]): string {
  return items.length > 0
    ? items.map((item) => `- ${item}`).join("\n")
    : "- Not specified yet";
}

function renderInlineList(items: string[]): string {
  return items.length > 0 ? items.join(", ") : "not specified";
}

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

function buildPlanMarkdown(params: {
  topic: string;
  state: ResearchProgramState;
  selectedTrack: ResearchProgramTrack | null;
  selectedOption: ResearchProgramState["planAlternatives"][number] | null;
}): string {
  const track = params.selectedTrack;
  const option = params.selectedOption;
  return [
    "# Research Plan",
    "",
    "## Objective",
    params.state.goal ?? params.topic,
    "",
    "## Selected Direction",
    `- Track: ${track?.trackId ?? params.state.planSelection.selectedTrackId ?? "unresolved"}`,
    `- Plan option: ${option?.title ?? params.state.planSelection.selectedOptionId ?? "selected option"}`,
    `- Hypothesis: ${
      track?.hypothesis ??
      "The selected direction should improve the target research metric when evaluated against the baseline."
    }`,
    `- Novelty basis: ${
      track?.noveltyBasis ??
      "Graph-grounded ideation selected this direction as the most useful next step."
    }`,
    `- Primary metric: ${track?.mainMetric ?? params.state.primaryMetric ?? "primary task quality metric"}`,
    `- Success threshold: ${
      track?.successThreshold ?? "beat the baseline without regressing core quality checks"
    }`,
    "",
    "## Implementation Strategy",
    "- Reproduce the baseline path first and keep the run configuration auditable.",
    "- Add the selected method change behind an isolated implementation flag.",
    "- Run the required baselines before interpreting any improvement from the creative branch.",
    "- Execute the ablation list so the final paper can separate the method effect from tuning noise.",
    "",
    "## Required Baselines",
    renderBulletList(track?.requiredBaselines ?? []),
    "",
    "## Required Ablations",
    renderBulletList(track?.requiredAblations ?? []),
    "",
    "## Graph Evidence",
    renderBulletList(params.state.planSelection.decisiveGraphEvidencePaths),
    "",
    "## Budget And Stop Rules",
    `- Budget: gpu_hours=${track?.budget.gpuHours ?? "unset"}, max_runs=${
      track?.budget.maxRuns ?? "unset"
    }, max_debug_iterations=${track?.budget.maxDebugIterations ?? "unset"}`,
    renderBulletList(track?.stopRules ?? []),
    "",
    "## Rollback Triggers",
    renderBulletList(track?.rollbackTriggers ?? []),
  ].join("\n");
}

function buildTodosMarkdown(params: {
  state: ResearchProgramState;
  selectedTrack: ResearchProgramTrack | null;
}): string {
  const trackId =
    params.selectedTrack?.trackId ??
    params.state.planSelection.selectedTrackId ??
    "selected-track";
  return [
    "# Plan TODOs",
    "",
    `## ${trackId}`,
    "- [ ] Implement the baseline reproduction entry point and record the exact command.",
    "- [ ] Add the selected method delta behind a configuration switch.",
    "- [ ] Run required baselines and store metrics in researcher/EXPERIMENT_LEDGER.json.",
    "- [ ] Run required ablations and compare against the selected metric.",
    "- [ ] Write analyzer evidence packets before paper drafting.",
    "",
    "## Acceptance",
    `- Metric: ${params.selectedTrack?.mainMetric ?? params.state.primaryMetric ?? "primary metric"}`,
    `- Success threshold: ${
      params.selectedTrack?.successThreshold ?? "baseline parity plus claimed improvement"
    }`,
    `- Write scope claims: ${renderInlineList(
      params.selectedTrack?.writeScope.allowedClaimIds ?? []
    )}`,
    `- Write scope figures: ${renderInlineList(
      params.selectedTrack?.writeScope.allowedFigureIds ?? []
    )}`,
  ].join("\n");
}

function buildPlanAuditMarkdown(params: {
  state: ResearchProgramState;
  selectedTrack: ResearchProgramTrack | null;
  selectedOption: ResearchProgramState["planAlternatives"][number] | null;
}): string {
  const selectedTrack = params.selectedTrack;
  const selectedOption = params.selectedOption;
  return [
    "# Plan Audit",
    "",
    "## Checks",
    `- Research program status: ${params.state.status}`,
    `- Selected track: ${params.state.planSelection.selectedTrackId ?? "unset"}`,
    `- Selected option: ${params.state.planSelection.selectedOptionId ?? "unset"}`,
    `- Compared options: ${renderInlineList(params.state.planSelection.comparedOptionIds)}`,
    `- Decisive graph evidence: ${renderInlineList(
      params.state.planSelection.decisiveGraphEvidencePaths
    )}`,
    "",
    "## Risk Controls",
    renderBulletList([
      ...(selectedOption?.keyRisks ?? []),
      ...(selectedTrack?.rollbackTriggers ?? []),
    ]),
    "",
    "## Handoff Decision",
    "The plan packet is sufficient for code-stage handoff when PLAN.md, TODOS.md, PLAN_AUDIT.md, the selected track, and at least two graph-grounded plan alternatives are present.",
  ].join("\n");
}

export async function materializePlanStateImpl(params: {
  projectRoot: string;
  planMaterialization?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<{
  state: ResearchProgramState;
  generatedDefaults: string[];
  generatedFiles: string[];
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
  const generatedFiles: string[] = [];
  const topic = inferTopic(manifest);
  const primaryMetric = inferPrimaryMetric({
    current,
    patchState,
    manifest,
    topic,
  });
  const baselineReference = inferBaselineReference({
    current,
    patchState,
    manifest,
    topic,
  });
  const datasets = inferDatasets({
    current,
    patchState,
    topic,
  });

  const activeRegistryTracks = readActiveTrackEntries(trackRegistry);
  const activeTrackIds = uniqueStrings([
    ...activeRegistryTracks.map((entry) => getTrackId(entry) ?? ""),
    ...asStringArray(manifest.active_track_ids),
    pickString(manifest, ["primary_track_id", "primaryTrackId"]) ?? "",
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
    const registryTrackState = registryTrack
      ? normalizeResearchProgramTrack({
          ...registryTrack,
          track_id: trackId,
        })
      : null;
    const mergedStageMatrix = uniqueStrings([
      ...(currentTrack?.experimentStageMatrix ?? []),
      ...(patchTrack?.experimentStageMatrix ?? []),
      ...(registryTrackState?.experimentStageMatrix ?? []),
      ...REQUIRED_PLAN_EXPERIMENT_STAGES,
    ]);
    if (
      (currentTrack?.experimentStageMatrix.length ?? 0) < REQUIRED_PLAN_EXPERIMENT_STAGES.length &&
      (patchTrack?.experimentStageMatrix.length ?? 0) < REQUIRED_PLAN_EXPERIMENT_STAGES.length
    ) {
      generatedDefaults.push(`tracks.${trackId}.experiment_stage_matrix`);
    }
    const hypothesis =
      firstNonEmpty(
        patchTrack?.hypothesis,
        currentTrack?.hypothesis,
        registryTrackState?.hypothesis,
        pickString(registryTrack ?? {}, ["question", "summary", "title", "name"])
      ) ??
      `Test whether ${
        pickString(registryTrack ?? {}, ["title", "name"]) ?? trackId
      } improves ${primaryMetric}.`;
    const noveltyBasis =
      firstNonEmpty(
        patchTrack?.noveltyBasis,
        currentTrack?.noveltyBasis,
        registryTrackState?.noveltyBasis,
        pickString(registryTrack ?? {}, ["noveltyBasis", "novelty_basis", "summary"])
      ) ??
      "Graph-backed ideation selected this track as the strongest bounded research direction.";
    const requiredBaselines = uniqueStrings([
      ...(currentTrack?.requiredBaselines ?? []),
      ...(patchTrack?.requiredBaselines ?? []),
      ...(registryTrackState?.requiredBaselines ?? []),
      ...collectLooseStrings((registryTrack ?? {}).baselines),
      baselineReference,
    ]);
    const requiredAblations = uniqueStrings([
      ...(currentTrack?.requiredAblations ?? []),
      ...(patchTrack?.requiredAblations ?? []),
      ...(registryTrackState?.requiredAblations ?? []),
      ...collectLooseStrings(
        (registryTrack ?? {}).ablation_plan,
        (registryTrack ?? {}).required_ablations
      ),
      "remove the selected method delta",
      "replace adaptive gating with a single global threshold",
    ]);
    const requiredControls = uniqueStrings([
      ...(currentTrack?.requiredControls ?? []),
      ...(patchTrack?.requiredControls ?? []),
      ...(registryTrackState?.requiredControls ?? []),
      "fixed random seed control",
      "matched training budget control",
    ]);
    const stopRules = uniqueStrings([
      ...(currentTrack?.stopRules ?? []),
      ...(patchTrack?.stopRules ?? []),
      ...(registryTrackState?.stopRules ?? []),
      "stop after two consecutive non-improving method runs against the reproduced baseline",
    ]);
    const rollbackTriggers = uniqueStrings([
      ...(currentTrack?.rollbackTriggers ?? []),
      ...(patchTrack?.rollbackTriggers ?? []),
      ...(registryTrackState?.rollbackTriggers ?? []),
      "known-class or baseline metric regression exceeds the accepted tolerance",
      "ablation evidence shows the selected method delta does not drive the gain",
    ]);
    const allowedClaimIds = uniqueStrings([
      ...(currentTrack?.writeScope.allowedClaimIds ?? []),
      ...(patchTrack?.writeScope.allowedClaimIds ?? []),
      ...(registryTrackState?.writeScope.allowedClaimIds ?? []),
      `claim-${trackId}-method`,
      `claim-${trackId}-evaluation`,
    ]);
    const allowedFigureIds = uniqueStrings([
      ...(currentTrack?.writeScope.allowedFigureIds ?? []),
      ...(patchTrack?.writeScope.allowedFigureIds ?? []),
      ...(registryTrackState?.writeScope.allowedFigureIds ?? []),
      `fig-${trackId}-method`,
      `tab-${trackId}-results`,
    ]);
    const status =
      trackId === selectedTrackId
        ? "active"
        : nonMissingStage(patchTrack?.status) ??
          nonMissingStage(currentTrack?.status) ??
          nonMissingStage(registryTrackState?.status) ??
          "active";
    return normalizeResearchProgramTrack({
      ...(registryTrack ?? {}),
      ...(currentTrack ?? {}),
      ...(patchTrack ?? {}),
      track_id: trackId,
      status,
      hypothesis,
      novelty_basis: noveltyBasis,
      main_metric:
        patchTrack?.mainMetric ??
        currentTrack?.mainMetric ??
        registryTrackState?.mainMetric ??
        primaryMetric,
      success_threshold:
        patchTrack?.successThreshold ??
        currentTrack?.successThreshold ??
        registryTrackState?.successThreshold ??
        `improve ${primaryMetric} over ${baselineReference} without a baseline regression`,
      required_baselines: requiredBaselines,
      required_ablations: requiredAblations,
      required_controls: requiredControls,
      experiment_stage_matrix: mergedStageMatrix,
      budget: {
        gpu_hours:
          patchTrack?.budget.gpuHours ??
          currentTrack?.budget.gpuHours ??
          registryTrackState?.budget.gpuHours ??
          24,
        max_runs:
          patchTrack?.budget.maxRuns ??
          currentTrack?.budget.maxRuns ??
          registryTrackState?.budget.maxRuns ??
          6,
        max_debug_iterations:
          patchTrack?.budget.maxDebugIterations ??
          currentTrack?.budget.maxDebugIterations ??
          registryTrackState?.budget.maxDebugIterations ??
          2,
      },
      stop_rules: stopRules,
      rollback_triggers: rollbackTriggers,
      write_scope: {
        allowed_claim_ids: allowedClaimIds,
        allowed_figure_ids: allowedFigureIds,
      },
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
    generatedDefaults.push("plan_alternatives");
  }
  const existingFallback = optionMap.get(fallbackOptionId) ?? null;
  optionMap.set(
    fallbackOptionId,
    normalizeResearchProgramState({
      plan_alternatives: [
        {
          ...(existingFallback ?? {}),
          optionId: fallbackOptionId,
          linkedTrackId: existingFallback?.linkedTrackId ?? null,
          title:
            existingFallback?.title ??
            `Fallback plan for ${selectedTrackId ?? "selected track"}`,
          status:
            existingFallback?.status && existingFallback.status !== "candidate"
              ? existingFallback.status
              : "rejected",
          summary:
            existingFallback?.summary ??
            "Keep a lower-scope fallback that preserves graph evidence while reducing implementation and debugging risk.",
          graphEvidencePaths: existingFallback?.graphEvidencePaths.length
            ? existingFallback.graphEvidencePaths
            : decisiveGraphEvidencePaths,
          keyRisks: existingFallback?.keyRisks.length
            ? existingFallback.keyRisks
            : ["The fallback path may preserve less novelty than the selected main plan."],
        },
      ],
    }).planAlternatives[0]
  );
  const nextPlanAlternatives = Array.from(optionMap.values());
  const comparedOptionIds = uniqueStrings([
    ...current.planSelection.comparedOptionIds,
    ...patchState.planSelection.comparedOptionIds,
    selectedOptionId,
    fallbackOptionId,
    ...nextPlanAlternatives.slice(0, 2).map((option) => option.optionId),
  ]).slice(0, Math.max(2, nextPlanAlternatives.length));
  const nextStatus =
    nonMissingStage(patchState.status) ??
    (["approved", "ready", "running"].includes(normalizeStage(current.status) ?? "")
      ? current.status
      : selectedTrackId
        ? "approved"
        : current.status);

  const next = normalizeResearchProgramState({
    ...serializeResearchProgramState(current),
    ...patchSource,
    status: nextStatus,
    goal:
      patchState.goal ??
      current.goal ??
      `Evaluate ${topic} with graph-grounded baselines and ablations.`,
    problem_statement:
      patchState.problemStatement ??
      current.problemStatement ??
      `The project needs a bounded, testable plan for ${topic}.`,
    baseline_reference: baselineReference,
    primary_metric: primaryMetric,
    datasets,
    success_criteria:
      patchState.successCriteria.length > 0
        ? patchState.successCriteria
        : current.successCriteria.length > 0
          ? current.successCriteria
          : [
              `Improve ${primaryMetric} over ${baselineReference}.`,
              "Preserve baseline parity on the control metric.",
              "Support all paper-facing claims with experiment or graph evidence.",
            ],
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
  const currentOrchestration = normalizeOrchestrationState(manifest.orchestration_state);
  const now = new Date().toISOString();
  manifest.orchestration_state = serializeOrchestrationState({
    ...currentOrchestration,
    status:
      ["ready", "running", "waiting"].includes(normalizeStage(currentOrchestration.status) ?? "")
        ? currentOrchestration.status
        : "waiting",
    currentOwner: currentOrchestration.currentOwner ?? "orchestrator",
    nextOwner: currentOrchestration.nextOwner ?? "coder",
    nextTransitionCandidate: "code",
    blockingCategory: null,
    blockingReason: null,
    retryBudgetRemaining: currentOrchestration.retryBudgetRemaining ?? 2,
    lastContractEvalAt: now,
    lastContractEvalResult: "pass",
    resumeCursor: currentOrchestration.resumeCursor ?? "plan:ready_for_code_handoff",
    lastUpdatedAt: now,
  });
  manifest.owner_agent = pickString(manifest, ["owner_agent", "ownerAgent"]) ?? "orchestrator";
  await writeJsonEnsured(manifestPath, manifest);
  const selectedTrack =
    selectedTrackId
      ? next.tracks.find((entry) => entry.trackId === selectedTrackId) ?? null
      : null;
  const selectedOption =
    next.planSelection.selectedOptionId
      ? next.planAlternatives.find(
          (entry) => entry.optionId === next.planSelection.selectedOptionId
        ) ?? null
      : null;
  await writeMarkdownIfWeak({
    projectRoot,
    relativePath: PLAN_ARTIFACTS.plan,
    generatedFiles,
    content: buildPlanMarkdown({
      topic,
      state: next,
      selectedTrack,
      selectedOption,
    }),
  });
  await writeMarkdownIfWeak({
    projectRoot,
    relativePath: PLAN_ARTIFACTS.todos,
    generatedFiles,
    content: buildTodosMarkdown({
      state: next,
      selectedTrack,
    }),
  });
  await writeMarkdownIfWeak({
    projectRoot,
    relativePath: PLAN_ARTIFACTS.audit,
    generatedFiles,
    content: buildPlanAuditMarkdown({
      state: next,
      selectedTrack,
      selectedOption,
    }),
  });
  generatedFiles.push("PROJECT_MANIFEST.json");
  return {
    state: next,
    generatedDefaults: uniqueStrings(generatedDefaults),
    generatedFiles: uniqueStrings(generatedFiles),
  };
}
