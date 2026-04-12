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
import type {
  WorkflowRuntimeBroadcastEntry,
  WorkflowRuntimeQueueEntry,
  WorkflowRuntimeSessionEntry,
} from "./workflow-runtime-state";

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

function isStaleQueueEntry(entry: WorkflowRuntimeQueueEntry, staleSessionAgeMs: number): boolean {
  if (!["queued", "launching", "degraded", "needs_repair"].includes(entry.status)) {
    return false;
  }
  const freshness = entry.lastAttemptedAt ?? entry.queuedAt;
  return isStaleIso(freshness, staleSessionAgeMs);
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
      .filter((entry) => isStaleQueueEntry(entry, staleSessionAgeMs))
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
  sendBroadcast?: (entry: WorkflowRuntimeBroadcastEntry) => Promise<{
    runId: string;
    sessionKey?: string | null;
  }>;
}): Promise<WorkflowRuntimeRecoveryResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const projectId = resolveProjectId(projectRoot, params.projectId);
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
          sendBroadcast: params.sendBroadcast,
        })
      : {
          store: broadcastStore,
          delivered: [],
          failed: [],
          skipped: broadcastStore.entries,
        };

  const staleSessionAgeMs =
    typeof params.staleSessionAgeMs === "number" && Number.isFinite(params.staleSessionAgeMs)
      ? Math.max(0, Math.floor(params.staleSessionAgeMs))
      : 15 * 60 * 1000;

  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  const repairedQueue: WorkflowRuntimeQueueEntry[] = [];
  const nextQueueEntries = queueStore.entries.map((entry) => {
    if (!isStaleQueueEntry(entry, staleSessionAgeMs)) {
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

  const sessionsStore = await readWorkflowRuntimeSessionsStore(projectRoot);
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
