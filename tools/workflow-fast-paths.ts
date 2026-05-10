import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  dispatchWorkflowTaskToAgent,
  deriveAgentSessionKeyForRole,
  resolveWorkflowDispatchLaunchRunId,
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
  listChannelProjectBindingsForWorkflow,
  setPaperIngestionState,
  type PaperIngestionQueuedRequest,
  type PaperIngestionState,
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
  isPaperIngestionExecutableUploadRequest,
  INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON,
  isInvalidCompletedWorkflowOwnedLiteratureRequisitionRequest,
  isWorkflowOwnedLiteratureRequisitionRequest,
  serializePaperIngestionQueuedRequest,
} from "./workflow-guard-state/paper-ingestion";
import {
  buildPapernexusScriptRelativePath,
  executePapernexusBatchImportRequest,
  getPapernexusBatchImportArgs,
  isPapernexusBatchImportLifecycleRequest,
  type PapernexusBatchExecutionState,
} from "./papernexus-batch-executor.js";
import type { PapernexusRemoteAccessConfig } from "./papernexus-secret";
import {
  buildWorkflowSubagentSessionKey,
  derivePapernexusTaskLabel,
  looksLikePapernexusHeavyCommand,
  normalizeWorkflowSubagentParentSessionKey,
} from "./workflow-subagent-sessions";
import {
  isWeakWorkflowBindingChannelKey,
  normalizeWorkflowBindingChannelKey,
} from "./workflow-commands/parsers.js";
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
import {
  isWorkflowRuntimeTrackingMissError,
  reconcileBackgroundRunTerminalState,
} from "./workflow-background-run-reconcile.js";
import { isProviderCapacityFailure } from "./provider-capacity.js";
import { writePapernexusProgressFromManifest } from "./papernexus-progress";
import {
  readJsonIfExists,
  writeJsonAtomicEnsured,
} from "./workflow-guard-core/fs";
import { shouldUseChannelProjectBindingForWorkflow } from "./workflow-message-channels.js";
import { recordWorkflowNotificationChannelForProject } from "./workflow-notification-channels.js";
import { sanitizeProjectIdFragment } from "./workflow-guard-project-state";
import { materializeZoteroSyncPacket } from "./workflow-zotero-sync";
import { materializeExecPacketIfNeeded } from "./workflow-execution/exec-packet";
import { detectWorkflowPaperArtifactTerminal } from "./workflow-paper-terminal";
import type {
  WorkflowExecutionRuntime,
  WorkflowExecutionSessionInspection,
  WorkflowExecutionRuntimeLike,
} from "./workflow-execution-runtime.js";
import type {
  WorkflowRuntimeQueueEntry as PersistedWorkflowRuntimeQueueEntry,
  WorkflowRuntimeSessionEntry as PersistedWorkflowRuntimeSessionEntry,
} from "./workflow-runtime-state.js";
import {
  getPromptLines,
  loadWorkflowPromptConfig,
  renderPromptLines,
  type WorkflowPromptConfig,
} from "./workflow-prompt-config";

type WorkflowRuntimeApi = WorkflowExecutionRuntime;
type WorkflowRuntimeMonitorApi = WorkflowExecutionRuntimeLike;

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function loadWorkflowFastPathPromptConfig(
  workflowPolicy?: WorkflowGuardPolicy | null
): WorkflowPromptConfig {
  return loadWorkflowPromptConfig({
    configPath: workflowPolicy?.promptConfigPath ?? null,
  });
}

function normalizeAgentId(value: unknown): string | null {
  return readString(value)?.toLowerCase() ?? null;
}

function asDispatchableWorkflowRole(
  value: string | null | undefined
): DispatchableWorkflowRole | null {
  const normalized = normalizeAgentId(value);
  return normalized === "researcher" ||
    normalized === "planner" ||
    normalized === "orchestrator" ||
    normalized === "coder" ||
    normalized === "analyzer" ||
    normalized === "academic_writer" ||
    normalized === "reviewer" ||
    normalized === "cross-reviewer"
    ? (normalized as DispatchableWorkflowRole)
    : null;
}

function buildPapernexusRemoteAccessConfigFromPolicy(
  workflowPolicy: WorkflowGuardPolicy
): PapernexusRemoteAccessConfig {
  return {
    apiBaseUrl: workflowPolicy.papernexusApiBaseUrl,
    mcpUrl: workflowPolicy.papernexusMcpUrl,
    mcpTransport: workflowPolicy.papernexusMcpTransport,
    mcpTimeoutMs: workflowPolicy.papernexusMcpTimeoutMs,
    allowLocalMcp: workflowPolicy.papernexusAllowLocalMcp,
    tokenSource: workflowPolicy.papernexusApiTokenSource,
    tokenEnv: workflowPolicy.papernexusApiTokenEnv,
    tokenService: workflowPolicy.papernexusApiTokenService,
    tokenAccount: workflowPolicy.papernexusApiTokenAccount,
    mineruHttpUrl: workflowPolicy.papernexusMineruHttpUrl,
    tokenLookupTimeoutMs: workflowPolicy.papernexusApiTokenLookupTimeoutMs,
    sshTarget: workflowPolicy.papernexusSshTarget,
    remoteStagingRoot: workflowPolicy.papernexusRemoteStagingRoot,
  };
}

function appendBatchImportSubmitRemoteStagingArgsForPolicy(
  args: string[],
  workflowPolicy: WorkflowGuardPolicy
) {
  if (!args.includes("submit")) {
    return;
  }
  const sshTarget = readString(workflowPolicy.papernexusSshTarget);
  if (sshTarget && !args.includes("--ssh-target")) {
    args.push("--ssh-target", sshTarget);
  }
  const remoteStagingRoot = readString(workflowPolicy.papernexusRemoteStagingRoot);
  if (remoteStagingRoot && !args.includes("--remote-staging-root")) {
    args.push("--remote-staging-root", remoteStagingRoot);
  }
}

function readAgentIdFromSessionKey(sessionKey: string | null | undefined): string | null {
  const normalized = readString(sessionKey);
  if (!normalized?.startsWith("agent:")) {
    return null;
  }
  const parts = normalized.split(":");
  return parts.length >= 2 ? normalizeAgentId(parts[1]) : null;
}

function resolveRequesterSessionKeyForOwner(params: {
  requesterSessionKey?: string | null;
  ownerAgent?: string | null;
}): string | null {
  const requesterSessionKey = readString(params.requesterSessionKey) ?? null;
  const ownerRole = asDispatchableWorkflowRole(params.ownerAgent ?? null);
  if (!requesterSessionKey || !ownerRole) {
    return requesterSessionKey;
  }
  const sessionRole = readAgentIdFromSessionKey(requesterSessionKey);
  if (sessionRole === ownerRole) {
    return requesterSessionKey;
  }
  return deriveAgentSessionKeyForRole({
    requesterSessionKey,
    targetRole: ownerRole,
  });
}

function isGatewaySubagentUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /gateway request/i.test(message) ||
    /runtime\.subagent/i.test(message) ||
    /plugin runtime subagent methods are only available/i.test(message)
  );
}

function isWorkflowSessionInspectionTainted(
  inspection: WorkflowExecutionSessionInspection | null | undefined
): boolean {
  if (!inspection) {
    return false;
  }
  const normalizedStatus = inspection.status?.trim().toLowerCase() ?? null;
  if (
    normalizedStatus === "failed" ||
    normalizedStatus === "completed" ||
    normalizedStatus === "aborted"
  ) {
    return true;
  }
  return (
    inspection.abortedLastRun ||
    inspection.liveModelSwitchPending ||
    Boolean(inspection.providerOverride) ||
    Boolean(inspection.modelOverride)
  );
}

async function maybeRotateBackgroundSessionKey(params: {
  workflowRuntime?: WorkflowRuntimeApi;
  sessionKey: string | null;
  parentSessionKey: string | null | undefined;
  purpose: string;
  segments?: Array<string | null | undefined>;
}): Promise<string | null> {
  const sessionKey = readString(params.sessionKey) ?? null;
  if (!sessionKey || !params.workflowRuntime?.inspectSession) {
    return sessionKey;
  }
  const inspection = await params.workflowRuntime.inspectSession({ sessionKey });
  if (!isWorkflowSessionInspectionTainted(inspection)) {
    return sessionKey;
  }
  return (
    buildWorkflowSubagentSessionKey({
      parentSessionKey: params.parentSessionKey,
      purpose: params.purpose,
      segments: [...(params.segments ?? []), `run-${randomUUID().slice(0, 8)}`],
    }) ?? sessionKey
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
  | "pn_paper_index.py"
  | "pn_paper_refresh.py"
  | "pn_main_graph_name.py"
  | "pn_idea_catalyst.py"
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
  nextRetryAt: string | null;
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
const BACKGROUND_QUEUE_ORPHAN_GRACE_MS = 15 * 1000;

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
  "pn_paper_index": "pn_paper_index.py",
  "pn_paper_index.py": "pn_paper_index.py",
  "pn_paper_refresh": "pn_paper_refresh.py",
  "pn_paper_refresh.py": "pn_paper_refresh.py",
  "pn_main_graph_name": "pn_main_graph_name.py",
  "pn_main_graph_name.py": "pn_main_graph_name.py",
  "pn_idea_catalyst": "pn_idea_catalyst.py",
  "pn_idea_catalyst.py": "pn_idea_catalyst.py",
  "pn_graph_query": "pn_graph_query.py",
  "pn_graph_query.py": "pn_graph_query.py",
  "pn_research_chains": "pn_research_chains.py",
  "pn_research_chains.py": "pn_research_chains.py",
};

const PAPERNEXUS_WRAPPER_SCRIPT_PATHS: Record<PapernexusWrapperScript, string> = {
  "pn_stage_sync.py": buildPapernexusScriptRelativePath("pn_stage_sync.py"),
  "pn_import_submit.py": buildPapernexusScriptRelativePath("pn_import_submit.py"),
  "pn_import_queue.py": buildPapernexusScriptRelativePath("pn_import_queue.py"),
  "pn_batch_import.py": buildPapernexusScriptRelativePath("pn_batch_import.py"),
  "pn_paper_index.py": buildPapernexusScriptRelativePath("pn_paper_index.py"),
  "pn_graph_query.py": buildPapernexusScriptRelativePath("pn_graph_query.py"),
  "pn_research_chains.py": buildPapernexusScriptRelativePath("pn_research_chains.py"),
  "pn_paper_refresh.py": "skills/researcher/papernexus-paper-refresh/scripts/pn_paper_refresh.py",
  "pn_main_graph_name.py": "skills/researcher/papernexus-main-graph-name/scripts/pn_main_graph_name.py",
  "pn_idea_catalyst.py": "skills/researcher/papernexus-idea-catalyst/scripts/pn_idea_catalyst.py",
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
  "paper-index",
  "refresh",
  "queue_progress",
  "progress",
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

function isResearchBackgroundQueueKind(entry: BackgroundWorkflowQueueEntry): boolean {
  return (
    entry.entryType === "background_run" &&
    entry.family === "research" &&
    (entry.kind === "research_queue" || entry.kind === "research_pipeline")
  );
}

function isRetirableAfterTerminalPaperArtifact(
  entry: BackgroundWorkflowQueueEntry
): boolean {
  return isResearchBackgroundQueueKind(entry) || entry.entryType === "dispatch_task";
}

async function detectTerminalPaperArtifactForBackgroundEntry(
  entry: BackgroundWorkflowQueueEntry
) {
  const projectRoot = readString(entry.projectRoot);
  if (!projectRoot || !isRetirableAfterTerminalPaperArtifact(entry)) {
    return null;
  }
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? null;
  const lane = readString(entry.projectId)?.startsWith("survey-")
    ? "survey"
    : "experiment";
  const terminal = await detectWorkflowPaperArtifactTerminal({
    projectRoot,
    manifest,
    lane,
  });
  return terminal.terminal ? terminal : null;
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
      "Unsupported PaperNexus wrapper. Use one of pn_stage_sync.py, pn_import_submit.py, pn_import_queue.py, pn_batch_import.py, pn_paper_index.py, pn_paper_refresh.py, pn_graph_query.py, pn_research_chains.py, pn_main_graph_name.py, or pn_idea_catalyst.py."
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
    PAPERNEXUS_WRAPPER_SCRIPT_PATHS[script],
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

function isAutoDispatchQueueEntry(entry: BackgroundWorkflowQueueEntry): boolean {
  return (
    entry.entryType === "dispatch_task" &&
    (entry.source === "workflow_auto_stage" ||
      entry.source === "workflow_auto_mitigation")
  );
}

function hasDurableProjectBindingForWorkflowQueue(params: {
  workflowPolicy?: WorkflowGuardPolicy | null;
  projectRoot: string | null | undefined;
}): boolean {
  const projectRoot = readString(params.projectRoot);
  if (!projectRoot) {
    return false;
  }
  const bindings = listChannelProjectBindingsForWorkflow({
    policy: params.workflowPolicy ?? undefined,
    workspaceDir: projectRoot,
  });
  return bindings.bindings.some(
    (entry) =>
      path.resolve(entry.projectRoot) === path.resolve(projectRoot) &&
      !isWeakWorkflowBindingChannelKey(entry.channelKey) &&
      shouldUseChannelProjectBindingForWorkflow({
        messageChannel: entry.messageChannel,
        channelKey: entry.channelKey,
        sessionKey:
          entry.sessionKeySample ??
          entry.workflowSessionKey ??
          entry.workflowBroadcastSessionKey,
      })
  );
}

function shouldSuppressAutoDispatchQueueForMissingBinding(params: {
  entry: BackgroundWorkflowQueueEntry;
  workflowPolicy?: WorkflowGuardPolicy | null;
}): boolean {
  if (params.workflowPolicy?.enableChannelProjectBindings !== true) {
    return false;
  }
  if (!isAutoDispatchQueueEntry(params.entry)) {
    return false;
  }
  const projectRoot =
    readString(params.entry.projectRoot) ??
    readString(params.entry.dispatchPayload?.projectRoot);
  return !hasDurableProjectBindingForWorkflowQueue({
    workflowPolicy: params.workflowPolicy,
    projectRoot,
  });
}

function isBackgroundQueueEntryBlockingPending(
  entry: BackgroundWorkflowQueueEntry
): boolean {
  return ["queued", "launching", "degraded"].includes(entry.status);
}

function isReusableBackgroundQueueEntry(entry: BackgroundWorkflowQueueEntry): boolean {
  return ["queued", "launching", "running", "degraded"].includes(entry.status);
}

function isRunningBackgroundQueueEntry(entry: BackgroundWorkflowQueueEntry): boolean {
  return entry.status === "running" || entry.status === "launching";
}

function isBackgroundQueueOrphanCheckDue(
  entry: BackgroundWorkflowQueueEntry,
  nowMs: number
): boolean {
  const referenceMs = Date.parse(entry.lastAttemptedAt ?? entry.queuedAt);
  return (
    Number.isFinite(referenceMs) &&
    nowMs - referenceMs >= BACKGROUND_QUEUE_ORPHAN_GRACE_MS
  );
}

function getBackgroundQueueRetryDelayMs(
  entry: BackgroundWorkflowQueueEntry,
  nowMs: number
): number {
  const nextRetryAtMs = Date.parse(entry.nextRetryAt ?? "");
  if (!Number.isFinite(nextRetryAtMs)) {
    return 0;
  }
  return Math.max(0, nextRetryAtMs - nowMs);
}

function hasActiveRegistryEntryForQueueEntry(params: {
  queueEntry: BackgroundWorkflowQueueEntry;
  activeEntries: BackgroundRunRegistryEntry[];
}): boolean {
  return params.activeEntries.some(
    (entry) =>
      entry.status === "active" &&
      entry.queueKey === params.queueEntry.queueKey &&
      backgroundRunRegistryEntryMatchesProject(
        entry,
        params.queueEntry.projectId,
        params.queueEntry.projectRoot
      )
  );
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
    nextRetryAt: entry.nextRetryAt,
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
    nextRetryAt: readString(entry.nextRetryAt) ?? null,
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
    if (error instanceof SyntaxError) {
      return [];
    }
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
        const nextRetryAt =
          readString(record.nextRetryAt ?? record.next_retry_at) ?? null;
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
          nextRetryAt,
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
  await writeJsonAtomicEnsured(queuePath, entries);
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
  const next = [
    ...current.filter((candidate) => candidate.queueKey !== entry.queueKey),
    entry,
  ];
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
            nextRetryAt: null,
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
            nextRetryAt: null,
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
            nextRetryAt: params.status === "needs_repair" ? entry.nextRetryAt : null,
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

async function writeBackgroundWorkflowQueueForResolvedScope(params: {
  entries: BackgroundWorkflowQueueEntry[];
  scope?: BackgroundRuntimeScope;
}): Promise<void> {
  if (shouldUseProjectRuntimeState(params.scope)) {
    const projectRoots = new Set<string>(
      (await listProjectScopedRuntimeProjectRoots(params.scope)).map((entry) =>
        path.normalize(entry)
      )
    );
    for (const entry of params.entries) {
      const projectRoot = readString(entry.projectRoot);
      if (projectRoot) {
        projectRoots.add(path.normalize(projectRoot));
      }
    }
    for (const projectRoot of projectRoots) {
      const projectEntries = params.entries.filter(
        (entry) =>
          readString(entry.projectRoot) &&
          path.normalize(String(entry.projectRoot)) === projectRoot
      );
      await writeBackgroundWorkflowQueue(projectEntries, {
        ...params.scope,
        projectRoot,
        projectId:
          projectEntries.find((entry) => readString(entry.projectId))?.projectId ??
          resolveBackgroundRuntimeScope(params.scope).projectId ??
          null,
      });
    }
    return;
  }
  await writeBackgroundWorkflowQueue(params.entries, params.scope);
}

async function reconcileBackgroundWorkflowQueueWithRegistry(params: {
  projectId?: string | null;
  projectRoot?: string | null;
  projectsRoot?: string | null;
  workflowRuntime?: WorkflowRuntimeMonitorApi;
}): Promise<BackgroundWorkflowQueueEntry[]> {
  const scope = {
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    projectsRoot: params.projectsRoot,
  };
  const queueEntries = await pruneBackgroundWorkflowQueue(scope);
  if (!params.workflowRuntime) {
    return queueEntries;
  }
  const activeEntries = await pruneBackgroundRunRegistry({
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    projectsRoot: params.projectsRoot,
    workflowRuntime: params.workflowRuntime,
  });
  const nowMs = Date.now();
  const repairedEntries: BackgroundWorkflowQueueEntry[] = [];
  let changed = false;
  for (const entry of queueEntries) {
    const terminalPaperArtifact =
      await detectTerminalPaperArtifactForBackgroundEntry(entry);
    if (terminalPaperArtifact) {
      changed = true;
      const retired = {
        ...entry,
        status: "completed" as const,
        nextRetryAt: null,
        lastError: null,
      };
      repairedEntries.push(retired);
      await appendBackgroundWorkflowRuntimeEvent({
        projectRoot: retired.projectRoot,
        projectId: retired.projectId,
        kind: "background_queue_retired_project_terminal",
        summary:
          "Retired background research queue entry because the project already has a ready paper artifact.",
        details: {
          queueKey: retired.queueKey,
          ownerAgent: retired.ownerAgent,
          family: retired.family,
          kind: retired.kind,
          terminal: terminalPaperArtifact,
        },
      });
      continue;
    }
    if (
      isRunningBackgroundQueueEntry(entry) &&
      isBackgroundQueueOrphanCheckDue(entry, nowMs) &&
      !hasActiveRegistryEntryForQueueEntry({ queueEntry: entry, activeEntries })
    ) {
      changed = true;
      const repaired = {
        ...entry,
        status: "needs_repair" as const,
        nextRetryAt: entry.nextRetryAt ?? null,
        lastError:
          entry.lastError ??
          "Background workflow queue entry was marked running but has no active runtime session; it was returned to the replay queue.",
      };
      repairedEntries.push(repaired);
      await appendBackgroundWorkflowRuntimeEvent({
        projectRoot: repaired.projectRoot,
        projectId: repaired.projectId,
        kind: "background_queue_needs_repair",
        summary:
          "Background workflow queue entry was marked running but has no active runtime session; it was returned to the replay queue.",
        details: {
          queueKey: repaired.queueKey,
          ownerAgent: repaired.ownerAgent,
          family: repaired.family,
          kind: repaired.kind,
        },
      });
      continue;
    }
    repairedEntries.push(entry);
  }
  if (changed) {
    await writeBackgroundWorkflowQueueForResolvedScope({
      entries: repairedEntries,
      scope,
    });
  }
  return repairedEntries;
}

export async function hasPendingBackgroundWorkflowQueueKey(params: {
  queueKey?: string | null;
  projectId?: string | null;
  projectRoot?: string | null;
  projectsRoot?: string | null;
  workflowRuntime?: WorkflowRuntimeMonitorApi;
}): Promise<{
  queued: boolean;
  active: boolean;
}> {
  const queueKey = readString(params.queueKey);
  if (!queueKey) {
    return { queued: false, active: false };
  }
  const queueEntries = await reconcileBackgroundWorkflowQueueWithRegistry({
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    projectsRoot: params.projectsRoot,
    workflowRuntime: params.workflowRuntime,
  });
  const queued = queueEntries.some(
    (entry) =>
      isBackgroundQueueEntryBlockingPending(entry) &&
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
    workflowRuntime: params.workflowRuntime,
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
  workflowRuntime?: WorkflowRuntimeMonitorApi;
}): Promise<BackgroundRunRegistryEntry | null> {
  return getBackgroundWorkflowRunByQueueKeyFromPool(params);
}

async function pruneBackgroundRunRegistry(params: {
  workflowRuntime?: WorkflowRuntimeMonitorApi;
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
    if (entry.status === "active" && params.workflowRuntime?.waitForRun) {
      try {
        const waited = await params.workflowRuntime.waitForRun({
          runId: entry.runId,
          timeoutMs: 1,
        });
        if (isWorkflowRuntimeTrackingMissError(waited)) {
          kept.push(nextEntry);
          continue;
        }
        if (waited.status === "ok" || waited.status === "error") {
          const terminalStatus =
            waited.status === "ok"
              ? "completed"
              : isProviderCapacityFailure(waited.error)
                ? "needs_repair"
                : "failed";
          await reconcileBackgroundRunTerminalState({
            entry,
            terminalStatus,
            finishedAt: checkedAt,
            error: waited.status === "error" ? waited.error ?? "Background workflow run failed." : null,
          });
          nextEntry = {
            ...nextEntry,
            status: terminalStatus === "needs_repair" ? "needs_repair" : "idle",
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
  workflowRuntime?: WorkflowRuntimeMonitorApi;
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
  workflowRuntime?: WorkflowRuntimeMonitorApi;
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

function asPlainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isManifestGraphPresenceReady(manifest: Record<string, unknown>): boolean {
  const paperIngestion = asPlainRecord(manifest.paper_ingestion);
  return (
    normalizeStageLike(
      paperIngestion.graph_presence_status ?? paperIngestion.graphPresenceStatus
    ) === "ready"
  );
}

function sanitizeArtifactPathFragment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "request"
  );
}

function deriveGraphReadyDirectBatchWarningReportPath(requestId: string): string {
  return `graph/paper-ingestion-validation/${sanitizeArtifactPathFragment(
    requestId
  )}-direct-batch-graph-ready-warning.json`;
}

function shouldDegradeDirectBatchFailureAgainstReadyGraph(params: {
  manifest: Record<string, unknown>;
  directResult: PapernexusBatchExecutionState;
}): boolean {
  const request = params.directResult.request;
  return (
    params.directResult.repairRequired === true &&
    isManifestGraphPresenceReady(params.manifest) &&
    isPaperIngestionExecutableUploadRequest(request) &&
    (request.validationStatus === "valid" || request.validationStatus === "warning")
  );
}

async function writeGraphReadyDirectBatchWarningReport(params: {
  projectRoot: string;
  manifest: Record<string, unknown>;
  directResult: PapernexusBatchExecutionState;
  reportPath: string;
  nowIso: string;
}): Promise<void> {
  const paperIngestion = asPlainRecord(params.manifest.paper_ingestion);
  await writeJsonAtomicEnsured(path.join(params.projectRoot, params.reportPath), {
    schema_version: 1,
    status: "warning",
    decision: "degraded_satisfied_current_graph",
    request_id: params.directResult.request.requestId,
    request_kind: params.directResult.request.requestKind,
    trigger_kind: params.directResult.request.triggerKind,
    manifest_path: params.directResult.request.manifestPath,
    previous_status: params.directResult.request.status,
    previous_last_error: params.directResult.request.lastError,
    previous_runtime_status: params.directResult.runtimeStatus,
    previous_waiting_reason: params.directResult.waitingReason,
    previous_repair_reason: params.directResult.repairReason,
    graph_presence: {
      status:
        normalizeStageLike(
          paperIngestion.graph_presence_status ?? paperIngestion.graphPresenceStatus
        ) ?? null,
      report_path:
        typeof paperIngestion.graph_presence_report_path === "string"
          ? paperIngestion.graph_presence_report_path
          : typeof paperIngestion.graphPresenceReportPath === "string"
            ? paperIngestion.graphPresenceReportPath
            : "graph/GRAPH_PRESENCE_CHECK.json",
      expected_paper_count:
        typeof paperIngestion.graph_presence_expected_papers === "number"
          ? paperIngestion.graph_presence_expected_papers
          : typeof paperIngestion.graphPresenceExpectedPapers === "number"
            ? paperIngestion.graphPresenceExpectedPapers
            : null,
      present_paper_count:
        typeof paperIngestion.graph_presence_present_papers === "number"
          ? paperIngestion.graph_presence_present_papers
          : typeof paperIngestion.graphPresencePresentPapers === "number"
            ? paperIngestion.graphPresencePresentPapers
            : null,
    },
    command_outputs: params.directResult.commandOutputs,
    reason:
      "Direct PaperNexus batch execution failed after graph presence was already ready; persisted as a workflow warning instead of a blocking repair request.",
    created_at: params.nowIso,
    updated_at: params.nowIso,
  });
}

export async function retireBackgroundWorkflowRuns(params: {
  workflowRuntime?: WorkflowRuntimeMonitorApi;
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
  workflowRuntime?: WorkflowRuntimeMonitorApi;
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
    nextRetryAt: null,
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
  workflowRuntime?: WorkflowRuntimeApi;
  workflowPolicy?: (WorkflowGuardPolicy & {
    lobsterHandoff?: WorkflowLobsterHandoffConfig;
  }) | null;
  projectsRoot?: string | null;
  ignoreRetryBackoff?: boolean;
  handoffWorkflowTaskToAgent?: typeof handoffWorkflowTaskToAgent;
}): Promise<QueuedBackgroundWorkflowDrainResult> {
  const workflowRuntime = params.workflowRuntime;
  if (!workflowRuntime) {
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

  const queue = await reconcileBackgroundWorkflowQueueWithRegistry({
    projectsRoot:
      readString(params.projectsRoot) ??
      readString(params.workflowPolicy?.projectsRoot) ??
      null,
    workflowRuntime,
  });
  const started: BackgroundRunStartResult[] = [];
  const processedEntries: BackgroundWorkflowQueueEntry[] = [];

  for (const entry of queue) {
    const terminalPaperArtifact =
      await detectTerminalPaperArtifactForBackgroundEntry(entry);
    if (terminalPaperArtifact) {
      await retireBackgroundWorkflowRunsFromPool({
        workflowRuntime,
        ownerAgent: entry.ownerAgent,
        family: entry.family,
        projectId: entry.projectId,
        projectRoot: entry.projectRoot,
        statuses: ["active", "idle", "needs_repair"],
      });
      await appendBackgroundWorkflowRuntimeEvent({
        projectRoot: entry.projectRoot,
        projectId: entry.projectId,
        kind: "background_queue_retired_project_terminal",
        summary:
          "Consumed background research queue entry because the project already has a ready paper artifact.",
        details: {
          queueKey: entry.queueKey,
          entryType: entry.entryType,
          ownerAgent: entry.ownerAgent,
          family: entry.family,
          kind: entry.kind,
          terminal: terminalPaperArtifact,
        },
      });
      continue;
    }
    if (!isBackgroundQueueEntryPending(entry)) {
      continue;
    }
    if (
      params.ignoreRetryBackoff !== true &&
      getBackgroundQueueRetryDelayMs(entry, Date.now()) > 0
    ) {
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
    if (
      shouldSuppressAutoDispatchQueueForMissingBinding({
        entry,
        workflowPolicy: params.workflowPolicy ?? null,
      })
    ) {
      const error =
        "Queued workflow auto-dispatch is missing an active project binding; notification-only targets cannot replay automatic work.";
      await touchBackgroundWorkflowQueueEntry({
        entry,
        error,
        status: "failed",
      });
      await appendBackgroundWorkflowRuntimeEvent({
        projectRoot: entry.projectRoot,
        projectId: entry.projectId,
        kind: "background_queue_binding_missing",
        summary: error,
        details: {
          queueKey: entry.queueKey,
          source: entry.source,
          entryType: entry.entryType,
          projectRoot: entry.projectRoot,
          projectId: entry.projectId,
        },
      });
      continue;
    }

    const sessionLease = await acquireBackgroundWorkflowSession({
      workflowRuntime,
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
                      workflowRuntime,
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
                      workflowRuntime,
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
                const dispatchRunId = resolveWorkflowDispatchLaunchRunId(dispatch);
                if (!dispatch.dispatched || !dispatchRunId || !dispatch.sessionKey) {
                  throw new Error(
                    dispatch.error ?? "Queued workflow dispatch did not start."
                  );
                }
                return {
                  runId: dispatchRunId,
                  sessionKey: dispatch.sessionKey ?? sessionLease.sessionKey,
                  runtime:
                    dispatch.channel === "sessions_spawn" ||
                    dispatch.channel === "sessions_send"
                      ? workflowRuntime.runtimeKind ?? "subagent"
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
                workflowRuntime,
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
                workflowRuntime,
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
            !resolveWorkflowDispatchLaunchRunId(legacyDispatch) ||
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
            runId: resolveWorkflowDispatchLaunchRunId(legacyDispatch),
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
                const startedRun = await workflowRuntime.run({
                  sessionKey: backgroundSessionKey,
                  message: runPayload.message,
                  lane: runPayload.lane,
                  deliver: runPayload.deliver,
                  idempotencyKey:
                    runPayload.idempotencyKey ?? undefined,
                  extraSystemPrompt: runPayload.extraSystemPrompt ?? undefined,
                  projectRoot: entry.projectRoot,
                  projectId: entry.projectId,
                  ownerAgent: entry.ownerAgent,
                  requesterSessionKey: entry.requesterSessionKey,
                  messageChannel: entry.messageChannel,
                });
                return {
                  runId: startedRun.runId,
                  sessionKey: backgroundSessionKey,
                  sessionId: startedRun.sessionId ?? null,
                  runtime: startedRun.runtime ?? workflowRuntime.runtimeKind ?? "subagent",
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
            : await workflowRuntime.run({
                sessionKey: backgroundSessionKey,
                message: runPayload.message,
                lane: runPayload.lane,
                deliver: runPayload.deliver,
                idempotencyKey: runPayload.idempotencyKey ?? undefined,
                extraSystemPrompt: runPayload.extraSystemPrompt ?? undefined,
                projectRoot: entry.projectRoot,
                projectId: entry.projectId,
                ownerAgent: entry.ownerAgent,
                requesterSessionKey: entry.requesterSessionKey,
                messageChannel: entry.messageChannel,
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
    /(?:^|\s)(?:skills\/(?:researcher\/)?papernexus\/)?scripts\/pn_stage_sync\.py\b/.test(normalized) ||
    /(?:^|\s)(?:skills\/(?:researcher\/)?papernexus\/)?scripts\/pn_import_submit\.py\b/.test(normalized) ||
    (/(?:^|\s)(?:skills\/(?:researcher\/)?papernexus\/)?scripts\/pn_batch_import\.py\b/.test(normalized) &&
      /\b(submit|status|wait)\b/.test(normalized)) ||
    (/(?:^|\s)(?:skills\/(?:researcher\/)?papernexus\/)?scripts\/pn_import_queue\.py\b/.test(normalized) &&
      /\b(status|log|wait)\b/.test(normalized))
  );
}

function isPapernexusBatchImportCommand(text: string | null | undefined): boolean {
  const normalized = (text ?? "").toLowerCase();
  return (
    /(?:^|\s)(?:skills\/(?:researcher\/)?papernexus\/)?scripts\/pn_batch_import\.py\b/.test(normalized) &&
    /\b(submit|status|wait)\b/.test(normalized)
  );
}

function buildBackgroundWorkflowContinuationSystemPrompt(params?: {
  kind?: string | null;
  commandText?: string | null;
  promptConfig?: WorkflowPromptConfig | null;
}): string {
  const normalizedKind = readString(params?.kind)?.toLowerCase() ?? null;
  const commandText = readString(params?.commandText) ?? null;
  const promptConfig = params?.promptConfig ?? null;
  const promptValues = {
    kind: normalizedKind ?? "generic",
    commandText: commandText ?? "",
  };
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
  const lines = renderPromptLines(
    getPromptLines(
      promptConfig,
      ["backgroundContinuations", "baseRules"],
      [
        "BACKGROUND_WORKFLOW_CONTINUATION=1",
        "This run was launched from a slash-command fast path into a dedicated workflow subagent session.",
        "Continue the requested workflow in the background, keep durable state current, and do not assume the foreground session is available.",
        "Use research_workflow mailbox for bounded handoffs, and do not call research_workflow start_background_run again from this continuation.",
        "Workflow ownership rule: do not use the generic Agent tool or ad hoc cross-role subagents from this continuation. Let research_workflow, auto_iterator, and workflow handoff own cross-role dispatch explicitly.",
        "Session hygiene rule: stay inside the current owner role unless workflow state changes ownership. Record durable state and queue official workflow handoffs instead of freelancing into other roles.",
      ]
    ),
    promptValues
  );
  if (papernexusBackground) {
    lines.push(
      ...renderPromptLines(
        getPromptLines(
          promptConfig,
          ["backgroundContinuations", "papernexusRules"],
          [
            "PaperNexus workflow rule: stay MCP-first. Use remote PaperNexus MCP tools (`research_lookup`, `research_briefing`, `idea_catalyst`, `import_workflow`, `refresh_paper_graph`) directly when available; use the authenticated Python wrappers only as MCP-backed adapters for local file staging, shell-only execution, or bounded import/status work. Do not fall back to local live-graph CLI work or hand-written REST calls.",
          ]
        ),
        promptValues
      )
    );
  }
  if (graphBuildContinuation) {
    lines.push(
      ...renderPromptLines(
        getPromptLines(
          promptConfig,
          ["backgroundContinuations", "graphBuildRules"],
          [
            "Graph-build workflow rule: treat /graph-build as a bounded graph-readiness and brainstorm-refresh pass. The remote PaperNexus import worker performs the real graph mutation; do not turn this continuation into a manual rebuild loop.",
            "During /graph-build, use the local Zotero MCP server through /zotero-project-library and keep the project's bibliography synchronized under the configured project Zotero path (default <zoteroProjectRoot>/<project-id>, where zoteroProjectRoot defaults to bot).",
            "At minimum, sync the verified canonical paper set into the configured project's selected collection, put baseline-defining papers into the baselines collection, and refresh {PROJ}/researcher/ZOTERO_PACKET.md with collection path, counts, and unresolved metadata cleanup tasks.",
            "Do not wait indefinitely on Zotero work either; keep graph readiness and brainstorm bundle refresh as the primary bounded pass, then complete the bounded project Zotero sync before reporting graph-build completion.",
          ]
        ),
        promptValues
      )
    );
    if (graphBuildRepairContinuation) {
      lines.push(
        ...renderPromptLines(
          getPromptLines(
            promptConfig,
            ["backgroundContinuations", "graphBuildRepairRules"],
            [
              "Graph-build repair mode: this continuation was launched because graph sync is still missing papers while ingestion is idle. Treat it as a bounded graph-sync repair pass, not a passive status check.",
              "Regenerate one manifest for the missing canonical papers and drive the repair through pn_batch_import.py submit/status/wait instead of hand-rolled loops or repeated one-paper submit commands.",
              "If a prior workflow queue/session is marked needs_repair, treat it as stale bookkeeping and start a fresh bounded repair batch instead of waiting forever on the stale run.",
              "Keep repair progress durable through research_workflow.set_paper_ingestion: mirror active_batches, batch_items, completed_papers, and paper_operations, and clear repair_required only after a fresh batch is running or graph_presence_status becomes ready.",
            ]
          ),
          promptValues
        )
      );
      if (graphBuildRepairTargetCorpus) {
        lines.push(
          ...renderPromptLines(
            getPromptLines(
              promptConfig,
              ["backgroundContinuations", "graphBuildRepairTargetCorpusRules"],
              [
                "Lock the repair pass to the shared corpus {{sharedCorpus}}; do not switch to a project-local or differently named corpus.",
              ]
            ),
            { ...promptValues, sharedCorpus: graphBuildRepairTargetCorpus }
          )
        );
      }
    }
  }
  if (zoteroSyncContinuation) {
    lines.push(
      ...renderPromptLines(
        getPromptLines(
          promptConfig,
          ["backgroundContinuations", "zoteroSyncRules"],
          [
            "Zotero sync workflow rule: treat /zotero-sync as a bounded project-wide bibliography reconciliation pass, not as an inline foreground task.",
            "Use the local Zotero MCP server through /zotero-project-library, reconcile the configured project collections, and keep ZOTERO_SYNC_PACKET.json plus ZOTERO_PACKET.md truthful.",
            "Collection safety rule: remove stale papers only from the project's Zotero collections; do not delete or trash Zotero items themselves.",
            "Foreground responsiveness rule: do not block the foreground session waiting on Zotero MCP work; if Zotero is unavailable, record unavailable or failed state durably and exit.",
          ]
        ),
        promptValues
      )
    );
  }
  if (literatureReviewContinuation) {
    lines.push(
      ...renderPromptLines(
        getPromptLines(
          promptConfig,
          ["backgroundContinuations", "literatureReviewRules"],
          [
            "Literature-review workflow rule: treat /literature-review as a bounded durable review-packet pass for the current project, not as an endless foreground search session.",
            "Refresh REVIEW_PROTOCOL.md, INCLUDED_PAPERS.json, EXCLUDED_PAPERS.json, SOTA_MATRIX.md, GAP_SYNTHESIS.md, and LITERATURE_REVIEW.md coherently so downstream frontier / plan / writing stages can trust one packet.",
            "Foreground responsiveness rule: keep the foreground chat interruptible while this review pass runs; summarize progress durably rather than monopolizing the session.",
          ]
        ),
        promptValues
      )
    );
  }
  if (surveyReviewContinuation) {
    lines.push(
      ...renderPromptLines(
        getPromptLines(
          promptConfig,
          ["backgroundContinuations", "surveyReviewRules"],
          [
            "Survey workflow rule: keep the project on the survey_review -> write line. Do not steer this continuation into graph_build, frontier_mapping, idea, plan, code, or experiment unless a human explicitly switches the workflow line.",
            "Use research_workflow.set_survey_review and research_workflow.materialize_survey_review_state to keep survey_review durable while retrieval, screening, and synthesis progress.",
            "If survey literature imports or discovery runs are needed, treat them as bounded substeps inside survey_review instead of clearing paper_ingestion by hand or rewriting experiment-track artifacts.",
          ]
        ),
        promptValues
      )
    );
  }
  if (importLifecycleCommand) {
    if (batchImportCommand) {
      lines.push(
        ...renderPromptLines(
          getPromptLines(
            promptConfig,
            ["backgroundContinuations", "batchImportRules"],
            [
              "PaperNexus batch-import rule: when 2 or more staged papers are being synchronized, use one manifest file with pn_batch_import.py submit/status/wait instead of hand-rolled shell loops or repeated one-paper submit commands.",
              "Reuse the same manifest for submit, status, and wait. Keep each workflow wait pass bounded to 60 seconds or less, then persist progress and let the workflow continue on the next status pass instead of blocking indefinitely.",
              "After each batch status or wait result, call research_workflow.set_paper_ingestion so runtime_status, active_batches, batch_items, completed_papers, and paper_operations stay durable.",
              "Translate the wrapper summary/items view into durable workflow state: active_batches should mirror the batch summary, batch_items should mirror per-paper items, and any synced item should also write completed_papers or terminal paper_operations when appropriate.",
              "Use research_workflow.set_paper_ingestion as the channel-visible progress path; it will keep batch progress visible even if the delegated subagent never sends a free-form chat reply.",
            ]
          ),
          promptValues
        )
      );
    } else {
      lines.push(
        ...renderPromptLines(
          getPromptLines(
            promptConfig,
            ["backgroundContinuations", "singleImportRules"],
            [
              "PaperNexus import rule: process one paper per import task when using pn_import_submit.py, keep each paper within a 60 seconds total wait budget, and do not poll indefinitely.",
              "Before and after each paper import or graph reconcile step, call research_workflow.set_paper_ingestion so runtime_status, import_task_ids, paper_operations, and completed_papers stay durable.",
              "When a paper completes, write completed_papers with canonical_id, title, and import_task_id. When a paper times out or fails, write paper_operations with the terminal status and move on to the next paper.",
              "If more than one staged paper needs syncing, stop using repeated one-paper submits and switch to pn_batch_import.py with one manifest.",
              "Use research_workflow.set_paper_ingestion as the channel-visible progress path; it will broadcast the per-paper completion or timeout update for you.",
            ]
          ),
          promptValues
        )
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
  promptConfig?: WorkflowPromptConfig | null;
}): string {
  const promptValues = {
    requestId: params.requestId,
    triggerKind: params.triggerKind,
    sharedCorpus: params.sharedCorpus ?? "",
  };
  const lines = [
    `WORKFLOW_OWNED_PAPER_INGESTION_REQUEST_ID=${params.requestId}`,
    ...renderPromptLines(
      getPromptLines(
        params.promptConfig,
        ["workflowOwnedRequests", "paperIngestion", "rules"],
        [
          "This wrapper run was launched by workflow-owned {{triggerKind}} trigger, not by ad-hoc agent delegation.",
          "Treat this as the authoritative upload execution for the queued paper ingestion request and keep the queued_requests entry synchronized through research_workflow.set_paper_ingestion.",
          "When you report progress, include queued_requests with this request_id so status moves through running/completed/failed and preserves last_run_id, last_session_key, last_error, and detail.",
        ]
      ),
      promptValues
    ),
  ];
  if (params.sharedCorpus) {
    lines.push(
      ...renderPromptLines(
        getPromptLines(
          params.promptConfig,
          ["workflowOwnedRequests", "paperIngestion", "sharedCorpusRules"],
          [
            "Use the locked shared corpus {{sharedCorpus}} for this queued upload request and do not switch corpora mid-run.",
          ]
        ),
        promptValues
      )
    );
  }
  return `${lines.join("\n")}\n`;
}

function buildWorkflowOwnedRequisitionRequestPrompt(params: {
  requestId: string;
  triggerKind: string | null;
  manifestPath: string | null;
  sharedCorpus: string | null;
  promptConfig?: WorkflowPromptConfig | null;
}): string {
  const promptValues = {
    requestId: params.requestId,
    triggerKind: params.triggerKind ?? "",
    manifestPath: params.manifestPath ?? "",
    sharedCorpus: params.sharedCorpus ?? "",
  };
  const lines = [
    `WORKFLOW_OWNED_PAPER_INGESTION_REQUEST_ID=${params.requestId}`,
    `WORKFLOW_OWNED_LITERATURE_REQUISITION_REQUEST_ID=${params.requestId}`,
    ...renderPromptLines(
      getPromptLines(
        params.promptConfig,
        ["workflowOwnedRequests", "literatureRequisition", "rules"],
        [
          "This run was launched by the workflow to consume a queued literature discovery requisition without requiring a Discord foreground handoff.",
          "Execute the command text as the authoritative requisition instructions: read the packet/scaffold, collect only sources that close the stated evidence gap, stage local Markdown/PDF sources, then materialize and run one real PaperNexus batch import for the staged sources.",
          "Keep the queued_requests entry synchronized through research_workflow.set_paper_ingestion using this request_id. Move it to running while active, completed only after durable import evidence exists in completed_papers/batch_items or after a requisition-satisfaction report is written and referenced by validation_report_path; otherwise leave it queued/needs_repair with a concrete error.",
          "Do not mark this requisition completed with zero collected/imported papers unless the no-new-paper decision is backed by a saved requisition-satisfaction report that explains why the current graph already closes the gap.",
          "After imports finish or exhaust retry budget, rerun /graph-build or record the graph-build reentry requirement so the workflow can refresh graph presence before continuing downstream.",
        ]
      ),
      promptValues
    ),
  ];
  if (params.triggerKind) {
    lines.push(
      ...renderPromptLines(
        getPromptLines(
          params.promptConfig,
          ["workflowOwnedRequests", "literatureRequisition", "triggerKindRules"],
          ["Trigger kind: {{triggerKind}}."]
        ),
        promptValues
      )
    );
  }
  if (params.manifestPath) {
    lines.push(
      ...renderPromptLines(
        getPromptLines(
          params.promptConfig,
          ["workflowOwnedRequests", "literatureRequisition", "manifestPathRules"],
          ["Requisition packet/scaffold path: {PROJ}/{{manifestPath}}."]
        ),
        promptValues
      )
    );
  }
  if (params.sharedCorpus) {
    lines.push(
      ...renderPromptLines(
        getPromptLines(
          params.promptConfig,
          ["workflowOwnedRequests", "literatureRequisition", "sharedCorpusRules"],
          [
            "Use the locked shared corpus {{sharedCorpus}} for any PaperNexus import produced by this requisition.",
          ]
        ),
        promptValues
      )
    );
  }
  return `${lines.join("\n")}\n`;
}

function hasDirectPapernexusBatchExecutionConfig(
  request: {
    args: string[];
    commandText: string | null;
  }
): boolean {
  const text = [request.commandText, ...request.args].filter(Boolean).join(" ");
  return (
    /(?:^|\s)--(?:mcp-url|api-base)(?:\s|=|$)/.test(text) ||
    Boolean(readString(process.env.PAPERNEXUS_MCP_URL)) ||
    Boolean(readString(process.env.PAPERNEXUS_API_BASE_URL))
  );
}

function materializeQueuedPapernexusBatchRequestCommand(params: {
  request: PaperIngestionQueuedRequest;
  workflowPolicy: WorkflowGuardPolicy;
}): PaperIngestionQueuedRequest {
  if (params.request.commandText) {
    return params.request;
  }
  if (!isPapernexusBatchImportLifecycleRequest(params.request)) {
    return params.request;
  }
  const existingArgs = params.request.args.length > 0 ? [...params.request.args] : [];
  const manifestPath = readString(params.request.manifestPath);
  const args = existingArgs.length > 0 ? existingArgs : [];
  if (args.length === 0) {
    const mcpUrl = readString(params.workflowPolicy.papernexusMcpUrl);
    const apiBaseUrl = readString(params.workflowPolicy.papernexusApiBaseUrl);
    if (mcpUrl) {
      args.push("--mcp-url", mcpUrl);
    } else if (apiBaseUrl) {
      args.push("--api-base", apiBaseUrl);
    }
    const sharedCorpus =
      readString(params.request.sharedCorpus) ??
      readString(params.workflowPolicy.papernexusSharedCorpus);
    if (sharedCorpus) {
      args.push("--corpus", sharedCorpus);
    }
    if (manifestPath) {
      args.push("--manifest", manifestPath, "submit");
    }
  }
  appendBatchImportSubmitRemoteStagingArgsForPolicy(args, params.workflowPolicy);
  if (args.length === 0) {
    return params.request;
  }
  return {
    ...params.request,
    wrapper: params.request.wrapper ?? "pn_batch_import.py",
    args,
    commandText: buildPapernexusWrapperCommand({
      wrapper: "pn_batch_import.py",
      args,
    }),
  };
}

function readPapernexusArgValue(args: string[], names: string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    for (const name of names) {
      if (arg === name) {
        return readString(args[index + 1]) ?? null;
      }
      const prefix = `${name}=`;
      if (arg.startsWith(prefix)) {
        return readString(arg.slice(prefix.length)) ?? null;
      }
    }
  }
  return null;
}

function papernexusBatchArgsKey(
  request: Pick<PaperIngestionQueuedRequest, "args" | "commandText">
): string {
  return getPapernexusBatchImportArgs(request).join("\u0000");
}

function readWorkflowOwnedPaperIngestionRequestId(
  prompt: string | null | undefined
): string | null {
  const match =
    /(?:^|\n)\s*WORKFLOW_OWNED_PAPER_INGESTION_REQUEST_ID=([^\s\n]+)/.exec(
      prompt ?? ""
    );
  return readString(match?.[1]) ?? null;
}

async function countBatchManifestPapers(params: {
  projectRoot: string;
  manifestPath: string | null;
}): Promise<number | null> {
  const manifestPath = readString(params.manifestPath);
  if (!manifestPath) {
    return null;
  }
  const resolvedPath = path.isAbsolute(manifestPath)
    ? manifestPath
    : path.join(params.projectRoot, manifestPath);
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(resolvedPath)) ?? null;
  if (!manifest) {
    return null;
  }
  const arrays = [
    manifest.papers,
    manifest.items,
    manifest.sources,
    typeof manifest.batch === "object" && manifest.batch
      ? (manifest.batch as Record<string, unknown>).papers
      : null,
    typeof manifest.batch === "object" && manifest.batch
      ? (manifest.batch as Record<string, unknown>).items
      : null,
  ];
  const firstArray = arrays.find(Array.isArray);
  return Array.isArray(firstArray) ? firstArray.length : null;
}

async function resolveDirectPapernexusBatchRequest(params: {
  projectRoot: string;
  commandText: string | null;
  summary: string | null;
  triggerKind: string | null;
  extraSystemPrompt?: string | null;
}): Promise<PaperIngestionQueuedRequest | null> {
  const commandText = readString(params.commandText);
  if (!commandText) {
    return null;
  }
  const commandRequest = {
    args: [],
    commandText,
  };
  const commandArgs = getPapernexusBatchImportArgs(commandRequest);
  if (commandArgs.length === 0) {
    return null;
  }
  const commandKey = papernexusBatchArgsKey(commandRequest);
  const manifestPath = readPapernexusArgValue(commandArgs, ["--manifest"]);
  const ownedRequestId = readWorkflowOwnedPaperIngestionRequestId(
    params.extraSystemPrompt
  );
  const ingestion = await getPaperIngestionStateSummary({
    projectRoot: params.projectRoot,
  });
  const queuedRequests = ingestion.state.queuedRequests;
  const byOwnedId = ownedRequestId
    ? queuedRequests.find((request) => request.requestId === ownedRequestId)
    : null;
  const byCommand = queuedRequests.find(
    (request) =>
      isPapernexusBatchImportLifecycleRequest(request) &&
      papernexusBatchArgsKey(request) === commandKey
  );
  const byManifest = manifestPath
    ? queuedRequests.find(
        (request) =>
          isPapernexusBatchImportLifecycleRequest(request) &&
          readString(request.manifestPath) === manifestPath
      )
    : null;
  const existing = byOwnedId ?? byCommand ?? byManifest ?? null;
  if (existing) {
    return {
      ...existing,
      args: existing.args.length > 0 ? existing.args : commandArgs,
      commandText: existing.commandText ?? commandText,
      wrapper: existing.wrapper ?? "pn_batch_import.py",
      manifestPath: existing.manifestPath ?? manifestPath,
      sharedCorpus:
        existing.sharedCorpus ??
        readPapernexusArgValue(commandArgs, ["--corpus", "--shared-corpus"]),
      summary: existing.summary ?? params.summary,
      triggerKind: existing.triggerKind ?? params.triggerKind,
    };
  }

  const nowIso = new Date().toISOString();
  return {
    requestId: `direct-papernexus-batch-${randomUUID().slice(0, 12)}`,
    requestKind: "upload_manifest",
    status: "running",
    wrapper: "pn_batch_import.py",
    args: commandArgs,
    commandText,
    manifestPath,
    sharedCorpus: readPapernexusArgValue(commandArgs, [
      "--corpus",
      "--shared-corpus",
    ]),
    paperCount: await countBatchManifestPapers({
      projectRoot: params.projectRoot,
      manifestPath,
    }),
    summary: params.summary,
    createdAt: nowIso,
    updatedAt: nowIso,
    startedAt: null,
    finishedAt: null,
    lastRunId: null,
    lastSessionKey: null,
    lastError: null,
    detail: null,
    triggerKind: params.triggerKind,
    progress: null,
    queueProgress: null,
    validationStatus: "valid",
    validationSummary: null,
    validationReportPath: null,
    attemptCount: 0,
    maxAttempts: 3,
    lastAttemptAt: null,
    nextRetryAt: null,
    deadLetterAt: null,
    deadLetterReason: null,
  };
}

async function persistDirectPapernexusBatchExecutionResult(params: {
  projectRoot: string;
  projectId: string | null;
  queueKey?: string | null;
  source: string;
  directResult: PapernexusBatchExecutionState;
}): Promise<BackgroundRunStartResult> {
  const directResult = params.directResult;
  const manifestBeforePersist =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(params.projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const degradeFailureAgainstReadyGraph =
    shouldDegradeDirectBatchFailureAgainstReadyGraph({
      manifest: manifestBeforePersist,
      directResult,
    });
  const nowIso = directResult.request.updatedAt ?? new Date().toISOString();
  const warningReportPath = degradeFailureAgainstReadyGraph
    ? deriveGraphReadyDirectBatchWarningReportPath(directResult.request.requestId)
    : null;
  if (warningReportPath) {
    await writeGraphReadyDirectBatchWarningReport({
      projectRoot: params.projectRoot,
      manifest: manifestBeforePersist,
      directResult,
      reportPath: warningReportPath,
      nowIso,
    });
  }
  const requestPatch: PaperIngestionQueuedRequest = {
    ...directResult.request,
    status: degradeFailureAgainstReadyGraph ? "completed" : directResult.request.status,
    queueProgress:
      directResult.queueProgress ?? directResult.request.queueProgress,
    updatedAt: nowIso,
    finishedAt: degradeFailureAgainstReadyGraph
      ? directResult.request.finishedAt ?? nowIso
      : directResult.request.finishedAt,
    lastError: degradeFailureAgainstReadyGraph ? null : directResult.request.lastError,
    detail: degradeFailureAgainstReadyGraph
      ? "Direct PaperNexus batch failure was degradably satisfied because graph presence is already ready."
      : directResult.request.detail,
    validationStatus: degradeFailureAgainstReadyGraph
      ? "warning"
      : directResult.request.validationStatus,
    validationSummary: degradeFailureAgainstReadyGraph
      ? "Direct PaperNexus batch failed after graph presence was ready; current graph accepted with a durable warning report."
      : directResult.request.validationSummary,
    validationReportPath: warningReportPath ?? directResult.request.validationReportPath,
    nextRetryAt: degradeFailureAgainstReadyGraph ? null : directResult.request.nextRetryAt,
    deadLetterAt: degradeFailureAgainstReadyGraph
      ? null
      : directResult.request.deadLetterAt,
    deadLetterReason: degradeFailureAgainstReadyGraph
      ? null
      : directResult.request.deadLetterReason,
  };
  await setPaperIngestionState({
    projectRoot: params.projectRoot,
    paperIngestion: {
      runtime_status: degradeFailureAgainstReadyGraph
        ? "ready"
        : directResult.runtimeStatus,
      waiting_reason: degradeFailureAgainstReadyGraph
        ? null
        : directResult.waitingReason,
      import_task_ids: directResult.importTaskIds,
      last_import_task_id: directResult.lastImportTaskId,
      last_import_status: degradeFailureAgainstReadyGraph
        ? "completed"
        : directResult.lastImportStatus,
      completed_papers: directResult.completedPapers,
      paper_operations: degradeFailureAgainstReadyGraph
        ? []
        : directResult.paperOperations,
      active_batches: degradeFailureAgainstReadyGraph
        ? []
        : directResult.activeBatches,
      batch_items: degradeFailureAgainstReadyGraph ? [] : directResult.batchItems,
      queued_requests: [serializePaperIngestionQueuedRequest(requestPatch)],
      repair_required: degradeFailureAgainstReadyGraph
        ? false
        : directResult.repairRequired,
      repair_reason: degradeFailureAgainstReadyGraph
        ? null
        : directResult.repairReason,
      reconcile_required: degradeFailureAgainstReadyGraph ? false : undefined,
      replace_paper_operations: degradeFailureAgainstReadyGraph,
      replace_active_batches: degradeFailureAgainstReadyGraph,
      replace_batch_items: degradeFailureAgainstReadyGraph,
      last_updated_at: nowIso,
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
      run_id: directResult.request.lastRunId,
      session_key: directResult.request.lastSessionKey,
      queue_key: params.queueKey ?? null,
      wrapper: directResult.request.wrapper,
    },
    updatedAt: directResult.request.updatedAt ?? new Date().toISOString(),
  });
  await appendWorkflowRuntimeEvent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    kind: "paper_ingestion_direct_batch_import",
    summary: directResult.request.detail ?? directResult.waitingReason,
    details: {
      source: params.source,
      queueKey: params.queueKey ?? null,
      requestId: directResult.request.requestId,
      status: requestPatch.status,
      runtimeStatus: degradeFailureAgainstReadyGraph
        ? "ready"
        : directResult.runtimeStatus,
      degradedDueToGraphReady: degradeFailureAgainstReadyGraph,
      warningReportPath,
      importTaskCount: directResult.importTaskIds.length,
      completedPaperCount: directResult.completedPapers.length,
      batchItemCount: degradeFailureAgainstReadyGraph ? 0 : directResult.batchItems.length,
    },
  });
  return {
    started: true,
    reason: "started",
    runId: directResult.request.lastRunId,
    sessionKey: directResult.request.lastSessionKey,
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    summary:
      requestPatch.detail ??
      (degradeFailureAgainstReadyGraph
        ? "Direct PaperNexus batch failure was degradably satisfied by the ready graph."
        : directResult.waitingReason),
    reusedIdleSession: false,
    activeResearcherSessionsInChannel: null,
    queued: false,
    queueKey: params.queueKey ?? null,
  };
}

async function maybeExecuteDirectPapernexusBatchBackgroundRun(params: {
  projectRoot: string | null;
  projectId: string | null;
  normalizedKind: string;
  commandText: string | null;
  summary: string | null;
  triggerKind: string | null;
  extraSystemPrompt?: string | null;
  queueKey?: string | null;
  source: string;
  papernexusRemoteAccess?: PapernexusRemoteAccessConfig | null;
}): Promise<BackgroundRunStartResult | null> {
  if (!params.projectRoot || !isPapernexusBackgroundKind(params.normalizedKind)) {
    return null;
  }
  if (!readWorkflowOwnedPaperIngestionRequestId(params.extraSystemPrompt)) {
    return null;
  }
  const request = await resolveDirectPapernexusBatchRequest({
    projectRoot: params.projectRoot,
    commandText: params.commandText,
    summary: params.summary,
    triggerKind: params.triggerKind,
    extraSystemPrompt: params.extraSystemPrompt,
  });
  if (
    !request ||
    !isPapernexusBatchImportLifecycleRequest(request) ||
    !hasDirectPapernexusBatchExecutionConfig(request)
  ) {
    return null;
  }
  const directResult = await executePapernexusBatchImportRequest({
    projectRoot: params.projectRoot,
    request,
    waitTimeoutSeconds: 60,
    waitIntervalSeconds: 5,
    remoteAccess: params.papernexusRemoteAccess,
  });
  if (!directResult) {
    return null;
  }
  return persistDirectPapernexusBatchExecutionResult({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    queueKey: params.queueKey,
    source: params.source,
    directResult,
  });
}

async function maybeTriggerQueuedLiteratureRequisitionRequest(params: {
  workflowRuntime?: WorkflowRuntimeApi;
  workflowPolicy: WorkflowGuardPolicy;
  agentCtx: BackgroundRunAgentContext;
  snapshot: BackgroundRunSnapshot;
  triggerKind: string;
  projectRoot: string;
  projectId: string | null;
  paperIngestionState: PaperIngestionState;
  queuedRequests: PaperIngestionQueuedRequest[];
  nowIso: string;
  ensureProjectBinding?: boolean;
}): Promise<BackgroundRunStartResult | null> {
  const invalidCompletedCandidate =
    params.queuedRequests.find((entry) =>
      isInvalidCompletedWorkflowOwnedLiteratureRequisitionRequest({
        state: params.paperIngestionState,
        request: entry,
      })
    ) ?? null;
  const requisitionCandidate =
    params.queuedRequests.find(
      (entry) =>
        isWorkflowOwnedLiteratureRequisitionRequest(entry) &&
        isQueuedPaperIngestionRetryDue(entry, params.nowIso) &&
        Boolean(entry.commandText)
    ) ??
    (invalidCompletedCandidate?.commandText
      ? {
          ...invalidCompletedCandidate,
          status: "needs_repair" as const,
          finishedAt: null,
          nextRetryAt: null,
          deadLetterAt: null,
          deadLetterReason: null,
          lastError: INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON,
          detail:
            INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON,
        }
      : null);
  if (!requisitionCandidate?.commandText) {
    if (invalidCompletedCandidate) {
      const repairUpdatedAt = new Date().toISOString();
      await setPaperIngestionState({
        projectRoot: params.projectRoot,
        paperIngestion: {
          queued_requests: [
            {
              request_id: invalidCompletedCandidate.requestId,
              request_kind: invalidCompletedCandidate.requestKind,
              wrapper: invalidCompletedCandidate.wrapper,
              command_text: invalidCompletedCandidate.commandText,
              manifest_path: invalidCompletedCandidate.manifestPath,
              shared_corpus: invalidCompletedCandidate.sharedCorpus,
              paper_count: invalidCompletedCandidate.paperCount,
              summary: invalidCompletedCandidate.summary,
              status: "needs_repair",
              updated_at: repairUpdatedAt,
              last_error: INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON,
              trigger_kind: invalidCompletedCandidate.triggerKind,
              detail: INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON,
              validation_status: invalidCompletedCandidate.validationStatus,
              validation_summary: invalidCompletedCandidate.validationSummary,
              validation_report_path: invalidCompletedCandidate.validationReportPath,
              attempt_count: invalidCompletedCandidate.attemptCount,
              max_attempts: invalidCompletedCandidate.maxAttempts,
              last_attempt_at: invalidCompletedCandidate.lastAttemptAt,
              next_retry_at: null,
              dead_letter_at: null,
              dead_letter_reason: null,
            },
          ],
          runtime_status: "blocked",
          waiting_reason: INVALID_WORKFLOW_OWNED_LITERATURE_COMPLETION_REASON,
          last_updated_at: repairUpdatedAt,
        },
      });
    }
    return null;
  }

  const requestPrompt = buildWorkflowOwnedRequisitionRequestPrompt({
    requestId: requisitionCandidate.requestId,
    triggerKind: requisitionCandidate.triggerKind ?? params.triggerKind,
    manifestPath: requisitionCandidate.manifestPath,
    sharedCorpus: requisitionCandidate.sharedCorpus,
    promptConfig: loadWorkflowFastPathPromptConfig(params.workflowPolicy),
  });
  const result = await startBackgroundWorkflowRun({
    workflowRuntime: params.workflowRuntime,
    workflowPolicy: params.workflowPolicy,
    agentCtx: params.agentCtx,
    snapshot: {
      ...params.snapshot,
      projectRoot: params.projectRoot,
      projectId: params.projectId,
    },
    backgroundRun: {
      kind: "research_queue",
      commandText: buildResearchQueueBackgroundCommand(
        requisitionCandidate.commandText
      ),
      summary:
        requisitionCandidate.summary ??
        `Workflow-triggered literature requisition ${requisitionCandidate.requestId}.`,
      projectId: params.projectId ?? undefined,
      projectRoot: params.projectRoot,
      ensureProjectBinding: params.ensureProjectBinding !== false,
      extraSystemPrompt: requestPrompt,
      dedupeKey: requisitionCandidate.requestId,
      triggerKind: requisitionCandidate.triggerKind ?? params.triggerKind,
    },
  });

  const launchUpdatedAt = new Date().toISOString();
  const launchRequest = result.started
    ? markQueuedPaperIngestionLaunchStarted({
        request: requisitionCandidate,
        nowIso: launchUpdatedAt,
        runId: result.runId,
        sessionKey: result.sessionKey,
        triggerKind: requisitionCandidate.triggerKind ?? params.triggerKind,
        summary:
          result.summary ??
          `Workflow-triggered literature requisition started from ${params.triggerKind}.`,
      })
    : result.queued || result.reason === "session_unavailable"
      ? {
          ...requisitionCandidate,
          status:
            requisitionCandidate.status === "running" ? "running" : "queued",
          updatedAt: launchUpdatedAt,
          triggerKind: requisitionCandidate.triggerKind ?? params.triggerKind,
          lastError: null,
          detail:
            result.summary ??
            `Workflow queued literature requisition from ${params.triggerKind}; it will start when the background runtime is available.`,
        }
      : markQueuedPaperIngestionLaunchFailure({
          request: requisitionCandidate,
          nowIso: launchUpdatedAt,
          error:
            result.summary ??
            `Workflow tried to trigger literature requisition from ${params.triggerKind} but it could not start (${result.reason}).`,
        });

  await setPaperIngestionState({
    projectRoot: params.projectRoot,
    paperIngestion: {
      queued_requests: [
        {
          request_id: launchRequest.requestId,
          request_kind: launchRequest.requestKind,
          wrapper: launchRequest.wrapper,
          command_text: launchRequest.commandText,
          manifest_path: launchRequest.manifestPath,
          shared_corpus: launchRequest.sharedCorpus,
          paper_count: launchRequest.paperCount,
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
      last_updated_at: launchUpdatedAt,
    },
  });

  return result;
}

export async function maybeTriggerQueuedPaperIngestionRequest(params: {
  workflowRuntime?: WorkflowRuntimeApi;
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
  const executableRequests = ingestion.state.queuedRequests.filter((entry) =>
    isPaperIngestionExecutableUploadRequest(entry)
  );
  const queuedCandidateRaw =
    executableRequests.find((entry) =>
      isQueuedPaperIngestionRetryDue(entry, now)
    ) ??
    (!inFlight
      ? executableRequests.find((entry) =>
          ["launching", "running"].includes(entry.status)
        ) ?? null
      : null);
  const queuedCandidate = queuedCandidateRaw
    ? materializeQueuedPapernexusBatchRequestCommand({
        request: queuedCandidateRaw,
        workflowPolicy: params.workflowPolicy,
      })
    : null;
  if (!queuedCandidate || !queuedCandidate.commandText) {
    return maybeTriggerQueuedLiteratureRequisitionRequest({
      workflowRuntime: params.workflowRuntime,
      workflowPolicy: params.workflowPolicy,
      agentCtx: params.agentCtx,
      snapshot: params.snapshot,
      triggerKind: params.triggerKind,
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      paperIngestionState: ingestion.state,
      queuedRequests: ingestion.state.queuedRequests,
      nowIso: now,
      ensureProjectBinding: params.ensureProjectBinding,
    });
  }

  const staleRunning = ["launching", "running"].includes(queuedCandidate.status);
  if (staleRunning) {
    await setPaperIngestionState({
      projectRoot: params.projectRoot,
      paperIngestion: {
        queued_requests: [
          {
            request_id: queuedCandidate.requestId,
            request_kind: queuedCandidate.requestKind,
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
  if (validationReport.status === "invalid") {
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
            request_kind: blockedRequest.requestKind,
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
    promptConfig: loadWorkflowFastPathPromptConfig(params.workflowPolicy),
  });

  if (
    isPapernexusBatchImportLifecycleRequest(validatedRequest) &&
    hasDirectPapernexusBatchExecutionConfig(validatedRequest)
  ) {
    const directResult = await executePapernexusBatchImportRequest({
      projectRoot: params.projectRoot,
      request: {
        ...validatedRequest,
        triggerKind: validatedRequest.triggerKind ?? params.triggerKind,
      },
      waitTimeoutSeconds: 60,
      waitIntervalSeconds: 5,
      remoteAccess: buildPapernexusRemoteAccessConfigFromPolicy(params.workflowPolicy),
    });
    if (directResult) {
      return persistDirectPapernexusBatchExecutionResult({
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        source: "queued_paper_ingestion_request",
        directResult,
      });
    }
  }

  const result = await startBackgroundWorkflowRun({
    workflowRuntime: params.workflowRuntime,
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

  const launchUpdatedAt = new Date().toISOString();
  const launchRequest = result.started
    ? markQueuedPaperIngestionLaunchStarted({
        request: validatedRequest,
        nowIso: launchUpdatedAt,
        runId: result.runId,
        sessionKey: result.sessionKey,
        triggerKind: params.triggerKind,
        summary: `Workflow-triggered upload started from ${params.triggerKind}.`,
      })
    : result.queued || result.reason === "session_unavailable"
      ? {
          ...validatedRequest,
          status: validatedRequest.status === "running" ? "running" : "queued",
          updatedAt: launchUpdatedAt,
          triggerKind: params.triggerKind,
          lastError: null,
          detail:
            result.summary ??
            `Workflow queued upload launch from ${params.triggerKind}; it will start when the background runtime is available.`,
        }
      : markQueuedPaperIngestionLaunchFailure({
          request: validatedRequest,
          nowIso: launchUpdatedAt,
          error:
            result.summary ??
            `Workflow tried to trigger upload from ${params.triggerKind} but it could not start (${result.reason}).`,
        });
  await setPaperIngestionState({
    projectRoot: params.projectRoot,
    paperIngestion: {
      queued_requests: [
        {
          request_id: launchRequest.requestId,
          request_kind: launchRequest.requestKind,
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
          promptConfig: loadWorkflowFastPathPromptConfig(params.workflowPolicy),
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
  workflowRuntime?: WorkflowRuntimeApi;
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
  const ownerAgent =
    normalizeAgentId(params.agentCtx.agentId) ?? normalizeAgentId(params.snapshot.role);
  const requesterSessionKeyForOwner =
    resolveRequesterSessionKeyForOwner({
      requesterSessionKey: params.agentCtx.sessionKey,
      ownerAgent,
    }) ?? params.agentCtx.sessionKey;
  const shouldBindProjectChannel = shouldUseChannelProjectBindingForWorkflow({
    messageChannel: params.agentCtx.messageChannel,
    channelKey: params.agentCtx.channelKey,
    sessionKey: requesterSessionKeyForOwner,
  });

  let ensuredProject:
    | Awaited<ReturnType<typeof ensureWorkflowProjectRoot>>
    | null = null;
  if (shouldEnsureProjectBinding) {
    ensuredProject = await ensureWorkflowProjectRoot({
      policy: params.workflowPolicy,
      workspaceDir: params.agentCtx.workspaceDir,
      sessionKey: requesterSessionKeyForOwner,
      sessionId: params.agentCtx.sessionId,
      messageChannel: params.agentCtx.messageChannel,
      channelKey: shouldBindProjectChannel ? params.agentCtx.channelKey : undefined,
      projectRoot: readString(params.backgroundRun.projectRoot) ?? params.snapshot.projectRoot,
      projectId: resolvedBackgroundProjectId,
      title: resolvedBackgroundTitle,
      topic,
      workflowLine: normalizedKind === "survey_review" ? "survey" : undefined,
    });
    if (!shouldBindProjectChannel) {
      await recordWorkflowNotificationChannelForProject({
        projectRoot: ensuredProject.projectRoot,
        projectId: ensuredProject.projectId,
        messageChannel: params.agentCtx.messageChannel,
        channelKey: params.agentCtx.channelKey,
        sessionKey: requesterSessionKeyForOwner,
        source: "start_background_run",
        notes: "Recorded notification-only channel during workflow startup.",
      });
    }
    if (
      shouldBindProjectChannel &&
      params.snapshot.channelProjectBindingsEnabled &&
      (params.agentCtx.sessionKey || params.agentCtx.sessionId)
    ) {
      const ensuredManifest =
        (await readJsonIfExists<Record<string, unknown>>(
          path.join(ensuredProject.projectRoot, "PROJECT_MANIFEST.json")
        )) ?? {};
      const bindingOwnerAgent =
        normalizeAgentId(ensuredManifest.owner_agent) ?? ownerAgent;
      const bindingSessionKey =
        resolveRequesterSessionKeyForOwner({
          requesterSessionKey: params.agentCtx.sessionKey,
          ownerAgent: bindingOwnerAgent,
        }) ?? requesterSessionKeyForOwner;
      await bindChannelProjectForWorkflow({
        policy: params.workflowPolicy,
        workspaceDir: params.agentCtx.workspaceDir,
        sessionKey: bindingSessionKey ?? undefined,
        sessionId: params.agentCtx.sessionId,
        messageChannel: params.agentCtx.messageChannel,
        channelKey: params.agentCtx.channelKey,
        projectRoot: ensuredProject.projectRoot,
        projectId: ensuredProject.projectId,
        title: ensuredProject.title,
        topic,
        boundByAgent: bindingOwnerAgent ?? params.agentCtx.agentId ?? params.snapshot.role,
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

  const channelKey = deriveBackgroundRunChannelKey({
    channelKey: params.agentCtx.channelKey,
    sessionKey: requesterSessionKeyForOwner,
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
    requesterSessionKey: requesterSessionKeyForOwner,
    family: normalizedFamily,
    kind: normalizedKind,
    projectId: resolvedProjectId,
    projectRoot: resolvedProjectRoot,
    topic: readString(params.backgroundRun.dedupeKey) ?? topic,
    commandText,
  });
  const directPapernexusBatchResult =
    await maybeExecuteDirectPapernexusBatchBackgroundRun({
      projectRoot: resolvedProjectRoot,
      projectId: resolvedProjectId,
      normalizedKind,
      commandText,
      summary: readString(params.backgroundRun.summary) ?? null,
      triggerKind: readString(params.backgroundRun.triggerKind) ?? null,
      extraSystemPrompt: backgroundRunExtraSystemPrompt,
      queueKey,
      source: "start_background_run",
      papernexusRemoteAccess: buildPapernexusRemoteAccessConfigFromPolicy(
        params.workflowPolicy
      ),
    });
  if (directPapernexusBatchResult) {
    return directPapernexusBatchResult;
  }
  const pendingQueueState = await hasPendingBackgroundWorkflowQueueKey({
    queueKey,
    projectId: resolvedProjectId,
    projectRoot: resolvedProjectRoot,
    projectsRoot: params.workflowPolicy.projectsRoot,
    workflowRuntime: params.workflowRuntime,
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
      parentSessionKey: requesterSessionKeyForOwner ?? params.agentCtx.sessionKey,
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
    promptConfig: loadWorkflowFastPathPromptConfig(params.workflowPolicy),
  });
  const mergedContinuationSystemPrompt = mergeBackgroundWorkflowSystemPrompt(
    continuationSystemPrompt,
    backgroundRunExtraSystemPrompt
  );
  const queueIfRuntimeUnavailable = async (reason?: string | null) =>
    queueBackgroundWorkflowUntilRuntimeRecovers({
      workflowPolicy: params.workflowPolicy,
      agentCtx: {
        ...params.agentCtx,
        sessionKey: requesterSessionKeyForOwner ?? undefined,
      },
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

  if (!params.workflowRuntime) {
    return queueIfRuntimeUnavailable(
      "Background workflow execution requires an available workflow execution runtime."
    );
  }

  if (
    resolvedProjectRoot &&
    (normalizedKind === "graph_build" || normalizedKind === "resume_pipeline")
  ) {
    await maybeTriggerQueuedPaperIngestionRequest({
      workflowRuntime: params.workflowRuntime,
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
    workflowRuntime: params.workflowRuntime,
    ownerAgent,
    requesterSessionKey: requesterSessionKeyForOwner ?? undefined,
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
      requesterSessionKey: requesterSessionKeyForOwner ?? undefined,
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
  const backgroundSessionPurpose =
    isPapernexusBackgroundKind(normalizedKind) &&
    looksLikePapernexusHeavyCommand(commandText)
      ? "papernexus-skill"
      : `workflow-${normalizedKind}`;
  const backgroundSessionSegments =
    isPapernexusBackgroundKind(normalizedKind) &&
    looksLikePapernexusHeavyCommand(commandText)
      ? [derivePapernexusTaskLabel(commandText)]
      : [resolvedProjectId, topic];
  const backgroundSessionKey =
    (await maybeRotateBackgroundSessionKey({
      workflowRuntime: params.workflowRuntime,
      sessionKey: sessionLease.sessionKey,
      parentSessionKey: requesterSessionKeyForOwner ?? params.agentCtx.sessionKey,
      purpose: backgroundSessionPurpose,
      segments: backgroundSessionSegments,
    })) ?? sessionLease.sessionKey;
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
          requesterSessionKey: requesterSessionKeyForOwner ?? params.agentCtx.sessionKey,
          messageChannel: params.agentCtx.messageChannel ?? null,
          preferredSessionKey: backgroundSessionKey,
          family: normalizedFamily,
          kind: normalizedKind,
          summary:
            readString(params.backgroundRun.summary) ??
            `Start background workflow for ${topic ?? ensuredProject?.title ?? resolvedProjectId ?? "the current project"}.`,
          parentSessionKey: requesterSessionKeyForOwner ?? params.agentCtx.sessionKey,
          depth: 1,
          runPayload: {
            message: commandText,
            lane: "nested",
            deliver: false,
            idempotencyKey: `openclaw-research:bg:${backgroundSessionKey}:${queueKey}`,
            extraSystemPrompt: mergedContinuationSystemPrompt,
          },
        },
        spawn: async () => {
          const started = await params.workflowRuntime!.run({
            sessionKey: backgroundSessionKey,
            message: commandText,
            lane: "nested",
            deliver: false,
            idempotencyKey: `openclaw-research:bg:${backgroundSessionKey}:${Date.now()}`,
            extraSystemPrompt: mergedContinuationSystemPrompt,
            projectRoot: resolvedProjectRoot,
            projectId: resolvedProjectId,
            ownerAgent,
            requesterSessionKey: requesterSessionKeyForOwner ?? params.agentCtx.sessionKey,
            messageChannel: params.agentCtx.messageChannel,
            workspaceDir: resolvedProjectRoot ?? params.agentCtx.workspaceDir ?? null,
          });
          return {
            runId: started.runId,
            sessionKey: backgroundSessionKey,
            sessionId: started.sessionId ?? null,
            runtime:
              started.runtime ??
              params.workflowRuntime!.runtimeKind ??
              "subagent",
            role: ownerAgent,
            agentId: ownerAgent,
            ownerAgent,
            parentSessionKey: requesterSessionKeyForOwner ?? params.agentCtx.sessionKey,
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
        preferredSessionKey: backgroundSessionKey,
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
        await params.workflowRuntime.run({
          sessionKey: backgroundSessionKey,
          message: commandText,
          lane: "nested",
          deliver: false,
          idempotencyKey: `openclaw-research:bg:${backgroundSessionKey}:${Date.now()}`,
          extraSystemPrompt: mergedContinuationSystemPrompt,
          projectRoot: resolvedProjectRoot,
          projectId: resolvedProjectId,
          ownerAgent,
          requesterSessionKey: requesterSessionKeyForOwner ?? params.agentCtx.sessionKey,
          messageChannel: params.agentCtx.messageChannel,
          workspaceDir: resolvedProjectRoot ?? params.agentCtx.workspaceDir ?? null,
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
      preferredSessionKey: backgroundSessionKey,
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
      requesterSessionKey: requesterSessionKeyForOwner ?? params.agentCtx.sessionKey,
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
