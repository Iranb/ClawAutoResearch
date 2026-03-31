import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  dispatchWorkflowTaskToAgent,
  type DispatchableWorkflowRole,
} from "./agent-task-dispatch";
import {
  handoffWorkflowTaskToAgent,
  type WorkflowLobsterHandoffConfig,
} from "./lobster-handoff";
import {
  bindChannelProjectForWorkflow,
  ensureWorkflowProjectRoot,
  type WorkflowGuardPolicy,
} from "./workflow-guard";
import {
  buildWorkflowSubagentSessionKey,
  derivePapernexusTaskLabel,
  looksLikePapernexusHeavyCommand,
  normalizeWorkflowSubagentParentSessionKey,
} from "./workflow-subagent-sessions";

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeAgentId(value: unknown): string | null {
  return readString(value)?.toLowerCase() ?? null;
}

export type BackgroundRunRequest = {
  kind?: string;
  commandText?: string;
  summary?: string;
  topic?: string;
  title?: string;
  projectId?: string;
  projectRoot?: string;
  ensureProjectBinding?: boolean;
};

export type BackgroundRunRegistryViewEntry = BackgroundRunRegistryEntry & {
  deleteEligible: boolean;
  idleForMs: number | null;
};

export type BackgroundRunStartResult = {
  started: boolean;
  reason:
    | "started"
    | "channel_capacity_reached"
    | "runtime_unavailable"
    | "session_unavailable";
  runId: string | null;
  sessionKey: string | null;
  projectRoot: string | null;
  projectId: string | null;
  summary: string;
  reusedIdleSession: boolean;
  activeResearcherSessionsInChannel: number | null;
  queued: boolean;
  queueKey: string | null;
};

export type QueuedBackgroundWorkflowDrainResult = {
  started: BackgroundRunStartResult[];
  remaining: BackgroundWorkflowQueueEntry[];
};

export type BackgroundWorkflowSessionLease = {
  acquired: boolean;
  reason: "acquired" | "channel_capacity_reached";
  sessionKey: string | null;
  reusedIdleSession: boolean;
  activeResearcherSessionsInChannel: number | null;
  channelKey: string | null;
  ownerAgent: string | null;
  family: string;
  projectId: string | null;
  projectRoot: string | null;
};

type BackgroundRunRegistryEntry = {
  ownerAgent: string;
  channelKey: string;
  requesterSessionKey: string;
  backgroundSessionKey: string;
  runId: string;
  queueKey: string | null;
  kind: string;
  family: string;
  status: "active" | "idle";
  projectId: string | null;
  projectRoot: string | null;
  startedAt: string;
  lastCheckedAt: string | null;
  lastFinishedAt: string | null;
};

type BackgroundWorkflowQueueRunPayload = {
  message: string;
  lane: string;
  deliver: boolean;
  idempotencyKey: string | null;
  extraSystemPrompt: string | null;
};

type BackgroundWorkflowQueueDispatchPayload = {
  requesterChannel: string | null;
  requesterAccountId: string | null;
  preferredSessionKeys: string[];
  fromRole: string | null;
  toRole: DispatchableWorkflowRole;
  projectRoot: string;
  projectId: string | null;
  stage: string | null;
  summary: string;
  command: string | null;
  mailboxMessageId: string | null;
  extraBody: string | null;
  waitTimeoutMs: number | null;
  retryOnTimeout: boolean;
  enableSpawnFallback: boolean;
  useWorkflowHandoff: boolean;
  autoModeActive: boolean;
};

type BackgroundWorkflowQueueEntry = {
  queueId: string;
  queueKey: string;
  source:
    | "start_background_run"
    | "workflow_auto_stage"
    | "workflow_auto_discussion"
    | "workflow_auto_mitigation";
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
  attemptCount: number;
  summary: string | null;
  runPayload: BackgroundWorkflowQueueRunPayload | null;
  dispatchPayload: BackgroundWorkflowQueueDispatchPayload | null;
};

export type BackgroundRunAgentContext = {
  agentId?: string;
  workspaceDir?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
};

export type BackgroundRunSnapshot = {
  role: string | null;
  projectRoot: string | null;
  projectId: string | null;
  channelProjectBindingsEnabled: boolean;
};

const MAX_RESEARCHER_BACKGROUND_SUBAGENTS_PER_CHANNEL = 2;
const BACKGROUND_RUN_STALE_MS = 6 * 60 * 60 * 1000;
const BACKGROUND_RUN_REGISTRY_FILENAME = "openclaw-research-background-runs.json";
const BACKGROUND_QUEUE_STALE_MS = 24 * 60 * 60 * 1000;
const BACKGROUND_QUEUE_RETRY_BACKOFF_MS = 15 * 1000;
const BACKGROUND_QUEUE_FILENAME = "openclaw-research-background-queue.json";

function deriveBackgroundRunFamily(kind: string): string {
  switch (kind) {
    case "research_pipeline":
    case "research_queue":
    case "resume_pipeline":
    case "idle_research":
      return "research";
    case "papernexus_skill":
      return "papernexus";
    default:
      return kind || "generic";
  }
}

function backgroundRunRegistryEntryMatchesProject(
  entry: BackgroundRunRegistryEntry,
  projectId: string | null,
  projectRoot: string | null
): boolean {
  const normalizedProjectId = readString(projectId) ?? null;
  const normalizedProjectRoot = readString(projectRoot) ?? null;
  if (normalizedProjectId && entry.projectId) {
    return normalizedProjectId === entry.projectId;
  }
  if (normalizedProjectRoot && entry.projectRoot) {
    return path.normalize(normalizedProjectRoot) === path.normalize(entry.projectRoot);
  }
  return normalizedProjectId == null && normalizedProjectRoot == null;
}

function getBackgroundRunRegistryPath(): string {
  const override = readString(
    process.env.OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH
  );
  if (override) {
    return path.resolve(override);
  }
  return path.join(os.tmpdir(), BACKGROUND_RUN_REGISTRY_FILENAME);
}

function getBackgroundQueuePath(): string {
  const override = readString(
    process.env.OPENCLAW_RESEARCH_BACKGROUND_QUEUE_PATH
  );
  if (override) {
    return path.resolve(override);
  }
  return path.join(os.tmpdir(), BACKGROUND_QUEUE_FILENAME);
}

export async function clearBackgroundWorkflowRunRegistryForTests(): Promise<void> {
  await fs.rm(getBackgroundRunRegistryPath(), { force: true });
}

export async function clearBackgroundWorkflowQueueForTests(): Promise<void> {
  await fs.rm(getBackgroundQueuePath(), { force: true });
}

function deriveBackgroundRunChannelKey(params: {
  sessionKey?: string;
  messageChannel?: string;
}): string | null {
  const normalizedParent = normalizeWorkflowSubagentParentSessionKey(params.sessionKey);
  const sessionKey = readString(normalizedParent ?? params.sessionKey);
  if (sessionKey?.startsWith("agent:")) {
    const parts = sessionKey.split(":");
    if (parts.length > 2) {
      const suffix = parts.slice(2).join(":").trim();
      if (suffix) {
        return suffix;
      }
    }
  }
  return readString(params.messageChannel) ?? null;
}

async function readBackgroundRunRegistry(): Promise<BackgroundRunRegistryEntry[]> {
  try {
    const raw = await fs.readFile(getBackgroundRunRegistryPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const record = entry as Record<string, unknown>;
        const ownerAgent = normalizeAgentId(record.ownerAgent);
        const channelKey = readString(record.channelKey);
        const requesterSessionKey = readString(record.requesterSessionKey);
        const backgroundSessionKey = readString(record.backgroundSessionKey);
        const runId = readString(record.runId);
        const queueKey = readString(record.queueKey) ?? null;
        const kind = readString(record.kind) ?? "generic";
        const family = readString(record.family) ?? deriveBackgroundRunFamily(kind);
        const status = readString(record.status) === "idle" ? "idle" : "active";
        const projectId = readString(record.projectId) ?? null;
        const projectRoot = readString(record.projectRoot) ?? null;
        const startedAt = readString(record.startedAt);
        const lastCheckedAt = readString(record.lastCheckedAt) ?? null;
        const lastFinishedAt = readString(record.lastFinishedAt) ?? null;
        if (
          !ownerAgent ||
          !channelKey ||
          !requesterSessionKey ||
          !backgroundSessionKey ||
          !runId ||
          !startedAt
        ) {
          return null;
        }
        return {
          ownerAgent,
          channelKey,
          requesterSessionKey,
          backgroundSessionKey,
          runId,
          queueKey,
          kind,
          family,
          status,
          projectId,
          projectRoot,
          startedAt,
          lastCheckedAt,
          lastFinishedAt,
        } satisfies BackgroundRunRegistryEntry;
      })
      .filter((entry): entry is BackgroundRunRegistryEntry => Boolean(entry));
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

async function readBackgroundWorkflowQueue(): Promise<BackgroundWorkflowQueueEntry[]> {
  try {
    const raw = await fs.readFile(getBackgroundQueuePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const record = entry as Record<string, unknown>;
        const queueId = readString(record.queueId);
        const queueKey = readString(record.queueKey);
        const source = readString(record.source);
        const entryType = readString(record.entryType);
        const ownerAgent = normalizeAgentId(record.ownerAgent);
        const channelKey = readString(record.channelKey);
        const requesterSessionKey = readString(record.requesterSessionKey);
        const messageChannel = readString(record.messageChannel) ?? null;
        const preferredSessionKey = readString(record.preferredSessionKey) ?? null;
        const family = readString(record.family);
        const kind = readString(record.kind);
        const projectId = readString(record.projectId) ?? null;
        const projectRoot = readString(record.projectRoot) ?? null;
        const queuedAt = readString(record.queuedAt);
        const lastAttemptedAt = readString(record.lastAttemptedAt) ?? null;
        const attemptCount = Number.isFinite(record.attemptCount)
          ? Math.max(0, Math.floor(Number(record.attemptCount)))
          : 0;
        const summary = readString(record.summary) ?? null;
        const runPayload =
          record.runPayload && typeof record.runPayload === "object"
            ? {
                message:
                  readString((record.runPayload as Record<string, unknown>).message) ?? "",
                lane:
                  readString((record.runPayload as Record<string, unknown>).lane) ?? "nested",
                deliver:
                  (record.runPayload as Record<string, unknown>).deliver === true,
                idempotencyKey:
                  readString(
                    (record.runPayload as Record<string, unknown>).idempotencyKey
                  ) ?? null,
                extraSystemPrompt:
                  readString(
                    (record.runPayload as Record<string, unknown>).extraSystemPrompt
                  ) ?? null,
              }
            : null;
        const dispatchPayload =
          record.dispatchPayload && typeof record.dispatchPayload === "object"
            ? {
                requesterChannel:
                  readString(
                    (record.dispatchPayload as Record<string, unknown>).requesterChannel
                  ) ?? null,
                requesterAccountId:
                  readString(
                    (record.dispatchPayload as Record<string, unknown>).requesterAccountId
                  ) ?? null,
                preferredSessionKeys: Array.isArray(
                  (record.dispatchPayload as Record<string, unknown>).preferredSessionKeys
                )
                  ? ((record.dispatchPayload as Record<string, unknown>)
                      .preferredSessionKeys as unknown[])
                      .map((value) => readString(value) ?? null)
                      .filter((value): value is string => Boolean(value))
                  : [],
                fromRole:
                  readString((record.dispatchPayload as Record<string, unknown>).fromRole) ??
                  null,
                toRole:
                  (readString(
                    (record.dispatchPayload as Record<string, unknown>).toRole
                  ) as DispatchableWorkflowRole | undefined) ?? "researcher",
                projectRoot:
                  readString(
                    (record.dispatchPayload as Record<string, unknown>).projectRoot
                  ) ?? projectRoot ?? "",
                projectId:
                  readString(
                    (record.dispatchPayload as Record<string, unknown>).projectId
                  ) ?? projectId,
                stage:
                  readString((record.dispatchPayload as Record<string, unknown>).stage) ??
                  null,
                summary:
                  readString((record.dispatchPayload as Record<string, unknown>).summary) ??
                  "",
                command:
                  readString((record.dispatchPayload as Record<string, unknown>).command) ??
                  null,
                mailboxMessageId:
                  readString(
                    (record.dispatchPayload as Record<string, unknown>).mailboxMessageId
                  ) ?? null,
                extraBody:
                  readString((record.dispatchPayload as Record<string, unknown>).extraBody) ??
                  null,
                waitTimeoutMs: Number.isFinite(
                  (record.dispatchPayload as Record<string, unknown>).waitTimeoutMs
                )
                  ? Math.max(
                      0,
                      Math.floor(
                        Number(
                          (record.dispatchPayload as Record<string, unknown>).waitTimeoutMs
                        )
                      )
                    )
                  : null,
                retryOnTimeout:
                  (record.dispatchPayload as Record<string, unknown>).retryOnTimeout === true,
                enableSpawnFallback:
                  (record.dispatchPayload as Record<string, unknown>).enableSpawnFallback !==
                  false,
                useWorkflowHandoff:
                  (record.dispatchPayload as Record<string, unknown>).useWorkflowHandoff ===
                  true,
                autoModeActive:
                  (record.dispatchPayload as Record<string, unknown>).autoModeActive === true,
              }
            : null;
        if (
          !queueId ||
          !queueKey ||
          !source ||
          !entryType ||
          !ownerAgent ||
          !channelKey ||
          !requesterSessionKey ||
          !family ||
          !kind ||
          !queuedAt
        ) {
          return null;
        }
        if (entryType === "background_run" && !runPayload?.message) {
          return null;
        }
        if (entryType === "dispatch_task" && !dispatchPayload?.projectRoot) {
          return null;
        }
        return {
          queueId,
          queueKey,
          source: source as BackgroundWorkflowQueueEntry["source"],
          entryType: entryType as BackgroundWorkflowQueueEntry["entryType"],
          ownerAgent,
          channelKey,
          requesterSessionKey,
          messageChannel,
          preferredSessionKey,
          family,
          kind,
          projectId,
          projectRoot,
          queuedAt,
          lastAttemptedAt,
          attemptCount,
          summary,
          runPayload,
          dispatchPayload,
        } satisfies BackgroundWorkflowQueueEntry;
      })
      .filter((entry): entry is BackgroundWorkflowQueueEntry => Boolean(entry));
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

async function writeBackgroundRunRegistry(entries: BackgroundRunRegistryEntry[]): Promise<void> {
  const registryPath = getBackgroundRunRegistryPath();
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

async function writeBackgroundWorkflowQueue(
  entries: BackgroundWorkflowQueueEntry[]
): Promise<void> {
  const queuePath = getBackgroundQueuePath();
  await fs.mkdir(path.dirname(queuePath), { recursive: true });
  await fs.writeFile(queuePath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

async function pruneBackgroundWorkflowQueue(): Promise<BackgroundWorkflowQueueEntry[]> {
  const now = Date.now();
  const current = await readBackgroundWorkflowQueue();
  const kept = current.filter((entry) => {
    const freshnessReference = entry.lastAttemptedAt ?? entry.queuedAt;
    const freshnessMs = Date.parse(freshnessReference);
    return Number.isFinite(freshnessMs) && now - freshnessMs <= BACKGROUND_QUEUE_STALE_MS;
  });
  await writeBackgroundWorkflowQueue(kept);
  return kept;
}

async function upsertBackgroundWorkflowQueueEntry(
  entry: BackgroundWorkflowQueueEntry
): Promise<{
  entry: BackgroundWorkflowQueueEntry;
  queuePosition: number;
}> {
  const current = await pruneBackgroundWorkflowQueue();
  const existing = current.find((candidate) => candidate.queueKey === entry.queueKey) ?? null;
  if (existing) {
    return {
      entry: existing,
      queuePosition:
        current
          .sort((a, b) => Date.parse(a.queuedAt) - Date.parse(b.queuedAt))
          .findIndex((candidate) => candidate.queueKey === existing.queueKey) + 1,
    };
  }
  const next = [...current, entry];
  next.sort((a, b) => Date.parse(a.queuedAt) - Date.parse(b.queuedAt));
  await writeBackgroundWorkflowQueue(next);
  return {
    entry,
    queuePosition: next.findIndex((candidate) => candidate.queueKey === entry.queueKey) + 1,
  };
}

async function removeBackgroundWorkflowQueueEntries(queueKeys: string[]): Promise<void> {
  if (queueKeys.length === 0) {
    return;
  }
  const current = await pruneBackgroundWorkflowQueue();
  const blocked = new Set(queueKeys);
  const next = current.filter((entry) => !blocked.has(entry.queueKey));
  await writeBackgroundWorkflowQueue(next);
}

async function touchBackgroundWorkflowQueueEntry(params: {
  queueKey: string;
  error?: string | null;
}): Promise<void> {
  const current = await pruneBackgroundWorkflowQueue();
  const next = current.map((entry) =>
    entry.queueKey === params.queueKey
      ? {
          ...entry,
          lastAttemptedAt: new Date().toISOString(),
          attemptCount: entry.attemptCount + 1,
          summary: params.error ? params.error : entry.summary,
        }
      : entry
  );
  await writeBackgroundWorkflowQueue(next);
}

export async function hasPendingBackgroundWorkflowQueueKey(params: {
  queueKey?: string | null;
  projectId?: string | null;
  projectRoot?: string | null;
}): Promise<{
  queued: boolean;
  active: boolean;
}> {
  const queueKey = readString(params.queueKey);
  if (!queueKey) {
    return { queued: false, active: false };
  }
  const queueEntries = await pruneBackgroundWorkflowQueue();
  const queued = queueEntries.some(
    (entry) =>
      entry.queueKey === queueKey &&
      backgroundRunRegistryEntryMatchesProject(
        {
          ownerAgent: entry.ownerAgent,
          channelKey: entry.channelKey,
          requesterSessionKey: entry.requesterSessionKey,
          backgroundSessionKey: entry.preferredSessionKey ?? entry.requesterSessionKey,
          runId: entry.queueId,
          queueKey: entry.queueKey,
          kind: entry.kind,
          family: entry.family,
          status: "active",
          projectId: entry.projectId,
          projectRoot: entry.projectRoot,
          startedAt: entry.queuedAt,
          lastCheckedAt: entry.lastAttemptedAt,
          lastFinishedAt: null,
        },
        readString(params.projectId) ?? null,
        readString(params.projectRoot) ?? null
      )
  );
  const activeEntries = await pruneBackgroundRunRegistry({});
  const active = activeEntries.some(
    (entry) =>
      entry.status === "active" &&
      entry.queueKey === queueKey &&
      backgroundRunRegistryEntryMatchesProject(
        entry,
        readString(params.projectId) ?? null,
        readString(params.projectRoot) ?? null
      )
  );
  return { queued, active };
}

export async function getBackgroundWorkflowRunByQueueKey(params: {
  queueKey?: string | null;
  projectId?: string | null;
  projectRoot?: string | null;
  runtimeSubagent?: {
    waitForRun?: (params: { runId: string; timeoutMs?: number }) => Promise<{
      status: "ok" | "error" | "timeout";
      error?: string;
    }>;
  };
}): Promise<BackgroundRunRegistryEntry | null> {
  const queueKey = readString(params.queueKey);
  if (!queueKey) {
    return null;
  }
  const refreshed = await pruneBackgroundRunRegistry({
    runtimeSubagent: params.runtimeSubagent,
  });
  return (
    refreshed.find(
      (entry) =>
        entry.queueKey === queueKey &&
        backgroundRunRegistryEntryMatchesProject(
          entry,
          readString(params.projectId) ?? null,
          readString(params.projectRoot) ?? null
        )
    ) ?? null
  );
}

async function pruneBackgroundRunRegistry(params: {
  runtimeSubagent?: {
    waitForRun?: (params: { runId: string; timeoutMs?: number }) => Promise<{
      status: "ok" | "error" | "timeout";
      error?: string;
    }>;
  };
}): Promise<BackgroundRunRegistryEntry[]> {
  const now = Date.now();
  const current = await readBackgroundRunRegistry();
  const kept: BackgroundRunRegistryEntry[] = [];
  for (const entry of current) {
    const freshnessReference =
      entry.lastFinishedAt ?? entry.lastCheckedAt ?? entry.startedAt;
    const freshnessMs = Date.parse(freshnessReference);
    if (!Number.isFinite(freshnessMs) || now - freshnessMs > BACKGROUND_RUN_STALE_MS) {
      continue;
    }
    let nextEntry: BackgroundRunRegistryEntry = {
      ...entry,
      lastCheckedAt: new Date(now).toISOString(),
    };
    if (entry.status === "active" && params.runtimeSubagent?.waitForRun) {
      try {
        const waited = await params.runtimeSubagent.waitForRun({
          runId: entry.runId,
          timeoutMs: 1,
        });
        if (waited.status === "ok" || waited.status === "error") {
          nextEntry = {
            ...nextEntry,
            status: "idle",
            lastFinishedAt: new Date(now).toISOString(),
          };
        }
      } catch {
        continue;
      }
    }
    kept.push(nextEntry);
  }
  await writeBackgroundRunRegistry(kept);
  return kept;
}

function toBackgroundRunRegistryViewEntry(
  entry: BackgroundRunRegistryEntry,
  nowMs: number
): BackgroundRunRegistryViewEntry {
  const idleReference =
    entry.lastFinishedAt ?? entry.lastCheckedAt ?? entry.startedAt;
  const idleReferenceMs = Date.parse(idleReference);
  const idleForMs =
    entry.status === "idle" && Number.isFinite(idleReferenceMs)
      ? Math.max(0, nowMs - idleReferenceMs)
      : null;
  return {
    ...entry,
    deleteEligible: entry.status === "idle",
    idleForMs,
  };
}

function matchesBackgroundRunRegistryFilters(
  entry: BackgroundRunRegistryEntry,
  filters: {
    ownerAgent?: string | null;
    channelKey?: string | null;
    family?: string | null;
    projectId?: string | null;
    projectRoot?: string | null;
  }
): boolean {
  const ownerAgent = normalizeAgentId(filters.ownerAgent);
  if (ownerAgent && entry.ownerAgent !== ownerAgent) {
    return false;
  }
  const channelKey = readString(filters.channelKey) ?? null;
  if (channelKey && entry.channelKey !== channelKey) {
    return false;
  }
  const family = readString(filters.family) ?? null;
  if (family && entry.family !== family) {
    return false;
  }
  return backgroundRunRegistryEntryMatchesProject(
    entry,
    readString(filters.projectId) ?? null,
    readString(filters.projectRoot) ?? null
  );
}

export async function listBackgroundWorkflowRuns(params: {
  runtimeSubagent?: {
    waitForRun?: (params: { runId: string; timeoutMs?: number }) => Promise<{
      status: "ok" | "error" | "timeout";
      error?: string;
    }>;
  };
  ownerAgent?: string | null;
  channelKey?: string | null;
  family?: string | null;
  projectId?: string | null;
  projectRoot?: string | null;
}): Promise<{
  entries: BackgroundRunRegistryViewEntry[];
}> {
  const refreshed = await pruneBackgroundRunRegistry({
    runtimeSubagent: params.runtimeSubagent,
  });
  const nowMs = Date.now();
  return {
    entries: refreshed
      .filter((entry) => matchesBackgroundRunRegistryFilters(entry, params))
      .map((entry) => toBackgroundRunRegistryViewEntry(entry, nowMs)),
  };
}

export async function pruneBackgroundWorkflowRuns(params: {
  runtimeSubagent?: {
    waitForRun?: (params: { runId: string; timeoutMs?: number }) => Promise<{
      status: "ok" | "error" | "timeout";
      error?: string;
    }>;
    deleteSession?: (params: {
      sessionKey: string;
      deleteTranscript?: boolean;
    }) => Promise<void>;
  };
  ownerAgent?: string | null;
  channelKey?: string | null;
  family?: string | null;
  projectId?: string | null;
  projectRoot?: string | null;
  idleOlderThanMs?: number;
  deleteSessions?: boolean;
}): Promise<{
  kept: BackgroundRunRegistryViewEntry[];
  removed: BackgroundRunRegistryViewEntry[];
}> {
  const refreshed = await pruneBackgroundRunRegistry({
    runtimeSubagent: params.runtimeSubagent,
  });
  const nowMs = Date.now();
  const idleOlderThanMs =
    typeof params.idleOlderThanMs === "number" && Number.isFinite(params.idleOlderThanMs)
      ? Math.max(0, Math.floor(params.idleOlderThanMs))
      : BACKGROUND_RUN_STALE_MS;
  const kept: BackgroundRunRegistryEntry[] = [];
  const removed: BackgroundRunRegistryEntry[] = [];
  for (const entry of refreshed) {
    if (!matchesBackgroundRunRegistryFilters(entry, params)) {
      kept.push(entry);
      continue;
    }
    const idleReference =
      entry.lastFinishedAt ?? entry.lastCheckedAt ?? entry.startedAt;
    const idleReferenceMs = Date.parse(idleReference);
    const idleForMs =
      entry.status === "idle" && Number.isFinite(idleReferenceMs)
        ? Math.max(0, nowMs - idleReferenceMs)
        : 0;
    if (entry.status === "idle" && idleForMs >= idleOlderThanMs) {
      removed.push(entry);
      continue;
    }
    kept.push(entry);
  }
  await writeBackgroundRunRegistry(kept);
  if (params.deleteSessions === true && params.runtimeSubagent?.deleteSession) {
    for (const entry of removed) {
      await params.runtimeSubagent.deleteSession({
        sessionKey: entry.backgroundSessionKey,
        deleteTranscript: false,
      });
    }
  }
  return {
    kept: kept.map((entry) => toBackgroundRunRegistryViewEntry(entry, nowMs)),
    removed: removed.map((entry) => toBackgroundRunRegistryViewEntry(entry, nowMs)),
  };
}

async function upsertBackgroundRunRegistryEntry(
  entry: BackgroundRunRegistryEntry
): Promise<void> {
  const current = await readBackgroundRunRegistry();
  const next = current.filter(
    (existing) => existing.backgroundSessionKey !== entry.backgroundSessionKey
  );
  next.push(entry);
  await writeBackgroundRunRegistry(next);
}

export async function acquireBackgroundWorkflowSession(params: {
  runtimeSubagent?: {
    waitForRun?: (params: { runId: string; timeoutMs?: number }) => Promise<{
      status: "ok" | "error" | "timeout";
      error?: string;
    }>;
  };
  ownerAgent?: string | null;
  requesterSessionKey?: string | null;
  messageChannel?: string | null;
  preferredSessionKey?: string | null;
  family?: string | null;
  kind?: string | null;
  projectId?: string | null;
  projectRoot?: string | null;
}): Promise<BackgroundWorkflowSessionLease> {
  const ownerAgent = normalizeAgentId(params.ownerAgent);
  const family =
    readString(params.family) ??
    deriveBackgroundRunFamily(readString(params.kind)?.toLowerCase() ?? "generic");
  const projectId = readString(params.projectId) ?? null;
  const projectRoot = readString(params.projectRoot) ?? null;
  const channelKey = deriveBackgroundRunChannelKey({
    sessionKey: params.requesterSessionKey ?? undefined,
    messageChannel: params.messageChannel ?? undefined,
  });

  if (ownerAgent !== "researcher" || !channelKey) {
    return {
      acquired: true,
      reason: "acquired",
      sessionKey:
        readString(params.preferredSessionKey) ??
        readString(params.requesterSessionKey) ??
        null,
      reusedIdleSession: false,
      activeResearcherSessionsInChannel: null,
      channelKey,
      ownerAgent,
      family,
      projectId,
      projectRoot,
    };
  }

  const registryEntries = await pruneBackgroundRunRegistry({
    runtimeSubagent: params.runtimeSubagent,
  });
  const reusableBackgroundSessionKey =
    registryEntries.find(
      (entry) =>
        entry.ownerAgent === "researcher" &&
        entry.channelKey === channelKey &&
        entry.status === "idle" &&
        entry.family === family &&
        backgroundRunRegistryEntryMatchesProject(entry, projectId, projectRoot)
    )?.backgroundSessionKey ?? null;
  const activeChannelEntries = registryEntries.filter(
    (entry) =>
      entry.ownerAgent === "researcher" &&
      entry.channelKey === channelKey &&
      entry.status === "active" &&
      entry.backgroundSessionKey !== reusableBackgroundSessionKey
  );
  const activeResearcherSessionsInChannel = activeChannelEntries.length;
  if (
    !reusableBackgroundSessionKey &&
    activeChannelEntries.length >= MAX_RESEARCHER_BACKGROUND_SUBAGENTS_PER_CHANNEL
  ) {
    return {
      acquired: false,
      reason: "channel_capacity_reached",
      sessionKey: null,
      reusedIdleSession: false,
      activeResearcherSessionsInChannel,
      channelKey,
      ownerAgent,
      family,
      projectId,
      projectRoot,
    };
  }

  return {
    acquired: true,
    reason: "acquired",
    sessionKey:
      reusableBackgroundSessionKey ??
      readString(params.preferredSessionKey) ??
      readString(params.requesterSessionKey) ??
      null,
    reusedIdleSession: Boolean(reusableBackgroundSessionKey),
    activeResearcherSessionsInChannel,
    channelKey,
    ownerAgent,
    family,
    projectId,
    projectRoot,
  };
}

export async function recordBackgroundWorkflowRun(params: {
  ownerAgent?: string | null;
  channelKey?: string | null;
  requesterSessionKey?: string | null;
  backgroundSessionKey?: string | null;
  runId?: string | null;
  queueKey?: string | null;
  kind?: string | null;
  family?: string | null;
  projectId?: string | null;
  projectRoot?: string | null;
}): Promise<void> {
  const ownerAgent = normalizeAgentId(params.ownerAgent);
  const channelKey = readString(params.channelKey);
  const requesterSessionKey = readString(params.requesterSessionKey);
  const backgroundSessionKey = readString(params.backgroundSessionKey);
  const runId = readString(params.runId);
  if (
    ownerAgent !== "researcher" ||
    !channelKey ||
    !requesterSessionKey ||
    !backgroundSessionKey ||
    !runId
  ) {
    return;
  }
  await upsertBackgroundRunRegistryEntry({
    ownerAgent,
    channelKey,
    requesterSessionKey,
    backgroundSessionKey,
    runId,
    queueKey: readString(params.queueKey) ?? null,
    kind: readString(params.kind) ?? "generic",
    family:
      readString(params.family) ??
      deriveBackgroundRunFamily(readString(params.kind)?.toLowerCase() ?? "generic"),
    status: "active",
    projectId: readString(params.projectId) ?? null,
    projectRoot: readString(params.projectRoot) ?? null,
    startedAt: new Date().toISOString(),
    lastCheckedAt: null,
    lastFinishedAt: null,
  });
}

function buildBackgroundRunQueueKey(params: {
  requesterSessionKey?: string | null;
  kind?: string | null;
  family?: string | null;
  projectId?: string | null;
  projectRoot?: string | null;
  topic?: string | null;
  commandText?: string | null;
}): string {
  return [
    "background-run",
    readString(params.requesterSessionKey) ?? "unknown-requester",
    readString(params.family) ??
      deriveBackgroundRunFamily(readString(params.kind)?.toLowerCase() ?? "generic"),
    readString(params.kind) ?? "generic",
    readString(params.projectId) ?? readString(params.projectRoot) ?? "unknown-project",
    readString(params.topic) ?? readString(params.commandText) ?? "generic-task",
  ].join(":");
}

export async function enqueueQueuedBackgroundWorkflowRun(params: {
  source: BackgroundWorkflowQueueEntry["source"];
  ownerAgent?: string | null;
  requesterSessionKey?: string | null;
  messageChannel?: string | null;
  preferredSessionKey?: string | null;
  family?: string | null;
  kind?: string | null;
  projectId?: string | null;
  projectRoot?: string | null;
  queueKey?: string | null;
  summary?: string | null;
  runPayload?: BackgroundWorkflowQueueRunPayload | null;
  dispatchPayload?: BackgroundWorkflowQueueDispatchPayload | null;
}): Promise<{
  entry: BackgroundWorkflowQueueEntry;
  queuePosition: number;
}> {
  const ownerAgent = normalizeAgentId(params.ownerAgent) ?? "researcher";
  const requesterSessionKey =
    readString(params.requesterSessionKey) ?? "agent:researcher:main";
  const messageChannel = readString(params.messageChannel) ?? null;
  const channelKey = deriveBackgroundRunChannelKey({
    sessionKey: requesterSessionKey,
    messageChannel: messageChannel ?? undefined,
  });
  if (!channelKey) {
    throw new Error("Cannot queue a background workflow run without a channel key.");
  }
  const family =
    readString(params.family) ??
    deriveBackgroundRunFamily(readString(params.kind)?.toLowerCase() ?? "generic");
  const kind = readString(params.kind) ?? "generic";
  const queueKey =
    readString(params.queueKey) ??
    buildBackgroundRunQueueKey({
      requesterSessionKey,
      family,
      kind,
      projectId: params.projectId,
      projectRoot: params.projectRoot,
      topic: params.summary,
    });
  const entry: BackgroundWorkflowQueueEntry = {
    queueId: randomUUID(),
    queueKey,
    source: params.source,
    entryType: params.dispatchPayload ? "dispatch_task" : "background_run",
    ownerAgent,
    channelKey,
    requesterSessionKey,
    messageChannel,
    preferredSessionKey: readString(params.preferredSessionKey) ?? null,
    family,
    kind,
    projectId: readString(params.projectId) ?? null,
    projectRoot: readString(params.projectRoot) ?? null,
    queuedAt: new Date().toISOString(),
    lastAttemptedAt: null,
    attemptCount: 0,
    summary: readString(params.summary) ?? null,
    runPayload: params.runPayload ?? null,
    dispatchPayload: params.dispatchPayload ?? null,
  };
  return upsertBackgroundWorkflowQueueEntry(entry);
}

export async function drainQueuedBackgroundWorkflowRuns(params: {
  runtimeSubagent?: {
    run: (params: {
      sessionKey: string;
      message: string;
      lane?: string;
      deliver?: boolean;
      idempotencyKey?: string;
      extraSystemPrompt?: string;
    }) => Promise<{ runId: string }>;
    waitForRun?: (params: { runId: string; timeoutMs?: number }) => Promise<{
      status: "ok" | "error" | "timeout";
      error?: string;
    }>;
    getSessionMessages?: (params: {
      sessionKey: string;
      limit?: number;
    }) => Promise<{ messages: unknown[] }>;
  };
  workflowPolicy?: {
    lobsterHandoff?: WorkflowLobsterHandoffConfig;
  } | null;
  handoffWorkflowTaskToAgent?: typeof handoffWorkflowTaskToAgent;
}): Promise<QueuedBackgroundWorkflowDrainResult> {
  const runtimeSubagent = params.runtimeSubagent;
  if (!runtimeSubagent) {
    return {
      started: [],
      remaining: await pruneBackgroundWorkflowQueue(),
    };
  }

  const queue = await pruneBackgroundWorkflowQueue();
  const started: BackgroundRunStartResult[] = [];
  const processedQueueKeys = new Set<string>();

  for (const entry of queue) {
    const lastAttemptedAtMs = entry.lastAttemptedAt
      ? Date.parse(entry.lastAttemptedAt)
      : null;
    if (
      lastAttemptedAtMs &&
      Number.isFinite(lastAttemptedAtMs) &&
      Date.now() - lastAttemptedAtMs < BACKGROUND_QUEUE_RETRY_BACKOFF_MS
    ) {
      continue;
    }

    const sessionLease = await acquireBackgroundWorkflowSession({
      runtimeSubagent,
      ownerAgent: entry.ownerAgent,
      requesterSessionKey: entry.requesterSessionKey,
      messageChannel: entry.messageChannel,
      preferredSessionKey: entry.preferredSessionKey,
      family: entry.family,
      kind: entry.kind,
      projectId: entry.projectId,
      projectRoot: entry.projectRoot,
    });
    if (!sessionLease.acquired || !sessionLease.sessionKey) {
      continue;
    }

    try {
      if (entry.entryType === "dispatch_task" && entry.dispatchPayload) {
        const preferredSessionKeys = [
          sessionLease.sessionKey,
          ...entry.dispatchPayload.preferredSessionKeys.filter(
            (candidate) => candidate !== sessionLease.sessionKey
          ),
        ];
        const dispatch = entry.dispatchPayload.useWorkflowHandoff
          ? await (params.handoffWorkflowTaskToAgent ?? handoffWorkflowTaskToAgent)({
              runtimeSubagent,
              workflowPolicy: params.workflowPolicy ?? undefined,
              requesterSessionKey: entry.requesterSessionKey,
              requesterChannel: entry.dispatchPayload.requesterChannel ?? undefined,
              requesterAccountId:
                entry.dispatchPayload.requesterAccountId ?? undefined,
              preferredSessionKeys,
              fromRole: entry.dispatchPayload.fromRole,
              toRole: entry.dispatchPayload.toRole,
              projectRoot: entry.dispatchPayload.projectRoot,
              projectId: entry.dispatchPayload.projectId,
              stage: entry.dispatchPayload.stage,
              summary: entry.dispatchPayload.summary,
              command: entry.dispatchPayload.command,
              mailboxMessageId: entry.dispatchPayload.mailboxMessageId,
              extraBody: entry.dispatchPayload.extraBody,
              waitTimeoutMs: entry.dispatchPayload.waitTimeoutMs ?? undefined,
              retryOnTimeout: entry.dispatchPayload.retryOnTimeout,
              enableSpawnFallback: entry.dispatchPayload.enableSpawnFallback,
              autoModeActive: entry.dispatchPayload.autoModeActive,
            })
          : await dispatchWorkflowTaskToAgent({
              runtimeSubagent,
              requesterSessionKey: entry.requesterSessionKey,
              requesterChannel: entry.dispatchPayload.requesterChannel ?? undefined,
              preferredSessionKeys,
              fromRole: entry.dispatchPayload.fromRole,
              toRole: entry.dispatchPayload.toRole,
              projectRoot: entry.dispatchPayload.projectRoot,
              projectId: entry.dispatchPayload.projectId,
              stage: entry.dispatchPayload.stage,
              summary: entry.dispatchPayload.summary,
              command: entry.dispatchPayload.command,
              mailboxMessageId: entry.dispatchPayload.mailboxMessageId,
              extraBody: entry.dispatchPayload.extraBody,
              waitTimeoutMs: entry.dispatchPayload.waitTimeoutMs ?? undefined,
              retryOnTimeout: entry.dispatchPayload.retryOnTimeout,
              enableSpawnFallback: entry.dispatchPayload.enableSpawnFallback,
            });
        if (!dispatch.dispatched || !dispatch.runId || !dispatch.sessionKey) {
          await touchBackgroundWorkflowQueueEntry({
            queueKey: entry.queueKey,
            error: dispatch.error ?? "Queued workflow dispatch did not start.",
          });
          continue;
        }
        await recordBackgroundWorkflowRun({
          ownerAgent: entry.ownerAgent,
          channelKey: entry.channelKey,
          requesterSessionKey: entry.requesterSessionKey,
          backgroundSessionKey: dispatch.sessionKey,
          runId: dispatch.runId,
          queueKey: entry.queueKey,
          kind: entry.kind,
          family: entry.family,
          projectId: entry.projectId,
          projectRoot: entry.projectRoot,
        });
        processedQueueKeys.add(entry.queueKey);
        started.push({
          started: true,
          reason: "started",
          runId: dispatch.runId,
          sessionKey: dispatch.sessionKey,
          projectRoot: entry.projectRoot,
          projectId: entry.projectId,
          summary:
            entry.summary ??
            `Queued workflow dispatch resumed for ${entry.projectId ?? "the current project"}.`,
          reusedIdleSession: sessionLease.reusedIdleSession,
          activeResearcherSessionsInChannel:
            sessionLease.activeResearcherSessionsInChannel,
          queued: false,
          queueKey: entry.queueKey,
        });
        continue;
      }

      if (entry.runPayload) {
        const startedRun = await runtimeSubagent.run({
          sessionKey: sessionLease.sessionKey,
          message: entry.runPayload.message,
          lane: entry.runPayload.lane,
          deliver: entry.runPayload.deliver,
          idempotencyKey: entry.runPayload.idempotencyKey ?? undefined,
          extraSystemPrompt: entry.runPayload.extraSystemPrompt ?? undefined,
        });
        await recordBackgroundWorkflowRun({
          ownerAgent: entry.ownerAgent,
          channelKey: entry.channelKey,
          requesterSessionKey: entry.requesterSessionKey,
          backgroundSessionKey: sessionLease.sessionKey,
          runId: startedRun.runId,
          queueKey: entry.queueKey,
          kind: entry.kind,
          family: entry.family,
          projectId: entry.projectId,
          projectRoot: entry.projectRoot,
        });
        processedQueueKeys.add(entry.queueKey);
        started.push({
          started: true,
          reason: "started",
          runId: startedRun.runId,
          sessionKey: sessionLease.sessionKey,
          projectRoot: entry.projectRoot,
          projectId: entry.projectId,
          summary:
            entry.summary ??
            `Queued background workflow resumed for ${entry.projectId ?? "the current project"}.`,
          reusedIdleSession: sessionLease.reusedIdleSession,
          activeResearcherSessionsInChannel:
            sessionLease.activeResearcherSessionsInChannel,
          queued: false,
          queueKey: entry.queueKey,
        });
      }
    } catch (error) {
      await touchBackgroundWorkflowQueueEntry({
        queueKey: entry.queueKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await removeBackgroundWorkflowQueueEntries(Array.from(processedQueueKeys));
  return {
    started,
    remaining: await pruneBackgroundWorkflowQueue(),
  };
}

export function hasBackgroundContinuationMarker(
  text: string | null | undefined
): boolean {
  if (!text) {
    return false;
  }
  return (
    /BACKGROUND_WORKFLOW_CONTINUATION=1/i.test(text) ||
    /__BACKGROUND_CONTINUATION__\s*:\s*true/i.test(text)
  );
}

export function buildResearchPipelineBackgroundCommand(commandText: string): string {
  const trimmed = commandText.trim();
  if (!trimmed) {
    return '/research-pipeline "topic" -- __BACKGROUND_CONTINUATION__: true';
  }
  if (hasBackgroundContinuationMarker(trimmed)) {
    return trimmed;
  }
  return `${trimmed} -- __BACKGROUND_CONTINUATION__: true`;
}

export function buildResearchQueueBackgroundCommand(commandText: string): string {
  const trimmed = commandText.trim();
  if (!trimmed) {
    return '/research-queue "status" -- __BACKGROUND_CONTINUATION__: true';
  }
  if (hasBackgroundContinuationMarker(trimmed)) {
    return trimmed;
  }
  return `${trimmed} -- __BACKGROUND_CONTINUATION__: true`;
}

export function buildResumePipelineBackgroundCommand(commandText: string): string {
  const trimmed = commandText.trim();
  if (!trimmed) {
    return "/resume-pipeline -- __BACKGROUND_CONTINUATION__: true";
  }
  if (hasBackgroundContinuationMarker(trimmed)) {
    return trimmed;
  }
  return `${trimmed} -- __BACKGROUND_CONTINUATION__: true`;
}

export function buildPapernexusSkillBackgroundCommand(commandText: string): string {
  const trimmed = commandText.trim();
  if (!trimmed) {
    return "/graph-build -- __BACKGROUND_CONTINUATION__: true";
  }
  if (hasBackgroundContinuationMarker(trimmed)) {
    return trimmed;
  }
  return `${trimmed} -- __BACKGROUND_CONTINUATION__: true`;
}

export async function startBackgroundWorkflowRun(params: {
  runtimeSubagent?: {
    run: (params: {
      sessionKey: string;
      message: string;
      lane?: string;
      deliver?: boolean;
      idempotencyKey?: string;
      extraSystemPrompt?: string;
    }) => Promise<{ runId: string }>;
    waitForRun?: (params: { runId: string; timeoutMs?: number }) => Promise<{
      status: "ok" | "error" | "timeout";
      error?: string;
    }>;
    deleteSession?: (params: {
      sessionKey: string;
      deleteTranscript?: boolean;
    }) => Promise<void>;
  };
  workflowPolicy: WorkflowGuardPolicy;
  agentCtx: BackgroundRunAgentContext;
  snapshot: BackgroundRunSnapshot;
  backgroundRun: BackgroundRunRequest;
}): Promise<BackgroundRunStartResult> {
  if (!params.runtimeSubagent) {
    throw new Error(
      "Background workflow execution requires gateway runtime.subagent access."
    );
  }
  if (!params.agentCtx.sessionKey) {
    throw new Error(
      "Background workflow execution requires a resolved sessionKey for this channel."
    );
  }

  const normalizedKind = readString(params.backgroundRun.kind)?.toLowerCase() ?? "generic";
  const normalizedFamily = deriveBackgroundRunFamily(normalizedKind);
  const requestedCommandText = readString(params.backgroundRun.commandText);
  const topic =
    readString(params.backgroundRun.topic) ?? readString(params.backgroundRun.title);
  const shouldEnsureProjectBinding =
    params.backgroundRun.ensureProjectBinding === false ? false : true;

  let ensuredProject:
    | Awaited<ReturnType<typeof ensureWorkflowProjectRoot>>
    | null = null;
  if (shouldEnsureProjectBinding) {
    ensuredProject = await ensureWorkflowProjectRoot({
      policy: params.workflowPolicy,
      workspaceDir: params.agentCtx.workspaceDir,
      sessionKey: params.agentCtx.sessionKey,
      sessionId: params.agentCtx.sessionId,
      messageChannel: params.agentCtx.messageChannel,
      projectRoot: readString(params.backgroundRun.projectRoot) ?? params.snapshot.projectRoot,
      projectId: readString(params.backgroundRun.projectId) ?? params.snapshot.projectId,
      title: readString(params.backgroundRun.title),
      topic,
    });
    if (
      params.snapshot.channelProjectBindingsEnabled &&
      (params.agentCtx.sessionKey || params.agentCtx.sessionId)
    ) {
      await bindChannelProjectForWorkflow({
        policy: params.workflowPolicy,
        workspaceDir: params.agentCtx.workspaceDir,
        sessionKey: params.agentCtx.sessionKey,
        sessionId: params.agentCtx.sessionId,
        messageChannel: params.agentCtx.messageChannel,
        projectRoot: ensuredProject.projectRoot,
        projectId: ensuredProject.projectId,
        title: ensuredProject.title,
        topic,
        boundByAgent: params.agentCtx.agentId ?? params.snapshot.role,
        notes: "Auto-bound during slash fast-path workflow startup.",
      });
    }
  }

  const commandText =
    requestedCommandText ??
    (normalizedKind === "research_pipeline"
      ? buildResearchPipelineBackgroundCommand(
          `/research-pipeline "${topic ?? ensuredProject?.title ?? "research topic"}"`
        )
      : normalizedKind === "research_queue"
        ? buildResearchQueueBackgroundCommand(
            `/research-queue "${topic ?? ensuredProject?.title ?? "status"}"`
          )
      : normalizedKind === "papernexus_skill"
        ? buildPapernexusSkillBackgroundCommand("/graph-build")
      : normalizedKind === "idle_research"
        ? requestedCommandText ?? null
      : null);
  if (!commandText) {
    throw new Error(
      "backgroundRun.commandText is required unless kind=research_pipeline."
    );
  }

  const ownerAgent =
    normalizeAgentId(params.agentCtx.agentId) ?? normalizeAgentId(params.snapshot.role);
  const channelKey = deriveBackgroundRunChannelKey({
    sessionKey: params.agentCtx.sessionKey,
    messageChannel: params.agentCtx.messageChannel,
  });
  const resolvedProjectId =
    ensuredProject?.projectId ??
    readString(params.backgroundRun.projectId) ??
    params.snapshot.projectId ??
    null;
  const resolvedProjectRoot =
    ensuredProject?.projectRoot ??
    readString(params.backgroundRun.projectRoot) ??
    params.snapshot.projectRoot ??
    null;
  const queueKey = buildBackgroundRunQueueKey({
    requesterSessionKey: params.agentCtx.sessionKey,
    family: normalizedFamily,
    kind: normalizedKind,
    projectId: resolvedProjectId,
    projectRoot: resolvedProjectRoot,
    topic,
    commandText,
  });
  let reusableBackgroundSessionKey: string | null = null;
  let activeResearcherSessionsInChannel: number | null = null;

  const preferredBackgroundSessionKey =
    buildWorkflowSubagentSessionKey({
      parentSessionKey: params.agentCtx.sessionKey,
      purpose:
        normalizedKind === "papernexus_skill" && looksLikePapernexusHeavyCommand(commandText)
          ? "papernexus-skill"
          : `workflow-${normalizedKind}`,
      segments:
        normalizedKind === "papernexus_skill" && looksLikePapernexusHeavyCommand(commandText)
          ? [derivePapernexusTaskLabel(commandText), resolvedProjectId]
          : [resolvedProjectId, topic],
    }) ?? params.agentCtx.sessionKey;

  const sessionLease = await acquireBackgroundWorkflowSession({
    runtimeSubagent: params.runtimeSubagent,
    ownerAgent,
    requesterSessionKey: params.agentCtx.sessionKey,
    messageChannel: params.agentCtx.messageChannel,
    preferredSessionKey: preferredBackgroundSessionKey,
    family: normalizedFamily,
    kind: normalizedKind,
    projectId: resolvedProjectId,
    projectRoot: resolvedProjectRoot,
  });
  reusableBackgroundSessionKey = sessionLease.reusedIdleSession
    ? sessionLease.sessionKey
    : null;
  activeResearcherSessionsInChannel =
    sessionLease.activeResearcherSessionsInChannel;
  if (!sessionLease.acquired || !sessionLease.sessionKey) {
    const queued = await enqueueQueuedBackgroundWorkflowRun({
      source: "start_background_run",
      ownerAgent,
      requesterSessionKey: params.agentCtx.sessionKey,
      messageChannel: params.agentCtx.messageChannel,
      preferredSessionKey: preferredBackgroundSessionKey,
      family: normalizedFamily,
      kind: normalizedKind,
      projectId: resolvedProjectId,
      projectRoot: resolvedProjectRoot,
      queueKey,
      summary:
        readString(params.backgroundRun.summary) ??
        `Queued background workflow for ${topic ?? ensuredProject?.title ?? resolvedProjectId ?? "the current project"}.`,
      runPayload: {
        message: commandText,
        lane: "nested",
        deliver: false,
        idempotencyKey: `openclaw-research:bg:${preferredBackgroundSessionKey}:${queueKey}`,
        extraSystemPrompt:
          "BACKGROUND_WORKFLOW_CONTINUATION=1\n" +
          "This queued run was launched from a slash-command fast path into a dedicated workflow subagent session.\n" +
          "Continue the requested workflow in the background, keep durable state current, and do not assume the foreground session is available.\n" +
          "Use research_workflow mailbox for bounded handoffs, and do not call research_workflow start_background_run again from this continuation.",
      },
    });
    return {
      started: false,
      reason: "channel_capacity_reached",
      runId: null,
      sessionKey: null,
      projectRoot:
        ensuredProject?.projectRoot ?? params.snapshot.projectRoot ?? null,
      projectId: ensuredProject?.projectId ?? params.snapshot.projectId ?? null,
      summary:
        `Queued background workflow because this channel already has ` +
        `${MAX_RESEARCHER_BACKGROUND_SUBAGENTS_PER_CHANNEL} active Researcher background subagents. ` +
        `It will auto-start when a pooled session becomes idle${queued.queuePosition > 0 ? ` (queue position ${queued.queuePosition})` : ""}.`,
      reusedIdleSession: false,
      activeResearcherSessionsInChannel,
      queued: true,
      queueKey: queued.entry.queueKey,
    };
  }
  const backgroundSessionKey = sessionLease.sessionKey;

  const runId = (
    await params.runtimeSubagent.run({
      sessionKey: backgroundSessionKey,
      message: commandText,
      lane: "nested",
      deliver: false,
      idempotencyKey: `openclaw-research:bg:${backgroundSessionKey}:${Date.now()}`,
      extraSystemPrompt:
        "BACKGROUND_WORKFLOW_CONTINUATION=1\n" +
        "This run was launched from a slash-command fast path into a dedicated workflow subagent session.\n" +
        "Continue the requested workflow in the background, keep durable state current, and do not assume the foreground session is available.\n" +
        "Use research_workflow mailbox for bounded handoffs, and do not call research_workflow start_background_run again from this continuation.",
    })
  ).runId;

  if (ownerAgent === "researcher" && channelKey) {
    await recordBackgroundWorkflowRun({
      ownerAgent,
      channelKey,
      requesterSessionKey: params.agentCtx.sessionKey,
      backgroundSessionKey,
      runId,
      queueKey,
      kind: normalizedKind,
      family: normalizedFamily,
      projectId: resolvedProjectId,
      projectRoot: resolvedProjectRoot,
    });
  }

  return {
    started: true,
    reason: "started",
    runId,
    sessionKey: backgroundSessionKey,
    projectRoot:
      ensuredProject?.projectRoot ?? params.snapshot.projectRoot ?? null,
    projectId: ensuredProject?.projectId ?? params.snapshot.projectId ?? null,
    summary:
      readString(params.backgroundRun.summary) ??
      (normalizedKind === "research_pipeline"
        ? `${reusableBackgroundSessionKey ? "Reused an idle Researcher subagent and started" : "Background research pipeline started for"} ${topic ?? ensuredProject?.title ?? "research topic"}.`
        : normalizedKind === "resume_pipeline"
          ? `${reusableBackgroundSessionKey ? "Reused an idle Researcher subagent and started" : "Background resume pipeline started for"} ${readString(params.backgroundRun.projectId) ?? params.snapshot.projectId ?? "the current project"}.`
        : normalizedKind === "idle_research"
          ? `${reusableBackgroundSessionKey ? "Reused an idle Researcher subagent and started" : "Idle research started for"} ${topic ?? ensuredProject?.title ?? readString(params.backgroundRun.projectId) ?? "the current project"}.`
        : normalizedKind === "papernexus_skill"
          ? `${reusableBackgroundSessionKey ? "Reused an idle dedicated PaperNexus subagent and started" : "PaperNexus-heavy workflow task started in a dedicated subagent for"} ${readString(params.backgroundRun.projectId) ?? ensuredProject?.projectId ?? "the current project"}.`
        : "Background workflow run started."),
    reusedIdleSession: Boolean(reusableBackgroundSessionKey),
    activeResearcherSessionsInChannel,
    queued: false,
    queueKey,
  };
}
