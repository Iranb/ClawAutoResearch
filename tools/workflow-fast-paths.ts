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
import {
  appendWorkflowRuntimeEvent,
  listWorkflowRuntimeProjectRoots,
  migrateWorkflowRuntimeState,
  readWorkflowRuntimeQueueStore,
  readWorkflowRuntimeSessionsStore,
  writeWorkflowRuntimeQueueStore,
  writeWorkflowRuntimeSessionsStore,
} from "./workflow-runtime-state.js";
import {
  orchestrateWorkflowTransition,
  resumeWorkflowTransition,
} from "./workflow-session-orchestrator.js";
import type {
  WorkflowRuntimeQueueEntry as PersistedWorkflowRuntimeQueueEntry,
  WorkflowRuntimeSessionEntry as PersistedWorkflowRuntimeSessionEntry,
} from "./workflow-runtime-state";

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

export type PapernexusWrapperScript =
  | "pn_stage_sync.py"
  | "pn_import_submit.py"
  | "pn_import_queue.py"
  | "pn_graph_query.py"
  | "pn_research_chains.py";

export type PapernexusWrapperRunRequest = {
  wrapper?: string;
  args?: unknown[];
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
  status: "active" | "idle" | "needs_repair";
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
  status:
    | "queued"
    | "launching"
    | "running"
    | "completed"
    | "degraded"
    | "needs_repair"
    | "failed";
  fallbackMode:
    | "legacy_dispatch"
    | "hybrid_runtime"
    | "sessions_spawn_runtime"
    | null;
  lastError: string | null;
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

type BackgroundRuntimeScope = {
  projectId?: string | null;
  projectRoot?: string | null;
  projectsRoot?: string | null;
};

const PAPERNEXUS_WRAPPER_SCRIPT_MAP: Record<string, PapernexusWrapperScript> = {
  "pn_stage_sync": "pn_stage_sync.py",
  "pn_stage_sync.py": "pn_stage_sync.py",
  "pn_import_submit": "pn_import_submit.py",
  "pn_import_submit.py": "pn_import_submit.py",
  "pn_import_queue": "pn_import_queue.py",
  "pn_import_queue.py": "pn_import_queue.py",
  "pn_graph_query": "pn_graph_query.py",
  "pn_graph_query.py": "pn_graph_query.py",
  "pn_research_chains": "pn_research_chains.py",
  "pn_research_chains.py": "pn_research_chains.py",
};

const PAPERNEXUS_WRAPPER_SUBCOMMANDS = new Set([
  "query",
  "context",
  "impact",
  "ideas",
  "brainstorm",
  "path-trace",
  "evidence-chain",
  "reflection-chain",
  "research-brief",
  "brainstorm-brief",
  "theory-brief",
  "storyline-brief",
  "paper-enhancement",
  "list",
  "status",
  "log",
  "wait",
]);

function isPapernexusBackgroundKind(kind: string): boolean {
  return kind === "papernexus_skill" || kind === "papernexus_wrapper";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function stringifyPapernexusWrapperArg(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return null;
}

export function resolvePapernexusWrapperScript(
  value: string | null | undefined
): PapernexusWrapperScript {
  const normalized = readString(value)?.toLowerCase();
  const resolved = normalized ? PAPERNEXUS_WRAPPER_SCRIPT_MAP[normalized] : null;
  if (!resolved) {
    throw new Error(
      "Unsupported PaperNexus wrapper. Use one of pn_stage_sync.py, pn_import_submit.py, pn_import_queue.py, pn_graph_query.py, or pn_research_chains.py."
    );
  }
  return resolved;
}

export function buildPapernexusWrapperCommand(params: {
  wrapper?: string | null;
  args?: unknown[];
}): string {
  const script = resolvePapernexusWrapperScript(params.wrapper ?? null);
  const args = Array.isArray(params.args)
    ? params.args
        .map((value) => stringifyPapernexusWrapperArg(value))
        .filter((value): value is string => Boolean(value))
    : [];
  const parts = [
    "python3",
    `scripts/${script}`,
    ...args.map((value) =>
      value.startsWith("-") || PAPERNEXUS_WRAPPER_SUBCOMMANDS.has(value.toLowerCase())
        ? value
        : shellQuote(value)
    ),
  ];
  return parts.join(" ");
}

export function buildPapernexusWrapperBackgroundRunRequest(
  params: PapernexusWrapperRunRequest
): BackgroundRunRequest & { wrapper: PapernexusWrapperScript } {
  const wrapper = resolvePapernexusWrapperScript(params.wrapper ?? null);
  const commandText = buildPapernexusSkillBackgroundCommand(
    buildPapernexusWrapperCommand({
      wrapper,
      args: params.args,
    })
  );
  return {
    kind: "papernexus_wrapper",
    commandText,
    summary:
      readString(params.summary) ??
      `Queued ${wrapper} in a dedicated PaperNexus workflow subagent.`,
    topic: readString(params.topic),
    title: readString(params.title),
    projectId: readString(params.projectId),
    projectRoot: readString(params.projectRoot),
    ensureProjectBinding: params.ensureProjectBinding,
    wrapper,
  };
}

function deriveBackgroundRunFamily(kind: string): string {
  switch (kind) {
    case "research_pipeline":
    case "research_queue":
    case "resume_pipeline":
    case "idle_research":
      return "research";
    case "papernexus_skill":
    case "papernexus_wrapper":
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

function isBackgroundQueueEntryPending(entry: BackgroundWorkflowQueueEntry): boolean {
  return ["queued", "launching", "degraded", "needs_repair"].includes(entry.status);
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
    lastError:
      entry.status === "needs_repair"
        ? "Background workflow session needs repair after runtime recovery."
        : null,
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
      entry.status === "idle" || entry.status === "needs_repair"
        ? entry.status
        : "active",
    projectId: readString(entry.projectId) ?? null,
    projectRoot: readString(entry.projectRoot) ?? null,
    startedAt,
    lastCheckedAt: readString(entry.lastCheckedAt ?? entry.lastHeartbeatAt) ?? null,
    lastFinishedAt: readString(entry.lastFinishedAt) ?? null,
  };
}

function toPersistedQueueEntry(
  entry: BackgroundWorkflowQueueEntry
): PersistedWorkflowRuntimeQueueEntry {
  return {
    transitionId: entry.queueId,
    queueId: entry.queueId,
    queueKey: entry.queueKey,
    source: entry.source,
    entryType: entry.entryType,
    ownerAgent: entry.ownerAgent,
    channelKey: entry.channelKey,
    requesterSessionKey: entry.requesterSessionKey,
    messageChannel: entry.messageChannel,
    preferredSessionKey: entry.preferredSessionKey,
    family: entry.family,
    kind: entry.kind,
    projectId: entry.projectId,
    projectRoot: entry.projectRoot,
    queuedAt: entry.queuedAt,
    lastAttemptedAt: entry.lastAttemptedAt,
    attemptCount: entry.attemptCount,
    summary: entry.summary,
    status: entry.status,
    fallbackMode: entry.fallbackMode,
    lastError: entry.lastError,
    parentSessionKey: null,
    threadBindingKey: null,
    depth: 0,
    runPayload: entry.runPayload,
    dispatchPayload: entry.dispatchPayload,
  };
}

function fromPersistedQueueEntry(
  entry: PersistedWorkflowRuntimeQueueEntry
): BackgroundWorkflowQueueEntry | null {
  const ownerAgent = normalizeAgentId(entry.ownerAgent);
  const channelKey = readString(entry.channelKey);
  const requesterSessionKey = readString(entry.requesterSessionKey);
  const family = readString(entry.family);
  const kind = readString(entry.kind);
  const queuedAt = readString(entry.queuedAt);
  if (
    !ownerAgent ||
    !channelKey ||
    !requesterSessionKey ||
    !family ||
    !kind ||
    !queuedAt
  ) {
    return null;
  }
  return {
    queueId: readString(entry.queueId) ?? readString(entry.transitionId) ?? randomUUID(),
    queueKey: readString(entry.queueKey) ?? "",
    source:
      (readString(entry.source) as BackgroundWorkflowQueueEntry["source"] | null) ??
      "start_background_run",
    entryType: entry.entryType,
    ownerAgent,
    channelKey,
    requesterSessionKey,
    messageChannel: readString(entry.messageChannel) ?? null,
    preferredSessionKey: readString(entry.preferredSessionKey) ?? null,
    family,
    kind,
    projectId: readString(entry.projectId) ?? null,
    projectRoot: readString(entry.projectRoot) ?? null,
    queuedAt,
    lastAttemptedAt: readString(entry.lastAttemptedAt) ?? null,
    attemptCount: Math.max(0, Math.floor(Number(entry.attemptCount ?? 0))),
    summary: readString(entry.summary) ?? null,
    status: entry.status,
    fallbackMode: entry.fallbackMode ?? null,
    lastError: readString(entry.lastError) ?? null,
    runPayload: entry.runPayload,
    dispatchPayload: entry.dispatchPayload
      ? {
          ...entry.dispatchPayload,
          toRole: entry.dispatchPayload.toRole as DispatchableWorkflowRole,
        }
      : null,
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

async function readBackgroundWorkflowQueue(
  scope?: BackgroundRuntimeScope
): Promise<BackgroundWorkflowQueueEntry[]> {
  if (shouldUseProjectRuntimeState(scope)) {
    const projectRoots = await listProjectScopedRuntimeProjectRoots(scope);
    const stores = await Promise.all(
      projectRoots.map((projectRoot) => readWorkflowRuntimeQueueStore(projectRoot))
    );
    return stores
      .flatMap((store) => store.entries)
      .map((entry) => fromPersistedQueueEntry(entry))
      .filter((entry): entry is BackgroundWorkflowQueueEntry => Boolean(entry));
  }
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
        const status =
          (readString(record.status) as BackgroundWorkflowQueueEntry["status"] | null) ??
          "queued";
        const fallbackMode =
          (readString(record.fallbackMode ?? record.fallback_mode) as
            | BackgroundWorkflowQueueEntry["fallbackMode"]
            | null) ?? null;
        const lastError = readString(record.lastError ?? record.last_error) ?? null;
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
          status,
          fallbackMode,
          lastError,
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
  await fs.writeFile(registryPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

async function writeBackgroundWorkflowQueue(
  entries: BackgroundWorkflowQueueEntry[],
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
      reason: "write_background_queue",
    });
    await writeWorkflowRuntimeQueueStore({
      projectRoot,
      projectId: resolved.projectId,
      entries: filteredEntries.map((entry) => toPersistedQueueEntry(entry)),
    });
    return;
  }
  const queuePath = getBackgroundQueuePath();
  await fs.mkdir(path.dirname(queuePath), { recursive: true });
  await fs.writeFile(queuePath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

async function pruneBackgroundWorkflowQueue(
  scope?: BackgroundRuntimeScope
): Promise<BackgroundWorkflowQueueEntry[]> {
  const now = Date.now();
  const current = await readBackgroundWorkflowQueue(scope);
  const kept = current.filter((entry) => {
    const freshnessReference = entry.lastAttemptedAt ?? entry.queuedAt;
    const freshnessMs = Date.parse(freshnessReference);
    return Number.isFinite(freshnessMs) && now - freshnessMs <= BACKGROUND_QUEUE_STALE_MS;
  });
  if (shouldUseProjectRuntimeState(scope)) {
    const projectRoots = await listProjectScopedRuntimeProjectRoots(scope);
    const grouped = new Map<string, BackgroundWorkflowQueueEntry[]>();
    for (const entry of kept) {
      const projectRoot = readString(entry.projectRoot);
      if (!projectRoot) {
        continue;
      }
      const bucket = grouped.get(projectRoot) ?? [];
      bucket.push(entry);
      grouped.set(projectRoot, bucket);
    }
    for (const projectRoot of projectRoots) {
      const entries = grouped.get(projectRoot) ?? [];
      await writeBackgroundWorkflowQueue(entries, {
        ...scope,
        projectRoot,
        projectId:
          entries.find((entry) => readString(entry.projectId))?.projectId ??
          resolveBackgroundRuntimeScope(scope).projectId ??
          null,
      });
    }
  } else {
    await writeBackgroundWorkflowQueue(kept);
  }
  return kept;
}

async function upsertBackgroundWorkflowQueueEntry(
  entry: BackgroundWorkflowQueueEntry,
  scope?: BackgroundRuntimeScope
): Promise<{
  entry: BackgroundWorkflowQueueEntry;
  queuePosition: number;
  created: boolean;
}> {
  const entryScope = {
    projectId: entry.projectId,
    projectRoot: entry.projectRoot,
  };
  const current = await pruneBackgroundWorkflowQueue(entryScope);
  const existing = current.find((candidate) => candidate.queueKey === entry.queueKey) ?? null;
  if (existing) {
    return {
      entry: existing,
      queuePosition:
        current
          .sort((a, b) => Date.parse(a.queuedAt) - Date.parse(b.queuedAt))
          .findIndex((candidate) => candidate.queueKey === existing.queueKey) + 1,
      created: false,
    };
  }
  const next = [...current, entry];
  next.sort((a, b) => Date.parse(a.queuedAt) - Date.parse(b.queuedAt));
  await writeBackgroundWorkflowQueue(next, entryScope);
  return {
    entry,
    queuePosition: next.findIndex((candidate) => candidate.queueKey === entry.queueKey) + 1,
    created: true,
  };
}

async function removeBackgroundWorkflowQueueEntries(
  entries: BackgroundWorkflowQueueEntry[]
): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  const byProjectRoot = new Map<string, BackgroundWorkflowQueueEntry[]>();
  for (const entry of entries) {
    const projectRoot = readString(entry.projectRoot);
    if (!projectRoot) {
      continue;
    }
    const bucket = byProjectRoot.get(projectRoot) ?? [];
    bucket.push(entry);
    byProjectRoot.set(projectRoot, bucket);
  }
  if (byProjectRoot.size === 0) {
    const current = await pruneBackgroundWorkflowQueue();
    const blocked = new Set(entries.map((entry) => entry.queueKey));
    const next = current.map((entry) =>
      blocked.has(entry.queueKey)
        ? {
            ...entry,
            status: "running" as const,
            lastAttemptedAt: new Date().toISOString(),
          }
        : entry
    );
    await writeBackgroundWorkflowQueue(next);
    return;
  }
  for (const [projectRoot, projectEntries] of byProjectRoot.entries()) {
    const current = await pruneBackgroundWorkflowQueue({ projectRoot });
    const blocked = new Set(projectEntries.map((entry) => entry.queueKey));
    const next = current.map((entry) =>
      blocked.has(entry.queueKey)
        ? {
            ...entry,
            status: "running" as const,
            lastAttemptedAt: new Date().toISOString(),
          }
        : entry
    );
    await writeBackgroundWorkflowQueue(next, {
      projectRoot,
      projectId: projectEntries.find((entry) => readString(entry.projectId))?.projectId ?? null,
    });
  }
}

async function touchBackgroundWorkflowQueueEntry(params: {
  entry: BackgroundWorkflowQueueEntry;
  error?: string | null;
  status?: BackgroundWorkflowQueueEntry["status"];
}): Promise<void> {
  const current = await pruneBackgroundWorkflowQueue({
    projectRoot: params.entry.projectRoot,
    projectId: params.entry.projectId,
  });
  const next = current.map((entry) =>
    entry.queueKey === params.entry.queueKey
        ? {
            ...entry,
            lastAttemptedAt: new Date().toISOString(),
            attemptCount: entry.attemptCount + 1,
            summary: params.error ? params.error : entry.summary,
            lastError: params.error ? params.error : entry.lastError,
            status:
              params.status ??
              (params.error ? "degraded" : entry.status),
          }
        : entry
  );
  await writeBackgroundWorkflowQueue(next, {
    projectRoot: params.entry.projectRoot,
    projectId: params.entry.projectId,
  });
  await appendBackgroundWorkflowRuntimeEvent({
    projectRoot: params.entry.projectRoot,
    projectId: params.entry.projectId,
    kind:
      params.status === "needs_repair"
        ? "background_queue_needs_repair"
        : params.error
          ? "background_queue_degraded"
          : "background_queue_touched",
    summary:
      params.error ??
      `Background workflow queue entry ${params.entry.queueKey} updated.`,
    details: {
      queueKey: params.entry.queueKey,
      status:
        params.status ??
        (params.error ? "degraded" : params.entry.status),
    },
  });
}

export async function hasPendingBackgroundWorkflowQueueKey(params: {
  queueKey?: string | null;
  projectId?: string | null;
  projectRoot?: string | null;
  projectsRoot?: string | null;
}): Promise<{
  queued: boolean;
  active: boolean;
}> {
  const queueKey = readString(params.queueKey);
  if (!queueKey) {
    return { queued: false, active: false };
  }
  const queueEntries = await pruneBackgroundWorkflowQueue({
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    projectsRoot: params.projectsRoot,
  });
  const queued = queueEntries.some(
    (entry) =>
      isBackgroundQueueEntryPending(entry) &&
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
  const activeEntries = await pruneBackgroundRunRegistry({
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    projectsRoot: params.projectsRoot,
  });
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
  projectsRoot?: string | null;
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

async function pruneBackgroundRunRegistry(params: {
  runtimeSubagent?: {
    waitForRun?: (params: { runId: string; timeoutMs?: number }) => Promise<{
      status: "ok" | "error" | "timeout";
      error?: string;
    }>;
  };
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
    const freshnessReference =
      entry.lastFinishedAt ?? entry.lastCheckedAt ?? entry.startedAt;
    const freshnessMs = Date.parse(freshnessReference);
    if (!Number.isFinite(freshnessMs) || now - freshnessMs > BACKGROUND_RUN_STALE_MS) {
      if (entry.status === "active") {
        kept.push({
          ...entry,
          status: "needs_repair",
          lastCheckedAt: new Date(now).toISOString(),
        });
      }
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
        kept.push({
          ...nextEntry,
          status: "needs_repair",
        });
        continue;
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
  projectsRoot?: string | null;
}): Promise<{
  entries: BackgroundRunRegistryViewEntry[];
}> {
  const refreshed = await pruneBackgroundRunRegistry({
    runtimeSubagent: params.runtimeSubagent,
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
  projectsRoot?: string | null;
  idleOlderThanMs?: number;
  deleteSessions?: boolean;
}): Promise<{
  kept: BackgroundRunRegistryViewEntry[];
  removed: BackgroundRunRegistryViewEntry[];
}> {
  const refreshed = await pruneBackgroundRunRegistry({
    runtimeSubagent: params.runtimeSubagent,
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
  entry: BackgroundRunRegistryEntry,
  scope?: BackgroundRuntimeScope
): Promise<void> {
  const targetScope = {
    projectId: entry.projectId,
    projectRoot: entry.projectRoot,
  };
  const current = await readBackgroundRunRegistry(targetScope);
  const next = current.filter(
    (existing) => existing.backgroundSessionKey !== entry.backgroundSessionKey
  );
  next.push(entry);
  await writeBackgroundRunRegistry(next, targetScope);
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
  projectsRoot?: string | null;
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
    projectId,
    projectRoot,
    projectsRoot: params.projectsRoot,
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
  projectsRoot?: string | null;
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
  }, {
    projectId: readString(params.projectId) ?? null,
    projectRoot: readString(params.projectRoot) ?? null,
    projectsRoot: readString(params.projectsRoot) ?? null,
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
      queueKey: readString(params.queueKey) ?? null,
      family:
        readString(params.family) ??
        deriveBackgroundRunFamily(readString(params.kind)?.toLowerCase() ?? "generic"),
      kind: readString(params.kind) ?? "generic",
    },
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
  projectsRoot?: string | null;
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
    status: "queued",
    fallbackMode: null,
    lastError: null,
    runPayload: params.runPayload ?? null,
    dispatchPayload: params.dispatchPayload ?? null,
  };
  const queued = await upsertBackgroundWorkflowQueueEntry(entry, {
    projectId: entry.projectId,
    projectRoot: entry.projectRoot,
    projectsRoot: readString(params.projectsRoot) ?? null,
  });
  if (queued.created) {
    await appendBackgroundWorkflowRuntimeEvent({
      projectRoot: entry.projectRoot,
      projectId: entry.projectId,
      kind: "background_queue_enqueued",
      summary:
        entry.summary ??
        `Queued background workflow ${entry.queueKey} for replay.`,
      details: {
        queueKey: entry.queueKey,
        entryType: entry.entryType,
        source: entry.source,
        ownerAgent: entry.ownerAgent,
        family: entry.family,
        kind: entry.kind,
        queuePosition: queued.queuePosition,
      },
    });
  }
  return queued;
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
    projectsRoot?: string;
  } | null;
  projectsRoot?: string | null;
  handoffWorkflowTaskToAgent?: typeof handoffWorkflowTaskToAgent;
}): Promise<QueuedBackgroundWorkflowDrainResult> {
  const runtimeSubagent = params.runtimeSubagent;
  if (!runtimeSubagent) {
    return {
      started: [],
      remaining: await pruneBackgroundWorkflowQueue({
        projectsRoot:
          readString(params.projectsRoot) ??
          readString(params.workflowPolicy?.projectsRoot) ??
          null,
      }),
    };
  }

  const queue = await pruneBackgroundWorkflowQueue({
    projectsRoot:
      readString(params.projectsRoot) ??
      readString(params.workflowPolicy?.projectsRoot) ??
      null,
  });
  const started: BackgroundRunStartResult[] = [];
  const processedEntries: BackgroundWorkflowQueueEntry[] = [];

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
        projectsRoot:
          readString(params.projectsRoot) ??
          readString(params.workflowPolicy?.projectsRoot) ??
          null,
      });
    if (!sessionLease.acquired || !sessionLease.sessionKey) {
      continue;
    }

    try {
      if (entry.entryType === "dispatch_task" && entry.dispatchPayload) {
        if (!readString(entry.projectRoot)) {
          await touchBackgroundWorkflowQueueEntry({
            entry,
            error:
              "Queued workflow dispatch is missing a durable projectRoot and cannot use legacy inline fallback.",
            status: "needs_repair",
          });
          continue;
        }
        const dispatchPayload = entry.dispatchPayload;
        const preferredSessionKeys = [
          sessionLease.sessionKey,
          ...dispatchPayload.preferredSessionKeys.filter(
            (candidate) => candidate !== sessionLease.sessionKey
          ),
        ];
        const dispatchLaunch = readString(entry.projectRoot)
          ? await resumeWorkflowTransition({
              projectRoot: String(entry.projectRoot),
              projectId: entry.projectId,
              queueKey: entry.queueKey,
              spawn: async () => {
                const dispatch = dispatchPayload.useWorkflowHandoff
                  ? await (
                      params.handoffWorkflowTaskToAgent ?? handoffWorkflowTaskToAgent
                    )({
                      runtimeSubagent,
                      workflowPolicy: params.workflowPolicy ?? undefined,
                      requesterSessionKey: entry.requesterSessionKey,
                      requesterChannel:
                        dispatchPayload.requesterChannel ?? undefined,
                      requesterAccountId:
                        dispatchPayload.requesterAccountId ?? undefined,
                      preferredSessionKeys,
                      fromRole: dispatchPayload.fromRole,
                      toRole: dispatchPayload.toRole,
                      projectRoot: dispatchPayload.projectRoot,
                      projectId: dispatchPayload.projectId,
                      stage: dispatchPayload.stage,
                      summary: dispatchPayload.summary,
                      command: dispatchPayload.command,
                      mailboxMessageId: dispatchPayload.mailboxMessageId,
                      extraBody: dispatchPayload.extraBody,
                      waitTimeoutMs:
                        dispatchPayload.waitTimeoutMs ?? undefined,
                      retryOnTimeout: dispatchPayload.retryOnTimeout,
                      enableSpawnFallback:
                        dispatchPayload.enableSpawnFallback,
                      autoModeActive: dispatchPayload.autoModeActive,
                    })
                  : await dispatchWorkflowTaskToAgent({
                      runtimeSubagent,
                      requesterSessionKey: entry.requesterSessionKey,
                      requesterChannel:
                        dispatchPayload.requesterChannel ?? undefined,
                      preferredSessionKeys,
                      fromRole: dispatchPayload.fromRole,
                      toRole: dispatchPayload.toRole,
                      projectRoot: dispatchPayload.projectRoot,
                      projectId: dispatchPayload.projectId,
                      stage: dispatchPayload.stage,
                      summary: dispatchPayload.summary,
                      command: dispatchPayload.command,
                      mailboxMessageId: dispatchPayload.mailboxMessageId,
                      extraBody: dispatchPayload.extraBody,
                      waitTimeoutMs:
                        dispatchPayload.waitTimeoutMs ?? undefined,
                      retryOnTimeout: dispatchPayload.retryOnTimeout,
                      enableSpawnFallback:
                        dispatchPayload.enableSpawnFallback,
                    });
                if (!dispatch.dispatched || !dispatch.runId || !dispatch.sessionKey) {
                  throw new Error(
                    dispatch.error ?? "Queued workflow dispatch did not start."
                  );
                }
                return {
                  runId: dispatch.runId,
                  sessionKey: dispatch.sessionKey ?? sessionLease.sessionKey,
                  runtime:
                    dispatch.channel === "sessions_spawn"
                      ? "subagent"
                      : "legacy_dispatch",
                  role: dispatchPayload.toRole,
                  agentId: dispatchPayload.toRole,
                  ownerAgent: entry.ownerAgent,
                  strategy: dispatch.strategy ?? "workflow_dispatch",
                  parentSessionKey: entry.requesterSessionKey,
                  depth: 1,
                };
              },
            })
          : null;
        if (
          dispatchLaunch &&
          (!dispatchLaunch.launched ||
            !dispatchLaunch.runId ||
            !dispatchLaunch.sessionKey)
        ) {
          continue;
        }
        let dispatchResult: {
          dispatched: boolean;
          runId: string | null;
          sessionKey: string | null;
          strategy: string | null;
          error: string | null;
        };
        if (dispatchLaunch == null) {
          const legacyDispatch = entry.dispatchPayload.useWorkflowHandoff
            ? await (params.handoffWorkflowTaskToAgent ?? handoffWorkflowTaskToAgent)({
                runtimeSubagent,
                workflowPolicy: params.workflowPolicy ?? undefined,
                requesterSessionKey: entry.requesterSessionKey,
                requesterChannel:
                  entry.dispatchPayload.requesterChannel ?? undefined,
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
                requesterChannel:
                  entry.dispatchPayload.requesterChannel ?? undefined,
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
          if (
            !legacyDispatch.dispatched ||
            !legacyDispatch.runId ||
            !legacyDispatch.sessionKey
          ) {
            await touchBackgroundWorkflowQueueEntry({
              entry,
              error:
                legacyDispatch.error ??
                "Queued workflow dispatch did not start.",
            });
            continue;
          }
          dispatchResult = {
            dispatched: legacyDispatch.dispatched,
            runId: legacyDispatch.runId,
            sessionKey: legacyDispatch.sessionKey,
            strategy: legacyDispatch.strategy,
            error: legacyDispatch.error,
          };
        } else {
          dispatchResult = {
            dispatched: dispatchLaunch.launched,
            runId: dispatchLaunch.runId,
            sessionKey: dispatchLaunch.sessionKey,
            strategy: dispatchLaunch.strategy,
            error: dispatchLaunch.error,
          };
        }
        await recordBackgroundWorkflowRun({
          ownerAgent: entry.ownerAgent,
          channelKey: entry.channelKey,
          requesterSessionKey: entry.requesterSessionKey,
          backgroundSessionKey: dispatchResult.sessionKey,
          runId: dispatchResult.runId,
          queueKey: entry.queueKey,
          kind: entry.kind,
          family: entry.family,
          projectId: entry.projectId,
          projectRoot: entry.projectRoot,
          projectsRoot:
            readString(params.projectsRoot) ??
            readString(params.workflowPolicy?.projectsRoot) ??
            null,
        });
        await appendBackgroundWorkflowRuntimeEvent({
          projectRoot: entry.projectRoot,
          projectId: entry.projectId,
          kind: "background_queue_replayed",
          summary:
            entry.summary ??
            `Queued workflow dispatch ${entry.queueKey} resumed through the runtime.`,
          details: {
            queueKey: entry.queueKey,
            entryType: entry.entryType,
            strategy: dispatchResult.strategy,
            sessionKey: dispatchResult.sessionKey,
            runId: dispatchResult.runId,
          },
        });
        processedEntries.push(entry);
        started.push({
          started: true,
          reason: "started",
          runId: dispatchResult.runId,
          sessionKey: dispatchResult.sessionKey,
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
        const runPayload = entry.runPayload;
        const backgroundSessionKey = sessionLease.sessionKey;
        if (!backgroundSessionKey) {
          throw new Error("Unable to resume background workflow without a session key.");
        }
        const runLaunch = readString(entry.projectRoot)
          ? await resumeWorkflowTransition({
              projectRoot: String(entry.projectRoot),
              projectId: entry.projectId,
              queueKey: entry.queueKey,
              spawn: async () => {
                const startedRun = await runtimeSubagent.run({
                  sessionKey: backgroundSessionKey,
                  message: runPayload.message,
                  lane: runPayload.lane,
                  deliver: runPayload.deliver,
                  idempotencyKey:
                    runPayload.idempotencyKey ?? undefined,
                  extraSystemPrompt: runPayload.extraSystemPrompt ?? undefined,
                });
                return {
                  runId: startedRun.runId,
                  sessionKey: backgroundSessionKey,
                  runtime: "subagent",
                  role: entry.ownerAgent,
                  agentId: entry.ownerAgent,
                  ownerAgent: entry.ownerAgent,
                  parentSessionKey: entry.requesterSessionKey,
                  depth: 1,
                };
              },
            })
          : null;
        if (
          runLaunch &&
          (!runLaunch.launched || !runLaunch.runId || !runLaunch.sessionKey)
        ) {
          continue;
        }
        const startedRun =
          runLaunch != null
            ? {
                runId: runLaunch.runId,
                sessionKey: runLaunch.sessionKey ?? backgroundSessionKey,
              }
            : await runtimeSubagent.run({
                sessionKey: backgroundSessionKey,
                message: runPayload.message,
                lane: runPayload.lane,
                deliver: runPayload.deliver,
                idempotencyKey: runPayload.idempotencyKey ?? undefined,
                extraSystemPrompt: runPayload.extraSystemPrompt ?? undefined,
              });
        const effectiveBackgroundSessionKey =
          runLaunch?.sessionKey ?? backgroundSessionKey;
        await recordBackgroundWorkflowRun({
          ownerAgent: entry.ownerAgent,
          channelKey: entry.channelKey,
          requesterSessionKey: entry.requesterSessionKey,
          backgroundSessionKey: effectiveBackgroundSessionKey,
          runId: startedRun.runId,
          queueKey: entry.queueKey,
          kind: entry.kind,
          family: entry.family,
          projectId: entry.projectId,
          projectRoot: entry.projectRoot,
          projectsRoot:
            readString(params.projectsRoot) ??
            readString(params.workflowPolicy?.projectsRoot) ??
            null,
        });
        await appendBackgroundWorkflowRuntimeEvent({
          projectRoot: entry.projectRoot,
          projectId: entry.projectId,
          kind: "background_queue_replayed",
          summary:
            entry.summary ??
            `Queued background workflow ${entry.queueKey} resumed through the runtime.`,
          details: {
            queueKey: entry.queueKey,
            entryType: entry.entryType,
            sessionKey: effectiveBackgroundSessionKey,
            runId: startedRun.runId,
          },
        });
        processedEntries.push(entry);
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
        entry,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await removeBackgroundWorkflowQueueEntries(processedEntries);
  return {
    started,
    remaining: (
      await pruneBackgroundWorkflowQueue({
        projectsRoot:
          readString(params.projectsRoot) ??
          readString(params.workflowPolicy?.projectsRoot) ??
          null,
      })
    ).filter((entry) => isBackgroundQueueEntryPending(entry)),
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
  if (hasBackgroundContinuationMarker(trimmed)) {
    return trimmed;
  }
  if (!trimmed) {
    return "__PAPERNEXUS_WRAPPER_REQUIRED__ -- __BACKGROUND_CONTINUATION__: true";
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
      : normalizedKind === "idle_research"
        ? requestedCommandText ?? null
      : null);
  if (!commandText) {
    throw new Error(
      isPapernexusBackgroundKind(normalizedKind)
        ? "PaperNexus wrapper runs require an explicit wrapper command. Use research_workflow action run_papernexus_wrapper or pass backgroundRun.commandText with a Python wrapper command."
        : "backgroundRun.commandText is required unless kind=research_pipeline."
    );
  }
  if (
    isPapernexusBackgroundKind(normalizedKind) &&
    /__PAPERNEXUS_WRAPPER_REQUIRED__/i.test(commandText)
  ) {
    throw new Error(
      "PaperNexus wrapper runs require an explicit wrapper command. Use research_workflow action run_papernexus_wrapper or pass backgroundRun.commandText with a Python wrapper command."
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
        isPapernexusBackgroundKind(normalizedKind) &&
        looksLikePapernexusHeavyCommand(commandText)
          ? "papernexus-skill"
          : `workflow-${normalizedKind}`,
      segments:
        isPapernexusBackgroundKind(normalizedKind) &&
        looksLikePapernexusHeavyCommand(commandText)
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
    projectsRoot: params.workflowPolicy.projectsRoot,
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
      projectsRoot: params.workflowPolicy.projectsRoot,
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
  const directLaunch = resolvedProjectRoot
    ? await orchestrateWorkflowTransition({
        transition: {
          projectRoot: resolvedProjectRoot,
          projectId: resolvedProjectId,
          queueKey,
          source: "start_background_run",
          entryType: "background_run",
          ownerAgent: ownerAgent ?? "researcher",
          channelKey: channelKey ?? backgroundSessionKey,
          requesterSessionKey: params.agentCtx.sessionKey,
          messageChannel: params.agentCtx.messageChannel ?? null,
          preferredSessionKey: preferredBackgroundSessionKey,
          family: normalizedFamily,
          kind: normalizedKind,
          summary:
            readString(params.backgroundRun.summary) ??
            `Start background workflow for ${topic ?? ensuredProject?.title ?? resolvedProjectId ?? "the current project"}.`,
          parentSessionKey: params.agentCtx.sessionKey,
          depth: 1,
          runPayload: {
            message: commandText,
            lane: "nested",
            deliver: false,
            idempotencyKey: `openclaw-research:bg:${preferredBackgroundSessionKey}:${queueKey}`,
            extraSystemPrompt:
              "BACKGROUND_WORKFLOW_CONTINUATION=1\n" +
              "This run was launched from a slash-command fast path into a dedicated workflow subagent session.\n" +
              "Continue the requested workflow in the background, keep durable state current, and do not assume the foreground session is available.\n" +
              "Use research_workflow mailbox for bounded handoffs, and do not call research_workflow start_background_run again from this continuation.",
          },
        },
        spawn: async () => {
          const started = await params.runtimeSubagent!.run({
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
          });
          return {
            runId: started.runId,
            sessionKey: backgroundSessionKey,
            runtime: "subagent",
            role: ownerAgent,
            agentId: ownerAgent,
            ownerAgent,
            parentSessionKey: params.agentCtx.sessionKey,
            depth: 1,
          };
        },
      })
    : null;
  if (directLaunch && (!directLaunch.launched || !directLaunch.runId || !directLaunch.sessionKey)) {
    return {
      started: false,
      reason: "runtime_unavailable",
      runId: null,
      sessionKey: null,
      projectRoot:
        ensuredProject?.projectRoot ?? params.snapshot.projectRoot ?? null,
      projectId: ensuredProject?.projectId ?? params.snapshot.projectId ?? null,
      summary:
        directLaunch.error ??
        "Background workflow transition failed before the runtime could start it.",
      reusedIdleSession: Boolean(reusableBackgroundSessionKey),
      activeResearcherSessionsInChannel,
      queued: false,
      queueKey,
    };
  }
  const runId =
    directLaunch?.runId ??
    (
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
      backgroundSessionKey: directLaunch?.sessionKey ?? backgroundSessionKey,
      runId,
      queueKey,
      kind: normalizedKind,
        family: normalizedFamily,
        projectId: resolvedProjectId,
        projectRoot: resolvedProjectRoot,
        projectsRoot: params.workflowPolicy.projectsRoot,
      });
  }

  return {
    started: true,
    reason: "started",
    runId,
    sessionKey: directLaunch?.sessionKey ?? backgroundSessionKey,
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
        : isPapernexusBackgroundKind(normalizedKind)
          ? `${reusableBackgroundSessionKey ? "Reused an idle dedicated PaperNexus subagent and started" : "PaperNexus wrapper-first workflow task started in a dedicated subagent for"} ${readString(params.backgroundRun.projectId) ?? ensuredProject?.projectId ?? "the current project"}.`
        : "Background workflow run started."),
    reusedIdleSession: Boolean(reusableBackgroundSessionKey),
    activeResearcherSessionsInChannel,
    queued: false,
    queueKey,
  };
}
