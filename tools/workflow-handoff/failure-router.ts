import {
  createWorkflowRepairQueueItem,
  updateWorkflowRepairQueueItem,
} from "./repair-queue";
import { upsertWorkflowHandoffIntent } from "./handoff-store";
import type {
  WorkflowHandoffIntent,
  WorkflowHandoffReason,
} from "./handoff-types";

export type WorkflowFailureRoutingPolicy = {
  failureKind: WorkflowHandoffReason;
  repairOwner: string;
  fallbackOwners: string[];
  createRepairTask: boolean;
  deliveryPriority: "low" | "normal" | "high" | "urgent";
};

export const WORKFLOW_FAILURE_ROUTING_POLICIES: Record<
  WorkflowHandoffReason,
  WorkflowFailureRoutingPolicy
> = {
  stage_owner_change: {
    failureKind: "stage_owner_change",
    repairOwner: "orchestrator",
    fallbackOwners: ["researcher"],
    createRepairTask: false,
    deliveryPriority: "normal",
  },
  task_completed: {
    failureKind: "task_completed",
    repairOwner: "orchestrator",
    fallbackOwners: ["researcher"],
    createRepairTask: false,
    deliveryPriority: "normal",
  },
  dependency_unblocked: {
    failureKind: "dependency_unblocked",
    repairOwner: "orchestrator",
    fallbackOwners: ["researcher"],
    createRepairTask: false,
    deliveryPriority: "normal",
  },
  verification_failed: {
    failureKind: "verification_failed",
    repairOwner: "orchestrator",
    fallbackOwners: ["researcher"],
    createRepairTask: true,
    deliveryPriority: "high",
  },
  code_review_required: {
    failureKind: "code_review_required",
    repairOwner: "reviewer",
    fallbackOwners: ["orchestrator"],
    createRepairTask: true,
    deliveryPriority: "high",
  },
  code_review_failed: {
    failureKind: "code_review_failed",
    repairOwner: "coder",
    fallbackOwners: ["orchestrator"],
    createRepairTask: true,
    deliveryPriority: "high",
  },
  plan_review_required: {
    failureKind: "plan_review_required",
    repairOwner: "orchestrator",
    fallbackOwners: ["researcher"],
    createRepairTask: true,
    deliveryPriority: "high",
  },
  plan_inconsistent: {
    failureKind: "plan_inconsistent",
    repairOwner: "orchestrator",
    fallbackOwners: ["researcher"],
    createRepairTask: true,
    deliveryPriority: "high",
  },
  paper_ingestion_failed: {
    failureKind: "paper_ingestion_failed",
    repairOwner: "researcher",
    fallbackOwners: ["orchestrator"],
    createRepairTask: true,
    deliveryPriority: "urgent",
  },
  graph_presence_failed: {
    failureKind: "graph_presence_failed",
    repairOwner: "researcher",
    fallbackOwners: ["orchestrator"],
    createRepairTask: true,
    deliveryPriority: "urgent",
  },
  survey_review_required: {
    failureKind: "survey_review_required",
    repairOwner: "researcher",
    fallbackOwners: ["orchestrator"],
    createRepairTask: true,
    deliveryPriority: "high",
  },
  survey_route_drift: {
    failureKind: "survey_route_drift",
    repairOwner: "researcher",
    fallbackOwners: ["orchestrator"],
    createRepairTask: true,
    deliveryPriority: "urgent",
  },
  paper_review_required: {
    failureKind: "paper_review_required",
    repairOwner: "reviewer",
    fallbackOwners: ["academic_writer", "orchestrator"],
    createRepairTask: true,
    deliveryPriority: "high",
  },
  cross_domain_evidence_missing: {
    failureKind: "cross_domain_evidence_missing",
    repairOwner: "researcher",
    fallbackOwners: ["orchestrator"],
    createRepairTask: true,
    deliveryPriority: "high",
  },
  tool_unavailable: {
    failureKind: "tool_unavailable",
    repairOwner: "researcher",
    fallbackOwners: ["orchestrator"],
    createRepairTask: true,
    deliveryPriority: "urgent",
  },
  runtime_unavailable: {
    failureKind: "runtime_unavailable",
    repairOwner: "orchestrator",
    fallbackOwners: ["researcher"],
    createRepairTask: true,
    deliveryPriority: "urgent",
  },
  capability_stale: {
    failureKind: "capability_stale",
    repairOwner: "orchestrator",
    fallbackOwners: ["researcher"],
    createRepairTask: true,
    deliveryPriority: "high",
  },
  handoff_ack_timeout: {
    failureKind: "handoff_ack_timeout",
    repairOwner: "orchestrator",
    fallbackOwners: ["researcher"],
    createRepairTask: false,
    deliveryPriority: "high",
  },
  discord_inbound_timeout: {
    failureKind: "discord_inbound_timeout",
    repairOwner: "orchestrator",
    fallbackOwners: ["researcher"],
    createRepairTask: false,
    deliveryPriority: "normal",
  },
  inbound_budget_exceeded: {
    failureKind: "inbound_budget_exceeded",
    repairOwner: "orchestrator",
    fallbackOwners: ["researcher"],
    createRepairTask: false,
    deliveryPriority: "normal",
  },
  broadcast_delivery_timeout: {
    failureKind: "broadcast_delivery_timeout",
    repairOwner: "orchestrator",
    fallbackOwners: ["researcher"],
    createRepairTask: false,
    deliveryPriority: "normal",
  },
  stale_claim: {
    failureKind: "stale_claim",
    repairOwner: "orchestrator",
    fallbackOwners: ["researcher"],
    createRepairTask: true,
    deliveryPriority: "high",
  },
  write_scope_conflict: {
    failureKind: "write_scope_conflict",
    repairOwner: "orchestrator",
    fallbackOwners: ["researcher"],
    createRepairTask: false,
    deliveryPriority: "normal",
  },
  exec_approval_required: {
    failureKind: "exec_approval_required",
    repairOwner: "researcher",
    fallbackOwners: ["orchestrator"],
    createRepairTask: true,
    deliveryPriority: "urgent",
  },
  manual_recovery: {
    failureKind: "manual_recovery",
    repairOwner: "orchestrator",
    fallbackOwners: ["researcher"],
    createRepairTask: true,
    deliveryPriority: "high",
  },
};

export function getWorkflowFailureRoutingPolicy(
  failureKind: WorkflowHandoffReason
): WorkflowFailureRoutingPolicy {
  return WORKFLOW_FAILURE_ROUTING_POLICIES[failureKind];
}

export async function routeWorkflowFailure(params: {
  projectRoot: string;
  projectId?: string | null;
  workflowLine?: "experiment" | "survey";
  stage?: string | null;
  sourceTaskId?: string | null;
  sourceIntentId?: string | null;
  originalOwner?: string | null;
  failureKind: WorkflowHandoffReason;
  failureReason: string;
  verificationRule?: string | null;
  failureFingerprint?: string | null;
}): Promise<{
  repairCreated: boolean;
  handoff: WorkflowHandoffIntent;
}> {
  const policy = getWorkflowFailureRoutingPolicy(params.failureKind);
  const repair = policy.createRepairTask
    ? await createWorkflowRepairQueueItem({
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        sourceTaskId: params.sourceTaskId,
        sourceIntentId: params.sourceIntentId,
        stage: params.stage,
        workflowLine: params.workflowLine,
        failureKind: params.failureKind,
        failureReason: params.failureReason,
        verificationRule: params.verificationRule,
        failureFingerprint: params.failureFingerprint,
        originalOwner: params.originalOwner,
        repairOwner: policy.repairOwner,
        fallbackOwners: policy.fallbackOwners,
      })
    : null;
  const repairItem =
    repair && !repair.created
      ? (await updateWorkflowRepairQueueItem({
          projectRoot: params.projectRoot,
          repairId: repair.item.repairId,
          retryBudgetDelta: -1,
          status:
            repair.item.retryBudgetRemaining <= 1 ? "escalated" : repair.item.status,
        })) ?? repair.item
      : repair?.item ?? null;
  if (repairItem?.status === "escalated") {
    const escalated = await upsertWorkflowHandoffIntent({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      workflowLine: params.workflowLine ?? "experiment",
      idempotencyKey: [
        "human_escalation",
        params.projectId ?? "unknown-project",
        repairItem.repairLineageId,
        repairItem.failureFingerprint,
      ].join(":"),
      stage: params.stage,
      fromRole: params.originalOwner,
      toRole: "human",
      reason: "manual_recovery",
      priority: "urgent",
      failureId: repairItem.repairId,
      failureFingerprint: repairItem.failureFingerprint,
      repairLineageId: repairItem.repairLineageId,
      summary: `Human escalation required for ${params.failureKind}: ${params.failureReason}`,
      blockerSummary: params.failureReason,
      deliveryPlan: {
        channels: ["human_escalation"],
        maxAttemptsTotal: 1,
      },
    });
    return {
      repairCreated: repair?.created ?? false,
      handoff: escalated.intent,
    };
  }
  const fingerprint = repairItem?.failureFingerprint ?? params.failureFingerprint ?? params.failureReason;
  const result = await upsertWorkflowHandoffIntent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    workflowLine: params.workflowLine ?? "experiment",
    idempotencyKey: [
      params.failureKind,
      params.projectId ?? "unknown-project",
      params.sourceTaskId ?? "no-task",
      fingerprint,
    ].join(":"),
    stage: params.stage,
    fromRole: params.originalOwner,
    toRole: policy.repairOwner,
    reason: params.failureKind,
    priority: policy.deliveryPriority,
    sourceTaskId: params.sourceTaskId,
    failureId: repairItem?.repairId ?? null,
    failureFingerprint: repairItem?.failureFingerprint ?? params.failureFingerprint,
    repairLineageId: repairItem?.repairLineageId ?? null,
    summary: `Repair ${params.failureKind}: ${params.failureReason}`,
    blockerSummary: params.failureReason,
    payload: {
      verificationRule: params.verificationRule ?? null,
      fallbackOwners: policy.fallbackOwners,
      repairId: repairItem?.repairId ?? null,
    },
  });
  return {
    repairCreated: repair?.created ?? false,
    handoff: result.intent,
  };
}
