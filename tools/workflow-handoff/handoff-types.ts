export type WorkflowHandoffReason =
  | "stage_owner_change"
  | "task_completed"
  | "dependency_unblocked"
  | "verification_failed"
  | "tool_unavailable"
  | "runtime_unavailable"
  | "exec_approval_required"
  | "paper_ingestion_failed"
  | "graph_presence_failed"
  | "code_review_required"
  | "code_review_failed"
  | "plan_review_required"
  | "plan_inconsistent"
  | "survey_review_required"
  | "survey_route_drift"
  | "paper_review_required"
  | "cross_domain_evidence_missing"
  | "capability_stale"
  | "handoff_ack_timeout"
  | "discord_inbound_timeout"
  | "inbound_budget_exceeded"
  | "broadcast_delivery_timeout"
  | "stale_claim"
  | "write_scope_conflict"
  | "manual_recovery";

export type WorkflowHandoffStatus =
  | "prepared"
  | "pending"
  | "queued"
  | "dispatching"
  | "dispatched"
  | "delivered"
  | "acknowledged"
  | "claimed"
  | "activated"
  | "completed"
  | "failed"
  | "stale_claim"
  | "expired"
  | "superseded"
  | "escalated"
  | "cancelled";

export type WorkflowHandoffDeliveryChannel =
  | "native_runtime"
  | "lobster"
  | "channel_broadcast"
  | "runtime_queue"
  | "mailbox_compat"
  | "human_escalation";

export type WorkflowHandoffDeliveryAttemptStatus =
  | "pending"
  | "delivered"
  | "failed"
  | "skipped";

export type WorkflowHandoffDeliveryAttempt = {
  attemptId: string;
  channel: WorkflowHandoffDeliveryChannel;
  status: WorkflowHandoffDeliveryAttemptStatus;
  runId: string | null;
  sessionKey: string | null;
  messageId: string | null;
  queueKey: string | null;
  error: string | null;
  attemptedAt: string;
};

export type WorkflowHandoffDeliveryPlan = {
  channels: WorkflowHandoffDeliveryChannel[];
  requireAck: boolean;
  ackDeadlineAt: string | null;
  fallbackAfterMs: number | null;
  maxAttemptsTotal: number;
  maxAttemptsByChannel: Partial<Record<WorkflowHandoffDeliveryChannel, number>>;
  staleClaimAfterMs: number | null;
};

export type WorkflowHandoffIntent = {
  schemaVersion: 1;
  intentId: string;
  idempotencyKey: string;
  projectId: string | null;
  projectRoot: string;
  workflowLine: "experiment" | "survey";
  stage: string | null;
  fromRole: string | null;
  fromSessionKey: string | null;
  toRole: string;
  toSessionKey: string | null;
  reason: WorkflowHandoffReason;
  priority: "low" | "normal" | "high" | "urgent";
  sourceTaskId: string | null;
  targetTaskId: string | null;
  artifactReceiptId: string | null;
  failureId: string | null;
  failureFingerprint: string | null;
  repairLineageId: string | null;
  status: WorkflowHandoffStatus;
  stageBefore: string | null;
  stageAfter: string | null;
  executionId: string | null;
  sessionBindingKey: string | null;
  preferredSessionKeys: string[];
  deliveryPlan: WorkflowHandoffDeliveryPlan;
  deliveryAttempts: WorkflowHandoffDeliveryAttempt[];
  dispatchedAt: string | null;
  acknowledgedAt: string | null;
  claimedAt: string | null;
  activatedAt: string | null;
  claimLeaseExpiresAt: string | null;
  terminalReason: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  summary: string | null;
  command: string | null;
  blockerSummary: string | null;
  payload: Record<string, unknown> | null;
};

export type WorkflowHandoffEvent = {
  schemaVersion: 1;
  eventId: string;
  intentId: string | null;
  idempotencyKey: string | null;
  projectId: string | null;
  projectRoot: string;
  kind: string;
  fromStatus: WorkflowHandoffStatus | null;
  toStatus: WorkflowHandoffStatus | null;
  summary: string | null;
  details: Record<string, unknown> | null;
  recordedAt: string;
};

export type WorkflowHandoffIntentStore = {
  schemaVersion: 1;
  projectId: string | null;
  projectRoot: string;
  updatedAt: string;
  intents: WorkflowHandoffIntent[];
};

export const WORKFLOW_HANDOFF_TERMINAL_STATUSES = new Set<WorkflowHandoffStatus>([
  "completed",
  "expired",
  "superseded",
  "escalated",
  "cancelled",
]);

export const WORKFLOW_HANDOFF_ACTIVE_STATUSES = new Set<WorkflowHandoffStatus>([
  "prepared",
  "pending",
  "queued",
  "dispatching",
  "dispatched",
  "delivered",
  "acknowledged",
  "claimed",
  "activated",
  "stale_claim",
]);

export const WORKFLOW_HANDOFF_ALLOWED_TRANSITIONS: Record<
  WorkflowHandoffStatus,
  ReadonlySet<WorkflowHandoffStatus>
> = {
  prepared: new Set(["pending", "queued", "dispatching", "dispatched", "claimed", "failed", "expired", "superseded", "cancelled"]),
  pending: new Set(["prepared", "queued", "dispatching", "dispatched", "claimed", "failed", "expired", "superseded", "cancelled"]),
  queued: new Set(["dispatching", "dispatched", "claimed", "failed", "expired", "superseded", "cancelled"]),
  dispatching: new Set(["dispatched", "delivered", "claimed", "failed", "queued", "expired", "escalated", "superseded"]),
  dispatched: new Set(["delivered", "acknowledged", "claimed", "failed", "queued", "expired", "escalated", "superseded"]),
  delivered: new Set(["acknowledged", "claimed", "failed", "expired", "escalated", "superseded"]),
  acknowledged: new Set(["claimed", "failed", "expired", "escalated", "superseded"]),
  claimed: new Set(["activated", "failed", "stale_claim", "expired", "escalated", "superseded"]),
  activated: new Set(["completed", "failed", "stale_claim", "expired", "escalated", "superseded"]),
  failed: new Set(["prepared", "queued", "dispatching", "dispatched", "escalated", "superseded"]),
  stale_claim: new Set(["queued", "escalated", "superseded"]),
  completed: new Set(),
  expired: new Set(),
  superseded: new Set(),
  escalated: new Set(),
  cancelled: new Set(),
};

export function isWorkflowHandoffTerminalStatus(
  status: WorkflowHandoffStatus
): boolean {
  return WORKFLOW_HANDOFF_TERMINAL_STATUSES.has(status);
}

export function isWorkflowHandoffActiveStatus(status: WorkflowHandoffStatus): boolean {
  return WORKFLOW_HANDOFF_ACTIVE_STATUSES.has(status);
}

export function canTransitionWorkflowHandoffStatus(params: {
  from: WorkflowHandoffStatus;
  to: WorkflowHandoffStatus;
}): boolean {
  if (params.from === params.to) {
    return true;
  }
  return WORKFLOW_HANDOFF_ALLOWED_TRANSITIONS[params.from]?.has(params.to) === true;
}
