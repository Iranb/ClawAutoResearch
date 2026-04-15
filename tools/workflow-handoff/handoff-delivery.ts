import { randomUUID } from "node:crypto";
import {
  appendWorkflowHandoffDeliveryAttempt,
  countWorkflowHandoffAttemptsByChannel,
  countWorkflowHandoffAttemptsTotal,
  transitionWorkflowHandoffIntent,
} from "./handoff-store";
import {
  evaluateChannelProjectBindingGate,
  type ChannelProjectBindingPolicy,
} from "../channel-project-bindings";
import { checkHandoffHookFreshness } from "../workflow-hooks/handoff-gates.js";
import type {
  WorkflowHandoffDeliveryChannel,
  WorkflowHandoffIntent,
} from "./handoff-types";
import { isWorkflowHandoffTerminalStatus } from "./handoff-types";

export type WorkflowHandoffDeliveryRuntime = {
  nativeDispatch?: (intent: WorkflowHandoffIntent) => Promise<{
    ok: boolean;
    runId?: string | null;
    sessionKey?: string | null;
    error?: string | null;
  }>;
  lobsterDispatch?: (intent: WorkflowHandoffIntent) => Promise<{
    ok: boolean;
    runId?: string | null;
    sessionKey?: string | null;
    error?: string | null;
    dryRun?: boolean;
  }>;
  channelBroadcast?: (intent: WorkflowHandoffIntent) => Promise<{
    ok: boolean;
    runId?: string | null;
    messageId?: string | null;
    error?: string | null;
  }>;
  runtimeQueue?: (intent: WorkflowHandoffIntent) => Promise<{
    ok: boolean;
    queueKey?: string | null;
    error?: string | null;
  }>;
  mailboxCompat?: (intent: WorkflowHandoffIntent) => Promise<{
    ok: boolean;
    messageId?: string | null;
    error?: string | null;
  }>;
};

function nowIso(): string {
  return new Date().toISOString();
}

function computeAckDeadlineAt(intent: WorkflowHandoffIntent): string | null {
  if (
    typeof intent.deliveryPlan.fallbackAfterMs === "number" &&
    Number.isFinite(intent.deliveryPlan.fallbackAfterMs) &&
    intent.deliveryPlan.fallbackAfterMs > 0
  ) {
    return new Date(Date.now() + Math.floor(intent.deliveryPlan.fallbackAfterMs)).toISOString();
  }
  return intent.deliveryPlan.ackDeadlineAt ?? null;
}

function hasChannelBudget(
  intent: WorkflowHandoffIntent,
  channel: WorkflowHandoffDeliveryChannel
): boolean {
  const channelLimit = intent.deliveryPlan.maxAttemptsByChannel[channel] ?? 1;
  return countWorkflowHandoffAttemptsByChannel(intent, channel) < channelLimit;
}

function hasTotalBudget(intent: WorkflowHandoffIntent): boolean {
  return countWorkflowHandoffAttemptsTotal(intent) < intent.deliveryPlan.maxAttemptsTotal;
}

export async function deliverWorkflowHandoffIntent(params: {
  intent: WorkflowHandoffIntent;
  runtime?: WorkflowHandoffDeliveryRuntime;
  lobsterMode?: "disabled" | "dry_run" | "enabled";
  bindingPolicy?: ChannelProjectBindingPolicy;
}): Promise<{
  delivered: boolean;
  intent: WorkflowHandoffIntent;
  terminal: boolean;
  reason: string | null;
}> {
  let intent = params.intent;
  if (isWorkflowHandoffTerminalStatus(intent.status)) {
    return { delivered: false, intent, terminal: true, reason: "terminal_intent" };
  }
  if (!hasTotalBudget(intent) && intent.deliveryPlan.maxAttemptsTotal > 0) {
    const escalated =
      (await transitionWorkflowHandoffIntent({
        projectRoot: intent.projectRoot,
        intentId: intent.intentId,
        toStatus: "escalated",
        terminalReason: "delivery_attempt_budget_exhausted",
      })) ?? intent;
    return {
      delivered: false,
      intent: escalated,
      terminal: true,
      reason: "delivery_attempt_budget_exhausted",
    };
  }

  const hookFreshness = await checkHandoffHookFreshness({
    intent,
    defaultHookPoint: "before_handoff_delivery",
  });
  if (!hookFreshness.allowed) {
    const superseded =
      (await transitionWorkflowHandoffIntent({
        projectRoot: intent.projectRoot,
        intentId: intent.intentId,
        toStatus: "superseded",
        terminalReason: "hook_gate_stale",
        summary:
          hookFreshness.blockingReason ??
          "Suppressed stale handoff because hook gate freshness failed.",
      })) ?? intent;
    return {
      delivered: false,
      intent: superseded,
      terminal: true,
      reason: "hook_gate_stale",
    };
  }

  const deliveryGate = await evaluateChannelProjectBindingGate({
    policy: params.bindingPolicy,
    context: {
      sessionKey: intent.fromSessionKey ?? intent.toSessionKey ?? undefined,
    },
    projectRoot: intent.projectRoot,
    projectId: intent.projectId,
    sessionKey: intent.fromSessionKey ?? intent.toSessionKey,
    allowSessionProjectFallback: !intent.fromSessionKey && Boolean(intent.toSessionKey),
    allowSessionFallbackOnBindingMismatch: false,
  });
  if (!deliveryGate.allowed) {
    const superseded =
      (await transitionWorkflowHandoffIntent({
        projectRoot: intent.projectRoot,
        intentId: intent.intentId,
        toStatus: "superseded",
        terminalReason: [
          "binding_gate_mismatch",
          deliveryGate.reason,
          deliveryGate.currentBinding?.projectId ?? "unbound",
        ].join(":"),
        summary:
          "Suppressed stale handoff because the current channel binding no longer points at this project.",
      })) ?? intent;
    return {
      delivered: false,
      intent: superseded,
      terminal: true,
      reason: "binding_mismatch",
    };
  }

  const dispatching =
    (await transitionWorkflowHandoffIntent({
      projectRoot: intent.projectRoot,
      intentId: intent.intentId,
      toStatus:
        intent.status === "prepared" ||
        intent.status === "pending" ||
        intent.status === "queued" ||
        intent.status === "failed" ||
        intent.status === "stale_claim"
          ? "dispatching"
          : intent.status,
      summary: "Starting handoff delivery.",
    })) ?? intent;
  intent = dispatching;

  for (const channel of intent.deliveryPlan.channels) {
    if (!hasTotalBudget(intent) && intent.deliveryPlan.maxAttemptsTotal > 0) {
      break;
    }
    if (!hasChannelBudget(intent, channel)) {
      continue;
    }
    if (channel === "lobster" && (params.lobsterMode ?? "disabled") === "disabled") {
      intent =
        (await appendWorkflowHandoffDeliveryAttempt({
          projectRoot: intent.projectRoot,
          intentId: intent.intentId,
          attempt: {
            channel,
            status: "skipped",
            runId: null,
            sessionKey: null,
            messageId: null,
            queueKey: null,
            error: "lobster_disabled",
          },
        })) ?? intent;
      continue;
    }

    const attemptId = randomUUID();
    const startedAt = nowIso();
    try {
      if (channel === "native_runtime") {
        const result = await params.runtime?.nativeDispatch?.(intent);
        intent =
          (await appendWorkflowHandoffDeliveryAttempt({
            projectRoot: intent.projectRoot,
            intentId: intent.intentId,
            attempt: {
              attemptId,
              attemptedAt: startedAt,
              channel,
              status: result?.ok ? "delivered" : "failed",
              runId: result?.runId ?? null,
              sessionKey: result?.sessionKey ?? null,
              messageId: null,
              queueKey: null,
              error: result?.ok ? null : result?.error ?? "native_runtime_unavailable",
            },
          })) ?? intent;
        if (result?.ok) {
          const delivered =
            (await transitionWorkflowHandoffIntent({
              projectRoot: intent.projectRoot,
              intentId: intent.intentId,
              toStatus: intent.deliveryPlan.requireAck ? "dispatched" : "dispatched",
              patch: {
                toSessionKey: result.sessionKey ?? intent.toSessionKey,
                deliveryPlan: {
                  ...intent.deliveryPlan,
                  ackDeadlineAt: computeAckDeadlineAt(intent),
                },
              },
            })) ?? intent;
          return { delivered: true, intent: delivered, terminal: false, reason: null };
        }
      } else if (channel === "lobster") {
        const result = await params.runtime?.lobsterDispatch?.(intent);
        const dryRun = params.lobsterMode === "dry_run" || result?.dryRun === true;
        intent =
          (await appendWorkflowHandoffDeliveryAttempt({
            projectRoot: intent.projectRoot,
            intentId: intent.intentId,
            attempt: {
              attemptId,
              attemptedAt: startedAt,
              channel,
              status: result?.ok && !dryRun ? "delivered" : dryRun ? "skipped" : "failed",
              runId: result?.runId ?? null,
              sessionKey: result?.sessionKey ?? null,
              messageId: null,
              queueKey: null,
              error: dryRun ? "lobster_dry_run" : result?.ok ? null : result?.error ?? "lobster_failed",
            },
          })) ?? intent;
        if (result?.ok && !dryRun) {
          const delivered =
            (await transitionWorkflowHandoffIntent({
              projectRoot: intent.projectRoot,
              intentId: intent.intentId,
              toStatus: "dispatched",
              patch: {
                toSessionKey: result.sessionKey ?? intent.toSessionKey,
                deliveryPlan: {
                  ...intent.deliveryPlan,
                  ackDeadlineAt: computeAckDeadlineAt(intent),
                },
              },
            })) ?? intent;
          return { delivered: true, intent: delivered, terminal: false, reason: null };
        }
      } else if (channel === "channel_broadcast") {
        const result = await params.runtime?.channelBroadcast?.(intent);
        intent =
          (await appendWorkflowHandoffDeliveryAttempt({
            projectRoot: intent.projectRoot,
            intentId: intent.intentId,
            attempt: {
              attemptId,
              attemptedAt: startedAt,
              channel,
              status: result?.ok ? "delivered" : "failed",
              runId: result?.runId ?? null,
              sessionKey: null,
              messageId: result?.messageId ?? null,
              queueKey: null,
              error: result?.ok ? null : result?.error ?? "channel_broadcast_failed",
            },
          })) ?? intent;
        if (result?.ok) {
          const delivered =
            (await transitionWorkflowHandoffIntent({
              projectRoot: intent.projectRoot,
              intentId: intent.intentId,
              toStatus: "dispatched",
              patch: {
                deliveryPlan: {
                  ...intent.deliveryPlan,
                  ackDeadlineAt: computeAckDeadlineAt(intent),
                },
              },
            })) ?? intent;
          return { delivered: true, intent: delivered, terminal: false, reason: null };
        }
      } else if (channel === "runtime_queue") {
        const result = await params.runtime?.runtimeQueue?.(intent);
        intent =
          (await appendWorkflowHandoffDeliveryAttempt({
            projectRoot: intent.projectRoot,
            intentId: intent.intentId,
            attempt: {
              attemptId,
              attemptedAt: startedAt,
              channel,
              status: result?.ok ? "delivered" : "failed",
              runId: null,
              sessionKey: null,
              messageId: null,
              queueKey: result?.queueKey ?? null,
              error: result?.ok ? null : result?.error ?? "runtime_queue_failed",
            },
          })) ?? intent;
        if (result?.ok) {
          const delivered =
            (await transitionWorkflowHandoffIntent({
              projectRoot: intent.projectRoot,
              intentId: intent.intentId,
              toStatus: "queued",
              patch: {
                deliveryPlan: {
                  ...intent.deliveryPlan,
                  ackDeadlineAt: computeAckDeadlineAt(intent),
                },
              },
            })) ?? intent;
          return { delivered: true, intent: delivered, terminal: false, reason: null };
        }
      } else if (channel === "mailbox_compat") {
        const result = await params.runtime?.mailboxCompat?.(intent);
        intent =
          (await appendWorkflowHandoffDeliveryAttempt({
            projectRoot: intent.projectRoot,
            intentId: intent.intentId,
            attempt: {
              attemptId,
              attemptedAt: startedAt,
              channel,
              status: result?.ok ? "delivered" : "failed",
              runId: null,
              sessionKey: null,
              messageId: result?.messageId ?? null,
              queueKey: null,
              error: result?.ok ? null : result?.error ?? "mailbox_compat_failed",
            },
          })) ?? intent;
        if (result?.ok) {
          const delivered =
            (await transitionWorkflowHandoffIntent({
              projectRoot: intent.projectRoot,
              intentId: intent.intentId,
              toStatus: "dispatched",
              patch: {
                deliveryPlan: {
                  ...intent.deliveryPlan,
                  ackDeadlineAt: computeAckDeadlineAt(intent),
                },
              },
            })) ?? intent;
          return { delivered: true, intent: delivered, terminal: false, reason: null };
        }
      } else if (channel === "human_escalation") {
        intent =
          (await appendWorkflowHandoffDeliveryAttempt({
            projectRoot: intent.projectRoot,
            intentId: intent.intentId,
            attempt: {
              attemptId,
              attemptedAt: startedAt,
              channel,
              status: "delivered",
              runId: null,
              sessionKey: null,
              messageId: null,
              queueKey: null,
              error: null,
            },
          })) ?? intent;
        const escalated =
          (await transitionWorkflowHandoffIntent({
            projectRoot: intent.projectRoot,
            intentId: intent.intentId,
            toStatus: "escalated",
            terminalReason: "human_escalation",
          })) ?? intent;
        return { delivered: false, intent: escalated, terminal: true, reason: "human_escalation" };
      }
    } catch (error) {
      intent =
        (await appendWorkflowHandoffDeliveryAttempt({
          projectRoot: intent.projectRoot,
          intentId: intent.intentId,
          attempt: {
            attemptId,
            attemptedAt: startedAt,
            channel,
            status: "failed",
            runId: null,
            sessionKey: null,
            messageId: null,
            queueKey: null,
            error: error instanceof Error ? error.message : String(error),
          },
        })) ?? intent;
    }
  }

  const failed =
    (await transitionWorkflowHandoffIntent({
      projectRoot: intent.projectRoot,
      intentId: intent.intentId,
      toStatus: hasTotalBudget(intent) ? "failed" : "escalated",
      terminalReason: hasTotalBudget(intent) ? null : "delivery_attempt_budget_exhausted",
    })) ?? intent;
  return {
    delivered: false,
    intent: failed,
    terminal: isWorkflowHandoffTerminalStatus(failed.status),
    reason: failed.terminalReason ?? "delivery_failed",
  };
}
