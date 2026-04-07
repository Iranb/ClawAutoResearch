import path from "node:path";
import {
  appendWorkflowRuntimeEvent,
  migrateWorkflowRuntimeState,
  readWorkflowAnnounceOutboxStore,
  readWorkflowBroadcastOutboxStore,
  readWorkflowRuntimeSessionsStore,
  writeWorkflowAnnounceOutboxStore,
  writeWorkflowBroadcastOutboxStore,
} from "./workflow-runtime-state.js";
import { reconcileWorkflowAnnounceRuntimeState } from "./workflow-session-orchestrator.js";
import type {
  WorkflowRuntimeAnnounceEntry,
  WorkflowRuntimeAnnounceOutboxStore,
  WorkflowRuntimeBroadcastEntry,
  WorkflowRuntimeBroadcastOutboxStore,
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

function sortByCreatedAt<T extends { createdAt?: string | null }>(entries: T[]): T[] {
  return [...entries].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt ?? "");
    const rightTime = Date.parse(right.createdAt ?? "");
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
      return leftTime - rightTime;
    }
    if (Number.isFinite(leftTime)) {
      return -1;
    }
    if (Number.isFinite(rightTime)) {
      return 1;
    }
    return 0;
  });
}

export type WorkflowAnnounceConsumptionGroup = {
  parentSessionKey: string | null;
  entries: WorkflowRuntimeAnnounceEntry[];
};

export type WorkflowAnnounceConsumptionResult = {
  store: WorkflowRuntimeAnnounceOutboxStore;
  groups: WorkflowAnnounceConsumptionGroup[];
  consumed: WorkflowRuntimeAnnounceEntry[];
  duplicates: WorkflowRuntimeAnnounceEntry[];
  orphaned: WorkflowRuntimeAnnounceEntry[];
  orphans: WorkflowRuntimeAnnounceEntry[];
  pending: WorkflowRuntimeAnnounceEntry[];
};

export async function consumeWorkflowAnnounceOutbox(params: {
  projectRoot: string;
  projectId?: string | null;
  markConsumed?: boolean;
  recordEvent?: boolean;
}): Promise<WorkflowAnnounceConsumptionResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const projectId = resolveProjectId(projectRoot, params.projectId);
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId,
    compatibilityMode: "sessions_spawn_runtime",
    reason: "consume_announce_outbox",
  });

  const [announceStore, sessionsStore] = await Promise.all([
    readWorkflowAnnounceOutboxStore(projectRoot),
    readWorkflowRuntimeSessionsStore(projectRoot),
  ]);
  const parentSessionKeys = new Set(
    sessionsStore.entries.map((entry) => entry.sessionKey).filter(Boolean)
  );

  const dedupe = new Set<string>();
  const groups = new Map<string | null, WorkflowRuntimeAnnounceEntry[]>();
  const duplicates: WorkflowRuntimeAnnounceEntry[] = [];
  const orphaned: WorkflowRuntimeAnnounceEntry[] = [];
  const consumed: WorkflowRuntimeAnnounceEntry[] = [];
  const pending: WorkflowRuntimeAnnounceEntry[] = [];
  const nextEntries = [...announceStore.entries];
  let changed = false;

  for (let index = 0; index < announceStore.entries.length; index += 1) {
    let entry = announceStore.entries[index];
    const isDuplicate = dedupe.has(entry.announceId);
    if (isDuplicate) {
      duplicates.push(entry);
      pending.push(entry);
      if (params.markConsumed !== false && entry.status !== "skipped") {
        nextEntries[index] = {
          ...entry,
          status: "skipped",
          consumedAt: entry.consumedAt ?? nowIso(),
          lastError: entry.lastError ?? "Duplicate announce skipped during consumption.",
        };
        changed = true;
      }
      continue;
    }

    dedupe.add(entry.announceId);
    const reconciled = await reconcileWorkflowAnnounceRuntimeState({
      projectRoot,
      projectId,
      entry,
    });
    entry = reconciled.entry;
    const parentSessionKey = readString(entry.parentSessionKey);
    if (
      parentSessionKey !== readString(announceStore.entries[index]?.parentSessionKey)
    ) {
      nextEntries[index] = entry;
      changed = true;
    }
    const hasParent = parentSessionKey ? parentSessionKeys.has(parentSessionKey) : true;
    if (!hasParent) {
      orphaned.push(entry);
      pending.push(entry);
      continue;
    }

    const groupKey = parentSessionKey ?? null;
    const grouped = groups.get(groupKey) ?? [];
    grouped.push(entry);
    groups.set(groupKey, grouped);

    if (params.markConsumed !== false && entry.status !== "consumed") {
      nextEntries[index] = {
        ...entry,
        status: "consumed",
        consumedAt: entry.consumedAt ?? nowIso(),
        lastError: null,
      };
      changed = true;
      consumed.push(nextEntries[index]);
    } else {
      pending.push(entry);
    }
  }

  let store = announceStore;
  if (changed) {
    store = await writeWorkflowAnnounceOutboxStore({
      projectRoot,
      projectId,
      entries: nextEntries,
    });
  }

  if (params.recordEvent !== false) {
    await appendWorkflowRuntimeEvent({
      projectRoot,
      projectId,
      kind: "announce_consumed",
      summary: `Consumed ${consumed.length} announce(s); skipped ${duplicates.length}; orphaned ${orphaned.length}.`,
      details: {
        groups: Array.from(groups.entries()).map(([parentSessionKey, entries]) => ({
          parentSessionKey,
          announceIds: entries.map((entry) => entry.announceId),
        })),
      },
    });
  }

  return {
    store,
    groups: Array.from(groups.entries()).map(([parentSessionKey, entries]) => ({
      parentSessionKey,
      entries: sortByCreatedAt(entries),
    })),
    consumed: sortByCreatedAt(consumed),
    duplicates: sortByCreatedAt(duplicates),
    orphaned: sortByCreatedAt(orphaned),
    orphans: sortByCreatedAt(orphaned),
    pending: sortByCreatedAt(pending),
  };
}

export type WorkflowBroadcastReplayResult = {
  store: WorkflowRuntimeBroadcastOutboxStore;
  delivered: WorkflowRuntimeBroadcastEntry[];
  failed: WorkflowRuntimeBroadcastEntry[];
  skipped: WorkflowRuntimeBroadcastEntry[];
};

export async function replayWorkflowBroadcastOutbox(params: {
  projectRoot: string;
  projectId?: string | null;
  sendBroadcast: (entry: WorkflowRuntimeBroadcastEntry) => Promise<{
    runId: string;
    sessionKey?: string | null;
  }>;
}): Promise<WorkflowBroadcastReplayResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const projectId = resolveProjectId(projectRoot, params.projectId);
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId,
    compatibilityMode: "sessions_spawn_runtime",
    reason: "replay_broadcast_outbox",
  });

  const store = await readWorkflowBroadcastOutboxStore(projectRoot);
  const delivered: WorkflowRuntimeBroadcastEntry[] = [];
  const failed: WorkflowRuntimeBroadcastEntry[] = [];
  const skipped: WorkflowRuntimeBroadcastEntry[] = [];
  const seenIdempotencyKeys = new Set<string>();
  const nextEntries = [...store.entries];
  let changed = false;

  for (let index = 0; index < nextEntries.length; index += 1) {
    const entry = nextEntries[index];
    if (entry.deliveryStatus === "delivered") {
      skipped.push(entry);
      seenIdempotencyKeys.add(entry.idempotencyKey);
      continue;
    }
    if (seenIdempotencyKeys.has(entry.idempotencyKey)) {
      skipped.push(entry);
      nextEntries[index] = {
        ...entry,
        deliveryStatus: "failed",
        lastAttemptedAt: entry.lastAttemptedAt ?? nowIso(),
        lastError: entry.lastError ?? "Duplicate broadcast suppressed during replay.",
      };
      changed = true;
      continue;
    }
    seenIdempotencyKeys.add(entry.idempotencyKey);
    nextEntries[index] = {
      ...entry,
      deliveryStatus: "sending",
      attempts: entry.attempts + 1,
      lastAttemptedAt: nowIso(),
      lastError: null,
    };
    changed = true;
    await writeWorkflowBroadcastOutboxStore({
      projectRoot,
      projectId,
      entries: nextEntries,
    });

    try {
      await params.sendBroadcast(nextEntries[index]);
      nextEntries[index] = {
        ...nextEntries[index],
        deliveryStatus: "delivered",
        deliveredAt: nowIso(),
        lastAttemptedAt: nowIso(),
        lastError: null,
      };
      delivered.push(nextEntries[index]);
      changed = true;
      await writeWorkflowBroadcastOutboxStore({
        projectRoot,
        projectId,
        entries: nextEntries,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      nextEntries[index] = {
        ...nextEntries[index],
        deliveryStatus: "failed",
        lastAttemptedAt: nowIso(),
        lastError: message,
      };
      failed.push(nextEntries[index]);
      changed = true;
      await writeWorkflowBroadcastOutboxStore({
        projectRoot,
        projectId,
        entries: nextEntries,
      });
    }
  }

  if (changed) {
    await appendWorkflowRuntimeEvent({
      projectRoot,
      projectId,
      kind: "broadcast_replay",
      summary: `Replayed ${delivered.length} broadcast(s); failed ${failed.length}; skipped ${skipped.length}.`,
      details: {
        delivered: delivered.map((entry) => entry.idempotencyKey),
        failed: failed.map((entry) => entry.idempotencyKey),
        skipped: skipped.map((entry) => entry.idempotencyKey),
      },
    });
  }

  return {
    store: await readWorkflowBroadcastOutboxStore(projectRoot),
    delivered,
    failed,
    skipped,
  };
}
