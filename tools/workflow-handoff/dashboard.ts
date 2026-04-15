import { readWorkflowHandoffIntentStore } from "./handoff-store";
import { readWorkflowMailbox } from "../workflow-collaboration/mailbox";
import {
  readWorkflowRuntimeQueueStore,
  readWorkflowRuntimeSessionsStore,
} from "../workflow-runtime-state.js";
import { readJsonIfExists } from "../workflow-guard-core/fs";
import { normalizeOrchestrationState } from "../workflow-guard-state/execution-state";
import {
  evaluateChannelProjectBindingGate,
  type ChannelProjectBindingPolicy,
} from "../channel-project-bindings";

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function buildHandoffDashboard(params: {
  projectRoot: string;
  projectId?: string | null;
  policy?: ChannelProjectBindingPolicy;
  sessionKey?: string | null;
}): Promise<{
  projectRoot: string;
  projectId: string | null;
  currentOwner: string | null;
  pendingHandoffId: string | null;
  pendingOwnerCandidate: string | null;
  pendingStageCandidate: string | null;
  handoffPhase: string | null;
  bindingGate: Awaited<ReturnType<typeof evaluateChannelProjectBindingGate>> | null;
  queueDepth: number;
  activeSessionCount: number;
  pendingMailboxCount: number;
  intents: Array<{
    intentId: string;
    status: string;
    toRole: string;
    stageAfter: string | null;
    executionId: string | null;
    attempts: number;
    lastAttemptAt: string | null;
    ackDeadlineAt: string | null;
    claimLeaseExpiresAt: string | null;
    terminalReason: string | null;
  }>;
}> {
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(`${params.projectRoot}/PROJECT_MANIFEST.json`)) ??
    {};
  const orchestration = normalizeOrchestrationState(manifest.orchestration_state);
  const [handoffs, mailbox, queueStore, sessionsStore] = await Promise.all([
    readWorkflowHandoffIntentStore(params.projectRoot),
    readWorkflowMailbox(params.projectRoot).catch(() => ({
      schemaVersion: 1 as const,
      updatedAt: null,
      messages: [],
    })),
    readWorkflowRuntimeQueueStore(params.projectRoot),
    readWorkflowRuntimeSessionsStore(params.projectRoot),
  ]);
  const bindingGate =
    params.policy && params.sessionKey
      ? await evaluateChannelProjectBindingGate({
          policy: params.policy,
          context: {
            sessionKey: params.sessionKey,
          },
          projectRoot: params.projectRoot,
          projectId: params.projectId ?? readString(manifest.project_id),
          sessionKey: params.sessionKey,
          allowSessionProjectFallback: true,
          allowSessionFallbackOnBindingMismatch: false,
        })
      : null;
  return {
    projectRoot: params.projectRoot,
    projectId: params.projectId ?? readString(manifest.project_id),
    currentOwner:
      orchestration.currentOwner ?? readString(manifest.owner_agent),
    pendingHandoffId: orchestration.pendingHandoffId,
    pendingOwnerCandidate: orchestration.pendingOwnerCandidate,
    pendingStageCandidate: orchestration.pendingStageCandidate,
    handoffPhase: orchestration.handoffPhase,
    bindingGate,
    queueDepth: queueStore.entries.filter((entry) =>
      ["queued", "launching", "running", "needs_repair", "degraded"].includes(entry.status)
    ).length,
    activeSessionCount: sessionsStore.entries.filter((entry) => entry.status === "active").length,
    pendingMailboxCount: mailbox.messages.filter((entry) => entry.status === "pending").length,
    intents: handoffs.intents
      .slice()
      .sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      )
      .map((intent) => ({
        intentId: intent.intentId,
        status: intent.status,
        toRole: intent.toRole,
        stageAfter: intent.stageAfter ?? intent.stage,
        executionId: intent.executionId,
        attempts: intent.deliveryAttempts.length,
        lastAttemptAt: intent.deliveryAttempts.at(-1)?.attemptedAt ?? null,
        ackDeadlineAt: intent.deliveryPlan.ackDeadlineAt,
        claimLeaseExpiresAt: intent.claimLeaseExpiresAt,
        terminalReason: intent.terminalReason,
      })),
  };
}
