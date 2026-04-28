import { createHash } from "node:crypto";
import { upsertWorkflowHandoffIntent } from "./handoff-store";
import type {
  WorkflowHandoffIntent,
  WorkflowHandoffReason,
} from "./handoff-types";
import type { WorkflowHandoffHookGateRecord } from "../workflow-hooks/handoff-gates.js";

function hashFragment(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex")
    .slice(0, 16);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveRouteRevisionSegment(params: {
  manifestRevision?: string | number | null;
  routeRevision?: string | number | null;
  nextAction?: string | null;
}): string | number {
  if (params.routeRevision != null) {
    return params.routeRevision;
  }
  if (params.manifestRevision != null) {
    return "manifest-bound";
  }
  return hashFragment(params.nextAction);
}

export function buildStageOwnerHandoffIdempotencyKey(params: {
  projectId?: string | null;
  workflowLine?: string | null;
  stageAfter?: string | null;
  ownerAfter?: string | null;
  manifestRevision?: string | number | null;
  routeRevision?: string | number | null;
  nextAction?: string | null;
}): string {
  return [
    "stage_owner_change",
    params.projectId ?? "unknown-project",
    params.workflowLine ?? "experiment",
    params.stageAfter ?? "unknown-stage",
    params.ownerAfter ?? "unknown-owner",
    params.manifestRevision ?? "no-manifest-revision",
    resolveRouteRevisionSegment(params),
  ].join(":");
}

export async function createStageOwnerHandoffIntent(params: {
  projectRoot: string;
  projectId?: string | null;
  workflowLine?: "experiment" | "survey";
  stageBefore?: string | null;
  stageAfter?: string | null;
  ownerBefore?: string | null;
  ownerAfter: string;
  fromSessionKey?: string | null;
  sessionBindingKey?: string | null;
  preferredSessionKeys?: string[] | null;
  executionId?: string | null;
  summary?: string | null;
  acceptanceChecks?: string[] | null;
  resumeAction?: string | null;
  nextOwner?: string | null;
  nextTransitionCandidate?: string | null;
  nextMicroStage?: string | null;
  nextAction?: string | null;
  blockingReason?: string | null;
  missingStageSignals?: string[];
  manifestRevision?: string | number | null;
  routeRevision?: string | number | null;
  hookGate?: WorkflowHandoffHookGateRecord | null;
  deliveryPlan?: Parameters<typeof upsertWorkflowHandoffIntent>[0]["deliveryPlan"];
}): Promise<{ intent: WorkflowHandoffIntent; created: boolean }> {
  return upsertWorkflowHandoffIntent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    workflowLine: params.workflowLine ?? "experiment",
    idempotencyKey: buildStageOwnerHandoffIdempotencyKey(params),
    stage: readString(params.stageAfter),
    stageBefore: readString(params.stageBefore),
    stageAfter: readString(params.stageAfter),
    executionId: readString(params.executionId),
    fromRole: readString(params.ownerBefore),
    fromSessionKey: params.fromSessionKey,
    sessionBindingKey: readString(params.sessionBindingKey),
    preferredSessionKeys: params.preferredSessionKeys ?? null,
    toRole: params.ownerAfter,
    reason: "stage_owner_change",
    status: "prepared",
    summary:
      readString(params.summary) ??
      `Workflow owner handoff ${params.ownerBefore ?? "unknown"} -> ${params.ownerAfter}.`,
    command: params.nextAction,
    blockerSummary: params.blockingReason,
    payload: {
      stageBefore: params.stageBefore ?? null,
      stageAfter: params.stageAfter ?? null,
      ownerBefore: params.ownerBefore ?? null,
      ownerAfter: params.ownerAfter,
      nextAction: params.nextAction ?? null,
      resumeAction: params.resumeAction ?? null,
      acceptanceChecks: params.acceptanceChecks ?? [],
      nextOwner: params.nextOwner ?? null,
      nextTransitionCandidate: params.nextTransitionCandidate ?? null,
      nextMicroStage: params.nextMicroStage ?? null,
      executionId: params.executionId ?? null,
      missingStageSignals: params.missingStageSignals ?? [],
      ...(params.hookGate
        ? {
            hookGatePoint: params.hookGate.hookGatePoint,
            hookGateFingerprint: params.hookGate.hookGateFingerprint,
            hookGateVerdict: params.hookGate.hookGateVerdict,
            hookGateStatus: params.hookGate.hookGateStatus,
            hookGateCheckedAt: params.hookGate.hookGateCheckedAt,
            hookGatePolicyIds: params.hookGate.hookGatePolicyIds,
            hookGateRevisionPacketPath: params.hookGate.hookGateRevisionPacketPath,
          }
        : {}),
    },
    deliveryPlan: params.deliveryPlan,
  });
}

export function buildTaskHandoffIdempotencyKey(params: {
  projectId?: string | null;
  sourceTaskId?: string | null;
  targetTaskId?: string | null;
  artifactReceiptId?: string | null;
  reason?: WorkflowHandoffReason;
}): string {
  return [
    params.reason ?? "task_completed",
    params.projectId ?? "unknown-project",
    params.sourceTaskId ?? "no-source-task",
    params.targetTaskId ?? "no-target-task",
    params.artifactReceiptId ?? "no-receipt",
  ].join(":");
}

export async function createTaskUnlockedHandoffIntent(params: {
  projectRoot: string;
  projectId?: string | null;
  workflowLine?: "experiment" | "survey";
  stage?: string | null;
  fromRole?: string | null;
  fromSessionKey?: string | null;
  toRole: string;
  sourceTaskId?: string | null;
  targetTaskId?: string | null;
  artifactReceiptId?: string | null;
  summary?: string | null;
  command?: string | null;
  reason?: WorkflowHandoffReason;
}): Promise<{ intent: WorkflowHandoffIntent; created: boolean }> {
  const reason = params.reason ?? "dependency_unblocked";
  return upsertWorkflowHandoffIntent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    workflowLine: params.workflowLine ?? "experiment",
    idempotencyKey: buildTaskHandoffIdempotencyKey({ ...params, reason }),
    stage: params.stage,
    fromRole: params.fromRole,
    fromSessionKey: params.fromSessionKey,
    toRole: params.toRole,
    reason,
    sourceTaskId: params.sourceTaskId,
    targetTaskId: params.targetTaskId,
    artifactReceiptId: params.artifactReceiptId,
    summary: params.summary,
    command: params.command,
  });
}
