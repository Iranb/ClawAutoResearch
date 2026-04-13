import { appendWorkflowHandoffEvent } from "./handoff-events";
import {
  readWorkflowHandoffIntentStore,
  transitionWorkflowHandoffIntent,
} from "./handoff-store";

export type WorkflowHandoffMaintenanceResult = {
  expiredIntentIds: string[];
  staleClaimIntentIds: string[];
  ackTimeoutIntentIds: string[];
  stalledIntentIds: string[];
};

export async function runWorkflowHandoffMaintenancePass(params: {
  projectRoot: string;
  now?: Date;
}): Promise<WorkflowHandoffMaintenanceResult> {
  const now = params.now ?? new Date();
  const store = await readWorkflowHandoffIntentStore(params.projectRoot);
  const result: WorkflowHandoffMaintenanceResult = {
    expiredIntentIds: [],
    staleClaimIntentIds: [],
    ackTimeoutIntentIds: [],
    stalledIntentIds: [],
  };

  for (const intent of store.intents) {
    if (
      intent.expiresAt &&
      Date.parse(intent.expiresAt) <= now.getTime() &&
      !["completed", "expired", "superseded", "escalated", "cancelled"].includes(
        intent.status
      )
    ) {
      await transitionWorkflowHandoffIntent({
        projectRoot: params.projectRoot,
        intentId: intent.intentId,
        toStatus: "expired",
        terminalReason: "expiresAt elapsed",
      });
      result.expiredIntentIds.push(intent.intentId);
      continue;
    }

    if (
      ["dispatched", "delivered", "acknowledged"].includes(intent.status) &&
      intent.deliveryPlan.ackDeadlineAt &&
      Date.parse(intent.deliveryPlan.ackDeadlineAt) <= now.getTime()
    ) {
      await transitionWorkflowHandoffIntent({
        projectRoot: params.projectRoot,
        intentId: intent.intentId,
        toStatus: "failed",
        summary: "Handoff delivery was not acknowledged before ack deadline.",
      });
      await appendWorkflowHandoffEvent({
        projectRoot: params.projectRoot,
        projectId: intent.projectId,
        intentId: intent.intentId,
        idempotencyKey: intent.idempotencyKey,
        kind: "handoff_ack_timeout",
        fromStatus: intent.status,
        toStatus: "failed",
        summary: "Handoff delivery was not acknowledged before ack deadline.",
      });
      result.ackTimeoutIntentIds.push(intent.intentId);
      continue;
    }

    if (
      intent.status === "claimed" &&
      intent.claimLeaseExpiresAt &&
      Date.parse(intent.claimLeaseExpiresAt) <= now.getTime()
    ) {
      await transitionWorkflowHandoffIntent({
        projectRoot: params.projectRoot,
        intentId: intent.intentId,
        toStatus: "stale_claim",
        summary: "Handoff claim lease expired without progress evidence.",
      });
      result.staleClaimIntentIds.push(intent.intentId);
      continue;
    }

    if (
      ["prepared", "pending", "queued", "dispatching", "dispatched", "delivered", "acknowledged"].includes(intent.status)
    ) {
      const freshness =
        intent.deliveryAttempts.at(-1)?.attemptedAt ??
        intent.dispatchedAt ??
        intent.updatedAt ??
        intent.createdAt;
      const freshnessMs = Date.parse(freshness ?? "");
      if (Number.isFinite(freshnessMs) && now.getTime() - freshnessMs > 15 * 60 * 1000) {
        await transitionWorkflowHandoffIntent({
          projectRoot: params.projectRoot,
          intentId: intent.intentId,
          toStatus: "failed",
          summary: "Handoff stall watchdog marked the handoff failed after prolonged inactivity.",
        });
        await appendWorkflowHandoffEvent({
          projectRoot: params.projectRoot,
          projectId: intent.projectId,
          intentId: intent.intentId,
          idempotencyKey: intent.idempotencyKey,
          kind: "handoff_stall_detected",
          fromStatus: intent.status,
          toStatus: "failed",
          summary: "Handoff stall watchdog detected prolonged inactivity without claim or completion.",
        });
        result.stalledIntentIds.push(intent.intentId);
      }
    }
  }
  return result;
}
