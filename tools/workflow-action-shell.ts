import * as path from "node:path";
import {
  bindChannelProjectForWorkflow,
  getChannelProjectBindingForWorkflow,
  listChannelProjectBindingsForWorkflow,
  unbindChannelProjectForWorkflow,
  type WorkflowSnapshot,
} from "./workflow-guard";
import {
  readString,
  textResponse,
  type PluginRegistrationContext,
  type ToolContext,
} from "./plugin-registration-shared";

type WorkflowPolicy = ReturnType<PluginRegistrationContext["getWorkflowPolicy"]>;
type TextToolResponse = ReturnType<typeof textResponse>;

function normalizeComparableProjectRoot(value: string | null | undefined): string | null {
  const normalized = readString(value);
  return normalized ? path.resolve(normalized) : null;
}

function projectRootsMatch(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  const normalizedLeft = normalizeComparableProjectRoot(left);
  const normalizedRight = normalizeComparableProjectRoot(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function projectIdsCompatible(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  const normalizedLeft = readString(left);
  const normalizedRight = readString(right);
  return !normalizedLeft || !normalizedRight || normalizedLeft === normalizedRight;
}

function isLocalWorkflowTransport(
  messageChannel: string | null | undefined,
  channelKey: string | null | undefined,
  sessionKey?: string | null | undefined
): boolean {
  const normalizedChannel = readString(messageChannel)?.toLowerCase() ?? null;
  const normalizedKey = readString(channelKey)?.toLowerCase() ?? null;
  const normalizedSessionKey = readString(sessionKey)?.toLowerCase() ?? null;
  return (
    normalizedChannel === "local" ||
    normalizedKey?.startsWith("local:") === true ||
    normalizedKey?.startsWith("binding:local:") === true ||
    normalizedSessionKey?.startsWith("local:") === true ||
    normalizedSessionKey?.includes(":local:") === true
  );
}

function maybeResolveLocalWorkflowProjectContext(params: {
  workflowPolicy: WorkflowPolicy;
  ctx: ToolContext;
  channelBinding: Record<string, unknown> | null;
  snapshot: WorkflowSnapshot;
  requestedProjectRoot: string | null;
  requestedProjectId: string | null;
}) {
  const channelKey =
    readString(params.channelBinding?.channelKey) ?? readString(params.ctx.channelKey);
  const localTransport = isLocalWorkflowTransport(
    params.ctx.messageChannel,
    channelKey,
    params.ctx.sessionKey
  );

  const existing = getChannelProjectBindingForWorkflow({
    policy: params.workflowPolicy,
    workspaceDir: params.ctx.workspaceDir,
    sessionKey: params.ctx.sessionKey,
    sessionId: params.ctx.sessionId,
    messageChannel: params.ctx.messageChannel,
    channelKey,
  });
  const requestedProjectRoot =
    params.requestedProjectRoot ??
    params.snapshot.projectRoot ??
    existing.binding?.projectRoot ??
    null;
  const requestedProjectId =
    params.requestedProjectId ??
    params.snapshot.projectId ??
    existing.binding?.projectId ??
    null;
  const existingMatches =
    existing.binding &&
    projectRootsMatch(existing.binding.projectRoot, requestedProjectRoot) &&
    projectIdsCompatible(existing.binding.projectId, requestedProjectId);
  const snapshotMatches =
    params.snapshot.projectRoot &&
    projectRootsMatch(params.snapshot.projectRoot, requestedProjectRoot) &&
    projectIdsCompatible(params.snapshot.projectId, requestedProjectId);
  const workspaceMatches =
    params.ctx.workspaceDir &&
    projectRootsMatch(params.ctx.workspaceDir, requestedProjectRoot) &&
    projectIdsCompatible(params.snapshot.projectId, requestedProjectId);
  if (!requestedProjectRoot) {
    return null;
  }
  const explicitProjectContext = Boolean(params.requestedProjectRoot);
  if (
    !existingMatches &&
    !snapshotMatches &&
    !workspaceMatches &&
    !explicitProjectContext
  ) {
    return null;
  }

  return {
    ...existing,
    resolvedOnly: true,
    reason: existingMatches
      ? localTransport
        ? "existing_local_workflow_context"
        : "existing_channel_workflow_context"
      : localTransport
        ? "snapshot_local_workflow_context"
        : snapshotMatches
          ? "snapshot_workflow_context"
          : workspaceMatches
            ? "workspace_project_context"
            : "explicit_project_context",
    projectRoot: path.resolve(requestedProjectRoot),
    projectId: readString(requestedProjectId) ?? path.basename(requestedProjectRoot),
    binding:
      existing.binding ??
      {
        channelKey: existing.channelKey,
        projectRoot: path.resolve(requestedProjectRoot),
        projectId: readString(requestedProjectId) ?? path.basename(requestedProjectRoot),
        messageChannel: readString(params.ctx.messageChannel),
        workflowRole: readString(params.ctx.agentId),
      },
  };
}

export async function executeChannelProjectBindingActionShell(params: {
  action: string;
  workflowPolicy: WorkflowPolicy;
  ctx: ToolContext;
  rawParams: Record<string, unknown>;
  channelBinding: Record<string, unknown> | null;
  snapshot: WorkflowSnapshot;
  bindingRole: string | null;
}): Promise<TextToolResponse | null> {
  const channelKey =
    readString(params.channelBinding?.channelKey) ?? readString(params.ctx.channelKey);
  switch (params.action) {
    case "get_channel_project_binding": {
      const binding = getChannelProjectBindingForWorkflow({
        policy: params.workflowPolicy,
        workspaceDir: params.ctx.workspaceDir,
        sessionKey: params.ctx.sessionKey,
        sessionId: params.ctx.sessionId,
        messageChannel: params.ctx.messageChannel,
        channelKey,
      });
      return textResponse(JSON.stringify(binding, null, 2));
    }
    case "list_channel_project_bindings": {
      const bindings = listChannelProjectBindingsForWorkflow({
        policy: params.workflowPolicy,
        workspaceDir: params.ctx.workspaceDir,
      });
      return textResponse(JSON.stringify(bindings, null, 2));
    }
    case "bind_channel_project": {
      const requestedProjectRoot =
        readString(params.channelBinding?.projectRoot) ??
        readString(params.channelBinding?.project_path) ??
        readString(params.rawParams.projectRoot) ??
        readString(params.rawParams.project_root) ??
        process.env.OPENCLAW_PROJECT ??
        params.snapshot.projectRoot;
      const requestedProjectId =
        readString(params.channelBinding?.projectId) ??
        readString(params.channelBinding?.project_id) ??
        readString(params.rawParams.projectId) ??
        readString(params.rawParams.project_id) ??
        params.snapshot.projectId;
      if (params.bindingRole && params.bindingRole !== "researcher") {
        const localContext = maybeResolveLocalWorkflowProjectContext({
          workflowPolicy: params.workflowPolicy,
          ctx: params.ctx,
          channelBinding: params.channelBinding,
          snapshot: params.snapshot,
          requestedProjectRoot,
          requestedProjectId,
        });
        if (localContext) {
          return textResponse(JSON.stringify(localContext, null, 2));
        }
        throw new Error(
          "Only Researcher may create or rebind a channel session project binding in this workflow. Non-Researcher workflow sessions may only resolve an existing or snapshot-matched project context."
        );
      }
      const bound = await bindChannelProjectForWorkflow({
        policy: params.workflowPolicy,
        workspaceDir: params.ctx.workspaceDir,
        sessionKey: params.ctx.sessionKey,
        sessionId: params.ctx.sessionId,
        messageChannel: params.ctx.messageChannel,
        channelKey,
        projectRoot: requestedProjectRoot,
        projectId: requestedProjectId,
        title:
          readString(params.channelBinding?.title) ??
          readString(params.channelBinding?.topic),
        topic: readString(params.channelBinding?.topic),
        boundByAgent: params.ctx.agentId,
        notes: readString(params.channelBinding?.notes),
      });
      return textResponse(JSON.stringify(bound, null, 2));
    }
    case "unbind_channel_project": {
      if (params.bindingRole && params.bindingRole !== "researcher") {
        throw new Error(
          "Only Researcher may remove a Discord/channel session project binding in this workflow."
        );
      }
      const result = await unbindChannelProjectForWorkflow({
        policy: params.workflowPolicy,
        workspaceDir: params.ctx.workspaceDir,
        sessionKey: params.ctx.sessionKey,
        sessionId: params.ctx.sessionId,
        messageChannel: params.ctx.messageChannel,
        channelKey,
      });
      return textResponse(JSON.stringify(result, null, 2));
    }
    default:
      return null;
  }
}
