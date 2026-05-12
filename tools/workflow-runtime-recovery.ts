import path from "node:path";
import {
  appendWorkflowRuntimeEvent,
  migrateWorkflowRuntimeState,
  readWorkflowBroadcastOutboxStore,
  readWorkflowRuntimeQueueStore,
  readWorkflowRuntimeSessionsStore,
  writeWorkflowBroadcastOutboxStore,
  writeWorkflowRuntimeQueueStore,
  writeWorkflowRuntimeSessionsStore,
} from "./workflow-runtime-state.js";
import {
  consumeWorkflowAnnounceOutbox,
  replayWorkflowBroadcastOutbox,
} from "./workflow-announce-runtime.js";
import { appendWorkflowDiagnosticEvent } from "./workflow-diagnostics.js";
import { readWorkflowHandoffIntentStore } from "./workflow-handoff/handoff-store";
import { isWorkflowHandoffActiveStatus } from "./workflow-handoff/handoff-types";
import type { ChannelProjectBindingPolicy } from "./channel-project-bindings";
import type {
  WorkflowRuntimeBroadcastEntry,
  WorkflowRuntimeQueueEntry,
  WorkflowRuntimeSessionEntry,
} from "./workflow-runtime-state.js";

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function resolveProjectId(projectRoot: string, projectId?: string | null): string {
  return readString(projectId) ?? path.basename(projectRoot);
}

function isStaleIso(iso: string | null, staleSessionAgeMs: number): boolean {
  if (!iso) {
    return true;
  }
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) {
    return true;
  }
  return Date.now() - timestamp > staleSessionAgeMs;
}

function queueSessionCandidates(entry: WorkflowRuntimeQueueEntry): Set<string> {
  return new Set(
    [
      entry.preferredSessionKey,
      entry.requesterSessionKey,
      ...(entry.dispatchPayload?.preferredSessionKeys ?? []),
    ].filter((value): value is string => Boolean(readString(value)))
  );
}

function hasFreshActiveSessionForQueue(
  entry: WorkflowRuntimeQueueEntry,
  sessions: WorkflowRuntimeSessionEntry[],
  staleSessionAgeMs: number
): boolean {
  const candidates = queueSessionCandidates(entry);
  return sessions.some((session) => {
    if (session.status !== "active" || isStaleSessionEntry(session, staleSessionAgeMs)) {
      return false;
    }
    return session.queueKey === entry.queueKey || candidates.has(session.sessionKey);
  });
}

function isStaleQueueEntry(
  entry: WorkflowRuntimeQueueEntry,
  staleSessionAgeMs: number,
  sessions: WorkflowRuntimeSessionEntry[] = []
): boolean {
  if (!["queued", "launching", "running", "degraded"].includes(entry.status)) {
    return false;
  }
  const freshness = entry.lastAttemptedAt ?? entry.queuedAt;
  if (!isStaleIso(freshness, staleSessionAgeMs)) {
    return false;
  }
  if (entry.status === "running") {
    return !hasFreshActiveSessionForQueue(entry, sessions, staleSessionAgeMs);
  }
  return true;
}

function isStaleSessionEntry(
  entry: WorkflowRuntimeSessionEntry,
  staleSessionAgeMs: number
): boolean {
  if (entry.status !== "active") {
    return false;
  }
  const freshness =
    entry.lastHeartbeatAt ?? entry.lastCheckedAt ?? entry.startedAt;
  return isStaleIso(freshness, staleSessionAgeMs);
}

export type WorkflowRuntimeRecoveryStage =
  | "announce_replay"
  | "broadcast_replay"
  | "queued_transitions"
  | "stale_sessions";

export type WorkflowRuntimeRecoveryPlan = {
  projectId: string | null;
  projectRoot: string;
  stageOrder: WorkflowRuntimeRecoveryStage[];
  announcePending: string[];
  broadcastPending: string[];
  staleQueueKeys: string[];
  staleSessionKeys: string[];
};

export type WorkflowRuntimeRecoveryResult = {
  projectId: string | null;
  projectRoot: string;
  stageOrder: WorkflowRuntimeRecoveryStage[];
  plan: WorkflowRuntimeRecoveryPlan;
  announce: Awaited<ReturnType<typeof consumeWorkflowAnnounceOutbox>>;
  broadcast: Awaited<ReturnType<typeof replayWorkflowBroadcastOutbox>>;
  queue: {
    repaired: WorkflowRuntimeQueueEntry[];
    store: Awaited<ReturnType<typeof readWorkflowRuntimeQueueStore>>;
  };
  sessions: {
    repaired: WorkflowRuntimeSessionEntry[];
    store: Awaited<ReturnType<typeof readWorkflowRuntimeSessionsStore>>;
  };
  repairedQueue: WorkflowRuntimeQueueEntry[];
  repairedSessions: WorkflowRuntimeSessionEntry[];
  recoveryBroadcast: WorkflowRuntimeBroadcastEntry | null;
};

export type WorkflowRuntimeDispatchReconciliationResult = {
  projectId: string | null;
  projectRoot: string;
  stage: string | null;
  owner: string | null;
  queueKey: string | null;
  status: "healthy" | "waiting_for_dispatch" | "waiting_for_owner" | "stale_reclaimed";
  shouldDispatch: boolean;
  detectedCondition: string | null;
  activeSessionKeys: string[];
  reclaimedSessionKeys: string[];
  activeQueueKeys: string[];
  activeHandoffIds: string[];
  lastSessionHeartbeatAt: string | null;
};

const ACTIVE_RUNTIME_QUEUE_STATUSES = new Set([
  "queued",
  "launching",
  "running",
  "degraded",
]);

function sameResolvedPath(left: string | null | undefined, right: string): boolean {
  const resolvedLeft = readString(left);
  return !resolvedLeft || path.resolve(resolvedLeft) === right;
}

function ownerMatches(
  value: string | null | undefined,
  owner: string | null
): boolean {
  const normalizedOwner = readString(owner);
  return !normalizedOwner || readString(value) === normalizedOwner;
}

function stageMatches(
  value: string | null | undefined,
  stage: string | null
): boolean {
  const normalizedStage = readString(stage);
  return !normalizedStage || readString(value) === normalizedStage;
}

function activeQueueMatchesDispatch(params: {
  entry: WorkflowRuntimeQueueEntry;
  projectRoot: string;
  owner: string | null;
  stage: string | null;
  queueKey: string | null;
}): boolean {
  if (!ACTIVE_RUNTIME_QUEUE_STATUSES.has(params.entry.status)) {
    return false;
  }
  if (!sameResolvedPath(params.entry.projectRoot, params.projectRoot)) {
    return false;
  }
  if (readString(params.queueKey) && params.entry.queueKey === params.queueKey) {
    return true;
  }
  if (!ownerMatches(params.entry.ownerAgent, params.owner)) {
    return false;
  }
  return stageMatches(params.entry.dispatchPayload?.stage, params.stage);
}

function activeSessionMatchesDispatch(params: {
  entry: WorkflowRuntimeSessionEntry;
  projectRoot: string;
  owner: string | null;
  queueKey: string | null;
}): boolean {
  if (params.entry.status !== "active") {
    return false;
  }
  if (!sameResolvedPath(params.entry.projectRoot, params.projectRoot)) {
    return false;
  }
  if (readString(params.queueKey) && params.entry.queueKey === params.queueKey) {
    return true;
  }
  if (
    !ownerMatches(params.entry.ownerAgent, params.owner) &&
    !ownerMatches(params.entry.agentId, params.owner) &&
    !ownerMatches(params.entry.role, params.owner)
  ) {
    return false;
  }
  return params.entry.family === "research" && params.entry.kind === "workflow_stage_dispatch";
}

function latestSessionFreshnessIso(
  entry: WorkflowRuntimeSessionEntry
): string | null {
  const candidates = [
    entry.lastHeartbeatAt,
    entry.lastAnnounceAt,
    entry.lastCheckedAt,
    entry.startedAt,
  ].filter((value): value is string => Boolean(readString(value)));
  return candidates
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

function latestIso(values: Array<string | null | undefined>): string | null {
  return values
    .filter((value): value is string => Boolean(readString(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

export async function reconcileWorkflowRuntimeDispatchState(params: {
  projectRoot: string;
  projectId?: string | null;
  stage?: string | null;
  owner?: string | null;
  queueKey?: string | null;
  staleSessionAgeMs?: number;
}): Promise<WorkflowRuntimeDispatchReconciliationResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const projectId = resolveProjectId(projectRoot, params.projectId);
  const stage = readString(params.stage);
  const owner = readString(params.owner);
  const queueKey = readString(params.queueKey);
  const staleSessionAgeMs =
    typeof params.staleSessionAgeMs === "number" && Number.isFinite(params.staleSessionAgeMs)
      ? Math.max(0, Math.floor(params.staleSessionAgeMs))
      : 15 * 60 * 1000;

  const [queueStore, sessionsStore, handoffStore] = await Promise.all([
    readWorkflowRuntimeQueueStore(projectRoot),
    readWorkflowRuntimeSessionsStore(projectRoot),
    readWorkflowHandoffIntentStore(projectRoot),
  ]);
  const activeQueue = queueStore.entries.filter((entry) =>
    activeQueueMatchesDispatch({
      entry,
      projectRoot,
      owner,
      stage,
      queueKey,
    })
  );
  const activeHandoffs = handoffStore.intents.filter(
    (intent) =>
      isWorkflowHandoffActiveStatus(intent.status) &&
      sameResolvedPath(intent.projectRoot, projectRoot) &&
      ownerMatches(intent.toRole, owner) &&
      stageMatches(intent.stageAfter ?? intent.stage, stage)
  );
  const activeSessions = sessionsStore.entries.filter((entry) =>
    activeSessionMatchesDispatch({
      entry,
      projectRoot,
      owner,
      queueKey,
    })
  );
  const activeSessionKeys = activeSessions.map((entry) => entry.sessionKey);
  const lastSessionHeartbeatAt = latestIso(
    activeSessions.map((entry) => latestSessionFreshnessIso(entry))
  );

  if (activeQueue.length > 0 || activeHandoffs.length > 0) {
    const result: WorkflowRuntimeDispatchReconciliationResult = {
      projectId,
      projectRoot,
      stage,
      owner,
      queueKey,
      status: "waiting_for_dispatch",
      shouldDispatch: false,
      detectedCondition: "active_dispatch_chain_exists",
      activeSessionKeys,
      reclaimedSessionKeys: [],
      activeQueueKeys: activeQueue.map((entry) => entry.queueKey),
      activeHandoffIds: activeHandoffs.map((entry) => entry.intentId),
      lastSessionHeartbeatAt,
    };
    await appendWorkflowDiagnosticEvent({
      projectRoot,
      projectId,
      component: "runtime_recovery",
      action: "dispatch_reconciliation",
      status: "waiting",
      stage,
      owner,
      summary:
        "Auto-stage dispatch is waiting because an active queue entry or handoff already owns this delivery chain.",
      details: result,
    });
    return result;
  }

  if (activeSessions.length === 0) {
    return {
      projectId,
      projectRoot,
      stage,
      owner,
      queueKey,
      status: "healthy",
      shouldDispatch: true,
      detectedCondition: null,
      activeSessionKeys,
      reclaimedSessionKeys: [],
      activeQueueKeys: activeQueue.map((entry) => entry.queueKey),
      activeHandoffIds: activeHandoffs.map((entry) => entry.intentId),
      lastSessionHeartbeatAt,
    };
  }

  const staleSessions = activeSessions.filter((entry) =>
    isStaleSessionEntry(entry, staleSessionAgeMs)
  );
  if (staleSessions.length !== activeSessions.length) {
    const result: WorkflowRuntimeDispatchReconciliationResult = {
      projectId,
      projectRoot,
      stage,
      owner,
      queueKey,
      status: "waiting_for_owner",
      shouldDispatch: false,
      detectedCondition: "orphaned_bound_session_without_handoff",
      activeSessionKeys,
      reclaimedSessionKeys: [],
      activeQueueKeys: [],
      activeHandoffIds: [],
      lastSessionHeartbeatAt,
    };
    await appendWorkflowDiagnosticEvent({
      projectRoot,
      projectId,
      component: "runtime_recovery",
      action: "dispatch_reconciliation",
      status: "waiting",
      stage,
      owner,
      summary:
        "Auto-stage dispatch is waiting because an active owner session exists without an active handoff or queue entry.",
      details: result,
    });
    return result;
  }

  const reclaimedSessionKeys = staleSessions.map((entry) => entry.sessionKey);
  const checkedAt = nowIso();
  await writeWorkflowRuntimeSessionsStore({
    projectRoot,
    projectId,
    entries: sessionsStore.entries.map((entry) =>
      reclaimedSessionKeys.includes(entry.sessionKey)
        ? {
            ...entry,
            status: "needs_repair",
            lastCheckedAt: checkedAt,
            lastError:
              entry.lastError ??
              "Reclaimed stale active stage-dispatch session with no active handoff or queue entry.",
          }
        : entry
    ),
  });

  const result: WorkflowRuntimeDispatchReconciliationResult = {
    projectId,
    projectRoot,
    stage,
    owner,
    queueKey,
    status: "stale_reclaimed",
    shouldDispatch: true,
    detectedCondition: "orphaned_bound_session_without_handoff",
    activeSessionKeys,
    reclaimedSessionKeys,
    activeQueueKeys: [],
    activeHandoffIds: [],
    lastSessionHeartbeatAt,
  };
  await appendWorkflowRuntimeEvent({
    projectRoot,
    projectId,
    kind: "runtime_dispatch_reconciliation",
    summary:
      `Reclaimed ${reclaimedSessionKeys.length} stale active session(s) before auto-stage dispatch.`,
    details: result,
  });
  await appendWorkflowDiagnosticEvent({
    projectRoot,
    projectId,
    component: "runtime_recovery",
    action: "dispatch_reconciliation",
    status: "degraded",
    stage,
    owner,
    summary:
      "Reclaimed stale owner session(s) with no active handoff or queue before dispatch.",
    details: result,
  });
  return result;
}

export async function buildWorkflowRuntimeRecoveryPlan(params: {
  projectRoot: string;
  projectId?: string | null;
  staleSessionAgeMs?: number;
}): Promise<WorkflowRuntimeRecoveryPlan> {
  const projectRoot = path.resolve(params.projectRoot);
  const projectId = resolveProjectId(projectRoot, params.projectId);
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId,
    compatibilityMode: "sessions_spawn_runtime",
    reason: "build_recovery_plan",
  });

  const [announceStore, broadcastStore, queueStore, sessionsStore] = await Promise.all([
    consumeWorkflowAnnounceOutbox({
      projectRoot,
      projectId,
      markConsumed: false,
      recordEvent: false,
    }),
    readWorkflowBroadcastOutboxStore(projectRoot),
    readWorkflowRuntimeQueueStore(projectRoot),
    readWorkflowRuntimeSessionsStore(projectRoot),
  ]);
  const staleSessionAgeMs =
    typeof params.staleSessionAgeMs === "number" && Number.isFinite(params.staleSessionAgeMs)
      ? Math.max(0, Math.floor(params.staleSessionAgeMs))
      : 15 * 60 * 1000;

  return {
    projectId,
    projectRoot,
    stageOrder: [
      "announce_replay",
      "broadcast_replay",
      "queued_transitions",
      "stale_sessions",
    ],
    announcePending: announceStore.pending.map((entry) => entry.announceId),
    broadcastPending: broadcastStore.entries
      .filter((entry) => entry.deliveryStatus !== "delivered" && entry.deliveryStatus !== "superseded")
      .map((entry) => entry.idempotencyKey),
    staleQueueKeys: queueStore.entries
      .filter((entry) =>
        isStaleQueueEntry(entry, staleSessionAgeMs, sessionsStore.entries)
      )
      .map((entry) => entry.queueKey),
    staleSessionKeys: sessionsStore.entries
      .filter((entry) => isStaleSessionEntry(entry, staleSessionAgeMs))
      .map((entry) => entry.sessionKey),
  };
}

async function maybeEnsureRecoveryBroadcast(params: {
  projectRoot: string;
  projectId: string | null;
  sessionKey: string | null;
  shouldEmit: boolean;
}) {
  if (!params.shouldEmit) {
    return null;
  }
  const store = await readWorkflowBroadcastOutboxStore(params.projectRoot);
  const existing = store.entries.find(
    (entry) =>
      entry.status === "recovered_after_restart" ||
      entry.idempotencyKey === `recovered_after_restart:${params.projectId ?? "unknown"}`
  );
  if (existing) {
    return existing;
  }
  const entry: WorkflowRuntimeBroadcastEntry = {
    broadcastId: `recovery:${params.projectId ?? "unknown"}`,
    idempotencyKey: `recovered_after_restart:${params.projectId ?? "unknown"}`,
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    sessionKey: params.sessionKey,
    status: "recovered_after_restart",
    stage: null,
    summary: "Recovered the workflow runtime after restart.",
    deliveryStatus: "pending",
    attempts: 0,
    createdAt: nowIso(),
    lastAttemptedAt: null,
    deliveredAt: null,
    lastError: null,
  };
  const nextStore = await writeWorkflowBroadcastOutboxStore({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    entries: [...store.entries, entry],
  });
  return nextStore.entries.find((candidate) => candidate.idempotencyKey === entry.idempotencyKey) ??
    null;
}

export async function recoverWorkflowRuntimeState(params: {
  projectRoot: string;
  projectId?: string | null;
  staleSessionAgeMs?: number;
  workflowPolicy?: ChannelProjectBindingPolicy;
  sendBroadcast?: (entry: WorkflowRuntimeBroadcastEntry) => Promise<{
    runId: string;
    sessionKey?: string | null;
  }>;
}): Promise<WorkflowRuntimeRecoveryResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const projectId = resolveProjectId(projectRoot, params.projectId);
  const staleSessionAgeMs =
    typeof params.staleSessionAgeMs === "number" && Number.isFinite(params.staleSessionAgeMs)
      ? Math.max(0, Math.floor(params.staleSessionAgeMs))
      : 15 * 60 * 1000;
  await appendWorkflowDiagnosticEvent({
    projectRoot,
    projectId,
    component: "runtime_recovery",
    action: "recovery_started",
    status: "started",
    summary: "Runtime recovery sweep started.",
    details: {
      staleSessionAgeMs,
      hasBroadcastSender: Boolean(params.sendBroadcast),
    },
  });
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId,
    compatibilityMode: "sessions_spawn_runtime",
    reason: "workflow_runtime_recovery",
  });
  const plan = await buildWorkflowRuntimeRecoveryPlan({
    projectRoot,
    projectId,
    staleSessionAgeMs: params.staleSessionAgeMs,
  });
  await appendWorkflowDiagnosticEvent({
    projectRoot,
    projectId,
    component: "runtime_recovery",
    action: "recovery_plan_built",
    status:
      plan.announcePending.length > 0 ||
      plan.broadcastPending.length > 0 ||
      plan.staleQueueKeys.length > 0 ||
      plan.staleSessionKeys.length > 0
        ? "waiting"
        : "completed",
    summary: "Runtime recovery plan built.",
    details: plan,
  });

  const announce = await consumeWorkflowAnnounceOutbox({
    projectRoot,
    projectId,
    markConsumed: true,
  });
  const broadcastStore = await readWorkflowBroadcastOutboxStore(projectRoot);
  const broadcast =
    params.sendBroadcast && broadcastStore.entries.some((entry) => entry.deliveryStatus !== "delivered" && entry.deliveryStatus !== "superseded")
      ? await replayWorkflowBroadcastOutbox({
          projectRoot,
          projectId,
          workflowPolicy: params.workflowPolicy,
          sendBroadcast: params.sendBroadcast,
        })
      : {
          store: broadcastStore,
          delivered: [],
          failed: [],
          skipped: broadcastStore.entries,
        };

  const [queueStore, sessionsStore] = await Promise.all([
    readWorkflowRuntimeQueueStore(projectRoot),
    readWorkflowRuntimeSessionsStore(projectRoot),
  ]);
  const repairedQueue: WorkflowRuntimeQueueEntry[] = [];
  const nextQueueEntries = queueStore.entries.map((entry) => {
    if (!isStaleQueueEntry(entry, staleSessionAgeMs, sessionsStore.entries)) {
      return entry;
    }
    const repaired = {
      ...entry,
      status: "needs_repair" as const,
      lastCheckedAt: nowIso(),
      lastError: entry.lastError ?? "Queue entry was stale during recovery and needs repair.",
    };
    repairedQueue.push(repaired);
    return repaired;
  });
  if (repairedQueue.length > 0) {
    await writeWorkflowRuntimeQueueStore({
      projectRoot,
      projectId,
      entries: nextQueueEntries,
    });
    await appendWorkflowRuntimeEvent({
      projectRoot,
      projectId,
      kind: "runtime_recovery_queue",
      summary: `Marked ${repairedQueue.length} queue entry(s) as needs_repair during recovery.`,
      details: {
        queueKeys: repairedQueue.map((entry) => entry.queueKey),
      },
    });
  }

  const repairedSessions: WorkflowRuntimeSessionEntry[] = [];
  const nextSessionEntries = sessionsStore.entries.map((entry) => {
    if (!isStaleSessionEntry(entry, staleSessionAgeMs)) {
      return entry;
    }
    const repaired = {
      ...entry,
      status: "needs_repair" as const,
      lastCheckedAt: nowIso(),
      lastError:
        entry.lastError ??
        "Session lost contact with the runtime and needs repair before continue.",
    };
    repairedSessions.push(repaired);
    return repaired;
  });
  if (repairedSessions.length > 0) {
    await writeWorkflowRuntimeSessionsStore({
      projectRoot,
      projectId,
      entries: nextSessionEntries,
    });
    await appendWorkflowRuntimeEvent({
      projectRoot,
      projectId,
      kind: "runtime_recovery_sessions",
      summary: `Marked ${repairedSessions.length} session(s) as needs_repair during recovery.`,
      details: {
        sessionKeys: repairedSessions.map((entry) => entry.sessionKey),
      },
    });
  }

  const recoveryBroadcast = await maybeEnsureRecoveryBroadcast({
    projectRoot,
    projectId,
    sessionKey:
      repairedSessions[0]?.requesterSessionKey ??
      repairedSessions[0]?.sessionKey ??
      null,
    shouldEmit:
      announce.consumed.length > 0 ||
      broadcast.delivered.length > 0 ||
      repairedQueue.length > 0 ||
      repairedSessions.length > 0,
  });

  if (
    recoveryBroadcast &&
    recoveryBroadcast.deliveryStatus !== "delivered" &&
    recoveryBroadcast.deliveryStatus !== "superseded" &&
    params.sendBroadcast
  ) {
    await replayWorkflowBroadcastOutbox({
      projectRoot,
      projectId,
      workflowPolicy: params.workflowPolicy,
      sendBroadcast: params.sendBroadcast,
    });
  }

  if (repairedQueue.length > 0 || repairedSessions.length > 0 || announce.consumed.length > 0) {
    await appendWorkflowRuntimeEvent({
      projectRoot,
      projectId,
      kind: "runtime_recovery",
      summary: `Recovery sweep completed with ${repairedQueue.length} queue repair(s), ${repairedSessions.length} session repair(s), and ${announce.consumed.length} announce replay(s) into needs_repair handling.`,
      details: {
        repairedQueueKeys: repairedQueue.map((entry) => entry.queueKey),
        repairedSessionKeys: repairedSessions.map((entry) => entry.sessionKey),
        consumedAnnounces: announce.consumed.map((entry) => entry.announceId),
      },
    });
  }
  await appendWorkflowDiagnosticEvent({
    projectRoot,
    projectId,
    component: "runtime_recovery",
    action: "recovery_completed",
    status:
      repairedQueue.length > 0 || repairedSessions.length > 0
        ? "degraded"
        : announce.consumed.length > 0 || broadcast.delivered.length > 0
          ? "completed"
          : "waiting",
    summary: "Runtime recovery sweep completed.",
    details: {
      repairedQueueKeys: repairedQueue.map((entry) => entry.queueKey),
      repairedSessionKeys: repairedSessions.map((entry) => entry.sessionKey),
      consumedAnnounceIds: announce.consumed.map((entry) => entry.announceId),
      deliveredBroadcastIds: broadcast.delivered.map((entry) => entry.broadcastId),
      failedBroadcastIds: broadcast.failed.map((entry) => entry.broadcastId),
      recoveryBroadcastId: recoveryBroadcast?.broadcastId ?? null,
    },
  });

  return {
    projectId,
    projectRoot,
    stageOrder: plan.stageOrder,
    plan,
    announce,
    broadcast,
    queue: {
      repaired: repairedQueue,
      store: await readWorkflowRuntimeQueueStore(projectRoot),
    },
    sessions: {
      repaired: repairedSessions,
      store: await readWorkflowRuntimeSessionsStore(projectRoot),
    },
    repairedQueue,
    repairedSessions,
    recoveryBroadcast,
  };
}
