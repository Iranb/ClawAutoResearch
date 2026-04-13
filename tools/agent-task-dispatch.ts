import { randomUUID } from "node:crypto";
import {
  buildWorkflowSubagentSessionKey,
  derivePapernexusTaskLabel,
  looksLikePapernexusHeavyCommand,
} from "./workflow-subagent-sessions";
import {
  ensureWorkflowDispatchMailboxMessage,
  waitForWorkflowMailboxAcknowledgement,
} from "./workflow-handoff-runtime";
import { isExecApprovalRequiredError } from "./workflow-execution/exec-budget";
import { materializeExecPacketIfNeeded } from "./workflow-execution/exec-packet";
import {
  downgradeWorkflowAgentCapability,
  readWorkflowAgentCapabilityStore,
  selectWorkflowCapableSession,
} from "./workflow-handoff/agent-capabilities";
import { readWorkflowRuntimeSessionsStore } from "./workflow-runtime-state";

export type DispatchableWorkflowRole =
  | "researcher"
  | "planner"
  | "orchestrator"
  | "coder"
  | "analyzer"
  | "academic_writer"
  | "reviewer"
  | "cross-reviewer";

type RuntimeSubagentApi = {
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
  deleteSession?: (params: {
    sessionKey: string;
    deleteTranscript?: boolean;
  }) => Promise<void>;
};

export type WorkflowTaskDispatchAttempt = {
  strategy: "direct_session" | "alternate_session" | "spawn_fallback";
  sessionKey: string;
  runId: string | null;
  waitStatus: "ok" | "error" | "timeout" | null;
  dispatched: boolean;
  acceptedByMailbox: boolean;
  acceptedByTranscript: boolean;
  error: string | null;
};

export type WorkflowTaskDispatchResult = {
  dispatched: boolean;
  sessionKey: string | null;
  runId: string | null;
  waitStatus: "ok" | "error" | "timeout" | null;
  channel: "sessions_send" | "sessions_spawn" | null;
  strategy: "direct_session" | "alternate_session" | "spawn_fallback" | null;
  attempts: WorkflowTaskDispatchAttempt[];
  fallbackSpawned: boolean;
  acknowledgedByMailbox: boolean;
  error: string | null;
};

function toAgentId(role: DispatchableWorkflowRole): string {
  return role;
}

export function deriveAgentSessionKeyForRole(params: {
  requesterSessionKey?: string;
  targetRole: DispatchableWorkflowRole;
}): string {
  const requesterSessionKey = params.requesterSessionKey?.trim();
  const targetAgentId = toAgentId(params.targetRole);
  if (requesterSessionKey?.startsWith("agent:")) {
    const parts = requesterSessionKey.split(":");
    if (parts.length >= 2) {
      parts[1] = targetAgentId;
      return parts.join(":");
    }
  }
  return `agent:${targetAgentId}:main`;
}

function stripThreadSuffix(sessionKey?: string): string | null {
  const raw = sessionKey?.trim();
  if (!raw) {
    return null;
  }
  const normalized = raw.toLowerCase();
  const markers = [":thread:", ":topic:"];
  let splitAt = -1;
  for (const marker of markers) {
    const idx = normalized.lastIndexOf(marker);
    if (idx > splitAt) {
      splitAt = idx;
    }
  }
  if (splitAt <= 0) {
    return null;
  }
  const parent = raw.slice(0, splitAt).trim();
  return parent || null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  return ordered;
}

export function deriveWorkflowDispatchSessionCandidates(params: {
  requesterSessionKey?: string;
  targetRole: DispatchableWorkflowRole;
}): string[] {
  const primary = deriveAgentSessionKeyForRole(params);
  const parentSessionKey = stripThreadSuffix(params.requesterSessionKey);
  const parentCandidate = parentSessionKey
    ? deriveAgentSessionKeyForRole({
        requesterSessionKey: parentSessionKey,
        targetRole: params.targetRole,
      })
    : null;
  const mainCandidate = `agent:${toAgentId(params.targetRole)}:main`;
  return uniqueStrings([primary, parentCandidate, mainCandidate]);
}

export function buildSpawnFallbackSessionKey(targetRole: DispatchableWorkflowRole): string {
  return `agent:${toAgentId(targetRole)}:subagent:${randomUUID()}`;
}

function resolveRuntimeSessionStatus(params: {
  runtimeSessionStatuses: Map<string, string>;
  sessionKey: string;
}): string | null {
  return params.runtimeSessionStatuses.get(params.sessionKey) ?? null;
}

export function buildWorkflowDispatchMessage(params: {
  projectRoot: string;
  projectId?: string | null;
  fromRole?: string | null;
  toRole: DispatchableWorkflowRole;
  stage?: string | null;
  summary: string;
  command?: string | null;
  mailboxMessageId?: string | null;
  extraBody?: string | null;
}): string {
  return [
    `Workflow task dispatch from ${params.fromRole ?? "workflow"} to ${params.toRole}.`,
    params.projectId ? `Project ID: ${params.projectId}` : null,
    `Project root: ${params.projectRoot}`,
    params.stage ? `Current stage: ${params.stage}` : null,
    `Task summary: ${params.summary}`,
    params.command ? `Immediate command: ${params.command}` : null,
    params.mailboxMessageId
      ? `Mailbox message id: ${params.mailboxMessageId}. Read and acknowledge it if present.`
      : "Read workflow context and mailbox first if a handoff exists.",
    params.extraBody?.trim() ? params.extraBody.trim() : null,
    "When you finish this stage and need to wake the next owner in-channel, use exactly this block:",
    `[STATUS] ${(params.stage ?? "workflow").replace(/_/g, " ")} complete`,
    `[HANDOFF] next owner: ${params.toRole}`,
    "[ARTIFACTS] <durable files, packets, manifests, or reports you updated>",
    `[NEXT] ${params.command ?? "<one immediate next action>"}`,
    `Target owner label: [${params.toRole}]. Avoid raw @mentions inside workflow dispatch payloads.`,
    "Reply style after receiving a handoff: acknowledge with plain text or a role label, do not repeat raw @mentions, and only use mailbox-aware workflow handoff paths for follow-up routing.",
    "Then execute the assigned stage work, update durable state, and avoid decorative @mentions.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function getMessageCount(
  runtimeSubagent: RuntimeSubagentApi | undefined,
  sessionKey: string
): Promise<number | null> {
  if (!runtimeSubagent?.getSessionMessages) {
    return null;
  }
  try {
    const result = await runtimeSubagent.getSessionMessages({
      sessionKey,
      limit: 16,
    });
    return Array.isArray(result?.messages) ? result.messages.length : 0;
  } catch {
    return null;
  }
}

async function runSingleDispatchAttempt(params: {
  runtimeSubagent: RuntimeSubagentApi;
  sessionKey: string;
  strategy: WorkflowTaskDispatchAttempt["strategy"];
  message: string;
  requesterSessionKey?: string;
  requesterChannel?: string;
  projectRoot: string;
  mailboxMessageId?: string | null;
  requireMailboxAcknowledgement?: boolean;
  waitTimeoutMs?: number;
  retryOnTimeout?: boolean;
  idempotencyKey: string;
}): Promise<{
  attempt: WorkflowTaskDispatchAttempt;
  accepted: boolean;
}> {
  const beforeCount = await getMessageCount(params.runtimeSubagent, params.sessionKey);

  try {
    const started = await params.runtimeSubagent.run({
      sessionKey: params.sessionKey,
      message: params.message,
      lane: "nested",
      deliver: false,
      idempotencyKey: params.idempotencyKey,
      extraSystemPrompt: [
        "Workflow agent-to-agent task dispatch.",
        params.requesterSessionKey
          ? `Requester session: ${params.requesterSessionKey}.`
          : null,
        params.requesterChannel ? `Requester channel: ${params.requesterChannel}.` : null,
        `Target session: ${params.sessionKey}.`,
        params.strategy === "spawn_fallback"
          ? "This is a spawned fallback session because direct workflow delivery did not confirm."
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
    });

    const mailboxWaitTimeoutMs =
      typeof params.waitTimeoutMs === "number" && params.waitTimeoutMs > 0
        ? params.waitTimeoutMs
        : 5_000;
    if (params.mailboxMessageId && params.projectRoot) {
      const mailboxWait = await waitForWorkflowMailboxAcknowledgement({
        projectRoot: params.projectRoot,
        messageId: params.mailboxMessageId,
        timeoutMs: params.runtimeSubagent.waitForRun
          ? mailboxWaitTimeoutMs
          : Math.min(mailboxWaitTimeoutMs, 500),
      });
      if (mailboxWait.acknowledged) {
        return {
          accepted: true,
          attempt: {
            strategy: params.strategy,
            sessionKey: params.sessionKey,
            runId: started.runId,
            waitStatus: "ok",
            dispatched: true,
            acceptedByMailbox: true,
            acceptedByTranscript: false,
            error: null,
          },
        };
      }
    }

    if (
      typeof params.waitTimeoutMs === "number" &&
      params.waitTimeoutMs > 0 &&
      params.runtimeSubagent.waitForRun
    ) {
      const waited = await params.runtimeSubagent.waitForRun({
        runId: started.runId,
        timeoutMs: params.waitTimeoutMs,
      });
      if (waited.status === "ok") {
        if (params.requireMailboxAcknowledgement === true && params.mailboxMessageId) {
          return {
            accepted: false,
            attempt: {
              strategy: params.strategy,
              sessionKey: params.sessionKey,
              runId: started.runId,
              waitStatus: waited.status,
              dispatched: false,
              acceptedByMailbox: false,
              acceptedByTranscript: false,
              error: "workflow mailbox handoff was not acknowledged before the dispatch timeout",
            },
          };
        }
        return {
          accepted: true,
          attempt: {
            strategy: params.strategy,
            sessionKey: params.sessionKey,
            runId: started.runId,
            waitStatus: waited.status,
            dispatched: true,
            acceptedByMailbox: false,
            acceptedByTranscript: false,
            error: null,
          },
        };
      }
      if (waited.status === "timeout") {
        const afterCount = await getMessageCount(params.runtimeSubagent, params.sessionKey);
        const acceptedByTranscript =
          beforeCount != null && afterCount != null && afterCount > beforeCount;
        const accepted =
          params.requireMailboxAcknowledgement === true && params.mailboxMessageId
            ? false
            : acceptedByTranscript || params.retryOnTimeout !== true;
        return {
          accepted,
          attempt: {
            strategy: params.strategy,
            sessionKey: params.sessionKey,
            runId: started.runId,
            waitStatus: waited.status,
            dispatched: accepted,
            acceptedByMailbox: false,
            acceptedByTranscript,
            error:
              accepted || acceptedByTranscript
                ? null
                : "agent dispatch timed out before the target transcript advanced",
          },
        };
      }
      return {
        accepted: false,
        attempt: {
          strategy: params.strategy,
          sessionKey: params.sessionKey,
          runId: started.runId,
          waitStatus: waited.status,
          dispatched: false,
          acceptedByMailbox: false,
          acceptedByTranscript: false,
          error: waited.error ?? "agent dispatch failed",
        },
      };
    }

    if (params.requireMailboxAcknowledgement === true && params.mailboxMessageId) {
      return {
        accepted: false,
        attempt: {
          strategy: params.strategy,
          sessionKey: params.sessionKey,
          runId: started.runId,
          waitStatus: null,
          dispatched: false,
          acceptedByMailbox: false,
          acceptedByTranscript: false,
          error: "workflow mailbox handoff was not acknowledged before returning control",
        },
      };
    }
    return {
      accepted: true,
      attempt: {
        strategy: params.strategy,
        sessionKey: params.sessionKey,
        runId: started.runId,
        waitStatus: null,
        dispatched: true,
        acceptedByMailbox: false,
        acceptedByTranscript: false,
        error: null,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (/tool.+unavailable|unknown tool|not available|permission denied/i.test(errorMessage)) {
      await downgradeWorkflowAgentCapability({
        projectRoot: params.projectRoot,
        sessionKey: params.sessionKey,
        reason: errorMessage,
      }).catch(() => null);
    }
    return {
      accepted: false,
      attempt: {
        strategy: params.strategy,
        sessionKey: params.sessionKey,
        runId: null,
        waitStatus: null,
        dispatched: false,
        acceptedByMailbox: false,
        acceptedByTranscript: false,
        error: isExecApprovalRequiredError(error)
          ? `exec_packet_required: ${errorMessage}`
          : errorMessage,
      },
    };
  }
}

export async function dispatchWorkflowTaskToAgent(params: {
  runtimeSubagent?: RuntimeSubagentApi;
  requesterSessionKey?: string;
  requesterChannel?: string;
  preferredSessionKeys?: string[] | null;
  fromRole?: string | null;
  toRole: DispatchableWorkflowRole;
  projectRoot: string;
  projectId?: string | null;
  stage?: string | null;
  summary: string;
  command?: string | null;
  mailboxMessageId?: string | null;
  requireMailboxAcknowledgement?: boolean;
  extraBody?: string | null;
  waitTimeoutMs?: number;
  retryOnTimeout?: boolean;
  enableSpawnFallback?: boolean;
}): Promise<WorkflowTaskDispatchResult> {
  const runtimeSubagent = params.runtimeSubagent;
  if (!runtimeSubagent) {
    return {
      dispatched: false,
      sessionKey: null,
      runId: null,
      waitStatus: null,
      channel: null,
      strategy: null,
      attempts: [],
      fallbackSpawned: false,
      acknowledgedByMailbox: false,
      error: "Plugin runtime subagent API is unavailable.",
    };
  }
  const requireMailboxAcknowledgement =
    params.requireMailboxAcknowledgement !== false;
  const execPayload = await materializeExecPacketIfNeeded({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    stage: params.stage,
    ownerRole: params.toRole,
    commandText: params.command,
    extraBody: params.extraBody,
    budgetKind: "dispatch_command",
  });

  const mailboxMessageId = await ensureWorkflowDispatchMailboxMessage({
    projectRoot: params.projectRoot,
    fromAgent: params.fromRole,
    toAgent: params.toRole,
    projectId: params.projectId,
    stage: params.stage,
    summary: params.summary,
    command: execPayload.commandForDispatch || params.command,
    extraBody: execPayload.extraBodyForDispatch,
    existingMessageId: params.mailboxMessageId,
  });

  const message = buildWorkflowDispatchMessage({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    fromRole: params.fromRole,
    toRole: params.toRole,
    stage: params.stage,
    summary: params.summary,
    command: execPayload.commandForDispatch || params.command,
    mailboxMessageId,
    extraBody: execPayload.extraBodyForDispatch,
  });
  const attempts: WorkflowTaskDispatchAttempt[] = [];
  const dispatchBatchId = randomUUID();
  const preferredCandidates = Array.isArray(params.preferredSessionKeys)
    ? uniqueStrings(params.preferredSessionKeys)
    : [];
  const capabilityStore = await readWorkflowAgentCapabilityStore(params.projectRoot).catch(
    () => null
  );
  const roleCapabilityRecords =
    capabilityStore?.records.filter(
      (entry) => entry.role === params.toRole || entry.agentId === params.toRole
    ) ?? [];
  const capableSession = await selectWorkflowCapableSession({
    projectRoot: params.projectRoot,
    role: params.toRole,
    requiresResearchWorkflow: true,
  }).catch(() => null);
  const dedicatedPapernexusSessionKey =
    preferredCandidates.length === 0 &&
    looksLikePapernexusHeavyCommand(params.command ?? params.summary)
      ? buildWorkflowSubagentSessionKey({
          parentSessionKey: deriveAgentSessionKeyForRole({
            requesterSessionKey: params.requesterSessionKey,
            targetRole: params.toRole,
          }),
          purpose: "papernexus-skill",
          segments: [derivePapernexusTaskLabel(params.command ?? params.summary)],
        })
      : null;
  const candidates =
    capableSession
      ? uniqueStrings([capableSession.sessionKey, ...preferredCandidates])
      : roleCapabilityRecords.length > 0
        ? []
    : preferredCandidates.length > 0
      ? preferredCandidates
      : dedicatedPapernexusSessionKey
        ? [dedicatedPapernexusSessionKey]
      : deriveWorkflowDispatchSessionCandidates({
          requesterSessionKey: params.requesterSessionKey,
          targetRole: params.toRole,
        });
  const runtimeSessionsStore = await readWorkflowRuntimeSessionsStore(params.projectRoot).catch(
    () => null
  );
  const runtimeSessionStatuses = new Map<string, string>(
    (runtimeSessionsStore?.entries ?? []).map((entry) => [entry.sessionKey, entry.status])
  );
  const canonicalMainSessionKey = deriveAgentSessionKeyForRole({
    requesterSessionKey: params.requesterSessionKey,
    targetRole: params.toRole,
  });

  for (const [index, sessionKey] of candidates.entries()) {
    const runtimeStatus = resolveRuntimeSessionStatus({
      runtimeSessionStatuses,
      sessionKey,
    });
    if (runtimeStatus === "failed" || runtimeStatus === "completed") {
      attempts.push({
        strategy: index === 0 ? "direct_session" : "alternate_session",
        sessionKey,
        runId: null,
        waitStatus: null,
        dispatched: false,
        acceptedByMailbox: false,
        acceptedByTranscript: false,
        error: `session_liveness_probe:${runtimeStatus}`,
      });
      continue;
    }
    if (
      index > 0 &&
      sessionKey !== canonicalMainSessionKey &&
      runtimeStatus == null &&
      runtimeSubagent.getSessionMessages
    ) {
      const candidateMessageCount = await getMessageCount(runtimeSubagent, sessionKey);
      if (candidateMessageCount === 0) {
        attempts.push({
          strategy: "alternate_session",
          sessionKey,
          runId: null,
          waitStatus: null,
          dispatched: false,
          acceptedByMailbox: false,
          acceptedByTranscript: false,
          error: "session_liveness_probe:no_messages",
        });
        continue;
      }
    }
    const attemptResult = await runSingleDispatchAttempt({
      runtimeSubagent,
      sessionKey,
      strategy: index === 0 ? "direct_session" : "alternate_session",
      message,
      requesterSessionKey: params.requesterSessionKey,
      requesterChannel: params.requesterChannel,
      projectRoot: params.projectRoot,
      mailboxMessageId,
      requireMailboxAcknowledgement,
      waitTimeoutMs: params.waitTimeoutMs,
      retryOnTimeout: params.retryOnTimeout,
      idempotencyKey: `${dispatchBatchId}:direct:${index}`,
    });
    attempts.push(attemptResult.attempt);
    if (attemptResult.accepted) {
      return {
        dispatched: true,
        sessionKey,
        runId: attemptResult.attempt.runId,
        waitStatus: attemptResult.attempt.waitStatus,
        channel: "sessions_send",
        strategy: attemptResult.attempt.strategy,
        attempts,
        fallbackSpawned: false,
        acknowledgedByMailbox: attemptResult.attempt.acceptedByMailbox,
        error: null,
      };
    }
  }

  if (params.enableSpawnFallback !== false) {
    const fallbackSessionKey = buildSpawnFallbackSessionKey(params.toRole);
    const attemptResult = await runSingleDispatchAttempt({
      runtimeSubagent,
      sessionKey: fallbackSessionKey,
      strategy: "spawn_fallback",
      message,
      requesterSessionKey: params.requesterSessionKey,
      requesterChannel: params.requesterChannel,
      projectRoot: params.projectRoot,
      mailboxMessageId,
      requireMailboxAcknowledgement,
      waitTimeoutMs: params.waitTimeoutMs,
      retryOnTimeout: params.retryOnTimeout,
      idempotencyKey: `${dispatchBatchId}:spawn`,
    });
    attempts.push(attemptResult.attempt);
    if (attemptResult.accepted) {
      return {
        dispatched: true,
        sessionKey: fallbackSessionKey,
        runId: attemptResult.attempt.runId,
        waitStatus: attemptResult.attempt.waitStatus,
        channel: "sessions_spawn",
        strategy: attemptResult.attempt.strategy,
        attempts,
        fallbackSpawned: true,
        acknowledgedByMailbox: attemptResult.attempt.acceptedByMailbox,
        error: null,
      };
    }
    if (!attemptResult.attempt.runId && runtimeSubagent.deleteSession) {
      try {
        await runtimeSubagent.deleteSession({
          sessionKey: fallbackSessionKey,
          deleteTranscript: true,
        });
      } catch {
        // Best-effort cleanup only.
      }
    }
  }

  const lastAttempt = attempts.at(-1) ?? null;
  return {
    dispatched: false,
    sessionKey: lastAttempt?.sessionKey ?? null,
    runId: lastAttempt?.runId ?? null,
    waitStatus: lastAttempt?.waitStatus ?? null,
    channel: null,
    strategy: lastAttempt?.strategy ?? null,
    attempts,
    fallbackSpawned: attempts.some((attempt) => attempt.strategy === "spawn_fallback"),
    acknowledgedByMailbox: attempts.some((attempt) => attempt.acceptedByMailbox),
    error: lastAttempt?.error ?? "Workflow agent dispatch failed.",
  };
}
