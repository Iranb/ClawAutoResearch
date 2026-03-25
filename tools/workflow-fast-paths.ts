import {
  bindChannelProjectForWorkflow,
  ensureWorkflowProjectRoot,
  type WorkflowGuardPolicy,
} from "./workflow-guard";

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
  };
  workflowPolicy: WorkflowGuardPolicy;
  agentCtx: BackgroundRunAgentContext;
  snapshot: BackgroundRunSnapshot;
  backgroundRun: BackgroundRunRequest;
}) {
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
      : null);
  if (!commandText) {
    throw new Error(
      "backgroundRun.commandText is required unless kind=research_pipeline."
    );
  }

  const runId = (
    await params.runtimeSubagent.run({
      sessionKey: params.agentCtx.sessionKey,
      message: commandText,
      lane: "nested",
      deliver: true,
      idempotencyKey: `openclaw-research:bg:${params.agentCtx.sessionKey}:${Date.now()}`,
      extraSystemPrompt:
        "BACKGROUND_WORKFLOW_CONTINUATION=1\n" +
        "This run was launched from a slash-command fast path. Immediately acknowledge in-channel that the task has started, then continue the requested workflow. Report concise progress when a stage changes, when a blocker appears, or when a durable handoff is queued. Use research_workflow mailbox for bounded handoffs, and do not call research_workflow start_background_run again from this continuation.",
    })
  ).runId;

  return {
    started: true,
    runId,
    sessionKey: params.agentCtx.sessionKey,
    projectRoot:
      ensuredProject?.projectRoot ?? params.snapshot.projectRoot ?? null,
    projectId: ensuredProject?.projectId ?? params.snapshot.projectId ?? null,
    summary:
      readString(params.backgroundRun.summary) ??
      (normalizedKind === "research_pipeline"
        ? `Background research pipeline started for ${topic ?? ensuredProject?.title ?? "research topic"}.`
        : normalizedKind === "resume_pipeline"
          ? `Background resume pipeline started for ${readString(params.backgroundRun.projectId) ?? params.snapshot.projectId ?? "the current project"}.`
        : "Background workflow run started."),
  };
}
