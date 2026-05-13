import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  readJsonIfExists,
  withAdvisoryLock,
  writeJsonAtomicEnsured,
} from "../workflow-guard-core/fs";
import {
  buildDefaultWorkflowHandoffDeliveryPlan,
  getWorkflowHandoffDefaultExpiresAt,
} from "./handoff-defaults";
import { appendWorkflowHandoffEvent } from "./handoff-events";
import type {
  WorkflowHandoffDeliveryAttempt,
  WorkflowHandoffDeliveryChannel,
  WorkflowHandoffIntent,
  WorkflowHandoffIntentStore,
  WorkflowHandoffReason,
  WorkflowHandoffStatus,
} from "./handoff-types";
import {
  canTransitionWorkflowHandoffStatus,
  isWorkflowHandoffActiveStatus,
  isWorkflowHandoffTerminalStatus,
} from "./handoff-types";

const HANDOFF_INTENTS_FILENAME = "workflow-handoff-intents.json";
const HANDOFF_STORE_LOCK_TIMEOUT_MS = 60_000;
const HANDOFF_STORE_LOCK_RETRY_MS = 100;
const HANDOFF_STORE_LOCK_STALE_MS = 5 * 60_000;

function nowIso(): string {
  return new Date().toISOString();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeWorkflowLine(value: unknown): "experiment" | "survey" {
  return value === "survey" ? "survey" : "experiment";
}

function withWorkflowHandoffStoreLock<T>(
  projectRoot: string,
  task: () => Promise<T>
): Promise<T> {
  return withAdvisoryLock({
    lockPath: lockPath(projectRoot),
    timeoutMs: HANDOFF_STORE_LOCK_TIMEOUT_MS,
    retryMs: HANDOFF_STORE_LOCK_RETRY_MS,
    staleMs: HANDOFF_STORE_LOCK_STALE_MS,
    task,
  });
}

function normalizePriority(value: unknown): WorkflowHandoffIntent["priority"] {
  return value === "low" || value === "normal" || value === "high" || value === "urgent"
    ? value
    : "normal";
}

function normalizeStatus(value: unknown): WorkflowHandoffStatus {
  return value === "prepared" ||
    value === "queued" ||
    value === "dispatching" ||
    value === "dispatched" ||
    value === "delivered" ||
    value === "acknowledged" ||
    value === "claimed" ||
    value === "activated" ||
    value === "completed" ||
    value === "failed" ||
    value === "stale_claim" ||
    value === "expired" ||
    value === "superseded" ||
    value === "escalated" ||
    value === "cancelled"
    ? value
    : "pending";
}

function normalizeReason(value: unknown): WorkflowHandoffReason {
  const raw = readString(value);
  const allowed = new Set<WorkflowHandoffReason>([
    "stage_owner_change",
    "task_completed",
    "dependency_unblocked",
    "verification_failed",
    "tool_unavailable",
    "runtime_unavailable",
    "exec_approval_required",
    "paper_ingestion_failed",
    "graph_presence_failed",
    "code_review_required",
    "code_review_failed",
    "plan_review_required",
    "plan_inconsistent",
    "survey_review_required",
    "survey_route_drift",
    "paper_review_required",
    "cross_domain_evidence_missing",
    "capability_stale",
    "handoff_ack_timeout",
    "discord_inbound_timeout",
    "inbound_budget_exceeded",
    "broadcast_delivery_timeout",
    "stale_claim",
    "write_scope_conflict",
    "manual_recovery",
  ]);
  return raw && allowed.has(raw as WorkflowHandoffReason)
    ? (raw as WorkflowHandoffReason)
    : "manual_recovery";
}

function normalizeChannel(value: unknown): WorkflowHandoffDeliveryChannel | null {
  return value === "native_runtime" ||
    value === "lobster" ||
    value === "channel_broadcast" ||
    value === "runtime_queue" ||
    value === "mailbox_compat" ||
    value === "human_escalation"
    ? value
    : null;
}

function normalizeDeliveryAttempts(value: unknown): WorkflowHandoffDeliveryAttempt[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const attempts: WorkflowHandoffDeliveryAttempt[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const channel = normalizeChannel(record.channel);
    if (!channel) {
      continue;
    }
    attempts.push({
      attemptId: readString(record.attemptId) ?? randomUUID(),
      channel,
      status:
        record.status === "delivered" ||
        record.status === "failed" ||
        record.status === "skipped"
          ? record.status
          : "pending",
      runId: readString(record.runId),
      sessionKey: readString(record.sessionKey),
      messageId: readString(record.messageId),
      queueKey: readString(record.queueKey),
      error: readString(record.error),
      attemptedAt: readString(record.attemptedAt) ?? nowIso(),
    });
  }
  return attempts;
}

function normalizeIntent(value: unknown, projectRoot: string): WorkflowHandoffIntent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const intentId = readString(record.intentId) ?? randomUUID();
  const idempotencyKey = readString(record.idempotencyKey);
  const toRole = readString(record.toRole);
  if (!idempotencyKey || !toRole) {
    return null;
  }
  const reason = normalizeReason(record.reason);
  const deliveryPlanRecord =
    record.deliveryPlan && typeof record.deliveryPlan === "object" && !Array.isArray(record.deliveryPlan)
      ? (record.deliveryPlan as Record<string, unknown>)
      : null;
  const defaultPlan = buildDefaultWorkflowHandoffDeliveryPlan({ reason });
  const maxAttemptsByChannel: Partial<Record<WorkflowHandoffDeliveryChannel, number>> = {
    ...defaultPlan.maxAttemptsByChannel,
  };
  const rawAttemptsByChannel = deliveryPlanRecord?.maxAttemptsByChannel;
  if (rawAttemptsByChannel && typeof rawAttemptsByChannel === "object" && !Array.isArray(rawAttemptsByChannel)) {
    for (const [key, attemptValue] of Object.entries(rawAttemptsByChannel)) {
      const channel = normalizeChannel(key);
      const count = readNumber(attemptValue);
      if (channel && count != null) {
        maxAttemptsByChannel[channel] = Math.max(0, Math.floor(count));
      }
    }
  }
  return {
    schemaVersion: 1,
    intentId,
    idempotencyKey,
    projectId: readString(record.projectId),
    projectRoot: path.resolve(readString(record.projectRoot) ?? projectRoot),
    workflowLine: normalizeWorkflowLine(record.workflowLine),
    stage: readString(record.stage),
    fromRole: readString(record.fromRole),
    fromSessionKey: readString(record.fromSessionKey),
    toRole,
    toSessionKey: readString(record.toSessionKey),
    reason,
    priority: normalizePriority(record.priority),
    sourceTaskId: readString(record.sourceTaskId),
    targetTaskId: readString(record.targetTaskId),
    artifactReceiptId: readString(record.artifactReceiptId),
    failureId: readString(record.failureId),
    failureFingerprint: readString(record.failureFingerprint),
    repairLineageId: readString(record.repairLineageId),
    status: normalizeStatus(record.status),
    stageBefore: readString(record.stageBefore) ?? readString(record.stage_before),
    stageAfter:
      readString(record.stageAfter) ??
      readString(record.stage_after) ??
      readString(record.stage),
    executionId: readString(record.executionId) ?? readString(record.execution_id),
    sessionBindingKey:
      readString(record.sessionBindingKey) ?? readString(record.session_binding_key),
    preferredSessionKeys: (() => {
      const rawPreferred = record.preferredSessionKeys ?? record.preferred_session_keys;
      if (!Array.isArray(rawPreferred)) {
        return [];
      }
      return rawPreferred
        .map(readString)
        .filter((entry): entry is string => Boolean(entry));
    })(),
    deliveryPlan: {
      channels: Array.isArray(deliveryPlanRecord?.channels)
        ? deliveryPlanRecord.channels
            .map(normalizeChannel)
            .filter((entry): entry is WorkflowHandoffDeliveryChannel => Boolean(entry))
        : defaultPlan.channels,
      requireAck:
        typeof deliveryPlanRecord?.requireAck === "boolean"
          ? deliveryPlanRecord.requireAck
          : defaultPlan.requireAck,
      ackDeadlineAt:
        readString(deliveryPlanRecord?.ackDeadlineAt) ?? defaultPlan.ackDeadlineAt,
      fallbackAfterMs:
        readNumber(deliveryPlanRecord?.fallbackAfterMs) ?? defaultPlan.fallbackAfterMs,
      maxAttemptsTotal:
        readNumber(deliveryPlanRecord?.maxAttemptsTotal) ?? defaultPlan.maxAttemptsTotal,
      maxAttemptsByChannel,
      staleClaimAfterMs:
        readNumber(deliveryPlanRecord?.staleClaimAfterMs) ?? defaultPlan.staleClaimAfterMs,
    },
    deliveryAttempts: normalizeDeliveryAttempts(record.deliveryAttempts),
    dispatchedAt: readString(record.dispatchedAt) ?? readString(record.dispatched_at),
    acknowledgedAt:
      readString(record.acknowledgedAt) ?? readString(record.acknowledged_at),
    claimedAt: readString(record.claimedAt),
    activatedAt: readString(record.activatedAt) ?? readString(record.activated_at),
    claimLeaseExpiresAt: readString(record.claimLeaseExpiresAt),
    terminalReason: readString(record.terminalReason),
    createdAt: readString(record.createdAt) ?? nowIso(),
    updatedAt: readString(record.updatedAt) ?? nowIso(),
    expiresAt: readString(record.expiresAt),
    summary: readString(record.summary),
    command: readString(record.command),
    blockerSummary: readString(record.blockerSummary),
    payload:
      record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)
        ? (record.payload as Record<string, unknown>)
        : null,
  };
}

export function getWorkflowHandoffIntentPath(projectRoot: string): string {
  return path.join(
    path.resolve(projectRoot),
    ".openclaw-research",
    HANDOFF_INTENTS_FILENAME
  );
}

function lockPath(projectRoot: string): string {
  return `${getWorkflowHandoffIntentPath(projectRoot)}.lock`;
}

export async function readWorkflowHandoffIntentStore(
  projectRoot: string
): Promise<WorkflowHandoffIntentStore> {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const store = await readJsonIfExists<Partial<WorkflowHandoffIntentStore>>(
    getWorkflowHandoffIntentPath(resolvedProjectRoot)
  );
  const intents = Array.isArray(store?.intents)
    ? store.intents
        .map((entry) => normalizeIntent(entry, resolvedProjectRoot))
        .filter((entry): entry is WorkflowHandoffIntent => Boolean(entry))
    : [];
  return {
    schemaVersion: 1,
    projectId: readString(store?.projectId),
    projectRoot: resolvedProjectRoot,
    updatedAt: readString(store?.updatedAt) ?? nowIso(),
    intents,
  };
}

export async function writeWorkflowHandoffIntentStore(
  store: WorkflowHandoffIntentStore
): Promise<void> {
  await writeJsonAtomicEnsured(getWorkflowHandoffIntentPath(store.projectRoot), {
    ...store,
    schemaVersion: 1,
    projectRoot: path.resolve(store.projectRoot),
    updatedAt: nowIso(),
  });
}

export async function upsertWorkflowHandoffIntent(params: {
  projectRoot: string;
  projectId?: string | null;
  idempotencyKey: string;
  workflowLine?: "experiment" | "survey";
  stage?: string | null;
  fromRole?: string | null;
  fromSessionKey?: string | null;
  toRole: string;
  toSessionKey?: string | null;
  reason: WorkflowHandoffReason;
  priority?: WorkflowHandoffIntent["priority"];
  sourceTaskId?: string | null;
  targetTaskId?: string | null;
  artifactReceiptId?: string | null;
  failureId?: string | null;
  failureFingerprint?: string | null;
  repairLineageId?: string | null;
  status?: WorkflowHandoffStatus;
  stageBefore?: string | null;
  stageAfter?: string | null;
  executionId?: string | null;
  sessionBindingKey?: string | null;
  preferredSessionKeys?: string[] | null;
  summary?: string | null;
  command?: string | null;
  blockerSummary?: string | null;
  payload?: Record<string, unknown> | null;
  deliveryPlan?: Partial<WorkflowHandoffIntent["deliveryPlan"]>;
}): Promise<{ intent: WorkflowHandoffIntent; created: boolean }> {
  const projectRoot = path.resolve(params.projectRoot);
  return withWorkflowHandoffStoreLock(projectRoot, async () => {
    const store = await readWorkflowHandoffIntentStore(projectRoot);
    const matchingIntents = store.intents.filter(
      (entry) => entry.idempotencyKey === params.idempotencyKey
    );
    const terminalIntents = matchingIntents.filter((entry) =>
      isWorkflowHandoffTerminalStatus(entry.status)
    );
    const blockingTerminalExisting = terminalIntents.find(
      (entry) => entry.status !== "expired"
    );
    const expiredTerminalExisting = terminalIntents.find(
      (entry) => entry.status === "expired"
    );
    if (blockingTerminalExisting) {
      const duplicateActiveIntents = matchingIntents.filter(
        (entry) =>
          entry.intentId !== blockingTerminalExisting.intentId &&
          isWorkflowHandoffActiveStatus(entry.status)
      );
      if (duplicateActiveIntents.length > 0) {
        const updatedAt = nowIso();
        const nextStore = {
          ...store,
          intents: store.intents.map((entry) =>
            duplicateActiveIntents.some((duplicate) => duplicate.intentId === entry.intentId)
              ? {
                  ...entry,
                  status: "superseded" as const,
                  terminalReason:
                    "duplicate_idempotency_key_already_terminal",
                  updatedAt,
                }
              : entry
          ),
        };
        await writeWorkflowHandoffIntentStore(nextStore);
        for (const duplicate of duplicateActiveIntents) {
          await appendWorkflowHandoffEvent({
            projectRoot,
            projectId: duplicate.projectId,
            intentId: duplicate.intentId,
            idempotencyKey: duplicate.idempotencyKey,
            kind: "duplicate_intent_superseded",
            fromStatus: duplicate.status,
            toStatus: "superseded",
            summary:
              "Superseded duplicate active handoff because the same idempotency key already reached a terminal state.",
            details: {
              terminalIntentId: blockingTerminalExisting.intentId,
              terminalStatus: blockingTerminalExisting.status,
            },
          });
        }
      }
      await appendWorkflowHandoffEvent({
        projectRoot,
        projectId: blockingTerminalExisting.projectId,
        intentId: blockingTerminalExisting.intentId,
        idempotencyKey: blockingTerminalExisting.idempotencyKey,
        kind: "terminal_intent_reused",
        fromStatus: blockingTerminalExisting.status,
        toStatus: blockingTerminalExisting.status,
        summary:
          "Reused terminal handoff intent for duplicate idempotency key instead of creating a new intent.",
      });
      return { intent: blockingTerminalExisting, created: false };
    }
    const existing = matchingIntents.find((entry) =>
      isWorkflowHandoffActiveStatus(entry.status)
    );
    if (existing) {
      const mergedPayload =
        params.payload || existing.payload
          ? {
              ...(existing.payload ?? {}),
              ...(params.payload ?? {}),
            }
          : null;
      const enriched: WorkflowHandoffIntent = {
        ...existing,
        projectId: readString(params.projectId) ?? existing.projectId,
        workflowLine: params.workflowLine ?? existing.workflowLine,
        stage: readString(params.stage) ?? existing.stage,
        stageBefore: readString(params.stageBefore) ?? existing.stageBefore,
        stageAfter: readString(params.stageAfter) ?? existing.stageAfter,
        executionId: readString(params.executionId) ?? existing.executionId,
        fromRole: readString(params.fromRole) ?? existing.fromRole,
        fromSessionKey: readString(params.fromSessionKey) ?? existing.fromSessionKey,
        toSessionKey: readString(params.toSessionKey) ?? existing.toSessionKey,
        summary: readString(params.summary) ?? existing.summary,
        command: readString(params.command) ?? existing.command,
        blockerSummary: readString(params.blockerSummary) ?? existing.blockerSummary,
        sessionBindingKey:
          readString(params.sessionBindingKey) ?? existing.sessionBindingKey,
        preferredSessionKeys:
          Array.isArray(params.preferredSessionKeys) &&
          params.preferredSessionKeys.length > 0
            ? params.preferredSessionKeys
                .map(readString)
                .filter((entry): entry is string => Boolean(entry))
            : existing.preferredSessionKeys,
        payload: mergedPayload,
        updatedAt: nowIso(),
      };
      const changed =
        JSON.stringify(enriched) !== JSON.stringify(existing);
      if (changed) {
        const nextStore = {
          ...store,
          intents: store.intents.map((entry) =>
            entry.intentId === existing.intentId ? enriched : entry
          ),
        };
        await writeWorkflowHandoffIntentStore(nextStore);
        await appendWorkflowHandoffEvent({
          projectRoot,
          projectId: enriched.projectId,
          intentId: enriched.intentId,
          idempotencyKey: enriched.idempotencyKey,
          kind: "intent_enriched",
          fromStatus: existing.status,
          toStatus: enriched.status,
          summary: "Updated an existing active handoff intent with stronger runtime context.",
        });
      }
      return { intent: changed ? enriched : existing, created: false };
    }
    const now = new Date();
    const defaultPlan = buildDefaultWorkflowHandoffDeliveryPlan({
      reason: params.reason,
      now,
    });
    const intent: WorkflowHandoffIntent = {
      schemaVersion: 1,
      intentId: randomUUID(),
      idempotencyKey: params.idempotencyKey,
      projectId: readString(params.projectId),
      projectRoot,
      workflowLine: params.workflowLine ?? "experiment",
      stage: readString(params.stage),
      fromRole: readString(params.fromRole),
      fromSessionKey: readString(params.fromSessionKey),
      toRole: params.toRole,
      toSessionKey: readString(params.toSessionKey),
      reason: params.reason,
      priority: params.priority ?? "normal",
      sourceTaskId: readString(params.sourceTaskId),
      targetTaskId: readString(params.targetTaskId),
      artifactReceiptId: readString(params.artifactReceiptId),
      failureId: readString(params.failureId),
      failureFingerprint: readString(params.failureFingerprint),
      repairLineageId: readString(params.repairLineageId),
      status: params.status ?? "prepared",
      stageBefore: readString(params.stageBefore),
      stageAfter: readString(params.stageAfter) ?? readString(params.stage),
      executionId: readString(params.executionId),
      sessionBindingKey: readString(params.sessionBindingKey),
      preferredSessionKeys: Array.isArray(params.preferredSessionKeys)
        ? params.preferredSessionKeys
            .map(readString)
            .filter((entry): entry is string => Boolean(entry))
        : [],
      deliveryPlan: {
        ...defaultPlan,
        ...params.deliveryPlan,
        maxAttemptsByChannel: {
          ...defaultPlan.maxAttemptsByChannel,
          ...(params.deliveryPlan?.maxAttemptsByChannel ?? {}),
        },
        channels: params.deliveryPlan?.channels ?? defaultPlan.channels,
      },
      deliveryAttempts: [],
      dispatchedAt: null,
      acknowledgedAt: null,
      claimedAt: null,
      activatedAt: null,
      claimLeaseExpiresAt: null,
      terminalReason: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt:
        readString(params.payload?.expiresAt) ??
        getWorkflowHandoffDefaultExpiresAt({ reason: params.reason, now }),
      summary: readString(params.summary),
      command: readString(params.command),
      blockerSummary: readString(params.blockerSummary),
      payload: params.payload ?? null,
    };
    const nextStore = {
      ...store,
      projectId: intent.projectId ?? store.projectId,
      intents: [...store.intents, intent],
    };
    await writeWorkflowHandoffIntentStore(nextStore);
    await appendWorkflowHandoffEvent({
      projectRoot,
      projectId: intent.projectId,
      intentId: intent.intentId,
      idempotencyKey: intent.idempotencyKey,
      kind: "intent_created",
      toStatus: intent.status,
      summary: intent.summary ?? `Created ${intent.reason} handoff for ${intent.toRole}.`,
    });
    if (expiredTerminalExisting) {
      await appendWorkflowHandoffEvent({
        projectRoot,
        projectId: intent.projectId,
        intentId: intent.intentId,
        idempotencyKey: intent.idempotencyKey,
        kind: "expired_terminal_intent_reissued",
        fromStatus: expiredTerminalExisting.status,
        toStatus: intent.status,
        summary:
          "Created a fresh handoff intent because the previous matching intent expired before delivery completed.",
        details: {
          expiredIntentId: expiredTerminalExisting.intentId,
        },
      });
    }
    return { intent, created: true };
  });
}

export async function transitionWorkflowHandoffIntent(params: {
  projectRoot: string;
  intentId?: string | null;
  idempotencyKey?: string | null;
  toStatus: WorkflowHandoffStatus;
  summary?: string | null;
  terminalReason?: string | null;
  patch?: Partial<WorkflowHandoffIntent>;
}): Promise<WorkflowHandoffIntent | null> {
  const projectRoot = path.resolve(params.projectRoot);
  return withWorkflowHandoffStoreLock(projectRoot, async () => {
    const store = await readWorkflowHandoffIntentStore(projectRoot);
    const index = store.intents.findIndex(
      (entry) =>
        (readString(params.intentId) && entry.intentId === params.intentId) ||
        (readString(params.idempotencyKey) &&
          entry.idempotencyKey === params.idempotencyKey)
    );
    if (index < 0) {
      return null;
    }
    const current = store.intents[index];
    if (!canTransitionWorkflowHandoffStatus({ from: current.status, to: params.toStatus })) {
      await appendWorkflowHandoffEvent({
        projectRoot,
        projectId: current.projectId,
        intentId: current.intentId,
        idempotencyKey: current.idempotencyKey,
        kind: "invalid_status_transition",
        fromStatus: current.status,
        toStatus: params.toStatus,
        summary:
          params.summary ??
          `Rejected invalid handoff transition ${current.status} -> ${params.toStatus}.`,
      });
      return current;
    }
    const updated: WorkflowHandoffIntent = {
      ...current,
      ...(params.patch ?? {}),
      status: params.toStatus,
      acknowledgedAt:
        params.toStatus === "acknowledged"
          ? nowIso()
          : params.toStatus === "claimed" ||
              params.toStatus === "activated" ||
              params.toStatus === "completed" ||
              params.toStatus === "failed" ||
              params.toStatus === "superseded" ||
              params.toStatus === "expired" ||
              params.toStatus === "escalated" ||
              params.toStatus === "cancelled"
            ? current.acknowledgedAt
            : current.acknowledgedAt,
      dispatchedAt:
        params.toStatus === "dispatching" || params.toStatus === "dispatched"
          ? current.dispatchedAt ?? nowIso()
          : current.dispatchedAt,
      claimedAt:
        params.toStatus === "claimed"
          ? current.claimedAt ?? nowIso()
          : current.claimedAt,
      activatedAt:
        params.toStatus === "activated"
          ? current.activatedAt ?? nowIso()
          : current.activatedAt,
      terminalReason:
        isWorkflowHandoffTerminalStatus(params.toStatus)
          ? readString(params.terminalReason) ?? current.terminalReason
          : current.terminalReason,
      updatedAt: nowIso(),
    };
    const nextIntents = [...store.intents];
    nextIntents[index] = updated;
    await writeWorkflowHandoffIntentStore({
      ...store,
      intents: nextIntents,
    });
    await appendWorkflowHandoffEvent({
      projectRoot,
      projectId: updated.projectId,
      intentId: updated.intentId,
      idempotencyKey: updated.idempotencyKey,
      kind: "status_transition",
      fromStatus: current.status,
      toStatus: updated.status,
      summary:
        params.summary ??
        `Handoff ${updated.intentId} transitioned ${current.status} -> ${updated.status}.`,
    });
    return updated;
  });
}

export async function appendWorkflowHandoffDeliveryAttempt(params: {
  projectRoot: string;
  intentId?: string | null;
  idempotencyKey?: string | null;
  attempt: Omit<WorkflowHandoffDeliveryAttempt, "attemptId" | "attemptedAt"> &
    Partial<Pick<WorkflowHandoffDeliveryAttempt, "attemptId" | "attemptedAt">>;
}): Promise<WorkflowHandoffIntent | null> {
  const projectRoot = path.resolve(params.projectRoot);
  return withWorkflowHandoffStoreLock(projectRoot, async () => {
    const store = await readWorkflowHandoffIntentStore(projectRoot);
    const index = store.intents.findIndex(
      (entry) =>
        (readString(params.intentId) && entry.intentId === params.intentId) ||
        (readString(params.idempotencyKey) &&
          entry.idempotencyKey === params.idempotencyKey)
    );
    if (index < 0) {
      return null;
    }
    const current = store.intents[index];
    if (isWorkflowHandoffTerminalStatus(current.status)) {
      return current;
    }
    const attempt: WorkflowHandoffDeliveryAttempt = {
      ...params.attempt,
      attemptId: readString(params.attempt.attemptId) ?? randomUUID(),
      attemptedAt: readString(params.attempt.attemptedAt) ?? nowIso(),
    };
    const updated: WorkflowHandoffIntent = {
      ...current,
      deliveryAttempts: [...current.deliveryAttempts, attempt],
      updatedAt: nowIso(),
    };
    const nextIntents = [...store.intents];
    nextIntents[index] = updated;
    await writeWorkflowHandoffIntentStore({
      ...store,
      intents: nextIntents,
    });
    await appendWorkflowHandoffEvent({
      projectRoot,
      projectId: updated.projectId,
      intentId: updated.intentId,
      idempotencyKey: updated.idempotencyKey,
      kind: "delivery_attempt_recorded",
      fromStatus: current.status,
      toStatus: updated.status,
      summary: `${attempt.channel} delivery ${attempt.status}.`,
      details: { attempt },
    });
    return updated;
  });
}

export function countWorkflowHandoffAttemptsByChannel(
  intent: WorkflowHandoffIntent,
  channel: WorkflowHandoffDeliveryChannel
): number {
  return intent.deliveryAttempts.filter((attempt) => attempt.channel === channel).length;
}

export function countWorkflowHandoffAttemptsTotal(intent: WorkflowHandoffIntent): number {
  return intent.deliveryAttempts.length;
}

export async function findWorkflowHandoffIntent(params: {
  projectRoot: string;
  intentId?: string | null;
  idempotencyKey?: string | null;
}): Promise<WorkflowHandoffIntent | null> {
  const store = await readWorkflowHandoffIntentStore(params.projectRoot);
  return (
    store.intents.find(
      (entry) =>
        (readString(params.intentId) && entry.intentId === params.intentId) ||
        (readString(params.idempotencyKey) &&
          entry.idempotencyKey === params.idempotencyKey)
    ) ?? null
  );
}

export async function claimWorkflowHandoffIntent(params: {
  projectRoot: string;
  intentId?: string | null;
  idempotencyKey?: string | null;
  sessionKey?: string | null;
  claimLeaseExpiresAt?: string | null;
}): Promise<WorkflowHandoffIntent | null> {
  const existing = await findWorkflowHandoffIntent(params);
  if (!existing) {
    return null;
  }
  const targetStatus =
    existing.status === "claimed" || existing.status === "activated"
      ? existing.status
      : "claimed";
  return transitionWorkflowHandoffIntent({
    projectRoot: params.projectRoot,
    intentId: params.intentId,
    idempotencyKey: params.idempotencyKey,
    toStatus: targetStatus,
    summary:
      targetStatus === "claimed"
        ? "Target agent claimed the handoff."
        : "Handoff was already claimed.",
    patch: {
      toSessionKey: readString(params.sessionKey) ?? existing.toSessionKey,
      claimLeaseExpiresAt:
        readString(params.claimLeaseExpiresAt) ?? existing.claimLeaseExpiresAt,
    },
  });
}

export async function activateWorkflowHandoffIntent(params: {
  projectRoot: string;
  intentId?: string | null;
  idempotencyKey?: string | null;
}): Promise<WorkflowHandoffIntent | null> {
  const existing = await findWorkflowHandoffIntent(params);
  if (!existing) {
    return null;
  }
  const targetStatus =
    existing.status === "activated" || existing.status === "completed"
      ? existing.status
      : "activated";
  return transitionWorkflowHandoffIntent({
    projectRoot: params.projectRoot,
    intentId: params.intentId,
    idempotencyKey: params.idempotencyKey,
    toStatus: targetStatus,
    summary:
      targetStatus === "activated"
        ? "Workflow activated the claimed handoff."
        : "Handoff was already activated.",
  });
}

export async function findRetriableWorkflowHandoffIntents(params: {
  projectRoot: string;
  now?: Date;
}): Promise<WorkflowHandoffIntent[]> {
  const now = params.now ?? new Date();
  const nowMs = now.getTime();
  const store = await readWorkflowHandoffIntentStore(params.projectRoot);
  return store.intents.filter((intent) => {
    if (isWorkflowHandoffTerminalStatus(intent.status)) {
      return false;
    }
    if (!["prepared", "queued", "dispatching", "dispatched", "delivered", "acknowledged", "failed", "stale_claim", "pending"].includes(intent.status)) {
      return false;
    }
    if (intent.expiresAt && Number.isFinite(Date.parse(intent.expiresAt)) && Date.parse(intent.expiresAt) <= nowMs) {
      return false;
    }
    if (countWorkflowHandoffAttemptsTotal(intent) >= intent.deliveryPlan.maxAttemptsTotal) {
      return false;
    }
    const lastAttemptAt = intent.deliveryAttempts.at(-1)?.attemptedAt ?? null;
    const defaultFallbackAfterMs =
      typeof intent.deliveryPlan.fallbackAfterMs === "number" &&
      Number.isFinite(intent.deliveryPlan.fallbackAfterMs)
        ? Math.max(0, Math.floor(intent.deliveryPlan.fallbackAfterMs))
        : 0;
    const effectiveBackoffMs =
      intent.status === "failed" || intent.status === "stale_claim"
        ? defaultFallbackAfterMs > 0
          ? Math.min(defaultFallbackAfterMs, 30_000)
          : 30_000
        : intent.status === "dispatched" ||
            intent.status === "delivered" ||
            intent.status === "acknowledged"
          ? defaultFallbackAfterMs > 0
            ? Math.min(defaultFallbackAfterMs, 60_000)
            : 60_000
          : defaultFallbackAfterMs;
    if (
      lastAttemptAt &&
      effectiveBackoffMs > 0 &&
      Number.isFinite(Date.parse(lastAttemptAt)) &&
      Date.parse(lastAttemptAt) + effectiveBackoffMs > nowMs
    ) {
      return false;
    }
    return true;
  });
}
