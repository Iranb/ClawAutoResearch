import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  appendWorkflowRuntimeEvent,
  migrateWorkflowRuntimeState,
  readWorkflowAnnounceOutboxStore,
  readWorkflowBroadcastOutboxStore,
  readWorkflowRuntimeQueueStore,
  readWorkflowRuntimeSessionsStore,
  writeWorkflowAnnounceOutboxStore,
  writeWorkflowBroadcastOutboxStore,
  writeWorkflowRuntimeQueueStore,
  writeWorkflowRuntimeSessionsStore,
  updateWorkflowRuntimeQueueStore,
  updateWorkflowRuntimeSessionsStore,
} from "./workflow-runtime-state.js";
import { deriveWorkflowSubagentImmediateParentSessionKey } from "./workflow-subagent-sessions";
import type {
  WorkflowRuntimeAnnounceDeliveryMode,
  WorkflowRuntimeAnnounceEntry,
  WorkflowRuntimeBroadcastDeliveryStatus,
  WorkflowRuntimeBroadcastEntry,
  WorkflowRuntimeBroadcastStatus,
  WorkflowRuntimeCompatibilityMode,
  WorkflowRuntimeQueueDispatchPayload,
  WorkflowRuntimeQueueEntry,
  WorkflowRuntimeQueueRunPayload,
  WorkflowRuntimeSessionEntry,
} from "./workflow-runtime-state.js";

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function resolveProjectId(projectRoot: string, projectId?: string | null): string {
  return readString(projectId) ?? path.basename(projectRoot);
}

function deriveWorkflowAnnounceTerminalState(
  payload: Record<string, unknown> | null
): {
  status: "completed" | "failed" | null;
  finishedAt: string | null;
  error: string | null;
} {
  const rawStatus = readString(payload?.status)?.toLowerCase() ?? null;
  const finishedAt =
    readString(payload?.completedAt) ??
    readString(payload?.finishedAt) ??
    readString(payload?.lastFinishedAt) ??
    null;
  if (
    rawStatus === "completed" ||
    rawStatus === "complete" ||
    rawStatus === "done" ||
    rawStatus === "ok" ||
    rawStatus === "success" ||
    rawStatus === "succeeded"
  ) {
    return {
      status: "completed",
      finishedAt,
      error: null,
    };
  }
  if (
    rawStatus === "failed" ||
    rawStatus === "failure" ||
    rawStatus === "error" ||
    rawStatus === "blocked"
  ) {
    return {
      status: "failed",
      finishedAt,
      error:
        readString(payload?.error) ??
        readString(asRecord(payload?.result)?.summary) ??
        null,
    };
  }
  return {
    status: null,
    finishedAt,
    error: readString(payload?.error),
  };
}

export async function reconcileWorkflowAnnounceRuntimeState(params: {
  projectRoot: string;
  projectId?: string | null;
  entry: WorkflowRuntimeAnnounceEntry;
}): Promise<{
  entry: WorkflowRuntimeAnnounceEntry;
  sessionPatched: boolean;
  queuePatched: boolean;
}> {
  const projectRoot = path.resolve(params.projectRoot);
  const projectId = resolveProjectId(projectRoot, params.projectId);
  const [sessionsStore, queueStore] = await Promise.all([
    readWorkflowRuntimeSessionsStore(projectRoot),
    readWorkflowRuntimeQueueStore(projectRoot),
  ]);
  const childSession =
    sessionsStore.entries.find((session) => session.sessionKey === params.entry.childSessionKey) ??
    null;
  const resolvedParentSessionKey =
    readString(params.entry.parentSessionKey) ??
    readString(childSession?.parentSessionKey) ??
    readString(childSession?.requesterSessionKey) ??
    deriveWorkflowSubagentImmediateParentSessionKey(params.entry.childSessionKey);
  const entry =
    resolvedParentSessionKey && resolvedParentSessionKey !== params.entry.parentSessionKey
      ? {
          ...params.entry,
          parentSessionKey: resolvedParentSessionKey,
        }
      : params.entry;
  const announceAt =
    readString(asRecord(entry.payload)?.completedAt) ??
    readString(asRecord(entry.payload)?.finishedAt) ??
    readString(entry.createdAt) ??
    nowIso();
  const terminal = deriveWorkflowAnnounceTerminalState(asRecord(entry.payload));

  let sessionPatched = false;
  const nextSessionEntries = sessionsStore.entries.map((session) => {
    if (session.sessionKey === entry.childSessionKey) {
      const nextSession: WorkflowRuntimeSessionEntry = {
        ...session,
        parentSessionKey: readString(session.parentSessionKey) ?? resolvedParentSessionKey,
        lastAnnounceAt: announceAt,
        lastCheckedAt: announceAt,
      };
      if (terminal.status) {
        nextSession.status = terminal.status;
        nextSession.lastFinishedAt =
          terminal.finishedAt ?? session.lastFinishedAt ?? announceAt;
        nextSession.lastHeartbeatAt =
          terminal.finishedAt ?? session.lastHeartbeatAt ?? announceAt;
        nextSession.lastError = terminal.status === "failed" ? terminal.error : null;
      }
      sessionPatched =
        sessionPatched ||
        JSON.stringify(nextSession) !== JSON.stringify(session);
      return nextSession;
    }
    if (resolvedParentSessionKey && session.sessionKey === resolvedParentSessionKey) {
      const nextParent: WorkflowRuntimeSessionEntry = {
        ...session,
        lastAnnounceAt: announceAt,
        lastCheckedAt: announceAt,
        lastError:
          terminal.status === "failed" ? terminal.error ?? session.lastError : session.lastError,
      };
      sessionPatched =
        sessionPatched ||
        JSON.stringify(nextParent) !== JSON.stringify(session);
      return nextParent;
    }
    return session;
  });
  if (sessionPatched) {
    await writeWorkflowRuntimeSessionsStore({
      projectRoot,
      projectId: sessionsStore.projectId,
      entries: nextSessionEntries,
    });
  }

  let queuePatched = false;
  if (childSession?.queueKey && terminal.status) {
    const nextQueueEntries = queueStore.entries.map((queueEntry) => {
      if (queueEntry.queueKey !== childSession.queueKey) {
        return queueEntry;
      }
      const nextQueue: WorkflowRuntimeQueueEntry = {
        ...queueEntry,
        status: terminal.status === "completed" ? "completed" : "failed",
        lastAttemptedAt: terminal.finishedAt ?? announceAt,
        nextRetryAt: null,
        lastError:
          terminal.status === "failed"
            ? terminal.error ?? queueEntry.lastError
            : null,
      };
      queuePatched = queuePatched || JSON.stringify(nextQueue) !== JSON.stringify(queueEntry);
      return nextQueue;
    });
    if (queuePatched) {
      await writeWorkflowRuntimeQueueStore({
        projectRoot,
        projectId: queueStore.projectId,
        entries: nextQueueEntries,
      });
    }
  }

  return {
    entry,
    sessionPatched,
    queuePatched,
  };
}

export type WorkflowTransitionInput = {
  projectRoot: string;
  projectId?: string | null;
  queueKey: string;
  source: string;
  entryType: "background_run" | "dispatch_task";
  ownerAgent: string;
  channelKey: string;
  requesterSessionKey: string;
  messageChannel?: string | null;
  preferredSessionKey?: string | null;
  family: string;
  kind: string;
  summary?: string | null;
  parentSessionKey?: string | null;
  threadBindingKey?: string | null;
  depth?: number;
  runPayload?: WorkflowRuntimeQueueRunPayload | null;
  dispatchPayload?: WorkflowRuntimeQueueDispatchPayload | null;
};

export type WorkflowTransitionSpawnResult = {
  runId: string;
  sessionKey: string;
  sessionId?: string | null;
  runtime?: string;
  role?: string | null;
  agentId?: string | null;
  ownerAgent?: string | null;
  strategy?: string | null;
  parentSessionKey?: string | null;
  threadBindingKey?: string | null;
  depth?: number;
};

export type WorkflowTransitionLaunchResult = {
  launched: boolean;
  reason:
    | "started"
    | "intent_persist_failed"
    | "spawn_failed"
    | "legacy_fallback_started";
  strategy: string | null;
  fallbackUsed: boolean;
  transition: WorkflowRuntimeQueueEntry | null;
  runId: string | null;
  sessionKey: string | null;
  sessionId: string | null;
  error: string | null;
};

async function executePersistedWorkflowTransition(params: {
  projectRoot: string;
  projectId: string;
  transition: WorkflowRuntimeQueueEntry;
  spawn: () => Promise<WorkflowTransitionSpawnResult>;
  legacyFallback?: (
    error: Error
  ) => Promise<WorkflowTransitionSpawnResult | null>;
}): Promise<WorkflowTransitionLaunchResult> {
  let transition =
    (await patchTransitionEntry({
      projectRoot: params.projectRoot,
      queueKey: params.transition.queueKey,
      patch: {
        status: "launching",
        attemptCount: params.transition.attemptCount + 1,
        lastAttemptedAt: nowIso(),
        nextRetryAt: null,
      },
    })) ?? params.transition;

  try {
    const spawned = await params.spawn();
    transition =
      (await patchTransitionEntry({
        projectRoot: params.projectRoot,
        queueKey: transition.queueKey,
        patch: {
          status: "running",
          lastError: null,
          fallbackMode: null,
          nextRetryAt: null,
        },
      })) ?? transition;
    await recordWorkflowRuntimeSession({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      sessionKey: spawned.sessionKey,
      sessionId: spawned.sessionId ?? null,
      runtime: spawned.runtime ?? "subagent",
      role:
        spawned.role ??
        transition.dispatchPayload?.toRole ??
        params.transition.ownerAgent,
      agentId: spawned.agentId ?? params.transition.ownerAgent,
      ownerAgent: spawned.ownerAgent ?? params.transition.ownerAgent,
      family: transition.family,
      kind: transition.kind,
      channelKey: transition.channelKey,
      requesterSessionKey: transition.requesterSessionKey,
      parentSessionKey:
        spawned.parentSessionKey ?? transition.parentSessionKey,
      threadBindingKey:
        spawned.threadBindingKey ?? transition.threadBindingKey,
      depth: spawned.depth ?? transition.depth,
      status: "active",
      runId: spawned.runId,
      queueKey: transition.queueKey,
      lastHeartbeatAt: nowIso(),
    });
    await appendWorkflowRuntimeEvent({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      kind: "transition_started",
      summary: `Started workflow transition ${transition.queueKey}.`,
      details: {
        strategy: "sessions_spawn",
        runId: spawned.runId,
        sessionKey: spawned.sessionKey,
      },
    });
    return {
      launched: true,
      reason: "started",
      strategy: "sessions_spawn",
      fallbackUsed: false,
      transition,
      runId: spawned.runId,
      sessionKey: spawned.sessionKey,
      sessionId: readString(spawned.sessionId),
      error: null,
    };
  } catch (error) {
    const resolvedError =
      error instanceof Error ? error : new Error(String(error));
    await patchTransitionEntry({
      projectRoot: params.projectRoot,
      queueKey: transition.queueKey,
      patch: {
        status: "degraded",
        lastError: resolvedError.message,
      },
    });
    if (!params.legacyFallback) {
      await appendWorkflowRuntimeEvent({
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        kind: "transition_failed",
        summary: `Workflow transition ${transition.queueKey} failed to spawn.`,
        details: {
          error: resolvedError.message,
        },
      });
      return {
        launched: false,
        reason: "spawn_failed",
        strategy: null,
        fallbackUsed: false,
        transition:
          (await readWorkflowRuntimeQueueStore(params.projectRoot)).entries.find(
            (entry) => entry.queueKey === transition?.queueKey
          ) ?? transition,
        runId: null,
        sessionKey: null,
        sessionId: null,
        error: resolvedError.message,
      };
    }
    const fallback = await params.legacyFallback(resolvedError);
    if (!fallback) {
      return {
        launched: false,
        reason: "spawn_failed",
        strategy: null,
        fallbackUsed: false,
        transition:
          (await readWorkflowRuntimeQueueStore(params.projectRoot)).entries.find(
            (entry) => entry.queueKey === transition?.queueKey
          ) ?? transition,
        runId: null,
        sessionKey: null,
        sessionId: null,
        error: resolvedError.message,
      };
    }
    transition =
      (await patchTransitionEntry({
        projectRoot: params.projectRoot,
        queueKey: transition.queueKey,
        patch: {
          status: "running",
          fallbackMode: "legacy_dispatch",
          lastError: resolvedError.message,
        },
      })) ?? transition;
    await recordWorkflowRuntimeSession({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      sessionKey: fallback.sessionKey,
      sessionId: fallback.sessionId ?? null,
      runtime: fallback.runtime ?? "legacy_dispatch",
      role:
        fallback.role ??
        transition.dispatchPayload?.toRole ??
        params.transition.ownerAgent,
      agentId: fallback.agentId ?? params.transition.ownerAgent,
      ownerAgent: fallback.ownerAgent ?? params.transition.ownerAgent,
      family: transition.family,
      kind: transition.kind,
      channelKey: transition.channelKey,
      requesterSessionKey: transition.requesterSessionKey,
      parentSessionKey:
        fallback.parentSessionKey ?? transition.parentSessionKey,
      threadBindingKey:
        fallback.threadBindingKey ?? transition.threadBindingKey,
      depth: fallback.depth ?? transition.depth,
      status: "active",
      runId: fallback.runId,
      queueKey: transition.queueKey,
      lastHeartbeatAt: nowIso(),
      lastError: resolvedError.message,
    });
    await appendWorkflowRuntimeEvent({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      kind: "transition_degraded",
      summary: `Workflow transition ${transition.queueKey} degraded to legacy dispatch.`,
      details: {
        error: resolvedError.message,
        strategy: fallback.strategy ?? "legacy_dispatch",
      },
    });
    return {
      launched: true,
      reason: "legacy_fallback_started",
      strategy: fallback.strategy ?? "legacy_dispatch",
      fallbackUsed: true,
      transition,
      runId: fallback.runId,
      sessionKey: fallback.sessionKey,
      sessionId: readString(fallback.sessionId),
      error: resolvedError.message,
    };
  }
}

async function upsertTransitionEntry(
  entry: WorkflowRuntimeQueueEntry
): Promise<{ entry: WorkflowRuntimeQueueEntry; created: boolean }> {
  let persistedEntry: WorkflowRuntimeQueueEntry | null = null;
  let created = false;
  await updateWorkflowRuntimeQueueStore({
    projectRoot: entry.projectRoot ?? "",
    projectId: entry.projectId,
    updater: (store) => {
      const existingIndex = store.entries.findIndex(
        (candidate) => candidate.queueKey === entry.queueKey
      );
      if (existingIndex >= 0) {
        const nextEntries = [...store.entries];
        nextEntries[existingIndex] = {
          ...nextEntries[existingIndex],
          ...entry,
          transitionId: nextEntries[existingIndex].transitionId,
          queueId: nextEntries[existingIndex].queueId,
          queuedAt: nextEntries[existingIndex].queuedAt,
        };
        persistedEntry = nextEntries[existingIndex];
        created = false;
        return nextEntries;
      }
      const nextEntry = {
        ...entry,
        transitionId: entry.transitionId || randomUUID(),
        queueId: entry.queueId || entry.transitionId || randomUUID(),
      };
      persistedEntry = nextEntry;
      created = true;
      return [...store.entries, nextEntry];
    },
  });
  return {
    entry: persistedEntry ?? entry,
    created,
  };
}

async function patchTransitionEntry(params: {
  projectRoot: string;
  queueKey: string;
  patch: Partial<WorkflowRuntimeQueueEntry>;
}): Promise<WorkflowRuntimeQueueEntry | null> {
  let patchedEntry: WorkflowRuntimeQueueEntry | null = null;
  await updateWorkflowRuntimeQueueStore({
    projectRoot: params.projectRoot,
    updater: (store) => {
      const index = store.entries.findIndex(
        (entry) => entry.queueKey === params.queueKey
      );
      if (index < 0) {
        return store.entries;
      }
      const nextEntries = [...store.entries];
      nextEntries[index] = {
        ...nextEntries[index],
        ...params.patch,
      };
      patchedEntry = nextEntries[index];
      return nextEntries;
    },
  });
  return patchedEntry;
}

export async function createWorkflowTransitionIntent(
  params: WorkflowTransitionInput
): Promise<{ entry: WorkflowRuntimeQueueEntry; created: boolean }> {
  const projectRoot = path.resolve(params.projectRoot);
  const projectId = resolveProjectId(projectRoot, params.projectId);
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId,
    compatibilityMode: "sessions_spawn_runtime",
    reason: "create_transition_intent",
  });
  const entry: WorkflowRuntimeQueueEntry = {
    transitionId: randomUUID(),
    queueId: "",
    queueKey: params.queueKey,
    source: params.source,
    entryType: params.entryType,
    ownerAgent: params.ownerAgent,
    channelKey: params.channelKey,
    requesterSessionKey: params.requesterSessionKey,
    messageChannel: readString(params.messageChannel),
    preferredSessionKey: readString(params.preferredSessionKey),
    family: params.family,
    kind: params.kind,
    projectId,
    projectRoot,
    queuedAt: nowIso(),
    lastAttemptedAt: null,
    lastCheckedAt: null,
    nextRetryAt: null,
    attemptCount: 0,
    summary: readString(params.summary),
    status: "queued",
    fallbackMode: null,
    lastError: null,
    parentSessionKey: readString(params.parentSessionKey),
    threadBindingKey: readString(params.threadBindingKey),
    depth:
      typeof params.depth === "number" && Number.isFinite(params.depth)
        ? Math.max(0, Math.floor(params.depth))
        : 0,
    runPayload: params.runPayload ?? null,
    dispatchPayload: params.dispatchPayload ?? null,
  };
  const persisted = await upsertTransitionEntry(entry);
  await appendWorkflowRuntimeEvent({
    projectRoot,
    projectId,
    kind: "transition_intent_created",
    summary: `Queued workflow transition ${persisted.entry.queueKey}.`,
    details: {
      source: persisted.entry.source,
      entryType: persisted.entry.entryType,
      kind: persisted.entry.kind,
      created: persisted.created,
    },
  });
  return persisted;
}

export async function recordWorkflowRuntimeSession(
  params: {
    projectRoot: string;
    projectId?: string | null;
    sessionKey: string;
    sessionId?: string | null;
    runtime?: string;
    role?: string | null;
    agentId?: string | null;
    ownerAgent?: string | null;
    family: string;
    kind: string;
    channelKey?: string | null;
    requesterSessionKey?: string | null;
    parentSessionKey?: string | null;
    threadBindingKey?: string | null;
    depth?: number;
    status: WorkflowRuntimeSessionEntry["status"];
    runId?: string | null;
    queueKey?: string | null;
    startedAt?: string | null;
    lastHeartbeatAt?: string | null;
    lastAnnounceAt?: string | null;
    lastCheckedAt?: string | null;
    lastFinishedAt?: string | null;
    lastError?: string | null;
  }
): Promise<{ entry: WorkflowRuntimeSessionEntry; created: boolean }> {
  const projectRoot = path.resolve(params.projectRoot);
  const projectId = resolveProjectId(projectRoot, params.projectId);
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId,
    compatibilityMode: "sessions_spawn_runtime",
    reason: "record_runtime_session",
  });
  const entry: WorkflowRuntimeSessionEntry = {
    sessionKey: params.sessionKey,
    sessionId: readString(params.sessionId),
    runtime: readString(params.runtime) ?? "subagent",
    role: readString(params.role),
    agentId: readString(params.agentId),
    ownerAgent: readString(params.ownerAgent),
    family: params.family,
    kind: params.kind,
    channelKey: readString(params.channelKey),
    requesterSessionKey: readString(params.requesterSessionKey),
    projectId,
    projectRoot,
    parentSessionKey: readString(params.parentSessionKey),
    threadBindingKey: readString(params.threadBindingKey),
    depth:
      typeof params.depth === "number" && Number.isFinite(params.depth)
        ? Math.max(0, Math.floor(params.depth))
        : 0,
    status: params.status,
    runId: readString(params.runId),
    queueKey: readString(params.queueKey),
    startedAt: readString(params.startedAt) ?? nowIso(),
    lastHeartbeatAt: readString(params.lastHeartbeatAt),
    lastAnnounceAt: readString(params.lastAnnounceAt),
    lastCheckedAt: readString(params.lastCheckedAt),
    lastFinishedAt: readString(params.lastFinishedAt),
    lastError: readString(params.lastError),
  };
  let persistedEntry: WorkflowRuntimeSessionEntry | null = null;
  let created = false;
  await updateWorkflowRuntimeSessionsStore({
    projectRoot,
    projectId,
    updater: (store) => {
      const existingIndex = store.entries.findIndex(
        (candidate) => candidate.sessionKey === params.sessionKey
      );
      const nextEntries = [...store.entries];
      if (existingIndex >= 0) {
        nextEntries[existingIndex] = {
          ...nextEntries[existingIndex],
          ...entry,
          startedAt: nextEntries[existingIndex].startedAt,
        };
        persistedEntry = nextEntries[existingIndex];
        created = false;
      } else {
        nextEntries.push(entry);
        persistedEntry = entry;
        created = true;
      }
      return nextEntries;
    },
  });
  return {
    entry: persistedEntry ?? entry,
    created,
  };
}

export async function orchestrateWorkflowTransition(params: {
  transition: WorkflowTransitionInput;
  spawn: () => Promise<WorkflowTransitionSpawnResult>;
  legacyFallback?: (
    error: Error
  ) => Promise<WorkflowTransitionSpawnResult | null>;
  deps?: {
    persistIntent?: () => Promise<{ entry: WorkflowRuntimeQueueEntry; created: boolean }>;
  };
}): Promise<WorkflowTransitionLaunchResult> {
  const projectRoot = path.resolve(params.transition.projectRoot);
  const projectId = resolveProjectId(projectRoot, params.transition.projectId);
  let transition: WorkflowRuntimeQueueEntry | null = null;
  try {
    const persisted = params.deps?.persistIntent
      ? await params.deps.persistIntent()
      : await createWorkflowTransitionIntent(params.transition);
    transition = persisted.entry;
  } catch (error) {
    await appendWorkflowRuntimeEvent({
      projectRoot,
      projectId,
      kind: "transition_intent_failed",
      summary: "Failed to persist workflow transition intent.",
      details: {
        queueKey: params.transition.queueKey,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return {
      launched: false,
      reason: "intent_persist_failed",
      strategy: null,
      fallbackUsed: false,
      transition: null,
      runId: null,
      sessionKey: null,
      sessionId: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return executePersistedWorkflowTransition({
    projectRoot,
    projectId,
    transition,
    spawn: params.spawn,
    legacyFallback: params.legacyFallback,
  });
}

export async function resumeWorkflowTransition(params: {
  projectRoot: string;
  projectId?: string | null;
  queueKey: string;
  spawn: () => Promise<WorkflowTransitionSpawnResult>;
  legacyFallback?: (
    error: Error
  ) => Promise<WorkflowTransitionSpawnResult | null>;
}): Promise<WorkflowTransitionLaunchResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const projectId = resolveProjectId(projectRoot, params.projectId);
  const store = await readWorkflowRuntimeQueueStore(projectRoot);
  const transition =
    store.entries.find((entry) => entry.queueKey === params.queueKey) ?? null;
  if (!transition) {
    await appendWorkflowRuntimeEvent({
      projectRoot,
      projectId,
      kind: "transition_missing",
      summary: `Cannot resume missing workflow transition ${params.queueKey}.`,
      details: {
        queueKey: params.queueKey,
      },
    });
    return {
      launched: false,
      reason: "spawn_failed",
      strategy: null,
      fallbackUsed: false,
      transition: null,
      runId: null,
      sessionKey: null,
      sessionId: null,
      error: `Workflow transition ${params.queueKey} is missing from runtime state.`,
    };
  }
  return executePersistedWorkflowTransition({
    projectRoot,
    projectId,
    transition,
    spawn: params.spawn,
    legacyFallback: params.legacyFallback,
  });
}

export async function recordWorkflowAnnounceEvent(params: {
  projectRoot: string;
  projectId?: string | null;
  announceId: string;
  sourceTransitionId?: string | null;
  parentSessionKey?: string | null;
  childSessionKey: string;
  deliveryMode: WorkflowRuntimeAnnounceDeliveryMode;
  summary: string;
  payload?: Record<string, unknown> | null;
}) {
  const projectRoot = path.resolve(params.projectRoot);
  const projectId = resolveProjectId(projectRoot, params.projectId);
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId,
    compatibilityMode: "sessions_spawn_runtime",
    reason: "record_announce_event",
  });
  const store = await readWorkflowAnnounceOutboxStore(projectRoot);
  const existingIndex = store.entries.findIndex(
    (entry) => entry.announceId === params.announceId
  );
  if (existingIndex >= 0) {
    const reconciled = await reconcileWorkflowAnnounceRuntimeState({
      projectRoot,
      projectId,
      entry: store.entries[existingIndex],
    });
    if (
      reconciled.entry.parentSessionKey !== store.entries[existingIndex].parentSessionKey
    ) {
      const nextEntries = [...store.entries];
      nextEntries[existingIndex] = reconciled.entry;
      await writeWorkflowAnnounceOutboxStore({
        projectRoot,
        projectId,
        entries: nextEntries,
      });
    }
    return {
      created: false,
      entry: reconciled.entry,
    };
  }
  let entry: WorkflowRuntimeAnnounceEntry = {
    announceId: params.announceId,
    sourceTransitionId: readString(params.sourceTransitionId),
    projectId,
    projectRoot,
    parentSessionKey: readString(params.parentSessionKey),
    childSessionKey: params.childSessionKey,
    deliveryMode: params.deliveryMode,
    status: "pending",
    summary: params.summary,
    payload: params.payload ?? null,
    createdAt: nowIso(),
    consumedAt: null,
    lastError: null,
  };
  await writeWorkflowAnnounceOutboxStore({
    projectRoot,
    projectId,
    entries: [...store.entries, entry],
  });
  const reconciled = await reconcileWorkflowAnnounceRuntimeState({
    projectRoot,
    projectId,
    entry,
  });
  entry = reconciled.entry;
  if (entry.parentSessionKey !== null) {
    const nextEntries = [...store.entries, entry];
    await writeWorkflowAnnounceOutboxStore({
      projectRoot,
      projectId,
      entries: nextEntries,
    });
  }
  await appendWorkflowRuntimeEvent({
    projectRoot,
    projectId,
    kind: "announce_recorded",
    summary: `Recorded announce ${params.announceId}.`,
    details: {
      deliveryMode: params.deliveryMode,
      childSessionKey: params.childSessionKey,
      parentSessionKey: entry.parentSessionKey,
      sessionPatched: reconciled.sessionPatched,
      queuePatched: reconciled.queuePatched,
    },
  });
  return {
    created: true,
    entry,
  };
}

export async function recordWorkflowBroadcastEvent(params: {
  projectRoot: string;
  projectId?: string | null;
  broadcastId: string;
  idempotencyKey: string;
  sessionKey?: string | null;
  status: WorkflowRuntimeBroadcastStatus;
  stage?: string | null;
  summary: string;
  deliveryStatus?: WorkflowRuntimeBroadcastDeliveryStatus;
  attempts?: number;
  lastAttemptedAt?: string | null;
  deliveredAt?: string | null;
  lastError?: string | null;
}) {
  const projectRoot = path.resolve(params.projectRoot);
  const projectId = resolveProjectId(projectRoot, params.projectId);
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId,
    compatibilityMode: "sessions_spawn_runtime",
    reason: "record_broadcast_event",
  });
  const store = await readWorkflowBroadcastOutboxStore(projectRoot);
  const existing =
    store.entries.find((entry) => entry.idempotencyKey === params.idempotencyKey) ??
    store.entries.find((entry) => entry.broadcastId === params.broadcastId) ??
    null;
  if (existing) {
    return {
      created: false,
      entry: existing,
    };
  }
  const entry: WorkflowRuntimeBroadcastEntry = {
    broadcastId: params.broadcastId,
    idempotencyKey: params.idempotencyKey,
    projectId,
    projectRoot,
    sessionKey: readString(params.sessionKey),
    status: params.status,
    stage: readString(params.stage),
    summary: params.summary,
    deliveryStatus: params.deliveryStatus ?? "pending",
    attempts:
      typeof params.attempts === "number" && Number.isFinite(params.attempts)
        ? Math.max(0, Math.floor(params.attempts))
        : 0,
    createdAt: nowIso(),
    lastAttemptedAt: readString(params.lastAttemptedAt),
    deliveredAt: readString(params.deliveredAt),
    lastError: readString(params.lastError),
  };
  await writeWorkflowBroadcastOutboxStore({
    projectRoot,
    projectId,
    entries: [...store.entries, entry],
  });
  await appendWorkflowRuntimeEvent({
    projectRoot,
    projectId,
    kind: "broadcast_recorded",
    summary: `Recorded broadcast ${params.idempotencyKey}.`,
    details: {
      status: params.status,
      stage: params.stage ?? null,
    },
  });
  return {
    created: true,
    entry,
  };
}

export async function markWorkflowBroadcastEvent(params: {
  projectRoot: string;
  broadcastId?: string | null;
  idempotencyKey?: string | null;
  deliveryStatus: WorkflowRuntimeBroadcastDeliveryStatus;
  runError?: string | null;
  deliveredAt?: string | null;
  lastAttemptedAt?: string | null;
  attemptsIncrement?: number;
}): Promise<WorkflowRuntimeBroadcastEntry | null> {
  const projectRoot = path.resolve(params.projectRoot);
  const store = await readWorkflowBroadcastOutboxStore(projectRoot);
  const index = store.entries.findIndex(
    (entry) =>
      (readString(params.broadcastId) && entry.broadcastId === params.broadcastId) ||
      (readString(params.idempotencyKey) && entry.idempotencyKey === params.idempotencyKey)
  );
  if (index < 0) {
    return null;
  }
  const nextEntries = [...store.entries];
  nextEntries[index] = {
    ...nextEntries[index],
    deliveryStatus: params.deliveryStatus,
    attempts:
      nextEntries[index].attempts +
      (typeof params.attemptsIncrement === "number" &&
      Number.isFinite(params.attemptsIncrement)
        ? Math.max(0, Math.floor(params.attemptsIncrement))
        : 0),
    deliveredAt:
      params.deliveryStatus === "delivered"
        ? readString(params.deliveredAt) ?? nowIso()
        : nextEntries[index].deliveredAt,
    lastAttemptedAt: readString(params.lastAttemptedAt) ?? nowIso(),
    lastError: readString(params.runError),
  };
  await writeWorkflowBroadcastOutboxStore({
    projectRoot,
    projectId: store.projectId,
    entries: nextEntries,
  });
  return nextEntries[index];
}

export async function recoverWorkflowRuntimeState(params: {
  projectRoot: string;
  projectId?: string | null;
  staleSessionAgeMs?: number;
  enqueueRecoveryBroadcast?: boolean;
}) {
  const projectRoot = path.resolve(params.projectRoot);
  const projectId = resolveProjectId(projectRoot, params.projectId);
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId,
    compatibilityMode: "sessions_spawn_runtime",
    reason: "recover_runtime_state",
  });
  const staleSessionAgeMs =
    typeof params.staleSessionAgeMs === "number" &&
    Number.isFinite(params.staleSessionAgeMs)
      ? Math.max(0, Math.floor(params.staleSessionAgeMs))
      : 15 * 60 * 1000;
  const now = Date.now();
  const store = await readWorkflowRuntimeSessionsStore(projectRoot);
  const repairedSessions: WorkflowRuntimeSessionEntry[] = [];
  const nextEntries = store.entries.map((entry) => {
    if (entry.status !== "active") {
      return entry;
    }
    const freshnessReference =
      readString(entry.lastHeartbeatAt) ??
      readString(entry.lastCheckedAt) ??
      readString(entry.startedAt);
    const freshnessMs = freshnessReference ? Date.parse(freshnessReference) : NaN;
    if (!Number.isFinite(freshnessMs) || now - freshnessMs <= staleSessionAgeMs) {
      return entry;
    }
    const repairedEntry: WorkflowRuntimeSessionEntry = {
      ...entry,
      status: "needs_repair",
      lastCheckedAt: nowIso(),
      lastError:
        entry.lastError ??
        "Session lost contact with the runtime and needs repair before continue.",
    };
    repairedSessions.push(repairedEntry);
    return repairedEntry;
  });
  if (repairedSessions.length > 0) {
    await writeWorkflowRuntimeSessionsStore({
      projectRoot,
      projectId,
      entries: nextEntries,
    });
    await appendWorkflowRuntimeEvent({
      projectRoot,
      projectId,
      kind: "runtime_recovery",
      summary: `Marked ${repairedSessions.length} runtime session(s) as needs_repair after restart.`,
      details: {
        repairedSessionKeys: repairedSessions.map((entry) => entry.sessionKey),
      },
    });
  }
  const recoveryBroadcast =
    repairedSessions.length > 0 && params.enqueueRecoveryBroadcast === true
      ? await recordWorkflowBroadcastEvent({
          projectRoot,
          projectId,
          broadcastId: `recovery:${projectId}`,
          idempotencyKey: `recovered_after_restart:${projectId}`,
          sessionKey: repairedSessions[0]?.requesterSessionKey ?? null,
          status: "recovered_after_restart",
          stage: null,
          summary:
            "Recovered the workflow runtime after restart and marked stale sessions for repair.",
          deliveryStatus: "pending",
        })
      : null;
  return {
    repairedSessions,
    recoveryBroadcast: recoveryBroadcast?.entry ?? null,
  };
}
