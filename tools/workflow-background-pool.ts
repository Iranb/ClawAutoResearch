import fs from "node:fs/promises";
import path from "node:path";
import { normalizeWorkflowSubagentParentSessionKey } from "./workflow-subagent-sessions";
import { normalizeWorkflowBindingChannelKey } from "./workflow-commands/parsers.js";
import {
  inferBackgroundRunTerminalStateFromDurableState,
  isWorkflowRuntimeTrackingMissError,
  reconcileBackgroundRunTerminalState,
} from "./workflow-background-run-reconcile.js";
import { isProviderCapacityFailure } from "./provider-capacity.js";
import { inspectRecentSessionProviderCapacity } from "./workflow-session-provider-capacity.js";
import {
  appendWorkflowRuntimeEvent,
  listWorkflowRuntimeProjectRoots,
  migrateWorkflowRuntimeState,
  readWorkflowRuntimeSessionsStore,
  updateWorkflowRuntimeSessionsStore,
  writeWorkflowRuntimeSessionsStore,
} from "./workflow-runtime-state.js";
import {
  withAdvisoryLock,
  writeJsonAtomicEnsured,
} from "./workflow-guard-core/fs";
import type { WorkflowExecutionRuntimeLike } from "./workflow-execution-runtime.js";
import type {
  WorkflowRuntimeSessionEntry as PersistedWorkflowRuntimeSessionEntry,
} from "./workflow-runtime-state.js";

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseTimestampMs(value: string | null | undefined): number | null {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAgentId(value: unknown): string | null {
  return readString(value)?.toLowerCase() ?? null;
}

const MAX_POOLED_BACKGROUND_SUBAGENTS_PER_PROJECT_SCOPE = 2;
const BACKGROUND_RUN_STALE_MS = 60 * 60 * 1000;
const BACKGROUND_RUN_DURABLE_RECONCILE_GRACE_MS = 15 * 1000;
const BACKGROUND_RUN_REGISTRY_FILENAME = "openclaw-research-background-runs.json";

export type BackgroundRuntimeScope = {
  projectId?: string | null;
  projectRoot?: string | null;
  projectsRoot?: string | null;
};

export type BackgroundRunRegistryEntry = {
  ownerAgent: string;
  channelKey: string;
  requesterSessionKey: string;
  backgroundSessionKey: string;
  runId: string;
  queueKey: string | null;
  kind: string;
  family: string;
  status: "active" | "idle" | "needs_repair";
  projectId: string | null;
  projectRoot: string | null;
  startedAt: string;
  lastCheckedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
};

export type BackgroundRunRegistryViewEntry = BackgroundRunRegistryEntry & {
  deleteEligible: boolean;
  idleForMs: number | null;
};

export type BackgroundWorkflowSessionLease = {
  acquired: boolean;
  reason: "acquired" | "channel_capacity_reached";
  sessionKey: string | null;
  reusedIdleSession: boolean;
  activeOwnerSessionsInChannel: number | null;
  activeResearcherSessionsInChannel: number | null;
  channelKey: string | null;
  ownerAgent: string | null;
  family: string;
  projectId: string | null;
  projectRoot: string | null;
};

type WorkflowRuntimeWaitApi = WorkflowExecutionRuntimeLike;

function isWorkflowRuntimeTrackingMiss(value: {
  status?: string;
  error?: string | null;
  message?: string | null;
} | null | undefined): boolean {
  return isWorkflowRuntimeTrackingMissError(value);
}

function deriveBackgroundRunFamily(kind: string): string {
  switch (kind) {
    case "research_pipeline":
    case "research_queue":
    case "resume_pipeline":
    case "graph_build":
    case "literature_review":
    case "idle_research":
      return "research";
    case "papernexus_skill":
    case "papernexus_wrapper":
      return "papernexus";
    default:
      return kind || "generic";
  }
}

function normalizeBackgroundRunKind(value: unknown): string {
  return readString(value)?.toLowerCase() ?? "generic";
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

function backgroundRunRegistryEntryMatchesLease(
  entry: BackgroundRunRegistryEntry,
  params: {
    ownerAgent: string;
    channelKey: string;
    family: string;
    kind: string;
    projectId: string | null;
    projectRoot: string | null;
  }
): boolean {
  return (
    entry.ownerAgent === params.ownerAgent &&
    entry.channelKey === params.channelKey &&
    entry.family === params.family &&
    normalizeBackgroundRunKind(entry.kind) === params.kind &&
    backgroundRunRegistryEntryMatchesProject(
      entry,
      params.projectId,
      params.projectRoot
    )
  );
}

function sanitizeBackgroundSessionSegment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "generic"
  );
}

function resolveNonCollidingBackgroundSessionKey(params: {
  registryEntries: BackgroundRunRegistryEntry[];
  preferredSessionKey: string | null;
  requesterSessionKey: string | null;
  ownerAgent: string;
  channelKey: string;
  family: string;
  kind: string;
  projectId: string | null;
  projectRoot: string | null;
}): string | null {
  const candidate =
    readString(params.preferredSessionKey) ??
    readString(params.requesterSessionKey) ??
    null;
  if (!candidate) {
    return null;
  }
  const collidingEntries = params.registryEntries.filter(
    (entry) => entry.backgroundSessionKey === candidate
  );
  if (
    collidingEntries.length === 0 ||
    collidingEntries.every((entry) =>
      backgroundRunRegistryEntryMatchesLease(entry, {
        ownerAgent: params.ownerAgent,
        channelKey: params.channelKey,
        family: params.family,
        kind: params.kind,
        projectId: params.projectId,
        projectRoot: params.projectRoot,
      })
    )
  ) {
    return candidate;
  }

  const base = `${candidate}:workflow-${sanitizeBackgroundSessionSegment(params.kind)}`;
  const used = new Set(
    params.registryEntries.map((entry) => entry.backgroundSessionKey)
  );
  if (!used.has(base)) {
    return base;
  }
  for (let index = 2; index < 100; index += 1) {
    const next = `${base}-${index}`;
    if (!used.has(next)) {
      return next;
    }
  }
  return `${base}-${Date.now()}`;
}

function getBackgroundRunRegistryPath(): string {
  const override = readString(
    process.env.OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH
  );
  if (override) {
    return path.resolve(override);
  }
  throw new Error(
    "A project-scoped background run registry path is required; refusing ephemeral /tmp fallback. Pass projectRoot/projectsRoot or set OPENCLAW_RESEARCH_BACKGROUND_RUN_REGISTRY_PATH for tests."
  );
}

function getBackgroundRunRegistryLockPath(): string {
  return `${getBackgroundRunRegistryPath()}.lock`;
}

function resolveBackgroundRuntimeScope(
  scope: BackgroundRuntimeScope | undefined
): Required<BackgroundRuntimeScope> {
  const projectRoot = readString(scope?.projectRoot)
    ? path.resolve(String(scope?.projectRoot))
    : null;
  const projectsRoot = readString(scope?.projectsRoot)
    ? path.resolve(String(scope?.projectsRoot))
    : null;
  return {
    projectId: readString(scope?.projectId) ?? null,
    projectRoot,
    projectsRoot,
  };
}

function shouldUseProjectRuntimeState(scope: BackgroundRuntimeScope | undefined): boolean {
  const resolved = resolveBackgroundRuntimeScope(scope);
  return Boolean(resolved.projectRoot || resolved.projectsRoot);
}

async function appendBackgroundWorkflowRuntimeEvent(params: {
  projectRoot?: string | null;
  projectId?: string | null;
  kind: string;
  summary: string;
  details?: Record<string, unknown> | null;
}): Promise<void> {
  const projectRoot = readString(params.projectRoot);
  if (!projectRoot) {
    return;
  }
  await appendWorkflowRuntimeEvent({
    projectRoot,
    projectId: readString(params.projectId) ?? null,
    kind: params.kind,
    summary: params.summary,
    details: params.details ?? null,
  });
}

function toPersistedSessionEntry(
  entry: BackgroundRunRegistryEntry
): PersistedWorkflowRuntimeSessionEntry {
  return {
    sessionKey: entry.backgroundSessionKey,
    sessionId: null,
    runtime: "subagent",
    role: entry.ownerAgent,
    agentId: entry.ownerAgent,
    ownerAgent: entry.ownerAgent,
    family: entry.family,
    kind: entry.kind,
    channelKey: entry.channelKey,
    requesterSessionKey: entry.requesterSessionKey,
    projectId: entry.projectId,
    projectRoot: entry.projectRoot,
    parentSessionKey: entry.requesterSessionKey,
    threadBindingKey: null,
    depth: 0,
    status: entry.status,
    runId: entry.runId,
    queueKey: entry.queueKey,
    startedAt: entry.startedAt,
    lastHeartbeatAt: entry.lastCheckedAt,
    lastAnnounceAt: null,
    lastCheckedAt: entry.lastCheckedAt,
    lastFinishedAt: entry.lastFinishedAt,
    lastError: readString(entry.lastError) ?? null,
  };
}

function fromPersistedSessionEntry(
  entry: PersistedWorkflowRuntimeSessionEntry
): BackgroundRunRegistryEntry | null {
  const ownerAgent = normalizeAgentId(entry.ownerAgent ?? entry.agentId);
  const channelKey = readString(entry.channelKey);
  const requesterSessionKey =
    readString(entry.requesterSessionKey) ??
    readString(entry.parentSessionKey) ??
    null;
  const backgroundSessionKey = readString(entry.sessionKey);
  const runId = readString(entry.runId);
  const startedAt = readString(entry.startedAt);
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
    queueKey: readString(entry.queueKey) ?? null,
    kind: readString(entry.kind) ?? "generic",
    family: readString(entry.family) ?? "generic",
    status:
      entry.status === "active"
        ? "active"
        : entry.status === "needs_repair"
          ? "needs_repair"
          : "idle",
    projectId: readString(entry.projectId) ?? null,
    projectRoot: readString(entry.projectRoot) ?? null,
    startedAt,
    lastCheckedAt: readString(entry.lastCheckedAt ?? entry.lastHeartbeatAt) ?? null,
    lastFinishedAt: readString(entry.lastFinishedAt) ?? null,
    lastError: readString(entry.lastError) ?? null,
  };
}

async function listProjectScopedRuntimeProjectRoots(
  scope: BackgroundRuntimeScope | undefined
): Promise<string[]> {
  const resolved = resolveBackgroundRuntimeScope(scope);
  return listWorkflowRuntimeProjectRoots({
    projectRoot: resolved.projectRoot,
    projectsRoot: resolved.projectsRoot,
  });
}

export async function clearBackgroundWorkflowRunRegistryForTests(): Promise<void> {
  await fs.rm(getBackgroundRunRegistryPath(), { force: true });
}

export function deriveBackgroundRunChannelKey(params: {
  channelKey?: string;
  sessionKey?: string;
  messageChannel?: string;
}): string | null {
  const explicit = normalizeWorkflowBindingChannelKey(readString(params.channelKey) ?? null);
  if (explicit) {
    return explicit;
  }
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

async function readBackgroundRunRegistry(
  scope?: BackgroundRuntimeScope
): Promise<BackgroundRunRegistryEntry[]> {
  if (shouldUseProjectRuntimeState(scope)) {
    const projectRoots = await listProjectScopedRuntimeProjectRoots(scope);
    const stores = await Promise.all(
      projectRoots.map((projectRoot) => readWorkflowRuntimeSessionsStore(projectRoot))
    );
    return stores
      .flatMap((store) => store.entries)
      .map((entry) => fromPersistedSessionEntry(entry))
      .filter((entry): entry is BackgroundRunRegistryEntry => Boolean(entry));
  }
  try {
    const raw = await fs.readFile(getBackgroundRunRegistryPath(), "utf8");
    if (!raw.trim()) {
      return [];
    }
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
        const status =
          readString(record.status) === "idle"
            ? "idle"
            : readString(record.status) === "needs_repair"
              ? "needs_repair"
              : "active";
        const projectId = readString(record.projectId) ?? null;
        const projectRoot = readString(record.projectRoot) ?? null;
        const startedAt = readString(record.startedAt);
        const lastCheckedAt = readString(record.lastCheckedAt) ?? null;
        const lastFinishedAt = readString(record.lastFinishedAt) ?? null;
        const lastError = readString(record.lastError) ?? null;
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
          lastError,
        } satisfies BackgroundRunRegistryEntry;
      })
      .filter((entry): entry is BackgroundRunRegistryEntry => Boolean(entry));
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : null;
    if (error instanceof SyntaxError) {
      return [];
    }
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeBackgroundRunRegistry(
  entries: BackgroundRunRegistryEntry[],
  scope?: BackgroundRuntimeScope
): Promise<void> {
  const resolved = resolveBackgroundRuntimeScope(scope);
  const projectRoot = resolved.projectRoot;
  if (projectRoot) {
    const filteredEntries = entries.filter(
      (entry) =>
        readString(entry.projectRoot) &&
        path.normalize(String(entry.projectRoot)) === path.normalize(projectRoot)
    );
    await migrateWorkflowRuntimeState({
      projectRoot,
      projectId: resolved.projectId,
      compatibilityMode: "sessions_spawn_runtime",
      reason: "write_background_run_registry",
    });
    await writeWorkflowRuntimeSessionsStore({
      projectRoot,
      projectId: resolved.projectId,
      entries: filteredEntries.map((entry) => toPersistedSessionEntry(entry)),
    });
    return;
  }
  const registryPath = getBackgroundRunRegistryPath();
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await writeJsonAtomicEnsured(registryPath, entries);
}

async function inspectBackgroundRunTerminalState(params: {
  workflowRuntime?: WorkflowRuntimeWaitApi;
  entry: BackgroundRunRegistryEntry;
}): Promise<{
  terminalStatus: "completed" | "failed" | "needs_repair";
  error: string | null;
} | null> {
  if (!params.workflowRuntime?.inspectSession) {
    return null;
  }
  try {
    const inspection = await params.workflowRuntime.inspectSession({
      sessionKey: params.entry.backgroundSessionKey,
    });
    if (!inspection) {
      return null;
    }
    const status = readString(inspection.status)?.toLowerCase() ?? null;
    const inspectionError = readString(inspection.lastError);
    if (status && ["failed", "aborted"].includes(status)) {
      const error = [
        `Background workflow session is terminal in the runtime session store (status=${status}).`,
        inspectionError,
      ]
        .filter(Boolean)
        .join(" ");
      return {
        terminalStatus: isProviderCapacityFailure(error) ? "needs_repair" : "failed",
        error,
      };
    }
    if (inspection.abortedLastRun) {
      const error = [
        "Background workflow session was aborted in the runtime session store.",
        inspectionError,
      ]
        .filter(Boolean)
        .join(" ");
      return {
        terminalStatus: isProviderCapacityFailure(error) ? "needs_repair" : "failed",
        error,
      };
    }
    if (status && ["completed", "done"].includes(status)) {
      return {
        terminalStatus: "completed",
        error: null,
      };
    }
    const transcriptCapacityFailure =
      await inspectRecentSessionProviderCapacity({
        workflowRuntime: params.workflowRuntime,
        sessionKey: params.entry.backgroundSessionKey,
      });
    if (transcriptCapacityFailure) {
      return {
        terminalStatus: "needs_repair",
        error: `Background workflow session hit provider capacity while still marked active: ${transcriptCapacityFailure}`,
      };
    }
  } catch {
    return null;
  }
  return null;
}

async function pruneBackgroundRunRegistry(params: {
  workflowRuntime?: WorkflowRuntimeWaitApi;
  projectId?: string | null;
  projectRoot?: string | null;
  projectsRoot?: string | null;
}): Promise<BackgroundRunRegistryEntry[]> {
  const now = Date.now();
  const current = await readBackgroundRunRegistry({
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    projectsRoot: params.projectsRoot,
  });
  const kept: BackgroundRunRegistryEntry[] = [];
  for (const entry of current) {
    const checkedAt = new Date(now).toISOString();
    const startedAtMs = parseTimestampMs(entry.startedAt);
    const freshnessMs =
      entry.status === "active"
        ? startedAtMs
        : parseTimestampMs(entry.lastFinishedAt ?? entry.lastCheckedAt ?? entry.startedAt);
    const canAttemptDurableReconcile =
      startedAtMs != null &&
      now - startedAtMs >= BACKGROUND_RUN_DURABLE_RECONCILE_GRACE_MS;
    if (freshnessMs == null || now - freshnessMs > BACKGROUND_RUN_STALE_MS) {
      if (entry.status === "active") {
        await reconcileBackgroundRunTerminalState({
          entry,
          terminalStatus: "needs_repair",
          finishedAt: checkedAt,
          error: "Background workflow session exceeded the stale runtime threshold and needs repair.",
        });
        kept.push({
          ...entry,
          status: "needs_repair",
          lastCheckedAt: checkedAt,
          lastFinishedAt: checkedAt,
          lastError:
            entry.lastError ??
            "Background workflow session exceeded the stale runtime threshold and needs repair.",
        });
      }
      continue;
    }
    let nextEntry: BackgroundRunRegistryEntry = {
      ...entry,
      lastCheckedAt: checkedAt,
    };
    const markEntryTerminal = async (
      terminalStatus: "completed" | "failed" | "needs_repair",
      error: string | null
    ): Promise<BackgroundRunRegistryEntry> => {
      await reconcileBackgroundRunTerminalState({
        entry,
        terminalStatus,
        finishedAt: checkedAt,
        error,
      });
      return {
        ...nextEntry,
        status: terminalStatus === "needs_repair" ? "needs_repair" : "idle",
        lastFinishedAt: checkedAt,
        lastError: terminalStatus === "completed" ? null : error ?? nextEntry.lastError,
      };
    };
    if (entry.status === "active" && params.workflowRuntime?.waitForRun) {
      try {
        const inspectedTerminal = await inspectBackgroundRunTerminalState({
          workflowRuntime: params.workflowRuntime,
          entry,
        });
        if (inspectedTerminal) {
          nextEntry = await markEntryTerminal(
            inspectedTerminal.terminalStatus,
            inspectedTerminal.error
          );
          kept.push(nextEntry);
          continue;
        }
        const waited = await params.workflowRuntime.waitForRun({
          runId: entry.runId,
          timeoutMs: 1,
        });
        if (isWorkflowRuntimeTrackingMiss(waited)) {
          if (canAttemptDurableReconcile) {
            const durableState = await inferBackgroundRunTerminalStateFromDurableState({
              entry,
              allowNeedsRepair: false,
            });
            if (durableState) {
              nextEntry = await markEntryTerminal(
                durableState.terminalStatus,
                durableState.error
              );
            }
          }
        } else if (waited.status === "ok" || waited.status === "error") {
          const postWaitTerminal = await inspectBackgroundRunTerminalState({
            workflowRuntime: params.workflowRuntime,
            entry,
          });
          const terminalStatus =
            postWaitTerminal?.terminalStatus ??
            (waited.status === "ok"
              ? "completed"
              : isProviderCapacityFailure(waited.error)
                ? "needs_repair"
                : "failed");
          nextEntry = await markEntryTerminal(
            terminalStatus,
            postWaitTerminal?.error ??
              (waited.status === "error"
                ? waited.error ?? "Background workflow run failed."
                : null)
          );
        } else if (canAttemptDurableReconcile) {
          const durableState = await inferBackgroundRunTerminalStateFromDurableState({
            entry,
            allowNeedsRepair: false,
          });
          if (durableState) {
            nextEntry = await markEntryTerminal(
              durableState.terminalStatus,
              durableState.error
            );
          }
        }
      } catch {
        kept.push(nextEntry);
        continue;
      }
    } else if (entry.status === "active" && canAttemptDurableReconcile) {
      const inspectedTerminal = await inspectBackgroundRunTerminalState({
        workflowRuntime: params.workflowRuntime,
        entry,
      });
      if (inspectedTerminal) {
        nextEntry = await markEntryTerminal(
          inspectedTerminal.terminalStatus,
          inspectedTerminal.error
        );
        kept.push(nextEntry);
        continue;
      }
      const durableState = await inferBackgroundRunTerminalStateFromDurableState({
        entry,
        allowNeedsRepair: false,
      });
      if (durableState) {
        nextEntry = await markEntryTerminal(
          durableState.terminalStatus,
          durableState.error
        );
      }
    }
    kept.push(nextEntry);
  }
  if (shouldUseProjectRuntimeState(params)) {
    const projectRoots = await listProjectScopedRuntimeProjectRoots(params);
    for (const projectRoot of projectRoots) {
      const projectEntries = kept.filter(
        (entry) =>
          readString(entry.projectRoot) &&
          path.normalize(String(entry.projectRoot)) === path.normalize(projectRoot)
      );
      await writeBackgroundRunRegistry(projectEntries, {
        projectRoot,
        projectId:
          projectEntries.find((entry) => readString(entry.projectId))?.projectId ??
          params.projectId ??
          null,
      });
    }
  } else {
    await writeBackgroundRunRegistry(kept);
  }
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
    deleteEligible: entry.status === "idle" || entry.status === "needs_repair",
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

function normalizeBackgroundRunRegistryStatuses(
  value: unknown
): Array<BackgroundRunRegistryEntry["status"]> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizeStageLike(entry))
    .filter(
      (
        entry
      ): entry is BackgroundRunRegistryEntry["status"] =>
        entry === "active" || entry === "idle" || entry === "needs_repair"
    );
}

function normalizeStageLike(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")
    : null;
}

async function upsertBackgroundRunRegistryEntry(
  entry: BackgroundRunRegistryEntry
): Promise<BackgroundRunRegistryEntry> {
  let persistedQueueKey: string | null = readString(entry.queueKey) ?? null;
  if (readString(entry.projectRoot)) {
    await updateWorkflowRuntimeSessionsStore({
      projectRoot: String(entry.projectRoot),
      projectId: entry.projectId,
      updater: (store) => {
        const existing = store.entries.find(
          (candidate) => candidate.sessionKey === entry.backgroundSessionKey
        );
        persistedQueueKey =
          readString(entry.queueKey) ??
          (existing?.runId === entry.runId
            ? readString(existing.queueKey) ?? null
            : null);
        const persistedEntry = toPersistedSessionEntry({
          ...entry,
          queueKey: persistedQueueKey,
        });
        const nextEntries = store.entries.filter(
          (existing) => existing.sessionKey !== persistedEntry.sessionKey
        );
        nextEntries.push(persistedEntry);
        return nextEntries;
      },
    });
    return {
      ...entry,
      queueKey: persistedQueueKey,
    };
  }
  const targetScope = {
    projectId: entry.projectId,
    projectRoot: entry.projectRoot,
  };
  let storedEntry = entry;
  await withAdvisoryLock({
    lockPath: getBackgroundRunRegistryLockPath(),
    task: async () => {
      const current = await readBackgroundRunRegistry(targetScope);
      const existing = current.find(
        (candidate) => candidate.backgroundSessionKey === entry.backgroundSessionKey
      );
      storedEntry = {
        ...entry,
        queueKey:
          readString(entry.queueKey) ??
          (existing?.runId === entry.runId
            ? readString(existing.queueKey) ?? null
            : null),
      };
      const next = current.filter(
        (existing) => existing.backgroundSessionKey !== entry.backgroundSessionKey
      );
      next.push(storedEntry);
      await writeBackgroundRunRegistry(next, targetScope);
    },
  });
  return storedEntry;
}

export async function getBackgroundWorkflowRunByQueueKey(params: {
  queueKey?: string | null;
  projectId?: string | null;
  projectRoot?: string | null;
  projectsRoot?: string | null;
  workflowRuntime?: WorkflowRuntimeWaitApi;
}): Promise<BackgroundRunRegistryEntry | null> {
  const queueKey = readString(params.queueKey);
  if (!queueKey) {
    return null;
  }
  const refreshed = await pruneBackgroundRunRegistry({
    workflowRuntime: params.workflowRuntime,
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    projectsRoot: params.projectsRoot,
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

export async function listBackgroundWorkflowRuns(params: {
  workflowRuntime?: WorkflowRuntimeWaitApi;
  ownerAgent?: string | null;
  channelKey?: string | null;
  family?: string | null;
  projectId?: string | null;
  projectRoot?: string | null;
  projectsRoot?: string | null;
}): Promise<{
  entries: BackgroundRunRegistryViewEntry[];
}> {
  const refreshed = await pruneBackgroundRunRegistry({
    workflowRuntime: params.workflowRuntime,
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    projectsRoot: params.projectsRoot,
  });
  const nowMs = Date.now();
  return {
    entries: refreshed
      .filter((entry) => matchesBackgroundRunRegistryFilters(entry, params))
      .map((entry) => toBackgroundRunRegistryViewEntry(entry, nowMs)),
  };
}

export async function pruneBackgroundWorkflowRuns(params: {
  workflowRuntime?: WorkflowRuntimeWaitApi;
  ownerAgent?: string | null;
  channelKey?: string | null;
  family?: string | null;
  projectId?: string | null;
  projectRoot?: string | null;
  projectsRoot?: string | null;
  idleOlderThanMs?: number;
  deleteSessions?: boolean;
}): Promise<{
  kept: BackgroundRunRegistryViewEntry[];
  removed: BackgroundRunRegistryViewEntry[];
}> {
  const refreshed = await pruneBackgroundRunRegistry({
    workflowRuntime: params.workflowRuntime,
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    projectsRoot: params.projectsRoot,
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
    const inactiveForMs =
      (entry.status === "idle" || entry.status === "needs_repair") &&
      Number.isFinite(idleReferenceMs)
        ? Math.max(0, nowMs - idleReferenceMs)
        : 0;
    if (
      (entry.status === "idle" || entry.status === "needs_repair") &&
      inactiveForMs >= idleOlderThanMs
    ) {
      removed.push(entry);
      continue;
    }
    kept.push(entry);
  }
  if (shouldUseProjectRuntimeState(params)) {
    const projectRoots = await listProjectScopedRuntimeProjectRoots(params);
    for (const projectRoot of projectRoots) {
      const projectEntries = kept.filter(
        (entry) =>
          readString(entry.projectRoot) &&
          path.normalize(String(entry.projectRoot)) === path.normalize(projectRoot)
      );
      await writeBackgroundRunRegistry(projectEntries, {
        projectRoot,
        projectId:
          projectEntries.find((entry) => readString(entry.projectId))?.projectId ??
          params.projectId ??
          null,
      });
    }
  } else {
    await writeBackgroundRunRegistry(kept);
  }
  if (params.deleteSessions === true && params.workflowRuntime?.deleteSession) {
    for (const entry of removed) {
      await params.workflowRuntime.deleteSession({
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

export async function retireBackgroundWorkflowRuns(params: {
  workflowRuntime?: WorkflowRuntimeWaitApi;
  ownerAgent?: string | null;
  channelKey?: string | null;
  family?: string | null;
  projectId?: string | null;
  projectRoot?: string | null;
  projectsRoot?: string | null;
  statuses?: unknown;
  deleteSessions?: boolean;
}): Promise<{
  kept: BackgroundRunRegistryViewEntry[];
  removed: BackgroundRunRegistryViewEntry[];
}> {
  const refreshed = await pruneBackgroundRunRegistry({
    workflowRuntime: params.workflowRuntime,
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    projectsRoot: params.projectsRoot,
  });
  const statuses = normalizeBackgroundRunRegistryStatuses(params.statuses);
  const nowMs = Date.now();
  const kept: BackgroundRunRegistryEntry[] = [];
  const removed: BackgroundRunRegistryEntry[] = [];
  for (const entry of refreshed) {
    if (!matchesBackgroundRunRegistryFilters(entry, params)) {
      kept.push(entry);
      continue;
    }
    if (statuses.length > 0 && !statuses.includes(entry.status)) {
      kept.push(entry);
      continue;
    }
    removed.push(entry);
  }
  if (shouldUseProjectRuntimeState(params)) {
    const projectRoots = await listProjectScopedRuntimeProjectRoots(params);
    for (const projectRoot of projectRoots) {
      const projectEntries = kept.filter(
        (entry) =>
          readString(entry.projectRoot) &&
          path.normalize(String(entry.projectRoot)) === path.normalize(projectRoot)
      );
      await writeBackgroundRunRegistry(projectEntries, {
        projectRoot,
        projectId:
          projectEntries.find((entry) => readString(entry.projectId))?.projectId ??
          params.projectId ??
          null,
      });
    }
  } else {
    await writeBackgroundRunRegistry(kept);
  }
  if (params.deleteSessions === true && params.workflowRuntime?.deleteSession) {
    for (const entry of removed) {
      await params.workflowRuntime.deleteSession({
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

export async function acquireBackgroundWorkflowSession(params: {
  workflowRuntime?: WorkflowRuntimeWaitApi;
  ownerAgent?: string | null;
  requesterSessionKey?: string | null;
  messageChannel?: string | null;
  channelKey?: string | null;
  preferredSessionKey?: string | null;
  family?: string | null;
  kind?: string | null;
  projectId?: string | null;
  projectRoot?: string | null;
  projectsRoot?: string | null;
}): Promise<BackgroundWorkflowSessionLease> {
  const ownerAgent = normalizeAgentId(params.ownerAgent);
  const family =
    readString(params.family) ??
    deriveBackgroundRunFamily(readString(params.kind)?.toLowerCase() ?? "generic");
  const kind = normalizeBackgroundRunKind(params.kind);
  const projectId = readString(params.projectId) ?? null;
  const projectRoot = readString(params.projectRoot) ?? null;
  const channelKey = deriveBackgroundRunChannelKey({
    channelKey: readString(params.channelKey) ?? undefined,
    sessionKey: params.requesterSessionKey ?? undefined,
    messageChannel: params.messageChannel ?? undefined,
  });

  if (!ownerAgent || !channelKey) {
    return {
      acquired: true,
      reason: "acquired",
      sessionKey:
        readString(params.preferredSessionKey) ??
        readString(params.requesterSessionKey) ??
        null,
      reusedIdleSession: false,
      activeOwnerSessionsInChannel: null,
      activeResearcherSessionsInChannel: null,
      channelKey,
      ownerAgent,
      family,
      projectId,
      projectRoot,
    };
  }

  const registryEntries = await pruneBackgroundRunRegistry({
    workflowRuntime: params.workflowRuntime,
    projectId,
    projectRoot,
    projectsRoot: params.projectsRoot,
  });
  const reusableBackgroundSessionKey =
    registryEntries.find(
      (entry) =>
        entry.status === "idle" &&
        backgroundRunRegistryEntryMatchesLease(entry, {
          ownerAgent,
          channelKey,
          family,
          kind,
          projectId,
          projectRoot,
        })
    )?.backgroundSessionKey ?? null;
  const activeScopeEntries = registryEntries.filter(
    (entry) =>
      entry.ownerAgent === ownerAgent &&
      entry.channelKey === channelKey &&
      entry.status === "active" &&
      backgroundRunRegistryEntryMatchesProject(entry, projectId, projectRoot) &&
      entry.backgroundSessionKey !== reusableBackgroundSessionKey
  );
  const activeFamilyScopeEntries = activeScopeEntries.filter(
    (entry) => entry.family === family
  );
  const activeOwnerSessionsInChannel = activeScopeEntries.length;
  if (
    !reusableBackgroundSessionKey &&
    activeFamilyScopeEntries.length >=
      MAX_POOLED_BACKGROUND_SUBAGENTS_PER_PROJECT_SCOPE
  ) {
    return {
      acquired: false,
      reason: "channel_capacity_reached",
      sessionKey: null,
      reusedIdleSession: false,
      activeOwnerSessionsInChannel,
      activeResearcherSessionsInChannel: activeOwnerSessionsInChannel,
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
      resolveNonCollidingBackgroundSessionKey({
        registryEntries,
        preferredSessionKey: readString(params.preferredSessionKey) ?? null,
        requesterSessionKey: readString(params.requesterSessionKey) ?? null,
        ownerAgent,
        channelKey,
        family,
        kind,
        projectId,
        projectRoot,
      }),
    reusedIdleSession: Boolean(reusableBackgroundSessionKey),
    activeOwnerSessionsInChannel,
    activeResearcherSessionsInChannel: activeOwnerSessionsInChannel,
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
  projectsRoot?: string | null;
}): Promise<void> {
  const ownerAgent = normalizeAgentId(params.ownerAgent);
  const channelKey = readString(params.channelKey);
  const requesterSessionKey = readString(params.requesterSessionKey);
  const backgroundSessionKey = readString(params.backgroundSessionKey);
  const runId = readString(params.runId);
  if (!ownerAgent || !channelKey || !requesterSessionKey || !backgroundSessionKey || !runId) {
    return;
  }
  const persistedEntry = await upsertBackgroundRunRegistryEntry({
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
    lastError: null,
  });
  await appendBackgroundWorkflowRuntimeEvent({
    projectRoot: readString(params.projectRoot) ?? null,
    projectId: readString(params.projectId) ?? null,
    kind: "background_session_recorded",
    summary: `Recorded background workflow session ${backgroundSessionKey}.`,
    details: {
      ownerAgent,
      channelKey,
      requesterSessionKey,
      backgroundSessionKey,
      runId,
      queueKey: persistedEntry.queueKey,
      family:
        readString(params.family) ??
        deriveBackgroundRunFamily(readString(params.kind)?.toLowerCase() ?? "generic"),
      kind: readString(params.kind) ?? "generic",
    },
  });
}
