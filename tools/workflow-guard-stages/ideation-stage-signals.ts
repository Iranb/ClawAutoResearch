import * as path from "node:path";
import {
  getIdeaCatalystRequisitionBlockingSignal,
  getIdeaCatalystRequiredArtifactPaths,
  isIdeaCatalystReadyForPlan,
} from "../idea-catalyst/workflow-bridge";
import type {
  ManifestLike,
  StageSignalsContext,
  TrackRegistryLike,
  WorkflowTrackLike,
} from "./types";

export interface IdeationStageDeps {
  pathExists: (targetPath: string) => Promise<boolean>;
  fileHasNonWhitespaceContent: (targetPath: string | null) => Promise<boolean>;
  fileHasMeaningfulJsonContent: (targetPath: string | null) => Promise<boolean>;
  isNonEmptyDirectory: (targetPath: string) => Promise<boolean>;
  resolveProjectArtifactPath: (
    projectRoot: string,
    artifactPath: string | null
  ) => string | null;
  resolveTrackArtifactPath: (
    projectRoot: string,
    artifactPath: string | null
  ) => string | null;
  normalizeIdeaCatalystState: (value: unknown) => any;
  getIdeaCatalystValidationErrors: (state: any) => string[];
  normalizeIdeationContractState: (value: unknown) => any;
  getIdeationContractValidationErrors: (state: any) => string[];
  normalizeInnovationReflectionState: (value: unknown) => any;
  isInnovationReflectionDue: (params: any) => boolean;
  getActiveTracks: (trackRegistry: TrackRegistryLike | null) => WorkflowTrackLike[];
  asString: (value: unknown) => string | null;
  trackHasGraphBackedInnovationEvidence: (track: WorkflowTrackLike) => boolean;
  getBrainstormCycleMissingSignals: (params: {
    projectRoot: string;
    manifest: ManifestLike | null;
  }) => Promise<string[]>;
  normalizeResearchProgramState: (value: unknown) => any;
  getResearchProgramValidationErrors: (state: any) => string[];
  normalizeOrchestrationState: (value: unknown) => any;
  getOrchestrationStateValidationErrors: (
    state: any,
    currentStage: string | null
  ) => string[];
  getCodeStageBundleMissingSignals: (params: {
    projectRoot: string;
    manifest: ManifestLike | null;
  }) => Promise<string[]>;
}

async function artifactHasMeaningfulContent(
  projectRoot: string,
  relativePath: string | null | undefined,
  deps: Pick<
    IdeationStageDeps,
    "resolveProjectArtifactPath" | "fileHasMeaningfulJsonContent" | "fileHasNonWhitespaceContent"
  >
): Promise<boolean> {
  if (!relativePath) {
    return false;
  }
  const resolvedPath = deps.resolveProjectArtifactPath(projectRoot, relativePath);
  return relativePath.toLowerCase().endsWith(".json")
    ? deps.fileHasMeaningfulJsonContent(resolvedPath)
    : deps.fileHasNonWhitespaceContent(resolvedPath);
}

export async function collectIdeaStageMissingSignals(
  ctx: StageSignalsContext,
  deps: IdeationStageDeps
): Promise<string[]> {
  const missing: string[] = [];
  if (!(await deps.pathExists(path.join(ctx.projectRoot, "researcher", "IDEA_REPORT.md")))) {
    missing.push("{PROJ}/researcher/IDEA_REPORT.md");
  }
  if (!(await deps.pathExists(path.join(ctx.projectRoot, "researcher", "IDEA_AUDIT.md")))) {
    missing.push("{PROJ}/researcher/IDEA_AUDIT.md");
  }

  const ideationContract = deps.normalizeIdeationContractState(
    ctx.manifest?.ideation_contract
  );
  missing.push(...deps.getIdeationContractValidationErrors(ideationContract));
  for (const relativePath of [
    ideationContract.noveltyTreePath,
    ideationContract.challengeInsightTreePath,
    ideationContract.solutionCheckPath,
    ideationContract.crossDomainTransferPath,
    ideationContract.problemDecompositionPath,
    ideationContract.candidatePoolPath,
    ideationContract.tournamentScoreboardPath,
    ideationContract.top3SummaryPath,
    ideationContract.graphIdeationPacketPath,
    ideationContract.ideaTreePath,
    ideationContract.rankingHistoryPath,
  ]) {
    if (!(await artifactHasMeaningfulContent(ctx.projectRoot, relativePath, deps))) {
      if (relativePath) {
        missing.push(`{PROJ}/${relativePath}`);
      }
    }
  }

  const ideaCatalyst = deps.normalizeIdeaCatalystState(ctx.manifest?.idea_catalyst);
  missing.push(...deps.getIdeaCatalystValidationErrors(ideaCatalyst));
  const requisitionBlockingSignal =
    getIdeaCatalystRequisitionBlockingSignal(ideaCatalyst);
  if (requisitionBlockingSignal) {
    missing.push(requisitionBlockingSignal);
  }
  for (const relativePath of getIdeaCatalystRequiredArtifactPaths(ideaCatalyst)) {
    if (!(await artifactHasMeaningfulContent(ctx.projectRoot, relativePath, deps))) {
      missing.push(`{PROJ}/${relativePath}`);
    }
  }

  const innovationReflection = deps.normalizeInnovationReflectionState(
    ctx.manifest?.innovation_reflection
  );
  if (
    deps.isInnovationReflectionDue({
      state: innovationReflection,
      ledger: ctx.experimentLedger,
    })
  ) {
    missing.push(
      "{PROJ}/researcher/INNOVATION_REFLECTION.md refreshed after the latest experiment results"
    );
  }

  const activeTracks = deps.getActiveTracks(ctx.trackRegistry);
  if (activeTracks.length < 1 || activeTracks.length > 2) {
    missing.push("TRACK_REGISTRY.json with 1-2 active tracks");
  }
  for (const track of activeTracks) {
    const trackId = deps.asString(track.track_id) ?? "unknown-track";
    const reasoningPacketDir = deps.asString(track.reasoning_packet_dir);
    const workingMemoryPath = deps.asString(track.working_memory_path);
    const synthesisPacketPath = deps.asString(track.synthesis_packet_path);
    if (!deps.trackHasGraphBackedInnovationEvidence(track)) {
      missing.push(`active track ${trackId} missing graph-backed innovation evidence`);
    }
    if (!reasoningPacketDir) {
      missing.push(`active track ${trackId} missing reasoning_packet_dir`);
    } else {
      const resolvedReasoningPacketDir = deps.resolveTrackArtifactPath(
        ctx.projectRoot,
        reasoningPacketDir
      );
      if (
        !resolvedReasoningPacketDir ||
        !(await deps.isNonEmptyDirectory(resolvedReasoningPacketDir))
      ) {
        missing.push(
          `active track ${trackId} requires a non-empty reasoning packet under ${reasoningPacketDir}`
        );
      }
    }
    if (!workingMemoryPath) {
      missing.push(`active track ${trackId} missing working_memory_path`);
    } else if (
      !(await deps.fileHasNonWhitespaceContent(
        deps.resolveTrackArtifactPath(ctx.projectRoot, workingMemoryPath)
      ))
    ) {
      missing.push(
        `active track ${trackId} working_memory_path must point to a non-empty artifact (${workingMemoryPath})`
      );
    }
    if (!synthesisPacketPath) {
      missing.push(`active track ${trackId} missing synthesis_packet_path`);
    } else if (
      !(await deps.fileHasNonWhitespaceContent(
        deps.resolveTrackArtifactPath(ctx.projectRoot, synthesisPacketPath)
      ))
    ) {
      missing.push(
        `active track ${trackId} synthesis_packet_path must point to a non-empty artifact (${synthesisPacketPath})`
      );
    }
  }

  missing.push(
    ...(await deps.getBrainstormCycleMissingSignals({
      projectRoot: ctx.projectRoot,
      manifest: ctx.manifest,
    }))
  );
  return missing;
}

export async function collectPlanStageMissingSignals(
  ctx: StageSignalsContext,
  deps: IdeationStageDeps
): Promise<string[]> {
  const missing: string[] = [];
  if (!(await deps.pathExists(path.join(ctx.projectRoot, "orchestrator", "PLAN.md")))) {
    missing.push("{PROJ}/orchestrator/PLAN.md");
  }
  if (!(await deps.pathExists(path.join(ctx.projectRoot, "orchestrator", "TODOS.md")))) {
    missing.push("{PROJ}/orchestrator/TODOS.md");
  }
  if (!(await deps.pathExists(path.join(ctx.projectRoot, "orchestrator", "PLAN_AUDIT.md")))) {
    missing.push("{PROJ}/orchestrator/PLAN_AUDIT.md");
  }

  const researchProgram = deps.normalizeResearchProgramState(
    ctx.manifest?.research_program
  );
  missing.push(...deps.getResearchProgramValidationErrors(researchProgram));

  const ideationContract = deps.normalizeIdeationContractState(
    ctx.manifest?.ideation_contract
  );
  missing.push(...deps.getIdeationContractValidationErrors(ideationContract));
  const proposalPath = deps.resolveProjectArtifactPath(
    ctx.projectRoot,
    ideationContract.researchProposalPath
  );
  if (!(await deps.fileHasNonWhitespaceContent(proposalPath))) {
    missing.push(
      `PROJECT_MANIFEST.json.ideation_contract.research_proposal_path must point to a non-empty artifact (${ideationContract.researchProposalPath ?? "unset"})`
    );
  }

  const ideaCatalyst = deps.normalizeIdeaCatalystState(ctx.manifest?.idea_catalyst);
  if (!isIdeaCatalystReadyForPlan(ideaCatalyst)) {
    missing.push(...deps.getIdeaCatalystValidationErrors(ideaCatalyst));
    const requisitionBlockingSignal =
      getIdeaCatalystRequisitionBlockingSignal(ideaCatalyst);
    if (requisitionBlockingSignal) {
      missing.push(requisitionBlockingSignal);
    }
  }
  for (const relativePath of getIdeaCatalystRequiredArtifactPaths(ideaCatalyst)) {
    if (!(await artifactHasMeaningfulContent(ctx.projectRoot, relativePath, deps))) {
      missing.push(`{PROJ}/${relativePath}`);
    }
  }

  const orchestrationState = deps.normalizeOrchestrationState(
    ctx.manifest?.orchestration_state
  );
  missing.push(
    ...deps.getOrchestrationStateValidationErrors(orchestrationState, "plan")
  );
  return missing;
}

export async function collectCodeStageMissingSignals(
  ctx: StageSignalsContext,
  deps: IdeationStageDeps
): Promise<string[]> {
  const missing = await deps.getCodeStageBundleMissingSignals({
    projectRoot: ctx.projectRoot,
    manifest: ctx.manifest,
  });
  if (!(await deps.pathExists(path.join(ctx.projectRoot, "coder", "EXPERIMENT_INDEX.md")))) {
    missing.push("{PROJ}/coder/EXPERIMENT_INDEX.md");
  }
  return missing;
}
