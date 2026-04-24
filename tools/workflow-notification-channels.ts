import * as fs from "node:fs";
import * as path from "node:path";
import { readJsonIfExists, writeJsonEnsured } from "./workflow-guard-core/fs";

function readString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

export type WorkflowNotificationChannelRecord = {
  notificationKey: string;
  projectRoot: string;
  projectId: string | null;
  messageChannel: string | null;
  channelKey: string | null;
  sessionKey: string | null;
  accountId: string | null;
  conversationId: string | null;
  source: string | null;
  notes: string | null;
  recordedAt: string;
  updatedAt: string;
};

type WorkflowNotificationChannelsStore = {
  schemaVersion: 1;
  updatedAt: string;
  channels: WorkflowNotificationChannelRecord[];
};

const STORE_FILE = "workflow-notification-channels.json";

function emptyStore(): WorkflowNotificationChannelsStore {
  return {
    schemaVersion: 1,
    updatedAt: new Date(0).toISOString(),
    channels: [],
  };
}

function normalizeRecord(value: unknown): WorkflowNotificationChannelRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<WorkflowNotificationChannelRecord>;
  const notificationKey = readString(record.notificationKey);
  const projectRoot = readString(record.projectRoot);
  if (!notificationKey || !projectRoot) {
    return null;
  }
  const recordedAt = readString(record.recordedAt) ?? new Date(0).toISOString();
  const updatedAt = readString(record.updatedAt) ?? recordedAt;
  return {
    notificationKey,
    projectRoot,
    projectId: readString(record.projectId),
    messageChannel: readString(record.messageChannel),
    channelKey: readString(record.channelKey),
    sessionKey: readString(record.sessionKey),
    accountId: readString(record.accountId),
    conversationId: readString(record.conversationId),
    source: readString(record.source),
    notes: readString(record.notes),
    recordedAt,
    updatedAt,
  };
}

function normalizeStore(value: unknown): WorkflowNotificationChannelsStore {
  if (!value || typeof value !== "object") {
    return emptyStore();
  }
  const store = value as Partial<WorkflowNotificationChannelsStore>;
  const channels = Array.isArray(store.channels)
    ? store.channels
        .map((entry) => normalizeRecord(entry))
        .filter((entry): entry is WorkflowNotificationChannelRecord => Boolean(entry))
    : [];
  return {
    schemaVersion: 1,
    updatedAt: readString(store.updatedAt) ?? new Date(0).toISOString(),
    channels,
  };
}

function buildNotificationKey(params: {
  messageChannel?: unknown;
  channelKey?: unknown;
  sessionKey?: unknown;
  accountId?: unknown;
  conversationId?: unknown;
}): string {
  const messageChannel = readString(params.messageChannel)?.toLowerCase() ?? "unknown";
  const target =
    readString(params.channelKey) ??
    readString(params.sessionKey) ??
    [
      readString(params.accountId) ?? "default",
      readString(params.conversationId) ?? "unknown",
    ].join(":");
  return `${messageChannel}:${target}`;
}

function sortNewestFirst(
  entries: WorkflowNotificationChannelRecord[]
): WorkflowNotificationChannelRecord[] {
  return [...entries].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );
}

export function getWorkflowNotificationChannelsPath(projectRoot: string): string {
  return path.join(
    path.resolve(projectRoot),
    ".openclaw-research",
    STORE_FILE
  );
}

export async function listWorkflowNotificationChannelsForProject(
  projectRoot: string
): Promise<WorkflowNotificationChannelRecord[]> {
  const store = normalizeStore(
    await readJsonIfExists<WorkflowNotificationChannelsStore>(
      getWorkflowNotificationChannelsPath(projectRoot)
    )
  );
  return sortNewestFirst(store.channels);
}

export function listWorkflowNotificationChannelsForProjectSync(
  projectRoot: string
): WorkflowNotificationChannelRecord[] {
  try {
    const raw = fs.readFileSync(getWorkflowNotificationChannelsPath(projectRoot), "utf8");
    return sortNewestFirst(normalizeStore(JSON.parse(raw)).channels);
  } catch {
    return [];
  }
}

export function resolveWorkflowNotificationTargetForProjectSync(
  projectRoot: string
): WorkflowNotificationChannelRecord | null {
  const channels = listWorkflowNotificationChannelsForProjectSync(projectRoot);
  return (
    channels.find((entry) => Boolean(entry.sessionKey)) ??
    channels[0] ??
    null
  );
}

export async function recordWorkflowNotificationChannelForProject(params: {
  projectRoot: string;
  projectId?: unknown;
  messageChannel?: unknown;
  channelKey?: unknown;
  sessionKey?: unknown;
  accountId?: unknown;
  conversationId?: unknown;
  source?: unknown;
  notes?: unknown;
  notificationKey?: unknown;
}): Promise<WorkflowNotificationChannelRecord> {
  const projectRoot = path.resolve(params.projectRoot);
  const storePath = getWorkflowNotificationChannelsPath(projectRoot);
  const existingStore = normalizeStore(
    await readJsonIfExists<WorkflowNotificationChannelsStore>(storePath)
  );
  const now = new Date().toISOString();
  const notificationKey =
    readString(params.notificationKey) ?? buildNotificationKey(params);
  const existing =
    existingStore.channels.find((entry) => entry.notificationKey === notificationKey) ??
    null;
  const record: WorkflowNotificationChannelRecord = {
    notificationKey,
    projectRoot,
    projectId: readString(params.projectId) ?? existing?.projectId ?? null,
    messageChannel:
      readString(params.messageChannel)?.toLowerCase() ??
      existing?.messageChannel ??
      null,
    channelKey: readString(params.channelKey) ?? existing?.channelKey ?? null,
    sessionKey: readString(params.sessionKey) ?? existing?.sessionKey ?? null,
    accountId: readString(params.accountId) ?? existing?.accountId ?? null,
    conversationId:
      readString(params.conversationId) ?? existing?.conversationId ?? null,
    source: readString(params.source) ?? existing?.source ?? null,
    notes: readString(params.notes) ?? existing?.notes ?? null,
    recordedAt: existing?.recordedAt ?? now,
    updatedAt: now,
  };
  const channels = sortNewestFirst([
    record,
    ...existingStore.channels.filter(
      (entry) => entry.notificationKey !== notificationKey
    ),
  ]);
  await writeJsonEnsured(storePath, {
    schemaVersion: 1,
    updatedAt: now,
    channels,
  } satisfies WorkflowNotificationChannelsStore);
  return record;
}
