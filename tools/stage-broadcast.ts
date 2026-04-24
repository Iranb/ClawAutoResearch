import {
  markWorkflowBroadcastEvent,
  recordWorkflowBroadcastEvent,
} from "./workflow-session-orchestrator.js";
import {
  readWorkflowBroadcastOutboxStore,
  writeWorkflowBroadcastOutboxStore,
} from "./workflow-runtime-state.js";
import { applyWorkflowBroadcastBudget } from "./workflow-handoff/broadcast-budget";
import { recordWorkflowRuntimeIncident } from "./workflow-runtime-incidents.js";
import {
  evaluateChannelProjectBindingGate,
  type ChannelProjectBindingPolicy,
} from "./channel-project-bindings";
import { isWorkflowNotificationOnlySessionKey } from "./workflow-message-channels.js";

export type StageBroadcastRuntime = {
  run: (params: {
    sessionKey: string;
    message: string;
    lane?: string;
    deliver?: boolean;
    idempotencyKey?: string;
    extraSystemPrompt?: string;
  }) => Promise<{ runId: string }>;
};

export type StageBroadcastAction = {
  kind: string;
  owner: string | null;
  stage: string | null;
  summary: string;
  command: string | null;
  mailboxMessageId?: string | null;
  cooldownRemainingSeconds?: number | null;
  blocking: boolean;
};

export type StageBroadcastDispatch = {
  dispatched?: boolean;
  blockedByCooldown?: boolean;
  cooldownRemainingSeconds?: number | null;
  owner?: string | null;
  channel?: string | null;
  strategy?: string | null;
};

export type StageBroadcastResult = {
  broadcasted: boolean;
  reasonSkipped: string | null;
  runId: string | null;
  sessionKey: string | null;
  idempotencyKey: string | null;
};

export type WorkflowStatusBroadcastStatus =
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

export type WorkflowStatusBroadcastResult = {
  broadcasted: boolean;
  reasonSkipped: string | null;
  runId: string | null;
  sessionKey: string | null;
  idempotencyKey: string | null;
};

async function maybeSuppressBindingMismatchedBroadcast(params: {
  bindingPolicy?: ChannelProjectBindingPolicy;
  sessionKey?: string | null;
  projectId: string | null;
  projectRoot: string | null;
  idempotencyKey: string;
  broadcastId: string;
  status: WorkflowStatusBroadcastStatus;
  stage: string | null;
  summary: string;
}): Promise<{
  suppressed: boolean;
  reason: string | null;
}> {
  if (!params.projectRoot || !params.bindingPolicy || !params.sessionKey) {
    return { suppressed: false, reason: null };
  }
  if (isWorkflowNotificationOnlySessionKey(params.sessionKey)) {
    return { suppressed: false, reason: null };
  }
  const gate = await evaluateChannelProjectBindingGate({
    policy: params.bindingPolicy,
    context: {
      sessionKey: params.sessionKey,
    },
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    sessionKey: params.sessionKey,
    allowSessionProjectFallback: false,
  });
  if (gate.allowed) {
    return { suppressed: false, reason: null };
  }
  const mismatchMessage = [
    `Suppressed stale workflow broadcast because the current channel binding no longer matches ${params.projectId ?? "the project"}.`,
    `gate_reason=${gate.reason}`,
    gate.currentBinding?.projectId
      ? `bound_project=${gate.currentBinding.projectId}`
      : null,
    gate.currentBinding?.projectRoot
      ? `bound_root=${gate.currentBinding.projectRoot}`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  const recorded = await recordWorkflowBroadcastEvent({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    broadcastId: params.broadcastId,
    idempotencyKey: params.idempotencyKey,
    sessionKey: params.sessionKey,
    status: params.status,
    stage: params.stage,
    summary: params.summary,
    deliveryStatus: "superseded",
    lastError: mismatchMessage,
  });
  if (!recorded.created) {
    await markWorkflowBroadcastEvent({
      projectRoot: params.projectRoot,
      idempotencyKey: params.idempotencyKey,
      deliveryStatus: "superseded",
      runError: mismatchMessage,
      lastAttemptedAt: new Date().toISOString(),
    });
  }
  return { suppressed: true, reason: gate.reason };
}

function roleToMention(role: string | null | undefined): string | null {
  if (!role) {
    return null;
  }
  const normalized = role.trim().toLowerCase().replace(/_/g, "-");
  switch (normalized) {
    case "researcher":
      return "@Researcher";
    case "orchestrator":
      return "@Orchestrator";
    case "coder":
      return "@Coder";
    case "analyzer":
      return "@Analyzer";
    case "academic-writer":
    case "writer":
      return "@Writer";
    case "reviewer":
      return "@Reviewer";
    case "cross-reviewer":
      return "@Cross-Reviewer";
    default:
      return `@${normalized}`;
  }
}

function formatStageLabel(stage: string | null | undefined): string {
  if (!stage) {
    return "unknown";
  }
  return stage.replace(/_/g, " ");
}

function summarizeRecommendedAction(
  actions: StageBroadcastAction[] | undefined
): string | null {
  if (!Array.isArray(actions) || actions.length === 0) {
    return null;
  }
  const primary =
    actions.find((action) => action.kind === "drive_stage") ?? actions[0] ?? null;
  if (!primary) {
    return null;
  }
  const fragments = [primary.summary.trim()];
  if (primary.command) {
    fragments.push(`Command: ${primary.command}`);
  }
  if (primary.mailboxMessageId) {
    fragments.push(`Mailbox: ${primary.mailboxMessageId}`);
  }
  return fragments.join(" | ");
}

function collectParticipantSummaries(params: {
  ownerAfter: string | null;
  recommendedActions?: StageBroadcastAction[];
  agentTaskDispatch?: StageBroadcastDispatch | null;
}): string[] {
  const participants = new Map<string, string>();

  if (params.agentTaskDispatch?.owner) {
    const dispatchDetails = [];
    if (params.agentTaskDispatch.dispatched === true) {
      dispatchDetails.push("task dispatched");
    } else if (params.agentTaskDispatch.blockedByCooldown === true) {
      dispatchDetails.push("dispatch cooling down");
    } else {
      dispatchDetails.push("dispatch pending");
    }
    if (params.agentTaskDispatch.strategy) {
      dispatchDetails.push(`via ${params.agentTaskDispatch.strategy}`);
    }
    participants.set(params.agentTaskDispatch.owner, dispatchDetails.join(", "));
  }

  for (const action of params.recommendedActions ?? []) {
    const owner = action.owner;
    if (!owner || owner === params.ownerAfter) {
      continue;
    }
    const details = [];
    if (action.summary?.trim()) {
      details.push(action.summary.trim());
    }
    if (action.command) {
      details.push(`command ${action.command}`);
    }
    if (action.mailboxMessageId) {
      details.push(`mailbox ${action.mailboxMessageId}`);
    }
    if (action.blocking) {
      details.push("currently blocked");
    }
    if (details.length === 0) {
      details.push("participating in the current workflow handoff");
    }
    const existing = participants.get(owner);
    participants.set(owner, existing ? `${existing}; ${details.join(", ")}` : details.join(", "));
  }

  return Array.from(participants.entries()).map(
    ([agent, task]) => `${agent}: ${task}`
  );
}

function collectMentionTargets(params: {
  ownerAfter: string | null;
  recommendedActions?: StageBroadcastAction[];
  agentTaskDispatch?: StageBroadcastDispatch | null;
}): string[] {
  const primaryMention =
    roleToMention(params.agentTaskDispatch?.owner) ?? roleToMention(params.ownerAfter);
  return primaryMention ? [primaryMention] : [];
}

export function isWorkflowStageBroadcastMessage(text: string | null | undefined): boolean {
  return Boolean(text && /^\s*\[Workflow Stage Update\]/i.test(text));
}

export function buildWorkflowStatusBroadcastMessage(params: {
  projectId: string | null;
  projectRoot: string | null;
  status: WorkflowStatusBroadcastStatus;
  stage?: string | null;
  summary: string;
}) {
  const lines = [
    "WORKFLOW_STATUS_BROADCAST=1",
    "BEGIN_UPDATE",
    "[Workflow Status]",
    `[STATUS] ${params.status.replace(/_/g, " ")}${params.stage ? ` (${formatStageLabel(params.stage)})` : ""}`,
    "[HANDOFF] next owner: none",
    `[ARTIFACTS] ${params.summary.trim()}`,
    "[NEXT] none",
    `Project: ${params.projectId ?? "unknown"}`,
    `Project Root: ${params.projectRoot ?? "unknown"}`,
    `Status: ${params.status.replace(/_/g, " ")}`,
    params.stage ? `Stage: ${formatStageLabel(params.stage)}` : null,
    `Summary: ${params.summary.trim()}`,
    "END_UPDATE",
    "Post the exact update between BEGIN_UPDATE and END_UPDATE to the current channel.",
    "Keep the update concise.",
    "Do not call tools, do not continue the workflow, and stop immediately after the update.",
  ];
  return `${lines.filter(Boolean).join("\n")}\n`;
}

export function buildAutoIteratorStageBroadcastMessage(params: {
  projectId: string | null;
  projectRoot: string | null;
  stageBefore: string | null;
  stageAfter: string | null;
  ownerBefore: string | null;
  ownerAfter: string | null;
  nextAction: string | null;
  blockingReason: string | null;
  regressed?: boolean;
  recommendedActions?: StageBroadcastAction[];
  agentTaskDispatch?: StageBroadcastDispatch | null;
  handoffIntentId?: string | null;
}): string {
  const recommendedAction = summarizeRecommendedAction(params.recommendedActions);
  const participantSummaries = collectParticipantSummaries({
    ownerAfter: params.ownerAfter,
    recommendedActions: params.recommendedActions,
    agentTaskDispatch: params.agentTaskDispatch,
  });
  const mentionTargets = collectMentionTargets({
    ownerAfter: params.ownerAfter,
    recommendedActions: params.recommendedActions,
    agentTaskDispatch: params.agentTaskDispatch,
  });
  const transitionVerb =
    params.regressed === true ? "Workflow regressed" : "Workflow advanced";
  const lines = [
    "WORKFLOW_STAGE_BROADCAST=1",
    "BEGIN_UPDATE",
    "[Workflow Stage Update]",
    `Project: ${params.projectId ?? "unknown"}`,
    `Project Root: ${params.projectRoot ?? "unknown"}`,
  ];
  if (mentionTargets.length > 0) {
    lines.push(`Notify: ${mentionTargets.join(" ")}`);
  }
  if (params.handoffIntentId) {
    lines.push(`Handoff Intent: ${params.handoffIntentId}`);
    lines.push(
      `Ack Command: research_workflow ack_handoff_intent handoffIntentId=${params.handoffIntentId}`
    );
  }
  lines.push(
    `[STATUS] ${transitionVerb}: ${formatStageLabel(params.stageBefore)} -> ${formatStageLabel(
      params.stageAfter
    )}`,
    `[HANDOFF] next owner: ${mentionTargets[0] ?? params.ownerAfter ?? "none"}`,
    `[ARTIFACTS] ${
      recommendedAction ??
      "Workflow state reconciled, ownership updated, and durable routing artifacts refreshed."
    }`,
    `[NEXT] ${params.nextAction ?? "none"}`
  );
  lines.push(
    `${transitionVerb}: ${formatStageLabel(params.stageBefore)} -> ${formatStageLabel(
      params.stageAfter
    )}`,
    `Owner: ${params.ownerBefore ?? "unknown"} -> ${params.ownerAfter ?? "unknown"}`,
    `Next action: ${params.nextAction ?? "none"}`
  );

  const ownerMention = roleToMention(params.ownerAfter);
  if (ownerMention) {
    lines.push(`Responsible agent: ${ownerMention}`);
  }

  if (params.blockingReason) {
    lines.push(`Blocking reason: ${params.blockingReason}`);
  }
  if (recommendedAction) {
    lines.push(`Recommended action: ${recommendedAction}`);
  }
  if (participantSummaries.length > 0) {
    lines.push(`Agent participation: ${participantSummaries.join(" | ")}`);
  }
  if (params.agentTaskDispatch) {
    const dispatchFragments = [
      `dispatched=${params.agentTaskDispatch.dispatched === true ? "yes" : "no"}`,
    ];
    if (params.agentTaskDispatch.owner) {
      dispatchFragments.push(`owner=${params.agentTaskDispatch.owner}`);
    }
    if (params.agentTaskDispatch.strategy) {
      dispatchFragments.push(`strategy=${params.agentTaskDispatch.strategy}`);
    }
    if (params.agentTaskDispatch.channel) {
      dispatchFragments.push(`channel=${params.agentTaskDispatch.channel}`);
    }
    if (params.agentTaskDispatch.blockedByCooldown === true) {
      dispatchFragments.push("blocked_by_cooldown=yes");
    }
    if (
      typeof params.agentTaskDispatch.cooldownRemainingSeconds === "number" &&
      Number.isFinite(params.agentTaskDispatch.cooldownRemainingSeconds)
    ) {
      dispatchFragments.push(
        `cooldown_seconds=${Math.max(
          0,
          Math.floor(params.agentTaskDispatch.cooldownRemainingSeconds)
        )}`
      );
    }
    lines.push(`Dispatch: ${dispatchFragments.join(", ")}`);
  }

  lines.push(
    "END_UPDATE",
    "Post the exact update between BEGIN_UPDATE and END_UPDATE to the current channel.",
    "Preserve any raw @Agent mention in the Notify, [HANDOFF], or Responsible agent lines.",
    "If other agents are participating, keep them named with their responsibilities.",
    "Do not call tools, do not continue the workflow, and stop after posting the update."
  );
  return `${lines.join("\n")}\n`;
}

export async function maybeBroadcastAutoIteratorStageChange(params: {
  workflowRuntime?: StageBroadcastRuntime;
  bindingPolicy?: ChannelProjectBindingPolicy;
  sessionKey?: string;
  projectId: string | null;
  projectRoot: string | null;
  stageBefore: string | null;
  stageAfter: string | null;
  stageChanged: boolean;
  ownerBefore: string | null;
  ownerAfter: string | null;
  nextAction: string | null;
  blockingReason: string | null;
  regressed?: boolean;
  recommendedActions?: StageBroadcastAction[];
  agentTaskDispatch?: StageBroadcastDispatch | null;
  handoffIntentId?: string | null;
}): Promise<StageBroadcastResult> {
  if (!params.stageChanged) {
    return {
      broadcasted: false,
      reasonSkipped: "stage_unchanged",
      runId: null,
      sessionKey: params.sessionKey ?? null,
      idempotencyKey: null,
    };
  }
  if (!params.workflowRuntime) {
    return {
      broadcasted: false,
      reasonSkipped: "runtime_unavailable",
      runId: null,
      sessionKey: params.sessionKey ?? null,
      idempotencyKey: null,
    };
  }
  if (!params.sessionKey) {
    return {
      broadcasted: false,
      reasonSkipped: "session_unavailable",
      runId: null,
      sessionKey: null,
      idempotencyKey: null,
    };
  }

  const idempotencyKey = [
    "openclaw-research:stage-broadcast",
    params.sessionKey,
    params.projectId ?? "unknown-project",
    params.stageBefore ?? "unknown-before",
    params.stageAfter ?? "unknown-after",
    params.ownerAfter ?? "unknown-owner",
  ].join(":");
  const message = buildAutoIteratorStageBroadcastMessage({
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    stageBefore: params.stageBefore,
    stageAfter: params.stageAfter,
    ownerBefore: params.ownerBefore,
    ownerAfter: params.ownerAfter,
    nextAction: params.nextAction,
    blockingReason: params.blockingReason,
    regressed: params.regressed,
    recommendedActions: params.recommendedActions,
    agentTaskDispatch: params.agentTaskDispatch,
    handoffIntentId: params.handoffIntentId,
  });
  const bindingSuppressed = await maybeSuppressBindingMismatchedBroadcast({
    bindingPolicy: params.bindingPolicy,
    sessionKey: params.sessionKey,
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    idempotencyKey,
    broadcastId: idempotencyKey,
    status:
      params.agentTaskDispatch?.dispatched === true ? "handed_off" : "continued",
    stage: params.stageAfter,
    summary:
      params.nextAction ??
      `Workflow stage changed from ${params.stageBefore ?? "unknown"} to ${params.stageAfter ?? "unknown"}.`,
  });
  if (bindingSuppressed.suppressed) {
    return {
      broadcasted: false,
      reasonSkipped: "binding_mismatch",
      runId: null,
      sessionKey: params.sessionKey,
      idempotencyKey,
    };
  }
  if (params.projectRoot) {
    const existingStore = await readWorkflowBroadcastOutboxStore(params.projectRoot);
    const supersededEntries = existingStore.entries.map((entry) =>
      entry.idempotencyKey !== idempotencyKey &&
      entry.idempotencyKey.startsWith(
        [
          "openclaw-research:stage-broadcast",
          params.sessionKey,
          params.projectId ?? "unknown-project",
        ].join(":")
      ) &&
      (entry.deliveryStatus === "pending" || entry.deliveryStatus === "failed")
        ? {
            ...entry,
            deliveryStatus: "superseded" as const,
            lastError:
              entry.lastError ??
              `Superseded by newer stage broadcast ${params.stageBefore ?? "unknown"} -> ${params.stageAfter ?? "unknown"}.`,
          }
        : entry
    );
    if (supersededEntries.some((entry, index) => entry !== existingStore.entries[index])) {
      await writeWorkflowBroadcastOutboxStore({
        projectRoot: params.projectRoot,
        projectId: params.projectId,
        entries: supersededEntries,
      });
    }
    const recorded = await recordWorkflowBroadcastEvent({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      broadcastId: idempotencyKey,
      idempotencyKey,
      sessionKey: params.sessionKey,
      status:
        params.agentTaskDispatch?.dispatched === true ? "handed_off" : "continued",
      stage: params.stageAfter,
      summary:
        params.nextAction ??
        `Workflow stage changed from ${params.stageBefore ?? "unknown"} to ${params.stageAfter ?? "unknown"}.`,
      deliveryStatus: "pending",
    });
    if (
      !recorded.created &&
      (recorded.entry.deliveryStatus === "pending" ||
        recorded.entry.deliveryStatus === "sending" ||
        recorded.entry.deliveryStatus === "delivered")
    ) {
      return {
        broadcasted: false,
        reasonSkipped: `duplicate_${recorded.entry.deliveryStatus}`,
        runId: null,
        sessionKey: params.sessionKey,
        idempotencyKey,
      };
    }
  }
  const budgeted = await applyWorkflowBroadcastBudget({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    sessionKey: params.sessionKey,
    broadcastId: idempotencyKey,
    idempotencyKey,
    message,
    summary:
      params.nextAction ??
      `Workflow stage changed from ${params.stageBefore ?? "unknown"} to ${params.stageAfter ?? "unknown"}.`,
  });
  try {
    const runId = (
      await params.workflowRuntime.run({
        sessionKey: params.sessionKey,
        message: budgeted.message,
        lane: "nested",
        deliver: true,
        idempotencyKey,
        extraSystemPrompt:
          "WORKFLOW_STAGE_BROADCAST=1\n" +
          "This is a synthetic workflow stage-change broadcast. Post exactly one concise channel update, preserve raw @Agent mentions from the prepared update, do not call tools, do not advance the workflow, and stop immediately after the update.",
      })
    ).runId;

    if (params.projectRoot) {
      await markWorkflowBroadcastEvent({
        projectRoot: params.projectRoot,
        idempotencyKey,
        deliveryStatus: "delivered",
        deliveredAt: new Date().toISOString(),
        lastAttemptedAt: new Date().toISOString(),
        attemptsIncrement: 1,
      });
    }

    return {
      broadcasted: true,
      reasonSkipped: null,
      runId,
      sessionKey: params.sessionKey,
      idempotencyKey,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (params.projectRoot) {
      await markWorkflowBroadcastEvent({
        projectRoot: params.projectRoot,
        idempotencyKey,
        deliveryStatus: "failed",
        runError: errorMessage,
        lastAttemptedAt: new Date().toISOString(),
        attemptsIncrement: 1,
      });
      if (/Discord inbound worker timed out/i.test(errorMessage)) {
        await recordWorkflowRuntimeIncident({
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          idempotencyKey: `discord-inbound-timeout:${idempotencyKey}`,
          kind: "discord_inbound_timeout",
          severity: "warning",
          summary:
            "Discord inbound worker timed out while delivering a workflow stage broadcast.",
          sessionKey: params.sessionKey,
          error: errorMessage,
          details: {
            broadcastId: idempotencyKey,
            stageBefore: params.stageBefore,
            stageAfter: params.stageAfter,
          },
        });
      }
    }
    return {
      broadcasted: false,
      reasonSkipped: "runtime_error",
      runId: null,
      sessionKey: params.sessionKey,
      idempotencyKey,
    };
  }
}

export async function maybeBroadcastWorkflowStatusUpdate(params: {
  workflowRuntime?: StageBroadcastRuntime;
  bindingPolicy?: ChannelProjectBindingPolicy;
  sessionKey?: string | null;
  projectId: string | null;
  projectRoot: string | null;
  status: WorkflowStatusBroadcastStatus;
  stage?: string | null;
  summary: string;
  idempotencyKeySuffix?: string | null;
}): Promise<WorkflowStatusBroadcastResult> {
  if (!params.workflowRuntime) {
    return {
      broadcasted: false,
      reasonSkipped: "runtime_unavailable",
      runId: null,
      sessionKey: params.sessionKey ?? null,
      idempotencyKey: null,
    };
  }
  if (!params.sessionKey) {
    return {
      broadcasted: false,
      reasonSkipped: "session_unavailable",
      runId: null,
      sessionKey: null,
      idempotencyKey: null,
    };
  }
  if (!params.summary.trim()) {
    return {
      broadcasted: false,
      reasonSkipped: "empty_summary",
      runId: null,
      sessionKey: params.sessionKey,
      idempotencyKey: null,
    };
  }

  const idempotencyKey = [
    "openclaw-research:status-broadcast",
    params.sessionKey,
    params.projectId ?? "unknown-project",
    params.status,
    params.stage ?? "unknown-stage",
    params.idempotencyKeySuffix ?? params.summary.trim().slice(0, 80),
  ].join(":");
  const bindingSuppressed = await maybeSuppressBindingMismatchedBroadcast({
    bindingPolicy: params.bindingPolicy,
    sessionKey: params.sessionKey,
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    idempotencyKey,
    broadcastId: idempotencyKey,
    status: params.status,
    stage: params.stage ?? null,
    summary: params.summary,
  });
  if (bindingSuppressed.suppressed) {
    return {
      broadcasted: false,
      reasonSkipped: "binding_mismatch",
      runId: null,
      sessionKey: params.sessionKey,
      idempotencyKey,
    };
  }
  if (params.projectRoot) {
    const recorded = await recordWorkflowBroadcastEvent({
      projectRoot: params.projectRoot,
      projectId: params.projectId,
      broadcastId: idempotencyKey,
      idempotencyKey,
      sessionKey: params.sessionKey,
      status: params.status,
      stage: params.stage,
      summary: params.summary,
      deliveryStatus: "pending",
    });
    if (
      !recorded.created &&
      (recorded.entry.deliveryStatus === "pending" ||
        recorded.entry.deliveryStatus === "sending" ||
        recorded.entry.deliveryStatus === "delivered")
    ) {
      return {
        broadcasted: false,
        reasonSkipped: `duplicate_${recorded.entry.deliveryStatus}`,
        runId: null,
        sessionKey: params.sessionKey,
        idempotencyKey,
      };
    }
  }
  const budgeted = await applyWorkflowBroadcastBudget({
    projectRoot: params.projectRoot,
    projectId: params.projectId,
    sessionKey: params.sessionKey,
    broadcastId: idempotencyKey,
    idempotencyKey,
    message: buildWorkflowStatusBroadcastMessage({
      projectId: params.projectId,
      projectRoot: params.projectRoot,
      status: params.status,
      stage: params.stage,
      summary: params.summary,
    }),
    summary: params.summary,
  });
  try {
    const runId = (
      await params.workflowRuntime.run({
        sessionKey: params.sessionKey,
        message: budgeted.message,
        lane: "nested",
        deliver: true,
        idempotencyKey,
        extraSystemPrompt:
          "WORKFLOW_STATUS_BROADCAST=1\n" +
          "This is a synthetic workflow status broadcast. Post exactly one concise channel update, do not call tools, do not advance the workflow, and stop immediately after the update.",
      })
    ).runId;
    if (params.projectRoot) {
      await markWorkflowBroadcastEvent({
        projectRoot: params.projectRoot,
        idempotencyKey,
        deliveryStatus: "delivered",
        deliveredAt: new Date().toISOString(),
        lastAttemptedAt: new Date().toISOString(),
        attemptsIncrement: 1,
      });
    }
    return {
      broadcasted: true,
      reasonSkipped: null,
      runId,
      sessionKey: params.sessionKey,
      idempotencyKey,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (params.projectRoot) {
      await markWorkflowBroadcastEvent({
        projectRoot: params.projectRoot,
        idempotencyKey,
        deliveryStatus: "failed",
        runError: errorMessage,
        lastAttemptedAt: new Date().toISOString(),
        attemptsIncrement: 1,
      });
      if (/Discord inbound worker timed out/i.test(errorMessage)) {
        await recordWorkflowRuntimeIncident({
          projectRoot: params.projectRoot,
          projectId: params.projectId,
          idempotencyKey: `discord-inbound-timeout:${idempotencyKey}`,
          kind: "discord_inbound_timeout",
          severity: "warning",
          summary:
            "Discord inbound worker timed out while delivering a workflow status broadcast.",
          sessionKey: params.sessionKey,
          error: errorMessage,
          details: {
            broadcastId: idempotencyKey,
            stage: params.stage,
            status: params.status,
          },
        });
      }
    }
    return {
      broadcasted: false,
      reasonSkipped: "runtime_error",
      runId: null,
      sessionKey: params.sessionKey,
      idempotencyKey,
    };
  }
}
