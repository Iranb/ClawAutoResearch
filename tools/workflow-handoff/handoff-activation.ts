import path from "node:path";

import {
  asRecord,
  normalizeStage,
  pickString,
} from "../workflow-guard-core/coercion";
import {
  readJsonIfExists,
  writeJsonEnsured,
} from "../workflow-guard-core/fs";
import {
  normalizeOrchestrationState,
  serializeOrchestrationState,
} from "../workflow-guard-state/execution-state";
import {
  activateWorkflowHandoffIntent,
  claimWorkflowHandoffIntent,
  readWorkflowHandoffIntentStore,
} from "./handoff-store";
import type { WorkflowHandoffIntent } from "./handoff-types";

type ManifestLike = Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getManifestPath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), "PROJECT_MANIFEST.json");
}

async function readManifest(projectRoot: string): Promise<ManifestLike> {
  return (
    (await readJsonIfExists<ManifestLike>(getManifestPath(projectRoot))) ?? {}
  );
}

async function writeManifest(projectRoot: string, manifest: ManifestLike): Promise<void> {
  await writeJsonEnsured(getManifestPath(projectRoot), manifest);
}

function getIntentPayload(intent: WorkflowHandoffIntent): Record<string, unknown> {
  return asRecord(intent.payload) ?? {};
}

export async function syncPreparedWorkflowHandoffToManifest(params: {
  projectRoot: string;
  intent: WorkflowHandoffIntent;
}): Promise<void> {
  const manifest = await readManifest(params.projectRoot);
  const orchestration = normalizeOrchestrationState(manifest.orchestration_state);
  const payload = getIntentPayload(params.intent);
  const nextState = {
    ...orchestration,
    currentOwner:
      orchestration.currentOwner ??
      readString(manifest.owner_agent) ??
      params.intent.fromRole ??
      null,
    currentExecutionId:
      params.intent.executionId ??
      orchestration.currentExecutionId ??
      orchestration.stageRunId,
    pendingHandoffId: params.intent.intentId,
    pendingOwnerCandidate: params.intent.toRole,
    pendingStageCandidate:
      params.intent.stageAfter ??
      readString(payload.stageAfter) ??
      params.intent.stage,
    handoffPhase:
      params.intent.status === "activated" || params.intent.status === "completed"
        ? "activated"
        : params.intent.status === "claimed"
          ? "claimed"
          : params.intent.status === "acknowledged" ||
              params.intent.status === "delivered" ||
              params.intent.status === "dispatched" ||
              params.intent.status === "dispatching" ||
              params.intent.status === "queued"
            ? "dispatched"
            : "prepared",
    ownerClaimedAt: params.intent.claimedAt ?? orchestration.ownerClaimedAt,
    ownerActivationDeadline:
      params.intent.deliveryPlan.ackDeadlineAt ?? orchestration.ownerActivationDeadline,
    rollbackTargetOwner:
      params.intent.fromRole ??
      orchestration.rollbackTargetOwner ??
      orchestration.currentOwner,
    lastHandoffError: null,
    nextOwner:
      readString(payload.nextOwner) ??
      orchestration.nextOwner,
    nextTransitionCandidate:
      readString(payload.nextTransitionCandidate) ??
      orchestration.nextTransitionCandidate,
    lastUpdatedAt: nowIso(),
  };
  manifest.orchestration_state = serializeOrchestrationState(nextState);
  await writeManifest(params.projectRoot, manifest);
}

function selectClaimableIntentForRole(params: {
  intents: WorkflowHandoffIntent[];
  role: string;
  pendingHandoffId: string | null;
}): WorkflowHandoffIntent | null {
  const claimable = params.intents.filter((intent) => {
    if (intent.toRole !== params.role) {
      return false;
    }
    return [
      "prepared",
      "pending",
      "queued",
      "dispatching",
      "dispatched",
      "delivered",
      "acknowledged",
      "failed",
      "stale_claim",
    ].includes(intent.status);
  });
  if (claimable.length === 0) {
    return null;
  }
  if (params.pendingHandoffId) {
    return (
      claimable.find((intent) => intent.intentId === params.pendingHandoffId) ?? null
    );
  }
  return claimable.sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  )[0] ?? null;
}

export async function claimAndActivateWorkflowHandoffForAgent(params: {
  projectRoot: string;
  role: string;
  sessionKey?: string | null;
  claimLeaseMs?: number | null;
}): Promise<{
  intent: WorkflowHandoffIntent | null;
  claimed: boolean;
  activated: boolean;
}> {
  const manifest = await readManifest(params.projectRoot);
  const orchestration = normalizeOrchestrationState(manifest.orchestration_state);
  const store = await readWorkflowHandoffIntentStore(params.projectRoot);
  const selectedIntent = selectClaimableIntentForRole({
    intents: store.intents,
    role: params.role,
    pendingHandoffId: orchestration.pendingHandoffId,
  });
  if (!selectedIntent) {
    return { intent: null, claimed: false, activated: false };
  }

  const leaseExpiresAt =
    typeof params.claimLeaseMs === "number" && Number.isFinite(params.claimLeaseMs)
      ? new Date(Date.now() + Math.max(0, Math.floor(params.claimLeaseMs))).toISOString()
      : null;
  const claimedIntent =
    (await claimWorkflowHandoffIntent({
      projectRoot: params.projectRoot,
      intentId: selectedIntent.intentId,
      sessionKey: readString(params.sessionKey),
      claimLeaseExpiresAt: leaseExpiresAt,
    })) ?? selectedIntent;

  const payload = getIntentPayload(claimedIntent);
  const stageAfter =
    claimedIntent.stageAfter ??
    readString(payload.stageAfter) ??
    claimedIntent.stage;
  const currentOwner =
    orchestration.currentOwner ?? readString(manifest.owner_agent);
  const pendingOwnerCandidate =
    orchestration.pendingOwnerCandidate ?? claimedIntent.toRole;
  const pendingStageCandidate =
    orchestration.pendingStageCandidate ?? stageAfter;
  const activationEligible =
    (!orchestration.pendingHandoffId ||
      orchestration.pendingHandoffId === claimedIntent.intentId) &&
    pendingOwnerCandidate === claimedIntent.toRole &&
    (!pendingStageCandidate || !stageAfter || pendingStageCandidate === stageAfter);

  if (!activationEligible) {
    await syncPreparedWorkflowHandoffToManifest({
      projectRoot: params.projectRoot,
      intent: claimedIntent,
    });
    return { intent: claimedIntent, claimed: true, activated: false };
  }

  const nextAction =
    readString(payload.nextAction) ?? claimedIntent.command ?? readString(manifest.next_action);
  const resumeAction =
    readString(payload.resumeAction) ?? nextAction ?? readString(manifest.resume_action);
  const blockingReason =
    readString(payload.blockingReason) ??
    claimedIntent.blockerSummary ??
    readString(manifest.blocking_reason);
  const nextMicroStage = normalizeStage(payload.nextMicroStage);

  manifest.current_stage = stageAfter ?? manifest.current_stage;
  manifest.owner_agent = claimedIntent.toRole;
  if (nextMicroStage) {
    manifest.current_micro_stage = nextMicroStage;
  }
  manifest.next_action = nextAction;
  manifest.resume_action = resumeAction;
  manifest.blocking_reason = blockingReason;
  manifest.last_handoff_at = nowIso();
  manifest.orchestration_state = serializeOrchestrationState({
    ...orchestration,
    currentOwner: claimedIntent.toRole,
    currentExecutionId:
      claimedIntent.executionId ??
      orchestration.currentExecutionId ??
      claimedIntent.intentId,
    pendingHandoffId: null,
    pendingOwnerCandidate: null,
    pendingStageCandidate: null,
    handoffPhase: "activated",
    ownerClaimedAt: claimedIntent.claimedAt ?? nowIso(),
    ownerActivationDeadline: null,
    rollbackTargetOwner: null,
    lastHandoffError: null,
    nextOwner:
      readString(payload.nextOwner) ??
      orchestration.nextOwner,
    nextTransitionCandidate:
      readString(payload.nextTransitionCandidate) ??
      orchestration.nextTransitionCandidate,
    blockingReason,
    lastUpdatedAt: nowIso(),
  });
  await writeManifest(params.projectRoot, manifest);

  const activatedIntent =
    (await activateWorkflowHandoffIntent({
      projectRoot: params.projectRoot,
      intentId: claimedIntent.intentId,
    })) ?? claimedIntent;
  return {
    intent: activatedIntent,
    claimed: true,
    activated: true,
  };
}
