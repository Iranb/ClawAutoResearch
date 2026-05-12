import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import type {
  OpenClawPluginService,
  OpenClawPluginServiceContext,
} from "../runtime-api.js";
import type { PluginRegistrationContext } from "./plugin-registration-shared";
import {
  enqueueWorkflowTask,
  resolveWorkflowProjectQueueKey,
} from "./workflow-coordination";
import {
  drainQueuedBackgroundWorkflowRuns,
  enqueueQueuedBackgroundWorkflowRun,
  hasPendingBackgroundWorkflowQueueKey,
  maybeTriggerQueuedPaperIngestionRequest,
  startBackgroundWorkflowRun,
} from "./workflow-fast-paths";
import {
  acquireBackgroundWorkflowSession,
  getBackgroundWorkflowRunByQueueKey,
  recordBackgroundWorkflowRun,
} from "./workflow-execution/background-pool";
import {
  readWorkflowAnnounceOutboxStore,
  readWorkflowRuntimeSessionsStore,
  updateWorkflowRuntimeQueueStore,
  updateWorkflowRuntimeSessionsStore,
} from "./workflow-execution/runtime-store";
import {
  orchestrateWorkflowTransition,
  recordWorkflowAnnounceEvent,
} from "./workflow-session-orchestrator.js";
import { runWorkflowRuntimeMaintenancePass } from "./workflow-runtime-maintenance.js";
import {
  createWorkflowBroadcastRuntimeFromApi,
  createWorkflowExecutionRuntimeFromApi,
  type WorkflowExecutionRuntime,
} from "./workflow-execution-runtime.js";
import {
  getIdleResearchStateSummary,
  listChannelProjectBindingsForWorkflow,
  recordWorkflowContactEvent,
  runWorkflowAutoIterator,
  type AutoIteratorResult,
} from "./workflow-guard";
import { resolveWorkflowNotificationTargetForProjectSync } from "./workflow-notification-channels.js";
import { shouldUseChannelProjectBindingForWorkflow } from "./workflow-message-channels.js";
import { ensureProjectsBindingIndex } from "./channel-project-bindings";
import {
  selectDispatchableAutoStageAction,
} from "./workflow-guard-runtime/auto-iterator";
import { listActiveProjectsFromRegistry } from "./workflow-project-registry";
import {
  deriveAgentSessionKeyForRole,
  resolveWorkflowDispatchLaunchRunId,
  type DispatchableWorkflowRole,
} from "./agent-task-dispatch";
import { handoffWorkflowTaskToAgent } from "./workflow-execution/delivery-adapter";
import { ensureWorkflowDispatchMailboxMessage } from "./workflow-handoff-runtime";
import { maybeBroadcastWorkflowStatusUpdate } from "./stage-broadcast";
import {
  aggregateGateReviewRound,
  buildAutoGatePanelDiscussionPolicy,
  buildAutoGateReviewPrompt,
  createGateReviewRound,
  defaultGateReviewPanel,
  evaluateAutoGate,
  extractLatestAssistantText,
  materializeGateReviewPacket,
  parseGateReviewResult,
  readGateReviewStore,
  resolveAutoGateIdForStage,
  resolveAutoGateMode,
  saveGateReviewStore,
  type GateReviewAttempt,
  type GateReviewReviewerRole,
  type GateReviewResult,
} from "./workflow-auto-gate";
import {
  aggregateCodeReviewRound,
  buildCodeReviewPrompt,
  buildLocalCodeReviewAttempts,
  createCodeReviewRound,
  defaultCodeReviewPanel,
  materializeCodeReviewPacket,
  parseCodeReviewResult,
  readCodeReviewStore,
  saveCodeReviewStore,
  type CodeReviewAttempt,
  type CodeReviewReviewerRole,
  type CodeReviewResult,
} from "./workflow-code-review.js";
import {
  aggregateAutoModeDiscussionRound,
  buildAutoModeDiscussionPrompt,
  buildLocalAutoModeDiscussionAttempts,
  createAutoModeDiscussionRound,
  defaultAutoModeDiscussionPanel,
  materializeAutoModeDiscussionPacket,
  parseAutoModeDiscussionResult,
  readAutoModeDiscussionStore,
  saveAutoModeDiscussionStore,
  type AutoModeDiscussionAttempt as AutoModeDiscussionReviewAttempt,
  type AutoModeDiscussionReviewerRole,
  type AutoModeDiscussionResult,
} from "./workflow-auto-discussion";
import {
  aggregateWorkflowPanelDiscussionRound,
  buildWorkflowPanelDiscussionPrompt,
  materializeWorkflowPanelDiscussionState,
  normalizeWorkflowPanelDiscussionPolicy,
  parseWorkflowPanelDiscussionResult,
  readWorkflowPanelDiscussionStore,
  saveWorkflowPanelDiscussionStore,
  type WorkflowPanelDiscussionAggregate,
  type WorkflowPanelDiscussionPolicy,
  type WorkflowPanelParticipantRole,
  type WorkflowPanelDiscussionResult,
} from "./workflow-panel-discussion";
import { buildWorkflowSubagentSessionKey } from "./workflow-subagent-sessions";
import { asRecord, asString, normalizeStage } from "./workflow-guard-core/coercion";
import { readJsonIfExists } from "./workflow-guard-core/fs";
import { normalizeWritingContractState } from "./workflow-guard-state/writing-contract";
import { normalizeSurveyReviewState } from "./workflow-guard-state/survey-review";
import { updateAutoDispatchDiagnostics } from "./workflow-auto-dispatch-diagnostics";
import { resolveWorkflowBroadcastSessionKey } from "./workflow-agent-isolation.js";
import { deriveAutoZoteroSyncCandidate } from "./workflow-zotero-sync";
import {
  claimNextWorkflowTaskForOwner,
  releaseWorkflowTasksForSession,
} from "./workflow-team/task-graph";
import {
  recordWorkflowTeamRoundClaim,
  materializeWorkflowTeamRound,
  readWorkflowTeamRoundStore,
  releaseWorkflowTeamRoundSession,
} from "./workflow-team/team-round";
import { appendWorkflowRuntimeEvent } from "./workflow-execution/runtime-store";
import { appendWorkflowDiagnosticEvent } from "./workflow-diagnostics.js";
import {
  getWorkflowTaskGraphPath,
  readWorkflowTaskGraphStore,
  summarizeWorkflowTaskGraphStore,
} from "./workflow-team/task-graph";
import {
  createWorkflowReviewRoundHandoff,
  recordWorkflowReviewRoundResults,
} from "./workflow-handoff/review-rounds";
import {
  mergeBuiltinWorkflowHooksIntoSummary,
  syncBuiltinAutoCodeReviewHook,
  syncBuiltinAutoModeRiskHook,
  syncBuiltinSubmitReadinessHook,
} from "./workflow-hooks/builtin-bridge.js";
import { evaluateWorkflowHooksForPoint } from "./workflow-hooks/executor.js";
import { buildWorkflowHookPointContext } from "./workflow-hooks/point-context.js";
import type {
  WorkflowGateControlPackage,
  WorkflowHookPoint,
} from "./workflow-hooks/contracts.js";

type WorkflowCoordinatorLogger = {
  debug?: (message: string, meta?: Record<string, unknown>) => void;
  info?: (message: string, meta?: Record<string, unknown>) => void;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
};

type WorkflowCoordinatorProject = {
  projectId: string | null;
  projectRoot: string;
  source: "projects_state" | "scan";
  stage: string | null;
  updatedAt: string | null;
  channelKey: string | null;
};

type WorkflowCoordinatorPassEntry = WorkflowCoordinatorProject & {
  result: AutoIteratorResult;
};

function buildWorkflowCoordinatorFailureResult(params: {
  project: WorkflowCoordinatorProject;
  policy?: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  error: unknown;
}): AutoIteratorResult {
  const errorMessage =
    params.error instanceof Error ? params.error.message : String(params.error);
  return {
    projectRoot: params.project.projectRoot,
    projectId: params.project.projectId,
    mode: "service",
    configuredAutoMode: params.policy?.autoMode ?? "off",
    effectiveAutoMode: params.policy?.autoMode ?? "off",
    autoModeRiskLevel: "stable",
    autoModeReasons: [],
    autoModeRiskFingerprint: null,
    autoModeMitigationStatus: null,
    autoModeMitigationRoundsStarted: 0,
    autoModeMitigationRoundsRemaining: 0,
    stageBefore: params.project.stage,
    stageEffective: params.project.stage,
    stageAfter: params.project.stage,
    stageChanged: false,
    regressed: false,
    gateBlocking: true,
    gateReason: errorMessage,
    timedDefaultTriggered: false,
    missingStageSignals: [errorMessage],
    ownerBefore: null,
    ownerAfter: null,
    ownerActivated: false,
    pendingHandoff: false,
    pendingHandoffPhase: null,
    pendingHandoffExecutionId: null,
    nextAction: errorMessage,
    resumeAction: errorMessage,
    blockingReason: errorMessage,
    experimentDecision: null,
    experimentDecisionRationale: null,
    experimentRollbackStage: null,
    graphPresenceCheck: null,
    projectsStateUpdated: false,
    auditPath: null,
    materializedArtifacts: [],
    hookEvents: [],
    recommendedActions: [],
  };
}

async function settleCoordinatorProjectStep<
  TEntry extends { projectId?: string | null; projectRoot?: string | null },
  TResult,
  TErrorResult = TResult,
>(params: {
  entries: TEntry[];
  stepName: string;
  logger?: WorkflowCoordinatorLogger;
  run: (entry: TEntry, index: number) => Promise<TResult>;
  onError: (entry: TEntry, index: number, error: unknown) => TErrorResult;
}): Promise<Array<TResult | TErrorResult>> {
  return Promise.all(
    params.entries.map(async (entry, index) => {
      try {
        return await params.run(entry, index);
      } catch (error) {
        params.logger?.warn?.(
          `Workflow coordinator ${params.stepName} failed for one project.`,
          {
            projectId: entry.projectId ?? null,
            projectRoot: entry.projectRoot ?? null,
            error: error instanceof Error ? error.message : String(error),
          }
        );
        return params.onError(entry, index, error);
      }
    })
  );
}

const POOLED_SERVICE_ROLES = new Set([
  "researcher",
  "orchestrator",
  "coder",
  "analyzer",
  "academic_writer",
  "reviewer",
]);

function shouldUsePooledServiceSession(role: string | null | undefined): boolean {
  return typeof role === "string" && POOLED_SERVICE_ROLES.has(role);
}

type WorkflowCoordinatorDependencies = {
  runWorkflowAutoIterator: typeof runWorkflowAutoIterator;
  listWorkflowCoordinatorProjects: typeof listWorkflowCoordinatorProjects;
  getIdleResearchStateSummary: typeof getIdleResearchStateSummary;
  listChannelProjectBindingsForWorkflow: typeof listChannelProjectBindingsForWorkflow;
  runWorkflowRuntimeMaintenancePass: typeof runWorkflowRuntimeMaintenancePass;
};

function resolveWorkflowCoordinatorDependencies(
  overrides?: Partial<WorkflowCoordinatorDependencies>
): WorkflowCoordinatorDependencies {
  return {
    runWorkflowAutoIterator:
      overrides?.runWorkflowAutoIterator ?? runWorkflowAutoIterator,
    listWorkflowCoordinatorProjects:
      overrides?.listWorkflowCoordinatorProjects ?? listWorkflowCoordinatorProjects,
    getIdleResearchStateSummary:
      overrides?.getIdleResearchStateSummary ?? getIdleResearchStateSummary,
    listChannelProjectBindingsForWorkflow:
      overrides?.listChannelProjectBindingsForWorkflow ??
      listChannelProjectBindingsForWorkflow,
    runWorkflowRuntimeMaintenancePass:
      overrides?.runWorkflowRuntimeMaintenancePass ?? runWorkflowRuntimeMaintenancePass,
  };
}

const TEAM_CLAIM_RELEASE_SESSION_STATUSES = new Set(["completed", "failed", "needs_repair"]);

export async function reconcileClaimedWorkflowTasksForProject(params: {
  projectRoot: string;
  projectId: string | null;
}): Promise<{
  releasedTaskIds: string[];
  releasedSessionKeys: string[];
}> {
  const sessionsStore = await readWorkflowRuntimeSessionsStore(params.projectRoot);
  const staleSessionKeys = sessionsStore.entries
    .filter((entry) => TEAM_CLAIM_RELEASE_SESSION_STATUSES.has(entry.status))
    .map((entry) => entry.sessionKey);

  const releasedTaskIds: string[] = [];
  const releasedSessionKeys: string[] = [];

  for (const sessionKey of staleSessionKeys) {
    const released = await releaseWorkflowTasksForSession({
      projectRoot: params.projectRoot,
      sessionKey,
    });
    if (released.releasedTaskIds.length > 0) {
      releasedTaskIds.push(...released.releasedTaskIds);
      releasedSessionKeys.push(sessionKey);
      await releaseWorkflowTeamRoundSession({
        projectRoot: params.projectRoot,
        sessionKey,
      });
      await appendWorkflowRuntimeEvent({
        projectRoot: params.projectRoot,
        projectId: params.projectId ?? null,
        kind: "team_task_released",
        summary: `Released ${released.releasedTaskIds.length} task claim(s) from ${sessionKey}.`,
        details: {
          sessionKey,
          taskIds: released.releasedTaskIds,
        },
      });
    }
  }

  return {
    releasedTaskIds,
    releasedSessionKeys,
  };
}

type WorkflowRuntimeApi = WorkflowExecutionRuntime;

type WorkflowPanelRuntimeAttempt<Role extends string, Result> = {
  reviewerRole: Role;
  sessionKey: string;
  runId: string | null;
  queueKey?: string | null;
  status: "pending" | "completed" | "error";
  launchedAt: string;
  completedAt: string | null;
  error: string | null;
  result: Result | null;
};

type IdleResearchLaunchAttempt = {
  launched: boolean;
  reason:
    | "started"
    | "no_runtime_subagent"
    | "no_recommended_idle_research"
    | "idle_research_disabled"
    | "idle_research_not_due"
    | "idle_research_topic_missing"
    | "idle_research_already_launched"
    | "channel_capacity_reached";
  projectId: string | null;
  projectRoot: string;
  topic: string | null;
  sessionKey: string | null;
  runId: string | null;
  dueKey: string | null;
  summary: string | null;
  reusedIdleSession: boolean;
  activeResearcherSessionsInChannel: number | null;
};

type AutoZoteroSyncAttempt = {
  launched: boolean;
  queued: boolean;
  reason:
    | "started"
    | "queued"
    | "no_candidate"
    | "already_launched"
    | "already_queued";
  projectId: string | null;
  projectRoot: string;
  trigger: string | null;
  triggerReason: string | null;
  sessionKey: string | null;
  runId: string | null;
  summary: string | null;
  queueKey: string | null;
  zoteroProjectPath: string | null;
  packetPath: string | null;
  markdownPath: string | null;
};

type PaperIngestionWorkerAttempt = {
  launched: boolean;
  queued: boolean;
  reason:
    | "started"
    | "queued"
    | "no_runtime_subagent"
    | "no_request"
    | "already_active"
    | "blocked";
  projectId: string | null;
  projectRoot: string;
  sessionKey: string | null;
  runId: string | null;
  summary: string | null;
  queueKey: string | null;
};

type AutoStageLaunchAttempt = {
  launched: boolean;
  reason:
    | "started"
    | "auto_mode_disabled"
    | "risk_discussion_pending"
    | "no_runtime_subagent"
    | "binding_missing"
    | "session_pool_full"
    | "gate_blocked"
    | "no_drive_stage_action"
    | "cooldown_active"
    | "already_launched"
    | "dispatch_failed";
  projectId: string | null;
  projectRoot: string;
  stage: string | null;
  owner: string | null;
  sessionKey: string | null;
  runId: string | null;
  dispatchStrategy: string | null;
  launchKey: string | null;
  error: string | null;
  reusedServiceSession: boolean;
  activeResearcherSessionsInChannel: number | null;
};

type AutoGateReviewAttempt = {
  launched: boolean;
  reason:
    | "disabled"
    | "not_submit_gate"
    | "manual_confirmation_required"
    | "no_runtime_subagent"
    | "already_approved"
    | "already_rejected"
    | "reviewing"
    | "started"
    | "updated"
    | "launch_failed";
  projectId: string | null;
  projectRoot: string;
  gateId: string | null;
  stage: string | null;
  status: string | null;
  reviewCount: number;
  approved: boolean;
};

type AutoCodeReviewAttempt = {
  launched: boolean;
  reason:
    | "disabled"
    | "not_code_gate"
    | "bundle_incomplete"
    | "no_runtime_subagent"
    | "already_approved"
    | "already_rejected"
    | "reviewing"
    | "started"
    | "updated"
    | "launch_failed"
    | "local_static_review_no_runtime"
    | "local_static_review_runtime_stale"
    | "local_static_review_launch_failed";
  projectId: string | null;
  projectRoot: string;
  gateId: string | null;
  stage: string | null;
  status: string | null;
  reviewCount: number;
  approved: boolean;
};

type AutoModeDiscussionAttempt = {
  launched: boolean;
  reason:
    | "disabled"
    | "stable"
    | "no_runtime_subagent"
    | "binding_missing"
    | "reviewing"
    | "started"
    | "updated"
    | "resolved"
    | "round_limit_reached"
    | "local_static_discussion_no_runtime"
    | "local_static_discussion_runtime_stale"
    | "local_static_discussion_launch_failed";
  projectId: string | null;
  projectRoot: string;
  fingerprint: string | null;
  stage: string | null;
  riskLevel: string | null;
  status: string | null;
  reviewCount: number;
  roundsStarted: number;
  recommendedOwner: DispatchableWorkflowRole | null;
  actionItems: string[];
  blockers: string[];
  summary: string | null;
  roundId: string | null;
  packetPath: string | null;
  resolved: boolean;
};

type WorkflowPanelDiscussionServiceAttempt = {
  launched: boolean;
  reason:
    | "started"
    | "reviewing"
    | "updated"
    | "resolved"
    | "no_runtime_subagent"
    | "round_limit_reached";
  projectId: string | null;
  projectRoot: string;
  discussionId: string;
  topic: string;
  stage: string | null;
  status: string | null;
  reviewCount: number;
  roundsStarted: number;
  recommendedOwner: DispatchableWorkflowRole | null;
  actionItems: string[];
  blockers: string[];
  summary: string | null;
  roundId: string | null;
  packetPath: string | null;
  resolved: boolean;
};

type WorkflowHookPointAttempt = {
  launched: boolean;
  reason:
    | "disabled"
    | "no_hooks"
    | "no_runtime_subagent"
    | "started"
    | "reviewing"
    | "updated"
    | "passed"
    | "blocked";
  projectId: string | null;
  projectRoot: string;
  hookPoint: WorkflowHookPoint;
  stage: string | null;
  status: string | null;
  hookCount: number;
  approved: boolean;
  aggregateVerdict: string | null;
  blockingReason: string | null;
  aggregateRevisionPacketPath: string | null;
  gateControl?: WorkflowGateControlPackage | null;
};

type AutoModeMitigationDispatchAttempt = {
  launched: boolean;
  reason:
    | "not_needed"
    | "no_runtime_subagent"
    | "binding_missing"
    | "session_pool_full"
    | "already_dispatched"
    | "dispatch_failed"
    | "started";
  projectId: string | null;
  projectRoot: string;
  fingerprint: string | null;
  stage: string | null;
  owner: DispatchableWorkflowRole | null;
  sessionKey: string | null;
  runId: string | null;
  dispatchStrategy: string | null;
  error: string | null;
  reusedServiceSession: boolean;
  activeResearcherSessionsInChannel: number | null;
};

type WorkflowCoordinatorVisibleStatusUpdate = {
  status: "started" | "continued" | "queued" | "blocked" | "waiting" | "handed_off";
  stage: string | null;
  summary: string;
  dedupeKey: string;
};

function buildSurveyBriefRefinementPanelPolicy(params: {
  topic: string | null;
  diagnosticsPath: string | null;
  surveyBriefPath: string | null;
  literatureReviewPath: string | null;
  sotaMatrixPath: string | null;
  gapSynthesisPath: string | null;
  blockingIssues: string[];
}) {
  return {
    discussionId: "survey-brief-refinement",
    topic: `Refine the survey brief for ${params.topic ?? "the current survey topic"}`,
    stage: "survey_review",
    participants: ["researcher", "analyzer", "planner", "reviewer"],
    maxRounds: 2,
    quorum: 2,
    resolvedDecisions: ["resolved", "pass", "approved"],
    blockedDecisions: ["blocked", "rollback", "rejected"],
    packetArtifacts: [
      "PROJECT_MANIFEST.json",
      "TRACK_REGISTRY.json",
      params.diagnosticsPath,
      "researcher/TOPIC_RELEVANCE_AUDIT.json",
      "researcher/TOPIC_RELEVANCE_AUDIT.md",
      params.surveyBriefPath,
      params.literatureReviewPath,
      params.sotaMatrixPath,
      params.gapSynthesisPath,
    ].filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0),
    promptInstructions:
      "Review the auto-generated survey brief as a bounded synthesis artifact. Focus on whether the taxonomy is stable, whether the benchmark landscape is explicit, whether unresolved gaps/limitations are carried into the brief without overclaiming consensus, and whether the current include/background boundary still matches the body-aware topic relevance audit.",
    summary: [
      `Topic: ${params.topic ?? "unset"}`,
      ...params.blockingIssues.slice(0, 5),
    ],
    context: {
      artifact: params.surveyBriefPath,
      diagnostics: params.diagnosticsPath,
      blockingIssues: params.blockingIssues,
    },
  };
}

const DEFAULT_WORKFLOW_COORDINATOR_INTERVAL_MS = 120_000;
const DEFAULT_WORKFLOW_COORDINATOR_MAX_PROJECTS = 3;

const readString = asString;

function slugifyForIdempotency(value: string): string {
  return value.replace(/[^a-z0-9_.:-]+/gi, "-");
}

function nowIso() {
  return new Date().toISOString();
}

function readNonNegativeIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function shouldUseLocalCodeReviewFallback(params: {
  launchedAt: string | null | undefined;
  nowMs?: number;
}): boolean {
  const fallbackAfterMs = readNonNegativeIntegerEnv(
    "OPENCLAW_CODE_REVIEW_LOCAL_FALLBACK_AFTER_MS",
    180_000
  );
  const launchedAtMs = Date.parse(readString(params.launchedAt) ?? "");
  if (!Number.isFinite(launchedAtMs)) {
    return fallbackAfterMs === 0;
  }
  return (params.nowMs ?? Date.now()) - launchedAtMs >= fallbackAfterMs;
}

function shouldUseLocalAutoModeDiscussionFallback(params: {
  launchedAt: string | null | undefined;
  nowMs?: number;
}): boolean {
  const fallbackAfterMs = readNonNegativeIntegerEnv(
    "OPENCLAW_AUTO_MODE_DISCUSSION_LOCAL_FALLBACK_AFTER_MS",
    180_000
  );
  const launchedAtMs = Date.parse(readString(params.launchedAt) ?? "");
  if (!Number.isFinite(launchedAtMs)) {
    return fallbackAfterMs === 0;
  }
  return (params.nowMs ?? Date.now()) - launchedAtMs >= fallbackAfterMs;
}

function isWorkflowRuntimeCapacityFailure(error: unknown): boolean {
  const message = readString(error)?.toLowerCase() ?? "";
  return (
    /429|too many requests|rate limit|rate_limit|quota|allocated quota exceeded|provider capacity|all models failed|timeout|timed out|no readable|failed before returning/.test(
      message
    ) ||
    /failed to extract accountid from token/.test(message)
  );
}

function isCodeReviewRuntimeFailure(error: unknown): boolean {
  return isWorkflowRuntimeCapacityFailure(error);
}

function isAutoModeDiscussionRuntimeFailure(error: unknown): boolean {
  return isWorkflowRuntimeCapacityFailure(error);
}

function readGateReviewAnnounceResult(params: {
  entries: Array<{ announceId: string; payload: Record<string, unknown> | null }>;
  attempt: GateReviewAttempt;
}): GateReviewResult | null {
  if (!params.attempt.runId) {
    return null;
  }
  const targetAnnounceId = `gate-review:${params.attempt.runId}:${params.attempt.reviewerRole}`;
  const match = params.entries.find((entry) => entry.announceId === targetAnnounceId);
  const payload = asRecord(match?.payload);
  const result = asRecord(payload?.result);
  if (result) {
    const parsed = parseGateReviewResult(
      JSON.stringify(result),
      params.attempt.reviewerRole
    );
    return {
      ...parsed,
      createdAt: readString(result.createdAt) ?? parsed.createdAt,
      runId: readString(result.runId) ?? params.attempt.runId,
      rawText: readString(result.rawText) ?? parsed.rawText,
    };
  }
  const rawText = readString(payload?.rawText ?? payload?.text);
  if (!rawText) {
    return null;
  }
  const parsed = parseGateReviewResult(rawText, params.attempt.reviewerRole);
  return {
    ...parsed,
    runId: readString(payload?.runId) ?? parsed.runId ?? params.attempt.runId,
  };
}

function readCodeReviewAnnounceResult(params: {
  entries: Array<{ announceId: string; payload: Record<string, unknown> | null }>;
  attempt: CodeReviewAttempt;
}): CodeReviewResult | null {
  if (!params.attempt.runId) {
    return null;
  }
  const targetAnnounceId = `code-review:${params.attempt.runId}:${params.attempt.reviewerRole}`;
  const match = params.entries.find((entry) => entry.announceId === targetAnnounceId);
  const payload = asRecord(match?.payload);
  const result = asRecord(payload?.result);
  if (result) {
    const parsed = parseCodeReviewResult(
      JSON.stringify(result),
      params.attempt.reviewerRole
    );
    return {
      ...parsed,
      createdAt: readString(result.createdAt) ?? parsed.createdAt,
      runId: readString(result.runId) ?? params.attempt.runId,
      rawText: readString(result.rawText) ?? parsed.rawText,
    };
  }
  const rawText = readString(payload?.rawText ?? payload?.text);
  if (!rawText) {
    return null;
  }
  const parsed = parseCodeReviewResult(rawText, params.attempt.reviewerRole);
  return {
    ...parsed,
    runId: readString(payload?.runId) ?? parsed.runId ?? params.attempt.runId,
  };
}

function readAutoModeDiscussionAnnounceResult(params: {
  entries: Array<{ announceId: string; payload: Record<string, unknown> | null }>;
  attempt: AutoModeDiscussionReviewAttempt;
}): AutoModeDiscussionResult | null {
  if (!params.attempt.runId) {
    return null;
  }
  const targetAnnounceId = `auto-discussion:${params.attempt.runId}:${params.attempt.reviewerRole}`;
  const match = params.entries.find((entry) => entry.announceId === targetAnnounceId);
  const payload = asRecord(match?.payload);
  const result = asRecord(payload?.result);
  if (result) {
    const parsed = parseAutoModeDiscussionResult(
      JSON.stringify(result),
      params.attempt.reviewerRole
    );
    return {
      ...parsed,
      createdAt: readString(result.createdAt) ?? parsed.createdAt,
      runId: readString(result.runId) ?? params.attempt.runId,
      rawText: readString(result.rawText) ?? parsed.rawText,
    };
  }
  const rawText = readString(payload?.rawText ?? payload?.text);
  if (!rawText) {
    return null;
  }
  const parsed = parseAutoModeDiscussionResult(rawText, params.attempt.reviewerRole);
  return {
    ...parsed,
    runId: readString(payload?.runId) ?? parsed.runId ?? params.attempt.runId,
  };
}

function readWorkflowPanelDiscussionAnnounceResult<Role extends string, Result>(params: {
  entries: Array<{ announceId: string; payload: Record<string, unknown> | null }>;
  attempt: WorkflowPanelRuntimeAttempt<Role, Result>;
  announceIdPrefix: string;
  parseResult: (text: string, reviewerRole: Role) => Result;
  reviveStructuredResult?: (
    value: Record<string, unknown>,
    attempt: WorkflowPanelRuntimeAttempt<Role, Result>,
    parsed: Result
  ) => Result;
}): Result | null {
  if (!params.attempt.runId) {
    return null;
  }
  const targetAnnounceId = `${params.announceIdPrefix}:${params.attempt.runId}:${params.attempt.reviewerRole}`;
  const match = params.entries.find((entry) => entry.announceId === targetAnnounceId);
  const payload = asRecord(match?.payload);
  const result = asRecord(payload?.result);
  if (result) {
    const parsed = params.parseResult(
      JSON.stringify(result),
      params.attempt.reviewerRole
    );
    return params.reviveStructuredResult
      ? params.reviveStructuredResult(result, params.attempt, parsed)
      : parsed;
  }
  const rawText = readString(payload?.rawText ?? payload?.text);
  if (!rawText) {
    return null;
  }
  return params.parseResult(rawText, params.attempt.reviewerRole);
}

async function launchWorkflowPanelDiscussionAttempts<Role extends string, Result>(params: {
  workflowRuntime: WorkflowRuntimeApi;
  participants: Role[];
  requesterSessionKey: string;
  projectRoot: string;
  projectId: string | null;
  source: string;
  family: string;
  kind: string;
  buildSessionKey: (reviewerRole: Role) => string;
  buildQueueKey: (reviewerRole: Role) => string;
  buildPrompt: (reviewerRole: Role) => string;
  buildSummary: (reviewerRole: Role) => string;
  extraSystemPrompt: string;
  buildErrorResult: (reviewerRole: Role, errorMessage: string) => Result;
}): Promise<Array<WorkflowPanelRuntimeAttempt<Role, Result>>> {
  const attempts: Array<WorkflowPanelRuntimeAttempt<Role, Result>> = [];
  for (const reviewerRole of params.participants) {
    const sessionKey = params.buildSessionKey(reviewerRole);
    const queueKey = params.buildQueueKey(reviewerRole);
    try {
      const started = await launchWorkflowNestedRunTransition({
        workflowRuntime: params.workflowRuntime,
        source: params.source,
        queueKey,
        ownerAgent: reviewerRole,
        sessionKey,
        requesterSessionKey: params.requesterSessionKey,
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        family: params.family,
        kind: params.kind,
        summary: params.buildSummary(reviewerRole),
        message: params.buildPrompt(reviewerRole),
        idempotencyKey: queueKey,
        extraSystemPrompt: params.extraSystemPrompt,
      });
      if (!started.launched || !started.runId) {
        throw new Error(
          started.error ??
            `Workflow panel discussion reviewer ${String(reviewerRole)} failed to launch.`
        );
      }
      attempts.push({
        reviewerRole,
        sessionKey,
        runId: started.runId,
        queueKey,
        status: "pending",
        launchedAt: nowIso(),
        completedAt: null,
        error: null,
        result: null,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      attempts.push({
        reviewerRole,
        sessionKey,
        runId: null,
        queueKey,
        status: "error",
        launchedAt: nowIso(),
        completedAt: nowIso(),
        error: errorMessage,
        result: params.buildErrorResult(reviewerRole, errorMessage),
      });
    }
  }
  return attempts;
}

async function pollWorkflowPanelDiscussionAttempts<Role extends string, Result>(params: {
  workflowRuntime: WorkflowRuntimeApi;
  attempts: Array<WorkflowPanelRuntimeAttempt<Role, Result>>;
  projectRoot: string;
  projectId: string | null;
  announceIdPrefix: string;
  parseResult: (text: string, reviewerRole: Role) => Result;
  reviveStructuredResult?: (
    value: Record<string, unknown>,
    attempt: WorkflowPanelRuntimeAttempt<Role, Result>,
    parsed: Result
  ) => Result;
  buildErrorResult: (reviewerRole: Role, errorMessage: string) => Result;
  buildNoResponseResult: (reviewerRole: Role) => Result;
  buildFailureSummary: (attempt: WorkflowPanelRuntimeAttempt<Role, Result>) => string;
  buildCompletionSummary: (attempt: WorkflowPanelRuntimeAttempt<Role, Result>) => string;
  buildFailurePayload: (
    attempt: WorkflowPanelRuntimeAttempt<Role, Result>,
    errorMessage: string,
    result: Result
  ) => Record<string, unknown>;
  buildCompletionPayload: (
    attempt: WorkflowPanelRuntimeAttempt<Role, Result>,
    result: Result
  ) => Record<string, unknown>;
  hydratePendingAttempt?: (
    attempt: WorkflowPanelRuntimeAttempt<Role, Result>
  ) => Promise<WorkflowPanelRuntimeAttempt<Role, Result>>;
}): Promise<Array<WorkflowPanelRuntimeAttempt<Role, Result>>> {
  const announceStore = await readWorkflowAnnounceOutboxStore(params.projectRoot);
  const nextAttempts: Array<WorkflowPanelRuntimeAttempt<Role, Result>> = [];

  for (const originalAttempt of params.attempts) {
    let attempt = originalAttempt;
    if (attempt.status !== "pending") {
      nextAttempts.push(attempt);
      continue;
    }
    if (params.hydratePendingAttempt) {
      attempt = await params.hydratePendingAttempt(attempt);
      if (attempt.status !== "pending") {
        nextAttempts.push(attempt);
        continue;
      }
    }
    const announcedResult = readWorkflowPanelDiscussionAnnounceResult({
      entries: announceStore.entries,
      attempt,
      announceIdPrefix: params.announceIdPrefix,
      parseResult: params.parseResult,
      reviveStructuredResult: params.reviveStructuredResult,
    });
    if (announcedResult) {
      nextAttempts.push({
        ...attempt,
        status: "completed",
        completedAt: attempt.completedAt ?? nowIso(),
        error: null,
        result: announcedResult,
      });
      continue;
    }
    if (!attempt.runId || !params.workflowRuntime.waitForRun) {
      nextAttempts.push(attempt);
      continue;
    }
    const waited = await params.workflowRuntime.waitForRun({
      runId: attempt.runId,
      timeoutMs: 1,
    });
    if (waited.status === "timeout") {
      nextAttempts.push(attempt);
      continue;
    }
    if (waited.status === "error") {
      const errorMessage = waited.error ?? "panel discussion run failed";
      const result = params.buildErrorResult(attempt.reviewerRole, errorMessage);
      const failedAttempt = {
        ...attempt,
        status: "error" as const,
        completedAt: nowIso(),
        error: errorMessage,
        result,
      };
      await recordWorkflowAnnounceEvent({
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        announceId: `${params.announceIdPrefix}:${attempt.runId}:${attempt.reviewerRole}`,
        parentSessionKey: null,
        childSessionKey: attempt.sessionKey,
        deliveryMode: "internal",
        summary: params.buildFailureSummary(failedAttempt),
        payload: params.buildFailurePayload(failedAttempt, errorMessage, result),
      });
      nextAttempts.push(failedAttempt);
      continue;
    }
    const messages = params.workflowRuntime.getSessionMessages
      ? await params.workflowRuntime.getSessionMessages({
          sessionKey: attempt.sessionKey,
          limit: 20,
        })
      : { messages: [] };
    const latestText = extractLatestAssistantText(messages.messages);
    const result = latestText
      ? params.parseResult(latestText, attempt.reviewerRole)
      : params.buildNoResponseResult(attempt.reviewerRole);
    const completedAttempt = {
      ...attempt,
      status: "completed" as const,
      completedAt: nowIso(),
      error: null,
      result,
    };
    await recordWorkflowAnnounceEvent({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      announceId: `${params.announceIdPrefix}:${attempt.runId}:${attempt.reviewerRole}`,
      parentSessionKey: null,
      childSessionKey: attempt.sessionKey,
      deliveryMode: "internal",
      summary: params.buildCompletionSummary(completedAttempt),
      payload: params.buildCompletionPayload(completedAttempt, result),
    });
    nextAttempts.push(completedAttempt);
  }

  return nextAttempts;
}

function resolveWorkflowRequesterSessionKey(params: {
  projectRoot: string;
  workflowPolicy?: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  deps?: Partial<WorkflowCoordinatorDependencies>;
}): string | null {
  return resolveWorkflowRequesterBinding(params).sessionKey;
}

function resolveWorkflowRequesterBinding(params: {
  projectRoot: string;
  workflowPolicy?: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  deps?: Partial<WorkflowCoordinatorDependencies>;
}): {
  sessionKey: string | null;
  messageChannel: string | null;
  channelKey: string | null;
} {
  const notificationTarget = resolveWorkflowNotificationTargetForProjectSync(
    params.projectRoot
  );
  if (notificationTarget?.sessionKey) {
    return {
      sessionKey: notificationTarget.sessionKey,
      messageChannel: notificationTarget.messageChannel,
      channelKey: notificationTarget.channelKey,
    };
  }
  const deps = resolveWorkflowCoordinatorDependencies(params.deps);
  const bindings = deps.listChannelProjectBindingsForWorkflow({
    policy: params.workflowPolicy,
  });
  const binding = bindings.bindings
    .filter(
      (entry) => path.resolve(entry.projectRoot) === path.resolve(params.projectRoot)
    )
    .filter((entry) =>
      shouldUseChannelProjectBindingForWorkflow({
        messageChannel: entry.messageChannel,
        channelKey: entry.channelKey,
        sessionKey: resolveWorkflowBroadcastSessionKey(entry) ?? entry.sessionKeySample,
      })
    )
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    )[0];
  return {
    sessionKey: resolveWorkflowBroadcastSessionKey(binding) ?? null,
    messageChannel: binding?.messageChannel ?? null,
    channelKey: binding?.channelKey ?? null,
  };
}

function hasWorkflowProjectBinding(params: {
  projectRoot: string;
  workflowPolicy?: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  deps?: Partial<WorkflowCoordinatorDependencies>;
}): boolean {
  const deps = resolveWorkflowCoordinatorDependencies(params.deps);
  const bindings = deps.listChannelProjectBindingsForWorkflow({
    policy: params.workflowPolicy,
  });
  return bindings.bindings.some(
    (entry) => path.resolve(entry.projectRoot) === path.resolve(params.projectRoot)
  );
}

function resolveWorkflowCoordinationKey(params: {
  projectRoot: string;
  workflowPolicy?: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  deps?: Partial<WorkflowCoordinatorDependencies>;
}): string {
  const binding = resolveWorkflowRequesterBinding(params);
  return resolveWorkflowProjectQueueKey(params.projectRoot, binding.channelKey);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function listProjectsFromStateFile(params: {
  projectsRoot: string;
  maxProjects: number;
}): Promise<WorkflowCoordinatorProject[]> {
  const projects = await listActiveProjectsFromRegistry({
    projectsRoot: params.projectsRoot,
    maxProjects: params.maxProjects,
    pathExists: fileExists,
  });
  return projects.map((entry) => ({
    projectId: entry.projectId,
    projectRoot: entry.projectRoot,
    source: "projects_state",
    stage: entry.stage,
    updatedAt: entry.updatedAt,
    channelKey: null,
  }));
}

async function listProjectsFromDirectoryScan(params: {
  projectsRoot: string;
  maxProjects: number;
}): Promise<WorkflowCoordinatorProject[]> {
  let entries: Dirent<string>[] = [];
  try {
    entries = (await fs.readdir(params.projectsRoot, {
      withFileTypes: true,
      encoding: "utf8",
    })) as Dirent<string>[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const results: WorkflowCoordinatorProject[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const projectRoot = path.join(params.projectsRoot, entry.name);
    const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
    const manifest = await readJsonIfExists<Record<string, unknown>>(manifestPath);
    if (!manifest) {
      continue;
    }
    if (readString(manifest.current_stage)?.toLowerCase() === "done") {
      continue;
    }
    results.push({
      projectId: readString(manifest.project_id) ?? entry.name,
      projectRoot,
      source: "scan",
      stage: readString(manifest.current_stage),
      updatedAt: readString(manifest.last_heartbeat_at),
      channelKey: null,
    });
    if (results.length >= params.maxProjects) {
      break;
    }
  }

  return results;
}

export async function listWorkflowCoordinatorProjects(params: {
  projectsRoot: string;
  maxProjects?: number;
}): Promise<WorkflowCoordinatorProject[]> {
  const projectsRoot = path.resolve(params.projectsRoot);
  const maxProjects = Math.max(
    1,
    Math.floor(params.maxProjects ?? DEFAULT_WORKFLOW_COORDINATOR_MAX_PROJECTS)
  );
  const fromState = await listProjectsFromStateFile({
    projectsRoot,
    maxProjects,
  });
  if (fromState.length > 0) {
    return fromState;
  }
  return listProjectsFromDirectoryScan({
    projectsRoot,
    maxProjects,
  });
}

export async function runWorkflowCoordinatorPass(params: {
  projectsRoot: string;
  policy?: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  cooldownSeconds: number;
  queueMailbox: boolean;
  maxProjects?: number;
  logger?: WorkflowCoordinatorLogger;
  deps?: Partial<WorkflowCoordinatorDependencies>;
}): Promise<WorkflowCoordinatorPassEntry[]> {
  const deps = resolveWorkflowCoordinatorDependencies(params.deps);
  const projects = await deps.listWorkflowCoordinatorProjects({
    projectsRoot: params.projectsRoot,
    maxProjects: params.maxProjects,
  });
  return settleCoordinatorProjectStep({
    entries: projects,
    stepName: "auto_iterator",
    logger: params.logger,
    run: async (project) => {
      const result = await enqueueWorkflowTask({
        key: resolveWorkflowCoordinationKey({
          projectRoot: project.projectRoot,
          workflowPolicy: params.policy,
          deps,
        }),
        label: "workflow_coordinator_tick",
        logger: params.logger,
        task: () =>
          deps.runWorkflowAutoIterator({
            projectRoot: project.projectRoot,
            policy: params.policy,
            agentId: "researcher",
            mode: "service",
            queueMailbox: params.queueMailbox,
            cooldownSeconds: params.cooldownSeconds,
          }),
      });
      return {
        ...project,
        result,
      };
    },
    onError: (project, _index, error) => ({
      ...project,
      result: buildWorkflowCoordinatorFailureResult({
        project,
        policy: params.policy,
        error,
      }),
    }),
  });
}

function hasRecommendedIdleResearchAction(result: {
  recommendedActions: Array<{
    kind: string;
    owner: string | null;
    command: string | null;
  }>;
}): boolean {
  return result.recommendedActions.some(
    (action) =>
      action.kind === "background" &&
      action.owner === "researcher" &&
      /\/idle-research\b/i.test(action.command ?? "")
  );
}

function buildIdleResearchDueKey(params: {
  projectRoot: string;
  topic: string;
  nextDueAt: string | null;
}) {
  return [
    path.resolve(params.projectRoot),
    params.topic.trim().toLowerCase(),
    params.nextDueAt ?? "due-now",
  ].join("::");
}

function resolveResearcherIdleResearchSessionKey(params: {
  projectRoot: string;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  deps: WorkflowCoordinatorDependencies;
}): string {
  const bindings = params.deps.listChannelProjectBindingsForWorkflow({
    policy: params.workflowPolicy,
  });
  const binding = bindings.bindings
    .filter(
      (entry) => path.resolve(entry.projectRoot) === path.resolve(params.projectRoot)
    )
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    )[0];
  if (binding?.sessionKeySample) {
    const baseSessionKey = deriveAgentSessionKeyForRole({
      requesterSessionKey: binding.sessionKeySample,
      targetRole: "researcher",
    });
    return (
      buildWorkflowSubagentSessionKey({
        parentSessionKey: baseSessionKey,
        purpose: "workflow-idle-research",
        segments: [params.projectRoot],
      }) ?? baseSessionKey
    );
  }
  return (
    buildWorkflowSubagentSessionKey({
      parentSessionKey: "agent:researcher:main",
      purpose: "workflow-idle-research",
      segments: [params.projectRoot],
    }) ?? "agent:researcher:main"
  );
}

function buildIdleResearchCoordinatorMessage(params: {
  projectId: string | null;
  projectRoot: string;
  topic: string;
}) {
  return [
    `/idle-research ${JSON.stringify(params.topic)}`,
    "",
    "Workflow coordinator background task.",
    params.projectId ? `Project ID: ${params.projectId}` : null,
    `Project root: ${params.projectRoot}`,
    "This project is currently idle or waiting on another owner, and idle_research is due.",
    "Before fresh work, read research_workflow.get_idle_research. If it is still due, complete exactly one bounded idle-research round for this topic.",
    "Record the round through research_workflow.record_idle_research_run, including digest path, paper counts, and graph-refresh follow-up.",
    "Do not change active tracks, rewrite PLAN.md, or launch experiments from this background round.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildResearcherWorkflowSubagentSessionKey(params: {
  requesterSessionKey?: string | null;
  projectRoot: string;
  purpose: string;
  segments?: Array<string | null | undefined>;
}) {
  const baseSessionKey = deriveAgentSessionKeyForRole({
    requesterSessionKey: params.requesterSessionKey ?? undefined,
    targetRole: "researcher",
  });
  const projectSessionSegment = path.basename(path.resolve(params.projectRoot));
  return (
    buildWorkflowSubagentSessionKey({
      parentSessionKey: baseSessionKey,
      purpose: params.purpose,
      segments: [projectSessionSegment, ...(params.segments ?? [])],
    }) ?? baseSessionKey
  );
}

const ACTIVE_AUTO_DISCUSSION_QUEUE_STATUSES = new Set([
  "queued",
  "launching",
  "running",
  "degraded",
  "needs_repair",
]);
const ACTIVE_WORKFLOW_PANEL_QUEUE_STATUSES = new Set([
  "queued",
  "launching",
  "running",
  "degraded",
  "needs_repair",
]);
const ACTIVE_WORKFLOW_PANEL_SESSION_STATUSES = new Set([
  "active",
  "needs_repair",
]);

async function retireWorkflowPanelRuntimeAttemptState(params: {
  projectRoot: string;
  projectId: string | null;
  attempts: Array<{
    queueKey?: string | null;
    sessionKey?: string | null;
  }>;
  source: string;
  kind: string;
  reason: string;
  eventKind: string;
  diagnosticAction: string;
  diagnosticSummary: string;
  logger?: WorkflowCoordinatorLogger;
}) {
  const currentAt = nowIso();
  const requestedQueueKeys = new Set(
    params.attempts
      .map((attempt) => readString(attempt.queueKey))
      .filter((entry): entry is string => Boolean(entry))
  );
  const requestedSessionKeys = new Set(
    params.attempts
      .map((attempt) => readString(attempt.sessionKey))
      .filter((entry): entry is string => Boolean(entry))
  );
  if (requestedQueueKeys.size === 0 && requestedSessionKeys.size === 0) {
    return {
      retiredQueueKeys: [],
      retiredSessionKeys: [],
    };
  }

  const retiredQueueKeys = new Set<string>();
  await updateWorkflowRuntimeQueueStore({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    updater: (store) =>
      store.entries.map((entry) => {
        if (
          !requestedQueueKeys.has(entry.queueKey) ||
          (entry.source !== params.source && entry.kind !== params.kind) ||
          !ACTIVE_WORKFLOW_PANEL_QUEUE_STATUSES.has(entry.status)
        ) {
          return entry;
        }
        retiredQueueKeys.add(entry.queueKey);
        return {
          ...entry,
          status: "completed",
          lastCheckedAt: currentAt,
          nextRetryAt: null,
          lastError: entry.lastError ?? params.reason,
        };
      }),
  });

  const retiredSessionKeys: string[] = [];
  await updateWorkflowRuntimeSessionsStore({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    updater: (store) =>
      store.entries.map((entry) => {
        const queueMatched =
          entry.queueKey != null && requestedQueueKeys.has(entry.queueKey);
        const sessionMatched = requestedSessionKeys.has(entry.sessionKey);
        if (
          (!queueMatched && !sessionMatched) ||
          (entry.kind !== params.kind && entry.family !== "review") ||
          !ACTIVE_WORKFLOW_PANEL_SESSION_STATUSES.has(entry.status)
        ) {
          return entry;
        }
        retiredSessionKeys.push(entry.sessionKey);
        return {
          ...entry,
          status: "completed",
          lastCheckedAt: currentAt,
          lastFinishedAt: entry.lastFinishedAt ?? currentAt,
          lastError: entry.lastError ?? params.reason,
        };
      }),
  });

  const retiredQueueKeyList = [...retiredQueueKeys];
  if (retiredQueueKeyList.length === 0 && retiredSessionKeys.length === 0) {
    return {
      retiredQueueKeys: [],
      retiredSessionKeys: [],
    };
  }

  await appendWorkflowRuntimeEvent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    kind: params.eventKind,
    summary:
      `Retired ${retiredQueueKeyList.length} ${params.kind} queue entry(s) and ${retiredSessionKeys.length} session(s).`,
    details: {
      reason: params.reason,
      queueKeys: retiredQueueKeyList,
      sessionKeys: retiredSessionKeys,
    },
  });
  await appendWorkflowDiagnosticEvent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    component: "service",
    action: params.diagnosticAction,
    status: "completed",
    summary: params.diagnosticSummary,
    details: {
      reason: params.reason,
      queueKeys: retiredQueueKeyList,
      sessionKeys: retiredSessionKeys,
    },
  });
  params.logger?.debug?.(params.diagnosticSummary, {
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    reason: params.reason,
    queueKeys: retiredQueueKeyList,
    sessionKeys: retiredSessionKeys,
  });
  return {
    retiredQueueKeys: retiredQueueKeyList,
    retiredSessionKeys,
  };
}

async function retireSupersededCodeReviewQueuesForPacket(params: {
  projectRoot: string;
  projectId: string | null;
  packetFingerprint: string;
  reason: string;
  logger?: WorkflowCoordinatorLogger;
}) {
  const currentAt = nowIso();
  const retiredQueueKeys = new Set<string>();
  await updateWorkflowRuntimeQueueStore({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    updater: (store) =>
      store.entries.map((entry) => {
        if (
          entry.kind !== "workflow_auto_code_review" ||
          entry.queueKey.includes(`:${params.packetFingerprint}:`) ||
          !ACTIVE_WORKFLOW_PANEL_QUEUE_STATUSES.has(entry.status)
        ) {
          return entry;
        }
        retiredQueueKeys.add(entry.queueKey);
        return {
          ...entry,
          status: "completed",
          lastCheckedAt: currentAt,
          nextRetryAt: null,
          lastError: entry.lastError ?? params.reason,
        };
      }),
  });
  const retiredQueueKeyList = [...retiredQueueKeys];
  if (retiredQueueKeyList.length === 0) {
    return retiredQueueKeyList;
  }
  await appendWorkflowRuntimeEvent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    kind: "auto_code_review_runtime_retired",
    summary: `Retired ${retiredQueueKeyList.length} superseded code review queue entry(s).`,
    details: {
      reason: params.reason,
      packetFingerprint: params.packetFingerprint,
      queueKeys: retiredQueueKeyList,
    },
  });
  await appendWorkflowDiagnosticEvent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    component: "service",
    action: "auto_code_review_superseded_queues_retired",
    status: "completed",
    summary: "Retired superseded code review queue entries for older packet fingerprints.",
    details: {
      reason: params.reason,
      packetFingerprint: params.packetFingerprint,
      queueKeys: retiredQueueKeyList,
    },
  });
  params.logger?.debug?.(
    "Retired superseded code review queue entries for older packet fingerprints.",
    {
      projectId: params.projectId,
      projectRoot: params.projectRoot,
      packetFingerprint: params.packetFingerprint,
      queueKeys: retiredQueueKeyList,
    }
  );
  return retiredQueueKeyList;
}

function extractAutoModeDiscussionFingerprint(queueKey: string): string | null {
  const parts = queueKey.split(":");
  if (parts.length >= 6 && parts[0] === "openclaw-research" && parts[1] === "auto-discussion") {
    return parts[3] || null;
  }
  if (parts.length >= 5 && parts[0] === "auto-discussion") {
    return parts[2] || null;
  }
  return null;
}

function buildAutoModeDiscussionQueueKey(params: {
  projectRoot: string;
  projectId: string | null;
  fingerprint: string;
  reviewerRole: AutoModeDiscussionReviewerRole;
  roundNumber: number;
}) {
  return slugifyForIdempotency(
    `openclaw-research:auto-discussion:${params.projectId ?? path.basename(params.projectRoot)}:${params.fingerprint}:${params.reviewerRole}:${params.roundNumber}`
  );
}

function readAutoModeDiscussionProjectSegment(queueKey: string): string | null {
  const parts = queueKey.split(":");
  if (parts.length >= 6 && parts[0] === "openclaw-research" && parts[1] === "auto-discussion") {
    return parts[2] || null;
  }
  if (parts.length >= 5 && parts[0] === "auto-discussion") {
    return parts[1] || null;
  }
  return null;
}

function autoModeDiscussionQueueBelongsToProject(params: {
  queueKey: string;
  projectRoot: string;
  projectId: string | null;
}) {
  const projectSegment = readAutoModeDiscussionProjectSegment(params.queueKey);
  if (!projectSegment) {
    return false;
  }
  const acceptedProjectSegments = new Set([
    params.projectId,
    path.basename(path.resolve(params.projectRoot)),
  ].filter((entry): entry is string => Boolean(entry)));
  return acceptedProjectSegments.has(projectSegment);
}

function buildAutoModeDiscussionReviewerSessionKey(params: {
  requesterSessionKey?: string | null;
  reviewerRole: AutoModeDiscussionReviewerRole;
  projectRoot: string;
  stage: string | null;
  riskLevel: string | null;
  fingerprint: string;
  roundNumber: number;
}) {
  const baseSessionKey = deriveAgentSessionKeyForRole({
    requesterSessionKey: params.requesterSessionKey ?? undefined,
    targetRole: params.reviewerRole,
  });
  return (
    buildWorkflowSubagentSessionKey({
      parentSessionKey: baseSessionKey,
      purpose: "workflow-auto-discussion",
      segments: [
        path.basename(path.resolve(params.projectRoot)),
        params.fingerprint.slice(0, 12),
        params.reviewerRole,
        params.stage,
        params.riskLevel,
        `${params.roundNumber}`,
      ],
    }) ?? baseSessionKey
  );
}

async function retireSupersededAutoModeDiscussionRuntimeState(params: {
  projectRoot: string;
  projectId: string | null;
  activeFingerprint: string;
  logger?: WorkflowCoordinatorLogger;
}) {
  const currentAt = nowIso();
  const retiredQueueKeys = new Set<string>();
  const supersededReason =
    `Auto discussion round was superseded by newer risk fingerprint ${params.activeFingerprint}.`;

  await updateWorkflowRuntimeQueueStore({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    updater: (store) =>
      store.entries.map((entry) => {
        if (
          entry.source !== "workflow_auto_discussion" &&
          entry.kind !== "workflow_auto_discussion"
        ) {
          return entry;
        }
        if (
          !autoModeDiscussionQueueBelongsToProject({
            queueKey: entry.queueKey,
            projectRoot: params.projectRoot,
            projectId: params.projectId,
          })
        ) {
          return entry;
        }
        const fingerprint = extractAutoModeDiscussionFingerprint(entry.queueKey);
        if (
          fingerprint === params.activeFingerprint ||
          !ACTIVE_AUTO_DISCUSSION_QUEUE_STATUSES.has(entry.status)
        ) {
          return entry;
        }
        retiredQueueKeys.add(entry.queueKey);
        return {
          ...entry,
          status: "completed",
          lastCheckedAt: currentAt,
          nextRetryAt: null,
          lastError: entry.lastError ?? supersededReason,
        };
      }),
  });

  if (retiredQueueKeys.size === 0) {
    return {
      retiredQueueKeys: [],
      retiredSessionKeys: [],
    };
  }

  const retiredSessionKeys: string[] = [];
  await updateWorkflowRuntimeSessionsStore({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    updater: (store) =>
      store.entries.map((entry) => {
        if (!entry.queueKey || !retiredQueueKeys.has(entry.queueKey)) {
          return entry;
        }
        if (
          entry.status === "completed" ||
          entry.status === "failed" ||
          entry.status === "idle"
        ) {
          return entry;
        }
        retiredSessionKeys.push(entry.sessionKey);
        return {
          ...entry,
          status: "completed",
          lastCheckedAt: currentAt,
          lastFinishedAt: entry.lastFinishedAt ?? currentAt,
          lastError: entry.lastError ?? supersededReason,
        };
      }),
  });

  const retiredQueueKeyList = [...retiredQueueKeys];
  await appendWorkflowRuntimeEvent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    kind: "auto_discussion_superseded",
    summary:
      `Retired ${retiredQueueKeyList.length} superseded auto discussion queue entry(s).`,
    details: {
      activeFingerprint: params.activeFingerprint,
      retiredQueueKeys: retiredQueueKeyList,
      retiredSessionKeys,
    },
  });
  await appendWorkflowDiagnosticEvent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    component: "service",
    action: "superseded_runtime_state_retired",
    status: "completed",
    summary:
      "Retired stale auto discussion runtime state before launching or polling the current risk fingerprint.",
    details: {
      activeFingerprint: params.activeFingerprint,
      retiredQueueKeys: retiredQueueKeyList,
      retiredSessionKeys,
    },
  });
  params.logger?.debug?.(
    "Retired superseded auto discussion runtime state.",
    {
      projectId: params.projectId,
      projectRoot: params.projectRoot,
      activeFingerprint: params.activeFingerprint,
      retiredQueueKeys: retiredQueueKeyList,
      retiredSessionKeys,
    }
  );
  return {
    retiredQueueKeys: retiredQueueKeyList,
    retiredSessionKeys,
  };
}

function buildWorkflowCoordinatorDispatchSessionKeys(params: {
  requesterSessionKey?: string | null;
  owner: DispatchableWorkflowRole;
  projectRoot: string;
  purpose: string;
  segments?: Array<string | null | undefined>;
}): string[] | undefined {
  if (params.owner !== "researcher") {
    return [
      deriveAgentSessionKeyForRole({
        requesterSessionKey: params.requesterSessionKey ?? undefined,
        targetRole: params.owner,
      }),
    ];
  }
  return [
    buildResearcherWorkflowSubagentSessionKey({
      requesterSessionKey: params.requesterSessionKey,
      projectRoot: params.projectRoot,
      purpose: params.purpose,
      segments: params.segments,
    }),
  ];
}

export function deriveWorkflowCoordinatorStatusUpdate(params: {
  projectId: string | null;
  projectRoot: string;
  stageAfter: string | null;
  timedDefaultTriggered?: boolean;
  timedDefaultSummary?: string | null;
  artifactHooks?: WorkflowHookPointAttempt;
  beforeStageHandoffHooks?: WorkflowHookPointAttempt;
  autoCodeReview?: AutoCodeReviewAttempt;
  autoGateReview: AutoGateReviewAttempt;
  autoModeDiscussion: AutoModeDiscussionAttempt;
  autoMitigationDispatch: AutoModeMitigationDispatchAttempt;
  autoStageLaunch: AutoStageLaunchAttempt;
  idleResearchLaunch: IdleResearchLaunchAttempt;
  autoZoteroSync?: AutoZoteroSyncAttempt;
  paperIngestionWorker?: PaperIngestionWorkerAttempt;
}): WorkflowCoordinatorVisibleStatusUpdate | null {
  const autoCodeReview =
    params.autoCodeReview ??
    ({
      launched: false,
      reason: "disabled",
      projectId: params.projectId,
      projectRoot: params.projectRoot,
      gateId: null,
      stage: params.stageAfter ?? null,
      status: null,
      reviewCount: 0,
      approved: false,
    } satisfies AutoCodeReviewAttempt);
  if (params.autoStageLaunch.launched && params.autoStageLaunch.owner) {
    return {
      status: "handed_off",
      stage: params.autoStageLaunch.stage ?? params.stageAfter ?? null,
      summary:
        params.autoStageLaunch.owner === "researcher" &&
        params.autoStageLaunch.reusedServiceSession
          ? `Workflow handed off to ${params.autoStageLaunch.owner} for ${params.autoStageLaunch.stage ?? params.stageAfter ?? "the current"} stage using an idle reused Researcher service session.`
          : `Workflow handed off to ${params.autoStageLaunch.owner} for ${params.autoStageLaunch.stage ?? params.stageAfter ?? "the current"} stage.`,
      dedupeKey: [
        "handoff",
        params.autoStageLaunch.stage ?? params.stageAfter ?? "unknown",
        params.autoStageLaunch.owner,
        params.autoStageLaunch.dispatchStrategy ?? "unknown",
        params.autoStageLaunch.reusedServiceSession ? "reused" : "fresh",
      ].join(":"),
    };
  }
  if (params.autoMitigationDispatch.launched && params.autoMitigationDispatch.owner) {
    return {
      status: "handed_off",
      stage: params.autoMitigationDispatch.stage ?? params.stageAfter ?? null,
      summary:
        params.autoMitigationDispatch.owner === "researcher" &&
        params.autoMitigationDispatch.reusedServiceSession
          ? "Auto-mode mitigation was handed off to Researcher using an idle reused service session."
          : `Auto-mode mitigation was handed off to ${params.autoMitigationDispatch.owner}.`,
      dedupeKey: [
        "mitigation",
        params.autoMitigationDispatch.stage ?? params.stageAfter ?? "unknown",
        params.autoMitigationDispatch.owner,
        params.autoMitigationDispatch.reusedServiceSession ? "reused" : "fresh",
      ].join(":"),
    };
  }
  const blockingHookAttempt =
    params.beforeStageHandoffHooks?.approved === false &&
    params.beforeStageHandoffHooks.reason === "blocked"
      ? params.beforeStageHandoffHooks
      : params.artifactHooks?.approved === false &&
          params.artifactHooks.reason === "blocked"
        ? params.artifactHooks
        : null;
  if (blockingHookAttempt) {
    return {
      status: "blocked",
      stage: blockingHookAttempt.stage ?? params.stageAfter ?? null,
      summary:
        blockingHookAttempt.blockingReason ??
        `Workflow hooks at ${blockingHookAttempt.hookPoint} blocked the current transition.`,
      dedupeKey: [
        "workflow-hooks",
        "blocked",
        blockingHookAttempt.hookPoint,
        blockingHookAttempt.stage ?? params.stageAfter ?? "unknown",
      ].join(":"),
    };
  }
  const waitingHookAttempt =
    params.beforeStageHandoffHooks?.reason === "started" ||
    params.beforeStageHandoffHooks?.reason === "reviewing"
      ? params.beforeStageHandoffHooks
      : params.artifactHooks?.reason === "started" ||
          params.artifactHooks?.reason === "reviewing"
        ? params.artifactHooks
        : null;
  if (waitingHookAttempt) {
    return {
      status: "waiting",
      stage: waitingHookAttempt.stage ?? params.stageAfter ?? null,
      summary:
        waitingHookAttempt.blockingReason ??
        `Waiting for workflow hooks at ${waitingHookAttempt.hookPoint} before continuing.`,
      dedupeKey: [
        "workflow-hooks",
        waitingHookAttempt.reason,
        waitingHookAttempt.hookPoint,
        waitingHookAttempt.stage ?? params.stageAfter ?? "unknown",
      ].join(":"),
    };
  }
  if (params.timedDefaultTriggered) {
    return {
      status: "continued",
      stage: params.stageAfter ?? null,
      summary:
        params.timedDefaultSummary ??
        "No user reply arrived before the confirmation deadline, so the workflow continued through the default safe branch.",
      dedupeKey: [
        "timed-default",
        params.stageAfter ?? "unknown-stage",
        params.projectId ?? path.basename(params.projectRoot),
      ].join(":"),
    };
  }
  if (params.paperIngestionWorker?.launched) {
    return {
      status: "started",
      stage: params.stageAfter ?? null,
      summary:
        params.paperIngestionWorker.summary ??
        `Started workflow-owned PaperNexus upload worker for ${
          params.projectId ?? path.basename(params.projectRoot)
        }.`,
      dedupeKey: [
        "paper-ingestion-worker",
        "started",
        params.paperIngestionWorker.queueKey ?? "no-queue-key",
      ].join(":"),
    };
  }
  if (params.paperIngestionWorker?.queued) {
    return {
      status: "queued",
      stage: params.stageAfter ?? null,
      summary:
        params.paperIngestionWorker.summary ??
        `Queued workflow-owned PaperNexus upload worker for ${
          params.projectId ?? path.basename(params.projectRoot)
        }.`,
      dedupeKey: [
        "paper-ingestion-worker",
        "queued",
        params.paperIngestionWorker.queueKey ?? "no-queue-key",
      ].join(":"),
    };
  }
  if (params.idleResearchLaunch.launched) {
    return {
      status: "started",
      stage: params.stageAfter ?? null,
      summary:
        params.idleResearchLaunch.summary ??
        `Idle research started${params.idleResearchLaunch.topic ? ` for ${params.idleResearchLaunch.topic}` : ""}.`,
      dedupeKey: [
        "idle-research",
        params.idleResearchLaunch.topic ?? "unknown-topic",
        params.idleResearchLaunch.dueKey ?? "due-now",
        params.idleResearchLaunch.reusedIdleSession ? "reused" : "fresh",
      ].join(":"),
    };
  }
  if (params.idleResearchLaunch.reason === "channel_capacity_reached") {
    return {
      status: "queued",
      stage: params.stageAfter ?? null,
      summary:
        params.idleResearchLaunch.summary ??
        `Queued idle research${params.idleResearchLaunch.topic ? ` for ${params.idleResearchLaunch.topic}` : ""} until a Researcher background session becomes idle in this channel.`,
      dedupeKey: [
        "idle-research",
        "capacity",
        params.idleResearchLaunch.topic ?? "unknown-topic",
        String(params.idleResearchLaunch.activeResearcherSessionsInChannel ?? "unknown"),
      ].join(":"),
    };
  }
  if (params.autoZoteroSync?.launched) {
    return {
      status: "continued",
      stage: params.stageAfter ?? null,
      summary:
        params.autoZoteroSync.summary ??
        `Started non-blocking Zotero sync for ${
          params.projectId ?? path.basename(params.projectRoot)
        }.`,
      dedupeKey: [
        "zotero-sync",
        "started",
        params.autoZoteroSync.trigger ?? "unknown",
        params.autoZoteroSync.queueKey ?? "no-queue-key",
      ].join(":"),
    };
  }
  if (
    params.autoZoteroSync &&
    params.autoZoteroSync.queued &&
    params.autoZoteroSync.reason === "queued"
  ) {
    return {
      status: "queued",
      stage: params.stageAfter ?? null,
      summary:
        params.autoZoteroSync.summary ??
        `Queued non-blocking Zotero sync for ${
          params.projectId ?? path.basename(params.projectRoot)
        }.`,
      dedupeKey: [
        "zotero-sync",
        "queued",
        params.autoZoteroSync.trigger ?? "unknown",
        params.autoZoteroSync.queueKey ?? "no-queue-key",
      ].join(":"),
    };
  }
  if (
    autoCodeReview.reason === "started" ||
    autoCodeReview.reason === "reviewing"
  ) {
    return {
      status: "waiting",
      stage: autoCodeReview.stage ?? params.stageAfter ?? null,
      summary:
        "Waiting for code innovation reviewer quorum before progressing from CODE to EXPERIMENT.",
      dedupeKey: [
        "auto-code-review",
        autoCodeReview.stage ?? params.stageAfter ?? "code",
        autoCodeReview.status ?? autoCodeReview.reason,
      ].join(":"),
    };
  }
  if (
    params.autoGateReview.reason === "manual_confirmation_required"
  ) {
    return {
      status: "waiting",
      stage: params.autoGateReview.stage ?? params.stageAfter ?? null,
      summary:
        "OpenReview-facing submission and the final GATE-5 revision decision require explicit human confirmation; auto mode will stop here.",
      dedupeKey: [
        "auto-gate",
        "manual",
        params.autoGateReview.stage ?? params.stageAfter ?? "submit",
      ].join(":"),
    };
  }
  if (
    params.autoGateReview.reason === "started" ||
    params.autoGateReview.reason === "reviewing"
  ) {
    return {
      status: "waiting",
      stage: params.autoGateReview.stage ?? params.stageAfter ?? null,
      summary: "Waiting for auto gate reviewer quorum at submit before progressing further.",
      dedupeKey: [
        "auto-gate",
        params.autoGateReview.stage ?? params.stageAfter ?? "submit",
        params.autoGateReview.status ?? params.autoGateReview.reason,
      ].join(":"),
    };
  }
  if (
    params.autoModeDiscussion.reason === "started" ||
    params.autoModeDiscussion.reason === "reviewing"
  ) {
    return {
      status: "waiting",
      stage: params.autoModeDiscussion.stage ?? params.stageAfter ?? null,
      summary: "Waiting for the auto-mode risk discussion to settle before the next dispatch.",
      dedupeKey: [
        "auto-discussion",
        params.autoModeDiscussion.stage ?? params.stageAfter ?? "unknown",
        params.autoModeDiscussion.fingerprint ?? "unknown",
        params.autoModeDiscussion.status ?? params.autoModeDiscussion.reason,
      ].join(":"),
    };
  }
  if (
    params.autoStageLaunch.reason === "risk_discussion_pending" ||
    params.autoStageLaunch.reason === "cooldown_active" ||
    params.autoStageLaunch.reason === "already_launched" ||
    params.autoStageLaunch.reason === "session_pool_full"
  ) {
    const summary =
      params.autoStageLaunch.reason === "risk_discussion_pending"
        ? "Waiting for auto-mode risk discussion before handing off the next stage."
        : params.autoStageLaunch.reason === "cooldown_active"
          ? `Queued the next stage handoff until the workflow contact cooldown clears for ${params.autoStageLaunch.owner ?? "the next owner"}.`
          : params.autoStageLaunch.reason === "session_pool_full"
            ? `Queued the ${params.autoStageLaunch.stage ?? params.stageAfter ?? "current"} stage until an idle Researcher service session is available.`
            : `Queued behind the already-running ${params.autoStageLaunch.stage ?? params.stageAfter ?? "workflow"} stage handoff.`;
    return {
      status:
        params.autoStageLaunch.reason === "risk_discussion_pending" ? "waiting" : "queued",
      stage: params.autoStageLaunch.stage ?? params.stageAfter ?? null,
      summary,
      dedupeKey: [
        "stage-wait",
        params.autoStageLaunch.reason,
        params.autoStageLaunch.stage ?? params.stageAfter ?? "unknown",
        params.autoStageLaunch.owner ?? "unknown-owner",
      ].join(":"),
    };
  }
  if (params.autoMitigationDispatch.reason === "session_pool_full") {
    return {
      status: "queued",
      stage: params.autoMitigationDispatch.stage ?? params.stageAfter ?? null,
      summary:
        "Queued the mitigation pass until an idle Researcher service session is available.",
      dedupeKey: [
        "mitigation-wait",
        params.autoMitigationDispatch.stage ?? params.stageAfter ?? "unknown",
        params.autoMitigationDispatch.owner ?? "researcher",
      ].join(":"),
    };
  }
  if (
    params.autoStageLaunch.reason === "gate_blocked" ||
    params.autoStageLaunch.reason === "dispatch_failed" ||
    autoCodeReview.reason === "already_rejected" ||
    params.autoGateReview.reason === "already_rejected"
  ) {
    const summary =
      autoCodeReview.reason === "already_rejected"
        ? "Blocked because the code innovation review rejected the current implementation packet."
        : params.autoGateReview.reason === "already_rejected"
        ? "Blocked because the submit auto gate review rejected the packet."
        : params.autoStageLaunch.reason === "gate_blocked"
          ? `Blocked by the current ${params.autoStageLaunch.stage ?? params.stageAfter ?? "workflow"} gate.`
          : `Blocked because the handoff to ${params.autoStageLaunch.owner ?? "the next owner"} failed${params.autoStageLaunch.error ? `: ${params.autoStageLaunch.error}` : "."}`;
    return {
      status: "blocked",
      stage: params.autoStageLaunch.stage ?? params.stageAfter ?? null,
      summary,
      dedupeKey: [
        "blocked",
        params.autoStageLaunch.reason,
        params.autoStageLaunch.stage ?? params.stageAfter ?? "unknown",
        params.autoStageLaunch.owner ?? "unknown-owner",
      ].join(":"),
    };
  }
  return null;
}

export async function maybeLaunchIdleResearchForProject(params: {
  workflowRuntime?: WorkflowRuntimeApi;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  projectRoot: string;
  projectId: string | null;
  autoIteratorResult: {
    recommendedActions: Array<{
      kind: string;
      owner: string | null;
      command: string | null;
    }>;
  };
  launchedDueKeys: Map<string, string>;
  logger?: WorkflowCoordinatorLogger;
  deps?: Partial<WorkflowCoordinatorDependencies>;
}) {
  const deps = resolveWorkflowCoordinatorDependencies(params.deps);

  return enqueueWorkflowTask({
    key: resolveWorkflowCoordinationKey({
      projectRoot: params.projectRoot,
      workflowPolicy: params.workflowPolicy,
      deps,
    }),
    label: "workflow_idle_research_launch",
    logger: params.logger,
    task: async (): Promise<IdleResearchLaunchAttempt> => {
      if (!params.workflowRuntime) {
        return {
          launched: false,
          reason: "no_runtime_subagent",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          topic: null,
          sessionKey: null,
          runId: null,
          dueKey: null,
          summary: null,
          reusedIdleSession: false,
          activeResearcherSessionsInChannel: null,
        };
      }

      if (!hasRecommendedIdleResearchAction(params.autoIteratorResult)) {
        params.launchedDueKeys.delete(params.projectRoot);
        return {
          launched: false,
          reason: "no_recommended_idle_research",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          topic: null,
          sessionKey: null,
          runId: null,
          dueKey: null,
          summary: null,
          reusedIdleSession: false,
          activeResearcherSessionsInChannel: null,
        };
      }

      const idleResearch = await deps.getIdleResearchStateSummary({
        projectRoot: params.projectRoot,
      });
      const topic = readString(idleResearch.state.topic);
      if (!idleResearch.state.enabled) {
        params.launchedDueKeys.delete(params.projectRoot);
        return {
          launched: false,
          reason: "idle_research_disabled",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          topic,
          sessionKey: null,
          runId: null,
          dueKey: null,
          summary: null,
          reusedIdleSession: false,
          activeResearcherSessionsInChannel: null,
        };
      }
      if (!idleResearch.due) {
        params.launchedDueKeys.delete(params.projectRoot);
        return {
          launched: false,
          reason: "idle_research_not_due",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          topic,
          sessionKey: null,
          runId: null,
          dueKey: null,
          summary: null,
          reusedIdleSession: false,
          activeResearcherSessionsInChannel: null,
        };
      }
      if (!topic) {
        params.launchedDueKeys.delete(params.projectRoot);
        return {
          launched: false,
          reason: "idle_research_topic_missing",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          topic: null,
          sessionKey: null,
          runId: null,
          dueKey: null,
          summary: null,
          reusedIdleSession: false,
          activeResearcherSessionsInChannel: null,
        };
      }

      const dueKey = buildIdleResearchDueKey({
        projectRoot: params.projectRoot,
        topic,
        nextDueAt: idleResearch.nextDueAt,
      });
      if (params.launchedDueKeys.get(params.projectRoot) === dueKey) {
        return {
          launched: false,
          reason: "idle_research_already_launched",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          topic,
          sessionKey: null,
          runId: null,
          dueKey,
          summary: null,
          reusedIdleSession: false,
          activeResearcherSessionsInChannel: null,
        };
      }

      const sessionKey = resolveResearcherIdleResearchSessionKey({
        projectRoot: params.projectRoot,
        workflowPolicy: params.workflowPolicy,
        deps,
      });
      const launched = await startBackgroundWorkflowRun({
        workflowRuntime: params.workflowRuntime,
        workflowPolicy: params.workflowPolicy,
        agentCtx: {
          agentId: "researcher",
          workspaceDir: params.projectRoot,
          sessionKey,
          messageChannel: "discord",
        },
        snapshot: {
          role: "researcher",
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          channelProjectBindingsEnabled:
            params.workflowPolicy.enableChannelProjectBindings === true,
        },
        backgroundRun: {
          kind: "idle_research",
          commandText: buildIdleResearchCoordinatorMessage({
            projectId: params.projectId,
            projectRoot: params.projectRoot,
            topic,
          }),
          topic,
          projectId: params.projectId ?? undefined,
          projectRoot: params.projectRoot,
          ensureProjectBinding: false,
          summary: `Idle research started for ${topic}.`,
        },
      });
      if (!launched.started || !launched.runId || !launched.sessionKey) {
        return {
          launched: false,
          reason:
            launched.reason === "channel_capacity_reached"
              ? "channel_capacity_reached"
              : "no_runtime_subagent",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          topic,
          sessionKey: null,
          runId: null,
          dueKey,
          summary: launched.summary,
          reusedIdleSession: false,
          activeResearcherSessionsInChannel:
            launched.activeResearcherSessionsInChannel,
        };
      }
      params.launchedDueKeys.set(params.projectRoot, dueKey);
      return {
        launched: true,
        reason: "started",
        projectId: params.projectId,
        projectRoot: params.projectRoot,
        topic,
        sessionKey: launched.sessionKey,
        runId: launched.runId,
        dueKey,
        summary: launched.summary,
        reusedIdleSession: launched.reusedIdleSession,
        activeResearcherSessionsInChannel:
          launched.activeResearcherSessionsInChannel,
      };
    },
  });
}

function buildAutoZoteroSyncExtraPrompt(params: {
  projectId: string | null;
  projectRoot: string;
  trigger: string;
  triggerReason: string | null;
  packetPath: string;
  markdownPath: string;
  zoteroProjectPath: string | null;
}) {
  return [
    "Workflow coordinator soft Zotero sync trigger.",
    params.projectId ? `Project ID: ${params.projectId}` : null,
    `Project root: ${params.projectRoot}`,
    `Trigger: ${params.trigger}`,
    params.triggerReason ? `Trigger reason: ${params.triggerReason}` : null,
    `Packet path: ${params.packetPath}`,
    `Markdown path: ${params.markdownPath}`,
    `Effective project collection path: ${params.zoteroProjectPath ?? "<configured-root>/<project-id>"}`,
    "Treat this as a best-effort bibliography reconciliation pass. Keep the foreground workflow responsive, and if Zotero MCP is unavailable, record unavailable or failed state durably instead of blocking the main project flow.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function maybeLaunchAutoZoteroSyncForProject(params: {
  workflowRuntime?: WorkflowRuntimeApi;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  projectRoot: string;
  projectId: string | null;
  logger?: WorkflowCoordinatorLogger;
  deps?: Partial<WorkflowCoordinatorDependencies>;
}) {
  const deps = resolveWorkflowCoordinatorDependencies(params.deps);

  return enqueueWorkflowTask({
    key: resolveWorkflowCoordinationKey({
      projectRoot: params.projectRoot,
      workflowPolicy: params.workflowPolicy,
      deps,
    }),
    label: "workflow_auto_zotero_sync",
    logger: params.logger,
    task: async (): Promise<AutoZoteroSyncAttempt> => {
      const candidate = await deriveAutoZoteroSyncCandidate({
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        zoteroProjectRoot: params.workflowPolicy.zoteroProjectRoot,
      });
      if (!candidate.shouldLaunch || !candidate.trigger || !candidate.dedupeKey) {
        return {
          launched: false,
          queued: false,
          reason: "no_candidate",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          trigger: candidate.trigger,
          triggerReason: candidate.triggerReason,
          sessionKey: null,
          runId: null,
          summary: null,
          queueKey: null,
          zoteroProjectPath: candidate.zoteroProjectPath,
          packetPath: candidate.packetPath,
          markdownPath: candidate.markdownPath,
        };
      }

      const pending = await hasPendingBackgroundWorkflowQueueKey({
        queueKey: candidate.dedupeKey,
        projectId: params.projectId,
        projectRoot: params.projectRoot,
        projectsRoot: params.workflowPolicy.projectsRoot,
        workflowRuntime: params.workflowRuntime,
      });
      if (pending.active) {
        return {
          launched: false,
          queued: false,
          reason: "already_launched",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          trigger: candidate.trigger,
          triggerReason: candidate.triggerReason,
          sessionKey: null,
          runId: null,
          summary: null,
          queueKey: candidate.dedupeKey,
          zoteroProjectPath: candidate.zoteroProjectPath,
          packetPath: candidate.packetPath,
          markdownPath: candidate.markdownPath,
        };
      }
      if (pending.queued) {
        return {
          launched: false,
          queued: true,
          reason: "already_queued",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          trigger: candidate.trigger,
          triggerReason: candidate.triggerReason,
          sessionKey: null,
          runId: null,
          summary: null,
          queueKey: candidate.dedupeKey,
          zoteroProjectPath: candidate.zoteroProjectPath,
          packetPath: candidate.packetPath,
          markdownPath: candidate.markdownPath,
        };
      }

      const requesterBinding = resolveWorkflowRequesterBinding({
        projectRoot: params.projectRoot,
        workflowPolicy: params.workflowPolicy,
        deps,
      });
      const requesterSessionKey =
        requesterBinding.sessionKey ?? "agent:researcher:main";
      const sessionKey = buildResearcherWorkflowSubagentSessionKey({
        requesterSessionKey,
        projectRoot: params.projectRoot,
        purpose: "workflow-zotero-sync",
        segments: [
          candidate.trigger,
          candidate.collectionFingerprint,
          candidate.activeExperimentFingerprint,
          candidate.graphLastBuiltAt,
        ],
      });
      const launched = await startBackgroundWorkflowRun({
        workflowRuntime: params.workflowRuntime,
        workflowPolicy: params.workflowPolicy,
        agentCtx: {
          agentId: "researcher",
          workspaceDir: params.projectRoot,
          sessionKey,
          messageChannel: requesterBinding.messageChannel ?? "discord",
        },
        snapshot: {
          role: "researcher",
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          channelProjectBindingsEnabled:
            params.workflowPolicy.enableChannelProjectBindings === true,
        },
        backgroundRun: {
          kind: "zotero_sync",
          projectId: params.projectId ?? undefined,
          projectRoot: params.projectRoot,
          ensureProjectBinding: false,
          summary:
            `Background Zotero sync started for ` +
            `${params.projectId ?? path.basename(params.projectRoot)} (${candidate.trigger}).`,
          dedupeKey: candidate.dedupeKey,
          triggerKind: candidate.trigger,
          triggerReason: candidate.triggerReason ?? undefined,
          extraSystemPrompt: buildAutoZoteroSyncExtraPrompt({
            projectId: params.projectId,
            projectRoot: params.projectRoot,
            trigger: candidate.trigger,
            triggerReason: candidate.triggerReason,
            packetPath: candidate.packetPath,
            markdownPath: candidate.markdownPath,
            zoteroProjectPath: candidate.zoteroProjectPath,
          }),
        },
      });

      return {
        launched: launched.started,
        queued: launched.queued,
        reason: launched.started ? "started" : launched.queued ? "queued" : "queued",
        projectId: params.projectId,
        projectRoot: params.projectRoot,
        trigger: candidate.trigger,
        triggerReason: candidate.triggerReason,
        sessionKey: launched.sessionKey,
        runId: launched.runId,
        summary: launched.summary,
        queueKey: launched.queueKey ?? candidate.dedupeKey,
        zoteroProjectPath: candidate.zoteroProjectPath,
        packetPath: candidate.packetPath,
        markdownPath: candidate.markdownPath,
      };
    },
  });
}

export async function maybeLaunchPaperIngestionWorkerForProject(params: {
  workflowRuntime?: WorkflowRuntimeApi;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  projectRoot: string;
  projectId: string | null;
  triggerKind?: string;
  logger?: WorkflowCoordinatorLogger;
  deps?: Partial<WorkflowCoordinatorDependencies>;
}) {
  const deps = resolveWorkflowCoordinatorDependencies(params.deps);

  return enqueueWorkflowTask({
    key: resolveWorkflowCoordinationKey({
      projectRoot: params.projectRoot,
      workflowPolicy: params.workflowPolicy,
      deps,
    }),
    label: "workflow_papernexus_upload_worker",
    logger: params.logger,
    task: async (): Promise<PaperIngestionWorkerAttempt> => {
      const requesterBinding = resolveWorkflowRequesterBinding({
        projectRoot: params.projectRoot,
        workflowPolicy: params.workflowPolicy,
        deps,
      });
      const requesterSessionKey =
        requesterBinding.sessionKey ?? "agent:researcher:main";
      const sessionKey = buildResearcherWorkflowSubagentSessionKey({
        requesterSessionKey,
        projectRoot: params.projectRoot,
        purpose: "workflow-papernexus-upload-worker",
        segments: [params.triggerKind ?? "heartbeat"],
      });
      const result = await maybeTriggerQueuedPaperIngestionRequest({
        workflowRuntime: params.workflowRuntime,
        workflowPolicy: params.workflowPolicy,
        agentCtx: {
          agentId: "researcher",
          workspaceDir: params.projectRoot,
          sessionKey,
          messageChannel: requesterBinding.messageChannel ?? "worker",
          channelKey: requesterBinding.channelKey ?? undefined,
        },
        snapshot: {
          role: "researcher",
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          channelProjectBindingsEnabled:
            params.workflowPolicy.enableChannelProjectBindings === true,
        },
        triggerKind: params.triggerKind ?? "worker_heartbeat",
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        ensureProjectBinding: false,
      });
      if (!result) {
        return {
          launched: false,
          queued: false,
          reason: "no_request",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          sessionKey: null,
          runId: null,
          summary: null,
          queueKey: null,
        };
      }
      const reason: PaperIngestionWorkerAttempt["reason"] = result.started
        ? "started"
        : result.queued
          ? "queued"
          : result.reason === "session_unavailable"
            ? "already_active"
            : "blocked";
      return {
        launched: result.started,
        queued: result.queued,
        reason,
        projectId: params.projectId,
        projectRoot: params.projectRoot,
        sessionKey: result.sessionKey,
        runId: result.runId,
        summary: result.summary,
        queueKey: result.queueKey,
      };
    },
  });
}

function buildAutoStageLaunchKey(params: {
  projectRoot: string;
  stage: string | null;
  owner: string | null;
  command: string | null;
}) {
  return [
    path.resolve(params.projectRoot),
    params.stage ?? "unknown-stage",
    params.owner ?? "unknown-owner",
    params.command ?? "no-command",
  ].join("::");
}

function isExperimentMonitorCommand(command: string | null | undefined): boolean {
  return /\/monitor-experiment\b/i.test(command ?? "");
}

function buildAutoStageDispatchExtraBody(params: {
  stage: string | null;
  owner: string | null;
  command: string | null;
}): string {
  if (params.stage === "experiment" && isExperimentMonitorCommand(params.command)) {
    return "Workflow auto-mode experiment reconciliation dispatch. Treat this as reconciliation-first work: read watcher artifacts before shell polling, persist missing watcher signals with research_workflow.record_experiment_runtime_signal, and do not relaunch or widen the search envelope until the ledger and experiment_search are coherent.";
  }
  if (
    params.stage === "experiment" &&
    params.owner === "coder" &&
    /repair|baseline|implementation|runtime/i.test(params.command ?? "")
  ) {
    return "Workflow auto-mode experiment repair dispatch. Stay inside bounded runtime / implementation repair, keep baseline fairness intact, avoid inventing new experiments, and hand back once the repair evidence is durable.";
  }
  if (
    params.stage === "experiment" &&
    params.owner === "researcher" &&
    /(multi-seed|ablation|search neighborhood|bounded search|rollback)/i.test(
      params.command ?? ""
    )
  ) {
    return "Workflow auto-mode experiment decision dispatch. Execute only the requested multi-seed / ablation / bounded-search / rollback follow-up, keep the incumbent-vs-candidate history clean, and do not mix scientific judgment with unrelated runtime babysitting.";
  }
  return "Workflow auto-mode service dispatch. Continue only the assigned stage, keep durable state current, and do not skip stage completion checks.";
}

async function launchWorkflowDispatchTransition(params: {
  workflowRuntime: WorkflowRuntimeApi;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  source: string;
  queueKey: string;
  owner: DispatchableWorkflowRole;
  projectRoot: string;
  projectId: string | null;
  requesterSessionKey: string;
  requesterChannel?: string | null;
  requesterChannelKey?: string | null;
  preferredSessionKeys: string[];
  family: string;
  kind: string;
  stage: string | null;
  summary: string;
  command?: string | null;
  mailboxMessageId?: string | null;
  requireMailboxAcknowledgement?: boolean;
  extraBody?: string | null;
  autoModeActive: boolean;
  fromRole?: string | null;
  logger?: WorkflowCoordinatorLogger;
}) {
  const mailboxMessageId =
    params.requireMailboxAcknowledgement !== false || params.mailboxMessageId
      ? await ensureWorkflowDispatchMailboxMessage({
          projectRoot: params.projectRoot,
          fromAgent: params.fromRole ?? "researcher",
          toAgent: params.owner,
          projectId: params.projectId,
          stage: params.stage,
          summary: params.summary,
          command: params.command ?? null,
          extraBody: params.extraBody ?? null,
          queueKey: params.queueKey,
          existingMessageId: params.mailboxMessageId ?? null,
        })
      : null;
  return orchestrateWorkflowTransition({
    transition: {
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      queueKey: params.queueKey,
      source: params.source,
      entryType: "dispatch_task",
      ownerAgent: params.owner,
      channelKey:
        readString(params.requesterChannelKey) ??
        params.requesterChannel ??
        params.requesterSessionKey,
      requesterSessionKey: params.requesterSessionKey,
      messageChannel: params.requesterChannel ?? null,
      preferredSessionKey: params.preferredSessionKeys[0] ?? null,
      family: params.family,
      kind: params.kind,
      summary: params.summary,
      parentSessionKey: params.requesterSessionKey,
      depth: 1,
      dispatchPayload: {
          requesterChannel: params.requesterChannel ?? null,
        requesterAccountId: null,
        preferredSessionKeys: params.preferredSessionKeys,
        fromRole: params.fromRole ?? "researcher",
        toRole: params.owner,
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        stage: params.stage,
        summary: params.summary,
        command: params.command ?? null,
        mailboxMessageId,
        requireMailboxAcknowledgement:
          params.requireMailboxAcknowledgement !== false,
        extraBody: params.extraBody ?? null,
        waitTimeoutMs: 5000,
        retryOnTimeout: true,
        enableSpawnFallback: true,
        useWorkflowHandoff: true,
        autoModeActive: params.autoModeActive,
      },
    },
    spawn: async () => {
      const dispatch = await handoffWorkflowTaskToAgent({
        workflowRuntime: params.workflowRuntime,
        workflowPolicy: params.workflowPolicy,
        requesterSessionKey: params.requesterSessionKey,
        requesterChannel: params.requesterChannel ?? undefined,
        preferredSessionKeys: params.preferredSessionKeys,
        fromRole: params.fromRole ?? "researcher",
        toRole: params.owner,
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        stage: params.stage,
        summary: params.summary,
        command: params.command ?? null,
        mailboxMessageId,
        requireMailboxAcknowledgement:
          params.requireMailboxAcknowledgement !== false,
        extraBody: params.extraBody ?? null,
        waitTimeoutMs: 5000,
        retryOnTimeout: true,
        enableSpawnFallback: true,
        autoModeActive: params.autoModeActive,
        logger: params.logger,
      });
      const dispatchRunId = resolveWorkflowDispatchLaunchRunId(dispatch);
      if (!dispatch.dispatched || !dispatchRunId || !dispatch.sessionKey) {
        throw new Error(
          dispatch.error ??
            `Failed to dispatch workflow transition ${params.queueKey}.`
        );
      }
      return {
        runId: dispatchRunId,
        sessionKey: dispatch.sessionKey,
        runtime:
          dispatch.channel === "sessions_spawn" || dispatch.channel === "sessions_send"
            ? params.workflowRuntime.runtimeKind ?? "subagent"
            : "legacy_dispatch",
        role: params.owner,
        agentId: params.owner,
        ownerAgent: params.owner,
        strategy: dispatch.strategy ?? "workflow_dispatch",
        parentSessionKey: params.requesterSessionKey,
        depth: 1,
      };
    },
  });
}

async function launchWorkflowNestedRunTransition(params: {
  workflowRuntime: WorkflowRuntimeApi;
  source: string;
  queueKey: string;
  ownerAgent: string;
  sessionKey: string;
  requesterSessionKey: string;
  projectRoot: string;
  projectId: string | null;
  family: string;
  kind: string;
  summary: string;
  message: string;
  idempotencyKey: string;
  extraSystemPrompt: string;
  depth?: number;
}) {
  return orchestrateWorkflowTransition({
    transition: {
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      queueKey: params.queueKey,
      source: params.source,
      entryType: "background_run",
      ownerAgent: params.ownerAgent,
      channelKey: params.requesterSessionKey,
      requesterSessionKey: params.requesterSessionKey,
      preferredSessionKey: params.sessionKey,
      family: params.family,
      kind: params.kind,
      summary: params.summary,
      parentSessionKey: params.requesterSessionKey,
      depth: params.depth ?? 1,
      runPayload: {
        message: params.message,
        lane: "nested",
        deliver: false,
        idempotencyKey: params.idempotencyKey,
        extraSystemPrompt: params.extraSystemPrompt,
      },
    },
    spawn: async () => {
      const started = await params.workflowRuntime.run({
        sessionKey: params.sessionKey,
        message: params.message,
        lane: "nested",
        deliver: false,
        idempotencyKey: params.idempotencyKey,
        extraSystemPrompt: params.extraSystemPrompt,
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        ownerAgent: params.ownerAgent,
        requesterSessionKey: params.requesterSessionKey,
        workspaceDir: params.projectRoot,
      });
      return {
        runId: started.runId,
        sessionKey: params.sessionKey,
        sessionId: started.sessionId ?? null,
        runtime:
          started.runtime ??
          params.workflowRuntime.runtimeKind ??
          "subagent",
        role: params.ownerAgent,
        agentId: params.ownerAgent,
        ownerAgent: params.ownerAgent,
        parentSessionKey: params.requesterSessionKey,
        depth: params.depth ?? 1,
      };
    },
  });
}

export async function maybeLaunchAutoStageForProject(params: {
  workflowRuntime?: WorkflowRuntimeApi;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  projectRoot: string;
  projectId: string | null;
  autoIteratorResult: {
    configuredAutoMode?: string | null;
    effectiveAutoMode?: string | null;
    autoModeRiskLevel?: string | null;
    autoModeMitigationStatus?: string | null;
    gateBlocking?: boolean;
    stageAfter?: string | null;
    missingStageSignals?: string[];
    pendingHandoff?: boolean;
    pendingHandoffPhase?: string | null;
      recommendedActions: Array<{
        kind: string;
        owner: string | null;
        stage: string | null;
        summary: string;
        command: string | null;
        mailboxMessageId?: string | null;
        cooldownRemainingSeconds?: number | null;
        blocking?: boolean;
        dispatchDespiteMissingSignals?: boolean;
      }>;
  };
  launchedStageKeys: Map<string, { key: string; launchedAt: number }>;
  logger?: WorkflowCoordinatorLogger;
  deps?: Partial<WorkflowCoordinatorDependencies>;
}) {
  const deps = resolveWorkflowCoordinatorDependencies(params.deps);

  return enqueueWorkflowTask({
    key: resolveWorkflowCoordinationKey({
      projectRoot: params.projectRoot,
      workflowPolicy: params.workflowPolicy,
      deps,
    }),
    label: "workflow_auto_stage_launch",
    logger: params.logger,
    task: async (): Promise<AutoStageLaunchAttempt> => {
      const finalizeAttempt = async (
        attempt: AutoStageLaunchAttempt
      ): Promise<AutoStageLaunchAttempt> => {
        await appendWorkflowDiagnosticEvent({
          projectRoot: params.projectRoot,
          projectId: params.projectId ?? null,
          component: "service",
          action: "auto_stage_launch",
          status: attempt.launched
            ? "completed"
            : attempt.reason === "dispatch_failed"
              ? "blocked"
              : [
                    "auto_mode_disabled",
                    "risk_discussion_pending",
                    "gate_blocked",
                    "binding_missing",
                    "cooldown_active",
                    "already_launched",
                    "session_pool_full",
                    "no_drive_stage_action",
                  ].includes(attempt.reason)
                ? "waiting"
                : "failed",
          stage: attempt.stage ?? null,
          owner: attempt.owner ?? null,
          summary: attempt.launched
            ? `Service launched ${attempt.owner ?? "workflow"} for ${attempt.stage ?? "current stage"}.`
            : `Service did not launch auto-stage work (${attempt.reason}).`,
          details: {
            reason: attempt.reason,
            launchKey: attempt.launchKey,
            sessionKey: attempt.sessionKey,
            runId: attempt.runId,
            dispatchStrategy: attempt.dispatchStrategy,
            reusedServiceSession: attempt.reusedServiceSession,
            activeResearcherSessionsInChannel:
              attempt.activeResearcherSessionsInChannel,
            error: attempt.error,
            configuredAutoMode:
              params.autoIteratorResult.configuredAutoMode ??
              params.workflowPolicy.autoMode ??
              null,
            effectiveAutoMode:
              params.autoIteratorResult.effectiveAutoMode ??
              params.workflowPolicy.autoMode ??
              null,
            gateBlocking: params.autoIteratorResult.gateBlocking ?? false,
          },
        });
        return attempt;
      };
      if ((params.autoIteratorResult.effectiveAutoMode ?? params.workflowPolicy.autoMode) === "off") {
        params.launchedStageKeys.delete(params.projectRoot);
        return finalizeAttempt({
          launched: false,
          reason: "auto_mode_disabled",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          stage: params.autoIteratorResult.stageAfter ?? null,
          owner: null,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          launchKey: null,
          error: null,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        });
      }
      if (
        readString(params.autoIteratorResult.autoModeRiskLevel) &&
        readString(params.autoIteratorResult.autoModeRiskLevel) !== "stable" &&
        params.autoIteratorResult.autoModeMitigationStatus !== "resolved" &&
        (params.autoIteratorResult.effectiveAutoMode ?? params.workflowPolicy.autoMode) ===
          (params.autoIteratorResult.configuredAutoMode ?? params.workflowPolicy.autoMode)
      ) {
        return finalizeAttempt({
          launched: false,
          reason: "risk_discussion_pending",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          stage: params.autoIteratorResult.stageAfter ?? null,
          owner: null,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          launchKey: null,
          error: null,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        });
      }
      if (!params.workflowRuntime) {
        return finalizeAttempt({
          launched: false,
          reason: "no_runtime_subagent",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          stage: params.autoIteratorResult.stageAfter ?? null,
          owner: null,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          launchKey: null,
          error: null,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        });
      }
      const requesterBinding = resolveWorkflowRequesterBinding({
        projectRoot: params.projectRoot,
        workflowPolicy: params.workflowPolicy,
        deps,
      });
      if (
        params.workflowPolicy.enableChannelProjectBindings === true &&
        !hasWorkflowProjectBinding({
          projectRoot: params.projectRoot,
          workflowPolicy: params.workflowPolicy,
          deps,
        })
      ) {
        params.launchedStageKeys.delete(params.projectRoot);
        return finalizeAttempt({
          launched: false,
          reason: "binding_missing",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          stage: params.autoIteratorResult.stageAfter ?? null,
          owner: null,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          launchKey: null,
          error:
            "Channel-project bindings are enabled, but this project has no active workflow binding.",
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        });
      }
      if (params.autoIteratorResult.gateBlocking) {
        return finalizeAttempt({
          launched: false,
          reason: "gate_blocked",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          stage: params.autoIteratorResult.stageAfter ?? null,
          owner: null,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          launchKey: null,
          error: null,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        });
      }

      const dispatchableAutoIteratorResult: Parameters<
        typeof selectDispatchableAutoStageAction
      >[0]["autoIteratorResult"] = {
        gateBlocking: params.autoIteratorResult.gateBlocking ?? false,
        missingStageSignals: params.autoIteratorResult.missingStageSignals ?? [],
        pendingHandoff: params.autoIteratorResult.pendingHandoff === true,
        pendingHandoffPhase: params.autoIteratorResult.pendingHandoffPhase ?? null,
        recommendedActions: (params.autoIteratorResult.recommendedActions ?? []).map(
          (entry) => ({
            kind: entry.kind as "drive_stage" | "background" | "wait_human" | "switch_project",
            owner: entry.owner as DispatchableWorkflowRole | null,
            stage: entry.stage ?? null,
            summary: entry.summary,
            command: entry.command ?? null,
            mailboxQueued: false,
            mailboxMessageId: entry.mailboxMessageId ?? null,
            cooldownRemainingSeconds: entry.cooldownRemainingSeconds ?? null,
            blocking: entry.blocking === true,
            dispatchDespiteMissingSignals:
              entry.dispatchDespiteMissingSignals === true,
          })
        ),
      };
      const action = selectDispatchableAutoStageAction({
        autoIteratorResult: dispatchableAutoIteratorResult,
      });
      if (!action) {
        params.launchedStageKeys.delete(params.projectRoot);
        return finalizeAttempt({
          launched: false,
          reason: "no_drive_stage_action",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          stage: params.autoIteratorResult.stageAfter ?? null,
          owner: null,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          launchKey: null,
          error: null,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        });
      }
      if ((action.cooldownRemainingSeconds ?? 0) > 0) {
        return finalizeAttempt({
          launched: false,
          reason: "cooldown_active",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
          owner: action.owner,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          launchKey: null,
          error: null,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        });
      }

      const launchKey = buildAutoStageLaunchKey({
        projectRoot: params.projectRoot,
        stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
        owner: action.owner,
        command: action.command,
      });
      const lastLaunch = params.launchedStageKeys.get(params.projectRoot);
      const cooldownMs = Math.max(
        1,
        isExperimentMonitorCommand(action.command)
          ? Math.floor(
              (params.workflowPolicy.autoGate?.experimentMonitorCooldownMs ?? 5 * 60 * 1000) /
                1000
            )
          : params.workflowPolicy.agentContactCooldownSeconds
      ) * 1000;
      if (
        lastLaunch?.key === launchKey &&
        Date.now() - lastLaunch.launchedAt < cooldownMs
      ) {
        return finalizeAttempt({
          launched: false,
          reason: "already_launched",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
          owner: action.owner,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          launchKey,
          error: null,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        });
      }
      const pendingQueueState = await hasPendingBackgroundWorkflowQueueKey({
        queueKey: launchKey,
        projectId: params.projectId ?? null,
        projectRoot: params.projectRoot,
        workflowRuntime: params.workflowRuntime,
      });
      if (pendingQueueState.active || pendingQueueState.queued) {
        return finalizeAttempt({
          launched: false,
          reason: pendingQueueState.active ? "already_launched" : "session_pool_full",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
          owner: action.owner,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          launchKey,
          error: pendingQueueState.queued
            ? "Researcher stage handoff is already queued for the shared service session pool."
            : null,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        });
      }

      const requesterSessionKey = requesterBinding.sessionKey;
      const defaultResearcherRequesterSessionKey =
        requesterSessionKey ?? "agent:researcher:main";
      const preferredResearcherSessionKeys = buildWorkflowCoordinatorDispatchSessionKeys({
        requesterSessionKey: requesterSessionKey ?? undefined,
        owner: action.owner as Parameters<typeof deriveAgentSessionKeyForRole>[0]["targetRole"],
        projectRoot: params.projectRoot,
        purpose: "workflow-stage",
        segments: [
          action.stage ?? params.autoIteratorResult.stageAfter ?? null,
          action.command,
        ],
      });
      let pooledSessionLease:
        | Awaited<ReturnType<typeof acquireBackgroundWorkflowSession>>
        | null = null;
      if (shouldUsePooledServiceSession(action.owner)) {
        pooledSessionLease = await acquireBackgroundWorkflowSession({
          workflowRuntime: params.workflowRuntime,
          ownerAgent: action.owner,
          requesterSessionKey: defaultResearcherRequesterSessionKey,
          channelKey: requesterBinding.channelKey ?? undefined,
          preferredSessionKey: preferredResearcherSessionKeys?.[0] ?? null,
          family: "research",
          kind: "workflow_stage_dispatch",
          projectId: params.projectId ?? undefined,
          projectRoot: params.projectRoot,
          projectsRoot: params.workflowPolicy.projectsRoot,
        });
        if (!pooledSessionLease.acquired || !pooledSessionLease.sessionKey) {
          await enqueueQueuedBackgroundWorkflowRun({
            source: "workflow_auto_stage",
            ownerAgent: action.owner,
            requesterSessionKey: defaultResearcherRequesterSessionKey,
            channelKey: requesterBinding.channelKey ?? undefined,
            preferredSessionKey: preferredResearcherSessionKeys?.[0] ?? null,
            family: "research",
            kind: "workflow_stage_dispatch",
            projectId: params.projectId ?? undefined,
            projectRoot: params.projectRoot,
            projectsRoot: params.workflowPolicy.projectsRoot,
            queueKey: launchKey,
            summary:
              `Queued the ${action.stage ?? params.autoIteratorResult.stageAfter ?? "current"} stage handoff until an idle ${action.owner} service session becomes available.`,
            dispatchPayload: {
              requesterChannel: requesterBinding.messageChannel,
              requesterAccountId: null,
              preferredSessionKeys: preferredResearcherSessionKeys ?? [],
              fromRole: "researcher",
              toRole: action.owner as Parameters<typeof deriveAgentSessionKeyForRole>[0]["targetRole"],
              projectRoot: params.projectRoot,
              projectId: params.projectId,
              stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
              summary: action.summary,
              command: action.command,
              mailboxMessageId: action.mailboxMessageId ?? null,
              requireMailboxAcknowledgement:
                params.workflowPolicy.enableWorkflowMailbox !== false,
              extraBody:
                buildAutoStageDispatchExtraBody({
                  stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
                  owner: action.owner,
                  command: action.command,
                }),
              waitTimeoutMs: 5000,
              retryOnTimeout: true,
              enableSpawnFallback: true,
              useWorkflowHandoff: true,
              autoModeActive:
                (params.autoIteratorResult.effectiveAutoMode ??
                  params.workflowPolicy.autoMode) !== "off",
            },
          });
          return finalizeAttempt({
            launched: false,
            reason: "session_pool_full",
            projectId: params.projectId,
            projectRoot: params.projectRoot,
            stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
            owner: action.owner,
            sessionKey: null,
            runId: null,
            dispatchStrategy: null,
            launchKey,
            error: `${action.owner} service session pool is at capacity for this channel (${pooledSessionLease.activeOwnerSessionsInChannel ?? pooledSessionLease.activeResearcherSessionsInChannel ?? 0} active).`,
            reusedServiceSession: false,
            activeResearcherSessionsInChannel:
              pooledSessionLease.activeResearcherSessionsInChannel,
          });
        }
      }
      const dispatchLaunch = await launchWorkflowDispatchTransition({
        workflowRuntime: params.workflowRuntime,
        workflowPolicy: params.workflowPolicy,
        source: "workflow_auto_stage",
        queueKey: launchKey,
        owner: action.owner as Parameters<typeof deriveAgentSessionKeyForRole>[0]["targetRole"],
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        requesterSessionKey: requesterSessionKey ?? defaultResearcherRequesterSessionKey,
        requesterChannel: requesterBinding.messageChannel ?? undefined,
        requesterChannelKey: requesterBinding.channelKey ?? undefined,
        preferredSessionKeys:
          shouldUsePooledServiceSession(action.owner)
            ? [
                pooledSessionLease?.sessionKey ??
                  preferredResearcherSessionKeys?.[0] ??
                  defaultResearcherRequesterSessionKey,
              ]
            : preferredResearcherSessionKeys ?? [],
        family: "research",
        kind: "workflow_stage_dispatch",
        fromRole: "researcher",
        stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
        summary: action.summary,
        command: action.command,
        mailboxMessageId: action.mailboxMessageId ?? null,
        requireMailboxAcknowledgement:
          params.workflowPolicy.enableWorkflowMailbox !== false,
        extraBody:
          buildAutoStageDispatchExtraBody({
            stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
            owner: action.owner,
            command: action.command,
          }),
        autoModeActive:
          (params.autoIteratorResult.effectiveAutoMode ??
            params.workflowPolicy.autoMode) !== "off",
        logger: params.logger,
      });
      if (!dispatchLaunch.launched) {
        return finalizeAttempt({
          launched: false,
          reason: "dispatch_failed",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
          owner: action.owner,
          sessionKey: dispatchLaunch.sessionKey,
          runId: dispatchLaunch.runId,
          dispatchStrategy: dispatchLaunch.strategy,
          launchKey,
          error: dispatchLaunch.error,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel:
            pooledSessionLease?.activeResearcherSessionsInChannel ?? null,
        });
      }

      if (
        shouldUsePooledServiceSession(action.owner) &&
        pooledSessionLease?.channelKey &&
        dispatchLaunch.runId &&
        dispatchLaunch.sessionKey
      ) {
        await recordBackgroundWorkflowRun({
          ownerAgent: action.owner,
          channelKey: pooledSessionLease.channelKey,
          requesterSessionKey: defaultResearcherRequesterSessionKey,
          backgroundSessionKey: dispatchLaunch.sessionKey,
          runId: dispatchLaunch.runId,
          queueKey: launchKey,
          kind: "workflow_stage_dispatch",
          family: "research",
          projectId: params.projectId ?? undefined,
          projectRoot: params.projectRoot,
          projectsRoot: params.workflowPolicy.projectsRoot,
        });
      }

      params.launchedStageKeys.set(params.projectRoot, {
        key: launchKey,
        launchedAt: Date.now(),
      });
      if (params.workflowPolicy.teamRuntime?.enabled !== false && dispatchLaunch.sessionKey) try {
        const claimedTask = await claimNextWorkflowTaskForOwner({
          projectRoot: params.projectRoot,
          owner: String(action.owner),
          sessionKey: dispatchLaunch.sessionKey,
        });
        if (claimedTask.claimed && claimedTask.task) {
          let teamRound = await recordWorkflowTeamRoundClaim({
            projectRoot: params.projectRoot,
            sessionKey: dispatchLaunch.sessionKey,
            taskId: claimedTask.task.taskId,
          });
          if (!teamRound) {
            const taskGraphStore = await readWorkflowTaskGraphStore(params.projectRoot);
            const taskGraphSummary = summarizeWorkflowTaskGraphStore(taskGraphStore);
            if (taskGraphStore) {
              await materializeWorkflowTeamRound({
                projectRoot: params.projectRoot,
                projectId: params.projectId ?? null,
                stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
                leadRole: String(action.owner),
                topTierVerdict: taskGraphStore.topTierVerdict,
                evidenceCloseoutStatus: taskGraphStore.evidenceCloseoutStatus,
                taskGraphPath: getWorkflowTaskGraphPath(params.projectRoot),
                taskCount: taskGraphSummary.taskCount,
                claimableCount: taskGraphSummary.claimableCount,
                blockedCount: taskGraphSummary.blockedCount,
                claimedCount: taskGraphSummary.claimedCount,
                verifyingCount: taskGraphSummary.verifyingCount,
                needsRepairCount: taskGraphSummary.needsRepairCount,
                satisfiedCount: taskGraphSummary.satisfiedCount,
                optionalCount: taskGraphSummary.optionalCount,
              });
              teamRound = await recordWorkflowTeamRoundClaim({
                projectRoot: params.projectRoot,
                sessionKey: dispatchLaunch.sessionKey,
                taskId: claimedTask.task.taskId,
              });
            }
          }
          await appendWorkflowRuntimeEvent({
            projectRoot: params.projectRoot,
            projectId: params.projectId ?? null,
            kind: "team_task_claimed",
            summary: `Auto-stage dispatch claimed ${claimedTask.task.taskId} for ${action.owner}.`,
            details: {
              taskId: claimedTask.task.taskId,
              owner: action.owner,
              sessionKey: dispatchLaunch.sessionKey,
              stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
              launchKey,
            },
          });
        }
      } catch (error) {
        params.logger?.warn?.("Failed to claim workflow task after auto-stage dispatch.", {
          projectRoot: params.projectRoot,
          owner: action.owner,
          stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await recordWorkflowContactEvent({
        projectRoot: params.projectRoot,
        fromAgent: "researcher",
        toAgent: action.owner as Parameters<typeof deriveAgentSessionKeyForRole>[0]["targetRole"],
        channel: "sessions_spawn",
      });
      return finalizeAttempt({
        launched: true,
        reason: "started",
        projectId: params.projectId,
        projectRoot: params.projectRoot,
        stage: action.stage ?? params.autoIteratorResult.stageAfter ?? null,
        owner: action.owner,
        sessionKey: dispatchLaunch.sessionKey,
        runId: dispatchLaunch.runId,
        dispatchStrategy: dispatchLaunch.strategy,
        launchKey,
        error: null,
        reusedServiceSession: pooledSessionLease?.reusedIdleSession ?? false,
        activeResearcherSessionsInChannel:
          pooledSessionLease?.activeResearcherSessionsInChannel ?? null,
      });
    },
  });
}

async function pollGateReviewAttempts(params: {
  workflowRuntime: WorkflowRuntimeApi;
  attempts: GateReviewAttempt[];
  projectRoot: string;
  projectId: string | null;
}) {
  const announceStore = await readWorkflowAnnounceOutboxStore(params.projectRoot);
  const nextAttempts: GateReviewAttempt[] = [];

  for (const attempt of params.attempts) {
    if (attempt.status !== "pending") {
      nextAttempts.push(attempt);
      continue;
    }

    const announcedResult = readGateReviewAnnounceResult({
      entries: announceStore.entries,
      attempt,
    });
    if (announcedResult) {
      nextAttempts.push({
        ...attempt,
        status: "completed",
        completedAt: attempt.completedAt ?? nowIso(),
        error: null,
        result: {
          ...announcedResult,
          runId: announcedResult.runId ?? attempt.runId,
        },
      });
      continue;
    }

    if (!attempt.runId || !params.workflowRuntime.waitForRun) {
      nextAttempts.push(attempt);
      continue;
    }

    const waited = await params.workflowRuntime.waitForRun({
      runId: attempt.runId,
      timeoutMs: 1,
    });
    if (waited.status === "timeout") {
      nextAttempts.push(attempt);
      continue;
    }
    if (waited.status === "error") {
      const failedAttempt = {
        ...attempt,
        status: "error" as const,
        completedAt: nowIso(),
        error: waited.error ?? "gate review run failed",
        result: parseGateReviewResult(
          JSON.stringify({
            verdict: "block",
            overallScore: 0,
            criticalBlockers: [waited.error ?? "gate review run failed"],
            summary: "Gate review run failed before returning a valid response.",
          }),
          attempt.reviewerRole
        ),
      };
      await recordWorkflowAnnounceEvent({
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        announceId: `gate-review:${attempt.runId}:${attempt.reviewerRole}`,
        parentSessionKey: null,
        childSessionKey: attempt.sessionKey,
        deliveryMode: "internal",
        summary: `Gate reviewer ${attempt.reviewerRole} failed ${attempt.runId}.`,
        payload: {
          reviewerRole: attempt.reviewerRole,
          runId: attempt.runId,
          status: "error",
          error: failedAttempt.error,
          completedAt: failedAttempt.completedAt,
          result: failedAttempt.result,
        },
      });
      nextAttempts.push(failedAttempt);
      continue;
    }

    const messages = params.workflowRuntime.getSessionMessages
      ? await params.workflowRuntime.getSessionMessages({
          sessionKey: attempt.sessionKey,
          limit: 20,
        })
      : { messages: [] };
    const latestText = extractLatestAssistantText(messages.messages);
    const completedAttempt = {
      ...attempt,
      status: "completed" as const,
      completedAt: nowIso(),
      error: null,
      result: {
        ...parseGateReviewResult(
          latestText ??
            JSON.stringify({
              verdict: "block",
              overallScore: 0,
              criticalBlockers: ["Reviewer returned no readable response."],
              summary: "No readable gate review response was found in the session transcript.",
            }),
          attempt.reviewerRole
        ),
        runId: attempt.runId,
      },
    };
    await recordWorkflowAnnounceEvent({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      announceId: `gate-review:${attempt.runId}:${attempt.reviewerRole}`,
      parentSessionKey: null,
      childSessionKey: attempt.sessionKey,
      deliveryMode: "internal",
      summary: `Gate reviewer ${attempt.reviewerRole} completed ${attempt.runId}.`,
      payload: {
        reviewerRole: attempt.reviewerRole,
        runId: attempt.runId,
        status: "completed",
        completedAt: completedAttempt.completedAt,
        result: completedAttempt.result,
      },
    });
    nextAttempts.push(completedAttempt);
  }

  return nextAttempts;
}

async function pollCodeReviewAttempts(params: {
  workflowRuntime: WorkflowRuntimeApi;
  attempts: CodeReviewAttempt[];
  projectRoot: string;
  projectId: string | null;
}) {
  return pollWorkflowPanelDiscussionAttempts({
    workflowRuntime: params.workflowRuntime,
    attempts: params.attempts,
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    announceIdPrefix: "code-review",
    parseResult: (text, reviewerRole) =>
      parseCodeReviewResult(text, reviewerRole as CodeReviewReviewerRole),
    reviveStructuredResult: (value, attempt, parsed) => ({
      ...parsed,
      createdAt: readString(value.createdAt) ?? parsed.createdAt,
      runId: readString(value.runId) ?? attempt.runId,
      rawText: readString(value.rawText) ?? parsed.rawText,
    }),
    buildErrorResult: (reviewerRole, errorMessage) =>
      parseCodeReviewResult(
        JSON.stringify({
          verdict: "block",
          overallScore: 0,
          criticalBlockers: [errorMessage],
          summary: "Code innovation reviewer run failed before returning a valid response.",
        }),
        reviewerRole as CodeReviewReviewerRole
      ),
    buildNoResponseResult: (reviewerRole) =>
      parseCodeReviewResult(
        JSON.stringify({
          verdict: "block",
          overallScore: 0,
          criticalBlockers: ["Reviewer returned no readable response."],
          summary: "No readable code innovation review response was found in the session transcript.",
        }),
        reviewerRole as CodeReviewReviewerRole
      ),
    buildFailureSummary: (attempt) =>
      `Code reviewer ${attempt.reviewerRole} failed ${attempt.runId}.`,
    buildCompletionSummary: (attempt) =>
      `Code reviewer ${attempt.reviewerRole} completed ${attempt.runId}.`,
    buildFailurePayload: (attempt, errorMessage, result) => ({
      reviewerRole: attempt.reviewerRole,
      runId: attempt.runId,
      status: "error",
      error: errorMessage,
      completedAt: attempt.completedAt,
      result,
    }),
    buildCompletionPayload: (attempt, result) => ({
      reviewerRole: attempt.reviewerRole,
      runId: attempt.runId,
      status: "completed",
      completedAt: attempt.completedAt,
      result,
    }),
  });
}

async function pollAutoModeDiscussionAttempts(params: {
  workflowRuntime: WorkflowRuntimeApi;
  attempts: AutoModeDiscussionReviewAttempt[];
  projectRoot: string;
  projectId: string | null;
  projectsRoot?: string | null;
}) {
  return pollWorkflowPanelDiscussionAttempts({
    workflowRuntime: params.workflowRuntime,
    attempts: params.attempts,
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    announceIdPrefix: "auto-discussion",
    parseResult: (text, reviewerRole) =>
      parseAutoModeDiscussionResult(text, reviewerRole as AutoModeDiscussionReviewerRole),
    reviveStructuredResult: (value, attempt, parsed) => ({
      ...parsed,
      createdAt: readString(value.createdAt) ?? parsed.createdAt,
      runId: readString(value.runId) ?? attempt.runId,
      rawText: readString(value.rawText) ?? parsed.rawText,
    }),
    buildErrorResult: (reviewerRole, errorMessage) =>
      parseAutoModeDiscussionResult(
        JSON.stringify({
          riskAssessment: "blocked",
          confidence: 0,
          recommendedOwner: "researcher",
          blockers: [errorMessage],
          summary: "Auto discussion run failed before returning a valid response.",
        }),
        reviewerRole as AutoModeDiscussionReviewerRole
      ),
    buildNoResponseResult: (reviewerRole) =>
      parseAutoModeDiscussionResult(
        JSON.stringify({
          riskAssessment: "blocked",
          confidence: 0,
          recommendedOwner: "researcher",
          blockers: ["Reviewer returned no readable response."],
          summary: "No readable auto discussion response was found in the session transcript.",
        }),
        reviewerRole as AutoModeDiscussionReviewerRole
      ),
    buildFailureSummary: (attempt) =>
      `Auto discussion reviewer ${attempt.reviewerRole} failed ${attempt.runId}.`,
    buildCompletionSummary: (attempt) =>
      `Auto discussion reviewer ${attempt.reviewerRole} completed ${attempt.runId}.`,
    buildFailurePayload: (attempt, errorMessage, result) => ({
      reviewerRole: attempt.reviewerRole,
      runId: attempt.runId,
      status: "error",
      error: errorMessage,
      completedAt: attempt.completedAt,
      result,
    }),
    buildCompletionPayload: (attempt, result) => ({
      reviewerRole: attempt.reviewerRole,
      runId: attempt.runId,
      status: "completed",
      completedAt: attempt.completedAt,
      result,
    }),
    hydratePendingAttempt: async (attempt) => {
      if (!attempt.runId && attempt.queueKey) {
        const activeQueuedRun = await getBackgroundWorkflowRunByQueueKey({
          queueKey: attempt.queueKey,
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          projectsRoot: params.projectsRoot,
          workflowRuntime: params.workflowRuntime,
        });
        if (activeQueuedRun?.runId && activeQueuedRun.backgroundSessionKey) {
          return {
            ...attempt,
            sessionKey: activeQueuedRun.backgroundSessionKey,
            runId: activeQueuedRun.runId,
          };
        }
        const pendingQueueState = await hasPendingBackgroundWorkflowQueueKey({
          queueKey: attempt.queueKey,
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          projectsRoot: params.projectsRoot,
          workflowRuntime: params.workflowRuntime,
        });
        if (pendingQueueState.queued || pendingQueueState.active) {
          return attempt;
        }
        return {
          ...attempt,
          status: "error",
          completedAt: nowIso(),
          error: "Queued auto discussion reviewer run disappeared before launch.",
          result: parseAutoModeDiscussionResult(
            JSON.stringify({
              riskAssessment: "blocked",
              confidence: 0,
              recommendedOwner: "researcher",
              blockers: ["Queued auto discussion reviewer run disappeared before launch."],
              summary: "Queued auto discussion reviewer run disappeared before launch.",
            }),
            attempt.reviewerRole
          ),
        };
      }
      return attempt;
    },
  });
}

export async function maybeAdvanceWorkflowPanelDiscussionForProject(params: {
  workflowRuntime?: WorkflowRuntimeApi;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  projectRoot: string;
  projectId: string | null;
  panelDiscussionPolicy: unknown;
  logger?: WorkflowCoordinatorLogger;
  deps?: Partial<WorkflowCoordinatorDependencies>;
}) {
  const deps = resolveWorkflowCoordinatorDependencies(params.deps);

  return enqueueWorkflowTask({
    key: resolveWorkflowCoordinationKey({
      projectRoot: params.projectRoot,
      workflowPolicy: params.workflowPolicy,
      deps,
    }),
    label: "workflow_panel_discussion",
    logger: params.logger,
    task: async (): Promise<WorkflowPanelDiscussionServiceAttempt> => {
      const policy = normalizeWorkflowPanelDiscussionPolicy(params.panelDiscussionPolicy);
      const materialized = await materializeWorkflowPanelDiscussionState({
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        policyLike: policy,
      });
      const store = await readWorkflowPanelDiscussionStore(
        params.projectRoot,
        policy.discussionId
      );
      const currentRound = store.currentRound;
      const roundsStarted =
        store.roundsStartedByFingerprint[materialized.packetFingerprint] ?? 0;

      if (
        currentRound?.packetFingerprint === materialized.packetFingerprint &&
        currentRound.status === "resolved"
      ) {
        return {
          launched: false,
          reason: "resolved",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          discussionId: policy.discussionId,
          topic: policy.topic,
          stage: currentRound.stage,
          status: currentRound.status,
          reviewCount: currentRound.aggregate?.reviewCount ?? 0,
          roundsStarted,
          recommendedOwner: currentRound.aggregate?.recommendedOwner ?? null,
          actionItems: currentRound.aggregate?.actionItems ?? [],
          blockers: currentRound.aggregate?.blockers ?? [],
          summary: currentRound.aggregate?.summary ?? null,
          roundId: currentRound.roundId,
          packetPath: currentRound.packetPath,
          resolved: true,
        };
      }

      if (
        !materialized.createdRound &&
        currentRound?.packetFingerprint === materialized.packetFingerprint &&
        currentRound.status === "reviewing"
      ) {
        if (!params.workflowRuntime) {
          return {
            launched: false,
            reason: "no_runtime_subagent",
            projectId: params.projectId,
            projectRoot: params.projectRoot,
            discussionId: policy.discussionId,
            topic: policy.topic,
            stage: currentRound.stage,
            status: currentRound.status,
            reviewCount: currentRound.aggregate?.reviewCount ?? 0,
            roundsStarted,
            recommendedOwner: currentRound.aggregate?.recommendedOwner ?? null,
            actionItems: currentRound.aggregate?.actionItems ?? [],
            blockers: currentRound.aggregate?.blockers ?? [],
            summary: currentRound.aggregate?.summary ?? null,
            roundId: currentRound.roundId,
            packetPath: currentRound.packetPath,
            resolved: false,
          };
        }

        const attempts = await pollWorkflowPanelDiscussionAttempts({
          workflowRuntime: params.workflowRuntime,
          attempts: currentRound.attempts,
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          announceIdPrefix: `panel-discussion:${policy.discussionId}`,
          parseResult: (text, reviewerRole) =>
            parseWorkflowPanelDiscussionResult(
              text,
              reviewerRole as WorkflowPanelParticipantRole
            ),
          reviveStructuredResult: (value, attempt, parsed) => ({
            ...parsed,
            createdAt: readString(value.createdAt) ?? parsed.createdAt,
            runId: readString(value.runId) ?? attempt.runId,
            rawText: readString(value.rawText) ?? parsed.rawText,
          }),
          buildErrorResult: (reviewerRole, errorMessage) =>
            parseWorkflowPanelDiscussionResult(
              JSON.stringify({
                decision: policy.blockedDecisions[0] ?? "blocked",
                confidence: 0,
                recommendedOwner: "researcher",
                blockers: [errorMessage],
                summary: "Panel discussion run failed before returning a valid response.",
              }),
              reviewerRole as WorkflowPanelParticipantRole
            ),
          buildNoResponseResult: (reviewerRole) =>
            parseWorkflowPanelDiscussionResult(
              JSON.stringify({
                decision: policy.blockedDecisions[0] ?? "blocked",
                confidence: 0,
                recommendedOwner: "researcher",
                blockers: ["Reviewer returned no readable response."],
                summary: "No readable panel discussion response was found in the session transcript.",
              }),
              reviewerRole as WorkflowPanelParticipantRole
            ),
          buildFailureSummary: (attempt) =>
            `Panel discussion reviewer ${attempt.reviewerRole} failed ${attempt.runId}.`,
          buildCompletionSummary: (attempt) =>
            `Panel discussion reviewer ${attempt.reviewerRole} completed ${attempt.runId}.`,
          buildFailurePayload: (attempt, errorMessage, result) => ({
            reviewerRole: attempt.reviewerRole,
            runId: attempt.runId,
            status: "error",
            error: errorMessage,
            completedAt: attempt.completedAt,
            result,
          }),
          buildCompletionPayload: (attempt, result) => ({
            reviewerRole: attempt.reviewerRole,
            runId: attempt.runId,
            status: "completed",
            completedAt: attempt.completedAt,
            result,
          }),
        });

        const nextRound = {
          ...currentRound,
          attempts,
          updatedAt: nowIso(),
        };
        nextRound.aggregate = aggregateWorkflowPanelDiscussionRound({
          round: nextRound,
          policy,
        });
        nextRound.status = nextRound.aggregate.status;
        const nextStore = {
          ...store,
          updatedAt: nowIso(),
          currentRound: nextRound,
        };
        await saveWorkflowPanelDiscussionStore(
          params.projectRoot,
          policy.discussionId,
          nextStore
        );
        return {
          launched: false,
          reason: nextRound.status === "reviewing" ? "reviewing" : "updated",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          discussionId: policy.discussionId,
          topic: policy.topic,
          stage: nextRound.stage,
          status: nextRound.status,
          reviewCount: nextRound.aggregate?.reviewCount ?? 0,
          roundsStarted,
          recommendedOwner: nextRound.aggregate?.recommendedOwner ?? null,
          actionItems: nextRound.aggregate?.actionItems ?? [],
          blockers: nextRound.aggregate?.blockers ?? [],
          summary: nextRound.aggregate?.summary ?? null,
          roundId: nextRound.roundId,
          packetPath: nextRound.packetPath,
          resolved: nextRound.status === "resolved",
        };
      }

      if (roundsStarted >= policy.maxRounds) {
        return {
          launched: false,
          reason: "round_limit_reached",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          discussionId: policy.discussionId,
          topic: policy.topic,
          stage: currentRound?.stage ?? policy.stage,
          status: currentRound?.status ?? "blocked",
          reviewCount: currentRound?.aggregate?.reviewCount ?? 0,
          roundsStarted,
          recommendedOwner: currentRound?.aggregate?.recommendedOwner ?? null,
          actionItems: currentRound?.aggregate?.actionItems ?? [],
          blockers: currentRound?.aggregate?.blockers ?? [],
          summary: currentRound?.aggregate?.summary ?? null,
          roundId: currentRound?.roundId ?? null,
          packetPath: currentRound?.packetPath ?? materialized.packetPath,
          resolved: false,
        };
      }

      if (!params.workflowRuntime) {
        return {
          launched: false,
          reason: "no_runtime_subagent",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          discussionId: policy.discussionId,
          topic: policy.topic,
          stage: policy.stage,
          status: null,
          reviewCount: 0,
          roundsStarted,
          recommendedOwner: null,
          actionItems: [],
          blockers: [],
          summary: null,
          roundId: null,
          packetPath: materialized.packetPath,
          resolved: false,
        };
      }

      const requesterSessionKey =
        resolveWorkflowRequesterSessionKey({
          projectRoot: params.projectRoot,
          workflowPolicy: params.workflowPolicy,
          deps,
        }) ?? "agent:researcher:main";
      const attempts = await launchWorkflowPanelDiscussionAttempts({
        workflowRuntime: params.workflowRuntime,
        participants: policy.participants,
        requesterSessionKey,
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        source: "workflow_panel_discussion",
        family: "review",
        kind: "workflow_panel_discussion",
        buildSessionKey: (reviewerRole) =>
          deriveAgentSessionKeyForRole({
            requesterSessionKey,
            targetRole: reviewerRole,
          }),
        buildQueueKey: (reviewerRole) =>
          slugifyForIdempotency(
            `openclaw-research:panel-discussion:${policy.discussionId}:${params.projectId ?? path.basename(params.projectRoot)}:${materialized.packetFingerprint}:${reviewerRole}:${roundsStarted + 1}`
          ),
        buildPrompt: (reviewerRole) =>
          buildWorkflowPanelDiscussionPrompt({
            projectRoot: params.projectRoot,
            projectId: params.projectId,
            reviewerRole,
            policy,
            packetPath: materialized.packetPath,
            packetJsonPath: materialized.packetJsonPath,
          }),
        buildSummary: (reviewerRole) =>
          `Run panel discussion ${policy.discussionId} for ${reviewerRole}.`,
        extraSystemPrompt:
          "Workflow panel discussion reviewer.\n" +
          "Review only the supplied panel discussion packet and return the required JSON schema.",
        buildErrorResult: (reviewerRole, errorMessage) =>
          parseWorkflowPanelDiscussionResult(
            JSON.stringify({
              decision: policy.blockedDecisions[0] ?? "blocked",
              confidence: 0,
              recommendedOwner: "researcher",
              blockers: [errorMessage],
              summary: "Panel discussion reviewer run failed to start.",
            }),
            reviewerRole
          ),
      });

      const nextRound = {
        ...materialized.currentRound,
        attempts,
        updatedAt: nowIso(),
      };
      const nextStore = {
        ...materialized.store,
        updatedAt: nowIso(),
        currentRound: nextRound,
      };
      await saveWorkflowPanelDiscussionStore(
        params.projectRoot,
        policy.discussionId,
        nextStore
      );
      return {
        launched: true,
        reason: "started",
        projectId: params.projectId,
        projectRoot: params.projectRoot,
        discussionId: policy.discussionId,
        topic: policy.topic,
        stage: policy.stage,
        status: nextRound.status,
        reviewCount: 0,
        roundsStarted:
          nextStore.roundsStartedByFingerprint[materialized.packetFingerprint] ?? roundsStarted,
        recommendedOwner: null,
        actionItems: [],
        blockers: [],
        summary: null,
        roundId: nextRound.roundId,
        packetPath: nextRound.packetPath,
        resolved: false,
      };
    },
  });
}

export async function maybeAdvanceSurveyBriefRefinementForProject(params: {
  workflowRuntime?: WorkflowRuntimeApi;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  projectRoot: string;
  projectId: string | null;
  autoIteratorResult: {
    stageAfter?: string | null;
  };
  logger?: WorkflowCoordinatorLogger;
  deps?: Partial<WorkflowCoordinatorDependencies>;
}) {
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(params.projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const surveyReview = normalizeSurveyReviewState(
    asRecord(manifest.survey_review)
  );
  const stageAfter =
    normalizeStage(params.autoIteratorResult.stageAfter) ??
    normalizeStage(manifest.current_stage);
  if (stageAfter !== "survey_review") {
    return {
      launched: false,
      reason: "reviewing",
      projectId: params.projectId,
      projectRoot: params.projectRoot,
      discussionId: "survey-brief-refinement",
      topic: surveyReview.topic ?? "survey brief refinement",
      stage: stageAfter,
      status: null,
      reviewCount: 0,
      roundsStarted: 0,
      recommendedOwner: null,
      actionItems: [],
      blockers: [],
      summary: null,
      roundId: null,
      packetPath: null,
      resolved: false,
    } satisfies WorkflowPanelDiscussionServiceAttempt;
  }
  const phase = normalizeStage(surveyReview.currentPhase);
  const shouldRefine =
    (phase === "brief_synthesis" ||
      phase === "taxonomy_refinement" ||
      phase === "gap_closure") &&
    surveyReview.gateReady !== true &&
    Boolean(surveyReview.surveyBriefPath);
  if (!shouldRefine) {
    return {
      launched: false,
      reason: "reviewing",
      projectId: params.projectId,
      projectRoot: params.projectRoot,
      discussionId: "survey-brief-refinement",
      topic: surveyReview.topic ?? "survey brief refinement",
      stage: "survey_review",
      status: null,
      reviewCount: 0,
      roundsStarted: 0,
      recommendedOwner: null,
      actionItems: [],
      blockers: [],
      summary: null,
      roundId: null,
      packetPath: null,
      resolved: false,
    } satisfies WorkflowPanelDiscussionServiceAttempt;
  }
  return maybeAdvanceWorkflowPanelDiscussionForProject({
    workflowRuntime: params.workflowRuntime,
    workflowPolicy: params.workflowPolicy,
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    logger: params.logger,
    deps: params.deps,
    panelDiscussionPolicy: buildSurveyBriefRefinementPanelPolicy({
      topic: surveyReview.topic,
      diagnosticsPath: surveyReview.diagnosticsPath,
      surveyBriefPath: surveyReview.surveyBriefPath,
      literatureReviewPath: surveyReview.literatureReviewPath,
      sotaMatrixPath: surveyReview.sotaMatrixPath,
      gapSynthesisPath: surveyReview.gapSynthesisPath,
      blockingIssues: surveyReview.gateBlockingIssues,
    }),
  });
}

function buildAutoMitigationLaunchKey(params: {
  projectRoot: string;
  fingerprint: string | null;
  owner: DispatchableWorkflowRole | null;
  roundId: string | null;
}) {
  return [
    path.resolve(params.projectRoot),
    params.fingerprint ?? "no-fingerprint",
    params.owner ?? "researcher",
    params.roundId ?? "no-round",
  ].join("::");
}

function buildAutoMitigationExtraBody(params: {
  packetPath: string | null;
  summary: string | null;
  actionItems: string[];
  blockers: string[];
}) {
  return [
    "Workflow auto-mode risk mitigation dispatch.",
    params.packetPath ? `Discussion packet: ${params.packetPath}` : null,
    params.summary ? `Panel summary: ${params.summary}` : null,
    params.actionItems.length > 0
      ? `Action items:\n- ${params.actionItems.join("\n- ")}`
      : "Action items: none were returned.",
    params.blockers.length > 0
      ? `Open blockers:\n- ${params.blockers.join("\n- ")}`
      : null,
    "Make one bounded remediation pass for the listed risk signals, update durable workflow artifacts, then rerun research_workflow.auto_iterator_tick.",
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeHookReviewerRole(
  value: string | null | undefined
): DispatchableWorkflowRole | null {
  if (
    value === "researcher" ||
    value === "planner" ||
    value === "orchestrator" ||
    value === "coder" ||
    value === "analyzer" ||
    value === "academic_writer" ||
    value === "reviewer" ||
    value === "cross-reviewer"
  ) {
    return value;
  }
  return null;
}

export async function maybeAdvanceWorkflowHookPointForProject(params: {
  workflowRuntime?: WorkflowRuntimeApi;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  projectRoot: string;
  projectId: string | null;
  hookPoint: WorkflowHookPoint;
  autoIteratorResult: {
    effectiveAutoMode?: string | null;
    stageAfter?: string | null;
    ownerAfter?: string | null;
    ownerBefore?: string | null;
    missingStageSignals?: string[];
    materializedArtifacts?: Array<{
      contract: string;
      artifactPath: string | null;
      fingerprint: string | null;
      action: "created" | "updated" | "reconciled";
      kind?: string | null;
    }>;
    hookEvents?: Array<{
      hookPoint: WorkflowHookPoint;
      contract: string | null;
      artifactPath: string | null;
    }>;
  };
  logger?: WorkflowCoordinatorLogger;
  deps?: Partial<WorkflowCoordinatorDependencies>;
}) {
  const deps = resolveWorkflowCoordinatorDependencies(params.deps);
  return enqueueWorkflowTask({
    key: resolveWorkflowCoordinationKey({
      projectRoot: params.projectRoot,
      workflowPolicy: params.workflowPolicy,
      deps,
    }),
    label: `workflow_hook_point:${params.hookPoint}`,
    logger: params.logger,
    task: async (): Promise<WorkflowHookPointAttempt> => {
      const workflowRuntime = params.workflowRuntime;
      if ((params.autoIteratorResult.effectiveAutoMode ?? params.workflowPolicy.autoMode) === "off") {
        return {
          launched: false,
          reason: "disabled",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          hookPoint: params.hookPoint,
          stage: params.autoIteratorResult.stageAfter ?? null,
          status: null,
          hookCount: 0,
          approved: true,
          aggregateVerdict: "pass",
          blockingReason: null,
          aggregateRevisionPacketPath: null,
        };
      }
      const missingStageSignals = (params.autoIteratorResult.missingStageSignals ?? []).filter(
        (entry) => typeof entry === "string" && entry.trim().length > 0
      );
      if (params.hookPoint === "before_stage_handoff" && missingStageSignals.length > 0) {
        await appendWorkflowDiagnosticEvent({
          projectRoot: params.projectRoot,
          projectId: params.projectId ?? null,
          component: "hook",
          action: params.hookPoint,
          status: "waiting",
          stage: params.autoIteratorResult.stageAfter ?? null,
          owner:
            params.autoIteratorResult.ownerAfter ??
            params.autoIteratorResult.ownerBefore ??
            null,
          summary:
            "Skipped before-stage handoff hooks because stage readiness signals are still missing.",
          details: {
            hookPoint: params.hookPoint,
            stage: params.autoIteratorResult.stageAfter ?? null,
            missingStageSignalCount: missingStageSignals.length,
            missingStageSignals,
          },
        });
        return {
          launched: false,
          reason: "no_hooks",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          hookPoint: params.hookPoint,
          stage: params.autoIteratorResult.stageAfter ?? null,
          status: "skipped_stage_not_ready",
          hookCount: 0,
          approved: true,
          aggregateVerdict: "pass",
          blockingReason: null,
          aggregateRevisionPacketPath: null,
        };
      }
      const requesterBinding = resolveWorkflowRequesterBinding({
        projectRoot: params.projectRoot,
        workflowPolicy: params.workflowPolicy,
        deps,
      });
      const requesterSessionKey =
        requesterBinding.sessionKey ?? "agent:researcher:main";
      const manifest =
        (await readJsonIfExists<Record<string, unknown>>(
          path.join(params.projectRoot, "PROJECT_MANIFEST.json")
        )) ?? {};
      const writingContract = normalizeWritingContractState(manifest.writing_contract);
      const workflowLine =
        readString(manifest.workflow_line) === "survey" ||
        readString(manifest.paper_type) === "survey" ||
        writingContract.paperMode === "survey" ||
        readString(manifest.current_stage) === "survey_review"
          ? "survey"
          : "experiment";
      const summary = await evaluateWorkflowHooksForPoint({
        workflowRuntime,
        context: buildWorkflowHookPointContext({
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          stage: params.autoIteratorResult.stageAfter ?? null,
          hookPoint: params.hookPoint,
          ownerRole: params.autoIteratorResult.ownerAfter ?? params.autoIteratorResult.ownerBefore ?? null,
          actorRole: "researcher",
          targetRole:
            params.autoIteratorResult.ownerAfter ??
            params.autoIteratorResult.ownerBefore ??
            null,
          workflowLine,
          paperMode: writingContract.paperMode,
          targetStage: params.autoIteratorResult.stageAfter ?? null,
          transition:
            params.hookPoint === "artifact_materialized"
              ? "stage_preflight_materialization"
              : "service_stage_handoff",
          changedPaths: (params.autoIteratorResult.materializedArtifacts ?? [])
            .map((entry) => entry.artifactPath)
            .filter((entry): entry is string => typeof entry === "string"),
          artifactKinds: (params.autoIteratorResult.materializedArtifacts ?? [])
            .map((entry) => entry.kind)
            .filter((entry): entry is string => typeof entry === "string"),
          materializedArtifacts: params.autoIteratorResult.materializedArtifacts ?? [],
          emittedHookEvents: (params.autoIteratorResult.hookEvents ?? []).filter(
            (entry) => entry.hookPoint === params.hookPoint
          ),
        }),
        requesterSessionKey,
        requesterChannel: requesterBinding.messageChannel,
        launchReviewerRun: workflowRuntime
          ? async (launchParams) => {
              const reviewerRole = normalizeHookReviewerRole(launchParams.reviewerRole);
              if (!reviewerRole) {
                return {
                  launched: false,
                  runId: null,
                  sessionKey: launchParams.sessionKey,
                  error: `Unsupported hook reviewer role: ${launchParams.reviewerRole}`,
                };
              }
              const preferredSessionKey = deriveAgentSessionKeyForRole({
                requesterSessionKey,
                targetRole: reviewerRole,
              });
              const started = await launchWorkflowNestedRunTransition({
                workflowRuntime,
                source: "workflow_hook_file_audit",
                queueKey: `workflow-hook:${launchParams.idempotencyKey}`,
                ownerAgent: reviewerRole,
                sessionKey: preferredSessionKey,
                requesterSessionKey,
                projectRoot: launchParams.projectRoot,
                projectId: launchParams.projectId,
                family: "review",
                kind: "workflow_hook_file_audit",
                summary: launchParams.summary,
                message: launchParams.message,
                idempotencyKey: launchParams.idempotencyKey,
                extraSystemPrompt:
                  "Workflow file audit reviewer.\n" +
                  "Audit only the supplied target file packet and return the required JSON schema.",
              });
              return {
                launched: started.launched,
                runId: started.runId ?? null,
                sessionKey: started.sessionKey ?? preferredSessionKey,
                error: started.error ?? null,
              };
            }
          : undefined,
        extractLatestText: extractLatestAssistantText,
      });
      const mergedSummary = await mergeBuiltinWorkflowHooksIntoSummary({
        projectRoot: params.projectRoot,
        hookPoint: params.hookPoint,
        stage: params.autoIteratorResult.stageAfter ?? null,
        summary,
      });
      if (mergedSummary.hooksRun.length === 0) {
        return {
          launched: false,
          reason: "no_hooks",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          hookPoint: params.hookPoint,
          stage: params.autoIteratorResult.stageAfter ?? null,
          status: "idle",
          hookCount: 0,
          approved: true,
          aggregateVerdict: "pass",
          blockingReason: null,
          aggregateRevisionPacketPath: null,
        };
      }
      const launched = mergedSummary.hooksRun.some((entry) => entry.launched);
      const pending = mergedSummary.aggregateStatus === "auditing";
      const gateControl = mergedSummary.gateControl;
      const nonBlockingDebtOrWarning =
        !gateControl.blocking &&
        gateControl.repairRequiredCount === 0 &&
        (gateControl.deferredDebtCount > 0 || gateControl.warnOnlyCount > 0);
      const repairRouted =
        !gateControl.blocking &&
        gateControl.repairRequiredCount > 0 &&
        gateControl.repairRoutes.length > 0;
      const approved =
        mergedSummary.aggregateVerdict === "pass" || nonBlockingDebtOrWarning;
      return {
        launched,
        reason:
          approved
            ? "passed"
            : pending
              ? launched
                ? "started"
                : "reviewing"
              : repairRouted
                ? mergedSummary.aggregateRevisionPacketPath
                  ? "started"
                  : params.workflowRuntime
                    ? "reviewing"
                    : "no_runtime_subagent"
              : params.workflowRuntime
                ? "blocked"
                : "no_runtime_subagent",
        projectId: params.projectId,
        projectRoot: params.projectRoot,
        hookPoint: params.hookPoint,
        stage: params.autoIteratorResult.stageAfter ?? null,
        status: mergedSummary.aggregateStatus,
        hookCount: mergedSummary.hooksRun.length,
        approved,
        aggregateVerdict: mergedSummary.aggregateVerdict,
        blockingReason: mergedSummary.blockingReason,
        aggregateRevisionPacketPath: mergedSummary.aggregateRevisionPacketPath,
        gateControl,
      };
    },
  });
}

export async function maybeAdvanceAutoCodeReviewForProject(params: {
  workflowRuntime?: WorkflowRuntimeApi;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  projectRoot: string;
  projectId: string | null;
  autoIteratorResult: {
    effectiveAutoMode?: string | null;
    gateBlocking?: boolean;
    gateReason?: string | null;
    stageAfter?: string | null;
    missingStageSignals?: string[];
    recommendedActions?: Array<{ kind: string; summary: string; command: string | null }>;
  };
  logger?: WorkflowCoordinatorLogger;
  deps?: Partial<WorkflowCoordinatorDependencies>;
}) {
  const deps = resolveWorkflowCoordinatorDependencies(params.deps);

  return enqueueWorkflowTask({
    key: resolveWorkflowCoordinationKey({
      projectRoot: params.projectRoot,
      workflowPolicy: params.workflowPolicy,
      deps,
    }),
    label: "workflow_auto_code_review",
    logger: params.logger,
    task: async (): Promise<AutoCodeReviewAttempt> => {
      const finish = async (
        attempt: AutoCodeReviewAttempt
      ): Promise<AutoCodeReviewAttempt> => {
        await syncBuiltinAutoCodeReviewHook({
          projectRoot: params.projectRoot,
          stage: attempt.stage,
          attempt,
        });
        return attempt;
      };
      if (
        !params.workflowPolicy.autoGate.enabled ||
        (params.autoIteratorResult.effectiveAutoMode ?? params.workflowPolicy.autoMode) !==
          "aggressive"
      ) {
        return finish({
          launched: false,
          reason: "disabled",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId: null,
          stage: params.autoIteratorResult.stageAfter ?? null,
          status: null,
          reviewCount: 0,
          approved: false,
        });
      }
      if (
        params.autoIteratorResult.stageAfter !== "code" ||
        params.autoIteratorResult.gateBlocking !== true
      ) {
        return finish({
          launched: false,
          reason: "not_code_gate",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId: null,
          stage: params.autoIteratorResult.stageAfter ?? null,
          status: null,
          reviewCount: 0,
          approved: false,
        });
      }

      const missingStageSignals = Array.isArray(params.autoIteratorResult.missingStageSignals)
        ? params.autoIteratorResult.missingStageSignals.filter(
            (item): item is string => typeof item === "string" && item.trim().length > 0
          )
        : [];
      if (missingStageSignals.length > 0) {
        return finish({
          launched: false,
          reason: "bundle_incomplete",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId: "CODE-REVIEW",
          stage: "code",
          status: null,
          reviewCount: 0,
          approved: false,
        });
      }

      const packet = await materializeCodeReviewPacket({
        projectRoot: params.projectRoot,
        projectId: params.projectId,
      });
      const store = await readCodeReviewStore(params.projectRoot);
      const currentRound = store.currentRound;
      const completeWithLocalCodeReview = async (
        reason: AutoCodeReviewAttempt["reason"],
        runtimeAttemptsToRetire = currentRound?.attempts ?? []
      ) => {
        await retireWorkflowPanelRuntimeAttemptState({
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          attempts: runtimeAttemptsToRetire,
          source: "workflow_auto_code_review",
          kind: "workflow_auto_code_review",
          reason: `Local static code review completed because runtime review was unavailable (${reason}).`,
          eventKind: "auto_code_review_runtime_retired",
          diagnosticAction: "auto_code_review_runtime_retired",
          diagnosticSummary:
            "Retired stale code review runtime state after local static review completed.",
          logger: params.logger,
        });
        const attempts = buildLocalCodeReviewAttempts({
          packet: packet.packet,
          packetFingerprint: packet.packetFingerprint,
          participants: defaultCodeReviewPanel(),
          reason,
        });
        const round = createCodeReviewRound({
          stage: "code",
          packetPath: packet.packetPath,
          packetJsonPath: packet.packetJsonPath,
          packetFingerprint: packet.packetFingerprint,
          attempts,
        });
        round.aggregate = aggregateCodeReviewRound(
          round,
          params.workflowPolicy.autoGate
        );
        const aggregate = round.aggregate;
        round.status = aggregate.status;
        const nextStore = {
          schemaVersion: 1 as const,
          updatedAt: nowIso(),
          roundsStarted:
            currentRound?.packetFingerprint === packet.packetFingerprint
              ? store.roundsStarted
              : store.roundsStarted + 1,
          currentRound: round,
        };
        await saveCodeReviewStore(params.projectRoot, nextStore);
        await recordWorkflowReviewRoundResults({
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          workflowLine: "experiment",
          stage: "code",
          results: round.attempts
            .filter((attempt) => attempt.result)
            .map((attempt) => ({
              reviewerRole: attempt.reviewerRole,
              verdict:
                attempt.result?.verdict === "pass"
                  ? "pass"
                  : attempt.result?.verdict === "revise"
                    ? "revise"
                    : "block",
              summary:
                attempt.result?.summary ??
                `${attempt.reviewerRole} local code review ${attempt.result?.verdict ?? attempt.status}.`,
              artifactPaths: attempt.result?.reviewedArtifacts ?? [],
              blockers: [
                ...(attempt.result?.criticalBlockers ?? []),
                ...(attempt.result?.majorIssues ?? []),
              ],
            })),
          nextOwnerOnPass: aggregate.approved ? "researcher" : null,
        });
        await appendWorkflowDiagnosticEvent({
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          component: "service",
          action: "local_static_review_completed",
          status: round.status === "approved" ? "completed" : "blocked",
          stage: "code",
          owner: "reviewer",
          summary:
            round.status === "approved"
              ? "Local static code review approved the code packet."
              : "Local static code review rejected the code packet.",
          details: {
            reason,
            packetFingerprint: packet.packetFingerprint,
            reviewCount: aggregate.reviewCount,
            averageScore: aggregate.averageScore,
            blockerCount: aggregate.blockerCount,
          },
        });
        return finish({
          launched: false,
          reason,
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId: "CODE-REVIEW",
          stage: "code",
          status: round.status,
          reviewCount: aggregate.reviewCount,
          approved: aggregate.approved,
        });
      };
      if (
        currentRound?.gateId === "CODE-REVIEW" &&
        currentRound.packetFingerprint === packet.packetFingerprint &&
        currentRound.status === "approved"
      ) {
        return finish({
          launched: false,
          reason: "already_approved",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId: "CODE-REVIEW",
          stage: "code",
          status: currentRound.status,
          reviewCount: currentRound.aggregate?.reviewCount ?? 0,
          approved: true,
        });
      }
      if (
        currentRound?.gateId === "CODE-REVIEW" &&
        currentRound.packetFingerprint === packet.packetFingerprint &&
        currentRound.status === "rejected"
      ) {
        return finish({
          launched: false,
          reason: "already_rejected",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId: "CODE-REVIEW",
          stage: "code",
          status: currentRound.status,
          reviewCount: currentRound.aggregate?.reviewCount ?? 0,
          approved: false,
        });
      }
      if (!params.workflowRuntime) {
        return completeWithLocalCodeReview("local_static_review_no_runtime");
      }

      if (
        currentRound?.gateId === "CODE-REVIEW" &&
        currentRound.packetFingerprint === packet.packetFingerprint &&
        currentRound.status === "reviewing"
      ) {
        const attempts = await pollCodeReviewAttempts({
          workflowRuntime: params.workflowRuntime,
          attempts: currentRound.attempts,
          projectRoot: params.projectRoot,
          projectId: params.projectId,
        });
        const nextRound = {
          ...currentRound,
          attempts,
          updatedAt: nowIso(),
        };
        nextRound.aggregate = aggregateCodeReviewRound(
          nextRound,
          params.workflowPolicy.autoGate
        );
        nextRound.status = nextRound.aggregate.status;
        const shouldFallbackToLocalReview =
          nextRound.attempts.some(
            (attempt) =>
              attempt.status === "pending" &&
              shouldUseLocalCodeReviewFallback({ launchedAt: attempt.launchedAt })
          ) ||
          nextRound.attempts.some(
            (attempt) =>
              attempt.status === "error" && isCodeReviewRuntimeFailure(attempt.error)
          );
        if (shouldFallbackToLocalReview) {
          return completeWithLocalCodeReview("local_static_review_runtime_stale");
        }
        const nextStore = {
          ...store,
          updatedAt: nowIso(),
          currentRound: nextRound,
        };
        await saveCodeReviewStore(params.projectRoot, nextStore);
        if (nextRound.status !== "reviewing") {
          await retireWorkflowPanelRuntimeAttemptState({
            projectRoot: params.projectRoot,
            projectId: params.projectId,
            attempts: nextRound.attempts,
            source: "workflow_auto_code_review",
            kind: "workflow_auto_code_review",
            reason: `Code review round reached terminal state ${nextRound.status}.`,
            eventKind: "auto_code_review_runtime_retired",
            diagnosticAction: "auto_code_review_runtime_retired",
            diagnosticSummary:
              "Retired code review runtime state after the reviewer round reached a terminal state.",
            logger: params.logger,
          });
          await recordWorkflowReviewRoundResults({
            projectRoot: params.projectRoot,
            projectId: params.projectId,
            workflowLine: "experiment",
            stage: "code",
            results: nextRound.attempts
              .filter((attempt) => attempt.result)
              .map((attempt) => ({
                reviewerRole: attempt.reviewerRole,
                verdict:
                  attempt.result?.verdict === "pass"
                    ? "pass"
                    : attempt.result?.verdict === "revise"
                      ? "revise"
                      : "block",
                summary:
                  attempt.result?.summary ??
                  `${attempt.reviewerRole} code review ${attempt.result?.verdict ?? attempt.status}.`,
                artifactPaths: attempt.result?.reviewedArtifacts ?? [],
                blockers: [
                  ...(attempt.result?.criticalBlockers ?? []),
                  ...(attempt.result?.majorIssues ?? []),
                ],
              })),
            nextOwnerOnPass: nextRound.aggregate?.approved ? "researcher" : null,
          });
        }
        return finish({
          launched: false,
          reason: nextRound.status === "reviewing" ? "reviewing" : "updated",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId: "CODE-REVIEW",
          stage: "code",
          status: nextRound.status,
          reviewCount: nextRound.aggregate?.reviewCount ?? 0,
          approved: nextRound.aggregate?.approved === true,
        });
      }

      let supersededCodeReviewFromFingerprint: string | null = null;
      const supersededCodeReviewAttempts:
        Array<{ queueKey: string; sessionKey: string | null }> = [];
      if (
        currentRound?.gateId === "CODE-REVIEW" &&
        currentRound.status === "reviewing" &&
        currentRound.packetFingerprint !== packet.packetFingerprint
      ) {
        supersededCodeReviewFromFingerprint = currentRound.packetFingerprint;
        for (const attempt of currentRound.attempts) {
          const queueKey = readString(attempt.queueKey);
          if (queueKey) {
            supersededCodeReviewAttempts.push({ queueKey, sessionKey: null });
          }
        }
      }
      if (supersededCodeReviewAttempts.length > 0) {
        await retireWorkflowPanelRuntimeAttemptState({
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          attempts: supersededCodeReviewAttempts,
          source: "workflow_auto_code_review",
          kind: "workflow_auto_code_review",
          reason:
            `Code review packet changed from ${supersededCodeReviewFromFingerprint ?? "unknown"} to ${packet.packetFingerprint}; retiring superseded reviewer runtime.`,
          eventKind: "auto_code_review_runtime_retired",
          diagnosticAction: "auto_code_review_superseded_runtime_retired",
          diagnosticSummary:
            "Retired superseded code review runtime state after the packet fingerprint changed.",
          logger: params.logger,
        });
      }
      await retireSupersededCodeReviewQueuesForPacket({
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        packetFingerprint: packet.packetFingerprint,
        reason:
          `Code review packet ${packet.packetFingerprint} superseded older code review queue entries.`,
        logger: params.logger,
      });

      if (store.roundsStarted >= params.workflowPolicy.autoGate.maxReviewRounds) {
        return finish({
          launched: false,
          reason: "already_rejected",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId: "CODE-REVIEW",
          stage: "code",
          status: "rejected",
          reviewCount: currentRound?.aggregate?.reviewCount ?? 0,
          approved: false,
        });
      }

      const requesterSessionKey =
        resolveWorkflowRequesterSessionKey({
          projectRoot: params.projectRoot,
          workflowPolicy: params.workflowPolicy,
          deps,
        }) ?? "agent:researcher:main";
      const attempts = await launchWorkflowPanelDiscussionAttempts({
        workflowRuntime: params.workflowRuntime,
        participants: defaultCodeReviewPanel(),
        requesterSessionKey,
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        source: "workflow_auto_code_review",
        family: "review",
        kind: "workflow_auto_code_review",
        buildSessionKey: (reviewerRole) =>
          deriveAgentSessionKeyForRole({
            requesterSessionKey,
            targetRole: reviewerRole,
          }),
        buildQueueKey: (reviewerRole) =>
          slugifyForIdempotency(
            `openclaw-research:auto-code-review:${params.projectId ?? path.basename(params.projectRoot)}:${packet.packetFingerprint}:${reviewerRole}`
          ),
        buildPrompt: (reviewerRole) =>
          buildCodeReviewPrompt({
            projectRoot: params.projectRoot,
            projectId: params.projectId,
            reviewerRole,
            packetPath: packet.packetPath,
            packetJsonPath: packet.packetJsonPath,
          }),
        buildSummary: (reviewerRole) =>
          `Run code innovation review for ${reviewerRole}.`,
        extraSystemPrompt:
          "Workflow code innovation reviewer.\n" +
          "Review only the supplied code review packet and return the required JSON schema.",
        buildErrorResult: (reviewerRole, errorMessage) =>
          parseCodeReviewResult(
            JSON.stringify({
              verdict: "block",
              overallScore: 0,
              criticalBlockers: [errorMessage],
              summary: "Code reviewer run failed to start.",
            }),
            reviewerRole
          ),
      });

      if (supersededCodeReviewAttempts.length > 0) {
        await retireWorkflowPanelRuntimeAttemptState({
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          attempts: supersededCodeReviewAttempts,
          source: "workflow_auto_code_review",
          kind: "workflow_auto_code_review",
          reason:
            `Code review packet changed from ${currentRound?.packetFingerprint ?? "unknown"} to ${packet.packetFingerprint}; retiring superseded reviewer runtime after relaunch.`,
          eventKind: "auto_code_review_runtime_retired",
          diagnosticAction: "auto_code_review_superseded_runtime_retired",
          diagnosticSummary:
            "Retired superseded code review queue state after launching the replacement reviewer round.",
          logger: params.logger,
        });
      }
      await retireSupersededCodeReviewQueuesForPacket({
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        packetFingerprint: packet.packetFingerprint,
        reason:
          `Code review packet ${packet.packetFingerprint} superseded older code review queue entries after relaunch.`,
        logger: params.logger,
      });

      if (
        attempts.length > 0 &&
        attempts.every(
          (attempt) =>
            attempt.status === "error" &&
            isCodeReviewRuntimeFailure(attempt.error)
        )
      ) {
        return completeWithLocalCodeReview(
          "local_static_review_launch_failed",
          attempts
        );
      }

      const round = createCodeReviewRound({
        stage: "code",
        packetPath: packet.packetPath,
        packetJsonPath: packet.packetJsonPath,
        packetFingerprint: packet.packetFingerprint,
        attempts,
      });
      const nextStore = {
        schemaVersion: 1 as const,
        updatedAt: nowIso(),
        roundsStarted: store.roundsStarted + 1,
        currentRound: round,
      };
      await saveCodeReviewStore(params.projectRoot, nextStore);
      await Promise.all(
        attempts.map((attempt) =>
          createWorkflowReviewRoundHandoff({
            projectRoot: params.projectRoot,
            projectId: params.projectId,
            workflowLine: "experiment",
            stage: "code",
            fromRole: "orchestrator",
            reviewerRole: attempt.reviewerRole,
            subject: `Code innovation review for ${attempt.reviewerRole}`,
            command: `Review packet: ${packet.packetPath}`,
          })
        )
      );
      return finish({
        launched: true,
        reason: "started",
        projectId: params.projectId,
        projectRoot: params.projectRoot,
        gateId: "CODE-REVIEW",
        stage: "code",
        status: round.status,
        reviewCount: 0,
        approved: false,
      });
    },
  });
}

export async function maybeAdvanceAutoGateReviewForProject(params: {
  workflowRuntime?: WorkflowRuntimeApi;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  projectRoot: string;
  projectId: string | null;
  autoIteratorResult: {
    effectiveAutoMode?: string | null;
    gateBlocking?: boolean;
    stageAfter?: string | null;
    recommendedActions?: Array<{ kind: string; summary: string; command: string | null }>;
  };
  logger?: WorkflowCoordinatorLogger;
  deps?: Partial<WorkflowCoordinatorDependencies>;
}) {
  const deps = resolveWorkflowCoordinatorDependencies(params.deps);

  return enqueueWorkflowTask({
    key: resolveWorkflowCoordinationKey({
      projectRoot: params.projectRoot,
      workflowPolicy: params.workflowPolicy,
      deps,
    }),
    label: "workflow_auto_gate_review",
    logger: params.logger,
    task: async (): Promise<AutoGateReviewAttempt> => {
      const finish = async (
        attempt: AutoGateReviewAttempt
      ): Promise<AutoGateReviewAttempt> => {
        await syncBuiltinSubmitReadinessHook({
          projectRoot: params.projectRoot,
          stage: attempt.stage,
          attempt,
        });
        return attempt;
      };
      if (
        !params.workflowPolicy.autoGate.enabled ||
        (params.autoIteratorResult.effectiveAutoMode ?? params.workflowPolicy.autoMode) !==
          "aggressive"
      ) {
        return finish({
          launched: false,
          reason: "disabled",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId: null,
          stage: params.autoIteratorResult.stageAfter ?? null,
          status: null,
          reviewCount: 0,
          approved: false,
        });
      }
      const gateStage = params.autoIteratorResult.stageAfter ?? null;
      const gateId = resolveAutoGateIdForStage(gateStage);
      const gateMode = resolveAutoGateMode({
        stage: gateStage,
        autoGate: params.workflowPolicy.autoGate,
      });
      if (!gateId || params.autoIteratorResult.gateBlocking !== true) {
        return finish({
          launched: false,
          reason: "not_submit_gate",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId: gateId ?? null,
          stage: gateStage,
          status: null,
          reviewCount: 0,
          approved: false,
        });
      }
      if (gateMode === "panel_gate") {
        const gatePacket = await materializeGateReviewPacket({
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          stage: gateStage,
          gateId,
        });
        const panelAttempt = await maybeAdvanceWorkflowPanelDiscussionForProject({
          workflowRuntime: params.workflowRuntime,
          workflowPolicy: params.workflowPolicy,
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          logger: params.logger,
          deps: params.deps,
          panelDiscussionPolicy: buildAutoGatePanelDiscussionPolicy({
            projectRoot: params.projectRoot,
            gateId,
            stage: gateStage,
            autoGate: params.workflowPolicy.autoGate,
            packetPath: gatePacket.packetPath,
            packetJsonPath: gatePacket.packetJsonPath,
            reviewedArtifacts: gatePacket.reviewedArtifacts,
          }),
        });
        const panelStore = await readWorkflowPanelDiscussionStore(
          params.projectRoot,
          `gate-review-${gateId.toLowerCase()}`
        );
        const panelRound = panelStore.currentRound;
        if (panelRound) {
          const attempts: GateReviewAttempt[] = panelRound.attempts.map((attempt) => ({
            reviewerRole: attempt.reviewerRole as GateReviewReviewerRole,
            sessionKey: attempt.sessionKey,
            runId: attempt.runId,
            status: attempt.status,
            launchedAt: attempt.launchedAt,
            completedAt: attempt.completedAt,
            error: attempt.error,
            result: attempt.result
              ? {
                  ...parseGateReviewResult(
                    attempt.result.rawText ??
                      JSON.stringify({
                        verdict: attempt.result.decision,
                        overallScore: attempt.result.confidence,
                        criticalBlockers: attempt.result.blockers,
                        majorIssues: attempt.result.actionItems,
                        summary: attempt.result.summary,
                      }),
                    attempt.reviewerRole as GateReviewReviewerRole
                  ),
                  runId: attempt.result.runId ?? attempt.runId,
                }
              : null,
          }));
          const gateRound = createGateReviewRound({
            gateId,
            stage: gateStage,
            packetPath: gatePacket.packetPath,
            packetJsonPath: gatePacket.packetJsonPath,
            packetFingerprint: gatePacket.packetFingerprint,
            attempts,
          });
          gateRound.aggregate = aggregateGateReviewRound(
            gateRound,
            params.workflowPolicy.autoGate
          );
          gateRound.status = gateRound.aggregate.status;
          await saveGateReviewStore(params.projectRoot, {
            schemaVersion: 1,
            updatedAt: nowIso(),
            roundsStarted:
              panelStore.roundsStartedByFingerprint[panelRound.packetFingerprint] ?? 1,
            currentRound: gateRound,
          });
          return finish({
            launched: panelAttempt.launched,
            reason:
              gateRound.status === "approved"
                ? "updated"
                : panelAttempt.reason === "started" || panelAttempt.reason === "reviewing"
                  ? panelAttempt.reason
                  : panelAttempt.reason === "resolved"
                    ? "updated"
                    : panelAttempt.reason === "round_limit_reached"
                      ? "already_rejected"
                  : gateRound.status === "rejected"
                    ? "updated"
                    : panelAttempt.reason,
            projectId: params.projectId,
            projectRoot: params.projectRoot,
            gateId,
            stage: gateStage,
            status: gateRound.status,
            reviewCount: gateRound.aggregate?.reviewCount ?? 0,
            approved: gateRound.aggregate?.approved === true,
          });
        }
        return finish({
          launched: panelAttempt.launched,
          reason:
            panelAttempt.reason === "resolved"
              ? "updated"
              : panelAttempt.reason === "round_limit_reached"
                ? "already_rejected"
                : panelAttempt.reason,
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId,
          stage: gateStage,
          status: panelAttempt.status,
          reviewCount: panelAttempt.reviewCount,
          approved: false,
        });
      }
      const manifest = await readJsonIfExists<Record<string, unknown>>(
        path.join(params.projectRoot, "PROJECT_MANIFEST.json")
      );
      const scoreEvaluation = evaluateAutoGate(
        gateStage,
        manifest,
        params.workflowPolicy.autoGate
      );
      if (scoreEvaluation.scoreRecordCount > 0 && !scoreEvaluation.pass) {
        return finish({
          launched: false,
          reason: "already_rejected",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          gateId,
          stage: gateStage,
          status: "rejected",
          reviewCount: scoreEvaluation.scoreRecordCount,
          approved: false,
        });
      }
      return finish({
        launched: false,
        reason: "manual_confirmation_required",
        projectId: params.projectId,
        projectRoot: params.projectRoot,
        gateId,
        stage: gateStage,
        status:
          scoreEvaluation.scoreRecordCount > 0 && scoreEvaluation.pass
            ? "thresholds_passed"
            : null,
        reviewCount: scoreEvaluation.scoreRecordCount,
        approved: false,
      });
    },
  });
}

export async function maybeAdvanceAutoModeDiscussionForProject(params: {
  workflowRuntime?: WorkflowRuntimeApi;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  projectRoot: string;
  projectId: string | null;
  autoIteratorResult: {
    configuredAutoMode?: string | null;
    autoModeRiskLevel?: string | null;
    autoModeReasons?: string[];
    autoModeRiskFingerprint?: string | null;
    stageAfter?: string | null;
    ownerAfter?: string | null;
    nextAction?: string | null;
    blockingReason?: string | null;
    missingStageSignals?: string[];
  };
  logger?: WorkflowCoordinatorLogger;
  deps?: Partial<WorkflowCoordinatorDependencies>;
}) {
  const deps = resolveWorkflowCoordinatorDependencies(params.deps);

  return enqueueWorkflowTask({
    key: resolveWorkflowCoordinationKey({
      projectRoot: params.projectRoot,
      workflowPolicy: params.workflowPolicy,
      deps,
    }),
    label: "workflow_auto_mode_discussion",
    logger: params.logger,
    task: async (): Promise<AutoModeDiscussionAttempt> => {
      const finish = async (
        attempt: AutoModeDiscussionAttempt
      ): Promise<AutoModeDiscussionAttempt> => {
        await syncBuiltinAutoModeRiskHook({
          projectRoot: params.projectRoot,
          stage: attempt.stage,
          attempt,
        });
        return attempt;
      };
      const configuredMode =
        readString(params.autoIteratorResult.configuredAutoMode) ??
        params.workflowPolicy.autoMode;
      const riskLevel = readString(params.autoIteratorResult.autoModeRiskLevel);
      const fingerprint = readString(params.autoIteratorResult.autoModeRiskFingerprint);
      const riskReasons = Array.isArray(params.autoIteratorResult.autoModeReasons)
        ? params.autoIteratorResult.autoModeReasons.filter(
            (item): item is string => typeof item === "string" && item.trim().length > 0
          )
        : [];
      const coreRiskReasons = riskReasons.filter(
        (item) => !/^Auto discussion /i.test(item)
      );
      const missingStageSignals = Array.isArray(params.autoIteratorResult.missingStageSignals)
        ? params.autoIteratorResult.missingStageSignals.filter(
            (item): item is string => typeof item === "string" && item.trim().length > 0
          )
        : [];
      const retireStableAutoModeDiscussionRound = async () => {
        const stableStore = await readAutoModeDiscussionStore(params.projectRoot);
        const staleRound = stableStore.currentRound;
        if (staleRound?.status !== "reviewing") {
          return;
        }
        await retireWorkflowPanelRuntimeAttemptState({
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          attempts: staleRound.attempts,
          source: "workflow_auto_discussion",
          kind: "workflow_auto_discussion",
          reason:
            "Auto-mode risk is now stable; the previous runtime discussion round is no longer active.",
          eventKind: "auto_mode_discussion_runtime_retired",
          diagnosticAction: "stable_auto_mode_discussion_retired",
          diagnosticSummary:
            "Retired stale auto-mode discussion runtime state after risk returned to stable.",
          logger: params.logger,
        });
        await saveAutoModeDiscussionStore(params.projectRoot, {
          ...stableStore,
          updatedAt: nowIso(),
          currentRound: null,
        });
        await appendWorkflowDiagnosticEvent({
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          component: "service",
          action: "stable_auto_mode_discussion_cleared",
          status: "completed",
          stage: staleRound.stage,
          owner: null,
          summary:
            "Cleared the stale auto-mode discussion round because the active risk fingerprint became stable.",
          details: {
            staleFingerprint: staleRound.packetFingerprint,
            staleStatus: staleRound.status,
          },
        });
      };
      if (configuredMode === "off") {
        return finish({
          launched: false,
          reason: "disabled",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          fingerprint,
          stage: params.autoIteratorResult.stageAfter ?? null,
          riskLevel,
          status: null,
          reviewCount: 0,
          roundsStarted: 0,
          recommendedOwner: null,
          actionItems: [],
          blockers: [],
          summary: null,
          roundId: null,
          packetPath: null,
          resolved: false,
        });
      }
      if (riskLevel == null || riskLevel === "stable" || !fingerprint) {
        await retireStableAutoModeDiscussionRound();
        return finish({
          launched: false,
          reason: "stable",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          fingerprint,
          stage: params.autoIteratorResult.stageAfter ?? null,
          riskLevel,
          status: null,
          reviewCount: 0,
          roundsStarted: 0,
          recommendedOwner: null,
          actionItems: [],
          blockers: [],
          summary: null,
          roundId: null,
          packetPath: null,
          resolved: false,
        });
      }
      const packet = await materializeAutoModeDiscussionPacket({
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        stage: params.autoIteratorResult.stageAfter ?? null,
        riskLevel: riskLevel as "caution" | "severe",
        riskReasons: coreRiskReasons.length > 0 ? coreRiskReasons : riskReasons,
        missingStageSignals,
        ownerAfter: params.autoIteratorResult.ownerAfter ?? null,
        nextAction: params.autoIteratorResult.nextAction ?? null,
        blockingReason: params.autoIteratorResult.blockingReason ?? null,
      });
      const store = await readAutoModeDiscussionStore(params.projectRoot);
      const currentRound = store.currentRound;
      const roundsStarted = store.roundsStartedByFingerprint[packet.packetFingerprint] ?? 0;
      await retireSupersededAutoModeDiscussionRuntimeState({
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        activeFingerprint: packet.packetFingerprint,
        logger: params.logger,
      });
      const completeWithLocalAutoModeDiscussion = async (
        reason: AutoModeDiscussionAttempt["reason"],
        runtimeAttemptsToRetire = currentRound?.attempts ?? []
      ) => {
        await retireWorkflowPanelRuntimeAttemptState({
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          attempts: runtimeAttemptsToRetire,
          source: "workflow_auto_discussion",
          kind: "workflow_auto_discussion",
          reason: `Local static auto-mode discussion completed because runtime discussion was unavailable (${reason}).`,
          eventKind: "auto_mode_discussion_runtime_retired",
          diagnosticAction: "auto_mode_discussion_runtime_retired",
          diagnosticSummary:
            "Retired stale auto-mode discussion runtime state after local static discussion completed.",
          logger: params.logger,
        });
        const attempts = buildLocalAutoModeDiscussionAttempts({
          packet: packet.packet,
          packetFingerprint: packet.packetFingerprint,
          participants: defaultAutoModeDiscussionPanel(),
          reason,
        });
        const round = createAutoModeDiscussionRound({
          stage: params.autoIteratorResult.stageAfter ?? null,
          riskLevel: riskLevel as "caution" | "severe",
          packetPath: packet.packetPath,
          packetJsonPath: packet.packetJsonPath,
          packetFingerprint: packet.packetFingerprint,
          attempts,
        });
        round.aggregate = aggregateAutoModeDiscussionRound(
          round,
          params.workflowPolicy.autoGate.quorum
        );
        const aggregate = round.aggregate;
        round.status = aggregate.status;
        const nextRoundsStarted =
          currentRound?.packetFingerprint === packet.packetFingerprint
            ? Math.max(1, roundsStarted)
            : roundsStarted + 1;
        const nextStore = {
          schemaVersion: 1 as const,
          updatedAt: nowIso(),
          roundsStartedByFingerprint: {
            ...store.roundsStartedByFingerprint,
            [packet.packetFingerprint]: nextRoundsStarted,
          },
          currentRound: round,
        };
        await saveAutoModeDiscussionStore(params.projectRoot, nextStore);
        await appendWorkflowDiagnosticEvent({
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          component: "service",
          action: "local_static_auto_mode_discussion_completed",
          status:
            round.status === "resolved"
              ? "completed"
              : round.status === "needs_changes"
                ? "degraded"
                : "blocked",
          stage: round.stage,
          owner: aggregate.recommendedOwner,
          summary:
            round.status === "resolved"
              ? "Local auto-mode risk discussion allowed the current handoff to continue."
              : "Local auto-mode risk discussion requested bounded remediation before continuing.",
          details: {
            reason,
            packetFingerprint: packet.packetFingerprint,
            riskLevel,
            reviewCount: aggregate.reviewCount,
            averageConfidence: aggregate.averageConfidence,
            assessmentCounts: aggregate.assessmentCounts,
            blockerCount: aggregate.blockers.length,
          },
        });
        return finish({
          launched: false,
          reason,
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          fingerprint: packet.packetFingerprint,
          stage: round.stage,
          riskLevel: round.riskLevel,
          status: round.status,
          reviewCount: aggregate.reviewCount,
          roundsStarted: nextRoundsStarted,
          recommendedOwner: aggregate.recommendedOwner,
          actionItems: aggregate.actionItems,
          blockers: aggregate.blockers,
          summary: aggregate.summary,
          roundId: round.roundId,
          packetPath: round.packetPath,
          resolved: round.status === "resolved",
        });
      };

      if (
        currentRound?.packetFingerprint === packet.packetFingerprint &&
        currentRound.status === "resolved"
      ) {
        return finish({
          launched: false,
          reason: "resolved",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          fingerprint: packet.packetFingerprint,
          stage: currentRound.stage,
          riskLevel: currentRound.riskLevel,
          status: currentRound.status,
          reviewCount: currentRound.aggregate?.reviewCount ?? 0,
          roundsStarted,
          recommendedOwner: currentRound.aggregate?.recommendedOwner ?? null,
          actionItems: currentRound.aggregate?.actionItems ?? [],
          blockers: currentRound.aggregate?.blockers ?? [],
          summary: currentRound.aggregate?.summary ?? null,
          roundId: currentRound.roundId,
          packetPath: currentRound.packetPath,
          resolved: true,
        });
      }
      if (
        currentRound?.packetFingerprint === packet.packetFingerprint &&
        currentRound.status !== "reviewing" &&
        currentRound.status !== "resolved" &&
        currentRound.attempts.length > 0 &&
        currentRound.attempts.every(
          (attempt) =>
            attempt.status === "error" &&
            isAutoModeDiscussionRuntimeFailure(attempt.error)
        )
      ) {
        return completeWithLocalAutoModeDiscussion(
          "local_static_discussion_runtime_stale",
          currentRound.attempts
        );
      }

      if (
        currentRound?.packetFingerprint === packet.packetFingerprint &&
        currentRound.status === "reviewing"
      ) {
        if (!params.workflowRuntime) {
          return completeWithLocalAutoModeDiscussion(
            "local_static_discussion_no_runtime"
          );
        }
        const attempts = await pollAutoModeDiscussionAttempts({
          workflowRuntime: params.workflowRuntime,
          attempts: currentRound.attempts,
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          projectsRoot: params.workflowPolicy.projectsRoot,
        });
        const nextRound = {
          ...currentRound,
          attempts,
          updatedAt: nowIso(),
        };
        nextRound.aggregate = aggregateAutoModeDiscussionRound(
          nextRound,
          params.workflowPolicy.autoGate.quorum
        );
        nextRound.status = nextRound.aggregate.status;
        const shouldFallbackToLocalDiscussion =
          nextRound.attempts.some(
            (attempt) =>
              attempt.status === "pending" &&
              shouldUseLocalAutoModeDiscussionFallback({
                launchedAt: attempt.launchedAt,
              })
          ) ||
          nextRound.attempts.some(
            (attempt) =>
              attempt.status === "error" &&
              isAutoModeDiscussionRuntimeFailure(attempt.error)
          );
        if (shouldFallbackToLocalDiscussion) {
          return completeWithLocalAutoModeDiscussion(
            "local_static_discussion_runtime_stale"
          );
        }
        const nextStore = {
          ...store,
          updatedAt: nowIso(),
          currentRound: nextRound,
        };
        await saveAutoModeDiscussionStore(params.projectRoot, nextStore);
        if (nextRound.status !== "reviewing") {
          await retireWorkflowPanelRuntimeAttemptState({
            projectRoot: params.projectRoot,
            projectId: params.projectId,
            attempts: nextRound.attempts,
            source: "workflow_auto_discussion",
            kind: "workflow_auto_discussion",
            reason: `Auto-mode discussion round reached terminal state ${nextRound.status}.`,
            eventKind: "auto_mode_discussion_runtime_retired",
            diagnosticAction: "auto_mode_discussion_runtime_retired",
            diagnosticSummary:
              "Retired auto-mode discussion runtime state after the discussion round reached a terminal state.",
            logger: params.logger,
          });
        }
        return finish({
          launched: false,
          reason: nextRound.status === "reviewing" ? "reviewing" : "updated",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          fingerprint: packet.packetFingerprint,
          stage: nextRound.stage,
          riskLevel: nextRound.riskLevel,
          status: nextRound.status,
          reviewCount: nextRound.aggregate?.reviewCount ?? 0,
          roundsStarted,
          recommendedOwner: nextRound.aggregate?.recommendedOwner ?? null,
          actionItems: nextRound.aggregate?.actionItems ?? [],
          blockers: nextRound.aggregate?.blockers ?? [],
          summary: nextRound.aggregate?.summary ?? null,
          roundId: nextRound.roundId,
          packetPath: nextRound.packetPath,
          resolved: nextRound.status === "resolved",
        });
      }

      if (roundsStarted >= params.workflowPolicy.autoGate.maxMitigationRounds) {
        return finish({
          launched: false,
          reason: "round_limit_reached",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          fingerprint: packet.packetFingerprint,
          stage: currentRound?.stage ?? params.autoIteratorResult.stageAfter ?? null,
          riskLevel: currentRound?.riskLevel ?? riskLevel,
          status: currentRound?.status ?? "blocked",
          reviewCount: currentRound?.aggregate?.reviewCount ?? 0,
          roundsStarted,
          recommendedOwner: currentRound?.aggregate?.recommendedOwner ?? null,
          actionItems: currentRound?.aggregate?.actionItems ?? [],
          blockers: currentRound?.aggregate?.blockers ?? [],
          summary: currentRound?.aggregate?.summary ?? null,
          roundId: currentRound?.roundId ?? null,
          packetPath: currentRound?.packetPath ?? packet.packetPath,
          resolved: false,
        });
      }
      if (!params.workflowRuntime) {
        return completeWithLocalAutoModeDiscussion(
          "local_static_discussion_no_runtime"
        );
      }
      if (
        params.workflowPolicy.enableChannelProjectBindings === true &&
        !hasWorkflowProjectBinding({
          projectRoot: params.projectRoot,
          workflowPolicy: params.workflowPolicy,
          deps,
        })
      ) {
        return finish({
          launched: false,
          reason: "binding_missing",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          fingerprint: packet.packetFingerprint,
          stage: params.autoIteratorResult.stageAfter ?? null,
          riskLevel,
          status: null,
          reviewCount: 0,
          roundsStarted,
          recommendedOwner: null,
          actionItems: [],
          blockers: [],
          summary:
            "Channel-project bindings are enabled, but this project has no active workflow binding.",
          roundId: null,
          packetPath: packet.packetPath,
          resolved: false,
        });
      }

      const requesterBinding = resolveWorkflowRequesterBinding({
        projectRoot: params.projectRoot,
        workflowPolicy: params.workflowPolicy,
        deps,
      });
      const requesterSessionKey = requesterBinding.sessionKey;
      const attempts: AutoModeDiscussionReviewAttempt[] = [];
      const roundNumber = roundsStarted + 1;
      for (const reviewerRole of defaultAutoModeDiscussionPanel()) {
        let sessionKey: string | null = buildAutoModeDiscussionReviewerSessionKey({
          requesterSessionKey: requesterSessionKey ?? undefined,
          reviewerRole,
          projectRoot: params.projectRoot,
          stage: params.autoIteratorResult.stageAfter ?? null,
          riskLevel,
          fingerprint: packet.packetFingerprint,
          roundNumber,
        });
        const preferredDiscussionSessionKey = sessionKey;
        const discussionQueueKey = buildAutoModeDiscussionQueueKey({
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          fingerprint: packet.packetFingerprint,
          reviewerRole,
          roundNumber,
        });
        const pooledDiscussionQueueKey = shouldUsePooledServiceSession(reviewerRole)
          ? discussionQueueKey
          : null;
        let pooledSessionLease:
          | Awaited<ReturnType<typeof acquireBackgroundWorkflowSession>>
          | null = null;
        if (shouldUsePooledServiceSession(reviewerRole)) {
          pooledSessionLease = await acquireBackgroundWorkflowSession({
            workflowRuntime: params.workflowRuntime,
            ownerAgent: reviewerRole,
            requesterSessionKey: requesterSessionKey ?? "agent:researcher:main",
            channelKey: requesterBinding.channelKey ?? undefined,
            preferredSessionKey: sessionKey,
            family: "review",
            kind: "workflow_auto_discussion",
            projectId: params.projectId ?? undefined,
            projectRoot: params.projectRoot,
            projectsRoot: params.workflowPolicy.projectsRoot,
          });
          if (!pooledSessionLease.acquired || !pooledSessionLease.sessionKey) {
            await enqueueQueuedBackgroundWorkflowRun({
              source: "workflow_auto_discussion",
              ownerAgent: reviewerRole,
              requesterSessionKey: requesterSessionKey ?? "agent:researcher:main",
              channelKey: requesterBinding.channelKey ?? undefined,
              preferredSessionKey: sessionKey,
              family: "review",
              kind: "workflow_auto_discussion",
              projectId: params.projectId ?? undefined,
              projectRoot: params.projectRoot,
              projectsRoot: params.workflowPolicy.projectsRoot,
              queueKey: pooledDiscussionQueueKey,
              summary:
                `Queued the ${reviewerRole} auto discussion reviewer until an idle ${reviewerRole} service session becomes available.`,
              runPayload: {
                message: buildAutoModeDiscussionPrompt({
                  projectRoot: params.projectRoot,
                  projectId: params.projectId,
                  stage: params.autoIteratorResult.stageAfter ?? null,
                  riskLevel: riskLevel as "caution" | "severe",
                  reviewerRole,
                  packetPath: packet.packetPath,
                  packetJsonPath: packet.packetJsonPath,
                }),
                lane: "nested",
                deliver: false,
                idempotencyKey: discussionQueueKey,
                extraSystemPrompt:
                  "Workflow auto risk discussion reviewer.\n" +
                  "Review only the supplied risk packet and return the required JSON schema.",
              },
            });
            params.logger?.debug?.("Queued researcher auto discussion reviewer because the shared service session pool is at capacity.", {
              projectId: params.projectId,
              projectRoot: params.projectRoot,
              stage: params.autoIteratorResult.stageAfter ?? null,
              riskLevel,
              activeResearcherSessionsInChannel:
                pooledSessionLease.activeResearcherSessionsInChannel,
            });
            attempts.push({
              reviewerRole,
              sessionKey: sessionKey ?? "",
              runId: null,
              queueKey: pooledDiscussionQueueKey,
              status: "pending",
              launchedAt: nowIso(),
              completedAt: null,
              error: null,
              result: null,
            });
            continue;
          }
          sessionKey = pooledSessionLease.reusedIdleSession
            ? preferredDiscussionSessionKey
            : pooledSessionLease.sessionKey;
        }
        try {
          const queueKey = discussionQueueKey;
          const started = await launchWorkflowNestedRunTransition({
            workflowRuntime: params.workflowRuntime,
            source: "workflow_auto_discussion",
            queueKey,
            ownerAgent: reviewerRole,
            sessionKey,
            requesterSessionKey: requesterSessionKey ?? "agent:researcher:main",
            projectRoot: params.projectRoot,
            projectId: params.projectId,
            family: "review",
            kind: "workflow_auto_discussion",
            summary: `Run auto discussion review for ${reviewerRole}.`,
            message: buildAutoModeDiscussionPrompt({
              projectRoot: params.projectRoot,
              projectId: params.projectId,
              stage: params.autoIteratorResult.stageAfter ?? null,
              riskLevel: riskLevel as "caution" | "severe",
              reviewerRole,
              packetPath: packet.packetPath,
              packetJsonPath: packet.packetJsonPath,
            }),
            idempotencyKey: queueKey,
            extraSystemPrompt:
              "Workflow auto risk discussion reviewer.\n" +
              "Review only the supplied risk packet and return the required JSON schema.",
          });
          if (!started.launched || !started.runId) {
            throw new Error(
              started.error ??
                "Auto discussion reviewer failed to launch through the workflow runtime."
            );
          }
          if (shouldUsePooledServiceSession(reviewerRole) && pooledSessionLease?.channelKey) {
            await recordBackgroundWorkflowRun({
              ownerAgent: reviewerRole,
              channelKey: pooledSessionLease.channelKey,
              requesterSessionKey: requesterSessionKey ?? "agent:researcher:main",
              backgroundSessionKey: sessionKey,
              runId: started.runId,
              queueKey,
              kind: "workflow_auto_discussion",
              family: "review",
              projectId: params.projectId ?? undefined,
              projectRoot: params.projectRoot,
              projectsRoot: params.workflowPolicy.projectsRoot,
            });
          }
          attempts.push({
            reviewerRole,
            sessionKey,
            runId: started.runId,
            queueKey,
            status: "pending",
            launchedAt: nowIso(),
            completedAt: null,
            error: null,
            result: null,
          });
        } catch (error) {
          attempts.push({
            reviewerRole,
            sessionKey,
            runId: null,
            queueKey: pooledDiscussionQueueKey,
            status: "error",
            launchedAt: nowIso(),
            completedAt: nowIso(),
            error: error instanceof Error ? error.message : String(error),
            result: parseAutoModeDiscussionResult(
              JSON.stringify({
                riskAssessment: "blocked",
                confidence: 0,
                recommendedOwner: "researcher",
                blockers: [error instanceof Error ? error.message : String(error)],
                summary: "Risk discussion run failed to start.",
              }),
              reviewerRole
            ),
          });
        }
      }
      if (
        attempts.length > 0 &&
        attempts.every(
          (attempt) =>
            attempt.status === "error" &&
            isAutoModeDiscussionRuntimeFailure(attempt.error)
        )
      ) {
        return completeWithLocalAutoModeDiscussion(
          "local_static_discussion_launch_failed",
          attempts
        );
      }
      const round = createAutoModeDiscussionRound({
        stage: params.autoIteratorResult.stageAfter ?? null,
        riskLevel: riskLevel as "caution" | "severe",
        packetPath: packet.packetPath,
        packetJsonPath: packet.packetJsonPath,
        packetFingerprint: packet.packetFingerprint,
        attempts,
      });
      const nextStore = {
        schemaVersion: 1 as const,
        updatedAt: nowIso(),
        roundsStartedByFingerprint: {
          ...store.roundsStartedByFingerprint,
          [packet.packetFingerprint]: roundsStarted + 1,
        },
        currentRound: round,
      };
      await saveAutoModeDiscussionStore(params.projectRoot, nextStore);
      return finish({
        launched: true,
        reason: "started",
        projectId: params.projectId,
        projectRoot: params.projectRoot,
        fingerprint: packet.packetFingerprint,
        stage: round.stage,
        riskLevel: round.riskLevel,
        status: round.status,
        reviewCount: 0,
        roundsStarted: roundsStarted + 1,
        recommendedOwner: null,
        actionItems: [],
        blockers: [],
        summary: null,
        roundId: round.roundId,
        packetPath: round.packetPath,
        resolved: false,
      });
    },
  });
}

export async function maybeDispatchAutoModeMitigationForProject(params: {
  workflowRuntime?: WorkflowRuntimeApi;
  workflowPolicy: ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
  projectRoot: string;
  projectId: string | null;
  autoIteratorResult: {
    stageAfter?: string | null;
    nextAction?: string | null;
    ownerAfter?: DispatchableWorkflowRole | null;
    effectiveAutoMode?: string | null;
  };
  discussionAttempt: AutoModeDiscussionAttempt;
  launchedMitigationKeys: Map<string, { key: string; launchedAt: number }>;
  logger?: WorkflowCoordinatorLogger;
  deps?: Partial<WorkflowCoordinatorDependencies>;
}) {
  const deps = resolveWorkflowCoordinatorDependencies(params.deps);

  return enqueueWorkflowTask({
    key: resolveWorkflowCoordinationKey({
      projectRoot: params.projectRoot,
      workflowPolicy: params.workflowPolicy,
      deps,
    }),
    label: "workflow_auto_mode_mitigation",
    logger: params.logger,
    task: async (): Promise<AutoModeMitigationDispatchAttempt> => {
      if (
        params.discussionAttempt.status !== "needs_changes" &&
        params.discussionAttempt.status !== "blocked"
      ) {
        return {
          launched: false,
          reason: "not_needed",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          fingerprint: params.discussionAttempt.fingerprint,
          stage: params.discussionAttempt.stage,
          owner: null,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          error: null,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        };
      }
      if (!params.workflowRuntime) {
        return {
          launched: false,
          reason: "no_runtime_subagent",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          fingerprint: params.discussionAttempt.fingerprint,
          stage: params.discussionAttempt.stage,
          owner: params.discussionAttempt.recommendedOwner,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          error: null,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        };
      }

      const owner =
        params.discussionAttempt.recommendedOwner ??
        params.autoIteratorResult.ownerAfter ??
        "researcher";
      const requesterBinding = resolveWorkflowRequesterBinding({
        projectRoot: params.projectRoot,
        workflowPolicy: params.workflowPolicy,
        deps,
      });
      if (
        params.workflowPolicy.enableChannelProjectBindings === true &&
        !hasWorkflowProjectBinding({
          projectRoot: params.projectRoot,
          workflowPolicy: params.workflowPolicy,
          deps,
        })
      ) {
        params.launchedMitigationKeys.delete(params.projectRoot);
        return {
          launched: false,
          reason: "binding_missing",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          fingerprint: params.discussionAttempt.fingerprint,
          stage: params.discussionAttempt.stage,
          owner,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          error:
            "Channel-project bindings are enabled, but this project has no active workflow binding.",
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        };
      }
      const launchKey = buildAutoMitigationLaunchKey({
        projectRoot: params.projectRoot,
        fingerprint: params.discussionAttempt.fingerprint,
        owner,
        roundId: params.discussionAttempt.roundId,
      });
      const lastLaunch = params.launchedMitigationKeys.get(params.projectRoot);
      const cooldownMs = Math.max(
        1,
        params.workflowPolicy.agentContactCooldownSeconds
      ) * 1000;
      if (
        lastLaunch?.key === launchKey &&
        Date.now() - lastLaunch.launchedAt < cooldownMs
      ) {
        return {
          launched: false,
          reason: "already_dispatched",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          fingerprint: params.discussionAttempt.fingerprint,
          stage: params.discussionAttempt.stage,
          owner,
          sessionKey: null,
          runId: null,
          dispatchStrategy: null,
          error: null,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel: null,
        };
      }

      const requesterSessionKey = requesterBinding.sessionKey;
      const defaultResearcherRequesterSessionKey =
        requesterSessionKey ?? "agent:researcher:main";
      const preferredResearcherSessionKeys = buildWorkflowCoordinatorDispatchSessionKeys({
        requesterSessionKey: requesterSessionKey ?? undefined,
        owner,
        projectRoot: params.projectRoot,
        purpose: "workflow-mitigation",
        segments: [
          params.discussionAttempt.stage ?? params.autoIteratorResult.stageAfter ?? null,
          params.autoIteratorResult.nextAction,
        ],
      });
      let pooledSessionLease:
        | Awaited<ReturnType<typeof acquireBackgroundWorkflowSession>>
        | null = null;
      if (shouldUsePooledServiceSession(owner)) {
        pooledSessionLease = await acquireBackgroundWorkflowSession({
          workflowRuntime: params.workflowRuntime,
          ownerAgent: owner,
          requesterSessionKey: defaultResearcherRequesterSessionKey,
          channelKey: requesterBinding.channelKey ?? undefined,
          preferredSessionKey: preferredResearcherSessionKeys?.[0] ?? null,
          family: "research",
          kind: "workflow_mitigation_dispatch",
          projectId: params.projectId ?? undefined,
          projectRoot: params.projectRoot,
          projectsRoot: params.workflowPolicy.projectsRoot,
        });
        if (!pooledSessionLease.acquired || !pooledSessionLease.sessionKey) {
          await enqueueQueuedBackgroundWorkflowRun({
            source: "workflow_auto_mitigation",
            ownerAgent: owner,
            requesterSessionKey: defaultResearcherRequesterSessionKey,
            channelKey: requesterBinding.channelKey ?? undefined,
            preferredSessionKey: preferredResearcherSessionKeys?.[0] ?? null,
            family: "research",
            kind: "workflow_mitigation_dispatch",
            projectId: params.projectId ?? undefined,
            projectRoot: params.projectRoot,
            projectsRoot: params.workflowPolicy.projectsRoot,
            queueKey: launchKey,
            summary:
              `Queued the mitigation pass until an idle ${owner} service session becomes available.`,
            dispatchPayload: {
              requesterChannel: requesterBinding.messageChannel,
              requesterAccountId: null,
              preferredSessionKeys: preferredResearcherSessionKeys ?? [],
              fromRole: "researcher",
              toRole: owner,
              projectRoot: params.projectRoot,
              projectId: params.projectId,
              stage: params.autoIteratorResult.stageAfter ?? null,
              summary:
                params.discussionAttempt.summary ??
                "Resolve the current auto-mode risk before the next workflow advance.",
              command:
                params.autoIteratorResult.nextAction ??
                "Run research_workflow.auto_iterator_tick after the mitigation pass.",
              mailboxMessageId: null,
              requireMailboxAcknowledgement: true,
              extraBody: buildAutoMitigationExtraBody({
                packetPath: params.discussionAttempt.packetPath,
                summary: params.discussionAttempt.summary,
                actionItems: params.discussionAttempt.actionItems,
                blockers: params.discussionAttempt.blockers,
              }),
              waitTimeoutMs: 5000,
              retryOnTimeout: true,
              enableSpawnFallback: true,
              useWorkflowHandoff: true,
              autoModeActive:
                (params.autoIteratorResult.effectiveAutoMode ??
                  params.workflowPolicy.autoMode) !== "off",
            },
          });
          return {
            launched: false,
            reason: "session_pool_full",
            projectId: params.projectId,
            projectRoot: params.projectRoot,
            fingerprint: params.discussionAttempt.fingerprint,
            stage: params.discussionAttempt.stage,
            owner,
            sessionKey: null,
            runId: null,
            dispatchStrategy: null,
            error: `${owner} service session pool is at capacity for this channel (${pooledSessionLease.activeOwnerSessionsInChannel ?? pooledSessionLease.activeResearcherSessionsInChannel ?? 0} active).`,
            reusedServiceSession: false,
            activeResearcherSessionsInChannel:
              pooledSessionLease.activeResearcherSessionsInChannel,
          };
        }
      }
      const dispatchLaunch = await launchWorkflowDispatchTransition({
        workflowRuntime: params.workflowRuntime,
        workflowPolicy: params.workflowPolicy,
        source: "workflow_auto_mitigation",
        queueKey: launchKey,
        owner,
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        requesterSessionKey: requesterSessionKey ?? defaultResearcherRequesterSessionKey,
        requesterChannel: requesterBinding.messageChannel ?? undefined,
        requesterChannelKey: requesterBinding.channelKey ?? undefined,
        preferredSessionKeys:
          shouldUsePooledServiceSession(owner)
            ? [
                pooledSessionLease?.sessionKey ??
                  preferredResearcherSessionKeys?.[0] ??
                  defaultResearcherRequesterSessionKey,
              ]
            : preferredResearcherSessionKeys ?? [],
        family: "research",
        kind: "workflow_mitigation_dispatch",
        fromRole: "researcher",
        stage: params.autoIteratorResult.stageAfter ?? null,
        summary:
          params.discussionAttempt.summary ??
          "Resolve the current auto-mode risk before the next workflow advance.",
        command:
          params.autoIteratorResult.nextAction ??
          "Run research_workflow.auto_iterator_tick after the mitigation pass.",
        extraBody: buildAutoMitigationExtraBody({
          packetPath: params.discussionAttempt.packetPath,
          summary: params.discussionAttempt.summary,
          actionItems: params.discussionAttempt.actionItems,
          blockers: params.discussionAttempt.blockers,
        }),
        autoModeActive:
          (params.autoIteratorResult.effectiveAutoMode ??
            params.workflowPolicy.autoMode) !== "off",
        logger: params.logger,
      });
      if (!dispatchLaunch.launched) {
        return {
          launched: false,
          reason: "dispatch_failed",
          projectId: params.projectId,
          projectRoot: params.projectRoot,
          fingerprint: params.discussionAttempt.fingerprint,
          stage: params.discussionAttempt.stage,
          owner,
          sessionKey: dispatchLaunch.sessionKey,
          runId: dispatchLaunch.runId,
          dispatchStrategy: dispatchLaunch.strategy,
          error: dispatchLaunch.error,
          reusedServiceSession: false,
          activeResearcherSessionsInChannel:
            pooledSessionLease?.activeResearcherSessionsInChannel ?? null,
        };
      }

      if (
        shouldUsePooledServiceSession(owner) &&
        pooledSessionLease?.channelKey &&
        dispatchLaunch.runId &&
        dispatchLaunch.sessionKey
      ) {
        await recordBackgroundWorkflowRun({
          ownerAgent: owner,
          channelKey: pooledSessionLease.channelKey,
          requesterSessionKey: defaultResearcherRequesterSessionKey,
          backgroundSessionKey: dispatchLaunch.sessionKey,
          runId: dispatchLaunch.runId,
          queueKey: launchKey,
          kind: "workflow_mitigation_dispatch",
          family: "research",
          projectId: params.projectId ?? undefined,
          projectRoot: params.projectRoot,
          projectsRoot: params.workflowPolicy.projectsRoot,
        });
      }

      params.launchedMitigationKeys.set(params.projectRoot, {
        key: launchKey,
        launchedAt: Date.now(),
      });
      await recordWorkflowContactEvent({
        projectRoot: params.projectRoot,
        fromAgent: "researcher",
        toAgent: owner,
        channel: "sessions_spawn",
      });
      return {
        launched: true,
        reason: "started",
        projectId: params.projectId,
        projectRoot: params.projectRoot,
        fingerprint: params.discussionAttempt.fingerprint,
        stage: params.discussionAttempt.stage,
        owner,
        sessionKey: dispatchLaunch.sessionKey,
        runId: dispatchLaunch.runId,
        dispatchStrategy: dispatchLaunch.strategy,
        error: null,
        reusedServiceSession: pooledSessionLease?.reusedIdleSession ?? false,
        activeResearcherSessionsInChannel:
          pooledSessionLease?.activeResearcherSessionsInChannel ?? null,
      };
    },
  });
}

function summarizeCoordinatorPass(
  results: Awaited<ReturnType<typeof runWorkflowCoordinatorPass>>
) {
  return results.map((entry) => ({
    projectId: entry.projectId,
    stageBefore: entry.result.stageBefore,
    stageAfter: entry.result.stageAfter,
    stageChanged: entry.result.stageChanged,
    regressed: entry.result.regressed,
    recommendedActionKinds: entry.result.recommendedActions.map((action) => action.kind),
  }));
}

export function createWorkflowCoordinatorService(
  plugin: PluginRegistrationContext,
  deps: Partial<WorkflowCoordinatorDependencies> = {}
): OpenClawPluginService {
  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let inFlightTick: Promise<void> | null = null;
  const launchedIdleResearchDueKeys = new Map<string, string>();
  const launchedStageKeys = new Map<string, { key: string; launchedAt: number }>();
  const launchedMitigationKeys = new Map<string, { key: string; launchedAt: number }>();
  const workflowRuntime = createWorkflowExecutionRuntimeFromApi({
    api: plugin.api,
    defaultMessageChannel: "discord",
  });
  const gatewayMessagingRuntime = createWorkflowBroadcastRuntimeFromApi({
    api: plugin.api,
  });

  const runTick = (logger: WorkflowCoordinatorLogger, trigger: string) => {
    if (inFlightTick) {
      return inFlightTick;
    }

    const workflowPolicy = plugin.getWorkflowPolicy();
    if (!workflowPolicy.heartbeatBackgroundChecks || !workflowPolicy.projectsRoot) {
      return Promise.resolve();
    }

    inFlightTick = (async () => {
      try {
        const workflowPolicy = plugin.getWorkflowPolicy();
        const resolvedDeps = resolveWorkflowCoordinatorDependencies(deps);
        if (
          workflowPolicy.enableChannelProjectBindings &&
          workflowPolicy.projectsRoot
        ) {
          await ensureProjectsBindingIndex({
            projectsRoot: workflowPolicy.projectsRoot,
          });
        }
        const drainedQueue = await drainQueuedBackgroundWorkflowRuns({
          workflowRuntime: workflowRuntime,
          workflowPolicy,
          projectsRoot: workflowPolicy.projectsRoot,
        });
        const results = await runWorkflowCoordinatorPass({
          projectsRoot: workflowPolicy.projectsRoot,
          policy: workflowPolicy,
          cooldownSeconds: workflowPolicy.agentContactCooldownSeconds,
          queueMailbox: workflowPolicy.enableWorkflowMailbox,
          maxProjects: DEFAULT_WORKFLOW_COORDINATOR_MAX_PROJECTS,
          logger,
          deps: resolvedDeps,
        });
        await settleCoordinatorProjectStep({
          entries: results,
          stepName: "runtime_maintenance",
          logger,
          run: (entry) =>
            resolvedDeps.runWorkflowRuntimeMaintenancePass({
              projectRoot: entry.projectRoot,
              projectId: entry.projectId,
              staleSessionAgeMs: 15 * 60 * 1000,
              workflowRuntime: workflowRuntime,
              workflowPolicy,
              logger,
              sendBroadcast: async (broadcastEntry) => {
                const result = await maybeBroadcastWorkflowStatusUpdate({
                  workflowRuntime: gatewayMessagingRuntime,
                  bindingPolicy: workflowPolicy,
                  sessionKey: broadcastEntry.sessionKey,
                  projectId: broadcastEntry.projectId,
                  projectRoot: broadcastEntry.projectRoot,
                  status: broadcastEntry.status,
                  stage: broadcastEntry.stage,
                  summary: broadcastEntry.summary,
                  idempotencyKeySuffix: broadcastEntry.broadcastId,
                });
                if (!result.broadcasted || !result.runId) {
                  throw new Error(
                    result.reasonSkipped ??
                      "Workflow runtime recovery broadcast could not be delivered."
                  );
                }
                return {
                  runId: result.runId,
                  sessionKey: result.sessionKey,
                };
              },
            }),
          onError: () => null,
        });
        await settleCoordinatorProjectStep({
          entries: results,
          stepName: "task_reconcile",
          logger,
          run: (entry) =>
            reconcileClaimedWorkflowTasksForProject({
              projectRoot: entry.projectRoot,
              projectId: entry.projectId,
            }),
          onError: () => null,
        });
        const artifactHookAttempts = await Promise.all(
          results.map((entry) =>
            maybeAdvanceWorkflowHookPointForProject({
              workflowRuntime: workflowRuntime,
              workflowPolicy,
              projectRoot: entry.projectRoot,
              projectId: entry.projectId,
              hookPoint: "artifact_materialized",
              autoIteratorResult: entry.result,
              logger,
              deps: resolvedDeps,
            })
          )
        );
        const autoCodeReviews = await Promise.all(
          results.map((entry) =>
            maybeAdvanceAutoCodeReviewForProject({
              workflowRuntime: workflowRuntime,
              workflowPolicy,
              projectRoot: entry.projectRoot,
              projectId: entry.projectId,
              autoIteratorResult: entry.result,
              logger,
              deps: resolvedDeps,
            })
          )
        );
        const codeReviewRefreshedResults = await Promise.all(
          results.map(async (entry, index) => {
            if (autoCodeReviews[index]?.approved !== true) {
              return entry;
            }
            const refreshed = await enqueueWorkflowTask({
              key: resolveWorkflowCoordinationKey({
                projectRoot: entry.projectRoot,
                workflowPolicy,
                deps,
              }),
              label: "workflow_post_code_review_reconcile",
              logger,
              task: () =>
                (deps.runWorkflowAutoIterator ?? runWorkflowAutoIterator)({
                  projectRoot: entry.projectRoot,
                  policy: workflowPolicy,
                  agentId: "researcher",
                  mode: "service-post-code-review",
                  queueMailbox: workflowPolicy.enableWorkflowMailbox,
                  cooldownSeconds: workflowPolicy.agentContactCooldownSeconds,
                }),
            });
            return {
              ...entry,
              result: refreshed,
            };
          })
        );
        const autoGateReviews = await Promise.all(
          codeReviewRefreshedResults.map((entry) =>
            maybeAdvanceAutoGateReviewForProject({
              workflowRuntime: workflowRuntime,
              workflowPolicy,
              projectRoot: entry.projectRoot,
              projectId: entry.projectId,
              autoIteratorResult: entry.result,
              logger,
              deps: resolvedDeps,
            })
          )
        );
        const refreshedResults = await Promise.all(
          codeReviewRefreshedResults.map(async (entry, index) => {
            if (autoGateReviews[index]?.approved !== true) {
              return entry;
            }
            const refreshed = await enqueueWorkflowTask({
              key: resolveWorkflowCoordinationKey({
                projectRoot: entry.projectRoot,
                workflowPolicy,
                deps,
              }),
              label: "workflow_post_gate_reconcile",
              logger,
              task: () =>
                (deps.runWorkflowAutoIterator ?? runWorkflowAutoIterator)({
                  projectRoot: entry.projectRoot,
                  policy: workflowPolicy,
                  agentId: "researcher",
                  mode: "service-post-gate",
                  queueMailbox: workflowPolicy.enableWorkflowMailbox,
                  cooldownSeconds: workflowPolicy.agentContactCooldownSeconds,
                }),
            });
            return {
              ...entry,
              result: refreshed,
            };
          })
        );
        const autoModeDiscussions = await Promise.all(
          refreshedResults.map((entry) =>
            maybeAdvanceAutoModeDiscussionForProject({
              workflowRuntime: workflowRuntime,
              workflowPolicy,
              projectRoot: entry.projectRoot,
              projectId: entry.projectId,
              autoIteratorResult: entry.result,
              logger,
              deps: resolvedDeps,
            })
          )
        );
        const surveyBriefRefinementAttempts = await Promise.all(
          refreshedResults.map((entry) =>
            maybeAdvanceSurveyBriefRefinementForProject({
              workflowRuntime: workflowRuntime,
              workflowPolicy,
              projectRoot: entry.projectRoot,
              projectId: entry.projectId,
              autoIteratorResult: entry.result,
              logger,
              deps: resolvedDeps,
            })
          )
        );
        const discussionRefreshedResults = await Promise.all(
          refreshedResults.map(async (entry, index) => {
            if (
              autoModeDiscussions[index]?.resolved !== true &&
              surveyBriefRefinementAttempts[index]?.resolved !== true
            ) {
              return entry;
            }
            const refreshed = await enqueueWorkflowTask({
              key: resolveWorkflowCoordinationKey({
                projectRoot: entry.projectRoot,
                workflowPolicy,
                deps,
              }),
              label: "workflow_post_discussion_reconcile",
              logger,
              task: () =>
                (deps.runWorkflowAutoIterator ?? runWorkflowAutoIterator)({
                  projectRoot: entry.projectRoot,
                  policy: workflowPolicy,
                  agentId: "researcher",
                  mode: "service-post-discussion",
                  queueMailbox: workflowPolicy.enableWorkflowMailbox,
                  cooldownSeconds: workflowPolicy.agentContactCooldownSeconds,
                }),
            });
            return {
              ...entry,
              result: refreshed,
            };
          })
        );
        const autoMitigationAttempts = await Promise.all(
          discussionRefreshedResults.map((entry, index) =>
            maybeDispatchAutoModeMitigationForProject({
              workflowRuntime: workflowRuntime,
              workflowPolicy,
              projectRoot: entry.projectRoot,
              projectId: entry.projectId,
              autoIteratorResult: entry.result,
              discussionAttempt: autoModeDiscussions[index],
              launchedMitigationKeys,
              logger,
              deps,
            })
          )
        );
        const autoMitigationDispatches = autoMitigationAttempts.filter((entry) => entry.launched);
        const beforeStageHandoffHookAttempts = await Promise.all(
          discussionRefreshedResults.map((entry) =>
            maybeAdvanceWorkflowHookPointForProject({
              workflowRuntime: workflowRuntime,
              workflowPolicy,
              projectRoot: entry.projectRoot,
              projectId: entry.projectId,
              hookPoint: "before_stage_handoff",
              autoIteratorResult: entry.result,
              logger,
              deps: resolvedDeps,
            })
          )
        );
        const autoStageAttempts = await Promise.all(
          discussionRefreshedResults.map((entry, index) => {
            if (
              artifactHookAttempts[index]?.approved === false ||
              beforeStageHandoffHookAttempts[index]?.approved === false
            ) {
              return Promise.resolve({
                launched: false,
                reason: "gate_blocked",
                projectId: entry.projectId,
                projectRoot: entry.projectRoot,
                stage: entry.result.stageAfter ?? null,
                owner: null,
                sessionKey: null,
                runId: null,
                dispatchStrategy: null,
                launchKey: null,
                error:
                  beforeStageHandoffHookAttempts[index]?.blockingReason ??
                  artifactHookAttempts[index]?.blockingReason ??
                  "Workflow hooks blocked the current stage handoff.",
                reusedServiceSession: false,
                activeResearcherSessionsInChannel: null,
              } satisfies AutoStageLaunchAttempt);
            }
            return maybeLaunchAutoStageForProject({
              workflowRuntime: workflowRuntime,
              workflowPolicy,
              projectRoot: entry.projectRoot,
              projectId: entry.projectId,
              autoIteratorResult: entry.result,
              launchedStageKeys,
              logger,
              deps,
            });
          })
        );
        const autoStageLaunches = autoStageAttempts.filter((entry) => entry.launched);
        const idleResearchAttempts = await Promise.all(
          discussionRefreshedResults.map((entry) =>
            maybeLaunchIdleResearchForProject({
              workflowRuntime: workflowRuntime,
              workflowPolicy,
              projectRoot: entry.projectRoot,
              projectId: entry.projectId,
              autoIteratorResult: entry.result,
              launchedDueKeys: launchedIdleResearchDueKeys,
              logger,
              deps,
            })
          )
        );
        const idleResearchLaunches = idleResearchAttempts.filter((entry) => entry.launched);
        const autoZoteroSyncAttempts = await Promise.all(
          discussionRefreshedResults.map((entry) =>
            maybeLaunchAutoZoteroSyncForProject({
              workflowRuntime: workflowRuntime,
              workflowPolicy,
              projectRoot: entry.projectRoot,
              projectId: entry.projectId,
              logger,
              deps,
            })
          )
        );
        const autoZoteroSyncLaunches = autoZoteroSyncAttempts.filter(
          (entry) => entry.launched || entry.queued
        );
        const paperIngestionWorkerAttempts = await Promise.all(
          discussionRefreshedResults.map((entry) =>
            maybeLaunchPaperIngestionWorkerForProject({
              workflowRuntime: workflowRuntime,
              workflowPolicy,
              projectRoot: entry.projectRoot,
              projectId: entry.projectId,
              triggerKind: "coordinator_heartbeat",
              logger,
              deps,
            })
          )
        );
        const paperIngestionWorkerLaunches = paperIngestionWorkerAttempts.filter(
          (entry) => entry.launched || entry.queued
        );
        await Promise.all(
          discussionRefreshedResults.map((entry, index) =>
            updateAutoDispatchDiagnostics({
              projectRoot: entry.projectRoot,
              patch: {
                status:
                  autoStageAttempts[index]?.launched
                    ? "ready"
                    : beforeStageHandoffHookAttempts[index]?.approved === false ||
                        artifactHookAttempts[index]?.approved === false
                      ? "blocked"
                      : autoStageAttempts[index]?.reason === "session_pool_full" ||
                          autoStageAttempts[index]?.reason === "dispatch_failed"
                        ? "degraded"
                        : entry.result.gateBlocking || (entry.result.missingStageSignals?.length ?? 0) > 0
                          ? "waiting"
                          : "ready",
                blockingLayer:
                  beforeStageHandoffHookAttempts[index]?.approved === false ||
                  artifactHookAttempts[index]?.approved === false
                    ? "hook"
                    : autoStageAttempts[index]?.reason === "session_pool_full" ||
                        autoStageAttempts[index]?.reason === "dispatch_failed"
                      ? "dispatch"
                      : entry.result.gateBlocking
                        ? "runtime"
                        : (entry.result.missingStageSignals?.length ?? 0) > 0
                          ? "signals"
                          : null,
                blockingReason:
                  autoStageAttempts[index]?.reason ??
                  beforeStageHandoffHookAttempts[index]?.blockingReason ??
                  artifactHookAttempts[index]?.blockingReason ??
                  entry.result.gateReason ??
                  entry.result.blockingReason,
                blockingSummary:
                  autoStageAttempts[index]?.error ??
                  beforeStageHandoffHookAttempts[index]?.blockingReason ??
                  artifactHookAttempts[index]?.blockingReason ??
                  entry.result.blockingReason,
                stageAfter: entry.result.stageAfter ?? null,
                ownerAfter: entry.result.ownerAfter ?? null,
                effectiveAutoMode: entry.result.effectiveAutoMode ?? null,
                riskFingerprint: entry.result.autoModeRiskFingerprint ?? null,
                activeHookPoint:
                  beforeStageHandoffHookAttempts[index]?.approved === false
                    ? "before_stage_handoff"
                    : artifactHookAttempts[index]?.approved === false
                      ? "artifact_materialized"
                      : null,
                aggregateHookVerdict:
                  beforeStageHandoffHookAttempts[index]?.aggregateVerdict ??
                  artifactHookAttempts[index]?.aggregateVerdict ??
                  null,
                runtimeSessionHealth:
                  autoStageAttempts[index]?.reason === "session_pool_full"
                    ? "session_pool_full"
                    : autoStageAttempts[index]?.reason === "dispatch_failed"
                      ? "dispatch_failed"
                      : null,
                mailboxStatus:
                  autoStageAttempts[index]?.reason === "gate_blocked"
                    ? "not_dispatched"
                    : null,
                nextRepairAction: entry.result.nextAction ?? null,
              },
            })
          )
        );
        await Promise.all(
          discussionRefreshedResults.map(async (entry, index) => {
            const statusUpdate = deriveWorkflowCoordinatorStatusUpdate({
              projectId: entry.projectId,
              projectRoot: entry.projectRoot,
              stageAfter: entry.result.stageAfter ?? null,
              timedDefaultTriggered: entry.result.timedDefaultTriggered === true,
              timedDefaultSummary: entry.result.gateReason,
              artifactHooks: artifactHookAttempts[index],
              beforeStageHandoffHooks: beforeStageHandoffHookAttempts[index],
              autoCodeReview: autoCodeReviews[index],
              autoGateReview: autoGateReviews[index],
              autoModeDiscussion: autoModeDiscussions[index],
              autoMitigationDispatch: autoMitigationAttempts[index],
              autoStageLaunch: autoStageAttempts[index],
              idleResearchLaunch: idleResearchAttempts[index],
              autoZoteroSync: autoZoteroSyncAttempts[index],
              paperIngestionWorker: paperIngestionWorkerAttempts[index],
            });
            if (!statusUpdate) {
              return null;
            }
            const requesterSessionKey = resolveWorkflowRequesterSessionKey({
              projectRoot: entry.projectRoot,
              workflowPolicy,
              deps: resolveWorkflowCoordinatorDependencies(deps),
            });
            return maybeBroadcastWorkflowStatusUpdate({
              workflowRuntime: gatewayMessagingRuntime,
              bindingPolicy: workflowPolicy,
              sessionKey: requesterSessionKey,
              projectId: entry.projectId,
              projectRoot: entry.projectRoot,
              status: statusUpdate.status,
              stage: statusUpdate.stage,
              summary: statusUpdate.summary,
              idempotencyKeySuffix: statusUpdate.dedupeKey,
            });
          })
        );
        logger.debug?.("Workflow coordinator pass completed.", {
          trigger,
          queuedBackgroundRunsStarted: drainedQueue.started.length,
          queuedBackgroundRunsRemaining: drainedQueue.remaining.length,
          projectCount: discussionRefreshedResults.length,
          results: summarizeCoordinatorPass(discussionRefreshedResults),
          artifactHookAttempts,
          autoCodeReviews,
          autoGateReviews,
          autoModeDiscussions,
          autoMitigationDispatches,
          beforeStageHandoffHookAttempts,
          autoStageLaunches,
          idleResearchLaunches,
          autoZoteroSyncLaunches,
          paperIngestionWorkerLaunches,
        });
        if (autoMitigationDispatches.length > 0) {
          logger.info?.("Workflow coordinator launched mitigation passes.", {
            trigger,
            launches: autoMitigationDispatches.map((entry) => ({
              projectId: entry.projectId,
              stage: entry.stage,
              owner: entry.owner,
              sessionKey: entry.sessionKey,
              runId: entry.runId,
              strategy: entry.dispatchStrategy,
            })),
          });
        }
        if (autoStageLaunches.length > 0) {
          logger.info?.("Workflow coordinator launched stage owners.", {
            trigger,
            launches: autoStageLaunches.map((entry) => ({
              projectId: entry.projectId,
              stage: entry.stage,
              owner: entry.owner,
              sessionKey: entry.sessionKey,
              runId: entry.runId,
              strategy: entry.dispatchStrategy,
            })),
          });
        }
        if (idleResearchLaunches.length > 0) {
          logger.info?.("Workflow coordinator launched idle research.", {
            trigger,
            launches: idleResearchLaunches.map((entry) => ({
              projectId: entry.projectId,
              topic: entry.topic,
              sessionKey: entry.sessionKey,
              runId: entry.runId,
            })),
          });
        }
        if (autoZoteroSyncLaunches.length > 0) {
          logger.info?.("Workflow coordinator launched non-blocking Zotero sync.", {
            trigger,
            launches: autoZoteroSyncLaunches.map((entry) => ({
              projectId: entry.projectId,
              trigger: entry.trigger,
              queueKey: entry.queueKey,
              runId: entry.runId,
              queued: entry.queued,
              zoteroProjectPath: entry.zoteroProjectPath,
            })),
          });
        }
      } catch (error) {
        logger.warn?.("Workflow coordinator pass failed.", {
          trigger,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        inFlightTick = null;
      }
    })();

    return inFlightTick;
  };

  return {
    id: "workflow-background-coordinator",
    async start(ctx: OpenClawPluginServiceContext) {
      const workflowPolicy = plugin.getWorkflowPolicy();
      if (intervalHandle) {
        return;
      }
      if (!workflowPolicy.heartbeatBackgroundChecks || !workflowPolicy.projectsRoot) {
        ctx.logger.debug?.("Workflow coordinator service disabled by policy.", {
          heartbeatBackgroundChecks: workflowPolicy.heartbeatBackgroundChecks,
          projectsRoot: workflowPolicy.projectsRoot,
        });
        return;
      }

      intervalHandle = setInterval(() => {
        void runTick(ctx.logger, "interval");
      }, DEFAULT_WORKFLOW_COORDINATOR_INTERVAL_MS);
      intervalHandle.unref?.();

      ctx.logger.info?.("Workflow coordinator service started.", {
        intervalMs: DEFAULT_WORKFLOW_COORDINATOR_INTERVAL_MS,
        maxProjectsPerTick: DEFAULT_WORKFLOW_COORDINATOR_MAX_PROJECTS,
        projectsRoot: workflowPolicy.projectsRoot,
      });
      void runTick(ctx.logger, "startup");
    },
    async stop(ctx: OpenClawPluginServiceContext) {
      if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
      await inFlightTick;
      ctx.logger.info?.("Workflow coordinator service stopped.");
    },
  };
}

export function registerWorkflowService(plugin: PluginRegistrationContext) {
  if (typeof plugin.api.registerService !== "function") {
    return;
  }
  plugin.api.registerService(createWorkflowCoordinatorService(plugin));
}
