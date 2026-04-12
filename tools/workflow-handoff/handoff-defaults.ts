import type {
  WorkflowHandoffDeliveryChannel,
  WorkflowHandoffDeliveryPlan,
  WorkflowHandoffReason,
} from "./handoff-types";

export type WorkflowHandoffDefaultBudget = {
  ackDeadlineMs: number | null;
  expiresInMs: number | null;
  maxAttemptsTotal: number;
  repairBudget: number;
  staleClaimAfterMs: number | null;
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const WORKFLOW_HANDOFF_DEFAULT_CHANNEL_ATTEMPTS: Record<
  WorkflowHandoffDeliveryChannel,
  number
> = {
  native_runtime: 1,
  lobster: 1,
  channel_broadcast: 1,
  runtime_queue: 1,
  mailbox_compat: 1,
  human_escalation: 1,
};

export const WORKFLOW_HANDOFF_DEFAULT_BUDGETS: Record<
  WorkflowHandoffReason,
  WorkflowHandoffDefaultBudget
> = {
  stage_owner_change: {
    ackDeadlineMs: 10 * MINUTE,
    expiresInMs: HOUR,
    maxAttemptsTotal: 4,
    repairBudget: 1,
    staleClaimAfterMs: 15 * MINUTE,
  },
  task_completed: {
    ackDeadlineMs: 10 * MINUTE,
    expiresInMs: HOUR,
    maxAttemptsTotal: 4,
    repairBudget: 1,
    staleClaimAfterMs: 15 * MINUTE,
  },
  dependency_unblocked: {
    ackDeadlineMs: 10 * MINUTE,
    expiresInMs: HOUR,
    maxAttemptsTotal: 4,
    repairBudget: 1,
    staleClaimAfterMs: 15 * MINUTE,
  },
  verification_failed: {
    ackDeadlineMs: 15 * MINUTE,
    expiresInMs: 6 * HOUR,
    maxAttemptsTotal: 4,
    repairBudget: 2,
    staleClaimAfterMs: 30 * MINUTE,
  },
  code_review_required: {
    ackDeadlineMs: 30 * MINUTE,
    expiresInMs: 12 * HOUR,
    maxAttemptsTotal: 4,
    repairBudget: 2,
    staleClaimAfterMs: 30 * MINUTE,
  },
  code_review_failed: {
    ackDeadlineMs: 30 * MINUTE,
    expiresInMs: 12 * HOUR,
    maxAttemptsTotal: 4,
    repairBudget: 2,
    staleClaimAfterMs: 30 * MINUTE,
  },
  plan_review_required: {
    ackDeadlineMs: 30 * MINUTE,
    expiresInMs: 12 * HOUR,
    maxAttemptsTotal: 4,
    repairBudget: 2,
    staleClaimAfterMs: 30 * MINUTE,
  },
  plan_inconsistent: {
    ackDeadlineMs: 30 * MINUTE,
    expiresInMs: 12 * HOUR,
    maxAttemptsTotal: 4,
    repairBudget: 2,
    staleClaimAfterMs: 30 * MINUTE,
  },
  paper_ingestion_failed: {
    ackDeadlineMs: 30 * MINUTE,
    expiresInMs: 24 * HOUR,
    maxAttemptsTotal: 4,
    repairBudget: 3,
    staleClaimAfterMs: HOUR,
  },
  graph_presence_failed: {
    ackDeadlineMs: 30 * MINUTE,
    expiresInMs: 24 * HOUR,
    maxAttemptsTotal: 4,
    repairBudget: 3,
    staleClaimAfterMs: HOUR,
  },
  survey_review_required: {
    ackDeadlineMs: 30 * MINUTE,
    expiresInMs: 12 * HOUR,
    maxAttemptsTotal: 4,
    repairBudget: 2,
    staleClaimAfterMs: 30 * MINUTE,
  },
  survey_route_drift: {
    ackDeadlineMs: 30 * MINUTE,
    expiresInMs: 12 * HOUR,
    maxAttemptsTotal: 4,
    repairBudget: 2,
    staleClaimAfterMs: 30 * MINUTE,
  },
  paper_review_required: {
    ackDeadlineMs: 30 * MINUTE,
    expiresInMs: 12 * HOUR,
    maxAttemptsTotal: 4,
    repairBudget: 2,
    staleClaimAfterMs: 30 * MINUTE,
  },
  cross_domain_evidence_missing: {
    ackDeadlineMs: 30 * MINUTE,
    expiresInMs: 24 * HOUR,
    maxAttemptsTotal: 4,
    repairBudget: 2,
    staleClaimAfterMs: HOUR,
  },
  tool_unavailable: {
    ackDeadlineMs: 10 * MINUTE,
    expiresInMs: 2 * HOUR,
    maxAttemptsTotal: 3,
    repairBudget: 1,
    staleClaimAfterMs: 10 * MINUTE,
  },
  runtime_unavailable: {
    ackDeadlineMs: 10 * MINUTE,
    expiresInMs: 2 * HOUR,
    maxAttemptsTotal: 3,
    repairBudget: 1,
    staleClaimAfterMs: 10 * MINUTE,
  },
  capability_stale: {
    ackDeadlineMs: 10 * MINUTE,
    expiresInMs: 2 * HOUR,
    maxAttemptsTotal: 3,
    repairBudget: 1,
    staleClaimAfterMs: 10 * MINUTE,
  },
  handoff_ack_timeout: {
    ackDeadlineMs: null,
    expiresInMs: null,
    maxAttemptsTotal: 1,
    repairBudget: 0,
    staleClaimAfterMs: null,
  },
  discord_inbound_timeout: {
    ackDeadlineMs: null,
    expiresInMs: null,
    maxAttemptsTotal: 0,
    repairBudget: 0,
    staleClaimAfterMs: null,
  },
  inbound_budget_exceeded: {
    ackDeadlineMs: null,
    expiresInMs: null,
    maxAttemptsTotal: 0,
    repairBudget: 0,
    staleClaimAfterMs: null,
  },
  broadcast_delivery_timeout: {
    ackDeadlineMs: null,
    expiresInMs: null,
    maxAttemptsTotal: 1,
    repairBudget: 0,
    staleClaimAfterMs: null,
  },
  stale_claim: {
    ackDeadlineMs: null,
    expiresInMs: null,
    maxAttemptsTotal: 1,
    repairBudget: 1,
    staleClaimAfterMs: null,
  },
  write_scope_conflict: {
    ackDeadlineMs: null,
    expiresInMs: 2 * HOUR,
    maxAttemptsTotal: 0,
    repairBudget: 0,
    staleClaimAfterMs: null,
  },
  exec_approval_required: {
    ackDeadlineMs: null,
    expiresInMs: 24 * HOUR,
    maxAttemptsTotal: 1,
    repairBudget: 1,
    staleClaimAfterMs: null,
  },
  manual_recovery: {
    ackDeadlineMs: 10 * MINUTE,
    expiresInMs: 2 * HOUR,
    maxAttemptsTotal: 3,
    repairBudget: 1,
    staleClaimAfterMs: 10 * MINUTE,
  },
};

export const WORKFLOW_INBOUND_DEFAULT_BUDGET_MS = 8_000;
export const WORKFLOW_INBOUND_AUTO_ITERATOR_INLINE_BUDGET_MS = 5_000;
export const WORKFLOW_BROADCAST_INLINE_BUDGET_MS = 1_500;
export const WORKFLOW_BROADCAST_MAX_INLINE_CHARS = 1_500;
export const WORKFLOW_BROADCAST_MAX_INLINE_FRAGMENT_CHARS = 400;

export function getWorkflowHandoffDefaultBudget(
  reason: WorkflowHandoffReason
): WorkflowHandoffDefaultBudget {
  return WORKFLOW_HANDOFF_DEFAULT_BUDGETS[reason];
}

export function buildDefaultWorkflowHandoffDeliveryPlan(params: {
  reason: WorkflowHandoffReason;
  now?: Date;
  channels?: WorkflowHandoffDeliveryChannel[];
  requireAck?: boolean;
}): WorkflowHandoffDeliveryPlan {
  const now = params.now ?? new Date();
  const budget = getWorkflowHandoffDefaultBudget(params.reason);
  return {
    channels:
      params.channels ?? [
        "native_runtime",
        "lobster",
        "channel_broadcast",
        "runtime_queue",
        "mailbox_compat",
        "human_escalation",
      ],
    requireAck: params.requireAck ?? true,
    ackDeadlineAt:
      budget.ackDeadlineMs == null
        ? null
        : new Date(now.getTime() + budget.ackDeadlineMs).toISOString(),
    fallbackAfterMs: budget.ackDeadlineMs,
    maxAttemptsTotal: budget.maxAttemptsTotal,
    maxAttemptsByChannel: { ...WORKFLOW_HANDOFF_DEFAULT_CHANNEL_ATTEMPTS },
    staleClaimAfterMs: budget.staleClaimAfterMs,
  };
}

export function getWorkflowHandoffDefaultExpiresAt(params: {
  reason: WorkflowHandoffReason;
  now?: Date;
}): string | null {
  const budget = getWorkflowHandoffDefaultBudget(params.reason);
  if (budget.expiresInMs == null) {
    return null;
  }
  const now = params.now ?? new Date();
  return new Date(now.getTime() + budget.expiresInMs).toISOString();
}
