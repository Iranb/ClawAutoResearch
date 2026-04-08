import * as fs from "node:fs/promises";
import {
  normalizeIdeationContractState,
} from "../workflow-guard-state/ideation-contract";
import { normalizePaperIngestionState } from "../workflow-guard-state/paper-ingestion";
import { normalizePaperStoryState } from "../workflow-guard-state/paper-story";
import { normalizeReviewPressurePacketState } from "../workflow-guard-state/review-pressure";
import { normalizeIdeaCatalystState } from "../idea-catalyst/state";
import { hasActiveIdeaCatalystRequisitionRequest } from "../idea-catalyst/workflow-bridge";
import {
  DEFAULT_LITERATURE_DISCOVERY_PACKET_PATH,
  needsStoryGapLiteratureDiscovery,
} from "../literature-discovery/materializer";
import { hasActiveLiteratureDiscoveryRequest } from "../literature-discovery/workflow-bridge";
import { materializeCycleMemory } from "../research-memory-cycle";
import {
  DEFAULT_IDEA_CATALYST_PACKET_BUNDLE_PATH,
  materializePapernexusPacketContracts,
} from "../papernexus-packets/materializer";
import { materializeWritingSupportArtifacts } from "../research-writing/materializers";
import { pathExists, readJsonIfExists } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";

type ManifestLike = Record<string, unknown>;

type StagePreflightDeps = {
  materializeIdeationContract: (params: {
    projectRoot: string;
    ideationMaterialization?: Record<string, unknown>;
    trigger?: string | null;
    agentId?: string | null;
  }) => Promise<unknown>;
  materializePaperStoryState: (params: {
    projectRoot: string;
    paperStoryMaterialization?: Record<string, unknown>;
    trigger?: string | null;
    agentId?: string | null;
  }) => Promise<unknown>;
  materializeReviewPressurePacket: (params: {
    projectRoot: string;
    reviewPressureMaterialization?: Record<string, unknown>;
    trigger?: string | null;
    agentId?: string | null;
  }) => Promise<unknown>;
  materializeIdeaCatalystState: (params: {
    projectRoot: string;
    ideaCatalystMaterialization?: Record<string, unknown>;
    trigger?: string | null;
    agentId?: string | null;
  }) => Promise<unknown>;
  materializeLiteratureDiscoveryPacket: (params: {
    projectRoot: string;
    literatureDiscoveryMaterialization?: Record<string, unknown>;
    trigger?: string | null;
    agentId?: string | null;
  }) => Promise<unknown>;
  materializePapernexusPacketContracts?: (params: {
    projectRoot: string;
    trigger?: string | null;
    agentId?: string | null;
  }) => Promise<unknown>;
  queueIdeaCatalystRequisition: (params: {
    projectRoot: string;
    trigger?: string | null;
    agentId?: string | null;
  }) => Promise<unknown>;
  queueLiteratureDiscoveryRequisition: (params: {
    projectRoot: string;
    packetPath: string;
    triggerKind?: string | null;
    originStage?: string | null;
    summary?: string | null;
    sharedCorpus?: string | null;
    requestIdPrefix?: string | null;
  }) => Promise<unknown>;
};

const IDEA_CATALYST_PREP_STAGES = new Set([
  "idea",
  "plan",
  "code",
  "experiment",
  "analyze",
  "review",
  "write",
  "submit",
]);
const PAPERNEXUS_PACKET_PREP_STAGES = new Set([
  "idea",
  "plan",
  "code",
  "experiment",
  "analyze",
  "review",
  "write",
  "submit",
]);
const IDEATION_PREP_STAGES = new Set([
  "plan",
  "code",
  "experiment",
  "analyze",
  "review",
  "write",
  "submit",
]);
const PAPER_STORY_PREP_STAGES = new Set([
  "plan",
  "code",
  "experiment",
  "analyze",
  "review",
  "write",
  "submit",
]);
const REVIEW_PRESSURE_PREP_STAGES = new Set(["review", "write", "submit"]);
const LITERATURE_DISCOVERY_PREP_STAGES = new Set([
  "idea",
  "review",
  "write",
  "submit",
]);
const WRITING_SUPPORT_PREP_STAGES = new Set(["plan", "write", "review", "submit"]);
const CYCLE_MEMORY_PREP_STAGES = new Set(["idea", "review", "write", "submit"]);

function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function hasTerminalIdeaCatalystRequisitionRequest(manifest: ManifestLike): boolean {
  const paperIngestion = normalizePaperIngestionState(manifest.paper_ingestion);
  return paperIngestion.queuedRequests.some(
    (entry) =>
      entry.triggerKind === "idea_catalyst_requisition" &&
      ["completed", "failed"].includes(String(entry.status ?? "").trim().toLowerCase())
  );
}

async function readPathMtimeMsIfExists(targetPath: string | null): Promise<number | null> {
  if (!targetPath) {
    return null;
  }
  try {
    const stat = await fs.stat(targetPath);
    return stat.mtimeMs;
  } catch {
    return null;
  }
}

async function anyArtifactMissing(
  projectRoot: string,
  artifactPaths: Array<string | null | undefined>
): Promise<boolean> {
  for (const artifactPath of artifactPaths) {
    const resolved = resolveProjectArtifactPath(projectRoot, artifactPath ?? null);
    if (!resolved || !(await pathExists(resolved))) {
      return true;
    }
  }
  return false;
}

async function latestArtifactMtimeMs(
  projectRoot: string,
  artifactPaths: Array<string | null | undefined>
): Promise<number | null> {
  let latest: number | null = null;
  for (const artifactPath of artifactPaths) {
    const resolved = resolveProjectArtifactPath(projectRoot, artifactPath ?? null);
    const mtimeMs = await readPathMtimeMsIfExists(resolved);
    if (mtimeMs === null) {
      continue;
    }
    latest = latest === null ? mtimeMs : Math.max(latest, mtimeMs);
  }
  return latest;
}

async function shouldMaterializeIdeationContract(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !IDEATION_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const state = normalizeIdeationContractState(params.manifest.ideation_contract);
  if (state.status !== "ready") {
    return true;
  }
  return anyArtifactMissing(params.projectRoot, [
    state.graphIdeationPacketPath,
    state.ideaTreePath,
    state.noveltyTreePath,
    state.challengeInsightTreePath,
    state.solutionCheckPath,
    state.crossDomainTransferPath,
    state.problemDecompositionPath,
    state.candidatePoolPath,
    state.rankingHistoryPath,
    state.tournamentScoreboardPath,
    state.top3SummaryPath,
    state.researchProposalPath,
  ]);
}

async function shouldMaterializeIdeaCatalyst(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !IDEA_CATALYST_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const ideationState = normalizeIdeationContractState(params.manifest.ideation_contract);
  if (ideationState.status !== "ready") {
    return false;
  }
  const state = normalizeIdeaCatalystState(params.manifest.idea_catalyst);
  if (state.status === "requisition") {
    return !hasActiveIdeaCatalystRequisitionRequest({
      ideaCatalyst: state,
      paperIngestion: normalizePaperIngestionState(params.manifest.paper_ingestion),
    });
  }
  if (state.status !== "ready") {
    return true;
  }
  return anyArtifactMissing(params.projectRoot, [
    state.decompositionPacketPath,
    state.abstractionPacketPath,
    state.scoutingReportPath,
    state.gateDecisionPath,
    state.ideaFragmentsPath,
    state.rankedFragmentsPath,
  ]);
}

async function shouldQueueIdeaCatalystRequisition(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !IDEA_CATALYST_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const ideaCatalyst = normalizeIdeaCatalystState(params.manifest.idea_catalyst);
  if (!ideaCatalyst.requisitionRequired && ideaCatalyst.status !== "requisition") {
    return false;
  }
  if (ideaCatalyst.requisitionSaturated) {
    return false;
  }
  if (hasTerminalIdeaCatalystRequisitionRequest(params.manifest)) {
    return false;
  }
  return !hasActiveIdeaCatalystRequisitionRequest({
    ideaCatalyst,
    paperIngestion: normalizePaperIngestionState(params.manifest.paper_ingestion),
  });
}

async function shouldMaterializePaperStory(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !PAPER_STORY_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const ideationState = normalizeIdeationContractState(params.manifest.ideation_contract);
  if (ideationState.status !== "ready") {
    return false;
  }
  const state = normalizePaperStoryState(params.manifest.paper_story_state);
  if (state.status !== "ready") {
    return true;
  }
  if (
    await anyArtifactMissing(params.projectRoot, [
      state.taskSummaryPath,
      state.challengeStatementPath,
      state.insightSummaryPath,
      state.contributionMapPath,
      state.advantageMapPath,
      state.storySpinePath,
      state.pipelineFigureSketchPath,
      state.moduleMotivationMapPath,
      state.claimToExperimentMapPath,
      state.fallbackNarrativePath,
      state.rejectionRiskTablePath,
    ])
  ) {
    return true;
  }
  const stateTimestamp = parseTimestampMs(state.lastUpdatedAt);
  if (stateTimestamp === null) {
    return true;
  }
  const sourceTimestamp = await latestArtifactMtimeMs(params.projectRoot, [
    ideationState.researchProposalPath,
    ideationState.problemDecompositionPath,
    ideationState.graphIdeationPacketPath,
    ideationState.graphBasisPaths.storylineBriefPath,
    state.claimEvidenceMatrixPath,
    state.trackVerdictsPath,
    state.unsupportedClaimsPath,
  ]);
  return sourceTimestamp !== null && sourceTimestamp > stateTimestamp;
}

async function shouldMaterializeReviewPressure(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !REVIEW_PRESSURE_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const paperStoryState = normalizePaperStoryState(params.manifest.paper_story_state);
  if (paperStoryState.status !== "ready") {
    return false;
  }
  const state = normalizeReviewPressurePacketState(params.manifest.review_pressure_packet);
  if (state.status !== "ready") {
    return true;
  }
  if (
    await anyArtifactMissing(params.projectRoot, [
      state.rejectFirstReviewPath,
      state.noveltyAttackPath,
      state.unsupportedClaimAuditPath,
      state.reverseOutlinePath,
      state.figureTableQcPath,
      state.limitationAuditPath,
    ])
  ) {
    return true;
  }
  const stateTimestamp = parseTimestampMs(state.lastUpdatedAt);
  if (stateTimestamp === null) {
    return true;
  }
  const sourceTimestamp = await latestArtifactMtimeMs(params.projectRoot, [
    paperStoryState.storySpinePath,
    paperStoryState.claimToExperimentMapPath,
    paperStoryState.fallbackNarrativePath,
    paperStoryState.rejectionRiskTablePath,
  ]);
  return sourceTimestamp !== null && sourceTimestamp > stateTimestamp;
}

async function shouldMaterializeLiteratureDiscoveryPacket(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !LITERATURE_DISCOVERY_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const packetResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    DEFAULT_LITERATURE_DISCOVERY_PACKET_PATH
  );
  const packetExists = Boolean(packetResolvedPath && (await pathExists(packetResolvedPath)));
  const storyGapRequired = needsStoryGapLiteratureDiscovery({
    manifest: params.manifest,
    stage: params.stage,
  });
  if (!storyGapRequired && !packetExists) {
    return false;
  }
  if (!packetResolvedPath || !(await pathExists(packetResolvedPath))) {
    return true;
  }
  const packetTimestamp = await readPathMtimeMsIfExists(packetResolvedPath);
  if (packetTimestamp === null) {
    return true;
  }
  const paperStory = normalizePaperStoryState(params.manifest.paper_story_state);
  const reviewPressure = normalizeReviewPressurePacketState(params.manifest.review_pressure_packet);
  const sourceTimestamp = await latestArtifactMtimeMs(params.projectRoot, [
    paperStory.challengeStatementPath,
    paperStory.insightSummaryPath,
    paperStory.unsupportedClaimsPath,
    paperStory.rejectionRiskTablePath,
    reviewPressure.rejectFirstReviewPath,
    reviewPressure.noveltyAttackPath,
    reviewPressure.limitationAuditPath,
  ]);
  return sourceTimestamp !== null && sourceTimestamp > packetTimestamp;
}

async function shouldMaterializePapernexusPacketContracts(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !PAPERNEXUS_PACKET_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const mechanismPacketPath = resolveProjectArtifactPath(
    params.projectRoot,
    "researcher/papernexus/MECHANISM_BRIDGE_PACKET.json"
  );
  const challengePacketPath = resolveProjectArtifactPath(
    params.projectRoot,
    "researcher/papernexus/CHALLENGE_INSIGHT_PACKET.json"
  );
  const storylinePacketPath = resolveProjectArtifactPath(
    params.projectRoot,
    "researcher/papernexus/GRAPH_STORYLINE_PACKET.json"
  );
  const ideaCatalystBundlePath = resolveProjectArtifactPath(
    params.projectRoot,
    DEFAULT_IDEA_CATALYST_PACKET_BUNDLE_PATH
  );
  if (
    (mechanismPacketPath && (await pathExists(mechanismPacketPath))) ||
    (challengePacketPath && (await pathExists(challengePacketPath))) ||
    (storylinePacketPath && (await pathExists(storylinePacketPath))) ||
    (ideaCatalystBundlePath && (await pathExists(ideaCatalystBundlePath)))
  ) {
    return true;
  }
  return false;
}

async function shouldQueueLiteratureDiscoveryRequisition(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !LITERATURE_DISCOVERY_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const packetResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    DEFAULT_LITERATURE_DISCOVERY_PACKET_PATH
  );
  const packetExists = Boolean(packetResolvedPath && (await pathExists(packetResolvedPath)));
  if (
    !packetExists &&
    !needsStoryGapLiteratureDiscovery({ manifest: params.manifest, stage: params.stage })
  ) {
    return false;
  }
  return !hasActiveLiteratureDiscoveryRequest({
    paperIngestion: normalizePaperIngestionState(params.manifest.paper_ingestion),
  });
}

async function shouldMaterializeWritingSupport(params: {
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !WRITING_SUPPORT_PREP_STAGES.has(params.stage)) {
    return false;
  }
  const paperStory = normalizePaperStoryState(params.manifest.paper_story_state);
  return paperStory.status === "ready";
}

async function shouldRefreshCycleMemory(params: {
  stage: string | null;
}): Promise<boolean> {
  return Boolean(params.stage && CYCLE_MEMORY_PREP_STAGES.has(params.stage));
}

export async function maybePrepareWorkflowStageContracts(params: {
  projectRoot: string;
  manifest?: ManifestLike | null;
  stage: string | null;
  agentId?: string | null;
  trigger?: string | null;
  deps: StagePreflightDeps;
}): Promise<{
  manifest: ManifestLike;
  materializedContracts: string[];
  errors: Array<{ contract: string; message: string }>;
}> {
  const projectRoot = params.projectRoot;
  let manifest =
    params.manifest ??
    ((await readJsonIfExists<ManifestLike>(resolveProjectArtifactPath(projectRoot, "PROJECT_MANIFEST.json"))) ??
      {});
  const materializedContracts: string[] = [];
  const errors: Array<{ contract: string; message: string }> = [];
  const trigger = params.trigger ?? "stage_preflight";

  const runStep = async (
    contract: string,
    shouldRun: (input: { projectRoot: string; manifest: ManifestLike; stage: string | null }) => Promise<boolean>,
    action: () => Promise<unknown>
  ) => {
    if (!(await shouldRun({ projectRoot, manifest, stage: params.stage }))) {
      return;
    }
    try {
      await action();
      materializedContracts.push(contract);
      manifest =
        (await readJsonIfExists<ManifestLike>(
          resolveProjectArtifactPath(projectRoot, "PROJECT_MANIFEST.json")
        )) ?? manifest;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ contract, message });
    }
  };

  await runStep("papernexus_packet_contracts", shouldMaterializePapernexusPacketContracts, () =>
    (params.deps.materializePapernexusPacketContracts ?? materializePapernexusPacketContracts)({
      projectRoot,
      trigger,
      agentId: params.agentId ?? null,
    })
  );

  await runStep("ideation_contract", shouldMaterializeIdeationContract, () =>
    params.deps.materializeIdeationContract({
      projectRoot,
      trigger,
      agentId: params.agentId ?? null,
      ideationMaterialization: {
        basis_stage: params.stage,
      },
    })
  );
  await runStep("idea_catalyst_requisition", shouldQueueIdeaCatalystRequisition, () =>
    params.deps.queueIdeaCatalystRequisition({
      projectRoot,
      trigger,
      agentId: params.agentId ?? null,
    })
  );
  await runStep("idea_catalyst", shouldMaterializeIdeaCatalyst, () =>
    params.deps.materializeIdeaCatalystState({
      projectRoot,
      trigger,
      agentId: params.agentId ?? null,
      ideaCatalystMaterialization: {
        basis_stage: params.stage,
      },
    })
  );
  await runStep("paper_story_state", shouldMaterializePaperStory, () =>
    params.deps.materializePaperStoryState({
      projectRoot,
      trigger,
      agentId: params.agentId ?? null,
      paperStoryMaterialization: {
        basis_stage: params.stage,
      },
    })
  );
  await runStep("review_pressure_packet", shouldMaterializeReviewPressure, () =>
    params.deps.materializeReviewPressurePacket({
      projectRoot,
      trigger,
      agentId: params.agentId ?? null,
      reviewPressureMaterialization: {
        basis_stage: params.stage,
      },
    })
  );
  await runStep(
    "literature_discovery_packet",
    shouldMaterializeLiteratureDiscoveryPacket,
    () =>
      params.deps.materializeLiteratureDiscoveryPacket({
        projectRoot,
        trigger,
        agentId: params.agentId ?? null,
        literatureDiscoveryMaterialization: {
          origin_stage: params.stage,
        },
      })
  );
  await runStep(
    "literature_discovery_requisition",
    shouldQueueLiteratureDiscoveryRequisition,
    async () => {
      const packetPath = resolveProjectArtifactPath(
        projectRoot,
        DEFAULT_LITERATURE_DISCOVERY_PACKET_PATH
      );
      const packet =
        (await readJsonIfExists<Record<string, unknown>>(packetPath ?? "")) ?? {};
      const packetTriggerKind =
        typeof packet.trigger_kind === "string"
          ? packet.trigger_kind
          : typeof packet.triggerKind === "string"
            ? packet.triggerKind
            : null;
      const packetSummary =
        typeof packet.discovery_reason === "string"
          ? packet.discovery_reason
          : typeof packet.discoveryReason === "string"
            ? packet.discoveryReason
            : null;
      const packetRequestId =
        typeof packet.discovery_id === "string"
          ? packet.discovery_id
          : typeof packet.discoveryId === "string"
            ? packet.discoveryId
            : null;
      return params.deps.queueLiteratureDiscoveryRequisition({
        projectRoot,
        packetPath: DEFAULT_LITERATURE_DISCOVERY_PACKET_PATH,
        triggerKind: packetTriggerKind ?? `${params.stage ?? "review"}_literature_discovery`,
        originStage: params.stage,
        summary:
          packetSummary ??
          `Workflow-owned ${params.stage ?? "review"} literature discovery rerun for story support gaps.`,
        requestIdPrefix: packetRequestId ?? `${params.stage ?? "review"}-literature-discovery`,
      });
    }
  );
  await runStep("writing_support_artifacts", shouldMaterializeWritingSupport, async () => {
    const paperStoryState = normalizePaperStoryState(manifest.paper_story_state);
    const reviewPressureState = normalizeReviewPressurePacketState(
      manifest.review_pressure_packet
    );
    await materializeWritingSupportArtifacts({
      projectRoot,
      stage: params.stage,
      paperStoryState,
      reviewPressureState,
    });
  });
  await runStep("cycle_memory", shouldRefreshCycleMemory, async () => {
    await materializeCycleMemory({
      projectRoot,
      stage: params.stage,
    });
  });

  return {
    manifest,
    materializedContracts,
    errors,
  };
}
