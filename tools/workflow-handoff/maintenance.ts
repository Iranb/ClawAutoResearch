import fs from "node:fs/promises";
import { appendWorkflowHandoffEvent } from "./handoff-events";
import {
  countWorkflowHandoffAttemptsTotal,
  readWorkflowHandoffIntentStore,
  transitionWorkflowHandoffIntent,
} from "./handoff-store";
import {
  isWorkflowHandoffActiveStatus,
  isWorkflowHandoffTerminalStatus,
} from "./handoff-types";

export type WorkflowHandoffMaintenanceResult = {
  expiredIntentIds: string[];
  staleClaimIntentIds: string[];
  ackTimeoutIntentIds: string[];
  stalledIntentIds: string[];
  supersededIntentIds: string[];
  exhaustedIntentIds: string[];
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
    supersededIntentIds: [],
    exhaustedIntentIds: [],
  };
  const manifestPath = `${params.projectRoot}/PROJECT_MANIFEST.json`;
  let manifest: Record<string, unknown> | null = null;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch {
    manifest = null;
  }
  const currentStage =
    typeof manifest?.current_stage === "string" ? manifest.current_stage.trim() : null;
  const pendingHandoffId =
    manifest?.orchestration_state &&
    typeof manifest.orchestration_state === "object" &&
    !Array.isArray(manifest.orchestration_state) &&
    typeof (manifest.orchestration_state as Record<string, unknown>).pending_handoff_id === "string"
      ? ((manifest.orchestration_state as Record<string, unknown>).pending_handoff_id as string)
      : manifest?.orchestration_state &&
          typeof manifest.orchestration_state === "object" &&
          !Array.isArray(manifest.orchestration_state) &&
          typeof (manifest.orchestration_state as Record<string, unknown>).pendingHandoffId === "string"
        ? ((manifest.orchestration_state as Record<string, unknown>).pendingHandoffId as string)
        : null;

  const intentsByIdempotencyKey = new Map<string, typeof store.intents>();
  for (const intent of store.intents) {
    const bucket = intentsByIdempotencyKey.get(intent.idempotencyKey) ?? [];
    bucket.push(intent);
    intentsByIdempotencyKey.set(intent.idempotencyKey, bucket);
  }
  for (const duplicateGroup of intentsByIdempotencyKey.values()) {
    if (duplicateGroup.length < 2) {
      continue;
    }
    const blockingTerminalIntent = duplicateGroup.find(
      (intent) =>
        isWorkflowHandoffTerminalStatus(intent.status) &&
        intent.status !== "expired"
    );
    const expiredTerminalIntent = duplicateGroup.find(
      (intent) =>
        isWorkflowHandoffTerminalStatus(intent.status) &&
        intent.status === "expired"
    );
    const pendingActiveIntent = duplicateGroup.find(
      (intent) =>
        pendingHandoffId &&
        intent.intentId === pendingHandoffId &&
        isWorkflowHandoffActiveStatus(intent.status)
    );
    const activeIntent =
      pendingActiveIntent ??
      duplicateGroup.find((intent) => isWorkflowHandoffActiveStatus(intent.status));
    const terminalIntent = blockingTerminalIntent ?? expiredTerminalIntent;
    const survivor =
      blockingTerminalIntent ??
      activeIntent ??
      terminalIntent ??
      duplicateGroup
        .slice()
        .sort(
          (a, b) =>
            Date.parse(a.createdAt ?? "") - Date.parse(b.createdAt ?? "")
        )[0];
    const terminalControlsDuplicate =
      terminalIntent != null && survivor.intentId === terminalIntent.intentId;
    for (const duplicate of duplicateGroup) {
      if (
        duplicate.intentId === survivor.intentId ||
        !isWorkflowHandoffActiveStatus(duplicate.status)
      ) {
        continue;
      }
      await transitionWorkflowHandoffIntent({
        projectRoot: params.projectRoot,
        intentId: duplicate.intentId,
        toStatus: "superseded",
        terminalReason: terminalControlsDuplicate
          ? "duplicate_idempotency_key_already_terminal"
          : "duplicate_idempotency_key_superseded",
        summary: terminalControlsDuplicate
          ? "Superseded duplicate handoff because the same idempotency key already reached a terminal state."
          : "Superseded duplicate handoff and kept the canonical active handoff for this idempotency key.",
      });
      await appendWorkflowHandoffEvent({
        projectRoot: params.projectRoot,
        projectId: duplicate.projectId,
        intentId: duplicate.intentId,
        idempotencyKey: duplicate.idempotencyKey,
        kind: "duplicate_intent_superseded",
        fromStatus: duplicate.status,
        toStatus: "superseded",
        summary:
          "Handoff maintenance removed a duplicate active intent for the same idempotency key.",
        details: {
          survivorIntentId: survivor.intentId,
          survivorStatus: survivor.status,
        },
      });
      result.supersededIntentIds.push(duplicate.intentId);
    }
  }

  for (const intent of store.intents) {
    if (
      !["completed", "expired", "superseded", "escalated", "cancelled"].includes(
        intent.status
      ) &&
      countWorkflowHandoffAttemptsTotal(intent) >= intent.deliveryPlan.maxAttemptsTotal &&
      intent.deliveryPlan.maxAttemptsTotal > 0
    ) {
      await transitionWorkflowHandoffIntent({
        projectRoot: params.projectRoot,
        intentId: intent.intentId,
        toStatus: "failed",
        terminalReason: "delivery_attempt_budget_exhausted",
        summary: "Handoff exhausted its delivery attempt budget.",
      });
      result.exhaustedIntentIds.push(intent.intentId);
      continue;
    }

    if (
      intent.reason === "stage_owner_change" &&
      intent.status !== "superseded" &&
      currentStage &&
      pendingHandoffId &&
      pendingHandoffId !== intent.intentId &&
      intent.intentId !== pendingHandoffId &&
      intent.stageAfter === currentStage
    ) {
      await transitionWorkflowHandoffIntent({
        projectRoot: params.projectRoot,
        intentId: intent.intentId,
        toStatus: "superseded",
        terminalReason: "replaced_by_newer_stage_owner_handoff",
        summary:
          "Superseded stale stage-owner handoff because a newer pending handoff now owns this stage transition.",
      });
      result.supersededIntentIds.push(intent.intentId);
      continue;
    }

    if (
      intent.reason === "stage_owner_change" &&
      intent.status !== "superseded" &&
      currentStage &&
      intent.stageBefore !== currentStage &&
      intent.stageAfter !== currentStage &&
      !["completed", "expired", "superseded", "escalated", "cancelled"].includes(intent.status)
    ) {
      await transitionWorkflowHandoffIntent({
        projectRoot: params.projectRoot,
        intentId: intent.intentId,
        toStatus: "superseded",
        terminalReason: "stage_lineage_drift",
        summary:
          "Superseded stage-owner handoff because the live project stage no longer matches either side of the handoff lineage.",
      });
      result.supersededIntentIds.push(intent.intentId);
      continue;
    }

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
