import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
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
  getPaperIngestionStateSummary,
  setPaperIngestionState,
  type WorkflowGuardPolicy,
} from "./workflow-guard";
import {
  applyPaperIngestionValidationToRequest,
  isQueuedPaperIngestionRetryDue,
  markQueuedPaperIngestionLaunchFailure,
  markQueuedPaperIngestionLaunchStarted,
  validateQueuedPaperIngestionRequest,
} from "./paper-ingestion-validation";
import {
  buildWorkflowSubagentSessionKey,
  derivePapernexusTaskLabel,
  looksLikePapernexusHeavyCommand,
  normalizeWorkflowSubagentParentSessionKey,
} from "./workflow-subagent-sessions";
import { normalizeWorkflowBindingChannelKey } from "./workflow-commands/parsers.js";
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
  acquireBackgroundWorkflowSession as acquireBackgroundWorkflowSessionFromPool,
  clearBackgroundWorkflowRunRegistryForTests as clearBackgroundWorkflowRunRegistryForTestsFromPool,
  getBackgroundWorkflowRunByQueueKey as getBackgroundWorkflowRunByQueueKeyFromPool,
  listBackgroundWorkflowRuns as listBackgroundWorkflowRunsFromPool,
  pruneBackgroundWorkflowRuns as pruneBackgroundWorkflowRunsFromPool,
  recordBackgroundWorkflowRun as recordBackgroundWorkflowRunFromPool,
  retireBackgroundWorkflowRuns as retireBackgroundWorkflowRunsFromPool,
} from "./workflow-background-pool";
import {
  orchestrateWorkflowTransition,
  resumeWorkflowTransition,
} from "./workflow-session-orchestrator.js";
import { reconcileBackgroundRunTerminalState } from "./workflow-background-run-reconcile.js";
import { writePapernexusProgressFromManifest } from "./papernexus-progress";
import { readJsonIfExists } from "./workflow-guard-core/fs";
import { sanitizeProjectIdFragment } from "./workflow-guard-project-state";
import { materializeZoteroSyncPacket } from "./workflow-zotero-sync";
import { materializeExecPacketIfNeeded } from "./workflow-execution/exec-packet";
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

function isGatewaySubagentUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /gateway request/i.test(message) ||
    /runtime\.subagent/i.test(message) ||
    /plugin runtime subagent methods are only available/i.test(message)
  );
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
  extraSystemPrompt?: string;
  dedupeKey?: string;
  triggerKind?: string;
  triggerReason?: string;
};

export type PapernexusWrapperScript =
  | "pn_stage_sync.py"
  | "pn_import_submit.py"
  | "pn_import_queue.py"
  | "pn_batch_import.py"
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
  requireMailboxAcknowledgement: boolean;
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
  channelKey?: string;
};

export type BackgroundRunSnapshot = {
  role: string | null;
  projectRoot: string | null;
  projectId: string | null;
  channelProjectBindingsEnabled: boolean;
};

const MAX_RESEARCHER_BACKGROUND_SUBAGENTS_PER_PROJECT_SCOPE = 2;
const BACKGROUND_RUN_STALE_MS = 60 * 60 * 1000;
const BACKGROUND_QUEUE_STALE_MS = 24 * 60 * 60 * 1000;
const BACKGROUND_QUEUE_RETRY_BACKOFF_MS = 15 * 1000;

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
  "pn_batch_import": "pn_batch_import.py",
  "pn_batch_import.py": "pn_batch_import.py",
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
  "submit",
  "template",
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
      "Unsupported PaperNexus wrapper. Use one of pn_stage_sync.py, pn_import_submit.py, pn_import_queue.py, pn_batch_import.py, pn_graph_query.py, or pn_research_chains.py."
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
    case "graph_build":
    case "zotero_sync":
    case "literature_review":
    case "survey_review":
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

function isReusableBackgroundQueueEntry(entry: BackgroundWorkflowQueueEntry): boolean {
  return ["queued", "launching", "running", "degraded", "needs_repair"].includes(entry.status);
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

function getBackgroundQueuePath(): string {
  const override = readString(
    process.env.OPENCLAW_RESEARCH_BACKGROUND_QUEUE_PATH
  );
  if (override) {
    return path.resolve(override);
  }
  throw new Error(
    "A project-scoped background queue path is required; refusing ephemeral /tmp fallback. Pass projectRoot/projectsRoot or set OPENCLAW_RESEARCH_BACKGROUND_QUEUE_PATH for tests."
  );
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
    lastCheckedAt: entry.lastAttemptedAt,
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
          requireMailboxAcknowledgement:
            entry.dispatchPayload.requireMailboxAcknowledgement === true,
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
  await clearBackgroundWorkflowRunRegistryForTestsFromPool();
}

export async function clearBackgroundWorkflowQueueForTests(): Promise<void> {
  await fs.rm(getBackgroundQueuePath(), { force: true });
}

function deriveBackgroundRunChannelKey(params: {
  channelKey?: string | null;
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
                requireMailboxAcknowledgement:
                  (record.dispatchPayload as Record<string, unknown>)
                    .requireMailboxAcknowledgement === true ||
                  (record.dispatchPayload as Record<string, unknown>)
                    .require_mailbox_acknowledgement === true,
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
  const existing =
    current.find(
      (candidate) =>
        candidate.queueKey === entry.queueKey &&
        isReusableBackgroundQueueEntry(candidate)
    ) ?? null;
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
  return getBackgroundWorkflowRunByQueueKeyFromPool(params);
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
    const checkedAt = new Date(now).toISOString();
    const freshnessReference =
      entry.lastFinishedAt ?? entry.lastCheckedAt ?? entry.startedAt;
    const freshnessMs = Date.parse(freshnessReference);
    if (!Number.isFinite(freshnessMs) || now - freshnessMs > BACKGROUND_RUN_STALE_MS) {
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
        });
      }
      continue;
    }
    let nextEntry: BackgroundRunRegistryEntry = {
      ...entry,
      lastCheckedAt: checkedAt,
    };
    if (entry.status === "active" && params.runtimeSubagent?.waitForRun) {
      try {
        const waited = await params.runtimeSubagent.waitForRun({
          runId: entry.runId,
          timeoutMs: 1,
        });
        if (waited.status === "ok" || waited.status === "error") {
          await reconcileBackgroundRunTerminalState({
            entry,
            terminalStatus: waited.status === "ok" ? "completed" : "failed",
            finishedAt: checkedAt,
            error: waited.status === "error" ? waited.error ?? "Background workflow run failed." : null,
          });
          nextEntry = {
            ...nextEntry,
            status: "idle",
            lastFinishedAt: checkedAt,
          };
        }
      } catch {
        await reconcileBackgroundRunTerminalState({
          entry,
          terminalStatus: "needs_repair",
          finishedAt: checkedAt,
          error: "Background workflow runtime state could not be refreshed and needs repair.",
        });
        kept.push({
          ...nextEntry,
          status: "needs_repair",
          lastFinishedAt: checkedAt,
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
  return listBackgroundWorkflowRunsFromPool(params);
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
  return pruneBackgroundWorkflowRunsFromPool(params);
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

export async function retireBackgroundWorkflowRuns(params: {
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
  statuses?: unknown;
  deleteSessions?: boolean;
}): Promise<{
  kept: BackgroundRunRegistryViewEntry[];
  removed: BackgroundRunRegistryViewEntry[];
}> {
  return retireBackgroundWorkflowRunsFromPool(params);
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
  channelKey?: string | null;
  preferredSessionKey?: string | null;
  family?: string | null;
  kind?: string | null;
  projectId?: string | null;
  projectRoot?: string | null;
  projectsRoot?: string | null;
}): Promise<BackgroundWorkflowSessionLease> {
  return acquireBackgroundWorkflowSessionFromPool(params);
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
  await recordBackgroundWorkflowRunFromPool(params);
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
  channelKey?: string | null;
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
    channelKey: readString(params.channelKey) ?? null,
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
  ignoreRetryBackoff?: boolean;
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
    if (!isBackgroundQueueEntryPending(entry)) {
      continue;
    }
    const lastAttemptedAtMs = entry.lastAttemptedAt
      ? Date.parse(entry.lastAttemptedAt)
      : null;
    if (
      params.ignoreRetryBackoff !== true &&
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
                      requireMailboxAcknowledgement:
                        dispatchPayload.requireMailboxAcknowledgement,
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
                      requireMailboxAcknowledgement:
                        dispatchPayload.requireMailboxAcknowledgement,
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
                requireMailboxAcknowledgement:
                  entry.dispatchPayload.requireMailboxAcknowledgement,
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
                requireMailboxAcknowledgement:
                  entry.dispatchPayload.requireMailboxAcknowledgement,
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

export function buildGraphBuildBackgroundCommand(commandText: string): string {
  const trimmed = commandText.trim();
  if (!trimmed) {
    return '/graph-build "current project" -- __BACKGROUND_CONTINUATION__: true';
  }
  if (hasBackgroundContinuationMarker(trimmed)) {
    return trimmed;
  }
  return `${trimmed} -- __BACKGROUND_CONTINUATION__: true`;
}

export function buildZoteroSyncBackgroundCommand(commandText: string): string {
  const trimmed = commandText.trim();
  if (!trimmed) {
    return '/zotero-sync "current project" -- __BACKGROUND_CONTINUATION__: true';
  }
  if (hasBackgroundContinuationMarker(trimmed)) {
    return trimmed;
  }
  return `${trimmed} -- __BACKGROUND_CONTINUATION__: true`;
}

export function buildLiteratureReviewBackgroundCommand(commandText: string): string {
  const trimmed = commandText.trim();
  if (!trimmed) {
    return '/literature-review "current project" -- __BACKGROUND_CONTINUATION__: true';
  }
  if (hasBackgroundContinuationMarker(trimmed)) {
    return trimmed;
  }
  return `${trimmed} -- __BACKGROUND_CONTINUATION__: true`;
}

export function buildSurveyReviewBackgroundCommand(commandText: string): string {
  const trimmed = commandText.trim();
  if (!trimmed) {
    return '/survey-pipeline "research topic" -- __BACKGROUND_CONTINUATION__: true';
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

function isPapernexusImportLifecycleCommand(text: string | null | undefined): boolean {
  const normalized = (text ?? "").toLowerCase();
  return (
    /\bscripts\/pn_stage_sync\.py\b/.test(normalized) ||
    /\bscripts\/pn_import_submit\.py\b/.test(normalized) ||
    (/\bscripts\/pn_batch_import\.py\b/.test(normalized) &&
      /\b(submit|status|wait)\b/.test(normalized)) ||
    (/\bscripts\/pn_import_queue\.py\b/.test(normalized) &&
      /\b(status|log|wait)\b/.test(normalized))
  );
}

function isPapernexusBatchImportCommand(text: string | null | undefined): boolean {
  const normalized = (text ?? "").toLowerCase();
  return (
    /\bscripts\/pn_batch_import\.py\b/.test(normalized) &&
    /\b(submit|status|wait)\b/.test(normalized)
  );
}

function buildBackgroundWorkflowContinuationSystemPrompt(params?: {
  kind?: string | null;
  commandText?: string | null;
}): string {
  const normalizedKind = readString(params?.kind)?.toLowerCase() ?? null;
  const commandText = readString(params?.commandText) ?? null;
  const graphBuildContinuation =
    normalizedKind === "graph_build" || /^\/graph-build\b/i.test(commandText ?? "");
  const zoteroSyncContinuation =
    normalizedKind === "zotero_sync" || /^\/zotero-sync\b/i.test(commandText ?? "");
  const literatureReviewContinuation =
    normalizedKind === "literature_review" || /^\/literature-review\b/i.test(commandText ?? "");
  const surveyReviewContinuation =
    normalizedKind === "survey_review" || /^\/survey-pipeline\b/i.test(commandText ?? "");
  const graphBuildRepairContinuation =
    graphBuildContinuation &&
    /--repair-import(?:\s+|=)(?:true|1|yes)\b/i.test(commandText ?? "");
  const graphBuildRepairTargetCorpus =
    (() => {
      const match =
        /--shared-corpus(?:\s+|=)(?:"([^"]+)"|'([^']+)'|([^\s]+))/i.exec(
          commandText ?? ""
        );
      return readString(match?.[1] ?? match?.[2] ?? match?.[3] ?? null) ?? null;
    })();
  const papernexusBackground =
    isPapernexusBackgroundKind(normalizedKind ?? "") ||
    looksLikePapernexusHeavyCommand(commandText ?? "");
  const importLifecycleCommand = isPapernexusImportLifecycleCommand(commandText);
  const batchImportCommand = isPapernexusBatchImportCommand(commandText);
  const lines = [
    "BACKGROUND_WORKFLOW_CONTINUATION=1",
    "This run was launched from a slash-command fast path into a dedicated workflow subagent session.",
    "Continue the requested workflow in the background, keep durable state current, and do not assume the foreground session is available.",
    "Use research_workflow mailbox for bounded handoffs, and do not call research_workflow start_background_run again from this continuation.",
  ];
  if (papernexusBackground) {
    lines.push(
      "PaperNexus workflow rule: stay wrapper-first. Use the authenticated Python wrappers and do not fall back to local PaperNexus live-graph CLI work or hand-written REST calls."
    );
  }
  if (graphBuildContinuation) {
    lines.push(
      "Graph-build workflow rule: treat /graph-build as a bounded graph-readiness and brainstorm-refresh pass. The remote PaperNexus import worker performs the real graph mutation; do not turn this continuation into a manual rebuild loop."
    );
    lines.push(
      "During /graph-build, use the local Zotero MCP server through /zotero-project-library and keep the project's bibliography synchronized under the configured project Zotero path (default <zoteroProjectRoot>/<project-id>, where zoteroProjectRoot defaults to bot)."
    );
    lines.push(
      "At minimum, sync the verified canonical paper set into the configured project's selected collection, put baseline-defining papers into the baselines collection, and refresh {PROJ}/researcher/ZOTERO_PACKET.md with collection path, counts, and unresolved metadata cleanup tasks."
    );
    lines.push(
      "Do not wait indefinitely on Zotero work either; keep graph readiness and brainstorm bundle refresh as the primary bounded pass, then complete the bounded project Zotero sync before reporting graph-build completion."
    );
    if (graphBuildRepairContinuation) {
      lines.push(
        "Graph-build repair mode: this continuation was launched because graph sync is still missing papers while ingestion is idle. Treat it as a bounded graph-sync repair pass, not a passive status check."
      );
      if (graphBuildRepairTargetCorpus) {
        lines.push(
          `Lock the repair pass to the shared corpus ${graphBuildRepairTargetCorpus}; do not switch to a project-local or differently named corpus.`
        );
      }
      lines.push(
        "Regenerate one manifest for the missing canonical papers and drive the repair through pn_batch_import.py submit/status/wait instead of hand-rolled loops or repeated one-paper submit commands."
      );
      lines.push(
        "If a prior workflow queue/session is marked needs_repair, treat it as stale bookkeeping and start a fresh bounded repair batch instead of waiting forever on the stale run."
      );
      lines.push(
        "Keep repair progress durable through research_workflow.set_paper_ingestion: mirror active_batches, batch_items, completed_papers, and paper_operations, and clear repair_required only after a fresh batch is running or graph_presence_status becomes ready."
      );
    }
  }
  if (zoteroSyncContinuation) {
    lines.push(
      "Zotero sync workflow rule: treat /zotero-sync as a bounded project-wide bibliography reconciliation pass, not as an inline foreground task."
    );
    lines.push(
      "Use the local Zotero MCP server through /zotero-project-library, reconcile the configured project collections, and keep ZOTERO_SYNC_PACKET.json plus ZOTERO_PACKET.md truthful."
    );
    lines.push(
      "Collection safety rule: remove stale papers only from the project's Zotero collections; do not delete or trash Zotero items themselves."
    );
    lines.push(
      "Foreground responsiveness rule: do not block the foreground session waiting on Zotero MCP work; if Zotero is unavailable, record unavailable or failed state durably and exit."
    );
  }
  if (literatureReviewContinuation) {
    lines.push(
      "Literature-review workflow rule: treat /literature-review as a bounded durable review-packet pass for the current project, not as an endless foreground search session."
    );
    lines.push(
      "Refresh REVIEW_PROTOCOL.md, INCLUDED_PAPERS.json, EXCLUDED_PAPERS.json, SOTA_MATRIX.md, GAP_SYNTHESIS.md, and LITERATURE_REVIEW.md coherently so downstream frontier / plan / writing stages can trust one packet."
    );
    lines.push(
      "Foreground responsiveness rule: keep the foreground chat interruptible while this review pass runs; summarize progress durably rather than monopolizing the session."
    );
  }
  if (surveyReviewContinuation) {
    lines.push(
      "Survey workflow rule: keep the project on the survey_review -> write line. Do not steer this continuation into graph_build, frontier_mapping, idea, plan, code, or experiment unless a human explicitly switches the workflow line."
    );
    lines.push(
      "Use research_workflow.set_survey_review and research_workflow.materialize_survey_review_state to keep survey_review durable while retrieval, screening, and synthesis progress."
    );
    lines.push(
      "If survey literature imports or discovery runs are needed, treat them as bounded substeps inside survey_review instead of clearing paper_ingestion by hand or rewriting experiment-track artifacts."
    );
  }
  if (importLifecycleCommand) {
    if (batchImportCommand) {
      lines.push(
        "PaperNexus batch-import rule: when 2 or more staged papers are being synchronized, use one manifest file with pn_batch_import.py submit/status/wait instead of hand-rolled shell loops or repeated one-paper submit commands."
      );
      lines.push(
        "Reuse the same manifest for submit, status, and wait. Keep each workflow wait pass bounded to 60 seconds or less, then persist progress and let the workflow continue on the next status pass instead of blocking indefinitely."
      );
      lines.push(
        "After each batch status or wait result, call research_workflow.set_paper_ingestion so runtime_status, active_batches, batch_items, completed_papers, and paper_operations stay durable."
      );
      lines.push(
        "Translate the wrapper summary/items view into durable workflow state: active_batches should mirror the batch summary, batch_items should mirror per-paper items, and any synced item should also write completed_papers or terminal paper_operations when appropriate."
      );
      lines.push(
        "Use research_workflow.set_paper_ingestion as the channel-visible progress path; it will keep batch progress visible even if the delegated subagent never sends a free-form chat reply."
      );
    } else {
      lines.push(
        "PaperNexus import rule: process one paper per import task when using pn_import_submit.py, keep each paper within a 60 seconds total wait budget, and do not poll indefinitely."
      );
      lines.push(
        "Before and after each paper import or graph reconcile step, call research_workflow.set_paper_ingestion so runtime_status, import_task_ids, paper_operations, and completed_papers stay durable."
      );
      lines.push(
        "When a paper completes, write completed_papers with canonical_id, title, and import_task_id. When a paper times out or fails, write paper_operations with the terminal status and move on to the next paper."
      );
      lines.push(
        "If more than one staged paper needs syncing, stop using repeated one-paper submits and switch to pn_batch_import.py with one manifest."
      );
      lines.push(
        "Use research_workflow.set_paper_ingestion as the channel-visible progress path; it will broadcast the per-paper completion or timeout update for you."
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function mergeBackgroundWorkflowSystemPrompt(
  basePrompt: string,
  extraPrompt: string | null | undefined
): string {
  const extra = readString(extraPrompt);
  if (!extra) {
    return basePrompt;
  }
  return `${basePrompt.trimEnd()}\n\n${extra.trim()}\n`;
}

function isPaperIngestionStateInFlight(state: {
  runtimeStatus: string;
  importTaskIds: string[];
  completedPapers: unknown[];
  paperOperations: Array<{ status: string }>;
  activeBatches: Array<{ status: string }>;
  batchItems: Array<{ status: string | null }>;
}): boolean {
  if (["waiting_import", "reconciling"].includes(state.runtimeStatus)) {
    return true;
  }
  if (state.paperOperations.some((entry) => ["queued", "running"].includes(entry.status))) {
    return true;
  }
  if (state.activeBatches.some((entry) => ["queued", "running"].includes(entry.status))) {
    return true;
  }
  if (state.batchItems.some((entry) => ["pending", "running"].includes(entry.status ?? ""))) {
    return true;
  }
  return state.importTaskIds.length > 0 && state.completedPapers.length === 0;
}

function buildWorkflowOwnedIngestionRequestPrompt(params: {
  requestId: string;
  triggerKind: string;
  sharedCorpus: string | null;
}): string {
  const lines = [
    `WORKFLOW_OWNED_PAPER_INGESTION_REQUEST_ID=${params.requestId}`,
    `This wrapper run was launched by workflow-owned ${params.triggerKind} trigger, not by ad-hoc agent delegation.`,
    "Treat this as the authoritative upload execution for the queued paper ingestion request and keep the queued_requests entry synchronized through research_workflow.set_paper_ingestion.",
    "When you report progress, include queued_requests with this request_id so status moves through running/completed/failed and preserves last_run_id, last_session_key, last_error, and detail.",
  ];
  if (params.sharedCorpus) {
    lines.push(
      `Use the locked shared corpus ${params.sharedCorpus} for this queued upload request and do not switch corpora mid-run.`
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function maybeTriggerQueuedPaperIngestionRequest(params: {
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
  triggerKind: string;
  projectRoot: string | null;
  projectId: string | null;
  ensureProjectBinding?: boolean;
}): Promise<BackgroundRunStartResult | null> {
  if (!params.projectRoot) {
    return null;
  }
  const ingestion = await getPaperIngestionStateSummary({
    projectRoot: params.projectRoot,
  });
  const inFlight = isPaperIngestionStateInFlight(ingestion.state);
  const now = new Date().toISOString();
  const queuedCandidate =
    ingestion.state.queuedRequests.find((entry) =>
      isQueuedPaperIngestionRetryDue(entry, now)
    ) ??
    (!inFlight
      ? ingestion.state.queuedRequests.find((entry) =>
          ["launching", "running"].includes(entry.status)
        ) ?? null
      : null);
  if (!queuedCandidate || !queuedCandidate.commandText) {
    return null;
  }

  const staleRunning = ["launching", "running"].includes(queuedCandidate.status);
  if (staleRunning) {
    await setPaperIngestionState({
      projectRoot: params.projectRoot,
      paperIngestion: {
        queued_requests: [
          {
            request_id: queuedCandidate.requestId,
            wrapper: queuedCandidate.wrapper,
            command_text: queuedCandidate.commandText,
            manifest_path: queuedCandidate.manifestPath,
            summary: queuedCandidate.summary,
            status: "needs_repair",
            updated_at: now,
            detail:
              "Workflow detected a stale running upload request with no active ingestion state; requeueing it for a fresh workflow-owned launch.",
          },
        ],
      },
    });
  }

  const validationReport = await validateQueuedPaperIngestionRequest({
    projectRoot: params.projectRoot,
    request: queuedCandidate,
  });
  const validatedRequest = applyPaperIngestionValidationToRequest({
    request: queuedCandidate,
    report: validationReport,
    nowIso: now,
  });
  if (validatedRequest.status === "needs_repair") {
    const blockedRequest = markQueuedPaperIngestionLaunchFailure({
      request: validatedRequest,
      nowIso: now,
      error: validationReport.summary,
    });
    await setPaperIngestionState({
      projectRoot: params.projectRoot,
      paperIngestion: {
        queued_requests: [
          {
            request_id: blockedRequest.requestId,
            wrapper: blockedRequest.wrapper,
            command_text: blockedRequest.commandText,
            manifest_path: blockedRequest.manifestPath,
            summary: blockedRequest.summary,
            status: blockedRequest.status,
            updated_at: blockedRequest.updatedAt,
            detail: blockedRequest.detail,
            last_error: blockedRequest.lastError,
            validation_status: blockedRequest.validationStatus,
            validation_summary: blockedRequest.validationSummary,
            validation_report_path: blockedRequest.validationReportPath,
            attempt_count: blockedRequest.attemptCount,
            max_attempts: blockedRequest.maxAttempts,
            last_attempt_at: blockedRequest.lastAttemptAt,
            next_retry_at: blockedRequest.nextRetryAt,
            dead_letter_at: blockedRequest.deadLetterAt,
            dead_letter_reason: blockedRequest.deadLetterReason,
          },
        ],
      },
    });
    return null;
  }

  const requestPrompt = buildWorkflowOwnedIngestionRequestPrompt({
    requestId: queuedCandidate.requestId,
    triggerKind: params.triggerKind,
    sharedCorpus: queuedCandidate.sharedCorpus,
  });
  const result = await startBackgroundWorkflowRun({
    runtimeSubagent: params.runtimeSubagent,
    workflowPolicy: params.workflowPolicy,
    agentCtx: params.agentCtx,
    snapshot: {
      ...params.snapshot,
      projectRoot: params.projectRoot,
      projectId: params.projectId,
    },
    backgroundRun: {
      kind: "papernexus_wrapper",
      commandText: queuedCandidate.commandText,
      summary:
        queuedCandidate.summary ??
        `Workflow-triggered paper ingestion request ${queuedCandidate.requestId}.`,
      projectId: params.projectId ?? undefined,
      projectRoot: params.projectRoot,
      ensureProjectBinding: params.ensureProjectBinding !== false,
      extraSystemPrompt: requestPrompt,
    },
  });

  const launchRequest = result.started
    ? markQueuedPaperIngestionLaunchStarted({
        request: validatedRequest,
        nowIso: new Date().toISOString(),
        runId: result.runId,
        sessionKey: result.sessionKey,
        triggerKind: params.triggerKind,
        summary: `Workflow-triggered upload started from ${params.triggerKind}.`,
      })
    : markQueuedPaperIngestionLaunchFailure({
        request: validatedRequest,
        nowIso: new Date().toISOString(),
        error:
          result.summary ??
          `Workflow tried to trigger upload from ${params.triggerKind} but it remained queued (${result.reason}).`,
      });
  await setPaperIngestionState({
    projectRoot: params.projectRoot,
    paperIngestion: {
      queued_requests: [
        {
          request_id: launchRequest.requestId,
          wrapper: launchRequest.wrapper,
          command_text: launchRequest.commandText,
          manifest_path: launchRequest.manifestPath,
          summary: launchRequest.summary,
          status: launchRequest.status,
          updated_at: launchRequest.updatedAt,
          started_at: launchRequest.startedAt,
          last_run_id: launchRequest.lastRunId,
          last_session_key: launchRequest.lastSessionKey,
          last_error: launchRequest.lastError,
          trigger_kind: launchRequest.triggerKind,
          detail: launchRequest.detail,
          validation_status: launchRequest.validationStatus,
          validation_summary: launchRequest.validationSummary,
          validation_report_path: launchRequest.validationReportPath,
          attempt_count: launchRequest.attemptCount,
          max_attempts: launchRequest.maxAttempts,
          last_attempt_at: launchRequest.lastAttemptAt,
          next_retry_at: launchRequest.nextRetryAt,
          dead_letter_at: launchRequest.deadLetterAt,
          dead_letter_reason: launchRequest.deadLetterReason,
        },
      ],
    },
  });
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(params.projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  await writePapernexusProgressFromManifest({
    projectRoot: params.projectRoot,
    manifest,
    ownerRun: {
      run_id: result.runId,
      session_key: result.sessionKey,
      queue_key: result.queueKey,
      wrapper: launchRequest.wrapper,
    },
    updatedAt: new Date().toISOString(),
  });

  return result;
}

async function queueBackgroundWorkflowUntilRuntimeRecovers(params: {
  workflowPolicy: WorkflowGuardPolicy;
  agentCtx: BackgroundRunAgentContext;
  ownerAgent: string | null;
  queueKey: string;
  preferredSessionKey: string;
  family: string;
  kind: string;
  projectId: string | null;
  projectRoot: string | null;
  summary: string | null;
  commandText: string;
  extraSystemPrompt?: string | null;
  reusableBackgroundSessionKey?: string | null;
  activeResearcherSessionsInChannel?: number | null;
  unavailableReason?: string | null;
}): Promise<BackgroundRunStartResult> {
  const queued = await enqueueQueuedBackgroundWorkflowRun({
    source: "start_background_run",
    ownerAgent: params.ownerAgent,
    requesterSessionKey: params.agentCtx.sessionKey,
    messageChannel: params.agentCtx.messageChannel,
    channelKey: params.agentCtx.channelKey,
    preferredSessionKey: params.preferredSessionKey,
    family: params.family,
    kind: params.kind,
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    projectsRoot: params.workflowPolicy.projectsRoot,
    queueKey: params.queueKey,
    summary: params.summary,
    runPayload: {
      message: params.commandText,
      lane: "nested",
      deliver: false,
      idempotencyKey: `openclaw-research:bg:${params.preferredSessionKey}:${params.queueKey}`,
      extraSystemPrompt: mergeBackgroundWorkflowSystemPrompt(
        buildBackgroundWorkflowContinuationSystemPrompt({
          kind: params.kind,
          commandText: params.commandText,
        }),
        params.extraSystemPrompt
      ),
    },
  });
  const targetLabel =
    params.projectId ?? params.projectRoot ?? "the current project";
  const recoveryNote = readString(params.unavailableReason);
  return {
    started: false,
    reason: "runtime_unavailable",
    runId: null,
    sessionKey: null,
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    summary:
      `Queued background workflow for ${targetLabel} because the command runtime ` +
      `could not access a gateway-bound subagent session. It will auto-start when a ` +
      `later workflow command or the workflow coordinator regains runtime access` +
      `${queued.queuePosition > 0 ? ` (queue position ${queued.queuePosition})` : ""}.` +
      `${recoveryNote ? ` Cause: ${recoveryNote}` : ""}`,
    reusedIdleSession: Boolean(params.reusableBackgroundSessionKey),
    activeResearcherSessionsInChannel:
      params.activeResearcherSessionsInChannel ?? null,
    queued: true,
    queueKey: queued.entry.queueKey,
  };
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
  const derivedSurveyProjectId =
    normalizedKind === "survey_review" && topic
      ? `survey-${sanitizeProjectIdFragment(topic)}`
      : null;
  const resolvedBackgroundProjectId =
    readString(params.backgroundRun.projectId) ??
    derivedSurveyProjectId ??
    params.snapshot.projectId;
  const resolvedBackgroundTitle =
    readString(params.backgroundRun.title) ?? topic;
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
      channelKey: params.agentCtx.channelKey,
      projectRoot: readString(params.backgroundRun.projectRoot) ?? params.snapshot.projectRoot,
      projectId: resolvedBackgroundProjectId,
      title: resolvedBackgroundTitle,
      topic,
      workflowLine: normalizedKind === "survey_review" ? "survey" : undefined,
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
        channelKey: params.agentCtx.channelKey,
        projectRoot: ensuredProject.projectRoot,
        projectId: ensuredProject.projectId,
        title: ensuredProject.title,
        topic,
        boundByAgent: params.agentCtx.agentId ?? params.snapshot.role,
        notes: "Auto-bound during slash fast-path workflow startup.",
      });
    }
  }

  let commandText =
    requestedCommandText ??
    (normalizedKind === "research_pipeline"
      ? buildResearchPipelineBackgroundCommand(
          `/research-pipeline "${topic ?? ensuredProject?.title ?? "research topic"}"`
        )
      : normalizedKind === "research_queue"
        ? buildResearchQueueBackgroundCommand(
            `/research-queue "${topic ?? ensuredProject?.title ?? "status"}"`
          )
      : normalizedKind === "graph_build"
        ? buildGraphBuildBackgroundCommand(
            `/graph-build "${topic ?? ensuredProject?.title ?? readString(params.backgroundRun.projectId) ?? "current project"}"`
          )
      : normalizedKind === "zotero_sync"
        ? buildZoteroSyncBackgroundCommand(
            `/zotero-sync "${topic ?? ensuredProject?.title ?? readString(params.backgroundRun.projectId) ?? "current project"}"`
          )
      : normalizedKind === "literature_review"
        ? buildLiteratureReviewBackgroundCommand(
            `/literature-review "${topic ?? ensuredProject?.title ?? readString(params.backgroundRun.projectId) ?? "current project"}"`
          )
      : normalizedKind === "survey_review"
        ? buildSurveyReviewBackgroundCommand(
            `/survey-pipeline "${topic ?? ensuredProject?.title ?? "research topic"}"`
          )
      : normalizedKind === "idle_research"
        ? requestedCommandText ?? null
      : null);
  if (!commandText) {
    throw new Error(
      isPapernexusBackgroundKind(normalizedKind)
        ? "PaperNexus wrapper runs require an explicit wrapper command. Use research_workflow action run_papernexus_wrapper or pass backgroundRun.commandText with a Python wrapper command."
        : "backgroundRun.commandText is required unless kind=research_pipeline, research_queue, graph_build, zotero_sync, literature_review, or survey_review."
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
    channelKey: params.agentCtx.channelKey,
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
  let backgroundRunExtraSystemPrompt = readString(params.backgroundRun.extraSystemPrompt) ?? null;
  if (
    (normalizedKind === "graph_build" || normalizedKind === "zotero_sync") &&
    resolvedProjectRoot &&
    resolvedProjectId
  ) {
    const packet = await materializeZoteroSyncPacket({
      projectRoot: resolvedProjectRoot,
      projectId: resolvedProjectId,
      zoteroProjectRoot: params.workflowPolicy.zoteroProjectRoot,
      trigger:
        readString(params.backgroundRun.triggerKind) ??
        (normalizedKind === "graph_build" ? "graph_build" : "manual_command"),
      triggerReason: readString(params.backgroundRun.triggerReason) ?? null,
    });
    const packetPrompt = [
      "Zotero sync packet path: {PROJ}/researcher/ZOTERO_SYNC_PACKET.json",
      `Effective Zotero project path: ${packet.zoteroProjectPath ?? "<configured-root>/<project-id>"}.`,
      normalizedKind === "graph_build"
        ? "During graph-build, keep selected and baselines synchronized against workflow-owned project state and refresh writing-shortlist only when the project has one."
        : "Reconcile selected, baselines, and writing-shortlist against workflow-owned project state.",
      "If a paper no longer belongs to the project, remove it only from the project collections and never delete or trash the Zotero item.",
      normalizedKind === "graph_build"
        ? "Do not block graph-build or the foreground session while waiting on Zotero MCP work; record unavailable or failed state durably and keep the pass bounded."
        : "Do not block the foreground session while waiting on Zotero MCP work.",
      "Credential rule: if Zotero MCP requires ZOTERO_API_KEY or ZOTERO_USER_ID, rely on the MCP server environment and never expect plugin-managed credential fields.",
    ].join("\n");
    backgroundRunExtraSystemPrompt = backgroundRunExtraSystemPrompt
      ? mergeBackgroundWorkflowSystemPrompt(
          backgroundRunExtraSystemPrompt,
          packetPrompt
        )
      : packetPrompt;
  }
  const execPayload = await materializeExecPacketIfNeeded({
    projectRoot: resolvedProjectRoot,
    projectId: resolvedProjectId,
    stage: normalizedKind,
    ownerRole: ownerAgent,
    commandText,
    extraBody: backgroundRunExtraSystemPrompt,
    budgetKind: "background_command",
  });
  if (execPayload.materialized || execPayload.commandForDispatch !== commandText) {
    commandText = execPayload.commandForDispatch;
    backgroundRunExtraSystemPrompt = execPayload.extraBodyForDispatch;
  }
  const queueKey = buildBackgroundRunQueueKey({
    requesterSessionKey: params.agentCtx.sessionKey,
    family: normalizedFamily,
    kind: normalizedKind,
    projectId: resolvedProjectId,
    projectRoot: resolvedProjectRoot,
    topic: readString(params.backgroundRun.dedupeKey) ?? topic,
    commandText,
  });
  const pendingQueueState = await hasPendingBackgroundWorkflowQueueKey({
    queueKey,
    projectId: resolvedProjectId,
    projectRoot: resolvedProjectRoot,
    projectsRoot: params.workflowPolicy.projectsRoot,
  });
  if (pendingQueueState.active) {
    return {
      started: false,
      reason: "session_unavailable",
      runId: null,
      sessionKey: null,
      projectRoot:
        ensuredProject?.projectRoot ?? params.snapshot.projectRoot ?? null,
      projectId: ensuredProject?.projectId ?? params.snapshot.projectId ?? null,
      summary:
        readString(params.backgroundRun.summary) ??
        `Background workflow is already running for ${topic ?? ensuredProject?.title ?? resolvedProjectId ?? "the current project"}.`,
      reusedIdleSession: false,
      activeResearcherSessionsInChannel: null,
      queued: false,
      queueKey,
    };
  }
  if (pendingQueueState.queued) {
    return {
      started: false,
      reason: "session_unavailable",
      runId: null,
      sessionKey: null,
      projectRoot:
        ensuredProject?.projectRoot ?? params.snapshot.projectRoot ?? null,
      projectId: ensuredProject?.projectId ?? params.snapshot.projectId ?? null,
      summary:
        readString(params.backgroundRun.summary) ??
        `Background workflow is already queued for ${topic ?? ensuredProject?.title ?? resolvedProjectId ?? "the current project"}.`,
      reusedIdleSession: false,
      activeResearcherSessionsInChannel: null,
      queued: true,
      queueKey,
    };
  }
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
          ? [derivePapernexusTaskLabel(commandText)]
          : [resolvedProjectId, topic],
    }) ?? params.agentCtx.sessionKey;
  const continuationSystemPrompt = buildBackgroundWorkflowContinuationSystemPrompt({
    kind: normalizedKind,
    commandText,
  });
  const mergedContinuationSystemPrompt = mergeBackgroundWorkflowSystemPrompt(
    continuationSystemPrompt,
    backgroundRunExtraSystemPrompt
  );
  const queueIfRuntimeUnavailable = async (reason?: string | null) =>
    queueBackgroundWorkflowUntilRuntimeRecovers({
      workflowPolicy: params.workflowPolicy,
      agentCtx: params.agentCtx,
      ownerAgent,
      queueKey,
      preferredSessionKey: preferredBackgroundSessionKey,
      family: normalizedFamily,
      kind: normalizedKind,
      projectId: resolvedProjectId,
      projectRoot: resolvedProjectRoot,
      summary:
        readString(params.backgroundRun.summary) ??
        `Queued background workflow for ${topic ?? ensuredProject?.title ?? resolvedProjectId ?? "the current project"}.`,
      commandText,
      extraSystemPrompt: backgroundRunExtraSystemPrompt,
      unavailableReason: reason,
    });

  if (!params.runtimeSubagent) {
    return queueIfRuntimeUnavailable(
      "Background workflow execution requires gateway runtime.subagent access."
    );
  }

  if (
    resolvedProjectRoot &&
    (normalizedKind === "graph_build" || normalizedKind === "resume_pipeline")
  ) {
    await maybeTriggerQueuedPaperIngestionRequest({
      runtimeSubagent: params.runtimeSubagent,
      workflowPolicy: params.workflowPolicy,
      agentCtx: params.agentCtx,
      snapshot: {
        ...params.snapshot,
        projectRoot: resolvedProjectRoot,
        projectId: resolvedProjectId,
      },
      triggerKind: normalizedKind,
      projectRoot: resolvedProjectRoot,
      projectId: resolvedProjectId,
    });
  }

  const sessionLease = await acquireBackgroundWorkflowSession({
    runtimeSubagent: params.runtimeSubagent,
    ownerAgent,
    requesterSessionKey: params.agentCtx.sessionKey,
    messageChannel: params.agentCtx.messageChannel,
    channelKey: params.agentCtx.channelKey,
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
      channelKey: params.agentCtx.channelKey,
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
        extraSystemPrompt: mergedContinuationSystemPrompt,
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
        `${MAX_RESEARCHER_BACKGROUND_SUBAGENTS_PER_PROJECT_SCOPE} active Researcher background subagents are already running for this project on the current channel. ` +
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
            extraSystemPrompt: mergedContinuationSystemPrompt,
          },
        },
        spawn: async () => {
          const started = await params.runtimeSubagent!.run({
            sessionKey: backgroundSessionKey,
            message: commandText,
            lane: "nested",
            deliver: false,
            idempotencyKey: `openclaw-research:bg:${backgroundSessionKey}:${Date.now()}`,
            extraSystemPrompt: mergedContinuationSystemPrompt,
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
    if (isGatewaySubagentUnavailableError(directLaunch.error)) {
      return queueBackgroundWorkflowUntilRuntimeRecovers({
        workflowPolicy: params.workflowPolicy,
        agentCtx: params.agentCtx,
        ownerAgent,
        queueKey,
        preferredSessionKey: preferredBackgroundSessionKey,
        family: normalizedFamily,
        kind: normalizedKind,
        projectId:
          ensuredProject?.projectId ?? params.snapshot.projectId ?? null,
        projectRoot:
          ensuredProject?.projectRoot ?? params.snapshot.projectRoot ?? null,
        summary:
          readString(params.backgroundRun.summary) ??
          `Queued background workflow for ${topic ?? ensuredProject?.title ?? resolvedProjectId ?? "the current project"}.`,
        commandText,
        extraSystemPrompt: backgroundRunExtraSystemPrompt,
        reusableBackgroundSessionKey,
        activeResearcherSessionsInChannel,
        unavailableReason: directLaunch.error,
      });
    }
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
  let runId: string;
  try {
    runId =
      directLaunch?.runId ??
      (
        await params.runtimeSubagent.run({
          sessionKey: backgroundSessionKey,
          message: commandText,
          lane: "nested",
          deliver: false,
          idempotencyKey: `openclaw-research:bg:${backgroundSessionKey}:${Date.now()}`,
          extraSystemPrompt: mergedContinuationSystemPrompt,
        })
      ).runId;
  } catch (error) {
    if (!isGatewaySubagentUnavailableError(error)) {
      throw error;
    }
    return queueBackgroundWorkflowUntilRuntimeRecovers({
      workflowPolicy: params.workflowPolicy,
      agentCtx: params.agentCtx,
      ownerAgent,
      queueKey,
      preferredSessionKey: preferredBackgroundSessionKey,
      family: normalizedFamily,
      kind: normalizedKind,
      projectId:
        ensuredProject?.projectId ?? params.snapshot.projectId ?? null,
      projectRoot:
        ensuredProject?.projectRoot ?? params.snapshot.projectRoot ?? null,
      summary:
        readString(params.backgroundRun.summary) ??
        `Queued background workflow for ${topic ?? ensuredProject?.title ?? resolvedProjectId ?? "the current project"}.`,
      commandText,
      extraSystemPrompt: backgroundRunExtraSystemPrompt,
      reusableBackgroundSessionKey,
      activeResearcherSessionsInChannel,
      unavailableReason: error instanceof Error ? error.message : String(error),
    });
  }

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
        : normalizedKind === "graph_build"
          ? `${reusableBackgroundSessionKey ? "Reused an idle Researcher subagent and started" : "Background graph build started for"} ${readString(params.backgroundRun.projectId) ?? ensuredProject?.projectId ?? params.snapshot.projectId ?? "the current project"}.`
        : normalizedKind === "literature_review"
          ? `${reusableBackgroundSessionKey ? "Reused an idle Researcher subagent and started" : "Background literature review started for"} ${topic ?? ensuredProject?.title ?? readString(params.backgroundRun.projectId) ?? params.snapshot.projectId ?? "the current project"}.`
        : normalizedKind === "survey_review"
          ? `${reusableBackgroundSessionKey ? "Reused an idle Researcher subagent and started" : "Background survey pipeline started for"} ${topic ?? ensuredProject?.title ?? readString(params.backgroundRun.projectId) ?? "the current topic"}.`
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
