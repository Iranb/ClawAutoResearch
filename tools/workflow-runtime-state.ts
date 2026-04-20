import fs from "node:fs/promises";
import path from "node:path";

import {
  withAdvisoryLock,
  writeJsonAtomicEnsured,
} from "./workflow-guard-core/fs";

export const WORKFLOW_RUNTIME_SCHEMA_VERSION = 1;
export const WORKFLOW_RUNTIME_FRAMEWORK = "sessions_spawn_v1";

export type WorkflowRuntimeCompatibilityMode =
  | "legacy_dispatch"
  | "hybrid_runtime"
  | "sessions_spawn_runtime";

export type WorkflowRuntimeMigrationStatus = "initialized" | "completed";

export type WorkflowRuntimeQueueEntryStatus =
  | "queued"
  | "launching"
  | "running"
  | "completed"
  | "degraded"
  | "needs_repair"
  | "failed";

export type WorkflowRuntimeSessionStatus =
  | "active"
  | "idle"
  | "needs_repair"
  | "completed"
  | "failed";

export type WorkflowRuntimeAnnounceDeliveryMode = "internal" | "external";

export type WorkflowRuntimeAnnounceStatus =
  | "pending"
  | "consumed"
  | "skipped"
  | "failed";

export type WorkflowRuntimeBroadcastStatus =
  | "started"
  | "continued"
  | "completed"
  | "queued"
  | "blocked"
  | "waiting"
  | "handed_off"
  | "waiting_on_children"
  | "child_completed"
  | "handoff_ready"
  | "timed_out"
  | "recovered_after_restart";

export type WorkflowRuntimeBroadcastDeliveryStatus =
  | "pending"
  | "sending"
  | "delivered"
  | "failed"
  | "superseded";

export type WorkflowRuntimeMigrationInfo = {
  version: 1;
  status: WorkflowRuntimeMigrationStatus;
  compatibilityMode: WorkflowRuntimeCompatibilityMode;
  migratedAt: string;
  reason: string | null;
  preservedFiles: string[];
  notes: string[];
};

export type WorkflowRuntimeQueueRunPayload = {
  message: string;
  lane: string;
  deliver: boolean;
  idempotencyKey: string | null;
  extraSystemPrompt: string | null;
};

export type WorkflowRuntimeQueueDispatchPayload = {
  requesterChannel: string | null;
  requesterAccountId: string | null;
  preferredSessionKeys: string[];
  fromRole: string | null;
  toRole: string;
  projectRoot: string;
  projectId: string | null;
  stage: string | null;
  summary: string;
  command: string | null;
  mailboxMessageId: string | null;
  requireMailboxAcknowledgement: boolean;
  extraBody: string | null;
  waitTimeoutMs: number | null;
  retryOnTimeout: boolean;
  enableSpawnFallback: boolean;
  useWorkflowHandoff: boolean;
  autoModeActive: boolean;
};

export type WorkflowRuntimeQueueEntry = {
  transitionId: string;
  queueId: string;
  queueKey: string;
  source: string;
  entryType: "background_run" | "dispatch_task";
  ownerAgent: string;
  channelKey: string;
  requesterSessionKey: string;
  messageChannel: string | null;
  preferredSessionKey: string | null;
  family: string;
  kind: string;
  projectId: string | null;
  projectRoot: string | null;
  queuedAt: string;
  lastAttemptedAt: string | null;
  lastCheckedAt: string | null;
  attemptCount: number;
  summary: string | null;
  status: WorkflowRuntimeQueueEntryStatus;
  fallbackMode: WorkflowRuntimeCompatibilityMode | null;
  lastError: string | null;
  parentSessionKey: string | null;
  threadBindingKey: string | null;
  depth: number;
  runPayload: WorkflowRuntimeQueueRunPayload | null;
  dispatchPayload: WorkflowRuntimeQueueDispatchPayload | null;
};

export type WorkflowRuntimeSessionEntry = {
  sessionKey: string;
  sessionId: string | null;
  runtime: string;
  role: string | null;
  agentId: string | null;
  ownerAgent: string | null;
  family: string;
  kind: string;
  channelKey: string | null;
  requesterSessionKey: string | null;
  projectId: string | null;
  projectRoot: string | null;
  parentSessionKey: string | null;
  threadBindingKey: string | null;
  depth: number;
  status: WorkflowRuntimeSessionStatus;
  runId: string | null;
  queueKey: string | null;
  startedAt: string;
  lastHeartbeatAt: string | null;
  lastAnnounceAt: string | null;
  lastCheckedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
};

export type WorkflowRuntimeAnnounceEntry = {
  announceId: string;
  sourceTransitionId: string | null;
  projectId: string | null;
  projectRoot: string;
  parentSessionKey: string | null;
  childSessionKey: string;
  deliveryMode: WorkflowRuntimeAnnounceDeliveryMode;
  status: WorkflowRuntimeAnnounceStatus;
  summary: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
  consumedAt: string | null;
  lastError: string | null;
};

export type WorkflowRuntimeBroadcastEntry = {
  broadcastId: string;
  idempotencyKey: string;
  projectId: string | null;
  projectRoot: string;
  sessionKey: string | null;
  status: WorkflowRuntimeBroadcastStatus;
  stage: string | null;
  summary: string;
  deliveryStatus: WorkflowRuntimeBroadcastDeliveryStatus;
  attempts: number;
  createdAt: string;
  lastAttemptedAt: string | null;
  deliveredAt: string | null;
  lastError: string | null;
};

export type WorkflowRuntimeEvent = {
  recordedAt: string;
  projectId: string | null;
  projectRoot: string;
  kind: string;
  summary: string | null;
  details: Record<string, unknown> | null;
};

type WorkflowRuntimeStoreMeta = {
  schemaVersion: 1;
  runtimeFramework: typeof WORKFLOW_RUNTIME_FRAMEWORK;
  compatibilityMode: WorkflowRuntimeCompatibilityMode;
  updatedAt: string;
  migration: WorkflowRuntimeMigrationInfo;
};

export type WorkflowRuntimeQueueStore = WorkflowRuntimeStoreMeta & {
  projectId: string | null;
  projectRoot: string;
  entries: WorkflowRuntimeQueueEntry[];
};

export type WorkflowRuntimeSessionsStore = WorkflowRuntimeStoreMeta & {
  projectId: string | null;
  projectRoot: string;
  entries: WorkflowRuntimeSessionEntry[];
};

export type WorkflowRuntimeAnnounceOutboxStore = WorkflowRuntimeStoreMeta & {
  projectId: string | null;
  projectRoot: string;
  entries: WorkflowRuntimeAnnounceEntry[];
};

export type WorkflowRuntimeBroadcastOutboxStore = WorkflowRuntimeStoreMeta & {
  projectId: string | null;
  projectRoot: string;
  entries: WorkflowRuntimeBroadcastEntry[];
};

type ManifestLike = Record<string, unknown>;

const RUNTIME_DIRNAME = ".openclaw-research";
const QUEUE_FILENAME = "workflow-runtime-queue.json";
const SESSIONS_FILENAME = "workflow-runtime-sessions.json";
const ANNOUNCE_FILENAME = "workflow-announce-outbox.json";
const BROADCAST_FILENAME = "workflow-broadcast-outbox.json";
const EVENTS_FILENAME = "workflow-events.jsonl";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeProjectRoot(projectRoot: string): string {
  return path.resolve(projectRoot);
}

function nowIso(): string {
  return new Date().toISOString();
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (!raw.trim()) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : null;
    if (error instanceof SyntaxError) {
      return null;
    }
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeJsonAtomicEnsured(filePath, value);
}

function getRuntimeStoreLockPath(filePath: string): string {
  return `${filePath}.lock`;
}

async function withRuntimeStoreLock<T>(
  filePath: string,
  task: () => Promise<T>
): Promise<T> {
  return withAdvisoryLock({
    lockPath: getRuntimeStoreLockPath(filePath),
    task,
  });
}

function normalizeCompatibilityMode(
  value: unknown
): WorkflowRuntimeCompatibilityMode {
  switch (readString(value)) {
    case "legacy_dispatch":
    case "hybrid_runtime":
    case "sessions_spawn_runtime":
      return value as WorkflowRuntimeCompatibilityMode;
    default:
      return "sessions_spawn_runtime";
  }
}

function normalizeMigrationInfo(
  value: unknown,
  compatibilityMode: WorkflowRuntimeCompatibilityMode
): WorkflowRuntimeMigrationInfo {
  const record = asRecord(value) ?? {};
  return {
    version: 1,
    status: readString(record.status) === "initialized" ? "initialized" : "completed",
    compatibilityMode: normalizeCompatibilityMode(
      record.compatibilityMode ?? record.compatibility_mode ?? compatibilityMode
    ),
    migratedAt: readString(record.migratedAt ?? record.migrated_at) ?? new Date(0).toISOString(),
    reason: readString(record.reason),
    preservedFiles: Array.isArray(record.preservedFiles ?? record.preserved_files)
      ? ((record.preservedFiles ?? record.preserved_files) as unknown[])
          .map((item) => readString(item))
          .filter((item): item is string => Boolean(item))
      : [],
    notes: Array.isArray(record.notes)
      ? (record.notes as unknown[])
          .map((item) => readString(item))
          .filter((item): item is string => Boolean(item))
      : [],
  };
}

function defaultMigrationInfo(params: {
  compatibilityMode: WorkflowRuntimeCompatibilityMode;
  reason?: string | null;
  notes?: string[];
}): WorkflowRuntimeMigrationInfo {
  return {
    version: 1,
    status: "completed",
    compatibilityMode: params.compatibilityMode,
    migratedAt: nowIso(),
    reason: readString(params.reason) ?? null,
    preservedFiles: [
      "PROJECT_MANIFEST.json",
      "TRACK_REGISTRY.json",
      ".openclaw-research/workflow-mailbox.json",
      ".openclaw-research/workflow-contact-log.json",
      ".openclaw-research/channel-project-bindings.json",
    ],
    notes: params.notes ?? [],
  };
}

function buildStoreMeta(params: {
  compatibilityMode: WorkflowRuntimeCompatibilityMode;
  migration: WorkflowRuntimeMigrationInfo;
  updatedAt?: string | null;
}): WorkflowRuntimeStoreMeta {
  return {
    schemaVersion: WORKFLOW_RUNTIME_SCHEMA_VERSION,
    runtimeFramework: WORKFLOW_RUNTIME_FRAMEWORK,
    compatibilityMode: params.compatibilityMode,
    updatedAt: readString(params.updatedAt) ?? nowIso(),
    migration: params.migration,
  };
}

function getManifestPath(projectRoot: string): string {
  return path.join(normalizeProjectRoot(projectRoot), "PROJECT_MANIFEST.json");
}

export function getWorkflowRuntimeDir(projectRoot: string): string {
  return path.join(normalizeProjectRoot(projectRoot), RUNTIME_DIRNAME);
}

export function getWorkflowRuntimeQueuePath(projectRoot: string): string {
  return path.join(getWorkflowRuntimeDir(projectRoot), QUEUE_FILENAME);
}

export function getWorkflowRuntimeSessionsPath(projectRoot: string): string {
  return path.join(getWorkflowRuntimeDir(projectRoot), SESSIONS_FILENAME);
}

export function getWorkflowAnnounceOutboxPath(projectRoot: string): string {
  return path.join(getWorkflowRuntimeDir(projectRoot), ANNOUNCE_FILENAME);
}

export function getWorkflowBroadcastOutboxPath(projectRoot: string): string {
  return path.join(getWorkflowRuntimeDir(projectRoot), BROADCAST_FILENAME);
}

export function getWorkflowRuntimeEventsPath(projectRoot: string): string {
  return path.join(getWorkflowRuntimeDir(projectRoot), EVENTS_FILENAME);
}

async function readManifest(projectRoot: string): Promise<ManifestLike> {
  return (await readJsonIfExists<ManifestLike>(getManifestPath(projectRoot))) ?? {};
}

async function saveManifestAudit(
  projectRoot: string,
  audit: Record<string, unknown>
): Promise<void> {
  const manifestPath = getManifestPath(projectRoot);
  await withRuntimeStoreLock(manifestPath, async () => {
    const current = await readManifest(projectRoot);
    await writeJson(manifestPath, {
      ...current,
      audit,
      updated_at: nowIso(),
    });
  });
}

function normalizeManifestAudit(
  value: unknown,
  compatibilityMode: WorkflowRuntimeCompatibilityMode,
  reason?: string | null
): Record<string, unknown> {
  const audit = asRecord(value) ?? {};
  const runtimeMigration = normalizeMigrationInfo(
    audit.runtime_migration,
    compatibilityMode
  );
  if (readString(audit.runtime_framework) !== WORKFLOW_RUNTIME_FRAMEWORK) {
    runtimeMigration.compatibilityMode = compatibilityMode;
    runtimeMigration.reason = readString(reason) ?? runtimeMigration.reason;
    runtimeMigration.migratedAt = nowIso();
    runtimeMigration.status = "completed";
  }
  return {
    ...audit,
    runtime_framework: WORKFLOW_RUNTIME_FRAMEWORK,
    runtime_framework_version: 1,
    runtime_migration: {
      version: runtimeMigration.version,
      status: runtimeMigration.status,
      compatibility_mode: runtimeMigration.compatibilityMode,
      migrated_at: runtimeMigration.migratedAt,
      reason: runtimeMigration.reason,
      preserved_files: runtimeMigration.preservedFiles,
      notes: runtimeMigration.notes,
    },
  };
}

function defaultQueueStore(params: {
  projectRoot: string;
  projectId?: string | null;
  compatibilityMode: WorkflowRuntimeCompatibilityMode;
  migration: WorkflowRuntimeMigrationInfo;
}): WorkflowRuntimeQueueStore {
  return {
    ...buildStoreMeta(params),
    projectId: readString(params.projectId) ?? null,
    projectRoot: normalizeProjectRoot(params.projectRoot),
    entries: [],
  };
}

function defaultSessionsStore(params: {
  projectRoot: string;
  projectId?: string | null;
  compatibilityMode: WorkflowRuntimeCompatibilityMode;
  migration: WorkflowRuntimeMigrationInfo;
}): WorkflowRuntimeSessionsStore {
  return {
    ...buildStoreMeta(params),
    projectId: readString(params.projectId) ?? null,
    projectRoot: normalizeProjectRoot(params.projectRoot),
    entries: [],
  };
}

function defaultAnnounceStore(params: {
  projectRoot: string;
  projectId?: string | null;
  compatibilityMode: WorkflowRuntimeCompatibilityMode;
  migration: WorkflowRuntimeMigrationInfo;
}): WorkflowRuntimeAnnounceOutboxStore {
  return {
    ...buildStoreMeta(params),
    projectId: readString(params.projectId) ?? null,
    projectRoot: normalizeProjectRoot(params.projectRoot),
    entries: [],
  };
}

function defaultBroadcastStore(params: {
  projectRoot: string;
  projectId?: string | null;
  compatibilityMode: WorkflowRuntimeCompatibilityMode;
  migration: WorkflowRuntimeMigrationInfo;
}): WorkflowRuntimeBroadcastOutboxStore {
  return {
    ...buildStoreMeta(params),
    projectId: readString(params.projectId) ?? null,
    projectRoot: normalizeProjectRoot(params.projectRoot),
    entries: [],
  };
}

function normalizeQueueEntry(value: unknown): WorkflowRuntimeQueueEntry | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const transitionId =
    readString(record.transitionId ?? record.transition_id ?? record.queueId ?? record.queue_id);
  const queueKey = readString(record.queueKey ?? record.queue_key);
  const ownerAgent = readString(record.ownerAgent ?? record.owner_agent);
  const channelKey = readString(record.channelKey ?? record.channel_key);
  const requesterSessionKey = readString(
    record.requesterSessionKey ?? record.requester_session_key
  );
  const family = readString(record.family);
  const kind = readString(record.kind);
  const queuedAt = readString(record.queuedAt ?? record.queued_at);
  if (
    !transitionId ||
    !queueKey ||
    !ownerAgent ||
    !channelKey ||
    !requesterSessionKey ||
    !family ||
    !kind ||
    !queuedAt
  ) {
    return null;
  }
  const runPayloadRecord = asRecord(record.runPayload ?? record.run_payload);
  const dispatchPayloadRecord = asRecord(
    record.dispatchPayload ?? record.dispatch_payload
  );
  return {
    transitionId,
    queueId: transitionId,
    queueKey,
    source: readString(record.source) ?? "workflow_auto_stage",
    entryType:
      readString(record.entryType ?? record.entry_type) === "dispatch_task"
        ? "dispatch_task"
        : "background_run",
    ownerAgent,
    channelKey,
    requesterSessionKey,
    messageChannel: readString(record.messageChannel ?? record.message_channel),
    preferredSessionKey: readString(
      record.preferredSessionKey ?? record.preferred_session_key
    ),
    family,
    kind,
    projectId: readString(record.projectId ?? record.project_id),
    projectRoot: readString(record.projectRoot ?? record.project_root),
    queuedAt,
    lastAttemptedAt: readString(record.lastAttemptedAt ?? record.last_attempted_at),
    lastCheckedAt: readString(record.lastCheckedAt ?? record.last_checked_at),
    attemptCount: Math.max(
      0,
      Math.floor(readNumber(record.attemptCount ?? record.attempt_count) ?? 0)
    ),
    summary: readString(record.summary),
    status: (readString(record.status) as WorkflowRuntimeQueueEntryStatus | null) ?? "queued",
    fallbackMode: readString(record.fallbackMode ?? record.fallback_mode)
      ? normalizeCompatibilityMode(record.fallbackMode ?? record.fallback_mode)
      : null,
    lastError: readString(record.lastError ?? record.last_error),
    parentSessionKey: readString(
      record.parentSessionKey ?? record.parent_session_key
    ),
    threadBindingKey: readString(
      record.threadBindingKey ?? record.thread_binding_key
    ),
    depth: Math.max(0, Math.floor(readNumber(record.depth) ?? 0)),
    runPayload: runPayloadRecord
      ? {
          message: readString(runPayloadRecord.message) ?? "",
          lane: readString(runPayloadRecord.lane) ?? "nested",
          deliver: runPayloadRecord.deliver === true,
          idempotencyKey: readString(
            runPayloadRecord.idempotencyKey ?? runPayloadRecord.idempotency_key
          ),
          extraSystemPrompt: readString(
            runPayloadRecord.extraSystemPrompt ?? runPayloadRecord.extra_system_prompt
          ),
        }
      : null,
    dispatchPayload: dispatchPayloadRecord
      ? {
          requesterChannel: readString(
            dispatchPayloadRecord.requesterChannel ??
              dispatchPayloadRecord.requester_channel
          ),
          requesterAccountId: readString(
            dispatchPayloadRecord.requesterAccountId ??
              dispatchPayloadRecord.requester_account_id
          ),
          preferredSessionKeys: Array.isArray(
            dispatchPayloadRecord.preferredSessionKeys ??
              dispatchPayloadRecord.preferred_session_keys
          )
            ? ((
                dispatchPayloadRecord.preferredSessionKeys ??
                dispatchPayloadRecord.preferred_session_keys
              ) as unknown[])
                .map((item) => readString(item))
                .filter((item): item is string => Boolean(item))
            : [],
          fromRole: readString(
            dispatchPayloadRecord.fromRole ?? dispatchPayloadRecord.from_role
          ),
          toRole:
            readString(dispatchPayloadRecord.toRole ?? dispatchPayloadRecord.to_role) ??
            "researcher",
          projectRoot:
            readString(
              dispatchPayloadRecord.projectRoot ?? dispatchPayloadRecord.project_root
            ) ?? "",
          projectId: readString(
            dispatchPayloadRecord.projectId ?? dispatchPayloadRecord.project_id
          ),
          stage: readString(dispatchPayloadRecord.stage),
          summary: readString(dispatchPayloadRecord.summary) ?? "",
          command: readString(dispatchPayloadRecord.command),
          mailboxMessageId: readString(
            dispatchPayloadRecord.mailboxMessageId ??
              dispatchPayloadRecord.mailbox_message_id
          ),
          requireMailboxAcknowledgement:
            dispatchPayloadRecord.requireMailboxAcknowledgement === true ||
            dispatchPayloadRecord.require_mailbox_acknowledgement === true,
          extraBody: readString(
            dispatchPayloadRecord.extraBody ?? dispatchPayloadRecord.extra_body
          ),
          waitTimeoutMs: readNumber(
            dispatchPayloadRecord.waitTimeoutMs ??
              dispatchPayloadRecord.wait_timeout_ms
          ),
          retryOnTimeout: dispatchPayloadRecord.retryOnTimeout === true,
          enableSpawnFallback: dispatchPayloadRecord.enableSpawnFallback !== false,
          useWorkflowHandoff: dispatchPayloadRecord.useWorkflowHandoff === true,
          autoModeActive: dispatchPayloadRecord.autoModeActive === true,
        }
      : null,
  };
}

function normalizeSessionEntry(value: unknown): WorkflowRuntimeSessionEntry | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const sessionKey = readString(record.sessionKey ?? record.session_key);
  const family = readString(record.family);
  const kind = readString(record.kind);
  const startedAt = readString(record.startedAt ?? record.started_at);
  if (!sessionKey || !family || !kind || !startedAt) {
    return null;
  }
  return {
    sessionKey,
    sessionId: readString(record.sessionId ?? record.session_id),
    runtime: readString(record.runtime) ?? "subagent",
    role: readString(record.role),
    agentId: readString(record.agentId ?? record.agent_id),
    ownerAgent: readString(record.ownerAgent ?? record.owner_agent),
    family,
    kind,
    channelKey: readString(record.channelKey ?? record.channel_key),
    requesterSessionKey: readString(
      record.requesterSessionKey ?? record.requester_session_key
    ),
    projectId: readString(record.projectId ?? record.project_id),
    projectRoot: readString(record.projectRoot ?? record.project_root),
    parentSessionKey: readString(
      record.parentSessionKey ?? record.parent_session_key
    ),
    threadBindingKey: readString(
      record.threadBindingKey ?? record.thread_binding_key
    ),
    depth: Math.max(0, Math.floor(readNumber(record.depth) ?? 0)),
    status:
      (readString(record.status) as WorkflowRuntimeSessionStatus | null) ?? "active",
    runId: readString(record.runId ?? record.run_id),
    queueKey: readString(record.queueKey ?? record.queue_key),
    startedAt,
    lastHeartbeatAt: readString(
      record.lastHeartbeatAt ?? record.last_heartbeat_at
    ),
    lastAnnounceAt: readString(record.lastAnnounceAt ?? record.last_announce_at),
    lastCheckedAt: readString(record.lastCheckedAt ?? record.last_checked_at),
    lastFinishedAt: readString(record.lastFinishedAt ?? record.last_finished_at),
    lastError: readString(record.lastError ?? record.last_error),
  };
}

function normalizeAnnounceEntry(value: unknown): WorkflowRuntimeAnnounceEntry | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const announceId = readString(record.announceId ?? record.announce_id);
  const childSessionKey = readString(record.childSessionKey ?? record.child_session_key);
  const summary = readString(record.summary);
  const createdAt = readString(record.createdAt ?? record.created_at);
  const projectRoot = readString(record.projectRoot ?? record.project_root);
  if (!announceId || !childSessionKey || !summary || !createdAt || !projectRoot) {
    return null;
  }
  return {
    announceId,
    sourceTransitionId: readString(
      record.sourceTransitionId ?? record.source_transition_id
    ),
    projectId: readString(record.projectId ?? record.project_id),
    projectRoot,
    parentSessionKey: readString(
      record.parentSessionKey ?? record.parent_session_key
    ),
    childSessionKey,
    deliveryMode:
      readString(record.deliveryMode ?? record.delivery_mode) === "external"
        ? "external"
        : "internal",
    status:
      (readString(record.status) as WorkflowRuntimeAnnounceStatus | null) ?? "pending",
    summary,
    payload: asRecord(record.payload),
    createdAt,
    consumedAt: readString(record.consumedAt ?? record.consumed_at),
    lastError: readString(record.lastError ?? record.last_error),
  };
}

function normalizeBroadcastEntry(value: unknown): WorkflowRuntimeBroadcastEntry | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const broadcastId = readString(record.broadcastId ?? record.broadcast_id);
  const idempotencyKey = readString(
    record.idempotencyKey ?? record.idempotency_key
  );
  const summary = readString(record.summary);
  const createdAt = readString(record.createdAt ?? record.created_at);
  const projectRoot = readString(record.projectRoot ?? record.project_root);
  if (!broadcastId || !idempotencyKey || !summary || !createdAt || !projectRoot) {
    return null;
  }
  return {
    broadcastId,
    idempotencyKey,
    projectId: readString(record.projectId ?? record.project_id),
    projectRoot,
    sessionKey: readString(record.sessionKey ?? record.session_key),
    status:
      (readString(record.status) as WorkflowRuntimeBroadcastStatus | null) ?? "queued",
    stage: readString(record.stage),
    summary,
    deliveryStatus:
      (readString(
        record.deliveryStatus ?? record.delivery_status
      ) as WorkflowRuntimeBroadcastDeliveryStatus | null) ?? "pending",
    attempts: Math.max(0, Math.floor(readNumber(record.attempts) ?? 0)),
    createdAt,
    lastAttemptedAt: readString(
      record.lastAttemptedAt ?? record.last_attempted_at
    ),
    deliveredAt: readString(record.deliveredAt ?? record.delivered_at),
    lastError: readString(record.lastError ?? record.last_error),
  };
}

function normalizeQueueStore(
  projectRoot: string,
  projectId: string | null,
  value: unknown,
  compatibilityMode: WorkflowRuntimeCompatibilityMode,
  migration: WorkflowRuntimeMigrationInfo
): WorkflowRuntimeQueueStore {
  const record = asRecord(value);
  const entries = Array.isArray(record?.entries)
    ? record?.entries
        .map((entry) => normalizeQueueEntry(entry))
        .filter((entry): entry is WorkflowRuntimeQueueEntry => Boolean(entry))
    : [];
  return {
    ...buildStoreMeta({
      compatibilityMode: normalizeCompatibilityMode(
        record?.compatibilityMode ?? record?.compatibility_mode ?? compatibilityMode
      ),
      migration: normalizeMigrationInfo(record?.migration, compatibilityMode),
      updatedAt: readString(record?.updatedAt ?? record?.updated_at),
    }),
    projectId,
    projectRoot: normalizeProjectRoot(projectRoot),
    entries,
  };
}

function normalizeSessionsStore(
  projectRoot: string,
  projectId: string | null,
  value: unknown,
  compatibilityMode: WorkflowRuntimeCompatibilityMode,
  migration: WorkflowRuntimeMigrationInfo
): WorkflowRuntimeSessionsStore {
  const record = asRecord(value);
  const entries = Array.isArray(record?.entries)
    ? record?.entries
        .map((entry) => normalizeSessionEntry(entry))
        .filter((entry): entry is WorkflowRuntimeSessionEntry => Boolean(entry))
    : [];
  return {
    ...buildStoreMeta({
      compatibilityMode: normalizeCompatibilityMode(
        record?.compatibilityMode ?? record?.compatibility_mode ?? compatibilityMode
      ),
      migration: normalizeMigrationInfo(record?.migration, compatibilityMode),
      updatedAt: readString(record?.updatedAt ?? record?.updated_at),
    }),
    projectId,
    projectRoot: normalizeProjectRoot(projectRoot),
    entries,
  };
}

function normalizeAnnounceStore(
  projectRoot: string,
  projectId: string | null,
  value: unknown,
  compatibilityMode: WorkflowRuntimeCompatibilityMode,
  migration: WorkflowRuntimeMigrationInfo
): WorkflowRuntimeAnnounceOutboxStore {
  const record = asRecord(value);
  const entries = Array.isArray(record?.entries)
    ? record?.entries
        .map((entry) => normalizeAnnounceEntry(entry))
        .filter((entry): entry is WorkflowRuntimeAnnounceEntry => Boolean(entry))
    : [];
  return {
    ...buildStoreMeta({
      compatibilityMode: normalizeCompatibilityMode(
        record?.compatibilityMode ?? record?.compatibility_mode ?? compatibilityMode
      ),
      migration: normalizeMigrationInfo(record?.migration, compatibilityMode),
      updatedAt: readString(record?.updatedAt ?? record?.updated_at),
    }),
    projectId,
    projectRoot: normalizeProjectRoot(projectRoot),
    entries,
  };
}

function normalizeBroadcastStore(
  projectRoot: string,
  projectId: string | null,
  value: unknown,
  compatibilityMode: WorkflowRuntimeCompatibilityMode,
  migration: WorkflowRuntimeMigrationInfo
): WorkflowRuntimeBroadcastOutboxStore {
  const record = asRecord(value);
  const entries = Array.isArray(record?.entries)
    ? record?.entries
        .map((entry) => normalizeBroadcastEntry(entry))
        .filter((entry): entry is WorkflowRuntimeBroadcastEntry => Boolean(entry))
    : [];
  return {
    ...buildStoreMeta({
      compatibilityMode: normalizeCompatibilityMode(
        record?.compatibilityMode ?? record?.compatibility_mode ?? compatibilityMode
      ),
      migration: normalizeMigrationInfo(record?.migration, compatibilityMode),
      updatedAt: readString(record?.updatedAt ?? record?.updated_at),
    }),
    projectId,
    projectRoot: normalizeProjectRoot(projectRoot),
    entries,
  };
}

export async function migrateWorkflowRuntimeState(params: {
  projectRoot: string;
  projectId?: string | null;
  compatibilityMode?: WorkflowRuntimeCompatibilityMode;
  reason?: string | null;
  notes?: string[];
}): Promise<{
  migrated: boolean;
  projectRoot: string;
  projectId: string | null;
  compatibilityMode: WorkflowRuntimeCompatibilityMode;
  createdFiles: string[];
  runtimeDir: string;
}> {
  const projectRoot = normalizeProjectRoot(params.projectRoot);
  const compatibilityMode = normalizeCompatibilityMode(params.compatibilityMode);
  const manifest = await readManifest(projectRoot);
  const projectId =
    readString(params.projectId) ??
    readString(manifest.project_id) ??
    path.basename(projectRoot);
  const runtimeDir = getWorkflowRuntimeDir(projectRoot);
  const migration = defaultMigrationInfo({
    compatibilityMode,
    reason: params.reason,
    notes: params.notes,
  });
  const audit = normalizeManifestAudit(
    manifest.audit,
    compatibilityMode,
    params.reason ?? null
  );
  manifest.audit = audit;
  await saveManifestAudit(projectRoot, audit);

  const createdFiles: string[] = [];
  const fileSpecs: Array<{
    path: string;
    build: () =>
      | WorkflowRuntimeQueueStore
      | WorkflowRuntimeSessionsStore
      | WorkflowRuntimeAnnounceOutboxStore
      | WorkflowRuntimeBroadcastOutboxStore;
  }> = [
    {
      path: getWorkflowRuntimeQueuePath(projectRoot),
      build: () =>
        defaultQueueStore({
          projectRoot,
          projectId,
          compatibilityMode,
          migration,
        }),
    },
    {
      path: getWorkflowRuntimeSessionsPath(projectRoot),
      build: () =>
        defaultSessionsStore({
          projectRoot,
          projectId,
          compatibilityMode,
          migration,
        }),
    },
    {
      path: getWorkflowAnnounceOutboxPath(projectRoot),
      build: () =>
        defaultAnnounceStore({
          projectRoot,
          projectId,
          compatibilityMode,
          migration,
        }),
    },
    {
      path: getWorkflowBroadcastOutboxPath(projectRoot),
      build: () =>
        defaultBroadcastStore({
          projectRoot,
          projectId,
          compatibilityMode,
          migration,
        }),
    },
  ];

  await fs.mkdir(runtimeDir, { recursive: true });
  for (const fileSpec of fileSpecs) {
    if (!(await fileExists(fileSpec.path))) {
      await writeJson(fileSpec.path, fileSpec.build());
      createdFiles.push(fileSpec.path);
    }
  }
  if (!(await fileExists(getWorkflowRuntimeEventsPath(projectRoot)))) {
    await fs.writeFile(getWorkflowRuntimeEventsPath(projectRoot), "", "utf8");
    createdFiles.push(getWorkflowRuntimeEventsPath(projectRoot));
  }

  return {
    migrated: createdFiles.length > 0 || readString(asRecord(manifest.audit)?.runtime_framework) === WORKFLOW_RUNTIME_FRAMEWORK,
    projectRoot,
    projectId,
    compatibilityMode,
    createdFiles,
    runtimeDir,
  };
}

async function getProjectRuntimeContext(params: {
  projectRoot: string;
  projectId?: string | null;
  compatibilityMode?: WorkflowRuntimeCompatibilityMode;
  reason?: string | null;
}) {
  const migration = await migrateWorkflowRuntimeState({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    compatibilityMode: params.compatibilityMode,
    reason: params.reason,
  });
  const manifest = await readManifest(migration.projectRoot);
  const audit = asRecord(manifest.audit);
  const compatibilityMode = normalizeCompatibilityMode(
    audit?.runtime_migration &&
      asRecord(audit.runtime_migration)?.compatibility_mode
  );
  return {
    projectRoot: migration.projectRoot,
    projectId: migration.projectId,
    compatibilityMode,
    migration: normalizeMigrationInfo(audit?.runtime_migration, compatibilityMode),
  };
}

export async function readWorkflowRuntimeQueueStore(
  projectRoot: string
): Promise<WorkflowRuntimeQueueStore> {
  const normalizedProjectRoot = normalizeProjectRoot(projectRoot);
  const manifest = await readManifest(normalizedProjectRoot);
  const projectId =
    readString(manifest.project_id) ?? path.basename(normalizedProjectRoot);
  const audit = asRecord(manifest.audit);
  const compatibilityMode = normalizeCompatibilityMode(
    audit?.runtime_migration &&
      asRecord(audit.runtime_migration)?.compatibility_mode
  );
  const migration = normalizeMigrationInfo(audit?.runtime_migration, compatibilityMode);
  const raw = await readJsonIfExists<Record<string, unknown>>(
    getWorkflowRuntimeQueuePath(normalizedProjectRoot)
  );
  return raw
    ? normalizeQueueStore(
        normalizedProjectRoot,
        projectId,
        raw,
        compatibilityMode,
        migration
      )
    : defaultQueueStore({
        projectRoot: normalizedProjectRoot,
        projectId,
        compatibilityMode,
        migration,
      });
}

export async function writeWorkflowRuntimeQueueStore(params: {
  projectRoot: string;
  projectId?: string | null;
  compatibilityMode?: WorkflowRuntimeCompatibilityMode;
  entries: WorkflowRuntimeQueueEntry[];
}): Promise<WorkflowRuntimeQueueStore> {
  const context = await getProjectRuntimeContext(params);
  const store: WorkflowRuntimeQueueStore = {
    ...buildStoreMeta({
      compatibilityMode: context.compatibilityMode,
      migration: context.migration,
    }),
    projectId: context.projectId,
    projectRoot: context.projectRoot,
    entries: params.entries,
  };
  const targetPath = getWorkflowRuntimeQueuePath(context.projectRoot);
  await withRuntimeStoreLock(targetPath, async () => {
    await writeJson(targetPath, store);
  });
  return store;
}

export async function updateWorkflowRuntimeQueueStore(params: {
  projectRoot: string;
  projectId?: string | null;
  compatibilityMode?: WorkflowRuntimeCompatibilityMode;
  updater: (
    store: WorkflowRuntimeQueueStore
  ) => Promise<WorkflowRuntimeQueueEntry[]> | WorkflowRuntimeQueueEntry[];
}): Promise<WorkflowRuntimeQueueStore> {
  const context = await getProjectRuntimeContext(params);
  const targetPath = getWorkflowRuntimeQueuePath(context.projectRoot);
  return withRuntimeStoreLock(targetPath, async () => {
    const current = await readWorkflowRuntimeQueueStore(context.projectRoot);
    const nextEntries = await params.updater(current);
    const store: WorkflowRuntimeQueueStore = {
      ...buildStoreMeta({
        compatibilityMode: context.compatibilityMode,
        migration: context.migration,
      }),
      projectId: context.projectId,
      projectRoot: context.projectRoot,
      entries: nextEntries,
    };
    await writeJson(targetPath, store);
    return store;
  });
}

export async function readWorkflowRuntimeSessionsStore(
  projectRoot: string
): Promise<WorkflowRuntimeSessionsStore> {
  const normalizedProjectRoot = normalizeProjectRoot(projectRoot);
  const manifest = await readManifest(normalizedProjectRoot);
  const projectId =
    readString(manifest.project_id) ?? path.basename(normalizedProjectRoot);
  const audit = asRecord(manifest.audit);
  const compatibilityMode = normalizeCompatibilityMode(
    audit?.runtime_migration &&
      asRecord(audit.runtime_migration)?.compatibility_mode
  );
  const migration = normalizeMigrationInfo(audit?.runtime_migration, compatibilityMode);
  const raw = await readJsonIfExists<Record<string, unknown>>(
    getWorkflowRuntimeSessionsPath(normalizedProjectRoot)
  );
  return raw
    ? normalizeSessionsStore(
        normalizedProjectRoot,
        projectId,
        raw,
        compatibilityMode,
        migration
      )
    : defaultSessionsStore({
        projectRoot: normalizedProjectRoot,
        projectId,
        compatibilityMode,
        migration,
      });
}

export async function writeWorkflowRuntimeSessionsStore(params: {
  projectRoot: string;
  projectId?: string | null;
  compatibilityMode?: WorkflowRuntimeCompatibilityMode;
  entries: WorkflowRuntimeSessionEntry[];
}): Promise<WorkflowRuntimeSessionsStore> {
  const context = await getProjectRuntimeContext(params);
  const store: WorkflowRuntimeSessionsStore = {
    ...buildStoreMeta({
      compatibilityMode: context.compatibilityMode,
      migration: context.migration,
    }),
    projectId: context.projectId,
    projectRoot: context.projectRoot,
    entries: params.entries,
  };
  const targetPath = getWorkflowRuntimeSessionsPath(context.projectRoot);
  await withRuntimeStoreLock(targetPath, async () => {
    await writeJson(targetPath, store);
  });
  return store;
}

export async function updateWorkflowRuntimeSessionsStore(params: {
  projectRoot: string;
  projectId?: string | null;
  compatibilityMode?: WorkflowRuntimeCompatibilityMode;
  updater: (
    store: WorkflowRuntimeSessionsStore
  ) => Promise<WorkflowRuntimeSessionEntry[]> | WorkflowRuntimeSessionEntry[];
}): Promise<WorkflowRuntimeSessionsStore> {
  const context = await getProjectRuntimeContext(params);
  const targetPath = getWorkflowRuntimeSessionsPath(context.projectRoot);
  return withRuntimeStoreLock(targetPath, async () => {
    const current = await readWorkflowRuntimeSessionsStore(context.projectRoot);
    const nextEntries = await params.updater(current);
    const store: WorkflowRuntimeSessionsStore = {
      ...buildStoreMeta({
        compatibilityMode: context.compatibilityMode,
        migration: context.migration,
      }),
      projectId: context.projectId,
      projectRoot: context.projectRoot,
      entries: nextEntries,
    };
    await writeJson(targetPath, store);
    return store;
  });
}

export async function readWorkflowAnnounceOutboxStore(
  projectRoot: string
): Promise<WorkflowRuntimeAnnounceOutboxStore> {
  const normalizedProjectRoot = normalizeProjectRoot(projectRoot);
  const manifest = await readManifest(normalizedProjectRoot);
  const projectId =
    readString(manifest.project_id) ?? path.basename(normalizedProjectRoot);
  const audit = asRecord(manifest.audit);
  const compatibilityMode = normalizeCompatibilityMode(
    audit?.runtime_migration &&
      asRecord(audit.runtime_migration)?.compatibility_mode
  );
  const migration = normalizeMigrationInfo(audit?.runtime_migration, compatibilityMode);
  const raw = await readJsonIfExists<Record<string, unknown>>(
    getWorkflowAnnounceOutboxPath(normalizedProjectRoot)
  );
  return raw
    ? normalizeAnnounceStore(
        normalizedProjectRoot,
        projectId,
        raw,
        compatibilityMode,
        migration
      )
    : defaultAnnounceStore({
        projectRoot: normalizedProjectRoot,
        projectId,
        compatibilityMode,
        migration,
      });
}

export async function writeWorkflowAnnounceOutboxStore(params: {
  projectRoot: string;
  projectId?: string | null;
  compatibilityMode?: WorkflowRuntimeCompatibilityMode;
  entries: WorkflowRuntimeAnnounceEntry[];
}): Promise<WorkflowRuntimeAnnounceOutboxStore> {
  const context = await getProjectRuntimeContext(params);
  const store: WorkflowRuntimeAnnounceOutboxStore = {
    ...buildStoreMeta({
      compatibilityMode: context.compatibilityMode,
      migration: context.migration,
    }),
    projectId: context.projectId,
    projectRoot: context.projectRoot,
    entries: params.entries,
  };
  await writeJson(getWorkflowAnnounceOutboxPath(context.projectRoot), store);
  return store;
}

export async function readWorkflowBroadcastOutboxStore(
  projectRoot: string
): Promise<WorkflowRuntimeBroadcastOutboxStore> {
  const normalizedProjectRoot = normalizeProjectRoot(projectRoot);
  const manifest = await readManifest(normalizedProjectRoot);
  const projectId =
    readString(manifest.project_id) ?? path.basename(normalizedProjectRoot);
  const audit = asRecord(manifest.audit);
  const compatibilityMode = normalizeCompatibilityMode(
    audit?.runtime_migration &&
      asRecord(audit.runtime_migration)?.compatibility_mode
  );
  const migration = normalizeMigrationInfo(audit?.runtime_migration, compatibilityMode);
  const raw = await readJsonIfExists<Record<string, unknown>>(
    getWorkflowBroadcastOutboxPath(normalizedProjectRoot)
  );
  return raw
    ? normalizeBroadcastStore(
        normalizedProjectRoot,
        projectId,
        raw,
        compatibilityMode,
        migration
      )
    : defaultBroadcastStore({
        projectRoot: normalizedProjectRoot,
        projectId,
        compatibilityMode,
        migration,
      });
}

export async function writeWorkflowBroadcastOutboxStore(params: {
  projectRoot: string;
  projectId?: string | null;
  compatibilityMode?: WorkflowRuntimeCompatibilityMode;
  entries: WorkflowRuntimeBroadcastEntry[];
}): Promise<WorkflowRuntimeBroadcastOutboxStore> {
  const context = await getProjectRuntimeContext(params);
  const store: WorkflowRuntimeBroadcastOutboxStore = {
    ...buildStoreMeta({
      compatibilityMode: context.compatibilityMode,
      migration: context.migration,
    }),
    projectId: context.projectId,
    projectRoot: context.projectRoot,
    entries: params.entries,
  };
  await writeJson(getWorkflowBroadcastOutboxPath(context.projectRoot), store);
  return store;
}

export async function appendWorkflowRuntimeEvent(params: {
  projectRoot: string;
  projectId?: string | null;
  kind: string;
  summary?: string | null;
  details?: Record<string, unknown> | null;
}): Promise<WorkflowRuntimeEvent> {
  const projectRoot = normalizeProjectRoot(params.projectRoot);
  await migrateWorkflowRuntimeState({
    projectRoot,
    projectId: params.projectId,
    reason: "append_runtime_event",
  });
  const event: WorkflowRuntimeEvent = {
    recordedAt: nowIso(),
    projectId: readString(params.projectId) ?? path.basename(projectRoot),
    projectRoot,
    kind: params.kind,
    summary: readString(params.summary) ?? null,
    details: params.details ?? null,
  };
  await fs.appendFile(
    getWorkflowRuntimeEventsPath(projectRoot),
    `${JSON.stringify(event)}\n`,
    "utf8"
  );
  return event;
}

export async function readWorkflowRuntimeEvents(
  projectRoot: string
): Promise<WorkflowRuntimeEvent[]> {
  try {
    const raw = await fs.readFile(getWorkflowRuntimeEventsPath(projectRoot), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as WorkflowRuntimeEvent);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : null;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function listWorkflowRuntimeProjectRoots(params: {
  projectRoot?: string | null;
  projectsRoot?: string | null;
}): Promise<string[]> {
  const roots = new Set<string>();
  const explicitProjectRoot = readString(params.projectRoot);
  if (explicitProjectRoot) {
    roots.add(normalizeProjectRoot(explicitProjectRoot));
  }
  const explicitProjectsRoot = readString(params.projectsRoot);
  if (explicitProjectsRoot) {
    try {
      const entries = await fs.readdir(normalizeProjectRoot(explicitProjectsRoot), {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const candidate = path.join(normalizeProjectRoot(explicitProjectsRoot), entry.name);
        if (
          (await fileExists(path.join(candidate, "PROJECT_MANIFEST.json"))) ||
          (await fileExists(getWorkflowRuntimeDir(candidate)))
        ) {
          roots.add(candidate);
        }
      }
    } catch {
      // Ignore missing projectsRoot.
    }
  }
  return Array.from(roots.values());
}

export async function listWorkflowRuntimeQueueEntries(params: {
  projectRoot?: string | null;
  projectsRoot?: string | null;
}): Promise<WorkflowRuntimeQueueEntry[]> {
  const projectRoots = await listWorkflowRuntimeProjectRoots(params);
  const stores = await Promise.all(
    projectRoots.map((projectRoot) => readWorkflowRuntimeQueueStore(projectRoot))
  );
  return stores.flatMap((store) => store.entries);
}

export async function listWorkflowRuntimeSessionEntries(params: {
  projectRoot?: string | null;
  projectsRoot?: string | null;
}): Promise<WorkflowRuntimeSessionEntry[]> {
  const projectRoots = await listWorkflowRuntimeProjectRoots(params);
  const stores = await Promise.all(
    projectRoots.map((projectRoot) => readWorkflowRuntimeSessionsStore(projectRoot))
  );
  return stores.flatMap((store) => store.entries);
}
