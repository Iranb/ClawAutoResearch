import {
  buildWorkflowSnapshot,
  materializeExperimentReviewState,
  materializeIdeationContract,
  materializeResultsStorylineState,
  materializeInnovationSynthesisState,
  materializeLiteratureDiscoveryPacket,
  materializePaperStoryState,
  materializeReviewPressurePacket,
  materializeSurveyReviewState,
  materializeTitleAbstractIntroWorkbenchState,
} from "./workflow-guard";
import { materializeIdeaCatalystState } from "./idea-catalyst/materializers";
import { queueIdeaCatalystRequisition } from "./idea-catalyst/workflow-bridge";
import { queueLiteratureDiscoveryRequisition } from "./literature-discovery/workflow-bridge";
import { materializePapernexusPacketContracts } from "./papernexus-packets/materializer";
import {
  maybeAutoBindChannelProject,
  type PluginRegistrationContext,
  type ToolContext,
} from "./plugin-registration-shared";
import {
  maybeRefreshGraphPresenceForSnapshot,
  reconcileBackgroundWorkflowStateForSnapshot,
} from "./workflow-runtime-refresh.js";
import { maybePrepareWorkflowStageContracts } from "./workflow-guard-runtime/stage-preflight";

type WorkflowSnapshot = Awaited<ReturnType<typeof buildWorkflowSnapshot>>;

export type ResolvedWorkflowSnapshotContext = {
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  snapshot: WorkflowSnapshot;
  stagePreflight: Awaited<ReturnType<typeof maybePrepareWorkflowStageContracts>> | null;
};

function shouldRunStagePreflight(snapshot: WorkflowSnapshot): boolean {
  return (
    snapshot.missingStageSignals.length > 0 ||
    snapshot.workflowEvidenceStatus === "repairable" ||
    snapshot.workflowEvidenceStatus === "missing"
  );
}

export async function resolveWorkflowSnapshotContext(params: {
  plugin: PluginRegistrationContext;
  agentCtx: ToolContext;
  channelKey?: string | null;
  autoBind?: boolean;
  stagePreflight?: boolean;
  preflightTrigger?: string | null;
}): Promise<ResolvedWorkflowSnapshotContext> {
  const workflowPolicy = params.plugin.getWorkflowPolicy();
  const buildSnapshot = () =>
    buildWorkflowSnapshot({
      policy: workflowPolicy,
      agentId: params.agentCtx.agentId,
      workspaceDir: params.agentCtx.workspaceDir,
      sessionKey: params.agentCtx.sessionKey,
      sessionId: params.agentCtx.sessionId,
      messageChannel: params.agentCtx.messageChannel,
      channelKey: params.channelKey ?? params.agentCtx.channelKey ?? undefined,
    });

  let snapshot = await buildSnapshot();
  await reconcileBackgroundWorkflowStateForSnapshot({
    snapshot,
    workflowPolicy,
    runtimeSubagent: params.plugin.api.runtime?.subagent,
  });
  snapshot = await buildSnapshot();

  if (
    await maybeRefreshGraphPresenceForSnapshot({
      snapshot,
      workflowPolicy,
    })
  ) {
    snapshot = await buildSnapshot();
  }

  if (params.autoBind !== false) {
    await maybeAutoBindChannelProject({
      policy: workflowPolicy,
      agentCtx: params.agentCtx,
      snapshot,
    });
    snapshot = await buildSnapshot();
  }

  let stagePreflight: Awaited<ReturnType<typeof maybePrepareWorkflowStageContracts>> | null =
    null;
  if (
    params.stagePreflight === true &&
    snapshot.projectRoot &&
    snapshot.currentStage &&
    shouldRunStagePreflight(snapshot)
  ) {
    stagePreflight = await maybePrepareWorkflowStageContracts({
      projectRoot: snapshot.projectRoot,
      stage: snapshot.currentStage,
      agentId: params.agentCtx.agentId ?? null,
      trigger: params.preflightTrigger ?? "workflow_snapshot_read",
      deps: {
        materializeIdeationContract,
        materializePaperStoryState,
        materializeReviewPressurePacket,
        materializeExperimentReviewState,
        materializeSurveyReviewState,
        materializeInnovationSynthesisState,
        materializeResultsStoryline: materializeResultsStorylineState,
        materializeTitleAbstractIntroWorkbench:
          materializeTitleAbstractIntroWorkbenchState,
        materializeIdeaCatalystState,
        materializeLiteratureDiscoveryPacket,
        materializePapernexusPacketContracts,
        queueIdeaCatalystRequisition,
        queueLiteratureDiscoveryRequisition,
      },
    });
    if (
      stagePreflight.materializedContracts.length > 0 ||
      stagePreflight.errors.length > 0
    ) {
      snapshot = await buildSnapshot();
    }
  }

  return {
    workflowPolicy,
    snapshot,
    stagePreflight,
  };
}
