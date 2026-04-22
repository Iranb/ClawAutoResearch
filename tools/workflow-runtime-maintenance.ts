import path from "node:path";
import { readJsonIfExists } from "./workflow-guard-core/fs";
import {
  dispatchWorkflowTaskToAgent,
  type DispatchableWorkflowRole,
} from "./agent-task-dispatch";
import {
  handoffWorkflowTaskToAgent,
  type WorkflowLobsterHandoffConfig,
} from "./lobster-handoff";
import {
  recordWorkflowRuntimeIncident,
  type WorkflowRuntimeIncidentEntry,
} from "./workflow-runtime-incidents.js";
import {
  recoverWorkflowRuntimeState,
  type WorkflowRuntimeRecoveryResult,
} from "./workflow-runtime-recovery.js";
import { refreshExperimentGpuMonitor } from "./workflow-gpu-monitor";
import { evaluateExperimentSearchDecisionForProject } from "./workflow-experiment-decision";
import {
  appendWorkflowRuntimeEvent,
  readWorkflowRuntimeQueueStore,
  readWorkflowRuntimeSessionsStore,
  type WorkflowRuntimeBroadcastEntry,
  type WorkflowRuntimeQueueDispatchPayload,
  type WorkflowRuntimeQueueEntry,
  type WorkflowRuntimeSessionEntry,
  updateWorkflowRuntimeQueueStore,
  updateWorkflowRuntimeSessionsStore,
} from "./workflow-runtime-state.js";
import { resumeWorkflowTransition } from "./workflow-session-orchestrator.js";
import {
  runWorkflowHandoffMaintenancePass,
  type WorkflowHandoffMaintenanceResult,
} from "./workflow-handoff/maintenance";
import {
  findWorkflowHandoffIntent,
  transitionWorkflowHandoffIntent,
} from "./workflow-handoff/handoff-store";
import { routeWorkflowFailure } from "./workflow-handoff/failure-router";
import { evaluateChannelProjectBindingGate } from "./channel-project-bindings";
import { appendWorkflowDiagnosticEvent } from "./workflow-diagnostics.js";
import type { WorkflowExecutionRuntime } from "./workflow-execution-runtime.js";

type RuntimeSubagentApi = WorkflowExecutionRuntime;

type LoggerLike = {
  debug?: (message: string, meta?: Record<string, unknown>) => void;
  info?: (message: string, meta?: Record<string, unknown>) => void;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
  error?: (message: string, meta?: Record<string, unknown>) => void;
};

type WorkflowPolicyLike = {
  lobsterHandoff?: WorkflowLobsterHandoffConfig;
  enableChannelProjectBindings?: boolean;
  projectsRoot?: string;
} | null;

export type WorkflowRuntimeMaintenanceResult = {
  projectId: string | null;
  projectRoot: string;
  recovery: WorkflowRuntimeRecoveryResult;
  replayedQueueKeys: string[];
  exhaustedQueueKeys: string[];
  repairedSessionKeys: string[];
  exhaustedSessionKeys: string[];
  incidents: WorkflowRuntimeIncidentEntry[];
  handoffMaintenance: WorkflowHandoffMaintenanceResult;
  watchdogSummary: {
    queueRepairPending: number;
    sessionRepairPending: number;
    replayedQueueCount: number;
    exhaustedQueueCount: number;
    exhaustedSessionCount: number;
    incidentCount: number;
  };
  experimentMaintenance: {
    attempted: boolean;
    monitorRefreshed: boolean;
    decisionPersisted: boolean;
    decision: string | null;
    recommendation: string | null;
  };
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    const normalized = readString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

function toDispatchableRole(value: unknown): DispatchableWorkflowRole {
  const normalized = readString(value)?.toLowerCase();
  switch (normalized) {
    case "planner":
    case "orchestrator":
    case "coder":
    case "analyzer":
    case "academic_writer":
    case "reviewer":
    case "cross-reviewer":
    case "researcher":
      return normalized;
    default:
      return "researcher";
  }
}

async function updateQueueEntry(
  projectRoot: string,
  queueKey: string,
  updater: (entry: WorkflowRuntimeQueueEntry) => WorkflowRuntimeQueueEntry
): Promise<WorkflowRuntimeQueueEntry | null> {
  let updatedEntry: WorkflowRuntimeQueueEntry | null = null;
  await updateWorkflowRuntimeQueueStore({
    projectRoot,
    updater: (store) => {
      const index = store.entries.findIndex((entry) => entry.queueKey === queueKey);
      if (index < 0) {
        return store.entries;
      }
      const nextEntries = [...store.entries];
      nextEntries[index] = updater(nextEntries[index]);
      updatedEntry = nextEntries[index];
      return nextEntries;
    },
  });
  return updatedEntry;
}

async function updateSessions(
  projectRoot: string,
  updater: (entry: WorkflowRuntimeSessionEntry) => WorkflowRuntimeSessionEntry
): Promise<WorkflowRuntimeSessionEntry[]> {
  let nextEntriesSnapshot: WorkflowRuntimeSessionEntry[] = [];
  await updateWorkflowRuntimeSessionsStore({
    projectRoot,
    updater: (store) => {
      nextEntriesSnapshot = store.entries.map(updater);
      return nextEntriesSnapshot;
    },
  });
  return nextEntriesSnapshot;
}

async function markQueueFailed(params: {
  projectRoot: string;
  projectId: string | null;
  entry: WorkflowRuntimeQueueEntry;
  error: string;
}) {
  return updateQueueEntry(params.projectRoot, params.entry.queueKey, (entry) => ({
    ...entry,
    status: "failed",
    lastAttemptedAt: nowIso(),
    lastCheckedAt: nowIso(),
    lastError: params.error,
  }));
}

async function markLinkedSessionsFailed(params: {
  projectRoot: string;
  queueKey: string;
  error: string;
}) {
  const currentAt = nowIso();
  await updateSessions(params.projectRoot, (entry) => {
    if (entry.queueKey !== params.queueKey) {
      return entry;
    }
    return {
      ...entry,
      status: "failed",
      lastCheckedAt: currentAt,
      lastFinishedAt: entry.lastFinishedAt ?? currentAt,
      lastError: params.error,
    };
  });
}

async function markSessionFailed(params: {
  projectRoot: string;
  sessionKey: string;
  error: string;
}) {
  const currentAt = nowIso();
  await updateSessions(params.projectRoot, (entry) => {
    if (entry.sessionKey !== params.sessionKey) {
      return entry;
    }
    return {
      ...entry,
      status: "failed",
      lastCheckedAt: currentAt,
      lastFinishedAt: entry.lastFinishedAt ?? currentAt,
      lastError: params.error,
    };
  });
}

async function reconcileSupersededRepairSessions(params: {
  projectRoot: string;
  queueKey: string;
  survivorSessionKey: string | null;
}) {
  const currentAt = nowIso();
  await updateSessions(params.projectRoot, (entry) => {
    if (entry.queueKey !== params.queueKey) {
      return entry;
    }
    if (params.survivorSessionKey && entry.sessionKey === params.survivorSessionKey) {
      return entry;
    }
    if (entry.status !== "needs_repair") {
      return entry;
    }
    return {
      ...entry,
      status: "failed",
      lastCheckedAt: currentAt,
      lastFinishedAt: entry.lastFinishedAt ?? currentAt,
      lastError:
        entry.lastError ??
        "Superseded by a newer repaired workflow transition session.",
    };
  });
}

function buildPreferredSessionKeys(
  entry: WorkflowRuntimeQueueEntry,
  dispatchPayload: WorkflowRuntimeQueueDispatchPayload
): string[] {
  return uniqueStrings([
    entry.preferredSessionKey,
    ...dispatchPayload.preferredSessionKeys,
  ]);
}

async function replayQueueEntry(params: {
  entry: WorkflowRuntimeQueueEntry;
  runtimeSubagent?: RuntimeSubagentApi;
  workflowPolicy?: WorkflowPolicyLike;
  logger?: LoggerLike;
}) {
  if (!params.runtimeSubagent) {
    return {
      launched: false,
      error: "Runtime subagent API is unavailable for workflow repair.",
      sessionKey: null,
    };
  }
  const entry = params.entry;
  const dispatchPayload = entry.dispatchPayload;
  const preferredSessionKeys =
    dispatchPayload != null ? buildPreferredSessionKeys(entry, dispatchPayload) : [];
  const resumed = await resumeWorkflowTransition({
    projectRoot: String(entry.projectRoot),
    projectId: entry.projectId,
    queueKey: entry.queueKey,
    spawn: async () => {
      if (entry.entryType === "background_run") {
        const runPayload = entry.runPayload;
        const sessionKey =
          readString(entry.preferredSessionKey) ??
          readString(entry.requesterSessionKey) ??
          `agent:${entry.ownerAgent}:main`;
        if (!runPayload?.message) {
          throw new Error("Background workflow repair is missing a durable run payload.");
        }
        const started = await params.runtimeSubagent!.run({
          sessionKey,
          message: runPayload.message,
          lane: runPayload.lane,
          deliver: runPayload.deliver,
          idempotencyKey:
            runPayload.idempotencyKey ??
            `workflow-repair:${entry.queueKey}:${Date.now()}`,
          extraSystemPrompt: runPayload.extraSystemPrompt ?? undefined,
          projectRoot: entry.projectRoot,
          projectId: entry.projectId,
          ownerAgent: entry.ownerAgent,
          requesterSessionKey: entry.requesterSessionKey,
          messageChannel: entry.messageChannel,
          workspaceDir: entry.projectRoot,
        });
        return {
          runId: started.runId,
          sessionKey,
          sessionId: started.sessionId ?? null,
          runtime:
            started.runtime ??
            params.runtimeSubagent!.runtimeKind ??
            "subagent",
          role: entry.ownerAgent,
          agentId: entry.ownerAgent,
          ownerAgent: entry.ownerAgent,
          parentSessionKey: entry.requesterSessionKey,
          depth: entry.depth,
        };
      }

      if (!dispatchPayload) {
        throw new Error("Workflow repair is missing a durable dispatch payload.");
      }

      const dispatch = dispatchPayload.useWorkflowHandoff
        ? await handoffWorkflowTaskToAgent({
            runtimeSubagent: params.runtimeSubagent,
            workflowPolicy: params.workflowPolicy ?? undefined,
            requesterSessionKey: entry.requesterSessionKey,
            requesterChannel: dispatchPayload.requesterChannel ?? undefined,
            requesterAccountId: dispatchPayload.requesterAccountId ?? undefined,
            preferredSessionKeys,
            fromRole: dispatchPayload.fromRole,
            toRole: toDispatchableRole(dispatchPayload.toRole),
            projectRoot: dispatchPayload.projectRoot,
            projectId: dispatchPayload.projectId,
            stage: dispatchPayload.stage,
            summary: dispatchPayload.summary,
            command: dispatchPayload.command,
            mailboxMessageId: dispatchPayload.mailboxMessageId,
            requireMailboxAcknowledgement:
              dispatchPayload.requireMailboxAcknowledgement,
            extraBody: dispatchPayload.extraBody,
            waitTimeoutMs: dispatchPayload.waitTimeoutMs ?? undefined,
            retryOnTimeout: dispatchPayload.retryOnTimeout,
            enableSpawnFallback: dispatchPayload.enableSpawnFallback,
            autoModeActive: dispatchPayload.autoModeActive,
            logger: params.logger,
          })
        : await dispatchWorkflowTaskToAgent({
            runtimeSubagent: params.runtimeSubagent,
            requesterSessionKey: entry.requesterSessionKey,
            requesterChannel: dispatchPayload.requesterChannel ?? undefined,
            preferredSessionKeys,
            fromRole: dispatchPayload.fromRole,
            toRole: toDispatchableRole(dispatchPayload.toRole),
            projectRoot: dispatchPayload.projectRoot,
            projectId: dispatchPayload.projectId,
            stage: dispatchPayload.stage,
            summary: dispatchPayload.summary,
            command: dispatchPayload.command,
            mailboxMessageId: dispatchPayload.mailboxMessageId,
            requireMailboxAcknowledgement:
              dispatchPayload.requireMailboxAcknowledgement,
            extraBody: dispatchPayload.extraBody,
            waitTimeoutMs: dispatchPayload.waitTimeoutMs ?? undefined,
            retryOnTimeout: dispatchPayload.retryOnTimeout,
            enableSpawnFallback: dispatchPayload.enableSpawnFallback,
          });
      if (!dispatch.dispatched || !dispatch.runId || !dispatch.sessionKey) {
        throw new Error(dispatch.error ?? "Workflow repair dispatch did not start.");
      }
      return {
        runId: dispatch.runId,
        sessionKey: dispatch.sessionKey,
        runtime:
          dispatch.channel === "sessions_spawn" || dispatch.channel === "sessions_send"
            ? params.runtimeSubagent!.runtimeKind ?? "subagent"
            : "legacy_dispatch",
        role: dispatchPayload.toRole,
        agentId: dispatchPayload.toRole,
        ownerAgent: entry.ownerAgent,
        strategy: dispatch.strategy ?? "workflow_dispatch",
        parentSessionKey: entry.requesterSessionKey,
        depth: entry.depth,
      };
    },
  });
  return {
    launched: resumed.launched,
    error: resumed.error,
    sessionKey: resumed.sessionKey,
  };
}

function computeResetAckDeadlineAt(params: {
  fallbackAfterMs: number | null;
}): string | null {
  if (
    typeof params.fallbackAfterMs === "number" &&
    Number.isFinite(params.fallbackAfterMs) &&
    params.fallbackAfterMs > 0
  ) {
    return new Date(Date.now() + Math.floor(params.fallbackAfterMs)).toISOString();
  }
  return null;
}

async function syncQueuedHandoffIntentAfterReplay(params: {
  projectRoot: string;
  queueKey: string;
  sessionKey: string | null;
}): Promise<void> {
  if (!params.queueKey.startsWith("handoff:")) {
    return;
  }
  const intentId = params.queueKey.slice("handoff:".length);
  const intent = await findWorkflowHandoffIntent({
    projectRoot: params.projectRoot,
    intentId,
  });
  if (!intent) {
    return;
  }
  await transitionWorkflowHandoffIntent({
    projectRoot: params.projectRoot,
    intentId,
    toStatus: "dispatched",
    patch: {
      toSessionKey: params.sessionKey ?? intent.toSessionKey,
      deliveryPlan: {
        ...intent.deliveryPlan,
        ackDeadlineAt: computeResetAckDeadlineAt({
          fallbackAfterMs: intent.deliveryPlan.fallbackAfterMs,
        }),
      },
    },
    summary:
      "Runtime maintenance replay dispatched the queued handoff and reset the acknowledgement deadline.",
  });
}

async function recordBroadcastFailures(params: {
  projectRoot: string;
  projectId: string | null;
  failedBroadcasts: WorkflowRuntimeBroadcastEntry[];
}): Promise<WorkflowRuntimeIncidentEntry[]> {
  const incidents: WorkflowRuntimeIncidentEntry[] = [];
  for (const entry of params.failedBroadcasts) {
    incidents.push(
      await recordWorkflowRuntimeIncident({
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        idempotencyKey: `broadcast:${entry.idempotencyKey}`,
        kind: "broadcast_delivery_failed",
        severity: "warning",
        summary: `Workflow runtime broadcast ${entry.status} could not be delivered.`,
        sessionKey: entry.sessionKey,
        error: entry.lastError,
        details: {
          broadcastId: entry.broadcastId,
          stage: entry.stage,
          deliveryStatus: entry.deliveryStatus,
        },
      })
    );
  }
  return incidents;
}

export async function runWorkflowRuntimeMaintenancePass(params: {
  projectRoot: string;
  projectId?: string | null;
  staleSessionAgeMs?: number;
  maxRepairAttempts?: number;
  runtimeSubagent?: RuntimeSubagentApi;
  workflowPolicy?: WorkflowPolicyLike;
  logger?: LoggerLike;
  sendBroadcast?: (entry: WorkflowRuntimeBroadcastEntry) => Promise<{
    runId: string;
    sessionKey?: string | null;
  }>;
}): Promise<WorkflowRuntimeMaintenanceResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const projectId = readString(params.projectId) ?? path.basename(projectRoot);
  const maxRepairAttempts =
    typeof params.maxRepairAttempts === "number" && Number.isFinite(params.maxRepairAttempts)
      ? Math.max(1, Math.floor(params.maxRepairAttempts))
      : 3;
  await appendWorkflowDiagnosticEvent({
    projectRoot,
    projectId,
    component: "runtime_maintenance",
    action: "maintenance_started",
    status: "started",
    summary: "Runtime maintenance pass started.",
    details: {
      maxRepairAttempts,
      staleSessionAgeMs:
        typeof params.staleSessionAgeMs === "number" && Number.isFinite(params.staleSessionAgeMs)
          ? params.staleSessionAgeMs
          : null,
      hasRuntimeSubagent: Boolean(params.runtimeSubagent),
    },
  });

  const recovery = await recoverWorkflowRuntimeState({
    projectRoot,
    projectId,
    staleSessionAgeMs: params.staleSessionAgeMs,
    workflowPolicy: params.workflowPolicy ?? undefined,
    sendBroadcast: params.sendBroadcast,
  });
  const handoffMaintenance = await runWorkflowHandoffMaintenancePass({
    projectRoot,
  });
  const manifest = await readJsonIfExists<Record<string, unknown>>(
    path.join(projectRoot, "PROJECT_MANIFEST.json")
  );
  const currentStage = readString(manifest?.current_stage);
  const paperIngestion =
    manifest?.paper_ingestion &&
    typeof manifest.paper_ingestion === "object" &&
    !Array.isArray(manifest.paper_ingestion)
      ? (manifest.paper_ingestion as Record<string, unknown>)
      : null;
  const retryStatus = readString(
    paperIngestion?.retry_status ?? paperIngestion?.retryStatus
  );
  const retryableFailuresRaw =
    paperIngestion?.retryable_failed_papers ?? paperIngestion?.retryableFailedPapers;
  const retryableFailures: unknown[] = Array.isArray(retryableFailuresRaw)
    ? retryableFailuresRaw
    : [];
  if (
    retryableFailures.length > 0 &&
    ["failed", "terminal", "completed_with_failures", "exhausted"].includes(
      retryStatus ?? ""
    )
  ) {
    await routeWorkflowFailure({
      projectRoot,
      projectId,
      workflowLine: manifest?.workflow_line === "survey" ? "survey" : "experiment",
      stage: readString(manifest?.current_stage),
      originalOwner: readString(manifest?.owner_agent),
      failureKind: "paper_ingestion_failed",
      failureReason: `PaperNexus retry terminal state still has ${retryableFailures.length} retryable failure(s).`,
      verificationRule: "paper_ingestion_retry_terminal",
    });
  }

  const incidents = await recordBroadcastFailures({
    projectRoot,
    projectId,
    failedBroadcasts: recovery.broadcast.failed,
  });

  const queueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  const replayCandidates = queueStore.entries.filter(
    (entry) =>
      entry.status === "needs_repair" ||
      entry.status === "degraded" ||
      (entry.status === "queued" &&
        entry.entryType === "dispatch_task" &&
        entry.queueKey.startsWith("handoff:"))
  );
  const replayedQueueKeys: string[] = [];
  const exhaustedQueueKeys: string[] = [];

  for (const entry of replayCandidates) {
    const bindingGate = await evaluateChannelProjectBindingGate({
      policy: params.workflowPolicy ?? undefined,
      context: {
        sessionKey:
          readString(entry.requesterSessionKey) ??
          readString(entry.preferredSessionKey) ??
          undefined,
        channelKey: readString(entry.channelKey) ?? undefined,
        messageChannel: readString(entry.messageChannel) ?? undefined,
      },
      projectRoot,
      projectId,
      sessionKey:
        readString(entry.requesterSessionKey) ??
        readString(entry.preferredSessionKey),
      allowSessionProjectFallback: true,
      allowSessionFallbackOnBindingMismatch: false,
    });
    if (!bindingGate.allowed) {
      const error = [
        `Workflow transition ${entry.queueKey} was superseded by the current channel binding gate.`,
        `gate_reason=${bindingGate.reason}`,
        bindingGate.currentBinding?.projectId
          ? `bound_project=${bindingGate.currentBinding.projectId}`
          : null,
        bindingGate.currentBinding?.projectRoot
          ? `bound_root=${bindingGate.currentBinding.projectRoot}`
          : null,
      ]
        .filter(Boolean)
        .join(" ");
      await markQueueFailed({
        projectRoot,
        projectId,
        entry,
        error,
      });
      await markLinkedSessionsFailed({
        projectRoot,
        queueKey: entry.queueKey,
        error,
      });
      exhaustedQueueKeys.push(entry.queueKey);
      incidents.push(
        await recordWorkflowRuntimeIncident({
          projectRoot,
          projectId,
          idempotencyKey: `binding-gate:${entry.queueKey}`,
          kind: "binding_gate_mismatch",
          severity: "warning",
          summary:
            "Workflow repair replay was suppressed because the current channel binding points elsewhere.",
          queueKey: entry.queueKey,
          sessionKey: entry.requesterSessionKey,
          error,
          details: {
            gateReason: bindingGate.reason,
            expectedProjectRoot: projectRoot,
            boundProjectRoot: bindingGate.currentBinding?.projectRoot ?? null,
            boundProjectId: bindingGate.currentBinding?.projectId ?? null,
          },
        })
      );
      continue;
    }

    if (entry.attemptCount >= maxRepairAttempts) {
      const error =
        entry.lastError ??
        `Workflow transition exhausted the repair budget (${maxRepairAttempts}).`;
      await markQueueFailed({
        projectRoot,
        projectId,
        entry,
        error,
      });
      await markLinkedSessionsFailed({
        projectRoot,
        queueKey: entry.queueKey,
        error,
      });
      exhaustedQueueKeys.push(entry.queueKey);
      incidents.push(
        await recordWorkflowRuntimeIncident({
          projectRoot,
          projectId,
          idempotencyKey: `repair-exhausted:${entry.queueKey}`,
          kind: "repair_exhausted",
          severity: "error",
          summary: `Workflow transition ${entry.queueKey} exhausted the repair budget.`,
          queueKey: entry.queueKey,
          error,
          details: {
            attemptCount: entry.attemptCount,
            maxRepairAttempts,
            source: entry.source,
            kind: entry.kind,
          },
        })
      );
      continue;
    }

    const replay = await replayQueueEntry({
      entry,
      runtimeSubagent: params.runtimeSubagent,
      workflowPolicy: params.workflowPolicy,
      logger: params.logger,
    });
    if (replay.launched) {
      replayedQueueKeys.push(entry.queueKey);
      await syncQueuedHandoffIntentAfterReplay({
        projectRoot,
        queueKey: entry.queueKey,
        sessionKey: replay.sessionKey,
      });
      await reconcileSupersededRepairSessions({
        projectRoot,
        queueKey: entry.queueKey,
        survivorSessionKey: replay.sessionKey,
      });
      continue;
    }

    const refreshedStore = await readWorkflowRuntimeQueueStore(projectRoot);
    const refreshedEntry =
      refreshedStore.entries.find((candidate) => candidate.queueKey === entry.queueKey) ?? entry;
    const exhausted = refreshedEntry.attemptCount >= maxRepairAttempts;
    const error =
      readString(replay.error) ??
      refreshedEntry.lastError ??
      "Workflow runtime repair replay failed.";
    if (exhausted) {
      await markQueueFailed({
        projectRoot,
        projectId,
        entry: refreshedEntry,
        error,
      });
      await markLinkedSessionsFailed({
        projectRoot,
        queueKey: refreshedEntry.queueKey,
        error,
      });
      exhaustedQueueKeys.push(refreshedEntry.queueKey);
      incidents.push(
        await recordWorkflowRuntimeIncident({
          projectRoot,
          projectId,
          idempotencyKey: `repair-exhausted:${refreshedEntry.queueKey}`,
          kind: "repair_exhausted",
          severity: "error",
          summary: `Workflow transition ${refreshedEntry.queueKey} exhausted the repair budget.`,
          queueKey: refreshedEntry.queueKey,
          error,
          details: {
            attemptCount: refreshedEntry.attemptCount,
            maxRepairAttempts,
            source: refreshedEntry.source,
            kind: refreshedEntry.kind,
          },
        })
      );
    } else {
      await updateQueueEntry(projectRoot, refreshedEntry.queueKey, (candidate) => ({
        ...candidate,
        status: "needs_repair",
        lastCheckedAt: nowIso(),
        lastError: error,
      }));
    }
  }

  let experimentMaintenance: WorkflowRuntimeMaintenanceResult["experimentMaintenance"] = {
    attempted: false,
    monitorRefreshed: false,
    decisionPersisted: false,
    decision: null,
    recommendation: null,
  };
  if (currentStage === "experiment") {
    experimentMaintenance.attempted = true;
    try {
      const refreshed = await refreshExperimentGpuMonitor({
        projectRoot,
      });
      experimentMaintenance.monitorRefreshed = true;
      experimentMaintenance.recommendation = refreshed.state.recommendation;
    } catch (error) {
      params.logger?.warn?.("Experiment maintenance could not refresh GPU monitor.", {
        projectRoot,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    try {
      const decision = await evaluateExperimentSearchDecisionForProject({
        projectRoot,
        persist: true,
      });
      experimentMaintenance.decisionPersisted = true;
      experimentMaintenance.decision = decision.summary.decision;
    } catch (error) {
      params.logger?.warn?.("Experiment maintenance could not persist decision state.", {
        projectRoot,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const sessionsStore = await readWorkflowRuntimeSessionsStore(projectRoot);
  const queueStoreAfterReplay = await readWorkflowRuntimeQueueStore(projectRoot);
  const queueByKey = new Map(
    queueStoreAfterReplay.entries.map((entry) => [entry.queueKey, entry] as const)
  );
  const exhaustedSessionKeys: string[] = [];

  for (const session of sessionsStore.entries) {
    if (session.status !== "needs_repair") {
      continue;
    }
    const queueKey = readString(session.queueKey);
    if (!queueKey) {
      const error =
        session.lastError ??
        "Workflow session has no durable queue linkage and cannot be repaired.";
      await markSessionFailed({
        projectRoot,
        sessionKey: session.sessionKey,
        error,
      });
      exhaustedSessionKeys.push(session.sessionKey);
      incidents.push(
        await recordWorkflowRuntimeIncident({
          projectRoot,
          projectId,
          idempotencyKey: `orphan-session:${session.sessionKey}`,
          kind: "repair_orphan_session",
          severity: "error",
          summary: `Workflow session ${session.sessionKey} became orphaned without a queue link.`,
          sessionKey: session.sessionKey,
          error,
          details: {
            ownerAgent: session.ownerAgent,
            runtime: session.runtime,
          },
        })
      );
      continue;
    }
    const queueEntry = queueByKey.get(queueKey) ?? null;
    if (!queueEntry) {
      const error =
        session.lastError ??
        `Workflow session references missing transition ${queueKey}.`;
      await markSessionFailed({
        projectRoot,
        sessionKey: session.sessionKey,
        error,
      });
      exhaustedSessionKeys.push(session.sessionKey);
      incidents.push(
        await recordWorkflowRuntimeIncident({
          projectRoot,
          projectId,
          idempotencyKey: `orphan-session:${session.sessionKey}:${queueKey}`,
          kind: "repair_orphan_session",
          severity: "error",
          summary: `Workflow session ${session.sessionKey} references missing transition ${queueKey}.`,
          queueKey,
          sessionKey: session.sessionKey,
          error,
        })
      );
      continue;
    }
    if (queueEntry.status === "failed") {
      await markSessionFailed({
        projectRoot,
        sessionKey: session.sessionKey,
        error:
          queueEntry.lastError ??
          session.lastError ??
          `Workflow transition ${queueKey} failed during repair.`,
      });
      exhaustedSessionKeys.push(session.sessionKey);
    }
  }

  const repairedSessionKeys = (
    await readWorkflowRuntimeSessionsStore(projectRoot)
  ).entries
    .filter((entry) => replayedQueueKeys.includes(entry.queueKey ?? "") && entry.status === "active")
    .map((entry) => entry.sessionKey);

  const finalQueueStore = await readWorkflowRuntimeQueueStore(projectRoot);
  const finalSessionsStore = await readWorkflowRuntimeSessionsStore(projectRoot);
  const watchdogSummary = {
    queueRepairPending: finalQueueStore.entries.filter((entry) =>
      entry.status === "needs_repair" || entry.status === "degraded"
    ).length,
    sessionRepairPending: finalSessionsStore.entries.filter(
      (entry) => entry.status === "needs_repair"
    ).length,
    replayedQueueCount: replayedQueueKeys.length,
    exhaustedQueueCount: exhaustedQueueKeys.length,
    exhaustedSessionCount: exhaustedSessionKeys.length,
    incidentCount: incidents.length,
  };

  await appendWorkflowRuntimeEvent({
    projectRoot,
    projectId,
    kind: "runtime_watchdog_summary",
    summary:
      `Runtime maintenance completed with ${watchdogSummary.replayedQueueCount} replay(s), ` +
      `${watchdogSummary.exhaustedQueueCount} exhausted queue(s), and ` +
      `${watchdogSummary.sessionRepairPending} pending session repair(s).`,
    details: {
      replayedQueueKeys,
      exhaustedQueueKeys,
      exhaustedSessionKeys,
      handoffMaintenance,
      queueRepairPending: watchdogSummary.queueRepairPending,
      sessionRepairPending: watchdogSummary.sessionRepairPending,
      incidentCount: watchdogSummary.incidentCount,
      experimentMaintenance,
    },
  });
  await appendWorkflowDiagnosticEvent({
    projectRoot,
    projectId,
    component: "runtime_maintenance",
    action: "maintenance_completed",
    status:
      watchdogSummary.queueRepairPending > 0 || watchdogSummary.sessionRepairPending > 0
        ? "waiting"
        : incidents.length > 0 || exhaustedQueueKeys.length > 0 || exhaustedSessionKeys.length > 0
          ? "degraded"
          : "completed",
    stage: currentStage,
    owner: readString(manifest?.owner_agent),
    summary: "Runtime maintenance pass completed.",
    details: {
      replayedQueueKeys,
      exhaustedQueueKeys,
      exhaustedSessionKeys,
      repairedSessionKeys,
      handoffMaintenance,
      watchdogSummary,
      experimentMaintenance,
    },
  });

  return {
    projectId,
    projectRoot,
    recovery,
    replayedQueueKeys,
    exhaustedQueueKeys,
    repairedSessionKeys,
    exhaustedSessionKeys,
    incidents,
    handoffMaintenance,
    watchdogSummary,
    experimentMaintenance,
  };
}
