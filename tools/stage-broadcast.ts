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
  const targets = new Set<string>();
  const ownerMention = roleToMention(params.ownerAfter);
  if (ownerMention) {
    targets.add(ownerMention);
  }
  const dispatchMention = roleToMention(params.agentTaskDispatch?.owner);
  if (dispatchMention) {
    targets.add(dispatchMention);
  }
  for (const action of params.recommendedActions ?? []) {
    const mention = roleToMention(action.owner);
    if (mention) {
      targets.add(mention);
    }
  }
  return Array.from(targets);
}

export function isWorkflowStageBroadcastMessage(text: string | null | undefined): boolean {
  return Boolean(text && /^\s*\[Workflow Stage Update\]/i.test(text));
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
    "Preserve any raw @Agent mentions in the Notify or Responsible agent lines.",
    "If other agents are participating, keep them named with their responsibilities.",
    "Do not call tools, do not continue the workflow, and stop after posting the update."
  );
  return `${lines.join("\n")}\n`;
}

export async function maybeBroadcastAutoIteratorStageChange(params: {
  runtimeSubagent?: StageBroadcastRuntime;
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
  if (!params.runtimeSubagent) {
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
  });
  const runId = (
    await params.runtimeSubagent.run({
      sessionKey: params.sessionKey,
      message,
      lane: "nested",
      deliver: true,
      idempotencyKey,
      extraSystemPrompt:
        "WORKFLOW_STAGE_BROADCAST=1\n" +
        "This is a synthetic workflow stage-change broadcast. Post exactly one concise channel update, preserve raw @Agent mentions from the prepared update, do not call tools, do not advance the workflow, and stop immediately after the update.",
    })
  ).runId;

  return {
    broadcasted: true,
    reasonSkipped: null,
    runId,
    sessionKey: params.sessionKey,
    idempotencyKey,
  };
}
